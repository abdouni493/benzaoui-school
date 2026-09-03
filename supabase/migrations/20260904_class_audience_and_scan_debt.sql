-- =============================================================================
-- 1. Le public d'un créneau se lit sur la CLASSE (classe + année + filière)
-- 2. Étudier sans avoir payé creuse une DETTE, au lieu de refuser en silence
-- Run once against the live project (Supabase Dashboard -> SQL Editor).
--
-- CE QUE CE SCRIPT CORRIGE
--
-- A. « MES ÉLÈVES DE LA MÊME CLASSE NE PEUVENT PAS BADGER SUR LA SÉANCE LIBRE »
--    Le scan ne retrouvait un créneau que si l'élève avait une INSCRIPTION
--    (student_subscriptions) sur le même module ET la même classe. Un créneau
--    — ordinaire, séance libre, ou séance libre offerte — créé pour une classe
--    entière était donc fermé à tous les élèves de cette classe qui n'avaient
--    pas déjà l'abonnement correspondant : la carte sortait « aucune séance de
--    son niveau aujourd'hui ».
--    Désormais le créneau porte son public par la CLASSE : les classes cochées
--    à sa création, ÉLARGIES à toute classe de même niveau, même année et même
--    filière. Tout élève rattaché à l'une d'elles peut badger dessus.
--
-- B. « L'ÉLÈVE A ÉTUDIÉ SANS PAYER ET SON SOLDE N'A PAS BOUGÉ »
--    Deux causes, corrigées ensemble :
--      · le scan REFUSAIT l'entrée quand le solde ne couvrait pas la séance
--        (scan.expired) — aucune présence, aucune dette, donc rien à réclamer
--        plus tard : la séance était suivie mais jamais facturée ;
--      · quand le tarif ne se résolvait pas (élève non inscrit sur le créneau,
--        séance libre sans ligne d'abonnement), la présence était écrite à
--        0 DA et l'écran affichait « Offert · tarif à 0 ».
--    Désormais : le tarif retombe toujours sur le prix affiché du créneau, et
--    une présence facturable est TOUJOURS débitée — le solde passe en négatif
--    et la dette est visible partout (carte élève, fiche, alerte parent).
--
-- Ce script est IDEMPOTENT : ré-exécutable sans risque.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Les classes « jumelles » : même classe, même année, même filière
-- ---------------------------------------------------------------------------
-- Une ligne de `classes` porte exactement le triplet que la réception coche à
-- la création d'un emploi du temps : le niveau (primaire/moyen/lycée), l'année
-- et la filière. Deux lignes qui portent le même triplet désignent la même
-- population d'élèves, même si elles ont été créées séparément.
--
-- Les formations n'ont ni année ni filière : elles se rapprochent par leur
-- niveau (A1…C2), et jamais par « pas de filière », qui les réunirait toutes.
create or replace function public.class_peer_ids(p_class_ids uuid[])
returns uuid[]
language sql stable set search_path = public as $fn$
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
            and c.filiere_id is not distinct from p.filiere_id)
        or (c.type = 'formation' and p.type = 'formation'
            and c.formation_level is not distinct from p.formation_level)
      )
  );
$fn$;

comment on function public.class_peer_ids(uuid[]) is
  'Les classes qui désignent la même population : même niveau, même année, même filière (formations : même niveau).';

