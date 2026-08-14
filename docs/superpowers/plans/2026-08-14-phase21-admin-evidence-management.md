# Phase 21 — Admin Evidence Management

> **Status:** IMPLEMENTED — approved and completed (commits `docs: add phase 21 evidence management design` + `feat(admin): implement phase 21 evidence management`, pushed to `main`). The design below was implemented exactly as specified, including the six approved conflict closures (C1–C6): discovery method relation-contextual read-only; conditions deferred; dependencies/related items/documents/characters deferred; migration 0023 = exactly two service_role SELECT grants; related cases read-only; sequential-query + TS-join usage helper. This design spec is grounded in the repository state at `763324391e5ffb3f1bd0779d20f6ae73c1e44fe9` (`main`, Phase 20 committed and pushed, clean tree) and in live-DB privilege checks (local Supabase, migrations 0001–0023 applied).
>
> **Scope:** A server-side, role-gated **Evidence editor** that deepens the generic Phase 17 `evidence` entity page into a per-entity editor for the fields TODO Phase 21 lists (evidence editor, type, importance, discovery method, conditions, dependencies, related items/documents/characters/cases). It reuses the Phase 15 auth + RBAC plumbing, the Phase 16/17 service-role data-access pattern, the Phase 17 registry/form scaffolding, and the Phase 18/19/20 "specialized form + read-only usage list + additive relation-SELECT migration" pattern — and it **defers the parts of the TODO list that have no backing store** to their owning phases (§5), exactly as Phases 18/19/20 deferred their out-of-scope surfaces.
>
> **Explicitly OUT of scope (deferred with owning phases):** per-entity editors for the remaining entities (Phases 22–23/25), the visual Case Builder (Phase 23), rich asset **upload** (no storage bucket exists), content validation engine (Phase 26), full revision history (Phase 27), release/publish (Phase 28), audit (Phase 40), analytics (Phase 41/42). Phase 21 manages the `evidence` row's scalar content fields and its **read-only usage relationships**.

---

## 1. Status / Scope

**Status:** IMPLEMENTED. Completed and pushed to `main` (commits `docs: add phase 21 evidence management design` + `feat(admin): implement phase 21 evidence management`). This document is the Phase 21 design record.

**Scope (this phase):** replace the generic Phase 17 `evidence` create/edit form with a purpose-built Evidence editor that (a) provides a labeled, field-specific editing experience for the scalar columns that exist, and (b) surfaces the evidence's **relationships** — where it is referenced in locations, cases, and chapters (read-only usage list). Phase 21 must not start any later phase (22+ per-entity editors, 23 case builder, 26 validation, 27 versioning, 28 release) and must not modify any shared package.

---

## 2. Exact TODO Phase 21 Mapping

TODO.md §21 (lines 798–809):

> # PHASE 21 — ADMIN EVIDENCE MANAGEMENT
>
> - [ ] Evidence editor.
> - [ ] Type.
> - [ ] Importance.
> - [ ] Discovery method.
> - [ ] Conditions.
> - [ ] Dependencies.
> - [ ] Related items.
> - [ ] Related documents.
> - [ ] Related characters.
> - [ ] Related cases.

**Grounding check — what the TODO asks vs what exists (verified against migrations 0001–0022, live DB, and package sources):**

