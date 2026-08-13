# Phase 8 — Case Item Pool Design

> **Status:** DESIGN — for review. No database, migration, shared-types, content-schema, game-rules, Admin UI, or Mobile UI changes are made in this phase. This document determines what TODO Phase 8 ("CASE ITEM POOL") actually requires after Phase 7, and concludes with an architectural decision.

**Goal:** Resolve exactly what the existing TODO.md calls "PHASE 8 — CASE ITEM POOL" in the current architecture — without assuming a new `case_item_pool` table, without duplicating functionality already implemented by Phase 7, and without accidentally implementing Character → Item assignment.

**Architecture:** The content model has always been: global reusable entities referenced through relation tables that carry generation configuration. Audit decision **R1** resolved the historical `case_*` vs `case_*_pool` naming overlap to **one relation table per (parent, entity) pair carrying the full configuration** — the relation _is_ the pool. `case_items` is therefore the Case Item Pool. This design verifies that conclusion against the current repository and specifies what (if anything) remains.

**Tech Stack:** None required — this is an architectural checkpoint over existing PostgreSQL migrations and the `@gate8/game-rules` generator.

---

## 1. Objective

Determine the actual purpose of TODO Phase 8 "CASE ITEM POOL" given:

- `case_items` is the canonical Case ↔ Item relation (migration `0012`), already carrying every field the checklist names.
- Phase 7 (`selectItems` in `@gate8/game-rules`) already implements deterministic global case-item generation from `case_items` + `cases.min_items`/`max_items`.
- The architecture forbids duplicate `*_pool` tables (audit R1).

The design must explicitly answer: is Phase 8 a no-op / architectural checkpoint, or does genuine work remain — and if so, exactly what?

## 2. Current Repository & Schema State

### 2.1 Migrations applied (0001–0016, verified clean)

| Migration     | Delivers                                                                                                |
| ------------- | ------------------------------------------------------------------------------------------------------- |
| `0001`–`0010` | Global entities: characters, items, documents, evidence, locations, dialogues, missions, lifecycle, RLS |
| `0011`        | `cases` anchor (id, title, description, status, version)                                                |
| `0012`        | **`case_characters`, `case_items`, `case_documents`, `case_evidence`** relation tables                  |
| `0013`        | `location_*` relations                                                                                  |
| `0014`–`0015` | `chapters`, `chapter_locations`, `chapter_cases`                                                        |
| `0016`        | `cases.min_items/max_items` (+ characters/documents/evidence bounds, type, difficulty)                  |

### 2.2 `case_items` (migration `0012`) — the current Case Item Pool

| Column                      | Type        | Constraint                                   | Phase 8 checklist correspondence |
| --------------------------- | ----------- | -------------------------------------------- | -------------------------------- |
| `id`                        | uuid PK     |                                              |                                  |
| `case_id`                   | uuid FK     | CASCADE → cases                              |                                  |
| `item_id`                   | uuid FK     | RESTRICT → items, `UNIQUE(case_id, item_id)` | `itemId`                         |
| `required`                  | bool        | NOT NULL                                     | `required`                       |
| `weight`                    | numeric     | NOT NULL, `CHECK (weight >= 0)`              | `weight`                         |
| `min_quantity`              | int         | NOT NULL, `CHECK (min_quantity >= 0)`        | `minQuantity`                    |
| `max_quantity`              | int         | NOT NULL, `CHECK (max_quantity >= 0)`        | `maxQuantity`                    |
| `hidden`                    | bool        | NOT NULL                                     | `hidden`                         |
| `discovery_method`          | text        | NULL allowed                                 | `discoveryMethod`                |
| `conditions`                | jsonb       | NOT NULL DEFAULT '[]'                        | `conditions`                     |
| `priority`                  | int         | NOT NULL DEFAULT 0                           | (ordering; not on checklist)     |
| `version`                   | int         | NOT NULL DEFAULT 1                           | (versioning; not on checklist)   |
| `created_at` / `updated_at` | timestamptz | trigger-maintained                           |                                  |

### 2.3 `cases` bounds (migration `0016`)

- `cases.min_items` / `cases.max_items` — distinct-item-type count bounds, `CHECK >= 0`, `0` = no bound.

### 2.4 Type/schema mirrors (already exist)

- `packages/shared-types/src/relations.ts` — `CaseItem` mirrors `case_items` column-for-column.
- `packages/content-schema/src/relations.ts` — `caseItemSchema` validates it.

