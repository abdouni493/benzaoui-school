-- =============================================================================
-- 15/09/2026 — CE QUE CE SCRIPT RÉPARE
-- =============================================================================
--
-- 1. LE RÈGLEMENT D'UN ENSEIGNANT SE LIT ENFIN COMME UN TABLEAU.
--    L'écran listait une ligne par séance datée — trente lignes plates qu'il
--    fallait additionner à la main. Il se lit désormais en deux temps : on
--    coche les emplois du temps, puis on lit « un cours par ligne, une date de
--    séance par colonne, le nombre d'élèves dans chaque case ». Rien à changer
--    en base pour le tableau lui-même : il est construit à partir de
--    l'instantané figé que `teacher_payments.details` porte déjà.
--
--    En revanche, DEUX SÉANCES LIBRES ÉCHAPPAIENT AU RÈGLEMENT :
--      · celle suivie par un élève INSCRIT — le RPC ne retournait que les
--        passagers (`student_id is null`), l'enseignant n'était donc jamais
--        payé sur un élève encaissé au guichet plutôt qu'au badge ;
--      · celle qui porte SON PROPRE pourcentage (nouveau) — impossible de la
--        solder sans emporter ses voisines.
--    `pay_teacher_sessions` accepte donc des identifiants EXACTS
--    (`p_independent_ids`) au lieu de les deviner, et
--    `delete_teacher_payment` les rend à l'annulation.
--
-- 2. UNE SÉANCE LIBRE SE SAISIT DANS L'ORDRE DU GUICHET.
--    Qui suit la séance, sa scolarité, la matière, PUIS le créneau du jour.
--    `independent_sessions` accueille ce que le guichet déclare (téléphone du
--    passager, classe / année / filière, module) et — facultatif — le
--    pourcentage de l'enseignant SUR CETTE SÉANCE.
--
-- 3. LA PAIE D'UN TRAVAILLEUR MENSUEL PART DE SA DATE DE PAIE.
--    Un salaire se compte depuis le jour où l'employé commence à être payé, pas
--    depuis le 1er : payé à partir du 10 septembre, il est dû le 10 octobre.
--    L'écran découpait en mois civils et annonçait le salaire dû le 30
--    septembre — puis « en retard » pendant les dix jours où il n'était pas
--    encore gagné. D'où `reception_staff.pay_start_date`.
--
-- 4. UNE ABSENCE DE TRAVAILLEUR DIT ENFIN CE QU'ELLE COÛTE.
--    Une absence était constatée sans que personne ne décide de la retenue :
--    le mois se payait plein alors qu'il ne l'était pas. Une absence est
--    désormais EN ATTENTE jusqu'à ce qu'on tranche — même pour décider de ne
--    rien retenir — et le règlement de la période refuse de se conclure avant.
--    Les absences automatiques ne concernent plus que les travailleurs AU
--    MOIS : un journalier payé aux journées travaillées n'a rien à se faire
--    retenir quand il ne vient pas.
--
-- 5. UNE SÉANCE PARTICULIÈRE SE DÉROULE EN TROIS TEMPS.
--    Elle se créait d'un bloc — élève, date, modules, enseignants, argent —
--    alors que la vie du guichet en fait trois moments distincts :
--      · RENSEIGNEMENT : quelqu'un demande un cours particulier. On note qui,
--        quand il a demandé, quel réceptionniste l'a reçu, ce qu'il veut.
--        Rien n'est encore programmé, et c'est une ALERTE tant que ça dure.
--      · PROGRAMMATION : les modules, leurs dates, leurs prix, leurs
--        enseignants.
--      · CONCLUSION : l'élève a étudié et vient payer. On fixe le total, la
--        répartition école / enseignant, et on règle l'enseignant ou pas.
--    Plusieurs élèves peuvent partager la même séance, chacun avec sa part :
--    d'où `private_session_students`.
--
-- Ce script est IDEMPOTENT : ré-exécutable sans risque.
-- =============================================================================


