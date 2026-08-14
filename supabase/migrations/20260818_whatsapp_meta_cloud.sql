-- =============================================================================
-- WhatsApp Cloud API (Meta) — journal des messages + fenêtre de service client
-- Run once against the live project (Supabase Dashboard -> SQL Editor).
--
-- Contexte : la messagerie WhatsApp passe de l'ancienne passerelle auto-hébergée
-- à l'API Cloud officielle de Meta. Deux besoins nouveaux, propres à Meta :
--
--   1. whatsapp_messages — journal d'envoi. Meta n'accuse la remise qu'ensuite,
--      de façon asynchrone, via le webhook (sent -> delivered -> read | failed).
--      On mémorise donc chaque message et on met son statut à jour au fil des
--      événements. L'identifiant Meta (wamid) sert de clé d'idempotence : un
--      webhook livré deux fois ne crée pas de doublon.
--
--   2. whatsapp_contacts — dernier message ENTRANT par numéro. Un message libre
--      (texte hors modèle) n'est autorisé par Meta que dans la fenêtre de
--      service client de 24 h, c.-à-d. si la famille a écrit à l'école
--      récemment. Cette table matérialise cette fenêtre à partir des messages
--      entrants remontés par le webhook — aucun minuteur local fictif.
--
-- RLS : lecture/écriture réservées au personnel (admin/réception), comme le
-- registre financier. Les écritures applicatives passent par le client
-- service_role (webhook + route d'envoi), qui contourne la RLS de toute façon.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Journal des messages sortants
-- ---------------------------------------------------------------------------
create table if not exists public.whatsapp_messages (
  id uuid primary key default gen_random_uuid(),
  recipient_phone text not null,
  recipient_name text,
  student_id uuid references public.students (id) on delete set null,
  parent_id uuid references public.parents (id) on delete set null,
  -- identifiant local du modèle ("debt", "balance_low", …) ou "text" pour un libre
  message_type text not null,
  -- nom du modèle approuvé côté Meta (null pour un message texte)
  template_name text,
  template_language text,
  -- wamid renvoyé par Meta à l'acceptation ; clé d'idempotence des webhooks
  message_id text unique,
  -- accepted | sent | delivered | read | failed
  status text not null default 'accepted',
  error_code text,
  error_message text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  failed_at timestamptz
);

create index if not exists whatsapp_messages_student_id_idx on public.whatsapp_messages (student_id);
create index if not exists whatsapp_messages_parent_id_idx on public.whatsapp_messages (parent_id);
create index if not exists whatsapp_messages_status_idx on public.whatsapp_messages (status);
create index if not exists whatsapp_messages_created_at_idx on public.whatsapp_messages (created_at desc);

comment on table public.whatsapp_messages is
  'Journal des messages WhatsApp sortants (API Cloud Meta). Statut mis à jour par le webhook.';
comment on column public.whatsapp_messages.message_id is
  'wamid Meta. UNIQUE : garantit l''idempotence face à un webhook livré plusieurs fois.';

-- ---------------------------------------------------------------------------
-- 2. Fenêtre de service client (dernier message entrant par numéro)
-- ---------------------------------------------------------------------------
create table if not exists public.whatsapp_contacts (
  -- MSISDN en chiffres, indicatif inclus, sans "+" (ex. "213555123456")
  phone text primary key,
  last_inbound_at timestamptz,
  last_inbound_wamid text,
  updated_at timestamptz not null default now()
);

comment on table public.whatsapp_contacts is
  'Dernier message entrant par numéro : matérialise la fenêtre de service client de 24 h de Meta.';

-- ---------------------------------------------------------------------------
-- 3. Row Level Security — personnel uniquement (comme le registre financier)
-- ---------------------------------------------------------------------------
alter table public.whatsapp_messages enable row level security;
alter table public.whatsapp_contacts enable row level security;

create policy whatsapp_messages_all on public.whatsapp_messages for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

create policy whatsapp_contacts_all on public.whatsapp_contacts for all to authenticated
  using (public.is_staff()) with check (public.is_staff());