| TODO §21 item      | Backing store today                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Phase 21 disposition                                                                                                                                                                                                                                             |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Evidence editor    | `evidence` entity (0006) — editable via Phase 17 generic form today; registry `evidence` adapter present with `editor` flag **absent**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | **Implement** as a labeled specialized `EvidenceForm` (§6)                                                                                                                                                                                                       |
| Type               | `evidence.type` — **SQL enum `evidence_type`** (`physical`/`digital`/`documentary`/`forensic`/`testimony`, 0006:8); shared-types `EVIDENCE_TYPES` (enums.ts:20); content-schema `evidenceTypeSchema`; adapter `enumOptions.type` already wired                                                                                                                                                                                                                                                                                                                                                                                                             | **Implement** as an enum `<select>` (existing enum, no invention)                                                                                                                                                                                                |
| Importance         | `evidence.importance` — **SQL enum `evidence_importance`** (`low`/`medium`/`high`/`critical`, 0006:9); shared-types `EVIDENCE_IMPORTANCES` (enums.ts:29); content-schema `evidenceImportanceSchema`; adapter `enumOptions.importance` already wired                                                                                                                                                                                                                                                                                                                                                                                                        | **Implement** as an enum `<select>` (existing enum, no invention)                                                                                                                                                                                                |
| Discovery method   | **No `evidence.discovery_method` column.** `discovery_method` exists only as **free text (R4) on the relation tables**: `case_evidence.discovery_method` (0012:92) and `location_evidence.discovery_method` (0013:99). game-rules carries it unchanged (`evidence-selection.ts`); it is **not** a discovery-method-on-the-entity model.                                                                                                                                                                                                                                                                                                                    | **Partially implement — see §4/§6.** Discovery method is **contextual per relation** (a piece of evidence is discovered differently per case/location). Show it **read-only in the usage list** where the relation carries it. **Defer any entity-level store.** |
| Conditions         | **No `evidence.conditions` column.** `conditions` (jsonb) and `discovery_condition` (jsonb) exist only on the relation tables (`case_evidence` 0012:93–94, `location_evidence` 0013:100–103). They are **opaque and deferred to the Phase 11 rule engine** (`evidence-types.ts:32-33` — "discovery_condition and conditions are intentionally NOT part of the candidate: they are opaque and remain deferred to the Phase 11 rule engine").                                                                                                                                                                                                                | **Defer — no entity backing store; rule-engine-owned.** See §16.                                                                                                                                                                                                 |
| Dependencies       | **No `evidence_dependencies` table, no dependency column, no dependency concept anywhere** (searched shared-types, content-schema, game-rules, runtime, migrations).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | **Defer — no backing store anywhere.** Would require a new table + migration + Phase 40 audit surface. See §16.                                                                                                                                                  |
| Related items      | **No `evidence_items` table, no evidence↔item relation** (searched all packages + migrations).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | **Defer — no backing store.** Would require a new relation table (audit R1 territory) + reconciliation with Phase 22/23. See §16.                                                                                                                                |
| Related documents  | **No `evidence_documents` table, no evidence↔document relation** (searched all packages + migrations).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | **Defer — no backing store.** See §16.                                                                                                                                                                                                                           |
| Related characters | **No `evidence_characters` table, no evidence↔character relation** (searched all packages + migrations).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | **Defer — no backing store.** See §16.                                                                                                                                                                                                                           |
| Related cases      | **`case_evidence` relation table EXISTS** (0012:85–100): `case_id`, `evidence_id`, `role`, `weight`, `importance` (enum, nullable override), `discovery_method`, `discovery_condition`, `conditions`, `priority`, `version`; UNIQUE(case_id, evidence_id); RLS-enabled; index on evidence_id. **Used in Locations** via `location_evidence` (0013:90–108) and **Used in Chapters** via `chapter_cases` ∘ `case_evidence` (no `chapter_evidence` table — verified 0). **But `case_evidence` and `location_evidence` have ZERO service_role SELECT grant** (verified live; only REFERENCES/TRIGGER/TRUNCATE). `chapter_cases` already has SELECT (from 0020) | **Implement as read-only usage list** via a **new additive migration `0023`** granting service_role `SELECT` on `case_evidence` + `location_evidence` (§9). Shows where the evidence is referenced — nothing written. "Related cases" = Used in Cases.           |

**Phase 21 disposition summary:** 3 TODO items fully implementable from existing schema (editor, type, importance); 1 partially implementable read-only (discovery method via usage list); 1 implementable read-only (related cases = usage list); 5 deferred with no backing store (conditions, dependencies, related items/documents/characters).

---

## 3. Actual Schema Evidence

All verified against `backend/supabase/migrations/` and the live DB (local Supabase, 0001–0022 applied):

