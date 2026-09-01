-- =============================================================================
-- Séances offertes, règlements enseignants et re-tarification des créneaux
-- Run once against the live project (Supabase Dashboard -> SQL Editor).
--
-- CE QUE CE SCRIPT CORRIGE
--
-- 1. UNE SÉANCE OFFERTE NE DOIT RIEN COÛTER, À PERSONNE.
--    Un créneau coché « offert » (sessions.is_free) et une période gratuite
--    qui ne rémunère pas (free_periods.pay_teachers = false) écrivaient
--    quand même une ligne unpaid_teacher_sessions — à 0 DA, mais bien
--    présente. L'écran Enseignants la lisait et affichait le créneau comme
--    « séance non payée » à régler. scan_card et mark_attendance n'écrivent
--    désormais AUCUNE ligne de rémunération quand l'enseignant ne gagne rien.
--    Le solde de l'élève, lui, n'était déjà pas débité : c'est inchangé.
--
-- 2. DEUX SÉANCES À LA MÊME HEURE : LA GRATUITE L'EMPORTE.
--    Quand un créneau payant et un créneau offert se chevauchent et que
--    l'élève est inscrit sur les deux, le scan choisissait au hasard — en
--    pratique toujours le payant, donc l'élève était débité d'une séance
--    offerte. L'ordre de sélection classe maintenant explicitement le créneau
--    OFFERT avant le créneau payant, à inscription égale.
--
-- 3. RÉPARATION DES DONNÉES DÉJÀ ÉCRITES.
--    Les lignes de rémunération non réglées posées à tort sur des séances
--    offertes sont supprimées. RIEN D'AUTRE N'EST TOUCHÉ : aucun solde élève,
--    aucune présence, aucune ligne déjà réglée (paid = true), aucun règlement
--    déjà versé.
--
-- 4. GESTION DES SÉANCES DUES ET DE L'HISTORIQUE DES RÈGLEMENTS.
--    · delete_unpaid_teacher_sessions() — retirer des séances dues choisies.
--    · update_teacher_payment() / delete_teacher_payment() — modifier ou
--      annuler un règlement de l'historique, en rendant les séances à régler
--      et en corrigeant la caisse.
--    Pour qu'un règlement soit annulable, les acomptes et les retenues
--    d'absence ne sont plus SUPPRIMÉS au moment de payer : ils sont rattachés
--    au règlement (payment_id). Annuler le règlement les rend disponibles.
--
-- 5. CORRIGER LE MONTANT D'UNE PRÉSENCE NE MARCHAIT PLUS.
--    update_attendance() écrivait 'deduction' / 'topup' en texte brut dans
--    balance_tx.type, qui est une énumération : Postgres refusait la ligne
--    (« column "type" is of type balance_tx_type but expression is of type
--    text ») et TOUTE correction de montant depuis l'écran Présences échouait.
--    La conversion manquante est ajoutée.
--
-- 6. CHANGER LE PRIX D'UN CRÉNEAU MET À JOUR CE QUI N'EST PAS ENCORE RÉGLÉ.
--    reprice_session() écrit le tarif sur tous les groupes du cours ET
--    ré-évalue, à partir d'une date choisie, les présences déjà pointées :
--    le débit de l'élève est corrigé (avec sa ligne de compte), et la part
--    de l'enseignant encore due suit le nouveau tarif. Les séances déjà
--    RÉGLÉES à l'enseignant ne sont jamais retouchées.
--
-- Ce script est IDEMPOTENT : ré-exécutable sans risque.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 0. Colonnes attendues par le code (re-posées ici pour être auto-suffisant)
-- ---------------------------------------------------------------------------
alter table public.sessions
  add column if not exists is_free boolean not null default false;

alter table public.independent_sessions
  add column if not exists is_free boolean not null default false,
  add column if not exists waived_amount integer not null default 0;

alter table public.balance_tx
  add column if not exists module_id uuid references public.modules (id) on delete set null;

-- Le règlement retrouve son mouvement de caisse : sans ce lien, annuler un
-- règlement laisserait la caisse débitée.
alter table public.teacher_payments
  add column if not exists cash_tx_id uuid references public.cash_transactions (id) on delete set null;

-- Acomptes et retenues : consommés par un règlement au lieu d'être détruits.
alter table public.teacher_acomptes
  add column if not exists payment_id uuid references public.teacher_payments (id) on delete set null;

