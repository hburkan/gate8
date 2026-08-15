# Phase 22 — Admin Location Management

> **Filename note (conflict C10):** the design-task prompt mandated the path
> `2026-08-14-phase22-admin-case-builder.md`, but TODO.md assigns "ADMIN CASE
> BUILDER" to **Phase 23** and defines **Phase 22 as ADMIN LOCATION MANAGEMENT**
> (TODO.md:820–844). Per the prompt's own precedence rule ("If TODO.md says
> something different from this prompt, TODO.md and the real repository take
> precedence"), this document designs **Phase 22 = Admin Location Management**.
> The file is created at the mandated path for fidelity to the instruction; a
> rename to `2026-08-14-phase22-admin-location-management.md` (matching the
> phase18–21 `admin-*-management` convention) is recommended in C10. **Done** —
> renamed at implementation start.
>
> **Status:** IMPLEMENTED — design approved (C1/C3/C4/C5/C10) and implemented.
> Implementation is complete and fully verified (unit + DB reset 0001→0024 +
> grants + e2e). Per the approved workflow, the commit is held pending explicit
> user approval; this document will be updated with commit refs once pushed.

## 1. Status / Scope

- **Status:** IMPLEMENTED.
- **Scope:** Admin Location Management — the `locations` entity (parent/child
  hierarchy, type, asset) plus management of the five location relation tables
  (`location_characters`, `location_items`, `location_documents`,
  `location_evidence`, `location_cases`).
- **Mandated scope reconciliation (prompt §2/§3):** the task prompt assumed the
  next surface was "Case Builder / case relation management", but TODO.md
  Phase 22 (line 820) is **ADMIN LOCATION MANAGEMENT**:
  - Parent/child locations
  - Location types
  - Assets
  - Available characters
  - Available items
  - Available documents
  - Available evidence
  - Available cases
    TODO.md Phase 23 (line 846) is the visual **ADMIN CASE BUILDER** (sections
    General / Locations / Characters / Items / Documents / Evidence / Dialogues /
    Missions / Rules / Rewards / Preview / Validation / Publish). That is out of
    scope for Phase 22 and is analyzed in §17 only for compatibility.

## 2. Repository Baseline

- Git: `HEAD == origin/main == f28ebdc56be09a9493978e45ba4b97c90202bf0c`
  (Phase 21 `feat(admin): implement phase 21 evidence management`). Working tree clean.
- Migrations `0001`–`0023` present, applied. `supabase db reset` verified clean in Phase 21.
- Supabase local: API `127.0.0.1:54321`, DB `postgresql://postgres:postgres@127.0.0.1:54322/postgres`. Dev server `http://localhost:3001`.
- Roles re-provisioned after the Phase 21 reset: `super@gumruk.local` (SUPER_ADMIN), `contentadmin@gumruk.local`, `editor@gumruk.local`, `reviewer@gumruk.local`.
- Admin library: registry-driven CRUD (Phase 17), role/permission server actions (Phase 15), usage helpers for character/item/document/evidence (Phases 18–21).

## 3. TODO Reconciliation

TODO.md Phase 22 items and their real-world mapping:

| TODO Phase 22 item     | Schema support                                                                  | In Phase 22?                                          |
| ---------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Parent/child locations | `locations.parent_id` self-FK (0007, `ON DELETE SET NULL`)                      | Yes — parent selector + cycle guard                   |
| Location types         | `locations.type` `location_type` enum (country/city/airport/terminal/area/room) | Yes — enum select (already in registry `enumOptions`) |
| Assets                 | `locations.asset` text                                                          | Yes — text field                                      |
| Available characters   | `location_characters` (0013)                                                    | Yes — relation ADD/EDIT/REMOVE                        |
| Available items        | `location_items` (0013)                                                         | Yes — relation ADD/EDIT/REMOVE                        |
| Available documents    | `location_documents` (0013)                                                     | Yes — relation ADD/EDIT/REMOVE                        |
| Available evidence     | `location_evidence` (0013)                                                      | Yes — relation ADD/EDIT/REMOVE                        |
| Available cases        | `location_cases` (0013)                                                         | Yes — relation ADD/EDIT/REMOVE                        |

