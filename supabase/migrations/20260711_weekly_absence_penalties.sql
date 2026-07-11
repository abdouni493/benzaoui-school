-- =============================================================================
-- Facturation automatique des absences hebdomadaires (par module)
-- Run once against the live project (Supabase Dashboard -> SQL Editor).
--
-- Business rule (client brief):
--   For EACH module a student is enrolled in, count the days since the last
--   time he was marked present on that module (a card scan OR a manual
--   présence). As soon as a full 7-day window has elapsed with NO présence on
--   that module, the module's own séance price is deducted from his balance —
--   only that module, never the ones he did attend. The balance may go into
--   debt (e.g. 300 DA solde, 500 DA module -> -200 DA), and a new window starts
--   so a persistently absent student keeps being billed every 7 days.
--
-- What this migration adds:
--   1. absence_penalties — one row per weekly charge (student + module + the
--      7-day window + amount + resulting balance). This is what the presence
--      history renders; every charge ALSO writes a balance_tx row so it shows
--      up in every transaction list (student file, student profile, parent
--      profile, printed statement) automatically.
--   2. school.absence_penalty_enabled / _since / _last_run — an on/off switch,
--      a "bill from" floor date (so applying this migration does NOT retro-bill
--      months of history), and a once-a-day throttle.
--   3. process_weekly_absences() — the atomic, idempotent RPC that does the
--      billing. Safe to call repeatedly (the app calls it on staff load; an
--      optional pg_cron job runs it nightly).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. School-level controls
-- ---------------------------------------------------------------------------
alter table public.school
  add column if not exists absence_penalty_enabled boolean not null default true;

-- Floor date: absences are only billed for weeks that END on/after this date,
-- so turning the feature on never reaches back over old history. Defaults to
-- the day the migration is applied.
alter table public.school
  add column if not exists absence_penalty_since date;

update public.school set absence_penalty_since = current_date
  where absence_penalty_since is null;

-- Last day the batch actually ran (throttle: at most once per calendar day).
alter table public.school
  add column if not exists absence_penalty_last_run date;

-- ---------------------------------------------------------------------------
-- 2. absence_penalties ledger
-- ---------------------------------------------------------------------------
create table if not exists public.absence_penalties (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students (id) on delete cascade,
  subscription_id uuid references public.subscriptions (id) on delete set null,
  session_id uuid references public.sessions (id) on delete set null,
  module_id uuid references public.modules (id) on delete set null,
  period_start date not null,      -- first day of the absent 7-day window
  period_end date not null,        -- last day of the absent 7-day window
  amount integer not null,         -- deducted from the balance (> 0)
  balance_after integer not null,  -- resulting balance (may be negative = debt)
  created_at timestamptz not null default now()
);

create index if not exists absence_penalties_student_id_idx
  on public.absence_penalties (student_id);
create index if not exists absence_penalties_module_id_idx
  on public.absence_penalties (module_id);

-- One charge per (student, enrollment, week) — the guard that makes the RPC
-- idempotent and safe against two staff sessions triggering it at once.
create unique index if not exists absence_penalties_once_per_week_idx
  on public.absence_penalties (student_id, subscription_id, period_end);

alter table public.absence_penalties enable row level security;

drop policy if exists absence_penalties_select on public.absence_penalties;
create policy absence_penalties_select on public.absence_penalties for select to authenticated
  using (
    public.is_staff()
    or student_id = auth.uid()
    or public.is_my_child(student_id)
    or public.teaches_student(student_id)
  );

-- Writes only happen inside the SECURITY DEFINER RPC, but keep a staff-only
-- policy for any direct correction.
drop policy if exists absence_penalties_write on public.absence_penalties;
create policy absence_penalties_write on public.absence_penalties for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

-- ---------------------------------------------------------------------------
-- 3. process_weekly_absences() — the billing engine
-- ---------------------------------------------------------------------------
-- Runs for every student + every per-séance enrollment. For each, it walks
-- forward 7 days at a time from the later of {the floor date, the enrollment
-- start, the last présence on that module, the last week already billed} and
-- charges one module price per fully-elapsed absent week.
--
-- Concurrency / idempotency: the penalty row is inserted FIRST; a
-- unique_violation means another run already owns that week, so we skip it
-- without touching the balance. The balance is decremented with a relative
-- update (balance - cost), never an absolute set, so parallel runs can't lose
-- each other's writes.
create or replace function public.process_weekly_absences(p_when timestamptz default now())
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_role user_role := public.current_role();
  v_today date := (p_when at time zone 'Africa/Algiers')::date;
  v_floor date;
  v_enabled boolean;
  v_last_run date;
  v_charged int := 0;      -- number of weekly charges written this run
  v_students int := 0;     -- distinct students billed
  v_prev_student uuid;
  v_enr record;
  v_cost int;
  v_last_att date;
  v_last_pen date;
  v_anchor date;
  v_period_start date;
  v_period_end date;
  v_pen_id uuid;
  v_new_balance int;
  v_module_name text;
  v_group_name text;
  c_max_weeks constant int := 8; -- cap catch-up per enrollment per run
  v_iter int;
