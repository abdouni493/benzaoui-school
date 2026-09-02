-- =============================================================================
-- Tarifs, rémunérations et gratuités : remettre tout le monde d'accord
-- Run once against the live project (Supabase Dashboard -> SQL Editor).
--
-- CE QUE CE SCRIPT CORRIGE
--
-- 1. CHANGER LE PRIX D'UN CRÉNEAU NE CHANGEAIT NI LE DÉBIT DE L'ÉLÈVE, NI LA
--    PART DE L'ENSEIGNANT.
--    reprice_session() ne re-tarifait les présences déjà pointées QUE si on lui
--    passait une date de départ, et ne remettait jamais les séances dues à
--    l'heure autrement. Résultat : l'écran Abonnements affichait le nouveau
--    tarif, l'écran Enseignants continuait de devoir l'ancien, et l'historique
--    de solde de l'élève aussi. La re-tarification garde sa date de départ,
--    mais la rémunération encore due est DÉSORMAIS TOUJOURS réalignée.
--
-- 2. UNE GRATUITÉ DÉCIDÉE APRÈS COUP NE RATTRAPAIT PAS LES PRÉSENCES DÉJÀ
--    POINTÉES.
--    Une période gratuite créée le mardi pour une semaine commencée le
--    dimanche, ou un créneau coché « offert » alors qu'il tournait déjà :
--    les élèves qui avaient badgé AVANT restaient débités et l'enseignant
--    restait payé sur eux, pendant que ceux qui badgeaient APRÈS passaient
--    gratuitement. D'où « ça marche pour certains élèves et pas pour
--    d'autres ». apply_offered_rules() repasse sur les présences et applique
--    la règle en vigueur : l'élève est REMBOURSÉ (ligne de compte à l'appui),
--    le prix part dans waived_amount, et la séance due non réglée disparaît.
--
-- 3. LA PART DUE À L'ENSEIGNANT PEUT DÉRIVER DE CE QUE L'ÉCOLE A ENCAISSÉ.
--    sync_teacher_dues() rétablit l'invariant, une fois pour toutes :
--
--        séance due (non réglée) = % de ce que la présence a valu à l'école
--
--    et supprime les séances dues posées sur une séance qui ne rémunère
--    personne. Une séance DÉJÀ RÉGLÉE (paid = true) n'est jamais retouchée,
--    ni les règlements versés, ni la caisse.
--
-- Ce script est IDEMPOTENT : ré-exécutable sans risque. Le rejouer ne
-- rembourse rien deux fois — une présence remboursée est à 0 DA, donc il n'y
-- a plus rien à lui rendre.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. La règle de gratuité d'une séance, en un seul endroit
-- ---------------------------------------------------------------------------
-- Jusqu'ici « cette séance est-elle offerte ? » était réécrit dans scan_card,
-- dans mark_attendance et dans l'écran Enseignants. Trois copies, trois façons
-- de dériver. La question a maintenant UNE réponse :
--
--   offered        : rien ne doit être débité à l'élève ;
--   free_period_id : la période gratuite qui l'offre (NULL si c'est le créneau) ;
--   teacher_earns  : l'enseignant touche-t-il quand même sa part ?
--
-- Un créneau coché « offert » ne rémunère personne. Une période gratuite
-- rémunère l'enseignant, sauf si elle a été réglée « sans rémunération ».
create or replace function public.offered_rule(p_session_id uuid, p_date date)
returns table (offered boolean, free_period_id uuid, teacher_earns boolean)
language sql stable set search_path = public as $fn$
  select
    coalesce(se.is_free, false) or fp.id is not null,
    fp.id,
    not coalesce(se.is_free, false) and coalesce(fp.pay_teachers, true)
  from public.sessions se
  left join lateral public.active_free_period(
    array[se.class_id] || coalesce(se.class_ids, '{}'::uuid[]), p_date) fp on true
  where se.id = p_session_id;
$fn$;

