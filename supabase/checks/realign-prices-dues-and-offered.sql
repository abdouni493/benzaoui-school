-- =============================================================================
-- « Le nouveau tarif ne descend pas jusqu'à l'élève ni jusqu'à l'enseignant »
--
-- À lancer dans Supabase Dashboard -> SQL Editor, APRÈS la migration
-- supabase/migrations/20260903_price_sync_and_offered_reconcile.sql.
--
-- Ce fichier remet d'aplomb les données DÉJÀ écrites. Il répond à trois
-- questions, dans cet ordre :
--
--   1. quelles présences ne valent plus le tarif actuel de leur créneau ?
--   2. quelles séances dues à un enseignant ne correspondent plus à ce que
--      l'école a réellement encaissé sur la présence ?
--   3. quelles séances OFFERTES (créneau coché « offert », période gratuite)
--      ont quand même été facturées à l'élève / payées à l'enseignant ?
--
-- CE QUI N'EST JAMAIS TOUCHÉ, dans aucune section :
--   · une séance déjà RÉGLÉE à l'enseignant (unpaid_teacher_sessions.paid) ;
--   · un règlement versé (teacher_payments) et son mouvement de caisse ;
--   · une présence : aucune n'est créée, aucune n'est supprimée ;
--   · les recharges, les dettes payées, les frais d'inscription ;
--   · les acomptes et les retenues d'absence.
--
-- Chaque section est IDEMPOTENTE : la relancer ne rembourse ni ne débite deux
-- fois. Les sections 1 à 3 ne LISENT que. Les sections 4 à 6 écrivent.
-- =============================================================================


-- ###########################################################################
-- ## 1 à 3 — DIAGNOSTIC (lecture seule) ####################################
-- ###########################################################################

-- ---------------------------------------------------------------------------
-- 1. Présences dont le montant ne correspond plus au tarif COURANT du créneau
--    `manque` > 0 : l'élève a payé MOINS que le tarif actuel (le prix a été
--    augmenté après coup). `manque` < 0 : il a payé plus.
--    Les séances offertes sont exclues : elles ne coûtent rien, par décision.
-- ---------------------------------------------------------------------------
select
  (timezone('Africa/Algiers', a.occurred_at))::date            as jour,
  st.first_name || ' ' || st.last_name                         as eleve,
  m.name                                                       as module,
  g.name                                                       as groupe,
  a.amount_deducted                                            as debite,
  public.student_session_price(a.student_id, a.session_id,
    (timezone('Africa/Algiers', a.occurred_at))::date)          as tarif_actuel,
  public.student_session_price(a.student_id, a.session_id,
    (timezone('Africa/Algiers', a.occurred_at))::date)
    - a.amount_deducted                                        as manque
from public.attendance a
join public.students st on st.id = a.student_id
join public.sessions se on se.id = a.session_id
left join public.modules m on m.id = se.module_id
left join public.groups  g on g.id = se.group_id
where not st.is_free
  and a.amount_deducted > 0
  and coalesce(a.waived_amount, 0) = 0
  and a.free_period_id is null
  and not coalesce(a.pre_start, false)
  and a.amount_deducted <> public.student_session_price(
        a.student_id, a.session_id, (timezone('Africa/Algiers', a.occurred_at))::date)
order by jour desc, eleve
limit 200;


-- ---------------------------------------------------------------------------
-- 2. Séances dues (NON réglées) dont le montant ne suit plus la présence
--    La règle : part due = % de ce que la présence a valu à l'école, c'est-à-
--    dire le montant débité, ou le prix mis de côté quand la séance a été
--    offerte mais que l'enseignant est quand même payé.
-- ---------------------------------------------------------------------------
select
  (timezone('Africa/Algiers', u.date))::date                   as jour,
  t.first_name || ' ' || t.last_name                           as enseignant,
  t.percentage                                                 as pct,
  st.first_name || ' ' || st.last_name                         as eleve,
  m.name                                                       as module,
  u.amount                                                     as du_actuellement,
  round((case when a.amount_deducted > 0 then a.amount_deducted
              else coalesce(a.waived_amount, 0) end)
        * coalesce(t.percentage, 0) / 100.0)::int              as du_correct
from public.unpaid_teacher_sessions u
join public.teachers t on t.id = u.teacher_id and t.payment_type = 'percentage'
join public.students st on st.id = u.student_id
join public.attendance a
  on a.student_id = u.student_id
 and a.session_id = u.session_id
 and (timezone('Africa/Algiers', a.occurred_at))::date
     = (timezone('Africa/Algiers', u.date))::date
