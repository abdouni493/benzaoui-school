-- =====================================================================
-- Benzaoui School — FULL DATABASE SCHEMA (structure only, no data)
-- Generated 2026-10-29 from the live project with pg_dump (Postgres 17).
-- Contents: 41 tables, 85 functions, 78 triggers, 106 indexes,
--           83 RLS policies, grants/revokes, storage buckets + policies,
--           and the auth.users -> profiles trigger.
--
-- Run it on an EMPTY Supabase project (SQL editor or psql).
-- To also move the data, follow RESTORE.txt in the export folder instead:
-- the data must be loaded BETWEEN the structure and the triggers.
-- =====================================================================

--

--
-- PostgreSQL database dump
--

\restrict 3O8xS8XEghvV4FP1IcUlXGtrUZEqaGbxuheg5RsSoxx2ZdaJ51TpDjaU9s24aHN

-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.11 (Debian 17.11-1.pgdg13+2)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--



--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--



--
-- Name: attendance_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.attendance_status AS ENUM (
    'present',
    'late',
    'absent'
);


--
-- Name: audience_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.audience_type AS ENUM (
    'students',
    'teachers',
    'parents',
    'all'
);


--
-- Name: balance_tx_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.balance_tx_type AS ENUM (
    'topup',
    'deduction',
    'debt_payment',
    'registration'
);


--
-- Name: cash_tx_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.cash_tx_type AS ENUM (
    'deposit',
    'withdraw',
    'expense',
    'student_payment',
    'teacher_payment',
    'acompte'
);


--
-- Name: class_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.class_type AS ENUM (
    'cours',
    'formation'
);


--
-- Name: cours_level; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.cours_level AS ENUM (
    'primaire',
    'moyen',
    'lycee'
);


--
-- Name: coursework_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.coursework_type AS ENUM (
    'single',
    'period'
);


--
-- Name: day_of_week; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.day_of_week AS ENUM (
    'sunday',
    'monday',
    'tuesday',
    'wednesday',
    'thursday',
    'friday',
    'saturday'
);


--
-- Name: formation_level; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.formation_level AS ENUM (
    'A1',
    'A2',
    'B1',
    'B2',
    'C1',
    'C2'
);


--
-- Name: reception_payment_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.reception_payment_type AS ENUM (
    'daily',
    'monthly',
    'hourly',
    'half_day'
);


--
-- Name: teacher_payment_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.teacher_payment_type AS ENUM (
    'monthly',
    'percentage'
);


--
-- Name: user_role; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.user_role AS ENUM (
    'admin',
    'reception',
    'teacher',
    'student',
    'parent'
);


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: free_periods; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.free_periods (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text DEFAULT ''::text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    start_date date NOT NULL,
    end_date date NOT NULL,
    all_classes boolean DEFAULT true NOT NULL,
    class_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL,
    pay_teachers boolean DEFAULT true NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT free_periods_dates_check CHECK ((end_date >= start_date))
);


