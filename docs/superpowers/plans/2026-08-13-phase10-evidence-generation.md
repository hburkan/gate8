# Phase 10 — Evidence Generation Design

> **Status:** DESIGN — for review (design-only; nothing implemented or migrated). This document specifies the evidence-generation system and the module/API boundary. No database, migration, shared-types, content-schema, Admin UI, or Mobile UI changes in this phase.

**Goal:** Design how a Case Template deterministically generates its actual Evidence set from the existing canonical relation `case_evidence`, using the existing `cases.min_evidence`/`max_evidence` count bounds and the per-row `role`/`weight`/`importance`/`discovery_method` configuration — without creating pool tables, duplicate relations, case instances, a generator implementation, or any database change.

**Architecture:** The selection algorithm is a pure, deterministic domain operation. It consumes a version-pinned content snapshot (template + relation rows) and a seed; it never touches the database, Supabase, HTTP, UI, or AI. It reuses the Phase 6 PRNG (`cyrb128` + `mulberry32`) and mirrors the Phase 6/7/9 selection algorithm exactly. The natural home is `packages/game-rules` (generation is a game rule). Phase 10 designs and specifies; Phase 12/14 wires it into the seeded pipeline and Case Instance.

**Tech Stack:** TypeScript (pure functions), the existing seeded PRNG (Phase 6, dependency-free), `packages/game-rules` for the algorithm + types.

## Global Constraints (Phase 10)

- `case_evidence` is the **canonical** relation and the single source of truth for per-evidence selection and instance configuration. `cases.min_evidence`/`max_evidence` are the single source of truth for the **distinct-evidence** count bounds.
- No `case_evidence_pool` table. (TODO §10 is satisfied by `case_evidence`, per audit decision R1 — the relation is the pool.) No other separate evidence pool table, ever.
- Evidence is **single-instance**: like documents (unlike items) there are **no quantity columns** on `case_evidence`, so each selected evidence type appears exactly once. No quantity concept is invented.
- **The four evidence types REQUIRED/OPTIONAL/DECOY/HIDDEN are encoded in the single free-text `role` column** (TODO §10 "Types"). This is the critical divergence from `case_documents`: documents split requiredness (`required` bool), role (`real`/`fake`/`decoy`), and visibility (`hidden` bool) across three columns; evidence fuses all four states into `role` per audit decision R4 (no new SQL enums; typed union in shared-types only). The generator derives `required = role === 'required'` and treats `hidden = role === 'hidden'`, `decoy = role === 'decoy'` as instance classification carried unchanged.
- `role`/`importance`/`discovery_method` are **passive instance configuration carried through unchanged** — they are never selection inputs (with the single exception that `role === 'required'` selects-in the row unconditionally, exactly as the `required` bool does for documents/items/characters).
- `discovery_method` is carried through to the generated evidence unchanged; `discovery_condition` (jsonb) and `conditions` (jsonb) are **deferred** to the Phase 11 condition/rule engine and are not consumed or output in Phase 10.
- Per-location evidence placement (`location_evidence`) is a separate relation/pool; Phase 10 does not touch or consume it. Per-character evidence pools do not exist.
- No case instance tables, no generator implementation, no rule engine, no AI, no Admin UI, no Mobile UI.
- Deterministic: same (template, published version, seed) ⇒ same evidence set (types, ordering, roles, importance). Different seeds ⇒ may differ.
- Prefer deterministic explicit errors over silent fallback. Invalid configurations are caught at **publish time** (Phase 26) and defensively re-checked by the generator.
- The `eligibilityFilter` extension point (Phase 11 rule predicates) mirrors documents/items/characters and is an optional input; it must not change the draw sequence for identical pools.

---

## 1. Objective

Phase 10 is the **Evidence System**. It defines how a Case Template's evidence set is generated for a play-through, satisfying TODO §10 "Types" (REQUIRED, OPTIONAL, DECOY, HIDDEN) and §10.1 "Evidence Rules" (required/optional/decoy/hidden evidence, discovery method, discovery condition, importance, weight, min/max generation).

