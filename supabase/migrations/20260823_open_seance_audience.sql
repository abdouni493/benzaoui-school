-- =============================================================================
-- Public d'un créneau de SÉANCE LIBRE
-- Run once against the live project (Supabase Dashboard -> SQL Editor).
--
-- Les classes, les groupes et l'enseignant cochés à la création d'un créneau ne
-- décrivaient que le créneau : au guichet, N'IMPORTE quel élève pouvait être
-- encaissé dessus, y compris un élève d'une autre filière. Le créneau porte
-- désormais son public, choisi sur l'Emploi du Temps :
--
--   * 'enrolled' — seuls les élèves dont l'emploi du temps passe par les
--                  classes ET les groupes cochés ;
--   * 'filiere'  — tout élève d'une classe de la même filière, même s'il suit
--                  un autre groupe ou un autre emploi du temps.
--
-- NULL = créneau créé avant le réglage : aucune restriction n'est appliquée,
-- l'écran Séances Libres continue de tout accepter, exactement comme avant.
-- Les passagers ne sont jamais concernés : ils n'ont ni classe ni filière, et
-- la séance libre existe précisément pour les encaisser.
--
-- Ce script est IDEMPOTENT : ré-exécutable sans risque.
-- =============================================================================

alter table public.sessions
  add column if not exists open_audience text;

-- La contrainte est ajoutée à part : `add column if not exists` ne rejoue pas
-- son `check` quand la colonne est déjà là.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'sessions_open_audience_check'
  ) then
    alter table public.sessions
      add constraint sessions_open_audience_check
      check (open_audience is null or open_audience in ('enrolled', 'filiere'));
  end if;
end $$;

comment on column public.sessions.open_audience is
  'Séance libre : public autorisé au guichet (enrolled = classes et groupes cochés, filiere = toute la filière, NULL = aucune restriction).';

-- L'API REST garde le schéma en cache : sans ce rechargement, l'enregistrement
-- d'un créneau peut encore répondre « column not found ».
notify pgrst, 'reload schema';
