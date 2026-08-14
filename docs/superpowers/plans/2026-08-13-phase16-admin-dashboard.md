# Phase 16 — Admin Dashboard

> **Status:** IMPLEMENTED and pushed (`3f7c751` design, `14e2a7e` implementation, HEAD == origin/main). This document is the amended design record: the original design said "no migration" (below), and one **approved additive deviation** — migration `0018_service_role_reads.sql` — was required and recorded in §8a "Implementation Deviation / Environment Finding". This design spec governs the read-only Admin Dashboard for the Gümrük Kontrol Memuru CMS. It grounds every claim in the actual repository state at `fdb28f4` (`main`, Phase 15 committed and pushed, clean tree).
>
> **Scope:** A read-only dashboard delivered as the new landing surface of the existing admin shell, showing the eleven metrics named in `TODO.md` Phase 16. It determines which of those metrics are computable from the existing schema now, which are deferred to their owning phases (26 validation, 27 versioning, 28 release, 40 audit, 41 analytics), how the dashboard authenticates and authorizes server-side, and exactly which files are added or modified.
>
> **Explicitly OUT of scope (deferred with owning phases):** content CRUD (Phases 17–25), content validation logic (Phase 26), content versioning history/diff (Phase 27), the content release system (Phase 28), RLS grants and the audit log (Phase 40), player/metrics analytics visualizations (Phase 41/42), and content-library navigation. Phase 16 shows only what already exists; it creates no backing store for any metric.

---

## 1. Objective and TODO Mapping

`TODO.md` Phase 16 (lines 677–695) defines the deliverable:

> **PHASE 16 — ADMIN DASHBOARD**
>
> Create dashboard.
>
> Show:
>
> - [ ] Total Chapters.
> - [ ] Total Cases.
> - [ ] Total Characters.
> - [ ] Total Items.
> - [ ] Total Documents.
> - [ ] Total Evidence.
> - [ ] Draft content.
> - [ ] Published content.
> - [ ] Recent changes.
> - [ ] Recent releases.
> - [ ] Content validation errors.

**Goal of this phase:** replace the current placeholder admin shell (`apps/admin/src/app/page.tsx`, which today renders a permissions list plus a disabled "Publish (placeholder)" button and the caption "Content management UI ships in Phase 16+") with a read-only dashboard that surfaces the eleven metrics above, using the auth + RBAC plumbing already shipped in Phase 15 and the **existing** schema/migrations (no new tables). It must not start any later phase (17+ CRUD, 26 validation, 28 release, 40 audit, 41 analytics).

**Read-only posture.** Nothing in Phase 16 writes to any content table, creates any release/validation/change record, or introduces a persistence layer. The dashboard computes each metric on demand from the current rows.

---

## 2. Current State (verified at `fdb28f4`)

Ground-truth inventory of what exists before Phase 16:

- **Admin shell (`apps/admin`) is now authenticated.** Phase 15 shipped and committed: `src/proxy.ts` (Next.js 16 session-refresh guard; redirects unauthenticated visitors to `/login`, allows recovery-flow pages through for authenticated users), `src/lib/supabase/{server,browser,admin}.ts` (`server.ts` = `createServerClient` used in server components/actions, `admin.ts` = server-only `createServiceRoleClient` using `SUPABASE_SERVICE_ROLE_KEY`), `src/lib/auth/{roles,errors,login-state}.ts` (role read from `app_metadata.role` via `roleFromUser`, typed `AdminAuthError`), login / forgot-password / update-password / `/auth/callback` routes, and the admin shell `src/app/page.tsx` which calls `supabase.auth.getUser()`, derives the role, and renders a permissions list + placeholder.
- **Roles & permissions (Phase 15, committed in shared-types).** `ADMIN_ROLES = ['SUPER_ADMIN','CONTENT_ADMIN','EDITOR','REVIEWER']`, `ADMIN_PERMISSIONS = ['view','create','edit','delete','publish','rollback']`, the `ROLE_PERMISSIONS` matrix, and `roleHasPermission()` live in `packages/shared-types/src/enums.ts`. Every role includes `view`; REVIEWER is view-only. This is the contract Phase 16 UI gating consumes.
- **Schema (migrations 0001–0017, frozen, applied cleanly).** Every content entity table carries the shared lifecycle columns defined in `0002_lifecycle.sql` (`content_status` enum `'draft','review','published','archived'` + `set_updated_at()` trigger) and repeated per table: `status content_status not null default 'draft'`, `version int not null default 1`, `created_at`, `updated_at`, plus a `*_status_idx` index. Entity inventory relevant to the counts (columns verified by reading each migration):
  - `chapters` (0014): `title`, `description`, `sort_order`, lifecycle columns. No entity-ownership of characters/items/documents/evidence; references Locations/Cases via `chapter_*` (0015).
  - `cases` (0011 anchor + 0016 config): `title`, `description`, `type`, `difficulty`, `min_*`/`max_*` bounds, lifecycle columns.
  - `characters` (0003): `name`, plus `content_status`/`version`/timestamps.
  - `items` (0004): `name`, `item_category`, `item_rarity`, `risk_level`, lifecycle columns.
  - `documents` (0005): `title`, `type`, lifecycle columns.
  - `evidence` (0006): `name`, `evidence_type`, `evidence_importance`, lifecycle columns.
  - `locations` (0007): `name`, `location_type`, `parent_id`, lifecycle columns.
  - `missions` (0009): `title`, lifecycle columns.
  - `dialogue_definitions` (0008): `title`, lifecycle columns (the `dialogue_nodes`/`dialogue_node_choices` are child rows, not lifecycle-carrying content objects).
  - Relation tables `case_*` (0012), `location_*` (0013), `chapter_*` (0015): carry a `version` but **no** `content_status` lifecycle of their own.
  - `case_instances` (0017): **runtime data**, `instance_status` enum (`generated/active/completed/abandoned`) — NOT content; no admin access (Phase 15 decision D4).
