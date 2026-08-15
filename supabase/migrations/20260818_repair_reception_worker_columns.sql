-- =============================================================================
-- Réparation : colonnes "travailleur" manquantes sur reception_staff
-- Run once against the live project (Supabase Dashboard -> SQL Editor).
--
-- Symptôme corrigé :
--   « Could not find the 'role' column of 'reception_staff' in the schema cache »
--   -> POST /api/admin/users renvoie 400 quand on crée un travailleur.
--
-- Cause : la base en ligne n'avait pas reçu les migrations 20260708 (§6, colonne
-- `role`) et 20260810 (§9, `rfid` / `hourly_rate` + `worker_shifts` + pointage).
-- Le code (route.ts, data.ts, AdministrationPage) attend déjà ces colonnes.
--
-- Ce script est IDEMPOTENT : ré-exécutable sans risque même si une partie était
-- déjà appliquée. Il ne fait que remettre reception_staff et le pointage horaire
-- au niveau attendu par l'application.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Types de paiement des travailleurs (demi-journée + horaire)
-- ---------------------------------------------------------------------------
alter type reception_payment_type add value if not exists 'half_day';
alter type reception_payment_type add value if not exists 'hourly';

-- ---------------------------------------------------------------------------
-- 2. reception_staff : rôle métier + badge RFID + taux horaire
--    Un travailleur peut exister SANS compte de connexion (le rôle "Ménage"
--    n'en a jamais ; les autres peuvent aussi être créés sans identifiants),
--    donc l'id n'est plus contraint à un profil d'authentification.
-- ---------------------------------------------------------------------------
do $$ begin
  alter table public.reception_staff drop constraint reception_staff_id_fkey;
exception when undefined_object then null; end $$;

alter table public.reception_staff alter column id set default gen_random_uuid();

alter table public.reception_staff
  add column if not exists role        text not null default 'reception',
  add column if not exists rfid        text,
  add column if not exists hourly_rate integer not null default 0;

do $$ begin
  alter table public.reception_staff
    add constraint reception_staff_role_check
    check (role in ('reception', 'security', 'menage')) not valid;
exception when duplicate_object then null; end $$;

create unique index if not exists reception_staff_rfid_key
  on public.reception_staff (rfid) where rfid is not null;

-- ---------------------------------------------------------------------------
-- 3. Pointage journalier des travailleurs horaires (arrivée / départ)
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- 4. Fonctions de pointage (gel des journées ouvertes, badge, règlement)
--    Copiées à l'identique de 20260810 pour ne pas diverger.
-- ---------------------------------------------------------------------------

-- Gèle les journées entamées sans pointage de sortie (jour révolu).
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

-- Règlement des journées pointées non payées (atomique).
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
