# Phase 17 — Admin Content Library

> **Status:** DESIGN ONLY (not implemented; no code, migration, or commit in this document). This design spec governs the authenticated Admin Content Library for the Gümrük Kontrol Memuru CMS. It grounds every claim in the actual repository state at `12eb0fd` (`main`, Phase 16 committed and pushed, clean tree) and in live-DB privilege checks (local Supabase, migrations 0001–0018 applied).
>
> **Scope:** A server-side, role-gated Content Library where admins browse, search, filter, sort, create, edit, duplicate, and archive the nine global content entities (characters, items, documents, evidence, locations, missions, dialogue definitions, cases, chapters), reusing the Phase 15 auth + RBAC plumbing and the Phase 16 server-side service-role data-access pattern. It determines the generic-vs-adapter abstraction, the exact write migration required, per-role behavior, routing, and exactly which files are added/modified.
>
> **Explicitly OUT of scope (deferred with owning phases):** per-entity rich editors (Phases 18–22/23), the visual Case Builder (Phase 23), the node-based Dialogue Builder (Phase 24), the Admin Preview System (Phase 25), content validation (Phase 26), full revision history/diff/rollback (Phase 27), the content release/publish system (Phase 28), the audit log (Phase 40), analytics (Phase 41/42). Phase 17 manages the entity rows and their scalar content fields only.

---

## 1. Objective and TODO Mapping

TODO.md §17 (lines 697–723):

> Create central Content Library.
> Sections: Characters, Items, Documents, Evidence, Dialogues, Missions, Locations, Chapters, Cases.
> Every entity must support: Search, Filter, Sort, Create, Edit, Duplicate, Archive, Version history.

**Goal of this phase:** replace the dashboard-only admin shell with a central, per-entity Content Library. Each of the nine content entities gets a browsable list with search/filter/sort/pagination, a detail view, and create/edit/duplicate/archive operations — all executed **server-side** behind the Phase 15 token-verified role gate, with writes going through the **service-role client** exactly as Phase 16 established for reads. Phase 17 must not start any later phase (18+ rich editors, 23 case builder, 24 dialogue builder, 26 validation, 27 versioning, 28 release).

**Per-entity TODO mapping (the eight capabilities, applied to all nine entities):**

| Capability      | Phase 17 disposition                                                                                                        |
| --------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Search          | Server-side `ilike` on the entity's title/name column (§6/§10)                                                              |
| Filter          | Server-side by `status` (and where schema-backed, enum columns) (§6/§10)                                                    |
| Sort            | Server-side by `updated_at` / `title`·`name` / `status` / `version` (§6/§10)                                                |
| Create          | Server Action → `INSERT` via service-role client; `status='draft'`, `version=1` (§6)                                        |
| Edit            | Server Action → `UPDATE` via service-role client; `version` bumped (§6)                                                     |
| Duplicate       | Server Action → `INSERT` copying content fields; `status='draft'`, `version=1`, new id (§6)                                 |
| Archive         | Server Action → `UPDATE status='archived'` (soft delete; no hard delete) (§6)                                               |
| Version history | **Current `version` shown read-only**; full revision history/diff/rollback deferred to Phase 27 (§18.1 — reported conflict) |

---

## 2. Current State (verified at `12eb0fd`)

- **HEAD == origin/main == `12eb0fda9e74d39bcde26cd9446d353eabc07668`; working tree clean.**
- Commits: `12eb0fd` (docs: record phase 16 service-role read migration deviation) → `14e2a7e` (feat: implement phase 16 dashboard) → `3f7c751` (docs: phase 16 design) → `fdb28f4` (feat: phase 15 admin auth) → `c4a72ec` (docs: phase 15 design).
- **Phase 15 (committed `fdb28f4`):** admin auth via `@supabase/ssr` + `@supabase/supabase-js`. Role claim lives only in `app_metadata.role` (decision D2). Files: `src/lib/supabase/{server,browser,admin}.ts`, `src/lib/auth/{roles,errors,login-state}.ts`, `src/proxy.ts` (Next.js 16 session-refresh guard), `/login` + `/auth/*` + `/logout` routes. RLS stays **default-deny with zero policies** (D3a); `case_instances` admin read = none (D4).
- **Phase 15 permission matrix (shared-types `ROLE_PERMISSIONS`, committed):**

| Permission | SUPER_ADMIN | CONTENT_ADMIN | EDITOR | REVIEWER |
| ---------- | ----------- | ------------- | ------ | -------- |
| view       | ✓           | ✓             | ✓      | ✓        |
| create     | ✓           | ✓             | ✓      | —        |
| edit       | ✓           | ✓             | ✓      | —        |
| delete     | ✓           | ✓             | —      | —        |
| publish    | ✓           | ✓             | —      | —        |
| rollback   | ✓           | —             | —      | —        |