- **No backing stores exist** for "Recent releases" (no `releases` table anywhere in 0001–0017), for "Content validation errors" (no validation-result store), or for a durable revision/change history (content tables carry `version` + `updated_at` but no revision rows — Phase 27 owns revision history). Verified: the migration inventory (0001–0017) contains no dashboard/release/change/validation/audit table.
- **content-schema (`packages/content-schema`)** exports per-entity Zod schemas (`characterSchema`, `itemSchema`, `documentSchema`, `evidenceSchema`, `locationSchema`, `caseSchema`, `chapterSchema`, `dialogueSchema`, `missionSchema`) plus rule/completion/discovery payload schemas via `src/index.ts`. These define "what makes ONE record structurally valid." There is **no** aggregate/cross-entity "validate the whole content library" entry point — full validation is Phase 26's scope.
- **Docs (governing conventions):** `docs/architecture/api-contract-strategy.md` (Admin CMS talks to Supabase via typed clients; RLS enforces row-level permissions; Edge Functions for server-only privileged work), `database-migration-strategy.md` (additive migrations; never edit an applied migration; one concern per migration; no premature policies), `shared-types-strategy.md` (entities mirror DB columns; enums in one place; no runtime in shared-types).

---

## 3. Phase 16 Metric Inventory and Feasibility

The eleven TODO items fall into three buckets: computable from the existing schema now (no schema migration — the metric computation itself needs no new table/column; the approved `0018` base-privilege grant in §8a is separate and infra-only), computable from existing columns but semantically limited, and not-backed-anywhere yet (owning phase).

| #   | Metric (TODO)             | Computable now from schema? | Backing source (verified)                                                 | Determined disposition                                                                               |
| --- | ------------------------- | --------------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| 1   | Total Chapters            | ✅                          | `count(*)` on `chapters`                                                  | Render (all statuses)                                                                                |
| 2   | Total Cases               | ✅                          | `count(*)` on `cases`                                                     | Render (all statuses)                                                                                |
| 3   | Total Characters          | ✅                          | `count(*)` on `characters`                                                | Render (all statuses)                                                                                |
| 4   | Total Items               | ✅                          | `count(*)` on `items`                                                     | Render (all statuses)                                                                                |
| 5   | Total Documents           | ✅                          | `count(*)` on `documents`                                                 | Render (all statuses)                                                                                |
| 6   | Total Evidence            | ✅                          | `count(*)` on `evidence`                                                  | Render (all statuses)                                                                                |
| 7   | Draft content             | ✅                          | sum of `count(*) where status='draft'` over the nine lifecycle tables     | Render                                                                                               |
| 8   | Published content         | ✅                          | sum of `count(*) where status='published'` over the nine lifecycle tables | Render                                                                                               |
| 9   | Recent changes            | ⚠️ partial                  | `updated_at`/`version` on content tables; **no revision-history rows**    | Render "recently updated content" from `updated_at`; full revision history/diff deferred to Phase 27 |
| 10  | Recent releases           | ❌                          | no `releases` table exists (0001–0017)                                    | Deferred to Phase 28 — Phase 16 renders an honest empty state                                        |
| 11  | Content validation errors | ❌                          | no validation store; content-schema has no aggregate validator            | Deferred to Phase 26 (+ Phase 40 audit) — Phase 16 renders an honest empty state                     |

