# Content Model Architecture Audit — 2026-08-13

**Scope:** Phase 1–2 delivered schema (migrations `0001`–`0010`), `packages/shared-types`, `packages/content-schema`, `packages/game-rules`, and the design docs in `ARCHITECTURE.md`, `docs/content-model/`, and `docs/superpowers/plans/2026-08-13-phase1-phase2-monorepo-content-model.md`.

**Purpose:** Verify the schema follows the core content philosophy (global reusable entities referenced through relation/config tables, seeded weighted generation, template/instance separation, no hard-coded content, no AI, no mobile UI) and confirm it can support the planned Phase 3+ structure **before** any Phase 3 implementation.

**Verdict:** ✅ The current schema is **safe to continue**. No changes to existing Phase 2 tables are required to support Phase 3. See §10 for recommended (non-blocking) decisions.

---

## 1. Current Schema Summary

### Tables (all in `public`, all with RLS enabled, no policies yet)

| Table                   | Migration | Kind            | Notes                                                                    |
| ----------------------- | --------- | --------------- | ------------------------------------------------------------------------ |
| `characters`            | `0003`    | Global entity   | name, surname, age, nationality, occupation, description, portrait_asset |
| `items`                 | `0004`    | Global entity   | category/rarity/risk_level enums, value, asset                           |
| `documents`             | `0005`    | Global entity   | title, free-text `type`, description, asset                              |
| `evidence`              | `0006`    | Global entity   | `type` = category, importance                                            |
| `locations`             | `0007`    | Global entity   | self-referencing `parent_id` hierarchy                                   |
| `dialogue_definitions`  | `0008`    | Global entity   | title, description                                                       |
| `dialogue_nodes`        | `0008`    | Child (cascade) | node graph, `speaker_character_id` → characters                          |
| `dialogue_node_choices` | `0008`    | Child (cascade) | branching choices                                                        |
| `missions`              | `0009`    | Global entity   | reward + completion_condition JSONB                                      |

### Shared lifecycle (migration `0002`)

Every entity: `id uuid PK`, `status content_status` (draft/review/published/archived), `version int`, `created_at`, `updated_at`; shared `set_updated_at()` trigger; `content_status` enum.

### Types (SQL enums)

`content_status`, `item_category`, `item_rarity`, `risk_level`, `evidence_type`, `evidence_importance`, `location_type`, `dialogue_node_type`. Mirrored as TS unions in `shared-types/enums.ts` and zod enums in `content-schema`.

---

## 2. Entity Ownership Analysis

**Finding: no entity is owned by a Case, Location or Chapter.** No table has a FK to a case/location/chapter (none exist yet), and no entity table has ownership columns (case_id/location_id/chapter_id). This is correct.

Only cross-references present:

- `dialogue_nodes.speaker_character_id` → `characters(id)`, **nullable, `ON DELETE SET NULL`**. This is a _content-internal_ reference (a dialogue line spoken by a character), not an ownership relation. The dialogue definition remains a standalone, reusable entity; the character referenced is a fixed speaker in that script.
- `locations.parent_id` → `locations(id)` self-reference. Hierarchy, not ownership by another entity type.
- `dialogue_nodes.definition_id` / `dialogue_node_choices.node_id` → cascade. These are **composition** (a dialogue is its graph), which is correct: child rows have no standalone meaning.

✅ Characters, Items, Documents, Evidence, Locations, Dialogues, Missions are global and unowned. Requirement #1–#2 satisfied.

---

## 3. Reusability Analysis

**Finding: full reusability by construction.** Because no entity references a case/location/chapter and there is no duplicate-content mechanism, every Character/Item/Document/Evidence can be referenced from unlimited Locations, Cases and Chapters via the Phase 3+ relation tables. The `id uuid` + `version` fields give stable, versionable reference keys for relation rows.

Observations that preserve reusability:

1. **Evidence `type` = category** (physical/digital/documentary/forensic/testimony); the REQUIRED/OPTIONAL/DECOY/HIDDEN generation role is _not_ on the entity — it belongs on the case relation. This is exactly right: the same evidence can be REQUIRED in one case and DECOY in another. (Resolves C1 from the Phase 1–2 plan.)
2. **`documents.type` is free text** (not an enum). Content-defined document types (passport, invoice, license) can be added without a migration — important for data-driven content.
3. **`missions.reward` / `completion_condition` are JSONB** — configurable per content, validated by schema, not hard-coded.
4. **`conditions` / `actions` on dialogue nodes are JSONB** validated against the Phase 11 rule union in `game-rules` — a mission or dialogue can be reused in different cases because rules are data, not code.

✅ Requirement #3 and #14 satisfied. The schema makes no assumption that an entity is consumed by exactly one case.

---

## 4. Missing Relation Tables

The following tables do **not** exist yet — this is expected and correct. They are Phase 3+ deliverables, and the current schema is fully compatible with their introduction. They are listed for completeness of the audit.

### Phase 3.1 — Location relations

