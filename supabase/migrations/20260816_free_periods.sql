-- =============================================================================
-- Périodes gratuites (free periods)
-- Run once against the live project (Supabase Dashboard -> SQL Editor).
--
-- Une "période gratuite" est une fenêtre de dates pendant laquelle les séances
-- sont OFFERTES : l'élève badge normalement, sa présence est enregistrée, mais
-- RIEN n'est débité de son solde. Le prix qui aurait été facturé est mémorisé
-- sur la présence (attendance.waived_amount) pour que l'école sache exactement
-- combien la période lui a coûté.
--
-- Ce que fait cette migration :
--   1. table free_periods (dates, description, classes couvertes, actif) + RLS.
--   2. attendance.free_period_id / attendance.waived_amount — la trace de ce
--      qui a été offert, présence par présence.
--   3. active_free_period() — la période qui couvre une classe à une date.
--   4. scan_card réécrit : pendant une période gratuite, coût = 0, solde
--      intact, présence enregistrée, montant offert journalisé.
--   5. mark_attendance : même règle en saisie manuelle.
--   6. process_weekly_absences : aucune absence facturée sur une semaine qui
--      touche une période gratuite (sinon le "gratuit" serait repris par la
--      facturation hebdomadaire).
--   7. free_period_stats() — coût total / présences / élèves par période,
--      agrégé côté serveur (chiffres exacts, sans limite de lignes).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. La table des périodes gratuites
-- ---------------------------------------------------------------------------
create table if not exists public.free_periods (
  id uuid primary key default gen_random_uuid(),
  name text not null default '',
  description text not null default '',
  start_date date not null,
  end_date date not null,
  -- par défaut la période couvre TOUTES les classes ; décocher des classes
  -- bascule all_classes à false et ne garde que class_ids.
  all_classes boolean not null default true,
  class_ids uuid[] not null default '{}',
  -- l'enseignant est-il rémunéré normalement sur une séance offerte ?
  pay_teachers boolean not null default true,
  -- permet de suspendre une période sans perdre son historique
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint free_periods_dates_check check (end_date >= start_date)
);

create index if not exists free_periods_dates_idx
  on public.free_periods (start_date, end_date);

alter table public.free_periods enable row level security;

drop policy if exists free_periods_select on public.free_periods;
create policy free_periods_select on public.free_periods for select to authenticated
  using (true);

drop policy if exists free_periods_write on public.free_periods;
create policy free_periods_write on public.free_periods for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

-- ---------------------------------------------------------------------------
-- 2. La trace sur la présence
-- ---------------------------------------------------------------------------
-- free_period_id : la présence a été offerte par CETTE période.
-- waived_amount  : le prix qui aurait été débité (0 partout ailleurs). C'est
--                  la somme de cette colonne qui donne le coût de la période.
alter table public.attendance
  add column if not exists free_period_id uuid references public.free_periods (id) on delete set null,
  add column if not exists waived_amount integer not null default 0;

create index if not exists attendance_free_period_idx
  on public.attendance (free_period_id);

-- ---------------------------------------------------------------------------
-- 3. La période gratuite en vigueur pour une classe à une date donnée
-- ---------------------------------------------------------------------------
-- Renvoie 0 ou 1 ligne. Un créneau "séance libre" pouvant porter plusieurs
-- classes, l'argument est un TABLEAU de classes : la période s'applique dès
-- qu'une seule d'entre elles est couverte.
create or replace function public.active_free_period(p_class_ids uuid[], p_date date)
returns setof public.free_periods
language sql stable set search_path = public as $$
  select fp.*
  from public.free_periods fp
  where fp.active
    and p_date >= fp.start_date
    and p_date <= fp.end_date
    and (fp.all_classes or fp.class_ids && coalesce(p_class_ids, '{}'::uuid[]))
  order by fp.start_date desc, fp.created_at desc
  limit 1;
$$;