- **`evidence` (0006, verified):** `id uuid pk`, `name text not null`, `description text`, `type evidence_type not null default 'physical'`, `importance evidence_importance not null default 'medium'`, `status content_status not null default 'draft'`, `version int not null default 1`, `created_at/updated_at timestamptz`. Index `evidence_status_idx`; trigger `evidence_set_updated_at`. RLS enabled at `0010_rls.sql:9`. **service_role grants: SELECT (0018:38) + INSERT/UPDATE (0019:30) — verified live.** anon/authenticated: only Supabase-default REFERENCES/TRIGGER/TRUNCATE (0 DML — verified live).
- **`case_evidence` (0012:85–100, verified):** `case_id uuid not null refs cases on delete cascade`, `evidence_id uuid not null refs evidence on delete restrict`, `role text` (free text R4), `weight numeric not null default 1`, `importance evidence_importance` (nullable per-case override), `discovery_method text`, `discovery_condition jsonb`, `conditions jsonb not null default '[]'`, `priority int not null default 0`, `version int not null default 1`, timestamps; UNIQUE(case_id, evidence_id); index `case_evidence_evidence_id_idx`; RLS-enabled. **service_role SELECT: ZERO (verified live — only REFERENCES/TRIGGER/TRUNCATE).** No `required` boolean (evidence has no required/hidden flags on the case relation, unlike case_documents).
- **`location_evidence` (0013:90–108, verified):** `location_id uuid not null refs locations on delete cascade`, `evidence_id uuid not null refs evidence on delete restrict`, `availability boolean not null default true`, `weight numeric not null default 1`, `spawn_probability numeric not null default 1`, `role text`, `importance evidence_importance`, `discovery_method text`, `discovery_condition jsonb`, `priority int not null default 0`, `sort_order int not null default 0`, `conditions jsonb not null default '[]'`, `version int not null default 1`, timestamps; UNIQUE(location_id, evidence_id); index `location_evidence_evidence_id_idx`; RLS-enabled. **service_role SELECT: ZERO (verified live).**
- **`chapter_cases` (0015, verified):** `chapter_id`, `case_id`, `sort_order`, `version`; UNIQUE(chapter_id, case_id); index on case_id; RLS-enabled. **service_role SELECT present (from 0020) — verified live.** **No `chapter_evidence` table exists** (verified live: 0).
- **`cases` (0011 + 0016, verified):** `id`, `title text not null`, `description`, `status`, `version`, timestamps, plus `type`, `difficulty`, `min_character*/max_character*`, `min_items/max_items`, `min_documents/max_documents`, `min_evidence/max_evidence` (0016). `title` is the join target for the usage list.
- **`locations` (0007, verified):** `id`, `name text not null`, `type location_type not null default 'area'`, `description`, `parent_id`, `asset`, `status`, `version`, timestamps. `name`/`type` are the join targets for the usage list.
- **RLS posture (verified live):** `pg_policies` in `public` = **0**. anon/authenticated DML on ALL public tables = **0**. `case_instances` untouched (REFERENCES/TRIGGER/TRUNCATE only). `auto_expose_new_tables` unset (config.toml:24).
- **shared-types (verified):** `Evidence` interface = `{ name, description|null, type, importance }` + ContentEntity (no discoveryMethod/conditions/dependencies). `EVIDENCE_TYPES`, `EVIDENCE_IMPORTANCES`, `EVIDENCE_ROLES` (`required/optional/decoy/hidden` — relation-level role typed in TS per R4). `relations.ts` has `CaseEvidence` (with `role`, `weight`, `importance|null`, `discoveryMethod`, `discoveryCondition`, `conditions`, `priority`) and `LocationEvidence` (with `availability`, `weight`, `spawnProbability`, `role`, `importance|null`, `discoveryMethod`, `discoveryCondition`, `priority`, `sortOrder`, `conditions`) but **no `EvidenceUsage` aggregate**.
- **content-schema (verified):** `evidenceSchema` + `evidenceDraftSchema` — name required (min1 max200), description nullable, `type` evidenceTypeSchema (5-way enum), `importance` evidenceImportanceSchema (4-way enum). **No discoveryMethod/conditions/dependencies fields.**
- **game-rules (verified):** `evidence-selection.ts` consumes **`case_evidence` only** (evidenceId, role, weight, importance|null, discoveryMethod, priority, version) as a pure function; `evidence-types.ts:32-33` explicitly defers `discovery_condition`/`conditions` to the Phase 11 rule engine; **never reads `location_evidence`**; pipeline carries role/importance/discoveryMethod unchanged. Phase 21 must not change `role`/`importance` semantics or add an `evidence` column the pipeline does not consume.
- **runtime (verified):** `schemas.ts` validates generated case snapshots (`generatedEvidenceSchema`: evidenceId, role, importance). Does not read the `evidence` entity directly. Untouched by Phase 21.

---

## 4. Existing Admin Architecture to Reuse

- **Auth gate:** `createClient()` (SSR) → `supabase.auth.getUser()` → `roleFromUser(user)` → `roleHasPermission(role, 'view'/'edit'/'create')`. Page gate + Server Action re-check (§11).
- **Service-role read/write:** `libraryServiceClient()` (`src/lib/library/client.ts`), server-only, never in a client component.
- **Generic library shell (Phase 17):** `/library` landing, per-entity list/detail/create/edit; `src/lib/library/registry.ts` (`EntityAdapter`), `query.ts`, `mutate.ts`, `validation.ts`; `src/app/library/actions.ts` (`authorize` + `createLibraryItem`/`updateLibraryItem`/`duplicateLibraryItem`/`archiveLibraryItem`); `src/components/library/EntityForm.tsx`; pages `/library/[entity]/new`, `/library/[entity]/[id]`, `/library/[entity]/[id]/edit`.
- **Specialized-editor + usage-list pattern (Phase 18/19/20, committed):** `CharacterForm`/`ItemForm`/`DocumentForm`, `character-usage.ts`/`item-usage.ts`/`document-usage.ts`, `CharacterUsageList`/`ItemUsageList`/`DocumentUsageList`, registry `editor?: 'character' | 'item' | 'document'` union + route dispatch, `test/library/{character,item,document}-usage.test.ts`, `scripts/e2e-character.py`/`e2e-item.py`/`e2e-document.py`.
- **Evidence adapter (Phase 17, verified `registry.ts:161-186`):** `fieldMap {name, description, type, importance}`, `requiredFields ['name']`, `multilineFields ['description']`, `enumOptions {type: EVIDENCE_TYPES, importance: EVIDENCE_IMPORTANCES}`, `listColumns [{type},{importance}]`, `draftSchema evidenceDraftSchema`. **No `editor` flag** — Phase 21 adds `editor: 'evidence'` and extends the union to `'character' | 'item' | 'document' | 'evidence'`.
- **Version badge + lifecycle:** detail page renders `version` read-only and gates Duplicate/Archive (Phase 17).
- **Admin app conventions:** Next 16.3.0, React 19.2.8, Tailwind v4, `<html lang="tr">` (avoid CSS `uppercase`); extensionless imports in `src/`, `.js` in tests; `params` are Promises; Server Actions use `redirect` outside `try/catch`.