-- =============================================================================
-- 1. SÉANCES LIBRES — ce que le guichet déclare, et la part de l'enseignant
-- =============================================================================
alter table public.independent_sessions
  -- Le téléphone d'un passager : la seule façon de le rappeler. Un élève
  -- inscrit a le sien sur sa fiche, on ne le duplique pas.
  add column if not exists passager_phone text,
  -- La scolarité déclarée au guichet. Elle sert à proposer les bons créneaux
  -- du jour, et reste sur la séance pour que le bon réimprimé dans six mois
  -- dise encore de qui il s'agissait.
  add column if not exists class_id   uuid references public.classes  (id) on delete set null,
  add column if not exists year       text,
  add column if not exists filiere_id uuid references public.filieres (id) on delete set null,
  add column if not exists module_id  uuid references public.modules  (id) on delete set null,
  -- « Part de l'enseignant sur CETTE séance », en pourcentage.
  --
  -- NULL (le cas courant) : la séance rejoint les présences du créneau et
  -- l'enseignant en touche son pourcentage habituel — l'élève compte comme un
  -- présent de plus. Une valeur : la séance sort du lot, se chiffre à son
  -- propre taux, et s'affiche dans une colonne à part de l'écran de règlement.
  --
  -- 0 n'est PAS l'absence de valeur : c'est un taux délibérément nul, qui
  -- sort la séance du lot pour ne rien verser.
  add column if not exists teacher_percentage integer,
  add column if not exists teacher_amount     integer,
  add column if not exists created_by uuid references public.profiles (id) on delete set null;

alter table public.independent_sessions
  drop constraint if exists independent_sessions_teacher_pct_check;
alter table public.independent_sessions
  add constraint independent_sessions_teacher_pct_check
  check (teacher_percentage is null or teacher_percentage between 0 and 100);

-- L'écran de règlement cherche « ce qui reste dû à cet enseignant » : les
-- séances non réglées d'un créneau, à une date.
create index if not exists independent_sessions_teacher_due_idx
  on public.independent_sessions (session_id, date)
  where teacher_paid = false;

create index if not exists independent_sessions_created_by_idx
  on public.independent_sessions (created_by);


-- =============================================================================
-- 2. RÈGLEMENT D'UN ENSEIGNANT — des identifiants exacts, plus de devinette
-- =============================================================================
-- `p_independent_ids` est la liste des séances libres que CE règlement solde.
-- Les clés (date|créneau) restent honorées telles quelles, pour que les écrans
-- et les scripts qui appelaient déjà le RPC continuent de marcher à
-- l'identique — la nouvelle liste ne fait qu'ajouter de la précision là où il
-- n'y avait qu'une heuristique.
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
  p_settle_deductions boolean default false,
  p_independent_ids uuid[] default null
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

revoke execute on function public.pay_teacher_sessions(uuid, text[], integer, text, integer, jsonb, text, uuid[], uuid[], boolean, uuid[]) from public, anon;
grant execute on function public.pay_teacher_sessions(uuid, text[], integer, text, integer, jsonb, text, uuid[], uuid[], boolean, uuid[]) to authenticated;


-- ---- Annuler un règlement : rendre AUSSI les séances libres nommées --------
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
$$;

revoke execute on function public.delete_teacher_payment(uuid) from public, anon;
grant execute on function public.delete_teacher_payment(uuid) to authenticated;


-- =============================================================================
-- 3. TRAVAILLEURS — la date de paie, et les absences qu'on tranche
-- =============================================================================
alter table public.reception_staff
  -- « Payé à partir du ». Absente : on retombe sur `start_date`, ce que la
  -- réception avait toujours saisi.
  add column if not exists pay_start_date date;

-- ---- Acomptes et retenues : un travailleur SANS COMPTE en a aussi ----------
--
-- `teacher_acomptes.staff_id` et `teacher_absences.staff_id` référençaient
-- `profiles`, c'est-à-dire un compte de connexion. Or la moitié du personnel
-- n'en a pas : le rôle « Ménage » n'en reçoit JAMAIS (l'écran le dit
-- explicitement), et un agent créé sans email ni mot de passe non plus.
--
-- Conséquence, jamais rapportée parce qu'elle échouait en silence dans une
-- écriture optimiste : enregistrer un acompte ou une retenue pour l'un d'eux
-- était REFUSÉ par la base (violation de clé étrangère). L'écran affichait
-- l'acompte, puis il disparaissait au rechargement suivant — et la paie se
-- réglait sans lui.
--
-- Ces deux tables portent « du personnel », pas « des comptes » : la
-- contrainte tombe. Le nettoyage d'un enseignant supprimé continue de passer
-- par l'application (/api/admin/users), et une ligne d'argent orpheline est de
-- toute façon préférable à une ligne d'argent refusée.
alter table public.teacher_acomptes drop constraint if exists teacher_acomptes_staff_id_fkey;
alter table public.teacher_absences drop constraint if exists teacher_absences_staff_id_fkey;

