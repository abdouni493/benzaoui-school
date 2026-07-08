-- =============================================================================
-- Scan par niveau + module (tous groupes), cooldown 30 min, dette manuelle
-- uniquement, module sur les transactions, travailleurs (rôles + demi-journée).
-- Run once against the live project (Supabase Dashboard -> SQL Editor).
--
-- What this migration does:
--   1. balance_tx.module_id — deductions/refunds are linked to the module of
--      the séance so the student file can filter transactions per module.
--   2. scan_card() rewrite:
--        - REMOVED: the restriction that the scan must match one of the
--          student's OWN groups/timings. A scan is now accepted for ANY séance
--          currently running whose CLASS LEVEL and MODULE both match one of
--          the student's (date-valid) enrollments — whatever the group.
--        - 30-minute anti-double-scan cooldown across all séances: a second
--          swipe within 30 min of an accepted scan is ignored entirely.
--        - Insufficient balance (cannot cover the séance price) => scan
--          rejected with 'scan.expired'. No presence, NO automatic debt.
--        - Two eligible séances at the same moment: the group the student is
--          enrolled in wins, then the séance whose start time is closest.
--   3. mark_attendance() — the ONLY way to create a debt: the debt
--      confirmation gate now fires whenever the balance cannot cover the
--      séance price (not only when already negative); reception confirms with
--      p_allow_debt and the presence + negative balance are recorded. The
--      price lookup falls back to the student's enrollment on the same
--      module + class level, so a presence in another group of his module can
--      also be recorded manually.
--   4. add_student_balance() — recharging a negative balance settles the debt
--      automatically (single signed balance) and the settlement is now spelled
--      out in the transaction history.
--   5. Workers (ex-Administration): reception_staff gains a `role`
--      ('reception' | 'security' | 'menage'), rows no longer REQUIRE an auth
--      account (FK to profiles dropped, id defaults to a random uuid), and the
--      payment type gains 'half_day' (demi-journée).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. balance_tx.module_id
-- ---------------------------------------------------------------------------
alter table public.balance_tx
  add column if not exists module_id uuid references public.modules (id) on delete set null;

create index if not exists balance_tx_module_id_idx on public.balance_tx (module_id);