---

## 5. Proposed UX / Pages / Routes

- **`/library/evidence`** — list page (unchanged, Phase 17).
- **`/library/evidence/new`** — renders `EvidenceForm` (create mode) via the `editor === 'evidence'` branch, replacing the generic `EntityForm` (same `createLibraryItem` action). Route already exists; only the dispatch branch is added.
- **`/library/evidence/[id]`** — detail page; renders scalar fields + `EvidenceUsageList` (read-only, `view`-gated) via the `entity === 'evidence'` branch. Route already exists; only the dispatch + usage-load branch is added.
- **`/library/evidence/[id]/edit`** — renders `EvidenceForm` (edit mode) via the `editor === 'evidence'` branch, same `updateLibraryItem` action. Route already exists.
- **No new routes, no new nav.** The generic library nav (`/library`) already lists Evidence (Phase 17).

**New components:** `src/components/evidence/EvidenceForm.tsx`, `src/components/evidence/EvidenceUsageList.tsx`. **New helper:** `src/lib/library/evidence-usage.ts`. **Modified pages:** `new/page.tsx`, `[id]/edit/page.tsx`, `[id]/page.tsx` (branch additions only), `registry.ts` (union + flag).

---

## 6. Entity-Specific Fields and Forms

**`EvidenceForm`** (client component, mirrors `ItemForm`/`DocumentForm` exactly):

- Field keys are the `evidence` adapter keys (`name`, `description`, `type`, `importance`) so `validateDraft` + `mutate.ts` work unchanged — same contract as Phases 18/19/20.
- **Name** — text input, required (`REQUIRED = { name: true }`, matches adapter `requiredFields`).
- **Type** — enum `<select>` from `EVIDENCE_TYPES` (physical/digital/documentary/forensic/testimony) via `ENUM_OPTIONS = { type: EVIDENCE_TYPES }`, imported from `@gate8/shared-types` (the same import `registry.ts:2-3` already uses).
- **Importance** — enum `<select>` from `EVIDENCE_IMPORTANCES` (low/medium/high/critical) via `ENUM_OPTIONS.importance`.
- **Description** — multiline `<textarea>`.
- **Groups:** `[{ title: 'Identity', fields: ['name'] }, { title: 'Classification', fields: ['type', 'importance'] }, { title: 'Profile', fields: ['description'] }]`.
- **No asset field** — the `evidence` entity has **no `asset` column** (verified 0006). No upload surface is invented.
- **No discovery-method/conditions/dependencies/related fields in the form** — no entity backing store (§2, §16).

**Usage list (read-only)** on the detail page:

- **Used in Cases** (`case_evidence` → `cases`): shows the case title (link to `/library/cases/[id]`) plus per-relation `role` (required/optional/decoy/hidden free text), `importance` (per-case override, nullable), and `discovery_method` (free text). **Note:** `case_evidence` has no `required` boolean and no `hidden` flag (unlike case_documents) — verified 0012:85-100. Do not invent those.
- **Used in Locations** (`location_evidence` → `locations`): shows the location name (link to `/library/locations/[id]`) plus `type`, per-relation `role`, `importance` override, and `availability`.
- **Used in Chapters** (`chapter_cases` ∘ `case_evidence`): indirect — chapters list the cases that use the evidence; there is **no `chapter_evidence` table** (verified 0). Label as derived via cases.

**Field/usage surfaces verified for joins:** `cases.title` (0011), `locations.name`/`locations.type` (0007), `chapters.title` (0014 — verified via Phase 18 usage helper which already joins `chapters.title`).

---

## 7. Read / Write Behavior