- **Phase 16 (committed `14e2a7e`):** read-only dashboard. Server Component `src/app/page.tsx` gates via `getUser()` → `roleFromUser()` → `roleHasPermission(role,'view')`, then reads through `createServiceRoleClient()` cast to a `MetricsClient` (metrics.ts `QueryBuilder extends PromiseLike<QueryResult>` with `.eq/.order/.limit`), rendered inline (no components dir yet). Data-access module `src/lib/dashboard/metrics.ts` owns `CONTENT_TABLES` (9) + `TITLE_COLUMN` (title|name map). `case_instances` explicitly excluded.
- **Migration 0018 (approved deviation, committed):** grants `SELECT` to `service_role` **only** on the 9 content tables (`characters, items, documents, evidence, locations, missions, dialogue_definitions, cases, chapters`). Reason: this Supabase environment has `auto_expose_new_tables` unset (commented at `config.toml:24`), so base privileges are not auto-granted; `rolbypassrls` alone is insufficient. Verified live: service_role SELECT = 9; anon/authenticated = 0; RLS policies = 0; `case_instances` untouched.
- **CRITICAL Phase 17 finding (live-DB verified):** `service_role` currently has **0 `INSERT` and 0 `UPDATE` grants** on the 9 content tables (role_table_grants shows only REFERENCES/SELECT/TRIGGER/TRUNCATE). Phase 17's Create/Edit/Duplicate/Archive are **writes** → a new additive migration `0019` granting `INSERT, UPDATE` to `service_role` is **required** (§8). This is an infrastructure requirement proven against the actual database, exactly parallel to 0018.
- **Schema inventory (read from migrations 0001–0016):** every content entity table carries `id uuid pk default gen_random_uuid()`, `status content_status not null default 'draft'`, `version int not null default 1`, `created_at`, `updated_at`, `*_status_idx`, and a `set_updated_at()` before-update trigger; RLS enabled (0010 for all; 0011 for `cases`; 0014 for `chapters`). Entity-specific columns are listed in §3.
- **content-schema (committed, untouched):** full zod schemas + `*DraftSchema` for all nine entities (plus relation/rules schemas). Draft schemas are the author-input validation surface.
- **shared-types (committed, untouched):** entity interfaces extend `ContentEntity` (`id/status/version/createdAt/updatedAt`); enum const arrays + unions (`ITEM_CATEGORIES`, `ITEM_RARITIES`, `RISK_LEVELS`, `EVIDENCE_TYPES`, `EVIDENCE_IMPORTANCES`, `LOCATION_TYPES`); `ADMIN_ROLES`/`ADMIN_PERMISSIONS`/`ROLE_PERMISSIONS`/`roleHasPermission`. Pure leaf (no game-rules import).
- **Admin app:** `next 16.3.0`, `react 19.2.8`, Tailwind v4 (`globals.css` `@import 'tailwindcss'`), `<html lang="tr">`. No `/library` route, no `components/` dir, no nav — the dashboard is `/` with a sign-out button. **Next.js 16 note (AGENTS.md):** read `node_modules/next/dist/docs/` before writing any implementation code (mirrors Phase 15/16).
- **Tests/conventions:** Vitest unit tests with injected fake clients (`apps/admin/test/dashboard/metrics.test.ts`, `test/auth/*.test.ts`); shared-types matrix test (`test/roles.test.ts`, "every role has view"); Python Playwright e2e (`scripts/e2e-auth.py`, `scripts/e2e-dashboard.py`) run against `next start` + local Supabase via the seo venv; psql RLS checks in the Phase 15/16 verification playbook. `npm run typecheck`/`lint`/`format:check` at root; per-workspace `vitest run`. Pre-commit hooks run prettier --write + eslint --fix on staged files.

---

## 3. Entities in Scope (exact columns, from migrations)

The nine entities are the library sections. Each is a table with the shared lifecycle columns above plus entity columns (snake_case DB → camelCase shared-types). **They are NOT identical** — this is the core reason the design uses a per-entity adapter registry over a fully generic CRUD abstraction (§6).

### 3.1 characters

Columns: `name` (not null), `surname`, `age` (int), `nationality`, `occupation`, `description`, `portrait_asset`. → shared-types `Character`. Draft schema: `characterDraftSchema`.

### 3.2 items

Columns: `name` (not null), `description`, `category` (`item_category`, default 'other'), `rarity` (`item_rarity`, default 'common'), `value` (`numeric(12,2)`, default 0), `risk_level` (`risk_level`, default 'none'), `asset`. → `Item`. `itemDraftSchema`.

### 3.3 documents

Columns: `title` (not null), `type` (text not null, free-form document type), `description`, `asset`. → `Document`. `documentDraftSchema`.

### 3.4 evidence

Columns: `name` (not null), `description`, `type` (`evidence_type`, default 'physical'), `importance` (`evidence_importance`, default 'medium'). → `Evidence`. `evidenceDraftSchema`.

### 3.5 locations

Columns: `name` (not null), `type` (`location_type`, default 'area'), `description`, `parent_id` (self-FK → `locations`, ON DELETE SET NULL), `asset`. → `Location`. `locationDraftSchema`. (Hierarchy editing/UI is Phase 22; Phase 17 shows/edits `parentId` as a plain field.)

### 3.6 missions

Columns: `title` (not null), `description`, `objective`, `reward` (`jsonb`, default `{}`), `completion_condition` (`jsonb`, default `{}`). → `Mission`. `missionDraftSchema` (completionCondition validated by `completionConditionSchema`). Phase 17 treats the two JSONB columns as validated JSON text (schema-validated) — structured rule/reward editing is future-phase (§18.4).

### 3.7 dialogue_definitions

Columns: `title` (not null), `description`. → `DialogueDefinition`. `dialogueDefinitionDraftSchema`. **`dialogue_nodes` / `dialogue_node_choices` are OUT of scope** — node graph editing is Phase 24 (Dialogue Builder); Phase 17 manages the definition row (title/description) only. TODO's "Dialogues" section = `dialogue_definitions`.

### 3.8 cases