alter table public.worker_shifts
  -- Une absence constatée ne dit pas encore ce qu'elle coûte : la direction
  -- peut retenir une journée, une partie, ou rien du tout. Tant que personne
  -- n'a tranché, l'absence est EN ATTENTE — et le règlement de la période
  -- refuse de se conclure.
  --
  -- Tranchée à 0 DA est une décision comme une autre : `absence_resolved`
  -- vaut alors true et `absence_cost` 0. C'est ce qui distingue « on a décidé
  -- de ne rien retenir » de « personne n'a encore regardé ».
  add column if not exists absence_resolved boolean not null default false,
  add column if not exists absence_cost integer not null default 0,
  add column if not exists absence_id uuid references public.teacher_absences (id) on delete set null;

-- Les absences déjà là quand ce script passe : personne ne les a tranchées,
-- elles sont donc en attente — sauf celles qui portent déjà une retenue,
-- retrouvée par (travailleur, date) dans le registre des retenues.
update public.worker_shifts ws
   set absence_resolved = true,
       absence_cost = ta.cost,
       absence_id = ta.id
  from public.teacher_absences ta
 where ws.status = 'absent'
   and ws.absence_resolved = false
   and ta.staff_id = ws.worker_id
   and (ta.date)::date = ws.work_date;

create index if not exists worker_shifts_pending_absence_idx
  on public.worker_shifts (worker_id, work_date)
  where status = 'absent' and absence_resolved = false;


-- ---- Trancher la retenue d'une absence -------------------------------------
create or replace function public.resolve_worker_absence(
  p_shift_id uuid,
  p_cost integer default 0,
  p_description text default ''
)
returns jsonb
language plpgsql security definer set search_path = public as $$
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

revoke execute on function public.resolve_worker_absence(uuid, integer, text) from public, anon;
grant execute on function public.resolve_worker_absence(uuid, integer, text) to authenticated;


-- ---- Le relevé automatique des absences ne concerne QUE les mensuels -------
-- Un travailleur payé à la journée ou à l'heure est réglé sur ce qu'il a
-- travaillé : ne pas venir se solde tout seul, il n'y a rien à retenir. Lui
-- écrire une absence par jour de repos noyait les vraies.
create or replace function public.mark_worker_absences(
  p_worker_id uuid default null,
  p_from date default null,
  p_to date default null
)
returns jsonb
language plpgsql security definer set search_path = public as $$
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

revoke execute on function public.mark_worker_absences(uuid, date, date) from public, anon;
grant execute on function public.mark_worker_absences(uuid, date, date) to authenticated;


-- =============================================================================
-- 4. SÉANCES PARTICULIÈRES — renseignement, programmation, conclusion
-- =============================================================================

-- ---- 4.a  Le rendez-vous porte son dossier de demande ----------------------
alter table public.private_sessions
  -- « requested » : la demande est prise, rien n'est programmé. C'est une
  -- alerte tant que ça dure.
  add column if not exists request_date date,
  -- Qui a reçu la demande. Le compte pour pouvoir remonter à lui, le nom en
  -- clair pour que la facture reste lisible quand le compte est supprimé.
  add column if not exists receptionist_id uuid references public.profiles (id) on delete set null,
  add column if not exists receptionist_name text,
  add column if not exists observation text not null default '',
  -- Versement pris à la demande, avant toute programmation.
  add column if not exists deposit_amount integer not null default 0,
  -- La répartition décidée à la conclusion.
  add column if not exists school_percentage integer,
  add column if not exists teacher_share integer not null default 0,
  add column if not exists school_share integer not null default 0,
  add column if not exists completed_at timestamptz;

-- Une demande n'a pas encore d'heure : la colonne devient facultative.
alter table public.private_sessions
  alter column scheduled_at drop not null;

alter table public.private_sessions
  drop constraint if exists private_sessions_status_check;
alter table public.private_sessions
  add constraint private_sessions_status_check
  check (status in ('requested', 'planned', 'done', 'cancelled'));

-- Une séance programmée DOIT porter une date : c'est ce qui la distingue d'une
-- demande, et sans elle l'alerte « en retard » ne peut rien dire.
alter table public.private_sessions
  drop constraint if exists private_sessions_scheduled_when_planned;
alter table public.private_sessions
  add constraint private_sessions_scheduled_when_planned
  check (status = 'requested' or scheduled_at is not null);

create index if not exists private_sessions_status_idx
  on public.private_sessions (status, scheduled_at desc);