- **Writes:** the Evidence editor writes ONLY the `evidence` row's scalar columns via the existing `createLibraryItem`/`updateLibraryItem` server actions → `mutate.ts` → service-role client → `INSERT`/`UPDATE` on `evidence` (granted by 0019). Version bump on edit (existing `mutate.ts` behavior). Duplicate/Archive via existing actions (existing behavior). **No relation writes.**
- **Reads:** entity scalar read via `getEntity` (existing); usage reads via the new `getEvidenceUsage(client, id)` server-only helper in `src/lib/library/evidence-usage.ts`, which runs read-only, whitelisted-column queries against `case_evidence`, `cases`, `chapter_cases`, `chapters`, `location_evidence`, `locations` — mirroring `character-usage.ts`/`item-usage.ts`/`document-usage.ts` (sequential queries + TS join, no raw SQL, no `join` in PostgREST). **No relation writes, no `case_instances` reads.**

---

## 8. Existing Relation / Usage Data

Verified live and in migrations:

- `case_evidence` — 0 service_role SELECT (only REFERENCES/TRIGGER/TRUNCATE). **Grant needed (§9).**
- `location_evidence` — 0 service_role SELECT (only REFERENCES/TRIGGER/TRUNCATE). **Grant needed (§9).**
- `chapter_cases` — service_role SELECT present (0020). **No re-grant.**
- No `chapter_evidence` table (0). No `evidence_items`/`evidence_documents`/`evidence_characters`/`evidence_dependencies` tables (0 — searched all migrations + packages).
- RLS: 0 policies; anon/authenticated 0 DML; `case_instances` untouched.

---

## 9. Proposed Migration(s) — only if actually required

**One additive migration IS required** and is an infrastructure prerequisite (parallel to 0020/0021/0022):

`0023_evidence_usage_reads.sql` — grant base `SELECT` to `service_role` on the two relation tables the read-only usage list queries that currently lack it:

- `case_evidence` (Used in Cases; also feeds Used in Chapters via `chapter_cases`)
- `location_evidence` (Used in Locations)

`chapter_cases` already has SELECT (from 0020) — **do not re-grant**.

**Why an existing grant cannot satisfy this:** 0018 granted SELECT to service_role on the **9 content tables only** (not relations); 0020/0021/0022 granted the character/item/document relation tables; `case_evidence` and `location_evidence` are the only evidence relations and still hold 0 SELECT (verified live). Without this grant the usage queries fail with `permission denied for table`.

**Exact SQL (additive; SELECT only; service_role only; no anon/authenticated; no RLS policies; no `case_instances`; no other relation tables):**

```sql
-- 0023_evidence_usage_reads.sql
-- Grant base SELECT on the relation tables the Phase 21 read-only Evidence
-- usage list queries (Used in Locations / Cases / Chapters). service_role
-- only, mirroring the 0020/0021/0022 approved deviations; no
-- anon/authenticated, no INSERT/UPDATE/DELETE, no RLS policies.
-- `chapter_cases` already has SELECT from 0020 (no re-grant).
-- `case_instances` untouched (D4).

grant select on table public.case_evidence to service_role;
grant select on table public.location_evidence to service_role;
```

**Privilege recipients:** `service_role` only — `SELECT` on `case_evidence` and `location_evidence`.

**anon/authenticated:** unchanged (0 DML; verified live both before and after in the verification plan).

**RLS policies:** remain zero (`pg_policies` in `public` stays 0; migration adds no policy).

**`case_instances`:** untouched (0 grants; no DML; Phase 15 D4 preserved).

**Verification plan (implementation time, from clean DB):**

1. `supabase db reset` (0001→0023 applies cleanly).
2. service_role can `SELECT` on `case_evidence`, `location_evidence`, `chapter_cases`; the 9 content tables still have their 0018/0019 grants; relation tables get **no INSERT/UPDATE/DELETE**.
3. anon/authenticated still 0 DML; `pg_policies` in `public` still 0.
4. `case_instances` untouched (0 grants).
5. Reproducible on a second fresh reset.

---

## 10. Service-Role Grants and Security Implications

- New grant surface: service_role `SELECT` on `case_evidence` + `location_evidence` (additive, §9). No other grants added. No grants removed.
- **RLS default-deny preserved:** zero policies (0010 + per-table `enable row level security` stay zero-policy); no anon/authenticated DML; no INSERT/UPDATE/DELETE on relations (Phases 22/23 own relation writes and their grants).
- **`case_instances` untouched** (Phase 15 D4) — no grant, no read, no write.
- **Service-role key stays server-only**; no client component imports `admin.ts`; the browser never queries relation tables (D3a).
- **Server-side enforcement preserved:** every mutation re-runs `authorize()` in `actions.ts` before any DB write; UI hiding is UX only.

---

## 11. Role / Permission Matrix

