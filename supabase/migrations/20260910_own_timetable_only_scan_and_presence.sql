-- =============================================================================
-- CHACUN SUR SON EMPLOI DU TEMPS — et nulle part ailleurs
-- Run once against the live project (Supabase Dashboard -> SQL Editor).
--
-- ---------------------------------------------------------------------------
-- CE QUE CE SCRIPT CHANGE
-- ---------------------------------------------------------------------------
-- Un COURS ORDINAIRE n'accepte plus, au badge comme à la main, que les élèves
-- INSCRITS DESSUS. Rien d'autre n'ouvre plus la porte :
--
--   · ni un autre groupe du même cours (« rattrapage ») ;
--   · ni une classe jumelle — même niveau, même année, même filière ;
--   · ni une classe cochée à la création du créneau.
--
-- C'est mot pour mot la règle demandée : chaque élève badge sur SON emploi du
-- temps, et sur aucun autre — même celui de sa propre classe, de sa propre
-- année et de sa propre filière. Un 3AS sciences du groupe G1 présenté à 8h
-- devant le créneau du groupe G2 est refusé, et sa carte le lui dit.
--
-- ---------------------------------------------------------------------------
-- CE QUE CE SCRIPT NE CHANGE PAS — LES SÉANCES LIBRES
-- ---------------------------------------------------------------------------
-- LES SÉANCES LIBRES (`sessions.is_open`) GARDENT EXACTEMENT LEURS RÈGLES.
-- Le badge et la saisie manuelle s'y comportent mot pour mot comme avant :
--
--   · l'élève inscrit sur la séance libre entre ;
--   · l'élève inscrit au même cours dans un autre groupe entre (rattrapage) ;
--   · l'élève d'une classe du public de la séance entre — public réglé sur
--     l'Emploi du Temps (« classes cochées » = toute la promotion de même
--     niveau et de même année, filière indifférente ; « toute la filière »
--     ajoute les autres années) ;
--   · le passager, qui n'a ni classe ni abonnement, reste encaissable au
--     guichet et pointable à la main : la séance libre existe pour lui.
--
-- Le tarif, la séance OFFERTE, les périodes gratuites, la rémunération de
-- l'enseignant, l'anti-double-badge, la dette : rien n'est touché nulle part.
--
-- ---------------------------------------------------------------------------
-- CE QUE CE SCRIPT NE TOUCHE PAS DU TOUT
-- ---------------------------------------------------------------------------
-- Aucune présence déjà enregistrée n'est supprimée ni corrigée, aucun solde
-- n'est déplacé, aucun abonnement, aucune fiche élève, aucun mouvement de
-- caisse. Ce script ne (re)définit que des fonctions : les présences prises
-- hier sur un autre créneau restent lisibles telles quelles — la section 5 les
-- compte, elle ne les efface pas.
--
-- Ce script est IDEMPOTENT : ré-exécutable sans risque.
-- =============================================================================

-- =============================================================================
-- SECTION 0 — L'INTERRUPTEUR DE LA PORTE, créé une fois, jamais réécrit
-- =============================================================================
-- `scan_card` (section 2) le consulte pour savoir si un solde insuffisant
-- refuse l'entrée. Il n'est créé ici QUE s'il manque, pour qu'une base qui n'a
-- jamais reçu le script autonome ne tombe pas sur une fonction inexistante au
-- premier badge. Un réglage déjà choisi n'est PAS retouché.
--
--   false — l'élève entre, la séance lui est comptée, le solde passe en dette
--           (le réglage installé par 20260904, et la valeur par défaut ici) ;
--   true  — l'entrée est refusée (`scan.expired`), rien n'est enregistré.
do $switch$
begin
  if not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'scan_refuses_on_low_balance'
  ) then
    execute $f$
      create function public.scan_refuses_on_low_balance()
      returns boolean language sql immutable set search_path = public as $body$
        select false
      $body$;
    $f$;
    raise notice 'Politique de porte créée : solde insuffisant = entrée ACCEPTÉE (dette).';
  else
    raise notice 'Politique de porte déjà en place : elle n''est pas touchée.';
  end if;
