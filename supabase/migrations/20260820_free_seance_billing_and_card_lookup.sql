-- =============================================================================
-- Créneaux de séance libre OFFERTS + lecture de carte tolérante
-- Run once against the live project (Supabase Dashboard -> SQL Editor).
--
-- 1. `sessions.is_free` (migration 20260820_free_open_seances_timing) était
--    posé sur la table mais AUCUNE règle de facturation ne le lisait : un
--    créneau coché « offert » débitait quand même l'élève et rémunérait quand
--    même l'enseignant. scan_card et mark_attendance appliquent désormais la
--    règle complète sur un créneau offert :
--      · le solde de l'élève n'est JAMAIS débité (aucune ligne balance_tx,
--        donc l'école n'encaisse rien) ;
--      · AUCUNE ligne unpaid_teacher_sessions n'est écrite : l'enseignant
--        n'est pas rémunéré sur ce créneau (même règle que les séances libres
--        « offertes » de l'écran Séances Libres) ;
--      · la présence est enregistrée normalement et le prix non facturé part
--        dans attendance.waived_amount, pour que les rapports sachent ce qui
--        a été offert.
--    La réponse JSON porte `freeSeance: true` pour que l'écran distingue un
--    créneau offert d'une période gratuite.
--
-- 2. Lecture de carte insensible à la casse et aux espaces — scan_card comme
--    scan_worker_card. Une carte enregistrée « RFID-0010 » et saisie
--    « rfid-0010 » (ou collée avec une espace) répondait « carte introuvable » :
--    c'est la cause la plus fréquente des « Échec du scan » au guichet.
--
-- Ce script est IDEMPOTENT : ré-exécutable sans risque.
-- =============================================================================

-- La colonne peut manquer si 20260820_free_open_seances_timing n'a pas encore
-- été passée : on la (re)pose ici pour que ce script soit auto-suffisant.
alter table public.sessions
  add column if not exists is_free boolean not null default false;

-- ---------------------------------------------------------------------------
-- 1. scan_card
-- ---------------------------------------------------------------------------
create or replace function public.scan_card(p_code text, p_when timestamptz default now())
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_role user_role := public.current_role();
  v_student public.students%rowtype;
  v_code text := btrim(coalesce(p_code, ''));
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
  v_teacher_base int := 0;
  v_teacher_due int := 0;
  v_new_balance int;
  v_module_name text;
  v_group_name text;
  v_own_group boolean;
  v_own_group_name text;
  v_free public.free_periods%rowtype;
  v_is_free_period boolean := false;
  v_free_seance boolean := false;
  v_enr_start date;
  v_before_start boolean := false;
  v_offered boolean := false;
  v_waived int := 0;
  c_early_margin constant int := 30;
  c_late_after   constant int := 30;
  c_cooldown_min constant int := 30;
  c_double_swipe_sec constant int := 60;