**Decisions on the three deferred metrics.** Phase 16 is read-only and must not create backing tables. "Recent releases" and "Content validation errors" have **no data source**, so Phase 16 renders an honest empty state ("No releases yet — releases ship with the Content Release System (Phase 28)" / "No validation issues on file — content validation ships in Phase 26") rather than inventing a dashed/zero value that could be mistaken for a real count. "Recent changes" is rendered from the real `updated_at` column now (a recently-updated list), with an explicit UI caveat that authoritative change summaries/history/diff are Phase 27 (Content Versioning).

**Naming precondition check:** there is no existing "dashboard" table or metric store, and no conflicting "Total X"/"Draft/Published content" semantics in the schema — so Phase 16 defines these metrics fresh without colliding with anything pre-existing.

---

## 4. Content Tables and Denominator Semantics

To keep "Total X" and "Draft/Published content" unambiguous, Phase 16 fixes the **content-table set** and the counting rule:

- **Counted content tables (the lifecycle set):** `characters`, `items`, `documents`, `evidence`, `locations`, `missions`, `dialogue_definitions`, `cases`, `chapters`. These nine all carry `content_status`/`version`/timestamps (verified in 0003–0016).
- **Not counted:** relation tables (`case_*`, `location_*`, `chapter_*`) — join/configuration rows with a `version` but no independent `content_status` lifecycle; they are not the "content objects" the dashboard counts. **`case_instances` is excluded by design** — runtime data, not content (Phase 14 §6; Phase 15 D4 defers instance analytics to Phase 41/42).
- **Draft content / Published content** = sum of `count(*) where status='draft'` (respectively `'published'`) over the nine lifecycle tables. `'review'` and `'archived'` are not separately surfaced as Phase 16 headline numbers (TODO names exactly two lifecycle buckets: Draft and Published); they remain queryable in Phase 17+ and are documented as out of the headline count.
- **Total Chapters / Total Cases / Total Characters / Total Items / Total Documents / Total Evidence** = `count(*)` across **all** statuses for that entity, matching TODO's plain "Total" wording and the existing per-entity CLIs.

These semantics are the only sane reading of the TODO wording against the frozen schema; they are stated in a metric-definition note in the UI so the reviewer, Phase 17+ CRUD, Phase 26 validation, and Phase 27/28 versioning/release share the same denominator.

---

## 5. Authentication / Authorization (server-side, reusing Phase 15)

Phase 16 introduces **no new auth**; it consumes the Phase 15 plumbing:

- **Dashboard data access is server-side only.** Every content query runs in a **Server Component** (or a server action / route handler where a refresh is needed) via the **service-role client** `createServiceRoleClient()` (`src/lib/supabase/admin.ts`), which bypasses RLS. This is exactly the Phase 15 §8 D3(a) posture: RLS stays **default-deny with zero new policies** (0010 enablement + per-table `enable row level security`). **One additive base-privilege migration** (`0018_service_role_reads.sql`) grants `SELECT` to `service_role` **only** because this Supabase environment does not auto-expose tables (see §8a); it grants nothing to `anon`/`authenticated` and adds no RLS policy. The browser never queries PostgREST for content; there is no client-JWT read of any content table. **No RLS policy and no PostgREST grant** is added by Phase 16.
- **Authorization gate.** The dashboard route reads `supabase.auth.getUser()` (token-verified — never `getSession` alone), derives the role with `roleFromUser`, and requires the `view` permission via `roleHasPermission(role, 'view')`. Because every role in the Phase 15 matrix includes `view`, all four admin roles can see the dashboard — REVIEWER included (view-only is exactly its job). The guard is server-side: not authenticated → `redirect('/login')`; authenticated but role null/unknown or lacking `view` (defensive; no shipped role lacks `view`) → render an "unauthorized" state distinct from not-logged-in. No client-side role decision is ever trusted for the gate.
- **Service-role key never reaches the browser.** All dashboard queries live in server components; `SUPABASE_SERVICE_ROLE_KEY` stays server-only.
- **`case_instances` gets no read.** Consistent with Phase 15 D4, Phase 16 does not touch `case_instances` (it is outside the lifecycle set, §4).

---

## 6. Architecture and Data Flow

