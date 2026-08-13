-- =============================================================================
-- Tarif partagé par tous les groupes d'un même cours, scan inter-groupes,
-- absences hebdomadaires vendredi -> vendredi, correction des présences.
-- Run once against the live project (Supabase Dashboard -> SQL Editor).
--
-- Ce que fait cette migration :
--   1. sibling_session_ids() / set_subscription_price() — un tarif saisi sur UN
--      créneau est appliqué à TOUS les groupes du même cours (même classe, même
--      module, même enseignant). Un nouveau groupe créé plus tard hérite
--      automatiquement du tarif (trigger), et modifier un tarif le propage aux
--      groupes frères (trigger).
--   2. attendance.substitute_group — la présence a été pointée sur un AUTRE
--      groupe que celui de l'inscription de l'élève (rattrapage).
--   3. scan_card réécrit : un élève inscrit au groupe 1 peut badger sur le
--      groupe 2 du même cours ; la présence est enregistrée sur le créneau
--      RÉELLEMENT suivi, au tarif (et à la réduction) de son inscription. Le
--      délai anti-double-badge devient PAR CRÉNEAU, deux séances qui
--      s'enchaînent ne se bloquent donc plus l'une l'autre.
--   4. mark_attendance : même souplesse inter-groupes en saisie manuelle.
--   5. process_weekly_absences réécrit : semaines CALENDAIRES vendredi ->
--      vendredi. Si l'élève n'a badgé sur aucun groupe du module pendant une
--      semaine complète, le prix de la séance est débité et l'absence est
--      journalisée (visible dans la fiche élève et sur son compte).
--   6. update_attendance() / delete_absence_penalty() — corriger ou supprimer
--      une présence, supprimer une absence facturée, avec remise à niveau
--      atomique du solde et de l'historique.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 0. Colonnes ajoutées
-- ---------------------------------------------------------------------------

-- Présence pointée sur un groupe différent de celui de l'inscription.
alter table public.attendance
  add column if not exists substitute_group boolean not null default false;

-- Jour d'ouverture de la semaine d'absence (0 = dimanche … 5 = vendredi).
alter table public.school
  add column if not exists absence_week_start_day smallint not null default 5;

do $$ begin
  alter table public.school
    add constraint school_absence_week_start_day_check
    check (absence_week_start_day between 0 and 6) not valid;
exception when duplicate_object then null; end $$;

create index if not exists sessions_course_key_idx
  on public.sessions (class_id, module_id, teacher_id);

-- ---------------------------------------------------------------------------
-- 1. Groupes frères : même classe + même module + même enseignant
-- ---------------------------------------------------------------------------
-- Un créneau "séance libre" est un produit à lui tout seul : il n'est jamais
-- regroupé avec quoi que ce soit.
create or replace function public.sibling_session_ids(p_session_id uuid)
returns setof uuid
language sql stable set search_path = public as $$
  select se.id
  from public.sessions se
  join public.sessions src on src.id = p_session_id
  where case
    when src.is_open then se.id = src.id
    else not se.is_open
         and se.class_id = src.class_id
         and se.module_id = src.module_id
         and se.teacher_id is not distinct from src.teacher_id
  end;
$$;