### 2.5 Generator already implemented (Phase 7, committed `29ea65e`)

- `packages/game-rules/src/generation/item-selection.ts` — pure `selectItems`: version-pinned snapshot + seed → global item set (distinct types + per-type quantity, hidden, discovery method), canonical ordering, deterministic draw sequence, typed failures.
- `quantity.ts`, `item-errors.ts`, `item-types.ts` support it.
- 472 tests green across Phases 6–7.

## 3. Historical TODO Phase 8 Intent

The original TODO (and `docs/content-model/relations.md`, "Generation Pools (Phases 6–10)") listed a **separate pool-table family**:

```
case_character_pool   (weight, required, role, min_items, max_items, conditions)
character_item_pool   (weight, min_quantity, max_quantity, required, conditions)
case_item_pool        (weight, required, min_quantity, max_quantity, hidden, discovery_method, conditions)
case_document_pool    (required/optional/fake/decoy/hidden + discovery_method)
character_document_pool
location_document_pool
```

TODO Phase 8 states:

> **PHASE 8 — CASE ITEM POOL**
> Cases can override or restrict item pools.
>
> - [ ] case_item_pool. / - [ ] itemId. / - [ ] weight. / - [ ] required. / - [ ] minQuantity. / - [ ] maxQuantity. / - [ ] hidden. / - [ ] discoveryMethod. / - [ ] conditions.

The phrase "Cases can override or restrict item pools" reflects a pre-R1 mental model in which a case's items were derived by _overriding_ some other pool (a global pool and/or a per-character pool). That model was superseded by the audit.

## 4. What Phase 7 Already Implemented

Phase 7 (`2026-08-13-phase7-item-generation.md`, committed `29ea65e`) did the following, explicitly and verbatim:

- Confirmed `case_items` is the canonical relation and the single source of truth for per-item selection config; `cases.min_items/max_items` the single source of truth for the distinct-item-type count (§1).
- Confirmed **no migration required**, quoting: "TODO §8's `case_item_pool` is satisfied by `case_items` (audit R1) — no pool table" (§18).
- Implemented deterministic selection: distinct-item-type count draw, required set, weighted optional picks without replacement, canonical `(priority, item_id)` ordering, per-type quantity draws after selection, `hidden`/`discovery_method` carried through unchanged, opaque conditions + `eligibilityFilter` extension point for Phase 11 (§2–§9, §16).
- Established the explicit failure modes (§12) and draw-sequence contract (§9).
- Documented that Character → Item assignment is **deferred** (§13, Choice B).

Therefore every Phase 8 **checklist field** already exists as a `case_items` column, and every Phase 8 **behavior** (weighted, required, quantities, hidden/discovery, conditions) is already consumed by `selectItems`.

## 5. Gap Analysis

| Phase 8 checklist item   | Status       | Where satisfied                                                                                    |
| ------------------------ | ------------ | -------------------------------------------------------------------------------------------------- |
| `case_item_pool` (table) | ✅ satisfied | `case_items` _is_ the pool (audit R1; Phase 6 precedent marked `case_character_pool` the same way) |
| `itemId`                 | ✅ satisfied | `case_items.item_id` (RESTRICT, UNIQUE)                                                            |
| `weight`                 | ✅ satisfied | `case_items.weight` (`CHECK >= 0`), consumed by `selectItems` weighted pick                        |
| `required`               | ✅ satisfied | `case_items.required`, consumed by `selectItems` required set                                      |
| `minQuantity`            | ✅ satisfied | `case_items.min_quantity`, consumed by quantity draw                                               |
| `maxQuantity`            | ✅ satisfied | `case_items.max_quantity`, consumed by quantity draw                                               |
| `hidden`                 | ✅ satisfied | `case_items.hidden`, carried to generated output unchanged                                         |
| `discoveryMethod`        | ✅ satisfied | `case_items.discovery_method`, carried to generated output unchanged                               |
| `conditions`             | ✅ satisfied | `case_items.conditions`, opaque payload + Phase 11 eligibility hook                                |

**Genuinely missing:** none in the schema or in global item-set generation.

The historical sentence "Cases can override or restrict item pools" — in the current architecture a case author **directly enumerates** its item pool as `case_items` rows. That _is_ the restriction mechanism: only rows in `case_items` can ever appear in the case's generated item set; `UNIQUE(case_id, item_id)` prevents duplicates. There is **no separate pool to override** in the current model: no global default item pool table exists, and the per-character pool (`character_item_pool`) is deferred (TODO §7). "Override" is therefore moot — there is nothing upstream to override, and inventing one would be manufacturing a redundant layer.

