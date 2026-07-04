-- =============================================================================
-- Scan / Présences / Paiement enseignants — règles strictes d'emploi du temps
-- Run once against the live project (Supabase Dashboard -> SQL Editor).
--
-- What this migration does:
--   1. Data integrity: one attendance row per student/session/day, non-negative
--      deductions, "HH:mm" time format on sessions, missing indexes.
--   2. scan_card(): full rewrite — the scan is only accepted inside the exact
--      time window of a séance the student is subscribed to ON THAT WEEKDAY
--      ([start - 30min .. end]). Outside it the scan is rejected with a precise
--      reason (no séance today / subscription expired / too early / séance
--      finished => stays absent). Students already in debt are refused entry.
--      A student may cross into debt only once (the scan that empties the
--      balance); after that every scan is blocked until the debt is settled.
--      Teacher percentage dues are recorded per presence, atomically.
--   3. mark_attendance(): manual roll-call marking with the exact same money
--      rules (deduct / refund / debt gate / teacher due), atomic.
--   4. cancel_attendance(): atomic cancel+refund of a presence from history.
--   5. settle_teacher_percentage(): pays ALL unpaid séances of a percentage
--      teacher in one transaction (marks paid, consumes acomptes/absences,
--      writes the cash movement).
--   6. Security hardening: role checks now also reject anonymous callers
--      (current_role() IS NULL previously slipped through "not in" checks).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1a. Deduplicate any historical double-presences (keeps the earliest row per
--     student/session/local day) so the unique index below can be created.
--     NOTE: balances are not retro-corrected here — duplicates are extremely
--     unlikely unless a card was scanned twice in a race.
-- ---------------------------------------------------------------------------
delete from public.attendance a
using public.attendance b
where a.student_id = b.student_id
  and a.session_id = b.session_id
  and (timezone('Africa/Algiers', a.occurred_at))::date
    = (timezone('Africa/Algiers', b.occurred_at))::date
  and (b.occurred_at < a.occurred_at
       or (b.occurred_at = a.occurred_at and b.ctid < a.ctid));

-- One presence per student, per séance, per (local) calendar day — enforced by
-- the database itself, so no client race can double-charge a student.
create unique index if not exists attendance_once_per_day_idx
  on public.attendance (student_id, session_id, ((timezone('Africa/Algiers', occurred_at))::date));

-- ---------------------------------------------------------------------------
-- 1b. Sanity constraints + missing indexes
-- ---------------------------------------------------------------------------
do $$ begin
  alter table public.attendance
    add constraint attendance_amount_nonnegative check (amount_deducted >= 0) not valid;
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.sessions
    add constraint sessions_time_format
    check (start_time ~ '^[0-2][0-9]:[0-5][0-9]$'
       and end_time   ~ '^[0-2][0-9]:[0-5][0-9]$'
       and end_time > start_time) not valid;
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.unpaid_teacher_sessions
    add constraint unpaid_teacher_sessions_amount_nonnegative check (amount >= 0) not valid;
exception when duplicate_object then null; end $$;

create index if not exists unpaid_teacher_sessions_teacher_paid_idx
  on public.unpaid_teacher_sessions (teacher_id, paid);
create index if not exists unpaid_teacher_sessions_session_id_idx
  on public.unpaid_teacher_sessions (session_id);
create index if not exists unpaid_teacher_sessions_student_id_idx
  on public.unpaid_teacher_sessions (student_id);
create index if not exists attendance_occurred_at_idx
  on public.attendance (occurred_at);

-- ---------------------------------------------------------------------------
-- 2a. Helper: "HH:mm" -> minutes since midnight
-- ---------------------------------------------------------------------------
create or replace function public.time_to_minutes(p_time text)
returns integer
language sql immutable as $$
  select split_part(p_time, ':', 1)::int * 60 + split_part(p_time, ':', 2)::int;
$$;