Related deferred items (NOT Phase 22):

- `case_locations` — no table; explicitly deferred in TODO.md:251 (Phase 3).
- `location_missions` — no table; TODO.md:230 deferred.
- Visual case builder, dialog/mission/rule/reward editing — Phase 23 (TODO.md:846+).

## 4. Existing Location Schema

`locations` (migration 0007):

- `id uuid pk default gen_random_uuid()`
- `name text not null`
- `type location_type not null` — enum `('country','city','airport','terminal','area','room')`
- `description text`
- `parent_id uuid references locations(id) on delete set null` (self-FK)
- `asset text`
- `status text` + `version integer` + `created_at`/`updated_at`
- Indexes: `locations_status_idx`, `locations_parent_id_idx`; trigger `locations_set_updated_at`; RLS enabled (no policies).

shared-types `Location` = `{ name, type, description|null, parentId|null, asset|null }`; content-schema `locationSchema`/`locationDraftSchema` (name min 1 max 200, `type` enum, `description`/`parentId` uuid nullable, `asset` nullable) — matches the DB.

Entity grants: `locations` already has service_role SELECT (0018) + INSERT/UPDATE (0019). **Entity CRUD for locations works today through the generic Phase 17 path** (registry `locations` adapter: `fieldMap` includes `parentId`/`asset`, `enumOptions.type = LOCATION_TYPES`, `requiredFields: ['name']`).

## 5. Existing Relation Schema

All five relation tables from migration 0013. Shared shape: parent FK `references locations(id) on delete cascade`, entity FK `references <entity>(id) on delete restrict`, `version`, `created_at`/`updated_at`, RLS enabled, `UNIQUE(location_id, entity_id)`. shared-types interfaces: `LocationCharacter`, `LocationItem`, `LocationDocument`, `LocationEvidence`, `LocationCase` (relations.ts).

| Table                 | Config columns (beyond FK + version + timestamps)                                                                                                  |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `location_characters` | availability bool, weight, spawn_probability, min_quantity, max_quantity, role text, priority, sort_order, conditions jsonb                        |
| `location_items`      | availability, weight, spawn_probability, min_quantity, max_quantity, hidden bool, discovery_method text, priority, sort_order, conditions          |
| `location_documents`  | availability, weight, spawn_probability, role text, hidden, discovery_method, priority, sort_order, conditions                                     |
| `location_evidence`   | availability, weight, spawn_probability, role text, importance text, discovery_method, discovery_condition jsonb, priority, sort_order, conditions |
| `location_cases`      | availability, weight, spawn_probability, priority, sort_order, conditions                                                                          |

**Current service_role grants (verified live):**

- `location_characters` SELECT (0020); `location_items` SELECT (0021); `location_documents` SELECT (0022); `location_evidence` SELECT (0023).
- **`location_cases`: ZERO grants** (`REFERENCES, TRIGGER, TRUNCATE` only — no SELECT, no DML).
- **None of the five has INSERT/UPDATE/DELETE.**
- `chapter_locations`: ZERO grants (unchanged, out of scope).
- `case_instances`: untouched (D4).
- `pg_policies` in `public` = 0. anon/authenticated DML in `public` = 0 (the 34 reported earlier are in Supabase platform schemas `realtime`/`storage`/`supabase_functions`, not content).

## 6. Phase 22 Scope (Location Management)

Entity surface:

- **Parent/child:** parent selector in the location form listing valid parents (excluding self and descendants), storing `parent_id`.
- **Type:** enum select (`location_type`), already wired via registry `enumOptions`.
- **Asset:** text field, already wired via registry `fieldMap`.
- A specialized `editor: 'location'` form is added to support the parent selector and a readable parent display; scalar fields otherwise reuse generic behavior.

Relation surface (the core of Phase 22) — on the location detail page, five panels:

- **Available characters** (`location_characters`)
- **Available items** (`location_items`)
- **Available documents** (`location_documents`)
- **Available evidence** (`location_evidence`)
- **Available cases** (`location_cases`)

Each panel: list existing relations (entity title + editable config), ADD a relation (searchable entity selector), EDIT config, REMOVE the relation. Relation removal never deletes the content entity (FK `on delete restrict` guarantees this at the DB level too).

## 7. Relation Semantics

- **ADD:** resolve `entityId` (must exist), reject duplicates (enforced by `UNIQUE(location_id, entity_id)`), insert row with defaults for config columns.
- **EDIT:** update config columns only; identity (location/entity) is immutable on a relation row.
- **REMOVE:** `DELETE` the relation row only — never the entity. DB `on delete restrict` prevents dangling entity references; the admin flow performs no entity delete.
- **Allowed editable config (Phase 22):** `availability`, `weight`, `spawn_probability`, `min_quantity`, `max_quantity` (characters/items only), `role` (characters/documents/evidence), `importance` (evidence), `priority`, `sort_order`.
- **Deferred (rule-engine/discovery-owned, NOT edited in Phase 22):** `conditions` (jsonb, Phase 11 rule engine), `hidden`, `discovery_method`, `discovery_condition` (discovery system). Matches the Phase 21 deferral of the same fields on evidence.
- **Atomicity:** each relation mutation is a single-row `INSERT`/`UPDATE`/`DELETE` on the relation table via the service-role client — no multi-table writes, no orphan creation.

## 8. Permissions

Phase 15 matrix, no new roles. Server-side `authorize()` re-checks on every action (enforcement boundary; UI hiding is UX only).

| Action             | SUPER_ADMIN | CONTENT_ADMIN | EDITOR | REVIEWER |
| ------------------ | ----------- | ------------- | ------ | -------- |
| VIEW location      | ✓           | ✓             | ✓      | ✓        |
| CREATE location    | ✓           | ✓             | ✓      | ✗        |
| EDIT location      | ✓           | ✓             | ✓      | ✗        |
| DUPLICATE location | ✓           | ✓             | ✓      | ✗        |
| ARCHIVE location   | ✓           | ✓             | ✗      | ✗        |
| RELATION ADD       | ✓           | ✓             | ✓      | ✗        |
| RELATION EDIT      | ✓           | ✓             | ✓      | ✗        |
| RELATION REMOVE    | ✓           | ✓             | ✓      | ✗        |

Relation actions gate on `edit` permission (like entity edit). REVIEWER gets read-only panels.

## 9. Server Architecture

- New helper `apps/admin/src/lib/library/location-relations.ts` (service-role client `libraryServiceClient()`), mirroring `evidence-usage.ts` structure but with write support:
  - `getLocationRelations(client, locationId)` → `{ characters, items, documents, evidence, cases }` (relation rows + entity titles + counts)
  - `addLocationRelation(client, kind, locationId, entityId, config)`
  - `updateLocationRelation(client, kind, locationId, entityId, config)`
  - `removeLocationRelation(client, kind, locationId, entityId)`
  - `listEntityOptions(client, kind)` → searchable entity picker source
- Server Actions (`apps/admin/src/app/library/actions.ts`): reuse the Phase 17 `authorize(permission)` prelude; new relation actions `addRelation`, `updateRelation`, `removeRelation` gate on `'edit'`.
- Registry: extend `editor` union to `'character' | 'item' | 'document' | 'evidence' | 'location'`; set `editor: 'location'` on the `locations` adapter.
- Route branches: `[entity]/new/page.tsx`, `[entity]/[id]/edit/page.tsx` render `LocationForm` when `editor === 'location'`; `[entity]/[id]/page.tsx` renders relation panels for locations.

## 10. Validation

- **Entity scalar:** reuse content-schema `locationDraftSchema` via existing `validateDraft` (name length, enum type, uuid parentId).
- **Parent/child (Phase 22 minimal):** reject `parentId === own id`; reject selecting a descendant as parent (walk ancestor chain of the candidate parent; reject if it contains the edited location). Deeper DAG validation is Phase 26 scope.
- **Relation:** entity must exist; `UNIQUE(location_id, entity_id)` duplicate rejection; per-kind allowed-config whitelist (see §7); numeric bounds for min/max quantity; `role`/`importance`/`discovery_method` remain nullable text (typed unions deferred).
- **Permissions:** every mutation re-authorizes server-side; review role = read-only.

