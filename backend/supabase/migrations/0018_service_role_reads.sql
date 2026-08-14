-- 0018_service_role_reads.sql
-- Grant base SELECT privileges on the Phase 16 dashboard read surface to the
-- `service_role` database role only.
--
-- WHY this migration is required (verified in this Supabase environment):
--   * Phase 16 dashboard reads go through the server-only service-role client
--     (`apps/admin/src/lib/supabase/admin.ts`). `service_role` bypasses RLS
--     (`rolbypassrls = true`), but bypassing RLS does NOT grant base table
--     privileges.
--   * `config.toml` does not set `auto_expose_new_tables` (it is commented
--     out, line 24), so this stack follows the new default where tables
--     created by `postgres` in `public` are NOT auto-exposed to
--     `anon`/`authenticated`/`service_role`. Without an explicit GRANT,
--     service-role reads fail with `permission denied for table ...` (verified
--     via `information_schema.role_table_grants`: service_role has only
--     DELETE/REFERENCES/TRIGGER/TRUNCATE on these tables).
--
-- The 9 tables below are EXACTLY the Phase 16 dashboard read surface
-- (`CONTENT_TABLES` in `apps/admin/src/lib/dashboard/metrics.ts`): the count,
-- status-sum, and recent-changes queries touch no other table, column, join,
-- function, or sequence.
--
-- Security posture preserved (Phase 15 default-deny model):
--   * GRANT SELECT to `service_role` ONLY.
--   * NO grant to `anon` or `authenticated` (RLS still denies them; verified
--     below).
--   * NO INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER grants.
--   * NO sequence grants (the dashboard never generates identifiers).
--   * NO RLS policies are added or modified (0010 + per-table `enable row
--     level security` stay zero-policy).
--   * `auto_expose_new_tables` is left unset; `config.toml` is unchanged.
--   * `case_instances` is deliberately NOT granted (Phase 15 decision D4:
--     runtime data, no admin read; analytics deferred to Phase 41/42).

grant select on table public.characters to service_role;
grant select on table public.items to service_role;
grant select on table public.documents to service_role;
grant select on table public.evidence to service_role;
grant select on table public.locations to service_role;
grant select on table public.missions to service_role;
grant select on table public.dialogue_definitions to service_role;
grant select on table public.cases to service_role;
grant select on table public.chapters to service_role;
