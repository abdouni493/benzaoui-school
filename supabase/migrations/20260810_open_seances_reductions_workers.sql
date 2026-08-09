-- =============================================================================
-- Séances libres (créneaux + enseignants passagers), réductions par module,
-- ciblage des annonces par groupe, absences hebdomadaires par module,
-- travailleurs horaires (badge RFID + pointage).
-- Run once against the live project (Supabase Dashboard -> SQL Editor).
--
--   1. student_credentials — mot de passe du portail élève (table SÉPARÉE,
--      lisible par le personnel UNIQUEMENT) pour pouvoir l'imprimer sur le bon.
--   2. student_subscriptions.discount_type/_value — réduction par module
--      (pourcentage ou montant fixe) appliquée par TOUS les calculs de prix.
--   3. sessions.is_open/title/period_*/…_ids/open_price — créneaux "séance
--      libre" (plusieurs classes / groupes / salles, période + jours, tarif).
--   4. teachers sans compte auth (enseignant passager).
--   5. teacher_payments — journal des règlements (fixe ou pourcentage) avec
--      le détail figé pour la réimpression du bon.
--   6. independent_sessions.session_id/created_at/times — une séance libre
--      rattachée à un créneau.
--   7. module_absence_rules — la facturation hebdomadaire d'absence est
--      programmable module par module.
--   8. announcements.target_group_ids/include_parents — ciblage par groupe.
--   9. reception_staff.rfid/hourly_rate + worker_shifts — pointage horaire.
--  10. scan_card / mark_attendance / process_weekly_absences réécrits pour
--      appliquer la réduction de l'élève.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Identifiants portail élève (table séparée, personnel uniquement)
-- ---------------------------------------------------------------------------
create table if not exists public.student_credentials (
  student_id uuid primary key references public.students (id) on delete cascade,
  password text not null default '',
  updated_at timestamptz not null default now()
);

alter table public.student_credentials enable row level security;

-- Volontairement SANS policy "self": ni l'élève, ni son parent, ni son
-- enseignant ne doivent pouvoir relire ce mot de passe.
drop policy if exists student_credentials_staff on public.student_credentials;
create policy student_credentials_staff on public.student_credentials for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

-- ---------------------------------------------------------------------------
-- 2. Réduction par inscription (module) — pourcentage ou montant fixe
-- ---------------------------------------------------------------------------
alter table public.student_subscriptions
  add column if not exists discount_type text,
  add column if not exists discount_value integer not null default 0;

do $$ begin
  alter table public.student_subscriptions
    add constraint student_subscriptions_discount_type_check
    check (discount_type is null or discount_type in ('percent', 'amount')) not valid;
exception when duplicate_object then null; end $$;

-- Prix net d'une séance après réduction (jamais négatif). Utilisé par le scan,
-- la présence manuelle et la facturation d'absence pour que les trois calculs
-- ne puissent pas diverger.
create or replace function public.discounted_price(p_price integer, p_type text, p_value integer)
returns integer
language sql immutable as $$
  select greatest(0, coalesce(p_price, 0) - case
    when p_type = 'percent'
      then round(coalesce(p_price, 0) * least(greatest(coalesce(p_value, 0), 0), 100) / 100.0)::int
    when p_type = 'amount'
      then greatest(coalesce(p_value, 0), 0)
    else 0
  end);
$$;