## 6. Architectural Decision

**Phase 8 requires no implementation.**

- **No new `case_item_pool` table.** It is satisfied by `case_items` (audit decision R1 — one relation table per (parent, entity) pair; the relation is the pool). Creating it would violate the approved architecture's explicit "no duplicate pool tables" rule and duplicate every `case_items` column verbatim.
- **No migration.** Every checklist field and both generation sources (`case_items`, `cases.min_items/max_items`) already exist in applied migrations `0012`/`0016`.
- **No additional generation logic.** `selectItems` (Phase 7) already implements the entire global case item set from those sources. Adding any would duplicate it.
- **Phase 8 is an architectural checkpoint**, exactly parallel to how Phase 6 resolved `case_character_pool` (its TODO box was marked "Satisfied by `case_characters` — audit decision R1"). Phase 8 is the item counterpart.
- **Naming-mismatch handling:** the TODO checklist for Phase 8 is instrumentally satisfied but remains a separate historical checklist. Per the Phase 7 note already present in TODO.md (under Phase 7), Phase 8's boxes are **not** checked solely because `case_items` satisfies the architecture; this design document is the authoritative record.

**Ancillary note:** future item-generation concerns (assignment to characters, per-character limits interaction, instance item state) are real but belong to later phases/passages (§11, §15) — not Phase 8.

## 7. Entity / Relation Diagrams

### 7.1 Current (as built)

```
items (global, reusable) — items.id
        ▲
        │ item_id (RESTRICT)
case_items ◄———— case_id (CASCADE) ———— cases (Case Template)
   ◆ pool = relation: weight, required, min_quantity, max_quantity,
        hidden, discovery_method, conditions, priority, version
        UNIQUE(case_id, item_id)
        │ version-pinned snapshot
        ▼
selectItems (Phase 7, game-rules) + seed
        ▼
Global Case Item Set { itemId, quantity, hidden, discoveryMethod }
```

### 7.2 As-intended (historical pool table) — NOT built, rejected

```
items ──► case_item_pool ◄── cases      ← redundant; duplicates case_items
```

Rejected by audit R1. `case_items` is the pool.

### 7.3 Placement in the wider model

```
characters —► case_characters (pool = relation)   [Phase 6 precedent]
items      —► case_items       (pool = relation)   [Phase 8 = this doc]
documents  —► case_documents   (deferred generation)
evidence   —► case_evidence    (deferred generation)
```

## 8. Field-level Analysis

Every field the historical `case_item_pool` would carry already exists on `case_items` with the identical meaning and constraints:

| Historical pool field | `case_items` column | Constraint          | Consumed by               |
| --------------------- | ------------------- | ------------------- | ------------------------- |
| `itemId`              | `item_id`           | RESTRICT FK, UNIQUE | selection bookkeeping     |
| `weight`              | `weight`            | `>= 0`              | optional weighted pick    |
| `required`            | `required`          | NOT NULL            | required set              |
| `minQuantity`         | `min_quantity`      | `>= 0`              | effective quantity bounds |
| `maxQuantity`         | `max_quantity`      | `>= 0`              | effective quantity bounds |
| `hidden`              | `hidden`            | NOT NULL            | carried to output         |
| `discoveryMethod`     | `discovery_method`  | NULL allowed        | carried to output         |
| `conditions`          | `conditions`        | jsonb, DEFAULT '[]' | opaque; Phase 11 filter   |

Additions beyond the checklist (already decided in Phases 3/7): `priority` (deterministic ordering), `version` (relation-version pinning with the parent), `id`/timestamps (relation-table baseline), `UNIQUE(case_id, item_id)`.

**No column is missing. No column needs adding.**

## 9. Generation Implications

- `selectItems` already reads the version-pinned snapshot of `cases` (bounds) + `case_items` (rows) and returns the global case item set deterministically.
- No change to the draw sequence, quantity semantics, required handling, weighted selection, hidden/discovery propagation, canonical ordering, or failure modes.
- Phase 8 adds nothing to generation. Any future _assignment_ of those items to characters is explicitly out of scope (§10, §15).

## 10. Character → Item Assignment Is NOT Part of Phase 8

Explicit per the design requirements and Phase 7 §13 (Choice B deferred):