- **Route:** the existing shell `src/app/page.tsx` becomes the dashboard — it is already the authenticated landing page that `proxy.ts` redirects to. **Determined:** keep `src/app/page.tsx` as the dashboard for Phase 16 (no `(dashboard)` route-group refactor); Phase 17 introduces content-library navigation/sidebar.
- **Data-access module:** a small, pure, server-only `src/lib/dashboard/metrics.ts` exposes typed helpers the page calls:
  - `countRows(client, table): number` — `select('id', { count: 'exact', head: true })` per table.
  - `countByStatus(client, tables, status): number` — sum of per-table `select('id', { count: 'exact', head: true }).eq('status', status)`.
  - `recentChanges(client, tables, { limit }): RecentChange[]` — per table `select('id, <title|name>, status, version, updated_at').order('updated_at', { ascending: false }).limit(limit)`, merged and re-sorted. Column name differs per entity (`title` for cases/chapters/documents/missions/dialogue_definitions; `name` for characters/items/evidence/locations) — resolved by an explicit per-entity field map so no SQL interpolation of user input ever happens, only a hard-coded map.
- **Server Component renders the dashboard.** Because reads happen at render time in server components, no client fetch/SWR is needed. `DashboardMetrics` and `RecentChange` types are defined in the data layer.
- **Determinism/compatibility:** Phase 16 only reads; it alters no generation/deterministic contract (Phases 6–13) and no Phase 14 case-instance persistence path. There is no write path, so nothing can affect seeded generation or instance rows.

---

## 7. Repository / Service Boundaries

- **`apps/admin`** owns the dashboard UI + the server-only data-access module (`src/lib/dashboard/metrics.ts`) and the `DashboardMetrics`/`RecentChange` types. App-layer code; it may import from `@gate8/shared-types` and use the service-role client.
- **`packages/shared-types`** — **unchanged in Phase 16.** No future consumer of metric types exists in-repo yet (Edge Function/Phase 28/41 are not built), so `DashboardMetrics`/`RecentChange` stay **local to `apps/admin`** (YAGNI; shared-types remains purely additive when a real cross-package consumer appears). Existing `ADMIN_ROLES`/`ROLE_PERMISSIONS`/`roleHasPermission` are consumed as-is.
- **`packages/content-schema`** — **untouched.** The dashboard does not validate content (validation is Phase 26); no aggregate validator is added here, and content-schema must not be made to own a dashboard metric type.
- **`packages/game-rules` / `packages/runtime`** — **untouched and stay pure** (Phases 13/14 dependency rules; the dashboard does not import them).
- **Boundary rule:** the dashboard is a **consumer** of the existing read surface (service-role reads of the frozen schema + the Phase 15 role checks). It is **not** the owner of domain-generation logic (game-rules/runtime), not the owner of validation (content-schema/Phase 26), not the owner of releases/versioning (Phases 27/28), and not the owner of RLS (Phase 40). No new dependency direction is introduced.

---

## 8. Required Schema / Migration / Config Changes

**Original design determination: NONE** — no schema, table, column, enum, trigger, or index change was planned (rationale below). During implementation, one **approved additive migration** became necessary (infrastructure, not design scope): `0018_service_role_reads.sql` — base `SELECT` privileges for the server-side `service_role` reads this dashboard performs. Full rationale and the exact grant surface are recorded in **§8a**. The original design reasoning still holds and is kept here:

- Every Phase 16-servable metric (total counts, draft/published counts, recent changes via `updated_at`/`version`) is computable from **existing columns and indexes** (`*_status_idx`, `created_at`, `updated_at`, `version`). There is no new column, table, enum, trigger, or index to add.
- Deferred metrics ("Recent releases", "Content validation errors") have **no backing store** and **must not be given one in Phase 16** — creating `releases` or `validation_*`/`audit_log` tables would duplicate Phase 28/26/40 scope and violate the additive, one-concern migration strategy. They are surfaced as empty states (§10/§3).
- No `config.toml` change is required (auth/config settled in Phase 15).
- `0010_rls.sql` and the per-table `enable row level security` calls stay **zero-policy**; Phase 16 adds **no** grants to `anon` or `authenticated`, preserving the verified default-deny invariant.

### 8a. Implementation Deviation / Environment Finding (approved, post-design)

**What happened:** The implementation of this dashboard performs server-side content reads through the **service-role client** (`createServiceRoleClient()`, `apps/admin/src/lib/supabase/admin.ts`). Testing from a clean database proved that in **this Supabase environment** the `service_role` database role does **not** receive base `SELECT` privileges on `public` content tables automatically:

