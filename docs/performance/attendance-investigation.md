# Attendance CPU and screen prefetch: first bounded change

Base: 476ba66f71df399c5104250274ed5576b75d2bc8. This change does **not** satisfy the full bounded-data/navigation acceptance target. Do not treat it as completion of the school-wide performance redesign.

## What ships

Attendance history is evaluated only while its tab is visible, memoized across clock/input changes unrelated to history, and uses relationship maps instead of repeated array.find joins for every record. The visible table renders at most 100 rows; period counts, money totals and print output still use all matches. Filtering changes reset the page; deletions clamp it. Data retrieval, write semantics, RLS and cache formats are unchanged. No SQL migration is required.

ModuleDispatcher preserves dynamic imports/static route shells. Speculative imports now follow same-origin link pointer/focus intent, use the existing role allowlist, and respect Save-Data/2G. Role changes remove old listeners; unauthenticated users no longer default to admin prefetch. Already-started imports cannot be aborted; no further idle queue exists. Cold touch navigation may now wait for its requested chunk; browser waterfall comparison remains outstanding.

## Measured evidence (local synthetic only)

Node 24.22.1, Linux cloud machine, five reported CPUs, no CPU throttling. No browser/device/network emulation. Synthetic 2,000 students, 100 sessions/modules/classes and chronological attendance at 125 units per row; no real school data. Search: module12. Twenty-one samples per case, including index construction each time. Median = sample 11, p95 = sample 20, ascending order. Baseline reproduces repeated relationship searches; it is a CPU algorithm comparison, **not a production-build browser baseline**.

| Attendance rows | Before median / p95 ms | After median / p95 ms |
| --- | --- | --- |
| 10,000 | 54.73 / 64.71 | 2.78 / 4.15 |
| 100,000 | 467.75 / 614.12 | 15.21 / 22.78 |

Reproduce: `npx --no-install vitest run tests/attendance-history.test.ts --reporter=verbose`.
Tests compare every matching record/order and money totals for >500 rows, empty results, status/date filters, missing relationships, accents and Arabic. Existing billing, sync-engine, pagination and merge tests remain intact. Full suite: 37 files, 503 tests passed. TypeScript passed. Lint: 125 errors/54 warnings, same count as onboarding baseline (existing React purity/effect/any/entity issues). Build attempted with the repository's production `next build --webpack`; failed fetching Geist/Geist Mono/Cairo because fonts.googleapis.com CONNECT returned 403 under the active network policy. No TLS/signature bypass, font mocks or source substitutions used.

## Mode and data-flow findings

vercel.json selects Next.js and npm run build; scripts use Webpack in both dev and production. Module routes generate static params and client-dispatch role screens. This establishes repository configuration, **not the version/migration state/mode actually serving production**. No production telemetry was accessed. The earlier development login 200 is not a production/authenticated benchmark.

SessionProvider reads public branding separately and starts the per-user store. Empty IndexedDB still causes all TABLES readers to run and publishes after the group. Full readers use 500-row pages and UUID partitions; TABLES has 35 entries plus school. Snapshot warm starts restore most arrays then request delta and excluded data. DataSyncAgent checks every 30 seconds and full safety loads still occur after 30 minutes. Missing delta/cursor still falls back to full loads, and many writes await refresh. This PR intentionally leaves these correctness-critical behaviors unchanged.

Dependency map for the next data-layer change:

| View/roles | Required authoritative datasets / risks |
| --- | --- |
| Students, staff | student summaries + enrollment/class lookup; detail ledger on demand; debt/drift currently consumes complete balance_tx |
| Attendance, staff | sessions/roster/current day, scan RPC; separate period history and summary; cancellation/refund must be authoritative |
| Dashboard, staff | debt + schedule + private module aggregates; cannot sum a partial student page |
| Caisse/reports/analytics, admin | full-filter transaction/teacher/worker totals and export; visible list cap does not bound underlying computation |
| Classes/timetables, staff | enrollment/session/module joins and complete audience eligibility |
| Teacher/student/parent portals | RLS-authorized relationship scope, changing enrollments/children and revocation; never infer permissions from incomplete arrays |

