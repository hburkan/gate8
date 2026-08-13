# Phase 3 — Relation Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the Phase 3 relation tables that connect the global reusable entities (characters/items/documents/evidence/locations/cases) through exactly **one relation table per parent/entity pair**, each carrying both the relationship and its generation/gameplay configuration.

**Architecture:** Following audit `docs/superpowers/audits/2026-08-13-content-model-audit.md` decisions R1–R5:

- **R1:** No `*_pool` duplicate tables. One relation table per (case|location, entity) pair.
- **R2:** Relation rows carry `version` compatible with the parent content version. Simple, extensible.
- **R3:** `UNIQUE(parent_id, entity_id)` on every relation table.
- **R4:** No enum changes now (document roles stay free text; evidence role is a typed union in shared-types only).
- **R5:** Dialogue speaker validation is deferred to Phase 26 publish validation.

**Tech Stack:** PostgreSQL via Supabase migrations (`backend/supabase/migrations/`), TypeScript in `packages/shared-types` / `packages/content-schema`.

## Global Constraints

- Content stays 100% data-driven; no hard-coded game content.
- No AI, no mobile UI, no Admin UI, no random generation engine yet.
- Entities are global and reusable — relation tables must not duplicate or own content.
- Every relation table: `id`, parent FK, entity FK, config columns, `version`, `created_at`, `updated_at`, `set_updated_at()` trigger, RLS enabled, `UNIQUE(parent, entity)`.
- `cases` table does not exist yet (Phase 5). This phase creates a **minimal anchor `cases` table** (id, title, description, lifecycle) as the FK target; Phase 5 extends it with type/difficulty/min-max columns.
- FK behavior: parent (`case_id`/`location_id`) `ON DELETE CASCADE` (relations belong to the parent); entity (`character_id`/`item_id`/...) `ON DELETE RESTRICT` (protect global entities from accidental hard-delete).

## Tables To Create (exact set from approved audit R1)

```
case_*      : case_characters, case_items, case_documents, case_evidence
location_*  : location_characters, location_items, location_documents, location_evidence, location_cases
cases       : minimal anchor (dependency for case_* relations)
```

Deferred (NOT created this phase, per approved list): `case_dialogues`, `case_missions`, `case_locations`, `location_missions`.

---

## Design Review (pre-implementation)

### 1. Table design

#### `cases` (anchor; extended in Phase 5)

`id`, `title text not null`, `description text`, `status content_status`, `version int`, `created_at`, `updated_at`.

#### `case_characters` (per audit spec, exact minimum)

`id`, `case_id`, `character_id`, `required bool`, `weight numeric`, `min_items int`, `max_items int`, `role text`, `priority int`, `conditions jsonb`, `version`, `created_at`, `updated_at`.

#### `case_items`

`id`, `case_id`, `item_id`, `required bool`, `weight numeric`, `min_quantity int`, `max_quantity int`, `hidden bool`, `discovery_method text`, `conditions jsonb`, `priority int`, `version`, `created_at`, `updated_at`.

#### `case_documents`

`id`, `case_id`, `document_id`, `required bool`, `weight numeric`, `role text` (real/fake/decoy), `hidden bool`, `discovery_method text`, `conditions jsonb`, `priority int`, `version`, `created_at`, `updated_at`.

#### `case_evidence`

`id`, `case_id`, `evidence_id`, `role text` (required/optional/decoy/hidden), `weight numeric`, `importance evidence_importance` (per-case override, nullable), `discovery_method text`, `discovery_condition jsonb`, `conditions jsonb`, `priority int`, `version`, `created_at`, `updated_at`.

#### `location_characters`

`id`, `location_id`, `character_id`, `availability bool`, `weight numeric`, `spawn_probability numeric`, `min_quantity int`, `max_quantity int`, `role text`, `priority int`, `sort_order int`, `conditions jsonb`, `version`, `created_at`, `updated_at`.

#### `location_items`

`id`, `location_id`, `item_id`, `availability bool`, `weight numeric`, `spawn_probability numeric`, `min_quantity int`, `max_quantity int`, `hidden bool`, `discovery_method text`, `priority int`, `sort_order int`, `conditions jsonb`, `version`, `created_at`, `updated_at`.

#### `location_documents`

`id`, `location_id`, `document_id`, `availability bool`, `weight numeric`, `spawn_probability numeric`, `role text`, `hidden bool`, `discovery_method text`, `priority int`, `sort_order int`, `conditions jsonb`, `version`, `created_at`, `updated_at`.

#### `location_evidence`

`id`, `location_id`, `evidence_id`, `availability bool`, `weight numeric`, `spawn_probability numeric`, `role text`, `importance evidence_importance`, `discovery_method text`, `discovery_condition jsonb`, `priority int`, `sort_order int`, `conditions jsonb`, `version`, `created_at`, `updated_at`.

#### `location_cases`

`id`, `location_id`, `case_id`, `availability bool`, `weight numeric`, `spawn_probability numeric`, `priority int`, `sort_order int`, `conditions jsonb`, `version`, `created_at`, `updated_at`.

> Note: `order` is a reserved word in PostgreSQL; the column is named `sort_order`.

### 2. Foreign keys

