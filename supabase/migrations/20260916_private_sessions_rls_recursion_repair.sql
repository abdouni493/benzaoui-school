-- =============================================================================
-- Réparation : l'écran PARTICULIER n'affiche plus aucune demande
-- Run once against the live project (Supabase Dashboard -> SQL Editor).
-- IDEMPOTENT : ré-exécutable sans risque.
--
-- Symptômes corrigés
-- ------------------
--   GET /rest/v1/private_sessions        -> 500
--   GET /rest/v1/private_session_modules -> 500
--     « infinite recursion detected in policy for relation "private_sessions" »
--
--   POST /rest/v1/rpc/process_weekly_absences -> 400
--     (la facturation hebdomadaire des absences ne tourne plus)
--
-- Cause de la récursion
-- ---------------------
-- Les deux policies de 20260912 se lisent l'une l'autre :
--
--   private_sessions_select        -> « existe-t-il une ligne de
--                                       private_session_modules pour moi ? »
--   private_session_modules_select -> « existe-t-il une ligne de
--                                       private_sessions pour moi ? »
--
-- Postgres applique la policy de la table interrogée DANS le sous-select, qui
-- interroge l'autre table, dont la policy interroge la première… La base coupe
-- au bout de quelques tours et renvoie 500 — sur les DEUX tables à la fois.
-- L'écran Particulier n'a alors plus ni séance, ni module : il affiche
-- « aucune demande » alors que la base en est pleine.
--
-- Ce que ce script change
-- -----------------------
-- Le croisement entre les deux tables sort de la policy et passe dans une
-- fonction SECURITY DEFINER. Une telle fonction s'exécute sous le propriétaire
-- des tables, qui n'est pas soumis à leur RLS : le sous-select ne déclenche
-- donc plus aucune policy, et la boucle n'a plus lieu d'être.
--
-- LES DROITS NE CHANGENT PAS. Exactement les mêmes lignes restent visibles aux
-- mêmes comptes qu'avant :
--   · le personnel voit tout ;
--   · l'élève concerné (et son parent) voit SA séance et ses modules ;
--   · l'enseignant voit les séances où il a un module, et ses modules à lui.
-- Les fonctions ne rendent qu'un booléen « ce compte est-il concerné par CETTE
-- séance », jamais une ligne.
-- =============================================================================


-- ---------------------------------------------------------------------------
-- 1. Les deux croisements, sortis des policies
-- ---------------------------------------------------------------------------
-- `stable` : le résultat ne change pas pendant la requête, Postgres peut donc
-- l'appeler une fois par ligne sans le recalculer inutilement.

-- Le compte connecté enseigne-t-il un module de cette séance ?
create or replace function public.teaches_private_session(p_session_id uuid)
returns boolean
language sql stable security definer set search_path = public as $fn$
  select exists (
    select 1
    from public.private_session_modules m
    where m.private_session_id = p_session_id
      and m.teacher_id = auth.uid()
  );
$fn$;

-- Le compte connecté assiste-t-il à cette séance — lui-même, ou son enfant ?
create or replace function public.attends_private_session(p_session_id uuid)
returns boolean
language sql stable security definer set search_path = public as $fn$
  select exists (
    select 1
    from public.private_sessions s
    where s.id = p_session_id
      and (s.student_id = auth.uid() or public.is_my_child(s.student_id))
  )
  -- Depuis 20260915 une séance peut porter PLUSIEURS élèves : la table des
  -- participants fait foi dès qu'elle existe, la colonne historique reste lue
  -- pour les séances écrites avant elle.
  or exists (
    select 1
    from public.private_session_students ps
    where ps.private_session_id = p_session_id
      and (ps.student_id = auth.uid() or public.is_my_child(ps.student_id))
  );
$fn$;

revoke execute on function public.teaches_private_session(uuid) from public, anon;
revoke execute on function public.attends_private_session(uuid) from public, anon;
grant execute on function public.teaches_private_session(uuid) to authenticated;
grant execute on function public.attends_private_session(uuid) to authenticated;


-- ---------------------------------------------------------------------------
-- 2. Les policies, réécrites sans récursion
-- ---------------------------------------------------------------------------
drop policy if exists private_sessions_select on public.private_sessions;
create policy private_sessions_select on public.private_sessions for select to authenticated
  using (
    public.is_staff()
    or student_id = auth.uid()
    or public.is_my_child(student_id)
    -- était : un sous-select sur private_session_modules -> récursion
    or public.teaches_private_session(private_sessions.id)
    or public.attends_private_session(private_sessions.id)
  );

drop policy if exists private_session_modules_select on public.private_session_modules;
create policy private_session_modules_select on public.private_session_modules for select to authenticated
  using (
    public.is_staff()
    or teacher_id = auth.uid()
    -- était : un sous-select sur private_sessions -> récursion
    or public.attends_private_session(private_session_id)
  );

-- L'écriture n'a jamais été récursive (elle ne regarde que le rôle), mais on la
-- réaffirme : ce script doit suffire à remettre les deux tables d'aplomb.
drop policy if exists private_sessions_write on public.private_sessions;
create policy private_sessions_write on public.private_sessions for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