--
-- Name: active_free_period(uuid[], date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.active_free_period(p_class_ids uuid[], p_date date) RETURNS SETOF public.free_periods
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
  select fp.*
  from public.free_periods fp
  where fp.active
    and p_date >= fp.start_date
    and p_date <= fp.end_date
    and (fp.all_classes or fp.class_ids && coalesce(p_class_ids, '{}'::uuid[]))
  order by fp.start_date desc, fp.created_at desc
  limit 1;
$$;


--
-- Name: add_student_balance(uuid, integer, text, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.add_student_balance(p_student_id uuid, p_amount integer, p_description text DEFAULT ''::text, p_settle_registration boolean DEFAULT false) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: apply_offered_rules(date, date, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.apply_offered_rules(p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date, p_session_id uuid DEFAULT NULL::uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_role user_role := public.current_role();
  v_att record;
  v_module_name text;
  v_group_name text;
  v_presences int := 0;
  v_refunded int := 0;
  v_stamped int := 0;
  v_sync jsonb;
begin
  if v_role is null or v_role not in ('admin', 'reception') then
    raise exception 'not authorized';
  end if;

  for v_att in
    select a.id,
           a.student_id,
           a.amount_deducted,
           a.free_period_id,
           (timezone('Africa/Algiers', a.occurred_at))::date as day,
           r.free_period_id as rule_period,
           se.module_id,
           se.group_id,
           st.is_free as student_free
      from public.attendance a
      join public.sessions se on se.id = a.session_id
      join public.students st on st.id = a.student_id
      join lateral public.offered_rule(
        a.session_id, (timezone('Africa/Algiers', a.occurred_at))::date) r on true
     where r.offered
       and (p_from is null or (timezone('Africa/Algiers', a.occurred_at))::date >= p_from)
       and (p_to   is null or (timezone('Africa/Algiers', a.occurred_at))::date <= p_to)
       and (p_session_id is null
            or a.session_id in (select sib from public.sibling_session_ids(p_session_id) as t(sib)))
     order by a.occurred_at
  loop
    if v_att.amount_deducted > 0 then
      select m.name into v_module_name from public.modules m where m.id = v_att.module_id;
      select g.name into v_group_name from public.groups g where g.id = v_att.group_id;

      update public.students set balance = balance + v_att.amount_deducted
       where id = v_att.student_id;

      insert into public.balance_tx (student_id, amount, date, type, description, module_id)
      values (v_att.student_id, v_att.amount_deducted, now(), 'topup',
              'Séance offerte — remboursement: ' || coalesce(v_module_name, 'séance')
                || coalesce(' (' || v_group_name || ')', '')
                || ' du ' || to_char(v_att.day, 'DD/MM/YYYY'),
              v_att.module_id);

      -- L'élève gratuit n'a par définition rien coûté à l'école : son
      -- waived_amount reste à 0, exactement comme au moment du scan.
      update public.attendance
         set amount_deducted = 0,
             waived_amount = case
               when v_att.student_free then coalesce(waived_amount, 0)
               else greatest(coalesce(waived_amount, 0), v_att.amount_deducted)
             end,
             free_period_id = coalesce(free_period_id, v_att.rule_period)
       where id = v_att.id;

      v_presences := v_presences + 1;
      v_refunded  := v_refunded + v_att.amount_deducted;

    elsif v_att.rule_period is not null and v_att.free_period_id is null then
      -- Rien n'avait été débité, mais la présence ne disait pas QUI l'avait
      -- offerte : sans ce rattachement elle manquait au coût de la période.
      update public.attendance set free_period_id = v_att.rule_period where id = v_att.id;
      v_stamped := v_stamped + 1;
    end if;
  end loop;

  v_sync := public.sync_teacher_dues(p_session_id, p_from);

  return jsonb_build_object(
    'ok', true,
    'presences', v_presences,
    'refunded', v_refunded,
    'stamped', v_stamped,
    'duesRemoved', (v_sync ->> 'removed')::int,
    'duesUpdated', (v_sync ->> 'updated')::int);
end;
$$;


--
-- Name: attends_private_session(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.attends_private_session(p_session_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists (select 1 from public.private_sessions s
                 where s.id = p_session_id
                   and (s.student_id = auth.uid() or public.is_my_child(s.student_id)))
  or exists (select 1 from public.private_session_students ps
             where ps.private_session_id = p_session_id
               and (ps.student_id = auth.uid() or public.is_my_child(ps.student_id)));
$$;


--
-- Name: birthday_key(date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.birthday_key(d date) RETURNS text
    LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
    AS $$
  select lpad(extract(month from d)::int::text, 2, '0')
      || '-'
      || lpad(extract(day   from d)::int::text, 2, '0');
$$;


--
-- Name: FUNCTION birthday_key(d date); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.birthday_key(d date) IS 'Jour et mois d''une date, "MM-DD". Clé de rapprochement des anniversaires.';


--
-- Name: birthday_on_year(date, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.birthday_on_year(d date, p_year integer) RETURNS date
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
    AS $$
  select case
    when d is null or p_year is null then null
    -- 29 février d'une année sans 29 février : fêté le 28.
    when public.birthday_key(d) = '02-29'
     and not (
       (p_year % 4 = 0 and p_year % 100 <> 0) or p_year % 400 = 0
     )
      then make_date(p_year, 2, 28)
    else make_date(p_year, extract(month from d)::int, extract(day from d)::int)
  end;
$$;


--
-- Name: FUNCTION birthday_on_year(d date, p_year integer); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.birthday_on_year(d date, p_year integer) IS 'Date à laquelle cet anniversaire se fête l''année donnée (29/02 -> 28/02 hors année bissextile).';


--
-- Name: birthdays_on(date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.birthdays_on(p_date date DEFAULT NULL::date) RETURNS TABLE(student_id uuid, first_name text, last_name text, birth_date date, age integer, phone text, expected boolean, session_id uuid, session_label text, start_time text, end_time text, salle_name text, teacher_name text)
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
  with params as (
    -- Le jour observé, en heure d'Alger quand l'appelant n'en impose pas un.
    select coalesce(p_date, (now() at time zone 'Africa/Algiers')::date) as day_date
  ),
  ctx as (
    select
      day_date,
      extract(year from day_date)::int as day_year,
      (array['sunday','monday','tuesday','wednesday','thursday','friday','saturday']::day_of_week[])
        [extract(dow from day_date)::int + 1] as week_day
    from params
  ),
  celebrating as (
    select st.*, ctx.day_date, ctx.week_day
    from public.students st
    cross join ctx
    where st.birth_date is not null
      and public.birthday_on_year(st.birth_date, ctx.day_year) = ctx.day_date
  ),
  -- Les séances de l'élève réellement posées ce jour-là : le bon jour de
  -- semaine, et pour une séance libre, dans sa période de dates.
  mine as (
    select
      c.id as student_id,
      se.id as session_id,
      coalesce(nullif(se.title, ''), m.name) as session_label,
      se.start_time,
      se.end_time,
      sa.name as salle_name,
      nullif(trim(coalesce(t.first_name, '') || ' ' || coalesce(t.last_name, '')), '') as teacher_name
    from celebrating c
    join public.student_subscriptions ss on ss.student_id = c.id
    join public.subscriptions sub        on sub.id = ss.subscription_id
    join public.sessions se              on se.id = sub.session_id
    left join public.modules m           on m.id = se.module_id
    left join public.salles sa           on sa.id = se.salle_id
    left join public.teachers t          on t.id = se.teacher_id
    where c.week_day = any(se.days)
      and (se.period_start is null or se.period_start <= c.day_date)
      and (se.period_end   is null or se.period_end   >= c.day_date)
  )
  select
    c.id,
    c.first_name,
    c.last_name,
    c.birth_date,
    (extract(year from c.day_date)::int - extract(year from c.birth_date)::int) as age,
    c.phone,
    (mine.session_id is not null) as expected,
    mine.session_id,
    mine.session_label,
    mine.start_time,
    mine.end_time,
    mine.salle_name,
    mine.teacher_name
  from celebrating c
  left join mine on mine.student_id = c.id
  order by mine.start_time nulls last, c.first_name, c.last_name;
$$;


--
-- Name: FUNCTION birthdays_on(p_date date); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.birthdays_on(p_date date) IS 'Élèves fêtés une date donnée (aujourd''hui par défaut, heure d''Alger), avec leurs séances du jour. expected = a cours ce jour-là.';


--
-- Name: cancel_attendance(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cancel_attendance(p_attendance_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: charge_student(uuid, integer, text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.charge_student(p_student_id uuid, p_amount integer, p_description text DEFAULT NULL::text, p_module_id uuid DEFAULT NULL::uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_role user_role := public.current_role();
  v_student public.students%rowtype;
  v_amount int := greatest(coalesce(p_amount, 0), 0);
  v_new_balance int;
begin
  if v_role is null or v_role not in ('admin', 'reception') then
    raise exception 'not authorized';
  end if;

  select * into v_student from public.students where id = p_student_id;
  if not found then
    return jsonb_build_object('ok', false, 'messageKey', 'scan.notFound');
  end if;

  if v_amount = 0 or coalesce(v_student.is_free, false) then
    return jsonb_build_object('ok', true, 'cost', 0, 'newBalance', v_student.balance);
  end if;

  update public.students
     set balance = balance - v_amount
   where id = p_student_id
   returning balance into v_new_balance;

  insert into public.balance_tx (student_id, amount, date, type, description, module_id)
  values (p_student_id, -v_amount, now(), 'deduction',
          coalesce(nullif(btrim(p_description), ''), 'Séance')
          || case when v_new_balance < 0
                  then ' — DETTE : ' || (-v_new_balance) || ' DA'
                  else '' end,
          p_module_id);

  return jsonb_build_object('ok', true, 'cost', v_amount, 'newBalance', v_new_balance,
    'debt', v_new_balance < 0);
end;
$$;


--
-- Name: class_peer_ids(uuid[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.class_peer_ids(p_class_ids uuid[]) RETURNS uuid[]
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
  select public.class_peer_ids(p_class_ids, false);
$$;


--
-- Name: FUNCTION class_peer_ids(p_class_ids uuid[]); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.class_peer_ids(p_class_ids uuid[]) IS 'Les classes qui désignent la même population : même niveau, même année, même filière (formations : même niveau).';


--
-- Name: class_peer_ids(uuid[], boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.class_peer_ids(p_class_ids uuid[], p_ignore_filiere boolean) RETURNS uuid[]
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
  select coalesce(array_agg(distinct c.id), '{}'::uuid[])
  from public.classes c
  where exists (
    select 1
    from public.classes p
    where p.id = any (coalesce(p_class_ids, '{}'::uuid[]))
      and (
        c.id = p.id
        or (c.type = 'cours' and p.type = 'cours'
            and c.cours_level is not distinct from p.cours_level
            and coalesce(nullif(btrim(c.year), ''), '') = coalesce(nullif(btrim(p.year), ''), '')
            and (coalesce(p_ignore_filiere, false)
                 or c.filiere_id is not distinct from p.filiere_id))
        or (c.type = 'formation' and p.type = 'formation'
            and c.formation_level is not distinct from p.formation_level)
      )
  );
$$;


--
-- Name: FUNCTION class_peer_ids(p_class_ids uuid[], p_ignore_filiere boolean); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.class_peer_ids(p_class_ids uuid[], p_ignore_filiere boolean) IS 'Les classes qui désignent la même population. La filière compte, sauf sur une séance libre (p_ignore_filiere).';


--
-- Name: complete_private_session(uuid, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.complete_private_session(p_id uuid, p_payload jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_role user_role := public.current_role();
  v_sess public.private_sessions%rowtype;
  v_total int;
  v_mode text := coalesce(nullif(p_payload ->> 'percentageMode', ''), 'teacher');
  v_pct int := least(greatest(coalesce((p_payload ->> 'percentage')::int, 0), 0), 100);
  v_teacher_pct int;
  v_school_pct int;
  v_teacher_share int := 0;
  v_school_share int := 0;
  v_cash int := greatest(coalesce((p_payload ->> 'cashNow')::int, 0), 0);
  v_pay_teachers boolean := coalesce((p_payload ->> 'teacherPaid')::boolean, false);
  v_paid_total int;
  v_name text;
  v_row jsonb;
  v_mod public.private_session_modules%rowtype;
  v_teacher_paid_count int := 0;
  v_res jsonb;
begin
  if v_role is null or v_role not in ('admin', 'reception') then
    raise exception 'not authorized';
  end if;

  select * into v_sess from public.private_sessions where id = p_id;
  if not found then
    return jsonb_build_object('ok', false, 'messageKey', 'particulier.notFound');
  end if;

  -- Le total est éditable à la conclusion : c'est le moment où l'école ajuste
  -- (une heure de moins, un geste commercial). À défaut, celui de la
  -- programmation.
  v_total := greatest(coalesce((p_payload ->> 'totalPrice')::int, v_sess.total_price), 0);

  if v_mode = 'school' then
    v_school_pct := v_pct;
    v_teacher_pct := 100 - v_pct;
  else
    v_teacher_pct := v_pct;
    v_school_pct := 100 - v_pct;
  end if;

  -- Les parts des modules suivent la répartition décidée ici. Un module réglé
  -- d'avance n'est plus touché : son montant est déjà sorti de la caisse.
  update public.private_session_modules m
     set teacher_percentage = v_teacher_pct,
         teacher_amount = round(m.total_price * v_teacher_pct / 100.0)
   where m.private_session_id = p_id
     and m.teacher_paid = false;

  select coalesce(sum(teacher_amount), 0) into v_teacher_share
  from public.private_session_modules where private_session_id = p_id;

  -- La part de l'école est ce qui RESTE une fois l'enseignant payé : la
  -- calculer à part du pourcentage ferait apparaître un dinar d'écart à chaque
  -- arrondi, et c'est le fond de caisse qui ne s'expliquerait plus.
  v_school_share := greatest(v_total - v_teacher_share, 0);

  -- Ce que chaque élève doit et a versé. Passer la liste est facultatif : une
  -- séance à un seul élève n'a rien à répartir.
  if (p_payload -> 'students') is not null
     and jsonb_typeof(p_payload -> 'students') = 'array'
     and jsonb_array_length(p_payload -> 'students') > 0 then
    for v_row in select * from jsonb_array_elements(p_payload -> 'students') loop
      update public.private_session_students
         set total_price = greatest(coalesce((v_row ->> 'totalPrice')::int, total_price), 0),
             paid_amount = greatest(coalesce((v_row ->> 'paidAmount')::int, paid_amount), 0)
       where id = (v_row ->> 'id')::uuid
         and private_session_id = p_id;
    end loop;
  end if;

  -- L'encaissement du jour. Un versement supérieur au reste dû serait de la
  -- monnaie à rendre, pas une avance : on encaisse au plus ce qui reste.
  v_cash := least(v_cash, greatest(v_total - v_sess.paid_amount, 0));
  v_paid_total := least(v_sess.paid_amount + v_cash, v_total);

  update public.private_sessions
     set total_price = v_total,
         paid_amount = v_paid_total,
         school_percentage = v_school_pct,
         teacher_share = v_teacher_share,
         school_share = v_school_share,
         status = 'done',
         completed_at = now()
   where id = p_id;

  select coalesce(s.first_name || ' ' || s.last_name, ps.guest_name, 'Élève')
    into v_name
  from public.private_sessions ps
  left join public.students s on s.id = ps.student_id
  where ps.id = p_id;

  if v_cash > 0 then
    insert into public.cash_transactions (type, amount, date, description)
    values ('student_payment', v_cash, now(),
            'Séance particulière (séance tenue) — ' || v_name);
  end if;

  -- Régler les enseignants dans la foulée. On réutilise le RPC qui le fait
  -- déjà — caisse + historique de l'enseignant — plutôt que d'en écrire une
  -- deuxième version qui finirait par en différer. Un enseignant PASSAGER de
  -- l'occasion (nom seul, pas de fiche) n'a pas d'historique : il n'est pas
  -- réglé ici, et la séance reste signalée jusqu'à ce qu'on le fasse à la main.
  if v_pay_teachers then
    for v_mod in
      select * from public.private_session_modules
       where private_session_id = p_id
         and teacher_paid = false
         and teacher_id is not null
         and teacher_amount > 0
    loop
      v_res := public.pay_private_session_teacher(v_mod.id, v_mod.teacher_amount);
      if coalesce((v_res ->> 'ok')::boolean, false) then
        v_teacher_paid_count := v_teacher_paid_count + 1;
      end if;
    end loop;
  end if;

  return jsonb_build_object(
    'ok', true,
    'total', v_total,
    'paid', v_paid_total,
    'due', greatest(v_total - v_paid_total, 0),
    'teacherShare', v_teacher_share,
    'schoolShare', v_school_share,
    'teacherPercentage', v_teacher_pct,
    'schoolPercentage', v_school_pct,
    'teachersPaid', v_teacher_paid_count);
end;
$$;


--
-- Name: create_private_request(jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_private_request(p_payload jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_role user_role := public.current_role();
  v_id uuid := coalesce(nullif(p_payload ->> 'id', '')::uuid, gen_random_uuid());
  v_students int;
  v_deposit int := greatest(coalesce((p_payload ->> 'depositAmount')::int, 0), 0);
  v_first jsonb;
  v_name text;
  v_recep uuid := nullif(p_payload ->> 'receptionistId', '')::uuid;
begin
  if v_role is null or v_role not in ('admin', 'reception') then
    raise exception 'not authorized';
  end if;

  -- L'élève « principal » reste sur la séance : toute la lecture existante
  -- (cartes, recherche, factures) s'appuie dessus, et une séance à un seul
  -- élève — le cas courant — ne doit rien perdre.
  v_first := coalesce(p_payload -> 'students' -> 0, '{}'::jsonb);

  insert into public.private_sessions
    (id, student_id, guest_name, guest_phone, guest_phone2,
     class_id, year, filiere_id, scheduled_at, notes, status,
     request_date, receptionist_id, receptionist_name, observation, deposit_amount)
  values
    (v_id,
     nullif(v_first ->> 'studentId', '')::uuid,
     nullif(trim(coalesce(v_first ->> 'guestName', '')), ''),
     nullif(v_first ->> 'guestPhone', ''),
     nullif(v_first ->> 'guestPhone2', ''),
     nullif(v_first ->> 'classId', '')::uuid,
     nullif(v_first ->> 'year', ''),
     nullif(v_first ->> 'filiereId', '')::uuid,
     null,
     coalesce(p_payload ->> 'notes', ''),
     'requested',
     coalesce(nullif(p_payload ->> 'requestDate', '')::date,
              (timezone('Africa/Algiers', now()))::date),
     -- Le compte qui saisit est le réceptionniste par défaut ; un administrateur
     -- peut en désigner un autre.
     coalesce(v_recep, auth.uid()),
     nullif(p_payload ->> 'receptionistName', ''),
     coalesce(p_payload ->> 'observation', ''),
     v_deposit);

  v_students := public.write_private_session_students(v_id, p_payload -> 'students');
  if v_students = 0 then
    raise exception 'une séance particulière doit porter au moins un élève';
  end if;

  -- Le versement pris à la demande entre en caisse tout de suite : c'est de
  -- l'argent réellement reçu, il doit apparaître dans le fond de caisse du
  -- jour même si la séance n'est pas encore programmée.
  if v_deposit > 0 then
    select coalesce(s.first_name || ' ' || s.last_name, ps.guest_name, 'Élève')
      into v_name
    from public.private_sessions ps
    left join public.students s on s.id = ps.student_id
    where ps.id = v_id;

    update public.private_sessions set paid_amount = v_deposit where id = v_id;

    insert into public.cash_transactions (type, amount, date, description)
    values ('student_payment', v_deposit, now(),
            'Séance particulière (versement à la demande) — ' || v_name);
  end if;

  return jsonb_build_object('ok', true, 'id', v_id, 'students', v_students, 'deposit', v_deposit);
end;
$$;


--
-- Name: create_private_session(jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_private_session(p_payload jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_role user_role := public.current_role();
  v_id uuid := coalesce(nullif(p_payload ->> 'id', '')::uuid, gen_random_uuid());
  v_total int;
  v_minutes int;
  v_paid int;
  v_name text;
  v_teacher_cost int;
begin
  if v_role is null or v_role not in ('admin', 'reception') then
    raise exception 'not authorized';
  end if;

  insert into public.private_sessions
    (id, student_id, guest_name, guest_phone, guest_phone2,
     class_id, year, filiere_id, scheduled_at, notes)
  values
    (v_id,
     nullif(p_payload ->> 'studentId', '')::uuid,
     nullif(p_payload ->> 'guestName', ''),
     nullif(p_payload ->> 'guestPhone', ''),
     nullif(p_payload ->> 'guestPhone2', ''),
     nullif(p_payload ->> 'classId', '')::uuid,
     nullif(p_payload ->> 'year', ''),
     nullif(p_payload ->> 'filiereId', '')::uuid,
     (p_payload ->> 'scheduledAt')::timestamptz,
     coalesce(p_payload ->> 'notes', ''));

  v_total := public.write_private_session_modules(v_id, p_payload -> 'modules');

  select coalesce(sum(minutes), 0) into v_minutes
  from public.private_session_modules where private_session_id = v_id;

  -- Un versement supérieur au total serait de la monnaie à rendre, pas une
  -- avance : on encaisse au plus ce que la séance coûte.
  v_paid := least(greatest(coalesce((p_payload ->> 'paidAmount')::int, 0), 0), v_total);

  update public.private_sessions
     set total_price = v_total, duration_minutes = v_minutes, paid_amount = v_paid
   where id = v_id;

  select coalesce(s.first_name || ' ' || s.last_name, ps.guest_name, 'Élève')
    into v_name
  from public.private_sessions ps
  left join public.students s on s.id = ps.student_id
  where ps.id = v_id;

  if v_paid > 0 then
    insert into public.cash_transactions (type, amount, date, description)
    values ('student_payment', v_paid, now(), 'Séance particulière — ' || v_name);
  end if;

  -- Les enseignants réglés d'avance : la caisse doit les voir sortir tout de
  -- suite, sinon le fond de caisse du jour est faux.
  select coalesce(sum(teacher_amount), 0) into v_teacher_cost
  from public.private_session_modules
  where private_session_id = v_id and teacher_paid = true;

  if v_teacher_cost > 0 then
    insert into public.cash_transactions (type, amount, date, description)
    values ('teacher_payment', -v_teacher_cost, now(),
            'Séance particulière — part enseignants (' || v_name || ')');
  end if;

  return jsonb_build_object('ok', true, 'id', v_id, 'total', v_total, 'paid', v_paid);
end;
$$;


--
-- Name: current_role(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public."current_role"() RETURNS public.user_role
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select role from public.profiles where id = auth.uid();
$$;


--
-- Name: delete_absence_penalty(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.delete_absence_penalty(p_penalty_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: delete_balance_tx(uuid, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.delete_balance_tx(p_tx_id uuid, p_adjust_cash boolean DEFAULT true) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_role user_role := public.current_role();
  v_tx public.balance_tx%rowtype;
  v_student public.students%rowtype;
  v_new_balance integer;
begin
  if v_role is null or v_role not in ('admin', 'reception') then
    raise exception 'not authorized';
  end if;

  select * into v_tx from public.balance_tx where id = p_tx_id;
  if not found then
    raise exception 'transaction not found';
  end if;

  select * into v_student from public.students where id = v_tx.student_id;
  if not found then
    raise exception 'student not found';
  end if;

  update public.students
    set balance = balance - v_tx.amount
    where id = v_tx.student_id
    returning balance into v_new_balance;

  delete from public.balance_tx where id = p_tx_id;

  if p_adjust_cash and v_tx.type = 'topup' and v_tx.amount <> 0 then
    insert into public.cash_transactions (type, amount, date, description)
    values (
      'student_payment', -v_tx.amount, now(),
      'Annulation versement ' || v_student.first_name || ' ' || v_student.last_name
        || ' (' || v_tx.amount || ' DA)'
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'newBalance', v_new_balance,
    'reverted', v_tx.amount,
    'cashAdjusted', p_adjust_cash and v_tx.type = 'topup' and v_tx.amount <> 0
  );
end;
$$;


--
-- Name: delete_private_session(uuid, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.delete_private_session(p_id uuid, p_force boolean DEFAULT false) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_role user_role := public.current_role();
  v_sess public.private_sessions%rowtype;
  v_teacher_paid int;
begin
  if v_role is null or v_role not in ('admin', 'reception') then
    raise exception 'not authorized';
  end if;

  select * into v_sess from public.private_sessions where id = p_id;
  if not found then
    return jsonb_build_object('ok', false, 'messageKey', 'particulier.notFound');
  end if;

  select count(*) into v_teacher_paid
  from public.private_session_modules
  where private_session_id = p_id and teacher_paid = true;

  if not p_force and (v_sess.paid_amount > 0 or v_teacher_paid > 0) then
    return jsonb_build_object('ok', false, 'messageKey', 'particulier.hasMoney');
  end if;

  delete from public.private_sessions where id = p_id;
  return jsonb_build_object('ok', true);
end;
$$;


--
-- Name: delete_subscription_price(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.delete_subscription_price(p_session_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: delete_teacher_payment(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.delete_teacher_payment(p_payment_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
declare
  v_role user_role := public.current_role();
  v_pay public.teacher_payments%rowtype;
  v_restored int := 0;
  v_touched int := 0;
  v_d jsonb;
  v_date date;
  v_session uuid;
  v_ids uuid[];
begin
  if v_role is null or v_role not in ('admin', 'reception') then
    raise exception 'not authorized';
  end if;

  select * into v_pay from public.teacher_payments where id = p_payment_id;
  if not found then
    return jsonb_build_object('ok', false, 'messageKey', 'pay.notFound');
  end if;

  -- Rendre les créneaux réglés, d'après l'instantané figé du bon.
  for v_d in select value from jsonb_array_elements(coalesce(v_pay.details, '[]'::jsonb)) loop
    v_date    := nullif(v_d ->> 'dateKey', '')::date;
    v_session := nullif(v_d ->> 'sessionId', '')::uuid;

    -- Les séances libres que la ligne a soldées, nommément. Elles sont rendues
    -- même quand la ligne ne porte ni date ni créneau exploitables.
    v_ids := null;
    if (v_d -> 'independentIds') is not null
       and jsonb_typeof(v_d -> 'independentIds') = 'array' then
      select array_agg((value #>> '{}')::uuid)
        into v_ids
      from jsonb_array_elements(v_d -> 'independentIds')
      where (value #>> '{}') ~ '^[0-9a-fA-F-]{36}$';
    end if;

    if v_ids is not null and array_length(v_ids, 1) > 0 then
      update public.independent_sessions
         set teacher_paid = false
       where id = any (v_ids);
    end if;

    if v_date is null or v_session is null then
      continue;
    end if;

    update public.unpaid_teacher_sessions
       set paid = false
     where teacher_id = v_pay.teacher_id
       and paid = true
       and session_id = v_session
       and (timezone('Africa/Algiers', date))::date = v_date;
    get diagnostics v_touched = row_count;
    v_restored := v_restored + v_touched;

    -- Repli pour les règlements écrits avant `independentIds` : on rend les
    -- passagers du créneau-jour, comme avant.
    if v_ids is null then
      update public.independent_sessions
         set teacher_paid = false
       where session_id = v_session
         and student_id is null
         and teacher_paid = true
         and date = v_date;
    end if;
  end loop;

  -- Acomptes et retenues consommés par ce règlement redeviennent exigibles.
  update public.teacher_acomptes set payment_id = null where payment_id = p_payment_id;
  update public.teacher_absences set payment_id = null where payment_id = p_payment_id;

  if v_pay.cash_tx_id is not null then
    delete from public.cash_transactions where id = v_pay.cash_tx_id;
  end if;

  delete from public.teacher_payments where id = p_payment_id;

  return jsonb_build_object('ok', true, 'restored', v_restored, 'amount', v_pay.amount);
end;
$_$;


--
-- Name: delete_unpaid_teacher_sessions(uuid, uuid[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.delete_unpaid_teacher_sessions(p_teacher_id uuid, p_ids uuid[]) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_role user_role := public.current_role();
  v_deleted int := 0;
  v_amount int := 0;
begin
  if v_role is null or v_role not in ('admin', 'reception') then
    raise exception 'not authorized';
  end if;

  select coalesce(sum(amount), 0) into v_amount
  from public.unpaid_teacher_sessions
  where teacher_id = p_teacher_id
    and paid = false
    and id = any (coalesce(p_ids, '{}'::uuid[]));

  delete from public.unpaid_teacher_sessions
  where teacher_id = p_teacher_id
    and paid = false
    and id = any (coalesce(p_ids, '{}'::uuid[]));
  get diagnostics v_deleted = row_count;

  return jsonb_build_object('ok', true, 'deleted', v_deleted, 'amount', v_amount);
end;
$$;


--
-- Name: delete_worker_payment(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.delete_worker_payment(p_payment_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_role user_role := public.current_role();
  v_pay public.worker_payments%rowtype;
  v_restored int := 0;
begin
  if v_role is null or v_role not in ('admin', 'reception') then
    raise exception 'not authorized';
  end if;

  select * into v_pay from public.worker_payments where id = p_payment_id;
  if not found then
    return jsonb_build_object('ok', false, 'messageKey', 'worker.paymentNotFound');
  end if;

  update public.worker_shifts set paid = false, payment_id = null
   where payment_id = p_payment_id;
  get diagnostics v_restored = row_count;

  update public.teacher_acomptes set payment_id = null where payment_id = p_payment_id;
  update public.teacher_absences set payment_id = null where payment_id = p_payment_id;

  if v_pay.cash_tx_id is not null then
    delete from public.cash_transactions where id = v_pay.cash_tx_id;
  end if;

  delete from public.worker_payments where id = p_payment_id;

  return jsonb_build_object('ok', true, 'restored', v_restored, 'amount', v_pay.amount);
end;
$$;


--
-- Name: discounted_price(integer, text, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.discounted_price(p_price integer, p_type text, p_value integer) RETURNS integer
    LANGUAGE sql IMMUTABLE
    AS $$
  select greatest(0, coalesce(p_price, 0) - case
    when p_type = 'percent'
      then round(coalesce(p_price, 0) * least(greatest(coalesce(p_value, 0), 0), 100) / 100.0)::int
    when p_type = 'amount'
      then greatest(coalesce(p_value, 0), 0)
    else 0
  end);
$$;


--
-- Name: end_worker_shift(uuid, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.end_worker_shift(p_worker_id uuid, p_end_at timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_role user_role := public.current_role();
  v_when timestamptz := coalesce(p_end_at, now());
  v_shift public.worker_shifts%rowtype;
  v_minutes int;
begin
  if v_role is null or v_role not in ('admin', 'reception') then
    raise exception 'not authorized';
  end if;

  -- La journée ouverte la plus récente : celle que le travailleur est en train
  -- de faire, ou celle d'hier qu'on n'a jamais clôturée.
  select * into v_shift from public.worker_shifts
  where worker_id = p_worker_id
    and status = 'present'
    and start_at is not null
    and end_at is null
    and paid = false
  order by work_date desc
  limit 1;

  if not found then
    return jsonb_build_object('ok', false, 'messageKey', 'worker.noOpenShift');
  end if;
  if v_when <= v_shift.start_at then
    return jsonb_build_object('ok', false, 'messageKey', 'worker.endBeforeStart');
  end if;

  v_minutes := greatest(0, (extract(epoch from (v_when - v_shift.start_at)) / 60)::int);
  update public.worker_shifts
     set end_at = v_when, minutes = v_minutes, frozen = false, source = 'manual'
   where id = v_shift.id;

  return jsonb_build_object('ok', true, 'minutes', v_minutes, 'messageKey', 'worker.clockOut');
end;
$$;


--
-- Name: free_period_stats(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.free_period_stats(p_free_period_id uuid DEFAULT NULL::uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: freeze_open_worker_shifts(timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.freeze_open_worker_shifts(p_when timestamp with time zone DEFAULT now()) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: handle_new_user(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.handle_new_user() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: is_admin(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_admin() RETURNS boolean
    LANGUAGE sql STABLE
    AS $$
  select public.current_role() = 'admin';
$$;


--
-- Name: is_my_child(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_my_child(p_student_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists (
    select 1 from public.students where id = p_student_id and parent_id = auth.uid()
  );
$$;


--
-- Name: public.is_staff(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_staff() RETURNS boolean
    LANGUAGE sql STABLE
    AS $$
  select public.current_role() in ('admin', 'reception');
$$;


--
-- Name: mark_attendance(uuid, uuid, public.attendance_status, date, boolean, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mark_attendance(p_student_id uuid, p_session_id uuid, p_status public.attendance_status, p_date date DEFAULT NULL::date, p_allow_debt boolean DEFAULT false, p_skip_teacher_due boolean DEFAULT false) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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

  -- >>> LE CHANGEMENT <<<
  -- RATTRAPAGE : RÉSERVÉ AUX SÉANCES LIBRES.
  -- Cette recherche-là trouvait un tarif à l'élève inscrit au MÊME cours dans
  -- un AUTRE groupe. Un tarif trouvé vaut `v_found`, et `v_found` vaut
  -- présence écrite : la saisie manuelle posait donc une présence sur un
  -- créneau qui n'est pas celui de l'élève. Sur un COURS ORDINAIRE elle ne
  -- s'exécute plus. Sur une SÉANCE LIBRE elle est mot pour mot celle d'avant.
  if not v_found and coalesce(v_session.is_open, false) then
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
    -- Aucune inscription sur CE créneau.
    --   · SÉANCE LIBRE : elle reste ouverte à son public, exactement comme
    --     avant — c'est `student_session_rank` qui le lit, et le passager qui
    --     n'a aucune classe entre quand même (`v_session.is_open`).
    --   · COURS ORDINAIRE : `student_session_rank` rend désormais NULL pour
    --     qui n'est pas inscrit dessus. La présence est refusée, et le
    --     guichet lit « pas à son emploi du temps ».
    v_rank := public.student_session_rank(p_student_id, p_session_id, v_date);
    if coalesce(v_session.is_open, false) or v_rank is not null then
      v_price := public.student_session_price(p_student_id, p_session_id, v_date);
      v_enr_start := null;
    else
      return jsonb_build_object('ok', false, 'messageKey', 'attendance.notEnrolled');
    end if;
  end if;

  -- >>> PREMIÈRE SÉANCE OFFICIELLE DU CRÉNEAU <<<
  -- Un emploi du temps peut porter une date de première séance officielle
  -- (`sessions.billing_start_date`). Tant qu'elle n'est pas atteinte, la
  -- séance est enregistrée comme n'importe quelle autre — l'élève est bien
  -- présent — mais RIEN ne descend de son solde. On la traite exactement
  -- comme une date de début d'inscription, en retenant la plus TARDIVE des
  -- deux : la facturation ne peut pas commencer avant que le créneau lui-même
  -- ait officiellement commencé.
  if v_session.billing_start_date is not null
     and (v_enr_start is null or v_session.billing_start_date > v_enr_start) then
    v_enr_start := v_session.billing_start_date;
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


--
-- Name: mark_worker_absences(uuid, date, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mark_worker_absences(p_worker_id uuid DEFAULT NULL::uuid, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_role user_role := public.current_role();
  v_from date;
  v_to date;
  v_day date;
  v_w public.reception_staff%rowtype;
  v_marked int := 0;
  v_workers int := 0;
  v_did boolean;
begin
  if v_role is null or v_role not in ('admin', 'reception') then
    raise exception 'not authorized';
  end if;

  -- Hier au plus tard : une journée en cours n'est pas une absence, elle n'est
  -- simplement pas terminée.
  v_to := least(coalesce(p_to, (timezone('Africa/Algiers', now()))::date - 1),
                (timezone('Africa/Algiers', now()))::date - 1);
  v_from := coalesce(p_from, v_to - 31);

  for v_w in
    select * from public.reception_staff
     where (p_worker_id is null or id = p_worker_id)
       and payment_type = 'monthly'
  loop
    v_did := false;
    v_day := greatest(v_from, coalesce(v_w.pay_start_date, v_w.start_date, v_from));
    while v_day <= v_to loop
      if public.worker_works_on(v_w.id, v_day)
         and not exists (
           select 1 from public.worker_shifts
            where worker_id = v_w.id and work_date = v_day
         )
      then
        insert into public.worker_shifts
          (worker_id, work_date, minutes, frozen, paid, status, source, notes)
        values (v_w.id, v_day, 0, false, false, 'absent', 'auto',
                'Absence relevée automatiquement');
        v_marked := v_marked + 1;
        v_did := true;
      end if;
      v_day := v_day + 1;
    end loop;
    if v_did then v_workers := v_workers + 1; end if;
  end loop;

  return jsonb_build_object('ok', true, 'marked', v_marked, 'workers', v_workers);
end;
$$;


--
-- Name: offered_rule(uuid, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.offered_rule(p_session_id uuid, p_date date) RETURNS TABLE(offered boolean, free_period_id uuid, teacher_earns boolean)
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
  select
    coalesce(se.is_free, false) or fp.id is not null,
    fp.id,
    not coalesce(se.is_free, false) and coalesce(fp.pay_teachers, true)
  from public.sessions se
  left join lateral public.active_free_period(
    array[se.class_id] || coalesce(se.class_ids, '{}'::uuid[]), p_date) fp on true
  where se.id = p_session_id;
$$;


--
-- Name: pay_private_session(uuid, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.pay_private_session(p_id uuid, p_amount integer) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_role user_role := public.current_role();
  v_sess public.private_sessions%rowtype;
  v_take int;
  v_left int;
  v_name text;
  v_stu record;
  v_part int;
begin
  if v_role is null or v_role not in ('admin', 'reception') then
    raise exception 'not authorized';
  end if;

  select * into v_sess from public.private_sessions where id = p_id;
  if not found then
    return jsonb_build_object('ok', false, 'messageKey', 'particulier.notFound');
  end if;

  -- On n'encaisse jamais plus que ce qui reste dû : le surplus serait de la
  -- monnaie à rendre, pas une avance sur une séance déjà soldée.
  v_take := least(greatest(coalesce(p_amount, 0), 0),
                  greatest(v_sess.total_price - v_sess.paid_amount, 0));
  if v_take <= 0 then
    return jsonb_build_object('ok', false, 'messageKey', 'particulier.nothingDue');
  end if;

  update public.private_sessions
     set paid_amount = paid_amount + v_take
   where id = p_id;

  -- Le versement se répartit sur les élèves qui doivent encore, du plus
  -- endetté au moins : sans ça, une séance à plusieurs ne saurait plus qui a
  -- payé quoi.
  v_left := v_take;
  for v_stu in
    select id, greatest(total_price - paid_amount, 0) as due
    from public.private_session_students
    where private_session_id = p_id and total_price > paid_amount
    order by due desc, id
  loop
    exit when v_left <= 0;
    v_part := least(v_left, v_stu.due);
    update public.private_session_students
       set paid_amount = paid_amount + v_part
     where id = v_stu.id;
    v_left := v_left - v_part;
  end loop;

  select coalesce(s.first_name || ' ' || s.last_name, ps.guest_name, 'Élève')
    into v_name
  from public.private_sessions ps
  left join public.students s on s.id = ps.student_id
  where ps.id = p_id;

  insert into public.cash_transactions (type, amount, date, description)
  values ('student_payment', v_take, now(),
          'Séance particulière (règlement) — ' || v_name);

  return jsonb_build_object('ok', true, 'paid', v_take,
    'due', greatest(v_sess.total_price - v_sess.paid_amount - v_take, 0));
end;
$$;


--
-- Name: pay_private_session_teacher(uuid, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.pay_private_session_teacher(p_module_row_id uuid, p_amount integer DEFAULT NULL::integer) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_role user_role := public.current_role();
  v_mod public.private_session_modules%rowtype;
  v_sess public.private_sessions%rowtype;
  v_amount int;
  v_cash_id uuid;
  v_module_name text;
  v_teacher public.teachers%rowtype;
begin
  if v_role is null or v_role not in ('admin', 'reception') then
    raise exception 'not authorized';
  end if;

  select * into v_mod from public.private_session_modules where id = p_module_row_id;
  if not found then
    return jsonb_build_object('ok', false, 'messageKey', 'particulier.notFound');
  end if;
  if v_mod.teacher_paid then
    return jsonb_build_object('ok', false, 'messageKey', 'particulier.teacherAlreadyPaid');
  end if;
  if v_mod.teacher_id is null then
    return jsonb_build_object('ok', false, 'messageKey', 'particulier.noTeacher');
  end if;

  select * into v_sess from public.private_sessions where id = v_mod.private_session_id;
  select * into v_teacher from public.teachers where id = v_mod.teacher_id;
  select name into v_module_name from public.modules where id = v_mod.module_id;

  v_amount := greatest(coalesce(p_amount, v_mod.teacher_amount), 0);
  if v_amount <= 0 then
    return jsonb_build_object('ok', false, 'messageKey', 'particulier.nothingDue');
  end if;

  insert into public.cash_transactions (type, amount, date, description)
  values ('teacher_payment', -v_amount, now(),
          'Séance particulière — ' || coalesce(v_module_name, 'module')
          || ' — ' || coalesce(v_teacher.first_name || ' ' || v_teacher.last_name, 'enseignant'))
  returning id into v_cash_id;

  insert into public.teacher_payments
    (teacher_id, amount, method, percentage, students_count, sessions_count,
     description, details, paid_at, cash_tx_id)
  values
    (v_mod.teacher_id, v_amount, 'fixed', v_mod.teacher_percentage, 1, 1,
     'Séance particulière — ' || coalesce(v_module_name, 'module'),
     jsonb_build_array(jsonb_build_object(
       'dateKey', (timezone('Africa/Algiers', v_sess.scheduled_at))::date,
       'sessionId', v_mod.private_session_id,
       'title', 'Séance particulière — ' || coalesce(v_module_name, 'module'),
       'moduleName', coalesce(v_module_name, 'module'),
       'groupName', 'Particulier',
       'startTime', to_char(timezone('Africa/Algiers', v_sess.scheduled_at), 'HH24:MI'),
       'endTime', to_char(timezone('Africa/Algiers', v_sess.scheduled_at)
                          + make_interval(mins => v_mod.minutes), 'HH24:MI'),
       'presents', 1,
       'passagers', 0,
       'gross', v_mod.total_price,
       'share', v_amount)),
     now(), v_cash_id);

  update public.private_session_modules
     set teacher_paid = true, teacher_paid_at = now(), teacher_amount = v_amount
   where id = p_module_row_id;

  return jsonb_build_object('ok', true, 'amount', v_amount);
end;
$$;


--
-- Name: pay_registration_fee_cash(uuid, integer, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.pay_registration_fee_cash(p_student_id uuid, p_fee integer DEFAULT NULL::integer, p_label text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_role user_role := public.current_role();
  v_student public.students%rowtype;
  v_fee int;
  v_label text;
begin
  if v_role is null or v_role not in ('admin', 'reception') then
    raise exception 'not authorized';
  end if;

  select * into v_student from public.students where id = p_student_id;
  if not found then
    return jsonb_build_object('ok', false, 'messageKey', 'scan.notFound');
  end if;

  v_fee := greatest(coalesce(p_fee, v_student.registration_due, 0), 0);
  if v_fee = 0 then
    return jsonb_build_object('ok', true, 'fee', 0, 'newBalance', v_student.balance,
      'cashed', 0);
  end if;

  v_label := coalesce(nullif(btrim(p_label), ''), 'Frais d''inscription encaissés au guichet');

  -- Le solde n'est PAS touché : seuls les frais dus retombent à zéro.
  update public.students
     set registration_due = greatest(coalesce(registration_due, 0) - v_fee, 0)
   where id = p_student_id;

  insert into public.balance_tx (student_id, amount, date, type, description)
  values (p_student_id, v_fee, now(), 'topup',
          v_label || ' — ' || v_fee || ' DA reçus (le solde n''est pas modifié)');

  insert into public.balance_tx (student_id, amount, date, type, description)
  values (p_student_id, -v_fee, now(), 'registration', v_label);

  insert into public.cash_transactions (type, amount, date, description)
  values ('student_payment', v_fee, now(),
          'Frais d''inscription ' || v_student.first_name || ' ' || v_student.last_name);

  return jsonb_build_object('ok', true, 'fee', v_fee,
    'newBalance', v_student.balance, 'cashed', v_fee);
end;
$$;


--
-- Name: FUNCTION pay_registration_fee_cash(p_student_id uuid, p_fee integer, p_label text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.pay_registration_fee_cash(p_student_id uuid, p_fee integer, p_label text) IS 'Encaisse les frais d''inscription À PART : la caisse les reçoit, le solde de l''élève ne bouge pas.';


--
-- Name: pay_student_debt(uuid, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.pay_student_debt(p_student_id uuid, p_amount integer) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_role user_role := public.current_role();
  v_student public.students%rowtype;
  v_amount int := greatest(coalesce(p_amount, 0), 0);
  v_reg_paid int := 0;
  v_debt_paid int := 0;
  v_credited int := 0;
  v_new_balance int;
begin
  if v_role is null or v_role not in ('admin', 'reception') then
    raise exception 'not authorized';
  end if;

  select * into v_student from public.students where id = p_student_id;
  if not found then
    raise exception 'student not found';
  end if;
  if v_amount = 0 then
    return jsonb_build_object('ok', true, 'newBalance', v_student.balance,
      'registrationPaid', 0, 'debtPaid', 0, 'credited', 0);
  end if;

  v_reg_paid  := least(coalesce(v_student.registration_due, 0), v_amount);
  v_debt_paid := least(greatest(-v_student.balance, 0), v_amount - v_reg_paid);
  v_credited  := v_amount - v_reg_paid - v_debt_paid;

  update public.students
     set balance = balance + (v_amount - v_reg_paid),
         registration_due = coalesce(registration_due, 0) - v_reg_paid
   where id = p_student_id
   returning balance into v_new_balance;

  -- La ligne porte le montant REÇU en entier, et la ligne d'inscription reprend
  -- sa part : leur somme vaut exactement le déplacement du solde, sans quoi
  -- l'historique et le solde divergent de la valeur des frais.
  insert into public.balance_tx (student_id, amount, date, type, description)
  values (p_student_id, v_amount, now(), 'debt_payment',
          'Règlement de dette — ' || v_amount || ' DA reçus'
          || case when v_reg_paid  > 0 then ', dont ' || v_reg_paid  || ' DA d''inscription' else '' end
          || case when v_debt_paid > 0 then ', ' || v_debt_paid || ' DA de séances suivies' else '' end
          || case when v_credited  > 0 then ', ' || v_credited  || ' DA portés au solde' else '' end
          || ' (nouveau solde : ' || v_new_balance || ' DA)');

  if v_reg_paid > 0 then
    insert into public.balance_tx (student_id, amount, date, type, description)
    values (p_student_id, -v_reg_paid, now(), 'registration',
            'Frais d''inscription réglés sur le versement de dette');
  end if;

  insert into public.cash_transactions (type, amount, date, description)
  values ('student_payment', v_amount, now(),
          'Règlement de dette ' || v_student.first_name || ' ' || v_student.last_name);

  return jsonb_build_object('ok', true, 'newBalance', v_new_balance,
    'registrationPaid', v_reg_paid, 'debtPaid', v_debt_paid, 'credited', v_credited);
end;
$$;


--
-- Name: pay_teacher_sessions(uuid, text[], integer, text, integer, jsonb, text, uuid[], uuid[], boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.pay_teacher_sessions(p_teacher_id uuid, p_keys text[], p_amount integer, p_method text DEFAULT 'fixed'::text, p_percentage integer DEFAULT NULL::integer, p_details jsonb DEFAULT '[]'::jsonb, p_description text DEFAULT ''::text, p_acompte_ids uuid[] DEFAULT NULL::uuid[], p_absence_ids uuid[] DEFAULT NULL::uuid[], p_settle_deductions boolean DEFAULT false) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_role user_role := public.current_role();
  v_teacher public.teachers%rowtype;
  v_payment_id uuid;
  v_cash_id uuid;
  v_count int := 0;
  v_touched int := 0;
  v_students int := 0;
  v_presences int := 0;
  v_acomptes int := 0;
  v_absences int := 0;
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

    -- Élèves inscrits de ce créneau
    update public.unpaid_teacher_sessions
       set paid = true
     where teacher_id = p_teacher_id
       and paid = false
       and session_id = v_session
       and (timezone('Africa/Algiers', date))::date = v_date;
    get diagnostics v_touched = row_count;

    -- Passagers du même créneau (séances libres, sans compte élève)
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

  -- Présences couvertes par ce règlement, lues dans l'instantané figé.
  select coalesce(sum((d ->> 'presents')::int), 0) into v_presences
  from jsonb_array_elements(coalesce(p_details, '[]'::jsonb)) d;

  insert into public.teacher_payments
    (teacher_id, amount, method, percentage, students_count, sessions_count, description, details)
  values
    (p_teacher_id, greatest(p_amount, 0), coalesce(p_method, 'fixed'), p_percentage,
     v_presences, v_count,
     coalesce(nullif(p_description, ''),
              'Règlement séances ' || v_teacher.first_name || ' ' || v_teacher.last_name),
     coalesce(p_details, '[]'::jsonb))
  returning id into v_payment_id;

  -- Acomptes et retenues : rattachés au règlement au lieu d'être supprimés,
  -- pour qu'annuler le règlement les rende à nouveau exigibles.
  if p_settle_deductions then
    update public.teacher_acomptes
       set payment_id = v_payment_id
     where staff_id = p_teacher_id
       and payment_id is null
       and (p_acompte_ids is null or id = any (p_acompte_ids));
    get diagnostics v_acomptes = row_count;

    update public.teacher_absences
       set payment_id = v_payment_id
     where staff_id = p_teacher_id
       and payment_id is null
       and (p_absence_ids is null or id = any (p_absence_ids));
    get diagnostics v_absences = row_count;
  end if;

  insert into public.cash_transactions (type, amount, date, description)
  values ('teacher_payment', -greatest(p_amount, 0), now(),
          'Règlement séances ' || v_teacher.first_name || ' ' || v_teacher.last_name
          || ' (' || v_count || ' créneau(x))')
  returning id into v_cash_id;

  update public.teacher_payments set cash_tx_id = v_cash_id where id = v_payment_id;

  return jsonb_build_object('ok', true, 'paymentId', v_payment_id,
    'sessions', v_count, 'amount', greatest(p_amount, 0),
    'acomptes', v_acomptes, 'absences', v_absences);
end;
$$;


--
-- Name: pay_teacher_sessions(uuid, text[], integer, text, integer, jsonb, text, uuid[], uuid[], boolean, uuid[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.pay_teacher_sessions(p_teacher_id uuid, p_keys text[], p_amount integer, p_method text DEFAULT 'fixed'::text, p_percentage integer DEFAULT NULL::integer, p_details jsonb DEFAULT '[]'::jsonb, p_description text DEFAULT ''::text, p_acompte_ids uuid[] DEFAULT NULL::uuid[], p_absence_ids uuid[] DEFAULT NULL::uuid[], p_settle_deductions boolean DEFAULT false, p_independent_ids uuid[] DEFAULT NULL::uuid[]) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_role user_role := public.current_role();
  v_teacher public.teachers%rowtype;
  v_payment_id uuid;
  v_cash_id uuid;
  v_count int := 0;
  v_touched int := 0;
  v_passagers int := 0;
  v_free int := 0;
  v_presences int := 0;
  v_acomptes int := 0;
  v_absences int := 0;
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

    -- Élèves inscrits de ce créneau
    update public.unpaid_teacher_sessions
       set paid = true
     where teacher_id = p_teacher_id
       and paid = false
       and session_id = v_session
       and (timezone('Africa/Algiers', date))::date = v_date;
    get diagnostics v_touched = row_count;

    -- Passagers du même créneau, quand l'appelant n'a pas fourni la liste
    -- exacte. On garde ce chemin pour les appels qui ne connaissent pas encore
    -- `p_independent_ids` : sans lui, ils ne solderaient plus rien.
    if p_independent_ids is null then
      update public.independent_sessions
         set teacher_paid = true
       where session_id = v_session
         and student_id is null
         and teacher_paid = false
         and date = v_date;
      get diagnostics v_passagers = row_count;
    else
      v_passagers := 0;
    end if;

    if v_touched > 0 or v_passagers > 0 then
      v_count := v_count + 1;
    end if;
  end loop;

  -- Les séances libres que ce règlement solde, nommément. Le filtre sur le
  -- créneau de l'enseignant est une ceinture de sécurité : on ne solde jamais
  -- une séance qui appartient au cours de quelqu'un d'autre, même si l'écran
  -- s'était trompé en envoyant son identifiant.
  if p_independent_ids is not null and array_length(p_independent_ids, 1) > 0 then
    update public.independent_sessions i
       set teacher_paid = true
     where i.id = any (p_independent_ids)
       and i.teacher_paid = false
       and exists (
         select 1 from public.sessions s
         where s.id = i.session_id and s.teacher_id = p_teacher_id
       );
    get diagnostics v_free = row_count;
    if v_free > 0 and v_count = 0 then
      -- Un créneau suivi UNIQUEMENT par des séances libres est bien un créneau
      -- réglé : sans ça le bon annonçait « 0 créneau ».
      v_count := 1;
    end if;
  end if;

  -- Présences couvertes par ce règlement, lues dans l'instantané figé.
  select coalesce(sum((d ->> 'presents')::int), 0) into v_presences
  from jsonb_array_elements(coalesce(p_details, '[]'::jsonb)) d;

  insert into public.teacher_payments
    (teacher_id, amount, method, percentage, students_count, sessions_count, description, details)
  values
    (p_teacher_id, greatest(p_amount, 0), coalesce(p_method, 'fixed'), p_percentage,
     v_presences, v_count,
     coalesce(nullif(p_description, ''),
              'Règlement séances ' || v_teacher.first_name || ' ' || v_teacher.last_name),
     coalesce(p_details, '[]'::jsonb))
  returning id into v_payment_id;

  -- Acomptes et retenues : rattachés au règlement au lieu d'être supprimés,
  -- pour qu'annuler le règlement les rende à nouveau exigibles.
  if p_settle_deductions then
    update public.teacher_acomptes
       set payment_id = v_payment_id
     where staff_id = p_teacher_id
       and payment_id is null
       and (p_acompte_ids is null or id = any (p_acompte_ids));
    get diagnostics v_acomptes = row_count;

    update public.teacher_absences
       set payment_id = v_payment_id
     where staff_id = p_teacher_id
       and payment_id is null
       and (p_absence_ids is null or id = any (p_absence_ids));
    get diagnostics v_absences = row_count;
  end if;

  insert into public.cash_transactions (type, amount, date, description)
  values ('teacher_payment', -greatest(p_amount, 0), now(),
          'Règlement séances ' || v_teacher.first_name || ' ' || v_teacher.last_name
          || ' (' || v_count || ' créneau(x))')
  returning id into v_cash_id;

  update public.teacher_payments set cash_tx_id = v_cash_id where id = v_payment_id;

  return jsonb_build_object('ok', true, 'paymentId', v_payment_id,
    'sessions', v_count, 'amount', greatest(p_amount, 0),
    'freeSeances', v_free,
    'acomptes', v_acomptes, 'absences', v_absences);
end;
$$;


--
-- Name: pay_worker_period(uuid, text, text, date, date, uuid[], integer, text, jsonb, uuid[], uuid[], boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.pay_worker_period(p_worker_id uuid, p_method text, p_period_key text, p_period_start date DEFAULT NULL::date, p_period_end date DEFAULT NULL::date, p_shift_ids uuid[] DEFAULT NULL::uuid[], p_amount integer DEFAULT 0, p_description text DEFAULT ''::text, p_details jsonb DEFAULT '[]'::jsonb, p_acompte_ids uuid[] DEFAULT NULL::uuid[], p_absence_ids uuid[] DEFAULT NULL::uuid[], p_settle_deductions boolean DEFAULT false) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_role user_role := public.current_role();
  v_worker public.reception_staff%rowtype;
  v_payment_id uuid := gen_random_uuid();
  v_cash_id uuid;
  v_days int := 0;
  v_minutes int := 0;
  v_label text;
begin
  if v_role is null or v_role not in ('admin', 'reception') then
    raise exception 'not authorized';
  end if;

  select * into v_worker from public.reception_staff where id = p_worker_id;
  if not found then
    return jsonb_build_object('ok', false, 'messageKey', 'worker.notFound');
  end if;

  -- Le garde-fou que l'ancien écran n'avait pas : la même période ne peut pas
  -- être réglée deux fois, même par deux postes en même temps.
  if coalesce(p_period_key, '') <> ''
     and exists (select 1 from public.worker_payments
                  where worker_id = p_worker_id and period_key = p_period_key) then
    return jsonb_build_object('ok', false, 'messageKey', 'worker.periodAlreadyPaid');
  end if;

  v_label := coalesce(nullif(p_description, ''),
    'Règlement ' || v_worker.first_name || ' ' || v_worker.last_name
    || case when coalesce(p_period_key, '') <> '' then ' — ' || p_period_key else '' end);

  insert into public.cash_transactions (type, amount, date, description)
  values ('teacher_payment', -greatest(coalesce(p_amount, 0), 0), now(), v_label)
  returning id into v_cash_id;

  insert into public.worker_payments
    (id, worker_id, amount, method, period_start, period_end, period_key,
     days_count, minutes, description, details, cash_tx_id)
  values
    (v_payment_id, p_worker_id, greatest(coalesce(p_amount, 0), 0), p_method,
     p_period_start, p_period_end, coalesce(p_period_key, ''),
     0, 0, v_label, coalesce(p_details, '[]'::jsonb), v_cash_id);

  -- Les journées cochées passent réglées. Une absence peut en faire partie :
  -- elle ne rapporte rien, mais elle appartient à la période payée et ne doit
  -- plus jamais réapparaître comme « en attente ».
  if p_shift_ids is not null and array_length(p_shift_ids, 1) is not null then
    update public.worker_shifts
       set paid = true, payment_id = v_payment_id
     where worker_id = p_worker_id
       and paid = false
       and id = any (p_shift_ids);
    get diagnostics v_days = row_count;
    select coalesce(sum(minutes), 0) into v_minutes
    from public.worker_shifts where payment_id = v_payment_id;
  end if;

  -- Acomptes et retenues : RATTACHÉS au règlement, jamais détruits — annuler
  -- le règlement les rend à nouveau exigibles, exactement comme pour les
  -- enseignants depuis 20260902.
  if p_settle_deductions then
    if p_acompte_ids is not null and array_length(p_acompte_ids, 1) is not null then
      update public.teacher_acomptes set payment_id = v_payment_id
       where staff_id = p_worker_id and payment_id is null and id = any (p_acompte_ids);
    end if;
    if p_absence_ids is not null and array_length(p_absence_ids, 1) is not null then
      update public.teacher_absences set payment_id = v_payment_id
       where staff_id = p_worker_id and payment_id is null and id = any (p_absence_ids);
    end if;
  end if;

  update public.worker_payments
     set days_count = v_days, minutes = v_minutes
   where id = v_payment_id;

  return jsonb_build_object('ok', true, 'paymentId', v_payment_id,
    'days', v_days, 'minutes', v_minutes, 'amount', greatest(coalesce(p_amount, 0), 0));
end;
$$;


--
-- Name: pay_worker_shifts(uuid, uuid[], integer, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.pay_worker_shifts(p_worker_id uuid, p_shift_ids uuid[], p_amount integer, p_description text DEFAULT ''::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_res jsonb;
begin
  -- Pas de clé de période : un règlement horaire couvre un ensemble de
  -- journées choisies, pas un mois nommé. C'est `worker_shifts.paid` qui
  -- empêche de les payer deux fois.
  v_res := public.pay_worker_period(
    p_worker_id, 'hourly', '', null, null, p_shift_ids, p_amount, p_description,
    '[]'::jsonb, null, null, false);

  if not coalesce((v_res ->> 'ok')::boolean, false) then
    return v_res;
  end if;
  if coalesce((v_res ->> 'days')::int, 0) = 0 then
    return jsonb_build_object('ok', false, 'messageKey', 'worker.nothingDue');
  end if;
  return v_res;
end;
$$;


--
-- Name: process_weekly_absences(timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.process_weekly_absences(p_when timestamp with time zone DEFAULT now()) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
  v_period_end date;   -- dernier jour INCLUS de la semaine (le jeudi)
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
           greatest(ss.start_date, se.billing_start_date) as enr_start,
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

      -- Semaine suivant la dernière déjà facturée (period_end = jeudi, son
      -- vendredi d'ancrage est antérieur : on passe au vendredi suivant).
      if v_last_pen is not null then
        v_pen_anchor := public.week_anchor(v_last_pen, v_start_dow);
        if v_pen_anchor <= v_last_pen then
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
        -- Vendredi -> jeudi ; facturable une fois le jeudi terminé.
        v_period_start := v_anchor;
        v_period_end   := v_anchor + v_window - 1;
        exit when v_period_end >= v_today;
      else
        v_period_start := v_anchor + 1;
        v_period_end   := v_anchor + v_window;
        exit when v_today - v_anchor < v_window;
      end if;

      if v_period_end < greatest(v_floor, coalesce(v_enr.enr_start, v_floor)) then
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
          and fp.start_date <= v_period_end
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
          and (timezone('Africa/Algiers', a.occurred_at))::date between v_period_start and v_period_end
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

  -- LE correctif : sans WHERE, safeupdate refuse l'UPDATE et annule tout.
  update public.school set absence_penalty_last_run = v_today where id is not null;

  return jsonb_build_object('ok', true, 'enabled', true, 'charged', v_charged, 'students', v_students);
end;
$$;


--
-- Name: program_private_session(uuid, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.program_private_session(p_id uuid, p_payload jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_role user_role := public.current_role();
  v_total int;
  v_minutes int;
  v_when timestamptz;
  v_students int;
begin
  if v_role is null or v_role not in ('admin', 'reception') then
    raise exception 'not authorized';
  end if;
  if not exists (select 1 from public.private_sessions where id = p_id) then
    return jsonb_build_object('ok', false, 'messageKey', 'particulier.notFound');
  end if;

  v_total := public.write_private_session_modules(p_id, p_payload -> 'modules');

  select coalesce(sum(minutes), 0), min(scheduled_at)
    into v_minutes, v_when
  from public.private_session_modules where private_session_id = p_id;

  -- La date de la séance est celle de son PREMIER module ; à défaut, celle que
  -- l'écran a saisie. Sans l'une ou l'autre, on ne programme rien : la
  -- contrainte l'interdit, et une séance sans date ne pourrait jamais être
  -- signalée en retard.
  v_when := coalesce(v_when, nullif(p_payload ->> 'scheduledAt', '')::timestamptz);
  if v_when is null then
    return jsonb_build_object('ok', false, 'messageKey', 'particulier.noDate');
  end if;

  update public.private_sessions
     set total_price = v_total,
         duration_minutes = v_minutes,
         scheduled_at = v_when,
         status = 'planned'
   where id = p_id;

  -- Le total de la séance se répartit entre ses élèves, à parts égales par
  -- défaut : c'est ce que le guichet fait de tête, et la conclusion permettra
  -- de l'ajuster élève par élève.
  select count(*) into v_students
  from public.private_session_students where private_session_id = p_id;

  if v_students > 0 then
    update public.private_session_students
       set total_price = round(v_total::numeric / v_students)
     where private_session_id = p_id;
  end if;

  return jsonb_build_object('ok', true, 'total', v_total, 'scheduledAt', v_when);
end;
$$;


--
-- Name: protect_reception_payment_fields(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.protect_reception_payment_fields() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if not public.is_staff() then
    new.payment_type := old.payment_type;
    new.salary := old.salary;
    new.start_date := old.start_date;
  end if;
  return new;
end;
$$;


--
-- Name: protect_student_financial_fields(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.protect_student_financial_fields() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
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
$$;


--
-- Name: protect_teacher_payment_fields(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.protect_teacher_payment_fields() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if not public.is_staff() then
    new.payment_type := old.payment_type;
    new.monthly_amount := old.monthly_amount;
    new.percentage := old.percentage;
  end if;
  return new;
end;
$$;


--
-- Name: reprice_session(uuid, integer, integer, integer, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reprice_session(p_session_id uuid, p_price integer DEFAULT 0, p_level_price integer DEFAULT NULL::integer, p_period_months integer DEFAULT NULL::integer, p_from date DEFAULT NULL::date) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_role user_role := public.current_role();
  v_session public.sessions%rowtype;
  v_sib uuid;
  v_sub_id uuid;
  v_created int := 0;
  v_updated int := 0;
  v_att record;
  v_new_price int;
  v_delta int;
  v_repriced int := 0;
  v_refunded int := 0;
  v_charged int := 0;
  v_module_name text;
  v_group_name text;
  v_sync jsonb;
begin
  if v_role is null or v_role not in ('admin', 'reception') then
    raise exception 'not authorized';
  end if;

  select * into v_session from public.sessions where id = p_session_id;
  if not found then
    return jsonb_build_object('ok', false, 'messageKey', 'subscription.sessionNotFound');
  end if;

  -- ---- 1. Le tarif, sur TOUS les groupes du cours -------------------------
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

  if v_session.is_open then
    update public.sessions set open_price = greatest(coalesce(p_price, 0), 0)
      where id = p_session_id;
  end if;

  -- ---- 2. Les présences déjà pointées -------------------------------------
  if p_from is not null then
    for v_att in
      select a.*, se.module_id, st.is_free as student_free
      from public.attendance a
      join public.sessions se on se.id = a.session_id
      join public.students st on st.id = a.student_id
      where a.session_id in (select sib from public.sibling_session_ids(p_session_id) as t(sib))
        and (timezone('Africa/Algiers', a.occurred_at))::date >= p_from
      order by a.occurred_at
    loop
      v_new_price := case
        when v_att.student_free then 0
        else public.student_session_price(
               v_att.student_id, v_att.session_id,
               (timezone('Africa/Algiers', v_att.occurred_at))::date)
      end;

      if coalesce(v_att.waived_amount, 0) > 0 or v_att.free_period_id is not null
         or coalesce(v_att.pre_start, false) then
        -- Séance OFFERTE : rien n'a été débité et rien ne le sera. Seule la
        -- valeur de ce qui a été offert suit le nouveau tarif, pour que les
        -- rapports chiffrent juste.
        if coalesce(v_att.waived_amount, 0) <> v_new_price then
          update public.attendance set waived_amount = v_new_price where id = v_att.id;
          v_repriced := v_repriced + 1;
        end if;
      else
        v_delta := v_new_price - v_att.amount_deducted;
        if v_delta <> 0 then
          select m.name into v_module_name from public.modules m where m.id = v_att.module_id;
          select g.name into v_group_name from public.groups g
          where g.id = (select group_id from public.sessions where id = v_att.session_id);

          update public.attendance set amount_deducted = v_new_price where id = v_att.id;
          update public.students set balance = balance - v_delta where id = v_att.student_id;

          insert into public.balance_tx (student_id, amount, date, type, description, module_id)
          values (v_att.student_id, -v_delta, now(),
                  (case when v_delta > 0 then 'deduction' else 'topup' end)::balance_tx_type,
                  'Nouveau tarif: ' || coalesce(v_module_name, 'séance')
                    || coalesce(' (' || v_group_name || ')', '')
                    || ' du ' || to_char((timezone('Africa/Algiers', v_att.occurred_at))::date, 'DD/MM/YYYY')
                    || ' — ' || v_att.amount_deducted || ' DA → ' || v_new_price || ' DA',
                  v_att.module_id);

          v_repriced := v_repriced + 1;
          if v_delta > 0 then v_charged := v_charged + v_delta;
          else v_refunded := v_refunded - v_delta; end if;
        end if;
      end if;
    end loop;
  end if;

  -- ---- 3. La rémunération encore due suit, TOUJOURS -----------------------
  -- Sans p_from : les présences gardent leur montant, mais une séance due qui
  -- avait dérivé (montant corrigé à la main, pourcentage changé, créneau devenu
  -- offert) est remise d'aplomb. Avec p_from : elle suit le nouveau tarif.
  -- Les séances DÉJÀ RÉGLÉES ne sont jamais retouchées.
  v_sync := public.sync_teacher_dues(p_session_id, p_from);

  return jsonb_build_object('ok', true,
    'groups', v_created + v_updated,
    'created', v_created,
    'repriced', v_repriced,
    'charged', v_charged,
    'refunded', v_refunded,
    'teacherDues', (v_sync ->> 'updated')::int,
    'teacherDuesRemoved', (v_sync ->> 'removed')::int);
end;
$$;


--
-- Name: reschedule_private_session(uuid, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reschedule_private_session(p_id uuid, p_scheduled_at timestamp with time zone) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_role user_role := public.current_role();
begin
  if v_role is null or v_role not in ('admin', 'reception') then
    raise exception 'not authorized';
  end if;

  -- Reporter rend la séance « à venir » : une séance annulée qu'on redate est
  -- une séance reprogrammée, et une demande qu'on date EST une programmation.
  update public.private_sessions
     set scheduled_at = p_scheduled_at,
         status = case when status in ('cancelled', 'requested') then 'planned' else status end
   where id = p_id;
  if not found then
    return jsonb_build_object('ok', false, 'messageKey', 'particulier.notFound');
  end if;
  return jsonb_build_object('ok', true);
end;
$$;


--
-- Name: resolve_worker_absence(uuid, integer, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.resolve_worker_absence(p_shift_id uuid, p_cost integer DEFAULT 0, p_description text DEFAULT ''::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_role user_role := public.current_role();
  v_shift public.worker_shifts%rowtype;
  v_worker public.reception_staff%rowtype;
  v_cost int := greatest(coalesce(p_cost, 0), 0);
  v_absence_id uuid;
begin
  if v_role is null or v_role not in ('admin', 'reception') then
    raise exception 'not authorized';
  end if;

  select * into v_shift from public.worker_shifts where id = p_shift_id;
  if not found then
    return jsonb_build_object('ok', false, 'messageKey', 'worker.shiftNotFound');
  end if;
  if coalesce(v_shift.status, 'present') <> 'absent' then
    return jsonb_build_object('ok', false, 'messageKey', 'worker.notAnAbsence');
  end if;

  select * into v_worker from public.reception_staff where id = v_shift.worker_id;

  -- Retrancher une décision déjà prise : l'ancienne retenue s'en va, la
  -- nouvelle la remplace. Sans ça, changer d'avis EMPILAIT les retenues.
  if v_shift.absence_id is not null then
    delete from public.teacher_absences
     where id = v_shift.absence_id and payment_id is null;
  end if;

  if v_cost > 0 then
    insert into public.teacher_absences (staff_id, cost, description, date)
    values (
      v_shift.worker_id,
      v_cost,
      coalesce(nullif(p_description, ''),
               'Absence du ' || to_char(v_shift.work_date, 'DD/MM/YYYY')),
      v_shift.work_date
    )
    returning id into v_absence_id;
  end if;

  update public.worker_shifts
     set absence_resolved = true,
         absence_cost = v_cost,
         absence_id = v_absence_id,
         notes = coalesce(nullif(p_description, ''), notes)
   where id = p_shift_id;

  return jsonb_build_object('ok', true, 'absenceId', v_absence_id, 'cost', v_cost);
end;
$$;


--
-- Name: scan_card(text, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.scan_card(p_code text, p_when timestamp with time zone DEFAULT now()) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
  v_rank int;
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
  v_teacher_earns boolean := true;
  v_new_balance int;
  v_module_name text;
  v_group_name text;
  v_own_group boolean;
  v_own_group_name text;
  v_via_class boolean := false;
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

  -- >>> LE CHANGEMENT <<<
  -- Créneau retenu : celui sur lequel l'élève a le meilleur titre à être là.
  select se.* into v_matched
  from public.sessions se
  where v_today = any (se.days)
    and (se.period_start is null or se.period_start <= v_date)
    and (se.period_end   is null or se.period_end   >= v_date)
    and v_now_min >= public.time_to_minutes(se.start_time) - c_early_margin
    and v_now_min <= public.time_to_minutes(se.end_time)
    and public.student_session_rank(v_student.id, se.id, v_date) is not null
  order by
    -- 1. une séance commencée passe avant une séance qui n'a pas encore débuté
    (case when v_now_min >= public.time_to_minutes(se.start_time) then 0 else 1 end),
    -- 2. le titre à être là : inscrit sur le créneau, puis rattrapage sur un
    --    autre groupe du même cours, puis simple appartenance à la classe.
    public.student_session_rank(v_student.id, se.id, v_date),
    -- 3. À TITRE ÉGAL, LA SÉANCE OFFERTE L'EMPORTE. Deux créneaux à la même
    --    heure — un payant, un offert — ne peuvent pas être départagés par
    --    l'horaire : sans cette règle le scan débiterait l'élève sur le créneau
    --    payant alors que l'école a offert la séance.
    (case when coalesce(se.is_free, false) then 0 else 1 end),
    -- 4. puis le créneau dont l'heure de début est la plus proche
    abs(public.time_to_minutes(se.start_time) - v_now_min),
    -- 5. départage stable : deux scans identiques donnent le même créneau
    se.id
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
      and public.student_session_rank(v_student.id, se.id, v_date) is not null;

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

  v_rank := public.student_session_rank(v_student.id, v_matched.id, v_date);
  -- Rang 0 : inscrit sur le créneau. Rang 1 : rattrapage. Rang 2 : admis au
  -- titre de sa classe, sans aucune inscription sur ce cours.
  v_own_group := v_rank = 0;
  v_via_class := v_rank = 2;

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

  if v_rank = 1 then
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
      'viaClass', v_via_class,
      'debt', v_student.balance < 0,
      'sessionStart', v_matched.start_time, 'sessionEnd', v_matched.end_time,
      'messageKey', 'scan.alreadyPresent');
  end if;

  -- Prix NET : tarif de SON inscription (avec sa réduction) même s'il badge sur
  -- un autre groupe ; à défaut, le tarif affiché du créneau suivi.
  v_price := public.student_session_price(v_student.id, v_matched.id, v_date);

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

  -- >>> PREMIÈRE SÉANCE OFFICIELLE DU CRÉNEAU <<<
  -- Un emploi du temps peut porter une date de première séance officielle
  -- (`sessions.billing_start_date`). Tant qu'elle n'est pas atteinte, la
  -- séance est enregistrée comme n'importe quelle autre — l'élève est bien
  -- présent — mais RIEN ne descend de son solde. On la traite exactement
  -- comme une date de début d'inscription, en retenant la plus TARDIVE des
  -- deux : la facturation ne peut pas commencer avant que le créneau lui-même
  -- ait officiellement commencé.
  if v_matched.billing_start_date is not null
     and (v_enr_start is null or v_matched.billing_start_date > v_enr_start) then
    v_enr_start := v_matched.billing_start_date;
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

  -- Politique de porte, inchangée par ce script : voir section 0.
  if v_cost > 0 and v_student.balance < v_cost
     and public.scan_refuses_on_low_balance() then
    return jsonb_build_object('ok', false, 'studentId', v_student.id,
      'sessionId', v_matched.id, 'balance', v_student.balance,
      'debt', v_student.balance < 0,
      'moduleName', v_module_name, 'groupName', v_group_name,
      'otherGroup', not v_own_group, 'viaClass', v_via_class,
      'sessionStart', v_matched.start_time, 'sessionEnd', v_matched.end_time,
      'messageKey', 'scan.expired');
  end if;

  v_status := case
    when v_now_min > public.time_to_minutes(v_matched.start_time) + c_late_after then 'late'
    else 'present'
  end;

  -- L'enseignant gagne-t-il quelque chose sur CETTE séance ?
  --   · créneau offert                          -> non, personne n'encaisse ;
  --   · période gratuite « sans rémunération »   -> non ;
  --   · période gratuite qui rémunère, ou séance antérieure au début de
  --     l'abonnement                             -> oui, sur le prix non facturé ;
  --   · séance ordinaire                         -> oui, sur le prix encaissé.
  v_teacher_earns := not v_free_seance
                     and not (v_is_free_period and not coalesce(v_free.pay_teachers, true));

  v_teacher_base := case
    when not v_teacher_earns then 0
    when v_is_free_period or v_before_start then v_waived
    else v_cost
  end;

  if v_matched.teacher_id is not null and v_teacher_earns then
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
      'otherGroup', not v_own_group, 'viaClass', v_via_class,
      'debt', v_student.balance < 0,
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
            || case
                 when v_via_class then ' — admis au titre de sa classe'
                 when not v_own_group then ' — rattrapage sur un autre groupe'
                      || coalesce(' (inscrit ' || v_own_group_name || ')', '')
                 else '' end
            || case when v_new_balance < 0 then ' — DETTE : ' || (-v_new_balance) || ' DA' else '' end,
            v_matched.module_id);
  else
    -- Rien n'est débité : le solde reste strictement inchangé.
    v_new_balance := v_student.balance;
  end if;

  -- Séance offerte : AUCUNE ligne de rémunération n'est écrite, donc l'écran
  -- de règlement ne proposera jamais ce créneau et le total dû ne bouge pas.
  if v_matched.teacher_id is not null and v_teacher_earns then
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
    'balance', v_new_balance,
    'lowBalance', (v_cost > 0 and v_new_balance >= 0 and v_new_balance < v_price * 2),
    'moduleName', v_module_name,
    'groupName', v_group_name,
    'otherGroup', not v_own_group,
    'ownGroupName', v_own_group_name,
    'viaClass', v_via_class,
    'sessionStart', v_matched.start_time,
    'sessionEnd', v_matched.end_time,
    'free', v_is_free_period or v_free_seance,
    'freeSeance', v_free_seance,
    'freePeriodName', case when v_is_free_period then nullif(v_free.name, '') end,
    'preStart', v_before_start and not v_is_free_period and not v_free_seance,
    'enrollmentStart', case when v_before_start then v_enr_start end,
    'waived', v_waived,
    'teacherPaid', v_teacher_earns,
    'messageKey', case
      when v_cost > 0 and v_new_balance < 0 then 'scan.successDebt'
      when v_status = 'late' then 'scan.successLate'
      else 'scan.success'
    end
  );
end;
$$;


--
-- Name: scan_refuses_on_low_balance(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.scan_refuses_on_low_balance() RETURNS boolean
    LANGUAGE sql IMMUTABLE
    SET search_path TO 'public'
    AS $$
        select false
      $$;


--
-- Name: scan_worker_card(text, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.scan_worker_card(p_code text, p_when timestamp with time zone DEFAULT now()) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: sees_announcement_groups(uuid[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sees_announcement_groups(p_groups uuid[]) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: session_audience_class_ids(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.session_audience_class_ids(p_session_id uuid) RETURNS uuid[]
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
  with se as (
    select class_id,
           coalesce(class_ids, '{}'::uuid[]) as class_ids,
           open_audience,
           coalesce(is_open, false)          as is_open
      from public.sessions
     where id = p_session_id
  ),
  picked as (
    select c.*
      from public.classes c, se
     where c.id = se.class_id or c.id = any (se.class_ids)
  ),
  peers as (
    select public.class_peer_ids(
             (select coalesce(array_agg(p.id), '{}'::uuid[]) from picked p),
             (select is_open from se)
           ) as ids
  )
  select case
    when (select open_audience from se) = 'filiere' then (
      -- Toute la filière : l'année ne compte plus. Les jumelles restent du
      -- lot — élargir le public ne doit JAMAIS en retirer (une classe sans
      -- filière n'entrerait sinon plus dans son propre créneau).
      -- `peers` est joint, et non lu par `= any (sous-requête)` : sous cette
      -- forme Postgres comprend « l'un des uuid[] rendus » et refuse de
      -- comparer un uuid à un uuid[].
      select coalesce(array_agg(distinct c.id), '{}'::uuid[])
        from public.classes c, peers pe
       where c.id = any (pe.ids)
          or exists (
               select 1 from picked p
                where p.filiere_id is not null and c.filiere_id = p.filiere_id
             )
    )
    else (select ids from peers)
  end;
$$;


--
-- Name: FUNCTION session_audience_class_ids(p_session_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.session_audience_class_ids(p_session_id uuid) IS 'Les classes admises sur un créneau : cochées à sa création, élargies à leurs jumelles — filière comprise sur un cours ordinaire, ignorée sur une séance libre.';


--
-- Name: session_inherit_subscription(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.session_inherit_subscription() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: set_private_session_status(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_private_session_status(p_id uuid, p_status text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_role user_role := public.current_role();
begin
  if v_role is null or v_role not in ('admin', 'reception') then
    raise exception 'not authorized';
  end if;
  if p_status not in ('requested', 'planned', 'done', 'cancelled') then
    raise exception 'invalid private session status: %', p_status;
  end if;
  -- Une séance sans date ne peut pas être « programmée » : la contrainte
  -- l'interdit, et l'erreur brute ne dirait rien d'utile à l'écran.
  if p_status in ('planned', 'done')
     and not exists (
       select 1 from public.private_sessions
        where id = p_id and scheduled_at is not null
     )
  then
    return jsonb_build_object('ok', false, 'messageKey', 'particulier.noDate');
  end if;

  update public.private_sessions set status = p_status where id = p_id;
  if not found then
    return jsonb_build_object('ok', false, 'messageKey', 'particulier.notFound');
  end if;
  return jsonb_build_object('ok', true);
end;
$$;


--
-- Name: set_subscription_price(uuid, integer, integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_subscription_price(p_session_id uuid, p_price integer DEFAULT 0, p_level_price integer DEFAULT NULL::integer, p_period_months integer DEFAULT NULL::integer) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: set_worker_shift(uuid, date, timestamp with time zone, timestamp with time zone, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_worker_shift(p_worker_id uuid, p_work_date date, p_start_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_end_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_status text DEFAULT 'present'::text, p_notes text DEFAULT ''::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_role user_role := public.current_role();
  v_shift public.worker_shifts%rowtype;
  v_minutes int := 0;
  v_start timestamptz := p_start_at;
  v_end   timestamptz := p_end_at;
begin
  if v_role is null or v_role not in ('admin', 'reception') then
    raise exception 'not authorized';
  end if;
  if p_status not in ('present', 'absent') then
    raise exception 'invalid worker shift status: %', p_status;
  end if;
  if not exists (select 1 from public.reception_staff where id = p_worker_id) then
    return jsonb_build_object('ok', false, 'messageKey', 'worker.notFound');
  end if;

  select * into v_shift from public.worker_shifts
  where worker_id = p_worker_id and work_date = p_work_date;

  if found and v_shift.paid then
    return jsonb_build_object('ok', false, 'messageKey', 'worker.alreadyPaid');
  end if;

  -- Une absence n'a ni arrivée ni sortie : les heures d'un pointage corrigé en
  -- absence doivent disparaître, sinon elles resteraient payables.
  if p_status = 'absent' then
    v_start := null;
    v_end := null;
    v_minutes := 0;
  elsif v_start is not null and v_end is not null then
    if v_end <= v_start then
      return jsonb_build_object('ok', false, 'messageKey', 'worker.endBeforeStart');
    end if;
    v_minutes := greatest(0, (extract(epoch from (v_end - v_start)) / 60)::int);
  end if;

  if found then
    update public.worker_shifts
       set start_at = v_start,
           end_at   = v_end,
           minutes  = v_minutes,
           status   = p_status,
           source   = 'manual',
           notes    = coalesce(nullif(p_notes, ''), notes),
           -- Une journée qu'on vient d'écrire à la main n'est plus en attente
           -- d'une sortie : elle est complète ou elle est une absence.
           frozen   = (p_status = 'present' and v_start is not null and v_end is null)
     where id = v_shift.id
     returning * into v_shift;
  else
    insert into public.worker_shifts
      (worker_id, work_date, start_at, end_at, minutes, status, source, notes, frozen)
    values
      (p_worker_id, p_work_date, v_start, v_end, v_minutes, p_status, 'manual', coalesce(p_notes, ''),
       (p_status = 'present' and v_start is not null and v_end is null))
    returning * into v_shift;
  end if;

  return jsonb_build_object('ok', true, 'shiftId', v_shift.id, 'minutes', v_shift.minutes,
    'messageKey', case when p_status = 'absent' then 'worker.markedAbsent' else 'worker.shiftSaved' end);
end;
$$;


--
-- Name: settle_registration_fee(uuid, integer, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.settle_registration_fee(p_student_id uuid, p_fee integer DEFAULT NULL::integer, p_label text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_role user_role := public.current_role();
  v_student public.students%rowtype;
  v_fee int;
  v_new_balance int;
begin
  if v_role is null or v_role not in ('admin', 'reception') then
    raise exception 'not authorized';
  end if;

  select * into v_student from public.students where id = p_student_id;
  if not found then
    return jsonb_build_object('ok', false, 'messageKey', 'scan.notFound');
  end if;

  v_fee := greatest(coalesce(p_fee, v_student.registration_due, 0), 0);
  if v_fee = 0 then
    return jsonb_build_object('ok', true, 'fee', 0, 'newBalance', v_student.balance);
  end if;

  update public.students
     set balance = balance - v_fee,
         registration_due = greatest(coalesce(registration_due, 0) - v_fee, 0)
   where id = p_student_id
   returning balance into v_new_balance;

  insert into public.balance_tx (student_id, amount, date, type, description)
  values (p_student_id, -v_fee, now(), 'registration',
          coalesce(nullif(btrim(p_label), ''), 'Frais d''inscription')
          || case when v_new_balance < 0
                  then ' — DETTE : ' || (-v_new_balance) || ' DA'
                  else '' end);

  return jsonb_build_object('ok', true, 'fee', v_fee, 'newBalance', v_new_balance,
    'debt', v_new_balance < 0);
end;
$$;


--
-- Name: settle_teacher_percentage(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.settle_teacher_percentage(p_teacher_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_role user_role := public.current_role();
  v_teacher public.teachers%rowtype;
  v_gross int;
  v_count int;
  v_acomptes int;
  v_absences int;
  v_net int;
  v_details jsonb;
  v_timings int;
  v_payment_id uuid;
  v_cash_id uuid;
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
  from public.teacher_acomptes where staff_id = p_teacher_id and payment_id is null;

  select coalesce(sum(cost), 0) into v_absences
  from public.teacher_absences where staff_id = p_teacher_id and payment_id is null;

  v_net := v_gross - v_acomptes - v_absences;

  if v_net <= 0 then
    return jsonb_build_object('ok', false, 'messageKey', 'pay.nothingDue',
      'gross', v_gross, 'acomptes', v_acomptes, 'absences', v_absences, 'net', v_net);
  end if;

  -- Instantané des créneaux réglés : c'est lui qui permet de réimprimer le bon
  -- et, plus tard, d'ANNULER proprement le règlement. Les clés sont écrites en
  -- camelCase parce que c'est ce que lit l'application (TeacherPaymentDetail)
  -- et ce que delete_teacher_payment relit pour rendre les créneaux.
  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'dateKey',    d.date_key,
               'sessionId',  d.session_id,
               'title',      d.title,
               'moduleName', d.module_name,
               'groupName',  d.group_name,
               'startTime',  d.start_time,
               'endTime',    d.end_time,
               'presents',   d.presents,
               'passagers',  d.passagers,
               'gross',      d.gross,
               'share',      d.share
             )
             order by d.date_key desc
           ),
           '[]'::jsonb),
         count(*)
    into v_details, v_timings
  from (
    select
      to_char((timezone('Africa/Algiers', u.date))::date, 'YYYY-MM-DD') as date_key,
      u.session_id,
      coalesce(se.title, m.name, 'Séance')                              as title,
      coalesce(m.name, 'Séance')                                        as module_name,
      coalesce(g.name, '-')                                             as group_name,
      coalesce(se.start_time, '')                                       as start_time,
      coalesce(se.end_time, '')                                         as end_time,
      count(*)::int                                                     as presents,
      0                                                                 as passagers,
      coalesce(sum(a.amount_deducted), 0)::int                          as gross,
      sum(u.amount)::int                                                as share
    from public.unpaid_teacher_sessions u
    left join public.sessions se on se.id = u.session_id
    left join public.modules  m  on m.id  = se.module_id
    left join public.groups   g  on g.id  = se.group_id
    left join public.attendance a
      on a.student_id = u.student_id
     and a.session_id = u.session_id
     and (timezone('Africa/Algiers', a.occurred_at))::date = (timezone('Africa/Algiers', u.date))::date
    where u.teacher_id = p_teacher_id and u.paid = false
    group by 1, 2, 3, 4, 5, 6, 7
  ) d;


  insert into public.teacher_payments
    (teacher_id, amount, method, percentage, students_count, sessions_count, description, details)
  values
    (p_teacher_id, v_net, 'percent', v_teacher.percentage, v_count, v_timings,
     'Règlement au pourcentage ' || v_teacher.first_name || ' ' || v_teacher.last_name
     || ' (' || v_count || ' présences, brut ' || v_gross || ' DA, acomptes -' || v_acomptes
     || ' DA, absences -' || v_absences || ' DA)',
     v_details)
  returning id into v_payment_id;

  update public.unpaid_teacher_sessions set paid = true
  where teacher_id = p_teacher_id and paid = false;

  update public.teacher_acomptes set payment_id = v_payment_id
   where staff_id = p_teacher_id and payment_id is null;
  update public.teacher_absences set payment_id = v_payment_id
   where staff_id = p_teacher_id and payment_id is null;

  insert into public.cash_transactions (type, amount, date, description)
  values ('teacher_payment', -v_net, now(),
          'Règlement salaire au pourcentage - ' || v_teacher.first_name || ' ' || v_teacher.last_name
          || ' (' || v_count || ' présences, brut ' || v_gross || ' DA, acomptes -' || v_acomptes
          || ' DA, absences -' || v_absences || ' DA)')
  returning id into v_cash_id;

  update public.teacher_payments set cash_tx_id = v_cash_id where id = v_payment_id;

  return jsonb_build_object('ok', true, 'net', v_net, 'gross', v_gross,
    'sessions', v_count, 'acomptes', v_acomptes, 'absences', v_absences,
    'paymentId', v_payment_id);
end;
$$;


--
-- Name: sibling_session_ids(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sibling_session_ids(p_session_id uuid) RETURNS SETOF uuid
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
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


--
-- Name: student_class_ids(uuid, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.student_class_ids(p_student_id uuid, p_date date DEFAULT CURRENT_DATE) RETURNS uuid[]
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
  select coalesce(array_agg(distinct se.class_id), '{}'::uuid[])
  from public.student_subscriptions ss
  join public.subscriptions sub on sub.id = ss.subscription_id
  join public.sessions se on se.id = sub.session_id
  where ss.student_id = p_student_id
    and (ss.expiry_date is null or ss.expiry_date >= p_date);
$$;


--
-- Name: student_group_ids(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.student_group_ids(p_student_id uuid) RETURNS uuid[]
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select coalesce(array_agg(distinct se.group_id), '{}')
  from public.student_subscriptions ss
  join public.subscriptions sub on sub.id = ss.subscription_id
  join public.sessions se       on se.id = sub.session_id
  where ss.student_id = p_student_id;
$$;


--
-- Name: student_session_price(uuid, uuid, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.student_session_price(p_student_id uuid, p_session_id uuid, p_date date DEFAULT CURRENT_DATE) RETURNS integer
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
  select coalesce(
    (select public.discounted_price(sub.price_per_session, ss.discount_type, ss.discount_value)
       from public.subscriptions sub
       join public.student_subscriptions ss
         on ss.subscription_id = sub.id and ss.student_id = p_student_id
      where sub.session_id = p_session_id
      limit 1),
    (select public.discounted_price(sub.price_per_session, ss.discount_type, ss.discount_value)
       from public.student_subscriptions ss
       join public.subscriptions sub on sub.id = ss.subscription_id
       join public.sessions enr on enr.id = sub.session_id
       join public.sessions cur on cur.id = p_session_id
      where ss.student_id = p_student_id
        and enr.module_id = cur.module_id
        and enr.class_id  = cur.class_id
        and (ss.expiry_date is null or ss.expiry_date >= p_date)
      limit 1),
    nullif((select sub.price_per_session from public.subscriptions sub
             where sub.session_id = p_session_id limit 1), 0),
    nullif((select se.open_price from public.sessions se where se.id = p_session_id), 0),
    0);
$$;


--
-- Name: student_session_rank(uuid, uuid, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.student_session_rank(p_student_id uuid, p_session_id uuid, p_date date DEFAULT CURRENT_DATE) RETURNS integer
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
  select case
    -- Rang 0 — inscrit sur CE créneau. Le seul titre qu'un cours ordinaire
    -- accepte désormais, et le premier qu'une séance libre accepte.
    when exists (
      select 1
      from public.student_subscriptions ss
      join public.subscriptions sub on sub.id = ss.subscription_id
      where ss.student_id = p_student_id
        and sub.session_id = p_session_id
        and (ss.expiry_date is null or ss.expiry_date >= p_date)
    ) then 0

    -- >>> LE CHANGEMENT <<<
    -- COURS ORDINAIRE : la lecture s'arrête ici. Ni l'autre groupe du même
    -- cours, ni la classe jumelle, ni la classe cochée à la création du
    -- créneau n'ouvrent plus la porte. Chacun sur son emploi du temps.
    when not coalesce(
      (select se.is_open from public.sessions se where se.id = p_session_id),
      false
    ) then null

    -- ---- À partir d'ici : SÉANCES LIBRES UNIQUEMENT, règles inchangées ----
    -- Rang 1 — inscrit au même cours dans un autre groupe (rattrapage).
    when exists (
      select 1
      from public.student_subscriptions ss
      join public.subscriptions sub on sub.id = ss.subscription_id
      join public.sessions enr on enr.id = sub.session_id
      join public.sessions cur on cur.id = p_session_id
      where ss.student_id = p_student_id
        and enr.module_id = cur.module_id
        and enr.class_id  = cur.class_id
        and (ss.expiry_date is null or ss.expiry_date >= p_date)
    ) then 1

    -- Rang 2 — rattaché à une classe du public de la séance libre
    -- (`session_audience_class_ids` : la promotion, ou la filière entière).
    when exists (
      select 1
      from unnest(public.student_class_ids(p_student_id, p_date)) as sc(cid)
      where sc.cid = any (public.session_audience_class_ids(p_session_id))
    ) then 2

    else null
  end;
$$;


--
-- Name: FUNCTION student_session_rank(p_student_id uuid, p_session_id uuid, p_date date); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.student_session_rank(p_student_id uuid, p_session_id uuid, p_date date) IS 'À quel titre un élève assiste à un créneau. COURS ORDINAIRE : 0 (inscrit dessus) ou NULL, rien d''autre. SÉANCE LIBRE : 0 inscrit, 1 rattrapage, 2 par sa classe, NULL refusé.';


--
-- Name: subscription_sync_siblings(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.subscription_sync_siblings() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: sync_changes(timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sync_changes(p_since timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS jsonb
    LANGUAGE plpgsql STABLE
    SET search_path TO 'public'
    AS $_$
declare
  v_now timestamptz := now();
  v_since timestamptz;
  v_tables jsonb := '{}'::jsonb;
  v_rows jsonb;
  v_deleted jsonb;
  v_t text;
begin
  if p_since is null then
    return jsonb_build_object('now', v_now, 'tables', '{}'::jsonb, 'deleted', '[]'::jsonb);
  end if;

  v_since := p_since - interval '2 minutes';

  foreach v_t in array array[
    'school', 'profiles', 'filieres', 'modules', 'groups', 'salles', 'classes',
    'teachers', 'teacher_payments', 'reception_staff', 'worker_shifts',
    'worker_payments', 'student_credentials', 'module_absence_rules', 'sessions',
    'subscriptions', 'free_periods', 'students', 'balance_tx', 'attendance',
    'absence_penalties', 'unpaid_teacher_sessions', 'teacher_acomptes',
    'teacher_absences', 'subjects', 'announcements', 'expense_categories',
    'expenses', 'cash_transactions', 'parents', 'notifications', 'coursework',
    'independent_sessions', 'private_sessions', 'private_session_modules',
    'private_session_students'
  ] loop
    -- Table absente, ou colonne pas encore posée : on passe, sans échouer.
    if not exists (
      select 1 from pg_attribute
      where attrelid = to_regclass('public.' || v_t)
        and attname = 'updated_at'
        and not attisdropped
    ) then
      continue;
    end if;

    if v_t = 'students' then
      -- Même forme que la lecture de l'application : la fiche + ses inscriptions.
      select coalesce(jsonb_agg(
               to_jsonb(s) || jsonb_build_object(
                 'student_subscriptions',
                 coalesce((select jsonb_agg(to_jsonb(ss))
                             from public.student_subscriptions ss
                            where ss.student_id = s.id), '[]'::jsonb)
               )), '[]'::jsonb)
        into v_rows
        from public.students s
       where s.updated_at > v_since;
    elsif v_t = 'parents' then
      -- La fiche parent + l'identifiant de chacun de ses enfants.
      select coalesce(jsonb_agg(
               to_jsonb(p) || jsonb_build_object(
                 'students',
                 coalesce((select jsonb_agg(jsonb_build_object('id', st.id))
                             from public.students st
                            where st.parent_id = p.id), '[]'::jsonb)
               )), '[]'::jsonb)
        into v_rows
        from public.parents p
       where p.updated_at > v_since;
    else
      execute format(
        'select coalesce(jsonb_agg(to_jsonb(t)), ''[]''::jsonb) from public.%I t where t.updated_at > $1',
        v_t
      ) into v_rows using v_since;
    end if;

    if jsonb_array_length(v_rows) > 0 then
      v_tables := v_tables || jsonb_build_object(v_t, v_rows);
    end if;
  end loop;

  select coalesce(jsonb_agg(jsonb_build_object('table', d.table_name, 'key', d.row_key)), '[]'::jsonb)
    into v_deleted
    from public.sync_deletions d
   where d.deleted_at > v_since;

  return jsonb_build_object('now', v_now, 'tables', v_tables, 'deleted', v_deleted);
end;
$_$;


--
-- Name: sync_record_deletion(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sync_record_deletion() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  insert into public.sync_deletions (table_name, row_key)
  values (tg_table_name, to_jsonb(old) ->> tg_argv[0]);
  -- Ménage occasionnel : un appel sur cinquante suffit à garder la table petite.
  if random() < 0.02 then
    delete from public.sync_deletions where deleted_at < now() - interval '45 days';
  end if;
  return old;
end;
$$;


--
-- Name: sync_teacher_dues(uuid, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sync_teacher_dues(p_session_id uuid DEFAULT NULL::uuid, p_from date DEFAULT NULL::date) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_role user_role := public.current_role();
  v_removed int := 0;
  v_updated int := 0;
begin
  if v_role is null or v_role not in ('admin', 'reception') then
    raise exception 'not authorized';
  end if;

  -- a) Séance qui ne rémunère personne : la ligne de rémunération n'a rien à
  --    faire là. Seules les lignes NON réglées sont retirées.
  delete from public.unpaid_teacher_sessions u
  where u.paid = false
    and exists (
      select 1
      from public.offered_rule(u.session_id, (timezone('Africa/Algiers', u.date))::date) r
      where not r.teacher_earns
    )
    and (p_session_id is null
         or u.session_id in (select sib from public.sibling_session_ids(p_session_id) as t(sib)))
    and (p_from is null or (timezone('Africa/Algiers', u.date))::date >= p_from);
  get diagnostics v_removed = row_count;

  -- b) Les autres suivent exactement la valeur de la présence.
  with want as (
    select u.id,
           round(
             (case when a.amount_deducted > 0 then a.amount_deducted
                   else coalesce(a.waived_amount, 0) end)
             * coalesce(t.percentage, 0) / 100.0)::int as amount
    from public.unpaid_teacher_sessions u
    join public.teachers t
      on t.id = u.teacher_id and t.payment_type = 'percentage'
    join public.attendance a
      on a.student_id = u.student_id
     and a.session_id = u.session_id
     and (timezone('Africa/Algiers', a.occurred_at))::date
         = (timezone('Africa/Algiers', u.date))::date
    where u.paid = false
      and (p_session_id is null
           or u.session_id in (select sib from public.sibling_session_ids(p_session_id) as t2(sib)))
      and (p_from is null or (timezone('Africa/Algiers', u.date))::date >= p_from)
  )
  update public.unpaid_teacher_sessions u
     set amount = w.amount
    from want w
   where w.id = u.id
     and u.amount is distinct from w.amount;
  get diagnostics v_updated = row_count;

  return jsonb_build_object('ok', true, 'removed', v_removed, 'updated', v_updated);
end;
$$;


--
-- Name: sync_touch_parent_from_student(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sync_touch_parent_from_student() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if tg_op in ('UPDATE', 'DELETE') and old.parent_id is not null then
    if tg_op = 'DELETE' or new.parent_id is distinct from old.parent_id then
      update public.parents set updated_at = now() where id = old.parent_id;
    end if;
  end if;
  if tg_op in ('INSERT', 'UPDATE') and new.parent_id is not null then
    if tg_op = 'INSERT' or new.parent_id is distinct from old.parent_id then
      update public.parents set updated_at = now() where id = new.parent_id;
    end if;
  end if;
  return null;
end;
$$;


--
-- Name: sync_touch_student_from_enrollment(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sync_touch_student_from_enrollment() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    update public.students set updated_at = now() where id = old.student_id;
  end if;
  if tg_op in ('INSERT', 'UPDATE') and (tg_op = 'INSERT' or new.student_id is distinct from old.student_id) then
    update public.students set updated_at = now() where id = new.student_id;
  end if;
  return null;
end;
$$;


--
-- Name: sync_touch_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sync_touch_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  new.updated_at := now();
  return new;
end;
$$;


--
-- Name: teaches_private_session(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.teaches_private_session(p_session_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists (select 1 from public.private_session_modules m
                 where m.private_session_id = p_session_id and m.teacher_id = auth.uid());
$$;


--
-- Name: teaches_session(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.teaches_session(p_session_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists (
    select 1 from public.sessions where id = p_session_id and teacher_id = auth.uid()
  );
$$;


--
-- Name: teaches_student(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.teaches_student(p_student_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists (
    select 1
    from public.student_subscriptions ss
    join public.subscriptions sub on sub.id = ss.subscription_id
    join public.sessions se on se.id = sub.session_id
    where ss.student_id = p_student_id and se.teacher_id = auth.uid()
  );
$$;


--
-- Name: time_to_minutes(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.time_to_minutes(p_time text) RETURNS integer
    LANGUAGE sql IMMUTABLE
    AS $$
  select split_part(p_time, ':', 1)::int * 60 + split_part(p_time, ':', 2)::int;
$$;


--
-- Name: update_attendance(uuid, public.attendance_status, timestamp with time zone, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_attendance(p_attendance_id uuid, p_status public.attendance_status DEFAULT NULL::public.attendance_status, p_occurred_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_amount integer DEFAULT NULL::integer) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
            (case when v_delta > 0 then 'deduction' else 'topup' end)::balance_tx_type,
            'Correction présence: ' || coalesce(v_module_name, 'séance')
              || coalesce(' (' || v_group_name || ')', '')
              || ' du ' || to_char(v_old_date, 'DD/MM/YYYY')
              || ' — ' || v_att.amount_deducted || ' DA → ' || v_amount || ' DA',
            v_session.module_id);
  else
    select balance into v_new_balance from public.students where id = v_att.student_id;
  end if;

  -- La part enseignant suit le nouveau montant — sauf sur une séance OFFERTE,
  -- où il n'y a aucune ligne de rémunération à suivre.
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


--
-- Name: update_balance_tx(uuid, integer, text, timestamp with time zone, public.balance_tx_type, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_balance_tx(p_tx_id uuid, p_amount integer, p_description text DEFAULT NULL::text, p_date timestamp with time zone DEFAULT NULL::timestamp with time zone, p_type public.balance_tx_type DEFAULT NULL::public.balance_tx_type, p_adjust_cash boolean DEFAULT true) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_role user_role := public.current_role();
  v_tx public.balance_tx%rowtype;
  v_student public.students%rowtype;
  v_delta integer;
  v_new_balance integer;
begin
  if v_role is null or v_role not in ('admin', 'reception') then
    raise exception 'not authorized';
  end if;

  select * into v_tx from public.balance_tx where id = p_tx_id;
  if not found then
    raise exception 'transaction not found';
  end if;

  select * into v_student from public.students where id = v_tx.student_id;
  if not found then
    raise exception 'student not found';
  end if;

  v_delta := p_amount - v_tx.amount;

  -- Mise à jour relative : deux corrections simultanées ne peuvent pas
  -- s'écraser l'une l'autre.
  update public.students
    set balance = balance + v_delta
    where id = v_tx.student_id
    returning balance into v_new_balance;

  -- Les valeurs de repli viennent de v_tx (et non des colonnes) pour qu'aucun
  -- nom de colonne ("date", "type") ne puisse être lu comme un mot-clé.
  update public.balance_tx
    set amount      = p_amount,
        description = coalesce(p_description, v_tx.description),
        date        = coalesce(p_date, v_tx.date),
        type        = coalesce(p_type, v_tx.type)
    where id = p_tx_id;

  if p_adjust_cash and v_tx.type = 'topup' and v_delta <> 0 then
    insert into public.cash_transactions (type, amount, date, description)
    values (
      'student_payment', v_delta, now(),
      'Correction versement ' || v_student.first_name || ' ' || v_student.last_name
        || ' (' || v_tx.amount || ' DA → ' || p_amount || ' DA)'
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'newBalance', v_new_balance,
    'delta', v_delta,
    'cashAdjusted', p_adjust_cash and v_tx.type = 'topup' and v_delta <> 0
  );
end;
$$;


--
-- Name: update_private_request(uuid, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_private_request(p_id uuid, p_payload jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_role user_role := public.current_role();
  v_students int;
  v_first jsonb;
begin
  if v_role is null or v_role not in ('admin', 'reception') then
    raise exception 'not authorized';
  end if;
  if not exists (select 1 from public.private_sessions where id = p_id) then
    return jsonb_build_object('ok', false, 'messageKey', 'particulier.notFound');
  end if;

  v_first := coalesce(p_payload -> 'students' -> 0, '{}'::jsonb);

  update public.private_sessions
     set student_id   = nullif(v_first ->> 'studentId', '')::uuid,
         guest_name   = nullif(trim(coalesce(v_first ->> 'guestName', '')), ''),
         guest_phone  = nullif(v_first ->> 'guestPhone', ''),
         guest_phone2 = nullif(v_first ->> 'guestPhone2', ''),
         class_id     = nullif(v_first ->> 'classId', '')::uuid,
         year         = nullif(v_first ->> 'year', ''),
         filiere_id   = nullif(v_first ->> 'filiereId', '')::uuid,
         notes        = coalesce(p_payload ->> 'notes', notes),
         request_date = coalesce(nullif(p_payload ->> 'requestDate', '')::date, request_date),
         receptionist_id =
           coalesce(nullif(p_payload ->> 'receptionistId', '')::uuid, receptionist_id),
         receptionist_name =
           coalesce(nullif(p_payload ->> 'receptionistName', ''), receptionist_name),
         observation  = coalesce(p_payload ->> 'observation', observation)
   where id = p_id;

  v_students := public.write_private_session_students(p_id, p_payload -> 'students');
  if v_students = 0 then
    raise exception 'une séance particulière doit porter au moins un élève';
  end if;

  return jsonb_build_object('ok', true, 'students', v_students);
end;
$$;


--
-- Name: update_private_session(uuid, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_private_session(p_id uuid, p_payload jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_role user_role := public.current_role();
  v_total int;
  v_minutes int;
  v_paid int;
begin
  if v_role is null or v_role not in ('admin', 'reception') then
    raise exception 'not authorized';
  end if;
  if not exists (select 1 from public.private_sessions where id = p_id) then
    return jsonb_build_object('ok', false, 'messageKey', 'particulier.notFound');
  end if;

  update public.private_sessions
     set student_id   = nullif(p_payload ->> 'studentId', '')::uuid,
         guest_name   = nullif(p_payload ->> 'guestName', ''),
         guest_phone  = nullif(p_payload ->> 'guestPhone', ''),
         guest_phone2 = nullif(p_payload ->> 'guestPhone2', ''),
         class_id     = nullif(p_payload ->> 'classId', '')::uuid,
         year         = nullif(p_payload ->> 'year', ''),
         filiere_id   = nullif(p_payload ->> 'filiereId', '')::uuid,
         scheduled_at = (p_payload ->> 'scheduledAt')::timestamptz,
         notes        = coalesce(p_payload ->> 'notes', notes)
   where id = p_id;

  v_total := public.write_private_session_modules(p_id, p_payload -> 'modules');

  select coalesce(sum(minutes), 0) into v_minutes
  from public.private_session_modules where private_session_id = p_id;

  select least(paid_amount, v_total) into v_paid
  from public.private_sessions where id = p_id;

  update public.private_sessions
     set total_price = v_total, duration_minutes = v_minutes, paid_amount = v_paid
   where id = p_id;

  return jsonb_build_object('ok', true, 'total', v_total);
end;
$$;


--
-- Name: update_teacher_payment(uuid, integer, text, integer, text, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_teacher_payment(p_payment_id uuid, p_amount integer DEFAULT NULL::integer, p_method text DEFAULT NULL::text, p_percentage integer DEFAULT NULL::integer, p_description text DEFAULT NULL::text, p_paid_at timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_role user_role := public.current_role();
  v_pay public.teacher_payments%rowtype;
  v_amount int;
  v_cash_id uuid;
begin
  if v_role is null or v_role not in ('admin', 'reception') then
    raise exception 'not authorized';
  end if;

  select * into v_pay from public.teacher_payments where id = p_payment_id;
  if not found then
    return jsonb_build_object('ok', false, 'messageKey', 'pay.notFound');
  end if;

  v_amount := greatest(coalesce(p_amount, v_pay.amount), 0);

  update public.teacher_payments
     set amount      = v_amount,
         method      = coalesce(nullif(p_method, ''), v_pay.method),
         percentage  = coalesce(p_percentage, v_pay.percentage),
         description = coalesce(nullif(p_description, ''), v_pay.description),
         paid_at     = coalesce(p_paid_at, v_pay.paid_at)
   where id = p_payment_id;

  if v_pay.cash_tx_id is not null then
    update public.cash_transactions
       set amount      = -v_amount,
           date        = coalesce(p_paid_at, v_pay.paid_at),
           description = coalesce(nullif(p_description, ''), description)
     where id = v_pay.cash_tx_id;
  else
    -- Règlement d'avant le lien de caisse : on en crée un pour que la caisse
    -- reste exacte, plutôt que de laisser deux montants diverger.
    insert into public.cash_transactions (type, amount, date, description)
    values ('teacher_payment', -v_amount, coalesce(p_paid_at, v_pay.paid_at),
            coalesce(nullif(p_description, ''), v_pay.description))
    returning id into v_cash_id;
    update public.teacher_payments set cash_tx_id = v_cash_id where id = p_payment_id;
  end if;

  return jsonb_build_object('ok', true, 'amount', v_amount);
end;
$$;


--
-- Name: week_anchor(date, smallint); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.week_anchor(p_date date, p_start_dow smallint) RETURNS date
    LANGUAGE sql IMMUTABLE
    AS $$
  -- Dernier "jour d'ouverture" (0=dimanche … 6=samedi) à p_date ou avant.
  select p_date - ((extract(dow from p_date)::int - coalesce(p_start_dow, 5)::int + 7) % 7);
$$;


--
-- Name: worker_works_on(uuid, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.worker_works_on(p_worker_id uuid, p_date date) RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_worker public.reception_staff%rowtype;
  v_dow day_of_week;
begin
  select * into v_worker from public.reception_staff where id = p_worker_id;
  if not found then return false; end if;
  -- Embauché plus tard : il n'était attendu nulle part avant son premier jour.
  if v_worker.start_date is not null and p_date < v_worker.start_date then
    return false;
  end if;
  v_dow := (array['sunday','monday','tuesday','wednesday','thursday','friday','saturday'])
             [extract(dow from p_date)::int + 1]::day_of_week;
  -- Jamais configuré = attendu tous les jours, comme avant ce script.
  if v_worker.work_days is null or array_length(v_worker.work_days, 1) is null then
    return true;
  end if;
  return v_dow = any (v_worker.work_days);
end;
$$;


--
-- Name: write_private_session_modules(uuid, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.write_private_session_modules(p_session_id uuid, p_modules jsonb) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_row jsonb;
  v_minutes int;
  v_hourly int;
  v_flat int;
  v_price int;
  v_pct int;
  v_total int := 0;
begin
  delete from public.private_session_modules where private_session_id = p_session_id;

  for v_row in select * from jsonb_array_elements(coalesce(p_modules, '[]'::jsonb))
  loop
    v_minutes := greatest(coalesce((v_row ->> 'minutes')::int, 0), 0);
    v_hourly  := greatest(coalesce((v_row ->> 'hourlyPrice')::int, 0), 0);
    v_flat    := greatest(coalesce((v_row ->> 'flatPrice')::int, 0), 0);
    -- Le forfait gagne quand il est posé : c'est une décision du guichet, pas
    -- une donnée à recalculer.
    v_price   := case when v_flat > 0 then v_flat else round(v_minutes * v_hourly / 60.0) end;
    v_pct     := least(greatest(coalesce((v_row ->> 'teacherPercentage')::int, 0), 0), 100);

    insert into public.private_session_modules
      (private_session_id, module_id, teacher_id, minutes, hourly_price, flat_price,
       total_price, teacher_percentage, teacher_amount, teacher_paid, teacher_paid_at,
       scheduled_at, teacher_name, teacher_phone)
    values
      (p_session_id,
       (v_row ->> 'moduleId')::uuid,
       nullif(v_row ->> 'teacherId', '')::uuid,
       v_minutes, v_hourly, v_flat, v_price, v_pct, round(v_price * v_pct / 100.0),
       coalesce((v_row ->> 'teacherPaid')::boolean, false),
       case when coalesce((v_row ->> 'teacherPaid')::boolean, false) then now() end,
       nullif(v_row ->> 'scheduledAt', '')::timestamptz,
       nullif(v_row ->> 'teacherName', ''),
       nullif(v_row ->> 'teacherPhone', ''));

    v_total := v_total + v_price;
  end loop;

  return v_total;
end;
$$;


--
-- Name: write_private_session_students(uuid, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.write_private_session_students(p_session_id uuid, p_students jsonb) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_row jsonb;
  v_count int := 0;
begin
  delete from public.private_session_students where private_session_id = p_session_id;

  for v_row in select * from jsonb_array_elements(coalesce(p_students, '[]'::jsonb))
  loop
    -- Une ligne sans personne dessus n'est pas un élève : on la saute plutôt
    -- que de faire échouer toute la séance sur une ligne vide oubliée.
    if nullif(v_row ->> 'studentId', '') is null
       and nullif(trim(coalesce(v_row ->> 'guestName', '')), '') is null then
      continue;
    end if;

    insert into public.private_session_students
      (private_session_id, student_id, guest_name, guest_phone,
       class_id, year, filiere_id, total_price, paid_amount)
    values
      (p_session_id,
       nullif(v_row ->> 'studentId', '')::uuid,
       nullif(trim(coalesce(v_row ->> 'guestName', '')), ''),
       nullif(v_row ->> 'guestPhone', ''),
       nullif(v_row ->> 'classId', '')::uuid,
       nullif(v_row ->> 'year', ''),
       nullif(v_row ->> 'filiereId', '')::uuid,
       greatest(coalesce((v_row ->> 'totalPrice')::int, 0), 0),
       greatest(coalesce((v_row ->> 'paidAmount')::int, 0), 0));
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;


--
-- Name: absence_penalties; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.absence_penalties (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    student_id uuid NOT NULL,
    subscription_id uuid,
    session_id uuid,
    module_id uuid,
    period_start date NOT NULL,
    period_end date NOT NULL,
    amount integer NOT NULL,
    balance_after integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: announcements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.announcements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    title text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    audience public.audience_type DEFAULT 'all'::public.audience_type NOT NULL,
    end_date date,
    date date DEFAULT CURRENT_DATE NOT NULL,
    target_group_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL,
    include_parents boolean DEFAULT true NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: attendance; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.attendance (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    student_id uuid NOT NULL,
    session_id uuid NOT NULL,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL,
    amount_deducted integer DEFAULT 0 NOT NULL,
    status public.attendance_status NOT NULL,
    substitute_group boolean DEFAULT false NOT NULL,
    free_period_id uuid,
    waived_amount integer DEFAULT 0 NOT NULL,
    pre_start boolean DEFAULT false NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: balance_tx; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.balance_tx (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    student_id uuid NOT NULL,
    amount integer NOT NULL,
    date timestamp with time zone DEFAULT now() NOT NULL,
    type public.balance_tx_type NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    module_id uuid,
    created_by uuid DEFAULT auth.uid(),
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: cash_transactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cash_transactions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    type public.cash_tx_type NOT NULL,
    amount integer NOT NULL,
    date timestamp with time zone DEFAULT now() NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    created_by uuid DEFAULT auth.uid(),
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: COLUMN cash_transactions.created_by; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.cash_transactions.created_by IS 'Compte qui a écrit ce mouvement (profiles.id). NULL sur les lignes antérieures au 12/09/2026.';


--
-- Name: classes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.classes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    type public.class_type NOT NULL,
    name text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    cours_level public.cours_level,
    year text,
    filiere_id uuid,
    formation_level public.formation_level,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: coursework; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.coursework (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    type public.coursework_type NOT NULL,
    dates date[] DEFAULT '{}'::date[] NOT NULL,
    price_per_session integer DEFAULT 0 NOT NULL,
    total integer DEFAULT 0 NOT NULL,
    teacher_id uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: expense_categories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.expense_categories (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: expenses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.expenses (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    category_id uuid,
    amount integer DEFAULT 0 NOT NULL,
    date date DEFAULT CURRENT_DATE NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: filieres; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.filieres (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: groups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.groups (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: independent_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.independent_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    student_id uuid,
    passager_name text,
    item_label text NOT NULL,
    price integer DEFAULT 0 NOT NULL,
    date date DEFAULT CURRENT_DATE NOT NULL,
    session_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    start_time text,
    end_time text,
    teacher_paid boolean DEFAULT false NOT NULL,
    is_free boolean DEFAULT false NOT NULL,
    waived_amount integer DEFAULT 0 NOT NULL,
    passager_phone text,
    class_id uuid,
    year text,
    filiere_id uuid,
    module_id uuid,
    teacher_percentage integer,
    teacher_amount integer,
    created_by uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT independent_sessions_has_payer CHECK (((student_id IS NOT NULL) OR (passager_name IS NOT NULL))),
    CONSTRAINT independent_sessions_teacher_pct_check CHECK (((teacher_percentage IS NULL) OR ((teacher_percentage >= 0) AND (teacher_percentage <= 100))))
);


--
-- Name: module_absence_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.module_absence_rules (
    module_id uuid NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    days_window integer DEFAULT 7 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: modules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.modules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    parent_id uuid NOT NULL,
    title text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    date timestamp with time zone DEFAULT now() NOT NULL,
    read boolean DEFAULT false NOT NULL,
    auto boolean DEFAULT false NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: parents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.parents (
    id uuid NOT NULL,
    first_name text NOT NULL,
    last_name text NOT NULL,
    phone text DEFAULT ''::text NOT NULL,
    email text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: private_session_modules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.private_session_modules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    private_session_id uuid NOT NULL,
    module_id uuid NOT NULL,
    teacher_id uuid,
    minutes integer DEFAULT 0 NOT NULL,
    hourly_price integer DEFAULT 0 NOT NULL,
    total_price integer DEFAULT 0 NOT NULL,
    teacher_percentage integer DEFAULT 0 NOT NULL,
    teacher_amount integer DEFAULT 0 NOT NULL,
    teacher_paid boolean DEFAULT false NOT NULL,
    teacher_paid_at timestamp with time zone,
    scheduled_at timestamp with time zone,
    flat_price integer DEFAULT 0 NOT NULL,
    teacher_name text,
    teacher_phone text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: private_session_students; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.private_session_students (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    private_session_id uuid NOT NULL,
    student_id uuid,
    guest_name text,
    guest_phone text,
    class_id uuid,
    year text,
    filiere_id uuid,
    total_price integer DEFAULT 0 NOT NULL,
    paid_amount integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT private_session_students_named CHECK (((student_id IS NOT NULL) OR (guest_name IS NOT NULL)))
);


--
-- Name: private_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.private_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    student_id uuid,
    guest_name text,
    guest_phone text,
    guest_phone2 text,
    class_id uuid,
    year text,
    filiere_id uuid,
    scheduled_at timestamp with time zone,
    duration_minutes integer DEFAULT 0 NOT NULL,
    total_price integer DEFAULT 0 NOT NULL,
    paid_amount integer DEFAULT 0 NOT NULL,
    status text DEFAULT 'planned'::text NOT NULL,
    notes text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid DEFAULT auth.uid(),
    request_date date,
    receptionist_id uuid,
    receptionist_name text,
    observation text DEFAULT ''::text NOT NULL,
    deposit_amount integer DEFAULT 0 NOT NULL,
    school_percentage integer,
    teacher_share integer DEFAULT 0 NOT NULL,
    school_share integer DEFAULT 0 NOT NULL,
    completed_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT private_sessions_has_attendee CHECK (((student_id IS NOT NULL) OR (guest_name IS NOT NULL))),
    CONSTRAINT private_sessions_scheduled_when_planned CHECK (((status = 'requested'::text) OR (scheduled_at IS NOT NULL))),
    CONSTRAINT private_sessions_status_check CHECK ((status = ANY (ARRAY['requested'::text, 'planned'::text, 'done'::text, 'cancelled'::text])))
);


--
-- Name: profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.profiles (
    id uuid NOT NULL,
    role public.user_role NOT NULL,
    full_name text NOT NULL,
    email text,
    phone text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: reception_staff; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reception_staff (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    first_name text NOT NULL,
    last_name text NOT NULL,
    phone text DEFAULT ''::text NOT NULL,
    email text,
    payment_type public.reception_payment_type NOT NULL,
    start_date date DEFAULT CURRENT_DATE NOT NULL,
    salary integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    rfid text,
    hourly_rate integer DEFAULT 0 NOT NULL,
    role text DEFAULT 'reception'::text NOT NULL,
    work_days public.day_of_week[] DEFAULT '{saturday,sunday,monday,tuesday,wednesday,thursday}'::public.day_of_week[] NOT NULL,
    daily_start text,
    daily_end text,
    job_title text DEFAULT ''::text NOT NULL,
    pay_alert_days integer DEFAULT 3 NOT NULL,
    pay_start_date date,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: salles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.salles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: school; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.school (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text DEFAULT 'Mon École'::text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    phone text DEFAULT ''::text NOT NULL,
    email text DEFAULT ''::text NOT NULL,
    logo_url text,
    address text DEFAULT ''::text NOT NULL,
    article_fiscal text,
    registre_commerce text,
    nif text,
    nis text,
    registration_fee integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    absence_penalty_enabled boolean DEFAULT true NOT NULL,
    absence_penalty_since date,
    absence_penalty_last_run date,
    absence_week_start_day smallint DEFAULT 5 NOT NULL,
    registration_fee_label text,
    registration_fee_2 integer DEFAULT 0 NOT NULL,
    registration_fee_2_label text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    class_id uuid NOT NULL,
    module_id uuid NOT NULL,
    group_id uuid NOT NULL,
    salle_id uuid NOT NULL,
    teacher_id uuid,
    days public.day_of_week[] DEFAULT '{}'::public.day_of_week[] NOT NULL,
    start_time text NOT NULL,
    end_time text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    is_open boolean DEFAULT false NOT NULL,
    title text,
    period_start date,
    period_end date,
    class_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL,
    group_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL,
    salle_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL,
    open_price integer DEFAULT 0 NOT NULL,
    is_free boolean DEFAULT false NOT NULL,
    open_audience text,
    billing_start_date date,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT sessions_open_audience_check CHECK (((open_audience IS NULL) OR (open_audience = ANY (ARRAY['enrolled'::text, 'filiere'::text]))))
);


--
-- Name: COLUMN sessions.open_audience; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.sessions.open_audience IS 'Séance libre : public autorisé au guichet (enrolled = classes et groupes cochés, filiere = toute la filière, NULL = aucune restriction).';


--
-- Name: COLUMN sessions.billing_start_date; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.sessions.billing_start_date IS 'Première séance officielle. Avant cette date, les présences sont enregistrées mais jamais facturées, et les absences jamais comptées. NULL = facturation dès la première séance.';


--
-- Name: student_credentials; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.student_credentials (
    student_id uuid NOT NULL,
    password text DEFAULT ''::text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: student_subscriptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.student_subscriptions (
    student_id uuid NOT NULL,
    subscription_id uuid NOT NULL,
    start_date date,
    expiry_date date,
    discount_type text,
    discount_value integer DEFAULT 0 NOT NULL,
    subscribed_at date
);


--
-- Name: COLUMN student_subscriptions.start_date; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.student_subscriptions.start_date IS 'Date de début de facturation : avant cette date, les séances sont offertes (aucun débit).';


--
-- Name: COLUMN student_subscriptions.subscribed_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.student_subscriptions.subscribed_at IS 'Date d''inscription : le jour où l''élève a été inscrit à ce module.';


--
-- Name: students; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.students (
    id uuid NOT NULL,
    first_name text NOT NULL,
    last_name text NOT NULL,
    birth_date date,
    phone text DEFAULT ''::text NOT NULL,
    email text,
    rfid text,
    balance integer DEFAULT 0 NOT NULL,
    is_free boolean DEFAULT false NOT NULL,
    parent_id uuid,
    registration_due integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: subjects; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.subjects (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    title text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    image_url text,
    session_id uuid NOT NULL,
    date date DEFAULT CURRENT_DATE NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: subscriptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.subscriptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    session_id uuid NOT NULL,
    price_per_session integer DEFAULT 0 NOT NULL,
    level_price integer,
    period_months integer,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: sync_deletions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sync_deletions (
    id bigint NOT NULL,
    table_name text NOT NULL,
    row_key text NOT NULL,
    deleted_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: sync_deletions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.sync_deletions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sync_deletions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.sync_deletions_id_seq OWNED BY public.sync_deletions.id;


--
-- Name: teacher_absences; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.teacher_absences (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    staff_id uuid NOT NULL,
    cost integer DEFAULT 0 NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    date date DEFAULT CURRENT_DATE NOT NULL,
    payment_id uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: teacher_acomptes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.teacher_acomptes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    staff_id uuid NOT NULL,
    amount integer DEFAULT 0 NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    date date DEFAULT CURRENT_DATE NOT NULL,
    payment_id uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: teacher_payments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.teacher_payments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    teacher_id uuid NOT NULL,
    amount integer DEFAULT 0 NOT NULL,
    method text DEFAULT 'fixed'::text NOT NULL,
    percentage integer,
    students_count integer DEFAULT 0 NOT NULL,
    sessions_count integer DEFAULT 0 NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    details jsonb DEFAULT '[]'::jsonb NOT NULL,
    paid_at timestamp with time zone DEFAULT now() NOT NULL,
    cash_tx_id uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: teachers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.teachers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    first_name text NOT NULL,
    last_name text NOT NULL,
    phone text DEFAULT ''::text NOT NULL,
    email text,
    payment_type public.teacher_payment_type NOT NULL,
    monthly_amount integer,
    start_date date,
    percentage integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    is_passager boolean DEFAULT false NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: unpaid_teacher_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.unpaid_teacher_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    teacher_id uuid NOT NULL,
    session_id uuid NOT NULL,
    student_id uuid NOT NULL,
    amount integer DEFAULT 0 NOT NULL,
    date timestamp with time zone DEFAULT now() NOT NULL,
    paid boolean DEFAULT false NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: whatsapp_contacts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.whatsapp_contacts (
    phone text NOT NULL,
    last_inbound_at timestamp with time zone,
    last_inbound_wamid text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE whatsapp_contacts; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.whatsapp_contacts IS 'Dernier message entrant par numero. Trace des familles qui ont repondu a l''ecole ; ne conditionne plus le droit d''ecrire.';


--
-- Name: whatsapp_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.whatsapp_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    recipient_phone text NOT NULL,
    recipient_name text,
    student_id uuid,
    parent_id uuid,
    message_type text NOT NULL,
    template_name text,
    template_language text,
    message_id text,
    status text DEFAULT 'queued'::text NOT NULL,
    error_code text,
    error_message text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    sent_at timestamp with time zone,
    delivered_at timestamp with time zone,
    read_at timestamp with time zone,
    failed_at timestamp with time zone,
    provider text DEFAULT 'evolution'::text NOT NULL,
    instance text
);


--
-- Name: TABLE whatsapp_messages; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.whatsapp_messages IS 'Journal des messages WhatsApp sortants. Statut mis a jour par le webhook de la passerelle.';


--
-- Name: COLUMN whatsapp_messages.template_name; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.whatsapp_messages.template_name IS 'PLUS ALIMENTEE depuis le passage a Evolution API : il n''y a plus de modele approuve. Conservee pour l''historique Meta.';


--
-- Name: COLUMN whatsapp_messages.template_language; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.whatsapp_messages.template_language IS 'PLUS ALIMENTEE depuis le passage a Evolution API. Conservee pour l''historique Meta.';


--
-- Name: COLUMN whatsapp_messages.message_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.whatsapp_messages.message_id IS 'Identifiant du message rendu a l''envoi. UNIQUE : garantit l''idempotence face a un webhook livre plusieurs fois. Les lignes d''epoque Meta portent un wamid.';


--
-- Name: COLUMN whatsapp_messages.status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.whatsapp_messages.status IS 'queued -> sent -> delivered -> read, ou failed. « queued » = pris en charge par la passerelle, pas encore remis.';


--
-- Name: COLUMN whatsapp_messages.provider; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.whatsapp_messages.provider IS 'Transport utilise : « evolution » (passerelle auto-hebergee, actuel) ou « meta » (API Cloud, historique).';


--
-- Name: COLUMN whatsapp_messages.instance; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.whatsapp_messages.instance IS 'Nom de l''instance Evolution ayant envoye le message. Null pour les lignes d''epoque Meta.';


--
-- Name: whatsapp_outbox; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.whatsapp_outbox (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    recipient_phone text NOT NULL,
    recipient_display text,
    recipient_name text,
    student_id uuid,
    parent_id uuid,
    message_type text DEFAULT 'text'::text NOT NULL,
    body text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    last_error text,
    last_attempt_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    sent_at timestamp with time zone,
    abandoned_at timestamp with time zone,
    abandoned_reason text
);


--
-- Name: TABLE whatsapp_outbox; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.whatsapp_outbox IS 'File des messages WhatsApp. Deux attentes distinctes : « draft » attend un humain (rien ne part d''un badge sans relecture), « pending » attend seulement la passerelle et part tout seul a son retour.';


--
-- Name: COLUMN whatsapp_outbox.body; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.whatsapp_outbox.body IS 'Texte complet du message. Indispensable ici : whatsapp_messages ne le conserve pas, n''ayant jamais eu a renvoyer un message.';


--
-- Name: COLUMN whatsapp_outbox.status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.whatsapp_outbox.status IS 'draft (propose par un badge, attend une relecture sur le tableau de bord — le vidage automatique ne le regarde PAS) | pending (approuve par un humain, partira seul des que la passerelle repond) | sent (confie a la passerelle, suivi dans whatsapp_messages) | abandoned (ecarte a la main, trop de tentatives, ou trop ancien).';


--
-- Name: COLUMN whatsapp_outbox.attempts; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.whatsapp_outbox.attempts IS 'Incremente uniquement sur un echec propre au destinataire. Une passerelle injoignable ne consomme pas de tentative.';


--
-- Name: COLUMN whatsapp_outbox.abandoned_reason; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.whatsapp_outbox.abandoned_reason IS 'Pourquoi le message ne repartira plus : « trop de tentatives » ou « trop ancien ». Un rappel de solde vieux de plusieurs jours peut etre devenu faux.';


--
-- Name: worker_payments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.worker_payments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    worker_id uuid NOT NULL,
    amount integer DEFAULT 0 NOT NULL,
    method text DEFAULT 'monthly'::text NOT NULL,
    period_start date,
    period_end date,
    period_key text DEFAULT ''::text NOT NULL,
    days_count integer DEFAULT 0 NOT NULL,
    minutes integer DEFAULT 0 NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    details jsonb DEFAULT '[]'::jsonb NOT NULL,
    paid_at timestamp with time zone DEFAULT now() NOT NULL,
    cash_tx_id uuid,
    created_by uuid DEFAULT auth.uid(),
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: worker_shifts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.worker_shifts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    worker_id uuid NOT NULL,
    work_date date NOT NULL,
    start_at timestamp with time zone,
    end_at timestamp with time zone,
    minutes integer DEFAULT 0 NOT NULL,
    frozen boolean DEFAULT false NOT NULL,
    paid boolean DEFAULT false NOT NULL,
    payment_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    status text DEFAULT 'present'::text NOT NULL,
    source text DEFAULT 'scan'::text NOT NULL,
    notes text DEFAULT ''::text NOT NULL,
    absence_resolved boolean DEFAULT false NOT NULL,
    absence_cost integer DEFAULT 0 NOT NULL,
    absence_id uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: sync_deletions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sync_deletions ALTER COLUMN id SET DEFAULT nextval('public.sync_deletions_id_seq'::regclass);


--
-- Name: absence_penalties absence_penalties_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.absence_penalties
    ADD CONSTRAINT absence_penalties_pkey PRIMARY KEY (id);


--
-- Name: announcements announcements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.announcements
    ADD CONSTRAINT announcements_pkey PRIMARY KEY (id);


--
-- Name: attendance attendance_amount_nonnegative; Type: CHECK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE public.attendance
    ADD CONSTRAINT attendance_amount_nonnegative CHECK ((amount_deducted >= 0)) NOT VALID;


--
-- Name: attendance attendance_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance
    ADD CONSTRAINT attendance_pkey PRIMARY KEY (id);


--
-- Name: balance_tx balance_tx_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.balance_tx
    ADD CONSTRAINT balance_tx_pkey PRIMARY KEY (id);


--
-- Name: cash_transactions cash_transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_transactions
    ADD CONSTRAINT cash_transactions_pkey PRIMARY KEY (id);


--
-- Name: classes classes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.classes
    ADD CONSTRAINT classes_pkey PRIMARY KEY (id);


--
-- Name: coursework coursework_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coursework
    ADD CONSTRAINT coursework_pkey PRIMARY KEY (id);


--
-- Name: expense_categories expense_categories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expense_categories
    ADD CONSTRAINT expense_categories_pkey PRIMARY KEY (id);


--
-- Name: expenses expenses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expenses
    ADD CONSTRAINT expenses_pkey PRIMARY KEY (id);


--
-- Name: filieres filieres_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.filieres
    ADD CONSTRAINT filieres_pkey PRIMARY KEY (id);


--
-- Name: free_periods free_periods_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.free_periods
    ADD CONSTRAINT free_periods_pkey PRIMARY KEY (id);


--
-- Name: groups groups_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.groups
    ADD CONSTRAINT groups_pkey PRIMARY KEY (id);


--
-- Name: independent_sessions independent_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.independent_sessions
    ADD CONSTRAINT independent_sessions_pkey PRIMARY KEY (id);


--
-- Name: module_absence_rules module_absence_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.module_absence_rules
    ADD CONSTRAINT module_absence_rules_pkey PRIMARY KEY (module_id);


--
-- Name: modules modules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.modules
    ADD CONSTRAINT modules_pkey PRIMARY KEY (id);


--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);


--
-- Name: parents parents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.parents
    ADD CONSTRAINT parents_pkey PRIMARY KEY (id);


--
-- Name: private_session_modules private_session_modules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.private_session_modules
    ADD CONSTRAINT private_session_modules_pkey PRIMARY KEY (id);


--
-- Name: private_session_students private_session_students_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.private_session_students
    ADD CONSTRAINT private_session_students_pkey PRIMARY KEY (id);


--
-- Name: private_sessions private_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.private_sessions
    ADD CONSTRAINT private_sessions_pkey PRIMARY KEY (id);


--
-- Name: profiles profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);


--
-- Name: reception_staff reception_staff_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reception_staff
    ADD CONSTRAINT reception_staff_pkey PRIMARY KEY (id);


--
-- Name: reception_staff reception_staff_role_check; Type: CHECK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE public.reception_staff
    ADD CONSTRAINT reception_staff_role_check CHECK ((role = ANY (ARRAY['reception'::text, 'security'::text, 'menage'::text]))) NOT VALID;


--
-- Name: salles salles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.salles
    ADD CONSTRAINT salles_pkey PRIMARY KEY (id);


--
-- Name: school school_absence_week_start_day_check; Type: CHECK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE public.school
    ADD CONSTRAINT school_absence_week_start_day_check CHECK (((absence_week_start_day >= 0) AND (absence_week_start_day <= 6))) NOT VALID;


--
-- Name: school school_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.school
    ADD CONSTRAINT school_pkey PRIMARY KEY (id);


--
-- Name: sessions sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_pkey PRIMARY KEY (id);


--
-- Name: sessions sessions_time_format; Type: CHECK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE public.sessions
    ADD CONSTRAINT sessions_time_format CHECK (((start_time ~ '^[0-2][0-9]:[0-5][0-9]$'::text) AND (end_time ~ '^[0-2][0-9]:[0-5][0-9]$'::text) AND (end_time > start_time))) NOT VALID;


--
-- Name: student_credentials student_credentials_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_credentials
    ADD CONSTRAINT student_credentials_pkey PRIMARY KEY (student_id);


--
-- Name: student_subscriptions student_subscriptions_discount_type_check; Type: CHECK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE public.student_subscriptions
    ADD CONSTRAINT student_subscriptions_discount_type_check CHECK (((discount_type IS NULL) OR (discount_type = ANY (ARRAY['percent'::text, 'amount'::text])))) NOT VALID;


--
-- Name: student_subscriptions student_subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_subscriptions
    ADD CONSTRAINT student_subscriptions_pkey PRIMARY KEY (student_id, subscription_id);


--
-- Name: students students_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.students
    ADD CONSTRAINT students_pkey PRIMARY KEY (id);


--
-- Name: students students_rfid_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.students
    ADD CONSTRAINT students_rfid_key UNIQUE (rfid);


--
-- Name: subjects subjects_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subjects
    ADD CONSTRAINT subjects_pkey PRIMARY KEY (id);


--
-- Name: subscriptions subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_pkey PRIMARY KEY (id);


--
-- Name: sync_deletions sync_deletions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sync_deletions
    ADD CONSTRAINT sync_deletions_pkey PRIMARY KEY (id);


--
-- Name: teacher_absences teacher_absences_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teacher_absences
    ADD CONSTRAINT teacher_absences_pkey PRIMARY KEY (id);


--
-- Name: teacher_acomptes teacher_acomptes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teacher_acomptes
    ADD CONSTRAINT teacher_acomptes_pkey PRIMARY KEY (id);


--
-- Name: teacher_payments teacher_payments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teacher_payments
    ADD CONSTRAINT teacher_payments_pkey PRIMARY KEY (id);


--
-- Name: teachers teachers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teachers
    ADD CONSTRAINT teachers_pkey PRIMARY KEY (id);


--
-- Name: unpaid_teacher_sessions unpaid_teacher_sessions_amount_nonnegative; Type: CHECK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE public.unpaid_teacher_sessions
    ADD CONSTRAINT unpaid_teacher_sessions_amount_nonnegative CHECK ((amount >= 0)) NOT VALID;


--
-- Name: unpaid_teacher_sessions unpaid_teacher_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.unpaid_teacher_sessions
    ADD CONSTRAINT unpaid_teacher_sessions_pkey PRIMARY KEY (id);


--
-- Name: whatsapp_contacts whatsapp_contacts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.whatsapp_contacts
    ADD CONSTRAINT whatsapp_contacts_pkey PRIMARY KEY (phone);


--
-- Name: whatsapp_messages whatsapp_messages_message_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.whatsapp_messages
    ADD CONSTRAINT whatsapp_messages_message_id_key UNIQUE (message_id);


--
-- Name: whatsapp_messages whatsapp_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.whatsapp_messages
    ADD CONSTRAINT whatsapp_messages_pkey PRIMARY KEY (id);


--
-- Name: whatsapp_outbox whatsapp_outbox_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.whatsapp_outbox
    ADD CONSTRAINT whatsapp_outbox_pkey PRIMARY KEY (id);


--
-- Name: worker_payments worker_payments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.worker_payments
    ADD CONSTRAINT worker_payments_pkey PRIMARY KEY (id);


--
-- Name: worker_shifts worker_shifts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.worker_shifts
    ADD CONSTRAINT worker_shifts_pkey PRIMARY KEY (id);


--
-- Name: worker_shifts worker_shifts_source_check; Type: CHECK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE public.worker_shifts
    ADD CONSTRAINT worker_shifts_source_check CHECK ((source = ANY (ARRAY['scan'::text, 'manual'::text, 'auto'::text]))) NOT VALID;


--
-- Name: worker_shifts worker_shifts_status_check; Type: CHECK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE public.worker_shifts
    ADD CONSTRAINT worker_shifts_status_check CHECK ((status = ANY (ARRAY['present'::text, 'absent'::text]))) NOT VALID;


--
-- Name: worker_shifts worker_shifts_worker_id_work_date_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.worker_shifts
    ADD CONSTRAINT worker_shifts_worker_id_work_date_key UNIQUE (worker_id, work_date);


--
-- Name: absence_penalties_module_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX absence_penalties_module_id_idx ON public.absence_penalties USING btree (module_id);


--
-- Name: absence_penalties_once_per_week_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX absence_penalties_once_per_week_idx ON public.absence_penalties USING btree (student_id, subscription_id, period_end);


--
-- Name: absence_penalties_student_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX absence_penalties_student_id_idx ON public.absence_penalties USING btree (student_id);


--
-- Name: absence_penalties_updated_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX absence_penalties_updated_at_idx ON public.absence_penalties USING btree (updated_at);


--
-- Name: announcements_updated_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX announcements_updated_at_idx ON public.announcements USING btree (updated_at);


--
-- Name: attendance_free_period_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX attendance_free_period_idx ON public.attendance USING btree (free_period_id);


--
-- Name: attendance_occurred_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX attendance_occurred_at_idx ON public.attendance USING btree (occurred_at);


--
-- Name: attendance_once_per_day_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX attendance_once_per_day_idx ON public.attendance USING btree (student_id, session_id, ((timezone('Africa/Algiers'::text, occurred_at))::date));


--
-- Name: attendance_pre_start_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX attendance_pre_start_idx ON public.attendance USING btree (pre_start) WHERE pre_start;


--
-- Name: attendance_session_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX attendance_session_date_idx ON public.attendance USING btree (session_id, occurred_at DESC);


--
-- Name: attendance_session_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX attendance_session_id_idx ON public.attendance USING btree (session_id);


--
-- Name: attendance_student_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX attendance_student_id_idx ON public.attendance USING btree (student_id);


--
-- Name: attendance_updated_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX attendance_updated_at_idx ON public.attendance USING btree (updated_at);


--
-- Name: balance_tx_created_by_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX balance_tx_created_by_idx ON public.balance_tx USING btree (created_by, date);


--
-- Name: balance_tx_module_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX balance_tx_module_id_idx ON public.balance_tx USING btree (module_id);


--
-- Name: balance_tx_student_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX balance_tx_student_date_idx ON public.balance_tx USING btree (student_id, date DESC);


--
-- Name: balance_tx_student_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX balance_tx_student_id_idx ON public.balance_tx USING btree (student_id);


--
-- Name: balance_tx_updated_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX balance_tx_updated_at_idx ON public.balance_tx USING btree (updated_at);


--
-- Name: cash_transactions_created_by_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX cash_transactions_created_by_idx ON public.cash_transactions USING btree (created_by, date);


--
-- Name: cash_transactions_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX cash_transactions_date_idx ON public.cash_transactions USING btree (date DESC);


--
-- Name: cash_transactions_type_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX cash_transactions_type_date_idx ON public.cash_transactions USING btree (type, date DESC);


--
-- Name: cash_transactions_updated_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX cash_transactions_updated_at_idx ON public.cash_transactions USING btree (updated_at);


--
-- Name: classes_updated_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX classes_updated_at_idx ON public.classes USING btree (updated_at);


--
-- Name: coursework_updated_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX coursework_updated_at_idx ON public.coursework USING btree (updated_at);


--
-- Name: expense_categories_updated_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX expense_categories_updated_at_idx ON public.expense_categories USING btree (updated_at);


--
-- Name: expenses_category_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX expenses_category_id_idx ON public.expenses USING btree (category_id);


--
-- Name: expenses_updated_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX expenses_updated_at_idx ON public.expenses USING btree (updated_at);


--
-- Name: filieres_updated_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX filieres_updated_at_idx ON public.filieres USING btree (updated_at);


--
-- Name: free_periods_dates_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX free_periods_dates_idx ON public.free_periods USING btree (start_date, end_date);


--
-- Name: free_periods_updated_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX free_periods_updated_at_idx ON public.free_periods USING btree (updated_at);


--
-- Name: groups_updated_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX groups_updated_at_idx ON public.groups USING btree (updated_at);


--
-- Name: independent_sessions_created_by_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX independent_sessions_created_by_idx ON public.independent_sessions USING btree (created_by);


--
-- Name: independent_sessions_is_free_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX independent_sessions_is_free_idx ON public.independent_sessions USING btree (is_free);


--
-- Name: independent_sessions_session_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX independent_sessions_session_id_idx ON public.independent_sessions USING btree (session_id);


--
-- Name: independent_sessions_student_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX independent_sessions_student_id_idx ON public.independent_sessions USING btree (student_id);


--
-- Name: independent_sessions_teacher_due_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX independent_sessions_teacher_due_idx ON public.independent_sessions USING btree (session_id, date) WHERE (teacher_paid = false);


--
-- Name: independent_sessions_updated_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX independent_sessions_updated_at_idx ON public.independent_sessions USING btree (updated_at);


--
-- Name: module_absence_rules_updated_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX module_absence_rules_updated_at_idx ON public.module_absence_rules USING btree (updated_at);


--
-- Name: modules_updated_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX modules_updated_at_idx ON public.modules USING btree (updated_at);


--
-- Name: notifications_parent_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX notifications_parent_id_idx ON public.notifications USING btree (parent_id);


--
-- Name: notifications_updated_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX notifications_updated_at_idx ON public.notifications USING btree (updated_at);


--
-- Name: parents_updated_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX parents_updated_at_idx ON public.parents USING btree (updated_at);


--
-- Name: private_session_modules_parent_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX private_session_modules_parent_idx ON public.private_session_modules USING btree (private_session_id);


--
-- Name: private_session_modules_scheduled_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX private_session_modules_scheduled_idx ON public.private_session_modules USING btree (scheduled_at);


--
-- Name: private_session_modules_teacher_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX private_session_modules_teacher_idx ON public.private_session_modules USING btree (teacher_id, teacher_paid);


--
-- Name: private_session_modules_updated_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX private_session_modules_updated_at_idx ON public.private_session_modules USING btree (updated_at);


--
-- Name: private_session_students_parent_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX private_session_students_parent_idx ON public.private_session_students USING btree (private_session_id);


--
-- Name: private_session_students_student_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX private_session_students_student_idx ON public.private_session_students USING btree (student_id);


--
-- Name: private_session_students_updated_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX private_session_students_updated_at_idx ON public.private_session_students USING btree (updated_at);


--
-- Name: private_sessions_scheduled_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX private_sessions_scheduled_idx ON public.private_sessions USING btree (scheduled_at DESC);


--
-- Name: private_sessions_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX private_sessions_status_idx ON public.private_sessions USING btree (status, scheduled_at DESC);


--
-- Name: private_sessions_student_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX private_sessions_student_idx ON public.private_sessions USING btree (student_id);


--
-- Name: private_sessions_updated_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX private_sessions_updated_at_idx ON public.private_sessions USING btree (updated_at);


--
-- Name: profiles_updated_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX profiles_updated_at_idx ON public.profiles USING btree (updated_at);


--
-- Name: reception_staff_rfid_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX reception_staff_rfid_key ON public.reception_staff USING btree (rfid) WHERE (rfid IS NOT NULL);


--
-- Name: reception_staff_updated_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX reception_staff_updated_at_idx ON public.reception_staff USING btree (updated_at);


--
-- Name: salles_updated_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX salles_updated_at_idx ON public.salles USING btree (updated_at);


--
-- Name: school_updated_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX school_updated_at_idx ON public.school USING btree (updated_at);


--
-- Name: sessions_class_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sessions_class_id_idx ON public.sessions USING btree (class_id);


--
-- Name: sessions_course_key_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sessions_course_key_idx ON public.sessions USING btree (class_id, module_id, teacher_id);


--
-- Name: sessions_is_free_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sessions_is_free_idx ON public.sessions USING btree (is_free) WHERE is_free;


--
-- Name: sessions_is_open_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sessions_is_open_idx ON public.sessions USING btree (is_open);


--
-- Name: sessions_teacher_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sessions_teacher_id_idx ON public.sessions USING btree (teacher_id);


--
-- Name: sessions_updated_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sessions_updated_at_idx ON public.sessions USING btree (updated_at);


--
-- Name: student_credentials_updated_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX student_credentials_updated_at_idx ON public.student_credentials USING btree (updated_at);


--
-- Name: student_subscriptions_subscription_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX student_subscriptions_subscription_id_idx ON public.student_subscriptions USING btree (subscription_id);


--
-- Name: students_birthday_key_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX students_birthday_key_idx ON public.students USING btree (public.birthday_key(birth_date)) WHERE (birth_date IS NOT NULL);


--
-- Name: students_parent_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX students_parent_id_idx ON public.students USING btree (parent_id);


--
-- Name: students_rfid_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX students_rfid_idx ON public.students USING btree (rfid);


--
-- Name: students_updated_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX students_updated_at_idx ON public.students USING btree (updated_at);


--
-- Name: subjects_session_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX subjects_session_id_idx ON public.subjects USING btree (session_id);


--
-- Name: subjects_updated_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX subjects_updated_at_idx ON public.subjects USING btree (updated_at);


--
-- Name: subscriptions_session_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX subscriptions_session_id_idx ON public.subscriptions USING btree (session_id);


--
-- Name: subscriptions_updated_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX subscriptions_updated_at_idx ON public.subscriptions USING btree (updated_at);


--
-- Name: sync_deletions_deleted_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sync_deletions_deleted_at_idx ON public.sync_deletions USING btree (deleted_at);


--
-- Name: teacher_absences_payment_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX teacher_absences_payment_id_idx ON public.teacher_absences USING btree (payment_id);


--
-- Name: teacher_absences_staff_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX teacher_absences_staff_id_idx ON public.teacher_absences USING btree (staff_id);


--
-- Name: teacher_absences_updated_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX teacher_absences_updated_at_idx ON public.teacher_absences USING btree (updated_at);


--
-- Name: teacher_acomptes_payment_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX teacher_acomptes_payment_id_idx ON public.teacher_acomptes USING btree (payment_id);


--
-- Name: teacher_acomptes_staff_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX teacher_acomptes_staff_id_idx ON public.teacher_acomptes USING btree (staff_id);


--
-- Name: teacher_acomptes_updated_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX teacher_acomptes_updated_at_idx ON public.teacher_acomptes USING btree (updated_at);


--
-- Name: teacher_payments_paid_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX teacher_payments_paid_at_idx ON public.teacher_payments USING btree (paid_at DESC);


--
-- Name: teacher_payments_teacher_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX teacher_payments_teacher_id_idx ON public.teacher_payments USING btree (teacher_id);


--
-- Name: teacher_payments_updated_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX teacher_payments_updated_at_idx ON public.teacher_payments USING btree (updated_at);


--
-- Name: teachers_is_passager_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX teachers_is_passager_idx ON public.teachers USING btree (is_passager);


--
-- Name: teachers_updated_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX teachers_updated_at_idx ON public.teachers USING btree (updated_at);


--
-- Name: unpaid_teacher_sessions_session_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX unpaid_teacher_sessions_session_id_idx ON public.unpaid_teacher_sessions USING btree (session_id);


--
-- Name: unpaid_teacher_sessions_student_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX unpaid_teacher_sessions_student_id_idx ON public.unpaid_teacher_sessions USING btree (student_id);


--
-- Name: unpaid_teacher_sessions_teacher_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX unpaid_teacher_sessions_teacher_id_idx ON public.unpaid_teacher_sessions USING btree (teacher_id);


--
-- Name: unpaid_teacher_sessions_teacher_paid_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX unpaid_teacher_sessions_teacher_paid_idx ON public.unpaid_teacher_sessions USING btree (teacher_id, paid);


--
-- Name: unpaid_teacher_sessions_updated_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX unpaid_teacher_sessions_updated_at_idx ON public.unpaid_teacher_sessions USING btree (updated_at);


--
-- Name: whatsapp_messages_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX whatsapp_messages_created_at_idx ON public.whatsapp_messages USING btree (created_at DESC);


--
-- Name: whatsapp_messages_parent_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX whatsapp_messages_parent_id_idx ON public.whatsapp_messages USING btree (parent_id);


--
-- Name: whatsapp_messages_provider_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX whatsapp_messages_provider_idx ON public.whatsapp_messages USING btree (provider);


--
-- Name: whatsapp_messages_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX whatsapp_messages_status_idx ON public.whatsapp_messages USING btree (status);


--
-- Name: whatsapp_messages_student_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX whatsapp_messages_student_id_idx ON public.whatsapp_messages USING btree (student_id);


--
-- Name: whatsapp_outbox_pending_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX whatsapp_outbox_pending_idx ON public.whatsapp_outbox USING btree (status, created_at);


--
-- Name: whatsapp_outbox_student_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX whatsapp_outbox_student_id_idx ON public.whatsapp_outbox USING btree (student_id);


--
-- Name: worker_payments_period_key_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX worker_payments_period_key_uniq ON public.worker_payments USING btree (worker_id, period_key) WHERE (period_key <> ''::text);


--
-- Name: worker_payments_updated_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX worker_payments_updated_at_idx ON public.worker_payments USING btree (updated_at);


--
-- Name: worker_payments_worker_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX worker_payments_worker_id_idx ON public.worker_payments USING btree (worker_id, paid_at DESC);


--
-- Name: worker_shifts_paid_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX worker_shifts_paid_idx ON public.worker_shifts USING btree (worker_id, paid);


--
-- Name: worker_shifts_pending_absence_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX worker_shifts_pending_absence_idx ON public.worker_shifts USING btree (worker_id, work_date) WHERE ((status = 'absent'::text) AND (absence_resolved = false));


--
-- Name: worker_shifts_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX worker_shifts_status_idx ON public.worker_shifts USING btree (worker_id, status, work_date);


--
-- Name: worker_shifts_updated_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX worker_shifts_updated_at_idx ON public.worker_shifts USING btree (updated_at);


--
-- Name: worker_shifts_worker_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX worker_shifts_worker_id_idx ON public.worker_shifts USING btree (worker_id);


--
-- Name: sessions sessions_inherit_subscription; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER sessions_inherit_subscription AFTER INSERT ON public.sessions FOR EACH ROW EXECUTE FUNCTION public.session_inherit_subscription();


--
-- Name: subscriptions subscriptions_sync_siblings; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER subscriptions_sync_siblings AFTER INSERT OR UPDATE OF price_per_session, level_price, period_months ON public.subscriptions FOR EACH ROW EXECUTE FUNCTION public.subscription_sync_siblings();


--
-- Name: reception_staff trg_protect_reception_payment_fields; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_protect_reception_payment_fields BEFORE UPDATE ON public.reception_staff FOR EACH ROW EXECUTE FUNCTION public.protect_reception_payment_fields();


--
-- Name: students trg_protect_student_financial_fields; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_protect_student_financial_fields BEFORE UPDATE ON public.students FOR EACH ROW EXECUTE FUNCTION public.protect_student_financial_fields();


--
-- Name: teachers trg_protect_teacher_payment_fields; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_protect_teacher_payment_fields BEFORE UPDATE ON public.teachers FOR EACH ROW EXECUTE FUNCTION public.protect_teacher_payment_fields();


--
-- Name: absence_penalties trg_sync_record_deletion; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_sync_record_deletion AFTER DELETE ON public.absence_penalties FOR EACH ROW EXECUTE FUNCTION public.sync_record_deletion('id');


--
-- Name: announcements trg_sync_record_deletion; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_sync_record_deletion AFTER DELETE ON public.announcements FOR EACH ROW EXECUTE FUNCTION public.sync_record_deletion('id');


--
-- Name: attendance trg_sync_record_deletion; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_sync_record_deletion AFTER DELETE ON public.attendance FOR EACH ROW EXECUTE FUNCTION public.sync_record_deletion('id');


--
-- Name: balance_tx trg_sync_record_deletion; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_sync_record_deletion AFTER DELETE ON public.balance_tx FOR EACH ROW EXECUTE FUNCTION public.sync_record_deletion('id');


--
-- Name: cash_transactions trg_sync_record_deletion; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_sync_record_deletion AFTER DELETE ON public.cash_transactions FOR EACH ROW EXECUTE FUNCTION public.sync_record_deletion('id');


--
-- Name: classes trg_sync_record_deletion; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_sync_record_deletion AFTER DELETE ON public.classes FOR EACH ROW EXECUTE FUNCTION public.sync_record_deletion('id');


--
-- Name: coursework trg_sync_record_deletion; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_sync_record_deletion AFTER DELETE ON public.coursework FOR EACH ROW EXECUTE FUNCTION public.sync_record_deletion('id');


--
-- Name: expense_categories trg_sync_record_deletion; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_sync_record_deletion AFTER DELETE ON public.expense_categories FOR EACH ROW EXECUTE FUNCTION public.sync_record_deletion('id');


--
-- Name: expenses trg_sync_record_deletion; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_sync_record_deletion AFTER DELETE ON public.expenses FOR EACH ROW EXECUTE FUNCTION public.sync_record_deletion('id');


--
-- Name: filieres trg_sync_record_deletion; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_sync_record_deletion AFTER DELETE ON public.filieres FOR EACH ROW EXECUTE FUNCTION public.sync_record_deletion('id');


--
-- Name: free_periods trg_sync_record_deletion; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_sync_record_deletion AFTER DELETE ON public.free_periods FOR EACH ROW EXECUTE FUNCTION public.sync_record_deletion('id');


--
-- Name: groups trg_sync_record_deletion; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_sync_record_deletion AFTER DELETE ON public.groups FOR EACH ROW EXECUTE FUNCTION public.sync_record_deletion('id');


--
-- Name: independent_sessions trg_sync_record_deletion; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_sync_record_deletion AFTER DELETE ON public.independent_sessions FOR EACH ROW EXECUTE FUNCTION public.sync_record_deletion('id');


--
-- Name: module_absence_rules trg_sync_record_deletion; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_sync_record_deletion AFTER DELETE ON public.module_absence_rules FOR EACH ROW EXECUTE FUNCTION public.sync_record_deletion('module_id');


--
-- Name: modules trg_sync_record_deletion; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_sync_record_deletion AFTER DELETE ON public.modules FOR EACH ROW EXECUTE FUNCTION public.sync_record_deletion('id');


--
-- Name: notifications trg_sync_record_deletion; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_sync_record_deletion AFTER DELETE ON public.notifications FOR EACH ROW EXECUTE FUNCTION public.sync_record_deletion('id');


--
-- Name: parents trg_sync_record_deletion; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_sync_record_deletion AFTER DELETE ON public.parents FOR EACH ROW EXECUTE FUNCTION public.sync_record_deletion('id');


--
-- Name: private_session_modules trg_sync_record_deletion; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_sync_record_deletion AFTER DELETE ON public.private_session_modules FOR EACH ROW EXECUTE FUNCTION public.sync_record_deletion('id');


--
-- Name: private_session_students trg_sync_record_deletion; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_sync_record_deletion AFTER DELETE ON public.private_session_students FOR EACH ROW EXECUTE FUNCTION public.sync_record_deletion('id');


--
-- Name: private_sessions trg_sync_record_deletion; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_sync_record_deletion AFTER DELETE ON public.private_sessions FOR EACH ROW EXECUTE FUNCTION public.sync_record_deletion('id');


--
-- Name: profiles trg_sync_record_deletion; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_sync_record_deletion AFTER DELETE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.sync_record_deletion('id');


--
-- Name: reception_staff trg_sync_record_deletion; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_sync_record_deletion AFTER DELETE ON public.reception_staff FOR EACH ROW EXECUTE FUNCTION public.sync_record_deletion('id');


--
-- Name: salles trg_sync_record_deletion; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_sync_record_deletion AFTER DELETE ON public.salles FOR EACH ROW EXECUTE FUNCTION public.sync_record_deletion('id');


--
-- Name: sessions trg_sync_record_deletion; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_sync_record_deletion AFTER DELETE ON public.sessions FOR EACH ROW EXECUTE FUNCTION public.sync_record_deletion('id');


--
-- Name: student_credentials trg_sync_record_deletion; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_sync_record_deletion AFTER DELETE ON public.student_credentials FOR EACH ROW EXECUTE FUNCTION public.sync_record_deletion('student_id');


--
-- Name: students trg_sync_record_deletion; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_sync_record_deletion AFTER DELETE ON public.students FOR EACH ROW EXECUTE FUNCTION public.sync_record_deletion('id');


--
-- Name: subjects trg_sync_record_deletion; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_sync_record_deletion AFTER DELETE ON public.subjects FOR EACH ROW EXECUTE FUNCTION public.sync_record_deletion('id');


--
-- Name: subscriptions trg_sync_record_deletion; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_sync_record_deletion AFTER DELETE ON public.subscriptions FOR EACH ROW EXECUTE FUNCTION public.sync_record_deletion('id');


--
-- Name: teacher_absences trg_sync_record_deletion; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_sync_record_deletion AFTER DELETE ON public.teacher_absences FOR EACH ROW EXECUTE FUNCTION public.sync_record_deletion('id');


--
-- Name: teacher_acomptes trg_sync_record_deletion; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_sync_record_deletion AFTER DELETE ON public.teacher_acomptes FOR EACH ROW EXECUTE FUNCTION public.sync_record_deletion('id');


--
-- Name: teacher_payments trg_sync_record_deletion; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_sync_record_deletion AFTER DELETE ON public.teacher_payments FOR EACH ROW EXECUTE FUNCTION public.sync_record_deletion('id');


--
-- Name: teachers trg_sync_record_deletion; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_sync_record_deletion AFTER DELETE ON public.teachers FOR EACH ROW EXECUTE FUNCTION public.sync_record_deletion('id');


--
-- Name: unpaid_teacher_sessions trg_sync_record_deletion; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_sync_record_deletion AFTER DELETE ON public.unpaid_teacher_sessions FOR EACH ROW EXECUTE FUNCTION public.sync_record_deletion('id');


--
-- Name: worker_payments trg_sync_record_deletion; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_sync_record_deletion AFTER DELETE ON public.worker_payments FOR EACH ROW EXECUTE FUNCTION public.sync_record_deletion('id');


--
-- Name: worker_shifts trg_sync_record_deletion; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_sync_record_deletion AFTER DELETE ON public.worker_shifts FOR EACH ROW EXECUTE FUNCTION public.sync_record_deletion('id');


--
-- Name: students trg_sync_touch_parent; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_sync_touch_parent AFTER INSERT OR DELETE OR UPDATE OF parent_id ON public.students FOR EACH ROW EXECUTE FUNCTION public.sync_touch_parent_from_student();


--
-- Name: student_subscriptions trg_sync_touch_student; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_sync_touch_student AFTER INSERT OR DELETE OR UPDATE ON public.student_subscriptions FOR EACH ROW EXECUTE FUNCTION public.sync_touch_student_from_enrollment();


--
-- Name: absence_penalties trg_sync_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_sync_updated_at BEFORE INSERT OR UPDATE ON public.absence_penalties FOR EACH ROW EXECUTE FUNCTION public.sync_touch_updated_at();


--
-- Name: announcements trg_sync_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_sync_updated_at BEFORE INSERT OR UPDATE ON public.announcements FOR EACH ROW EXECUTE FUNCTION public.sync_touch_updated_at();


--
-- Name: attendance trg_sync_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_sync_updated_at BEFORE INSERT OR UPDATE ON public.attendance FOR EACH ROW EXECUTE FUNCTION public.sync_touch_updated_at();


--
-- Name: balance_tx trg_sync_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_sync_updated_at BEFORE INSERT OR UPDATE ON public.balance_tx FOR EACH ROW EXECUTE FUNCTION public.sync_touch_updated_at();


--
-- Name: cash_transactions trg_sync_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_sync_updated_at BEFORE INSERT OR UPDATE ON public.cash_transactions FOR EACH ROW EXECUTE FUNCTION public.sync_touch_updated_at();


--
-- Name: classes trg_sync_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_sync_updated_at BEFORE INSERT OR UPDATE ON public.classes FOR EACH ROW EXECUTE FUNCTION public.sync_touch_updated_at();


--
-- Name: coursework trg_sync_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_sync_updated_at BEFORE INSERT OR UPDATE ON public.coursework FOR EACH ROW EXECUTE FUNCTION public.sync_touch_updated_at();


--
-- Name: expense_categories trg_sync_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_sync_updated_at BEFORE INSERT OR UPDATE ON public.expense_categories FOR EACH ROW EXECUTE FUNCTION public.sync_touch_updated_at();


--
-- Name: expenses trg_sync_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_sync_updated_at BEFORE INSERT OR UPDATE ON public.expenses FOR EACH ROW EXECUTE FUNCTION public.sync_touch_updated_at();


--
-- Name: filieres trg_sync_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_sync_updated_at BEFORE INSERT OR UPDATE ON public.filieres FOR EACH ROW EXECUTE FUNCTION public.sync_touch_updated_at();


--
-- Name: free_periods trg_sync_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_sync_updated_at BEFORE INSERT OR UPDATE ON public.free_periods FOR EACH ROW EXECUTE FUNCTION public.sync_touch_updated_at();


--
-- Name: groups trg_sync_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_sync_updated_at BEFORE INSERT OR UPDATE ON public.groups FOR EACH ROW EXECUTE FUNCTION public.sync_touch_updated_at();


--
-- Name: independent_sessions trg_sync_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_sync_updated_at BEFORE INSERT OR UPDATE ON public.independent_sessions FOR EACH ROW EXECUTE FUNCTION public.sync_touch_updated_at();


--
-- Name: module_absence_rules trg_sync_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_sync_updated_at BEFORE INSERT OR UPDATE ON public.module_absence_rules FOR EACH ROW EXECUTE FUNCTION public.sync_touch_updated_at();


--
-- Name: modules trg_sync_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_sync_updated_at BEFORE INSERT OR UPDATE ON public.modules FOR EACH ROW EXECUTE FUNCTION public.sync_touch_updated_at();


--
-- Name: notifications trg_sync_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_sync_updated_at BEFORE INSERT OR UPDATE ON public.notifications FOR EACH ROW EXECUTE FUNCTION public.sync_touch_updated_at();


--
-- Name: parents trg_sync_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_sync_updated_at BEFORE INSERT OR UPDATE ON public.parents FOR EACH ROW EXECUTE FUNCTION public.sync_touch_updated_at();


--
-- Name: private_session_modules trg_sync_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_sync_updated_at BEFORE INSERT OR UPDATE ON public.private_session_modules FOR EACH ROW EXECUTE FUNCTION public.sync_touch_updated_at();


--
-- Name: private_session_students trg_sync_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_sync_updated_at BEFORE INSERT OR UPDATE ON public.private_session_students FOR EACH ROW EXECUTE FUNCTION public.sync_touch_updated_at();


--
-- Name: private_sessions trg_sync_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_sync_updated_at BEFORE INSERT OR UPDATE ON public.private_sessions FOR EACH ROW EXECUTE FUNCTION public.sync_touch_updated_at();


--
-- Name: profiles trg_sync_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_sync_updated_at BEFORE INSERT OR UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.sync_touch_updated_at();


--
-- Name: reception_staff trg_sync_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_sync_updated_at BEFORE INSERT OR UPDATE ON public.reception_staff FOR EACH ROW EXECUTE FUNCTION public.sync_touch_updated_at();


--
-- Name: salles trg_sync_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_sync_updated_at BEFORE INSERT OR UPDATE ON public.salles FOR EACH ROW EXECUTE FUNCTION public.sync_touch_updated_at();


--
-- Name: school trg_sync_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_sync_updated_at BEFORE INSERT OR UPDATE ON public.school FOR EACH ROW EXECUTE FUNCTION public.sync_touch_updated_at();


--
-- Name: sessions trg_sync_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_sync_updated_at BEFORE INSERT OR UPDATE ON public.sessions FOR EACH ROW EXECUTE FUNCTION public.sync_touch_updated_at();


--
-- Name: student_credentials trg_sync_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_sync_updated_at BEFORE INSERT OR UPDATE ON public.student_credentials FOR EACH ROW EXECUTE FUNCTION public.sync_touch_updated_at();


--
-- Name: students trg_sync_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_sync_updated_at BEFORE INSERT OR UPDATE ON public.students FOR EACH ROW EXECUTE FUNCTION public.sync_touch_updated_at();


--
-- Name: subjects trg_sync_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_sync_updated_at BEFORE INSERT OR UPDATE ON public.subjects FOR EACH ROW EXECUTE FUNCTION public.sync_touch_updated_at();


--
-- Name: subscriptions trg_sync_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_sync_updated_at BEFORE INSERT OR UPDATE ON public.subscriptions FOR EACH ROW EXECUTE FUNCTION public.sync_touch_updated_at();


--
-- Name: teacher_absences trg_sync_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_sync_updated_at BEFORE INSERT OR UPDATE ON public.teacher_absences FOR EACH ROW EXECUTE FUNCTION public.sync_touch_updated_at();


--
-- Name: teacher_acomptes trg_sync_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_sync_updated_at BEFORE INSERT OR UPDATE ON public.teacher_acomptes FOR EACH ROW EXECUTE FUNCTION public.sync_touch_updated_at();


--
-- Name: teacher_payments trg_sync_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_sync_updated_at BEFORE INSERT OR UPDATE ON public.teacher_payments FOR EACH ROW EXECUTE FUNCTION public.sync_touch_updated_at();


--
-- Name: teachers trg_sync_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_sync_updated_at BEFORE INSERT OR UPDATE ON public.teachers FOR EACH ROW EXECUTE FUNCTION public.sync_touch_updated_at();


--
-- Name: unpaid_teacher_sessions trg_sync_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_sync_updated_at BEFORE INSERT OR UPDATE ON public.unpaid_teacher_sessions FOR EACH ROW EXECUTE FUNCTION public.sync_touch_updated_at();


--
-- Name: worker_payments trg_sync_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_sync_updated_at BEFORE INSERT OR UPDATE ON public.worker_payments FOR EACH ROW EXECUTE FUNCTION public.sync_touch_updated_at();


--
-- Name: worker_shifts trg_sync_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_sync_updated_at BEFORE INSERT OR UPDATE ON public.worker_shifts FOR EACH ROW EXECUTE FUNCTION public.sync_touch_updated_at();


--
-- Name: absence_penalties absence_penalties_module_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.absence_penalties
    ADD CONSTRAINT absence_penalties_module_id_fkey FOREIGN KEY (module_id) REFERENCES public.modules(id) ON DELETE SET NULL;


--
-- Name: absence_penalties absence_penalties_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.absence_penalties
    ADD CONSTRAINT absence_penalties_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.sessions(id) ON DELETE SET NULL;


--
-- Name: absence_penalties absence_penalties_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.absence_penalties
    ADD CONSTRAINT absence_penalties_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(id) ON DELETE CASCADE;


--
-- Name: absence_penalties absence_penalties_subscription_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.absence_penalties
    ADD CONSTRAINT absence_penalties_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES public.subscriptions(id) ON DELETE SET NULL;


--
-- Name: attendance attendance_free_period_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance
    ADD CONSTRAINT attendance_free_period_id_fkey FOREIGN KEY (free_period_id) REFERENCES public.free_periods(id) ON DELETE SET NULL;


--
-- Name: attendance attendance_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance
    ADD CONSTRAINT attendance_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.sessions(id) ON DELETE CASCADE;


--
-- Name: attendance attendance_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance
    ADD CONSTRAINT attendance_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(id) ON DELETE CASCADE;


--
-- Name: balance_tx balance_tx_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.balance_tx
    ADD CONSTRAINT balance_tx_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: balance_tx balance_tx_module_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.balance_tx
    ADD CONSTRAINT balance_tx_module_id_fkey FOREIGN KEY (module_id) REFERENCES public.modules(id) ON DELETE SET NULL;


--
-- Name: balance_tx balance_tx_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.balance_tx
    ADD CONSTRAINT balance_tx_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(id) ON DELETE CASCADE;


--
-- Name: cash_transactions cash_transactions_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_transactions
    ADD CONSTRAINT cash_transactions_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: classes classes_filiere_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.classes
    ADD CONSTRAINT classes_filiere_id_fkey FOREIGN KEY (filiere_id) REFERENCES public.filieres(id) ON DELETE SET NULL;


--
-- Name: coursework coursework_teacher_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coursework
    ADD CONSTRAINT coursework_teacher_id_fkey FOREIGN KEY (teacher_id) REFERENCES public.teachers(id) ON DELETE SET NULL;


--
-- Name: expenses expenses_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expenses
    ADD CONSTRAINT expenses_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.expense_categories(id) ON DELETE SET NULL;


--
-- Name: independent_sessions independent_sessions_class_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.independent_sessions
    ADD CONSTRAINT independent_sessions_class_id_fkey FOREIGN KEY (class_id) REFERENCES public.classes(id) ON DELETE SET NULL;


--
-- Name: independent_sessions independent_sessions_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.independent_sessions
    ADD CONSTRAINT independent_sessions_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: independent_sessions independent_sessions_filiere_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.independent_sessions
    ADD CONSTRAINT independent_sessions_filiere_id_fkey FOREIGN KEY (filiere_id) REFERENCES public.filieres(id) ON DELETE SET NULL;


--
-- Name: independent_sessions independent_sessions_module_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.independent_sessions
    ADD CONSTRAINT independent_sessions_module_id_fkey FOREIGN KEY (module_id) REFERENCES public.modules(id) ON DELETE SET NULL;


--
-- Name: independent_sessions independent_sessions_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.independent_sessions
    ADD CONSTRAINT independent_sessions_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.sessions(id) ON DELETE SET NULL;


--
-- Name: independent_sessions independent_sessions_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.independent_sessions
    ADD CONSTRAINT independent_sessions_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(id) ON DELETE SET NULL;


--
-- Name: module_absence_rules module_absence_rules_module_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.module_absence_rules
    ADD CONSTRAINT module_absence_rules_module_id_fkey FOREIGN KEY (module_id) REFERENCES public.modules(id) ON DELETE CASCADE;


--
-- Name: notifications notifications_parent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.parents(id) ON DELETE CASCADE;


--
-- Name: parents parents_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.parents
    ADD CONSTRAINT parents_id_fkey FOREIGN KEY (id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: private_session_modules private_session_modules_module_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.private_session_modules
    ADD CONSTRAINT private_session_modules_module_id_fkey FOREIGN KEY (module_id) REFERENCES public.modules(id) ON DELETE RESTRICT;


--
-- Name: private_session_modules private_session_modules_private_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.private_session_modules
    ADD CONSTRAINT private_session_modules_private_session_id_fkey FOREIGN KEY (private_session_id) REFERENCES public.private_sessions(id) ON DELETE CASCADE;


--
-- Name: private_session_modules private_session_modules_teacher_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.private_session_modules
    ADD CONSTRAINT private_session_modules_teacher_id_fkey FOREIGN KEY (teacher_id) REFERENCES public.teachers(id) ON DELETE SET NULL;


--
-- Name: private_session_students private_session_students_class_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.private_session_students
    ADD CONSTRAINT private_session_students_class_id_fkey FOREIGN KEY (class_id) REFERENCES public.classes(id) ON DELETE SET NULL;


--
-- Name: private_session_students private_session_students_filiere_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.private_session_students
    ADD CONSTRAINT private_session_students_filiere_id_fkey FOREIGN KEY (filiere_id) REFERENCES public.filieres(id) ON DELETE SET NULL;


--
-- Name: private_session_students private_session_students_private_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.private_session_students
    ADD CONSTRAINT private_session_students_private_session_id_fkey FOREIGN KEY (private_session_id) REFERENCES public.private_sessions(id) ON DELETE CASCADE;


--
-- Name: private_session_students private_session_students_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.private_session_students
    ADD CONSTRAINT private_session_students_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(id) ON DELETE SET NULL;


--
-- Name: private_sessions private_sessions_class_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.private_sessions
    ADD CONSTRAINT private_sessions_class_id_fkey FOREIGN KEY (class_id) REFERENCES public.classes(id) ON DELETE SET NULL;


--
-- Name: private_sessions private_sessions_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.private_sessions
    ADD CONSTRAINT private_sessions_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: private_sessions private_sessions_filiere_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.private_sessions
    ADD CONSTRAINT private_sessions_filiere_id_fkey FOREIGN KEY (filiere_id) REFERENCES public.filieres(id) ON DELETE SET NULL;


--
-- Name: private_sessions private_sessions_receptionist_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.private_sessions
    ADD CONSTRAINT private_sessions_receptionist_id_fkey FOREIGN KEY (receptionist_id) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: private_sessions private_sessions_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.private_sessions
    ADD CONSTRAINT private_sessions_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(id) ON DELETE SET NULL;


--
-- Name: profiles profiles_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: sessions sessions_class_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_class_id_fkey FOREIGN KEY (class_id) REFERENCES public.classes(id) ON DELETE CASCADE;


--
-- Name: sessions sessions_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_group_id_fkey FOREIGN KEY (group_id) REFERENCES public.groups(id) ON DELETE RESTRICT;


--
-- Name: sessions sessions_module_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_module_id_fkey FOREIGN KEY (module_id) REFERENCES public.modules(id) ON DELETE RESTRICT;


--
-- Name: sessions sessions_salle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_salle_id_fkey FOREIGN KEY (salle_id) REFERENCES public.salles(id) ON DELETE RESTRICT;


--
-- Name: sessions sessions_teacher_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_teacher_id_fkey FOREIGN KEY (teacher_id) REFERENCES public.teachers(id) ON DELETE SET NULL;


--
-- Name: student_credentials student_credentials_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_credentials
    ADD CONSTRAINT student_credentials_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(id) ON DELETE CASCADE;


--
-- Name: student_subscriptions student_subscriptions_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_subscriptions
    ADD CONSTRAINT student_subscriptions_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(id) ON DELETE CASCADE;


--
-- Name: student_subscriptions student_subscriptions_subscription_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_subscriptions
    ADD CONSTRAINT student_subscriptions_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES public.subscriptions(id) ON DELETE CASCADE;


--
-- Name: students students_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.students
    ADD CONSTRAINT students_id_fkey FOREIGN KEY (id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: students students_parent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.students
    ADD CONSTRAINT students_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.parents(id) ON DELETE SET NULL;


--
-- Name: subjects subjects_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subjects
    ADD CONSTRAINT subjects_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.sessions(id) ON DELETE CASCADE;


--
-- Name: subscriptions subscriptions_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.sessions(id) ON DELETE CASCADE;


--
-- Name: teacher_absences teacher_absences_payment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teacher_absences
    ADD CONSTRAINT teacher_absences_payment_id_fkey FOREIGN KEY (payment_id) REFERENCES public.teacher_payments(id) ON DELETE SET NULL;


--
-- Name: teacher_acomptes teacher_acomptes_payment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teacher_acomptes
    ADD CONSTRAINT teacher_acomptes_payment_id_fkey FOREIGN KEY (payment_id) REFERENCES public.teacher_payments(id) ON DELETE SET NULL;


--
-- Name: teacher_payments teacher_payments_cash_tx_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teacher_payments
    ADD CONSTRAINT teacher_payments_cash_tx_id_fkey FOREIGN KEY (cash_tx_id) REFERENCES public.cash_transactions(id) ON DELETE SET NULL;


--
-- Name: teacher_payments teacher_payments_teacher_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teacher_payments
    ADD CONSTRAINT teacher_payments_teacher_id_fkey FOREIGN KEY (teacher_id) REFERENCES public.teachers(id) ON DELETE CASCADE;


--
-- Name: unpaid_teacher_sessions unpaid_teacher_sessions_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.unpaid_teacher_sessions
    ADD CONSTRAINT unpaid_teacher_sessions_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.sessions(id) ON DELETE CASCADE;


--
-- Name: unpaid_teacher_sessions unpaid_teacher_sessions_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.unpaid_teacher_sessions
    ADD CONSTRAINT unpaid_teacher_sessions_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(id) ON DELETE CASCADE;


--
-- Name: unpaid_teacher_sessions unpaid_teacher_sessions_teacher_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.unpaid_teacher_sessions
    ADD CONSTRAINT unpaid_teacher_sessions_teacher_id_fkey FOREIGN KEY (teacher_id) REFERENCES public.teachers(id) ON DELETE CASCADE;


--
-- Name: whatsapp_messages whatsapp_messages_parent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.whatsapp_messages
    ADD CONSTRAINT whatsapp_messages_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.parents(id) ON DELETE SET NULL;


--
-- Name: whatsapp_messages whatsapp_messages_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.whatsapp_messages
    ADD CONSTRAINT whatsapp_messages_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(id) ON DELETE SET NULL;


--
-- Name: whatsapp_outbox whatsapp_outbox_parent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.whatsapp_outbox
    ADD CONSTRAINT whatsapp_outbox_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.parents(id) ON DELETE SET NULL;


--
-- Name: whatsapp_outbox whatsapp_outbox_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.whatsapp_outbox
    ADD CONSTRAINT whatsapp_outbox_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(id) ON DELETE SET NULL;


--
-- Name: worker_payments worker_payments_cash_tx_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.worker_payments
    ADD CONSTRAINT worker_payments_cash_tx_id_fkey FOREIGN KEY (cash_tx_id) REFERENCES public.cash_transactions(id) ON DELETE SET NULL;


--
-- Name: worker_payments worker_payments_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.worker_payments
    ADD CONSTRAINT worker_payments_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: worker_payments worker_payments_worker_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.worker_payments
    ADD CONSTRAINT worker_payments_worker_id_fkey FOREIGN KEY (worker_id) REFERENCES public.reception_staff(id) ON DELETE CASCADE;


--
-- Name: worker_shifts worker_shifts_absence_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.worker_shifts
    ADD CONSTRAINT worker_shifts_absence_id_fkey FOREIGN KEY (absence_id) REFERENCES public.teacher_absences(id) ON DELETE SET NULL;


--
-- Name: worker_shifts worker_shifts_payment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.worker_shifts
    ADD CONSTRAINT worker_shifts_payment_id_fkey FOREIGN KEY (payment_id) REFERENCES public.worker_payments(id) ON DELETE SET NULL NOT VALID;


--
-- Name: worker_shifts worker_shifts_worker_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.worker_shifts
    ADD CONSTRAINT worker_shifts_worker_id_fkey FOREIGN KEY (worker_id) REFERENCES public.reception_staff(id) ON DELETE CASCADE;


--
-- Name: absence_penalties; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.absence_penalties ENABLE ROW LEVEL SECURITY;

--
-- Name: absence_penalties absence_penalties_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY absence_penalties_select ON public.absence_penalties FOR SELECT TO authenticated USING ((( SELECT public.is_staff() AS is_staff) OR (student_id = ( SELECT auth.uid() AS uid)) OR public.is_my_child(student_id) OR public.teaches_student(student_id)));


--
-- Name: absence_penalties absence_penalties_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY absence_penalties_write ON public.absence_penalties TO authenticated USING (( SELECT public.is_staff() AS is_staff)) WITH CHECK (( SELECT public.is_staff() AS is_staff));


--
-- Name: announcements; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;

--
-- Name: announcements announcements_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY announcements_select ON public.announcements FOR SELECT TO authenticated USING ((( SELECT public.is_staff() AS is_staff) OR (public.sees_announcement_groups(target_group_ids) AND ((audience = 'all'::public.audience_type) OR ((audience = 'students'::public.audience_type) AND (( SELECT public."current_role"() AS "current_role") = 'student'::public.user_role)) OR ((audience = 'teachers'::public.audience_type) AND (( SELECT public."current_role"() AS "current_role") = 'teacher'::public.user_role)) OR ((audience = 'parents'::public.audience_type) AND (( SELECT public."current_role"() AS "current_role") = 'parent'::public.user_role)) OR (include_parents AND (( SELECT public."current_role"() AS "current_role") = 'parent'::public.user_role) AND (COALESCE(array_length(target_group_ids, 1), 0) > 0))))));


--
-- Name: announcements announcements_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY announcements_write ON public.announcements TO authenticated USING (( SELECT public.is_staff() AS is_staff)) WITH CHECK (( SELECT public.is_staff() AS is_staff));


--
-- Name: attendance; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.attendance ENABLE ROW LEVEL SECURITY;

--
-- Name: attendance attendance_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY attendance_select ON public.attendance FOR SELECT TO authenticated USING ((( SELECT public.is_staff() AS is_staff) OR (student_id = ( SELECT auth.uid() AS uid)) OR public.is_my_child(student_id) OR public.teaches_session(session_id)));


--
-- Name: attendance attendance_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY attendance_write ON public.attendance TO authenticated USING ((( SELECT public.is_staff() AS is_staff) OR public.teaches_session(session_id))) WITH CHECK ((( SELECT public.is_staff() AS is_staff) OR public.teaches_session(session_id)));


--
-- Name: balance_tx; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.balance_tx ENABLE ROW LEVEL SECURITY;

--
-- Name: balance_tx balance_tx_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY balance_tx_select ON public.balance_tx FOR SELECT TO authenticated USING ((( SELECT public.is_staff() AS is_staff) OR (student_id = ( SELECT auth.uid() AS uid)) OR public.is_my_child(student_id) OR public.teaches_student(student_id)));


--
-- Name: balance_tx balance_tx_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY balance_tx_write ON public.balance_tx TO authenticated USING (( SELECT public.is_staff() AS is_staff)) WITH CHECK (( SELECT public.is_staff() AS is_staff));


--
-- Name: cash_transactions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.cash_transactions ENABLE ROW LEVEL SECURITY;

--
-- Name: cash_transactions cash_transactions_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY cash_transactions_all ON public.cash_transactions TO authenticated USING (( SELECT public.is_staff() AS is_staff)) WITH CHECK (( SELECT public.is_staff() AS is_staff));


--
-- Name: classes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.classes ENABLE ROW LEVEL SECURITY;

--
-- Name: classes classes_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY classes_select ON public.classes FOR SELECT TO authenticated USING (true);


--
-- Name: classes classes_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY classes_write ON public.classes TO authenticated USING (( SELECT public.is_staff() AS is_staff)) WITH CHECK (( SELECT public.is_staff() AS is_staff));


--
-- Name: coursework; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.coursework ENABLE ROW LEVEL SECURITY;

--
-- Name: coursework coursework_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY coursework_select ON public.coursework FOR SELECT TO authenticated USING ((( SELECT public.is_staff() AS is_staff) OR (teacher_id = ( SELECT auth.uid() AS uid))));


--
-- Name: coursework coursework_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY coursework_write ON public.coursework TO authenticated USING (( SELECT public.is_staff() AS is_staff)) WITH CHECK (( SELECT public.is_staff() AS is_staff));


--
-- Name: expense_categories; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.expense_categories ENABLE ROW LEVEL SECURITY;

--
-- Name: expense_categories expense_categories_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY expense_categories_all ON public.expense_categories TO authenticated USING (( SELECT public.is_staff() AS is_staff)) WITH CHECK (( SELECT public.is_staff() AS is_staff));


--
-- Name: expenses; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;

--
-- Name: expenses expenses_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY expenses_all ON public.expenses TO authenticated USING (( SELECT public.is_staff() AS is_staff)) WITH CHECK (( SELECT public.is_staff() AS is_staff));


--
-- Name: filieres; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.filieres ENABLE ROW LEVEL SECURITY;

--
-- Name: filieres filieres_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY filieres_select ON public.filieres FOR SELECT TO authenticated USING (true);


--
-- Name: filieres filieres_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY filieres_write ON public.filieres TO authenticated USING (( SELECT public.is_staff() AS is_staff)) WITH CHECK (( SELECT public.is_staff() AS is_staff));


--
-- Name: free_periods; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.free_periods ENABLE ROW LEVEL SECURITY;

--
-- Name: free_periods free_periods_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY free_periods_select ON public.free_periods FOR SELECT TO authenticated USING (true);


--
-- Name: free_periods free_periods_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY free_periods_write ON public.free_periods TO authenticated USING (( SELECT public.is_staff() AS is_staff)) WITH CHECK (( SELECT public.is_staff() AS is_staff));


--
-- Name: groups; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.groups ENABLE ROW LEVEL SECURITY;

--
-- Name: groups groups_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY groups_select ON public.groups FOR SELECT TO authenticated USING (true);


--
-- Name: groups groups_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY groups_write ON public.groups TO authenticated USING (( SELECT public.is_staff() AS is_staff)) WITH CHECK (( SELECT public.is_staff() AS is_staff));


--
-- Name: independent_sessions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.independent_sessions ENABLE ROW LEVEL SECURITY;

--
-- Name: independent_sessions independent_sessions_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY independent_sessions_all ON public.independent_sessions TO authenticated USING (( SELECT public.is_staff() AS is_staff)) WITH CHECK (( SELECT public.is_staff() AS is_staff));


--
-- Name: module_absence_rules; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.module_absence_rules ENABLE ROW LEVEL SECURITY;

--
-- Name: module_absence_rules module_absence_rules_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY module_absence_rules_select ON public.module_absence_rules FOR SELECT TO authenticated USING (true);


--
-- Name: module_absence_rules module_absence_rules_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY module_absence_rules_write ON public.module_absence_rules TO authenticated USING (( SELECT public.is_staff() AS is_staff)) WITH CHECK (( SELECT public.is_staff() AS is_staff));


--
-- Name: modules; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.modules ENABLE ROW LEVEL SECURITY;

--
-- Name: modules modules_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY modules_select ON public.modules FOR SELECT TO authenticated USING (true);


--
-- Name: modules modules_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY modules_write ON public.modules TO authenticated USING (( SELECT public.is_staff() AS is_staff)) WITH CHECK (( SELECT public.is_staff() AS is_staff));


--
-- Name: notifications; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

--
-- Name: notifications notifications_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY notifications_delete ON public.notifications FOR DELETE TO authenticated USING (( SELECT public.is_staff() AS is_staff));


--
-- Name: notifications notifications_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY notifications_insert ON public.notifications FOR INSERT TO authenticated WITH CHECK (( SELECT public.is_staff() AS is_staff));


--
-- Name: notifications notifications_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY notifications_select ON public.notifications FOR SELECT TO authenticated USING ((( SELECT public.is_staff() AS is_staff) OR (parent_id = ( SELECT auth.uid() AS uid))));


--
-- Name: notifications notifications_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY notifications_update ON public.notifications FOR UPDATE TO authenticated USING ((( SELECT public.is_staff() AS is_staff) OR (parent_id = ( SELECT auth.uid() AS uid)))) WITH CHECK ((( SELECT public.is_staff() AS is_staff) OR (parent_id = ( SELECT auth.uid() AS uid))));


--
-- Name: parents; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.parents ENABLE ROW LEVEL SECURITY;

--
-- Name: parents parents_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY parents_delete ON public.parents FOR DELETE TO authenticated USING (( SELECT public.is_staff() AS is_staff));


--
-- Name: parents parents_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY parents_insert ON public.parents FOR INSERT TO authenticated WITH CHECK (( SELECT public.is_staff() AS is_staff));


--
-- Name: parents parents_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY parents_select ON public.parents FOR SELECT TO authenticated USING ((( SELECT public.is_staff() AS is_staff) OR (id = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
   FROM public.students st
  WHERE ((st.parent_id = parents.id) AND (st.id = ( SELECT auth.uid() AS uid)))))));


--
-- Name: parents parents_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY parents_update ON public.parents FOR UPDATE TO authenticated USING ((( SELECT public.is_staff() AS is_staff) OR (id = ( SELECT auth.uid() AS uid)))) WITH CHECK ((( SELECT public.is_staff() AS is_staff) OR (id = ( SELECT auth.uid() AS uid))));


--
-- Name: private_session_modules; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.private_session_modules ENABLE ROW LEVEL SECURITY;

--
-- Name: private_session_modules private_session_modules_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY private_session_modules_select ON public.private_session_modules FOR SELECT TO authenticated USING ((( SELECT public.is_staff() AS is_staff) OR (teacher_id = ( SELECT auth.uid() AS uid)) OR public.attends_private_session(private_session_id)));


--
-- Name: private_session_modules private_session_modules_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY private_session_modules_write ON public.private_session_modules TO authenticated USING (( SELECT public.is_staff() AS is_staff)) WITH CHECK (( SELECT public.is_staff() AS is_staff));


--
-- Name: private_session_students; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.private_session_students ENABLE ROW LEVEL SECURITY;

--
-- Name: private_session_students private_session_students_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY private_session_students_select ON public.private_session_students FOR SELECT TO authenticated USING ((( SELECT public.is_staff() AS is_staff) OR (student_id = ( SELECT auth.uid() AS uid)) OR public.is_my_child(student_id) OR public.teaches_private_session(private_session_id)));


--
-- Name: private_session_students private_session_students_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY private_session_students_write ON public.private_session_students TO authenticated USING (( SELECT public.is_staff() AS is_staff)) WITH CHECK (( SELECT public.is_staff() AS is_staff));


--
-- Name: private_sessions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.private_sessions ENABLE ROW LEVEL SECURITY;

--
-- Name: private_sessions private_sessions_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY private_sessions_select ON public.private_sessions FOR SELECT TO authenticated USING ((( SELECT public.is_staff() AS is_staff) OR (student_id = ( SELECT auth.uid() AS uid)) OR public.is_my_child(student_id) OR public.teaches_private_session(id) OR public.attends_private_session(id)));


--
-- Name: private_sessions private_sessions_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY private_sessions_write ON public.private_sessions TO authenticated USING (( SELECT public.is_staff() AS is_staff)) WITH CHECK (( SELECT public.is_staff() AS is_staff));


--
-- Name: profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: profiles profiles_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY profiles_select ON public.profiles FOR SELECT TO authenticated USING (((id = ( SELECT auth.uid() AS uid)) OR ( SELECT public.is_staff() AS is_staff)));


--
-- Name: profiles profiles_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY profiles_update ON public.profiles FOR UPDATE TO authenticated USING (((id = ( SELECT auth.uid() AS uid)) OR ( SELECT public.is_admin() AS is_admin))) WITH CHECK (((id = ( SELECT auth.uid() AS uid)) OR ( SELECT public.is_admin() AS is_admin)));


--
-- Name: reception_staff; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.reception_staff ENABLE ROW LEVEL SECURITY;

--
-- Name: reception_staff reception_staff_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY reception_staff_delete ON public.reception_staff FOR DELETE TO authenticated USING (( SELECT public.is_staff() AS is_staff));


--
-- Name: reception_staff reception_staff_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY reception_staff_insert ON public.reception_staff FOR INSERT TO authenticated WITH CHECK (( SELECT public.is_staff() AS is_staff));


--
-- Name: reception_staff reception_staff_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY reception_staff_select ON public.reception_staff FOR SELECT TO authenticated USING ((( SELECT public.is_staff() AS is_staff) OR (id = ( SELECT auth.uid() AS uid))));


--
-- Name: reception_staff reception_staff_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY reception_staff_update ON public.reception_staff FOR UPDATE TO authenticated USING ((( SELECT public.is_staff() AS is_staff) OR (id = ( SELECT auth.uid() AS uid)))) WITH CHECK ((( SELECT public.is_staff() AS is_staff) OR (id = ( SELECT auth.uid() AS uid))));


--
-- Name: salles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.salles ENABLE ROW LEVEL SECURITY;

--
-- Name: salles salles_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY salles_select ON public.salles FOR SELECT TO authenticated USING (true);


--
-- Name: salles salles_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY salles_write ON public.salles TO authenticated USING (( SELECT public.is_staff() AS is_staff)) WITH CHECK (( SELECT public.is_staff() AS is_staff));


--
-- Name: school; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.school ENABLE ROW LEVEL SECURITY;

--
-- Name: school school_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY school_select ON public.school FOR SELECT USING (true);


--
-- Name: school school_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY school_write ON public.school TO authenticated USING (( SELECT public.is_admin() AS is_admin)) WITH CHECK (( SELECT public.is_admin() AS is_admin));


--
-- Name: sessions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;

--
-- Name: sessions sessions_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY sessions_select ON public.sessions FOR SELECT TO authenticated USING (true);


--
-- Name: sessions sessions_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY sessions_write ON public.sessions TO authenticated USING (( SELECT public.is_staff() AS is_staff)) WITH CHECK (( SELECT public.is_staff() AS is_staff));


--
-- Name: student_credentials; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.student_credentials ENABLE ROW LEVEL SECURITY;

--
-- Name: student_credentials student_credentials_staff; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY student_credentials_staff ON public.student_credentials TO authenticated USING (( SELECT public.is_staff() AS is_staff)) WITH CHECK (( SELECT public.is_staff() AS is_staff));


--
-- Name: student_subscriptions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.student_subscriptions ENABLE ROW LEVEL SECURITY;

--
-- Name: student_subscriptions student_subscriptions_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY student_subscriptions_select ON public.student_subscriptions FOR SELECT TO authenticated USING (true);


--
-- Name: student_subscriptions student_subscriptions_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY student_subscriptions_write ON public.student_subscriptions TO authenticated USING (( SELECT public.is_staff() AS is_staff)) WITH CHECK (( SELECT public.is_staff() AS is_staff));


--
-- Name: students; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.students ENABLE ROW LEVEL SECURITY;

--
-- Name: students students_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY students_delete ON public.students FOR DELETE TO authenticated USING (( SELECT public.is_staff() AS is_staff));


--
-- Name: students students_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY students_insert ON public.students FOR INSERT TO authenticated WITH CHECK (( SELECT public.is_staff() AS is_staff));


--
-- Name: students students_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY students_select ON public.students FOR SELECT TO authenticated USING ((( SELECT public.is_staff() AS is_staff) OR (id = ( SELECT auth.uid() AS uid)) OR (parent_id = ( SELECT auth.uid() AS uid)) OR public.teaches_student(id)));


--
-- Name: students students_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY students_update ON public.students FOR UPDATE TO authenticated USING ((( SELECT public.is_staff() AS is_staff) OR (id = ( SELECT auth.uid() AS uid)))) WITH CHECK ((( SELECT public.is_staff() AS is_staff) OR (id = ( SELECT auth.uid() AS uid))));


--
-- Name: subjects; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.subjects ENABLE ROW LEVEL SECURITY;

--
-- Name: subjects subjects_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY subjects_select ON public.subjects FOR SELECT TO authenticated USING (true);


--
-- Name: subjects subjects_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY subjects_write ON public.subjects TO authenticated USING ((( SELECT public.is_staff() AS is_staff) OR public.teaches_session(session_id))) WITH CHECK ((( SELECT public.is_staff() AS is_staff) OR public.teaches_session(session_id)));


--
-- Name: subscriptions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

--
-- Name: subscriptions subscriptions_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY subscriptions_select ON public.subscriptions FOR SELECT TO authenticated USING (true);


--
-- Name: subscriptions subscriptions_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY subscriptions_write ON public.subscriptions TO authenticated USING (( SELECT public.is_staff() AS is_staff)) WITH CHECK (( SELECT public.is_staff() AS is_staff));


--
-- Name: sync_deletions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sync_deletions ENABLE ROW LEVEL SECURITY;

--
-- Name: sync_deletions sync_deletions_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY sync_deletions_select ON public.sync_deletions FOR SELECT TO authenticated USING (true);


--
-- Name: teacher_absences; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.teacher_absences ENABLE ROW LEVEL SECURITY;

--
-- Name: teacher_absences teacher_absences_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY teacher_absences_select ON public.teacher_absences FOR SELECT TO authenticated USING ((( SELECT public.is_staff() AS is_staff) OR (staff_id = ( SELECT auth.uid() AS uid))));


--
-- Name: teacher_absences teacher_absences_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY teacher_absences_write ON public.teacher_absences TO authenticated USING (( SELECT public.is_staff() AS is_staff)) WITH CHECK (( SELECT public.is_staff() AS is_staff));


--
-- Name: teacher_acomptes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.teacher_acomptes ENABLE ROW LEVEL SECURITY;

--
-- Name: teacher_acomptes teacher_acomptes_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY teacher_acomptes_select ON public.teacher_acomptes FOR SELECT TO authenticated USING ((( SELECT public.is_staff() AS is_staff) OR (staff_id = ( SELECT auth.uid() AS uid))));


--
-- Name: teacher_acomptes teacher_acomptes_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY teacher_acomptes_write ON public.teacher_acomptes TO authenticated USING (( SELECT public.is_staff() AS is_staff)) WITH CHECK (( SELECT public.is_staff() AS is_staff));


--
-- Name: teacher_payments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.teacher_payments ENABLE ROW LEVEL SECURITY;

--
-- Name: teacher_payments teacher_payments_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY teacher_payments_select ON public.teacher_payments FOR SELECT TO authenticated USING ((( SELECT public.is_staff() AS is_staff) OR (teacher_id = ( SELECT auth.uid() AS uid))));


--
-- Name: teacher_payments teacher_payments_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY teacher_payments_write ON public.teacher_payments TO authenticated USING (( SELECT public.is_staff() AS is_staff)) WITH CHECK (( SELECT public.is_staff() AS is_staff));


--
-- Name: teachers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.teachers ENABLE ROW LEVEL SECURITY;

--
-- Name: teachers teachers_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY teachers_delete ON public.teachers FOR DELETE TO authenticated USING (( SELECT public.is_staff() AS is_staff));


--
-- Name: teachers teachers_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY teachers_insert ON public.teachers FOR INSERT TO authenticated WITH CHECK (( SELECT public.is_staff() AS is_staff));


--
-- Name: teachers teachers_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY teachers_select ON public.teachers FOR SELECT TO authenticated USING (true);


--
-- Name: teachers teachers_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY teachers_update ON public.teachers FOR UPDATE TO authenticated USING ((( SELECT public.is_staff() AS is_staff) OR (id = ( SELECT auth.uid() AS uid)))) WITH CHECK ((( SELECT public.is_staff() AS is_staff) OR (id = ( SELECT auth.uid() AS uid))));


--
-- Name: unpaid_teacher_sessions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.unpaid_teacher_sessions ENABLE ROW LEVEL SECURITY;

--
-- Name: unpaid_teacher_sessions unpaid_teacher_sessions_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY unpaid_teacher_sessions_select ON public.unpaid_teacher_sessions FOR SELECT TO authenticated USING ((( SELECT public.is_staff() AS is_staff) OR (teacher_id = ( SELECT auth.uid() AS uid))));


--
-- Name: unpaid_teacher_sessions unpaid_teacher_sessions_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY unpaid_teacher_sessions_write ON public.unpaid_teacher_sessions TO authenticated USING (( SELECT public.is_staff() AS is_staff)) WITH CHECK (( SELECT public.is_staff() AS is_staff));


--
-- Name: whatsapp_contacts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.whatsapp_contacts ENABLE ROW LEVEL SECURITY;

--
-- Name: whatsapp_contacts whatsapp_contacts_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY whatsapp_contacts_all ON public.whatsapp_contacts TO authenticated USING (( SELECT public.is_staff() AS is_staff)) WITH CHECK (( SELECT public.is_staff() AS is_staff));


--
-- Name: whatsapp_messages; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.whatsapp_messages ENABLE ROW LEVEL SECURITY;

--
-- Name: whatsapp_messages whatsapp_messages_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY whatsapp_messages_all ON public.whatsapp_messages TO authenticated USING (( SELECT public.is_staff() AS is_staff)) WITH CHECK (( SELECT public.is_staff() AS is_staff));


--
-- Name: whatsapp_outbox; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.whatsapp_outbox ENABLE ROW LEVEL SECURITY;

--
-- Name: whatsapp_outbox whatsapp_outbox_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY whatsapp_outbox_all ON public.whatsapp_outbox TO authenticated USING (( SELECT public.is_staff() AS is_staff)) WITH CHECK (( SELECT public.is_staff() AS is_staff));


--
-- Name: worker_payments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.worker_payments ENABLE ROW LEVEL SECURITY;

--
-- Name: worker_payments worker_payments_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY worker_payments_select ON public.worker_payments FOR SELECT TO authenticated USING ((( SELECT public.is_staff() AS is_staff) OR (worker_id = ( SELECT auth.uid() AS uid))));


--
-- Name: worker_payments worker_payments_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY worker_payments_write ON public.worker_payments TO authenticated USING (( SELECT public.is_staff() AS is_staff)) WITH CHECK (( SELECT public.is_staff() AS is_staff));


--
-- Name: worker_shifts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.worker_shifts ENABLE ROW LEVEL SECURITY;

--
-- Name: worker_shifts worker_shifts_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY worker_shifts_select ON public.worker_shifts FOR SELECT TO authenticated USING ((( SELECT public.is_staff() AS is_staff) OR (worker_id = ( SELECT auth.uid() AS uid))));


--
-- Name: worker_shifts worker_shifts_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY worker_shifts_write ON public.worker_shifts TO authenticated USING (( SELECT public.is_staff() AS is_staff)) WITH CHECK (( SELECT public.is_staff() AS is_staff));


--
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: -
--

GRANT USAGE ON SCHEMA public TO postgres;
GRANT USAGE ON SCHEMA public TO anon;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO service_role;


--
-- Name: TABLE free_periods; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.free_periods TO anon;
GRANT ALL ON TABLE public.free_periods TO authenticated;
GRANT ALL ON TABLE public.free_periods TO service_role;


--
-- Name: FUNCTION active_free_period(p_class_ids uuid[], p_date date); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.active_free_period(p_class_ids uuid[], p_date date) TO anon;
GRANT ALL ON FUNCTION public.active_free_period(p_class_ids uuid[], p_date date) TO authenticated;
GRANT ALL ON FUNCTION public.active_free_period(p_class_ids uuid[], p_date date) TO service_role;


--
-- Name: FUNCTION add_student_balance(p_student_id uuid, p_amount integer, p_description text, p_settle_registration boolean); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.add_student_balance(p_student_id uuid, p_amount integer, p_description text, p_settle_registration boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.add_student_balance(p_student_id uuid, p_amount integer, p_description text, p_settle_registration boolean) TO authenticated;
GRANT ALL ON FUNCTION public.add_student_balance(p_student_id uuid, p_amount integer, p_description text, p_settle_registration boolean) TO service_role;


--
-- Name: FUNCTION apply_offered_rules(p_from date, p_to date, p_session_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.apply_offered_rules(p_from date, p_to date, p_session_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.apply_offered_rules(p_from date, p_to date, p_session_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.apply_offered_rules(p_from date, p_to date, p_session_id uuid) TO service_role;


--
-- Name: FUNCTION attends_private_session(p_session_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.attends_private_session(p_session_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.attends_private_session(p_session_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.attends_private_session(p_session_id uuid) TO service_role;


--
-- Name: FUNCTION birthday_key(d date); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.birthday_key(d date) TO anon;
GRANT ALL ON FUNCTION public.birthday_key(d date) TO authenticated;
GRANT ALL ON FUNCTION public.birthday_key(d date) TO service_role;


--
-- Name: FUNCTION birthday_on_year(d date, p_year integer); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.birthday_on_year(d date, p_year integer) TO anon;
GRANT ALL ON FUNCTION public.birthday_on_year(d date, p_year integer) TO authenticated;
GRANT ALL ON FUNCTION public.birthday_on_year(d date, p_year integer) TO service_role;


--
-- Name: FUNCTION birthdays_on(p_date date); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.birthdays_on(p_date date) TO anon;
GRANT ALL ON FUNCTION public.birthdays_on(p_date date) TO authenticated;
GRANT ALL ON FUNCTION public.birthdays_on(p_date date) TO service_role;


--
-- Name: FUNCTION cancel_attendance(p_attendance_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.cancel_attendance(p_attendance_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.cancel_attendance(p_attendance_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.cancel_attendance(p_attendance_id uuid) TO service_role;


--
-- Name: FUNCTION charge_student(p_student_id uuid, p_amount integer, p_description text, p_module_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.charge_student(p_student_id uuid, p_amount integer, p_description text, p_module_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.charge_student(p_student_id uuid, p_amount integer, p_description text, p_module_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.charge_student(p_student_id uuid, p_amount integer, p_description text, p_module_id uuid) TO service_role;


--
-- Name: FUNCTION class_peer_ids(p_class_ids uuid[]); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.class_peer_ids(p_class_ids uuid[]) TO anon;
GRANT ALL ON FUNCTION public.class_peer_ids(p_class_ids uuid[]) TO authenticated;
GRANT ALL ON FUNCTION public.class_peer_ids(p_class_ids uuid[]) TO service_role;


--
-- Name: FUNCTION class_peer_ids(p_class_ids uuid[], p_ignore_filiere boolean); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.class_peer_ids(p_class_ids uuid[], p_ignore_filiere boolean) TO anon;
GRANT ALL ON FUNCTION public.class_peer_ids(p_class_ids uuid[], p_ignore_filiere boolean) TO authenticated;
GRANT ALL ON FUNCTION public.class_peer_ids(p_class_ids uuid[], p_ignore_filiere boolean) TO service_role;


--
-- Name: FUNCTION complete_private_session(p_id uuid, p_payload jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.complete_private_session(p_id uuid, p_payload jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.complete_private_session(p_id uuid, p_payload jsonb) TO authenticated;
GRANT ALL ON FUNCTION public.complete_private_session(p_id uuid, p_payload jsonb) TO service_role;


--
-- Name: FUNCTION create_private_request(p_payload jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.create_private_request(p_payload jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.create_private_request(p_payload jsonb) TO authenticated;
GRANT ALL ON FUNCTION public.create_private_request(p_payload jsonb) TO service_role;


--
-- Name: FUNCTION create_private_session(p_payload jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.create_private_session(p_payload jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.create_private_session(p_payload jsonb) TO authenticated;
GRANT ALL ON FUNCTION public.create_private_session(p_payload jsonb) TO service_role;


--
-- Name: FUNCTION "current_role"(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public."current_role"() TO anon;
GRANT ALL ON FUNCTION public."current_role"() TO authenticated;
GRANT ALL ON FUNCTION public."current_role"() TO service_role;


--
-- Name: FUNCTION delete_absence_penalty(p_penalty_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.delete_absence_penalty(p_penalty_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.delete_absence_penalty(p_penalty_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.delete_absence_penalty(p_penalty_id uuid) TO service_role;


--
-- Name: FUNCTION delete_balance_tx(p_tx_id uuid, p_adjust_cash boolean); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.delete_balance_tx(p_tx_id uuid, p_adjust_cash boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.delete_balance_tx(p_tx_id uuid, p_adjust_cash boolean) TO authenticated;
GRANT ALL ON FUNCTION public.delete_balance_tx(p_tx_id uuid, p_adjust_cash boolean) TO service_role;


--
-- Name: FUNCTION delete_private_session(p_id uuid, p_force boolean); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.delete_private_session(p_id uuid, p_force boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.delete_private_session(p_id uuid, p_force boolean) TO authenticated;
GRANT ALL ON FUNCTION public.delete_private_session(p_id uuid, p_force boolean) TO service_role;


--
-- Name: FUNCTION delete_subscription_price(p_session_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.delete_subscription_price(p_session_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.delete_subscription_price(p_session_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.delete_subscription_price(p_session_id uuid) TO service_role;


--
-- Name: FUNCTION delete_teacher_payment(p_payment_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.delete_teacher_payment(p_payment_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.delete_teacher_payment(p_payment_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.delete_teacher_payment(p_payment_id uuid) TO service_role;


--
-- Name: FUNCTION delete_unpaid_teacher_sessions(p_teacher_id uuid, p_ids uuid[]); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.delete_unpaid_teacher_sessions(p_teacher_id uuid, p_ids uuid[]) FROM PUBLIC;
GRANT ALL ON FUNCTION public.delete_unpaid_teacher_sessions(p_teacher_id uuid, p_ids uuid[]) TO authenticated;
GRANT ALL ON FUNCTION public.delete_unpaid_teacher_sessions(p_teacher_id uuid, p_ids uuid[]) TO service_role;


--
-- Name: FUNCTION delete_worker_payment(p_payment_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.delete_worker_payment(p_payment_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.delete_worker_payment(p_payment_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.delete_worker_payment(p_payment_id uuid) TO service_role;


--
-- Name: FUNCTION discounted_price(p_price integer, p_type text, p_value integer); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.discounted_price(p_price integer, p_type text, p_value integer) TO anon;
GRANT ALL ON FUNCTION public.discounted_price(p_price integer, p_type text, p_value integer) TO authenticated;
GRANT ALL ON FUNCTION public.discounted_price(p_price integer, p_type text, p_value integer) TO service_role;


--
-- Name: FUNCTION end_worker_shift(p_worker_id uuid, p_end_at timestamp with time zone); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.end_worker_shift(p_worker_id uuid, p_end_at timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION public.end_worker_shift(p_worker_id uuid, p_end_at timestamp with time zone) TO authenticated;
GRANT ALL ON FUNCTION public.end_worker_shift(p_worker_id uuid, p_end_at timestamp with time zone) TO service_role;


--
-- Name: FUNCTION free_period_stats(p_free_period_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.free_period_stats(p_free_period_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.free_period_stats(p_free_period_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.free_period_stats(p_free_period_id uuid) TO service_role;


--
-- Name: FUNCTION freeze_open_worker_shifts(p_when timestamp with time zone); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.freeze_open_worker_shifts(p_when timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION public.freeze_open_worker_shifts(p_when timestamp with time zone) TO authenticated;
GRANT ALL ON FUNCTION public.freeze_open_worker_shifts(p_when timestamp with time zone) TO service_role;


--
-- Name: FUNCTION handle_new_user(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.handle_new_user() TO anon;
GRANT ALL ON FUNCTION public.handle_new_user() TO authenticated;
GRANT ALL ON FUNCTION public.handle_new_user() TO service_role;


--
-- Name: FUNCTION is_admin(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.is_admin() TO anon;
GRANT ALL ON FUNCTION public.is_admin() TO authenticated;
GRANT ALL ON FUNCTION public.is_admin() TO service_role;


--
-- Name: FUNCTION is_my_child(p_student_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.is_my_child(p_student_id uuid) TO anon;
GRANT ALL ON FUNCTION public.is_my_child(p_student_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.is_my_child(p_student_id uuid) TO service_role;


--
-- Name: FUNCTION public.is_staff(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.is_staff() TO anon;
GRANT ALL ON FUNCTION public.is_staff() TO authenticated;
GRANT ALL ON FUNCTION public.is_staff() TO service_role;


--
-- Name: FUNCTION mark_attendance(p_student_id uuid, p_session_id uuid, p_status public.attendance_status, p_date date, p_allow_debt boolean, p_skip_teacher_due boolean); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.mark_attendance(p_student_id uuid, p_session_id uuid, p_status public.attendance_status, p_date date, p_allow_debt boolean, p_skip_teacher_due boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.mark_attendance(p_student_id uuid, p_session_id uuid, p_status public.attendance_status, p_date date, p_allow_debt boolean, p_skip_teacher_due boolean) TO authenticated;
GRANT ALL ON FUNCTION public.mark_attendance(p_student_id uuid, p_session_id uuid, p_status public.attendance_status, p_date date, p_allow_debt boolean, p_skip_teacher_due boolean) TO service_role;


--
-- Name: FUNCTION mark_worker_absences(p_worker_id uuid, p_from date, p_to date); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.mark_worker_absences(p_worker_id uuid, p_from date, p_to date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.mark_worker_absences(p_worker_id uuid, p_from date, p_to date) TO authenticated;
GRANT ALL ON FUNCTION public.mark_worker_absences(p_worker_id uuid, p_from date, p_to date) TO service_role;


--
-- Name: FUNCTION offered_rule(p_session_id uuid, p_date date); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.offered_rule(p_session_id uuid, p_date date) TO anon;
GRANT ALL ON FUNCTION public.offered_rule(p_session_id uuid, p_date date) TO authenticated;
GRANT ALL ON FUNCTION public.offered_rule(p_session_id uuid, p_date date) TO service_role;


--
-- Name: FUNCTION pay_private_session(p_id uuid, p_amount integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.pay_private_session(p_id uuid, p_amount integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.pay_private_session(p_id uuid, p_amount integer) TO authenticated;
GRANT ALL ON FUNCTION public.pay_private_session(p_id uuid, p_amount integer) TO service_role;


--
-- Name: FUNCTION pay_private_session_teacher(p_module_row_id uuid, p_amount integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.pay_private_session_teacher(p_module_row_id uuid, p_amount integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.pay_private_session_teacher(p_module_row_id uuid, p_amount integer) TO authenticated;
GRANT ALL ON FUNCTION public.pay_private_session_teacher(p_module_row_id uuid, p_amount integer) TO service_role;


--
-- Name: FUNCTION pay_registration_fee_cash(p_student_id uuid, p_fee integer, p_label text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.pay_registration_fee_cash(p_student_id uuid, p_fee integer, p_label text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.pay_registration_fee_cash(p_student_id uuid, p_fee integer, p_label text) TO authenticated;
GRANT ALL ON FUNCTION public.pay_registration_fee_cash(p_student_id uuid, p_fee integer, p_label text) TO service_role;


--
-- Name: FUNCTION pay_student_debt(p_student_id uuid, p_amount integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.pay_student_debt(p_student_id uuid, p_amount integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.pay_student_debt(p_student_id uuid, p_amount integer) TO authenticated;
GRANT ALL ON FUNCTION public.pay_student_debt(p_student_id uuid, p_amount integer) TO service_role;


--
-- Name: FUNCTION pay_teacher_sessions(p_teacher_id uuid, p_keys text[], p_amount integer, p_method text, p_percentage integer, p_details jsonb, p_description text, p_acompte_ids uuid[], p_absence_ids uuid[], p_settle_deductions boolean); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.pay_teacher_sessions(p_teacher_id uuid, p_keys text[], p_amount integer, p_method text, p_percentage integer, p_details jsonb, p_description text, p_acompte_ids uuid[], p_absence_ids uuid[], p_settle_deductions boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.pay_teacher_sessions(p_teacher_id uuid, p_keys text[], p_amount integer, p_method text, p_percentage integer, p_details jsonb, p_description text, p_acompte_ids uuid[], p_absence_ids uuid[], p_settle_deductions boolean) TO authenticated;
GRANT ALL ON FUNCTION public.pay_teacher_sessions(p_teacher_id uuid, p_keys text[], p_amount integer, p_method text, p_percentage integer, p_details jsonb, p_description text, p_acompte_ids uuid[], p_absence_ids uuid[], p_settle_deductions boolean) TO service_role;


--
-- Name: FUNCTION pay_teacher_sessions(p_teacher_id uuid, p_keys text[], p_amount integer, p_method text, p_percentage integer, p_details jsonb, p_description text, p_acompte_ids uuid[], p_absence_ids uuid[], p_settle_deductions boolean, p_independent_ids uuid[]); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.pay_teacher_sessions(p_teacher_id uuid, p_keys text[], p_amount integer, p_method text, p_percentage integer, p_details jsonb, p_description text, p_acompte_ids uuid[], p_absence_ids uuid[], p_settle_deductions boolean, p_independent_ids uuid[]) FROM PUBLIC;
GRANT ALL ON FUNCTION public.pay_teacher_sessions(p_teacher_id uuid, p_keys text[], p_amount integer, p_method text, p_percentage integer, p_details jsonb, p_description text, p_acompte_ids uuid[], p_absence_ids uuid[], p_settle_deductions boolean, p_independent_ids uuid[]) TO authenticated;
GRANT ALL ON FUNCTION public.pay_teacher_sessions(p_teacher_id uuid, p_keys text[], p_amount integer, p_method text, p_percentage integer, p_details jsonb, p_description text, p_acompte_ids uuid[], p_absence_ids uuid[], p_settle_deductions boolean, p_independent_ids uuid[]) TO service_role;


--
-- Name: FUNCTION pay_worker_period(p_worker_id uuid, p_method text, p_period_key text, p_period_start date, p_period_end date, p_shift_ids uuid[], p_amount integer, p_description text, p_details jsonb, p_acompte_ids uuid[], p_absence_ids uuid[], p_settle_deductions boolean); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.pay_worker_period(p_worker_id uuid, p_method text, p_period_key text, p_period_start date, p_period_end date, p_shift_ids uuid[], p_amount integer, p_description text, p_details jsonb, p_acompte_ids uuid[], p_absence_ids uuid[], p_settle_deductions boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.pay_worker_period(p_worker_id uuid, p_method text, p_period_key text, p_period_start date, p_period_end date, p_shift_ids uuid[], p_amount integer, p_description text, p_details jsonb, p_acompte_ids uuid[], p_absence_ids uuid[], p_settle_deductions boolean) TO authenticated;
GRANT ALL ON FUNCTION public.pay_worker_period(p_worker_id uuid, p_method text, p_period_key text, p_period_start date, p_period_end date, p_shift_ids uuid[], p_amount integer, p_description text, p_details jsonb, p_acompte_ids uuid[], p_absence_ids uuid[], p_settle_deductions boolean) TO service_role;


--
-- Name: FUNCTION pay_worker_shifts(p_worker_id uuid, p_shift_ids uuid[], p_amount integer, p_description text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.pay_worker_shifts(p_worker_id uuid, p_shift_ids uuid[], p_amount integer, p_description text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.pay_worker_shifts(p_worker_id uuid, p_shift_ids uuid[], p_amount integer, p_description text) TO authenticated;
GRANT ALL ON FUNCTION public.pay_worker_shifts(p_worker_id uuid, p_shift_ids uuid[], p_amount integer, p_description text) TO service_role;


--
-- Name: FUNCTION process_weekly_absences(p_when timestamp with time zone); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.process_weekly_absences(p_when timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION public.process_weekly_absences(p_when timestamp with time zone) TO authenticated;
GRANT ALL ON FUNCTION public.process_weekly_absences(p_when timestamp with time zone) TO service_role;


--
-- Name: FUNCTION program_private_session(p_id uuid, p_payload jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.program_private_session(p_id uuid, p_payload jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.program_private_session(p_id uuid, p_payload jsonb) TO authenticated;
GRANT ALL ON FUNCTION public.program_private_session(p_id uuid, p_payload jsonb) TO service_role;


--
-- Name: FUNCTION protect_reception_payment_fields(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.protect_reception_payment_fields() TO anon;
GRANT ALL ON FUNCTION public.protect_reception_payment_fields() TO authenticated;
GRANT ALL ON FUNCTION public.protect_reception_payment_fields() TO service_role;


--
-- Name: FUNCTION protect_student_financial_fields(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.protect_student_financial_fields() TO anon;
GRANT ALL ON FUNCTION public.protect_student_financial_fields() TO authenticated;
GRANT ALL ON FUNCTION public.protect_student_financial_fields() TO service_role;


--
-- Name: FUNCTION protect_teacher_payment_fields(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.protect_teacher_payment_fields() TO anon;
GRANT ALL ON FUNCTION public.protect_teacher_payment_fields() TO authenticated;
GRANT ALL ON FUNCTION public.protect_teacher_payment_fields() TO service_role;


--
-- Name: FUNCTION reprice_session(p_session_id uuid, p_price integer, p_level_price integer, p_period_months integer, p_from date); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.reprice_session(p_session_id uuid, p_price integer, p_level_price integer, p_period_months integer, p_from date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.reprice_session(p_session_id uuid, p_price integer, p_level_price integer, p_period_months integer, p_from date) TO authenticated;
GRANT ALL ON FUNCTION public.reprice_session(p_session_id uuid, p_price integer, p_level_price integer, p_period_months integer, p_from date) TO service_role;


--
-- Name: FUNCTION reschedule_private_session(p_id uuid, p_scheduled_at timestamp with time zone); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.reschedule_private_session(p_id uuid, p_scheduled_at timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION public.reschedule_private_session(p_id uuid, p_scheduled_at timestamp with time zone) TO authenticated;
GRANT ALL ON FUNCTION public.reschedule_private_session(p_id uuid, p_scheduled_at timestamp with time zone) TO service_role;


--
-- Name: FUNCTION resolve_worker_absence(p_shift_id uuid, p_cost integer, p_description text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.resolve_worker_absence(p_shift_id uuid, p_cost integer, p_description text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.resolve_worker_absence(p_shift_id uuid, p_cost integer, p_description text) TO authenticated;
GRANT ALL ON FUNCTION public.resolve_worker_absence(p_shift_id uuid, p_cost integer, p_description text) TO service_role;


--
-- Name: FUNCTION scan_card(p_code text, p_when timestamp with time zone); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.scan_card(p_code text, p_when timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION public.scan_card(p_code text, p_when timestamp with time zone) TO authenticated;
GRANT ALL ON FUNCTION public.scan_card(p_code text, p_when timestamp with time zone) TO service_role;


--
-- Name: FUNCTION scan_refuses_on_low_balance(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.scan_refuses_on_low_balance() TO anon;
GRANT ALL ON FUNCTION public.scan_refuses_on_low_balance() TO authenticated;
GRANT ALL ON FUNCTION public.scan_refuses_on_low_balance() TO service_role;


--
-- Name: FUNCTION scan_worker_card(p_code text, p_when timestamp with time zone); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.scan_worker_card(p_code text, p_when timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION public.scan_worker_card(p_code text, p_when timestamp with time zone) TO authenticated;
GRANT ALL ON FUNCTION public.scan_worker_card(p_code text, p_when timestamp with time zone) TO service_role;


--
-- Name: FUNCTION sees_announcement_groups(p_groups uuid[]); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.sees_announcement_groups(p_groups uuid[]) TO anon;
GRANT ALL ON FUNCTION public.sees_announcement_groups(p_groups uuid[]) TO authenticated;
GRANT ALL ON FUNCTION public.sees_announcement_groups(p_groups uuid[]) TO service_role;


--
-- Name: FUNCTION session_audience_class_ids(p_session_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.session_audience_class_ids(p_session_id uuid) TO anon;
GRANT ALL ON FUNCTION public.session_audience_class_ids(p_session_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.session_audience_class_ids(p_session_id uuid) TO service_role;


--
-- Name: FUNCTION session_inherit_subscription(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.session_inherit_subscription() TO anon;
GRANT ALL ON FUNCTION public.session_inherit_subscription() TO authenticated;
GRANT ALL ON FUNCTION public.session_inherit_subscription() TO service_role;


--
-- Name: FUNCTION set_private_session_status(p_id uuid, p_status text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.set_private_session_status(p_id uuid, p_status text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.set_private_session_status(p_id uuid, p_status text) TO authenticated;
GRANT ALL ON FUNCTION public.set_private_session_status(p_id uuid, p_status text) TO service_role;


--
-- Name: FUNCTION set_subscription_price(p_session_id uuid, p_price integer, p_level_price integer, p_period_months integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.set_subscription_price(p_session_id uuid, p_price integer, p_level_price integer, p_period_months integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.set_subscription_price(p_session_id uuid, p_price integer, p_level_price integer, p_period_months integer) TO authenticated;
GRANT ALL ON FUNCTION public.set_subscription_price(p_session_id uuid, p_price integer, p_level_price integer, p_period_months integer) TO service_role;


--
-- Name: FUNCTION set_worker_shift(p_worker_id uuid, p_work_date date, p_start_at timestamp with time zone, p_end_at timestamp with time zone, p_status text, p_notes text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.set_worker_shift(p_worker_id uuid, p_work_date date, p_start_at timestamp with time zone, p_end_at timestamp with time zone, p_status text, p_notes text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.set_worker_shift(p_worker_id uuid, p_work_date date, p_start_at timestamp with time zone, p_end_at timestamp with time zone, p_status text, p_notes text) TO authenticated;
GRANT ALL ON FUNCTION public.set_worker_shift(p_worker_id uuid, p_work_date date, p_start_at timestamp with time zone, p_end_at timestamp with time zone, p_status text, p_notes text) TO service_role;


--
-- Name: FUNCTION settle_registration_fee(p_student_id uuid, p_fee integer, p_label text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.settle_registration_fee(p_student_id uuid, p_fee integer, p_label text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.settle_registration_fee(p_student_id uuid, p_fee integer, p_label text) TO authenticated;
GRANT ALL ON FUNCTION public.settle_registration_fee(p_student_id uuid, p_fee integer, p_label text) TO service_role;


--
-- Name: FUNCTION settle_teacher_percentage(p_teacher_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.settle_teacher_percentage(p_teacher_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.settle_teacher_percentage(p_teacher_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.settle_teacher_percentage(p_teacher_id uuid) TO service_role;


--
-- Name: FUNCTION sibling_session_ids(p_session_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.sibling_session_ids(p_session_id uuid) TO anon;
GRANT ALL ON FUNCTION public.sibling_session_ids(p_session_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.sibling_session_ids(p_session_id uuid) TO service_role;


--
-- Name: FUNCTION student_class_ids(p_student_id uuid, p_date date); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.student_class_ids(p_student_id uuid, p_date date) TO anon;
GRANT ALL ON FUNCTION public.student_class_ids(p_student_id uuid, p_date date) TO authenticated;
GRANT ALL ON FUNCTION public.student_class_ids(p_student_id uuid, p_date date) TO service_role;


--
-- Name: FUNCTION student_group_ids(p_student_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.student_group_ids(p_student_id uuid) TO anon;
GRANT ALL ON FUNCTION public.student_group_ids(p_student_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.student_group_ids(p_student_id uuid) TO service_role;


--
-- Name: FUNCTION student_session_price(p_student_id uuid, p_session_id uuid, p_date date); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.student_session_price(p_student_id uuid, p_session_id uuid, p_date date) TO anon;
GRANT ALL ON FUNCTION public.student_session_price(p_student_id uuid, p_session_id uuid, p_date date) TO authenticated;
GRANT ALL ON FUNCTION public.student_session_price(p_student_id uuid, p_session_id uuid, p_date date) TO service_role;


--
-- Name: FUNCTION student_session_rank(p_student_id uuid, p_session_id uuid, p_date date); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.student_session_rank(p_student_id uuid, p_session_id uuid, p_date date) TO anon;
GRANT ALL ON FUNCTION public.student_session_rank(p_student_id uuid, p_session_id uuid, p_date date) TO authenticated;
GRANT ALL ON FUNCTION public.student_session_rank(p_student_id uuid, p_session_id uuid, p_date date) TO service_role;


--
-- Name: FUNCTION subscription_sync_siblings(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.subscription_sync_siblings() TO anon;
GRANT ALL ON FUNCTION public.subscription_sync_siblings() TO authenticated;
GRANT ALL ON FUNCTION public.subscription_sync_siblings() TO service_role;


--
-- Name: FUNCTION sync_changes(p_since timestamp with time zone); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.sync_changes(p_since timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION public.sync_changes(p_since timestamp with time zone) TO authenticated;
GRANT ALL ON FUNCTION public.sync_changes(p_since timestamp with time zone) TO service_role;


--
-- Name: FUNCTION sync_record_deletion(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.sync_record_deletion() FROM PUBLIC;
GRANT ALL ON FUNCTION public.sync_record_deletion() TO service_role;


--
-- Name: FUNCTION sync_teacher_dues(p_session_id uuid, p_from date); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.sync_teacher_dues(p_session_id uuid, p_from date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.sync_teacher_dues(p_session_id uuid, p_from date) TO authenticated;
GRANT ALL ON FUNCTION public.sync_teacher_dues(p_session_id uuid, p_from date) TO service_role;


--
-- Name: FUNCTION sync_touch_parent_from_student(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.sync_touch_parent_from_student() FROM PUBLIC;
GRANT ALL ON FUNCTION public.sync_touch_parent_from_student() TO service_role;


--
-- Name: FUNCTION sync_touch_student_from_enrollment(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.sync_touch_student_from_enrollment() FROM PUBLIC;
GRANT ALL ON FUNCTION public.sync_touch_student_from_enrollment() TO service_role;


--
-- Name: FUNCTION sync_touch_updated_at(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.sync_touch_updated_at() TO anon;
GRANT ALL ON FUNCTION public.sync_touch_updated_at() TO authenticated;
GRANT ALL ON FUNCTION public.sync_touch_updated_at() TO service_role;


--
-- Name: FUNCTION teaches_private_session(p_session_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.teaches_private_session(p_session_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.teaches_private_session(p_session_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.teaches_private_session(p_session_id uuid) TO service_role;


--
-- Name: FUNCTION teaches_session(p_session_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.teaches_session(p_session_id uuid) TO anon;
GRANT ALL ON FUNCTION public.teaches_session(p_session_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.teaches_session(p_session_id uuid) TO service_role;


--
-- Name: FUNCTION teaches_student(p_student_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.teaches_student(p_student_id uuid) TO anon;
GRANT ALL ON FUNCTION public.teaches_student(p_student_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.teaches_student(p_student_id uuid) TO service_role;


--
-- Name: FUNCTION time_to_minutes(p_time text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.time_to_minutes(p_time text) TO anon;
GRANT ALL ON FUNCTION public.time_to_minutes(p_time text) TO authenticated;
GRANT ALL ON FUNCTION public.time_to_minutes(p_time text) TO service_role;


--
-- Name: FUNCTION update_attendance(p_attendance_id uuid, p_status public.attendance_status, p_occurred_at timestamp with time zone, p_amount integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.update_attendance(p_attendance_id uuid, p_status public.attendance_status, p_occurred_at timestamp with time zone, p_amount integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.update_attendance(p_attendance_id uuid, p_status public.attendance_status, p_occurred_at timestamp with time zone, p_amount integer) TO authenticated;
GRANT ALL ON FUNCTION public.update_attendance(p_attendance_id uuid, p_status public.attendance_status, p_occurred_at timestamp with time zone, p_amount integer) TO service_role;


--
-- Name: FUNCTION update_balance_tx(p_tx_id uuid, p_amount integer, p_description text, p_date timestamp with time zone, p_type public.balance_tx_type, p_adjust_cash boolean); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.update_balance_tx(p_tx_id uuid, p_amount integer, p_description text, p_date timestamp with time zone, p_type public.balance_tx_type, p_adjust_cash boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.update_balance_tx(p_tx_id uuid, p_amount integer, p_description text, p_date timestamp with time zone, p_type public.balance_tx_type, p_adjust_cash boolean) TO authenticated;
GRANT ALL ON FUNCTION public.update_balance_tx(p_tx_id uuid, p_amount integer, p_description text, p_date timestamp with time zone, p_type public.balance_tx_type, p_adjust_cash boolean) TO service_role;


--
-- Name: FUNCTION update_private_request(p_id uuid, p_payload jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.update_private_request(p_id uuid, p_payload jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.update_private_request(p_id uuid, p_payload jsonb) TO authenticated;
GRANT ALL ON FUNCTION public.update_private_request(p_id uuid, p_payload jsonb) TO service_role;


--
-- Name: FUNCTION update_private_session(p_id uuid, p_payload jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.update_private_session(p_id uuid, p_payload jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.update_private_session(p_id uuid, p_payload jsonb) TO authenticated;
GRANT ALL ON FUNCTION public.update_private_session(p_id uuid, p_payload jsonb) TO service_role;


--
-- Name: FUNCTION update_teacher_payment(p_payment_id uuid, p_amount integer, p_method text, p_percentage integer, p_description text, p_paid_at timestamp with time zone); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.update_teacher_payment(p_payment_id uuid, p_amount integer, p_method text, p_percentage integer, p_description text, p_paid_at timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION public.update_teacher_payment(p_payment_id uuid, p_amount integer, p_method text, p_percentage integer, p_description text, p_paid_at timestamp with time zone) TO authenticated;
GRANT ALL ON FUNCTION public.update_teacher_payment(p_payment_id uuid, p_amount integer, p_method text, p_percentage integer, p_description text, p_paid_at timestamp with time zone) TO service_role;


--
-- Name: FUNCTION week_anchor(p_date date, p_start_dow smallint); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.week_anchor(p_date date, p_start_dow smallint) TO anon;
GRANT ALL ON FUNCTION public.week_anchor(p_date date, p_start_dow smallint) TO authenticated;
GRANT ALL ON FUNCTION public.week_anchor(p_date date, p_start_dow smallint) TO service_role;


--
-- Name: FUNCTION worker_works_on(p_worker_id uuid, p_date date); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.worker_works_on(p_worker_id uuid, p_date date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.worker_works_on(p_worker_id uuid, p_date date) TO authenticated;
GRANT ALL ON FUNCTION public.worker_works_on(p_worker_id uuid, p_date date) TO service_role;


--
-- Name: FUNCTION write_private_session_modules(p_session_id uuid, p_modules jsonb); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.write_private_session_modules(p_session_id uuid, p_modules jsonb) TO anon;
GRANT ALL ON FUNCTION public.write_private_session_modules(p_session_id uuid, p_modules jsonb) TO authenticated;
GRANT ALL ON FUNCTION public.write_private_session_modules(p_session_id uuid, p_modules jsonb) TO service_role;


--
-- Name: FUNCTION write_private_session_students(p_session_id uuid, p_students jsonb); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.write_private_session_students(p_session_id uuid, p_students jsonb) TO anon;
GRANT ALL ON FUNCTION public.write_private_session_students(p_session_id uuid, p_students jsonb) TO authenticated;
GRANT ALL ON FUNCTION public.write_private_session_students(p_session_id uuid, p_students jsonb) TO service_role;


--
-- Name: TABLE absence_penalties; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.absence_penalties TO anon;
GRANT ALL ON TABLE public.absence_penalties TO authenticated;
GRANT ALL ON TABLE public.absence_penalties TO service_role;


--
-- Name: TABLE announcements; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.announcements TO anon;
GRANT ALL ON TABLE public.announcements TO authenticated;
GRANT ALL ON TABLE public.announcements TO service_role;


--
-- Name: TABLE attendance; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.attendance TO anon;
GRANT ALL ON TABLE public.attendance TO authenticated;
GRANT ALL ON TABLE public.attendance TO service_role;


--
-- Name: TABLE balance_tx; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.balance_tx TO anon;
GRANT ALL ON TABLE public.balance_tx TO authenticated;
GRANT ALL ON TABLE public.balance_tx TO service_role;


--
-- Name: TABLE cash_transactions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.cash_transactions TO anon;
GRANT ALL ON TABLE public.cash_transactions TO authenticated;
GRANT ALL ON TABLE public.cash_transactions TO service_role;


--
-- Name: TABLE classes; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.classes TO anon;
GRANT ALL ON TABLE public.classes TO authenticated;
GRANT ALL ON TABLE public.classes TO service_role;


--
-- Name: TABLE coursework; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.coursework TO anon;
GRANT ALL ON TABLE public.coursework TO authenticated;
GRANT ALL ON TABLE public.coursework TO service_role;


--
-- Name: TABLE expense_categories; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.expense_categories TO anon;
GRANT ALL ON TABLE public.expense_categories TO authenticated;
GRANT ALL ON TABLE public.expense_categories TO service_role;


--
-- Name: TABLE expenses; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.expenses TO anon;
GRANT ALL ON TABLE public.expenses TO authenticated;
GRANT ALL ON TABLE public.expenses TO service_role;


--
-- Name: TABLE filieres; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.filieres TO anon;
GRANT ALL ON TABLE public.filieres TO authenticated;
GRANT ALL ON TABLE public.filieres TO service_role;


--
-- Name: TABLE groups; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.groups TO anon;
GRANT ALL ON TABLE public.groups TO authenticated;
GRANT ALL ON TABLE public.groups TO service_role;


--
-- Name: TABLE independent_sessions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.independent_sessions TO anon;
GRANT ALL ON TABLE public.independent_sessions TO authenticated;
GRANT ALL ON TABLE public.independent_sessions TO service_role;


--
-- Name: TABLE module_absence_rules; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.module_absence_rules TO anon;
GRANT ALL ON TABLE public.module_absence_rules TO authenticated;
GRANT ALL ON TABLE public.module_absence_rules TO service_role;


--
-- Name: TABLE modules; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.modules TO anon;
GRANT ALL ON TABLE public.modules TO authenticated;
GRANT ALL ON TABLE public.modules TO service_role;


--
-- Name: TABLE notifications; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.notifications TO anon;
GRANT ALL ON TABLE public.notifications TO authenticated;
GRANT ALL ON TABLE public.notifications TO service_role;


--
-- Name: TABLE parents; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.parents TO anon;
GRANT ALL ON TABLE public.parents TO authenticated;
GRANT ALL ON TABLE public.parents TO service_role;


--
-- Name: TABLE private_session_modules; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.private_session_modules TO anon;
GRANT ALL ON TABLE public.private_session_modules TO authenticated;
GRANT ALL ON TABLE public.private_session_modules TO service_role;


--
-- Name: TABLE private_session_students; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.private_session_students TO anon;
GRANT ALL ON TABLE public.private_session_students TO authenticated;
GRANT ALL ON TABLE public.private_session_students TO service_role;


--
-- Name: TABLE private_sessions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.private_sessions TO anon;
GRANT ALL ON TABLE public.private_sessions TO authenticated;
GRANT ALL ON TABLE public.private_sessions TO service_role;


--
-- Name: TABLE profiles; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.profiles TO anon;
GRANT ALL ON TABLE public.profiles TO authenticated;
GRANT ALL ON TABLE public.profiles TO service_role;


--
-- Name: TABLE reception_staff; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.reception_staff TO anon;
GRANT ALL ON TABLE public.reception_staff TO authenticated;
GRANT ALL ON TABLE public.reception_staff TO service_role;


--
-- Name: TABLE salles; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.salles TO anon;
GRANT ALL ON TABLE public.salles TO authenticated;
GRANT ALL ON TABLE public.salles TO service_role;


--
-- Name: TABLE school; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.school TO anon;
GRANT ALL ON TABLE public.school TO authenticated;
GRANT ALL ON TABLE public.school TO service_role;


--
-- Name: TABLE sessions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.sessions TO anon;
GRANT ALL ON TABLE public.sessions TO authenticated;
GRANT ALL ON TABLE public.sessions TO service_role;


--
-- Name: TABLE student_credentials; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.student_credentials TO anon;
GRANT ALL ON TABLE public.student_credentials TO authenticated;
GRANT ALL ON TABLE public.student_credentials TO service_role;


--
-- Name: TABLE student_subscriptions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.student_subscriptions TO anon;
GRANT ALL ON TABLE public.student_subscriptions TO authenticated;
GRANT ALL ON TABLE public.student_subscriptions TO service_role;


--
-- Name: TABLE students; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.students TO anon;
GRANT ALL ON TABLE public.students TO authenticated;
GRANT ALL ON TABLE public.students TO service_role;


--
-- Name: TABLE subjects; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.subjects TO anon;
GRANT ALL ON TABLE public.subjects TO authenticated;
GRANT ALL ON TABLE public.subjects TO service_role;


--
-- Name: TABLE subscriptions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.subscriptions TO anon;
GRANT ALL ON TABLE public.subscriptions TO authenticated;
GRANT ALL ON TABLE public.subscriptions TO service_role;


--
-- Name: TABLE sync_deletions; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.sync_deletions TO anon;
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.sync_deletions TO authenticated;
GRANT ALL ON TABLE public.sync_deletions TO service_role;


--
-- Name: SEQUENCE sync_deletions_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.sync_deletions_id_seq TO anon;
GRANT ALL ON SEQUENCE public.sync_deletions_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.sync_deletions_id_seq TO service_role;


--
-- Name: TABLE teacher_absences; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.teacher_absences TO anon;
GRANT ALL ON TABLE public.teacher_absences TO authenticated;
GRANT ALL ON TABLE public.teacher_absences TO service_role;


--
-- Name: TABLE teacher_acomptes; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.teacher_acomptes TO anon;
GRANT ALL ON TABLE public.teacher_acomptes TO authenticated;
GRANT ALL ON TABLE public.teacher_acomptes TO service_role;


--
-- Name: TABLE teacher_payments; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.teacher_payments TO anon;
GRANT ALL ON TABLE public.teacher_payments TO authenticated;
GRANT ALL ON TABLE public.teacher_payments TO service_role;


--
-- Name: TABLE teachers; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.teachers TO anon;
GRANT ALL ON TABLE public.teachers TO authenticated;
GRANT ALL ON TABLE public.teachers TO service_role;


--
-- Name: TABLE unpaid_teacher_sessions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.unpaid_teacher_sessions TO anon;
GRANT ALL ON TABLE public.unpaid_teacher_sessions TO authenticated;
GRANT ALL ON TABLE public.unpaid_teacher_sessions TO service_role;


--
-- Name: TABLE whatsapp_contacts; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.whatsapp_contacts TO anon;
GRANT ALL ON TABLE public.whatsapp_contacts TO authenticated;
GRANT ALL ON TABLE public.whatsapp_contacts TO service_role;


--
-- Name: TABLE whatsapp_messages; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.whatsapp_messages TO anon;
GRANT ALL ON TABLE public.whatsapp_messages TO authenticated;
GRANT ALL ON TABLE public.whatsapp_messages TO service_role;


--
-- Name: TABLE whatsapp_outbox; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.whatsapp_outbox TO anon;
GRANT ALL ON TABLE public.whatsapp_outbox TO authenticated;
GRANT ALL ON TABLE public.whatsapp_outbox TO service_role;


--
-- Name: TABLE worker_payments; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.worker_payments TO anon;
GRANT ALL ON TABLE public.worker_payments TO authenticated;
GRANT ALL ON TABLE public.worker_payments TO service_role;


--
-- Name: TABLE worker_shifts; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.worker_shifts TO anon;
GRANT ALL ON TABLE public.worker_shifts TO authenticated;
GRANT ALL ON TABLE public.worker_shifts TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--



--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--



--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--



--
-- PostgreSQL database dump complete
--

\unrestrict 3O8xS8XEghvV4FP1IcUlXGtrUZEqaGbxuheg5RsSoxx2ZdaJ51TpDjaU9s24aHN


-- ===================== auth trigger + storage =====================
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
-- storage buckets
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values ('logos','logos','t',NULL,NULL) on conflict (id) do nothing;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values ('subjects','subjects','t',NULL,NULL) on conflict (id) do nothing;
-- storage policies
create policy logos_public_read on storage.objects as PERMISSIVE for SELECT to public using ((bucket_id = 'logos'::text));
create policy logos_staff_delete on storage.objects as PERMISSIVE for DELETE to authenticated using (((bucket_id = 'logos'::text) AND public.is_staff()));
create policy logos_staff_update on storage.objects as PERMISSIVE for UPDATE to authenticated using (((bucket_id = 'logos'::text) AND public.is_staff())) with check (((bucket_id = 'logos'::text) AND public.is_staff()));
create policy logos_staff_write on storage.objects as PERMISSIVE for INSERT to authenticated with check (((bucket_id = 'logos'::text) AND public.is_staff()));
create policy subjects_public_read on storage.objects as PERMISSIVE for SELECT to public using ((bucket_id = 'subjects'::text));
create policy subjects_staff_delete on storage.objects as PERMISSIVE for DELETE to authenticated using (((bucket_id = 'subjects'::text) AND (public.is_staff() OR (public."current_role"() = 'teacher'::public.user_role))));
create policy subjects_staff_update on storage.objects as PERMISSIVE for UPDATE to authenticated using (((bucket_id = 'subjects'::text) AND (public.is_staff() OR (public."current_role"() = 'teacher'::public.user_role)))) with check (((bucket_id = 'subjects'::text) AND (public.is_staff() OR (public."current_role"() = 'teacher'::public.user_role))));
create policy subjects_staff_write on storage.objects as PERMISSIVE for INSERT to authenticated with check (((bucket_id = 'subjects'::text) AND (public.is_staff() OR (public."current_role"() = 'teacher'::public.user_role))));

-- ===================== exact privileges (Supabase grants more by default) =====================
-- Exact EXECUTE rights per function, copied from the old project (2026-10-29).
SET search_path = public;
REVOKE ALL ON FUNCTION "current_role"() FROM PUBLIC, anon, authenticated, service_role; GRANT EXECUTE ON FUNCTION "current_role"() TO anon; GRANT EXECUTE ON FUNCTION "current_role"() TO authenticated; GRANT EXECUTE ON FUNCTION "current_role"() TO service_role; GRANT EXECUTE ON FUNCTION "current_role"() TO PUBLIC;
REVOKE ALL ON FUNCTION active_free_period(uuid[],date) FROM PUBLIC, anon, authenticated, service_role; GRANT EXECUTE ON FUNCTION active_free_period(uuid[],date) TO anon; GRANT EXECUTE ON FUNCTION active_free_period(uuid[],date) TO authenticated; GRANT EXECUTE ON FUNCTION active_free_period(uuid[],date) TO service_role; GRANT EXECUTE ON FUNCTION active_free_period(uuid[],date) TO PUBLIC;
REVOKE ALL ON FUNCTION add_student_balance(uuid,integer,text,boolean) FROM PUBLIC, anon, authenticated, service_role; GRANT EXECUTE ON FUNCTION add_student_balance(uuid,integer,text,boolean) TO authenticated; GRANT EXECUTE ON FUNCTION add_student_balance(uuid,integer,text,boolean) TO service_role;
REVOKE ALL ON FUNCTION apply_offered_rules(date,date,uuid) FROM PUBLIC, anon, authenticated, service_role; GRANT EXECUTE ON FUNCTION apply_offered_rules(date,date,uuid) TO authenticated; GRANT EXECUTE ON FUNCTION apply_offered_rules(date,date,uuid) TO service_role;
REVOKE ALL ON FUNCTION attends_private_session(uuid) FROM PUBLIC, anon, authenticated, service_role; GRANT EXECUTE ON FUNCTION attends_private_session(uuid) TO authenticated; GRANT EXECUTE ON FUNCTION attends_private_session(uuid) TO service_role;
REVOKE ALL ON FUNCTION birthday_key(date) FROM PUBLIC, anon, authenticated, service_role; GRANT EXECUTE ON FUNCTION birthday_key(date) TO anon; GRANT EXECUTE ON FUNCTION birthday_key(date) TO authenticated; GRANT EXECUTE ON FUNCTION birthday_key(date) TO service_role; GRANT EXECUTE ON FUNCTION birthday_key(date) TO PUBLIC;
REVOKE ALL ON FUNCTION birthday_on_year(date,integer) FROM PUBLIC, anon, authenticated, service_role; GRANT EXECUTE ON FUNCTION birthday_on_year(date,integer) TO anon; GRANT EXECUTE ON FUNCTION birthday_on_year(date,integer) TO authenticated; GRANT EXECUTE ON FUNCTION birthday_on_year(date,integer) TO service_role; GRANT EXECUTE ON FUNCTION birthday_on_year(date,integer) TO PUBLIC;
REVOKE ALL ON FUNCTION birthdays_on(date) FROM PUBLIC, anon, authenticated, service_role; GRANT EXECUTE ON FUNCTION birthdays_on(date) TO anon; GRANT EXECUTE ON FUNCTION birthdays_on(date) TO authenticated; GRANT EXECUTE ON FUNCTION birthdays_on(date) TO service_role; GRANT EXECUTE ON FUNCTION birthdays_on(date) TO PUBLIC;
REVOKE ALL ON FUNCTION cancel_attendance(uuid) FROM PUBLIC, anon, authenticated, service_role; GRANT EXECUTE ON FUNCTION cancel_attendance(uuid) TO authenticated; GRANT EXECUTE ON FUNCTION cancel_attendance(uuid) TO service_role;
REVOKE ALL ON FUNCTION charge_student(uuid,integer,text,uuid) FROM PUBLIC, anon, authenticated, service_role; GRANT EXECUTE ON FUNCTION charge_student(uuid,integer,text,uuid) TO authenticated; GRANT EXECUTE ON FUNCTION charge_student(uuid,integer,text,uuid) TO service_role;
REVOKE ALL ON FUNCTION class_peer_ids(uuid[]) FROM PUBLIC, anon, authenticated, service_role; GRANT EXECUTE ON FUNCTION class_peer_ids(uuid[]) TO anon; GRANT EXECUTE ON FUNCTION class_peer_ids(uuid[]) TO authenticated; GRANT EXECUTE ON FUNCTION class_peer_ids(uuid[]) TO service_role; GRANT EXECUTE ON FUNCTION class_peer_ids(uuid[]) TO PUBLIC;
REVOKE ALL ON FUNCTION class_peer_ids(uuid[],boolean) FROM PUBLIC, anon, authenticated, service_role; GRANT EXECUTE ON FUNCTION class_peer_ids(uuid[],boolean) TO anon; GRANT EXECUTE ON FUNCTION class_peer_ids(uuid[],boolean) TO authenticated; GRANT EXECUTE ON FUNCTION class_peer_ids(uuid[],boolean) TO service_role; GRANT EXECUTE ON FUNCTION class_peer_ids(uuid[],boolean) TO PUBLIC;
REVOKE ALL ON FUNCTION complete_private_session(uuid,jsonb) FROM PUBLIC, anon, authenticated, service_role; GRANT EXECUTE ON FUNCTION complete_private_session(uuid,jsonb) TO authenticated; GRANT EXECUTE ON FUNCTION complete_private_session(uuid,jsonb) TO service_role;
REVOKE ALL ON FUNCTION create_private_request(jsonb) FROM PUBLIC, anon, authenticated, service_role; GRANT EXECUTE ON FUNCTION create_private_request(jsonb) TO authenticated; GRANT EXECUTE ON FUNCTION create_private_request(jsonb) TO service_role;
REVOKE ALL ON FUNCTION create_private_session(jsonb) FROM PUBLIC, anon, authenticated, service_role; GRANT EXECUTE ON FUNCTION create_private_session(jsonb) TO authenticated; GRANT EXECUTE ON FUNCTION create_private_session(jsonb) TO service_role;
REVOKE ALL ON FUNCTION delete_absence_penalty(uuid) FROM PUBLIC, anon, authenticated, service_role; GRANT EXECUTE ON FUNCTION delete_absence_penalty(uuid) TO authenticated; GRANT EXECUTE ON FUNCTION delete_absence_penalty(uuid) TO service_role;
REVOKE ALL ON FUNCTION delete_balance_tx(uuid,boolean) FROM PUBLIC, anon, authenticated, service_role; GRANT EXECUTE ON FUNCTION delete_balance_tx(uuid,boolean) TO authenticated; GRANT EXECUTE ON FUNCTION delete_balance_tx(uuid,boolean) TO service_role;
REVOKE ALL ON FUNCTION delete_private_session(uuid,boolean) FROM PUBLIC, anon, authenticated, service_role; GRANT EXECUTE ON FUNCTION delete_private_session(uuid,boolean) TO authenticated; GRANT EXECUTE ON FUNCTION delete_private_session(uuid,boolean) TO service_role;
REVOKE ALL ON FUNCTION delete_subscription_price(uuid) FROM PUBLIC, anon, authenticated, service_role; GRANT EXECUTE ON FUNCTION delete_subscription_price(uuid) TO authenticated; GRANT EXECUTE ON FUNCTION delete_subscription_price(uuid) TO service_role;
REVOKE ALL ON FUNCTION delete_teacher_payment(uuid) FROM PUBLIC, anon, authenticated, service_role; GRANT EXECUTE ON FUNCTION delete_teacher_payment(uuid) TO authenticated; GRANT EXECUTE ON FUNCTION delete_teacher_payment(uuid) TO service_role;
REVOKE ALL ON FUNCTION delete_unpaid_teacher_sessions(uuid,uuid[]) FROM PUBLIC, anon, authenticated, service_role; GRANT EXECUTE ON FUNCTION delete_unpaid_teacher_sessions(uuid,uuid[]) TO authenticated; GRANT EXECUTE ON FUNCTION delete_unpaid_teacher_sessions(uuid,uuid[]) TO service_role;
REVOKE ALL ON FUNCTION delete_worker_payment(uuid) FROM PUBLIC, anon, authenticated, service_role; GRANT EXECUTE ON FUNCTION delete_worker_payment(uuid) TO authenticated; GRANT EXECUTE ON FUNCTION delete_worker_payment(uuid) TO service_role;
REVOKE ALL ON FUNCTION discounted_price(integer,text,integer) FROM PUBLIC, anon, authenticated, service_role; GRANT EXECUTE ON FUNCTION discounted_price(integer,text,integer) TO anon; GRANT EXECUTE ON FUNCTION discounted_price(integer,text,integer) TO authenticated; GRANT EXECUTE ON FUNCTION discounted_price(integer,text,integer) TO service_role; GRANT EXECUTE ON FUNCTION discounted_price(integer,text,integer) TO PUBLIC;
REVOKE ALL ON FUNCTION end_worker_shift(uuid,timestamp with time zone) FROM PUBLIC, anon, authenticated, service_role; GRANT EXECUTE ON FUNCTION end_worker_shift(uuid,timestamp with time zone) TO authenticated; GRANT EXECUTE ON FUNCTION end_worker_shift(uuid,timestamp with time zone) TO service_role;
REVOKE ALL ON FUNCTION free_period_stats(uuid) FROM PUBLIC, anon, authenticated, service_role; GRANT EXECUTE ON FUNCTION free_period_stats(uuid) TO authenticated; GRANT EXECUTE ON FUNCTION free_period_stats(uuid) TO service_role;
REVOKE ALL ON FUNCTION freeze_open_worker_shifts(timestamp with time zone) FROM PUBLIC, anon, authenticated, service_role; GRANT EXECUTE ON FUNCTION freeze_open_worker_shifts(timestamp with time zone) TO authenticated; GRANT EXECUTE ON FUNCTION freeze_open_worker_shifts(timestamp with time zone) TO service_role;
REVOKE ALL ON FUNCTION handle_new_user() FROM PUBLIC, anon, authenticated, service_role; GRANT EXECUTE ON FUNCTION handle_new_user() TO anon; GRANT EXECUTE ON FUNCTION handle_new_user() TO authenticated; GRANT EXECUTE ON FUNCTION handle_new_user() TO service_role; GRANT EXECUTE ON FUNCTION handle_new_user() TO PUBLIC;
REVOKE ALL ON FUNCTION is_admin() FROM PUBLIC, anon, authenticated, service_role; GRANT EXECUTE ON FUNCTION is_admin() TO anon; GRANT EXECUTE ON FUNCTION is_admin() TO authenticated; GRANT EXECUTE ON FUNCTION is_admin() TO service_role; GRANT EXECUTE ON FUNCTION is_admin() TO PUBLIC;
REVOKE ALL ON FUNCTION is_my_child(uuid) FROM PUBLIC, anon, authenticated, service_role; GRANT EXECUTE ON FUNCTION is_my_child(uuid) TO anon; GRANT EXECUTE ON FUNCTION is_my_child(uuid) TO authenticated; GRANT EXECUTE ON FUNCTION is_my_child(uuid) TO service_role; GRANT EXECUTE ON FUNCTION is_my_child(uuid) TO PUBLIC;
REVOKE ALL ON FUNCTION is_staff() FROM PUBLIC, anon, authenticated, service_role; GRANT EXECUTE ON FUNCTION is_staff() TO anon; GRANT EXECUTE ON FUNCTION is_staff() TO authenticated; GRANT EXECUTE ON FUNCTION is_staff() TO service_role; GRANT EXECUTE ON FUNCTION is_staff() TO PUBLIC;
REVOKE ALL ON FUNCTION mark_attendance(uuid,uuid,attendance_status,date,boolean,boolean) FROM PUBLIC, anon, authenticated, service_role; GRANT EXECUTE ON FUNCTION mark_attendance(uuid,uuid,attendance_status,date,boolean,boolean) TO authenticated; GRANT EXECUTE ON FUNCTION mark_attendance(uuid,uuid,attendance_status,date,boolean,boolean) TO service_role;
REVOKE ALL ON FUNCTION mark_worker_absences(uuid,date,date) FROM PUBLIC, anon, authenticated, service_role; GRANT EXECUTE ON FUNCTION mark_worker_absences(uuid,date,date) TO authenticated; GRANT EXECUTE ON FUNCTION mark_worker_absences(uuid,date,date) TO service_role;
REVOKE ALL ON FUNCTION offered_rule(uuid,date) FROM PUBLIC, anon, authenticated, service_role; GRANT EXECUTE ON FUNCTION offered_rule(uuid,date) TO anon; GRANT EXECUTE ON FUNCTION offered_rule(uuid,date) TO authenticated; GRANT EXECUTE ON FUNCTION offered_rule(uuid,date) TO service_role; GRANT EXECUTE ON FUNCTION offered_rule(uuid,date) TO PUBLIC;
REVOKE ALL ON FUNCTION pay_private_session(uuid,integer) FROM PUBLIC, anon, authenticated, service_role; GRANT EXECUTE ON FUNCTION pay_private_session(uuid,integer) TO authenticated; GRANT EXECUTE ON FUNCTION pay_private_session(uuid,integer) TO service_role;
REVOKE ALL ON FUNCTION pay_private_session_teacher(uuid,integer) FROM PUBLIC, anon, authenticated, service_role; GRANT EXECUTE ON FUNCTION pay_private_session_teacher(uuid,integer) TO authenticated; GRANT EXECUTE ON FUNCTION pay_private_session_teacher(uuid,integer) TO service_role;
REVOKE ALL ON FUNCTION pay_registration_fee_cash(uuid,integer,text) FROM PUBLIC, anon, authenticated, service_role; GRANT EXECUTE ON FUNCTION pay_registration_fee_cash(uuid,integer,text) TO authenticated; GRANT EXECUTE ON FUNCTION pay_registration_fee_cash(uuid,integer,text) TO service_role;
REVOKE ALL ON FUNCTION pay_student_debt(uuid,integer) FROM PUBLIC, anon, authenticated, service_role; GRANT EXECUTE ON FUNCTION pay_student_debt(uuid,integer) TO authenticated; GRANT EXECUTE ON FUNCTION pay_student_debt(uuid,integer) TO service_role;
REVOKE ALL ON FUNCTION pay_teacher_sessions(uuid,text[],integer,text,integer,jsonb,text,uuid[],uuid[],boolean) FROM PUBLIC, anon, authenticated, service_role; GRANT EXECUTE ON FUNCTION pay_teacher_sessions(uuid,text[],integer,text,integer,jsonb,text,uuid[],uuid[],boolean) TO authenticated; GRANT EXECUTE ON FUNCTION pay_teacher_sessions(uuid,text[],integer,text,integer,jsonb,text,uuid[],uuid[],boolean) TO service_role;
REVOKE ALL ON FUNCTION pay_teacher_sessions(uuid,text[],integer,text,integer,jsonb,text,uuid[],uuid[],boolean,uuid[]) FROM PUBLIC, anon, authenticated, service_role; GRANT EXECUTE ON FUNCTION pay_teacher_sessions(uuid,text[],integer,text,integer,jsonb,text,uuid[],uuid[],boolean,uuid[]) TO authenticated; GRANT EXECUTE ON FUNCTION pay_teacher_sessions(uuid,text[],integer,text,integer,jsonb,text,uuid[],uuid[],boolean,uuid[]) TO service_role;
REVOKE ALL ON FUNCTION pay_worker_period(uuid,text,text,date,date,uuid[],integer,text,jsonb,uuid[],uuid[],boolean) FROM PUBLIC, anon, authenticated, service_role; GRANT EXECUTE ON FUNCTION pay_worker_period(uuid,text,text,date,date,uuid[],integer,text,jsonb,uuid[],uuid[],boolean) TO authenticated; GRANT EXECUTE ON FUNCTION pay_worker_period(uuid,text,text,date,date,uuid[],integer,text,jsonb,uuid[],uuid[],boolean) TO service_role;
REVOKE ALL ON FUNCTION pay_worker_shifts(uuid,uuid[],integer,text) FROM PUBLIC, anon, authenticated, service_role; GRANT EXECUTE ON FUNCTION pay_worker_shifts(uuid,uuid[],integer,text) TO authenticated; GRANT EXECUTE ON FUNCTION pay_worker_shifts(uuid,uuid[],integer,text) TO service_role;
REVOKE ALL ON FUNCTION process_weekly_absences(timestamp with time zone) FROM PUBLIC, anon, authenticated, service_role; GRANT EXECUTE ON FUNCTION process_weekly_absences(timestamp with time zone) TO authenticated; GRANT EXECUTE ON FUNCTION process_weekly_absences(timestamp with time zone) TO service_role;
REVOKE ALL ON FUNCTION program_private_session(uuid,jsonb) FROM PUBLIC, anon, authenticated, service_role; GRANT EXECUTE ON FUNCTION program_private_session(uuid,jsonb) TO authenticated; GRANT EXECUTE ON FUNCTION program_private_session(uuid,jsonb) TO service_role;
REVOKE ALL ON FUNCTION protect_reception_payment_fields() FROM PUBLIC, anon, authenticated, service_role; GRANT EXECUTE ON FUNCTION protect_reception_payment_fields() TO anon; GRANT EXECUTE ON FUNCTION protect_reception_payment_fields() TO authenticated; GRANT EXECUTE ON FUNCTION protect_reception_payment_fields() TO service_role; GRANT EXECUTE ON FUNCTION protect_reception_payment_fields() TO PUBLIC;
REVOKE ALL ON FUNCTION protect_student_financial_fields() FROM PUBLIC, anon, authenticated, service_role; GRANT EXECUTE ON FUNCTION protect_student_financial_fields() TO anon; GRANT EXECUTE ON FUNCTION protect_student_financial_fields() TO authenticated; GRANT EXECUTE ON FUNCTION protect_student_financial_fields() TO service_role; GRANT EXECUTE ON FUNCTION protect_student_financial_fields() TO PUBLIC;
REVOKE ALL ON FUNCTION protect_teacher_payment_fields() FROM PUBLIC, anon, authenticated, service_role; GRANT EXECUTE ON FUNCTION protect_teacher_payment_fields() TO anon; GRANT EXECUTE ON FUNCTION protect_teacher_payment_fields() TO authenticated; GRANT EXECUTE ON FUNCTION protect_teacher_payment_fields() TO service_role; GRANT EXECUTE ON FUNCTION protect_teacher_payment_fields() TO PUBLIC;
REVOKE ALL ON FUNCTION reprice_session(uuid,integer,integer,integer,date) FROM PUBLIC, anon, authenticated, service_role; GRANT EXECUTE ON FUNCTION reprice_session(uuid,integer,integer,integer,date) TO authenticated; GRANT EXECUTE ON FUNCTION reprice_session(uuid,integer,integer,integer,date) TO service_role;
REVOKE ALL ON FUNCTION reschedule_private_session(uuid,timestamp with time zone) FROM PUBLIC, anon, authenticated, service_role; GRANT EXECUTE ON FUNCTION reschedule_private_session(uuid,timestamp with time zone) TO authenticated; GRANT EXECUTE ON FUNCTION reschedule_private_session(uuid,timestamp with time zone) TO service_role;
REVOKE ALL ON FUNCTION resolve_worker_absence(uuid,integer,text) FROM PUBLIC, anon, authenticated, service_role; GRANT EXECUTE ON FUNCTION resolve_worker_absence(uuid,integer,text) TO authenticated; GRANT EXECUTE ON FUNCTION resolve_worker_absence(uuid,integer,text) TO service_role;
REVOKE ALL ON FUNCTION scan_card(text,timestamp with time zone) FROM PUBLIC, anon, authenticated, service_role; GRANT EXECUTE ON FUNCTION scan_card(text,timestamp with time zone) TO authenticated; GRANT EXECUTE ON FUNCTION scan_card(text,timestamp with time zone) TO service_role;
REVOKE ALL ON FUNCTION scan_refuses_on_low_balance() FROM PUBLIC, anon, authenticated, service_role; GRANT EXECUTE ON FUNCTION scan_refuses_on_low_balance() TO anon; GRANT EXECUTE ON FUNCTION scan_refuses_on_low_balance() TO authenticated; GRANT EXECUTE ON FUNCTION scan_refuses_on_low_balance() TO service_role; GRANT EXECUTE ON FUNCTION scan_refuses_on_low_balance() TO PUBLIC;
REVOKE ALL ON FUNCTION scan_worker_card(text,timestamp with time zone) FROM PUBLIC, anon, authenticated, service_role; GRANT EXECUTE ON FUNCTION scan_worker_card(text,timestamp with time zone) TO authenticated; GRANT EXECUTE ON FUNCTION scan_worker_card(text,timestamp with time zone) TO service_role;
REVOKE ALL ON FUNCTION sees_announcement_groups(uuid[]) FROM PUBLIC, anon, authenticated, service_role; GRANT EXECUTE ON FUNCTION sees_announcement_groups(uuid[]) TO anon; GRANT EXECUTE ON FUNCTION sees_announcement_groups(uuid[]) TO authenticated; GRANT EXECUTE ON FUNCTION sees_announcement_groups(uuid[]) TO service_role; GRANT EXECUTE ON FUNCTION sees_announcement_groups(uuid[]) TO PUBLIC;
REVOKE ALL ON FUNCTION session_audience_class_ids(uuid) FROM PUBLIC, anon, authenticated, service_role; GRANT EXECUTE ON FUNCTION session_audience_class_ids(uuid) TO anon; GRANT EXECUTE ON FUNCTION session_audience_class_ids(uuid) TO authenticated; GRANT EXECUTE ON FUNCTION session_audience_class_ids(uuid) TO service_role; GRANT EXECUTE ON FUNCTION session_audience_class_ids(uuid) TO PUBLIC;
REVOKE ALL ON FUNCTION session_inherit_subscription() FROM PUBLIC, anon, authenticated, service_role; GRANT EXECUTE ON FUNCTION session_inherit_subscription() TO anon; GRANT EXECUTE ON FUNCTION session_inherit_subscription() TO authenticated; GRANT EXECUTE ON FUNCTION session_inherit_subscription() TO service_role; GRANT EXECUTE ON FUNCTION session_inherit_subscription() TO PUBLIC;
REVOKE ALL ON FUNCTION set_private_session_status(uuid,text) FROM PUBLIC, anon, authenticated, service_role; GRANT EXECUTE ON FUNCTION set_private_session_status(uuid,text) TO authenticated; GRANT EXECUTE ON FUNCTION set_private_session_status(uuid,text) TO service_role;
REVOKE ALL ON FUNCTION set_subscription_price(uuid,integer,integer,integer) FROM PUBLIC, anon, authenticated, service_role; GRANT EXECUTE ON FUNCTION set_subscription_price(uuid,integer,integer,integer) TO authenticated; GRANT EXECUTE ON FUNCTION set_subscription_price(uuid,integer,integer,integer) TO service_role;
REVOKE ALL ON FUNCTION set_worker_shift(uuid,date,timestamp with time zone,timestamp with time zone,text,text) FROM PUBLIC, anon, authenticated, service_role; GRANT EXECUTE ON FUNCTION set_worker_shift(uuid,date,timestamp with time zone,timestamp with time zone,text,text) TO authenticated; GRANT EXECUTE ON FUNCTION set_worker_shift(uuid,date,timestamp with time zone,timestamp with time zone,text,text) TO service_role;
REVOKE ALL ON FUNCTION settle_registration_fee(uuid,integer,text) FROM PUBLIC, anon, authenticated, service_role; GRANT EXECUTE ON FUNCTION settle_registration_fee(uuid,integer,text) TO authenticated; GRANT EXECUTE ON FUNCTION settle_registration_fee(uuid,integer,text) TO service_role;
REVOKE ALL ON FUNCTION settle_teacher_percentage(uuid) FROM PUBLIC, anon, authenticated, service_role; GRANT EXECUTE ON FUNCTION settle_teacher_percentage(uuid) TO authenticated; GRANT EXECUTE ON FUNCTION settle_teacher_percentage(uuid) TO service_role;
REVOKE ALL ON FUNCTION sibling_session_ids(uuid) FROM PUBLIC, anon, authenticated, service_role; GRANT EXECUTE ON FUNCTION sibling_session_ids(uuid) TO anon; GRANT EXECUTE ON FUNCTION sibling_session_ids(uuid) TO authenticated; GRANT EXECUTE ON FUNCTION sibling_session_ids(uuid) TO service_role; GRANT EXECUTE ON FUNCTION sibling_session_ids(uuid) TO PUBLIC;
REVOKE ALL ON FUNCTION student_class_ids(uuid,date) FROM PUBLIC, anon, authenticated, service_role; GRANT EXECUTE ON FUNCTION student_class_ids(uuid,date) TO anon; GRANT EXECUTE ON FUNCTION student_class_ids(uuid,date) TO authenticated; GRANT EXECUTE ON FUNCTION student_class_ids(uuid,date) TO service_role; GRANT EXECUTE ON FUNCTION student_class_ids(uuid,date) TO PUBLIC;
REVOKE ALL ON FUNCTION student_group_ids(uuid) FROM PUBLIC, anon, authenticated, service_role; GRANT EXECUTE ON FUNCTION student_group_ids(uuid) TO anon; GRANT EXECUTE ON FUNCTION student_group_ids(uuid) TO authenticated; GRANT EXECUTE ON FUNCTION student_group_ids(uuid) TO service_role; GRANT EXECUTE ON FUNCTION student_group_ids(uuid) TO PUBLIC;
REVOKE ALL ON FUNCTION student_session_price(uuid,uuid,date) FROM PUBLIC, anon, authenticated, service_role; GRANT EXECUTE ON FUNCTION student_session_price(uuid,uuid,date) TO anon; GRANT EXECUTE ON FUNCTION student_session_price(uuid,uuid,date) TO authenticated; GRANT EXECUTE ON FUNCTION student_session_price(uuid,uuid,date) TO service_role; GRANT EXECUTE ON FUNCTION student_session_price(uuid,uuid,date) TO PUBLIC;
REVOKE ALL ON FUNCTION student_session_rank(uuid,uuid,date) FROM PUBLIC, anon, authenticated, service_role; GRANT EXECUTE ON FUNCTION student_session_rank(uuid,uuid,date) TO anon; GRANT EXECUTE ON FUNCTION student_session_rank(uuid,uuid,date) TO authenticated; GRANT EXECUTE ON FUNCTION student_session_rank(uuid,uuid,date) TO service_role; GRANT EXECUTE ON FUNCTION student_session_rank(uuid,uuid,date) TO PUBLIC;
REVOKE ALL ON FUNCTION subscription_sync_siblings() FROM PUBLIC, anon, authenticated, service_role; GRANT EXECUTE ON FUNCTION subscription_sync_siblings() TO anon; GRANT EXECUTE ON FUNCTION subscription_sync_siblings() TO authenticated; GRANT EXECUTE ON FUNCTION subscription_sync_siblings() TO service_role; GRANT EXECUTE ON FUNCTION subscription_sync_siblings() TO PUBLIC;
REVOKE ALL ON FUNCTION sync_changes(timestamp with time zone) FROM PUBLIC, anon, authenticated, service_role; GRANT EXECUTE ON FUNCTION sync_changes(timestamp with time zone) TO authenticated; GRANT EXECUTE ON FUNCTION sync_changes(timestamp with time zone) TO service_role;
REVOKE ALL ON FUNCTION sync_record_deletion() FROM PUBLIC, anon, authenticated, service_role; GRANT EXECUTE ON FUNCTION sync_record_deletion() TO service_role;
REVOKE ALL ON FUNCTION sync_teacher_dues(uuid,date) FROM PUBLIC, anon, authenticated, service_role; GRANT EXECUTE ON FUNCTION sync_teacher_dues(uuid,date) TO authenticated; GRANT EXECUTE ON FUNCTION sync_teacher_dues(uuid,date) TO service_role;
REVOKE ALL ON FUNCTION sync_touch_parent_from_student() FROM PUBLIC, anon, authenticated, service_role; GRANT EXECUTE ON FUNCTION sync_touch_parent_from_student() TO service_role;
REVOKE ALL ON FUNCTION sync_touch_student_from_enrollment() FROM PUBLIC, anon, authenticated, service_role; GRANT EXECUTE ON FUNCTION sync_touch_student_from_enrollment() TO service_role;
REVOKE ALL ON FUNCTION sync_touch_updated_at() FROM PUBLIC, anon, authenticated, service_role; GRANT EXECUTE ON FUNCTION sync_touch_updated_at() TO anon; GRANT EXECUTE ON FUNCTION sync_touch_updated_at() TO authenticated; GRANT EXECUTE ON FUNCTION sync_touch_updated_at() TO service_role; GRANT EXECUTE ON FUNCTION sync_touch_updated_at() TO PUBLIC;
REVOKE ALL ON FUNCTION teaches_private_session(uuid) FROM PUBLIC, anon, authenticated, service_role; GRANT EXECUTE ON FUNCTION teaches_private_session(uuid) TO authenticated; GRANT EXECUTE ON FUNCTION teaches_private_session(uuid) TO service_role;
REVOKE ALL ON FUNCTION teaches_session(uuid) FROM PUBLIC, anon, authenticated, service_role; GRANT EXECUTE ON FUNCTION teaches_session(uuid) TO anon; GRANT EXECUTE ON FUNCTION teaches_session(uuid) TO authenticated; GRANT EXECUTE ON FUNCTION teaches_session(uuid) TO service_role; GRANT EXECUTE ON FUNCTION teaches_session(uuid) TO PUBLIC;
REVOKE ALL ON FUNCTION teaches_student(uuid) FROM PUBLIC, anon, authenticated, service_role; GRANT EXECUTE ON FUNCTION teaches_student(uuid) TO anon; GRANT EXECUTE ON FUNCTION teaches_student(uuid) TO authenticated; GRANT EXECUTE ON FUNCTION teaches_student(uuid) TO service_role; GRANT EXECUTE ON FUNCTION teaches_student(uuid) TO PUBLIC;
REVOKE ALL ON FUNCTION time_to_minutes(text) FROM PUBLIC, anon, authenticated, service_role; GRANT EXECUTE ON FUNCTION time_to_minutes(text) TO anon; GRANT EXECUTE ON FUNCTION time_to_minutes(text) TO authenticated; GRANT EXECUTE ON FUNCTION time_to_minutes(text) TO service_role; GRANT EXECUTE ON FUNCTION time_to_minutes(text) TO PUBLIC;
REVOKE ALL ON FUNCTION update_attendance(uuid,attendance_status,timestamp with time zone,integer) FROM PUBLIC, anon, authenticated, service_role; GRANT EXECUTE ON FUNCTION update_attendance(uuid,attendance_status,timestamp with time zone,integer) TO authenticated; GRANT EXECUTE ON FUNCTION update_attendance(uuid,attendance_status,timestamp with time zone,integer) TO service_role;
REVOKE ALL ON FUNCTION update_balance_tx(uuid,integer,text,timestamp with time zone,balance_tx_type,boolean) FROM PUBLIC, anon, authenticated, service_role; GRANT EXECUTE ON FUNCTION update_balance_tx(uuid,integer,text,timestamp with time zone,balance_tx_type,boolean) TO authenticated; GRANT EXECUTE ON FUNCTION update_balance_tx(uuid,integer,text,timestamp with time zone,balance_tx_type,boolean) TO service_role;
REVOKE ALL ON FUNCTION update_private_request(uuid,jsonb) FROM PUBLIC, anon, authenticated, service_role; GRANT EXECUTE ON FUNCTION update_private_request(uuid,jsonb) TO authenticated; GRANT EXECUTE ON FUNCTION update_private_request(uuid,jsonb) TO service_role;
REVOKE ALL ON FUNCTION update_private_session(uuid,jsonb) FROM PUBLIC, anon, authenticated, service_role; GRANT EXECUTE ON FUNCTION update_private_session(uuid,jsonb) TO authenticated; GRANT EXECUTE ON FUNCTION update_private_session(uuid,jsonb) TO service_role;
REVOKE ALL ON FUNCTION update_teacher_payment(uuid,integer,text,integer,text,timestamp with time zone) FROM PUBLIC, anon, authenticated, service_role; GRANT EXECUTE ON FUNCTION update_teacher_payment(uuid,integer,text,integer,text,timestamp with time zone) TO authenticated; GRANT EXECUTE ON FUNCTION update_teacher_payment(uuid,integer,text,integer,text,timestamp with time zone) TO service_role;
REVOKE ALL ON FUNCTION week_anchor(date,smallint) FROM PUBLIC, anon, authenticated, service_role; GRANT EXECUTE ON FUNCTION week_anchor(date,smallint) TO anon; GRANT EXECUTE ON FUNCTION week_anchor(date,smallint) TO authenticated; GRANT EXECUTE ON FUNCTION week_anchor(date,smallint) TO service_role; GRANT EXECUTE ON FUNCTION week_anchor(date,smallint) TO PUBLIC;
REVOKE ALL ON FUNCTION worker_works_on(uuid,date) FROM PUBLIC, anon, authenticated, service_role; GRANT EXECUTE ON FUNCTION worker_works_on(uuid,date) TO authenticated; GRANT EXECUTE ON FUNCTION worker_works_on(uuid,date) TO service_role;
REVOKE ALL ON FUNCTION write_private_session_modules(uuid,jsonb) FROM PUBLIC, anon, authenticated, service_role; GRANT EXECUTE ON FUNCTION write_private_session_modules(uuid,jsonb) TO anon; GRANT EXECUTE ON FUNCTION write_private_session_modules(uuid,jsonb) TO authenticated; GRANT EXECUTE ON FUNCTION write_private_session_modules(uuid,jsonb) TO service_role; GRANT EXECUTE ON FUNCTION write_private_session_modules(uuid,jsonb) TO PUBLIC;
REVOKE ALL ON FUNCTION write_private_session_students(uuid,jsonb) FROM PUBLIC, anon, authenticated, service_role; GRANT EXECUTE ON FUNCTION write_private_session_students(uuid,jsonb) TO anon; GRANT EXECUTE ON FUNCTION write_private_session_students(uuid,jsonb) TO authenticated; GRANT EXECUTE ON FUNCTION write_private_session_students(uuid,jsonb) TO service_role; GRANT EXECUTE ON FUNCTION write_private_session_students(uuid,jsonb) TO PUBLIC;
-- audit log: read-only for app roles, as on the old project
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.sync_deletions FROM anon, authenticated;
