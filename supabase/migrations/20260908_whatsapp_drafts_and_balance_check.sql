-- =============================================================================
-- 1. Une alerte de solde PROPOSE, elle n'envoie plus toute seule
-- 2. Contrôle (lecture seule) de l'intégrité des soldes
-- Run once against the live project (Supabase Dashboard -> SQL Editor).
--
-- ---------------------------------------------------------------------------
-- CE QUE CE SCRIPT CHANGE, ET CE QU'IL NE CHANGE PAS
-- ---------------------------------------------------------------------------
-- IL NE TOUCHE NI AUX SOLDES, NI AUX PRÉSENCES, NI À LA CAISSE. Aucune fiche
-- élève n'est modifiée, aucun dinar ne bouge. La seule table écrite est
-- `whatsapp_outbox`, et seulement pour changer le statut de messages qui ne
-- sont jamais partis.
--
-- La section 2 est un CONTRÔLE : elle lit, elle affiche, elle ne corrige rien.
--
-- Ce script est IDEMPOTENT : ré-exécutable sans risque.
--
-- ---------------------------------------------------------------------------
-- SECTION 1 — POURQUOI UN QUATRIÈME STATUT
-- ---------------------------------------------------------------------------
-- Jusqu'ici, une alerte de solde née d'un badge partait TOUTE SEULE : le scan
-- appelait la passerelle, et le message arrivait chez la famille sans que
-- personne à l'école n'ait lu le texte exact qui lui était écrit.
--
-- Quand la passerelle était éteinte, le message tombait en file « pending » et
-- un bandeau s'installait au bas de CHAQUE écran de l'application pour
-- annoncer un problème que personne ne pouvait résoudre depuis la page où il
-- s'affichait.
--
-- Le badge PROPOSE désormais, l'école DISPOSE. D'où un statut de plus :
--
--   draft     -- proposé, PAS approuvé. Le vidage automatique ne le regarde
--                pas. Il attend sur le tableau de bord qu'on le relise.
--   pending   -- approuvé par un humain, en attente de la passerelle. Celui-là
--                part tout seul dès qu'elle répond : c'est le seul état que le
--                vidage automatique fait avancer.
--   sent      -- confié à la passerelle (suivi dans whatsapp_messages).
--   abandoned -- ne repartira plus (écarté à la main, trop de tentatives, ou
--                trop ancien pour être encore vrai).
--
-- La colonne `status` est un `text` sans contrainte d'énumération : le nouveau
-- statut n'exige donc AUCUNE modification de schéma. Ce qui suit se limite à un
-- index, de la documentation, et la reprise des messages déjà en file.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1.1 L'index qui sert les deux files
-- ---------------------------------------------------------------------------
-- `whatsapp_outbox_pending_idx (status, created_at)` existe déjà et couvre
-- exactement « les plus anciens d'un statut donné » — la seule lecture que
-- font le vidage (status = pending) et le tableau de bord (status = draft).
-- Rien à ajouter ; on s'assure seulement qu'il est bien là sur un projet qui
-- aurait manqué la migration d'origine.
create index if not exists whatsapp_outbox_pending_idx
  on public.whatsapp_outbox (status, created_at);

-- ---------------------------------------------------------------------------
-- 1.2 LES MESSAGES DÉJÀ EN FILE
-- ---------------------------------------------------------------------------
-- Ils ont été mis en file par l'ANCIEN comportement : déposés automatiquement
-- par un badge, sans que personne ne les relise, et destinés à partir seuls au
-- retour de la passerelle.
--
-- Les laisser en « pending » les ferait partir dès le prochain retour de la
-- passerelle — c'est-à-dire exactement ce que ce lot de corrections vient
-- supprimer, et sur des messages qui peuvent avoir plusieurs jours. Ils
-- repassent donc en brouillon : ils s'afficheront sur le tableau de bord, et
-- c'est l'école qui décidera, message par message.
--
-- LA DATE EST FIXE, ET C'EST VOLONTAIRE. Avec un `now()`, une deuxième
-- exécution du script (un mois plus tard, par exemple) redescendrait en
-- brouillon des messages approuvés entre-temps par quelqu'un — `created_at` ne
-- bouge pas à l'approbation, ils seraient donc toujours « antérieurs à
-- maintenant ». Une borne figée au jour du correctif ne désigne que les
-- messages de l'ANCIEN comportement, et ne désignera jamais rien d'autre.
update public.whatsapp_outbox
   set status = 'draft'
 where status = 'pending'
   and created_at < timestamptz '2026-09-06 00:00:00+01';