Columns (anchor 0011 + 0016 config): `title` (not null), `description`, `type`, `difficulty`, `min_characters`, `max_characters`, `min_items`, `max_items`, `min_documents`, `max_documents`, `min_evidence`, `max_evidence` (all `int not null default 0 check >= 0`; `0` = "no bound"). → `Case`. `caseDraftSchema`. **`case_*` relation tables (case_characters/items/documents/evidence) are OUT of scope** — they are Phase 23 Case Builder territory (and Phase 8/9/10/3). Phase 17 manages the case template row's scalar fields.

### 3.9 chapters

Columns: `title` (not null), `description`, `sort_order` (int default 0). → `Chapter`. `chapterDraftSchema`. **`chapter_locations` / `chapter_cases` OUT of scope** (Phase 23/25).

**Excluded entirely:** `case_instances` (Phase 15 D4: runtime data; no admin read; analytics deferred to 41/42), all relation tables (Phases 22/23/25), `dialogue_nodes`/`dialogue_node_choices` (Phase 24).

---

## 4. Permission Matrix and Operation Gating

Phase 17 maps each library operation to a Phase 15 permission. Gates are enforced **server-side only** (never trusted client-side) via `getUser()` → `roleFromUser()` → `roleHasPermission(role, permission)` inside each Server Component and each Server Action (§5).

| Library operation                                      | Permission gate               | SUPER_ADMIN     | CONTENT_ADMIN   | EDITOR          | REVIEWER           |
| ------------------------------------------------------ | ----------------------------- | --------------- | --------------- | --------------- | ------------------ |
| View list / detail / search / filter / sort / paginate | `view`                        | ✓               | ✓               | ✓               | ✓                  |
| Create (new)                                           | `create`                      | ✓               | ✓               | ✓               | —                  |
| Edit (scalar fields; bump `version`)                   | `edit`                        | ✓               | ✓               | ✓               | —                  |
| Duplicate (copy → new draft v1)                        | `create`                      | ✓               | ✓               | ✓               | —                  |
| Archive (set `status='archived'`)                      | `delete`                      | ✓               | ✓               | —               | —                  |
| See Create/Edit/Duplicate/Archive controls             | `view` + the operation's gate | render per gate | render per gate | render per gate | hidden (view-only) |

**REVIEWER behavior (explicit):** read-only library. List/detail/search/filter/sort/pagination render normally; no Create/Edit/Duplicate/Archive buttons or forms are rendered, and the corresponding Server Actions reject REVIEWER server-side (defense in depth — a hand-crafted request is still denied). Version badge shows read-only.

**EDITOR vs CONTENT_ADMIN vs SUPER_ADMIN (explicit):**

- EDITOR can create/edit/duplicate but **cannot archive** (archive = `delete` gate) and cannot publish (Phase 28).
- CONTENT_ADMIN adds archive (and later publish in Phase 28).
- SUPER_ADMIN is the only role with `rollback` — not exercised in Phase 17 (rollback targets releases, Phase 27/28).

**Not implemented in Phase 17:** publish (Phase 28 release system), rollback (Phase 27/28), hard delete (blocked by `ON DELETE RESTRICT` FKs on relation tables anyway; archive is the soft-delete lifecycle), status transitions other than draft→archived (draft→review→published is the Phase 26/27/28 lifecycle).

---

## 5. Authentication / Authorization (server-side, reusing Phase 15/16)

No new auth. Phase 17 consumes the committed plumbing unchanged:

- **Every library page is a Server Component** that first runs the Phase 16 gate: `createClient()` (SSR, cookie session) → `supabase.auth.getUser()` (token-verified; never `getSession` alone) → `roleFromUser(user)` (reads only `app_metadata.role`; ignores `user_metadata`) → `roleHasPermission(role, 'view')`. Not authenticated → `redirect('/login')` (already enforced by `proxy.ts`). Authenticated without `view` → render the existing "Unauthorized" state pattern.
- **Every mutation is a Server Action** (`'use server'`) that re-derives the role server-side and checks the operation's permission (§4) **before** touching the database. The UI hiding controls is UX only; the Server Action is the enforcement boundary.
- **All content reads and writes use `createServiceRoleClient()`** (server-only module `src/lib/supabase/admin.ts`; `SUPABASE_SERVICE_ROLE_KEY` stays server-only; the file's header comment already documents it is used for "server-side content data access" from Phase 16+). **The browser never queries PostgREST for content** — `createBrowserSupabaseClient()` remains auth-only (Phase 15 D3a). RLS stays default-deny with zero policies; the service-role client bypasses RLS by design and is the sanctioned server-side boundary.
- **`case_instances` gets no read and no write** (Phase 15 D4, Phase 16 §8a preserved).
- **Service-role key never reaches the browser** — no client component imports `admin.ts`.

---

## 6. Architecture and Data Flow

### 6.1 Generic shell + per-entity adapter registry (NOT a fully generic CRUD)

The nine entities share the lifecycle columns but diverge on content fields (§3). A single fully-generic CRUD that assumes identical fields would be wrong (and the user explicitly flagged this risk). The design is a **hybrid**:

- **One generic library shell** provides the list page, search/filter/sort/pagination, status badge, detail layout, empty/loading/error states, and the form scaffolding — all driven by a per-entity adapter.
- **Per-entity adapter registry** (`src/lib/library/registry.ts`) is the single source of truth per entity: `table`, `entityKey`, `label`, `singularLabel`, `titleColumn` ('title'|'name'), `listColumns` (id, title/name, status, version, updated_at + up to a few entity columns), `draftSchema` (from content-schema), `enumOptions` (for select fields, from shared-types enums), and the JSONB-field set (missions). Phase 16's `CONTENT_TABLES`/`TITLE_COLUMN` become re-exports of this registry (single source of truth; §11 Modify).

This mirrors the proven Phase 16 pattern (`CONTENT_TABLES` + `TITLE_COLUMN` + `MetricsClient`/`QueryBuilder` fake) and extends it with a per-entity field map. It keeps the 9 entities' differences explicit, type-safe, and unit-testable.

### 6.2 Data-access layer (server-only)

New module `src/lib/library/` mirrors `src/lib/dashboard/metrics.ts` structure and test style:

- `types.ts` — `LibraryQuery` (search/filter/sort/page), `LibraryResult<T>`, `LibraryClient` (extends the `QueryBuilder`-style thenable+chainable interface with `.ilike/.eq/.order/.range` for reads and `.insert/.update` for writes), `LibraryEntityKey` (= registry keys).
- `query.ts` — `listEntities(client, key, query)` (builds `select`, applies `ilike` on title/name, `eq` on status/enum filters, `order`, `range` for pagination, plus `{ count: 'exact' }`), `getEntity(client, key, id)`. Read-only, throws typed `LibraryError` on error.
- `mutate.ts` — `createEntity`, `updateEntity`, `duplicateEntity`, `archiveEntity` (build the row, apply lifecycle rules, return typed results). Pure row-shaping logic (no Supabase import) so unit tests inject a fake client.
- `validation.ts` — parse author input with the entity's content-schema `DraftSchema`; map `ZodError` → per-field error map for form display.
- `errors.ts` — typed `LibraryError` union (NotFound / PermissionDenied / Validation / Database) mirroring the `AdminAuthError` convention (local to admin, not shared-types).

### 6.3 Writes and lifecycle rules

All writes go through Server Actions → `mutate.ts` → service-role client. No direct client-side inserts/updates.

- **Create:** validate with `DraftSchema` → `INSERT { ...content fields, status:'draft', version:1 }` (server timestamps + uuid PK via DB defaults). Returns the new row; redirect to its detail page.
- **Edit:** validate with `DraftSchema` → `UPDATE` the content fields, `status` unchanged, **`version = old_version + 1`** (bump is app-side; the DB trigger only sets `updated_at`). §18.3 records this version-bump interpretation.
- **Duplicate:** `INSERT` copying the entity's content fields, `status='draft'`, `version=1`, new id, new timestamps. No relation rows are copied (relations are out of scope).
- **Archive:** `UPDATE status='archived'` (soft delete; `version` unchanged). No hard delete anywhere in Phase 17.

### 6.4 Search / Filter / Sort / Pagination (server-side)

- **Search:** `ilike` on the entity's `titleColumn` (title or name), `%term%`. Whitelisted column (from registry) — never user-supplied SQL.
- **Filter:** `eq` on `status` (all statuses incl. draft/review/published/archived) and, where the registry declares enum columns, `eq` on those enums (e.g. items.category, evidence.type, locations.type).
- **Sort:** whitelisted set: `updated_at` (default, desc), `created_at`, `title`|`name` (per entity), `status`, `version`. Direction asc/desc from a fixed enum — never raw input.
- **Pagination:** page size constant (e.g. 25), `range((page-1)*size, page*size)` + `{ count:'exact' }` for total pages; `?page=` query param, capped. All server-rendered (no client fetch).

### 6.5 Routing

- `/library` — library landing: nav card/list of the nine sections (labels from registry) + a back link to the dashboard.
- `/library/[entity]` — list page. `entity` validated against the registry; unknown → `notFound()`.
- `/library/[entity]/new` — create form (Server Action).
- `/library/[entity]/[id]` — detail page (read-only summary + Edit/Duplicate/Archive controls per §4; unknown id → `notFound()`).
- `/library/[entity]/[id]/edit` — edit form (Server Action).
- Dashboard (`/`) gains a small nav link to `/library` (and the library nav links back to the dashboard). No route-group refactor is required by Phase 17 (Phase 16 explicitly deferred it); the existing `proxy.ts` matcher already guards the whole admin shell.

### 6.6 UI states

- **Empty list:** per-entity empty state ("No {entities} yet." + Create button when permitted), reusing the Phase 16 `EmptyState` visual pattern.
- **Loading:** server components render synchronously; no client skeletons needed (mirrors Phase 16).
- **Error:** data-layer failure → a typed error banner (reuse the Phase 16 "Unable to load" pattern) with a retry affordance; per-field validation errors inline on forms.
- **Not found:** unknown entity or id → Next `notFound()`.
- **Archive confirmation:** archive is destructive-ish (soft delete); use a confirm affordance on the client before submitting the Server Action.

---

## 7. Repository / Service Boundaries

- **`apps/admin`** owns the library: `src/lib/library/` (registry, query, mutate, validation, errors, types), `src/app/library/**` (pages/actions), shared UI components, and tests. It imports from `@gate8/shared-types` (roles, enums, entity types) and `@gate8/content-schema` (draft schemas) and uses the service-role client.
- **`packages/shared-types`** — **unchanged** (constraint: leaf, no new dependencies; all Phase 15/16 types already exist).
- **`packages/content-schema`** — **unchanged** (constraint: reuse `*DraftSchema` + rule schemas for validation; no new schemas needed).
- **`packages/game-rules` / `packages/runtime`** — **untouched and stay pure** (Phases 13/14 dependency rules; the library does not import them; shared-types must never import game-rules — preserved).
- **Boundary rule:** the library is a **consumer** of the Phase 15 read/write boundary (service-role client + server-side role gates) and of the content-schema validation surface. It is **not** the owner of per-entity rich editing (18–22/23), validation (26), versioning history (27), release/publish (28), audit (40), or analytics (41/42). No new dependency direction is introduced.

---

## 8. Required Schema / Migration / Config Changes

### 8.1 Migration decision: REQUIRED — additive `0019_content_library_writes.sql`

**Provable from the live database (verified, post-0018):** `service_role` has **0 `INSERT` and 0 `UPDATE` grants** on the 9 content tables (`information_schema.role_table_grants`: only REFERENCES/SELECT/TRIGGER/TRUNCATE). Phase 17 requires Create/Edit/Duplicate/Archive — all writes. Because `auto_expose_new_tables` is unset (config.toml:24), base privileges are never auto-granted in this environment — the same root cause as 0018. Therefore **migration 0019 is required** and is an **infrastructure prerequisite, not design scope** (exactly parallel to the approved 0018 deviation).

**Exact SQL (9 tables, additive, SELECT already granted by 0018):**

```sql
-- 0019_content_library_writes.sql
-- Grant base INSERT/UPDATE privileges on the Phase 17 Content Library write
-- surface to `service_role` only.
--
-- WHY this migration is required (verified in this Supabase environment):
--   * Phase 17 Create/Edit/Duplicate/Archive run server-side through the
--     service-role client (`apps/admin/src/lib/supabase/admin.ts`).
--   * 0018 granted SELECT only; `service_role` still holds 0 INSERT/UPDATE
--     grants on these tables (role_table_grants = REFERENCES/SELECT/TRIGGER/
--     TRUNCATE). `rolbypassrls` grants no base table privileges.
--   * `config.toml` does not set `auto_expose_new_tables` (commented, line 24),
--     so nothing auto-grants base privileges to service_role.
--   * Without this grant, Phase 17 writes fail with `permission denied` for
--     table, exactly as Phase 16 reads did before 0018.
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
```

**No config.toml change.** **No RLS policy change.** **No new tables.** No sequence changes. `case_instances` and all relation tables remain un-granted.

### 8.2 Verification plan (from clean DB, implementation time)

1. `supabase db reset` (0001→0019 applies cleanly).
2. service-role client can `INSERT` + `UPDATE` each of the 9 tables; `SELECT` still works (0018).
3. `anon` and `authenticated` still have 0 grants and are denied (INSERT/UPDATE/SELECT).
4. `pg_policies` in `public` still 0 (no RLS policies added).
5. `case_instances` service_role INSERT/UPDATE/SELECT = 0 (untouched).
6. Reproducible on a second fresh reset.

---

## 9. Impact on shared-types / content-schema / runtime / game-rules

- **shared-types:** **unchanged.** Roles/enums/entity types/`roleHasPermission` consumed as-is. The library registry and error union stay local to `apps/admin` (YAGNI; shared-types remains purely additive when a real cross-package consumer appears). No new dependency direction; the "shared-types must never import game-rules" rule is untouched.
- **content-schema:** **unchanged.** All nine `*DraftSchema`s (and the mission/rule schemas) are reused for create/edit validation. No new schemas, no exported change.
- **runtime / game-rules:** **unchanged; remain pure.** The library never imports them.
- **Admin app (only code touched after approval):** see §11.

---

## 10. UI / Component Plan

- **Nav:** a small server-rendered nav header on the library pages (and a link on the dashboard): Dashboard ↔ Content Library. The nine sections listed from the registry. Tailwind v4 styling consistent with Phase 16 (zinc palette, rounded-lg borders, `lang="tr"` — keep **lowercase** text styling to avoid the Turkish dotless-ı artifact seen in Phase 16; labels are short words like "Dialogues").
- **List table:** generic table driven by `registry[key].listColumns`: id (truncated), title/name (linked to detail), status badge (reuse Phase 16 `statusLabel` coloring), version, updated_at (relative time via Phase 16 `formatRelative`), and per-entity columns (e.g. items.category, evidence.type, locations.type, cases.difficulty). Row actions column (Edit / Duplicate / Archive) gated per §4.
- **Search bar + filters + sort:** text input (title/name `ilike`), status `<select>`, per-entity enum filter where applicable, sort `<select>` with direction toggle. All as `<form>` GET submissions (server-rendered, no client data fetching).
- **Pagination:** prev/next + page indicator + total, from `{ count:'exact' }`.
- **Detail:** read-only field list (all entity columns labeled), status + version badges, Edit/Duplicate/Archive actions (gated).
- **Create/Edit forms:** generated from the adapter (fields from the draft schema + enum selects from shared-types + JSONB textarea for mission reward/completion_condition). Per-field errors from `validation.ts`. Server Actions return the previous input + field errors on failure (reuse the login form state pattern from `src/app/login`).
- **Shared components:** `src/components/library/` — `EntityTable`, `StatusBadge`, `SearchFilterBar`, `Pagination`, `EmptyState`, `ConfirmButton`. This is the first `components/` dir in the app; it is justified because 9 entities × multiple pages share these pieces (Phase 16 kept them inline because it had one page).
- **Empty/loading/error/not-found states** per §6.6.

---

## 11. Exact Expected Files

**Create (after approval):**

- `apps/admin/src/lib/library/types.ts` — `LibraryEntityKey`, `LibraryQuery`, `LibraryResult`, `LibraryClient` (QueryBuilder-style fakeable interface incl. `ilike/eq/order/range/insert/update`).
- `apps/admin/src/lib/library/registry.ts` — per-entity adapters (table, labels, titleColumn, listColumns, enumOptions, draftSchema, jsonbFields) + `LIBRARY_ENTITIES`; re-exports `CONTENT_TABLES`/`ContentTable` (moved from metrics.ts, §Modify).
- `apps/admin/src/lib/library/query.ts` — `listEntities`, `getEntity` (server-only reads).
- `apps/admin/src/lib/library/mutate.ts` — `createEntity`, `updateEntity`, `duplicateEntity`, `archiveEntity` (server-only writes; lifecycle rules §6.3).
- `apps/admin/src/lib/library/validation.ts` — DraftSchema parse + ZodError → field-error map.
- `apps/admin/src/lib/library/errors.ts` — `LibraryError` union + `mapLibraryError`.
- `apps/admin/src/app/library/page.tsx` — library landing (nav of 9 sections).
- `apps/admin/src/app/library/[entity]/page.tsx` — list page (gate + query + table + search/filter/sort/pagination).
- `apps/admin/src/app/library/[entity]/[id]/page.tsx` — detail page.
- `apps/admin/src/app/library/[entity]/new/page.tsx` — create form.
- `apps/admin/src/app/library/[entity]/[id]/edit/page.tsx` — edit form.
- `apps/admin/src/app/library/actions.ts` — Server Actions (create/update/duplicate/archive) with role gates.
- `apps/admin/src/components/library/EntityTable.tsx`, `StatusBadge.tsx`, `SearchFilterBar.tsx`, `Pagination.tsx`, `EmptyState.tsx`, `ConfirmButton.tsx`.
- `apps/admin/test/library/registry.test.ts`, `query.test.ts`, `mutate.test.ts`, `validation.test.ts`, `errors.test.ts` — Vitest unit tests with fake `LibraryClient`.
- `scripts/e2e-library.py` — Python Playwright library e2e (roles, CRUD, search/filter/sort/pagination, archive, empty/unauth states).

**Modify (after approval):**

- `apps/admin/src/lib/dashboard/metrics.ts` — move `CONTENT_TABLES`/`ContentTable` (+ `TITLE_COLUMN`) into the registry and re-export from `registry.ts`, so the dashboard and library share one source of truth (behavior-preserving; dashboard tests updated to keep passing).
- `apps/admin/src/app/page.tsx` — add a "Content Library" nav link (and the library links back). Dashboard otherwise unchanged.

**Do NOT touch (unchanged by this design):** `TODO.md`, every migration except the new `0019`, `config.toml`, `packages/shared-types`, `packages/content-schema`, `packages/game-rules`, `packages/runtime`, `case_instances`, RLS posture, `src/lib/supabase/{admin,server,browser}.ts`, `src/lib/auth/*`, `src/proxy.ts`, `.env`/`.env.example`.

---

## 12. Error / Failure Model

- **Auth/role:** handled by the page gate (§5) — unauthenticated → `/login`; no `view` → "Unauthorized". Mutations additionally re-check the operation permission inside the Server Action and return a typed denial (REVIEWER/EDITOR attempts are rejected server-side even if a crafted request bypasses the UI).
- **Validation:** `validation.ts` parses with the entity DraftSchema; failures return a per-field error map + previous input (no DB write attempted).
- **Database:** `mutate.ts`/`query.ts` throw typed `LibraryError` (NotFound / PermissionDenied / Validation / Database). Pages render a user-facing banner; forms surface server-action errors inline. Not-found ids → `notFound()`.
- **No data corruption paths:** archive is the only destructive-ish op and it is a status update (soft); it is gated on `delete` and confirm-backed. No hard delete exists in Phase 17.

---

## 13. Security Considerations

- **Service-role key stays server-only** (§5): every library query/mutation runs in Server Components / Server Actions via `createServiceRoleClient`; never imported from a client component.
- **No browser content access:** the browser client remains auth-only; no client-JWT read or write of content tables (Phase 15 D3a preserved).
- **Permission enforcement server-side:** every mutation re-derives the role from the token-verified `getUser()` and checks the operation's permission before any DB call; UI hiding is not the control.
- **Writes restricted by grant:** migration 0019 grants `INSERT/UPDATE` to `service_role` only — no `anon`/`authenticated`, no `DELETE`, no sequences, no RLS policies, no relation/`case_instances` grants. RLS stays default-deny.
- **No SQL injection:** search/filter/sort columns come from the hard-coded registry (`titleColumn`, whitelisted filter/sort sets); values go through PostgREST as bound parameters. No raw SQL, no user-supplied column names, no dynamic route params parsed into queries.
- **`case_instances` untouched** (§3): no grant, no read, no write — Phase 14/15 boundaries preserved.
- **No secrets, no new env vars** (§11); no new dependencies (§9).

---

## 14. Testing Strategy

- **Unit (Vitest, `apps/admin/test/library/`):** registry completeness (9 entities, valid titleColumns, DraftSchema present for each, enumOptions aligned with shared-types); query building against a fake `LibraryClient` (search `ilike` on titleColumn, status/enum `eq`, sort whitelist, pagination `range` + exact count, no `case_instances`/relation tables); mutation lifecycle (`createEntity` → draft v1; `updateEntity` → version+1, status preserved; `duplicateEntity` → draft v1 new id, content fields copied; `archiveEntity` → status archived); validation mapping; error union mapping. Tests inject the fake client exactly as `metrics.test.ts` does (no live DB).
- **Shared-types matrix test already covers** "every role has view" and the exact `ROLE_PERMISSIONS`; Phase 17 adds no permission-matrix change.
- **Integration against local Supabase (`supabase start` + `db reset` 0001→0019):** psql/Admin API checks per §8.2 (grants, denials, zero policies, `case_instances` untouched, reproducibility).
- **E2E (Python Playwright, `scripts/e2e-library.py`, seo venv):** unauth redirect; each role's library nav renders; REVIEWER sees list/detail but **no** Create/Edit/Duplicate/Archive controls; EDITOR can create/edit/duplicate but not archive; CONTENT_ADMIN can archive; SUPER_ADMIN full; create → appears in list as draft v1; edit → version bump + list reflects; duplicate → new draft v1; archive → status badge; search/filter/sort/pagination exercise; empty states; unknown entity/id → not-found. Mirrors `e2e-dashboard.py` structure (check/`passed`/`failed` lists).
- **Full suite at implementation time:** admin, shared-types, content-schema, game-rules, runtime Vitest suites green; `tsc --noEmit`, `eslint`, `prettier --check` clean; admin production `next build` OK (validates Next 16 server-action + SSR paths per AGENTS.md).

---

## 15. Explicitly Deferred Items (owning phases)

- Per-entity rich editors / fields not edited in Phase 17: portraits/assets upload, tags, roles, availability pools → **Phases 18–22/23** (character/item/document/evidence/location management).
- Case relation pools (`case_*`), location relation pools (`location_*`), chapter relations, location hierarchy UI → **Phases 22/23/25** (Case Builder, Location Management, Preview).
- Dialogue node graph (`dialogue_nodes`/`dialogue_node_choices`) → **Phase 24** (Dialogue Builder). Phase 17 edits only `dialogue_definitions.title/description`.
- Content validation engine → **Phase 26** (Phase 17 does not run validation beyond DraftSchema field checks; no aggregate validator).
- Full revision history, created-by/published-by, change summary, diff view, rollback → **Phase 27** (no revision store exists; Phase 17 must not create one).
- Publish / release / rollback → **Phases 27/28** (publish permission exists but Phase 17 has no release system; `status='published'` is not reachable from the library UI).
- Audit log, RLS grant matrix → **Phase 40**.
- Analytics / `case_instances` admin view → **Phases 41/42** (Phase 15 D4).
- Version history UI (beyond the read-only version badge) → **Phase 27** (§18.1).

---

## 16. Risks / Alternatives

- **Risk: one fully-generic CRUD abstraction assumed identical fields.** Mitigation: per-entity adapter registry (§6.1); registry completeness is unit-tested; fields stay type-safe and entity-specific.
- **Risk: write grants to service_role widen the attack surface.** Mitigation: `INSERT/UPDATE` only, `service_role` only, no anon/authenticated, no DELETE, no sequences, no RLS policies, no relation/`case_instances` grants; every mutation is role-gated server-side; grant surface verified from clean reset (§8.2).
- **Risk: archive misread as hard delete.** Mitigation: archive = `status='archived'` (soft), confirm dialog, gated on `delete`; no hard delete path exists (relation FKs RESTRICT anyway).
- **Risk: version-bump semantics drift from Phase 27.** Mitigation: Phase 17 bumps `version` on edit as a simple change indicator (existing column, app-side); full revision history is Phase 27 — explicitly separated (§18.3).
- **Alternative rejected: browser-side PostgREST reads/writes with anon/authenticated grants.** Rejected: violates Phase 15 D3a and the committed default-deny posture.
- **Alternative rejected: editing `dialogue_nodes`/relations in Phase 17.** Rejected: Phase 24/23 ownership; would duplicate scope and violate the additive migration strategy.
- **Alternative rejected: creating a `revisions`/`audit_log`/`history` table for "Version history".** Rejected: Phase 27/40 own those; Phase 17 must not invent backing stores (§18.1).

---

## 17. Decision Log

| ID  | Decision                      | Options                                           | Recommendation (resolved)                                             | Codebase check                                                        | Hidden implications                                                          |
| --- | ----------------------------- | ------------------------------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| D1  | Library abstraction           | one generic CRUD vs per-entity adapters vs hybrid | **Hybrid: generic shell + per-entity adapter registry**               | 9 tables share lifecycle but diverge on fields (§3)                   | Registry is single source of truth; CONTENT_TABLES re-exported from it       |
| D2  | Write migration               | reuse 0018 only (SELECT) vs add 0019              | **Add 0019: `INSERT, UPDATE` to service_role on the 9 tables**        | Live DB: service_role has 0 INSERT/0 UPDATE grants                    | Infrastructure prerequisite, parallel to 0018; additive, verified from reset |
| D3  | Archive semantics             | hard delete vs soft archive                       | **Soft archive: `status='archived'` (UPDATE), gated on `delete`**     | relation FKs RESTRICT; TODO lists Archive; matrix has no archive perm | No hard delete in Phase 17; confirm dialog; version unchanged                |
| D4  | Duplicate semantics           | copy incl. relations vs fields-only draft v1      | **Copy content fields only → new draft v1, new id**                   | relations out of scope (§3)                                           | No relation rows duplicated in Phase 17                                      |
| D5  | Write mechanism               | Server Actions + service-role vs browser client   | **Server Actions (Server Components) + `createServiceRoleClient`**    | Phase 15 D3a; admin.ts already server-only                            | Enforces role gate server-side; no client writes                             |
| D6  | Search/filter/sort/pagination | client-side vs server-side                        | **Server-side via service-role client; whitelisted columns**          | metrics.ts QueryBuilder precedent                                     | No SQL injection; count='exact' pagination                                   |
| D7  | Version on edit               | leave v1 vs bump                                  | **Bump `version = old + 1` on edit (app-side)**                       | DB trigger only sets updated_at                                       | Simple change indicator; full history = Phase 27 (§18.3)                     |
| D8  | `CONTENT_TABLES` ownership    | keep in metrics.ts vs move to registry            | **Move to library registry; metrics.ts re-exports**                   | single source of truth                                                | Dashboard behavior unchanged; dashboard tests updated                        |
| D9  | Entity keys / routing         | friendly slugs vs table names                     | **Table-name keys (`/library/[entity]`, validated against registry)** | `CONTENT_TABLES` names are the canonical set                          | Unknown entity → `notFound()`; TODO "Dialogues" = `dialogue_definitions`     |

---

## 18. Conflicts / Open Decisions Found (reported, per instruction)

The instruction requires explicit reporting rather than silent interpretation. Three tensions between TODO.md / prior design docs / the repository were found; each is resolved with a recommendation below but is **subject to your approval**:

1. **TODO §17 "Version history" vs Phase 27 "CONTENT VERSIONING".** TODO §17 lists "Version history" per entity; Phase 27 (lines 982–1001) owns revision history / created-by / published-by / change summary / diff / rollback, and **no revision store exists in migrations 0001–0018**. Implementing real history in Phase 17 would require inventing a `revisions` table — explicitly forbidden ("do not invent new tables unless the actual TODO/code/schema proves necessary"; Phase 27 owns it). **Recommendation:** Phase 17 shows the current `version` read-only (existing column) and defers full history to Phase 27. **If you want real history rows in Phase 17, that is a scope change requiring a new migration + Phase 27 re-plan — say so.**
2. **TODO §17 "Archive" vs Phase 15 matrix (no `archive` permission).** The matrix has `delete`, not `archive`. **Recommendation:** gate Archive on `delete` (SUPER_ADMIN/CONTENT_ADMIN only; EDITOR cannot archive). **If EDITOR must archive, that is a permission-matrix change (shared-types + Phase 40) — say so.**
3. **`service_role` has no INSERT/UPDATE → migration 0019 is required** (verified live). This parallels the approved 0018 deviation; presented as an **approved-deviation-required** item, not a silent design choice. **If you prefer a different write path (e.g. an Edge Function with its own grants), that changes the architecture — say so.**
4. **Mission `reward` / `completion_condition` (JSONB)** have no structured editor in Phases 17–25. **Recommendation:** Phase 17 edits them as schema-validated JSON text (via content-schema schemas); structured rule/reward editing stays future-phase. Alternative: read-only in Phase 17 (reduces the "edit every entity" TODO coverage) — say which you prefer.

Open (lower risk, implementation-time): exact page size; exact list columns per entity; whether the library nav lives in a shared header component vs per-page. These do not change architecture and are resolved during implementation within the §6/§10 constraints.

---

## 19. Self-Review (against the objective constraints)

- ✅ **Nine sections, all eight TODO capabilities mapped** (§1), grounded in the real TODO §17 text.
- ✅ **No invented tables or migrations** beyond the provable 0019 write grant (§8); no `revisions`/`audit`/`history` tables; `case_instances` and relations untouched.
- ✅ **shared-types / content-schema / game-rules / runtime unchanged** (§9); shared-types stays a leaf; no game-rules import; reuses `*DraftSchema`s.
- ✅ **Phase 15 default-deny preserved:** no RLS policies, no anon/authenticated grants, only `INSERT/UPDATE` to `service_role` (additive), no `DELETE`, no sequences.
- ✅ **Phase 15 auth + Phase 16 architecture reused:** same gate (`getUser` → `roleFromUser` → `roleHasPermission`), same service-role server-only client, same fake-client test pattern; browser never touches content (D3a).
- ✅ **case_instances explicitly out of scope** (Phase 15 D4) — no grant, no read, no write.
- ✅ **REVIEWER read-only; EDITOR vs CONTENT_ADMIN vs SUPER_ADMIN behaviors explicit** (§4), enforced server-side.
- ✅ **Generic-vs-adapters question answered** (§6.1): hybrid, because the entities demonstrably diverge.
- ✅ **No Phase 18+ work started** — no rich editors, case builder, dialogue builder, preview, validation engine, versioning history, release system.
- ✅ **Exact files listed** (§11); conflicts reported rather than silently resolved (§18).
- ✅ **DESIGN ONLY** — this document is untracked and will remain uncommitted until approval; `git status` at handoff shows only this file as untracked.

---

## 20. Conclusion

Phase 17 delivers the **Admin Content Library**: a central, authenticated, server-side library over the nine content entities (characters, items, documents, evidence, locations, missions, dialogue definitions, cases, chapters) providing search, filter, sort, pagination, detail, create, edit, duplicate, and archive — with REVIEWER read-only, EDITOR create/edit/duplicate, CONTENT_ADMIN + archive, and SUPER_ADMIN full control, all enforced server-side through the Phase 15 role gate and the Phase 16 service-role client. The implementation uses a **generic library shell driven by a per-entity adapter registry** (not a fake fully-generic CRUD), reuses content-schema `*DraftSchema`s for validation and shared-types roles/enums as-is, requires **one new additive migration (`0019`)** granting `INSERT/UPDATE` to `service_role` only (provable from the live DB, parallel to the approved 0018 deviation), and changes **no shared-types / content-schema / game-rules / runtime code and no RLS policy**. Full revision history, publish/release, relation/case/dialogue-builder surfaces, validation, audit, and analytics are explicitly deferred to their owning phases. **This document is a design proposal; it will not be committed or pushed until you approve.**