## 11. UI Architecture

- `apps/admin/src/components/location/LocationForm.tsx`: name, type (enum select), description, parent selector (searchable, excludes self/descendants), asset. Register `editor: 'location'`.
- `apps/admin/src/components/location/LocationRelations.tsx`: five panels (Available characters / items / documents / evidence / cases). Each panel lists relations with editable config fields, an ADD row with entity search, and REMOVE. Panel visibility gated by `roleHasPermission(role, 'edit')` for write controls (server action still enforces).
- Detail page `[entity]/[id]/page.tsx`: entity metadata + relation panels for `entity === 'location'`.
- No changes to shared-types, content-schema, game-rules, or runtime packages — relations are admin-managed rows only; game-rules/runtime do not read them.

## 12. Mutation Semantics

- Entity CRUD for locations continues through the existing generic `mutate.ts` (`createEntity`/`updateEntity`/`duplicateEntity`/`archiveEntity`) with `validateDraft`; the specialized form feeds `formDataToValues`.
- Relation writes use `location-relations.ts` directly (single-row DML), not `mutate.ts`.
- Every write returns the same `LibraryFormState`-style error shape used by Phases 17–21 (`Validation` / `PermissionDenied` / `Database`).

## 13. Migration / Grants

Phase 22 requires the **smallest additive migration**: `0024_location_relations_management.sql`, service_role only, no anon/authenticated, no RLS policies, no `case_instances`/`chapter_locations` changes.

```sql
-- 0024_location_relations_management.sql
-- Phase 22 Admin Location Management: give service_role SELECT on location_cases
-- (missing from 0020-0023) and INSERT/UPDATE/DELETE on all five location
-- relation tables so the admin can manage "Available X" relations.
-- service_role only; no anon/authenticated; no RLS policies;
-- case_instances untouched (D4); chapter_locations untouched (out of scope).

grant select on table public.location_cases to service_role;

grant insert, update, delete on table public.location_characters to service_role;
grant insert, update, delete on table public.location_items to service_role;
grant insert, update, delete on table public.location_documents to service_role;
grant insert, update, delete on table public.location_evidence to service_role;
grant insert, update, delete on table public.location_cases to service_role;
```

Rationale: SELECT grants on `location_characters/items/documents/evidence` already exist (0020–0023) — not re-granted. `location_cases` has zero grants, so SELECT is added and it is included in the DML grant. No column-level grants needed (relation rows are whole-row managed).

## 14. Security

- All grants service_role only. `pg_policies` stays 0; anon/authenticated DML in `public` stays 0.
- Every Server Action re-authorizes server-side via token-verified user → role → `roleHasPermission`.
- Relation REMOVE cannot delete entities (admin never issues entity DELETE; DB `on delete restrict` is the backstop).
- No secrets, no new env vars, no schema exposure.

## 15. Testing Strategy

- **Unit (Vitest, fake `libraryServiceClient`):** `apps/admin/test/library/location-relations.test.ts` — get (grouped panels + titles), add (insert + duplicate rejection), update (config only), remove (row-only), per-kind config whitelist, parent/child self/descendant guard. TDD red→green before implementation (mirrors Phase 21 `evidence-usage.test.ts`).
- **Registry:** assert `editor: 'location'` present and union extended.
- **Existing suites must stay green:** admin unit (currently 127), shared-types, content-schema, game-rules, runtime.
- **DB:** `supabase db reset` 0001→0024; verify grant matrix (location_cases SELECT + DML on five tables; no anon/authenticated; policies 0; `case_instances`/`chapter_locations` untouched). Re-provision the four roles.
- **Type/lint/build:** `tsc --noEmit`, eslint, prettier, production build.

## 16. E2E Strategy

