-- =============================================================================
-- Séances libres OFFERTES (gratuites)
-- Run once against the live project (Supabase Dashboard -> SQL Editor).
--
-- Une séance libre pouvait seulement être encaissée. La réception peut
-- désormais la cocher « offerte » au moment où elle choisit le cours :
--   * l'école n'encaisse rien (aucune ligne de caisse),
--   * le solde de l'élève inscrit n'est pas débité,
--   * l'enseignant n'est PAS rémunéré sur cette séance.
--
-- La séance est malgré tout enregistrée comme les autres — présence, créneau,
-- date — avec `price = 0`. Ce que la séance aurait coûté est conservé dans
-- `waived_amount` : c'est ce montant que les rapports affichent comme « valeur
-- des séances offertes », exactement comme `attendance.waived_amount` le fait
-- déjà pour les périodes gratuites.
--
-- Ce script est IDEMPOTENT : ré-exécutable sans risque.
-- =============================================================================

alter table public.independent_sessions
  add column if not exists is_free boolean not null default false,
  add column if not exists waived_amount integer not null default 0;

-- Les rapports filtrent sur ce drapeau pour séparer recette et gratuité.
create index if not exists independent_sessions_is_free_idx
  on public.independent_sessions (is_free);

-- L'API REST garde le schéma en cache : sans ce rechargement, l'enregistrement
-- d'une séance offerte peut encore répondre « column not found ».
notify pgrst, 'reload schema';