alter table public.teacher_absences
  add column if not exists payment_id uuid references public.teacher_payments (id) on delete set null;

create index if not exists teacher_acomptes_payment_id_idx on public.teacher_acomptes (payment_id);
create index if not exists teacher_absences_payment_id_idx on public.teacher_absences (payment_id);
create index if not exists teacher_payments_paid_at_idx on public.teacher_payments (paid_at desc);
create index if not exists sessions_is_free_idx on public.sessions (is_free) where is_free;

-- Rattrapage des règlements déjà écrits : on retrouve leur mouvement de caisse
-- par montant + horodatage (à 5 secondes près), sans jamais en réutiliser un.
update public.teacher_payments tp
   set cash_tx_id = c.id
  from public.cash_transactions c
 where tp.cash_tx_id is null
   and c.type = 'teacher_payment'
   and c.amount = -tp.amount
   and abs(extract(epoch from (c.date - tp.paid_at))) < 5
   and not exists (
     select 1 from public.teacher_payments t2
     where t2.cash_tx_id = c.id and t2.id <> tp.id
   );

-- ---------------------------------------------------------------------------
-- 1. Helper : tarif NET d'un élève sur un créneau, réduction comprise
--    Même cascade que le scan : son inscription sur CE créneau, sinon son
--    inscription au même cours (autre groupe = rattrapage), sinon le tarif
--    affiché du créneau.
-- ---------------------------------------------------------------------------
create or replace function public.student_session_price(
  p_student_id uuid,
  p_session_id uuid,
  p_date date default current_date
)
returns integer
language sql stable set search_path = public as $$
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
    (select sub.price_per_session from public.subscriptions sub
      where sub.session_id = p_session_id limit 1),
    0);
$$;