grant execute on function public.active_free_period(uuid[], date) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. scan_card — pendant une période gratuite, rien n'est débité
-- ---------------------------------------------------------------------------
-- Identique à la version précédente (fenêtre horaire, scan inter-groupes,
-- anti-double-badge, réductions), avec UN seul changement de règle : si une
-- période gratuite couvre la classe du créneau ce jour-là, le coût passe à 0,
-- le solde n'est pas touché, aucune ligne de compte n'est écrite, et le prix
-- normal est mémorisé dans attendance.waived_amount.
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
  v_teacher_base int := 0;
  v_teacher_due int := 0;
  v_new_balance int;
  v_module_name text;
  v_group_name text;
  v_own_group boolean;
  v_own_group_name text;
  v_free public.free_periods%rowtype;
  v_is_free_period boolean := false;
  v_waived int := 0;
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
        and (ss.start_date  is null or ss.start_date  <= v_date)
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

  -- ---- Période gratuite ----------------------------------------------------
  -- La séance est offerte : présence enregistrée, solde intact, montant offert
  -- journalisé pour le récapitulatif de la période.
  select * into v_free
  from public.active_free_period(
    array[v_matched.class_id] || coalesce(v_matched.class_ids, '{}'::uuid[]),
    v_date);
  v_is_free_period := found;

  if v_is_free_period then
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

  -- Part enseignant : sur une séance offerte, elle suit le prix normal quand la
  -- période le prévoit (l'enseignant a bien assuré le cours).
  v_teacher_base := case
    when v_is_free_period and coalesce(v_free.pay_teachers, true) then v_waived
    else v_cost
  end;

  if v_matched.teacher_id is not null then
    select * into v_teacher from public.teachers where id = v_matched.teacher_id;
    if found and v_teacher.payment_type = 'percentage' then
      v_teacher_due := round(v_teacher_base * coalesce(v_teacher.percentage, 0) / 100.0);
    end if;
  end if;

  begin
    insert into public.attendance
      (student_id, session_id, occurred_at, amount_deducted, status, substitute_group,
       free_period_id, waived_amount)
    values (v_student.id, v_matched.id, p_when, v_cost, v_status, not v_own_group,
       case when v_is_free_period then v_free.id else null end, v_waived);
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
    'free', v_is_free_period,
    'freePeriodName', case when v_is_free_period then nullif(v_free.name, '') end,
    'waived', v_waived,
    'messageKey', case when v_status = 'late' then 'scan.successLate' else 'scan.success' end
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. mark_attendance — même règle en saisie manuelle
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

  if not v_found then
    if v_session.is_open then
      select coalesce(sub.price_per_session, v_session.open_price) into v_price
      from public.subscriptions sub where sub.session_id = p_session_id limit 1;
      v_price := coalesce(v_price, v_session.open_price, 0);
    else
      return jsonb_build_object('ok', false, 'messageKey', 'attendance.notEnrolled');
    end if;
  end if;

  -- Période gratuite : présence enregistrée, solde intact.
  select * into v_free
  from public.active_free_period(
    array[v_session.class_id] || coalesce(v_session.class_ids, '{}'::uuid[]),
    v_date);
  v_is_free_period := found;

  if v_is_free_period then
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
    when v_is_free_period and coalesce(v_free.pay_teachers, true) then v_waived
    else v_cost
  end;

  if v_session.teacher_id is not null and not p_skip_teacher_due then
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
       free_period_id, waived_amount)
    values (p_student_id, p_session_id, v_occurred, v_cost, p_status, not v_own_group,
       case when v_is_free_period then v_free.id else null end, v_waived);
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
    'free', v_is_free_period,
    'freePeriodName', case when v_is_free_period then nullif(v_free.name, '') end,
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
-- 6. process_weekly_absences — aucune absence facturée sur une période gratuite
-- ---------------------------------------------------------------------------
-- Identique à la version précédente, avec une exception supplémentaire : dès
-- qu'une période gratuite couvrant la classe touche la semaine examinée, la
-- semaine est ignorée (offrir les séances puis facturer l'absence serait
-- contradictoire).
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
    v_aligned := (v_window = 7);

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
      v_anchor := public.week_anchor(
        greatest(
          v_floor,
          coalesce(v_enr.enr_start, v_floor),
          coalesce(v_enr.student_since, v_floor)
        ), v_start_dow);

      if v_last_pen is not null then
        v_pen_anchor := public.week_anchor(v_last_pen, v_start_dow);
        if v_pen_anchor < v_last_pen then
          v_pen_anchor := v_pen_anchor + v_window;
        end if;
        v_anchor := greatest(v_anchor, v_pen_anchor);
      end if;

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
        v_period_end   := v_anchor + v_window;
        exit when v_period_end > v_today;
      else
        v_period_start := v_anchor + 1;
        v_period_end   := v_anchor + v_window;
        exit when v_today - v_anchor < v_window;
      end if;

      if v_period_end <= greatest(v_floor, coalesce(v_enr.enr_start, v_floor)) then
        v_anchor := v_anchor + v_window;
        continue;
      end if;

      if v_enr.is_open
         and ((v_enr.se_period_end is not null and v_enr.se_period_end < v_period_start)
           or (v_enr.se_period_start is not null and v_enr.se_period_start > v_period_end)) then
        v_anchor := v_anchor + v_window;
        continue;
      end if;

      -- Période gratuite chevauchant la semaine : rien n'est facturé.
      if exists (
        select 1 from public.free_periods fp
        where fp.active
          and (fp.all_classes or v_enr.class_id = any (fp.class_ids))
          and fp.start_date < v_period_end
          and fp.end_date  >= v_period_start
      ) then
        v_anchor := v_anchor + v_window;
        continue;
      end if;

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
-- 7. Récapitulatif d'une période gratuite (coût réel pour l'école)
-- ---------------------------------------------------------------------------
-- Agrégé côté serveur : le total ne dépend pas du nombre de lignes de présence
-- que le navigateur a pu charger.
create or replace function public.free_period_stats(p_free_period_id uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_role user_role := public.current_role();
  v_out jsonb;
begin
  if v_role is null or v_role not in ('admin', 'reception') then
    raise exception 'not authorized';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', fp.id,
           'presences', coalesce(s.presences, 0),
           'students', coalesce(s.students, 0),
           'waived', coalesce(s.waived, 0)
         ) order by fp.start_date desc), '[]'::jsonb)
    into v_out
  from public.free_periods fp
  left join lateral (
    select count(*)                    as presences,
           count(distinct a.student_id) as students,
           sum(a.waived_amount)        as waived
    from public.attendance a
    where a.free_period_id = fp.id
  ) s on true
  where p_free_period_id is null or fp.id = p_free_period_id;

  return v_out;
end;
$$;

revoke execute on function public.free_period_stats(uuid) from public, anon;
grant execute on function public.free_period_stats(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Grants (signatures inchangées, ré-affirmés par sécurité)
-- ---------------------------------------------------------------------------
revoke execute on function public.scan_card(text, timestamptz) from public, anon;
revoke execute on function public.mark_attendance(uuid, uuid, attendance_status, date, boolean, boolean) from public, anon;
revoke execute on function public.process_weekly_absences(timestamptz) from public, anon;

grant execute on function public.scan_card(text, timestamptz) to authenticated;
grant execute on function public.mark_attendance(uuid, uuid, attendance_status, date, boolean, boolean) to authenticated;
grant execute on function public.process_weekly_absences(timestamptz) to authenticated;