- **No new permission.** The evidence editor uses the existing `create`/`edit`/`view` gates; the usage list is `view`-gated (all four roles see it read-only). No shared-types change (`ROLE_PERMISSIONS` untouched).
- Existing matrix (verified `enums.ts`): SUPER_ADMIN = view/create/edit/delete/publish/rollback; CONTENT_ADMIN = view/create/edit/delete/publish; EDITOR = view/create/edit; REVIEWER = view.
- **REVIEWER** sees the evidence editor fields read-only / cannot submit; usage list visible. **EDITOR** can create/edit. **CONTENT_ADMIN/SUPER_ADMIN** per matrix. All enforced server-side (page gate + Server Action `authorize`).

---

## 12. Validation Rules

- **Author-input validation:** `evidenceDraftSchema` via the existing `validateDraft` (`src/lib/library/validation.ts`), unchanged: `name` required (min 1, max 200); `description` nullable; `type` ∈ {physical, digital, documentary, forensic, testimony}; `importance` ∈ {low, medium, high, critical}. Field-error map rendered inline by `EvidenceForm`.
- **No new validation surface.** No conditions/dependencies validation (deferred — rule engine/Phase 26 territory).

---

## 13. Error Handling

- **Read failures** (usage queries): `getEvidenceUsage` throws a typed `Database` error mirroring `character-usage.ts`/`item-usage.ts`/`document-usage.ts` (`{ kind: 'Database', detail }`); the detail page catches and renders the usage section as `null` (same pattern as `entity === 'items'`/`'documents'` branches, `page.tsx:88-95`).
- **Mutation failures:** existing Phase 17 `LibraryFormState` contract (`Validation` field errors / `PermissionDenied` / `Database` / generic) rendered by `EvidenceForm` via `topError` — same as `ItemForm`.
- **Not-found:** unknown id → `notFound()` (existing route behavior).
- **Unauthorized:** page gate + Server Action `authorize` (existing Phase 15/16/17 pattern).

---

## 14. Test Strategy

- **Unit (Vitest, fake client):** `apps/admin/test/library/evidence-usage.test.ts` mirroring `document-usage.test.ts` — 6 tests: empty relations → `{locations, cases, chapters}` all `[]`; no cases/chapters queries when no relations; builds cases + indirect chapters usage (role/importance/discovery_method carried); builds locations usage (role/importance/availability); `(untitled)` fallback for missing case row; Database error on relation read failure. **TDD RED→GREEN.**
- **Typecheck / lint / prettier:** `tsc --noEmit`, `eslint`, `prettier --check` on changed files (production build + full suite as regression).
- **No shared package tests touched** (shared-types/content-schema/game-rules/runtime unchanged).

---

## 15. E2E Strategy

- **`scripts/e2e-evidence.py`** (Python Playwright, mirrors `e2e-document.py`, run with `~/.claude/skills/seo/.venv/bin/python`):
  - unauth `/library/evidence/[id]` → `/login`
  - SUPER_ADMIN creates evidence via labeled `EvidenceForm` (Name/Type/Importance/Description; Type/Importance render as selects); create → draft v1; empty usage state
  - edit bumps to v2
  - seed `location_evidence` (role 'decoy', availability false), `case_evidence` (role 'required', importance 'high', discovery_method), and `chapter_cases` → verify Usage sections render (Used in Locations / Cases / Chapters), roles + importance + discovery method shown, chapter listed indirectly; cleanup seeded rows
  - REVIEWER sees usage list, no Edit/Duplicate/Archive
  - unknown id → not-found
- **Regression:** `e2e-library.py` (47), `e2e-character.py` (24), `e2e-item.py` (26), `e2e-document.py` (26). Evidence is **not** currently covered by `e2e-library.py` (verified 0 hits) — the new script closes that gap.
- **Credentials (exact, must be used after any db reset):** super@gumruk.local/Sup3rAdminP@ss2026 (SUPER_ADMIN), contentadmin@gumruk.local/C0ntentAdminP@ss2026, editor@gumruk.local/Ed1torP@ss2026, reviewer@gumruk.local/Rev1ewerP@ss2026. Provision via `node scripts/provision-admin.mjs` with `set -a; source apps/admin/.env; set +a`.

---

## 16. Explicitly Deferred Items

- **Discovery method (entity-level, TODO line 802):** no `evidence.discovery_method` column. Discovery is **contextual per relation** (`case_evidence.discovery_method` / `location_evidence.discovery_method`, free text R4). Phase 21 surfaces it read-only in the usage list; **any entity-level discovery-method store is deferred** (would change the R4 model and game-rules contract).
- **Conditions (TODO line 803):** no `evidence.conditions` column. `conditions`/`discovery_condition` are jsonb on the relation tables and are **opaque, deferred to the Phase 11 rule engine** (`evidence-types.ts:32-33`). No admin editing surface. Phase 21 does not touch them.
- **Dependencies (TODO line 804):** no `evidence_dependencies` table or dependency concept anywhere. Implementing would require a **new table** + migration + shared-types/content-schema surface + Phase 40 audit. **Defer** — no owning phase named in TODO.
- **Related items / documents / characters (TODO lines 805-807):** no `evidence_items`/`evidence_documents`/`evidence_characters` tables exist. Evidence relations in the schema are only `case_evidence` and `location_evidence` (audit R1: one relation per (parent, entity) pair; evidence is not a parent). **Defer** — inventing these now would conflict with Phase 22/23 relation writes and the R1 audit decision.
- **Relation writes** (creating `case_evidence`/`location_evidence` rows): Phase 22 Location Management / Phase 23 Case Builder.
- **Full revision history / publish / rollback:** Phases 27/28.
- **Content validation engine:** Phase 26 (Phase 21 runs only DraftSchema field checks).
- **Audit log / RLS grant matrix:** Phase 40.
- **Analytics / `case_instances` admin view:** Phases 41/42.