-- ---- 4.b  Plusieurs élèves sur la même séance ------------------------------
-- Deux cousins qui prennent le même cours particulier sont UNE séance et DEUX
-- élèves. Les entasser dans `guest_name` rendait impossible de dire qui avait
-- payé quoi — et c'est précisément ce que la conclusion de la séance doit
-- répartir.
create table if not exists public.private_session_students (
  id uuid primary key default gen_random_uuid(),
  private_session_id uuid not null references public.private_sessions (id) on delete cascade,
  -- un élève déjà inscrit… ou simplement nommé au guichet
  student_id uuid references public.students (id) on delete set null,
  guest_name  text,
  guest_phone text,
  class_id   uuid references public.classes  (id) on delete set null,
  year       text,
  filiere_id uuid references public.filieres (id) on delete set null,
  -- ce que CET élève doit, et ce qu'il a versé
  total_price integer not null default 0,
  paid_amount integer not null default 0,
  created_at timestamptz not null default now(),
  constraint private_session_students_named
    check (student_id is not null or guest_name is not null)
);

create index if not exists private_session_students_parent_idx
  on public.private_session_students (private_session_id);
create index if not exists private_session_students_student_idx
  on public.private_session_students (student_id);

alter table public.private_session_students enable row level security;

drop policy if exists private_session_students_select on public.private_session_students;
create policy private_session_students_select on public.private_session_students
  for select to authenticated
  using (
    public.is_staff()
    or student_id = auth.uid()
    or public.is_my_child(student_id)
  );

drop policy if exists private_session_students_write on public.private_session_students;
create policy private_session_students_write on public.private_session_students
  for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

-- Les séances déjà écrites n'avaient qu'un élève : on le recopie dans la
-- nouvelle table, pour que TOUS les écrans lisent le même endroit.
insert into public.private_session_students
  (private_session_id, student_id, guest_name, guest_phone, class_id, year, filiere_id,
   total_price, paid_amount)
select ps.id, ps.student_id, ps.guest_name, ps.guest_phone, ps.class_id, ps.year, ps.filiere_id,
       ps.total_price, ps.paid_amount
from public.private_sessions ps
where not exists (
  select 1 from public.private_session_students s where s.private_session_id = ps.id
);


-- ---- 4.c  Un module porte sa propre date, son prix, son enseignant ---------
alter table public.private_session_modules
  -- Chaque module se tient à son heure : deux matières le même jour, à deux
  -- heures différentes, sont deux lignes et non une moyenne.
  add column if not exists scheduled_at timestamptz,
  -- Prix forfaitaire du module. > 0 : c'est LUI le prix, la durée n'est plus
  -- qu'une information. 0 : on garde le calcul minutes × tarif horaire.
  add column if not exists flat_price integer not null default 0,
  -- Un enseignant qui n'est pas (encore) dans la base : un nom, un téléphone.
  add column if not exists teacher_name  text,
  add column if not exists teacher_phone text;

create index if not exists private_session_modules_scheduled_idx
  on public.private_session_modules (scheduled_at);


-- ---- 4.d  Écrire les modules (partagé création / programmation) -------------
-- Le prix d'un module est TOUJOURS recalculé ici, jamais repris de l'écran :
-- soit le forfait saisi, soit minutes × tarif horaire, arrondi une seule fois.
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


-- ---- 4.e  Écrire les élèves d'une séance -----------------------------------
create or replace function public.write_private_session_students(
  p_session_id uuid,
  p_students jsonb
)
returns integer
language plpgsql security definer set search_path = public as $$
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