This document designs that system at the **domain-rule boundary** (`packages/game-rules`), mirroring the Phase 9 document-generation design so that the evidence generator is a direct analogue of `selectDocuments`: pure, seeded, version-pinned, single-instance, and bound by `min_evidence`/`max_evidence`. It deliberately does **not** implement the generator, does **not** add tables or columns, and does **not** build the Phase 11 rule engine, the Phase 12 pipeline, or the Phase 14 Case Instance — those are separate, later phases.

The single architectural decision this phase must nail down: **how the four evidence types are represented and selected.** The answer below is "one free-text `role` column with a typed union in shared-types" (already present), which avoids a redundant `required`/`hidden` boolean pair and any migration.

---

## 2. Current Architecture

Existing (all committed, `16de3da`):

- **Global entity** `evidence` (migration `0006`): `id`, `name`, `description`, `type` (`evidence_type` enum: `physical`/`digital`/`documentary`/`forensic`/`testimony`), `importance` (`evidence_importance` enum: `low`/`medium`/`high`/`critical`), lifecycle (`content_status`), `version`. The generator references by `evidenceId`; it never copies entity content.
- **Case relation** `case_evidence` (migration `0012`): `case_id` FK CASCADE, `evidence_id` FK RESTRICT, `role` (text, nullable, R4), `weight` (numeric ≥ 0, default 1), `importance` (`evidence_importance`, nullable = per-case override), `discovery_method` (text), `discovery_condition` (jsonb), `conditions` (jsonb default `[]`), `priority` (int default 0), `version`, `UNIQUE(case_id, evidence_id)`.
- **Case Template bounds** on `cases` (migration `0016`): `min_evidence`/`max_evidence` (int, CHECK ≥ 0; `0` = no bound), extended on `Case` in shared-types as `minEvidence`/`maxEvidence`.
- **Seeded PRNG** (Phase 6, `packages/game-rules/src/generation/prng.ts`): `cyrb128` + `mulberry32` via `createSeededRandom(seed)`, exposing `int(n)` and `float()`.
- **Reference generators** in `packages/game-rules/src/generation/`: `selection.ts` (characters), `item-selection.ts`, `document-selection.ts` (+ per-family `*-errors.ts`, `*-types.ts`), all re-exported from `generation/index.ts`.
- **No evidence generator exists yet** (`selectEvidence`, `evidence-errors.ts`, `evidence-types.ts` are the Phase 10 design targets; NOT implemented here).
- Shared-types `enums.ts` already exports `EVIDENCE_TYPES`, `EVIDENCE_IMPORTANCES`, and `EVIDENCE_ROLES = ['required','optional','decoy','hidden']`; `relations.ts` already defines `CaseEvidence`. Content-schema already defines `caseEvidenceSchema` (`role` nullable string, `weight` non-negative, `importance` nullable string, `discoveryMethod` nullable string, `discoveryCondition` record-or-null, `conditions`, `priority`).

The pipeline (Phase 12) will load a version-pinned snapshot and call the generator; Phase 14 will persist the result as a Case Instance. Neither is built in Phase 10.

---

## 3. Existing Schema Analysis

**Migration `0012` — `case_evidence` (unchanged):**

| Column                | Type                  | Constraint                             | Role in generation                                                             |
| --------------------- | --------------------- | -------------------------------------- | ------------------------------------------------------------------------------ |
| `evidence_id`         | uuid FK               | RESTRICT, UNIQUE(case_id, evidence_id) | which evidence; duplicate prevention is structural                             |
| `role`                | text                  | NULL allowed (free text, R4)           | **the four evidence types**: `required` / `optional` / `decoy` / `hidden` (§9) |
| `weight`              | numeric               | NOT NULL, CHECK (weight >= 0)          | optional-selection probability                                                 |
| `importance`          | `evidence_importance` | NULL allowed                           | per-case override of the entity default; carried to instance unchanged         |
| `discovery_method`    | text                  | NULL allowed (free text, R4)           | discovery configuration carried to the instance                                |
| `discovery_condition` | jsonb                 | NULL allowed                           | deferred to Phase 11 (§14), opaque                                             |
| `conditions`          | jsonb                 | NOT NULL DEFAULT '[]'                  | deferred to Phase 11 (§14), opaque                                             |
| `priority`            | int                   | NOT NULL DEFAULT 0                     | deterministic ordering (§5)                                                    |
| `version`             | int                   | NOT NULL                               | version pinning (§12)                                                          |