---

## 17. Phase Boundary — What Phase 21 Must NOT Implement

- **No `evidence_items`/`evidence_documents`/`evidence_characters`/`evidence_dependencies` tables or columns** — none exist; inventing them violates instruction #6 and the R1 audit decision.
- **No entity-level `discovery_method`, `conditions`, `dependencies`, or related-entity fields** — no backing store; changing `Evidence` semantics would break game-rules/runtime contracts.
- **No relation writes** (case_evidence/location_evidence INSERT/UPDATE/DELETE) — those are Phase 22/23.
- **No `case_instances` read or write** (Phase 15 D4).
- **No RLS policies, no anon/authenticated grants, no relation INSERT/UPDATE/DELETE grants.**
- **No changes to `packages/shared-types`, `packages/content-schema`, `packages/game-rules`, `packages/runtime`, `config.toml`.**
- **No Phase 22+ work** (locations hierarchy, case builder, evidence validation engine, versioning, release, audit, analytics).
- **No TODO.md edits, no commit/push** in this design phase.

---

## 18. Conflicts / Open Decisions Requiring Approval

1. **TODO §21 "Discovery method" is not an evidence attribute.** `discovery_method` is contextual per relation (`case_evidence.discovery_method` / `location_evidence.discovery_method`, free text R4). **Recommendation:** Phase 21 shows it read-only in the usage list; no entity-level store. **If you want an entity-level discovery method, that changes the R4 model and needs a new column + game-rules contract change — say so.**
2. **TODO §21 "Conditions" has no entity backing store.** Conditions are relation jsonb, opaque, rule-engine-owned (Phase 11). **Recommendation:** defer. **If you want conditions editable in Phase 21, that is a new entity surface + rule-engine integration — say so.**
3. **TODO §21 "Dependencies" and "Related items/documents/characters" have no backing store anywhere.** **Recommendation:** defer all four. **If you want any of them in Phase 21, that is a new table (or tables) + migration + shared-types/content-schema surface + reconciliation with Phase 22/23 relation writes and the R1 audit decision — say so.**
4. **Migration `0023` grants relation SELECT** (required for the read-only usage list) — a new grant surface on `case_evidence` + `location_evidence` (SELECT-only, service_role-only, no policies, parallel to approved 0020/0021/0022). **If you prefer the usage list deferred or the relations to remain un-granted, say so.**
5. **"Related cases" is read-only usage here.** The case↔evidence relation (`case_evidence`) exists and is shown read-only (Used in Cases). Creating/editing those rows (per-case role/importance/discovery/conditions) is **Phase 23 Case Builder** territory. **If you want relation editing in Phase 21, that is a scope change to Phase 23 — say so.**
6. **Usage-list join style (open, low-risk):** sequential whitelisted-column queries + TS join (matches the Phase 18/19/20 fake-client test pattern — recommended) vs `join` in PostgREST. Does not change architecture.

---

## 19. Self-Review Against Actual Repository

