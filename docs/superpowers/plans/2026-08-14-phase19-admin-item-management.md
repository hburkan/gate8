# Phase 19 — Admin Item Management

> **Status:** IMPLEMENTED and pushed (`docs: add phase 19 item management design`, `feat(admin): implement phase 19 item management`, HEAD == origin/main). This document is the amended design record for the authenticated Admin Item editor for the Gümrük Kontrol Memuru CMS. It grounded every claim in the actual repository state at `f804b4b` (`main`, Phase 18 committed and pushed, clean tree) and in live-DB privilege checks (local Supabase, migrations 0001–0020 applied); implementation added migration `0021_item_usage_reads.sql` (approved additive deviation granting service_role `SELECT` on `case_items`/`location_items`, §8).
>
> **Scope:** A server-side, role-gated **Item editor** that deepens the Phase 17 `items` entity page into a per-entity editor for the fields TODO Phase 19 lists (name, category, description, value, risk level, rarity, image, tags, allowed locations, character pools, case pools, usage list). It reuses the Phase 15 auth + RBAC plumbing, the Phase 16/17 service-role data-access pattern, the Phase 17 registry/form scaffolding, and the Phase 18 specialized-editor + read-only usage-list pattern — and it **defers the parts of the TODO list that have no backing store** to their owning phases (§5).
>
> **Explicitly OUT of scope (deferred with owning phases):** per-entity editors for the other entities (Phases 20–23), the visual Case Builder (Phase 23), rich asset/portrait **upload** (no storage bucket exists; a storage phase), content validation engine (Phase 26), revision history (Phase 27), release/publish (Phase 28), audit (Phase 40), analytics (Phase 41/42). Phase 19 manages the `items` row's scalar content fields and its **read-only usage relationships**.

---

## 1. Objective and TODO Mapping

TODO.md §19 (lines 752–773):

> # PHASE 19 — ADMIN ITEM MANAGEMENT
>
> Item editor:
>
> - [ ] Name.
> - [ ] Category.
> - [ ] Description.
> - [ ] Value.
> - [ ] Risk level.
> - [ ] Rarity.
> - [ ] Image.
> - [ ] Tags.
> - [ ] Allowed locations.
> - [ ] Character pools.
> - [ ] Case pools.
>
> Show:
> Used in Locations
> Used by Characters
> Used in Cases

**Goal of this phase:** replace the generic Phase 17 `items` create/edit form with a purpose-built Item editor that (a) provides a labeled, field-specific editing experience for the scalar columns, and (b) surfaces the item's **relationships** — where it is used in locations and cases (read-only usage list). Phase 19 must not start any later phase (20+ per-entity editors, 23 case builder, 26 validation, 27 versioning, 28 release).

**Grounding check — what the TODO asks vs what exists:**