Note: `case_evidence` has **no quantity columns** (unlike `case_items`) and **no `required` bool and no `hidden` bool** (unlike `case_documents`). Evidence fuses the four types into `role`; single-instance semantics match documents.

**Migration `0016` — `cases` (unchanged):**

| Column         | Constraint | Role                                            |
| -------------- | ---------- | ----------------------------------------------- |
| `min_evidence` | CHECK >= 0 | distinct-evidence lower bound; `0` = no minimum |
| `max_evidence` | CHECK >= 0 | distinct-evidence upper bound; `0` = no maximum |
| `version`      | NOT NULL   | template version pin (§12)                      |

**Migration `0006` — `evidence` global entity:** `id`, `name`, `description`, `type` enum, `importance` enum (default resolved at instance time), lifecycle, `version`. Not copied into output; referenced by `evidenceId`.

**Shared-types / content-schema:** `EvidenceRole`, `EvidenceImportance` unions and `CaseEvidence` interface already exist; content-schema validation already accepts the role/weight/importance/discoveryMethod/discoveryCondition shape. The four-state classification is thus already a first-class, validated concept in the type layer.

---

## 4. Schema Sufficiency

**Verdict: the Phase 2–5 schema fully supports evidence generation. No migration required for Phase 10.**

Every TODO §10.1 rule maps to an existing column:

| §10.1 rule          | Existing carrier                                               |
| ------------------- | -------------------------------------------------------------- |
| Required evidence   | `case_evidence.role = 'required'`                              |
| Optional evidence   | `case_evidence.role = 'optional'` (or NULL)                    |
| Decoy evidence      | `case_evidence.role = 'decoy'`                                 |
| Hidden evidence     | `case_evidence.role = 'hidden'`                                |
| Discovery method    | `case_evidence.discovery_method` (carried, opaque)             |
| Discovery condition | `case_evidence.discovery_condition` (deferred to Phase 11)     |
| Importance          | `case_evidence.importance` per-case override (carried, opaque) |
| Weight              | `case_evidence.weight` (optional-selection probability)        |
| Min/max generation  | `cases.min_evidence` / `max_evidence`                          |

Adding `required`/`hidden` booleans to `case_evidence` would **duplicate** the signal already carried by `role` (violating the single-source-of-truth rule and audit decision R4). The schema intentionally chose a single fused `role` for evidence precisely because the four types are mutually exclusive (an evidence is exactly one of required/optional/decoy/hidden), unlike documents where `required` is orthogonal to `real`/`fake`/`decoy`. No migration is therefore either necessary or desirable.

---

## 5. Required DB Changes

**None.** No new tables, no new columns, no new enums, no constraint changes, no triggers, no RLS changes.

This is consistent with Phases 6–9, all of which satisfied their roadmap pool requirement with an existing relation (R1) and made zero schema changes.

---

## 6. New Tables and Relations

**None proposed.** `case_evidence` is the pool (R1). The only Phase 10 "new" artifacts are design-level, in `packages/game-rules` (implemented in the Phase 10 build step, not now):

- `evidence-types.ts` — `EvidenceSelectionCandidate`, `EvidenceSelectionInput`, `EvidenceSelectionResult`, `GeneratedEvidence`.
- `evidence-errors.ts` — `EvidenceSelectionError` union.
- `evidence-selection.ts` — pure `selectEvidence(input): EvidenceSelectionResult`.
- `index.ts` — re-export the new modules.

No database object is added.

---

## 7. Source-of-Truth and Duplication Analysis

