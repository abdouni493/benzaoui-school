-- =============================================================================
-- REMBOURSEMENT des séances retirées du solde à cause des absences
-- À exécuter UNE fois sur le projet en ligne (Supabase Dashboard -> SQL Editor).
--
-- Objectif (client) : remettre dans le solde (« sold ») de CHAQUE élève tout
-- l'argent qui lui a été retiré au titre d'une absence — rien d'autre n'est
-- touché.
--
-- Comment on reconnaît ces retraits, sans risque de double remboursement :
--   Chaque absence facturée a écrit UNE ligne dans public.balance_tx dont la
--   description commence par « Absence hebdomadaire » (facturation automatique
--   ET saisie manuelle). Le montant y est NÉGATIF (le débit réellement appliqué
--   au solde). Si une absence avait déjà été annulée, sa ligne avait été
--   SUPPRIMÉE et le solde recrédité à ce moment-là : il ne reste donc que les
--   lignes encore « debout ». On se base sur ces lignes (et non sur la table
--   absence_penalties) : c'est exactement l'argent encore manquant.
--
-- Ce que fait ce script, de façon atomique (tout ou rien) :
--   1. calcule, par élève, la somme des débits d'absence encore présents ;
--   2. recrédite ce montant au solde de l'élève (public.students.balance) ;
--   3. SUPPRIME ces lignes « Absence hebdomadaire » du relevé (le solde et son
--      historique redeviennent cohérents — c'est ce que fait déjà l'app quand
--      on annule une absence) ;
--   4. remet à 0 le montant des enregistrements d'absence (absence_penalties)
--      afin que les absences restent VISIBLES dans « Présences » mais sans
--      aucune somme associée.
--
-- Rien d'autre n'est modifié : ni les paiements, ni les présences, ni les
-- inscriptions, ni les élèves eux-mêmes.
--
-- Le bloc est encadré par un garde-fou : il AFFICHE un récapitulatif avant /
-- après. Relisez-le ; si un total vous surprend, un simple ROLLBACK (ou la
-- fermeture de l'onglet avant COMMIT) annule tout.
-- =============================================================================

begin;

-- --- 0. Photo AVANT -----------------------------------------------------------
-- (lecture seule : combien d'argent et combien d'élèves sont concernés)
select
  count(*)                                   as lignes_absence,
  count(distinct student_id)                 as eleves_concernes,
  coalesce(sum(-amount), 0)                  as total_a_rembourser_da
from public.balance_tx
where description like 'Absence hebdomadaire%';

-- --- 1. Montant à recréditer, par élève --------------------------------------
create temporary table _absence_refunds on commit drop as
select student_id,
       sum(-amount)::int as refund      -- -amount : le débit était négatif
from public.balance_tx
where description like 'Absence hebdomadaire%'
group by student_id
having sum(-amount) <> 0;

-- --- 2. Recréditer le solde de chaque élève ----------------------------------
update public.students s
   set balance = s.balance + r.refund
  from _absence_refunds r
 where s.id = r.student_id;

-- --- 3. Retirer les lignes de débit d'absence du relevé ----------------------
delete from public.balance_tx
 where description like 'Absence hebdomadaire%';

-- --- 4. Garder la trace de l'absence, sans montant ---------------------------
--      (les absences restent visibles dans « Présences », mais à 0 DA)
update public.absence_penalties ap
   set amount = 0,
       balance_after = s.balance
  from public.students s
 where s.id = ap.student_id
   and ap.amount <> 0;

-- --- 5. Photo APRÈS -----------------------------------------------------------
select
  (select count(*) from _absence_refunds)                                as eleves_rembourses,
  (select coalesce(sum(refund), 0) from _absence_refunds)                as total_rembourse_da,
  (select count(*) from public.balance_tx
     where description like 'Absence hebdomadaire%')                     as lignes_absence_restantes;  -- doit être 0

-- Tout est correct ? Validez :
commit;

-- Sinon, AVANT le commit (remplacez commit; par) :
-- rollback;