join public.sessions se on se.id = u.session_id
left join public.modules m on m.id = se.module_id
where u.paid = false
  and u.amount is distinct from round(
        (case when a.amount_deducted > 0 then a.amount_deducted
              else coalesce(a.waived_amount, 0) end)
        * coalesce(t.percentage, 0) / 100.0)::int
order by jour desc, enseignant
limit 200;


-- ---------------------------------------------------------------------------
-- 3. Gratuités décidées APRÈS coup : l'élève a été débité quand même
--    C'est le « ça marche pour certains élèves et pas pour d'autres » : ceux
--    qui ont badgé AVANT que la période gratuite / le créneau offert ne soit
--    enregistré sont restés facturés.
-- ---------------------------------------------------------------------------
select
  (timezone('Africa/Algiers', a.occurred_at))::date            as jour,
  st.first_name || ' ' || st.last_name                         as eleve,
  m.name                                                       as module,
  a.amount_deducted                                            as debite_a_tort,
  case when coalesce(se.is_free, false) then 'créneau offert'
       else 'période gratuite: ' || coalesce(fp.name, '?') end as raison,
  (select count(*) from public.unpaid_teacher_sessions u
    where u.paid = false and u.student_id = a.student_id and u.session_id = a.session_id
      and (timezone('Africa/Algiers', u.date))::date
          = (timezone('Africa/Algiers', a.occurred_at))::date) as seance_due_posee
from public.attendance a
join public.students st on st.id = a.student_id
join public.sessions se on se.id = a.session_id
left join public.modules m on m.id = se.module_id
join lateral public.offered_rule(
  a.session_id, (timezone('Africa/Algiers', a.occurred_at))::date) r on true
left join public.free_periods fp on fp.id = r.free_period_id
where r.offered
  and a.amount_deducted > 0
order by jour desc, eleve
limit 200;


-- ###########################################################################
-- ## 4 à 6 — RÉPARATION (écriture) #########################################
-- ###########################################################################

-- ---------------------------------------------------------------------------
-- 4. LES GRATUITÉS RATTRAPENT LES PRÉSENCES DÉJÀ POINTÉES
--    L'élève est REMBOURSÉ de ce qu'on lui avait pris sur une séance offerte,
--    le prix part dans waived_amount (les rapports chiffrent toujours juste),
--    et la séance due non réglée disparaît si l'enseignant ne gagne rien.
--    Ce sens est le seul autorisé : on rend, on ne reprend jamais.
-- ---------------------------------------------------------------------------
do $$
declare
  v_att record;
  v_module_name text;
  v_presences int := 0;
  v_refunded int := 0;
  v_stamped int := 0;
begin
  for v_att in
    select a.id, a.student_id, a.amount_deducted, a.free_period_id,
           (timezone('Africa/Algiers', a.occurred_at))::date as jour,
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
                || ' du ' || to_char(v_att.jour, 'DD/MM/YYYY'),
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

  raise notice '4. Gratuités rattrapées : % présence(s), % DA rendus aux élèves, % rattachée(s) à leur période.',
    v_presences, v_refunded, v_stamped;
end $$;


-- ---------------------------------------------------------------------------
-- 5. LES PRÉSENCES DÉJÀ POINTÉES SUIVENT LE TARIF COURANT DE LEUR CRÉNEAU
--
--    ⚠  C'EST LA SEULE SECTION QUI PEUT DÉBITER UN ÉLÈVE. Elle rejoue ce que
--       « Appliquer aussi aux séances déjà pointées » fait depuis l'écran
--       Abonnements, mais sur TOUS les créneaux d'un coup.
--
--    RÉGLEZ LA DATE CI-DESSOUS avant de lancer : seules les présences à partir
--    de cette date sont re-tarifées, les plus anciennes gardent leur prix.
--    Par défaut : le 1er du mois en cours.
--
--    Une séance OFFERTE n'est jamais re-facturée : seule la valeur de ce qui a
--    été offert (waived_amount) suit le nouveau tarif.
-- ---------------------------------------------------------------------------
do $$
declare
  -- ►►► LA DATE À RÉGLER ◄◄◄  (ex. : date '2026-09-01')
  c_from constant date := date_trunc('month', current_date)::date;

  v_att record;
  v_new_price int;
  v_delta int;
  v_module_name text;
  v_group_name text;
  v_repriced int := 0;
  v_charged int := 0;
  v_refunded int := 0;