grant execute on function public.class_peer_ids(uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Les classes qu'un créneau accepte, au badge comme au guichet
-- ---------------------------------------------------------------------------
-- Les classes cochées à la création (colonne simple + tableau multi-classes),
-- élargies à leurs jumelles. Un créneau de séance libre réglé sur « toute la
-- filière » va plus loin encore : toutes les années de la filière.
create or replace function public.session_audience_class_ids(p_session_id uuid)
returns uuid[]
language sql stable set search_path = public as $fn$
  with se as (
    select class_id,
           coalesce(class_ids, '{}'::uuid[]) as class_ids,
           open_audience
      from public.sessions
     where id = p_session_id
  ),
  picked as (
    select c.*
      from public.classes c, se
     where c.id = se.class_id or c.id = any (se.class_ids)
  )
  select case
    when (select open_audience from se) = 'filiere' then (
      -- Toute la filière : l'année ne compte plus. Les jumelles restent du
      -- lot — élargir le public ne doit JAMAIS en retirer (une classe sans
      -- filière n'entrerait sinon plus dans son propre créneau).
      select coalesce(array_agg(distinct c.id), '{}'::uuid[])
        from public.classes c
       where c.id = any (public.class_peer_ids(
               (select coalesce(array_agg(p.id), '{}'::uuid[]) from picked p)))
          or exists (
               select 1 from picked p
                where p.filiere_id is not null and c.filiere_id = p.filiere_id
             )
    )
    else public.class_peer_ids(
           (select coalesce(array_agg(p.id), '{}'::uuid[]) from picked p))
  end;
$fn$;

comment on function public.session_audience_class_ids(uuid) is
  'Les classes admises sur un créneau : celles cochées à sa création, élargies aux classes de même année et même filière.';

grant execute on function public.session_audience_class_ids(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Les classes d'un élève
-- ---------------------------------------------------------------------------
-- Un élève n'a pas de colonne « classe » : sa classe est celle des emplois du
-- temps qu'il suit. Une inscription expirée ne le rattache plus à rien — c'est
-- ce qui fait qu'un abonnement échu reste refusé au badge.
create or replace function public.student_class_ids(
  p_student_id uuid,
  p_date date default current_date
)
returns uuid[]
language sql stable set search_path = public as $fn$
  select coalesce(array_agg(distinct se.class_id), '{}'::uuid[])
  from public.student_subscriptions ss
  join public.subscriptions sub on sub.id = ss.subscription_id
  join public.sessions se on se.id = sub.session_id
  where ss.student_id = p_student_id
    and (ss.expiry_date is null or ss.expiry_date >= p_date);
$fn$;

grant execute on function public.student_class_ids(uuid, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. À quel titre cet élève peut-il assister à ce créneau ?
-- ---------------------------------------------------------------------------
-- Le rang sert DEUX fois : il dit si la carte est acceptée (non NULL), et il
-- départage deux créneaux qui se chevauchent — le créneau où l'élève est
-- nommément inscrit passe toujours devant celui où il n'entre que par sa
-- classe. Sans ce classement, ouvrir le badge à la classe entière détournerait
-- les scans vers le mauvais cours.
--
--   0 — inscrit sur CE créneau ;
--   1 — inscrit au même cours dans un autre groupe (rattrapage) ;
--   2 — rattaché à une classe du public du créneau ;
--   NULL — rien à faire là.
create or replace function public.student_session_rank(
  p_student_id uuid,
  p_session_id uuid,
  p_date date default current_date
)
returns int
language sql stable set search_path = public as $fn$
  select case
    when exists (
      select 1
      from public.student_subscriptions ss
      join public.subscriptions sub on sub.id = ss.subscription_id
      where ss.student_id = p_student_id
        and sub.session_id = p_session_id
        and (ss.expiry_date is null or ss.expiry_date >= p_date)
    ) then 0
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
    when exists (
      select 1
      from unnest(public.student_class_ids(p_student_id, p_date)) as sc(cid)
      where sc.cid = any (public.session_audience_class_ids(p_session_id))
    ) then 2
    else null
  end;
$fn$;

comment on function public.student_session_rank(uuid, uuid, date) is
  'À quel titre un élève assiste à un créneau : 0 inscrit dessus, 1 rattrapage, 2 par sa classe, NULL refusé.';

grant execute on function public.student_session_rank(uuid, uuid, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. student_session_price — le tarif ne retombe plus à 0 par accident
-- ---------------------------------------------------------------------------
-- Même cascade qu'avant, avec un dernier recours : le prix affiché du créneau
-- (`sessions.open_price`). Un élève admis par sa classe n'a aucune inscription
-- sur le créneau : sans ce recours sa présence était écrite à 0 DA et l'écran
-- affichait « Offert · tarif à 0 », comme si la facturation avait échoué.
create or replace function public.student_session_price(
  p_student_id uuid,
  p_session_id uuid,
  p_date date default current_date
)
returns integer
language sql stable set search_path = public as $fn$
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
$fn$;

grant execute on function public.student_session_price(uuid, uuid, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. scan_card
-- ---------------------------------------------------------------------------
-- Identique à 20260902_free_seances_teacher_settlements, avec DEUX changements :
--
--   · ÉLIGIBILITÉ — le créneau est retenu dès que `student_session_rank` rend
--     un rang (inscrit dessus, rattrapage, ou simplement rattaché à une classe
--     du public du créneau). C'est ce dernier cas qui débloque les élèves de la
--     même classe / même année / même filière sur une séance libre.
--
--   · DETTE — un solde insuffisant ne referme plus la porte. La présence est
--     écrite, le débit est passé, et le solde descend en négatif : l'élève a
--     étudié, donc l'école le lui compte. Le refus « scan.expired » disparaît ;
--     c'est l'alerte de dette (écran, voix, WhatsApp) qui prend le relais.
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
    --    l'horaire : sans cette règle le scan débitait l'élève sur le créneau
    --    payant alors que l'école avait offert la séance.
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

  -- PLUS AUCUN REFUS POUR MANQUE DE SOLDE. L'élève a suivi la séance : elle
  -- lui est comptée, quitte à faire passer le solde en dette. Ce qui était
  -- « entrée refusée, rien d'enregistré » devient une créance visible que la
  -- caisse peut réclamer.

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

-- ---------------------------------------------------------------------------
-- 7. mark_attendance — la saisie manuelle accepte aussi l'élève de la classe
-- ---------------------------------------------------------------------------
-- Seule différence avec 20260902 : quand l'élève n'a aucune inscription sur le
-- créneau, il n'est plus refusé (« attendance.notEnrolled ») dès lors qu'il
-- appartient au public du créneau — il est facturé au tarif affiché. Le
-- garde-fou de dette (`p_allow_debt`) reste, lui, une décision de guichet :
-- l'écran Présences demande confirmation avant de créer une dette à la main.
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
    -- Aucune inscription : le créneau reste ouvert à l'élève de sa classe (et
    -- à n'importe qui sur une séance libre), au tarif affiché du créneau.
    v_rank := public.student_session_rank(p_student_id, p_session_id, v_date);
    if v_session.is_open or v_rank is not null then
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
      when v_cost > 0 and v_new_balance < 0 then 'scan.successDebt'
      when p_status = 'late' then 'scan.successLate'
      else 'scan.success'
    end
  );
end;
$$;

revoke execute on function public.mark_attendance(uuid, uuid, attendance_status, date, boolean, boolean) from public, anon;
grant execute on function public.mark_attendance(uuid, uuid, attendance_status, date, boolean, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Rechargement du cache de schéma de l'API REST
-- ---------------------------------------------------------------------------
notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- 9. Vérification
-- ---------------------------------------------------------------------------
-- a) Les six fonctions attendues sont en place.
select
  (select count(*) from pg_proc where proname = 'class_peer_ids')             as class_peer_ids,
  (select count(*) from pg_proc where proname = 'session_audience_class_ids') as session_audience_class_ids,
  (select count(*) from pg_proc where proname = 'student_class_ids')          as student_class_ids,
  (select count(*) from pg_proc where proname = 'student_session_rank')       as student_session_rank,
  (select count(*) from pg_proc where proname = 'student_session_price')      as student_session_price,
  (select count(*) from pg_proc where proname = 'scan_card')                  as scan_card;

-- b) Combien d'élèves chaque créneau accepte-t-il désormais ? Un créneau à 0
--    élève est un créneau dont aucune classe cochée ne correspond à une classe
--    réellement suivie : c'est là qu'il faut regarder si une carte est refusée.
select
  coalesce(se.title, m.name)                as creneau,
  case when se.is_open then 'séance libre' else 'cours' end as genre,
  se.start_time || '-' || se.end_time       as horaire,
  (select count(*) from public.students st
    where public.student_session_rank(st.id, se.id, current_date) is not null) as eleves_admis
from public.sessions se
left join public.modules m on m.id = se.module_id
order by se.is_open desc, se.start_time;

-- c) Les élèves en dette, du plus lourd au plus léger.
select st.last_name || ' ' || st.first_name as eleve,
       st.rfid                              as carte,
       st.balance                           as solde,
       st.registration_due                  as inscription_due
from public.students st
where st.balance < 0 or st.registration_due > 0
order by st.balance asc;
