# Phase 20 — Admin Document Management

> **Status:** IMPLEMENTED and pushed (`docs: add phase 20 document management design`, `feat(admin): implement phase 20 document management`, HEAD == origin/main). This document is the amended design record for the authenticated Admin Document editor for the Gümrük Kontrol Memuru CMS. It grounded every claim in the actual repository state at `7d93815` (`main`, Phase 19 committed and pushed, clean tree) and in live-DB privilege checks (local Supabase, migrations 0001–0021 applied); implementation added migration `0022_document_usage_reads.sql` (approved additive deviation granting service_role `SELECT` on `case_documents`/`location_documents`, §8).
>
> **Scope:** A server-side, role-gated **Document editor** that builds on the Phase 17 Content Library. It deepens the generic Phase 17 `documents` entity page into a per-entity editor for the fields TODO Phase 20 lists (document type, title, description, asset, fake/real classification, tags, usage relations). It reuses the Phase 15 auth + RBAC plumbing, the Phase 16/17 service-role data-access pattern, the Phase 17 registry/form scaffolding, and the Phase 18/19 "specialized form + read-only usage list + additive relation-SELECT migration" pattern — and it **defers the parts of the TODO list that have no backing store** to their owning phases (§5), exactly as Phase 18/19 deferred their out-of-scope surfaces.
>
> **Explicitly OUT of scope (deferred with owning phases):** per-entity editors for the other seven entities (Phases 21–23/25), the visual Case Builder (Phase 23), rich asset **upload** (no storage bucket exists; Phase 25 or a storage phase), content validation engine (Phase 26), full revision history (Phase 27), release/publish (Phase 28), audit (Phase 40), analytics (Phase 41/42). Phase 20 manages the `documents` row's scalar content fields and its **read-only usage relationships**.

---

## 1. Objective and TODO Mapping

TODO.md §20 (lines 777–786):

> # PHASE 20 — ADMIN DOCUMENT MANAGEMENT
>
> - [ ] Document editor.
> - [ ] Document type.
> - [ ] Title.
> - [ ] Description.
> - [ ] Asset.
> - [ ] Fake/real classification.
> - [ ] Tags.
> - [ ] Usage relations.

**Goal of this phase:** replace the generic Phase 17 `documents` create/edit form with a purpose-built Document editor that (a) provides an improved, labeled, field-specific editing experience for the scalar columns, and (b) surfaces the document's **relationships** — where it is referenced in locations, cases, and chapters (read-only usage relations). Phase 20 must not start any later phase (21+ per-entity editors, 23 case builder, 26 validation, 27 versioning, 28 release).

**Grounding check — what the TODO asks vs what exists:**

| TODO §20 item            | Backing store today                                                                                                                                                                                                                                                                                                                                                                    | Phase 20 disposition                                                                                                                                                                                                                                                          |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Title                    | `documents.title` (0005) — exists, already editable via Phase 17                                                                                                                                                                                                                                                                                                                       | **Implement** as a labeled editor field                                                                                                                                                                                                                                       |
| Document type            | `documents.type` (0005) — **free-form text** (content-defined: passport, invoice, license, …; R4); **no `document_type` enum table**, no `enumOptions` in the adapter (`enumOptions: {}`)                                                                                                                                                                                              | **Implement** as a labeled text field (free-form type per R4). No enum/store invented                                                                                                                                                                                         |
| Description              | `documents.description` (0005) — exists, nullable, already multiline in Phase 17                                                                                                                                                                                                                                                                                                       | **Implement** as a labeled multiline editor field                                                                                                                                                                                                                             |
| Asset                    | `documents.asset` (0005) — a **text URL/path** column; **no storage bucket, no upload infra** (config.toml `[storage.buckets]` commented out)                                                                                                                                                                                                                                          | **Implement as text** (`asset` URL/asset string, already validated by content-schema) — **no upload** (deferred)                                                                                                                                                              |
| Fake/real classification | **No `documents.role` / classification column.** `real`/`fake`/`decoy` is typed in shared-types (`DOCUMENT_ROLES`, enums.ts:55) but stored only as **free-text per-relation** on `case_documents.role` / `location_documents.role` (R4; Phase 9 §4: "A document can be _real_ in one case and _fake_ in another" — role is case/location-context-specific, never a document attribute) | **Partially implement — see §4.** A document's real/fake/decoy status is contextual per relation; there is no single "Fake/real" attribute. Show per-relation role read-only in the usage list. **Defer any document-level classification store** (would change the R4 model) |
| Tags                     | **No `tags` column, no `tags` table anywhere** (searched shared-types, content-schema, game-rules, runtime, migrations)                                                                                                                                                                                                                                                                | **Defer — no backing store.** Would require a new table + migration + Phase 40 audit surface. TODO line 784                                                                                                                                                                   |
| Usage relations          | Queryable read-only via `location_documents`, `case_documents`, and (for chapters) `chapter_cases` ∘ `case_documents`. **But `location_documents` and `case_documents` have ZERO service_role SELECT grant** (verified live; only REFERENCES/TRIGGER/TRUNCATE). `chapter_cases` already has SELECT (from 0020)                                                                         | **Implement as read-only** via a **new additive migration** granting service_role `SELECT` on the two relation tables lacking it (§8). Shows where the document is referenced — nothing written                                                                               |