-- ---------------------------------------------------------------------------
-- 1.3 Documentation
-- ---------------------------------------------------------------------------
comment on column public.whatsapp_outbox.status is
  'draft (propose par un badge, attend une relecture sur le tableau de bord — le vidage automatique ne le regarde PAS) | pending (approuve par un humain, partira seul des que la passerelle repond) | sent (confie a la passerelle, suivi dans whatsapp_messages) | abandoned (ecarte a la main, trop de tentatives, ou trop ancien).';

comment on table public.whatsapp_outbox is
  'File des messages WhatsApp. Deux attentes distinctes : « draft » attend un humain (rien ne part d''un badge sans relecture), « pending » attend seulement la passerelle et part tout seul a son retour.';

-- =============================================================================
-- SECTION 2 — CONTRÔLE DES SOLDES (LECTURE SEULE)
-- =============================================================================
-- LE SYMPTÔME QU'ON VIENT DE CORRIGER, ET QUI N'ÉTAIT PAS UN PROBLÈME DE BASE
--
--   Une fiche élève à +1250 DA annonçait « DETTE : 600 DA à régler ». Une
--   autre à +1875 DA annonçait « DETTE : 625 DA ». Au total, 41 élèves
--   parfaitement à jour étaient affichés comme débiteurs.
--
--   LA BASE N'Y ÉTAIT POUR RIEN. PostgREST plafonne toute réponse à 1000
--   lignes (`db-max-rows`) et ne le signale pas : la requête réussit, il
--   manque simplement des lignes. `balance_tx` a dépassé ce seuil (1117
--   lignes), et l'application s'est mise à travailler sur un historique
--   amputé de ses lignes les plus récentes — elle voyait des débits sans leurs
--   recettes, et l'écart accusait toujours l'élève. C'est aussi ce qui faisait
--   « disparaître » une recharge tout juste enregistrée.
--
--   Le correctif est côté application : la lecture est désormais paginée, et
--   tout recoupement est désactivé sur une table incomplète plutôt que faux.
--
-- LA REQUÊTE CI-DESSOUS CONTRÔLE l'invariant que toutes les RPC maintiennent :
--
--       students.balance = somme de ses balance_tx
--
-- Elle ne corrige rien. Si elle ne rend AUCUNE ligne, les soldes sont sains et
-- il n'y a rien à faire. Si elle en rend, la réparation existe déjà et
-- s'appelle :
--
--       select public.reconcile_student_balances(true);
--
-- (jouer d'abord `reconcile_student_balances(false)` pour voir ce qu'elle
-- changerait sans rien changer).
select st.first_name || ' ' || st.last_name           as eleve,
       st.balance                                     as solde_stocke,
       coalesce(tx.total, 0)                          as somme_historique,
       coalesce(tx.total, 0) - st.balance             as ecart,
       st.registration_due                            as frais_dus
  from public.students st
  left join (
    select student_id, sum(amount) as total
      from public.balance_tx
     group by student_id
  ) tx on tx.student_id = st.id
 where st.balance is distinct from coalesce(tx.total, 0)
 order by abs(coalesce(tx.total, 0) - st.balance) desc;

-- =============================================================================
-- SECTION 3 — VÉRIFICATION
-- =============================================================================
-- `brouillons` : les alertes qui attendent une relecture sur le tableau de
-- bord. `approuves` : celles qui partiront toutes seules au retour de la
-- passerelle — normalement 0 juste après ce script.
select
  count(*) filter (where status = 'draft')     as brouillons,
  count(*) filter (where status = 'pending')   as approuves,
  count(*) filter (where status = 'sent')      as envoyes,
  count(*) filter (where status = 'abandoned') as ecartes
from public.whatsapp_outbox;

-- Combien d'élèves doivent RÉELLEMENT quelque chose à l'école. C'est le seul
-- chiffre que la fiche élève et le tableau de bord doivent afficher.
select count(*) filter (where balance < 0)                     as en_dette_de_seances,
       count(*) filter (where coalesce(registration_due, 0) > 0) as inscription_due,
       coalesce(sum(greatest(-balance, 0)), 0)
         + coalesce(sum(greatest(registration_due, 0)), 0)     as total_a_recouvrer
  from public.students;
