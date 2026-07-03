-- Formation subscriptions: price per level + duration, and per-student
-- enrollment window on the join table.
-- Run this once against the live project (Dashboard -> SQL Editor).

alter table public.subscriptions
  add column if not exists level_price integer,
  add column if not exists period_months integer;

alter table public.student_subscriptions
  add column if not exists start_date date,
  add column if not exists expiry_date date;
