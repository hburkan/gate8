-- 0024_location_management.sql
-- Phase 22 Admin Location Management. Service-role grants only, mirroring the
-- approved 0018/0019/0020-0023 deviations: no anon/authenticated, no
-- INSERT/UPDATE/DELETE for the browser roles, no RLS policies, no new tables.
-- `case_instances` untouched (D4). `chapter_locations` untouched (out of
-- scope — chapter relation management is a later phase).
--
-- 1. `location_cases` has ZERO grants today (0020-0023 covered the other four
--    location relation tables). SELECT is required for the "Available cases"
--    read-only list and the detail page.
-- 2. INSERT/UPDATE/DELETE on all five `location_*` relation tables are
--    required for the admin relation management (ADD / EDIT / REMOVE). The
--    relation rows are the only thing written — entity deletion is never
--    performed (entity FKs are `on delete restrict`; admin archives instead).

grant select on table public.location_cases to service_role;

grant insert, update, delete on table public.location_characters to service_role;
grant insert, update, delete on table public.location_items to service_role;
grant insert, update, delete on table public.location_documents to service_role;
grant insert, update, delete on table public.location_evidence to service_role;
grant insert, update, delete on table public.location_cases to service_role;