begin
  for v_att in
    select a.id, a.student_id, a.session_id, a.amount_deducted, a.waived_amount,
           a.free_period_id, a.pre_start,
           (timezone('Africa/Algiers', a.occurred_at))::date as jour,
           se.module_id, se.group_id, st.is_free as student_free
      from public.attendance a
      join public.sessions se on se.id = a.session_id
      join public.students st on st.id = a.student_id
     where (timezone('Africa/Algiers', a.occurred_at))::date >= c_from
     order by a.occurred_at
  loop
    v_new_price := case
      when v_att.student_free then 0
      else public.student_session_price(v_att.student_id, v_att.session_id, v_att.jour)
    end;

    if coalesce(v_att.waived_amount, 0) > 0 or v_att.free_period_id is not null
       or coalesce(v_att.pre_start, false) then
      -- Séance offerte : rien n'a été débité et rien ne le sera.
      if coalesce(v_att.waived_amount, 0) <> v_new_price then
        update public.attendance set waived_amount = v_new_price where id = v_att.id;
        v_repriced := v_repriced + 1;
      end if;

    elsif v_att.amount_deducted <> v_new_price then
      v_delta := v_new_price - v_att.amount_deducted;

      select m.name into v_module_name from public.modules m where m.id = v_att.module_id;
      select g.name into v_group_name from public.groups g where g.id = v_att.group_id;

      update public.attendance set amount_deducted = v_new_price where id = v_att.id;
      update public.students set balance = balance - v_delta where id = v_att.student_id;

      insert into public.balance_tx (student_id, amount, date, type, description, module_id)
      values (v_att.student_id, -v_delta, now(),
              (case when v_delta > 0 then 'deduction' else 'topup' end)::balance_tx_type,
              'Nouveau tarif: ' || coalesce(v_module_name, 'séance')
                || coalesce(' (' || v_group_name || ')', '')
                || ' du ' || to_char(v_att.jour, 'DD/MM/YYYY')
                || ' — ' || v_att.amount_deducted || ' DA → ' || v_new_price || ' DA',
              v_att.module_id);

      v_repriced := v_repriced + 1;
      if v_delta > 0 then v_charged := v_charged + v_delta;
      else v_refunded := v_refunded - v_delta; end if;
    end if;
  end loop;

  raise notice '5. Présences re-tarifées depuis le % : % ligne(s), % DA débités en plus, % DA rendus.',
    c_from, v_repriced, v_charged, v_refunded;
end $$;


-- ---------------------------------------------------------------------------
-- 6. LA PART DUE À L'ENSEIGNANT SUIT CE QUE L'ÉCOLE A ENCAISSÉ
--    À lancer EN DERNIER : les sections 4 et 5 ont bougé les montants des
--    présences, celle-ci les répercute sur ce qui reste à régler.
--    Aucune séance déjà réglée n'est touchée.
-- ---------------------------------------------------------------------------
do $$
declare
  v_removed int := 0;
  v_updated int := 0;
begin
  -- a) Séance qui ne rémunère personne : la ligne de rémunération n'a rien à
  --    faire là (créneau offert, période gratuite « sans rémunération »).
  delete from public.unpaid_teacher_sessions u
  where u.paid = false
    and exists (
      select 1
      from public.offered_rule(u.session_id, (timezone('Africa/Algiers', u.date))::date) r
      where not r.teacher_earns
    );
  get diagnostics v_removed = row_count;

  -- b) Les autres suivent exactement la valeur de la présence.
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

  raise notice '6. Séances dues : % retirée(s) (séance offerte), % remise(s) au bon montant.',
    v_removed, v_updated;
end $$;


-- ---------------------------------------------------------------------------
-- 7. CONTRÔLE FINAL — les trois compteurs doivent être à 0
-- ---------------------------------------------------------------------------
select
  (select count(*)
     from public.attendance a
     join lateral public.offered_rule(
       a.session_id, (timezone('Africa/Algiers', a.occurred_at))::date) r on true
    where r.offered and a.amount_deducted > 0)                    as offertes_encore_facturees,
  (select count(*)
     from public.unpaid_teacher_sessions u
    where u.paid = false
      and exists (select 1 from public.offered_rule(
            u.session_id, (timezone('Africa/Algiers', u.date))::date) r
          where not r.teacher_earns))                             as dues_sur_seances_offertes,
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
            * coalesce(t.percentage, 0) / 100.0)::int)            as dues_au_mauvais_montant;
