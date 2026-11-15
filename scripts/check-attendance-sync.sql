-- Read-only. Run first in Supabase SQL Editor. No school row values returned.
begin transaction read only;
select to_regprocedure('public.sync_changes(timestamp with time zone)') is not null as installed;
select p.oid::regprocedure as signature, not p.prosecdef as respects_caller_rls,
       has_function_privilege('authenticated',p.oid,'execute') as authenticated_can_call
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname='sync_changes';
rollback;
-- If installed=true, run the following in a SEPARATE read-only transaction.
-- Substitute a disposable authorized reception user's UUID, NOT a secret key.
-- The SQL Editor normally runs as postgres; setting claims alone is insufficient.
-- begin transaction read only;
-- set local role authenticated;
-- select set_config('request.jwt.claims',
--   '{"sub":"REPLACE_WITH_TEST_USER_UUID","role":"authenticated"}',true);
-- select public.current_role() as actual_school_role;
-- select jsonb_typeof(public.sync_changes(null)->'tables') as cursor_probe_tables;
-- with probe as materialized (select public.sync_changes(now()-interval '30 seconds') as payload)
-- select jsonb_typeof(payload->'tables') as delta_tables_type,
--        (payload->>'now')::timestamptz is not null as server_cursor_present,
--        jsonb_array_length(payload->'deleted') as deletion_count
-- from probe;
-- rollback;
-- Never return the full RPC payload: it can contain private school records.