end
$switch$;

grant execute on function public.scan_refuses_on_low_balance() to authenticated;

-- =============================================================================
-- SECTION 1 — LA PORTE : student_session_rank
-- =============================================================================
-- TOUT passe par cette fonction : `scan_card` la consulte pour choisir le
-- créneau et pour refuser la carte, `mark_attendance` la consulte pour refuser
-- une présence saisie à la main. La régler ici, c'est régler les deux écrans
-- d'un seul geste — et c'est la seule façon qu'ils ne se contredisent jamais.
--
-- LE RANG, ET CE QU'IL VEUT DIRE
--
--   0 — inscrit sur CE créneau ;
--   1 — inscrit au même cours dans un autre groupe (rattrapage) ;
--   2 — rattaché à une classe du public du créneau ;
--   NULL — rien à faire là : carte refusée, présence refusée.
--
-- LE CHANGEMENT TIENT EN UNE CLAUSE : sur un COURS ORDINAIRE, la lecture
-- s'arrête après le rang 0. Les rangs 1 et 2 — l'autre groupe, la classe
-- jumelle — ne sont plus atteints, et la fonction rend NULL.
--
-- SUR UNE SÉANCE LIBRE (`is_open`), les trois rangs restent lus, dans le même
-- ordre et avec les mêmes conditions qu'avant : la clause ajoutée ne s'y
-- exécute pas. C'est ce qui garde les séances libres identiques.
--
-- Le rang sert AUSSI à départager deux créneaux qui se chevauchent dans
-- `scan_card` (le créneau où l'élève est nommément inscrit passe devant) : la
-- valeur 0 garde donc exactement le sens qu'elle avait.
create or replace function public.student_session_rank(
  p_student_id uuid,
  p_session_id uuid,
  p_date date default current_date
)
returns int
language sql stable set search_path = public as $fn$
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
$fn$;

comment on function public.student_session_rank(uuid, uuid, date) is
  'À quel titre un élève assiste à un créneau. COURS ORDINAIRE : 0 (inscrit dessus) ou NULL, rien d''autre. SÉANCE LIBRE : 0 inscrit, 1 rattrapage, 2 par sa classe, NULL refusé.';

grant execute on function public.student_session_rank(uuid, uuid, date) to authenticated;

-- =============================================================================
-- SECTION 2 — scan_card
-- =============================================================================
-- Corps INCHANGÉ. Il est reposé ici pour une seule raison : garantir que le
-- badge passe bien par `student_session_rank`. Une base restée sur une version
-- antérieure lisait l'éligibilité elle-même (« inscrit au même module ET dans
-- la même classe »), et la section 1 ne lui aurait servi à rien — le contrôle
-- de 20260907 le signalait déjà par sa colonne `scan_card_classe`.
--
-- Ce que le badge fait, et qui ne bouge pas : anti-double-badge, séance
-- OFFERTE prioritaire à titre égal, période gratuite, abonnement pas encore
-- commencé, tarif net de la réduction de l'élève, rémunération de
-- l'enseignant, écriture de la présence et du solde, et la politique de porte
-- de la section 0 pour un solde insuffisant.
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

revoke execute on function public.scan_card(text, timestamptz) from public, anon;
grant execute on function public.scan_card(text, timestamptz) to authenticated;