- `config.toml` does **not** set `auto_expose_new_tables` (it is commented out), so this stack follows the newer default where tables created by `postgres` in `public` are **not** auto-exposed to `anon`/`authenticated`/`service_role`.
- `service_role` has `rolbypassrls = true` (it bypasses RLS), but bypassing RLS grants **no base table privileges**. Verified via `information_schema.role_table_grants`: before `0018`, `service_role` held only `DELETE`/`REFERENCES`/`TRIGGER`/`TRUNCATE` on these tables — no `SELECT` — so dashboard reads failed with `permission denied for table ...`.

**The approved deviation:** migration **`0018_service_role_reads.sql`** was added. It grants **`SELECT` only to `service_role`** on exactly the nine content tables that make up the Phase 16 dashboard read surface (`CONTENT_TABLES` in `apps/admin/src/lib/dashboard/metrics.ts`):

- `public.characters`
- `public.items`
- `public.documents`
- `public.evidence`
- `public.locations`
- `public.missions`
- `public.dialogue_definitions`
- `public.cases`
- `public.chapters`

**Explicitly preserved by the deviation (Phase 15 default-deny model is NOT weakened):**

- **No** `SELECT` (or any other privilege) to `anon` or `authenticated` — those roles remain denied and RLS still applies to them.
- **No RLS policies are added or modified.** `0010_rls.sql` and every per-table `enable row level security` stay zero-policy. The deviation changes _base table privileges for the server-side role only_; it does not change row-level security posture.
- **No `INSERT`/`UPDATE`/`DELETE`/`TRUNCATE`/`REFERENCES`/`TRIGGER` grants** — read-only, matching the read-only dashboard.
- **No sequence grants** — the dashboard never generates identifiers.
- **`case_instances` is explicitly excluded**, consistent with Phase 15 D4 and D4 below: it is runtime data (Phase 14), not content; admin view of instances is deferred to Phase 41/42 analytics.
- **No `config.toml` change** and `auto_expose_new_tables` is left unset.

**Why this is correct and not a security regression:** `service_role` is the server-side trusted key used exclusively by server components behind the Phase 15 auth gate (`getUser` → `roleFromUser` → `roleHasPermission(view)`); it never reaches the browser. The grant adds no client-facing access — the browser path (anonymous/authenticated users) still has zero base privileges and zero RLS policies. The default-deny invariant for non-service roles is unchanged and asserted in tests.

**Reproducibility:** `0018` is an **additive, committed migration** in the normal `0001→0018` sequence. `supabase db reset` applies it cleanly and deterministically, so fresh environments get the identical grant surface. This is **required for fresh environments**: without it, the Phase 16 dashboard's service-role reads fail in any newly reset stack that does not auto-expose tables.

---

## 9. Impact on shared-types / content-schema / runtime / game-rules

- **shared-types:** unchanged. Existing role consts + `roleHasPermission` are consumed by the dashboard gate; no metric types exported (kept local, §7).
- **content-schema:** unchanged. No validation surface added; Phase 26 owns validation. Phase 16 does not duplicate schema concepts or add an aggregate validator.
- **runtime / game-rules:** unchanged; remain pure and dependency-free.
- **Admin app (only touched code, after approval):** `src/app/page.tsx` (render dashboard) and new `src/lib/dashboard/metrics.ts` (+ tests).

---

## 10. UI / Component Plan

Phase 16 renders the dashboard as static server-rendered cards (Tailwind, matching the existing `zinc` design language in `page.tsx`/`layout.tsx`):

- **Header** (reuse existing shell header: "Admin Console" + signed-in-as/role + Sign out) — unchanged.
- **Entity count row (six cards):** Total Chapters, Total Cases, Total Characters, Total Items, Total Documents, Total Evidence — each `count(*)` over all statuses (§4).
- **Lifecycle count row (two cards):** Draft content, Published content — status-bucket sums over the nine lifecycle tables (§4).
- **Recent changes:** a list of the N most recently `updated_at` content items (entity label, title/name, status chip, `v{version}`, relative timestamp), ordered ascending-by-age descending-by-date (most recent first). Full revision history/diff → Phase 27; this is a "recently touched" view from the real `updated_at` column, with a UI note reading "full change history and diffs ship in Phase 27".
- **Recent releases:** an empty-state card ("No releases yet — releases ship with the Content Release System (Phase 28)"). No data source exists (§3).
- **Content validation errors:** an empty-state card ("No validation issues on file — content validation ships in Phase 26"). No store exists (§3); the dashboard does **not** run validation at render time (that would be Phase 26 logic).

**Determined:** a single screen, no client interactivity, no charts (YAGNI; Phase 41/42 own analytics visualizations). All four roles see the same read-only cards (all have `view`); REVIEWER included.

---

## 11. Exact Expected Files

**Create (after approval):**