Students already defers search and uses shallow selectors/maps; driftByStudent and debtById still consume whole collections. Global store consumers need explicit loading/failed/partial/complete status before server pagination can replace these arrays. A missing array currently often means empty, so truncating store reads would silently corrupt reports/permissions. WhatsApp watcher still polls counts/lists; not measured or changed. No real messages sent.

## Read-only diagnostics and migration order

Run `scripts/diagnose-sync.sql` only against authorized development/staging. Catalog checks report tables, updated_at/leading valid indexes, enabled triggers, RLS/policy counts, function privilege/security mode, relationship triggers and deletion metadata. School intentionally has no deletion trigger in the existing migration. Catalog findings alone do not establish intended-role usability. Execute the commented RPC/EXPLAIN probes separately with each actual synthetic admin/reception/teacher/student/parent JWT, never service_role. Record only duration, rows and bytes, not result payloads or identifiers.

Apply schema.sql then **all dated migrations in order**, including prerequisites before 20261001_fast_sync_and_rls_speed.sql, then 20261005_absences_friday_to_thursday.sql, 20261010_reduction_school_part_only.sql, 20261109_disable_absence_balance_deduction.sql. The last three do not redefine sync_changes. Do not reapply an old billing migration after the November migration. This PR changes no billing SQL. The 20261001 inventory checks missing columns/touch triggers/function and policy patterns, but omits deletion triggers, index validity and actual role execution; the new diagnostic covers more metadata.

sync_changes is SECURITY INVOKER, checks 36 tables, includes a two-minute overlap and nested enrollment/parent relationships, and returns deletion keys. A single HTTP call can still be expensive SQL. Long transactions exceeding the overlap and permission revocations need a correctness design before removing full reconciliation. Deletion retention is 45 days; snapshot validity must remain shorter. No scoped cursor or new index is introduced without plans. Profile empty/busy/long-offline cutoffs with actual RLS, then compare inner SELECT EXPLAIN ANALYZE/BUFFERS, RPC wall time/bytes and any Vercel route wall time separately. Outer function EXPLAIN alone does not expose inner plans.

## Outstanding acceptance measurements and implementation

Not measured: production build browser CPU/render/long tasks; login vs profile; cold/warm IndexedDB; Students/Attendance/dashboard/payment/reports network rows/bytes/counts; all-role navigation; scan/manual/payment click-to-authoritative feedback; second-desk visibility. There are no median/p95 claims for those cases. No database connection/credentials are available. Build network policy must be applied before production-mode local profiling.

Still required before declaring the requested outcome achieved: bounded server page/summary APIs and active-route loading, concurrency control, authoritative write merge/invalidation, scoped cursors preserving inactive-route changes, targeted reconciliation/recovery, incremental snapshot cost, complete consumer audit and full-period export paths. Preserve no absence balance deduction, idempotent scan/payment semantics, pending write guards and owner-generation guards. Exercise duplicate scans, simultaneous desks, response loss, stale reads after writes, failed page load, offline/reconnect, relationship changes/deletes and account switching. Existing unit tests passing is not evidence that this full new scenario matrix was exercised.

## Operator / rollout checklist

1. In a disposable staging database apply existing migrations in the order above; run read-only metadata and five-role probes. No production migration or write is authorized by this document.
2. Allow fonts.googleapis.com/fonts.gstatic.com through environment settings; add development Supabase variables securely. Re-run npm test, npm run lint, npm run build. Diagnose lint independently; do not disable rules to claim success.
3. Run the production server with synthetic data. Check scanner remains active while history is hidden; page through >500 history matches; compare period totals and printed output. Try filter changes and deleting last-page records.
4. Check hover/focus navigation for each role and constrained connections; inspect no idle bulk screen imports. Check French/Arabic RTL. Measure cold/warm touch navigation regressions.
5. This frontend-only change has no schema/cursor/snapshot format upgrade. Old/new tabs retain the existing sync protocol. Rollback by reverting this commit; no SQL rollback. Do not publish/deploy from this task.