`location_characters`, `location_items`, `location_documents`, `location_evidence`, `location_cases`, `location_missions`

### Phase 3.2 — Case relations

`case_characters`, `case_items`, `case_documents`, `case_evidence`, `case_dialogues`, `case_missions`, `case_locations`

### Phase 4 — Chapter model

`chapters`, `chapter_locations`, `chapter_cases`, `chapter_missions`, `chapter_story_nodes`

### Phase 5 — Case templates

`cases`

### Phases 6–10 — Generation pools

`case_character_pool`, `character_item_pool`, `case_item_pool`, `case_document_pool`, `character_document_pool`, `location_document_pool`

### Phase 14 — Case instances

`case_instances` (holds `seed`, `player_id`, generated content references)

> **No action needed in Phase 2.** These are additive `00NN` migrations on top of the existing schema. All of them reference existing entity tables by `id`; no existing table must be altered to host them.

---

## 5. Potential Future Migration Problems

1. **TODO overlap: `case_characters` (3.2) vs `case_character_pool` (6.1).** The TODO defines both a generic relation list (`case_characters`, `case_items`, …) in §3.2 _and_ pool tables with generation config (`case_character_pool`, `case_item_pool`, …) in §6–10. Two readings:
   - **(A)** One table per (parent, child) pair that carries **both** the relation and the generation config (weight, required, min/max, role, conditions, discovery). Then `case_character_pool` and `case_characters` are the **same** table, named inconsistently.
   - **(B)** Two separate layers: a relation/availability table (which entities exist in a case) and a pool table (generation weights). Redundant, more tables to maintain.
   - **Recommendation:** (A) — a single relation table per pair carrying full config. This matches §3.2's own rule ("Every relation must be able to contain context/configuration") and §3.1's location relations, which already put availability + weight + spawn_probability + min/max + order in one table. **This naming/design decision must be resolved before Phase 3 SQL is written**, but requires no change to existing tables.
