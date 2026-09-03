-- =============================================================================
-- Une séance suivie sans provision doit SE VOIR — et le solde doit la porter
-- Run once against the live project (Supabase Dashboard -> SQL Editor).
--
-- LE SYMPTÔME
--
--   Fiche élève : « Présence: science — A », « -625 DA », « Total débité
--   625 DA ». Sa carte, juste à côté : « Solde Actuel : 0 DA » en vert,
--   « Frais d'inscription : Payé ✔ », et pas la moindre alerte. L'élève a
--   suivi une séance qu'il n'a pas payée, et l'écran le déclare à jour.
--
-- POURQUOI 20260905 N'A PAS SUFFI
--
--   20260905 remet le solde d'accord avec son HISTORIQUE : il recalcule
--   `students.balance` = somme de `balance_tx`. C'est le bon remède quand une
--   écriture absolue a écrasé un solde, parce que la ligne d'historique, elle,
--   est toujours là.
--
--   Ici il ne restait rien à recalculer : l'historique NON PLUS n'a pas la
--   ligne. La présence facture 625 DA, `balance_tx` n'en porte aucune trace,
--   la somme de l'historique vaut donc 0 — exactement le solde stocké. Pour
--   20260905, cet élève était en règle.
--
--   Une présence facturée sans sa ligne d'historique vient de l'un de ces
--   chemins :
--     · une ligne de l'historique a été supprimée depuis la fiche élève
--       (« Supprimer la transaction ») alors que la présence, elle, continuait
--       de facturer la séance ;
--     · une présence écrite par un écran antérieur aux RPC actuelles, quand
--       débit et historique ne partaient pas encore dans la même transaction.
--   Pour annuler VRAIMENT une facturation, il faut passer la présence à 0 DA
--   (bouton Modifier de la ligne de présence) : `update_attendance` déplace
--   alors le solde du même montant et écrit la ligne de correction.
--
-- CE QUE FAIT CE SCRIPT
--
--   1. `mark_attendance` ne refuse plus une présence faute de solde : la
--      saisie manuelle facture toujours, exactement comme le badge depuis
--      20260904. Une présence enregistrée est une séance due.
--   2. Les séances facturées dans la fiche mais absentes de l'historique
--      reçoivent enfin leur ligne — c'est ce qui manquait pour que le solde
--      puisse passer en négatif.
--   3. Les soldes sont remis d'accord avec leur historique, nom par nom : un
--      élève à 0 DA qui doit 625 DA de séances tombe à -625 DA. C'est ce
--      solde négatif qui allume l'alerte de dette sur la carte élève, dans la
--      liste des élèves et sur le tableau de bord.
--   4. Le garde-fou du solde est resserré au passage (voir section 3).
--
-- CE QUE CE SCRIPT NE TOUCHE PAS : aucune présence, aucun abonnement, aucune
-- inscription, aucun mouvement de caisse, aucun autre champ de la fiche élève.
-- Une dette n'est pas un encaissement : rien n'entre en caisse ici.
--
-- Ce script est IDEMPOTENT : ré-exécutable sans risque. La deuxième exécution
-- ne trouve plus rien à corriger.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. mark_attendance — une présence est TOUJOURS facturée
-- ---------------------------------------------------------------------------
-- Identique à 20260904, à un refus près : le solde qui ne couvre pas la séance
-- ne renvoie plus `scan.debtBlocked`. Le badge avait cessé de refuser en
-- 20260904 ; la saisie manuelle, elle, refusait encore — une présence pointée
-- à la main sur un élève à 0 DA repartait donc sans être enregistrée du tout,
-- à moins de cliquer « Forcer ». Les deux chemins disent maintenant la même
-- chose : l'élève a étudié, l'école le lui compte, et la dette se voit partout
-- (carte élève, fiche, liste des élèves, tableau de bord).
create or replace function public.mark_attendance(
  p_student_id uuid,
  p_session_id uuid,
  p_status attendance_status,
  p_date date default null,
  p_allow_debt boolean default false,
  p_skip_teacher_due boolean default false
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_role user_role := public.current_role();
  v_student public.students%rowtype;
  v_session public.sessions%rowtype;
  v_date date := coalesce(p_date, (now() at time zone 'Africa/Algiers')::date);
  v_day day_of_week;
  v_existing public.attendance%rowtype;
  v_has_existing boolean;
  v_price int := 0;
  v_found boolean;
  v_rank int;
  v_cost int;
  v_teacher public.teachers%rowtype;
  v_teacher_base int := 0;
  v_teacher_due int := 0;
  v_teacher_earns boolean := true;
  v_new_balance int;
  v_module_name text;
  v_group_name text;
  v_own_group boolean;
  v_occurred timestamptz;
  v_free public.free_periods%rowtype;
  v_is_free_period boolean := false;
  v_free_seance boolean := false;
  v_enr_start date;
  v_before_start boolean := false;
  v_offered boolean := false;
  v_waived int := 0;
begin
  if v_role is null or v_role not in ('admin', 'reception', 'teacher') then
    raise exception 'not authorized';
  end if;
  if v_role = 'teacher' and not public.teaches_session(p_session_id) then
    raise exception 'not authorized for this session';
  end if;

  select * into v_student from public.students where id = p_student_id;
  if not found then
    return jsonb_build_object('ok', false, 'messageKey', 'scan.notFound');
  end if;
  select * into v_session from public.sessions where id = p_session_id;
  if not found then
    return jsonb_build_object('ok', false, 'messageKey', 'attendance.sessionNotFound');
  end if;

  v_day := (array['sunday','monday','tuesday','wednesday','thursday','friday','saturday']::day_of_week[])
    [extract(dow from v_date)::int + 1];
  if not (v_day = any (v_session.days)) then
    return jsonb_build_object('ok', false, 'messageKey', 'attendance.notScheduledThatDay');
  end if;

  select m.name into v_module_name from public.modules m where m.id = v_session.module_id;
  select g.name into v_group_name from public.groups g where g.id = v_session.group_id;

  select * into v_existing from public.attendance
  where student_id = p_student_id
    and session_id = p_session_id
    and (timezone('Africa/Algiers', occurred_at))::date = v_date
  limit 1;
  v_has_existing := found;

  if p_status = 'absent' then
    if not v_has_existing then
      return jsonb_build_object('ok', true, 'messageKey', 'attendance.alreadyAbsent',
        'cost', 0, 'newBalance', v_student.balance);
    end if;
    if v_existing.amount_deducted > 0 then
      update public.students set balance = balance + v_existing.amount_deducted
        where id = p_student_id
        returning balance into v_new_balance;
      insert into public.balance_tx (student_id, amount, date, type, description, module_id)
      values (p_student_id, v_existing.amount_deducted, now(), 'topup',
              'Remboursement absence: ' || coalesce(v_module_name, 'séance') || ' du ' || to_char(v_date, 'DD/MM/YYYY'),
              v_session.module_id);
    else
      v_new_balance := v_student.balance;
    end if;
    delete from public.unpaid_teacher_sessions
    where student_id = p_student_id
      and session_id = p_session_id
      and paid = false
      and (timezone('Africa/Algiers', date))::date = v_date;
    delete from public.attendance where id = v_existing.id;
    return jsonb_build_object('ok', true, 'messageKey', 'attendance.markedAbsent',
      'refunded', v_existing.amount_deducted, 'newBalance', v_new_balance);
  end if;

  if v_has_existing then
    update public.attendance set status = p_status where id = v_existing.id;
    return jsonb_build_object('ok', true, 'messageKey', 'attendance.statusUpdated',
      'cost', 0, 'newBalance', v_student.balance, 'status', p_status);
  end if;

  select exists (
    select 1
    from public.student_subscriptions ss
    join public.subscriptions sub on sub.id = ss.subscription_id
    where ss.student_id = p_student_id and sub.session_id = p_session_id
  ) into v_own_group;

  -- Tarif + date de début de SON inscription (la date de début ne filtre pas :
  -- elle décide seulement si la séance est débitée ou offerte).
  select public.discounted_price(sub.price_per_session, ss.discount_type, ss.discount_value),
         ss.start_date
    into v_price, v_enr_start
  from public.subscriptions sub
  join public.student_subscriptions ss on ss.subscription_id = sub.id
  where sub.session_id = p_session_id
    and ss.student_id = p_student_id
    and (ss.expiry_date is null or ss.expiry_date >= v_date)
  limit 1;
  v_found := found;

  if not v_found then
    select public.discounted_price(sub.price_per_session, ss.discount_type, ss.discount_value),
           ss.start_date
      into v_price, v_enr_start
    from public.student_subscriptions ss
    join public.subscriptions sub on sub.id = ss.subscription_id
    join public.sessions enr on enr.id = sub.session_id
    where ss.student_id = p_student_id
      and enr.module_id = v_session.module_id
      and enr.class_id  = v_session.class_id
      and (ss.expiry_date is null or ss.expiry_date >= v_date)
    order by ss.start_date nulls first
    limit 1;
    v_found := found;
  end if;

  if not v_found then
    -- Aucune inscription : le créneau reste ouvert à l'élève de sa classe (et
    -- à n'importe qui sur une séance libre), au tarif affiché du créneau.
    v_rank := public.student_session_rank(p_student_id, p_session_id, v_date);
    if v_session.is_open or v_rank is not null then
      v_price := public.student_session_price(p_student_id, p_session_id, v_date);
      v_enr_start := null;
    else
      return jsonb_build_object('ok', false, 'messageKey', 'attendance.notEnrolled');
    end if;
  end if;

  v_before_start := v_enr_start is not null and v_enr_start > v_date;
  v_free_seance := coalesce(v_session.is_free, false);

  -- Période gratuite : présence enregistrée, solde intact.
  select * into v_free
  from public.active_free_period(
    array[v_session.class_id] || coalesce(v_session.class_ids, '{}'::uuid[]),
    v_date);
  v_is_free_period := found;

  v_offered := v_free_seance or v_is_free_period or v_before_start;

  if v_offered then
    v_waived := case when v_student.is_free then 0 else coalesce(v_price, 0) end;
    v_cost := 0;
  else
    v_cost := case when v_student.is_free then 0 else coalesce(v_price, 0) end;
  end if;

  -- PLUS AUCUN REFUS POUR MANQUE DE SOLDE, comme au badge depuis 20260904.
  -- L'élève a suivi la séance : elle lui est comptée, et le solde descend en
  -- dessous de zéro s'il le faut. `p_allow_debt` n'est plus lu — le paramètre
  -- reste pour ne pas casser la signature appelée par l'écran Présences, qui
  -- continue de demander confirmation avant de creuser une dette à la main.

  v_teacher_earns := not v_free_seance
                     and not (v_is_free_period and not coalesce(v_free.pay_teachers, true))
                     and not p_skip_teacher_due;

  v_teacher_base := case
    when not v_teacher_earns then 0
    when v_is_free_period or v_before_start then v_waived
    else v_cost
  end;

  if v_session.teacher_id is not null and v_teacher_earns then
    select * into v_teacher from public.teachers where id = v_session.teacher_id;
    if found and v_teacher.payment_type = 'percentage' then
      v_teacher_due := round(v_teacher_base * coalesce(v_teacher.percentage, 0) / 100.0);
    end if;
  end if;

  if v_date = (now() at time zone 'Africa/Algiers')::date then
    v_occurred := now();
  else
    v_occurred := (v_date::text || ' ' || v_session.start_time)::timestamp at time zone 'Africa/Algiers';
  end if;

  begin
    insert into public.attendance
      (student_id, session_id, occurred_at, amount_deducted, status, substitute_group,
       free_period_id, waived_amount, pre_start)
    values (p_student_id, p_session_id, v_occurred, v_cost, p_status, not v_own_group,
       case when v_is_free_period then v_free.id else null end, v_waived,
       v_before_start and not v_is_free_period and not v_free_seance);
  exception when unique_violation then
    return jsonb_build_object('ok', true, 'messageKey', 'scan.alreadyPresent',
      'cost', 0, 'newBalance', v_student.balance);
  end;

  if v_cost > 0 then
    update public.students set balance = balance - v_cost
      where id = p_student_id
      returning balance into v_new_balance;

    insert into public.balance_tx (student_id, amount, date, type, description, module_id)
    values (p_student_id, -v_cost, v_occurred, 'deduction',
            'Présence: ' || coalesce(v_module_name, 'séance')
            || coalesce(' (' || v_group_name || ')', '')
            || ' (' || v_session.start_time || '-' || v_session.end_time || ')'
            || case when v_own_group then '' else ' — rattrapage sur un autre groupe' end
            || case when v_new_balance < 0 then ' — dette enregistrée' else '' end,
            v_session.module_id);
  else
    v_new_balance := v_student.balance;
  end if;

  if v_session.teacher_id is not null and v_teacher_earns then
    insert into public.unpaid_teacher_sessions (teacher_id, session_id, student_id, amount, date, paid)
    values (v_session.teacher_id, p_session_id, p_student_id, v_teacher_due, v_occurred, false);
  end if;

  return jsonb_build_object(
    'ok', true,
    'studentId', p_student_id,
    'sessionId', p_session_id,
    'cost', v_cost,
    'newBalance', v_new_balance,
    'status', p_status,
    'debt', v_new_balance < 0,
    'lowBalance', (v_cost > 0 and v_new_balance >= 0 and v_new_balance < coalesce(v_price, 0) * 2),
    'moduleName', v_module_name,
    'groupName', v_group_name,
    'otherGroup', not v_own_group,
    'free', v_is_free_period or v_free_seance,
    'freeSeance', v_free_seance,
    'freePeriodName', case when v_is_free_period then nullif(v_free.name, '') end,
    'preStart', v_before_start and not v_is_free_period and not v_free_seance,
    'enrollmentStart', case when v_before_start then v_enr_start end,
    'waived', v_waived,
    'teacherPaid', v_teacher_earns,
    'messageKey', case
      when v_cost > 0 and v_new_balance < 0 then 'scan.successDebt'
      when p_status = 'late' then 'scan.successLate'
      else 'scan.success'
    end
  );
end;
$$;

revoke execute on function public.mark_attendance(uuid, uuid, attendance_status, date, boolean, boolean) from public, anon;
grant execute on function public.mark_attendance(uuid, uuid, attendance_status, date, boolean, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. LES SÉANCES FACTURÉES QUE L'HISTORIQUE N'A JAMAIS PORTÉES
-- ---------------------------------------------------------------------------
-- Toute facturation écrit DEUX choses dans la même transaction : la présence
-- (`attendance.amount_deducted`, ou la pénalité d'absence hebdomadaire) et sa
-- ligne d'historique (`balance_tx` de type `deduction`). Quand la seconde
-- manque, la fiche facture 625 DA, l'historique n'en sait rien, et le solde
-- recalculé sur cet historique reste à 0 : c'est le « Total débité 625 DA »
-- en face du « Solde : 0 DA ».
--
-- L'écart est mesuré ÉLÈVE PAR ÉLÈVE, sur toute son histoire :
--
--     facturé  = Σ présences.amount_deducted + Σ absences facturées
--     débité   = Σ (-amount) des lignes 'deduction'
--     manquant = facturé - débité
--
-- Et il n'est retenu que dans le sens qui lèse l'école. Un remboursement
-- (séance devenue offerte, présence supprimée, tarif revu à la baisse) écrit
-- une ligne 'topup' et remet la présence à 0 : l'écart part alors dans l'autre
-- sens, et ce script l'ignore — il ne re-débite JAMAIS personne à tort.
--
-- La ligne écrite est une DETTE, pas un encaissement : rien n'entre en caisse.
--
-- APERÇU AVANT RÉPARATION. Cette requête ne modifie rien : elle nomme les
-- élèves que le bloc suivant va régulariser, et de combien. On peut la lancer
-- seule, avant tout le reste, pour vérifier la liste. Un élève qui y apparaît
-- à tort est un élève dont on a délibérément supprimé la ligne d'historique
-- sans remettre sa présence à 0 DA : corriger d'abord la présence (bouton
-- Modifier, montant à 0), puis relancer ce script.
with billed as (
  select student_id, sum(amount)::int as amount
  from (
    select a.student_id, sum(a.amount_deducted)::int as amount
      from public.attendance a where a.amount_deducted > 0 group by a.student_id
    union all
    select p.student_id, sum(p.amount)::int
      from public.absence_penalties p where p.amount > 0 group by p.student_id
  ) t
  group by student_id
),
debited as (
  select student_id, sum(-amount)::int as amount
    from public.balance_tx where type = 'deduction' and amount < 0 group by student_id
)
select st.last_name || ' ' || st.first_name          as eleve,
       st.rfid                                       as carte,
       st.balance                                    as solde_actuel,
       b.amount                                      as facture_sur_sa_fiche,
       coalesce(d.amount, 0)                         as deja_retire_du_solde,
       b.amount - coalesce(d.amount, 0)              as a_rattraper,
       st.balance - (b.amount - coalesce(d.amount, 0)) as solde_apres
from billed b
join public.students st on st.id = b.student_id
left join debited d on d.student_id = b.student_id
where b.amount - coalesce(d.amount, 0) > 0
order by a_rattraper desc;

do $repair_history$
declare
  v_r record;
  v_count int := 0;
  v_total int := 0;
begin
  for v_r in
    with billed as (
      select student_id, sum(amount)::int as amount
      from (
        select a.student_id, sum(a.amount_deducted)::int as amount
          from public.attendance a
         where a.amount_deducted > 0
         group by a.student_id
        union all
        select p.student_id, sum(p.amount)::int
          from public.absence_penalties p
         where p.amount > 0
         group by p.student_id
      ) t
      group by student_id
    ),
    debited as (
      select t.student_id, sum(-t.amount)::int as amount
        from public.balance_tx t
       where t.type = 'deduction' and t.amount < 0
       group by t.student_id
    )
    select st.id,
           st.last_name || ' ' || st.first_name   as name,
           st.rfid,
           st.balance,
           b.amount                               as billed,
           coalesce(d.amount, 0)                  as debited,
           b.amount - coalesce(d.amount, 0)       as missing
      from billed b
      join public.students st on st.id = b.student_id
      left join debited d on d.student_id = b.student_id
     where b.amount - coalesce(d.amount, 0) > 0
     order by b.amount - coalesce(d.amount, 0) desc
  loop
    raise notice 'Séances jamais portées à l''historique — % (carte %) : % DA facturés, % DA débités, % DA à rattraper (solde actuel : % DA)',
      v_r.name, coalesce(v_r.rfid, '-'), v_r.billed, v_r.debited, v_r.missing, v_r.balance;

    insert into public.balance_tx (student_id, amount, date, type, description)
    values (v_r.id, -v_r.missing, now(), 'deduction',
            'Régularisation — séances suivies déjà facturées sur sa fiche mais '
            || 'jamais retirées du solde : ' || v_r.missing || ' DA');

    v_count := v_count + 1;
    v_total := v_total + v_r.missing;
  end loop;

  raise notice '% élève(s) régularisé(s), % DA de séances suivies remis à leur charge.',
    v_count, v_total;
end
$repair_history$;

-- ---------------------------------------------------------------------------
-- 3. Le garde-fou du solde, resserré
-- ---------------------------------------------------------------------------
-- Ce qu'il protège n'a pas changé : le solde n'est PAS écrivable depuis le
-- navigateur, il n'appartient qu'aux RPC, qui le déplacent relativement et
-- écrivent l'historique dans la même transaction. Deux trous se referment :
--
--   · `is_staff()` rend NULL — et non FAUX — quand le JWT ne correspond à
--     aucune ligne de `profiles`. `if not public.is_staff()` ne se déclenchait
--     donc pas : une session authentifiée sans profil pouvait réécrire
--     `is_free`, `registration_due`, `rfid` et `parent_id`. `coalesce(…, false)`
--     ferme le cas.
--   · `service_role` (la clé serveur) écrivait le solde directement. Il rejoint
--     les rôles du navigateur : le solde ne bouge que par les RPC.
--
-- Restent libres d'écrire le solde : le propriétaire des fonctions (les RPC
-- `security definer`) et une session de base de données (éditeur SQL, psql,
-- migration) — c'est ce dernier cas qui fait tourner la section 4.
--
-- SECURITY INVOKER, volontairement : en SECURITY DEFINER, `current_user`
-- vaudrait le PROPRIÉTAIRE de la fonction à chaque appel, jamais le rôle qui
-- écrit — le garde-fou ne se déclencherait jamais. `is_staff()` reste, elle,
-- `security definer` : elle lit `profiles`, que le client ne peut pas parcourir.
create or replace function public.protect_student_financial_fields()
returns trigger
language plpgsql security invoker set search_path = public as $fn$
begin
  if current_user in ('authenticated', 'anon', 'authenticator', 'service_role') then
    -- Écriture directe depuis le client : le solde appartient aux RPC.
    new.balance := old.balance;

    if not coalesce(public.is_staff(), false) then
      -- Élève, parent, enseignant, ou jeton sans profil : rien de financier
      -- ne lui appartient.
      new.is_free := old.is_free;
      new.registration_due := old.registration_due;
      new.rfid := old.rfid;
      new.parent_id := old.parent_id;
    end if;
  end if;
  return new;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 4. LE SOLDE REPASSE EN NÉGATIF — il redevient la somme de son historique
-- ---------------------------------------------------------------------------
-- L'historique du solde est la vérité : c'est lui qu'on montre au parent, lui
-- qu'on imprime sur le reçu, et chaque mouvement d'argent y écrit sa ligne.
-- Maintenant que la section 2 a rendu à l'historique les séances qui lui
-- manquaient, l'élève à 0 DA qui doit 625 DA de séances descend enfin à
-- -625 DA — c'est ce solde négatif qui allume l'alerte de dette sur sa carte,
-- dans la liste des élèves et sur le tableau de bord.
--
-- Chaque correction est annoncée nom par nom : rien ne bouge en silence.
do $repair_balances$
declare
  v_r record;
  v_count int := 0;
  v_delta int := 0;
begin
  for v_r in
    select st.id,
           st.last_name || ' ' || st.first_name as name,
           st.rfid,
           st.balance                           as stored,
           coalesce(tx.total, 0)::int           as from_history
      from public.students st
      left join (
        select student_id, sum(amount)::int as total
          from public.balance_tx group by student_id
      ) tx on tx.student_id = st.id
     where st.balance is distinct from coalesce(tx.total, 0)
     order by coalesce(tx.total, 0) - st.balance
  loop
    raise notice 'Solde recalculé — % (carte %) : % DA -> % DA',
      v_r.name, coalesce(v_r.rfid, '-'), v_r.stored, v_r.from_history;
    update public.students set balance = v_r.from_history where id = v_r.id;
    v_count := v_count + 1;
    v_delta := v_delta + (v_r.from_history - v_r.stored);
  end loop;

  raise notice '% élève(s) remis d''accord avec leur historique (% DA au total).',
    v_count, v_delta;
end
$repair_balances$;

-- ---------------------------------------------------------------------------
-- 5. Rechargement du cache de schéma de l'API REST
-- ---------------------------------------------------------------------------
notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- 6. VÉRIFICATION — les deux compteurs doivent être à 0
-- ---------------------------------------------------------------------------
-- `seances_hors_solde` : des séances facturées qu'aucune ligne d'historique ne
-- porte. `soldes_en_desaccord` : un solde qui ne vaut pas la somme de son
-- historique. Si l'un des deux n'est pas à 0, relire les NOTICE ci-dessus :
-- une erreur y aura interrompu la réparation.
with billed as (
  select student_id, sum(amount)::int as amount
  from (
    select a.student_id, sum(a.amount_deducted)::int as amount
      from public.attendance a where a.amount_deducted > 0 group by a.student_id
    union all
    select p.student_id, sum(p.amount)::int
      from public.absence_penalties p where p.amount > 0 group by p.student_id
  ) t
  group by student_id
),
debited as (
  select student_id, sum(-amount)::int as amount
    from public.balance_tx where type = 'deduction' and amount < 0 group by student_id
)
select
  (select count(*) from billed b
     left join debited d on d.student_id = b.student_id
    where b.amount - coalesce(d.amount, 0) > 0)                      as seances_hors_solde,
  (select count(*)
     from public.students st
     left join (select student_id, sum(amount)::int as total
                  from public.balance_tx group by student_id) tx
       on tx.student_id = st.id
    where st.balance is distinct from coalesce(tx.total, 0))         as soldes_en_desaccord;

-- Qui doit quoi, maintenant que le solde dit la vérité. C'est exactement la
-- liste que la carte élève, l'écran Étudiants et le tableau de bord signalent.
select st.last_name || ' ' || st.first_name as eleve,
       st.rfid                              as carte,
       st.balance                           as solde,
       st.registration_due                  as inscription_due,
       (case when st.balance < 0 then -st.balance else 0 end)
         + coalesce(st.registration_due, 0) as total_du
from public.students st
where st.balance < 0 or coalesce(st.registration_due, 0) > 0
order by total_du desc;
