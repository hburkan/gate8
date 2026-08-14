# Phase 18 — Admin Character Management

> **Status:** DESIGN ONLY (not implemented; no code, migration, or commit in this document). This design spec governs the authenticated Admin Character editor for the Gümrük Kontrol Memuru CMS. It grounds every claim in the actual repository state at `833cff2` (`main`, Phase 17 committed and pushed, clean tree) and in live-DB privilege checks (local Supabase, migrations 0001–0019 applied).
>
> **Scope:** A server-side, role-gated **Character editor** that builds on the Phase 17 Content Library. It deepens the generic Phase 17 `characters` entity page into a per-entity editor for the fields TODO Phase 18 lists (name, surname, age, nationality, occupation, description, portrait, tags, roles, available items, available documents, usage list). It reuses the Phase 15 auth + RBAC plumbing, the Phase 16/17 service-role data-access pattern, and the Phase 17 registry/form scaffolding — and it **defers the parts of the TODO list that have no backing store** to their owning phases (§5), exactly as Phase 17 deferred its out-of-scope surfaces.
>
> **Explicitly OUT of scope (deferred with owning phases):** per-entity editors for the other eight entities (Phases 19–22/23), the visual Case Builder (Phase 23), rich asset/portrait **upload** (no storage bucket exists; Phase 25 or a storage phase), content validation engine (Phase 26), full revision history (Phase 27), release/publish (Phase 28), audit (Phase 40), analytics (Phase 41/42). Phase 18 manages the `characters` row's scalar content fields and its **read-only usage relationships**.

---

## 1. Objective and TODO Mapping

TODO.md §18 (lines 726–747):

> # PHASE 18 — ADMIN CHARACTER MANAGEMENT
>
> Character editor:
>
> - [ ] Name.
> - [ ] Surname.
> - [ ] Age.
> - [ ] Nationality.
> - [ ] Occupation.
> - [ ] Description.
> - [ ] Portrait.
> - [ ] Tags.
> - [ ] Roles.
> - [ ] Available items.
> - [ ] Available documents.
> - [ ] Usage list.
>
> Show:
> Used in Locations
> Used in Cases
> Used in Chapters

**Goal of this phase:** replace the generic Phase 17 `characters` create/edit form with a purpose-built Character editor that (a) provides an improved, labeled, field-specific editing experience for the scalar columns, and (b) surfaces the character's **relationships** — where it appears in locations, cases, and chapters (read-only usage list). Phase 18 must not start any later phase (19+ per-entity editors, 23 case builder, 26 validation, 27 versioning, 28 release).

**Grounding check — what the TODO asks vs what exists:**