grant execute on function public.discounted_price(integer, text, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Créneaux "séance libre" sur la table sessions
--    class_id / group_id / salle_id restent la valeur PRINCIPALE (compatibilité
--    avec le scan, les présences et les abonnements) ; les tableaux portent la
--    sélection multiple.
-- ---------------------------------------------------------------------------
alter table public.sessions
  add column if not exists is_open      boolean not null default false,
  add column if not exists title        text,
  add column if not exists period_start date,
  add column if not exists period_end   date,
  add column if not exists class_ids    uuid[] not null default '{}',
  add column if not exists group_ids    uuid[] not null default '{}',
  add column if not exists salle_ids    uuid[] not null default '{}',
  add column if not exists open_price   integer not null default 0;

create index if not exists sessions_is_open_idx on public.sessions (is_open);

-- ---------------------------------------------------------------------------
-- 4. Enseignant passager : pas de compte de connexion
-- ---------------------------------------------------------------------------
do $$ begin
  alter table public.teachers drop constraint teachers_id_fkey;
exception when undefined_object then null; end $$;

alter table public.teachers alter column id set default gen_random_uuid();

alter table public.teachers
  add column if not exists is_passager boolean not null default false;

create index if not exists teachers_is_passager_idx on public.teachers (is_passager);

-- ---------------------------------------------------------------------------
-- 5. Journal des règlements enseignants (fixe / pourcentage) + détail figé
-- ---------------------------------------------------------------------------
create table if not exists public.teacher_payments (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.teachers (id) on delete cascade,
  amount integer not null default 0,
  method text not null default 'fixed',      -- 'fixed' | 'percent'
  percentage integer,
  students_count integer not null default 0,
  sessions_count integer not null default 0,
  description text not null default '',
  -- snapshot des créneaux réglés (date, module, groupe, présents, part) pour
  -- que le bon puisse être réimprimé à l'identique
  details jsonb not null default '[]'::jsonb,
  paid_at timestamptz not null default now()
);

create index if not exists teacher_payments_teacher_id_idx on public.teacher_payments (teacher_id);

alter table public.teacher_payments enable row level security;

drop policy if exists teacher_payments_select on public.teacher_payments;
create policy teacher_payments_select on public.teacher_payments for select to authenticated
  using (public.is_staff() or teacher_id = auth.uid());

drop policy if exists teacher_payments_write on public.teacher_payments;
create policy teacher_payments_write on public.teacher_payments for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

-- ---------------------------------------------------------------------------
-- 6. Séance libre rattachée à un créneau + horodatage de création
-- ---------------------------------------------------------------------------
alter table public.independent_sessions
  add column if not exists session_id uuid references public.sessions (id) on delete set null,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists start_time text,
  add column if not exists end_time   text,
  -- A créneau attended ONLY by passagers has no unpaid_teacher_sessions row
  -- (those are per registered student), so the teacher payout needs its own
  -- "already settled" marker here or the créneau would be payable forever.
  add column if not exists teacher_paid boolean not null default false;

create index if not exists independent_sessions_session_id_idx
  on public.independent_sessions (session_id);

-- ---------------------------------------------------------------------------
-- 7. Facturation hebdomadaire des absences : programmable PAR MODULE
-- ---------------------------------------------------------------------------
create table if not exists public.module_absence_rules (
  module_id uuid primary key references public.modules (id) on delete cascade,
  enabled boolean not null default true,
  days_window integer not null default 7
);

alter table public.module_absence_rules enable row level security;

drop policy if exists module_absence_rules_select on public.module_absence_rules;
create policy module_absence_rules_select on public.module_absence_rules for select to authenticated
  using (true);

drop policy if exists module_absence_rules_write on public.module_absence_rules;
create policy module_absence_rules_write on public.module_absence_rules for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

-- ---------------------------------------------------------------------------
-- 8. Annonces ciblées par groupe (+ parents des élèves de ces groupes)
-- ---------------------------------------------------------------------------
alter table public.announcements
  add column if not exists target_group_ids uuid[] not null default '{}',
  add column if not exists include_parents  boolean not null default true;

-- Les groupes d'un élève, via ses inscriptions.
create or replace function public.student_group_ids(p_student_id uuid)
returns uuid[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct se.group_id), '{}')
  from public.student_subscriptions ss
  join public.subscriptions sub on sub.id = ss.subscription_id
  join public.sessions se       on se.id = sub.session_id
  where ss.student_id = p_student_id;
$$;

grant execute on function public.student_group_ids(uuid) to authenticated;

-- L'utilisateur courant est-il concerné par les groupes ciblés ?
create or replace function public.sees_announcement_groups(p_groups uuid[])
returns boolean
language sql stable security definer set search_path = public as $$
  select
    coalesce(array_length(p_groups, 1), 0) = 0
    or exists (
      -- élève : un de ses groupes est ciblé
      select 1 where public.student_group_ids(auth.uid()) && p_groups
    )
    or exists (
      -- parent : un de ses enfants est dans un groupe ciblé
      select 1 from public.students st
      where st.parent_id = auth.uid()
        and public.student_group_ids(st.id) && p_groups
    )
    or exists (
      -- enseignant : il intervient sur un des groupes ciblés
      select 1 from public.sessions se
      where se.teacher_id = auth.uid() and se.group_id = any (p_groups)
    );
$$;

grant execute on function public.sees_announcement_groups(uuid[]) to authenticated;