| TODO §19 item                                               | Backing store today                                                                                                                                                                                                                                 | Phase 19 disposition                                                                                    |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Name / Category / Description / Value / Risk level / Rarity | `items` columns (0004) — all exist, all already editable via Phase 17                                                                                                                                                                               | **Implement** as a labeled, improved editor                                                             |
| Image                                                       | `items.asset` (0004) — a **text URL/path** column; **no storage bucket, no upload infra** (`backend/supabase/config.toml:120–121` — `[storage.buckets.images]` is commented out)                                                                    | **Implement as text** (`asset` field, already validated by content-schema) — **no upload** (deferred)   |
| Tags                                                        | **No `tags` column, no `tags` table anywhere** (searched shared-types, content-schema, game-rules, runtime, migrations)                                                                                                                             | **Defer — no backing store.** TODO line 763                                                             |
| Allowed locations                                           | **No per-item allowed-locations store.** `location_items` (0013) is location-centric (a location's allowed items), not item-centric. No `item_locations` table                                                                                      | **Read-only via usage list** ("Used in Locations"); the write side is Phase 22 Location Management      |
| Character pools                                             | **No `character_items` / `character_item_pool` table anywhere** (searched all migrations). TODO §7.1 `character_item_pool` was audited and remains deferred; `case_characters.min_items/max_items` is a case-level bound, not a character↔item pool | **Defer — no backing store.** TODO line 765                                                             |
| Case pools                                                  | `case_items` (0012) IS the canonical Case Item Pool (Phase 8 audit R1, relation carries the pool)                                                                                                                                                   | **Read-only via usage list** ("Used in Cases"); editing `case_items` is Phase 23 Case Builder territory |
| Show: Used in Locations                                     | Queryable read-only via `location_items` — **but zero service_role SELECT grant** (verified live)                                                                                                                                                   | **Implement read-only** via migration `0021` (§8)                                                       |
| Show: Used by Characters                                    | **No character↔item relation table exists**                                                                                                                                                                                                         | **Defer — no backing store.** Cannot render                                                             |
| Show: Used in Cases                                         | Queryable read-only via `case_items` — **but zero service_role SELECT grant** (verified live)                                                                                                                                                       | **Implement read-only** via migration `0021` (§8)                                                       |

---

## 2. Current State (verified at `f804b4b`)

- **HEAD == origin/main == `f804b4b0e488624d986c6bcf608ca50ecaeaf3aa`; working tree clean.**
- Phases 15–18 committed and pushed. Migration `0020` (Phase 18) granted service_role `SELECT` on `case_characters`, `location_characters`, `chapter_cases` only.
- **`items` table (0004):** `id, name (nn), description, category (enum, nn default 'other'), rarity (enum, nn default 'common'), value numeric(12,2) (nn default 0), risk_level (enum, nn default 'none'), asset (text), status, version, created_at, updated_at`. Lifecycle trigger + `items_status_idx`. RLS enabled (0010).
- **`case_items` (0012):** `case_id (RESTRICT), item_id (RESTRICT), required, weight, min_quantity, max_quantity, hidden, discovery_method, conditions, priority, version, timestamps`, UNIQUE(case_id, item_id), RLS enabled. **service_role SELECT = 0** (verified live: only REFERENCES/TRIGGER/TRUNCATE).
- **`location_items` (0013):** `location_id (RESTRICT), item_id (RESTRICT), availability, weight, spawn_probability, min_quantity, max_quantity, hidden, discovery_method, priority, sort_order, conditions, version, timestamps`, UNIQUE(location_id, item_id), RLS enabled. **service_role SELECT = 0** (verified live).
- **No `character_items`, no `item_locations`, no `item_tags`, no `chapter_items` table exists anywhere** (verified across all migrations).
- **RLS:** `pg_policies` in `public` = **0** (default-deny preserved). anon/authenticated = **0** grants.
- **Grants:** `items` = SELECT (0018) + INSERT/UPDATE (0019); relation tables = no SELECT (until 0020 for character relations; item relations still 0).
- **content-schema:** `itemDraftSchema` (name required; description/asset nullable; category/rarity/riskLevel enums; value nonnegative number). No tags/availability/pool fields.
- **shared-types:** `Item` interface (the scalar fields only); `CaseItem` / `LocationItem` relation interfaces (0012/0013 mirror); **no `CharacterItem`, no `ItemTag`, no per-item pool types**.
- **game-rules:** consumes `case_items` relation rows via a version-pinned snapshot (`selectItems`, Phase 7/8); never reads `location_items`; never writes. `item.name`/`hasItem` context keys. **Does not depend on tags or per-item pools.**
- **runtime:** consumes `case_instances` + generated snapshots; does not read `items` directly.
- **Admin (Phase 17/18):** registry `items` adapter already declares `fieldMap` (name/description/category/rarity/value/riskLevel/asset), `requiredFields: ['name']`, `numberFields: ['value']`, `enumOptions` (category/rarity/riskLevel), `listColumns` (category/rarity/risk_level), `draftSchema: itemDraftSchema`. Phase 18 added `editor?: 'character'` to the adapter interface and the `CharacterForm`/`CharacterUsageList` components + `getCharacterUsage` + `character-usage.ts`.

---

## 3. What Actually Exists — Reuse Inventory

Phase 19 reuses, **unchanged**, the entire Phase 17 library data path and auth gate, plus the Phase 18 specialized-editor pattern:

- **Auth gate:** `createClient()` (SSR) → `supabase.auth.getUser()` (token-verified) → `roleFromUser(user)` → `roleHasPermission(role, 'view'/'create'/'edit')`. Page gate + Server Action re-check (§6).
- **Service-role read/write:** `libraryServiceClient()` (server-only; never in a client component).
- **Scalar editing:** the `items` adapter + `validateDraft` + `mutate.ts` already create/edit the scalar fields (name, description, category, rarity, value, risk_level, asset). Phase 19 **specializes the form** (labels, grouping, enum selects, number input for value) rather than re-implementing CRUD.
- **Phase 18 pattern:** the `CharacterForm` + `CharacterUsageList` + `getCharacterUsage` + `editor`-kind adapter flag pattern is directly reusable as `ItemForm` + `ItemUsageList` + `getItemUsage` + `editor: 'item'`.

**New code needed (Phase 19):**

- A dedicated Item editor UI (`ItemForm`) for the scalar fields.
- A **read-only Usage list** (Used in Locations / Used in Cases) rendered on the item detail page.
- A **new additive migration `0021`** granting service_role `SELECT` on `case_items` and `location_items` (§8).
- New `item-usage.ts` helpers for usage lookups (read-only, whitelisted columns, no raw SQL).

---

## 4. Proposed Architecture and Exact Files

### 4.1 Item editor (scalar fields)

Phase 19 introduces a **specialized `ItemForm`** (mirroring Phase 18's `CharacterForm`): human-readable labels ("Name", "Category", "Description", "Value", "Risk level", "Rarity", "Image asset URL"), grouped layout (Identity / Profile / Image), enum `<select>`s for category/rarity/risk level (from the adapter's `enumOptions`), a number input for value, and the existing `createLibraryItem`/`updateLibraryItem` server actions (unchanged). Field names match the `items` adapter keys (`name`, `category`, `description`, `value`, `riskLevel`, `rarity`, `asset`) so `validateDraft` + `mutate.ts` work unchanged. No new columns, no schema change, no migration for the editor itself.

- `src/components/item/ItemForm.tsx` (client; `useActionState`; mirrors `CharacterForm` wiring).
- `src/app/library/items/new/page.tsx` and `src/app/library/items/[id]/edit/page.tsx` — **replace** the generic `EntityForm` usage with `ItemForm` via `adapter.editor === 'item'`.

### 4.2 Usage list (read-only)

The usage list shows, for an item, the locations and cases that reference it:

- **Used in Locations:** `location_items` where `item_id = <id>` → join `locations` for name/type + `availability`, `role`, `min_quantity`, `max_quantity`.
- **Used in Cases:** `case_items` where `item_id = <id>` → join `cases` for title + `required`, `min_quantity`, `max_quantity`, `hidden`.
- **"Used by Characters":** **not renderable** — there is no `character_items` table (§1). Explicitly deferred; the section is omitted or shown as a documented "not available" note (decision D-CharacterUsage, §11).

Data path: a new server-only helper `getItemUsage(client, id)` in `src/lib/library/item-usage.ts` that runs read-only queries against the service-role client with **whitelisted columns** and returns a typed `ItemUsage` object (locations + cases). Rendered as read-only sections on the item detail page — no writes, no relation editing (Phase 22/23 territory).

- `src/lib/library/item-usage.ts` — `ItemUsage` type + `getItemUsage` (server-only reads).
- `src/app/library/items/[id]/page.tsx` — render the usage sections (read-only, gated by `view`).
- `src/components/item/ItemUsageList.tsx` — presentational (mirrors `CharacterUsageList`).

### 4.3 Files summary

**Create (after approval):**

- `apps/admin/src/lib/library/item-usage.ts` — usage query helpers + types.
- `apps/admin/src/components/item/ItemForm.tsx` — specialized scalar editor.
- `apps/admin/src/components/item/ItemUsageList.tsx` — read-only usage display.
- `apps/admin/test/library/item-usage.test.ts` — Vitest with fake client (usage joins, whitelisted columns, no relation-write).
- `backend/supabase/migrations/0021_item_usage_reads.sql` — §8.
- `scripts/e2e-item.py` — Python Playwright e2e (§9).

**Modify (after approval):**

- `apps/admin/src/lib/library/registry.ts` — set `editor: 'item'` on the `items` adapter and extend the adapter's `editor?: 'character'` union (line 78) to `'character' | 'item'` (one-line type change; the union is the Phase 18-introduced dispatch flag).
- `apps/admin/src/app/library/[entity]/new/page.tsx` — dispatch to `ItemForm` when `adapter.editor === 'item'`.
- `apps/admin/src/app/library/[entity]/[id]/edit/page.tsx` — same dispatch.
- `apps/admin/src/app/library/[entity]/[id]/page.tsx` — render `ItemUsageList` when `entity === 'items'`.

**Do NOT touch (unchanged by this design):** `TODO.md`, migrations other than the new `0021`, `backend/supabase/config.toml`, `packages/shared-types`, `packages/content-schema`, `packages/game-rules`, `packages/runtime`, `case_instances`, RLS posture, `src/lib/supabase/*`, `src/lib/auth/*`, `src/proxy.ts`, `.env`/`.env.example`.

---

## 5. Explicitly Deferred Items (owning phases) — grounded

- **Tags (TODO line 763):** no `tags` column, no `tags` table anywhere (searched shared-types, content-schema, game-rules, runtime, all migrations). Implementing would require a **new table** (`item_tags`) + a **new content-schema/shared-types surface** + a migration + Phase 40 audit surface. **Defer** — no owning phase named in TODO; flag to user (§11).
- **Allowed locations (TODO line 764):** no per-item allowed-locations store exists. `location_items` is location-centric (a location's allowed items); there is no `item_locations` table. The **read** side is the usage list; the **write** side (adding an item to a location's pool) belongs to Phase 22 Location Management. **Defer the write side.**
- **Character pools:** **no `character_items` / `character_item_pool` table exists anywhere** (searched all migrations). TODO §7.1 (`character_item_pool`) remains a separate deferred checklist — Phase 8 audit R1 confirmed `case_items` as the case pool but explicitly did **not** create a character↔item pool. `case_characters.min_items/max_items` (0012:15–16) is a per-case bound, not a character↔item pool. **Defer — no backing store; flag to user.**
- **Case pools (TODO line 766):** `case_items` **is** the Case Item Pool (Phase 8 audit R1). The item editor shows it **read-only** ("Used in Cases"); **editing** `case_items` (weight/quantity/required/hidden per case) is Phase 23 Case Builder. **Defer the write side.**
- **Image upload (TODO line 762):** `items.asset` is a text URL/path; **no storage bucket or upload infra exists** (`backend/supabase/config.toml:120–121` — `[storage.buckets.images]` commented out). Phase 19 edits the asset **path/URL as text** only; actual upload → a future storage phase.
- **"Used by Characters" (TODO line 772):** **no character↔item relation table exists** — cannot be rendered. **Defer; flag to user.**
- **Full revision history, created-by/published-by, diff, rollback:** Phase 27.
- **Publish/release/rollback:** Phases 27/28.
- **Content validation engine:** Phase 26.
- **Audit log, RLS grant matrix:** Phase 40.
- **Analytics / `case_instances` admin view:** Phases 41/42.
- **Case Builder (per-case item weight/quantity/required/hidden assignment):** Phase 23.
- **Location Management (location↔item availability):** Phase 22.

---

## 6. Permission / Auth / RLS Implications

- **No new permission.** The item editor uses the existing `create`/`edit`/`view` gates; the usage list is `view`-gated (all four roles see it read-only). No shared-types change (`ROLE_PERMISSIONS` untouched).
- **Server-side enforcement preserved:** every mutation re-runs `authorize()` (`actions.ts`) before any DB write; UI hiding is UX only. REVIEWER sees the editor fields read-only / cannot submit; EDITOR can create/edit; CONTENT_ADMIN/SUPER_ADMIN as Phase 15 matrix.
- **RLS stays default-deny (zero policies).** The new `0021` migration grants **base `SELECT`** to `service_role` only on `case_items` and `location_items` — no `anon`/`authenticated`, no INSERT/UPDATE/DELETE on relations, no policies. This mirrors the approved 0018/0019/0020 deviations and is provable from the live DB (item relation tables currently have zero service_role SELECT).
- **No `case_instances` access** (Phase 15 D4 preserved).
- **Service-role key stays server-only**; no client component imports `admin.ts`; the browser never queries relation tables.

---

## 7. Dependencies on Phases 20+

Phase 19 is a **leaf** relative to the later per-entity editors: it changes no shared-types/content-schema/game-rules/runtime and adds no new entity column, so Phases 20–23 are unaffected. It depends on the already-committed Phase 15/16/17/18 plumbing only. It does **not** depend on Phase 20+ features; conversely, no Phase 20+ feature depends on Phase 19 specifics (the scalar editor + read-only usage-list pattern is generic and reusable by Phases 20–22).

**Contradiction/ambiguity to flag:** TODO Phase 19 "Character pools" / "Allowed locations" overlap with Phase 22 (Location Management) and Phase 23 (Case Builder), and with the Phase 18 deferral of "Available items/documents" (TODO lines 740–741). The schema models item↔character only per-**case** (`case_characters.min_items/max_items`), not per-**item**. Phase 19 must not invent a `character_items` table that a later phase would then reconcile. (§11 decision.)

---

## 8. Migration Requirements

**One additive migration is required and is an infrastructure prerequisite (parallel to 0018/0019/0020):**

`0021_item_usage_reads.sql` — grant base `SELECT` to `service_role` on the relation tables needed to render the read-only usage list:

- `case_items` (Used in Cases)
- `location_items` (Used in Locations)

**Exact SQL (additive; SELECT only; service_role only; no anon/authenticated; no RLS policies; no `case_instances`; no other relation tables):**

```sql
-- 0021_item_usage_reads.sql
-- Grant base SELECT on the relation tables the Phase 19 read-only Item usage
-- list queries (Used in Locations / Cases). service_role only, mirroring the
-- 0018/0019/0020 approved deviations; no anon/authenticated, no
-- INSERT/UPDATE/DELETE, no RLS policies. `case_instances` untouched (D4).
-- NOTE: there is no character_items table (TODO §7.1 deferred), so
-- "Used by Characters" cannot be queried; no grant is made for it.

grant select on table public.case_items to service_role;
grant select on table public.location_items to service_role;
```

**Why required (verified live):** `case_items` and `location_items` currently show `service_role` with only `REFERENCES,TRIGGER,TRUNCATE` (no SELECT), because `auto_expose_new_tables` is unset (`backend/supabase/config.toml:24` — commented out) and 0018/0019/0020 granted only the content tables + character relations. Without this grant, the usage-list queries fail with `permission denied for table`.

**Verification plan (from clean DB, implementation time):**

1. `supabase db reset` (0001→0021 applies cleanly).
2. service_role can `SELECT` on `case_items`, `location_items`; the content tables + character relations keep their grants; item relations get **no INSERT/UPDATE/DELETE**.
3. `anon`/`authenticated` still 0 grants; `pg_policies` in `public` still 0.
4. `case_instances` untouched (0 grants).
5. Reproducible on a second fresh reset.

---

## 9. Impact on shared-types / content-schema / game-rules / runtime

- **shared-types:** **unchanged** (Phase 19 adds no permission, no enum, no entity field). The usage types live in `apps/admin` (YAGNI; `shared-types` stays purely additive for a real cross-package consumer).
- **content-schema:** **unchanged** (`itemDraftSchema` already validates all scalar fields; no new fields).
- **game-rules / runtime:** **unchanged; remain pure.** Phase 19 adds no column they consume and does not import them. `selectItems` keeps consuming the `case_items` snapshot rows as today — the `0021` SELECT grant does not alter generation behavior.
- **Admin app (only code touched after approval):** see §4.3.

---

## 10. UI / Component Plan

- **Item editor:** a dedicated `ItemForm` with grouped, labeled fields for the scalar columns; enum `<select>`s for category/rarity/risk level; number input for value; textarea for description; text input for image asset URL (with a hint that it is a path/URL, not an upload — no bucket exists). Inline per-field errors from `validateDraft` (reused). Tailwind v4 zinc palette matching Phase 16/17/18; `lang="tr"` → keep **lowercase** text styling (avoid dotless-ı artifact — no CSS `uppercase`).
- **Usage list:** read-only sections "Used in Locations" and "Used in Cases" on the item detail page. Each lists the referencing entity name with a link to its detail page; cases additionally show `required`/min-max quantity; locations show availability. Empty state "Not used anywhere yet." REVIEWER sees it read-only.
- **State:** mirror Phase 17/18 (`useActionState` + `initialLibraryFormState`); Server Actions return previous input + field errors on failure.

---

## 11. Conflicts / Open Decisions Found (reported, per instruction)

The instruction requires explicit reporting rather than silent interpretation. Tensions between TODO Phase 19, the prior design docs, and the repository:

1. **TODO §19 "Tags" has no backing store.** No `tags` column/table exists anywhere. **Recommendation:** defer (no owning phase). **If you want Tags in Phase 19, that is a scope change requiring a new `item_tags` table + migration + shared-types/content-schema surface + Phase 40 audit — say so.**
2. **TODO §19 "Character pools" has no backing store.** No `character_items`/`character_item_pool` table exists (TODO §7.1 deferred; Phase 8 audit R1 kept only `case_items`). **Recommendation:** defer. **If you want a per-item character pool, that is a new relation table + Phase 22/23 reconciliation — say so.**
3. **TODO §19 "Show: Used by Characters" is not renderable.** No character↔item relation exists. **Recommendation:** omit the section (documented as not available). **If you expected it, that is the same missing `character_items` table — say so.**
4. **TODO §19 "Allowed locations" / "Case pools" write sides have no per-item store.** `location_items`/`case_items` are parent-centric relations. **Recommendation:** Phase 19 shows them read-only; writes belong to Phases 22/23. **If you want per-item allowed-location/case editing in Phase 19, that is a new item-centric surface conflicting with Phases 22/23 — say so.**
5. **Migration `0021` grants relation SELECT** (required for the usage list) — a new grant surface beyond the content tables. It is **SELECT-only, service_role-only, no policies**, parallel to the approved 0018/0019/0020 deviations. **If you prefer the usage list to be deferred or the relations to remain fully un-granted, say so.**

Open (lower risk, implementation-time): whether the usage list joins live (PostgREST embedded) or runs sequential queries and joins in TS (the latter is simpler and matches the Phase 17/18 fake-client test pattern); exact grouping/labels. These do not change architecture and are resolved within the §4/§10 constraints.

---

## 12. Self-Review (against the objective constraints)

- ✅ **Grounded in the actual schema:** every TODO §19 item was mapped to a real column/table or explicitly deferred with the reason (no backing store / parent-centric relation / indirect relation).
- ✅ **No invented tables or migrations** beyond the provable `0021` relation-SELECT grant (§8); no `item_tags`/`character_items`/`item_locations` invented.
- ✅ **shared-types / content-schema / game-rules / runtime unchanged** (§9); shared-types stays a leaf; no game-rules import.
- ✅ **Phase 15 default-deny preserved:** no RLS policies, no anon/authenticated grants, only `SELECT` to `service_role` (additive) on 2 relation tables, no INSERT/UPDATE/DELETE on relations.
- ✅ **Phase 15–18 architecture reused:** same gate, same service-role server-only client, same fake-client test pattern; browser never touches content or relation tables (D3a).
- ✅ **`case_instances` explicitly out of scope** (Phase 15 D4) — no grant, no read, no write.
- ✅ **REVIEWER read-only; EDITOR/CONTENT_ADMIN/SUPER_ADMIN behaviors explicit** (§6), enforced server-side.
- ✅ **No Phase 20+ work started** — no document/evidence/location editors, no case builder, no validation engine, no versioning history, no release system.
- ✅ **Exact files listed** (§4.3); conflicts reported rather than silently resolved (§11).
- ✅ **IMPLEMENTED and committed** — this document's design was implemented per §4–§10 and verified (115 unit tests, typecheck/lint/prettier clean, production build, e2e 26/26 item + 47/47 library + 24/24 character regressions, `supabase db reset` 0001–0021 clean, live grant matrix confirmed).

---

## 13. Conclusion

Phase 19 delivers the **Admin Item editor**: a purpose-built, labeled editor for the existing `items` scalar fields (name, category, description, value, risk level, rarity, image asset URL) reusing the Phase 17 library's validation, server actions, auth gate, and service-role data path, plus a **read-only usage list** (Used in Locations / Cases) driven by one new additive migration (`0021`) granting service_role `SELECT` on `case_items` and `location_items` — with no change to any content package, no RLS policy, and `case_instances` untouched. The TODO items without a backing store (Tags, Character pools, "Used by Characters", the write sides of Allowed locations / Case pools, image upload) are **deferred with grounded reasons**, and the five scope conflicts are reported in §11. **This phase is implemented, verified, and pushed to `main`.**