grant execute on function public.sibling_session_ids(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Un seul tarif pour tous les groupes du cours
-- ---------------------------------------------------------------------------
-- Écrit (ou met à jour) l'abonnement de CHAQUE groupe du cours avec le même
-- tarif. C'est le seul point d'entrée utilisé par l'écran Abonnements, donc
-- deux groupes du même cours ne peuvent plus diverger.
create or replace function public.set_subscription_price(
  p_session_id uuid,
  p_price integer default 0,
  p_level_price integer default null,
  p_period_months integer default null
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_role user_role := public.current_role();
  v_session public.sessions%rowtype;
  v_sib uuid;
  v_created int := 0;
  v_updated int := 0;
  v_sub_id uuid;
begin
  if v_role is null or v_role not in ('admin', 'reception') then
    raise exception 'not authorized';
  end if;

  select * into v_session from public.sessions where id = p_session_id;
  if not found then
    return jsonb_build_object('ok', false, 'messageKey', 'subscription.sessionNotFound');
  end if;

  for v_sib in select sib from public.sibling_session_ids(p_session_id) as t(sib) loop
    select id into v_sub_id from public.subscriptions where session_id = v_sib limit 1;

    if v_sub_id is null then
      insert into public.subscriptions (session_id, price_per_session, level_price, period_months)
      values (v_sib, greatest(coalesce(p_price, 0), 0), p_level_price, p_period_months);
      v_created := v_created + 1;
    else
      update public.subscriptions
        set price_per_session = greatest(coalesce(p_price, 0), 0),
            level_price       = p_level_price,
            period_months     = p_period_months
        where id = v_sub_id;
      v_updated := v_updated + 1;
    end if;
  end loop;

  -- Le tarif d'une séance libre est aussi porté par le créneau lui-même
  -- (le planning l'affiche depuis là).
  if v_session.is_open then
    update public.sessions set open_price = greatest(coalesce(p_price, 0), 0)
      where id = p_session_id;
  end if;

  return jsonb_build_object('ok', true, 'created', v_created, 'updated', v_updated,
    'groups', v_created + v_updated);
end;
$$;

revoke execute on function public.set_subscription_price(uuid, integer, integer, integer) from public, anon;
grant execute on function public.set_subscription_price(uuid, integer, integer, integer) to authenticated;

-- Supprime le tarif du cours ENTIER (tous les groupes).
create or replace function public.delete_subscription_price(p_session_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_role user_role := public.current_role();
  v_deleted int := 0;
begin
  if v_role is null or v_role not in ('admin', 'reception') then
    raise exception 'not authorized';
  end if;

  delete from public.subscriptions
  where session_id in (select sib from public.sibling_session_ids(p_session_id) as t(sib));
  get diagnostics v_deleted = row_count;

  return jsonb_build_object('ok', true, 'deleted', v_deleted);
end;
$$;

revoke execute on function public.delete_subscription_price(uuid) from public, anon;
grant execute on function public.delete_subscription_price(uuid) to authenticated;

-- ---- Triggers de cohérence --------------------------------------------------

-- Un nouveau groupe ajouté à un cours déjà tarifé hérite du tarif.
create or replace function public.session_inherit_subscription()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_sub public.subscriptions%rowtype;
begin
  if new.is_open then
    return new;
  end if;

  select sub.* into v_sub
  from public.subscriptions sub
  join public.sessions se on se.id = sub.session_id
  where se.id <> new.id
    and not se.is_open
    and se.class_id = new.class_id
    and se.module_id = new.module_id
    and se.teacher_id is not distinct from new.teacher_id
  limit 1;

  if found and not exists (select 1 from public.subscriptions where session_id = new.id) then
    insert into public.subscriptions (session_id, price_per_session, level_price, period_months)
    values (new.id, v_sub.price_per_session, v_sub.level_price, v_sub.period_months);
  end if;

  return new;
end;
$$;

drop trigger if exists sessions_inherit_subscription on public.sessions;
create trigger sessions_inherit_subscription
  after insert on public.sessions
  for each row execute function public.session_inherit_subscription();

-- Modifier le tarif d'un groupe le propage à ses groupes frères.
create or replace function public.subscription_sync_siblings()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- Le trigger se ré-appelle sur les lignes qu'il vient de modifier : on
  -- s'arrête au premier niveau imbriqué.
  if pg_trigger_depth() > 1 then
    return new;
  end if;

  update public.subscriptions sub
    set price_per_session = new.price_per_session,
        level_price       = new.level_price,
        period_months     = new.period_months
  where sub.id <> new.id
    and sub.session_id in (select sib from public.sibling_session_ids(new.session_id) as t(sib))
    and (sub.price_per_session is distinct from new.price_per_session
      or sub.level_price       is distinct from new.level_price
      or sub.period_months     is distinct from new.period_months);

  return new;
end;
$$;

drop trigger if exists subscriptions_sync_siblings on public.subscriptions;
create trigger subscriptions_sync_siblings
  after insert or update of price_per_session, level_price, period_months
  on public.subscriptions
  for each row execute function public.subscription_sync_siblings();

-- Harmonise l'existant : chaque cours prend le tarif de son groupe le mieux
-- renseigné, et les groupes sans abonnement en reçoivent un.
do $$
declare
  r record;
begin
  for r in
    select distinct on (se.class_id, se.module_id, se.teacher_id)
           se.id as session_id,
           sub.price_per_session,
           sub.level_price,
           sub.period_months
    from public.sessions se
    join public.subscriptions sub on sub.session_id = se.id
    where not se.is_open
    order by se.class_id, se.module_id, se.teacher_id,
             sub.price_per_session desc nulls last, se.created_at
  loop
    update public.subscriptions sub
      set price_per_session = r.price_per_session,
          level_price       = r.level_price,
          period_months     = r.period_months
    where sub.session_id in (select sib from public.sibling_session_ids(r.session_id) as t(sib));

    insert into public.subscriptions (session_id, price_per_session, level_price, period_months)
    select sib, r.price_per_session, r.level_price, r.period_months
    from public.sibling_session_ids(r.session_id) as t(sib)
    where not exists (select 1 from public.subscriptions s2 where s2.session_id = sib);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 3. scan_card — badge accepté sur n'importe quel groupe du même cours
-- ---------------------------------------------------------------------------
create or replace function public.scan_card(p_code text, p_when timestamptz default now())
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_role user_role := public.current_role();
  v_student public.students%rowtype;
  v_last_same timestamptz;
  v_last_any timestamptz;
  v_local timestamp;
  v_date date;
  v_today day_of_week;
  v_now_min int;
  v_matched public.sessions%rowtype;
  v_total_today int;
  v_next_start int;
  v_total_enr int;
  v_valid_enr int;
  v_running_now boolean;
  v_price int := 0;
  v_cost int;
  v_status attendance_status;
  v_teacher public.teachers%rowtype;
  v_teacher_due int := 0;
  v_new_balance int;
  v_module_name text;
  v_group_name text;
  v_own_group boolean;
  v_own_group_name text;
  c_early_margin constant int := 30;
  c_late_after   constant int := 30;
  c_cooldown_min constant int := 30;
  c_double_swipe_sec constant int := 60;
begin
  if v_role is null or v_role not in ('admin', 'reception', 'teacher') then
    raise exception 'not authorized to scan cards';
  end if;

  select * into v_student from public.students
  where rfid = p_code or id::text = p_code
  limit 1;
  if not found then
    return jsonb_build_object('ok', false, 'messageKey', 'scan.notFound');
  end if;

  v_local := p_when at time zone 'Africa/Algiers';
  v_date := v_local::date;
  v_today := (array['sunday','monday','tuesday','wednesday','thursday','friday','saturday']::day_of_week[])
    [extract(dow from v_local)::int + 1];
  v_now_min := extract(hour from v_local)::int * 60 + extract(minute from v_local)::int;

  -- Garde anti double-badge : très courte toutes séances confondues (le lecteur
  -- envoie parfois deux trames), longue sur LE MÊME créneau. Deux cours qui
  -- s'enchaînent — ou deux groupes du même module — ne se bloquent donc plus.
  select max(occurred_at) into v_last_any
  from public.attendance
  where student_id = v_student.id;

  if v_last_any is not null
     and p_when >= v_last_any
     and p_when - v_last_any < make_interval(secs => c_double_swipe_sec) then
    return jsonb_build_object('ok', false, 'studentId', v_student.id,
      'messageKey', 'scan.cooldown');
  end if;

  -- Créneau réellement suivi : n'importe quel groupe (même classe + même
  -- module) sur lequel l'élève est inscrit, PAS seulement le sien.
  select se.* into v_matched
  from public.sessions se
  where v_today = any (se.days)
    and (se.period_start is null or se.period_start <= v_date)
    and (se.period_end   is null or se.period_end   >= v_date)
    and v_now_min >= public.time_to_minutes(se.start_time) - c_early_margin
    and v_now_min <= public.time_to_minutes(se.end_time)
    and exists (
      select 1
      from public.student_subscriptions ss
      join public.subscriptions sub on sub.id = ss.subscription_id
      join public.sessions enr on enr.id = sub.session_id
      where ss.student_id = v_student.id
        and enr.module_id = se.module_id
        and enr.class_id  = se.class_id
        and (ss.start_date  is null or ss.start_date  <= v_date)
        and (ss.expiry_date is null or ss.expiry_date >= v_date)
    )
  order by
    -- 1. la séance déjà commencée passe avant celle qui n'a pas encore démarré
    (case when v_now_min >= public.time_to_minutes(se.start_time) then 0 else 1 end),
    -- 2. à égalité, le groupe de l'élève
    (case when exists (
       select 1 from public.subscriptions s2
       join public.student_subscriptions ss2 on ss2.subscription_id = s2.id
       where s2.session_id = se.id and ss2.student_id = v_student.id
     ) then 0 else 1 end),
    abs(public.time_to_minutes(se.start_time) - v_now_min)
  limit 1;

  if not found then
    select count(*),
           min(public.time_to_minutes(se.start_time)) filter (
             where public.time_to_minutes(se.start_time) - c_early_margin > v_now_min)
      into v_total_today, v_next_start
    from public.sessions se
    where v_today = any (se.days)
      and (se.period_start is null or se.period_start <= v_date)
      and (se.period_end   is null or se.period_end   >= v_date)
      and exists (
        select 1
        from public.student_subscriptions ss
        join public.subscriptions sub on sub.id = ss.subscription_id
        join public.sessions enr on enr.id = sub.session_id
        where ss.student_id = v_student.id
          and enr.module_id = se.module_id
          and enr.class_id  = se.class_id
          and (ss.start_date  is null or ss.start_date  <= v_date)
          and (ss.expiry_date is null or ss.expiry_date >= v_date)
      );

    if coalesce(v_total_today, 0) > 0 then
      if v_next_start is not null then
        return jsonb_build_object('ok', false, 'studentId', v_student.id,
          'messageKey', 'scan.tooEarly',
          'nextStart', lpad((v_next_start / 60)::text, 2, '0') || ':' || lpad((v_next_start % 60)::text, 2, '0'));
      end if;
      return jsonb_build_object('ok', false, 'studentId', v_student.id,
        'messageKey', 'scan.sessionEnded');
    end if;

    select count(*),
           count(*) filter (where (ss.start_date  is null or ss.start_date  <= v_date)
                              and (ss.expiry_date is null or ss.expiry_date >= v_date))
      into v_total_enr, v_valid_enr
    from public.student_subscriptions ss
    where ss.student_id = v_student.id;

    if coalesce(v_total_enr, 0) > 0 and coalesce(v_valid_enr, 0) = 0 then
      return jsonb_build_object('ok', false, 'studentId', v_student.id,
        'messageKey', 'scan.subscriptionExpired');
    end if;

    select exists (
      select 1 from public.sessions se
      where v_today = any (se.days)
        and v_now_min >= public.time_to_minutes(se.start_time) - c_early_margin
        and v_now_min <= public.time_to_minutes(se.end_time)
    ) into v_running_now;

    if v_running_now then
      return jsonb_build_object('ok', false, 'studentId', v_student.id,
        'messageKey', 'scan.notEligible');
    end if;

    return jsonb_build_object('ok', false, 'studentId', v_student.id,
      'messageKey', 'scan.noSessionToday');
  end if;

  -- Anti-rebadge sur LE MÊME créneau (30 min).
  select max(occurred_at) into v_last_same
  from public.attendance
  where student_id = v_student.id
    and session_id = v_matched.id;

  if v_last_same is not null
     and p_when >= v_last_same
     and p_when - v_last_same < make_interval(mins => c_cooldown_min) then
    return jsonb_build_object('ok', false, 'studentId', v_student.id,
      'sessionId', v_matched.id, 'messageKey', 'scan.cooldown');
  end if;

  select m.name into v_module_name from public.modules m where m.id = v_matched.module_id;
  select g.name into v_group_name from public.groups g where g.id = v_matched.group_id;

  -- L'élève est-il inscrit sur CE groupe, ou vient-il suivre un autre groupe
  -- du même cours (rattrapage) ?
  select exists (
    select 1
    from public.student_subscriptions ss
    join public.subscriptions sub on sub.id = ss.subscription_id
    where ss.student_id = v_student.id and sub.session_id = v_matched.id
  ) into v_own_group;

  if not v_own_group then
    select g.name into v_own_group_name
    from public.student_subscriptions ss
    join public.subscriptions sub on sub.id = ss.subscription_id
    join public.sessions enr on enr.id = sub.session_id
    join public.groups g on g.id = enr.group_id
    where ss.student_id = v_student.id
      and enr.module_id = v_matched.module_id
      and enr.class_id  = v_matched.class_id
    limit 1;
  end if;

  if exists (
    select 1 from public.attendance
    where student_id = v_student.id
      and session_id = v_matched.id
      and (timezone('Africa/Algiers', occurred_at))::date = v_date
  ) then
    return jsonb_build_object('ok', true, 'studentId', v_student.id,
      'sessionId', v_matched.id, 'cost', 0, 'newBalance', v_student.balance,
      'moduleName', v_module_name, 'groupName', v_group_name,
      'otherGroup', not v_own_group, 'ownGroupName', v_own_group_name,
      'sessionStart', v_matched.start_time, 'sessionEnd', v_matched.end_time,
      'messageKey', 'scan.alreadyPresent');
  end if;

  -- Prix NET : tarif de SON inscription (avec sa réduction) même s'il badge sur
  -- un autre groupe ; à défaut, le tarif du créneau suivi.
  select coalesce(
    (select public.discounted_price(sub.price_per_session, ss.discount_type, ss.discount_value)
       from public.subscriptions sub
       join public.student_subscriptions ss
         on ss.subscription_id = sub.id and ss.student_id = v_student.id
      where sub.session_id = v_matched.id limit 1),
    (select public.discounted_price(sub.price_per_session, ss.discount_type, ss.discount_value)
       from public.student_subscriptions ss
       join public.subscriptions sub on sub.id = ss.subscription_id
       join public.sessions enr on enr.id = sub.session_id
      where ss.student_id = v_student.id
        and enr.module_id = v_matched.module_id
        and enr.class_id  = v_matched.class_id
        and (ss.start_date  is null or ss.start_date  <= v_date)
        and (ss.expiry_date is null or ss.expiry_date >= v_date)
      limit 1),
    (select sub.price_per_session from public.subscriptions sub
      where sub.session_id = v_matched.id limit 1),
    0) into v_price;

  v_cost := case when v_student.is_free then 0 else v_price end;

  if v_cost > 0 and v_student.balance < v_cost then
    return jsonb_build_object('ok', false, 'studentId', v_student.id,
      'sessionId', v_matched.id, 'balance', v_student.balance,
      'debt', v_student.balance < 0,
      'moduleName', v_module_name, 'groupName', v_group_name,
      'otherGroup', not v_own_group,
      'sessionStart', v_matched.start_time, 'sessionEnd', v_matched.end_time,
      'messageKey', 'scan.expired');
  end if;

  v_status := case
    when v_now_min > public.time_to_minutes(v_matched.start_time) + c_late_after then 'late'
    else 'present'
  end;

  if v_matched.teacher_id is not null then
    select * into v_teacher from public.teachers where id = v_matched.teacher_id;
    if found and v_teacher.payment_type = 'percentage' then
      v_teacher_due := round(v_cost * coalesce(v_teacher.percentage, 0) / 100.0);
    end if;
  end if;

  begin
    insert into public.attendance
      (student_id, session_id, occurred_at, amount_deducted, status, substitute_group)
    values (v_student.id, v_matched.id, p_when, v_cost, v_status, not v_own_group);
  exception when unique_violation then
    return jsonb_build_object('ok', true, 'studentId', v_student.id,
      'sessionId', v_matched.id, 'cost', 0, 'newBalance', v_student.balance,
      'moduleName', v_module_name, 'groupName', v_group_name,
      'otherGroup', not v_own_group,
      'sessionStart', v_matched.start_time, 'sessionEnd', v_matched.end_time,
      'messageKey', 'scan.alreadyPresent');
  end;

  update public.students set balance = balance - v_cost
    where id = v_student.id
    returning balance into v_new_balance;

  if v_cost > 0 then
    insert into public.balance_tx (student_id, amount, date, type, description, module_id)
    values (v_student.id, -v_cost, p_when, 'deduction',
            case when v_matched.is_open then 'Séance libre ' else 'Séance ' end
            || coalesce(v_module_name, '')
            || coalesce(' (' || v_group_name || ')', '')
            || ' (' || v_matched.start_time || '-' || v_matched.end_time || ')'
            || case when v_own_group then ''
                    else ' — rattrapage sur un autre groupe'
                         || coalesce(' (inscrit ' || v_own_group_name || ')', '') end,
            v_matched.module_id);
  end if;

  if v_matched.teacher_id is not null then
    insert into public.unpaid_teacher_sessions (teacher_id, session_id, student_id, amount, date, paid)
    values (v_matched.teacher_id, v_matched.id, v_student.id, v_teacher_due, p_when, false);
  end if;

  return jsonb_build_object(
    'ok', true,
    'studentId', v_student.id,
    'sessionId', v_matched.id,
    'cost', v_cost,
    'newBalance', v_new_balance,
    'status', v_status,
    'debt', false,
    'lowBalance', (v_cost > 0 and v_new_balance < v_price * 2),
    'moduleName', v_module_name,
    'groupName', v_group_name,
    'otherGroup', not v_own_group,
    'ownGroupName', v_own_group_name,
    'sessionStart', v_matched.start_time,
    'sessionEnd', v_matched.end_time,
    'messageKey', case when v_status = 'late' then 'scan.successLate' else 'scan.success' end
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. mark_attendance — même souplesse inter-groupes en saisie manuelle
-- ---------------------------------------------------------------------------
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
  v_cost int;
  v_teacher public.teachers%rowtype;
  v_teacher_due int := 0;
  v_new_balance int;
  v_module_name text;
  v_group_name text;
  v_own_group boolean;
  v_occurred timestamptz;
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

  select public.discounted_price(sub.price_per_session, ss.discount_type, ss.discount_value)
    into v_price
  from public.subscriptions sub
  join public.student_subscriptions ss on ss.subscription_id = sub.id
  where sub.session_id = p_session_id
    and ss.student_id = p_student_id
    and (ss.start_date  is null or ss.start_date  <= v_date)
    and (ss.expiry_date is null or ss.expiry_date >= v_date)
  limit 1;
  v_found := found;

  -- Inscrit sur un AUTRE groupe du même cours : la présence est acceptée au
  -- tarif (et à la réduction) de son inscription.
  if not v_found then
    select public.discounted_price(sub.price_per_session, ss.discount_type, ss.discount_value)
      into v_price
    from public.student_subscriptions ss
    join public.subscriptions sub on sub.id = ss.subscription_id
    join public.sessions enr on enr.id = sub.session_id
    where ss.student_id = p_student_id
      and enr.module_id = v_session.module_id
      and enr.class_id  = v_session.class_id
      and (ss.start_date  is null or ss.start_date  <= v_date)
      and (ss.expiry_date is null or ss.expiry_date >= v_date)
    limit 1;
    v_found := found;
  end if;

  -- Séance libre : la présence peut être saisie même sans inscription
  -- préalable ; on facture alors le tarif du créneau.
  if not v_found then
    if v_session.is_open then
      select coalesce(sub.price_per_session, v_session.open_price) into v_price
      from public.subscriptions sub where sub.session_id = p_session_id limit 1;
      v_price := coalesce(v_price, v_session.open_price, 0);
    else
      return jsonb_build_object('ok', false, 'messageKey', 'attendance.notEnrolled');
    end if;
  end if;

  v_cost := case when v_student.is_free then 0 else coalesce(v_price, 0) end;

  if v_cost > 0 and v_student.balance < v_cost and not p_allow_debt then
    return jsonb_build_object('ok', false, 'messageKey', 'scan.debtBlocked',
      'balance', v_student.balance, 'debt', v_student.balance < 0, 'moduleName', v_module_name);
  end if;

  if v_session.teacher_id is not null and not p_skip_teacher_due then
    select * into v_teacher from public.teachers where id = v_session.teacher_id;
    if found and v_teacher.payment_type = 'percentage' then
      v_teacher_due := round(v_cost * coalesce(v_teacher.percentage, 0) / 100.0);
    end if;
  end if;

  if v_date = (now() at time zone 'Africa/Algiers')::date then
    v_occurred := now();
  else
    v_occurred := (v_date::text || ' ' || v_session.start_time)::timestamp at time zone 'Africa/Algiers';
  end if;

  begin
    insert into public.attendance
      (student_id, session_id, occurred_at, amount_deducted, status, substitute_group)
    values (p_student_id, p_session_id, v_occurred, v_cost, p_status, not v_own_group);
  exception when unique_violation then
    return jsonb_build_object('ok', true, 'messageKey', 'scan.alreadyPresent',
      'cost', 0, 'newBalance', v_student.balance);
  end;

  update public.students set balance = balance - v_cost
    where id = p_student_id
    returning balance into v_new_balance;

  if v_cost > 0 then
    insert into public.balance_tx (student_id, amount, date, type, description, module_id)
    values (p_student_id, -v_cost, v_occurred, 'deduction',
            'Présence: ' || coalesce(v_module_name, 'séance')
            || coalesce(' (' || v_group_name || ')', '')
            || ' (' || v_session.start_time || '-' || v_session.end_time || ')'
            || case when v_own_group then '' else ' — rattrapage sur un autre groupe' end
            || case when v_new_balance < 0 then ' — dette enregistrée' else '' end,
            v_session.module_id);
  end if;

  if v_session.teacher_id is not null and not p_skip_teacher_due then
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
    'messageKey', case
      when v_new_balance < 0 then 'scan.successDebt'
      when p_status = 'late' then 'scan.successLate'
      else 'scan.success'
    end
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. process_weekly_absences — semaines calendaires vendredi -> vendredi
-- ---------------------------------------------------------------------------
-- Une "semaine d'absence" court du vendredi (inclus) au vendredi suivant
-- (exclu, il ouvre la semaine d'après). Si l'élève n'a badgé sur AUCUN groupe
-- du module pendant une semaine entièrement écoulée, le prix de sa séance est
-- débité et l'absence est journalisée (fiche élève + compte élève).
create or replace function public.week_anchor(p_date date, p_start_dow smallint)
returns date
language sql immutable as $$
  -- Dernier "jour d'ouverture" (0=dimanche … 6=samedi) à p_date ou avant.
  select p_date - ((extract(dow from p_date)::int - coalesce(p_start_dow, 5)::int + 7) % 7);
$$;

grant execute on function public.week_anchor(date, smallint) to authenticated;

create or replace function public.process_weekly_absences(p_when timestamptz default now())
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_role user_role := public.current_role();
  v_today date := (p_when at time zone 'Africa/Algiers')::date;
  v_floor date;
  v_enabled boolean;
  v_last_run date;
  v_start_dow smallint;
  v_charged int := 0;
  v_students int := 0;
  v_prev_student uuid;
  v_enr record;
  v_cost int;
  v_window int;
  v_aligned boolean;
  v_last_att date;
  v_last_pen date;
  v_anchor date;
  v_pen_anchor date;
  v_period_start date;
  v_period_end date;
  v_pen_id uuid;
  v_new_balance int;
  v_module_name text;
  v_group_name text;
  v_present boolean;
  c_max_weeks constant int := 8;
  v_iter int;
begin
  if auth.uid() is not null and (v_role is null or v_role not in ('admin', 'reception')) then
    raise exception 'not authorized';
  end if;

  select coalesce(absence_penalty_enabled, true),
         coalesce(absence_penalty_since, v_today),
         absence_penalty_last_run,
         coalesce(absence_week_start_day, 5)
    into v_enabled, v_floor, v_last_run, v_start_dow
  from public.school
  limit 1;

  if not coalesce(v_enabled, true) then
    return jsonb_build_object('ok', true, 'enabled', false, 'charged', 0, 'students', 0);
  end if;

  if v_last_run is not null and v_last_run >= v_today then
    return jsonb_build_object('ok', true, 'skipped', true, 'charged', 0, 'students', 0);
  end if;

  for v_enr in
    select ss.student_id,
           ss.subscription_id,
           ss.start_date        as enr_start,
           st.is_free           as is_free,
           st.created_at::date  as student_since,
           public.discounted_price(sub.price_per_session, ss.discount_type, ss.discount_value) as price,
           se.id                as session_id,
           se.module_id         as module_id,
           se.class_id          as class_id,
           se.is_open           as is_open,
           se.period_start      as se_period_start,
           se.period_end        as se_period_end,
           coalesce(mar.enabled, true)     as rule_enabled,
           coalesce(mar.days_window, 7)    as rule_window
    from public.student_subscriptions ss
    join public.students st       on st.id = ss.student_id
    join public.subscriptions sub on sub.id = ss.subscription_id
    join public.sessions se       on se.id = sub.session_id
    left join public.module_absence_rules mar on mar.module_id = se.module_id
    where coalesce(sub.price_per_session, 0) > 0
    order by ss.student_id
  loop
    if not v_enr.rule_enabled then
      continue;
    end if;

    v_cost := case when v_enr.is_free then 0 else coalesce(v_enr.price, 0) end;
    if v_cost <= 0 then
      continue;
    end if;

    v_window := greatest(coalesce(v_enr.rule_window, 7), 1);
    -- La règle standard (7 jours) suit le calendrier vendredi -> vendredi ;
    -- une fenêtre personnalisée reste glissante.
    v_aligned := (v_window = 7);

    -- Dernière présence de l'élève sur CE module — n'importe quel groupe.
    select max((timezone('Africa/Algiers', a.occurred_at))::date)
      into v_last_att
    from public.attendance a
    join public.sessions ase on ase.id = a.session_id
    where a.student_id = v_enr.student_id
      and ase.module_id = v_enr.module_id
      and ase.class_id  = v_enr.class_id
      and a.status in ('present', 'late');

    select max(period_end) into v_last_pen
    from public.absence_penalties
    where student_id = v_enr.student_id
      and subscription_id = v_enr.subscription_id;

    if v_aligned then
      -- Point de départ : le vendredi qui ouvre la semaine du plus tardif entre
      -- la date plancher, l'inscription et l'arrivée de l'élève…
      v_anchor := public.week_anchor(
        greatest(
          v_floor,
          coalesce(v_enr.enr_start, v_floor),
          coalesce(v_enr.student_since, v_floor)
        ), v_start_dow);

      -- … puis le premier vendredi qui suit la dernière semaine déjà facturée
      -- (les lignes écrites par l'ancienne règle glissante ne tombent pas
      -- forcément un vendredi).
      if v_last_pen is not null then
        v_pen_anchor := public.week_anchor(v_last_pen, v_start_dow);
        if v_pen_anchor < v_last_pen then
          v_pen_anchor := v_pen_anchor + v_window;
        end if;
        v_anchor := greatest(v_anchor, v_pen_anchor);
      end if;

      -- Borne de sécurité : on ne remonte jamais plus loin que c_max_weeks
      -- semaines, sinon un élève toujours présent ferait boucler la fonction
      -- sur son historique entier à chaque exécution.
      v_anchor := greatest(v_anchor,
        public.week_anchor(v_today, v_start_dow) - (c_max_weeks * v_window));
    else
      v_anchor := greatest(
        v_floor,
        coalesce(v_enr.enr_start, v_floor),
        coalesce(v_last_att, v_floor),
        coalesce(v_enr.student_since, v_floor),
        coalesce(v_last_pen, v_floor)
      );
    end if;

    v_iter := 0;
    loop
      v_iter := v_iter + 1;
      exit when v_iter > c_max_weeks + 1;

      if v_aligned then
        v_period_start := v_anchor;
        v_period_end   := v_anchor + v_window;   -- le vendredi suivant
        -- la semaine doit être entièrement écoulée
        exit when v_period_end > v_today;
      else
        v_period_start := v_anchor + 1;
        v_period_end   := v_anchor + v_window;
        exit when v_today - v_anchor < v_window;
      end if;

      -- Rien à facturer avant l'inscription / la date plancher.
      if v_period_end <= greatest(v_floor, coalesce(v_enr.enr_start, v_floor)) then
        v_anchor := v_anchor + v_window;
        continue;
      end if;

      -- Créneau "séance libre" : pas de séance = pas d'absence.
      if v_enr.is_open
         and ((v_enr.se_period_end is not null and v_enr.se_period_end < v_period_start)
           or (v_enr.se_period_start is not null and v_enr.se_period_start > v_period_end)) then
        v_anchor := v_anchor + v_window;
        continue;
      end if;

      -- Présent au moins une fois sur le module (tous groupes) cette semaine ?
      select exists (
        select 1
        from public.attendance a
        join public.sessions ase on ase.id = a.session_id
        where a.student_id = v_enr.student_id
          and ase.module_id = v_enr.module_id
          and ase.class_id  = v_enr.class_id
          and a.status in ('present', 'late')
          and (timezone('Africa/Algiers', a.occurred_at))::date >= v_period_start
          and (timezone('Africa/Algiers', a.occurred_at))::date <  v_period_end
      ) into v_present;

      if v_present then
        v_anchor := v_anchor + v_window;
        continue;
      end if;

      begin
        insert into public.absence_penalties
          (student_id, subscription_id, session_id, module_id,
           period_start, period_end, amount, balance_after)
        values
          (v_enr.student_id, v_enr.subscription_id, v_enr.session_id, v_enr.module_id,
           v_period_start, v_period_end, v_cost, 0)
        returning id into v_pen_id;
      exception when unique_violation then
        v_anchor := v_anchor + v_window;
        continue;
      end;

      update public.students
        set balance = balance - v_cost
        where id = v_enr.student_id
        returning balance into v_new_balance;

      update public.absence_penalties
        set balance_after = v_new_balance
        where id = v_pen_id;

      select m.name into v_module_name from public.modules m where m.id = v_enr.module_id;
      select g.name into v_group_name
        from public.groups g
        join public.sessions gse on gse.group_id = g.id
        where gse.id = v_enr.session_id;

      insert into public.balance_tx (student_id, amount, date, type, description, module_id)
      values (
        v_enr.student_id, -v_cost, p_when, 'deduction',
        'Absence hebdomadaire — ' || coalesce(v_module_name, 'module')
          || coalesce(' (' || v_group_name || ')', '')
          || ' — semaine du ' || to_char(v_period_start, 'DD/MM/YYYY')
          || ' au ' || to_char(v_period_end, 'DD/MM/YYYY')
          || ' — solde: ' || v_new_balance || ' DA'
          || case when v_new_balance < 0 then ' (dette)' else '' end,
        v_enr.module_id
      );

      if v_enr.student_id is distinct from v_prev_student then
        v_students := v_students + 1;
        v_prev_student := v_enr.student_id;
      end if;
      v_charged := v_charged + 1;
      v_anchor := v_anchor + v_window;
    end loop;
  end loop;

  update public.school set absence_penalty_last_run = v_today;

  return jsonb_build_object('ok', true, 'enabled', true, 'charged', v_charged, 'students', v_students);
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Correction d'une présence / suppression d'une absence facturée
-- ---------------------------------------------------------------------------
-- Modifie une ligne de présence (statut, date/heure, montant débité) et reporte
-- la différence sur le solde de l'élève dans la même transaction, pour que
-- l'historique et le solde ne puissent jamais diverger.
create or replace function public.update_attendance(
  p_attendance_id uuid,
  p_status attendance_status default null,
  p_occurred_at timestamptz default null,
  p_amount integer default null
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_role user_role := public.current_role();
  v_att public.attendance%rowtype;
  v_session public.sessions%rowtype;
  v_status attendance_status;
  v_occurred timestamptz;
  v_amount int;
  v_delta int;
  v_new_balance int;
  v_module_name text;
  v_group_name text;
  v_date date;
  v_old_date date;
begin
  if v_role is null or v_role not in ('admin', 'reception') then
    raise exception 'not authorized';
  end if;

  select * into v_att from public.attendance where id = p_attendance_id;
  if not found then
    return jsonb_build_object('ok', false, 'messageKey', 'attendance.notFound');
  end if;

  select * into v_session from public.sessions where id = v_att.session_id;

  v_status   := coalesce(p_status, v_att.status);
  v_occurred := coalesce(p_occurred_at, v_att.occurred_at);
  v_amount   := greatest(coalesce(p_amount, v_att.amount_deducted), 0);
  v_delta    := v_amount - v_att.amount_deducted;
  v_old_date := (timezone('Africa/Algiers', v_att.occurred_at))::date;
  v_date     := (timezone('Africa/Algiers', v_occurred))::date;

  select m.name into v_module_name from public.modules m where m.id = v_session.module_id;
  select g.name into v_group_name from public.groups g where g.id = v_session.group_id;

  -- Une seule présence par élève / créneau / jour : déplacer la ligne sur un
  -- jour déjà pointé est refusé proprement plutôt que de remonter une erreur SQL.
  begin
    update public.attendance
      set status = v_status,
          occurred_at = v_occurred,
          amount_deducted = v_amount
      where id = p_attendance_id;
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'messageKey', 'attendance.duplicateDay');
  end;

  -- Le solde suit exactement le montant débité par la présence.
  if v_delta <> 0 then
    update public.students set balance = balance - v_delta
      where id = v_att.student_id
      returning balance into v_new_balance;

    insert into public.balance_tx (student_id, amount, date, type, description, module_id)
    values (v_att.student_id, -v_delta, now(),
            case when v_delta > 0 then 'deduction' else 'topup' end,
            'Correction présence: ' || coalesce(v_module_name, 'séance')
              || coalesce(' (' || v_group_name || ')', '')
              || ' du ' || to_char(v_old_date, 'DD/MM/YYYY')
              || ' — ' || v_att.amount_deducted || ' DA → ' || v_amount || ' DA',
            v_session.module_id);
  else
    select balance into v_new_balance from public.students where id = v_att.student_id;
  end if;

  -- La part enseignant suit le nouveau montant.
  update public.unpaid_teacher_sessions u
    set amount = round(v_amount * coalesce(t.percentage, 0) / 100.0),
        date = v_occurred
  from public.teachers t
  where t.id = u.teacher_id
    and u.student_id = v_att.student_id
    and u.session_id = v_att.session_id
    and u.paid = false
    and (timezone('Africa/Algiers', u.date))::date = v_old_date
    and t.payment_type = 'percentage';

  return jsonb_build_object('ok', true, 'newBalance', v_new_balance,
    'cost', v_amount, 'status', v_status, 'delta', v_delta,
    'messageKey', 'attendance.updated');
end;
$$;

revoke execute on function public.update_attendance(uuid, attendance_status, timestamptz, integer) from public, anon;
grant execute on function public.update_attendance(uuid, attendance_status, timestamptz, integer) to authenticated;

-- Supprime une absence hebdomadaire facturée : rembourse le montant, retire la
-- ligne de l'historique du solde, puis supprime l'absence.
create or replace function public.delete_absence_penalty(p_penalty_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_role user_role := public.current_role();
  v_pen public.absence_penalties%rowtype;
  v_tx_id uuid;
  v_new_balance int;
begin
  if v_role is null or v_role not in ('admin', 'reception') then
    raise exception 'not authorized';
  end if;

  select * into v_pen from public.absence_penalties where id = p_penalty_id;
  if not found then
    return jsonb_build_object('ok', false, 'messageKey', 'absence.notFound');
  end if;

  -- La ligne de solde écrite par la facturation porte la période dans sa
  -- description : on la retrouve par module + montant + semaine.
  select id into v_tx_id
  from public.balance_tx
  where student_id = v_pen.student_id
    and amount = -v_pen.amount
    and type = 'deduction'
    and description like 'Absence hebdomadaire%'
    and description like '%' || to_char(v_pen.period_start, 'DD/MM/YYYY') || '%'
    and (module_id is not distinct from v_pen.module_id)
  order by date desc
  limit 1;

  if v_tx_id is not null then
    delete from public.balance_tx where id = v_tx_id;
  end if;

  update public.students set balance = balance + v_pen.amount
    where id = v_pen.student_id
    returning balance into v_new_balance;

  delete from public.absence_penalties where id = p_penalty_id;

  return jsonb_build_object('ok', true, 'refunded', v_pen.amount,
    'newBalance', v_new_balance, 'messageKey', 'absence.deleted');
end;
$$;

revoke execute on function public.delete_absence_penalty(uuid) from public, anon;
grant execute on function public.delete_absence_penalty(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Grants (signatures inchangées, ré-affirmés par sécurité)
-- ---------------------------------------------------------------------------
revoke execute on function public.scan_card(text, timestamptz) from public, anon;
revoke execute on function public.mark_attendance(uuid, uuid, attendance_status, date, boolean, boolean) from public, anon;
revoke execute on function public.process_weekly_absences(timestamptz) from public, anon;

grant execute on function public.scan_card(text, timestamptz) to authenticated;
grant execute on function public.mark_attendance(uuid, uuid, attendance_status, date, boolean, boolean) to authenticated;
grant execute on function public.process_weekly_absences(timestamptz) to authenticated;
