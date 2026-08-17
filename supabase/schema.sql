-- =============================================================================
-- École Privée — Supabase schema
-- Run once, top to bottom, in Supabase Dashboard → SQL Editor, on a fresh project.
-- Project: https://rbcdmwjhnuyrlbgzhimt.supabase.co
--
-- Covers: full relational schema, Supabase Auth wiring (profiles + role tables),
-- Row Level Security for all 5 roles (admin, reception, teacher, student, parent),
-- storage buckets for the school logo + subject images, and atomic RPCs for the
-- money/attendance flows (RFID scan, balance top-up, debt payment).
--
-- No demo/mock content is inserted — only the one bootstrap "school" row the app
-- needs to exist (edit it from Settings → École after login).
-- =============================================================================

create extension if not exists pgcrypto;

-- =============================================================================
-- 1. ENUMS
-- =============================================================================

create type user_role as enum ('admin', 'reception', 'teacher', 'student', 'parent');
create type class_type as enum ('cours', 'formation');
create type cours_level as enum ('primaire', 'moyen', 'lycee');
create type formation_level as enum ('A1', 'A2', 'B1', 'B2', 'C1', 'C2');
create type teacher_payment_type as enum ('monthly', 'percentage');
create type reception_payment_type as enum ('daily', 'monthly');
create type day_of_week as enum ('sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday');
create type balance_tx_type as enum ('topup', 'deduction', 'debt_payment', 'registration');
create type attendance_status as enum ('present', 'late', 'absent');
create type audience_type as enum ('students', 'teachers', 'parents', 'all');
create type cash_tx_type as enum ('deposit', 'withdraw', 'expense', 'student_payment', 'teacher_payment', 'acompte');
create type coursework_type as enum ('single', 'period');

-- =============================================================================
-- 2. TABLES
-- =============================================================================

-- Singleton school/branding record.
create table public.school (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Mon École',
  description text not null default '',
  phone text not null default '',
  email text not null default '',
  logo_url text,
  address text not null default '',
  article_fiscal text,
  registre_commerce text,
  nif text,
  nis text,
  registration_fee integer not null default 0,
  created_at timestamptz not null default now()
);

-- One row per Supabase Auth user (auth.users.id === profiles.id). Source of truth for role.
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role user_role not null,
  full_name text not null,
  email text,
  phone text,
  created_at timestamptz not null default now()
);

-- ---- Catalog / reference tables ----------------------------------------------

create table public.filieres (
  id uuid primary key default gen_random_uuid(),
  name text not null
);

create table public.modules (
  id uuid primary key default gen_random_uuid(),
  name text not null
);

create table public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null
);

create table public.salles (
  id uuid primary key default gen_random_uuid(),
  name text not null
);

create table public.classes (
  id uuid primary key default gen_random_uuid(),
  type class_type not null,
  name text not null,
  description text not null default '',
  cours_level cours_level,
  year text,
  filiere_id uuid references public.filieres (id) on delete set null,
  formation_level formation_level,
  created_at timestamptz not null default now()
);

-- ---- Role-linked entity tables (id === profiles.id === auth.users.id) --------

create table public.teachers (
  id uuid primary key references public.profiles (id) on delete cascade,
  first_name text not null,
  last_name text not null,
  phone text not null default '',
  email text,
  payment_type teacher_payment_type not null,
  monthly_amount integer,
  start_date date,
  percentage integer,
  created_at timestamptz not null default now()
);

create table public.reception_staff (
  id uuid primary key references public.profiles (id) on delete cascade,
  first_name text not null,
  last_name text not null,
  phone text not null default '',
  email text,
  payment_type reception_payment_type not null,
  start_date date not null default current_date,
  salary integer not null default 0,
  created_at timestamptz not null default now()
);

create table public.parents (
  id uuid primary key references public.profiles (id) on delete cascade,
  first_name text not null,
  last_name text not null,
  phone text not null default '',
  email text,
  created_at timestamptz not null default now()
);