- `case_evidence` is the **single source of truth** for evidence selection configuration (role/weight/importance/discovery_method/priority/version). No `case_evidence_pool`, no shadow columns, no cached copy anywhere.
- `cases.min_evidence`/`max_evidence` are the **single source of truth** for the distinct-evidence count bounds.
- `evidence` is the **single source of truth** for entity content; the generator references by `evidenceId` and never copies `name`/`description`/`type`/entity-level `importance` into output.
- `role` is the **single source of truth** for the four-state evidence type. The generator derives `required`/`hidden`/`decoy` as booleans **internally, as an interpretation of `role`**, never stored. This keeps one canonical column and one semantic mapping (documented in §9).
- `importance`: per-case override lives on `case_evidence.importance`; the entity default lives on `evidence.importance`. The generator carries the override when present and the Phase 14 instance resolves `override ?? entity-default`. No duplication at generation time; precedence is explicit.
- `discovery_condition`/`conditions` are consumed only by the Phase 11 rule engine, from the same relation rows — no separate copy.
- `location_evidence` is a separate, later concern (per-location placement) and is not a duplicate of `case_evidence`; Phase 10 leaves it untouched.

---

## 8. Entity and Relation Diagrams

```
evidence (global entity, 0006)
  id, name, description, type[physical|digital|documentary|forensic|testimony],
  importance[low|medium|high|critical], content_status, version
     ▲ 1
     │ RESTRICT (FK evidence_id)
case_evidence (canonical pool, 0012) ── UNIQUE(case_id, evidence_id)
  case_id (FK CASCADE) ──────► cases (0016)
  role text NULL  [required|optional|decoy|hidden]   <- the four types (R4)
  weight numeric >= 0 default 1                      <- optional-selection weight
  importance evidence_importance NULL                <- per-case override
  discovery_method text NULL                         <- carried, opaque
  discovery_condition jsonb NULL                     <- Phase 11 (opaque here)
  conditions jsonb default '[]'                      <- Phase 11 (opaque here)
  priority int default 0                             <- canonical ordering
  version int                                        <- pin vs cases.version

cases (0016): min_evidence, max_evidence (CHECK >= 0; 0 = no bound)
```

Generation-time flow (pure, no DB):

```
snapshot(case row + case_evidence rows, pinned to cases.version) + seed
        └─► selectEvidence ─► { ok:true, evidence: GeneratedEvidence[], ... }
                                or { ok:false, error: EvidenceSelectionError }
```

Instance-time flow (Phase 12/14, NOT Phase 10): generated evidence rows are persisted per Case Instance; `hidden`/`decoy` semantics and `discovery_condition` evaluation are applied later.

---

## 9. Field-Level Design

### 9.1 `EvidenceSelectionCandidate`

The generator's per-row view of `case_evidence` (the snapshot row; all required):

| Field             | Type                         | Source             | Notes                                                |
| ----------------- | ---------------------------- | ------------------ | ---------------------------------------------------- |
| `evidenceId`      | `string`                     | `evidence_id`      | uniqueness enforced structurally (UNIQUE)            |
| `role`            | `EvidenceRole \| null`       | `role`             | typed union (R4); `null` ≡ `optional`                |
| `weight`          | `number`                     | `weight`           | non-negative; `0` = ineligible for weighted draws    |
| `importance`      | `EvidenceImportance \| null` | `importance`       | per-case override; `null` = use entity default later |
| `discoveryMethod` | `string \| null`             | `discovery_method` | carried to output unchanged                          |
| `priority`        | `number`                     | `priority`         | canonical ordering key                               |
| `version`         | `number`                     | `version`          | must equal template version                          |

Not part of the candidate (deferred/opaque): `discoveryCondition`, `conditions` (Phase 11).

**Role semantics (the Phase 10 core):**

| `role`     | `required` (derived) | `hidden` (derived) | `decoy` (derived) | Selection behavior                                 |
| ---------- | -------------------- | ------------------ | ----------------- | -------------------------------------------------- |
| `required` | true                 | false              | false             | always selected                                    |
| `optional` | false                | false              | false             | eligible weighted optional                         |
| `decoy`    | false                | false              | true              | eligible weighted optional; classification carried |
| `hidden`   | false                | true               | false             | eligible weighted optional; classification carried |
| `null`     | false                | false              | false             | treated as `optional`                              |