---

## 2. Current State (verified at `7d93815`)

- **HEAD == origin/main == `7d93815f3731232caa4940d39798ecdc605295c9`; working tree clean.**
- Phase 15 (committed): admin auth (`@supabase/ssr` + `@supabase/supabase-js`), role claim in `app_metadata.role` only (D2), server-only service-role client `src/lib/supabase/admin.ts`, zero-policy RLS default-deny (D3a), `case_instances` admin = none (D4).
- Phase 16 (committed): read-only dashboard via service-role client; migration `0018_service_role_reads.sql` granted `SELECT` to service_role on the **9 content tables only** (not relations).
- Phase 17 (committed): the Admin Content Library — `/library` landing, per-entity list/detail/create/edit, generic adapter registry (`src/lib/library/registry.ts`), server actions (`actions.ts`), shared components (`src/components/library/`), service-role client typed as `LibraryClient` (`client.ts`), unit tests (`test/library/`), e2e (`scripts/e2e-library.py`). Migration `0019_content_library_writes.sql` granted `INSERT, UPDATE` to service_role on the **9 content tables only** (no DELETE, no relations, no `case_instances`).
- Phase 18 (committed): specialized **Character** editor + read-only usage list (Used in Locations / Cases / Chapters); migration `0020_character_usage_reads.sql` granted service_role `SELECT` on `case_characters`, `location_characters`, `chapter_cases`.
- Phase 19 (committed `7d93815`): specialized **Item** editor + read-only usage list (Used in Locations / Used by Characters / Used in Cases); migration `0021_item_usage_reads.sql` granted service_role `SELECT` on `case_items`, `location_items`. Registry gained `editor?: 'character' | 'item'` union; `editor: 'item'` dispatches the new/edit/detail pages to `ItemForm` / `ItemUsageList`.
- **Phase 17 library architecture (to reuse):**
  - `src/lib/library/registry.ts` — `EntityAdapter` per entity (`documents` adapter: `fieldMap` maps `title/type/description/asset` → snake_case columns; `requiredFields: ['title','type']`; `multilineFields: ['description']`; `listColumns: [{ column: 'type', label: 'Type' }]`; `enumOptions: {}`; `draftSchema: documentDraftSchema`). Currently **no `editor` flag** on documents.
  - `src/lib/library/query.ts` — `listEntities`, `getEntity`.
  - `src/lib/library/mutate.ts` — `createEntity`, `updateEntity`, `duplicateEntity`, `archiveEntity` (lifecycle rules; version bump on edit).
  - `src/lib/library/validation.ts` — `validateDraft` (DraftSchema parse + field-error map).
  - `src/app/library/actions.ts` — `authorize(permission)` prelude, then `createLibraryItem`/`updateLibraryItem`/`duplicateLibraryItem`/`archiveLibraryItem`, each re-checking the role server-side before any DB call.
  - `src/components/library/EntityForm.tsx` — generic form generated from the adapter.
  - Pages: `/library/[entity]/new`, `/library/[entity]/[id]` (detail), `/library/[entity]/[id]/edit`.