grant execute on function public.student_session_price(uuid, uuid, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. scan_card — la séance offerte ne rémunère personne, et gagne l'arbitrage
--    Identique à 20260820_free_seance_billing_and_card_lookup, avec DEUX
--    changements de règle :
--      · l'ordre de sélection place le créneau OFFERT devant le créneau
--        payant quand les deux se chevauchent et que l'élève est inscrit
--        pareillement sur les deux ;
--      · aucune ligne unpaid_teacher_sessions n'est écrite quand l'enseignant
--        ne gagne rien sur la séance (créneau offert, ou période gratuite
--        réglée « sans rémunération »).
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
  v_teacher_earns boolean := true;
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
    -- 1. une séance commencée passe avant une séance qui n'a pas encore débuté
    (case when v_now_min >= public.time_to_minutes(se.start_time) then 0 else 1 end),
    -- 2. le créneau où l'élève est NOMMÉMENT inscrit passe avant un simple
    --    rattrapage sur un autre groupe du même cours
    (case when exists (
       select 1 from public.subscriptions s2
       join public.student_subscriptions ss2 on ss2.subscription_id = s2.id
       where s2.session_id = se.id and ss2.student_id = v_student.id
     ) then 0 else 1 end),
    -- 3. À INSCRIPTION ÉGALE, LA SÉANCE OFFERTE L'EMPORTE. Deux créneaux à la
    --    même heure — un payant, un offert — ne peuvent pas être départagés
    --    par l'horaire : sans cette règle le scan débitait l'élève sur le
    --    créneau payant alors que l'école avait offert la séance.
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

  -- L'enseignant gagne-t-il quelque chose sur CETTE séance ?
  --   · créneau offert            -> non, personne n'encaisse rien ;
  --   · période gratuite « sans rémunération » -> non ;
  --   · période gratuite qui rémunère, ou séance antérieure au début de
  --     l'abonnement                            -> oui, sur le prix non facturé ;
  --   · séance ordinaire                        -> oui, sur le prix encaissé.
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
    'teacherPaid', v_teacher_earns,
    'messageKey', case when v_status = 'late' then 'scan.successLate' else 'scan.success' end
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. mark_attendance — même règle en saisie manuelle (écran Présences et
--    écran Appel de l'enseignant)
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
      when v_new_balance < 0 then 'scan.successDebt'
      when p_status = 'late' then 'scan.successLate'
      else 'scan.success'
    end
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Retirer des séances dues choisies (jamais une séance déjà réglée)
-- ---------------------------------------------------------------------------
create or replace function public.delete_unpaid_teacher_sessions(
  p_teacher_id uuid,
  p_ids uuid[]
)
returns jsonb
language plpgsql security definer set search_path = public as $$
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

revoke execute on function public.delete_unpaid_teacher_sessions(uuid, uuid[]) from public, anon;
grant execute on function public.delete_unpaid_teacher_sessions(uuid, uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. pay_teacher_sessions — consomme (sans détruire) acomptes et retenues,
--    et garde le lien vers son mouvement de caisse
--    L'ancienne signature à 7 arguments est retirée : deux surcharges rendraient
--    l'appel REST ambigu.
-- ---------------------------------------------------------------------------
drop function if exists public.pay_teacher_sessions(uuid, text[], integer, text, integer, jsonb, text);

create or replace function public.pay_teacher_sessions(
  p_teacher_id uuid,
  p_keys text[],                      -- 'YYYY-MM-DD|session_uuid'
  p_amount integer,
  p_method text default 'fixed',
  p_percentage integer default null,
  p_details jsonb default '[]'::jsonb,
  p_description text default '',
  p_acompte_ids uuid[] default null,  -- null = tous les acomptes en attente
  p_absence_ids uuid[] default null,  -- null = toutes les retenues en attente
  p_settle_deductions boolean default false
)
returns jsonb
language plpgsql security definer set search_path = public as $$
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

revoke execute on function public.pay_teacher_sessions(uuid, text[], integer, text, integer, jsonb, text, uuid[], uuid[], boolean) from public, anon;
grant execute on function public.pay_teacher_sessions(uuid, text[], integer, text, integer, jsonb, text, uuid[], uuid[], boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. settle_teacher_percentage — écrit désormais une ligne d'historique
--    (teacher_payments) modifiable et annulable, et ne détruit plus les
--    acomptes/retenues qu'il consomme.
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

revoke execute on function public.settle_teacher_percentage(uuid) from public, anon;
grant execute on function public.settle_teacher_percentage(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Modifier un règlement de l'historique
--    Le montant versé change -> le mouvement de caisse suit. Les créneaux
--    réglés, eux, ne bougent pas : pour les rendre, il faut annuler.
-- ---------------------------------------------------------------------------
create or replace function public.update_teacher_payment(
  p_payment_id uuid,
  p_amount integer default null,
  p_method text default null,
  p_percentage integer default null,
  p_description text default null,
  p_paid_at timestamptz default null
)
returns jsonb
language plpgsql security definer set search_path = public as $$
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

revoke execute on function public.update_teacher_payment(uuid, integer, text, integer, text, timestamptz) from public, anon;
grant execute on function public.update_teacher_payment(uuid, integer, text, integer, text, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Annuler un règlement
--    Les créneaux réglés redeviennent dus, les acomptes et retenues consommés
--    redeviennent exigibles, le mouvement de caisse est retiré.
-- ---------------------------------------------------------------------------
create or replace function public.delete_teacher_payment(p_payment_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_role user_role := public.current_role();
  v_pay public.teacher_payments%rowtype;
  v_restored int := 0;
  v_touched int := 0;
  v_d jsonb;
  v_date date;
  v_session uuid;
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

    update public.independent_sessions
       set teacher_paid = false
     where session_id = v_session
       and student_id is null
       and teacher_paid = true
       and date = v_date;
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
$$;

revoke execute on function public.delete_teacher_payment(uuid) from public, anon;
grant execute on function public.delete_teacher_payment(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. reprice_session — le nouveau tarif descend jusqu'aux séances déjà pointées
--    p_from = NULL  : seul le tarif change (comportement d'avant).
--    p_from = date  : toutes les présences pointées à partir de ce jour-là sont
--                     ré-évaluées — débit de l'élève corrigé avec sa ligne de
--                     compte, part de l'enseignant ENCORE DUE recalculée.
--    Une séance déjà RÉGLÉE à l'enseignant n'est jamais retouchée : son montant
--    a été versé, le corriger fausserait la caisse.
-- ---------------------------------------------------------------------------
create or replace function public.reprice_session(
  p_session_id uuid,
  p_price integer default 0,
  p_level_price integer default null,
  p_period_months integer default null,
  p_from date default null
)
returns jsonb
language plpgsql security definer set search_path = public as $$
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
  v_dues int := 0;
  v_due_rows int := 0;
  v_module_name text;
  v_group_name text;
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
      select a.*, se.module_id, se.start_time, se.end_time, st.is_free as student_free
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

      -- La part de l'enseignant ENCORE DUE suit le nouveau tarif. Une séance
      -- offerte qui rémunère quand même (période gratuite « avec paie », séance
      -- antérieure au début de l'abonnement) a bien une ligne ici : elle suit
      -- le même prix. Une séance déjà réglée (paid = true) est laissée intacte.
      update public.unpaid_teacher_sessions u
         set amount = round(v_new_price * coalesce(t.percentage, 0) / 100.0)
        from public.teachers t
       where t.id = u.teacher_id
         and t.payment_type = 'percentage'
         and u.paid = false
         and u.student_id = v_att.student_id
         and u.session_id = v_att.session_id
         and (timezone('Africa/Algiers', u.date))::date
             = (timezone('Africa/Algiers', v_att.occurred_at))::date;
      get diagnostics v_due_rows = row_count;
      v_dues := v_dues + v_due_rows;
    end loop;
  end if;

  return jsonb_build_object('ok', true,
    'groups', v_created + v_updated,
    'created', v_created,
    'repriced', v_repriced,
    'charged', v_charged,
    'refunded', v_refunded,
    'teacherDues', v_dues);
end;
$$;

revoke execute on function public.reprice_session(uuid, integer, integer, integer, date) from public, anon;
grant execute on function public.reprice_session(uuid, integer, integer, integer, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 10. update_attendance — CORRIGER LE MONTANT D'UNE PRÉSENCE NE MARCHAIT PAS
--     « column "type" is of type balance_tx_type but expression is of type text »
--     Le CASE qui choisit 'deduction' / 'topup' produit du `text`, que Postgres
--     refuse d'écrire dans une colonne d'énumération sans conversion : toute
--     correction de montant depuis l'écran Présences échouait, sans que le
--     solde ni la part enseignant ne bougent. Seule la conversion manquait.
-- ---------------------------------------------------------------------------
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

revoke execute on function public.update_attendance(uuid, attendance_status, timestamptz, integer) from public, anon;
grant execute on function public.update_attendance(uuid, attendance_status, timestamptz, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 11. RÉPARATION DES DONNÉES — uniquement les rémunérations écrites à tort

--     sur des séances offertes, et uniquement celles qui ne sont PAS réglées.
--     Aucun solde élève, aucune présence, aucun règlement versé n'est touché.
-- ---------------------------------------------------------------------------
do $$
declare
  v_free_seance int := 0;
  v_free_period int := 0;
begin
  -- a) créneau coché « offert » : l'enseignant n'y gagne rien
  delete from public.unpaid_teacher_sessions u
  using public.sessions se
  where se.id = u.session_id
    and u.paid = false
    and coalesce(se.is_free, false);
  get diagnostics v_free_seance = row_count;

  -- b) période gratuite réglée « sans rémunération des enseignants »
  delete from public.unpaid_teacher_sessions u
  using public.attendance a
  join public.free_periods fp on fp.id = a.free_period_id
  where u.paid = false
    and a.student_id = u.student_id
    and a.session_id = u.session_id
    and (timezone('Africa/Algiers', a.occurred_at))::date
        = (timezone('Africa/Algiers', u.date))::date
    and fp.pay_teachers = false;
  get diagnostics v_free_period = row_count;

  raise notice 'Rémunérations retirées — créneaux offerts: %, périodes gratuites non rémunérées: %',
    v_free_seance, v_free_period;
end $$;

-- ---------------------------------------------------------------------------
-- 12. Rechargement du cache de schéma de l'API REST
-- ---------------------------------------------------------------------------
notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- 13. Vérification : ce SELECT doit renvoyer une seule ligne, tout à "ok"
-- ---------------------------------------------------------------------------
select
  (select count(*) from public.unpaid_teacher_sessions u
     join public.sessions se on se.id = u.session_id
    where u.paid = false and coalesce(se.is_free, false))            as dues_sur_seances_offertes,
  (select count(*) from pg_proc where proname = 'reprice_session')    as reprice_session,
  (select count(*) from pg_proc where proname = 'delete_teacher_payment') as delete_teacher_payment,
  (select count(*) from pg_proc where proname = 'update_teacher_payment') as update_teacher_payment,
  (select count(*) from pg_proc where proname = 'delete_unpaid_teacher_sessions') as delete_unpaid,
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'teacher_payments'
      and column_name = 'cash_tx_id')                                as teacher_payments_cash_tx_id,
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'teacher_acomptes'
      and column_name = 'payment_id')                                as acomptes_payment_id;