create table public.students (
  id uuid primary key references public.profiles (id) on delete cascade,
  first_name text not null,
  last_name text not null,
  birth_date date,
  phone text not null default '',
  email text,
  rfid text unique,
  balance integer not null default 0,
  is_free boolean not null default false,
  parent_id uuid references public.parents (id) on delete set null,
  registration_due integer not null default 0,
  created_at timestamptz not null default now()
);

-- ---- Scheduling ---------------------------------------------------------------

create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes (id) on delete cascade,
  module_id uuid not null references public.modules (id) on delete restrict,
  group_id uuid not null references public.groups (id) on delete restrict,
  salle_id uuid not null references public.salles (id) on delete restrict,
  teacher_id uuid references public.teachers (id) on delete set null,
  days day_of_week[] not null default '{}',
  start_time text not null, -- "HH:mm"
  end_time text not null,   -- "HH:mm"
  created_at timestamptz not null default now()
);

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions (id) on delete cascade,
  price_per_session integer not null default 0,
  -- formation classes are priced per level for a fixed duration (price_per_session stays 0)
  level_price integer,
  period_months integer
);

-- Many-to-many: which students are enrolled in which subscription/session.
-- start/expiry dates only apply to formation subscriptions.
create table public.student_subscriptions (
  student_id uuid not null references public.students (id) on delete cascade,
  subscription_id uuid not null references public.subscriptions (id) on delete cascade,
  start_date date,
  expiry_date date,
  primary key (student_id, subscription_id)
);

-- ---- Money / attendance --------------------------------------------------------

create table public.balance_tx (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students (id) on delete cascade,
  amount integer not null, -- signed
  date timestamptz not null default now(),
  type balance_tx_type not null,
  description text not null default ''
);

create table public.attendance (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students (id) on delete cascade,
  session_id uuid not null references public.sessions (id) on delete cascade,
  occurred_at timestamptz not null default now(),
  amount_deducted integer not null default 0,
  status attendance_status not null
);

-- staff_id covers BOTH teachers.id and reception_staff.id (both === profiles.id),
-- mirroring the original app where reception "acomptes/absences" reuse the same
-- collections as teacher ones.
create table public.unpaid_teacher_sessions (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.teachers (id) on delete cascade,
  session_id uuid not null references public.sessions (id) on delete cascade,
  student_id uuid not null references public.students (id) on delete cascade,
  amount integer not null default 0,
  date timestamptz not null default now(),
  paid boolean not null default false
);

create table public.teacher_acomptes (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.profiles (id) on delete cascade,
  amount integer not null default 0,
  description text not null default '',
  date date not null default current_date
);

create table public.teacher_absences (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.profiles (id) on delete cascade,
  cost integer not null default 0,
  description text not null default '',
  date date not null default current_date
);

-- ---- Content --------------------------------------------------------------------

create table public.subjects (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text not null default '',
  image_url text,
  session_id uuid not null references public.sessions (id) on delete cascade,
  date date not null default current_date
);

create table public.announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text not null default '',
  audience audience_type not null default 'all',
  end_date date,
  date date not null default current_date
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid not null references public.parents (id) on delete cascade,
  title text not null,
  description text not null default '',
  date timestamptz not null default now(),
  read boolean not null default false,
  auto boolean not null default false
);

-- ---- Finance ----------------------------------------------------------------------

create table public.expense_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null
);

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category_id uuid references public.expense_categories (id) on delete set null,
  amount integer not null default 0,
  date date not null default current_date
);

create table public.cash_transactions (
  id uuid primary key default gen_random_uuid(),
  type cash_tx_type not null,
  amount integer not null, -- signed
  date timestamptz not null default now(),
  description text not null default ''
);

create table public.coursework (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type coursework_type not null,
  dates date[] not null default '{}',
  price_per_session integer not null default 0,
  total integer not null default 0,
  teacher_id uuid references public.teachers (id) on delete set null
);

create table public.independent_sessions (
  id uuid primary key default gen_random_uuid(),
  student_id uuid references public.students (id) on delete set null,
  passager_name text,
  item_label text not null,
  price integer not null default 0,
  date date not null default current_date,
  constraint independent_sessions_has_payer check (student_id is not null or passager_name is not null)
);

-- =============================================================================
-- 3. INDEXES
-- =============================================================================

