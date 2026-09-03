-- =============================================================================
-- Le solde ne peut plus mentir sur ce que l'élève a suivi
-- Run once against the live project (Supabase Dashboard -> SQL Editor).
--
-- LE SYMPTÔME
--
--   Fiche élève : « Présence: science — 625 DA débités », « Total débité
--   625 DA », historique à l'appui… et « Solde Actuel : 0 DA », sans la
--   moindre dette. L'élève a étudié, la séance est facturée dans son
--   historique, et son solde n'en sait rien.
--
-- LA CAUSE
--
--   Trois écrans écrivaient `students.balance` DIRECTEMENT depuis le
--   navigateur, en valeur ABSOLUE calculée sur la copie locale :
--
--       balance = (le solde que MON écran affiche) - montant
--
--   · le guichet des Séances Libres, à chaque encaissement ;
--   · « Régler » les frais d'inscription depuis la carte élève ;
--   · la fenêtre Modifier de la fiche élève, quand l'inscription est réglée.
--
--   Entre le moment où l'écran a chargé le solde et celui où il le réécrit, le
--   serveur a pu le bouger : un badge à l'entrée, un appel fait par
--   l'enseignant, une caisse ouverte sur un deuxième poste. L'écriture absolue
--   ÉCRASE ces mouvements — la présence et la ligne d'historique restent, le
--   débit sur le solde disparaît. D'où un solde à 0 en face d'une séance
--   facturée 625 DA.
--
-- CE QUE FAIT CE SCRIPT
--
--   1. Deux RPC pour ces trois écrans : elles bougent le solde RELATIVEMENT
--      (`balance = balance - montant`) et écrivent la ligne d'historique dans
--      la MÊME transaction. Deux caisses simultanées ne peuvent plus s'effacer.
--   2. Le solde devient INÉCRIVABLE depuis le navigateur : un PATCH direct sur
--      `students.balance` est ignoré. Seules les RPC (qui écrivent toujours
--      l'historique avec) peuvent le déplacer. La panne ne peut pas revenir par
--      un autre écran.
--   3. `pay_student_debt` règle enfin la dette en entier : les frais
--      d'inscription dus D'ABORD, le solde négatif ensuite, et l'argent entre
--      en caisse — il n'y entrait pas du tout.
--   4. Les soldes DÉJÀ faussés sont recalculés sur leur propre historique, et
--      chaque correction est annoncée nom par nom.
--
-- Ce script est IDEMPOTENT : ré-exécutable sans risque. Le recalcul ne bouge
-- que les soldes qui divergent encore de leur historique.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. charge_student — débiter une séance, sans jamais écraser le solde
-- ---------------------------------------------------------------------------
-- Le guichet des Séances Libres encaisse ici. Le solde descend RELATIVEMENT au
-- solde STOCKÉ, et il a le droit de passer en dette : l'élève a suivi la
-- séance, l'école la lui compte, exactement comme au badge.
create or replace function public.charge_student(
  p_student_id uuid,
  p_amount integer,
  p_description text,
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

  -- Élève gratuit, ou séance à 0 : rien à débiter, rien à raconter.
  if v_amount = 0 or v_student.is_free then
    return jsonb_build_object('ok', true, 'cost', 0, 'newBalance', v_student.balance,
      'debt', v_student.balance < 0);
  end if;

  update public.students set balance = balance - v_amount
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
-- 2. settle_registration_fee — l'inscription se règle sur le solde stocké
-- ---------------------------------------------------------------------------
-- « Régler » depuis la carte élève, et la case « inscription réglée » de la
-- fenêtre Modifier. Même principe : relatif, historique compris, et
-- `registration_due` remis à zéro dans la même transaction.
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

  -- Sans montant donné, on règle ce que la BASE dit encore dû — jamais ce que
  -- l'écran croyait dû il y a dix minutes.
  v_fee := greatest(coalesce(p_fee, v_student.registration_due, 0), 0);
  if v_fee = 0 then
    return jsonb_build_object('ok', true, 'fee', 0, 'newBalance', v_student.balance);
  end if;

  update public.students
     set balance = balance - v_fee,
         registration_due = 0
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
-- 3. pay_student_debt — régler la dette la règle vraiment, et entre en caisse
-- ---------------------------------------------------------------------------
-- L'ancienne version se contentait de créditer le solde. Deux conséquences :
--   · un élève dont la dette était surtout de l'inscription impayée voyait son
--     solde gonfler du montant des frais, qui restaient dus malgré tout ;
--   · l'argent reçu n'entrait JAMAIS en caisse — le bouton « Régler Dette »
--     était invisible dans les recettes de la journée.
--
-- Le versement est maintenant réparti dans l'ordre où l'école réclame :
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

  -- 1. Les frais d'inscription dus passent en premier.
  v_reg_paid := least(coalesce(v_student.registration_due, 0), v_amount);
  -- 2. Puis ce que les séances suivies ont creusé.
  v_debt_paid := least(greatest(-v_student.balance, 0), v_amount - v_reg_paid);
  -- 3. Le surplus reste sur le solde, disponible pour les séances à venir.
  v_credited := v_amount - v_reg_paid - v_debt_paid;

  update public.students
     set balance = balance + (v_amount - v_reg_paid),
         registration_due = coalesce(registration_due, 0) - v_reg_paid
   where id = p_student_id
   returning balance into v_new_balance;

  -- La ligne porte le montant REÇU en entier, et la ligne d'inscription reprend
  -- sa part : leur somme vaut exactement le déplacement du solde, sans quoi
  -- l'historique et le solde divergent de la valeur des frais (même règle que
  -- add_student_balance).
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

  -- L'argent est bien entré : la caisse doit le voir, comme toute recharge.
  insert into public.cash_transactions (type, amount, date, description)
  values ('student_payment', v_amount, now(),
          'Règlement de dette ' || v_student.first_name || ' ' || v_student.last_name);

  return jsonb_build_object('ok', true, 'newBalance', v_new_balance,
    'registrationPaid', v_reg_paid, 'debtPaid', v_debt_paid, 'credited', v_credited);
end;
$fn$;

revoke execute on function public.pay_student_debt(uuid, integer) from public, anon;
grant execute on function public.pay_student_debt(uuid, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Le solde n'est plus écrivable depuis le navigateur
-- ---------------------------------------------------------------------------
-- Le garde-fou existant ne visait que les non-membres du personnel. Or la
-- panne venait du personnel lui-même : un écran de réception qui réécrit le
-- solde en valeur absolue, calculée sur une copie périmée.
--
-- Le solde ne bouge donc plus QUE par les RPC, qui sont `security definer` et
-- s'exécutent sous le propriétaire de la fonction. Une écriture arrivée par
-- l'API REST (rôle `authenticated` / `anon`) garde l'ancien solde : la
-- modification de la fiche passe, le solde ne bouge pas. Aucun message
-- d'erreur, aucune fiche bloquée — juste un solde qui n'obéit plus qu'à son
-- historique.
-- SECURITY INVOKER, volontairement : en SECURITY DEFINER, `current_user` vaut
-- le PROPRIÉTAIRE de la fonction à chaque appel, jamais le rôle qui écrit — le
-- garde-fou ne se serait jamais déclenché. En invoker, `current_user` est
-- `authenticated` quand l'écriture arrive de l'API REST, et le propriétaire
-- quand elle vient d'une RPC `security definer`. `is_staff()` reste, elle,
-- `security definer` : elle lit `profiles`, que le client ne peut pas parcourir.
create or replace function public.protect_student_financial_fields()
returns trigger
language plpgsql security invoker set search_path = public as $fn$
begin
  if not public.is_staff() then
    new.balance := old.balance;
    new.is_free := old.is_free;
    new.registration_due := old.registration_due;
    new.rfid := old.rfid;
    new.parent_id := old.parent_id;
  elsif current_user in ('authenticated', 'anon', 'authenticator') then
    -- Personnel, mais écriture DIRECTE depuis le client : le solde appartient
    -- aux RPC, qui le déplacent relativement et écrivent l'historique avec.
    new.balance := old.balance;
  end if;
  return new;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 5. reconcile_student_balances — remettre le solde d'accord avec l'historique
-- ---------------------------------------------------------------------------
-- L'historique du solde (`balance_tx`) est la vérité : c'est lui qu'on montre
-- au parent, lui qu'on imprime sur le reçu, et chaque mouvement d'argent y
-- écrit sa ligne. Un solde qui s'en écarte a été écrasé par une écriture
-- absolue — il est recalculé.
--
-- p_apply = false : compte les écarts sans rien changer (contrôle).
-- p_apply = true  : corrige, et rend le détail élève par élève.
create or replace function public.reconcile_student_balances(p_apply boolean default false)
returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare
  v_role user_role := public.current_role();
  v_rows jsonb := '[]'::jsonb;
  v_count int := 0;
  v_r record;
begin
  if v_role is null or v_role not in ('admin', 'reception') then
    raise exception 'not authorized';
  end if;

  for v_r in
    select st.id,
           st.first_name || ' ' || st.last_name as name,
           st.balance                            as stored,
           coalesce(tx.total, 0)                 as from_history
      from public.students st
      left join (
        select student_id, sum(amount) as total
          from public.balance_tx group by student_id
      ) tx on tx.student_id = st.id
     where st.balance is distinct from coalesce(tx.total, 0)
     order by coalesce(tx.total, 0) - st.balance
  loop
    v_count := v_count + 1;
    v_rows := v_rows || jsonb_build_object(
      'id', v_r.id, 'name', v_r.name,
      'stored', v_r.stored, 'fromHistory', v_r.from_history,
      'delta', v_r.from_history - v_r.stored);

    if p_apply then
      update public.students set balance = v_r.from_history where id = v_r.id;
    end if;
  end loop;

  return jsonb_build_object('ok', true, 'applied', p_apply, 'students', v_count,
    'details', v_rows);
end;
$fn$;

revoke execute on function public.reconcile_student_balances(boolean) from public, anon;
grant execute on function public.reconcile_student_balances(boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. RÉPARATION DES SOLDES DÉJÀ FAUSSÉS
--    Chaque correction est annoncée nom par nom : rien ne bouge en silence.
--    Aucune présence, aucune ligne d'historique, aucun mouvement de caisse
--    n'est touché — seul le solde est remis à ce que son propre historique dit.
-- ---------------------------------------------------------------------------
do $rep$
declare
  v_r record;
  v_count int := 0;
  v_delta int := 0;
begin
  for v_r in
    select st.id,
           st.last_name || ' ' || st.first_name as name,
           st.rfid,
           st.balance                           as stored,
           coalesce(tx.total, 0)                as from_history
      from public.students st
      left join (
        select student_id, sum(amount) as total
          from public.balance_tx group by student_id
      ) tx on tx.student_id = st.id
     where st.balance is distinct from coalesce(tx.total, 0)
     order by coalesce(tx.total, 0) - st.balance
  loop
    raise notice 'Solde recalculé — % (carte %) : % DA -> % DA',
      v_r.name, coalesce(v_r.rfid, '-'), v_r.stored, v_r.from_history;
    update public.students set balance = v_r.from_history where id = v_r.id;
    v_count := v_count + 1;
    v_delta := v_delta + (v_r.from_history - v_r.stored);
  end loop;

  raise notice '% élève(s) remis d''accord avec leur historique (% DA au total).',
    v_count, v_delta;
end
$rep$;

-- ---------------------------------------------------------------------------
-- 7. Rechargement du cache de schéma de l'API REST
-- ---------------------------------------------------------------------------
notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- 8. Vérification
-- ---------------------------------------------------------------------------
-- a) Les fonctions attendues, et PLUS AUCUN solde en désaccord (0 attendu).
select
  (select count(*) from pg_proc where proname = 'charge_student')              as charge_student,
  (select count(*) from pg_proc where proname = 'settle_registration_fee')     as settle_registration_fee,
  (select count(*) from pg_proc where proname = 'reconcile_student_balances')  as reconcile,
  (select count(*)
     from public.students st
     left join (select student_id, sum(amount) as total
                  from public.balance_tx group by student_id) tx
       on tx.student_id = st.id
    where st.balance is distinct from coalesce(tx.total, 0))                   as soldes_en_desaccord;

-- b) Qui doit quoi, maintenant que le solde dit la vérité.
select st.last_name || ' ' || st.first_name as eleve,
       st.rfid                              as carte,
       st.balance                           as solde,
       st.registration_due                  as inscription_due,
       (case when st.balance < 0 then -st.balance else 0 end)
         + coalesce(st.registration_due, 0) as total_du
from public.students st
where st.balance < 0 or coalesce(st.registration_due, 0) > 0
order by total_du desc;