`required` is the **only** role that influences selection; `hidden`/`decoy`/`optional` are mutually exclusive classifications carried to the instance, exactly as document `role` is passive in Phase 9. Deriving `required` from `role` (rather than a separate bool) is the whole point: one column, one meaning, zero migration.

### 9.2 `EvidenceSelectionInput`

| Field                | Type                                         | Notes                                            |
| -------------------- | -------------------------------------------- | ------------------------------------------------ |
| `caseTemplateId`     | `string`                                     | echoed in output / errors                        |
| `templateVersion`    | `number`                                     | version pin                                      |
| `evidence`           | `EvidenceSelectionCandidate[]`               | version-pinned relation rows                     |
| `minEvidence`        | `number`                                     | distinct-evidence lower bound; `0` = none        |
| `maxEvidence`        | `number`                                     | distinct-evidence upper bound; `0` = none        |
| `seed`               | `string`                                     | seeded PRNG input                                |
| `eligibilityFilter?` | `(c: EvidenceSelectionCandidate) => boolean` | Phase 11 hook; identical contract to Phase 6/7/9 |

### 9.3 `GeneratedEvidence`

| Field             | Type                         | Source                         |
| ----------------- | ---------------------------- | ------------------------------ |
| `evidenceId`      | `string`                     | `evidence_id`                  |
| `role`            | `EvidenceRole \| null`       | `role` (unchanged)             |
| `importance`      | `EvidenceImportance \| null` | `importance` per-case override |
| `discoveryMethod` | `string \| null`             | `discovery_method`             |