drop policy if exists announcements_select on public.announcements;
create policy announcements_select on public.announcements for select to authenticated
  using (
    public.is_staff()
    or (
      public.sees_announcement_groups(target_group_ids)
      and (
        audience = 'all'
        or (audience = 'students' and public.current_role() = 'student')
        or (audience = 'teachers' and public.current_role() = 'teacher')
        or (audience = 'parents'  and public.current_role() = 'parent')
        -- annonce ciblée sur des groupes : les parents des élèves concernés la
        -- voient aussi quand include_parents est actif
        or (include_parents and public.current_role() = 'parent'
            and coalesce(array_length(target_group_ids, 1), 0) > 0)
      )
    )
  );

-- ---------------------------------------------------------------------------
-- 9. Travailleurs : badge RFID, taux horaire, pointage journalier
-- ---------------------------------------------------------------------------
alter type reception_payment_type add value if not exists 'hourly';

alter table public.reception_staff
  add column if not exists rfid        text,
  add column if not exists hourly_rate integer not null default 0;

create unique index if not exists reception_staff_rfid_key
  on public.reception_staff (rfid) where rfid is not null;

create table if not exists public.worker_shifts (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid not null references public.reception_staff (id) on delete cascade,
  work_date date not null,
  start_at timestamptz,
  end_at   timestamptz,
  minutes  integer not null default 0,
  -- true = la journée s'est terminée sans pointage de sortie : les heures ne
  -- sont plus comptées tant que la réception n'a pas corrigé l'heure de fin
  frozen   boolean not null default false,
  paid     boolean not null default false,
  payment_id uuid,
  created_at timestamptz not null default now(),
  unique (worker_id, work_date)
);

create index if not exists worker_shifts_worker_id_idx on public.worker_shifts (worker_id);
create index if not exists worker_shifts_paid_idx      on public.worker_shifts (worker_id, paid);

alter table public.worker_shifts enable row level security;

drop policy if exists worker_shifts_select on public.worker_shifts;
create policy worker_shifts_select on public.worker_shifts for select to authenticated
  using (public.is_staff() or worker_id = auth.uid());

drop policy if exists worker_shifts_write on public.worker_shifts;
create policy worker_shifts_write on public.worker_shifts for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

-- Gèle les journées entamées sans pointage de sortie (jour révolu).
-- Idempotent : appelable à chaque chargement de l'app.
create or replace function public.freeze_open_worker_shifts(p_when timestamptz default now())
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_today date := (p_when at time zone 'Africa/Algiers')::date;
  v_frozen int;
begin
  update public.worker_shifts
     set frozen = true, minutes = 0
   where end_at is null
     and start_at is not null
     and frozen = false
     and work_date < v_today;
  get diagnostics v_frozen = row_count;
  return jsonb_build_object('ok', true, 'frozen', v_frozen);
end;
$$;

revoke execute on function public.freeze_open_worker_shifts(timestamptz) from public, anon;
grant execute on function public.freeze_open_worker_shifts(timestamptz) to authenticated;

-- Badge travailleur : 1er passage = arrivée, 2e = départ (et calcul des minutes).
create or replace function public.scan_worker_card(p_code text, p_when timestamptz default now())
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_role user_role := public.current_role();
  v_worker public.reception_staff%rowtype;
  v_local timestamp := p_when at time zone 'Africa/Algiers';
  v_date date := (p_when at time zone 'Africa/Algiers')::date;
  v_shift public.worker_shifts%rowtype;
  v_minutes int;
begin
  if v_role is null or v_role not in ('admin', 'reception') then
    raise exception 'not authorized to scan worker cards';
  end if;

  select * into v_worker from public.reception_staff
  where rfid is not null and rfid = p_code limit 1;
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

revoke execute on function public.scan_worker_card(text, timestamptz) from public, anon;
grant execute on function public.scan_worker_card(text, timestamptz) to authenticated;