create index students_parent_id_idx on public.students (parent_id);
create index students_rfid_idx on public.students (rfid);
create index sessions_class_id_idx on public.sessions (class_id);
create index sessions_teacher_id_idx on public.sessions (teacher_id);
create index subscriptions_session_id_idx on public.subscriptions (session_id);
create index student_subscriptions_subscription_id_idx on public.student_subscriptions (subscription_id);
create index balance_tx_student_id_idx on public.balance_tx (student_id);
create index attendance_student_id_idx on public.attendance (student_id);
create index attendance_session_id_idx on public.attendance (session_id);
create index unpaid_teacher_sessions_teacher_id_idx on public.unpaid_teacher_sessions (teacher_id);
create index teacher_acomptes_staff_id_idx on public.teacher_acomptes (staff_id);
create index teacher_absences_staff_id_idx on public.teacher_absences (staff_id);
create index subjects_session_id_idx on public.subjects (session_id);
create index notifications_parent_id_idx on public.notifications (parent_id);
create index expenses_category_id_idx on public.expenses (category_id);
create index independent_sessions_student_id_idx on public.independent_sessions (student_id);

-- =============================================================================
-- 4. HELPER FUNCTIONS (used by RLS policies + RPCs)
-- =============================================================================

create or replace function public.current_role()
returns user_role
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid();
$$;

create or replace function public.is_staff()
returns boolean
language sql stable as $$
  select public.current_role() in ('admin', 'reception');
$$;

create or replace function public.is_admin()
returns boolean
language sql stable as $$
  select public.current_role() = 'admin';
$$;

create or replace function public.is_my_child(p_student_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.students where id = p_student_id and parent_id = auth.uid()
  );
$$;

create or replace function public.teaches_student(p_student_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.student_subscriptions ss
    join public.subscriptions sub on sub.id = ss.subscription_id
    join public.sessions se on se.id = sub.session_id
    where ss.student_id = p_student_id and se.teacher_id = auth.uid()
  );
$$;

create or replace function public.teaches_session(p_session_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.sessions where id = p_session_id and teacher_id = auth.uid()
  );
$$;

-- =============================================================================
-- 5. AUTH WIRING — new Supabase Auth user -> profiles row
-- =============================================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, role, full_name, email, phone)
  values (
    new.id,
    coalesce((new.raw_user_meta_data ->> 'role')::user_role, 'student'),
    coalesce(new.raw_user_meta_data ->> 'full_name', new.email),
    new.email,
    new.raw_user_meta_data ->> 'phone'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- =============================================================================
-- 6. DEFENSE-IN-DEPTH TRIGGERS — non-staff cannot self-edit financial fields
-- =============================================================================

create or replace function public.protect_student_financial_fields()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then
    new.balance := old.balance;
    new.is_free := old.is_free;
    new.registration_due := old.registration_due;
    new.rfid := old.rfid;
    new.parent_id := old.parent_id;
  end if;
  return new;
end;
$$;

create trigger trg_protect_student_financial_fields
  before update on public.students
  for each row execute function public.protect_student_financial_fields();

create or replace function public.protect_teacher_payment_fields()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then
    new.payment_type := old.payment_type;
    new.monthly_amount := old.monthly_amount;
    new.percentage := old.percentage;
  end if;
  return new;
end;
$$;

create trigger trg_protect_teacher_payment_fields
  before update on public.teachers
  for each row execute function public.protect_teacher_payment_fields();

create or replace function public.protect_reception_payment_fields()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then
    new.payment_type := old.payment_type;
    new.salary := old.salary;
    new.start_date := old.start_date;
  end if;
  return new;
end;
$$;

create trigger trg_protect_reception_payment_fields
  before update on public.reception_staff
  for each row execute function public.protect_reception_payment_fields();

-- =============================================================================
-- 7. ROW LEVEL SECURITY
-- =============================================================================

alter table public.school enable row level security;
alter table public.profiles enable row level security;
alter table public.filieres enable row level security;
alter table public.modules enable row level security;
alter table public.groups enable row level security;
alter table public.salles enable row level security;
alter table public.classes enable row level security;
alter table public.teachers enable row level security;
alter table public.reception_staff enable row level security;
alter table public.parents enable row level security;
alter table public.students enable row level security;
alter table public.sessions enable row level security;
alter table public.subscriptions enable row level security;
alter table public.student_subscriptions enable row level security;
alter table public.balance_tx enable row level security;
alter table public.attendance enable row level security;
alter table public.unpaid_teacher_sessions enable row level security;
alter table public.teacher_acomptes enable row level security;
alter table public.teacher_absences enable row level security;
alter table public.subjects enable row level security;
alter table public.announcements enable row level security;
alter table public.notifications enable row level security;
alter table public.expense_categories enable row level security;
alter table public.expenses enable row level security;
alter table public.cash_transactions enable row level security;
alter table public.coursework enable row level security;
alter table public.independent_sessions enable row level security;

-- ---- school: publicly readable (branding shows on the pre-login screen too),
-- admin writes ---------------------------------------------------------------

create policy school_select on public.school for select to public using (true);
create policy school_write on public.school for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ---- profiles: self or staff ---------------------------------------------------

create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_staff());
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());