Hidden-ness/decoy-ness are **not** separate output fields: they are `role === 'hidden'` / `role === 'decoy'` and are derived by the Phase 14 instance from `role`. This avoids duplicating the classification a second time in the output (mirrors how document `role` is single-sourced even though documents additionally carry a `hidden` bool that evidence's `role` subsumes). `discoveryCondition`/`conditions` are intentionally absent from output (Phase 11 reads them from the relation).

### 9.4 `EvidenceSelectionResult`

```ts
type EvidenceSelectionResult =
  | {
      ok: true;
      evidence: GeneratedEvidence[];
      caseTemplateId: string;
      templateVersion: number;
      seed: string;
    }
  | { ok: false; error: EvidenceSelectionError };
```

Mirrors `DocumentSelectionResult` exactly.

---

## 10. Generation Algorithm

`selectEvidence(input)` is the direct analogue of `selectDocuments` (document-selection.ts). Identical control flow, with `role === 'required'` standing in for the `required` bool and an `importance` passthrough on output.

1. `validate(input)` (deterministic, first error wins):
   - bounds: `minEvidence < 0` or `maxEvidence < 0` → `InvalidBounds`; `maxEvidence > 0 && minEvidence > maxEvidence` → `InvalidBounds`.
   - per row: `version !== templateVersion` → `VersionMismatch`; duplicate `evidenceId` → `DuplicateEvidence`; `!Number.isFinite(weight) || weight < 0` → `InvalidWeight`.
2. `rng = createSeededRandom(input.seed)`.
3. `canonical = canonicalOrder(input.evidence)` by `(priority ASC, evidenceId ASC)`.
4. `eligible = eligibilityFilter ? canonical.filter(eligibilityFilter) : canonical`.
5. `required = eligible.filter(c => c.role === 'required')`; `optional = eligible.filter(c => c.role !== 'required')`.
6. `eligible.length === 0` → `NoEligibleEvidence`.
7. `eligible.length < minEvidence` → `PoolBelowMinimum`.
8. `maxEvidence > 0 && required.length > maxEvidence` → `RequiredExceedsMax`.
9. `lower = max(minEvidence, required.length)`; `upper = maxEvidence > 0 ? min(maxEvidence, eligible.length) : eligible.length`.
10. `target = lower + rng.int(upper - lower + 1)` — draw #1 = distinct-evidence count.
11. `selected = [...required]`; `remaining = optional`.
12. While `selected.length < target`: drawPool = `remaining.filter(c => c.weight > 0)`; empty → `InsufficientPool`; else `picked = weightedPick(drawPool, rng.float())` (cumulative-weight scan in canonical order: first row whose running sum exceeds `draw × Σweight`); push; remove from `remaining`. (No quantity draws — single-instance.)
13. Output `canonicalOrder(selected)` mapped to `GeneratedEvidence` (role, importance, discoveryMethod).
14. Return `{ ok: true, evidence, caseTemplateId, templateVersion, seed }`.

The draw sequence contract is identical to documents: **draw #1 = target count, then one weighted draw per optional slot.** Any change to this contract is a breaking determinism change.

---

## 11. Deterministic and Seeded Behavior

- Determinism is identical to Phase 6/7/9: `createSeededRandom(input.seed)` produces the PRNG stream; the algorithm consumes it in a fixed order (count draw, then one float per optional slot) over a canonically ordered, version-pinned pool.
- Same (template, published `version`, `seed`) ⇒ identical evidence set: same ids, same canonical ordering, same roles, same importance overrides.
- Different seeds ⇒ may produce a different count (within bounds) and/or different weighted optional picks.
- The `eligibilityFilter` is a pure predicate; for an identical accepted pool the draw sequence is byte-identical, so its presence does not perturb determinism for unchanged inputs.
- Ordering is always `(priority ASC, evidenceId ASC)` — never insertion order, never DB order, never random.
- Weighted draws are without replacement (selected rows are removed from `remaining`), so an evidence cannot appear twice — matching the structural `UNIQUE(case_id, evidence_id)` and single-instance rule.

---

## 12. Versioning Strategy

- Every `case_evidence` row carries `version`; the template row (`cases.version`) is the pin.
- `VersionMismatch` is thrown deterministically if any relation row's `version` differs from `templateVersion` — the snapshot is stale or mixed-version and generation refuses rather than guessing.
- The generated result echoes `templateVersion`, so the consuming pipeline (Phase 12) can assert the produced evidence set belongs to exactly one template version.
- No version columns are added. Publishing (Phase 26) will increment `cases.version` and all relation rows together; the generator only ever sees one consistent version.

---

## 13. Failure Modes and Validation

`EvidenceSelectionError` union (deterministic, `{ ok: false, error }`; never throws):

| Type                 | Trigger                                                                                 |
| -------------------- | --------------------------------------------------------------------------------------- |
| `InvalidBounds`      | `minEvidence < 0`, `maxEvidence < 0`, or `maxEvidence > 0 && minEvidence > maxEvidence` |
| `VersionMismatch`    | a candidate `version !== templateVersion` (carries ids/versions)                        |
| `DuplicateEvidence`  | two candidates share `evidenceId` (defensive; UNIQUE prevents at DB)                    |
| `InvalidWeight`      | `weight` not finite or `< 0` (carries id/weight)                                        |
| `NoEligibleEvidence` | zero eligible rows after filter                                                         |
| `PoolBelowMinimum`   | `eligible.length < minEvidence`                                                         |
| `RequiredExceedsMax` | `required.length > maxEvidence` (maxEvidence > 0)                                       |
| `InsufficientPool`   | target not reachable because all remaining optionals have `weight = 0`                  |

All errors are data-driven and report the offending values; the publish-time validator (Phase 26) re-checks the same invariants so invalid templates are rejected before play. No silent fallback, no clamping, no partial results.

---

## 14. Phase 11 Interaction (Condition / Rule Engine)

- `case_evidence.conditions` (jsonb) and `discovery_condition` (jsonb) are **opaque** to Phase 10: they are carried on the relation and ignored by `selectEvidence`.
- The Phase 11 rule engine will consume these from the same canonical rows to gate evidence availability (e.g., "IF item == phone THEN allow evidence == imei_mismatch") and to unlock hidden/conditional evidence mid-play.
- The `eligibilityFilter` input on `EvidenceSelectionInput` is the Phase 11 hook: the pipeline passes rule-derived predicates that narrow the eligible pool **before** count/weighted draws. Because the filter runs before draws and does not change the draw sequence for identical pools, Phase 11 rules can be layered on without breaking the Phase 10 contract.
- Evidence made available only _after_ generation (runtime discovery) is a Phase 11/14 runtime concern, not a Phase 10 selection concern.

---

## 15. Phase 12 Interaction (Generation Pipeline)

- Phase 12 builds the version-pinned snapshot: the `cases` row (min/max/version) + `case_evidence` rows joined to the template, mapped to `EvidenceSelectionCandidate[]`.
- Phase 12 seeds the pipeline (per play-through seed) and calls `selectEvidence` as one pipeline step alongside characters/items/documents.
- Phase 12 maps `role` → `EvidenceRole` (invalid free text is treated as `null`/`optional` by the type layer, consistent with R4) and numeric `weight` → `number`.
- Phase 12 stores `GeneratedEvidence[]` (or its reference keys) into the Case Instance; hidden/decoy interpretation and discovery state are Phase 14 concerns.
- `location_evidence` placement and character-conditional evidence remain separate pipeline concerns, not part of the global `selectEvidence` step.

---

## 16. Phase 14 Interaction (Case Instance)

- The generated evidence set is materialized as Case Instance evidence rows: `evidenceId`, `role`, `importance`, `discoveryMethod` per play-through.
- `hidden = role === 'hidden'` and `decoy = role === 'decoy'` are derived at instance build from `role` (single source, no duplicate storage).
- Effective importance = `GeneratedEvidence.importance` (override) `??` `evidence.importance` (entity default) — precedence resolved at instance time.
- Discovery state (which evidence has been found, when) is instance state driven by `discoveryMethod`/`discovery_condition` (Phase 11); Phase 10 produces the set, not the runtime state.

---

## 17. Deferred Features

Deliberately out of Phase 10 scope (designed here, implemented elsewhere):

- `selectEvidence` implementation + tests (Phase 10 build step, not this document).
- Condition/rule evaluation, `eligibilityFilter` wiring, `discovery_condition`/`conditions` interpretation (Phase 11).
- Pipeline integration, snapshot loading, Case Instance materialization (Phase 12 / Phase 14).
- Per-location evidence placement (`location_evidence`) and per-character evidence assignment (no such pool exists; later-phase concern).
- Runtime discovery mechanics, hidden-evidence reveal, decoy resolution (Phase 14+).
- Publish-time invariant validation of the same error conditions (Phase 26).
- Admin UI editing of `case_evidence` role/weight/importance and Mobile UI presentation (later phases).

---

## 18. Migration Strategy

- **No migration.** The design touches zero SQL. The existing `0006`/`0012`/`0016` schema is sufficient and the `supabase db reset` baseline (0001–0016, verified in Phase 9) is unaffected.
- If a future phase needs to persist generated evidence, that is a Case Instance migration in Phase 12/14 — not Phase 10.
- No enum changes: the four evidence types live only as the shared-types `EvidenceRole` union and free text in the DB (R4).

---

## 19. Testing Strategy

Design-level plan for the Phase 10 build step (no tests written in this document):

- **Determinism:** same seed + same snapshot ⇒ identical `GeneratedEvidence` (id set, ordering, roles, importance); differing seed ⇒ allowed to differ.
- **Golden regression:** a fixed seed + fixed candidate pool pinned to an exact expected evidence set (ids, roles, order), mirroring the Phase 6/7/9 golden tests.
- **Count bounds:** `min_evidence`/`max_evidence` respected; `0` bound behaves as "none"; target drawn in `[lower, upper]`.
- **Role semantics:** `role='required'` always selected and never excluded by counts (except `RequiredExceedsMax`); `decoy`/`hidden`/`null` treated as eligible optionals; classifications preserved in output.
- **Weighted picks:** weights influence frequencies statistically; `weight=0` rows are never drawn and trigger `InsufficientPool` when nothing else remains.
- **Every error path:** `InvalidBounds`, `VersionMismatch`, `DuplicateEvidence`, `InvalidWeight`, `NoEligibleEvidence`, `PoolBelowMinimum`, `RequiredExceedsMax`, `InsufficientPool`.
- **Canonical ordering:** output ordered by `(priority ASC, evidenceId ASC)` regardless of input order.
- **Eligibility filter:** narrowing the pool changes the result only via eligibility, not via PRNG sequence perturbation.

---

## 20. Risks and Architectural Concerns

- **Role-as-type divergence from documents.** `case_evidence` fuses the four types into one column while `case_documents` splits required/hidden/role. Risk: authors accidentally use `case_documents` conventions (e.g., a separate `required` bool that does not exist). Mitigation: the typed union, content-schema validation, the Phase 8/9 docs, and the Phase 26 publish validator all document/check the evidence `role` values. The divergence is deliberate (mutually exclusive types) and is the key Phase 10 decision.
- **`null` role ambiguity.** A `NULL` role is treated as `optional`; content authors must not rely on it as a distinct state. Mitigation: content-schema keeps it nullable (R4) and documentation states `NULL ≡ optional`.
- **Redundant columns temptation.** Adding `required`/`hidden` booleans would duplicate `role` and require a migration plus consistency checks. This design explicitly refuses that in favor of a single source of truth.
- **Discovery-state coupling.** It is tempting to make Phase 10 evaluate `discovery_condition`. Risk: leaking Phase 11 semantics into selection. Mitigation: strict boundary — Phase 10 only classifies and selects; discovery is deferred.
- **Importance precedence.** Dual source (entity default vs per-case override). Risk: instance resolves the wrong one. Mitigation: explicit precedence `override ?? entity-default` defined here and to be enforced in Phase 14.
- **Determinism regressions.** Any change to draw order, canonical ordering, or pool semantics is breaking. Mitigation: golden tests (§19) and the explicit draw-sequence contract (§10).
- **Over-design.** The phase is intentionally a near-copy of the proven document generator. Risk of over-engineering is mitigated by following the established 8-error / 3-type-file / pure-function pattern verbatim.

---

## Self-Review

- [x] Global constraints stated (no pool table, single-instance, role-as-type, no migration, no instance/rules/AI/UI).
- [x] All 20 required sections present in order (objective → risks).
- [x] §4 verdict: schema sufficient; **no migration required**.
- [x] §6: **no new tables or relations** proposed.
- [x] §9 field-level design with the role→type mapping table (required/decoy/hidden semantics).
- [x] §10 algorithm mirrors `selectDocuments` with `role === 'required'` in place of the `required` bool.
- [x] §13 eight deterministic error types, matching the Phase 6/7/9 pattern (evidence-specific discriminants).
- [x] §14/§15/§16 interaction boundaries for Phases 11/12/14.
- [x] §17 deferred features explicitly listed.
- [x] §18 migration strategy: none.
- [x] §19 testing strategy defined (for the Phase 10 build step).
- [x] Phase 11, 12, 14 roadmap items confirmed in TODO.md (§433, §460, and later phases).
- [x] No code, migration, shared-types, content-schema, Admin, or Mobile change made in this document.

---

## Conclusion

Phase 10 (Evidence System) requires **no schema change and no new tables**: `case_evidence` is the canonical pool, `cases.min_evidence`/`max_evidence` bound the distinct-evidence count, and the single free-text `role` column (typed as `EvidenceRole` in shared-types, R4) encodes the four required evidence types. The generator is a faithful analogue of `selectDocuments` — pure, seeded, version-pinned, single-instance, eight deterministic errors — with `required = role === 'required'` as its only role-derived selection input and `hidden`/`decoy`/`importance`/`discovery_method` carried through as instance configuration. Implementation belongs in `packages/game-rules` (`evidence-selection.ts`, `evidence-types.ts`, `evidence-errors.ts`, `index.ts` re-exports) in the Phase 10 build step; this document freezes the contract.