-- Règlement des journées pointées non payées (atomique : les journées passent
-- à payé et ne réapparaissent plus dans l'écran de paiement).
create or replace function public.pay_worker_shifts(
  p_worker_id uuid,
  p_shift_ids uuid[],
  p_amount integer,
  p_description text default ''
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_role user_role := public.current_role();
  v_worker public.reception_staff%rowtype;
  v_payment_id uuid := gen_random_uuid();
  v_count int;
  v_minutes int;
begin
  if v_role is null or v_role not in ('admin', 'reception') then
    raise exception 'not authorized';
  end if;

  select * into v_worker from public.reception_staff where id = p_worker_id;
  if not found then
    return jsonb_build_object('ok', false, 'messageKey', 'worker.notFound');
  end if;

  update public.worker_shifts
     set paid = true, payment_id = v_payment_id
   where worker_id = p_worker_id
     and paid = false
     and frozen = false
     and end_at is not null
     and id = any (p_shift_ids);
  get diagnostics v_count = row_count;

  if v_count = 0 then
    return jsonb_build_object('ok', false, 'messageKey', 'worker.nothingDue');
  end if;

  select coalesce(sum(minutes), 0) into v_minutes
  from public.worker_shifts where payment_id = v_payment_id;

  insert into public.cash_transactions (type, amount, date, description)
  values ('teacher_payment', -greatest(p_amount, 0), now(),
          coalesce(nullif(p_description, ''),
                   'Règlement heures ' || v_worker.first_name || ' ' || v_worker.last_name)
          || ' (' || v_count || ' jour(s), ' || round(v_minutes / 60.0, 2) || ' h)');

  return jsonb_build_object('ok', true, 'paymentId', v_payment_id,
    'days', v_count, 'minutes', v_minutes, 'amount', greatest(p_amount, 0));
end;
$$;

revoke execute on function public.pay_worker_shifts(uuid, uuid[], integer, text) from public, anon;
grant execute on function public.pay_worker_shifts(uuid, uuid[], integer, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 10. Règlement d'un enseignant sur des créneaux précis (passager ou non)
--     Les lignes unpaid_teacher_sessions des créneaux réglés passent à payé,
--     donc l'écran de paiement ne les propose plus jamais.
-- ---------------------------------------------------------------------------
create or replace function public.pay_teacher_sessions(
  p_teacher_id uuid,
  p_keys text[],                      -- 'YYYY-MM-DD|session_uuid'
  p_amount integer,
  p_method text default 'fixed',
  p_percentage integer default null,
  p_details jsonb default '[]'::jsonb,
  p_description text default ''
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_role user_role := public.current_role();
  v_teacher public.teachers%rowtype;
  v_payment_id uuid;
  v_count int := 0;
  v_touched int := 0;
  v_students int := 0;
  v_key text;
  v_date date;
  v_session uuid;
begin
  if v_role is null or v_role not in ('admin', 'reception') then
    raise exception 'not authorized';
  end if;

  select * into v_teacher from public.teachers where id = p_teacher_id;
  if not found then
    return jsonb_build_object('ok', false, 'messageKey', 'pay.teacherNotFound');
  end if;

  foreach v_key in array coalesce(p_keys, '{}') loop
    v_date    := split_part(v_key, '|', 1)::date;
    v_session := nullif(split_part(v_key, '|', 2), '')::uuid;

    -- Registered students of that créneau
    update public.unpaid_teacher_sessions
       set paid = true
     where teacher_id = p_teacher_id
       and paid = false
       and session_id = v_session
       and (timezone('Africa/Algiers', date))::date = v_date;
    get diagnostics v_touched = row_count;

    -- Passagers of the same créneau (séances libres, no student account)
    update public.independent_sessions
       set teacher_paid = true
     where session_id = v_session
       and student_id is null
       and teacher_paid = false
       and date = v_date;
    get diagnostics v_students = row_count;

    if v_touched > 0 or v_students > 0 then
      v_count := v_count + 1;
    end if;
  end loop;

  -- Total presences covered by this settlement, read from the frozen snapshot.
  select coalesce(sum((d ->> 'presents')::int), 0) into v_students
  from jsonb_array_elements(coalesce(p_details, '[]'::jsonb)) d;

  insert into public.teacher_payments
    (teacher_id, amount, method, percentage, students_count, sessions_count, description, details)
  values
    (p_teacher_id, greatest(p_amount, 0), coalesce(p_method, 'fixed'), p_percentage,
     v_students, v_count,
     coalesce(nullif(p_description, ''),
              'Règlement séances ' || v_teacher.first_name || ' ' || v_teacher.last_name),
     coalesce(p_details, '[]'::jsonb))
  returning id into v_payment_id;

  insert into public.cash_transactions (type, amount, date, description)
  values ('teacher_payment', -greatest(p_amount, 0), now(),
          'Règlement séances ' || v_teacher.first_name || ' ' || v_teacher.last_name
          || ' (' || v_count || ' créneau(x))');

  return jsonb_build_object('ok', true, 'paymentId', v_payment_id,
    'sessions', v_count, 'amount', greatest(p_amount, 0));
end;
$$;

revoke execute on function public.pay_teacher_sessions(uuid, text[], integer, text, integer, jsonb, text) from public, anon;
grant execute on function public.pay_teacher_sessions(uuid, text[], integer, text, integer, jsonb, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 11. scan_card — applique la réduction du module et respecte la période des
--     créneaux "séance libre".
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
  c_early_margin constant int := 30;
  c_late_after   constant int := 30;
  c_cooldown_min constant int := 30;
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

  select se.* into v_matched
  from public.sessions se
  where v_today = any (se.days)
    -- un créneau de séance libre n'existe que dans sa période
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

  select m.name into v_module_name from public.modules m where m.id = v_matched.module_id;

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

  -- Prix NET : tarif du créneau (ou de l'inscription équivalente) MOINS la
  -- réduction que la réception a accordée à cet élève sur ce module.
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
            case when v_matched.is_open then 'Séance libre ' else 'Séance ' end
            || coalesce(v_module_name, '') || ' (' || v_matched.start_time || '-' || v_matched.end_time || ')',
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
    'sessionStart', v_matched.start_time,
    'sessionEnd', v_matched.end_time,
    'messageKey', case when v_status = 'late' then 'scan.successLate' else 'scan.success' end
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 12. mark_attendance — même prix net (réduction incluse)
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
-- 13. process_weekly_absences — prix net (réduction) + on/off PAR MODULE
-- ---------------------------------------------------------------------------
create or replace function public.process_weekly_absences(p_when timestamptz default now())
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_role user_role := public.current_role();
  v_today date := (p_when at time zone 'Africa/Algiers')::date;
  v_floor date;
  v_enabled boolean;
  v_last_run date;
  v_charged int := 0;
  v_students int := 0;
  v_prev_student uuid;
  v_enr record;
  v_cost int;
  v_window int;
  v_last_att date;
  v_last_pen date;
  v_anchor date;
  v_period_start date;
  v_period_end date;
  v_pen_id uuid;
  v_new_balance int;
  v_module_name text;
  v_group_name text;
  c_max_weeks constant int := 8;
  v_iter int;
begin
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

  if v_last_run is not null and v_last_run >= v_today then
    return jsonb_build_object('ok', true, 'skipped', true, 'charged', 0, 'students', 0);
  end if;

  for v_enr in
    select ss.student_id,
           ss.subscription_id,
           ss.start_date        as enr_start,
           st.is_free           as is_free,
           st.created_at::date  as student_since,
           -- prix NET de l'élève sur ce module (réduction comprise)
           public.discounted_price(sub.price_per_session, ss.discount_type, ss.discount_value) as price,
           se.id                as session_id,
           se.module_id         as module_id,
           se.class_id          as class_id,
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
    -- Règle désactivée pour CE module : aucune facturation d'absence.
    if not v_enr.rule_enabled then
      continue;
    end if;

    v_cost := case when v_enr.is_free then 0 else coalesce(v_enr.price, 0) end;
    if v_cost <= 0 then
      continue;
    end if;

    v_window := greatest(coalesce(v_enr.rule_window, 7), 1);

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

    v_anchor := greatest(
      v_floor,
      coalesce(v_enr.enr_start, v_floor),
      coalesce(v_enr.student_since, v_floor),
      coalesce(v_last_att, v_floor),
      coalesce(v_last_pen, v_floor)
    );

    v_iter := 0;
    while v_today - v_anchor >= v_window and v_iter < c_max_weeks loop
      v_iter := v_iter + 1;
      v_period_start := v_anchor + 1;
      v_period_end   := v_anchor + v_window;

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
-- 14. Grants (signatures inchangées, ré-affirmés par sécurité)
-- ---------------------------------------------------------------------------
revoke execute on function public.scan_card(text, timestamptz) from public, anon;
revoke execute on function public.mark_attendance(uuid, uuid, attendance_status, date, boolean, boolean) from public, anon;
revoke execute on function public.process_weekly_absences(timestamptz) from public, anon;

grant execute on function public.scan_card(text, timestamptz) to authenticated;
grant execute on function public.mark_attendance(uuid, uuid, attendance_status, date, boolean, boolean) to authenticated;
grant execute on function public.process_weekly_absences(timestamptz) to authenticated;