- ✅ **Grounded in the actual schema:** every TODO §21 item was mapped to a real column/table or explicitly deferred with the reason (no backing store / contextual per-relation model / rule-engine ownership). Verified live + against migrations 0001–0022.
- ✅ **No invented schema:** no `evidence_dependencies`/`evidence_items`/`evidence_documents`/`evidence_characters`/`chapter_evidence` tables, no `evidence.discovery_method`/`conditions` columns, no enums, no buckets, no APIs invented. Only the provable `0023` relation-SELECT grant is proposed (§9).
- ✅ **shared-types / content-schema / game-rules / runtime / config.toml unchanged.**
- ✅ **Phase 15 default-deny preserved:** 0 RLS policies, 0 anon/authenticated DML, only additive service_role SELECT on 2 relation tables, no relation writes.
- ✅ **`case_instances` untouched** (Phase 15 D4).
- ✅ **No Phase 26/27/28/36/38/40 scope leakage:** no validation engine, no versioning history, no publish/release, no audit, no analytics. (TODO has no Phase 36/38; the instruction's list is satisfied by deferral of every non-library surface.)
- ✅ **No deferred TODO item accidentally promoted:** conditions/dependencies/related-entity/discovery-method remain `[ ]` with grounded reasons.
- ✅ **No dependency-cycle risk:** Phase 21 is a leaf — changes no shared package; usage helper lives in `apps/admin` (YAGNI); no new cross-package imports.
- ✅ **No undocumented migration requirement:** the `0023` grant is documented with exact SQL, rationale, recipients, anon/authenticated unchanged, zero RLS policies, and `case_instances` untouched (§9/§10).
- ✅ **DESIGN ONLY:** no code, no migration file, no TODO.md edit, no commit/push. `git status` at handoff shows only this document as untracked.

---

## 20. Conclusion

Phase 21 delivers the **Admin Evidence editor**: a purpose-built, labeled editor for the existing `evidence` scalar fields (name, type, importance, description) reusing the Phase 17 library's validation, server actions, auth gate, and service-role data path — via the Phase 18/19/20 `editor`-flag dispatch — plus a **read-only usage list** (Used in Locations / Cases / Chapters, with per-relation role/importance/discovery-method shown read-only) driven by one new additive migration (`0023`) granting service_role `SELECT` on `case_evidence` + `location_evidence`, with **no change to any content package, no RLS policy, and `case_instances` untouched**. The TODO items without a backing store (conditions, dependencies, related items/documents/characters, entity-level discovery method) are **deferred with grounded reasons**, and the six scope conflicts are reported in §18 for your decision. **This document is a design record of the completed implementation (commits `docs: add phase 21 evidence management design` + `feat(admin): implement phase 21 evidence management`).**

---

## Appendix A — Implementation Outcome (approved decisions C1–C6 executed)

Approval delivered the six conflict closures explicitly (C1–C6); implementation followed them without deviation:

- **C1 (Discovery method relation-contextual, read-only):** implemented in `evidence-usage.ts` — `case_evidence.discovery_method` / `location_evidence.discovery_method` are read and displayed in the usage list as `discover: …`; no `evidence.discovery_method` column, no new table.
- **C2 (Conditions deferred):** no condition editor, no table/column, no normalization. The relation JSONB remains untouched (Phase 11 rule-engine owned). Verified absent from the form and detail page in e2e.
- **C3 (Dependencies / related items / documents / characters deferred):** no `evidence_dependencies`/`evidence_items`/`evidence_documents`/`evidence_characters` tables or columns created; no migrations for them; TODO keeps them unchecked with explicit deferred annotations.
- **C4 (Migration 0023):** `backend/supabase/migrations/0023_evidence_usage_reads.sql` contains exactly the two SELECT grants (`public.case_evidence`, `public.location_evidence`) to `service_role` — no INSERT/UPDATE/DELETE, no sequences, no anon/authenticated, no RLS policies, no `case_instances`, no `chapter_cases` re-grant. Verified via `supabase db reset` 0001→0023 and live `information_schema.role_table_grants`.
- **C5 (Related cases read-only):** usage list only (Used in Locations / Cases / Chapters); no relation-write UI; relation writes remain Phase 23 Case Builder.
- **C6 (Sequential + TS join):** `getEvidenceUsage` uses whitelisted-column sequential queries (relation link tables first, then join targets) with TS Map-based joining; no PostgREST embedded relations.

**Files (Phase 21):** created `apps/admin/src/lib/library/evidence-usage.ts`, `apps/admin/src/components/evidence/EvidenceForm.tsx`, `apps/admin/src/components/evidence/EvidenceUsageList.tsx`, `apps/admin/test/library/evidence-usage.test.ts`, `backend/supabase/migrations/0023_evidence_usage_reads.sql`, `scripts/e2e-evidence.py`; modified `apps/admin/src/lib/library/registry.ts` (editor union `'character' | 'item' | 'document' | 'evidence'` + `editor: 'evidence'`), `apps/admin/src/app/library/[entity]/new/page.tsx`, `apps/admin/src/app/library/[entity]/[id]/edit/page.tsx`, `apps/admin/src/app/library/[entity]/[id]/page.tsx` (evidence branches).

**Verification:** admin unit tests 127/127 (incl. 6 new evidence-usage); shared-types 19/19, content-schema 38/38, game-rules 1317/1317, runtime 27/27; `tsc --noEmit`, eslint, prettier, production build clean; e2e evidence 37/37 + library 47/47 + character 24/24 + item 26/26 + document 26/26; `supabase db reset` 0001→0023 clean with grant matrix verified (service_role SELECT on `case_evidence` + `location_evidence`, `chapter_cases` NOT re-granted, `case_instances` untouched, anon/authenticated DML 0, RLS policy count 0). TODO.md Phase 21 updated (implemented items checked, deferred items annotated); no shared package modified.
