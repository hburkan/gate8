-- 0020_character_usage_reads.sql
-- Grant base SELECT privileges on the relation tables the Phase 18 read-only
-- Character usage list queries to the `service_role` database role only.
--
-- WHY this migration is required (verified in this Supabase environment):
--   * Phase 18 renders "Used in Locations / Cases / Chapters" on the character
--     detail page via the server-only service-role client
--     (`apps/admin/src/lib/supabase/admin.ts`). `service_role` bypasses RLS
--     (`rolbypassrls = true`), but bypassing RLS does NOT grant base table
--     privileges.
--   * `config.toml` does not set `auto_expose_new_tables` (it is commented
--     out, line 24), so nothing auto-grants base privileges to service_role.
--   * 0018/0019 granted the 9 content tables only; the relation tables used by
--     the usage list (`case_characters`, `location_characters`,
--     `chapter_cases`) still hold 0 SELECT grants for service_role (verified
--     via `information_schema.role_table_grants`: only REFERENCES/TRIGGER/
--     TRUNCATE). Without this grant the usage queries fail with `permission
--     denied for table`, exactly as Phase 16 reads did before 0018.
--   * `chapter_cases` is read because a chapter references a character
--     INDIRECTLY through its cases (0015 models only chapter_locations and
--     chapter_cases; there is no `chapter_characters` table).
--
-- Security posture preserved (Phase 15 default-deny model):
--   * GRANT SELECT to `service_role` ONLY.
--   * NO grant to `anon` or `authenticated` (RLS still denies them).
--   * NO INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER grants (relations are
--     written only by Phases 22/23, which own their grants).
--   * NO RLS policies are added or modified (0010 + per-table `enable row
--     level security` stay zero-policy).
--   * `auto_expose_new_tables` is left unset; `config.toml` is unchanged.
--   * `case_instances` and the remaining relation tables are deliberately NOT
--     granted (Phase 15 D4; analytics deferred to Phase 41/42).
--   * Additive + reproducible: applies cleanly in `supabase db reset`.

grant select on table public.case_characters to service_role;
grant select on table public.location_characters to service_role;
grant select on table public.chapter_cases to service_role;