- `apps/admin/src/lib/dashboard/metrics.ts` — server-only data-access helpers + `DashboardMetrics`/`RecentChange` types + the content-table set constant + per-entity `title|name` field map.
- `apps/admin/test/dashboard/metrics.test.ts` — unit tests for the pure helpers (count/status-sum/recent-changes merge, column-name resolution, lifecycle-set excludes relations + `case_instances`) by injecting a fake client/typed results — logic testable without a live Supabase (mirrors `apps/admin/test/auth/*.test.ts` style).

**Modify (after approval):**

- `apps/admin/src/app/page.tsx` — render the dashboard from `metrics.ts` behind the Phase 15 server-side gate (`getUser` → `roleFromUser` → require `view`); keep the existing sign-out/role header; remove the placeholder "Publish (placeholder)" button and "Content management UI ships in Phase 16+" caption.

**Do NOT touch (unchanged by this design):** `TODO.md`, every migration (`backend/supabase/migrations/*`), `config.toml`, `packages/shared-types`, `packages/content-schema`, `packages/game-rules`, `packages/runtime`, `case_instances` access, RLS posture, `.env`/`.env.example`.

No new dependencies, no new env vars, no package.json change.

---

## 12. Error / Failure Model

- **Not authenticated** → `proxy.ts` already redirects to `/login` (Phase 15); a defensive server-side check in `page.tsx` also `redirect('/login')`.
- **Authenticated but role null/unknown or lacking `view`** → render an "unauthorized" state (distinct from not-logged-in); never silently fall back to the service role. (No shipped role lacks `view`, but the gate is defensive.)
- **Service-role read fails / Supabase unavailable** → render the dashboard with a clear per-section error state ("unable to load") rather than crashing the whole page; no secrets or stack details in the UI.
- **Counting edge cases:** zero rows in a table → `0` (correct via exact count); `updated_at` ties → stable secondary sort by title/name then `id`; per-entity `title` vs `name` resolution is explicit in the field map (§6). No inventing of missing columns.

---

## 13. Security Considerations

- **Service-role key stays server-only** (§5): dashboard queries run only in server components via `createServiceRoleClient`; never exported to client components; never in the browser bundle.
- **No RLS weakening.** Zero new RLS policies, zero grants to `anon`/`authenticated`; the verified default-deny invariant (Phase 15 §20 / D3a) is preserved and asserted in tests (psql `policy_count` stays 0 on content tables and `case_instances`). The only added privilege is the approved `0018` base `SELECT` to `service_role` (server-side role only, §8a), which grants no client-facing access.
- **Authorization never decided client-side.** Gate uses token-verified `getUser()` + `roleFromUser` + `roleHasPermission`; the UI may display the role but never authorizes from it.
- **No new attack surface:** read-only, no writes, no user-supplied SQL, no dynamic route params parsing arbitrary input; column names come from a hard-coded per-entity field map (no raw interpolation).
- **`case_instances` untouched** (§4/§5) — no admin read of runtime data; keeps Phase 14/15 boundaries.
- **No secrets, no new env vars** (§11).

---

## 14. Testing Strategy

- **Unit (Vitest, `apps/admin`)** — test the pure helpers in `metrics.ts` with a fake/typed client:
  - `countRows` issues an exact, head-only count per table → returns N.
  - `countByStatus` sums per-table status counts.
  - `recentChanges` merges per-entity results, resolves `title`/`name`, sorts by `updated_at` desc, applies `limit`, breaks ties stably.
  - The lifecycle-table set constant omits relation tables and `case_instances`.
  - `DashboardMetrics`/`RecentChange` types shape.