begin
  if v_role is null or v_role not in ('admin', 'reception', 'teacher') then
    raise exception 'not authorized to scan cards';
  end if;

  if v_code = '' then
    return jsonb_build_object('ok', false, 'messageKey', 'scan.notFound');
  end if;

  -- Carte retrouvée sans se soucier de la casse ni des espaces parasites.
  select * into v_student from public.students
  where upper(btrim(rfid)) = upper(v_code) or id::text = v_code
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
  -- envoie parfois deux trames), longue sur LE MÊME créneau.
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
        and (ss.expiry_date is null or ss.expiry_date >= v_date)
    )
  order by
    (case when v_now_min >= public.time_to_minutes(se.start_time) then 0 else 1 end),
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
           count(*) filter (where ss.expiry_date is null or ss.expiry_date >= v_date)
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
        and (ss.expiry_date is null or ss.expiry_date >= v_date)
      limit 1),
    (select sub.price_per_session from public.subscriptions sub
      where sub.session_id = v_matched.id limit 1),
    0) into v_price;

  -- ---- Date de début de l'inscription --------------------------------------
  select ss.start_date into v_enr_start
  from public.student_subscriptions ss
  join public.subscriptions sub on sub.id = ss.subscription_id
  where ss.student_id = v_student.id and sub.session_id = v_matched.id
  limit 1;

  if not found then
    select ss.start_date into v_enr_start
    from public.student_subscriptions ss
    join public.subscriptions sub on sub.id = ss.subscription_id
    join public.sessions enr on enr.id = sub.session_id
    where ss.student_id = v_student.id
      and enr.module_id = v_matched.module_id
      and enr.class_id  = v_matched.class_id
      and (ss.expiry_date is null or ss.expiry_date >= v_date)
    order by ss.start_date nulls first
    limit 1;
  end if;

  v_before_start := v_enr_start is not null and v_enr_start > v_date;

  -- ---- Créneau de séance libre OFFERT --------------------------------------
  v_free_seance := coalesce(v_matched.is_free, false);

  -- ---- Période gratuite ----------------------------------------------------
  select * into v_free
  from public.active_free_period(
    array[v_matched.class_id] || coalesce(v_matched.class_ids, '{}'::uuid[]),
    v_date);
  v_is_free_period := found;

  -- Trois raisons d'offrir la séance ; dans les trois cas le solde est intact
  -- et le prix non facturé est mémorisé.
  v_offered := v_free_seance or v_is_free_period or v_before_start;

  if v_offered then
    v_waived := case when v_student.is_free then 0 else v_price end;
    v_cost := 0;
  else
    v_cost := case when v_student.is_free then 0 else v_price end;
  end if;

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

  -- Part enseignant. Sur un CRÉNEAU OFFERT elle est nulle et aucune ligne n'est
  -- écrite du tout : personne n'encaisse cette séance, l'enseignant compris.
  -- Sur une période gratuite (quand elle le prévoit) ou une séance antérieure
  -- au début de l'abonnement, elle suit le prix normal — l'enseignant a bien
  -- assuré le cours.
  v_teacher_base := case
    when v_free_seance then 0
    when v_is_free_period and coalesce(v_free.pay_teachers, true) then v_waived
    when v_before_start then v_waived
    else v_cost
  end;

  if v_matched.teacher_id is not null and not v_free_seance then
    select * into v_teacher from public.teachers where id = v_matched.teacher_id;
    if found and v_teacher.payment_type = 'percentage' then
      v_teacher_due := round(v_teacher_base * coalesce(v_teacher.percentage, 0) / 100.0);
    end if;
  end if;

  begin
    insert into public.attendance
      (student_id, session_id, occurred_at, amount_deducted, status, substitute_group,
       free_period_id, waived_amount, pre_start)
    values (v_student.id, v_matched.id, p_when, v_cost, v_status, not v_own_group,
       case when v_is_free_period then v_free.id else null end, v_waived,
       v_before_start and not v_is_free_period and not v_free_seance);
  exception when unique_violation then
    return jsonb_build_object('ok', true, 'studentId', v_student.id,
      'sessionId', v_matched.id, 'cost', 0, 'newBalance', v_student.balance,
      'moduleName', v_module_name, 'groupName', v_group_name,
      'otherGroup', not v_own_group,
      'sessionStart', v_matched.start_time, 'sessionEnd', v_matched.end_time,
      'messageKey', 'scan.alreadyPresent');
  end;

  if v_cost > 0 then
    update public.students set balance = balance - v_cost
      where id = v_student.id
      returning balance into v_new_balance;

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
  else
    -- Rien n'est débité : le solde reste strictement inchangé.
    v_new_balance := v_student.balance;
  end if;

  -- Créneau offert : AUCUNE ligne de rémunération, donc aucun règlement
  -- possible plus tard sur cette séance.
  if v_matched.teacher_id is not null and not v_free_seance then
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
    'free', v_is_free_period or v_free_seance,
    'freeSeance', v_free_seance,
    'freePeriodName', case when v_is_free_period then nullif(v_free.name, '') end,
    'preStart', v_before_start and not v_is_free_period and not v_free_seance,
    'enrollmentStart', case when v_before_start then v_enr_start end,
    'waived', v_waived,
    'messageKey', case when v_status = 'late' then 'scan.successLate' else 'scan.success' end
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. mark_attendance — même règle en saisie manuelle
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
  v_teacher_base int := 0;
  v_teacher_due int := 0;
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
    if v_session.is_open then
      select coalesce(sub.price_per_session, v_session.open_price) into v_price
      from public.subscriptions sub where sub.session_id = p_session_id limit 1;
      v_price := coalesce(v_price, v_session.open_price, 0);
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

  if v_cost > 0 and v_student.balance < v_cost and not p_allow_debt then
    return jsonb_build_object('ok', false, 'messageKey', 'scan.debtBlocked',
      'balance', v_student.balance, 'debt', v_student.balance < 0, 'moduleName', v_module_name);
  end if;

  v_teacher_base := case
    when v_free_seance then 0
    when v_is_free_period and coalesce(v_free.pay_teachers, true) then v_waived
    when v_before_start then v_waived
    else v_cost
  end;

  if v_session.teacher_id is not null and not p_skip_teacher_due and not v_free_seance then
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

  if v_session.teacher_id is not null and not p_skip_teacher_due and not v_free_seance then
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
    'messageKey', case
      when v_new_balance < 0 then 'scan.successDebt'
      when p_status = 'late' then 'scan.successLate'
      else 'scan.success'
    end
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. scan_worker_card — même tolérance sur le code de badge
-- ---------------------------------------------------------------------------
create or replace function public.scan_worker_card(p_code text, p_when timestamptz default now())
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_role user_role := public.current_role();
  v_worker public.reception_staff%rowtype;
  v_code text := btrim(coalesce(p_code, ''));
  v_date date := (p_when at time zone 'Africa/Algiers')::date;
  v_shift public.worker_shifts%rowtype;
  v_minutes int;
