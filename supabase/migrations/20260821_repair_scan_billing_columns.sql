-- =============================================================================
-- Réparation : colonnes manquantes qui font échouer le SCAN des élèves
-- Run once against the live project (Supabase Dashboard -> SQL Editor).
--
-- Symptômes corrigés :
--   « scan_card failed: column "module_id" of relation "balance_tx" does not
--     exist » -> POST /rest/v1/rpc/scan_card renvoie 400 à chaque badge.
--   Le même 400 frappe /rest/v1/rpc/process_weekly_absences, appelé juste avant
--     le scan : la facturation hebdomadaire des absences ne passe plus non plus.
--   Une séance libre cochée « offerte » est enregistrée comme payante (le
--     drapeau est silencieusement retiré de l'écriture par la tolérance de
--     schéma de lib/store/data.ts).
--
-- Cause : la base en ligne a reçu les migrations récentes mais PAS
--   · 20260708 §1 -> balance_tx.module_id
--   · 20260819_free_casual_sessions -> independent_sessions.is_free /
--     .waived_amount
-- alors que scan_card et process_weekly_absences, elles, sont à jour et
-- écrivent déjà `module_id` sur chaque débit. L'INSERT échoue, la transaction
-- entière est annulée : aucune présence n'est pointée.
--
-- Ce script est IDEMPOTENT : ré-exécutable sans risque même si une partie était
-- déjà appliquée. Il ne touche à aucune fonction — uniquement aux colonnes que
-- le code attend — puis dresse en fin de script l'inventaire de ce qui
-- manquerait encore.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. balance_tx.module_id — le module facturé par le débit
--    Débits de séance (scan + présence manuelle), remboursements d'annulation
--    et facturation d'absence y attachent le module concerné : c'est ce qui
--    permet à la fiche élève de ventiler l'historique du solde par module.
--    Les lignes antérieures restent à NULL (elles sont rattachées par libellé).
-- ---------------------------------------------------------------------------
alter table public.balance_tx
  add column if not exists module_id uuid references public.modules (id) on delete set null;

create index if not exists balance_tx_module_id_idx on public.balance_tx (module_id);

-- ---------------------------------------------------------------------------
-- 2. independent_sessions.is_free / .waived_amount — séance libre offerte
--    is_free       : rien n'est encaissé, l'enseignant n'est pas rémunéré.
--    waived_amount : le prix qui aurait été payé, pour que les rapports
--                    chiffrent la gratuité au lieu de la perdre.
-- ---------------------------------------------------------------------------
alter table public.independent_sessions
  add column if not exists is_free boolean not null default false,
  add column if not exists waived_amount integer not null default 0;

create index if not exists independent_sessions_is_free_idx
  on public.independent_sessions (is_free);