| TODO §18 item                                                 | Backing store today                                                                                                                                                                                                                                                         | Phase 18 disposition                                                                                                                                                                     |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Name / Surname / Age / Nationality / Occupation / Description | `characters` columns (0003) — all exist, all already editable via Phase 17                                                                                                                                                                                                  | **Implement** as a labeled, improved editor                                                                                                                                              |
| Portrait                                                      | `characters.portrait_asset` (0003) — a **text URL/path** column; **no storage bucket, no upload infra** (config.toml storage buckets commented out)                                                                                                                         | **Implement as text** (`portraitAsset` URL/asset string, already validated by content-schema) — **no upload** (deferred)                                                                 |
| Tags                                                          | **No `tags` column, no `tags` table anywhere** (searched shared-types, content-schema, game-rules, runtime, migrations)                                                                                                                                                     | **Defer — no backing store.** Would require a new table + migration + Phase 40 audit surface. TODO line 738                                                                              |
| Roles                                                         | **No `character.roles` attribute.** `role` exists only as **free-text per-relation** on `case_characters.role` / `location_characters.role` (a character's role is case/location-context-specific, consumed by game-rules `characterRole` rule). No `character_roles` table | **Partially implement — see §4.** A character's roles are contextual; there is no single "Roles" list. Defer any new roles store (Phase 23 case builder owns per-case role assignment)   |
| Available items / Available documents                         | **No per-character item/document pool exists.** Only `case_characters.min_items/max_items` (per-case) and `location_characters` (location↔character). No `character_items` / `character_documents` table                                                                    | **Defer — no backing store.** TODO lines 740–741. Per-character availability pools are not modeled                                                                                       |
| Usage list (Used in Locations / Cases / Chapters)             | Queryable read-only via `location_characters`, `case_characters`, and (for chapters) `chapter_cases` ∘ `case_characters`. **But these relation tables have ZERO service_role SELECT grant** (verified live; only REFERENCES/TRIGGER/TRUNCATE)                               | **Implement as read-only** via a **new additive migration** granting service_role `SELECT` on the needed relation tables (§8). Shows where the character is referenced — nothing written |

---

## 2. Current State (verified at `833cff2`)

- **HEAD == origin/main == `833cff234adb9bf1bc0ed4781d584bde537ebdc0`; working tree clean.**
- Phase 15 (committed): admin auth (`@supabase/ssr` + `@supabase/supabase-js`), role claim in `app_metadata.role` only (D2), server-only service-role client `src/lib/supabase/admin.ts`, zero-policy RLS default-deny (D3a), `case_instances` admin = none (D4).
- Phase 16 (committed): read-only dashboard (`src/lib/dashboard/metrics.ts` + `page.tsx`) via service-role client; migration `0018_service_role_reads.sql` granted `SELECT` to service_role on the **9 content tables only** (not relations).
- Phase 17 (committed `833cff2`): the Admin Content Library — `/library` landing, per-entity list/detail/create/edit, generic adapter registry (`src/lib/library/registry.ts`), server actions (`actions.ts`), shared components (`src/components/library/`), service-role client typed as `LibraryClient` (`client.ts`), unit tests (`test/library/`), e2e (`scripts/e2e-library.py`). Migration `0019_content_library_writes.sql` granted `INSERT, UPDATE` to service_role on the **9 content tables only** (no DELETE, no relations, no `case_instances`).
- **Phase 17 library architecture (to reuse):**
  - `src/lib/library/registry.ts` — `EntityAdapter` per entity (`characters` adapter: `fieldMap` maps `name/surname/age/nationality/occupation/description/portraitAsset` → snake_case columns; `requiredFields: ['name']`; `numberFields: ['age']`; `multilineFields: ['description']`; `draftSchema: characterDraftSchema`).
  - `src/lib/library/query.ts` — `listEntities`, `getEntity`.
  - `src/lib/library/mutate.ts` — `createEntity`, `updateEntity`, `duplicateEntity`, `archiveEntity` (lifecycle rules; version bump on edit).
  - `src/lib/library/validation.ts` — `validateDraft` (DraftSchema parse + field-error map).
  - `src/app/library/actions.ts` — `authorize(permission)` prelude (`getUser()` → `roleFromUser()` → `roleHasPermission()`), then `createLibraryItem`/`updateLibraryItem`/`duplicateLibraryItem`/`archiveLibraryItem`, each re-checking the role server-side before any DB call.
  - `src/components/library/EntityForm.tsx` — generic form generated from the adapter (text/number/multiline/enum/JSONB inputs, `useActionState`).
  - Pages: `/library/[entity]/new`, `/library/[entity]/[id]` (detail), `/library/[entity]/[id]/edit`.
- **content-schema (committed, untouched):** `characterSchema` + `characterDraftSchema` (name required; surname/age/nationality/occupation/description/portraitAsset nullable; age int 0–150). This is the author-input validation surface. **No tags/roles/availability fields exist.**
- **shared-types (committed, untouched):** `Character` interface (the 7 scalar fields only); `relations.ts` has `CaseCharacter` (with `role`, `minItems`, `maxItems`) and `LocationCharacter` (with `role`, `availability`) but **no `CharacterUsage` aggregate**; enums have `EVIDENCE_ROLES`/`DOCUMENT_ROLES` but **no `CHARACTER_ROLES`**.
- **game-rules (committed, untouched):** consumes `characters.occupation` (generation `pipeline.ts:177`) and character `role` from the case context (`characterRole` rule). It reads `Character` fields but **does not depend on tags or a character-level roles attribute** — so Phase 18 must not add columns that change `Character` semantics in a way that breaks the pipeline.
- **runtime (committed, untouched):** consumes `case_instances` + generated snapshots; does not read `characters` directly.
- **Database (migrations 0001–0019):**
  - `characters` (0003): `id, name (nn), surname, age, nationality, occupation, description, portrait_asset, status, version, created_at, updated_at`. Lifecycle trigger + `characters_status_idx`.
  - Relation tables: `case_characters` (0012), `location_characters` (0013), `chapter_cases` (0015). All RLS-enabled, **zero policies**, and **zero service_role SELECT grant** (verified live this phase).
  - RLS: `pg_policies` in `public` = **0** (default-deny preserved). anon/authenticated = **0** grants on all tables.
- **Admin app:** Next 16.3.0, React 19.2.8, Tailwind v4, `<html lang="tr">` (avoid CSS `uppercase`). Turbopack build does not resolve `.js` → `.ts` (imports extensionless); test files keep `.js` suffix. `params`/`searchParams` are Promises; Server Actions use `redirect` (must be outside `try/catch`).

---

## 3. What Actually Exists — Reuse Inventory

The Phase 18 Character editor reuses, **unchanged**, the entire Phase 17 library data path and auth gate:

- **Auth gate:** `createClient()` (SSR) → `supabase.auth.getUser()` (token-verified) → `roleFromUser(user)` → `roleHasPermission(role, 'view'/'edit'/'create')`. Page gate + Server Action re-check (§5).
- **Service-role read/write:** `libraryServiceClient()` (server-only; never in a client component).
- **Scalar editing:** the `characters` adapter + `validateDraft` + `mutate.ts` already create/edit the 7 scalar fields. Phase 18 **specializes the form** (labels, grouping, portrait field, live preview of derived values) rather than re-implementing CRUD.
- **Version badge + lifecycle:** Phase 17 detail page already renders `version` read-only and gates Duplicate/Archive.

**New code needed (Phase 18):**

- A dedicated Character editor UI (better than the generic `EntityForm`) for the scalar fields.
- A **read-only Usage list** (Used in Locations / Cases / Chapters) rendered on the character detail page.
- A **new additive migration** granting service_role `SELECT` on the relation tables needed for the usage queries (§8).
- New `query.ts` helpers for usage lookups (read-only, whitelisted columns, no raw SQL).

---

## 4. Proposed Architecture and Exact Files

### 4.1 Character editor (scalar fields)

Phase 18 introduces a **specialized `CharacterForm`** component that improves on the generic `EntityForm` for the character entity: human-readable field labels ("Name", "Surname", "Age", "Nationality", "Occupation", "Description", "Portrait asset URL"), grouped layout (identity / profile / portrait), inline validation from `validateDraft` (unchanged), and the existing `createLibraryItem`/`updateLibraryItem` server actions (unchanged). Because the scalar columns and their validation are already correct, Phase 18 adds **no new columns, no new schema, no migration for the editor itself** — it is a presentation + layout improvement over the Phase 17 generic form, reusing the same server actions and the same `characters` adapter.

- `src/components/character/CharacterForm.tsx` (client; `useActionState`; wraps the `characters` adapter fields with labels/groups; mirrors `EntityForm`'s state wiring).
- `src/app/library/characters/new/page.tsx` and `src/app/library/characters/[id]/edit/page.tsx` — **replace** the generic `EntityForm` usage with `CharacterForm` (or extend the generic form via an adapter "editor kind" flag). Decision D-Edit (§11).

### 4.2 Usage list (read-only)

The usage list shows, for a character, the locations, cases, and chapters that reference it:

- **Used in Locations:** `location_characters` where `character_id = <id>` → join `locations` for name/type.
- **Used in Cases:** `case_characters` where `character_id = <id>` → join `cases` for title/difficulty/type, plus the per-case `role`, `required`, `min_items`, `max_items`.
- **Used in Chapters:** a chapter references a character **indirectly** through its cases: `chapter_cases` → `case_characters` where `character_id = <id>` (a chapter lists cases that use the character). There is **no direct `chapter_characters` table** — so "Used in Chapters" is derived via cases. This is a **grounded fact** (0015 only has `chapter_locations` and `chapter_cases`), and must be reported as such rather than invented.

Data path: a new server-only helper `getCharacterUsage(client, id)` in `src/lib/library/character-usage.ts` that runs 3 read-only queries against the service-role client with **whitelisted columns** and returns a typed `CharacterUsage` object. Rendered as read-only sections on the character detail page — no writes, no relation editing (that is Phase 23 Case Builder / Phase 22 Location Management territory).

- `src/lib/library/character-usage.ts` — `CharacterUsage` type + `getCharacterUsage` (server-only reads).
- `src/lib/library/types.ts` — add `CharacterUsage` / usage row types (or keep in character-usage.ts). Decision D-Types (§11).
- `src/app/library/characters/[id]/page.tsx` — render the usage sections (read-only, gated by `view`).
- `src/components/character/CharacterUsageList.tsx` — presentational.

### 4.3 Files summary

**Create (after approval):**

- `apps/admin/src/lib/library/character-usage.ts` — usage query helpers + types.
- `apps/admin/src/components/character/CharacterForm.tsx` — specialized scalar editor.
- `apps/admin/src/components/character/CharacterUsageList.tsx` — read-only usage display.
- `apps/admin/test/library/character-usage.test.ts` — Vitest with fake client (usage joins, whitelisted columns, no relation-write).
- `apps/admin/test/components/character-form.test.tsx` (or unit tests on the adapter-driven layout) — optional; mirrors Phase 17 test conventions.
- `backend/supabase/migrations/0020_character_usage_reads.sql` — §8.
- `scripts/e2e-character.py` — Python Playwright e2e (editor scalar save/bump, usage list renders for SUPER_ADMIN/CONTENT_ADMIN/EDITOR/REVIEWER, REVIEWER read-only, no relation writes).

**Modify (after approval):**

- `apps/admin/src/app/library/characters/new/page.tsx` — use `CharacterForm`.
- `apps/admin/src/app/library/characters/[id]/edit/page.tsx` — use `CharacterForm`.
- `apps/admin/src/app/library/characters/[id]/page.tsx` — render `CharacterUsageList`.
- `apps/admin/src/lib/library/registry.ts` — optionally add an `editor: 'character'` kind so the route dispatches to `CharacterForm` (decision D-Edit). No column/schema change.
- `apps/admin/src/lib/library/types.ts` — usage types (decision D-Types).

**Do NOT touch (unchanged by this design):** `TODO.md`, migrations other than the new `0020`, `config.toml`, `packages/shared-types`, `packages/content-schema`, `packages/game-rules`, `packages/runtime`, `case_instances`, RLS posture, `src/lib/supabase/{admin,server,browser}.ts`, `src/lib/auth/*`, `src/proxy.ts`, `.env`/`.env.example`.

---

## 5. Explicitly Deferred Items (owning phases) — grounded

- **Tags (TODO line 738):** no `tags` column, no `tags` table anywhere in the repo or migrations. Implementing would require a **new table** (`character_tags`) + a **new content-schema/shared-types surface** + a migration + Phase 40 audit surface. **Defer** — there is no owning phase named in TODO; flag to user (§11 decision).
- **Roles (TODO line 739):** no `character.roles` attribute. A character's role is **contextual** — it lives on `case_characters.role` / `location_characters.role` (free text, validated by game-rules `characterRole`). A global "Roles" list for a character is not modeled. Phase 18 shows the per-relation role as read-only in the usage list where available; **any new character-level roles store is deferred** (Phase 23 case builder owns per-case role assignment).
- **Available items / Available documents (TODO lines 740–741):** no per-character item/document pool table exists. Only `case_characters.min_items/max_items` (per-case) model character↔item bounds, and no `character_documents` table exists. **Defer** — no backing store; flag to user.
- **Portrait upload (TODO line 737):** `portrait_asset` is a text URL/path; **no storage bucket or upload infra exists** (config.toml `[storage.buckets.images]` commented out). Phase 18 edits the asset **path/URL as text** only; actual upload → a future storage phase / Phase 25.
- **Full revision history, created-by/published-by, diff, rollback:** Phase 27.
- **Publish/release/rollback:** Phases 27/28 (no release system; `status='published'` not reachable from the library UI).
- **Content validation engine:** Phase 26 (Phase 18 runs only DraftSchema field checks).
- **Audit log, RLS grant matrix:** Phase 40.
- **Analytics / `case_instances` admin view:** Phases 41/42.
- **Case Builder (per-case role/min-max/required assignment):** Phase 23.
- **Location Management (location↔character availability):** Phase 22.
- **Visual hierarchy/relations editing:** Phase 22/23.

---

## 6. Permission / Auth / RLS Implications

- **No new permission.** The character editor uses the existing `create`/`edit`/`view` gates; the usage list is `view`-gated (all four roles see it read-only). No shared-types change (`ROLE_PERMISSIONS` untouched).
- **Server-side enforcement preserved:** every mutation re-runs `authorize()` (`actions.ts`) before any DB write; UI hiding is UX only. REVIEWER sees the editor fields read-only / cannot submit; EDITOR can create/edit; CONTENT_ADMIN/SUPER_ADMIN as Phase 15 matrix.
- **RLS stays default-deny (zero policies).** The new `0020` migration grants **base `SELECT`** to `service_role` only on the relation tables needed for usage — no `anon`/`authenticated`, no INSERT/UPDATE/DELETE on relations, no policies. This mirrors the Phase 16/17 approved deviations (0018/0019) and is provable from the live DB (relation tables currently have zero service_role SELECT).
- **No `case_instances` access** (Phase 15 D4 preserved).
- **Service-role key stays server-only**; no client component imports `admin.ts`; the browser never queries relation tables.

---

## 7. Dependencies on Phases 19+

Phase 18 is a **leaf** relative to the later per-entity editors: it changes no shared-types/content-schema/game-rules/runtime and adds no new entity column, so Phases 19–23 are unaffected. It depends on the already-committed Phase 15/16/17 plumbing only. It does **not** depend on Phase 19+ features; conversely, no Phase 19+ feature depends on Phase 18 specifics (the scalar editor is generic enough that Phases 19–22 can adopt the same "specialized form + usage list" pattern).

**Contradiction/ambiguity to flag:** TODO Phase 18 (lines 740–741) "Available items / Available documents" overlaps with Phase 19 (item pools / allowed locations) and Phase 23 (case builder character pools). The schema models character↔item only per-**case** (`case_characters.min_items/max_items`), not per-**character**. Phase 18 must not invent a `character_items` table that Phase 19/23 would then have to reconcile. (§11 decision.)

---

## 8. Migration Requirements

**One additive migration is required and is an infrastructure prerequisite (parallel to 0018/0019):**

`0020_character_usage_reads.sql` — grant base `SELECT` to `service_role` on the relation tables needed to render the read-only usage list:

- `case_characters` (Used in Cases)
- `location_characters` (Used in Locations)
- `chapter_cases` (Used in Chapters, via cases)

**Exact SQL (additive; SELECT only; service_role only; no anon/authenticated; no RLS policies; no `case_instances`; no other relation tables):**

```sql
-- 0020_character_usage_reads.sql
-- Grant base SELECT on the relation tables the Phase 18 read-only Character
-- usage list queries (Used in Locations / Cases / Chapters). service_role only,
-- mirroring the 0018/0019 approved deviations; no anon/authenticated, no
-- INSERT/UPDATE/DELETE, no RLS policies. `case_instances` untouched (D4).

grant select on table public.case_characters to service_role;
grant select on table public.location_characters to service_role;
grant select on table public.chapter_cases to service_role;
```

**Why required (verified live):** the three relation tables currently show `service_role` with only `REFERENCES,TRIGGER,TRUNCATE` (no SELECT), because `auto_expose_new_tables` is unset (config.toml:24) and 0018/0019 granted only the 9 content tables. Without this grant, the usage list queries fail with `permission denied for table`.

**Verification plan (from clean DB, implementation time):**

1. `supabase db reset` (0001→0020 applies cleanly).
2. service_role can `SELECT` on `case_characters`, `location_characters`, `chapter_cases`; the 9 content tables still have their 0018/0019 grants; relation tables get **no INSERT/UPDATE/DELETE**.
3. `anon`/`authenticated` still 0 grants; `pg_policies` in `public` still 0.
4. `case_instances` untouched (0 grants).
5. Reproducible on a second fresh reset.

---

## 9. Impact on shared-types / content-schema / game-rules / runtime

- **shared-types:** **unchanged** (Phase 18 adds no permission, no enum, no entity field). The usage types live in `apps/admin` (YAGNI; `shared-types` remains purely additive for a real cross-package consumer). The "shared-types must never import game-rules" rule is untouched.
- **content-schema:** **unchanged** (`characterDraftSchema` already validates all 7 scalar fields; no new fields).
- **game-rules / runtime:** **unchanged; remain pure.** Phase 18 adds no column they consume and does not import them.
- **Admin app (only code touched after approval):** see §4.3.

---

## 10. UI / Component Plan

- **Character editor:** a dedicated `CharacterForm` with grouped, labeled fields for the 7 scalar columns; number input for age; multiline for description; text input for portrait asset URL (with a hint that it is a path/URL, not an upload — no bucket exists). Inline per-field errors from `validateDraft` (reused). Tailwind v4 zinc palette matching Phase 16/17; `lang="tr"` → keep **lowercase** text styling (avoid dotless-ı artifact).
- **Usage list:** read-only sections "Used in Locations", "Used in Cases", "Used in Chapters" on the character detail page. Each lists the referencing entity name with a link to its detail page; cases additionally show the per-case `role`/`required`/min-max (from `case_characters`); empty state "Not used anywhere yet." REVIEWER sees it read-only.
- **State:** mirror Phase 17 (`useActionState` + `initialLibraryFormState`); Server Actions return previous input + field errors on failure.

---

## 11. Conflicts / Open Decisions Found (reported, per instruction)

The instruction requires explicit reporting rather than silent interpretation. Four tensions between TODO Phase 18, the prior design docs, and the repository were found; each is resolved with a recommendation below but is **subject to your approval**:

1. **TODO §18 "Tags" has no backing store.** No `tags` column/table exists anywhere (searched all packages + migrations). **Recommendation:** defer Tags out of Phase 18 (no owning phase in TODO). **If you want Tags in Phase 18, that is a scope change requiring a new `character_tags` table + migration + shared-types/content-schema surface + Phase 40 audit — say so.**
2. **TODO §18 "Roles" is not a character attribute.** A character's role is contextual (`case_characters.role` / `location_characters.role`, consumed by game-rules `characterRole`). There is no `character.roles` list. **Recommendation:** Phase 18 shows per-relation roles read-only in the usage list; no character-level roles store. **If you want a global character Roles list, that changes the model and needs a new column/table — say so.**
3. **TODO §18 "Available items / Available documents" has no per-character pool.** Only per-**case** `case_characters.min_items/max_items` exists; no `character_items`/`character_documents` table. **Recommendation:** defer (overlaps Phase 19/23; inventing `character_items` now would conflict). **If you want per-character availability in Phase 18, that is a new relation table + Phase 19/23 reconciliation — say so.**
4. **TODO §18 "Used in Chapters" is indirect.** There is **no `chapter_characters` table**; chapters reference characters only through their cases (`chapter_cases` ∘ `case_characters`). **Recommendation:** Phase 18 derives "Used in Chapters" via cases and labels it as such. **If you expected direct chapter↔character relations, that is a schema gap in Phase 4/15 to reconcile — say so.**
5. **Migration `0020` grants relation SELECT** (required for the usage list) — this is a new grant surface beyond the 9 content tables. It is **SELECT-only, service_role-only, no policies**, parallel to the approved 0018/0019 deviations. **If you prefer the usage list to be deferred or the relations to remain fully un-granted, say so.**

Open (lower risk, implementation-time): whether the editor is a standalone `CharacterForm` vs an adapter "editor kind" flag; exact grouping/labels; whether the usage list joins live (`join` in PostgREST) or runs three sequential queries and joins in TS (the latter is simpler and matches the Phase 17 fake-client test pattern). These do not change architecture and are resolved within the §4/§10 constraints.

---

## 12. Self-Review (against the objective constraints)

- ✅ **Grounded in the actual schema:** every TODO §18 item was mapped to a real column/table or explicitly deferred with the reason (no backing store / contextual model / indirect relation).
- ✅ **No invented tables or migrations** beyond the provable `0020` relation-SELECT grant (§8); no `character_tags`/`character_items`/`character_roles`/`character_documents` invented.
- ✅ **shared-types / content-schema / game-rules / runtime unchanged** (§9); shared-types stays a leaf; no game-rules import.
- ✅ **Phase 15 default-deny preserved:** no RLS policies, no anon/authenticated grants, only `SELECT` to `service_role` (additive) on 3 relation tables, no INSERT/UPDATE/DELETE on relations.
- ✅ **Phase 15/16/17 architecture reused:** same gate (`getUser` → `roleFromUser` → `roleHasPermission`), same service-role server-only client, same fake-client test pattern; browser never touches content or relation tables (D3a).
- ✅ **`case_instances` explicitly out of scope** (Phase 15 D4) — no grant, no read, no write.
- ✅ **REVIEWER read-only; EDITOR/CONTENT_ADMIN/SUPER_ADMIN behaviors explicit** (§6), enforced server-side.
- ✅ **No Phase 19+ work started** — no item/document/evidence/location editors, no case builder, no validation engine, no versioning history, no release system.
- ✅ **Exact files listed** (§4.3); conflicts reported rather than silently resolved (§11).
- ✅ **DESIGN ONLY** — this document is untracked and will remain uncommitted until approval; `git status` at handoff shows only this file as untracked.

---

## 13. Conclusion

Phase 18 delivers the **Admin Character editor**: a purpose-built, labeled editor for the seven existing `characters` scalar fields (name, surname, age, nationality, occupation, description, portrait asset URL) reusing the Phase 17 library's validation, server actions, auth gate, and service-role data path, plus a **read-only usage list** (Used in Locations / Cases / Chapters) driven by one new additive migration (`0020`) granting service_role `SELECT` on the three relevant relation tables — with no change to any content package, no RLS policy, and `case_instances` untouched. The TODO items without a backing store (Tags, Roles as a global list, Available items/documents, direct chapter↔character, portrait upload) are **deferred with grounded reasons**, and the five scope conflicts are reported in §11 for your decision. **This document is a design proposal; it will not be committed or pushed until you approve.**