begin
  if v_role is null or v_role not in ('admin', 'reception') then
    raise exception 'not authorized to scan worker cards';
  end if;

  if v_code = '' then
    return jsonb_build_object('ok', false, 'messageKey', 'worker.notFound');
  end if;

  -- SEUL changement par rapport à 20260818 : le badge est retrouvé sans se
  -- soucier de la casse ni des espaces parasites.
  select * into v_worker from public.reception_staff
  where rfid is not null and upper(btrim(rfid)) = upper(v_code) limit 1;
  if not found then
    return jsonb_build_object('ok', false, 'messageKey', 'worker.notFound');
  end if;

  select * into v_shift from public.worker_shifts
  where worker_id = v_worker.id and work_date = v_date;

  -- Arrivée
  if not found then
    insert into public.worker_shifts (worker_id, work_date, start_at)
    values (v_worker.id, v_date, p_when)
    returning * into v_shift;
    return jsonb_build_object('ok', true, 'messageKey', 'worker.clockIn',
      'workerId', v_worker.id, 'workerName', v_worker.first_name || ' ' || v_worker.last_name,
      'date', v_date, 'startAt', v_shift.start_at);
  end if;

  -- Journée gelée : la réception doit corriger l'heure de fin à la main.
  if v_shift.frozen then
    return jsonb_build_object('ok', false, 'messageKey', 'worker.frozen',
      'workerId', v_worker.id, 'workerName', v_worker.first_name || ' ' || v_worker.last_name,
      'date', v_date);
  end if;

  if v_shift.start_at is null then
    update public.worker_shifts set start_at = p_when where id = v_shift.id;
    return jsonb_build_object('ok', true, 'messageKey', 'worker.clockIn',
      'workerId', v_worker.id, 'workerName', v_worker.first_name || ' ' || v_worker.last_name,
      'date', v_date, 'startAt', p_when);
  end if;

  if v_shift.end_at is not null then
    return jsonb_build_object('ok', true, 'messageKey', 'worker.alreadyClosed',
      'workerId', v_worker.id, 'workerName', v_worker.first_name || ' ' || v_worker.last_name,
      'date', v_date, 'minutes', v_shift.minutes);
  end if;

  -- Départ
  v_minutes := greatest(0, (extract(epoch from (p_when - v_shift.start_at)) / 60)::int);
  update public.worker_shifts
     set end_at = p_when, minutes = v_minutes
   where id = v_shift.id;

  return jsonb_build_object('ok', true, 'messageKey', 'worker.clockOut',
    'workerId', v_worker.id, 'workerName', v_worker.first_name || ' ' || v_worker.last_name,
    'date', v_date, 'minutes', v_minutes);
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Grants (signatures inchangées, ré-affirmés par sécurité)
-- ---------------------------------------------------------------------------
revoke execute on function public.scan_card(text, timestamptz) from public, anon;
revoke execute on function public.mark_attendance(uuid, uuid, attendance_status, date, boolean, boolean) from public, anon;
revoke execute on function public.scan_worker_card(text, timestamptz) from public, anon;

grant execute on function public.scan_card(text, timestamptz) to authenticated;
grant execute on function public.mark_attendance(uuid, uuid, attendance_status, date, boolean, boolean) to authenticated;
grant execute on function public.scan_worker_card(text, timestamptz) to authenticated;

notify pgrst, 'reload schema';
