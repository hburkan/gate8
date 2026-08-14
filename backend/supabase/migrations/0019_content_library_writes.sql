-- 0019_content_library_writes.sql
-- Grant base INSERT/UPDATE privileges on the Phase 17 Content Library write
-- surface to the `service_role` database role only.
--
-- WHY this migration is required (verified in this Supabase environment):
--   * Phase 17 Create/Edit/Duplicate/Archive run server-side through the
--     service-role client (`apps/admin/src/lib/supabase/admin.ts`).
--   * 0018 granted SELECT only; `service_role` still holds 0 INSERT/UPDATE
--     grants on these tables (role_table_grants = REFERENCES/SELECT/TRIGGER/
--     TRUNCATE). `rolbypassrls` grants no base table privileges.
--   * `config.toml` does not set `auto_expose_new_tables` (it is commented
--     out, line 24), so nothing auto-grants base privileges to service_role.
--   * Without this grant, Phase 17 writes fail with `permission denied for
--     table`, exactly as Phase 16 reads did before 0018.
--
-- Security posture preserved (Phase 15 default-deny model):
--   * GRANT INSERT/UPDATE to `service_role` ONLY (SELECT already from 0018).
--   * NO grant to `anon` or `authenticated` (RLS still denies them).
--   * NO DELETE grant (archive is an UPDATE; hard delete is not implemented
--     in Phase 17 and relation FKs use ON DELETE RESTRICT anyway).
--   * NO sequence grants (uuid PKs via gen_random_uuid(); no sequences used).
--   * NO RLS policies added or modified; `auto_expose_new_tables` left unset.
--   * `case_instances` and relation tables are deliberately NOT granted
--     (Phase 15 D4; Phases 22/23/24/25 own relation/runtime surfaces).
--   * Additive + reproducible: applies cleanly in `supabase db reset`.

grant insert, update on table public.characters to service_role;
grant insert, update on table public.items to service_role;
grant insert, update on table public.documents to service_role;
grant insert, update on table public.evidence to service_role;
grant insert, update on table public.locations to service_role;
grant insert, update on table public.missions to service_role;
grant insert, update on table public.dialogue_definitions to service_role;
grant insert, update on table public.cases to service_role;
grant insert, update on table public.chapters to service_role;