- **Gate test:** `roleFromUser`/`roleHasPermission` are already covered in `apps/admin/test/auth/*`; add a small assertion that **every** role has `view` (so the dashboard gate admits all four roles — a guard against future matrix drift in shared-types).
- **Integration against local Supabase (`supabase start`):** seed a few rows across tables via psql/service role; verify the dashboard server-component queries return expected totals/draft/published/recent lists; verify `case_instances` is excluded.
- **RLS/psql (Phase 14 §27 / Phase 15 §15 style):** after Phase 16, assert `policy_count` is still 0 on the content tables and `case_instances` (`anon`/`authenticated` remain denied).
- **E2E (Playwright is available, base URL `http://localhost:3000` — Next binds IPv6 `*:3000`; `127.0.0.1:3000` is an unrelated local docker container):** login as each provisioned role (super@gumruk.local SUPER_ADMIN, reviewer@gumruk.local REVIEWER, editor@gumruk.local EDITOR) → dashboard renders with cards; unauthenticated redirects to `/login`; empty-states render for Recent releases and Content validation errors; REVIEWER sees the dashboard (view-only).
- **Suites remain green:** admin 22+, shared-types 18+, content-schema 38, game-rules 1317, runtime 27; `next build` + `npm start` sanity for `apps/admin` (mirroring Phase 15's production-mode validation).

---

## 15. Explicitly Deferred Items

- **Full content validation engine (required fields, references, missing assets, broken dialogue links, min<=max, pool size, solvability)** → Phase 26 (TODO lines 963–980). Phase 16 only shows the empty state.
- **Content versioning (revision history, created/published by, published date, change summary, diff view, rollback)** → Phase 27 (TODO lines 982–1001). Phase 16's "Recent changes" is the raw `updated_at`/`version` view only.
- **Content Release System (`releases` states DRAFT/TESTING/SCHEDULED/PUBLISHED/ROLLED_BACK)** → Phase 28 (TODO lines 1004–1022). No `releases` table exists; Phase 16 shows the empty state.
- **RLS policy grants, publish permission, API authorization, audit log, storage permissions** → Phase 40 (TODO lines 1272–1289). Phase 16 adds zero policies; data access is server-side service-role + server-side role checks until then.
- **Admin analytics (active players, cases started/completed, completion rate, drop-offs)** → Phases 41/42 (TODO lines 1293–1308). Phase 16 counts content only; `case_instances` is untouched.
- **Content CRUD / Content Library navigation UI** → Phases 17–25 (TODO lines 697–961). Phase 16 is read-only.
- **Any dashboard refresh/caching architecture (SWR, background jobs, metrics snapshots)** → not required now; the dashboard queries on demand per render.
- **Metric types shared to Edge Functions / future consumers** → deferred until a real consumer exists (§7).

---

## 16. Risks / Alternatives

- **Risk: "Recent releases" and "Content validation errors" surfaced as zero/dashed could be misread as real zeros.** Mitigation: explicit empty-state copy naming the owning phase (28/26), distinct visual treatment (muted card, not a numeric "0" stat), and a UI note explaining the metric has no backing store yet.
- **Risk: the "Recent changes" list could be mistaken for an authoritative change history.** Mitigation: the chart is labeled "Recently updated content" with a Phase 27 note; `version` is displayed but no diff/rollback is implied.
- **Risk: per-entity `title` vs `name` column divergence breaks the generic count/recent query.** Mitigation: the per-entity field map is the single source of truth (§6); unit tests cover column resolution; the lifecycle set is a constant both the count helpers and the page consume.
- **Alternative rejected: creating `releases`/`validation_errors`/`dashboard_metrics` tables in Phase 16.** These are frozen/phase-owned concerns (26/27/28/40); creating them would duplicate scope and violate the migration strategy.
- **Alternative rejected: running full content validation at render time to populate "Content validation errors".** That is Phase 26 logic; Phase 16 shows the empty state instead.
- **Risk: extending dashboard data reads to `case_instances`.** Rejected (Phase 15 D4): instances are runtime data; admin view is analytics (Phase 41/42), server-side and audited. Phase 16 does not read them.
- **Risk: Next.js 16 App Router specifics (Server Components, `proxy.ts`).** Phase 15 already validated the production-mode path (`@supabase/ssr` × Next 16 build). Phase 16 uses standard Server Components only; per `apps/admin/AGENTS.md`, the implementer must read `node_modules/next/dist/docs/` before writing code, mirroring Phase 15.

---

## 17. Decision Log

| ID  | Decision                                       | Options                                                                  | Recommendation (resolved)                                                                                        | Codebase check                                                             | Hidden implications                                                                                                  |
| --- | ---------------------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| D1  | Backing for "Recent releases" metric           | render empty state vs create `releases` table                            | **Empty state; defer to Phase 28**                                                                               | no `releases` table in 0001–0017                                           | Phase 28 designs the table one-concern; Phase 16 must not pre-create it                                              |
| D2  | Backing for "Content validation errors" metric | render empty state vs create validation store / run validation at render | **Empty state; defer to Phase 26 (+ Phase 40 audit)**                                                            | no validation store; content-schema has no aggregate validator             | Phase 16 must not run Phase 26 logic or invent a validator                                                           |
| D3  | "Recent changes" semantics                     | raw `updated_at`/`version` view vs backfill revision history             | **Raw `updated_at`/`version` view, labeled "Recently updated content"**                                          | `updated_at`/`version` on all nine lifecycle tables; no revision rows      | Phase 27 owns revision history/diff; no backfill table here                                                          |
| D4  | Content-table set (denominator)                | nine lifecycle tables + relation tables vs nine only                     | **Nine lifecycle tables only; excludes relations and `case_instances`**                                          | relations lack `content_status`; `case_instances` is runtime (Phase 15 D4) | Provides the Phase 17/26/28 shared denominator; documented in UI note                                                |
| D5  | Metric type location                           | `apps/admin` local vs shared-types                                       | **Local to `apps/admin` (YAGNI); shared-types unchanged**                                                        | no cross-package consumer of dashboard metrics exists                      | Shared-types stays leaf; add pure types only when a real consumer (28/41) appears                                    |
| D6  | Auth/data access                               | Phase 15 server-side service-role + role gates vs new browser/JWT path   | **Reuse Phase 15: server components + `createServiceRoleClient` + `getUser`/`roleFromUser`/`roleHasPermission`** | Phase 15 plumbing committed and verified                                   | RLS stays default-deny; `case_instances` untouched; approved deviation §8a adds base `SELECT` to `service_role` only |

---

## 18. Self-Review (against the objective constraints)

- ✅ **No invented tables schemed.** Every Phase 16-servable metric is computable from the existing frozen schema; deferred metrics render empty states instead (D1/D2). No `releases`/`validation`/`dashboard_*`/`audit` table is proposed.
- ✅ **No duplication of schema concepts.** "Draft content"/"Published content" reuse the existing `content_status` lifecycle; "Total X" counts existing tables; no new lifecycle/status concept.
- ✅ **No premature RLS policies.** Phase 16 adds zero RLS policies; RLS stays default-deny (Phase 15 D3a posture); `case_instances` is untouched (Phase 15 D4). The one approved additive change is migration `0018` granting base `SELECT` to `service_role` only (server-side role, §8a) — no client-facing privilege, no RLS change.
- ✅ **game-rules/runtime stay pure and untouched**; content-schema and shared-types are untouched (D5). No new dependency direction.
- ✅ **Admin is a consumer, not an owner.** The dashboard consumes the Phase 15 read surface and the frozen schema; it owns no domain-generation, validation, versioning, release, or RLS logic.
- ✅ **Preserved deterministic contracts (Phases 6–13) and Phase 14 case-instance persistence.** Phase 16 is read-only; no write path exists to perturb generation or runtime rows.
- ✅ **No silent redesign of Phase 14 case-instance persistence** — `case_instances` is not read by Phase 16 (Phase 15 D4 deferred to 41/42 analytics).
- ✅ **Error handling, auditability, security, testing** specified (§12–§14), including per-role authorization tests and the "every role has `view`" gate guard.
- ✅ **Exact expected files** listed (§11) — one new module, one new test file, one modified page; nothing else.
- ✅ **No Phase 17+ work started.** No CRUD, no content library, no validation engine, no versioning/release tables.
- ✅ **Grounded in the repo** at `fdb28f4`/HEAD: migrations 0001–0017 read in full; Phase 15 commit verified; Phase 26/27/28/40/41 TODO sections referenced by line.
- ✅ **DESIGN ONLY at original handoff** — the design phase produced no migration, no code, no package change, no commit. Post-approval, the implementation added the one approved additive migration `0018` (base `SELECT` to `service_role`, §8a); this document was amended to record that deviation.

---

## 19. Conclusion

Phase 16 delivers the **read-only Admin Dashboard**: the existing admin shell's `page.tsx` becomes a metric overview showing the six TODO totals (Chapters, Cases, Characters, Items, Documents, Evidence), Draft/Published content buckets computed from the existing `content_status` lifecycle, and a "Recently updated content" list from the real `updated_at`/`version` columns — all behind the Phase 15 server-side auth gate (token-verified `getUser` → `roleFromUser` → `view` permission), with data fetched through the server-only service-role client and **zero new RLS policies** (Phase 15 D3a posture preserved; `case_instances` untouched per D4). "Recent releases" and "Content validation errors" have **no backing store** and are rendered as honest empty states with their owning phases (28/26) named — Phase 16 creates no table, no schema concept, and no store for them. No config change, no shared-types/content-schema/game-rules/runtime change; the files are `apps/admin/src/lib/dashboard/metrics.ts`, a matching unit test, and `apps/admin/src/app/page.tsx`, plus the **one approved additive migration `0018_service_role_reads.sql`** (base `SELECT` to `service_role` only, required because this environment does not auto-expose tables; see §8a). This document was a **design proposal at handoff; it was committed (`3f7c751`) only after approval and later amended to record the `0018` deviation.**
