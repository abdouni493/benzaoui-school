-- =============================================================================
-- Deuxième frais d'inscription
-- Run once against the live project (Supabase Dashboard -> SQL Editor).
--
-- L'école ne facturait qu'un seul frais d'inscription (`school.registration_fee`),
-- appliqué d'office à la première inscription. Elle en propose désormais DEUX :
-- la réception choisit, à la création de l'étudiant, lequel des deux (ou aucun)
-- lui est facturé, et si ce frais est encaissé tout de suite ou laissé en dette.
--
-- Chaque tarif peut être nommé (« Inscription annuelle », « Semestrielle »…) :
-- c'est ce nom que la réception voit dans le sélecteur de la fiche étudiant.
-- Un tarif laissé à 0 n'est jamais proposé.
--
-- Rien à migrer côté étudiants : `students.registration_due` continue de porter
-- le montant dû, quel que soit le tarif choisi.
--
-- Ce script est IDEMPOTENT : ré-exécutable sans risque.
-- =============================================================================

alter table public.school add column if not exists registration_fee_label text;
alter table public.school add column if not exists registration_fee_2 integer not null default 0;
alter table public.school add column if not exists registration_fee_2_label text;