New `scripts/e2e-location.py` (Playwright, port 3001), mirroring `e2e-evidence.py`:

- SUPER_ADMIN: create location (name/type/asset), set parent, edit, verify hierarchy display.
- Relation panels: add character/item/document/evidence/case; edit config (availability, weight, sort_order); remove.
- Parent guard: reject self-parent and descendant-parent.
- REVIEWER: read-only (no add/edit/remove controls; server rejects direct calls).
- EDITOR: can add/edit/remove relations; cannot archive.
- CONTENT_ADMIN: full CRUD + relations.

Existing e2e suites (library 47, character 24, item 26, document 26, evidence 37) must stay green.

## 17. Phase 23+ Compatibility

- **Phase 23 (Admin Case Builder)** builds on the same relation-write architecture: `case_characters/items/documents/evidence` gain DML grants and ADD/EDIT/REMOVE panels in the case editor; `case_locations` has no table (TODO.md:251) so "case locations" must map to `location_cases` (the inverse relation managed here) or await a future additive migration. Visual builder sections (Dialogues/Missions/Rules/Rewards/Preview/Validation/Publish) have no tables yet — deferred.
- **Chapter management** (read `chapter_locations`/`chapter_cases`) remains future; this phase does not grant or touch those tables.
- The Phase 22 relation helper is written generically (kind-based) so Phase 23 can extend it to `case_*` without rework.

## 18. Contradictions / Open Decisions (C1–C10)

### C1 — Prompt scope vs TODO scope

- **FACT:** The design prompt titled Phase 22 "Admin Case Builder / Relation Management". TODO.md:820 defines Phase 22 as **ADMIN LOCATION MANAGEMENT**; Phase 23 (line 846) is the visual Case Builder.
- **IMPACT:** A Case Builder design now would duplicate Phase 23 and skip the location relation surface.
- **RECOMMENDATION:** Phase 22 = Admin Location Management (this document). Case Builder deferred to Phase 23.
- **DECISION REQUIRED:** Confirm scope = Location Management.

### C2 — No `case_locations` table

- **FACT:** `case_locations` does not exist and is deferred (TODO.md:251). `location_cases` is the only case↔location relation.
- **IMPACT:** "Available cases" must be managed via `location_cases`; case→location linking happens here (inverse of a case-side picker).
- **RECOMMENDATION:** Manage `location_cases` in Phase 22; revisit case-side mapping in Phase 23.
- **DECISION REQUIRED:** Accept `location_cases` as the Phase 22 "Available cases" surface.

### C3 — location_cases has zero grants

- **FACT:** Live grants show `location_cases` = `REFERENCES, TRIGGER, TRUNCATE` only (no SELECT, no DML).
- **IMPACT:** "Available cases" cannot even be read without a grant.
- **RECOMMENDATION:** Migration 0024 adds SELECT + DML on `location_cases` (service_role only).
- **DECISION REQUIRED:** Approve 0024 grant additions.

### C4 — No DML grants on the other four relation tables

- **FACT:** `location_characters/items/documents/evidence` have SELECT (0020–0023) but zero INSERT/UPDATE/DELETE.
- **IMPACT:** Relation ADD/EDIT/REMOVE is impossible without DML grants.
- **RECOMMENDATION:** 0024 grants INSERT/UPDATE/DELETE on all five (service_role only).
- **DECISION REQUIRED:** Approve relation-write DML grants.

### C5 — Relation config editing scope

- **FACT:** Relation rows carry generation/rule-engine fields (`conditions`, `hidden`, `discovery_method`, `discovery_condition`) owned by later phases (9/10/11).
- **IMPACT:** Editing those now would create a half-baked UI for rule-engine-owned data.
- **RECOMMENDATION:** Phase 22 edits `availability`, `weight`, `spawn_probability`, min/max quantity, `role`, `importance`, `priority`, `sort_order`; defers conditions/discovery/hidden.
- **DECISION REQUIRED:** Accept the editable-config whitelist.

### C6 — Parent/child cycle prevention