drop policy if exists private_session_modules_write on public.private_session_modules;
create policy private_session_modules_write on public.private_session_modules for all to authenticated
  using (public.is_staff()) with check (public.is_staff());


-- ---------------------------------------------------------------------------
-- 3. Les participants d'une séance : l'enseignant doit les voir aussi
-- ---------------------------------------------------------------------------
-- 20260915 ne donnait la table qu'au personnel, à l'élève et à son parent.
-- L'enseignant, lui, voyait sa séance et son module sans jamais savoir QUI il
-- avait en face. Le croisement passe par la même fonction, donc sans récursion.
do $do$ begin
  if to_regclass('public.private_session_students') is not null then
    execute 'drop policy if exists private_session_students_select on public.private_session_students';
    execute $pol$
      create policy private_session_students_select on public.private_session_students
        for select to authenticated
        using (
          public.is_staff()
          or student_id = auth.uid()
          or public.is_my_child(student_id)
          or public.teaches_private_session(private_session_id)
        )
    $pol$;
  end if;
end $do$;


-- ---------------------------------------------------------------------------
-- 4. process_weekly_absences : les colonnes que la fonction attend
-- ---------------------------------------------------------------------------
-- Le corps d'une fonction plpgsql n'est PAS vérifié à sa création : une colonne
-- manquante ne se voit qu'à l'exécution, sous la forme d'un 400 muet côté
-- navigateur. La version de 20260912 lit `sessions.billing_start_date` ; si la
-- base en ligne a reçu la fonction sans la colonne, chaque appel échoue.
-- (Même panne, mêmes symptômes qu'en 20260821 avec `balance_tx.module_id`.)
alter table public.sessions
  add column if not exists billing_start_date date;

alter table public.student_subscriptions
  add column if not exists start_date date,
  add column if not exists expiry_date date,
  add column if not exists subscribed_at date,
  add column if not exists discount_type text,
  add column if not exists discount_value integer not null default 0;

alter table public.balance_tx
  add column if not exists module_id uuid references public.modules (id) on delete set null;

alter table public.school
  add column if not exists absence_penalty_enabled boolean not null default true,
  add column if not exists absence_penalty_since date,
  add column if not exists absence_penalty_last_run date,
  add column if not exists absence_week_start_day smallint not null default 5;


-- ---------------------------------------------------------------------------
-- 5. Rechargement du cache de schéma de l'API REST
-- ---------------------------------------------------------------------------
notify pgrst, 'reload schema';


-- ---------------------------------------------------------------------------
-- 6. Inventaire : ce script a-t-il tout remis en place ?
--    Le résultat doit être VIDE. Chaque ligne nomme ce qui manque encore.
-- ---------------------------------------------------------------------------
with expected_functions (fn, migration) as (values
  ('teaches_private_session', '20260916_private_sessions_rls_recursion_repair'),
  ('attends_private_session', '20260916_private_sessions_rls_recursion_repair'),
  ('process_weekly_absences', '20260912_particulier_workers_accounts_and_billing_start'),
  ('write_private_session_modules', '20260915_teacher_pay_matrix_particulier_workflow')
),
expected_tables (table_name, migration) as (values
  ('private_sessions',         '20260912_particulier_workers_accounts_and_billing_start'),
  ('private_session_modules',  '20260912_particulier_workers_accounts_and_billing_start'),
  ('private_session_students', '20260915_teacher_pay_matrix_particulier_workflow')
),
expected_columns (table_name, column_name, migration) as (values
  ('sessions',              'billing_start_date',       '20260912_particulier_workers_accounts_and_billing_start'),
  ('school',                'absence_penalty_last_run', '20260711_weekly_absence_penalties'),
  ('balance_tx',            'module_id',                '20260708_open_scan_rules_workers'),
  ('student_subscriptions', 'start_date',               '20260704_formation_subscriptions')
)
select 'FONCTION MANQUANTE' as quoi, fn as objet, migration
from expected_functions
where not exists (select 1 from pg_proc p
                  join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = expected_functions.fn)
union all
select 'TABLE MANQUANTE', table_name, migration
from expected_tables
where to_regclass('public.' || table_name) is null
union all
select 'COLONNE MANQUANTE', table_name || '.' || column_name, migration
from expected_columns
where not exists (select 1 from information_schema.columns c
                  where c.table_schema = 'public'
                    and c.table_name = expected_columns.table_name
                    and c.column_name = expected_columns.column_name)
union all
-- Une policy qui interroge encore l'AUTRE table est une récursion qui dort.
select 'POLICY ENCORE RECURSIVE', schemaname || '.' || tablename || ' / ' || policyname,
       '20260916_private_sessions_rls_recursion_repair'
from pg_policies
where schemaname = 'public'
  and ((tablename = 'private_sessions'        and qual like '%private_session_modules%')
    or (tablename = 'private_session_modules' and qual like '%public.private_sessions%'));