-- ---------------------------------------------------------------------------
-- 2. scan_card — level + module matching, cooldown, no automatic debt
-- ---------------------------------------------------------------------------
create or replace function public.scan_card(p_code text, p_when timestamptz default now())
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_role user_role := public.current_role();
  v_student public.students%rowtype;
  v_last_scan timestamptz;
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
  c_early_margin constant int := 30; -- minutes a student may badge before start
  c_late_after   constant int := 30; -- minutes after start counted as "late"
  c_cooldown_min constant int := 30; -- anti-double-scan window
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

  -- Anti-double-scan cooldown: any accepted scan (= presence row) in the last
  -- 30 minutes makes this swipe a no-op — no deduction, no presence, only the
  -- on-screen "Déjà enregistré" feedback.
  select max(occurred_at) into v_last_scan
  from public.attendance
  where student_id = v_student.id;
  if v_last_scan is not null
     and p_when >= v_last_scan
     and p_when - v_last_scan < make_interval(mins => c_cooldown_min) then
    return jsonb_build_object('ok', false, 'studentId', v_student.id,
      'messageKey', 'scan.cooldown');
  end if;

  v_local := p_when at time zone 'Africa/Algiers';
  v_date := v_local::date;
  v_today := (array['sunday','monday','tuesday','wednesday','thursday','friday','saturday']::day_of_week[])
    [extract(dow from v_local)::int + 1];
  v_now_min := extract(hour from v_local)::int * 60 + extract(minute from v_local)::int;

  -- The séance being scanned: scheduled on THIS weekday, running now
  -- ([start - margin .. end]), and its class level + module both match one of
  -- the student's date-valid enrollments — the student does NOT need to be
  -- enrolled in that specific group. If several windows are eligible, a group
  -- the student is enrolled in wins, then the closest start time.
  select se.* into v_matched
  from public.sessions se
  where v_today = any (se.days)
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
    (case when exists (
       select 1 from public.subscriptions s2
       join public.student_subscriptions ss2 on ss2.subscription_id = s2.id
       where s2.session_id = se.id and ss2.student_id = v_student.id
     ) then 0 else 1 end),
    abs(public.time_to_minutes(se.start_time) - v_now_min)
  limit 1;

  if not found then
    -- No eligible séance at this moment: report the precise reason.
    select count(*),
           min(public.time_to_minutes(se.start_time)) filter (
             where public.time_to_minutes(se.start_time) - c_early_margin > v_now_min)
      into v_total_today, v_next_start
    from public.sessions se
    where v_today = any (se.days)
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

    -- Nothing eligible today: expired enrollment, wrong level/module for what
    -- is running right now, or simply no séance today.
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
      -- A séance IS running, but for another class level or a module the
      -- student is not assigned to.
      return jsonb_build_object('ok', false, 'studentId', v_student.id,
        'messageKey', 'scan.notEligible');
    end if;

    return jsonb_build_object('ok', false, 'studentId', v_student.id,
      'messageKey', 'scan.noSessionToday');
  end if;

  select m.name into v_module_name from public.modules m where m.id = v_matched.module_id;

  -- Already badged for this séance today -> nothing more is charged.
  if exists (
    select 1 from public.attendance
    where student_id = v_student.id
      and session_id = v_matched.id
      and (timezone('Africa/Algiers', occurred_at))::date = v_date
  ) then
    return jsonb_build_object('ok', true, 'studentId', v_student.id,
      'sessionId', v_matched.id, 'cost', 0, 'newBalance', v_student.balance,
      'moduleName', v_module_name,
      'sessionStart', v_matched.start_time, 'sessionEnd', v_matched.end_time,
      'messageKey', 'scan.alreadyPresent');
  end if;

  -- Price of the scanned séance; if that group has no subscription row, fall
  -- back to the price of the enrollment that made the scan eligible.
  select coalesce(
    (select sub.price_per_session from public.subscriptions sub
      where sub.session_id = v_matched.id limit 1),
    (select sub.price_per_session
       from public.student_subscriptions ss
       join public.subscriptions sub on sub.id = ss.subscription_id
       join public.sessions enr on enr.id = sub.session_id
      where ss.student_id = v_student.id
        and enr.module_id = v_matched.module_id
        and enr.class_id  = v_matched.class_id
        and (ss.start_date  is null or ss.start_date  <= v_date)
        and (ss.expiry_date is null or ss.expiry_date >= v_date)
      limit 1),
    0) into v_price;

  v_cost := case when v_student.is_free then 0 else v_price end;

  -- Sufficient balance rule: the balance must cover this séance's price.
  -- Otherwise the scan is refused — no presence, and NO automatic debt (a
  -- debt can only be created by a staff member from the attendance screen).
  if v_cost > 0 and v_student.balance < v_cost then
    return jsonb_build_object('ok', false, 'studentId', v_student.id,
      'sessionId', v_matched.id, 'balance', v_student.balance,
      'debt', v_student.balance < 0,
      'moduleName', v_module_name,
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

  -- Insert the presence first: the unique index turns any concurrent double
  -- scan into a no-charge "already present" instead of a double deduction.
  -- The presence stores the ACTUAL group scanned into (v_matched), not the
  -- group the student is enrolled in.
  begin
    insert into public.attendance (student_id, session_id, occurred_at, amount_deducted, status)
    values (v_student.id, v_matched.id, p_when, v_cost, v_status);
  exception when unique_violation then
    return jsonb_build_object('ok', true, 'studentId', v_student.id,
      'sessionId', v_matched.id, 'cost', 0, 'newBalance', v_student.balance,
      'moduleName', v_module_name,
      'sessionStart', v_matched.start_time, 'sessionEnd', v_matched.end_time,
      'messageKey', 'scan.alreadyPresent');
  end;

  update public.students set balance = balance - v_cost
    where id = v_student.id
    returning balance into v_new_balance;

  if v_cost > 0 then
    insert into public.balance_tx (student_id, amount, date, type, description, module_id)
    values (v_student.id, -v_cost, p_when, 'deduction',
            'Séance ' || coalesce(v_module_name, '') || ' (' || v_matched.start_time || '-' || v_matched.end_time || ')',
            v_matched.module_id);
  end if;

  -- Séance history + percentage due for the teacher (amount 0 for monthly
  -- teachers: the row still documents the worked séance).
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
    'sessionStart', v_matched.start_time,
    'sessionEnd', v_matched.end_time,
    'messageKey', case when v_status = 'late' then 'scan.successLate' else 'scan.success' end
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. mark_attendance — manual marking is the only path that may create a debt
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
  v_cost int;
  v_teacher public.teachers%rowtype;
  v_teacher_due int := 0;
  v_new_balance int;
  v_module_name text;
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

  -- A roll-call sheet only exists on weekdays the séance is scheduled.
  v_day := (array['sunday','monday','tuesday','wednesday','thursday','friday','saturday']::day_of_week[])
    [extract(dow from v_date)::int + 1];
  if not (v_day = any (v_session.days)) then
    return jsonb_build_object('ok', false, 'messageKey', 'attendance.notScheduledThatDay');
  end if;

  select m.name into v_module_name from public.modules m where m.id = v_session.module_id;

  select * into v_existing from public.attendance
  where student_id = p_student_id
    and session_id = p_session_id
    and (timezone('Africa/Algiers', occurred_at))::date = v_date
  limit 1;
  v_has_existing := found;

  if p_status = 'absent' then
    if not v_has_existing then
      -- absent is the default: nothing recorded, nothing to refund
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

  -- present / late
  if v_has_existing then
    -- Only a status switch: no money moves twice.
    update public.attendance set status = p_status where id = v_existing.id;
    return jsonb_build_object('ok', true, 'messageKey', 'attendance.statusUpdated',
      'cost', 0, 'newBalance', v_student.balance, 'status', p_status);
  end if;

  -- Price: the student's enrollment on THIS séance, or (new open-scan rules)
  -- his enrollment on the same module + class level via another group.
  select sub.price_per_session into v_price
  from public.subscriptions sub
  join public.student_subscriptions ss on ss.subscription_id = sub.id
  where sub.session_id = p_session_id
    and ss.student_id = p_student_id
    and (ss.start_date  is null or ss.start_date  <= v_date)
    and (ss.expiry_date is null or ss.expiry_date >= v_date)
  limit 1;
  if not found then
    select sub.price_per_session into v_price
    from public.student_subscriptions ss
    join public.subscriptions sub on sub.id = ss.subscription_id
    join public.sessions enr on enr.id = sub.session_id
    where ss.student_id = p_student_id
      and enr.module_id = v_session.module_id
      and enr.class_id  = v_session.class_id
      and (ss.start_date  is null or ss.start_date  <= v_date)
      and (ss.expiry_date is null or ss.expiry_date >= v_date)
    limit 1;
    if not found then
      return jsonb_build_object('ok', false, 'messageKey', 'attendance.notEnrolled');
    end if;
  end if;

  v_cost := case when v_student.is_free then 0 else coalesce(v_price, 0) end;

  -- Debt gate: whenever the balance cannot cover the séance, reception must
  -- explicitly confirm — this is the ONLY flow that may create a debt (the
  -- RFID scan refuses these students outright).
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

  -- Today's sheet stamps the real time; a back-dated sheet stamps the séance
  -- start time on that date.
  if v_date = (now() at time zone 'Africa/Algiers')::date then
    v_occurred := now();
  else
    v_occurred := (v_date::text || ' ' || v_session.start_time)::timestamp at time zone 'Africa/Algiers';
  end if;

  begin
    insert into public.attendance (student_id, session_id, occurred_at, amount_deducted, status)
    values (p_student_id, p_session_id, v_occurred, v_cost, p_status);
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
            'Présence: ' || coalesce(v_module_name, 'séance') || ' (' || v_session.start_time || '-' || v_session.end_time || ')'
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
    'messageKey', case
      when v_new_balance < 0 then 'scan.successDebt'
      when p_status = 'late' then 'scan.successLate'
      else 'scan.success'
    end
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. cancel_attendance — refund row now linked to the module too
-- ---------------------------------------------------------------------------
create or replace function public.cancel_attendance(p_attendance_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_role user_role := public.current_role();
  v_att public.attendance%rowtype;
  v_date date;
  v_new_balance int;
  v_module_id uuid;
  v_module_name text;
begin
  if v_role is null or v_role not in ('admin', 'reception') then
    raise exception 'not authorized';
  end if;

  select * into v_att from public.attendance where id = p_attendance_id;
  if not found then
    return jsonb_build_object('ok', false, 'messageKey', 'attendance.notFound');
  end if;

  v_date := (timezone('Africa/Algiers', v_att.occurred_at))::date;

  if v_att.amount_deducted > 0 then
    update public.students set balance = balance + v_att.amount_deducted
      where id = v_att.student_id
      returning balance into v_new_balance;
    select m.id, m.name into v_module_id, v_module_name
    from public.modules m
    join public.sessions se on se.module_id = m.id
    where se.id = v_att.session_id;
    insert into public.balance_tx (student_id, amount, date, type, description, module_id)
    values (v_att.student_id, v_att.amount_deducted, now(), 'topup',
            'Remboursement (Annulation Présence): ' || coalesce(v_module_name, 'séance') || ' du ' || to_char(v_date, 'DD/MM/YYYY'),
            v_module_id);
  end if;

  delete from public.unpaid_teacher_sessions
  where student_id = v_att.student_id
    and session_id = v_att.session_id
    and paid = false
    and (timezone('Africa/Algiers', date))::date = v_date;

  delete from public.attendance where id = p_attendance_id;

  return jsonb_build_object('ok', true, 'refunded', v_att.amount_deducted, 'newBalance', v_new_balance);
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. add_student_balance — spell out the automatic debt settlement
-- ---------------------------------------------------------------------------
create or replace function public.add_student_balance(
  p_student_id uuid,
  p_amount integer,
  p_description text default '',
  p_settle_registration boolean default false
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_role user_role := public.current_role();
  v_student public.students%rowtype;
  v_reg integer := 0;
  v_debt_settled integer := 0;
  v_new_balance integer;
begin
  if v_role is null or v_role not in ('admin', 'reception') then
    raise exception 'not authorized';
  end if;

  select * into v_student from public.students where id = p_student_id;
  if not found then
    raise exception 'student not found';
  end if;

  if p_settle_registration then
    v_reg := coalesce(v_student.registration_due, 0);
  end if;

  -- Balance is a single signed number, so recharging a negative balance
  -- settles the debt first by construction; we compute how much of the
  -- recharge was absorbed by the debt to make it explicit in the history.
  if v_student.balance < 0 then
    v_debt_settled := least(-v_student.balance, greatest(p_amount - v_reg, 0));
  end if;

  update public.students
    set balance = balance + (p_amount - v_reg),
        registration_due = case when v_reg > 0 then 0 else registration_due end
    where id = p_student_id
    returning balance into v_new_balance;

  insert into public.balance_tx (student_id, amount, date, type, description)
  values (p_student_id, p_amount, now(), 'topup',
          coalesce(nullif(p_description, ''), 'Nouveau solde')
          || case when v_debt_settled > 0
               then ' — dette de ' || v_debt_settled || ' DA réglée automatiquement (nouveau solde: ' || v_new_balance || ' DA)'
               else '' end);

  if v_reg > 0 then
    insert into public.balance_tx (student_id, amount, date, type, description)
    values (p_student_id, -v_reg, now(), 'registration', 'Frais d''inscription');
  end if;

  insert into public.cash_transactions (type, amount, date, description)
  values ('student_payment', p_amount, now(), 'Versement ' || v_student.first_name || ' ' || v_student.last_name);

  return jsonb_build_object('ok', true, 'newBalance', v_new_balance, 'debtSettled', v_debt_settled);
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Workers: role column, standalone rows, half-day payment type
-- ---------------------------------------------------------------------------
alter type reception_payment_type add value if not exists 'half_day';

-- Workers may exist WITHOUT a login (role "Ménage" never gets one; the others
-- can skip credentials), so the row can no longer require an auth profile.
do $$ begin
  alter table public.reception_staff drop constraint reception_staff_id_fkey;
exception when undefined_object then null; end $$;

alter table public.reception_staff alter column id set default gen_random_uuid();

alter table public.reception_staff
  add column if not exists role text not null default 'reception';

do $$ begin
  alter table public.reception_staff
    add constraint reception_staff_role_check
    check (role in ('reception', 'security', 'menage')) not valid;
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- 7. Grants (unchanged signatures keep their grants; re-asserted for safety)
-- ---------------------------------------------------------------------------
revoke execute on function public.scan_card(text, timestamptz) from public, anon;
revoke execute on function public.mark_attendance(uuid, uuid, attendance_status, date, boolean, boolean) from public, anon;
revoke execute on function public.cancel_attendance(uuid) from public, anon;
revoke execute on function public.add_student_balance(uuid, integer, text, boolean) from public, anon;

grant execute on function public.scan_card(text, timestamptz) to authenticated;
grant execute on function public.mark_attendance(uuid, uuid, attendance_status, date, boolean, boolean) to authenticated;
grant execute on function public.cancel_attendance(uuid) to authenticated;
grant execute on function public.add_student_balance(uuid, integer, text, boolean) to authenticated;