-- ---- catalog tables: all authenticated read, staff write -----------------------

create policy filieres_select on public.filieres for select to authenticated using (true);
create policy filieres_write on public.filieres for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

create policy modules_select on public.modules for select to authenticated using (true);
create policy modules_write on public.modules for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

create policy groups_select on public.groups for select to authenticated using (true);
create policy groups_write on public.groups for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

create policy salles_select on public.salles for select to authenticated using (true);
create policy salles_write on public.salles for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

create policy classes_select on public.classes for select to authenticated using (true);
create policy classes_write on public.classes for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

create policy sessions_select on public.sessions for select to authenticated using (true);
create policy sessions_write on public.sessions for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

create policy subscriptions_select on public.subscriptions for select to authenticated using (true);
create policy subscriptions_write on public.subscriptions for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

create policy student_subscriptions_select on public.student_subscriptions for select to authenticated using (true);
create policy student_subscriptions_write on public.student_subscriptions for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

-- ---- teachers / reception_staff / parents: staff full, self read+limited-write --

create policy teachers_select on public.teachers for select to authenticated
  using (true); -- teacher names/payment info shown across schedules app-wide, matching original app
create policy teachers_insert on public.teachers for insert to authenticated
  with check (public.is_staff());
create policy teachers_update on public.teachers for update to authenticated
  using (public.is_staff() or id = auth.uid())
  with check (public.is_staff() or id = auth.uid());
create policy teachers_delete on public.teachers for delete to authenticated
  using (public.is_staff());

create policy reception_staff_select on public.reception_staff for select to authenticated
  using (public.is_staff() or id = auth.uid());
create policy reception_staff_insert on public.reception_staff for insert to authenticated
  with check (public.is_staff());
create policy reception_staff_update on public.reception_staff for update to authenticated
  using (public.is_staff() or id = auth.uid())
  with check (public.is_staff() or id = auth.uid());
create policy reception_staff_delete on public.reception_staff for delete to authenticated
  using (public.is_staff());

create policy parents_select on public.parents for select to authenticated
  using (public.is_staff() or id = auth.uid() or exists (
    select 1 from public.students st where st.parent_id = parents.id and st.id = auth.uid()
  ));
create policy parents_insert on public.parents for insert to authenticated
  with check (public.is_staff());
create policy parents_update on public.parents for update to authenticated
  using (public.is_staff() or id = auth.uid())
  with check (public.is_staff() or id = auth.uid());
create policy parents_delete on public.parents for delete to authenticated
  using (public.is_staff());

-- ---- students: staff full; self; own parent; own teacher ------------------------

create policy students_select on public.students for select to authenticated
  using (
    public.is_staff()
    or id = auth.uid()
    or parent_id = auth.uid()
    or public.teaches_student(id)
  );
create policy students_insert on public.students for insert to authenticated
  with check (public.is_staff());
create policy students_update on public.students for update to authenticated
  using (public.is_staff() or id = auth.uid())
  with check (public.is_staff() or id = auth.uid());