-- ---- 4.f  ÉTAPE 1 — le renseignement ---------------------------------------
-- Quelqu'un demande un cours particulier. On note qui, quand il a demandé, qui
-- l'a reçu, et ce qu'il veut. Rien n'est encore programmé — et c'est
-- exactement ce que l'alerte du tableau de bord doit dire.
create or replace function public.create_private_request(p_payload jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
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

revoke execute on function public.create_private_request(jsonb) from public, anon;
grant execute on function public.create_private_request(jsonb) to authenticated;


-- ---- 4.g  Modifier le dossier de demande -----------------------------------
create or replace function public.update_private_request(p_id uuid, p_payload jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
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

revoke execute on function public.update_private_request(uuid, jsonb) from public, anon;
grant execute on function public.update_private_request(uuid, jsonb) to authenticated;


-- ---- 4.h  ÉTAPE 2 — la programmation ---------------------------------------
-- Les modules, leurs dates, leurs prix, leurs enseignants. La séance passe de
-- « demande » à « programmée » et sort des alertes.
create or replace function public.program_private_session(p_id uuid, p_payload jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
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

revoke execute on function public.program_private_session(uuid, jsonb) from public, anon;
grant execute on function public.program_private_session(uuid, jsonb) to authenticated;


-- ---- 4.i  ÉTAPE 3 — la conclusion ------------------------------------------
-- L'élève a étudié et vient payer. On fixe le total, la répartition
-- école / enseignant, ce que chacun verse, et on règle les enseignants — ou
-- pas, et c'est alors une alerte jusqu'à ce que ce soit fait.
--
-- LA RÉPARTITION SE DIT DANS LES DEUX SENS. Certaines écoles annoncent « je
-- prends 30 % », d'autres « le prof prend 70 % ». C'est le même partage ;
-- `percentageMode` dit lequel des deux chiffres a été saisi, et l'autre s'en
-- déduit. Sans ça, l'écran et la base pouvaient comprendre deux partages
-- opposés à partir du même « 30 ».
create or replace function public.complete_private_session(p_id uuid, p_payload jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
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

revoke execute on function public.complete_private_session(uuid, jsonb) from public, anon;
grant execute on function public.complete_private_session(uuid, jsonb) to authenticated;


-- ---- 4.j  Statut : « requested » est un statut comme un autre --------------
create or replace function public.set_private_session_status(p_id uuid, p_status text)
returns jsonb
language plpgsql security definer set search_path = public as $$
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

revoke execute on function public.set_private_session_status(uuid, text) from public, anon;
grant execute on function public.set_private_session_status(uuid, text) to authenticated;


-- ---- 4.k  Reporter : une séance reportée redevient « programmée » ----------
create or replace function public.reschedule_private_session(p_id uuid, p_scheduled_at timestamptz)
returns jsonb
language plpgsql security definer set search_path = public as $$
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

revoke execute on function public.reschedule_private_session(uuid, timestamptz) from public, anon;
grant execute on function public.reschedule_private_session(uuid, timestamptz) to authenticated;


-- ---- 4.l  Encaisser la dette : répartie sur les élèves de la séance --------
create or replace function public.pay_private_session(p_id uuid, p_amount integer)
returns jsonb
language plpgsql security definer set search_path = public as $$
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

revoke execute on function public.pay_private_session(uuid, integer) from public, anon;
grant execute on function public.pay_private_session(uuid, integer) to authenticated;


-- =============================================================================
-- 5. LA CAISSE NOMME CE QUI S'Y PASSE
-- =============================================================================
-- Les rapports distinguaient mal une recharge de solde d'une séance libre ou
-- d'un cours particulier : tout arrivait en `student_payment` avec un libellé
-- libre. Le libellé reste la source, mais la caisse porte désormais aussi le
-- compte qui a encaissé pour les séances libres (`independent_sessions.created_by`),
-- ce qui permet de répondre à « combien CE guichet a-t-il encaissé ».
create index if not exists cash_transactions_type_date_idx
  on public.cash_transactions (type, date desc);


-- =============================================================================
-- 6. Contrôle : ce que ce script a posé
-- =============================================================================
do $$
declare
  v_missing text := '';
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'independent_sessions'
       and column_name = 'teacher_percentage'
  ) then v_missing := v_missing || 'independent_sessions.teacher_percentage '; end if;

  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'reception_staff'
       and column_name = 'pay_start_date'
  ) then v_missing := v_missing || 'reception_staff.pay_start_date '; end if;

  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'worker_shifts'
       and column_name = 'absence_resolved'
  ) then v_missing := v_missing || 'worker_shifts.absence_resolved '; end if;

  if not exists (
    select 1 from information_schema.tables
     where table_schema = 'public' and table_name = 'private_session_students'
  ) then v_missing := v_missing || 'private_session_students '; end if;

  if exists (
    select 1 from information_schema.table_constraints
     where table_schema = 'public' and constraint_name = 'teacher_absences_staff_id_fkey'
  ) then v_missing := v_missing || '(teacher_absences.staff_id toujours lié à profiles) '; end if;

  if v_missing <> '' then
    raise exception 'migration incomplète — manquant : %', v_missing;
  end if;

  raise notice 'Migration 20260915 appliquée : tableau de règlement, séances libres, paie des travailleurs, séances particulières en trois temps.';
end;
$$;
