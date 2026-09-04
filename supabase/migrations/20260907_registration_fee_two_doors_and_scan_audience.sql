-- =============================================================================
-- FRAIS D'INSCRIPTION : DEUX PORTES — et le badge sur les séances libres
-- Run once against the live project (Supabase Dashboard -> SQL Editor).
--
-- CE QUE CE SCRIPT RÉPARE
--
--   1. « La base a refusé le règlement: Could not find the function
--      public.settle_registration_fee(p_fee, p_label, p_student_id) in the
--      schema cache. »
--
--      L'écran appelle cette RPC depuis 20260905 ; la base ne l'a jamais reçue
--      (la migration 20260905 n'a pas été jouée sur ce projet). La section 1 la
--      crée, avec ses deux voisines du même lot — `charge_student` et la
--      version « répartie » de `pay_student_debt` — que le même écran appelle.
--
--   2. Une recharge ne paie plus l'inscription à l'insu du guichet. Rien à
--      changer côté base : `add_student_balance` ne touche aux frais que si on
--      le lui demande (`p_settle_registration`). C'est l'écran qui posait la
--      question à l'envers ; il pose maintenant DEUX choix explicites, et
--      « recharge seule » est celui par défaut.
--
--   3. Les frais d'inscription peuvent être encaissés À PART, sans manger la
--      recharge de l'élève : c'est `pay_registration_fee_cash` (section 2).
--      L'argent entre en caisse, le solde ne bouge pas d'un dinar.
--
--   4. LE BADGE, séance libre contre cours ordinaire (section 3) :
--        · SÉANCE LIBRE (`sessions.is_open`) — toute la promotion badge :
--          même niveau, MÊME ANNÉE, la filière ne compte pas. Un 3AS lettres
--          et un 3AS sciences entrent tous les deux sur la même séance libre.
--        · COURS ORDINAIRE — même niveau, MÊME ANNÉE ET MÊME FILIÈRE. Un
--          emploi du temps programmé pour les 3AS sciences n'accepte au badge
--          que des 3AS sciences ; le 3AS lettres est refusé.
--
-- CE QUE CE SCRIPT NE TOUCHE PAS : aucune présence, aucun abonnement, aucune
-- fiche élève, aucun mouvement de caisse existant. Il ne (re)définit que des
-- fonctions.
--
-- Ce script est IDEMPOTENT : ré-exécutable sans risque.
-- =============================================================================

-- =============================================================================
-- SECTION 1 — LES RÈGLEMENTS QUI MANQUAIENT À LA BASE
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1.1 charge_student — débiter une séance encaissée au guichet
-- ---------------------------------------------------------------------------
-- Le solde bouge RELATIVEMENT au solde stocké et l'historique part dans la
-- même transaction : deux caisses ouvertes en même temps ne peuvent plus
-- s'effacer l'une l'autre. Le solde a le droit de passer en dette — l'élève a
-- suivi la séance, elle lui est comptée.
create or replace function public.charge_student(
  p_student_id uuid,
  p_amount integer,
  p_description text default null,
  p_module_id uuid default null
)
returns jsonb
language plpgsql security definer set search_path = public as $fn$
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
$fn$;

revoke execute on function public.charge_student(uuid, integer, text, uuid) from public, anon;
grant execute on function public.charge_student(uuid, integer, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 1.2 settle_registration_fee — LA FONCTION QUI MANQUAIT
-- ---------------------------------------------------------------------------
-- Porte n°1 des frais d'inscription : l'élève paie avec ce qu'il a DÉJÀ versé.
-- Son solde descend du montant des frais et `registration_due` retombe à zéro,
-- dans la même transaction. Rien n'entre en caisse : l'argent y est entré le
-- jour de sa recharge, l'y remettre le compterait deux fois.
--
-- Sans montant donné, on règle ce que la BASE dit encore dû — jamais ce que
-- l'écran croyait dû il y a dix minutes.
create or replace function public.settle_registration_fee(
  p_student_id uuid,
  p_fee integer default null,
  p_label text default null
)
returns jsonb
language plpgsql security definer set search_path = public as $fn$
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
$fn$;

revoke execute on function public.settle_registration_fee(uuid, integer, text) from public, anon;
grant execute on function public.settle_registration_fee(uuid, integer, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 1.3 pay_student_debt — le versement est réparti, et il entre en caisse
-- ---------------------------------------------------------------------------
-- L'ancienne version se contentait de créditer le solde : un élève dont la
-- dette était surtout de l'inscription impayée voyait son solde gonfler des
-- frais, qui restaient dus malgré tout — et l'argent n'entrait JAMAIS en
-- caisse. Le versement est maintenant réparti dans l'ordre où l'école réclame :
--   1. les frais d'inscription encore dus,
--   2. le solde négatif (les séances suivies non payées),
--   3. le reste, s'il en reste, va sur le solde comme une recharge.
create or replace function public.pay_student_debt(p_student_id uuid, p_amount integer)
returns jsonb
language plpgsql security definer set search_path = public as $fn$
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
$fn$;

revoke execute on function public.pay_student_debt(uuid, integer) from public, anon;
grant execute on function public.pay_student_debt(uuid, integer) to authenticated;

-- =============================================================================
-- SECTION 2 — LA DEUXIÈME PORTE : LES FRAIS ENCAISSÉS À PART
-- =============================================================================
-- L'élève sort l'argent des frais d'inscription au guichet, aujourd'hui, en
-- plus de sa recharge. Trois écritures, une seule transaction :
--
--   · la caisse du jour voit passer les frais (`cash_transactions`) ;
--   · l'historique de l'élève porte la RECETTE (+frais) et son AFFECTATION
--     (-frais) — deux lignes qui s'annulent, exactement comme le fait déjà
--     `add_student_balance` quand on lui demande de régler l'inscription ;
--   · `registration_due` retombe à zéro.
--
-- Résultat : le solde de l'élève ne bouge PAS. Sa recharge lui reste entière
-- pour ses séances, et la somme de son historique vaut toujours son solde —
-- l'invariant que `reconcile_student_balances` contrôle.
--
-- Sans montant donné, on encaisse ce que la BASE dit encore dû.
create or replace function public.pay_registration_fee_cash(
  p_student_id uuid,
  p_fee integer default null,
  p_label text default null
)
returns jsonb
language plpgsql security definer set search_path = public as $fn$
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
$fn$;

comment on function public.pay_registration_fee_cash(uuid, integer, text) is
  'Encaisse les frais d''inscription À PART : la caisse les reçoit, le solde de l''élève ne bouge pas.';

revoke execute on function public.pay_registration_fee_cash(uuid, integer, text) from public, anon;
grant execute on function public.pay_registration_fee_cash(uuid, integer, text) to authenticated;

-- =============================================================================
-- SECTION 3 — QUI PEUT BADGER SUR QUOI
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 3.1 class_peer_ids — les classes qui désignent la même population
-- ---------------------------------------------------------------------------
-- Une ligne de `classes` porte exactement le triplet que la réception coche à
-- la création d'un emploi du temps : le niveau (primaire/moyen/lycée), l'année
-- et la filière. Deux lignes qui portent le même triplet désignent la même
-- population d'élèves, même si elles ont été créées séparément.
--
-- `p_ignore_filiere` est le réglage des SÉANCES LIBRES : elles réunissent toute
-- une PROMOTION (même niveau, même année), sciences et lettres confondues.
-- L'année, elle, sépare toujours : une 2AS n'entre pas chez les 3AS.
--
-- Les formations n'ont ni année ni filière : elles se rapprochent par leur
-- niveau (A1…C2), et jamais par « pas de filière », qui les réunirait toutes.
create or replace function public.class_peer_ids(
  p_class_ids uuid[],
  p_ignore_filiere boolean
)
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
            and (coalesce(p_ignore_filiere, false)
                 or c.filiere_id is not distinct from p.filiere_id))
        or (c.type = 'formation' and p.type = 'formation'
            and c.formation_level is not distinct from p.formation_level)
      )
  );