begin
  -- Web callers must be staff. A NULL role means a trusted server/cron context
  -- (auth.uid() is null); anon can't reach here because EXECUTE is revoked from
  -- anon/public below.
  if auth.uid() is not null and (v_role is null or v_role not in ('admin', 'reception')) then
    raise exception 'not authorized';
  end if;

  select coalesce(absence_penalty_enabled, true),
         coalesce(absence_penalty_since, v_today),
         absence_penalty_last_run
    into v_enabled, v_floor, v_last_run
  from public.school
  limit 1;

  if not coalesce(v_enabled, true) then
    return jsonb_build_object('ok', true, 'enabled', false, 'charged', 0, 'students', 0);
  end if;

  -- Once-a-day throttle: skip if today's batch already ran.
  if v_last_run is not null and v_last_run >= v_today then
    return jsonb_build_object('ok', true, 'skipped', true, 'charged', 0, 'students', 0);
  end if;

  -- Every per-séance enrollment (subscriptions with a real price; formations
  -- are level-priced with price_per_session = 0 and are naturally skipped).
  for v_enr in
    select ss.student_id,
           ss.subscription_id,
           ss.start_date        as enr_start,
           st.is_free           as is_free,
           st.created_at::date  as student_since,
           sub.price_per_session as price,
           se.id                as session_id,
           se.module_id         as module_id,
           se.class_id          as class_id
    from public.student_subscriptions ss
    join public.students st       on st.id = ss.student_id
    join public.subscriptions sub on sub.id = ss.subscription_id
    join public.sessions se       on se.id = sub.session_id
    where coalesce(sub.price_per_session, 0) > 0
    order by ss.student_id
  loop
    v_cost := case when v_enr.is_free then 0 else coalesce(v_enr.price, 0) end;
    if v_cost <= 0 then
      continue;
    end if;

    -- Last présence on THIS module + class level (any group counts, matching
    -- the open-scan eligibility rules).
    select max((timezone('Africa/Algiers', a.occurred_at))::date)
      into v_last_att
    from public.attendance a
    join public.sessions ase on ase.id = a.session_id
    where a.student_id = v_enr.student_id
      and ase.module_id = v_enr.module_id
      and ase.class_id  = v_enr.class_id
      and a.status in ('present', 'late');

    -- Last week already billed for this exact enrollment.
    select max(period_end) into v_last_pen
    from public.absence_penalties
    where student_id = v_enr.student_id
      and subscription_id = v_enr.subscription_id;

    -- Start counting from the latest meaningful point, but never before the
    -- floor date (so enabling the feature can't retro-bill old history).
    v_anchor := greatest(
      v_floor,
      coalesce(v_enr.enr_start, v_floor),
      coalesce(v_enr.student_since, v_floor),
      coalesce(v_last_att, v_floor),
      coalesce(v_last_pen, v_floor)
    );

    v_iter := 0;
    while v_today - v_anchor >= 7 and v_iter < c_max_weeks loop
      v_iter := v_iter + 1;
      v_period_start := v_anchor + 1;
      v_period_end   := v_anchor + 7;

      -- Claim this week (unique index). If another run already billed it, skip
      -- without deducting.
      begin
        insert into public.absence_penalties
          (student_id, subscription_id, session_id, module_id,
           period_start, period_end, amount, balance_after)
        values
          (v_enr.student_id, v_enr.subscription_id, v_enr.session_id, v_enr.module_id,
           v_period_start, v_period_end, v_cost, 0)
        returning id into v_pen_id;
      exception when unique_violation then
        v_anchor := v_anchor + 7;
        continue;
      end;

      -- We own the week: deduct (relative update, debt allowed) and record.
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
      v_anchor := v_anchor + 7;
    end loop;
  end loop;

  update public.school set absence_penalty_last_run = v_today;

  return jsonb_build_object('ok', true, 'enabled', true, 'charged', v_charged, 'students', v_students);
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Grants — staff (authenticated) only; cron/postgres bypasses grants.
-- ---------------------------------------------------------------------------
revoke execute on function public.process_weekly_absences(timestamptz) from public, anon;
grant execute on function public.process_weekly_absences(timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Optional automation — nightly pg_cron run (only if the extension exists).
--    Enable pg_cron from Dashboard -> Database -> Extensions to activate it;
--    otherwise the app's on-load catch-up covers the billing.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'weekly-absence-penalties') then
      perform cron.unschedule('weekly-absence-penalties');
    end if;
    perform cron.schedule(
      'weekly-absence-penalties',
      '5 0 * * *',
      'select public.process_weekly_absences();'
    );
  end if;
exception when others then
  -- pg_cron not available / not permitted here: ignore, the app fallback runs.
  null;
end $$;