```
Character Selection (Phase 6) → Global Item Selection (Phase 7) → Item Assignment to Characters ← DEFERRED
```

- Phase 8's scope is the **global Case Item Pool / global item set** — nothing more.
- Per-character item limits (`case_characters.min_items/max_items`) and the per-character pool (`character_item_pool`, TODO §7) remain separate deferred concerns. Phase 8 deliberately does **not** implement assignment, does **not** create `character_item_pool`, and does **not** consume character-generation output.
- The Phase 7 note in TODO.md already records this split; this design reinforces it.

## 11. Interactions

| Concern                         | Interaction with Phase 8                                                                                                                                                                                                                                                               |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Case Template                   | `case_items` rows are owned by the case (CASCADE); `cases.min_items/max_items` bound the distinct item types. No template change.                                                                                                                                                      |
| Characters                      | Independent. Global item set does not depend on selected characters. Per-character item limits/pools deferred (TODO §7).                                                                                                                                                               |
| Items                           | `case_items.item_id → items.id` (RESTRICT). Global item entity untouched; generator resolves output by `itemId`.                                                                                                                                                                       |
| Documents                       | Parallel relation `case_documents`; its generation is a separate phase. Phase 8 touches only items.                                                                                                                                                                                    |
| Evidence                        | Parallel relation `case_evidence`; its generation is a separate phase. Phase 8 touches only items.                                                                                                                                                                                     |
| Locations                       | `location_items` is a distinct relation governing items _at locations_; a case's item pool is orthogonal. No interaction.                                                                                                                                                              |
| Chapters                        | `chapter_cases` references cases; chapters never reference item pools. No interaction.                                                                                                                                                                                                 |
| Deterministic seeded generation | `selectItems(template, relations, seed)` already deterministic; seed lives on the future Case Instance (Phase 14), never on the template. No change.                                                                                                                                   |
| Future Case Instance (Phase 14) | Instance stores `caseTemplateId` + `seed` + (references or snapshot of) generated items; `selectItems` output (`itemId`, `quantity`, `hidden`, `discoveryMethod`) is the exact payload it will persist under `generatedItems`. Phase 8 adds nothing; Phase 14 consumes Phase 7 output. |
| Future Rule Engine (Phase 11)   | `conditions` on `case_items` remain opaque until then; `eligibilityFilter` hook narrows the eligible pool. Phase 8 adds nothing.                                                                                                                                                       |
| Publish validation (Phase 26)   | Validates bounds (`min ≤ max`, pool sizes vs. minima, required ⊆ pool) and speaker/dialogue integrity. Already planned; Phase 8 needs no new validation.                                                                                                                               |

## 12. Case Instance Implications

None beyond Phase 7. `selectItems` already produces `{ itemId, quantity, hidden, discoveryMethod }` per item — precisely what `case_instances.generatedItems` will store (TODO Phase 14 lists `generatedItems`). A Case Item Pool _module_ in the instance layer would be runtime state, not content — and runtime item-state modeling is a Phase 14 concern. Phase 8 explicitly does not build it here.

## 13. Rule Engine Implications

`conditions` on `case_items` rows are already consumed as opaque JSONB with an `eligibilityFilter` extension point (Phase 7 §8). Phase 8 does not change, evaluate, or duplicate condition handling. The Phase 11 rule engine will supply the predicate; selection stays in `selectItems`.

## 14. Versioning Implications

- `cases.version` is the template content version. `case_items.version` must equal it (R2: relations version with their parent), enforced by the generator (`VersionMismatch` failure).
- Phase 8 introduces no new versioned objects. The Case Item Pool is versioned exactly as the rest of the `case_items` relation — unchanged.
- A future `case_item_pool` table would have created a **second, independent version stream** that must be kept in sync with both `cases` and (potentially) a global pool — precisely the sync hazard the architecture avoids by collapsing the pool into the relation.

## 15. Migration Decision

**No migration required.**

- No new table (`case_item_pool` explicitly rejected — audit R1).
- No new columns (all checklist fields exist on `case_items`).
- No new constraints, enums, indexes, triggers, RLS, or types.
- Nothing to `ALTER` on `cases`, `case_items`, or `items`.

This mirrors the Phase 7 verdict (§18) and the Phase 6 verdict (§14), which both concluded "no migration required" for the character side for the same reason.

## 16. Explicitly Deferred Work (not Phase 8)