$fn$;

comment on function public.class_peer_ids(uuid[], boolean) is
  'Les classes qui désignent la même population. La filière compte, sauf sur une séance libre (p_ignore_filiere).';

-- L'ancienne signature reste : elle garde son sens strict (filière comprise),
-- et tout ce qui l'appelait continue de dire la même chose. PAS de valeur par
-- défaut sur la version à deux arguments — elle rendrait l'appel à un argument
-- ambigu.
create or replace function public.class_peer_ids(p_class_ids uuid[])
returns uuid[]
language sql stable set search_path = public as $fn$
  select public.class_peer_ids(p_class_ids, false);
$fn$;

comment on function public.class_peer_ids(uuid[]) is
  'Les classes qui désignent la même population : même niveau, même année, même filière (formations : même niveau).';

grant execute on function public.class_peer_ids(uuid[]) to authenticated;
grant execute on function public.class_peer_ids(uuid[], boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 3.2 session_audience_class_ids — le public d'un créneau
-- ---------------------------------------------------------------------------
-- Les classes cochées à la création (colonne simple + tableau multi-classes),
-- élargies à leurs jumelles. C'EST ICI QUE LES DEUX RÈGLES SE SÉPARENT :
--
--   · SÉANCE LIBRE (`is_open`) — jumelles au sens LARGE : même niveau, même
--     année, filière indifférente. Toute la promotion badge.
--   · COURS ORDINAIRE — jumelles au sens STRICT : même niveau, même année,
--     même filière. Un 3AS lettres ne badge pas sur le cours des 3AS sciences.
--
-- Une séance libre réglée sur « toute la filière » (`open_audience = 'filiere'`)
-- va plus loin encore : toutes les années de la filière s'ajoutent au lot.
create or replace function public.session_audience_class_ids(p_session_id uuid)
returns uuid[]
language sql stable set search_path = public as $fn$
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
$fn$;

comment on function public.session_audience_class_ids(uuid) is
  'Les classes admises sur un créneau : cochées à sa création, élargies à leurs jumelles — filière comprise sur un cours ordinaire, ignorée sur une séance libre.';

grant execute on function public.session_audience_class_ids(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3.3 student_class_ids — les classes d'un élève
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
-- 3.4 student_session_rank — à quel titre cet élève est-il là ?
-- ---------------------------------------------------------------------------
-- Le rang sert DEUX fois : il dit si la carte est acceptée (non NULL), et il
-- départage deux créneaux qui se chevauchent — le créneau où l'élève est
-- nommément inscrit passe toujours devant celui où il n'entre que par sa
-- classe.
--
--   0 — inscrit sur CE créneau ;
--   1 — inscrit au même cours dans un autre groupe (rattrapage) ;
--   2 — rattaché à une classe du public du créneau (3.2 dit lequel) ;
--   NULL — rien à faire là, la carte est refusée.
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

-- =============================================================================
-- SECTION 4 — RECHARGEMENT DU CACHE DE SCHÉMA DE L'API REST
-- =============================================================================
-- Sans cette ligne, PostgREST continue de répondre « Could not find the
-- function … in the schema cache » alors que la fonction existe.
notify pgrst, 'reload schema';

-- =============================================================================
-- SECTION 5 — VÉRIFICATION
-- =============================================================================
-- Les quatre premières colonnes doivent valoir 1, la cinquième 2 (les deux
-- signatures de class_peer_ids).
--
-- Si `scan_card_classe` vaut false, c'est que `scan_card` n'appelle pas encore
-- `student_session_rank` : les règles de public ci-dessus ne servent alors à
-- rien, le badge ne les consulte pas. Jouer dans cet ORDRE :
--   1. supabase/standalone/scan_audience_same_class_year_filiere.sql (il
--      réécrit `scan_card` — mais aussi `class_peer_ids` et
--      `session_audience_class_ids` dans leur version STRICTE, filière
--      comprise, y compris sur les séances libres) ;
--   2. CE SCRIPT À NOUVEAU, qui repose la règle « séance libre = promotion ».
-- L'inverse laisserait les séances libres fermées aux autres filières.
select
  (select count(*) from pg_proc where proname = 'settle_registration_fee')    as settle_registration_fee,
  (select count(*) from pg_proc where proname = 'pay_registration_fee_cash')  as pay_registration_fee_cash,
  (select count(*) from pg_proc where proname = 'charge_student')             as charge_student,
  (select count(*) from pg_proc where proname = 'session_audience_class_ids') as session_audience_class_ids,
  (select count(*) from pg_proc where proname = 'class_peer_ids')             as class_peer_ids,
  (select exists (
     select 1 from pg_proc
      where proname = 'scan_card'
        and prosrc like '%student_session_rank%'))                            as scan_card_classe;

-- Qui badge sur quoi, créneau par créneau : le nombre de classes admises, et
-- la règle appliquée. Une séance libre doit annoncer « promotion (filière
-- ignorée) », un cours ordinaire « niveau + année + filière ».
select coalesce(se.title, m.name)                             as creneau,
       case when coalesce(se.is_open, false)
            then 'séance libre — promotion (filière ignorée)'
            else 'cours ordinaire — niveau + année + filière' end as regle,
       coalesce(se.open_audience, '(par défaut)')             as public_regle,
       array_length(public.session_audience_class_ids(se.id), 1) as classes_admises
  from public.sessions se
  left join public.modules m on m.id = se.module_id
 order by coalesce(se.is_open, false) desc, creneau;
