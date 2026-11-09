-- =============================================================================
-- Les absences ne débitent PLUS le solde de l'élève
-- Run once against the live project (Supabase Dashboard -> SQL Editor).
--
-- Décision métier (client) :
--   * supprimer la FACTURATION AUTOMATIQUE des absences (plus aucune séance
--     n'est retirée du solde toute seule) ;
--   * supprimer le DÉBIT du solde lié à une absence, qu'elle soit posée
--     automatiquement ou à la main.
--   Les absences restent ENREGISTRÉES et visibles dans « Présences » — seul le
--   retrait d'argent disparaît.
--
-- Ce que fait ce script :
--   1. éteint l'interrupteur (absence_penalty_enabled = false) ;
--   2. remplace process_weekly_absences() par une fonction NEUTRE : elle ne
--      parcourt plus les inscriptions, n'écrit plus dans absence_penalties et
--      ne touche plus jamais public.students.balance ni balance_tx. Elle reste
--      présente (l'app l'appelait auparavant) mais ne fait rien ;
--   3. désactive la tâche pg_cron « weekly-absence-penalties » si elle existe.
--
-- Le REMBOURSEMENT des sommes déjà retirées se fait avec le script séparé
-- supabase/standalone/refund_absence_deductions.sql.
-- =============================================================================

-- 1. Interrupteur éteint (au cas où un appel passerait encore).
update public.school
   set absence_penalty_enabled = false
 where id is not null;

-- 2. La fonction devient neutre : aucune écriture, aucun débit.
create or replace function public.process_weekly_absences(p_when timestamptz default now())
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_role user_role := public.current_role();
begin
  -- Les appelants web restent le personnel ; un rôle NULL = contexte serveur/cron.
  if auth.uid() is not null and (v_role is null or v_role not in ('admin', 'reception')) then
    raise exception 'not authorized';
  end if;

  -- Facturation automatique des absences RETIRÉE : ne rien faire, ne rien
  -- débiter. On garde la fonction pour ne pas casser d'éventuels appels.
  perform 1 from public.school limit 1;  -- WHERE-less no-op safe sous safeupdate
  return jsonb_build_object('ok', true, 'enabled', false, 'removed', true,
                            'charged', 0, 'students', 0);
end;
$$;

revoke execute on function public.process_weekly_absences(timestamptz) from public, anon;
grant execute on function public.process_weekly_absences(timestamptz) to authenticated;

-- 3. Couper la tâche nocturne si pg_cron est installé.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'weekly-absence-penalties') then
      perform cron.unschedule('weekly-absence-penalties');
    end if;
  end if;
exception when others then
  null;
end $$;

notify pgrst, 'reload schema';
