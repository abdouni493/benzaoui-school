-- =============================================================================
-- « Combien doit-on à CET enseignant ? » — VÉRIFICATION, LECTURE SEULE
--
-- À lancer dans Supabase Dashboard -> SQL Editor. Ce fichier ne contient QUE
-- des SELECT : il ne crée, ne modifie et ne supprime RIEN. Aucune migration
-- n'est nécessaire pour la correction du 02/10/2026 — le calcul se fait dans
-- l'écran de règlement.
--
-- Il refait, à partir de la base, le calcul de l'écran « Règlement » :
--
--   part = Σ (tarif réellement payé × % de l'enseignant), au centime,
--          arrondie au dinar UNE seule fois, sur le total.
--
-- et le compare à l'ancien calcul, qui arrondissait présence par présence
-- (438 DA au lieu de 437,5 à 70 % d'une séance à 625 DA) et oubliait les
-- passagers dans « X DA dus ».
--
-- Ce qui est compté, exactement comme l'écran :
--   · les séances dues NON réglées (unpaid_teacher_sessions.paid = false),
--     au tarif ACTUEL du créneau, remise de l'élève comprise ;
--   · moins les séances OFFERTES : créneau coché « offert », ou période
--     gratuite « sans rémunération des enseignants » ;
--   · plus les séances libres encaissées au guichet sur ses créneaux
--     (passagers), au taux de l'enseignant — ou à leur propre taux quand le
--     guichet en a posé un.
--
-- Changer le nom ci-dessous pour vérifier un autre enseignant.
-- =============================================================================

with prof as (
  select t.id, trim(t.first_name) || ' ' || trim(t.last_name) as nom,
         least(greatest(coalesce(t.percentage, 0), 0), 100) as pct
  from public.teachers t
  where lower(trim(t.first_name) || ' ' || trim(t.last_name)) like '%amine%mohamed%'
),
-- Le tarif courant d'un créneau (un abonnement par créneau dans les faits).
tarif as (
  select distinct on (s.session_id) s.session_id, s.id as subscription_id, s.price_per_session
  from public.subscriptions s
  order by s.session_id, s.id
),
-- Les présences badgées encore dues, au tarif ACTUEL de l'élève.
dues as (
  select p.id as teacher_id, u.session_id,
         greatest(0,
           coalesce(ta.price_per_session, u.amount)
           - case
               when ss.discount_value > 0 and ss.discount_type = 'percent'
                 then round(coalesce(ta.price_per_session, 0)
                            * least(greatest(ss.discount_value, 0), 100) / 100.0)
               when ss.discount_value > 0
                 then greatest(ss.discount_value, 0)
               else 0
             end
         )::numeric as tarif_paye,
         u.amount as ancienne_part
  from prof p
  join public.unpaid_teacher_sessions u on u.teacher_id = p.id and u.paid = false
  join public.sessions se on se.id = u.session_id
  left join tarif ta on ta.session_id = u.session_id
  left join public.student_subscriptions ss
         on ss.student_id = u.student_id and ss.subscription_id = ta.subscription_id
  where coalesce(se.is_free, false) = false
    and not exists (
      select 1
      from public.attendance a
      join public.free_periods fp on fp.id = a.free_period_id
      where a.student_id = u.student_id
        and a.session_id = u.session_id
        and (timezone('Africa/Algiers', a.occurred_at))::date
            = (timezone('Africa/Algiers', u.date))::date
        and fp.pay_teachers = false
    )
),
-- Les séances libres (passagers) de ses créneaux, pas encore réglées.
libres as (
  select p.id as teacher_id, i.session_id, i.price::numeric as tarif_paye,
         i.teacher_percentage
  from prof p
  join public.sessions se on se.teacher_id = p.id and coalesce(se.is_free, false) = false
  join public.independent_sessions i on i.session_id = se.id
  where i.teacher_paid = false
    and coalesce(i.is_free, false) = false
    -- un élève inscrit déjà compté par son badge ne l'est pas deux fois
    and not (
      i.student_id is not null
      and exists (
        select 1 from public.unpaid_teacher_sessions u
        where u.teacher_id = p.id and u.paid = false
          and u.student_id = i.student_id and u.session_id = i.session_id
          and (timezone('Africa/Algiers', u.date))::date = i.date
      )
    )
),
par_cours as (
  select se.id as session_id,
         m.name || ' — ' || c.name || ' / ' || g.name || ' ' || se.start_time as emploi_du_temps,
         p.nom, p.pct,
         (select count(*) from dues d where d.session_id = se.id)                     as eleves_badges,
         (select count(*) from libres l where l.session_id = se.id
                                         and l.teacher_percentage is null)            as passagers,
         (select coalesce(sum(d.tarif_paye), 0) from dues d where d.session_id = se.id)
         + (select coalesce(sum(l.tarif_paye), 0) from libres l
             where l.session_id = se.id and l.teacher_percentage is null)            as encaisse,
         (select coalesce(sum(l.tarif_paye * least(greatest(l.teacher_percentage, 0), 100) / 100.0), 0)
            from libres l where l.session_id = se.id and l.teacher_percentage is not null)
                                                                                      as part_libres_taux_dedie,
         (select coalesce(sum(d.ancienne_part), 0) from dues d where d.session_id = se.id)
                                                                                      as ancien_dus_badges
  from prof p
  join public.sessions se on se.teacher_id = p.id
  join public.modules m on m.id = se.module_id
  join public.classes c on c.id = se.class_id
  join public.groups  g on g.id = se.group_id
)
-- 1. Une ligne par emploi du temps — ce que montre le tableau de l'étape 2.
select nom as enseignant,
       emploi_du_temps,
       eleves_badges,
       passagers,
       encaisse                                                as encaisse_da,
       pct                                                     as pourcentage,
       round(encaisse * pct / 100.0 + part_libres_taux_dedie, 2) as part_exacte_da,
       ancien_dus_badges                                       as ancien_affichage_dus_da
from par_cours
where eleves_badges + passagers > 0 or part_libres_taux_dedie > 0
order by part_exacte_da desc;

-- 2. Le total — ce que l'écran verse (avant acomptes / retenues).
with prof as (
  select t.id, trim(t.first_name) || ' ' || trim(t.last_name) as nom
  from public.teachers t
  where lower(trim(t.first_name) || ' ' || trim(t.last_name)) like '%amine%mohamed%'
)
select p.nom as enseignant,
       (select coalesce(sum(a.amount), 0) from public.teacher_acomptes a
         where a.staff_id = p.id and a.payment_id is null)  as acomptes_en_attente_da,
       (select coalesce(sum(b.cost), 0) from public.teacher_absences b
         where b.staff_id = p.id and b.payment_id is null)  as retenues_en_attente_da
from prof p;
-- Le TOTAL à verser = somme de « part_exacte_da » du résultat 1, arrondie au
-- dinar, moins les acomptes et retenues ci-dessus. Pour Amine Mohamed, sur la
-- sauvegarde du 01/10/2026 : 96 897,5 → 96 898 DA brut, − 6 000 DA d'acompte
-- = 90 898 DA nets (l'écran annonçait 97 006 DA brut, soit 108 DA de trop).
