-- =============================================================================
-- Séances libres OFFERTES au niveau du CRÉNEAU (planning)
-- Run once against the live project (Supabase Dashboard -> SQL Editor).
--
-- Jusqu'ici « offerte » se cochait présence par présence sur l'écran Séances
-- Libres. On peut désormais cocher tout un créneau de séance libre comme
-- « offert » au moment où on le crée sur le Planner :
--   * chaque présence enregistrée dessus est automatiquement offerte,
--   * l'école n'encaisse rien, le solde de l'élève n'est jamais débité,
--   * l'enseignant n'est PAS rémunéré sur ce créneau.
--
-- Ce que chaque séance aurait coûté (`open_price`) reste la valeur que les
-- rapports affichent comme « séances offertes », exactement comme la case
-- « offerte » de l'écran Séances Libres le fait déjà (colonne
-- independent_sessions.waived_amount, migration 20260819_free_casual_sessions).
--
-- Ce script est IDEMPOTENT : ré-exécutable sans risque.
-- =============================================================================

alter table public.sessions
  add column if not exists is_free boolean not null default false;

-- L'API REST garde le schéma en cache : sans ce rechargement, l'enregistrement
-- d'un créneau offert peut encore répondre « column not found ».
notify pgrst, 'reload schema';