create policy students_delete on public.students for delete to authenticated
  using (public.is_staff());

-- ---- balance_tx / attendance: staff full; self; own parent; own teacher ---------

create policy balance_tx_select on public.balance_tx for select to authenticated
  using (
    public.is_staff()
    or student_id = auth.uid()
    or public.is_my_child(student_id)
    or public.teaches_student(student_id)
  );
create policy balance_tx_write on public.balance_tx for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

create policy attendance_select on public.attendance for select to authenticated
  using (
    public.is_staff()
    or student_id = auth.uid()
    or public.is_my_child(student_id)
    or public.teaches_session(session_id)
  );
create policy attendance_write on public.attendance for all to authenticated
  using (public.is_staff() or public.teaches_session(session_id))
  with check (public.is_staff() or public.teaches_session(session_id));

-- ---- teacher dues / acomptes / absences: staff full; self (own staff_id) --------

create policy unpaid_teacher_sessions_select on public.unpaid_teacher_sessions for select to authenticated
  using (public.is_staff() or teacher_id = auth.uid());
create policy unpaid_teacher_sessions_write on public.unpaid_teacher_sessions for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

create policy teacher_acomptes_select on public.teacher_acomptes for select to authenticated
  using (public.is_staff() or staff_id = auth.uid());
create policy teacher_acomptes_write on public.teacher_acomptes for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

create policy teacher_absences_select on public.teacher_absences for select to authenticated
  using (public.is_staff() or staff_id = auth.uid());
create policy teacher_absences_write on public.teacher_absences for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

-- ---- subjects: all authenticated read, staff + owning teacher write -------------

create policy subjects_select on public.subjects for select to authenticated using (true);
create policy subjects_write on public.subjects for all to authenticated
  using (public.is_staff() or public.teaches_session(session_id))
  with check (public.is_staff() or public.teaches_session(session_id));

-- ---- announcements: audience-filtered read, staff write --------------------------

create policy announcements_select on public.announcements for select to authenticated
  using (
    public.is_staff()
    or audience = 'all'
    or (audience = 'students' and public.current_role() = 'student')
    or (audience = 'teachers' and public.current_role() = 'teacher')
    or (audience = 'parents' and public.current_role() = 'parent')
  );
create policy announcements_write on public.announcements for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

-- ---- notifications: parent reads/marks-read own, staff full ----------------------

create policy notifications_select on public.notifications for select to authenticated
  using (public.is_staff() or parent_id = auth.uid());
create policy notifications_insert on public.notifications for insert to authenticated
  with check (public.is_staff());
create policy notifications_update on public.notifications for update to authenticated
  using (public.is_staff() or parent_id = auth.uid())
  with check (public.is_staff() or parent_id = auth.uid());
create policy notifications_delete on public.notifications for delete to authenticated
  using (public.is_staff());

-- ---- finance ledger: staff only ---------------------------------------------------

create policy expense_categories_all on public.expense_categories for all to authenticated
  using (public.is_staff()) with check (public.is_staff());
create policy expenses_all on public.expenses for all to authenticated
  using (public.is_staff()) with check (public.is_staff());
create policy cash_transactions_all on public.cash_transactions for all to authenticated
  using (public.is_staff()) with check (public.is_staff());
create policy independent_sessions_all on public.independent_sessions for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

-- ---- coursework: staff full, owning teacher reads --------------------------------

create policy coursework_select on public.coursework for select to authenticated
  using (public.is_staff() or teacher_id = auth.uid());
create policy coursework_write on public.coursework for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

-- =============================================================================
-- 8. RPCs — atomic multi-table money / attendance operations
-- =============================================================================

-- RFID scan: find the student's matching session "now", deduct balance, log
-- attendance + balance_tx + the teacher's unpaid-session due, all atomically.
create or replace function public.scan_card(p_code text, p_when timestamptz default now())
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_role user_role := public.current_role();
  v_student public.students%rowtype;
  v_today day_of_week;
  v_now_min int;
  v_matched public.sessions%rowtype;
  v_price integer;
  v_cost integer;
  v_status attendance_status;
  v_teacher public.teachers%rowtype;
  v_teacher_due integer := 0;
  v_new_balance integer;
  v_module_name text;
  v_start_min int;
  v_end_min int;
