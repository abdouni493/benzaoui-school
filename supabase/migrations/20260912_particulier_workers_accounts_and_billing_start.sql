-- =============================================================================
-- 12/09/2026 — Cinq manques que l'école payait tous les jours
--
-- À jouer UNE FOIS sur le projet en ligne (Supabase Dashboard → SQL Editor).
-- Le script est IDEMPOTENT : le rejouer ne casse ni ne double rien.
--
--  §1  LA PREMIÈRE SÉANCE OFFICIELLE D'UN CRÉNEAU.
--      Un emploi du temps se crée des semaines avant la rentrée, et les
--      séances d'essai tenues d'ici là étaient facturées comme les autres :
--      solde débité, absences comptées. On pose une date facultative sur le
--      créneau — avant elle, la présence est écrite exactement pareil mais
--      rien n'est pris à l'élève et aucune absence n'est facturée.
--
--  §2  QUI A ENCAISSÉ ?
--      La caisse enregistrait des mouvements sans jamais dire de quel poste
--      ils venaient. Impossible de rendre ses comptes à une réceptionniste en
--      fin de journée. Chaque ligne de caisse et chaque ligne d'historique
--      élève porte désormais le compte qui l'a écrite — y compris celles que
--      les fonctions existantes écrivent, sans qu'aucune n'ait à changer.
--
--  §3  LE POINTAGE DES TRAVAILLEURS N'AVAIT QU'UNE PORTE : LE BADGE.
--      Un agent sans carte, une carte oubliée, une correction : rien ne
--      pouvait s'écrire à la main, et une journée non pointée disparaissait
--      au lieu de compter comme une absence. Journée manuelle, fin de service
--      manuelle, et relevé automatique des absences.
--
--  §4  « CE MOIS EST-IL PAYÉ ? » SE DEVINAIT DANS UN TEXTE LIBRE.
--      L'écran cherchait le nom du travailleur dans le libellé des
--      mouvements de caisse : un nom corrigé, une faute de frappe, deux
--      homonymes, et un mois payé repassait comme dû. Les règlements ont
--      maintenant leur registre, avec la période qu'ils couvrent.
--
--  §5  LES SÉANCES PARTICULIÈRES N'EXISTAIENT NULLE PART.
--      Elles se prenaient sur un cahier : ni rendez-vous, ni dette, ni part
--      d'enseignant, ni trace en caisse.
-- =============================================================================


-- =============================================================================
-- §1. LA PREMIÈRE SÉANCE OFFICIELLE D'UN CRÉNEAU
-- =============================================================================
-- Facultative : `null` = le créneau facture dès sa première séance, comme il
-- l'a toujours fait. Renseignée, elle se comporte EXACTEMENT comme une date de
-- début d'inscription — mécanique déjà en place depuis 20260817 (présence
-- écrite, `pre_start` à true, prix rangé dans `waived_amount`, solde intact).
-- C'est pour ça qu'elle ne coûte que trois lignes dans chaque fonction : elle
-- n'invente aucune règle, elle repousse une date déjà comprise partout.
alter table public.sessions
  add column if not exists billing_start_date date;

comment on column public.sessions.billing_start_date is
  'Première séance officielle. Avant cette date, les présences sont enregistrées mais jamais facturées, et les absences jamais comptées. NULL = facturation dès la première séance.';

-- ---------------------------------------------------------------------------
-- Les trois fonctions qui décident quand la facturation commence
-- ---------------------------------------------------------------------------
-- Elles sont réémises À L'IDENTIQUE de leurs migrations d'origine (20260910
-- pour les deux premières, 20260816 pour la troisième) : seules les lignes
-- signalées « PREMIÈRE SÉANCE OFFICIELLE » changent. Tout le reste — porte du
-- badge, séance offerte, période gratuite, rattrapage réservé aux séances
-- libres, rémunération de l'enseignant, dette autorisée — est mot pour mot ce
-- qui tourne aujourd'hui.

-- ---- 1.a  Le badge ---------------------------------------------------------
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

