-- =============================================================================
-- WhatsApp — passage de l'API Cloud de Meta a Evolution API (auto-hebergee)
-- Run once against the live project (Supabase Dashboard -> SQL Editor).
--
-- Contexte : la messagerie WhatsApp quitte l'API Cloud officielle de Meta pour
-- Evolution API, une passerelle open source auto-hebergee qui pilote une vraie
-- session WhatsApp Web. Trois consequences sur le schema :
--
--   1. Le statut initial d'un message n'est plus « accepted » (terme Meta, qui
--      signifiait « accepte par Meta ») mais « queued » : la passerelle a pris
--      le message en charge, WhatsApp ne l'a pas encore accuse.
--
--   2. Il n'y a plus de modele approuve : template_name / template_language ne
--      sont plus alimentes. Les colonnes sont CONSERVEES pour ne pas perdre
--      l'historique Meta, mais elles resteront nulles desormais.
--
--   3. Nouvelles colonnes `provider` et `instance` : l'ecole peut vouloir
--      distinguer les messages d'epoque Meta de ceux d'Evolution, et brancher
--      un second numero (une seconde instance) plus tard.
--
-- Cette migration est REJOUABLE sans erreur ni corruption : la reexecuter ne
-- reetiquette pas des messages Evolution en « meta ».
--
-- Ne touche NI a whatsapp_contacts NI aux politiques RLS existantes.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Provenance du message : « meta » (historique) ou « evolution » (actuel)
-- ---------------------------------------------------------------------------
-- Ajoutee SANS defaut : les lignes deja presentes prennent donc NULL, ce qui
-- permet de les reconnaitre comme anterieures a la migration. C'est ce qui rend
-- l'operation rejouable — un `default 'evolution'` pose d'emblee aurait rendu
-- les anciennes lignes indiscernables des nouvelles.
alter table public.whatsapp_messages
  add column if not exists provider text;

update public.whatsapp_messages
  set provider = 'meta'
  where provider is null;

alter table public.whatsapp_messages
  alter column provider set default 'evolution';

alter table public.whatsapp_messages
  alter column provider set not null;

-- ---------------------------------------------------------------------------
-- 2. Instance Evolution ayant envoye le message
-- ---------------------------------------------------------------------------
alter table public.whatsapp_messages
  add column if not exists instance text;

-- ---------------------------------------------------------------------------
-- 3. Statut : « accepted » (Meta) devient « queued » (passerelle)
-- ---------------------------------------------------------------------------
update public.whatsapp_messages
  set status = 'queued'
  where status = 'accepted';

alter table public.whatsapp_messages
  alter column status set default 'queued';

create index if not exists whatsapp_messages_provider_idx
  on public.whatsapp_messages (provider);

-- ---------------------------------------------------------------------------
-- 4. Documentation des colonnes
-- ---------------------------------------------------------------------------
comment on table public.whatsapp_messages is
  'Journal des messages WhatsApp sortants. Statut mis a jour par le webhook de la passerelle.';

comment on column public.whatsapp_messages.message_id is
  'Identifiant du message rendu a l''envoi. UNIQUE : garantit l''idempotence face a un webhook livre plusieurs fois. Les lignes d''epoque Meta portent un wamid.';

comment on column public.whatsapp_messages.provider is
  'Transport utilise : « evolution » (passerelle auto-hebergee, actuel) ou « meta » (API Cloud, historique).';

comment on column public.whatsapp_messages.instance is
  'Nom de l''instance Evolution ayant envoye le message. Null pour les lignes d''epoque Meta.';

comment on column public.whatsapp_messages.status is
  'queued -> sent -> delivered -> read, ou failed. « queued » = pris en charge par la passerelle, pas encore remis.';

comment on column public.whatsapp_messages.template_name is
  'PLUS ALIMENTEE depuis le passage a Evolution API : il n''y a plus de modele approuve. Conservee pour l''historique Meta.';

comment on column public.whatsapp_messages.template_language is
  'PLUS ALIMENTEE depuis le passage a Evolution API. Conservee pour l''historique Meta.';

comment on table public.whatsapp_contacts is
  'Dernier message entrant par numero. Trace des familles qui ont repondu a l''ecole ; ne conditionne plus le droit d''ecrire.';