| Table          | FK column   | References                                    | ON DELETE | ON UPDATE |
| -------------- | ----------- | --------------------------------------------- | --------- | --------- |
| case_*         | case_id     | cases(id)                                     | CASCADE   | NO ACTION |
| case_*         | _entity__id | characters/items/documents/evidence(id)       | RESTRICT  | NO ACTION |
| location_*     | location_id | locations(id)                                 | CASCADE   | NO ACTION |
| location_*     | _entity__id | characters/items/documents/evidence/cases(id) | RESTRICT  | NO ACTION |
| location_cases | case_id     | cases(id)                                     | CASCADE   | NO ACTION |

Parent-side cascade: deleting a case/location removes its relations (relations are owned by the parent). Entity-side restrict: a global entity used anywhere cannot be hard-deleted (archiving is the soft-delete path).

### 3. Indexes

- `UNIQUE(case_id, entity_id)` (also serves as the parent-side lookup index).
- `entity_id` index on every relation table → reverse lookups ("where is this character used?") needed by admin usage lists and Phase 26 validation.
- `locations` already has `parent_id` + `status` indexes.

### 4. RLS

`enable row level security` on every new table, no policies yet (policies ship in Phase 15/40). Matches migration `0010` pattern.

### 5. Versioning (R2)

Every relation row has `version int not null default 1`. Semantics: a relation row is valid for the parent content version; when a case/location is published at version N, its relation rows carry the matching version. No separate history table in Phase 3 (Phase 27 adds revision history). Simple and extensible.

### 6. Generation / gameplay support

| Requirement                    | Supported by                                                                                                                                                      |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reusable content               | Global entity FKs; no content duplication in relations                                                                                                            |
| Weighted random generation     | `weight` numeric on every relation table                                                                                                                          |
| Min/max generation             | `min_*`/`max_*` columns (items/characters quantities)                                                                                                             |
| Required entities              | `required bool` (case_characters/items/documents)                                                                                                                 |
| Character-specific item limits | `case_characters.min_items/max_items` + `case_items` per-item ranges                                                                                              |
| Location pools                 | `location_*` tables with `spawn_probability`, `availability`, `weight`                                                                                            |
| Case pools                     | `case_*` tables with `weight`, `required`, `hidden`, `discovery_method`, `role`                                                                                   |
| Case Template → Case Instance  | Relations reference the template (`case_id`); instance generation (Phase 12/14) reads them deterministically — template and instance remain conceptually separate |

---

## Migration Plan

| File                          | Contents                                                                                   |
| ----------------------------- | ------------------------------------------------------------------------------------------ |
| `0011_cases_anchor.sql`       | minimal `cases` table (Phase 5 extends) + trigger + index + RLS                            |
| `0012_case_relations.sql`     | case_characters, case_items, case_documents, case_evidence                                 |
| `0013_location_relations.sql` | location_characters, location_items, location_documents, location_evidence, location_cases |

---

## Task List

### Task 1: Write `0011_cases_anchor.sql`

**Files:** `backend/supabase/migrations/0011_cases_anchor.sql`

- DDL as designed. Verify with `supabase db reset` (applies all 0001–0013 together in Task 3; here just author the file).

### Task 2: Write `0012_case_relations.sql` + `0013_location_relations.sql`

**Files:** both migration files

- Full DDL per design. UNIQUE + entity indexes + triggers + RLS.

### Task 3: Apply & verify migrations

Run: `supabase db reset`
Verify via psql: all tables exist, FKs correct, unique constraints present, RLS enabled.

### Task 4: Update `packages/shared-types`

**Files:** `src/relations.ts` (new), `src/entities/case.ts` (new), `src/index.ts`, `src/enums.ts` (evidence/document role unions)

- Add `Case`, `CaseCharacter`, `CaseItem`, `CaseDocument`, `CaseEvidence`, `LocationCharacter`, `LocationItem`, `LocationDocument`, `LocationEvidence`, `LocationCase` types mirroring the DDL.
- Add `EVIDENCE_ROLES`, `DOCUMENT_ROLES` typed unions (shared-types only; DB stays text per R4).

### Task 5: Update `packages/content-schema`

**Files:** `src/relations.ts` (new), `src/entities/case.ts` (new), `src/index.ts`, `test/relations.test.ts` (new)

- zod schemas for all relation types + case, mirroring DDL column-for-column.
- Round-trip tests.

### Task 6: Full verification + TODO.md

- prettier, eslint, typecheck, build, tests.
- Update `TODO.md` Phase 3 boxes for created tables + "Support" rows; annotate deferred tables.
- Stop and report.

---

## Self-Review

**Spec coverage:** All 9 approved relation tables + cases anchor (R1). UNIQUE constraints (R3). version column (R2). No enums added to DB (R4). Speaker validation untouched (R5). Type/schema mirrors in Task 4/5. Verification in Task 3/6.
**Placeholder scan:** No TBD/TODO; full DDL in Tasks 1–2.
**Type consistency:** Column names in DDL match field names in shared-types (snake_case ↔ camelCase) and zod schemas exactly (e.g. `case_id` ↔ `caseId`, `spawn_probability` ↔ `spawnProbability`).