- **Character → Item assignment** and per-character limits interplay (TODO §7 / §12.3 "For each character: … generate quantity").
- **Per-character item pool** (`character_item_pool`) — future design; not created here.
- **Item generation for documents/evidence** — separate phases (TODO §9–§10), separate relations.
- **Case Instance item runtime state / `generatedItems` persistence** — Phase 14.
- **Discovery mechanics** (probabilities, unlock rules, inventory modeling) — future; Phase 7 already passes `discoveryMethod` through unchanged.
- **Condition evaluation** — Phase 11 rule engine.
- **Any `*_pool` duplicate tables** — never; relations are canonical (audit R1).
- Admin UI, Mobile UI, AI — never in any of these phases.

## 17. Acceptance Criteria (for this design)

1. The question "what is Phase 8 after Phase 7" is answered: **architectural checkpoint; no implementation.**
2. Every Phase 8 checklist item maps to a satisfied source (`case_items` columns) — documented in §5.
3. No migration, no new table, no new generation logic is proposed (§6, §15).
4. Character → Item assignment is explicitly excluded (§10).
5. Interactions with template/characters/items/documents/evidence/locations/chapters/seed/instance/rule engine are documented (§11–§13).
6. Versioning semantics preserved (single version stream, relation versions with parent) (§14).
7. Architectural rules preserved: no `*_pool` duplicates, UNIQUE(parent, entity), relations version with parent, no new SQL enums, conditions opaque until Phase 11, seed on instance not template, generator pure/deterministic, no AI/admin/mobile/hard-coded content.
8. TODO.md Phase 8 boxes remain **unchecked**; the Phase 7 note in TODO.md is the pointer to this document. Only this design document is created (git diff confirms a single new file).

## Self-Review / Contradiction Check

**Spec coverage:** All 10 design questions addressed — purpose (§3, §6), satisfied checklist items (§5), genuinely missing parts (§5 — none), migration (## 15 — none), new table (§6 — no), generation logic (§9 — none), no-op verdict (§6 — yes, checkpoint), remaining work if any (§8, §16 — none in scope; deferred items enumerated), interactions (§11–§13), Character→Item assignment excluded (§10).

**Contradiction check against the repository:**

- `case_items` columns verified against migration `0012` (§2.2) — match all 9 checklist fields. ✅ no contradiction.
- `cases.min_items/max_items` verified against migration `0016`. ✅
- Audit R1 verified (§audit §5.1, §10): one relation per pair, is-the-pool. Phase 6 TODO box precedent (`case_character_pool … Satisfied by case_characters`) confirms the established convention. ✅
- Phase 7 document verbatim: "TODO §8's `case_item_pool` is satisfied by `case_items` (audit R1) — no pool table" (§18) and "Duplicate pool tables … never; `case_items` is canonical" (§20). ✅ consistent.
- No existing table, type, schema, or commented intent suggests a separate pool is required. ✅
- The only "override/restrict" wording is historical, and the current model satisfies "restrict" (that is, per-case enumeration) by construction. ✅

**Placeholder scan:** no TBD/TODO; every section has a concrete, verified decision.

**Type/field consistency:** all field names checked against the migration DDL and mirrored types (`shared-types` `CaseItem`: `itemId`, `weight`, `required`, `minQuantity`, `maxQuantity`, `hidden`, `discoveryMethod`, `conditions`, `priority`, `version`). ✅

---

## Conclusion

TODO Phase 8 ("CASE ITEM POOL") is **already fully satisfied by the existing architecture**:

1. `case_items` is the Case Item Pool — the relation _is_ the pool, per audit decision R1 (the same decision Phase 6 applied to `case_character_pool`).
2. Every checklist field (`itemId`, `weight`, `required`, `minQuantity`, `maxQuantity`, `hidden`, `discoveryMethod`, `conditions`) exists as a `case_items` column with the correct constraints.
3. Phase 7's `selectItems` already implements deterministic global case-item generation from these sources; its output is the exact payload the future Case Instance will persist.
4. **No migration, no new table, no new generation logic is required.**
5. Character → Item assignment is a separate, explicitly deferred concern and must not be implemented here.

**Phase 8 requires no implementation — it is an architectural checkpoint.** Creating a `case_item_pool` table would duplicate `case_items` verbatim and violate the approved architecture. The genuinely remaining item-generation work (assignment to characters, per-character limits, instance item runtime state, condition evaluation) belongs to later phases (§16) and is out of scope for Phase 8.