revoke execute on function public.scan_card(text, timestamptz) from public, anon;
grant execute on function public.scan_card(text, timestamptz) to authenticated;

-- ---- 1.b  La feuille de pointage (saisie manuelle, appel de l'enseignant) ---
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

revoke execute on function public.mark_attendance(uuid, uuid, attendance_status, date, boolean, boolean) from public, anon;
grant execute on function public.mark_attendance(uuid, uuid, attendance_status, date, boolean, boolean) to authenticated;

-- ---- 1.c  La facturation hebdomadaire des absences -------------------------
create or replace function public.process_weekly_absences(p_when timestamptz default now())
returns jsonb
language plpgsql security definer set search_path = public as $$
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
  v_period_end date;
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
           -- La date de début retenue est la plus TARDIVE entre le début
           -- d'inscription de l'élève et la première séance officielle du
           -- créneau : aucune absence n'est facturée avant que le cours ait
           -- officiellement commencé. `greatest` ignore les NULL, donc une
           -- seule des deux dates suffit, et aucune ne veut dire « depuis
           -- toujours », comme avant.
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

      if v_last_pen is not null then
        v_pen_anchor := public.week_anchor(v_last_pen, v_start_dow);
        if v_pen_anchor < v_last_pen then
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
        v_period_start := v_anchor;
        v_period_end   := v_anchor + v_window;
        exit when v_period_end > v_today;
      else
        v_period_start := v_anchor + 1;
        v_period_end   := v_anchor + v_window;
        exit when v_today - v_anchor < v_window;
      end if;

      if v_period_end <= greatest(v_floor, coalesce(v_enr.enr_start, v_floor)) then
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
          and fp.start_date < v_period_end
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
          and (timezone('Africa/Algiers', a.occurred_at))::date >= v_period_start
          and (timezone('Africa/Algiers', a.occurred_at))::date <  v_period_end
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

  update public.school set absence_penalty_last_run = v_today;

  return jsonb_build_object('ok', true, 'enabled', true, 'charged', v_charged, 'students', v_students);
end;
$$;

revoke execute on function public.process_weekly_absences(timestamptz) from public, anon;
grant execute on function public.process_weekly_absences(timestamptz) to authenticated;



-- =============================================================================
-- §2. QUI A ENCAISSÉ ? — le compte derrière chaque mouvement
-- =============================================================================
-- `default auth.uid()` est le cœur de l'affaire : les quinze fonctions qui
-- écrivent déjà en caisse (scan_card, add_student_balance, pay_student_debt,
-- pay_teacher_sessions…) n'ont pas UNE ligne à changer. Elles sont toutes
-- SECURITY DEFINER, mais `auth.uid()` lit le jeton de l'APPELANT, pas celui du
-- propriétaire de la fonction : le compte enregistré est bien celui qui a
-- encaissé, jamais le rôle technique.
--
-- Les lignes écrites AVANT ce script gardent `null` : on ne devine pas
-- rétroactivement qui tenait la caisse ce jour-là. Les écrans les rangent sous
-- « compte non enregistré » plutôt que de les attribuer à quelqu'un.
alter table public.cash_transactions
  add column if not exists created_by uuid references public.profiles (id) on delete set null;
alter table public.cash_transactions
  alter column created_by set default auth.uid();

alter table public.balance_tx
  add column if not exists created_by uuid references public.profiles (id) on delete set null;
alter table public.balance_tx
  alter column created_by set default auth.uid();

create index if not exists cash_transactions_created_by_idx
  on public.cash_transactions (created_by, date);
create index if not exists balance_tx_created_by_idx
  on public.balance_tx (created_by, date);

comment on column public.cash_transactions.created_by is
  'Compte qui a écrit ce mouvement (profiles.id). NULL sur les lignes antérieures au 12/09/2026.';


-- =============================================================================
-- §3. LE REGISTRE DES TRAVAILLEURS — badge, saisie manuelle, absences
-- =============================================================================

-- ---- 3.a  Ce qu'on doit savoir d'un travailleur pour le gérer --------------
-- `work_days` est ce qui rend les absences automatiques utilisables : sans
-- lui, tout jour sans pointage devient une absence, vendredi et jours de repos
-- compris, et le relevé accuse à tort.
alter table public.reception_staff
  add column if not exists work_days      day_of_week[] not null
    default '{saturday,sunday,monday,tuesday,wednesday,thursday}'::day_of_week[],
  add column if not exists daily_start    text,
  add column if not exists daily_end      text,
  add column if not exists job_title      text not null default '',
  add column if not exists pay_alert_days integer not null default 3;

-- ---- 3.b  Une journée peut être une ABSENCE, et venir d'ailleurs que du badge
alter table public.worker_shifts
  add column if not exists status text not null default 'present',
  add column if not exists source text not null default 'scan',
  add column if not exists notes  text not null default '';

do $$ begin
  alter table public.worker_shifts
    add constraint worker_shifts_status_check check (status in ('present', 'absent')) not valid;
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.worker_shifts
    add constraint worker_shifts_source_check check (source in ('scan', 'manual', 'auto')) not valid;
exception when duplicate_object then null; end $$;

create index if not exists worker_shifts_status_idx on public.worker_shifts (worker_id, status, work_date);

-- ---- 3.c  Le jour de travail attendu ---------------------------------------
-- Un seul endroit décide si un travailleur était attendu un jour donné : le
-- relevé d'absences et les écrans lisent la même réponse.
create or replace function public.worker_works_on(p_worker_id uuid, p_date date)
returns boolean
language plpgsql stable security definer set search_path = public as $$
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

revoke execute on function public.worker_works_on(uuid, date) from public, anon;
grant execute on function public.worker_works_on(uuid, date) to authenticated;

-- ---- 3.d  Écrire une journée à la main -------------------------------------
-- Arrivée, sortie, ou absence constatée. Une journée DÉJÀ RÉGLÉE n'est jamais
-- réécrite : corriger après coup les heures d'un mois payé ferait mentir le
-- bon de paiement déjà signé.
create or replace function public.set_worker_shift(
  p_worker_id uuid,
  p_work_date date,
  p_start_at  timestamptz default null,
  p_end_at    timestamptz default null,
  p_status    text default 'present',
  p_notes     text default ''
)
returns jsonb
language plpgsql security definer set search_path = public as $$
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

revoke execute on function public.set_worker_shift(uuid, date, timestamptz, timestamptz, text, text) from public, anon;
grant execute on function public.set_worker_shift(uuid, date, timestamptz, timestamptz, text, text) to authenticated;

-- ---- 3.e  Clôturer la journée en cours, sans badge -------------------------
create or replace function public.end_worker_shift(
  p_worker_id uuid,
  p_end_at timestamptz default null
)
returns jsonb
language plpgsql security definer set search_path = public as $$
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

revoke execute on function public.end_worker_shift(uuid, timestamptz) from public, anon;
grant execute on function public.end_worker_shift(uuid, timestamptz) to authenticated;

-- ---- 3.f  Le relevé des absences -------------------------------------------
-- Un jour ouvré RÉVOLU sans pointage ni saisie est une absence. On ne touche
-- jamais à aujourd'hui (la journée n'est pas finie), ni à une journée déjà
-- écrite, quelle qu'elle soit : la fonction est sans effet si on la rejoue.
create or replace function public.mark_worker_absences(
  p_worker_id uuid default null,
  p_from date default null,
  p_to   date default null
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_role user_role := public.current_role();
  v_today date := (now() at time zone 'Africa/Algiers')::date;
  v_to date := least(coalesce(p_to, v_today - 1), v_today - 1);
  v_worker record;
  v_day date;
  v_from date;
  v_marked int := 0;
  v_workers int := 0;
  v_touched boolean;
begin
  if v_role is null or v_role not in ('admin', 'reception') then
    raise exception 'not authorized';
  end if;

  for v_worker in
    select id, start_date from public.reception_staff
    where p_worker_id is null or id = p_worker_id
  loop
    -- Deux mois en arrière au plus : le relevé sert à tenir le mois courant,
    -- pas à reconstruire une année d'archives d'un seul clic.
    v_from := greatest(
      coalesce(p_from, v_today - 60),
      coalesce(v_worker.start_date, v_today - 60),
      v_today - 366
    );
    v_touched := false;
    v_day := v_from;
    while v_day <= v_to loop
      if public.worker_works_on(v_worker.id, v_day)
         and not exists (
           select 1 from public.worker_shifts
           where worker_id = v_worker.id and work_date = v_day
         )
      then
        insert into public.worker_shifts
          (worker_id, work_date, minutes, status, source, notes, frozen)
        values
          (v_worker.id, v_day, 0, 'absent', 'auto',
           'Absence relevée automatiquement : aucun pointage ni saisie ce jour-là.', false)
        on conflict (worker_id, work_date) do nothing;
        if found then
          v_marked := v_marked + 1;
          v_touched := true;
        end if;
      end if;
      v_day := v_day + 1;
    end loop;
    if v_touched then v_workers := v_workers + 1; end if;
  end loop;

  return jsonb_build_object('ok', true, 'marked', v_marked, 'workers', v_workers);
end;
$$;

revoke execute on function public.mark_worker_absences(uuid, date, date) from public, anon;
grant execute on function public.mark_worker_absences(uuid, date, date) to authenticated;


-- =============================================================================
-- §4. LE REGISTRE DES RÈGLEMENTS DE TRAVAILLEURS
-- =============================================================================
-- Ce que cette table répare : « ce mois est-il payé ? » se répondait en
-- cherchant le NOM du travailleur dans le libellé libre des mouvements de
-- caisse. Un nom corrigé, un accent, deux homonymes, un libellé saisi à la
-- main — et un mois déjà réglé réapparaissait comme dû, ou l'inverse. La
-- période payée est maintenant une donnée, pas une chaîne de caractères.
create table if not exists public.worker_payments (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid not null references public.reception_staff (id) on delete cascade,
  amount integer not null default 0,
  -- le contrat sur lequel le calcul a été fait (le contrat peut changer après)
  method text not null default 'monthly',
  period_start date,
  period_end date,
  -- "09/2026" pour un mois, "2026-09-12" pour une journée : ce qui rend le
  -- règlement unique et interdit de payer deux fois la même période
  period_key text not null default '',
  days_count integer not null default 0,
  minutes integer not null default 0,
  description text not null default '',
  -- instantané figé des journées réglées, pour réimprimer le bon à l'identique
  details jsonb not null default '[]'::jsonb,
  paid_at timestamptz not null default now(),
  cash_tx_id uuid references public.cash_transactions (id) on delete set null,
  created_by uuid default auth.uid() references public.profiles (id) on delete set null
);

create index if not exists worker_payments_worker_id_idx on public.worker_payments (worker_id, paid_at desc);
create unique index if not exists worker_payments_period_key_uniq
  on public.worker_payments (worker_id, period_key) where period_key <> '';

alter table public.worker_payments enable row level security;

drop policy if exists worker_payments_select on public.worker_payments;
create policy worker_payments_select on public.worker_payments for select to authenticated
  using (public.is_staff() or worker_id = auth.uid());

drop policy if exists worker_payments_write on public.worker_payments;
create policy worker_payments_write on public.worker_payments for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

-- worker_shifts.payment_id pointait dans le vide : on lui donne sa cible.
--
-- `not valid` est ESSENTIEL ici, et pas une précaution de style : les journées
-- déjà réglées par l'ancienne fonction portent un `payment_id` inventé sur
-- place, qui ne correspond à aucune ligne — la table `worker_payments` n'existait
-- pas. Une contrainte validée immédiatement échouerait donc sur la base en
-- ligne, et TOUT le script avec elle. Les anciennes lignes sont laissées telles
-- quelles ; seules les nouvelles écritures sont contrôlées.
do $$ begin
  alter table public.worker_shifts
    add constraint worker_shifts_payment_id_fkey
    foreign key (payment_id) references public.worker_payments (id) on delete set null
    not valid;
exception when duplicate_object then null; end $$;



-- ---- 4.a  Régler une période -----------------------------------------------
create or replace function public.pay_worker_period(
  p_worker_id uuid,
  p_method text,
  p_period_key text,
  p_period_start date default null,
  p_period_end date default null,
  p_shift_ids uuid[] default null,
  p_amount integer default 0,
  p_description text default '',
  p_details jsonb default '[]'::jsonb,
  p_acompte_ids uuid[] default null,
  p_absence_ids uuid[] default null,
  p_settle_deductions boolean default false
)
returns jsonb
language plpgsql security definer set search_path = public as $$
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

revoke execute on function public.pay_worker_period(uuid, text, text, date, date, uuid[], integer, text, jsonb, uuid[], uuid[], boolean) from public, anon;
grant execute on function public.pay_worker_period(uuid, text, text, date, date, uuid[], integer, text, jsonb, uuid[], uuid[], boolean) to authenticated;

-- ---- 4.a bis  L'ANCIENNE fonction de règlement horaire ---------------------
-- `pay_worker_shifts` (20260810 / 20260818) écrivait un `payment_id` qui ne
-- référençait rien. Avec la contrainte ci-dessus, elle échouerait désormais —
-- et un onglet resté ouvert sur l'ancienne version de l'application l'appelle
-- encore. Plutôt que de la supprimer et de faire planter cet onglet, on la fait
-- passer par le nouveau registre : même signature, même résultat visible, mais
-- le règlement existe maintenant vraiment quelque part.
create or replace function public.pay_worker_shifts(
  p_worker_id uuid,
  p_shift_ids uuid[],
  p_amount integer,
  p_description text default ''
)
returns jsonb
language plpgsql security definer set search_path = public as $$
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

revoke execute on function public.pay_worker_shifts(uuid, uuid[], integer, text) from public, anon;
grant execute on function public.pay_worker_shifts(uuid, uuid[], integer, text) to authenticated;

-- ---- 4.b  Annuler un règlement ---------------------------------------------
create or replace function public.delete_worker_payment(p_payment_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
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

revoke execute on function public.delete_worker_payment(uuid) from public, anon;
grant execute on function public.delete_worker_payment(uuid) to authenticated;


-- =============================================================================
-- §5. LES SÉANCES PARTICULIÈRES
-- =============================================================================
-- Un cours particulier n'est ni un créneau ni une séance libre : pas de jour de
-- la semaine, pas d'abonnement, pas de solde. C'est un rendez-vous — quelqu'un,
-- une date, et un ou plusieurs modules facturés à l'heure, chacun avec son
-- enseignant et le pourcentage qui lui revient.
--
-- L'ARGENT N'Y PASSE PAS PAR LE SOLDE DE L'ÉLÈVE, et c'est délibéré : le solde
-- est la provision d'un abonné pour ses séances à venir ; un cours particulier
-- est une prestation ponctuelle. Ce qui est versé entre en caisse ; ce qui ne
-- l'est pas reste une dette attachée à CE rendez-vous, visible sur sa carte,
-- jamais mélangée à celle de la scolarité.

-- Un « enseignant passager » se crée au guichet en trois champs : un nom, un
-- téléphone, et de quoi se rappeler qui c'est — ce troisième champ n'existait
-- nulle part, et la réception finissait par écrire « Mohamed (le prof de maths
-- du samedi) » dans le nom.
alter table public.teachers
  add column if not exists description text not null default '';

create table if not exists public.private_sessions (
  id uuid primary key default gen_random_uuid(),
  -- un élève déjà inscrit… ou personne : le guichet note alors son nom
  student_id uuid references public.students (id) on delete set null,
  guest_name   text,
  guest_phone  text,
  guest_phone2 text,
  class_id   uuid references public.classes (id) on delete set null,
  year       text,
  filiere_id uuid references public.filieres (id) on delete set null,
  scheduled_at timestamptz not null,
  duration_minutes integer not null default 0,
  total_price integer not null default 0,
  paid_amount integer not null default 0,
  status text not null default 'planned',
  notes text not null default '',
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  constraint private_sessions_status_check check (status in ('planned', 'done', 'cancelled')),
  -- On ne peut pas programmer une séance pour personne.
  constraint private_sessions_has_attendee check (student_id is not null or guest_name is not null)
);

create table if not exists public.private_session_modules (
  id uuid primary key default gen_random_uuid(),
  private_session_id uuid not null references public.private_sessions (id) on delete cascade,
  module_id uuid not null references public.modules (id) on delete restrict,
  teacher_id uuid references public.teachers (id) on delete set null,
  minutes integer not null default 0,
  hourly_price integer not null default 0,
  total_price integer not null default 0,
  teacher_percentage integer not null default 0,
  teacher_amount integer not null default 0,
  teacher_paid boolean not null default false,
  teacher_paid_at timestamptz
);

create index if not exists private_sessions_scheduled_idx on public.private_sessions (scheduled_at desc);
create index if not exists private_sessions_student_idx   on public.private_sessions (student_id);
create index if not exists private_session_modules_parent_idx
  on public.private_session_modules (private_session_id);
create index if not exists private_session_modules_teacher_idx
  on public.private_session_modules (teacher_id, teacher_paid);

alter table public.private_sessions enable row level security;
alter table public.private_session_modules enable row level security;

-- L'élève et l'enseignant concernés voient leur propre rendez-vous ; le reste
-- est réservé au personnel, comme toute donnée d'argent.
drop policy if exists private_sessions_select on public.private_sessions;
create policy private_sessions_select on public.private_sessions for select to authenticated
  using (
    public.is_staff()
    or student_id = auth.uid()
    or public.is_my_child(student_id)
    or exists (
      select 1 from public.private_session_modules m
      where m.private_session_id = private_sessions.id and m.teacher_id = auth.uid()
    )
  );

drop policy if exists private_sessions_write on public.private_sessions;
create policy private_sessions_write on public.private_sessions for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

drop policy if exists private_session_modules_select on public.private_session_modules;
create policy private_session_modules_select on public.private_session_modules for select to authenticated
  using (
    public.is_staff()
    or teacher_id = auth.uid()
    or exists (
      select 1 from public.private_sessions s
      where s.id = private_session_id
        and (s.student_id = auth.uid() or public.is_my_child(s.student_id))
    )
  );

drop policy if exists private_session_modules_write on public.private_session_modules;
create policy private_session_modules_write on public.private_session_modules for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

-- ---- 5.a  Écrire les modules d'un rendez-vous (partagé création / édition) --
-- Le prix d'un module est TOUJOURS recalculé ici, jamais repris de l'écran :
-- une minute × un tarif horaire, arrondi une seule fois. C'est ce qui garantit
-- que le total affiché au guichet est exactement celui qui sera encaissé.
create or replace function public.write_private_session_modules(
  p_session_id uuid,
  p_modules jsonb
)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_row jsonb;
  v_minutes int;
  v_hourly int;
  v_price int;
  v_pct int;
  v_total int := 0;
begin
  delete from public.private_session_modules where private_session_id = p_session_id;

  for v_row in select * from jsonb_array_elements(coalesce(p_modules, '[]'::jsonb))
  loop
    v_minutes := greatest(coalesce((v_row ->> 'minutes')::int, 0), 0);
    v_hourly  := greatest(coalesce((v_row ->> 'hourlyPrice')::int, 0), 0);
    v_price   := round(v_minutes * v_hourly / 60.0);
    v_pct     := least(greatest(coalesce((v_row ->> 'teacherPercentage')::int, 0), 0), 100);

    insert into public.private_session_modules
      (private_session_id, module_id, teacher_id, minutes, hourly_price,
       total_price, teacher_percentage, teacher_amount, teacher_paid, teacher_paid_at)
    values
      (p_session_id,
       (v_row ->> 'moduleId')::uuid,
       nullif(v_row ->> 'teacherId', '')::uuid,
       v_minutes, v_hourly, v_price, v_pct, round(v_price * v_pct / 100.0),
       coalesce((v_row ->> 'teacherPaid')::boolean, false),
       case when coalesce((v_row ->> 'teacherPaid')::boolean, false) then now() end);

    v_total := v_total + v_price;
  end loop;

  return v_total;
end;
$$;

-- ---- 5.b  Créer le rendez-vous ---------------------------------------------
create or replace function public.create_private_session(p_payload jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
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

revoke execute on function public.create_private_session(jsonb) from public, anon;
grant execute on function public.create_private_session(jsonb) to authenticated;

-- ---- 5.c  Modifier le rendez-vous ------------------------------------------
-- Ce qui a DÉJÀ été encaissé ne bouge pas : on ne réécrit pas une recette. Si
-- le nouveau total descend en dessous, le trop-perçu est ramené au total (la
-- différence se rend au guichet, en espèces, hors de l'application).
create or replace function public.update_private_session(p_id uuid, p_payload jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
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

revoke execute on function public.update_private_session(uuid, jsonb) from public, anon;
grant execute on function public.update_private_session(uuid, jsonb) to authenticated;

-- ---- 5.d  Encaisser la dette de la famille ---------------------------------
create or replace function public.pay_private_session(p_id uuid, p_amount integer)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_role user_role := public.current_role();
  v_sess public.private_sessions%rowtype;
  v_due int;
  v_pay int;
  v_name text;
begin
  if v_role is null or v_role not in ('admin', 'reception') then
    raise exception 'not authorized';
  end if;

  select * into v_sess from public.private_sessions where id = p_id;
  if not found then
    return jsonb_build_object('ok', false, 'messageKey', 'particulier.notFound');
  end if;

  v_due := greatest(v_sess.total_price - v_sess.paid_amount, 0);
  v_pay := least(greatest(coalesce(p_amount, 0), 0), v_due);
  if v_pay <= 0 then
    return jsonb_build_object('ok', false, 'messageKey', 'particulier.nothingDue');
  end if;

  update public.private_sessions set paid_amount = paid_amount + v_pay where id = p_id;

  select coalesce(s.first_name || ' ' || s.last_name, v_sess.guest_name, 'Élève')
    into v_name
  from (select 1) x
  left join public.students s on s.id = v_sess.student_id;

  insert into public.cash_transactions (type, amount, date, description)
  values ('student_payment', v_pay, now(),
          'Séance particulière — règlement ' || v_name);

  return jsonb_build_object('ok', true, 'paid', v_pay, 'due', v_due - v_pay);
end;
$$;

revoke execute on function public.pay_private_session(uuid, integer) from public, anon;
grant execute on function public.pay_private_session(uuid, integer) to authenticated;

-- ---- 5.e  Régler l'enseignant d'un module ----------------------------------
-- Le versement part en caisse ET dans l'historique de l'enseignant : sa fiche
-- doit montrer ce qu'il a touché, d'où que ça vienne.
create or replace function public.pay_private_session_teacher(
  p_module_row_id uuid,
  p_amount integer default null
)
returns jsonb
language plpgsql security definer set search_path = public as $$
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

revoke execute on function public.pay_private_session_teacher(uuid, integer) from public, anon;
grant execute on function public.pay_private_session_teacher(uuid, integer) to authenticated;

-- ---- 5.f  Tenue / annulation / report --------------------------------------
create or replace function public.set_private_session_status(p_id uuid, p_status text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_role user_role := public.current_role();
begin
  if v_role is null or v_role not in ('admin', 'reception') then
    raise exception 'not authorized';
  end if;
  if p_status not in ('planned', 'done', 'cancelled') then
    raise exception 'invalid private session status: %', p_status;
  end if;

  update public.private_sessions set status = p_status where id = p_id;
  if not found then
    return jsonb_build_object('ok', false, 'messageKey', 'particulier.notFound');
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

revoke execute on function public.set_private_session_status(uuid, text) from public, anon;
grant execute on function public.set_private_session_status(uuid, text) to authenticated;

create or replace function public.reschedule_private_session(p_id uuid, p_scheduled_at timestamptz)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_role user_role := public.current_role();
begin
  if v_role is null or v_role not in ('admin', 'reception') then
    raise exception 'not authorized';
  end if;

  -- Reporter une séance la rend à nouveau « à venir » : une séance déjà tenue
  -- qu'on déplace n'a pas de sens, et une séance annulée qu'on redate est une
  -- séance reprogrammée.
  update public.private_sessions
     set scheduled_at = p_scheduled_at,
         status = case when status = 'cancelled' then 'planned' else status end
   where id = p_id;
  if not found then
    return jsonb_build_object('ok', false, 'messageKey', 'particulier.notFound');
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

revoke execute on function public.reschedule_private_session(uuid, timestamptz) from public, anon;
grant execute on function public.reschedule_private_session(uuid, timestamptz) to authenticated;

-- ---- 5.g  Supprimer -------------------------------------------------------
-- Refusé tant que de l'argent est passé dessus : supprimer la séance ne
-- retirerait PAS les mouvements de caisse, et le fond de caisse ne
-- s'expliquerait plus. `p_force` est la sortie consciente de cette règle.
create or replace function public.delete_private_session(p_id uuid, p_force boolean default false)
returns jsonb
language plpgsql security definer set search_path = public as $$
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

revoke execute on function public.delete_private_session(uuid, boolean) from public, anon;
grant execute on function public.delete_private_session(uuid, boolean) to authenticated;


-- =============================================================================
-- §6. RECHARGEMENT DU CACHE DE SCHÉMA DE L'API REST
-- =============================================================================
-- Sans cette ligne, PostgREST continue de servir l'ancien schéma et
-- l'application croit que la migration n'est pas passée
-- (« Could not find the 'billing_start_date' column… »).
notify pgrst, 'reload schema';


-- =============================================================================
-- §7. CONTRÔLE (lecture seule) — rien n'est corrigé ici
-- =============================================================================

-- a) Les nouvelles colonnes et fonctions sont bien en place.
select
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'sessions'
      and column_name = 'billing_start_date')                     as sessions_billing_start_date,
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'cash_transactions'
      and column_name = 'created_by')                             as caisse_compte,
  (select count(*) from pg_proc where proname = 'set_worker_shift')        as set_worker_shift,
  (select count(*) from pg_proc where proname = 'mark_worker_absences')    as mark_worker_absences,
  (select count(*) from pg_proc where proname = 'pay_worker_period')       as pay_worker_period,
  (select count(*) from pg_proc where proname = 'create_private_session')  as create_private_session,
  (select exists (
     select 1 from pg_proc
      where proname = 'scan_card' and prosrc like '%billing_start_date%')) as badge_respecte_la_date;

-- b) Les créneaux qui n'ont pas encore officiellement commencé : tout ce qui
--    s'y pointe d'ici là est enregistré mais jamais facturé.
select
  coalesce(se.title, m.name)      as creneau,
  se.start_time || '-' || se.end_time as horaire,
  se.billing_start_date           as premiere_seance_officielle,
  (se.billing_start_date - current_date) as jours_restants
from public.sessions se
left join public.modules m on m.id = se.module_id
where se.billing_start_date is not null and se.billing_start_date > current_date
order by se.billing_start_date;

-- c) La caisse, compte par compte, depuis que les comptes sont enregistrés.
--    Les lignes antérieures au script sortent sous « (compte non enregistré) ».
select
  coalesce(p.full_name, '(compte non enregistré)') as compte,
  coalesce(p.role::text, '—')                      as role,
  count(*)                                         as mouvements,
  sum(ct.amount) filter (where ct.amount > 0)      as encaisse,
  sum(-ct.amount) filter (where ct.amount < 0)     as decaisse
from public.cash_transactions ct
left join public.profiles p on p.id = ct.created_by
group by p.full_name, p.role
order by encaisse desc nulls last;