-- ---------------------------------------------------------------------------
-- 3. Rechargement du cache de schéma de l'API REST
--    Sans lui, PostgREST continue de répondre « column not found » sur les
--    colonnes qui viennent d'être créées.
-- ---------------------------------------------------------------------------
notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- 4. Inventaire : que manque-t-il ENCORE par rapport à ce que le code attend ?
--    Le résultat de ce script doit être VIDE. Chaque ligne renvoyée nomme un
--    objet absent et le fichier de migration à repasser pour le poser.
-- ---------------------------------------------------------------------------
with expected_tables (table_name, migration) as (values
  ('absence_penalties',    '20260711_weekly_absence_penalties'),
  ('student_credentials',  '20260810_open_seances_reductions_workers'),
  ('teacher_payments',     '20260810_open_seances_reductions_workers'),
  ('module_absence_rules', '20260810_open_seances_reductions_workers'),
  ('worker_shifts',        '20260818_repair_reception_worker_columns'),
  ('free_periods',         '20260816_free_periods'),
  ('whatsapp_messages',    '20260818_whatsapp_meta_cloud'),
  ('whatsapp_contacts',    '20260818_whatsapp_meta_cloud'),
  ('whatsapp_outbox',      '20260820_whatsapp_outbox')
),
expected_columns (table_name, column_name, migration) as (values
  ('subscriptions',         'level_price',              '20260704_formation_subscriptions'),
  ('subscriptions',         'period_months',            '20260704_formation_subscriptions'),
  ('student_subscriptions', 'start_date',               '20260704_formation_subscriptions'),
  ('student_subscriptions', 'expiry_date',              '20260704_formation_subscriptions'),
  ('balance_tx',            'module_id',                '20260708_open_scan_rules_workers'),
  ('school',                'absence_penalty_enabled',  '20260711_weekly_absence_penalties'),
  ('school',                'absence_penalty_since',    '20260711_weekly_absence_penalties'),
  ('school',                'absence_penalty_last_run', '20260711_weekly_absence_penalties'),
  ('student_subscriptions', 'discount_type',            '20260810_open_seances_reductions_workers'),
  ('student_subscriptions', 'discount_value',           '20260810_open_seances_reductions_workers'),
  ('sessions',              'is_open',                  '20260810_open_seances_reductions_workers'),
  ('sessions',              'title',                    '20260810_open_seances_reductions_workers'),
  ('sessions',              'period_start',             '20260810_open_seances_reductions_workers'),
  ('sessions',              'period_end',               '20260810_open_seances_reductions_workers'),
  ('sessions',              'class_ids',                '20260810_open_seances_reductions_workers'),
  ('sessions',              'group_ids',                '20260810_open_seances_reductions_workers'),
  ('sessions',              'salle_ids',                '20260810_open_seances_reductions_workers'),
  ('sessions',              'open_price',               '20260810_open_seances_reductions_workers'),
  ('teachers',              'is_passager',              '20260810_open_seances_reductions_workers'),
  ('independent_sessions',  'session_id',               '20260810_open_seances_reductions_workers'),
  ('independent_sessions',  'created_at',               '20260810_open_seances_reductions_workers'),
  ('independent_sessions',  'start_time',               '20260810_open_seances_reductions_workers'),
  ('independent_sessions',  'end_time',                 '20260810_open_seances_reductions_workers'),
  ('independent_sessions',  'teacher_paid',             '20260810_open_seances_reductions_workers'),
  ('announcements',         'target_group_ids',         '20260810_open_seances_reductions_workers'),
  ('announcements',         'include_parents',          '20260810_open_seances_reductions_workers'),
  ('attendance',            'substitute_group',         '20260815_group_pricing_crossgroup_scan_absences'),
  ('school',                'absence_week_start_day',   '20260815_group_pricing_crossgroup_scan_absences'),
  ('attendance',            'free_period_id',           '20260816_free_periods'),
  ('attendance',            'waived_amount',            '20260816_free_periods'),
  ('student_subscriptions', 'subscribed_at',            '20260817_enrollment_dates_pre_start'),
  ('attendance',            'pre_start',                '20260817_enrollment_dates_pre_start'),
  ('reception_staff',       'role',                     '20260818_repair_reception_worker_columns'),
  ('reception_staff',       'rfid',                     '20260818_repair_reception_worker_columns'),
  ('reception_staff',       'hourly_rate',              '20260818_repair_reception_worker_columns'),
  ('school',                'registration_fee_label',   '20260818_second_registration_fee'),
  ('school',                'registration_fee_2',       '20260818_second_registration_fee'),
  ('school',                'registration_fee_2_label', '20260818_second_registration_fee'),
  ('whatsapp_messages',     'provider',                 '20260819_whatsapp_evolution'),
  ('whatsapp_messages',     'instance',                 '20260819_whatsapp_evolution'),
  ('independent_sessions',  'is_free',                  '20260819_free_casual_sessions'),
  ('independent_sessions',  'waived_amount',            '20260819_free_casual_sessions'),
  ('sessions',              'is_free',                  '20260820_free_open_seances_timing')
)
select 'table manquante' as probleme,
       t.table_name      as objet,
       t.migration || '.sql' as a_repasser
from expected_tables t
where not exists (
  select 1 from information_schema.tables it
  where it.table_schema = 'public' and it.table_name = t.table_name
)
union all
select 'colonne manquante',
       c.table_name || '.' || c.column_name,
       c.migration || '.sql'
from expected_columns c
where exists (
    select 1 from information_schema.tables it
    where it.table_schema = 'public' and it.table_name = c.table_name
  )
  and not exists (
    select 1 from information_schema.columns ic
    where ic.table_schema = 'public'
      and ic.table_name = c.table_name
      and ic.column_name = c.column_name
  )
order by 1, 2;
