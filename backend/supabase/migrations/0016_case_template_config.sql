-- 0016_case_template_config.sql
-- Extend the existing `cases` (case template) entity with identity metadata
-- and generation-configuration bounds. Per the approved Phase 5 design:
--   * `type` / `difficulty` are free text (not enums), content-defined per
--     audit decision R4; difficulty matches the Phase 11 rule value string.
--   * `min_*`/`max_*` are the template-scoped entity-count bounds. `0` means
--     "no bound" (no minimum / no maximum), mirroring the nonnegativity-only
--     convention of the Phase 3 relation tables.
--   * Per-entity selection config (weight/required/min-max per character,
--     item, document, evidence) remains on the Phase 3 case_* relation tables.
--   * Cross-field `min <= max` is validated at publish time (Phase 26), not
--     as a DB guard.
-- No new tables, no enums, no trigger/RLS/index changes.

alter table cases
  add column type text,
  add column difficulty text,
  add column min_characters int not null default 0 check (min_characters >= 0),
  add column max_characters int not null default 0 check (max_characters >= 0),
  add column min_items int not null default 0 check (min_items >= 0),
  add column max_items int not null default 0 check (max_items >= 0),
  add column min_documents int not null default 0 check (min_documents >= 0),
  add column max_documents int not null default 0 check (max_documents >= 0),
  add column min_evidence int not null default 0 check (min_evidence >= 0),
  add column max_evidence int not null default 0 check (max_evidence >= 0);