begin
  if v_role not in ('admin', 'reception', 'teacher') then
    raise exception 'not authorized to scan cards';
  end if;

  select * into v_student from public.students where rfid = p_code or id::text = p_code limit 1;
  if not found then
    return jsonb_build_object('ok', false, 'messageKey', 'scan.notFound');
  end if;

  v_today := (array['sunday','monday','tuesday','wednesday','thursday','friday','saturday']::day_of_week[])
    [extract(dow from (p_when at time zone 'Africa/Algiers'))::int + 1];
  v_now_min := extract(hour from (p_when at time zone 'Africa/Algiers'))::int * 60 + extract(minute from (p_when at time zone 'Africa/Algiers'))::int;

  select se.* into v_matched
  from public.sessions se
  join public.subscriptions sub on sub.session_id = se.id
  join public.student_subscriptions ss on ss.subscription_id = sub.id
  where ss.student_id = v_student.id
    and v_today = any(se.days)
  order by abs((split_part(se.start_time, ':', 1)::int * 60 + split_part(se.start_time, ':', 2)::int) - v_now_min)
  limit 1;

  if not found then
    return jsonb_build_object('ok', false, 'studentId', v_student.id, 'messageKey', 'scan.noSession');
  end if;

  -- Check if already attended this session today (local calendar day)
  if exists (
    select 1 from public.attendance
    where student_id = v_student.id
      and session_id = v_matched.id
      and occurred_at::date = (p_when at time zone 'Africa/Algiers')::date
  ) then
    return jsonb_build_object(
      'ok', true,
      'studentId', v_student.id,
      'sessionId', v_matched.id,
      'cost', 0,
      'newBalance', v_student.balance,
      'messageKey', 'scan.alreadyPresent'
    );
  end if;

  select price_per_session into v_price from public.subscriptions where session_id = v_matched.id limit 1;
  v_cost := case when v_student.is_free then 0 else coalesce(v_price, 0) end;

  v_start_min := split_part(v_matched.start_time, ':', 1)::int * 60 + split_part(v_matched.start_time, ':', 2)::int;
  v_status := case when v_now_min > v_start_min + 30 then 'late' else 'present' end;

  select * into v_teacher from public.teachers where id = v_matched.teacher_id;
  if v_teacher.payment_type = 'percentage' then
    v_teacher_due := round(v_cost * coalesce(v_teacher.percentage, 0) / 100.0);
  end if;

  v_new_balance := v_student.balance - v_cost;
  update public.students set balance = v_new_balance where id = v_student.id;

  insert into public.attendance (student_id, session_id, occurred_at, amount_deducted, status)
  values (v_student.id, v_matched.id, p_when, v_cost, v_status);

  if v_cost > 0 then
    select m.name into v_module_name from public.modules m where m.id = v_matched.module_id;
    insert into public.balance_tx (student_id, amount, date, type, description)
    values (v_student.id, -v_cost, p_when, 'deduction', 'Séance ' || coalesce(v_module_name, ''));
  end if;

  insert into public.unpaid_teacher_sessions (teacher_id, session_id, student_id, amount, date, paid)
  values (v_matched.teacher_id, v_matched.id, v_student.id, v_teacher_due, p_when, false);

  return jsonb_build_object(
    'ok', true,
    'studentId', v_student.id,
    'sessionId', v_matched.id,
    'cost', v_cost,
    'newBalance', v_new_balance,
    'messageKey', case when v_status = 'late' then 'scan.successLate' else 'scan.success' end
  );
end;
$$;

-- Top up a student's balance; optionally settles the outstanding registration fee
-- first and logs the matching cash-drawer deposit.
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
  v_new_balance integer;