- **Phase 18/19 pattern to reuse (committed):** `src/components/character/CharacterForm.tsx`, `src/components/item/ItemForm.tsx`, `src/lib/library/character-usage.ts`, `src/lib/library/item-usage.ts`, `src/components/item/ItemUsageList.tsx`, registry `editor` union + route dispatch, `test/library/item-usage.test.ts`, `scripts/e2e-character.py`, `scripts/e2e-item.py`.
- **content-schema (committed, untouched):** `documentSchema` + `documentDraftSchema` (title required min1 max200; type required min1 max100; description nullable; asset nullable). This is the author-input validation surface. **No role/tags fields exist.**
- **shared-types (committed, untouched):** `Document` interface (title, type, description|null, asset|null — 4 fields only); enums have `DOCUMENT_ROLES = ['real','fake','decoy']` typed **for the TS layer** but with the explicit comment "DB column is free text (R4)" — i.e., it describes the **relation `role` column**, not a `documents` attribute. No `DocumentUsage` aggregate exists.
- **game-rules (committed, untouched):** `document-selection.ts` consumes **`case_documents`** snapshot rows (`documentId`, `required`, `weight`, `role` free-text, `hidden`, `discoveryMethod`, `priority`, `conditions`, `version`) as a pure function; `pipeline.ts:190` carries `role` unchanged. It **never reads `location_documents`**. Phase 20 must not change `role` semantics or add a `documents` column the pipeline does not consume.
- **runtime (committed, untouched):** consumes `case_instances` + generated snapshots; does not read `documents` directly.
- **Database (migrations 0001–0021):**
  - `documents` (0005): `id, title (nn), type (nn), description, asset, status, version, created_at, updated_at`. Lifecycle trigger + `documents_status_idx`. service_role grants: **SELECT (0018) + INSERT, UPDATE (0019)** — verified live.
  - Relation tables: `case_documents` (0012), `location_documents` (0013), `chapter_cases` (0015). All RLS-enabled, **zero policies**. **Live grant check:** `case_documents` = `REFERENCES,TRIGGER,TRUNCATE` (no SELECT); `location_documents` = `REFERENCES,TRIGGER,TRUNCATE` (no SELECT); `chapter_cases` = `REFERENCES,SELECT,TRIGGER,TRUNCATE` (SELECT present from 0020).
  - RLS: `pg_policies` in `public` = **0** (default-deny preserved). anon/authenticated = **0** grants on all tables.
- **Admin app:** Next 16.3.0, React 19.2.8, Tailwind v4, `<html lang="tr">` (avoid CSS `uppercase`). Turbopack build does not resolve `.js` → `.ts` (imports extensionless); test files keep `.js` suffix. `params`/`searchParams` are Promises; Server Actions use `redirect` (must be outside `try/catch`). `e2e-library.py` exercises the generic library but **has no document-specific section** (documents entity is covered generically only) — Phase 20 adds `e2e-document.py` mirroring `e2e-item.py`.

---

## 3. What Actually Exists — Reuse Inventory

The Phase 20 Document editor reuses, **unchanged**, the entire Phase 17 library data path and auth gate plus the Phase 18/19 specialized-editor pattern:

- **Auth gate:** `createClient()` (SSR) → `supabase.auth.getUser()` (token-verified) → `roleFromUser(user)` → `roleHasPermission(role, 'view'/'edit'/'create')`. Page gate + Server Action re-check (§6).
- **Service-role read/write:** `libraryServiceClient()` (server-only; never in a client component).
- **Scalar editing:** the `documents` adapter + `validateDraft` + `mutate.ts` already create/edit the 4 scalar fields. Phase 20 **specializes the form** (labels, grouping, asset field, type free-text hint) rather than re-implementing CRUD.
- **Version badge + lifecycle:** Phase 17 detail page already renders `version` read-only and gates Duplicate/Archive.
- **Editor-dispatch plumbing:** the registry `editor?: 'character' | 'item'` union already exists; Phase 20 extends it to `'character' | 'item' | 'document'` and marks `editor: 'document'` on the documents adapter. The route pages already branch on the editor kind (Phase 19 did exactly this for items).

