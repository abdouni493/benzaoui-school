-- =============================================================================
-- « Le scan enregistre la présence mais ne débite pas le solde »
--
-- Ce fichier n'est PAS une migration : il ne crée rien, ne modifie rien tant
-- qu'on n'a pas décommenté la section 5. Il répond à une seule question —
-- pourquoi une présence a-t-elle coûté 0 DA ?
--
-- À lancer dans Supabase Dashboard -> SQL Editor.
--
-- Trois réglages, tous volontaires, mettent une séance à 0 DA. Ils sont la
-- cause de la quasi-totalité des « pannes de facturation » signalées :
--
--   1. une PÉRIODE GRATUITE couvre la classe ce jour-là ;
--   2. le CRÉNEAU est coché « séance libre offerte » (sessions.is_free) ;
--   3. l'inscription de l'élève a une DATE DE DÉBUT DE FACTURATION encore à
--      venir (student_subscriptions.start_date) ;
--   (+ l'élève lui-même peut être marqué gratuit : students.is_free.)
--
-- Dans les trois cas la présence est écrite normalement et le prix non
-- facturé est conservé dans attendance.waived_amount — rien n'est perdu.
-- =============================================================================


-- ---------------------------------------------------------------------------
-- 1. Les 50 dernières présences, avec la RAISON de leur gratuité
--    Colonne `raison` : 'FACTUREE' = tout va bien. Les autres nomment le
--    réglage à changer.
-- ---------------------------------------------------------------------------
select
  (timezone('Africa/Algiers', a.occurred_at))::date as jour,
  to_char(timezone('Africa/Algiers', a.occurred_at), 'HH24:MI')  as heure,
  s.last_name || ' ' || s.first_name                             as eleve,
  m.name                                                         as module,
  a.amount_deducted                                              as debite,
  a.waived_amount                                                as offert,
  case
    when a.amount_deducted > 0        then 'FACTUREE'
    when a.free_period_id is not null then 'periode gratuite'
    when a.pre_start                  then 'inscription pas encore commencee'
    when se.is_free                   then 'creneau offert (sessions.is_free)'
    when s.is_free                    then 'eleve gratuit (students.is_free)'
    else                                   'tarif du creneau a 0 DA'
  end                                                            as raison
from public.attendance a
join public.students s  on s.id  = a.student_id
join public.sessions se on se.id = a.session_id
left join public.modules m on m.id = se.module_id
order by a.occurred_at desc
limit 50;


-- ---------------------------------------------------------------------------
-- 2. Les périodes gratuites qui suspendent la facturation
--    `porte_aujourdhui` = true : AUCUN scan ne débite quoi que ce soit
--    aujourd'hui sur les classes couvertes.
-- ---------------------------------------------------------------------------
select
  fp.id,
  fp.name                       as nom,
  fp.start_date                 as debut,
  fp.end_date                   as fin,
  fp.active                     as activee,
  fp.all_classes                as toutes_classes,
  coalesce(array_length(fp.class_ids, 1), 0) as nb_classes,
  fp.pay_teachers               as enseignants_payes,
  (fp.active
    and (now() at time zone 'Africa/Algiers')::date between fp.start_date and fp.end_date
  )                             as porte_aujourdhui
from public.free_periods fp
order by fp.start_date desc;


-- ---------------------------------------------------------------------------
-- 3. Les inscriptions dont la facturation n'a pas encore commencé
--    Tant que `debut_facturation` est dans le futur, chaque scan de cet élève
--    sur ce créneau est enregistré « AVANT LE DÉBUT » et ne débite rien.
-- ---------------------------------------------------------------------------
select
  st.last_name || ' ' || st.first_name as eleve,
  m.name                               as module,
  g.name                               as groupe,
  ss.start_date                        as debut_facturation,
  (ss.start_date - (now() at time zone 'Africa/Algiers')::date) as jours_restants
from public.student_subscriptions ss
join public.students st  on st.id = ss.student_id
join public.subscriptions sub on sub.id = ss.subscription_id
join public.sessions se  on se.id = sub.session_id
left join public.modules m on m.id = se.module_id
left join public.groups  g on g.id = se.group_id
where ss.start_date > (now() at time zone 'Africa/Algiers')::date
order by ss.start_date;


-- ---------------------------------------------------------------------------
-- 4. Les créneaux cochés « séance libre offerte »
-- ---------------------------------------------------------------------------
select se.id, se.title, se.start_time, se.end_time, se.period_start, se.period_end
from public.sessions se
where se.is_free
order by se.period_start nulls first;


-- ---------------------------------------------------------------------------
-- 5. RÉTABLIR LA FACTURATION — décommenter SEULEMENT ce qu'on veut vraiment
--
--    Ces trois commandes MODIFIENT les données. Chacune correspond à une
--    décision de gestion, pas à une réparation technique : n'exécuter que
--    celle qui correspond à l'intention de l'école.
--
--    Tout se fait aussi depuis l'application, sans SQL :
--      · Abonnements -> Périodes gratuites  (désactiver la période)
--      · Fiche élève -> Inscriptions        (avancer la date de début)
--      · Emploi du temps -> le créneau      (décocher « offerte »)
--
--    Ces commandes ne retouchent AUCUNE présence déjà écrite : le passé
--    reste tel qu'il a été encaissé. Elles ne changent que la suite.
-- ---------------------------------------------------------------------------

-- 5a. Suspendre une période gratuite (garde son historique, contrairement à
--     un delete). Remplacer le nom par celui vu en section 2.
-- update public.free_periods
--    set active = false
--  where name = 'Semaine porte ouverte';

-- 5b. Faire commencer la facturation aujourd'hui pour les inscriptions encore
--     à venir. À ne PAS lancer si ces dates sont voulues (préinscriptions).
-- update public.student_subscriptions
--    set start_date = (now() at time zone 'Africa/Algiers')::date
--  where start_date > (now() at time zone 'Africa/Algiers')::date;

-- 5c. Rendre payant un créneau coché « offert ».
-- update public.sessions
--    set is_free = false
--  where id = 'COLLER-ICI-L-ID-VU-EN-SECTION-4';


-- ---------------------------------------------------------------------------
-- 6. Contrôle : la rémunération enseignant suit-elle bien les présences ?
--    Une ligne par présence facturable, `paid = false` tant qu'elle n'a pas
--    été réglée depuis Enseignants -> Règlement. Un créneau offert n'en
--    produit AUCUNE, volontairement : personne n'encaisse cette séance.
-- ---------------------------------------------------------------------------
select
  t.last_name || ' ' || t.first_name as enseignant,
  count(*)                            as seances,
  sum(u.amount)                       as total_du,
  count(*) filter (where u.paid)      as deja_reglees
from public.unpaid_teacher_sessions u
join public.teachers t on t.id = u.teacher_id
group by 1
order by 3 desc nulls last;
