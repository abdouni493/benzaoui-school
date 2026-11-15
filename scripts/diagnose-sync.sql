-- Read-only metadata only: run in a development/staging SQL editor.
-- Catalog health is not proof of usable RLS. Run the separate role probe below.
begin transaction read only;
with synced(name) as (select unnest(array[
    'school', 'profiles', 'filieres', 'modules', 'groups', 'salles', 'classes',
    'teachers', 'teacher_payments', 'reception_staff', 'worker_shifts',
    'worker_payments', 'student_credentials', 'module_absence_rules', 'sessions',
    'subscriptions', 'free_periods', 'students', 'balance_tx', 'attendance',
    'absence_penalties', 'unpaid_teacher_sessions', 'teacher_acomptes',
    'teacher_absences', 'subjects', 'announcements', 'expense_categories',
    'expenses', 'cash_transactions', 'parents', 'notifications', 'coursework',
    'independent_sessions', 'private_sessions', 'private_session_modules',
    'private_session_students'
  ]::text[]))
select name,
  to_regclass('public.'||name) is not null as table_present,
  exists(select 1 from pg_attribute where attrelid=to_regclass('public.'||name) and attname='updated_at' and not attisdropped) as updated_at,
  exists(select 1 from pg_index i join pg_attribute a on a.attrelid=i.indrelid and a.attnum=i.indkey[0]
    where i.indrelid=to_regclass('public.'||name) and a.attname='updated_at' and i.indisvalid and i.indisready and i.indpred is null) as leading_updated_at_index,
  exists(select 1 from pg_trigger where tgrelid=to_regclass('public.'||name) and tgname='trg_sync_updated_at' and tgenabled <> 'D') as touch_trigger,
  exists(select 1 from pg_trigger where tgrelid=to_regclass('public.'||name) and tgname='trg_sync_record_deletion' and tgenabled <> 'D') as deletion_trigger,
  (select relrowsecurity from pg_class where oid=to_regclass('public.'||name)) as rls,
  (select count(*) from pg_policies where schemaname='public' and tablename=name) as policies
from synced order by name;
select p.oid::regprocedure as function, p.prosecdef as security_definer,
  has_function_privilege('authenticated',p.oid,'execute') as authenticated_execute
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname='sync_changes';
select c.relname,t.tgname,t.tgenabled from pg_trigger t join pg_class c on c.oid=t.tgrelid
where t.tgname in ('trg_sync_touch_student','trg_sync_touch_parent');
select indexname,indexdef from pg_indexes where schemaname='public' and tablename='sync_deletions';
select policyname,roles,cmd,qual from pg_policies where schemaname='public' and tablename='sync_deletions';
rollback;
-- In a separate READ ONLY transaction under each actual test user's JWT/RLS:
-- select jsonb_object_keys(public.sync_changes(null));
-- explain (analyze, buffers, format json) select public.sync_changes(now());
-- Repeat with busy and long-offline cursors. EXPLAIN outer RPC hides inner plans:
-- separately EXPLAIN each table SELECT with the same updated_at cutoff and JWT.
-- Do not print RPC payloads (they contain sensitive data). Do not use service_role
-- for role checks. Compare HTTP response time/bytes with SQL execution time.
