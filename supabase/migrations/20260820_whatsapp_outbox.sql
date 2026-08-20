-- =============================================================================
-- WhatsApp — file d'attente locale (outbox)
-- Run once against the live project (Supabase Dashboard -> SQL Editor).
--
-- Contexte : la passerelle WhatsApp est auto-hebergee sur un poste de l'ecole.
-- Ce poste eteint, en veille ou sans Internet, un envoi echouait purement et
-- simplement — l'utilisateur voyait une erreur et devait penser a recommencer
-- plus tard. Pour une alerte de solde declenchee par un scan de carte, personne
-- ne recommencait : le message etait perdu sans que quiconque le sache.
--
-- Cette table conserve les messages que la passerelle n'a pas pu prendre en
-- charge. Ils repartent tout seuls des qu'elle redevient joignable.
--
-- POURQUOI UNE TABLE DISTINCTE DE whatsapp_messages
-- -------------------------------------------------
-- whatsapp_messages est un JOURNAL : ce qui a ete confie a la passerelle, avec
-- son statut de remise. Il ne stocke meme pas le texte, puisqu'il n'a jamais eu
-- a le renvoyer. Une file d'attente a besoin du contraire : le texte complet, un
-- compteur de tentatives, et des lignes qui disparaissent une fois parties.
-- Melanger les deux rendrait le journal illisible et la reprise fragile.
--
-- Une ligne partie est marquee « sent » ET journalisee dans whatsapp_messages :
-- le suivi de remise (sent -> delivered -> read) reste au meme endroit que pour
-- un envoi direct.
--
-- Migration REJOUABLE sans erreur : `if not exists` partout.
-- =============================================================================

create table if not exists public.whatsapp_outbox (
  id uuid primary key default gen_random_uuid(),

  -- MSISDN normalise (chiffres, indicatif inclus, sans « + »), tel qu'il sera
  -- passe a la passerelle. Normalise DES la mise en file : un numero invalide
  -- doit etre refuse tout de suite, pas decouvert trois jours plus tard.
  recipient_phone text not null,
  -- forme lisible, pour l'interface ("+213 5 55 12 34 56")
  recipient_display text,
  recipient_name text,

  student_id uuid references public.students (id) on delete set null,
  parent_id uuid references public.parents (id) on delete set null,

  -- identifiant local du modele ("debt", "balance_low", ...) ou "text"
  message_type text not null default 'text',
  -- LE TEXTE A ENVOYER. C'est ce que whatsapp_messages ne conserve pas.
  body text not null,

  -- pending   : en attente, repartira au prochain vidage
  -- sent      : confie a la passerelle (journalise dans whatsapp_messages)
  -- abandoned : ne repartira plus (trop de tentatives, ou trop ancien)
  status text not null default 'pending',

  -- N'est incremente QUE sur un echec propre au destinataire (numero sans
  -- compte WhatsApp, refus de la passerelle). Une passerelle injoignable n'est
  -- pas la faute du message : elle ne consomme pas de tentative, sans quoi un
  -- week-end hors ligne epuiserait le compteur de toute la file.
  attempts integer not null default 0,
  last_error text,
  last_attempt_at timestamptz,

  created_at timestamptz not null default now(),
  sent_at timestamptz,
  abandoned_at timestamptz,
  abandoned_reason text
);

-- Le vidage lit toujours « les plus anciens en attente d'abord » : cet index
-- couvre exactement cette requete.
create index if not exists whatsapp_outbox_pending_idx
  on public.whatsapp_outbox (status, created_at);

create index if not exists whatsapp_outbox_student_id_idx
  on public.whatsapp_outbox (student_id);

-- ---------------------------------------------------------------------------
-- Row Level Security — personnel uniquement, comme le journal
-- ---------------------------------------------------------------------------
alter table public.whatsapp_outbox enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public'
       and tablename  = 'whatsapp_outbox'
       and policyname = 'whatsapp_outbox_all'
  ) then
    create policy whatsapp_outbox_all on public.whatsapp_outbox for all to authenticated
      using (public.is_staff()) with check (public.is_staff());
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Documentation
-- ---------------------------------------------------------------------------
comment on table public.whatsapp_outbox is
  'File d''attente des messages WhatsApp non partis faute de passerelle joignable. Videe automatiquement des que le poste qui heberge la passerelle revient en ligne.';

comment on column public.whatsapp_outbox.body is
  'Texte complet du message. Indispensable ici : whatsapp_messages ne le conserve pas, n''ayant jamais eu a renvoyer un message.';

comment on column public.whatsapp_outbox.status is
  'pending (repartira) | sent (confie a la passerelle, suivi dans whatsapp_messages) | abandoned (trop de tentatives, ou trop ancien).';

comment on column public.whatsapp_outbox.attempts is
  'Incremente uniquement sur un echec propre au destinataire. Une passerelle injoignable ne consomme pas de tentative.';

comment on column public.whatsapp_outbox.abandoned_reason is
  'Pourquoi le message ne repartira plus : « trop de tentatives » ou « trop ancien ». Un rappel de solde vieux de plusieurs jours peut etre devenu faux.';