**New code needed (Phase 20):**

- A dedicated Document editor UI (better than the generic `EntityForm`) for the scalar fields.
- A **read-only Usage-relations list** (Used in Locations / Cases / Chapters) rendered on the document detail page.
- A **new additive migration** granting service_role `SELECT` on the two relation tables lacking it: `case_documents` + `location_documents` (`chapter_cases` already granted by 0020) (§8).
- New `query.ts`-style helper for usage lookups (read-only, whitelisted columns, no raw SQL), mirroring `character-usage.ts`/`item-usage.ts`.

---

## 4. Proposed Architecture and Exact Files

### 4.1 Document editor (scalar fields)

Phase 20 introduces a **specialized `DocumentForm`** component that improves on the generic `EntityForm` for the document entity: human-readable field labels ("Title", "Type", "Description", "Asset URL"), grouped layout, inline validation from `validateDraft` (unchanged), and the existing `createLibraryItem`/`updateLibraryItem` server actions (unchanged). Because the scalar columns and their validation are already correct, Phase 20 adds **no new columns, no new schema, no migration for the editor itself** — it is a presentation + layout improvement over the Phase 17 generic form, reusing the same server actions and the same `documents` adapter.

- `src/components/document/DocumentForm.tsx` (client; `useActionState`; wraps the `documents` adapter fields with labels/groups; mirrors `ItemForm`'s state wiring).
- Route dispatch: the registry `editor: 'document'` flag (extension of the Phase 19 `editor` union to `'character' | 'item' | 'document'`) makes the **new/edit** pages (`/library/documents/new`, `/library/documents/[id]/edit`) render `DocumentForm` exactly as items do today (`adapter.editor === 'document'` branch alongside the existing `'character'`/`'item'` branches). The **detail** page (`/library/documents/[id]`) uses the Phase 19 pattern of `entity === 'items'` string branches — it gets a `entity === 'documents'` branch that loads `getDocumentUsage` and renders `DocumentUsageList`.

### 4.2 Usage relations (read-only)

The usage list shows, for a document, the locations, cases, and chapters that reference it:

- **Used in Locations:** `location_documents` where `document_id = <id>` → join `locations` for name/type, plus the per-location `role`, `availability`, `weight`, `spawn_probability`, `hidden`, `discovery_method`.
- **Used in Cases:** `case_documents` where `document_id = <id>` → join `cases` for title/difficulty/type, plus the per-case `role` (**the real/fake/decoy classification**), `required`, `weight`, `hidden`, `discovery_method`.
- **Used in Chapters:** a chapter references a document **indirectly** through its cases: `chapter_cases` → `case_documents` where `document_id = <id>` (a chapter lists cases that use the document). There is **no direct `chapter_documents` table** — so "Used in Chapters" is derived via cases. This is a **grounded fact** (0015 only has `chapter_locations` and `chapter_cases`) and must be reported as such rather than invented.

Data path: a new server-only helper `getDocumentUsage(client, id)` in `src/lib/library/document-usage.ts` that runs read-only queries against the service-role client with **whitelisted columns** and returns a typed `DocumentUsage` object. Rendered as read-only sections on the document detail page — no writes, no relation editing (that is Phase 22 Location Management / Phase 23 Case Builder territory).

- `src/lib/library/document-usage.ts` — `DocumentUsage` type + `getDocumentUsage` (server-only reads; mirrors `item-usage.ts`).
- `src/app/library/[entity]/[id]/page.tsx` — add the `entity === 'documents'` branch: load `getDocumentUsage` and render `DocumentUsageList` (read-only, gated by `view`), parallel to the existing `entity === 'items'` / `itemUsage` branch.
- `src/components/document/DocumentUsageList.tsx` — presentational; shows the per-relation `role` (real/fake/decoy) so the "Fake/real classification" TODO item is at least surfaced where it is actually modeled.

### 4.3 Files summary

**Create (after approval):**

- `apps/admin/src/lib/library/document-usage.ts` — usage query helper + types.
- `apps/admin/src/components/document/DocumentForm.tsx` — specialized scalar editor.
- `apps/admin/src/components/document/DocumentUsageList.tsx` — read-only usage display.
- `apps/admin/test/library/document-usage.test.ts` — Vitest with fake client (usage joins, whitelisted columns, no relation-write).
- `backend/supabase/migrations/0022_document_usage_reads.sql` — §8.
- `scripts/e2e-document.py` — Python Playwright e2e (editor scalar save/bump, usage relations render for SUPER_ADMIN/CONTENT_ADMIN/EDITOR/REVIEWER, REVIEWER read-only, no relation writes).

**Modify (after approval):**

- `apps/admin/src/lib/library/registry.ts` — extend `editor?: 'character' | 'item'` to `'character' | 'item' | 'document'`; set `editor: 'document'` on the documents adapter. No column/schema change.
- `apps/admin/src/app/library/[entity]/new/page.tsx` and `[entity]/[id]/edit/page.tsx` — add the `adapter.editor === 'document'` branch rendering `DocumentForm` (parallel to the existing `'character'`/`'item'` branches).
- `apps/admin/src/app/library/[entity]/[id]/page.tsx` — add the `entity === 'documents'` branch loading `getDocumentUsage` and rendering `DocumentUsageList`.

**Do NOT touch (unchanged by this design):** `TODO.md`, migrations other than the new `0022`, `config.toml`, `packages/shared-types`, `packages/content-schema`, `packages/game-rules`, `packages/runtime`, `case_instances`, RLS posture, `src/lib/supabase/{admin,server,browser}.ts`, `src/lib/auth/*`, `src/proxy.ts`, `.env`/`.env.example`.

---

## 5. Explicitly Deferred Items (owning phases) — grounded

- **Tags (TODO line 784):** no `tags` column, no `tags` table anywhere in the repo or migrations. Implementing would require a **new table** (`document_tags`) + a **new content-schema/shared-types surface** + a migration + Phase 40 audit surface. **Defer** — there is no owning phase named in TODO; flag to user (§11 decision).
- **Fake/real classification as a document attribute (TODO line 783):** there is **no `documents.role`/classification column**. The `real`/`fake`/`decoy` value (`DOCUMENT_ROLES`, shared-types enums.ts:55) is, per the schema comment and Phase 9 §4/§8, **free text on the relation rows only** (`case_documents.role`, `location_documents.role`): "A document can be _real_ in one case and _fake_ in another." A global per-document "Fake/real" field is **not modeled** and adding it would change the R4 audit decision and the game-rules contract (`document-selection.ts` reads `role` from the relation, `pipeline.ts:190` carries it unchanged). Phase 20 **surfaces the per-relation role read-only in the usage list** where it actually lives; **any document-level classification store is deferred** (and would be a model change — flag to user, §11).
- **Asset upload (TODO line 782):** `asset` is a text URL/path; **no storage bucket or upload infra exists** (config.toml `[storage.buckets]` commented out). Phase 20 edits the asset **path/URL as text** only; actual upload → a future storage phase / Phase 25.
- **Document type enum / catalog (TODO line 779):** `documents.type` is free-form text (R4 — content-defined: passport, invoice, license…). Phase 20 edits it as free text; a controlled `document_type` catalog would be a new table/enum and is **not** in any owning phase — flag to user (§11).
- **Full revision history, created-by/published-by, diff, rollback:** Phase 27.
- **Publish/release/rollback:** Phases 27/28 (no release system; `status='published'` not reachable from the library UI).
- **Content validation engine:** Phase 26 (Phase 20 runs only DraftSchema field checks).
- **Audit log, RLS grant matrix:** Phase 40.
- **Analytics / `case_instances` admin view:** Phases 41/42.
- **Case Builder (per-case role/required/min-max assignment):** Phase 23.
- **Location Management (location↔document availability):** Phase 22.
- **Visual hierarchy/relations editing:** Phase 22/23.

---

## 6. Permission / Auth / RLS Implications

- **No new permission.** The document editor uses the existing `create`/`edit`/`view` gates; the usage list is `view`-gated (all four roles see it read-only). No shared-types change (`ROLE_PERMISSIONS` untouched).
- **Server-side enforcement preserved:** every mutation re-runs `authorize()` (`actions.ts`) before any DB write; UI hiding is UX only. REVIEWER sees the editor fields read-only / cannot submit; EDITOR can create/edit; CONTENT_ADMIN/SUPER_ADMIN as Phase 15 matrix.
- **RLS stays default-deny (zero policies).** The new `0022` migration grants **base `SELECT`** to `service_role` only on the two relation tables lacking it (`case_documents`, `location_documents`) — no `anon`/`authenticated`, no INSERT/UPDATE/DELETE on relations, no policies. `chapter_cases` needs no new grant (0020 already granted it). This mirrors the approved 0018/0019/0020/0021 deviations and is provable from the live DB (both tables currently show zero service_role SELECT).
- **No `case_instances` access** (Phase 15 D4 preserved).
- **Service-role key stays server-only**; no client component imports `admin.ts`; the browser never queries relation tables.

---

## 7. Dependencies on Phases 21+

Phase 20 is a **leaf** relative to the later per-entity editors: it changes no shared-types/content-schema/game-rules/runtime and adds no new entity column, so Phases 21–23 are unaffected. It depends on the already-committed Phase 15/16/17 plumbing and the Phase 18/19 editor pattern only. It does **not** depend on Phase 21+ features; conversely, no Phase 21+ feature depends on Phase 20 specifics (the scalar editor is generic enough that Phases 21–22 can adopt the same "specialized form + usage list" pattern).

**Contradiction/ambiguity to flag:** TODO Phase 20 "Fake/real classification" (line 783) and "Tags" (line 784) parallel the Phase 18 "Roles"/"Tags" deferrals exactly: neither has a document-entity backing store. Additionally, "Usage relations" (line 786) is the read-only usage list (as implemented for characters/items in 18/19), NOT the write-side relation assignment (Phase 22/23 own those). (§11 decision.)

---

## 8. Migration Requirements

**One additive migration is required and is an infrastructure prerequisite (parallel to 0020/0021):**

`0022_document_usage_reads.sql` — grant base `SELECT` to `service_role` on the two relation tables that the read-only usage-relations list queries and that currently lack it:

- `case_documents` (Used in Cases; also feeds Used in Chapters via `chapter_cases`)
- `location_documents` (Used in Locations)

`chapter_cases` already has SELECT (from 0020) — **do not re-grant**.

**Exact SQL (additive; SELECT only; service_role only; no anon/authenticated; no RLS policies; no `case_instances`; no other relation tables):**

```sql
-- 0022_document_usage_reads.sql
-- Grant base SELECT on the relation tables the Phase 20 read-only Document
-- usage-relations list queries (Used in Locations / Cases / Chapters).
-- service_role only, mirroring the 0020/0021 approved deviations; no
-- anon/authenticated, no INSERT/UPDATE/DELETE, no RLS policies.
-- `chapter_cases` already has SELECT from 0020 (no re-grant).
-- `case_instances` untouched (D4).

grant select on table public.case_documents to service_role;
grant select on table public.location_documents to service_role;
```

**Why required (verified live):** `case_documents` and `location_documents` currently show `service_role` with only `REFERENCES,TRIGGER,TRUNCATE` (no SELECT), because `auto_expose_new_tables` is unset (config.toml:24) and 0018/0019 granted only the 9 content tables, and 0020/0021 granted only the character/item relation tables. Without this grant, the usage-list queries fail with `permission denied for table`.

**Verification plan (from clean DB, implementation time):**

1. `supabase db reset` (0001→0022 applies cleanly).
2. service_role can `SELECT` on `case_documents`, `location_documents`, `chapter_cases`; the 9 content tables still have their 0018/0019 grants; relation tables get **no INSERT/UPDATE/DELETE**.
3. `anon`/`authenticated` still 0 grants; `pg_policies` in `public` still 0.
4. `case_instances` untouched (0 grants).
5. Reproducible on a second fresh reset.

---

## 9. Impact on shared-types / content-schema / game-rules / runtime

- **shared-types:** **unchanged** (Phase 20 adds no permission, no enum, no entity field). The usage types live in `apps/admin` (YAGNI; `shared-types` remains purely additive for a real cross-package consumer). The "shared-types must never import game-rules" rule is untouched. `DOCUMENT_ROLES` stays a TS-layer typing of the free-text relation `role` (R4) — **no new column is implied**.
- **content-schema:** **unchanged** (`documentDraftSchema` already validates all 4 scalar fields; no new fields).
- **game-rules / runtime:** **unchanged; remain pure.** Phase 20 adds no column they consume and does not import them. `document-selection.ts`/`pipeline.ts` `role` pass-through is untouched.
- **Admin app (only code touched after approval):** see §4.3.

---

## 10. UI / Component Plan

- **Document editor:** a dedicated `DocumentForm` with grouped, labeled fields for the 4 scalar columns; text input for title and type (with a hint that type is free-form — "passport, invoice, license, …"); multiline for description; text input for asset URL (with a hint that it is a path/URL, not an upload — no bucket exists). Inline per-field errors from `validateDraft` (reused). Tailwind v4 zinc palette matching Phases 16–19; `lang="tr"` → keep **lowercase** text styling (avoid dotless-ı artifact).
- **Usage relations:** read-only sections "Used in Locations", "Used in Cases", "Used in Chapters" on the document detail page. Each lists the referencing entity name with a link to its detail page; cases and locations additionally show the per-relation **`role` (real/fake/decoy)** and `required`/`hidden`/`discovery_method` where present (from `case_documents`/`location_documents`); empty state "Not used anywhere yet." REVIEWER sees it read-only.
- **State:** mirror Phases 17–19 (`useActionState` + `initialLibraryFormState`); Server Actions return previous input + field errors on failure.

---

## 11. Conflicts / Open Decisions Found (reported, per instruction)

The instruction requires explicit reporting rather than silent interpretation. Five tensions between TODO Phase 20, the prior design docs, and the repository were found; each is resolved with a recommendation below but is **subject to your approval**:

1. **TODO §20 "Fake/real classification" is not a document attribute.** `real`/`fake`/`decoy` (`DOCUMENT_ROLES`) is **contextual per relation** — free text on `case_documents.role` / `location_documents.role` (R4; Phase 9 §4: a document can be real in one case and fake in another; `document-selection.ts` reads `role` from the relation, `pipeline.ts:190` carries it unchanged). There is **no `documents.role` column**. **Recommendation:** Phase 20 surfaces the per-relation role read-only in the usage list; no document-level classification store. **If you want a global Fake/real classification on the document entity, that changes the R4 model and needs a new column + game-rules contract change — say so.**
2. **TODO §20 "Tags" has no backing store.** No `tags` column/table exists anywhere (searched all packages + migrations). **Recommendation:** defer Tags out of Phase 20 (no owning phase in TODO). **If you want Tags in Phase 20, that is a scope change requiring a new `document_tags` table + migration + shared-types/content-schema surface + Phase 40 audit — say so.**
3. **TODO §20 "Usage relations" is read-only here; write-side assignment belongs to later phases.** Phase 20 shows where a document is referenced (Used in Locations / Cases / Chapters, read-only, parallel to 18/19). Editing those relations (availability, per-case role, spawn probability, etc.) is **Phase 22 Location Management / Phase 23 Case Builder** territory. **Recommendation:** keep Phase 20 read-only. **If you want relation editing in Phase 20, that is a scope change to Phase 22/23 — say so.**
4. **TODO §20 "Used in Chapters" is indirect.** There is **no `chapter_documents` table**; chapters reference documents only through their cases (`chapter_cases` ∘ `case_documents`). **Recommendation:** Phase 20 derives "Used in Chapters" via cases and labels it as such. **If you expected direct chapter↔document relations, that is a schema gap in Phase 4/15 to reconcile — say so.**
5. **Migration `0022` grants relation SELECT** (required for the usage relations) — a new grant surface on `case_documents` + `location_documents` (SELECT-only, service_role-only, no policies, parallel to approved 0020/0021). **If you prefer the usage relations to be deferred or the relations to remain fully un-granted, say so.**

Open (lower risk, implementation-time): whether the editor is a standalone `DocumentForm` vs the Phase 19 `editor`-flag dispatch (the latter is already wired and is the recommendation); whether usage types live in `document-usage.ts` (as `item-usage.ts` does) vs `types.ts` (the former matches the established pattern); exact grouping/labels; whether the usage list joins live (`join` in PostgREST) or runs sequential queries and joins in TS (the latter matches the Phase 18/19 fake-client test pattern). These do not change architecture and are resolved within the §4/§10 constraints.

---

## 12. Self-Review (against the objective constraints)

- ✅ **Grounded in the actual schema:** every TODO §20 item was mapped to a real column/table or explicitly deferred with the reason (no backing store / contextual model / indirect relation).
- ✅ **No invented tables or migrations** beyond the provable `0022` relation-SELECT grant (§8); no `document_tags`/`document_roles`/`documents.role`/`document_type` enum/`chapter_documents` invented.
- ✅ **shared-types / content-schema / game-rules / runtime unchanged** (§9); shared-types stays a leaf; no game-rules import.
- ✅ **Phase 15 default-deny preserved:** no RLS policies, no anon/authenticated grants, only `SELECT` to `service_role` (additive) on 2 relation tables, no INSERT/UPDATE/DELETE on relations.
- ✅ **Phase 15–19 architecture reused:** same gate (`getUser` → `roleFromUser` → `roleHasPermission`), same service-role server-only client, same fake-client test pattern, same `editor`-flag route dispatch (Phase 19); browser never touches content or relation tables (D3a).
- ✅ **`case_instances` explicitly out of scope** (Phase 15 D4) — no grant, no read, no write.
- ✅ **REVIEWER read-only; EDITOR/CONTENT_ADMIN/SUPER_ADMIN behaviors explicit** (§6), enforced server-side.
- ✅ **No Phase 21+ work started** — no evidence/location/case editors, no case builder, no validation engine, no versioning history, no release system.
- ✅ **Exact files listed** (§4.3); conflicts reported rather than silently resolved (§11).
- ✅ **IMPLEMENTED and committed** — this document's design was implemented per §4–§10 and verified (121 unit tests, typecheck/lint/prettier clean, production build, e2e 26/26 document + 47/47 library + 24/24 character + 26/26 item regressions, `supabase db reset` 0001–0022 clean, live grant matrix confirmed).

---

## 13. Conclusion

Phase 20 delivers the **Admin Document editor**: a purpose-built, labeled editor for the four existing `documents` scalar fields (title, type, description, asset URL) reusing the Phase 17 library's validation, server actions, auth gate, and service-role data path — via the Phase 19 `editor`-flag dispatch — plus a **read-only usage-relations list** (Used in Locations / Cases / Chapters) driven by one new additive migration (`0022`) granting service_role `SELECT` on the two relation tables that lack it (`case_documents`, `location_documents`), with **no change to any content package, no RLS policy, and `case_instances` untouched**. The TODO items without a backing store (Tags, Fake/real classification as a document attribute, direct chapter↔document, asset upload, document-type catalog) are **deferred with grounded reasons**, and the five scope conflicts are reported in §11. **This phase is implemented, verified, and pushed to `main`.**