-- =============================================================================
-- SECTION 3 — mark_attendance (saisie manuelle, appel de l'enseignant)
-- =============================================================================
-- Le badge n'est qu'une des deux portes : la feuille de pointage écrit les
-- mêmes présences, et elle avait sa propre échappatoire. Avant de consulter
-- `student_session_rank`, elle cherchait un TARIF à l'élève « au même module et
-- dans la même classe » — et un tarif trouvé valait présence écrite. Un élève
-- du groupe G2 pointé à la main sur le créneau du G1 passait donc, alors même
-- que sa carte allait être refusée à la porte.
--
-- Cette recherche de rattrapage est désormais RÉSERVÉE AUX SÉANCES LIBRES, où
-- elle est mot pour mot celle d'avant. Sur un cours ordinaire, la fonction
-- rend `attendance.notEnrolled` — l'écran Présences l'affiche en clair.
--
-- Tout le reste est INCHANGÉ : une présence est toujours facturée (dette
-- comprise, depuis 20260906), l'absence rembourse et efface la rémunération,
-- le changement de statut ne redébite rien, les séances offertes et les
-- périodes gratuites ne débitent personne.
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

revoke execute on function public.mark_attendance(uuid, uuid, attendance_status, date, boolean, boolean) from public, anon;
grant execute on function public.mark_attendance(uuid, uuid, attendance_status, date, boolean, boolean) to authenticated;

-- =============================================================================
-- SECTION 4 — RECHARGEMENT DU CACHE DE SCHÉMA DE L'API REST
-- =============================================================================
-- Sans cette ligne, PostgREST continue de servir l'ancienne signature et
-- l'écran croit que la migration n'est pas passée.
notify pgrst, 'reload schema';

-- =============================================================================
-- SECTION 5 — CONTRÔLE (lecture seule) — rien n'est corrigé ici
-- =============================================================================

-- a) Les fonctions sont en place, et le badge passe bien par la porte.
--    `scan_card_par_la_porte` DOIT valoir true : à false, le badge décide
--    encore tout seul et la règle ne s'applique pas.
select
  (select count(*) from pg_proc where proname = 'student_session_rank')  as student_session_rank,
  (select count(*) from pg_proc where proname = 'scan_card')             as scan_card,
  (select count(*) from pg_proc where proname = 'mark_attendance')       as mark_attendance,
  (select exists (
     select 1 from pg_proc
      where proname = 'scan_card'
        and prosrc like '%student_session_rank%'))                       as scan_card_par_la_porte,
  case when public.scan_refuses_on_low_balance()
       then 'solde insuffisant = ENTRÉE REFUSÉE'
       else 'solde insuffisant = entrée acceptée, dette enregistrée'
  end                                                                    as politique_de_porte;

-- b) Créneau par créneau : combien d'élèves y sont admis, et à quel titre.
--    Sur un COURS, `dont_hors_inscription` doit valoir 0 — c'est la preuve que
--    plus personne n'entre par sa classe ou par un autre groupe. Sur une
--    SÉANCE LIBRE, cette colonne peut rester peuplée : c'est voulu.
select
  coalesce(se.title, m.name)                                as creneau,
  case when coalesce(se.is_open, false)
       then 'séance libre' else 'cours' end                 as genre,
  se.start_time || '-' || se.end_time                       as horaire,
  (select count(*) from public.students st
    where public.student_session_rank(st.id, se.id, current_date) is not null)  as eleves_admis,
  (select count(*) from public.students st
    where public.student_session_rank(st.id, se.id, current_date) > 0)          as dont_hors_inscription
from public.sessions se
left join public.modules m on m.id = se.module_id
order by coalesce(se.is_open, false) desc, se.start_time;

-- c) L'HÉRITAGE : les présences déjà écrites sur un cours ordinaire où l'élève
--    n'était pas inscrit. Elles ne sont ni supprimées ni remboursées — les
--    séances ont bien été suivies. Cette requête sert à les RETROUVER, pour
--    décider au cas par cas depuis la fiche de l'élève (bouton Modifier de la
--    ligne de présence, qui déplace le solde du même montant).
select
  st.first_name || ' ' || st.last_name                      as eleve,
  coalesce(se.title, m.name)                                as creneau,
  (timezone('Africa/Algiers', a.occurred_at))::date         as jour,
  a.amount_deducted                                         as debite
from public.attendance a
join public.students st on st.id = a.student_id
join public.sessions se on se.id = a.session_id
left join public.modules m on m.id = se.module_id
where not coalesce(se.is_open, false)
  and not exists (
    select 1
    from public.student_subscriptions ss
    join public.subscriptions sub on sub.id = ss.subscription_id
    where ss.student_id = a.student_id
      and sub.session_id = a.session_id
  )
order by jour desc, eleve;
