-- 0023_evidence_usage_reads.sql
-- Grant base SELECT on the relation tables the Phase 21 read-only Evidence
-- usage list queries (Used in Locations / Cases / Chapters). service_role
-- only, mirroring the 0020/0021/0022 approved deviations; no
-- anon/authenticated, no INSERT/UPDATE/DELETE, no RLS policies.
-- `chapter_cases` already has SELECT from 0020 (no re-grant).
-- `case_instances` untouched (D4).

grant select on table public.case_evidence to service_role;
grant select on table public.location_evidence to service_role;