-- ---------------------------------------------------------------------------
-- 2b. scan_card — strict schedule-window scan (atomic)
-- ---------------------------------------------------------------------------
create or replace function public.scan_card(p_code text, p_when timestamptz default now())
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_role user_role := public.current_role();
  v_student public.students%rowtype;
  v_local timestamp;
  v_date date;
  v_today day_of_week;
  v_now_min int;
  v_matched record;
  v_total_today int;
  v_valid_today int;
  v_next_start int;
  v_price int := 0;
  v_cost int;
  v_status attendance_status;
  v_teacher public.teachers%rowtype;
  v_teacher_due int := 0;
  v_new_balance int;
  v_module_name text;
  c_early_margin constant int := 30; -- minutes a student may badge before start
  c_late_after   constant int := 30; -- minutes after start counted as "late"
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

  -- The séance being scanned: scheduled on THIS weekday, the student is
  -- enrolled (enrollment window still valid for formations), and the scan
  -- time falls inside [start - margin .. end]. If two windows overlap, the
  -- séance whose start time is closest to the scan wins.
  select se.*, sub.price_per_session as sub_price
    into v_matched
  from public.sessions se
  join public.subscriptions sub on sub.session_id = se.id
  join public.student_subscriptions ss on ss.subscription_id = sub.id
  where ss.student_id = v_student.id
    and v_today = any (se.days)
    and (ss.start_date  is null or ss.start_date  <= v_date)
    and (ss.expiry_date is null or ss.expiry_date >= v_date)
    and v_now_min >= public.time_to_minutes(se.start_time) - c_early_margin
    and v_now_min <= public.time_to_minutes(se.end_time)
  order by abs(public.time_to_minutes(se.start_time) - v_now_min)
  limit 1;

  if not found then
    -- No window matched: report the precise reason.
    select
      count(*),
      count(*) filter (where (ss.start_date  is null or ss.start_date  <= v_date)
                         and (ss.expiry_date is null or ss.expiry_date >= v_date)),
      min(public.time_to_minutes(se.start_time)) filter (
        where (ss.start_date  is null or ss.start_date  <= v_date)
          and (ss.expiry_date is null or ss.expiry_date >= v_date)
          and public.time_to_minutes(se.start_time) - c_early_margin > v_now_min)
      into v_total_today, v_valid_today, v_next_start
    from public.sessions se
    join public.subscriptions sub on sub.session_id = se.id
    join public.student_subscriptions ss on ss.subscription_id = sub.id
    where ss.student_id = v_student.id
      and v_today = any (se.days);

    if coalesce(v_total_today, 0) = 0 then
      -- e.g. maths is on Monday and today is Sunday -> "no séance today"
      return jsonb_build_object('ok', false, 'studentId', v_student.id,
        'messageKey', 'scan.noSessionToday');
    elsif coalesce(v_valid_today, 0) = 0 then
      return jsonb_build_object('ok', false, 'studentId', v_student.id,
        'messageKey', 'scan.subscriptionExpired');
    elsif v_next_start is not null then
      -- A séance exists later today; badge rejected until its window opens.
      return jsonb_build_object('ok', false, 'studentId', v_student.id,
        'messageKey', 'scan.tooEarly',
        'nextStart', lpad((v_next_start / 60)::text, 2, '0') || ':' || lpad((v_next_start % 60)::text, 2, '0'));
    else
      -- All of today's séances are over: the scan is refused and the student
      -- simply stays absent for them (absent is the default state).
      return jsonb_build_object('ok', false, 'studentId', v_student.id,
        'messageKey', 'scan.sessionEnded');
    end if;
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

  v_price := coalesce(v_matched.sub_price, 0);
  v_cost := case when v_student.is_free then 0 else v_price end;

  -- Debt gate: a student whose balance is already negative may not enter a
  -- paying séance. (The single scan that took the balance below zero was
  -- allowed; every scan after that is refused until the debt is settled.)
  if v_cost > 0 and v_student.balance < 0 then
    return jsonb_build_object('ok', false, 'studentId', v_student.id,
      'sessionId', v_matched.id, 'balance', v_student.balance, 'debt', true,
      'moduleName', v_module_name,
      'sessionStart', v_matched.start_time, 'sessionEnd', v_matched.end_time,
      'messageKey', 'scan.debtBlocked');
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
    insert into public.balance_tx (student_id, amount, date, type, description)
    values (v_student.id, -v_cost, p_when, 'deduction',
            'Séance ' || coalesce(v_module_name, '') || ' (' || v_matched.start_time || '-' || v_matched.end_time || ')');
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
    'debt', v_new_balance < 0,
    'lowBalance', (v_cost > 0 and v_new_balance >= 0 and v_new_balance < v_price * 2),
    'moduleName', v_module_name,
    'sessionStart', v_matched.start_time,
    'sessionEnd', v_matched.end_time,
    'messageKey', case
      when v_new_balance < 0 then 'scan.successDebt'
      when v_status = 'late' then 'scan.successLate'
      else 'scan.success'
    end
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. mark_attendance — manual roll-call marking (atomic, same money rules)
--    p_status 'present'/'late' : deducts once; switching present<->late later
--    only updates the status. p_status 'absent' : refunds the deduction,
--    removes the teacher due and deletes the row (absent = default state).
--    p_allow_debt lets reception explicitly force a presence for a student
--    already in debt (after the on-screen confirmation).
--    p_skip_teacher_due is used when the teacher was flagged absent.
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
      insert into public.balance_tx (student_id, amount, date, type, description)
      values (p_student_id, v_existing.amount_deducted, now(), 'topup',
              'Remboursement absence: ' || coalesce(v_module_name, 'séance') || ' du ' || to_char(v_date, 'DD/MM/YYYY'));
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

  select sub.price_per_session into v_price
  from public.subscriptions sub
  join public.student_subscriptions ss on ss.subscription_id = sub.id
  where sub.session_id = p_session_id
    and ss.student_id = p_student_id
    and (ss.start_date  is null or ss.start_date  <= v_date)
    and (ss.expiry_date is null or ss.expiry_date >= v_date)
  limit 1;
  if not found then
    return jsonb_build_object('ok', false, 'messageKey', 'attendance.notEnrolled');
  end if;

  v_cost := case when v_student.is_free then 0 else coalesce(v_price, 0) end;

  -- Same debt gate as the RFID scan, but reception can force it explicitly.
  if v_cost > 0 and v_student.balance < 0 and not p_allow_debt then
    return jsonb_build_object('ok', false, 'messageKey', 'scan.debtBlocked',
      'balance', v_student.balance, 'debt', true, 'moduleName', v_module_name);
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
    insert into public.balance_tx (student_id, amount, date, type, description)
    values (p_student_id, -v_cost, v_occurred, 'deduction',
            'Présence: ' || coalesce(v_module_name, 'séance') || ' (' || v_session.start_time || '-' || v_session.end_time || ')');
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
-- 4. cancel_attendance — atomic cancel + refund from the history screen
-- ---------------------------------------------------------------------------
create or replace function public.cancel_attendance(p_attendance_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_role user_role := public.current_role();
  v_att public.attendance%rowtype;
  v_date date;
  v_new_balance int;
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
    select m.name into v_module_name
    from public.modules m
    join public.sessions se on se.module_id = m.id
    where se.id = v_att.session_id;
    insert into public.balance_tx (student_id, amount, date, type, description)
    values (v_att.student_id, v_att.amount_deducted, now(), 'topup',
            'Remboursement (Annulation Présence): ' || coalesce(v_module_name, 'séance') || ' du ' || to_char(v_date, 'DD/MM/YYYY'));
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
-- 5. settle_teacher_percentage — pay every unpaid séance in one transaction
-- ---------------------------------------------------------------------------
create or replace function public.settle_teacher_percentage(p_teacher_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_role user_role := public.current_role();
  v_teacher public.teachers%rowtype;
  v_gross int;
  v_count int;
  v_acomptes int;
  v_absences int;
  v_net int;
begin
  if v_role is null or v_role not in ('admin', 'reception') then
    raise exception 'not authorized';
  end if;

  select * into v_teacher from public.teachers where id = p_teacher_id;
  if not found then
    return jsonb_build_object('ok', false, 'messageKey', 'pay.teacherNotFound');
  end if;

  select coalesce(sum(amount), 0), count(*)
    into v_gross, v_count
  from public.unpaid_teacher_sessions
  where teacher_id = p_teacher_id and paid = false;

  select coalesce(sum(amount), 0) into v_acomptes
  from public.teacher_acomptes where staff_id = p_teacher_id;

  select coalesce(sum(cost), 0) into v_absences
  from public.teacher_absences where staff_id = p_teacher_id;

  v_net := v_gross - v_acomptes - v_absences;

  if v_net <= 0 then
    return jsonb_build_object('ok', false, 'messageKey', 'pay.nothingDue',
      'gross', v_gross, 'acomptes', v_acomptes, 'absences', v_absences, 'net', v_net);
  end if;

  update public.unpaid_teacher_sessions set paid = true
  where teacher_id = p_teacher_id and paid = false;

  delete from public.teacher_acomptes where staff_id = p_teacher_id;
  delete from public.teacher_absences where staff_id = p_teacher_id;

  insert into public.cash_transactions (type, amount, date, description)
  values ('teacher_payment', -v_net, now(),
          'Règlement salaire au pourcentage - ' || v_teacher.first_name || ' ' || v_teacher.last_name
          || ' (' || v_count || ' présences, brut ' || v_gross || ' DA, acomptes -' || v_acomptes
          || ' DA, absences -' || v_absences || ' DA)');

  return jsonb_build_object('ok', true, 'net', v_net, 'gross', v_gross,
    'sessions', v_count, 'acomptes', v_acomptes, 'absences', v_absences);
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Grants (and no anonymous execution)
--    NOTE: Postgres grants EXECUTE to PUBLIC by default on new functions, and
--    the original role checks ("v_role not in (...)") silently pass when
--    current_role() is NULL (anonymous). Revoke anon from ALL money RPCs.
-- ---------------------------------------------------------------------------
revoke execute on function public.add_student_balance(uuid, integer, text, boolean) from public, anon;
revoke execute on function public.pay_student_debt(uuid, integer) from public, anon;
revoke execute on function public.scan_card(text, timestamptz) from public, anon;
revoke execute on function public.mark_attendance(uuid, uuid, attendance_status, date, boolean, boolean) from public, anon;
revoke execute on function public.cancel_attendance(uuid) from public, anon;
revoke execute on function public.settle_teacher_percentage(uuid) from public, anon;

grant execute on function public.time_to_minutes(text) to authenticated;
grant execute on function public.scan_card(text, timestamptz) to authenticated;
grant execute on function public.mark_attendance(uuid, uuid, attendance_status, date, boolean, boolean) to authenticated;
grant execute on function public.cancel_attendance(uuid) to authenticated;
grant execute on function public.settle_teacher_percentage(uuid) to authenticated;