2. **Relation-table lifecycle.** Relation tables have no `status`/`version` (they don't exist yet). Decide in Phase 3 whether relation rows inherit versioning from their parent (case/location) or carry their own. Recommendation: they belong to the parent's version (a case's relations version with the case). This affects Phase 27 (revision history) — plan it, no schema change now.
3. **SQL enum rigidity.** `item_category`, `evidence_type`, etc. are Postgres enums. Adding a value later needs `ALTER TYPE … ADD VALUE` (fine in PG 14+, but a migration + rebuild consideration; can't run in a transaction block in older versions). Free-text fields (`documents.type`, `characters.occupation`, `nationality`) avoid this for content-defined types. Acceptable; document it.
4. **Duplicate prevention on relation tables.** Phase 3 must add `UNIQUE(parent_id, entity_id)` on every relation/pool table to prevent duplicate references. Not a Phase 2 problem.
5. **Dialogue–character coupling.** `dialogue_nodes.speaker_character_id` means a dialogue definition is only _directly_ usable in cases that include that specific character. Reusability of a dialogue across cases therefore depends on the case including its speakers. This is a content-authoring constraint to validate in Phase 26 (broken-speaker checks), not a schema flaw.
6. **`case_instances` snapshots.** Phase 14 must decide whether instances store _references_ (case_template_id + entity ids) or _snapshots_ (denormalized copies) so generated content stays stable. Recommended: store `seed` + references to template and template-relations; regenerate deterministically from seed, or snapshot on generation. No Phase 2 impact.

---

## 6. Case Generation Compatibility

Planned future structure requires:

- Case template min/max character/item/document/evidence counts (§5.1) — belongs on the future `cases` table. ✅ no conflict with existing tables.
- Case character pool with `weight`, `required`, `min_items`, `max_items`, `role`, `priority`, `conditions` (§6.1). ✅ all columns reference `characters(id)` which exists.
- Case item pool (`hidden`, `discovery_method`, conditions, §8). ✅ references `items(id)` which exists.
- Case document pool (required/optional/fake/decoy/hidden, §9). ✅ references `documents(id)` which exists.
- Case evidence rules (required/optional/decoy/hidden, discovery method/condition, importance, weight, min/max, §10). ✅ references `evidence(id)` which exists; role/importance override on the relation.
- **Seeded deterministic generation** (§12): seed stored on `case_instances`; weights live on relation tables; entity ids are stable uuids. The generator (Phase 12, shared `game-rules`/engine) reads content — nothing about the current schema blocks it.

✅ **Case generation is fully compatible** — Phase 2 provides all entity anchors; generation config lands on Phase 3+ relation tables.

---

## 7. Location Compatibility

Planned `location_*` relations (characters/items/documents/evidence/cases/missions) will be new tables referencing `locations(id)` and the entity tables. The `locations.parent_id` hierarchy already supports the required model:

```
Turkey → Istanbul → Istanbul Airport → Terminal / Passport Control / Baggage Area / Inspection Room / Interview Room
```

via nested `parent_id`. ✅ **Location compatibility confirmed**; no Phase 2 changes needed.

---

## 8. Character / Item Compatibility

Planned `character_item_pool` (§7.1): `characterId`, `itemId`, `weight`, `minQuantity`, `maxQuantity`, `required`, `conditions` — both referenced tables (`characters`, `items`) exist with stable ids.

Per-character item **limits** (a character may carry 1–3 items) are supported two ways:

- `case_character_pool.min_items/max_items` — how many items a character can hold within a case (§6.1).
- `character_item_pool.min_quantity/max_quantity` — per-item quantities.

Both are relation-level columns; nothing hard-coded. ✅ **Character/item compatibility confirmed.**

---

## 9. Document / Evidence Compatibility

- **Documents:** global entity with free-text `type`. Fake/decoy/hidden/required classification (§9) is relation-level on `case_document_pool` / `character_document_pool` / `location_document_pool` — consistent with the evidence role decision. A single document can be _real_ in one case and _fake_ in another. ✅
- **Evidence:** entity carries category (`type`) + `importance`; case relation carries REQUIRED/OPTIONAL/DECOY/HIDDEN role, discovery method/condition, per-case importance override, weight, min/max. ✅

✅ **Document/evidence compatibility confirmed; both stay global and reuse-safe.**

---

## 10. Recommended Changes

### Required before Phase 3 can proceed (no existing-table change — design decisions)

- **R1 (decision):** Resolve the `case_*` vs `case_*_pool` naming overlap (§5.1). Adopt **one relation table per (parent, child) pair** carrying the full configuration. Finalize the column contract in `docs/content-model/relations.md` before writing Phase 3 SQL.
- **R2 (decision):** Decide relation-table versioning semantics (version with parent). Document in `docs/architecture/database-migration-strategy.md`.

### Non-blocking recommendations

- **R3:** Add `UNIQUE(parent_id, entity_id)` constraints on all Phase 3 relation/pool tables.
- **R4:** Document that SQL enums are append-only (new values via `ALTER TYPE … ADD VALUE`); prefer free-text for content-defined types (already done for `documents.type`).
- **R5:** Keep `speaker_character_id` nullable and validate "speaker must exist in the case" at publish time (Phase 26), so dialogue reusability is enforced as data validation, not by schema coupling.

---

## 11. No-Changes-Required Sections

- **No change required to `characters`, `items`, `documents`, `evidence`, `locations`, `missions`, `dialogue_*` tables** to support Phase 3–14. They are complete global entities with stable ids, versioning, and status.
- **No change required for weighted random generation** — weights are future relation columns; entity ids are stable anchors.
- **No change required for seeded deterministic generation** — seed lives on the future `case_instances` table, decoupled from content.
- **No change required for Case Template / Case Instance separation** — no instance data exists in content tables; the separation is architectural and preserved.
- **No hard-coded game content, no AI, no mobile UI** — confirmed: no seed content data, no AI dependency anywhere in the codebase, `apps/mobile` is a placeholder directory only.
- **No change required to `packages/shared-types`, `packages/content-schema`, `packages/game-rules`** — they mirror the schema and are ready for relation-schema additions in Phase 3.

---

## 12. Future Structure Support Check (explicit)

| Future structure                                                                        | Supported by current schema?                                         |
| --------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| CONTENT LIBRARY: Characters, Items, Documents, Evidence, Dialogues, Missions, Locations | ✅ all exist as global entities                                      |
| CONTENT LIBRARY: Chapters, Cases                                                        | ✅ will be added (Phase 4, 5); entities reference them via relations |
| Location → Characters/Items/Documents/Evidence/Cases                                    | ✅ via future `location_*` tables                                    |
| Case → Characters/Items/Documents/Evidence/Dialogues/Missions/Locations                 | ✅ via future `case_*` tables                                        |
| Character → Item Pool                                                                   | ✅ via future `character_item_pool`                                  |
| Character → Document Pool                                                               | ✅ via future `character_document_pool`                              |

The current schema is a clean foundation: **global entities only, no premature ownership, no coupling to cases.**

---

## 13. Audit Conclusion

1. **Is the current schema safe to continue?** — **Yes.** Phase 2's schema is correct, minimal, and fully compatible with the Phase 3+ relation/pool/template/instance model.
2. **Required migrations?** — **None to existing tables.** Phase 3 will add new `location_*` and `case_*` relation tables (plus, later, `chapters`, `cases`, pools, `case_instances`). No `ALTER` on existing entities is required.
3. **Architectural concerns?**
   - The TODO's `case_*` vs `case_*_pool` duplication (**R1**) is the one real design inconsistency; resolve before Phase 3 SQL.
   - Relation-table versioning semantics (**R2**) and duplicate-prevention constraints (**R3**) should be decided and applied as part of Phase 3.
   - SQL enum append-only policy (**R4**) and dialogue-speaker validation (**R5**) are minor, documented risks with clear mitigations.

---

## Status

Awaiting approval before Phase 3 implementation. No database changes have been made during this audit.