- **FACT:** DB has `ON DELETE SET NULL` but no cycle guard.
- **IMPACT:** Without a guard, a hierarchy could become cyclic.
- **RECOMMENDATION:** Phase 22 rejects self-parent and descendant-parent (ancestor-chain walk). Full DAG validation deferred to Phase 26.
- **DECISION REQUIRED:** Accept the minimal parent guard.

### C7 — Relation write permission gating

- **FACT:** Phase 15 matrix has no relation-specific permission; EDITOR can edit but not archive.
- **IMPACT:** Relation mutations must be gated consistently.
- **RECOMMENDATION:** Gate RELATION ADD/EDIT/REMOVE on `edit` (SUPER_ADMIN/CONTENT_ADMIN/EDITOR); REVIEWER read-only.
- **DECISION REQUIRED:** Accept `edit` gating for relation mutations.

### C8 — Specialized location form necessity

- **FACT:** Generic Phase 17 CRUD already handles locations scalars (registry fieldMap/enumOptions).
- **IMPACT:** Only the parent selector + readable parent display need a specialized form.
- **RECOMMENDATION:** Add `editor: 'location'` + `LocationForm` (parent selector with self/descendant exclusion); reuse generic mutation path.
- **DECISION REQUIRED:** Accept the specialized form scope.

### C9 — Entity delete safety on relation removal

- **FACT:** Admin never deletes entities (archive only); relation FKs are `on delete restrict`.
- **IMPACT:** REMOVE must delete only the relation row.
- **RECOMMENDATION:** `removeLocationRelation` issues `DELETE` on the relation table only; no entity delete in the flow.
- **DECISION REQUIRED:** Accept relation-row-only removal.

### C10 — Design-document filename mismatch

- **FACT:** The prompt mandated the file `2026-08-14-phase22-admin-case-builder.md`, but the actual scope is Location Management; the repo convention (phase18–21) names docs `phaseNN-admin-*-management.md`.
- **IMPACT:** A "case-builder"-named file containing Location Management design is confusing for future phases.
- **RECOMMENDATION:** Rename to `2026-08-14-phase22-admin-location-management.md`.
- **DECISION REQUIRED:** Approve the rename (or keep the mandated name).

## 19. Self-Review Against Actual Repository

- ✅ `HEAD == origin/main`, tree clean, migrations 0001–0023 present.
- ✅ `locations` schema, `location_type` enum, self-FK, content grants verified from 0007/0018/0019.
- ✅ Five relation tables + config columns verified from 0013 and shared-types `relations.ts`.
- ✅ Grants verified live: SELECT on chars/items/docs/evidence (0020–0023); `location_cases` zero; no DML on any relation table; policies 0; anon/authenticated DML in `public` 0.
- ✅ Registry `locations` adapter exists (`fieldMap`, `enumOptions.type`, `requiredFields`) with no `editor` flag yet; `editor` union is `'character' | 'item' | 'document' | 'evidence'` — adding `'location'` is additive.
- ✅ No `location-relations.ts`, no `LocationForm`, no `LocationRelations` exist today.
- ✅ e2e-library.py has zero location coverage — new `e2e-location.py` required.
- ✅ content-schema `locationDraftSchema` covers name/type/description/parentId/asset — no content-schema change needed.
- ✅ game-rules/runtime do not read location relation tables — no shared-package change needed.
- ✅ Migration style matches 0020–0023 (grant statements, service_role only, rationale header).

## 20. Conclusion

Phase 22 = **Admin Location Management** (per TODO.md:820). Scope: location entity parent/child, type, and asset via a specialized `editor: 'location'` form, plus full management of the five `location_*` relation tables (Available characters / items / documents / evidence / cases) with service_role-only migration 0024 (SELECT on `location_cases`, DML on all five). Relation writes gate on `edit`; REVIEWER is read-only. The visual Case Builder is Phase 23 and is preserved for that phase. All design decisions are registered in C1–C10.

**DESIGN ONLY — implementation has not started.** This document is the complete Phase 22 design, awaiting approval before any code, migration, TODO edit, or commit.