begin
  if v_role not in ('admin', 'reception') then
    raise exception 'not authorized';
  end if;

  select * into v_student from public.students where id = p_student_id;
  if not found then
    raise exception 'student not found';
  end if;

  if p_settle_registration then
    v_reg := coalesce(v_student.registration_due, 0);
  end if;

  update public.students
    set balance = balance + (p_amount - v_reg),
        registration_due = case when v_reg > 0 then 0 else registration_due end
    where id = p_student_id
    returning balance into v_new_balance;

  insert into public.balance_tx (student_id, amount, date, type, description)
  values (p_student_id, p_amount, now(), 'topup', coalesce(nullif(p_description, ''), 'Nouveau solde'));

  if v_reg > 0 then
    insert into public.balance_tx (student_id, amount, date, type, description)
    values (p_student_id, -v_reg, now(), 'registration', 'Frais d''inscription');
  end if;

  insert into public.cash_transactions (type, amount, date, description)
  values ('student_payment', p_amount, now(), 'Versement ' || v_student.first_name || ' ' || v_student.last_name);

  return jsonb_build_object('ok', true, 'newBalance', v_new_balance);
end;
$$;

-- Settle (part of) a negative balance without touching the cash drawer (used for
-- pure debt write-downs, mirrors the original in-app "payDebt" action).
create or replace function public.pay_student_debt(p_student_id uuid, p_amount integer)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_role user_role := public.current_role();
  v_new_balance integer;
begin
  if v_role not in ('admin', 'reception') then
    raise exception 'not authorized';
  end if;

  update public.students set balance = balance + p_amount where id = p_student_id
    returning balance into v_new_balance;
  if not found then
    raise exception 'student not found';
  end if;

  insert into public.balance_tx (student_id, amount, date, type, description)
  values (p_student_id, p_amount, now(), 'debt_payment', 'Règlement de dette');

  return jsonb_build_object('ok', true, 'newBalance', v_new_balance);
end;
$$;

grant execute on function public.scan_card(text, timestamptz) to authenticated;
grant execute on function public.add_student_balance(uuid, integer, text, boolean) to authenticated;
grant execute on function public.pay_student_debt(uuid, integer) to authenticated;

-- =============================================================================
-- 9. STORAGE — buckets for the school logo and subject images
-- =============================================================================

insert into storage.buckets (id, name, public)
values ('logos', 'logos', true)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('subjects', 'subjects', true)
on conflict (id) do nothing;

-- Public read (both buckets are public, so anonymous <img> tags work everywhere,
-- including the pre-login screen which shows the school logo).
create policy logos_public_read on storage.objects for select
  using (bucket_id = 'logos');
create policy subjects_public_read on storage.objects for select
  using (bucket_id = 'subjects');

-- Writes restricted to staff (logo: admin/reception, matches Settings page access;
-- subjects: admin/reception/teacher, matches who can manage course material).
create policy logos_staff_write on storage.objects for insert to authenticated
  with check (bucket_id = 'logos' and public.is_staff());
create policy logos_staff_update on storage.objects for update to authenticated
  using (bucket_id = 'logos' and public.is_staff())
  with check (bucket_id = 'logos' and public.is_staff());
create policy logos_staff_delete on storage.objects for delete to authenticated
  using (bucket_id = 'logos' and public.is_staff());

create policy subjects_staff_write on storage.objects for insert to authenticated
  with check (bucket_id = 'subjects' and (public.is_staff() or public.current_role() = 'teacher'));
create policy subjects_staff_update on storage.objects for update to authenticated
  using (bucket_id = 'subjects' and (public.is_staff() or public.current_role() = 'teacher'))
  with check (bucket_id = 'subjects' and (public.is_staff() or public.current_role() = 'teacher'));
create policy subjects_staff_delete on storage.objects for delete to authenticated
  using (bucket_id = 'subjects' and (public.is_staff() or public.current_role() = 'teacher'));

-- =============================================================================
-- 10. BOOTSTRAP — the one row the app needs to exist (no demo content)
-- =============================================================================

insert into public.school (name, description, phone, email, address, registration_fee)
values ('Mon École', '', '', '', '', 0);

-- =============================================================================
-- Done. Next steps:
--   1. Create your first admin user from the app's login page ("Créer un compte
--      administrateur") — this calls /api/admin/users which needs
--      SUPABASE_SERVICE_ROLE_KEY set in .env.local (see README/setup notes).
--   2. Log in as admin and fill in the school profile + logo under Settings.
-- =============================================================================