grant execute on function public.offered_rule(uuid, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. sync_teacher_dues — la part encore due suit ce que l'école a encaissé
-- ---------------------------------------------------------------------------
-- Invariant rétabli : pour un enseignant au pourcentage,
--
--     unpaid_teacher_sessions.amount = round(valeur de la présence × %)
--
-- où « valeur de la présence » est le montant débité à l'élève, ou — quand la
-- séance a été offerte mais que l'enseignant est quand même payé (période
-- gratuite rémunérée, séance antérieure au début de l'abonnement) — le prix
-- non facturé mis de côté dans waived_amount.
--
-- p_session_id : ne traiter qu'un cours (tous ses groupes). NULL = tout.
-- p_from       : ne traiter qu'à partir de cette date. NULL = tout l'historique.
--
-- Une ligne déjà réglée (paid = true) n'est JAMAIS touchée : un règlement versé
-- est un fait comptable, pas une estimation. Ce qui reste DÛ, en revanche, est
-- recalculé au pourcentage EN VIGUEUR de l'enseignant : changer son taux met
-- donc à jour ce qu'on lui doit encore, jamais ce qu'on lui a déjà versé.
create or replace function public.sync_teacher_dues(
  p_session_id uuid default null,
  p_from date default null
)
returns jsonb
language plpgsql security definer set search_path = public as $fn$
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
$fn$;

revoke execute on function public.sync_teacher_dues(uuid, date) from public, anon;
grant execute on function public.sync_teacher_dues(uuid, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. apply_offered_rules — la gratuité rattrape ce qui a déjà été pointé
-- ---------------------------------------------------------------------------
-- Repasse sur les présences enregistrées et applique la règle EN VIGUEUR
-- aujourd'hui. Ce qui a été débité à tort est RENDU à l'élève :
--
--   · son solde est recrédité,
--   · une ligne 'topup' explique le remboursement dans son historique,
--   · la présence garde sa trace : le prix passe dans waived_amount, et la
--     période gratuite qui l'offre est enregistrée (free_period_id),
--   · la séance due non réglée disparaît si l'enseignant ne gagne rien.
--
-- Ce sens est le seul autorisé : on rend de l'argent, on n'en reprend jamais.
-- Supprimer ou désactiver une période gratuite ne re-débite donc personne.
create or replace function public.apply_offered_rules(
  p_from date default null,
  p_to date default null,
  p_session_id uuid default null
)
returns jsonb
language plpgsql security definer set search_path = public as $fn$
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
$fn$;

revoke execute on function public.apply_offered_rules(date, date, uuid) from public, anon;
grant execute on function public.apply_offered_rules(date, date, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. reprice_session — le nouveau tarif descend TOUJOURS jusqu'aux séances dues
-- ---------------------------------------------------------------------------
-- Inchangé côté élèves : les présences déjà pointées ne sont re-tarifées que
-- si p_from est donné (on ne réécrit pas l'histoire sans le demander).
-- Ce qui change : la part ENCORE DUE à l'enseignant est réalignée à chaque
-- appel, avec ou sans p_from, par sync_teacher_dues(). Sans cela, l'écran
-- Enseignants gardait l'ancien tarif indéfiniment.
create or replace function public.reprice_session(
  p_session_id uuid,
  p_price integer default 0,
  p_level_price integer default null,
  p_period_months integer default null,
  p_from date default null
)
returns jsonb
language plpgsql security definer set search_path = public as $fn$
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
$fn$;

revoke execute on function public.reprice_session(uuid, integer, integer, integer, date) from public, anon;
grant execute on function public.reprice_session(uuid, integer, integer, integer, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. RÉPARATION DES DONNÉES DÉJÀ ÉCRITES
--    Rien d'autre n'est touché : aucun règlement versé, aucune séance déjà
--    réglée, aucun mouvement de caisse, aucune présence supprimée.
-- ---------------------------------------------------------------------------
do $rep$
declare
  v_att record;
  v_module_name text;
  v_presences int := 0;
  v_refunded int := 0;
  v_stamped int := 0;
  v_removed int := 0;
  v_updated int := 0;
begin
  -- a) Les présences facturées alors que la séance est offerte : remboursées.
  for v_att in
    select a.id, a.student_id, a.amount_deducted, a.free_period_id,
           (timezone('Africa/Algiers', a.occurred_at))::date as day,
           se.module_id, st.is_free as student_free, r.free_period_id as rule_period
      from public.attendance a
      join public.sessions se on se.id = a.session_id
      join public.students st on st.id = a.student_id
      join lateral public.offered_rule(
        a.session_id, (timezone('Africa/Algiers', a.occurred_at))::date) r on true
     where r.offered
     order by a.occurred_at
  loop
    if v_att.amount_deducted > 0 then
      select m.name into v_module_name from public.modules m where m.id = v_att.module_id;

      update public.students set balance = balance + v_att.amount_deducted
       where id = v_att.student_id;

      insert into public.balance_tx (student_id, amount, date, type, description, module_id)
      values (v_att.student_id, v_att.amount_deducted, now(), 'topup',
              'Séance offerte — remboursement: ' || coalesce(v_module_name, 'séance')
                || ' du ' || to_char(v_att.day, 'DD/MM/YYYY'),
              v_att.module_id);

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
      update public.attendance set free_period_id = v_att.rule_period where id = v_att.id;
      v_stamped := v_stamped + 1;
    end if;
  end loop;

  -- b) Les séances dues non réglées posées sur une séance qui ne rémunère
  --    personne.
  delete from public.unpaid_teacher_sessions u
  where u.paid = false
    and exists (
      select 1
      from public.offered_rule(u.session_id, (timezone('Africa/Algiers', u.date))::date) r
      where not r.teacher_earns
    );
  get diagnostics v_removed = row_count;

  -- c) Les séances dues non réglées qui ne valent plus le bon montant.
  with want as (
    select u.id,
           round(
             (case when a.amount_deducted > 0 then a.amount_deducted
                   else coalesce(a.waived_amount, 0) end)
             * coalesce(t.percentage, 0) / 100.0)::int as amount
    from public.unpaid_teacher_sessions u
    join public.teachers t on t.id = u.teacher_id and t.payment_type = 'percentage'
    join public.attendance a
      on a.student_id = u.student_id
     and a.session_id = u.session_id
     and (timezone('Africa/Algiers', a.occurred_at))::date
         = (timezone('Africa/Algiers', u.date))::date
    where u.paid = false
  )
  update public.unpaid_teacher_sessions u
     set amount = w.amount
    from want w
   where w.id = u.id and u.amount is distinct from w.amount;
  get diagnostics v_updated = row_count;

  raise notice 'Séances offertes rattrapées: % présence(s), % DA rendus, % rattachée(s) à leur période.',
    v_presences, v_refunded, v_stamped;
  raise notice 'Séances dues: % retirée(s) (séance offerte), % remise(s) au bon montant.',
    v_removed, v_updated;
end
$rep$;

-- ---------------------------------------------------------------------------
-- 6. Rechargement du cache de schéma de l'API REST
-- ---------------------------------------------------------------------------
notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- 7. Vérification : une seule ligne, tous les compteurs d'anomalies à 0
-- ---------------------------------------------------------------------------
select
  (select count(*)
     from public.attendance a
     join lateral public.offered_rule(
       a.session_id, (timezone('Africa/Algiers', a.occurred_at))::date) r on true
    where r.offered and a.amount_deducted > 0)                        as presences_offertes_encore_facturees,
  (select count(*)
     from public.unpaid_teacher_sessions u
    where u.paid = false
      and exists (select 1 from public.offered_rule(
            u.session_id, (timezone('Africa/Algiers', u.date))::date) r
          where not r.teacher_earns))                                 as dues_sur_seances_offertes,
  (select count(*)
     from public.unpaid_teacher_sessions u
     join public.teachers t on t.id = u.teacher_id and t.payment_type = 'percentage'
     join public.attendance a
       on a.student_id = u.student_id and a.session_id = u.session_id
      and (timezone('Africa/Algiers', a.occurred_at))::date
          = (timezone('Africa/Algiers', u.date))::date
    where u.paid = false
      and u.amount is distinct from round(
            (case when a.amount_deducted > 0 then a.amount_deducted
                  else coalesce(a.waived_amount, 0) end)
            * coalesce(t.percentage, 0) / 100.0)::int)                as dues_au_mauvais_montant,
  (select count(*) from pg_proc where proname = 'offered_rule')        as offered_rule,
  (select count(*) from pg_proc where proname = 'sync_teacher_dues')   as sync_teacher_dues,
  (select count(*) from pg_proc where proname = 'apply_offered_rules') as apply_offered_rules;
