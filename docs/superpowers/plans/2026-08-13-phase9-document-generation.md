# Phase 9 — Document Generation Design

> **Status:** DESIGN — approved; implemented in `@gate8/game-rules` (pure `selectDocuments` over a version-pinned `case_documents` snapshot). This document specifies the document-generation system and the module/API boundary. No database, migration, shared-types, content-schema, Admin UI, or Mobile UI changes in this phase.

**Goal:** Design how a Case Template deterministically generates its actual Document set from the existing canonical relation `case_documents`, using the existing `cases.min_documents`/`max_documents` count bounds and the per-row `role`/`hidden`/`discovery_method` configuration — without creating pool tables, duplicate relations, case instances, a generator implementation, or any database change.

**Architecture:** The selection algorithm is a pure, deterministic domain operation. It consumes a version-pinned content snapshot (template + relation rows) and a seed; it never touches the database, Supabase, HTTP, UI, or AI. It reuses the Phase 6 PRNG (`cyrb128` + `mulberry32`) and mirrors the Phase 6/7 selection algorithm exactly. The natural home is `packages/game-rules` (generation is a game rule). Phase 9 designs and specifies; Phase 12/14 wires it into the seeded pipeline and Case Instance.

**Tech Stack:** TypeScript (pure functions), the existing seeded PRNG (Phase 6, dependency-free), `packages/game-rules` for the algorithm + types.

## Global Constraints (Phase 9)

- `case_documents` is the **canonical** relation and the single source of truth for per-document selection and instance configuration. `cases.min_documents`/`max_documents` are the single source of truth for the **distinct-document** count bounds.
- No `case_document_pool` table. (TODO §9 is satisfied by `case_documents`, per audit decision R1 — the relation is the pool.) No other separate document pool table, ever.
- A document is **single-instance**: unlike items there are **no quantity columns** on `case_documents`, so each selected document type appears exactly once. No quantity concept is invented.
- The `role` column (free text, `real`/`fake`/`decoy` in the TS layer, R4) is **passive instance configuration carried through unchanged** — exactly like `hidden` is for items (§4). It is never a selection input in Phase 9.
- Per-character document pools (`character_document_pool`) and per-character document assignment are **deferred** (TODO §7 / §12.x pattern) — Phase 9 implements the **global case document set only** (§7).
- Location document placement (`location_documents`) is a separate relation/pool; Phase 9 does not touch or consume it.
- No case instance tables, no generator implementation, no rule engine, no AI, no Admin UI, no Mobile UI.
- Deterministic: same (template, published version, seed) ⇒ same document set (types, ordering, roles). Different seeds ⇒ may differ.
- Prefer deterministic explicit errors over silent fallback. Invalid configurations are caught at **publish time** (Phase 26) and defensively re-checked by the generator.
- `hidden` and `discovery_method` are carried through to the generated document **unchanged**; they are instance state, not selection inputs.

---

## 1. Sources of Truth (current schema — sufficient)

From migration `0012` (`case_documents`) — **unchanged**:

| Column             | Type    | Constraint                             | Role in generation                                    |
| ------------------ | ------- | -------------------------------------- | ----------------------------------------------------- |
| `document_id`      | uuid FK | RESTRICT, UNIQUE(case_id, document_id) | which document; duplicate prevention is structural    |
| `required`         | bool    | NOT NULL                               | must always be selected                               |
| `weight`           | numeric | NOT NULL, CHECK (weight >= 0)          | optional-selection probability                        |
| `role`             | text    | NULL allowed (free text, R4)           | carried unchanged to output, not a selection input    |
| `hidden`           | bool    | NOT NULL                               | initial visibility of the generated instance document |
| `discovery_method` | text    | NULL allowed (free text, R4)           | discovery configuration carried to the instance       |
| `priority`         | int     | NOT NULL DEFAULT 0                     | deterministic ordering (defined §5)                   |
| `conditions`       | jsonb   | NOT NULL DEFAULT '[]'                  | deferred to Phase 11 (§6)                             |
| `version`          | int     | NOT NULL                               | version pinning (§8)                                  |

Note: `case_documents` has **no quantity columns** (unlike `case_items`). Each selected document type appears exactly once — quantity is structurally `1` and no `min_quantity`/`max_quantity`/`quantity` field is invented.

From migration `0016` (`cases`) — **unchanged**:

| Column          | Constraint | Role                                            |
| --------------- | ---------- | ----------------------------------------------- |
| `min_documents` | CHECK >= 0 | distinct-document lower bound; `0` = no minimum |
| `max_documents` | CHECK >= 0 | distinct-document upper bound; `0` = no maximum |
| `version`       | NOT NULL   | template version pin (§8)                       |

From migration `0005` (`documents`) — global entity (`id`, `title`, free-text `type`, `description`, `asset`, lifecycle). The generator never copies entity content; output references by `documentId`.

**Verdict: the Phase 2–5 schema fully supports document generation. No migration required for Phase 9.** `case_documents` already carries the full selection + instance configuration, and `cases.min_documents`/`max_documents` carry the distinct-document count bounds.

---

## 2. Document Selection Count (distinct document types)

`cases.min_documents`/`max_documents` control the number of **distinct Document entities (types)** selected into the generated case document set.

```
min_documents = 2, max_documents = 4
Pool: Passport, Invoice, License, Warrant  (|E| = 4)

target ∈ {2, 3, 4}
```

- **Lower bound** `lower = max(min_documents, |R|)` — never fewer than the required document types.
- **Upper bound** `upper = max_documents > 0 ? min(max_documents, |E|) : |E|` — `0` = no upper bound (Phase 5 convention), resolved to the eligible pool size; a positive `max_documents` is capped by the eligible pool size (corrected Phase 6 semantics; no `PoolBelowMaximum` failure).
- **Target** `target = lower + prng.int(upper - lower + 1)` — one seeded draw, uniform, inclusive.

Each selected row is one distinct document type. The generator selects **distinct `document_id`s only** (structural `UNIQUE(case_id, document_id)` + selection bookkeeping); no document type is ever duplicated in the output.

**The count is a count of document types; each type contributes exactly one instance** (no physical-copy dimension exists for documents).

---

## 3. Required Documents

`required = true` ⇒ the document type is selected unconditionally and always present in the output, regardless of weight, role, priority, conditions, hidden, or seed. Required documents count against `max_documents` and against the distinct-document count.

| Situation                                          | Resolution                                                                     |
| -------------------------------------------------- | ------------------------------------------------------------------------------ |
| `required count > max_documents` (bounded)         | `RequiredExceedsMax` — publish-time validation (Phase 26) + generator backstop |
| `required count > eligible pool`                   | `PoolBelowMinimum` — pool smaller than the required set; invalid template      |
| required document with `role`/`hidden`/`discovery` | carried through unchanged; `required` and role/hidden/discovery are orthogonal |

A required document with `weight = 0` is still selected (weight governs optional selection only, §4). A required fake/decoy/hidden document is selected exactly like any other required row.

---

## 4. Role, Hidden, Discovery Method (passive instance state)

Unlike items (which carry `hidden`/`discovery_method` but no `role`), documents carry `role`, `hidden`, and `discovery_method`. Mirroring the Phase 6 character `role` treatment and the Phase 7 `hidden`/`discovery_method` treatment, **all three are generated instance state, never selection inputs**:

- **`role`** (`real`/`fake`/`decoy`, free text) — what the document _is_ in this case. A document can be _real_ in one case and _fake_ in another (audit §9). Role does **not** mean excluded, does **not** set weight, and does **not** narrow eligibility. A fake/decoy document participates in weighted selection exactly like a real one; its role is carried unchanged into the output.
  - "Fake documents" and "Decoy documents" (TODO §9) are therefore **supported by the existing `role` column** — no new columns, no new behavior beyond pass-through.
- **`hidden`** — initial visibility of the generated instance document; carries through unchanged.
- **`discovery_method`** — free text; carries through unchanged (`string | null`).

No runtime discovery mechanics (probabilities, unlock rules) are implemented in Phase 9 — the generated document carries its discovery configuration as data for the future Case Instance (Phase 14), exactly like Phase 7.

No `DOCUMENT_ROLES` enum is added to the DB (R4). The typed union already exists in `shared-types` (`DOCUMENT_ROLES = ['real', 'fake', 'decoy']`); the DB column stays free text.

---

## 5. Priority (canonical ordering)

Identical to Phase 6 §6 and Phase 7 §9: `(priority ASC, document_id ASC)` is the authoring-provided deterministic ordering key — pool iteration order, weighted-draw tie-break, and final output ordering. It is **selection ordering, not probability**; it never changes selection chance (weights do), never overrides `required`, and never narrows the eligible set.

| Field      | Meaning in Phase 9                                      |
| ---------- | ------------------------------------------------------- |
| `required` | hard membership — always selected                       |
| `weight`   | relative selection probability among optional rows      |
| `priority` | deterministic ordering (iteration + tie-break + output) |
| `role`     | passive instance state, carried through unchanged       |

---

## 6. Conditions

Identical treatment to Phase 6/7:

```
CONTENT (case_documents.conditions, opaque JSONB)
  ↓
future eligibility evaluation (Phase 11 rule engine)
  ↓
eligible document pool E
  ↓
deterministic selection (Phase 9 algorithm)
```

- **Phase 9 treatment: ignored.** All pool rows are eligible; `conditions` are not evaluated.
- The generator input includes `conditions` as opaque payloads and the algorithm exposes the same optional **eligibility filter** extension point (`eligibilityFilter?: (candidate) => boolean`) used by Phases 6/7. When the Phase 11 rule engine ships, a caller-provided predicate may narrow `E`; without it, all rows are eligible.
- No condition semantics are invented now.

---

## 7. Interaction with Character / Item Generation (Choice A — global set only)

Document Generation (Phase 9) is **independent** of Character Generation (Phase 6) and Item Generation (Phase 7):

- It generates the **global case document set** from `case_documents` + `cases.min_documents`/`max_documents`.
- It does **not** consume character or item output, does **not** depend on selected characters, and is not gated by them.
- Per-character document pools and per-character document **assignment** are **deferred** to a later phase (the future per-character work described in TODO §7 / §12.x). Phase 9 does not assign documents to characters; `character_document_pool` is **not** created.
- `location_documents` (migration `0013`) is a separate location-placement relation; Phase 9 does not read, write, or consume it. Location-based document spawning is a separate, later concern.

```
Character Selection (Phase 6)
    ↓
Global Item Selection (Phase 7)
    ↓
Global Document Selection (Phase 9)   ← this phase
    ↓
Assignment to Characters / Locations   ← deferred
```

---

## 8. Seeded Determinism, Draw Sequence, Version Pinning

**Deterministic input tuple** (identical to Phase 6/7):

```
(case_template_id, template version, seed, snapshot of cases + case_documents at that version)
```

Same tuple ⇒ identical output. The generator is a pure function: `f(template, relations, seed) → result`. The seed is opaque to the algorithm; Phase 14 stores it on the Case Instance.

**Draw sequence (part of the generator contract — regression tested):**

```
draw #1   → document target count        (prng.int(upper - lower + 1))
draw #2.. → one weighted pick per optional slot   (prng.float() each)
```

No quantity draws exist for documents (single-instance). The stream layout is therefore identical to Phase 6 character selection (count + picks). The PRNG source is the **existing** `createSeededRandom(seed)` (`cyrb128` → `mulberry32`); no second random implementation.

**Version pinning:** `cases.version` is the template content version; `case_documents.version` must equal it (R2: relations version with their parent). A single mismatch ⇒ `VersionMismatch`. Never generate from `cases.version N` + `case_documents.version N+1`.

---

## 9. Output Model

A generated document carries **the relation's instance-relevant configuration** — enough for the future Case Instance without copying the global `documents` entity content (title, type, description resolve by `documentId`).

```ts
interface GeneratedDocument {
  documentId: string;
  role: string | null; // free text; carried unchanged
  hidden: boolean; // initial visibility (instance state)
  discoveryMethod: string | null; // free text, carried unchanged
}
```

- Output is **canonically ordered** `(priority ASC, document_id ASC)`.
- **No `quantity`** — documents are single-instance; `case_documents` has no quantity columns and none is invented.
- `weight`, `required`, `priority`, `conditions`, `version` are not copied into the output: they are selection/ordering/validation config, not instance state.
- `role` **is** copied into the output (unlike items, where no `role` exists) because it is part of what the generated document _is_ in this case — matching the Phase 6 character precedent, where `role` is included.

---

## 10. Failure Modes (deterministic, explicit errors)

| Condition                                                        | Error                 | Layer                                              |
| ---------------------------------------------------------------- | --------------------- | -------------------------------------------------- |
| `required > max_documents`                                       | `RequiredExceedsMax`  | publish validation (Phase 26) + generator backstop |
| `pool size < min_documents`                                      | `PoolBelowMinimum`    | publish validation + generator backstop            |
| no eligible documents (`\|E\| = 0`)                              | `NoEligibleDocuments` | generator                                          |
| all optional `weight = 0` + target > `\|R\|`                     | `InsufficientPool`    | generator                                          |
| negative / non-finite weight in snapshot                         | `InvalidWeight`       | generator (defensive; DB CHECK prevents)           |
| `min_documents > max_documents` (bounded), or any negative bound | `InvalidBounds`       | publish validation + generator backstop            |
| relation `version` ≠ template `version`                          | `VersionMismatch`     | generator                                          |
| duplicate `document_id` in snapshot                              | `DuplicateDocument`   | generator (defensive; UNIQUE prevents)             |
| `conditions` eliminate all rows (post-Phase 11)                  | `NoEligibleDocuments` | generator                                          |

All errors are typed, data-carrying discriminated-union values (mirroring `CharacterSelectionError`/`ItemSelectionError`). Error-level parallels: `RequiredExceedsMax`, `PoolBelowMinimum`, `NoEligibleDocuments`, `InsufficientPool`, `InvalidWeight`, `InvalidBounds`, `VersionMismatch`, `DuplicateDocument`. **No `InvalidQuantityBounds`** (no quantities exist) and **no `PoolBelowMaximum`** (corrected Phase 6 semantics).

---

## 11. Proposed Module / API Boundary (design only — no implementation)

Package: `packages/game-rules`, reusing the Phase 6 `prng.ts`. Proposed structure (NOT created in Phase 9):

```
packages/game-rules/src/generation/
  document-selection.ts  — pure selectDocuments(...)
  document-errors.ts     — DocumentSelectionError discriminated union
  document-types.ts      — DocumentSelectionCandidate / DocumentSelectionInput / GeneratedDocument / result types
  prng.ts                — reused from Phase 6 (unchanged)
```

Proposed API (sketch — informational):

```ts
interface DocumentSelectionCandidate {
  documentId: string;
  required: boolean;
  weight: number;
  role: string | null; // free text; carried unchanged
  hidden: boolean;
  discoveryMethod: string | null;
  priority: number;
  conditions: unknown[]; // opaque in Phase 9
  version: number;
}

interface DocumentSelectionInput {
  caseTemplateId: string;
  templateVersion: number;
  minDocuments: number; // distinct document types; 0 = no minimum
  maxDocuments: number; // distinct document types; 0 = no maximum
  documents: DocumentSelectionCandidate[];
  seed: string;
  // Phase 11 extension point:
  eligibilityFilter?: (candidate: DocumentSelectionCandidate) => boolean;
}

type DocumentSelectionResult =
  | {
      ok: true;
      documents: GeneratedDocument[]; // { documentId, role, hidden, discoveryMethod }
      caseTemplateId: string;
      templateVersion: number;
      seed: string;
    }
  | { ok: false; error: DocumentSelectionError };

declare function selectDocuments(input: DocumentSelectionInput): DocumentSelectionResult;
```

The function is pure, synchronous, typed, and fully unit-testable with no external dependencies. Phase 12/14 load the version-pinned snapshot and call it, storing the seed + result on the Case Instance.

---

## 12. Test Strategy (design only — no implementation)

Deterministic unit tests (in `packages/game-rules`, Phase 9 implementation), mirroring Phases 6–7:

| #   | Test                            | Asserts                                                                 |
| --- | ------------------------------- | ----------------------------------------------------------------------- |
| 1   | min/max document count          | count ∈ [min_documents, effectiveUpper]                                 |
| 2   | max_documents > pool            | succeeds; count capped at `\|E\|`                                       |
| 3   | max_documents = 0               | unbounded ⇒ upper = `\|E\|`                                             |
| 4   | required document               | required id always present                                              |
| 5   | multiple required documents     | all required ids present; lower = `\|R\|`                               |
| 6   | required > max                  | returns `RequiredExceedsMax`                                            |
| 7   | pool < minimum                  | returns `PoolBelowMinimum`                                              |
| 8   | weighted selection              | statistical check: higher weight selected more often across seeds       |
| 9   | weight = 0                      | zero-weight optional never picked (unless required)                     |
| 10  | all optional weights = 0        | `InsufficientPool` when target > `\|R\|`; succeeds with exactly `\|R\|` |
| 11  | duplicate prevention            | no duplicate documentId in output; `DuplicateDocument` on snapshot dupe |
| 12  | same seed ⇒ same result         | two calls, same input, equal output (types + roles + order)             |
| 13  | different seeds can differ      | at least one differing output across seeds                              |
| 14  | role propagation                | output `role` equals row `role` incl. `null`                            |
| 15  | hidden propagation              | output `hidden` equals row `hidden`                                     |
| 16  | discovery_method propagation    | output `discoveryMethod` equals row value incl. `null`                  |
| 17  | no quantity                     | output has no quantity field; each document appears exactly once        |
| 18  | role never affects selection    | role values (incl. fake/decoy) never change counts/picks                |
| 19  | version mismatch                | relation version ≠ template version ⇒ `VersionMismatch`                 |
| 20  | conditions remain unevaluated   | all rows eligible when no filter; opaque conditions don't affect output |
| 21  | target count never exceeds pool | `\|output\| ≤ \|E\|` for all seeds                                      |
| 22  | deterministic draw ordering     | regression test pins the exact reference (count, picks)                 |

**Property-based tests** — reuse the Phase 6/7 approach: documents generated deterministically from an independent LCG (no new dependency). Invariants across random templates + seeds: distinct document IDs, selected count within `[lower, effectiveUpper]`, required always selected, role/hidden/discovery pass-through, same-seed determinism.

---

## 13. Database Changes

**No migration required for Phase 9.** The Phase 2–5 schema is fully sufficient: `case_documents` carries required/weight/role/hidden/discovery_method/conditions/priority/version with `UNIQUE(case_id, document_id)` (migration `0012`), `cases` carries `min_documents`/`max_documents` (migration `0016`), and `documents` is the global entity (migration `0005`). TODO §9's `case_document_pool` is satisfied by `case_documents` (audit R1) — no pool table. No new columns, tables, constraints, enums, or types are introduced.

---

## 14. Risks

| Risk                                             | Mitigation                                                                                          |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| Inventing a quantity for documents               | `case_documents` has no quantity columns (§1); output model has no quantity and test #17 pins it    |
| Role mistaken for a selection input              | §4: role is passive instance state, carried unchanged; test #18 pins selection independence         |
| NA / No-eligibility vs role                      | Role never narrows eligibility (opposite of a "hidden = excluded" misread) — documented in §4       |
| Duplicating Phase 6/7 selection logic needlessly | Algorithm is intentionally identical (count + weighted picks); only the output/pass-through differs |
| Per-character/location document pools consumed   | Explicitly out of scope (§7); `character_document_pool` deferred, `location_documents` untouched    |
| Free-text `role`/`discovery_method` drift        | Content-defined by design (R4); carried through unchanged                                           |
| Min/max impossible ranges                        | Deferred to Phase 26 publish validation (consistent with Phase 3/5/6/7 nonnegativity-only checks)   |

---

## 15. Explicitly Deferred Features

- Case Instance model (`case_instances`) — Phase 14.
- Seeded generator wiring / random generation engine — Phase 12.
- Rule/condition engine — Phase 11.
- Document assignment to characters — later phase (§7, deferred).
- Per-character document pools (`character_document_pool`) — TODO §7 / §12.x, later design; not created here.
- Location document spawn models (`location_documents` consumption/generation) — separate later concern; relation already exists (0013).
- Document discovery mechanics (probabilities, unlock rules) — future, not Phase 9.
- Duplicate pool tables (`case_document_pool`, etc.) — never; `case_documents` is canonical.
- Solvability constraints (at least one real document, decoy limits, etc.) — Phase 13 constraint validation / Phase 26 publish.
- Admin UI / Mobile UI / AI — never in this phase.

---

## Self-Review / Contradiction Check

**Spec coverage:** count semantics (§2), required behavior (§3), role/hidden/discovery passive-state treatment (§4), priority ordering (§5), conditions opacity (§6), character/item interaction with deferred assignment and untouched location relation (§7), deterministic seed + draw sequence + version pinning (§8), output model with no invented quantity (§9), all 8 failure modes with a necessity review (§10), module boundary reusing Phase 6 PRNG (§11), 22-test strategy + property tests (§12), no-migration verdict (§13), risks (§14), deferred features (§15).

**Contradiction check against the repository:**

- `case_documents` columns verified against migration `0012` (§1) — match the candidate/output types exactly; confirmed **no quantity columns**. ✅
- `cases.min_documents`/`max_documents` verified against migration `0016`. ✅
- `documents` global entity verified against migration `0005` (free-text `type`). ✅
- `DOCUMENT_ROLES = ['real', 'fake', 'decoy']` already declared in `packages/shared-types/src/enums.ts` — Phase 9 introduces no new union; the DB stays free text (R4). ✅
- `location_documents` exists (migration `0013`) and is deliberately untouched. ✅
- Audit R1 (§5.1, §10) and the Phase 6/7 precedent: relation is the pool; `case_document_pool` not created. ✅
- No existing table, type, schema, or commented intent suggests a separate document pool table or a quantity column. ✅
- Phase 7 §Interactive example and §15 show the exact algorithm shape reused here (count draw + weighted picks, effective upper capped by pool, no `PoolBelowMaximum`). ✅

**Placeholder scan:** no TBD/TODO; every behavior has a concrete decision.

**Type/field consistency:** field names mirror DB/TS naming (`documentId`, `minDocuments`, `maxDocuments`, `required`, `weight`, `role`, `hidden`, `discoveryMethod`, `priority`, `conditions`, `version`, `templateVersion`, `caseTemplateId`), matching Phase 6/7 conventions and `shared-types` `CaseDocument`/`Case`.

---

## Conclusion

TODO Phase 9 ("DOCUMENT GENERATION") resolves cleanly through the append-only pattern established in Phases 6–8:

1. `case_documents` is the **Case Document Pool** — the relation is the pool, per audit R1. No `case_document_pool` table is required.
2. Every TODO §9 checklist capability — required, optional, hidden, fake, decoy, case-specific — maps to existing `case_documents` columns (`required`, `weight`, `role`, `hidden`, `discovery_method`).
3. **No migration is required** — `case_documents` (0012), `cases.min_documents`/`max_documents` (0016), and the global `documents` entity (0005) fully support deterministic selection.
4. The design proposes an extension of the shared selection algorithm (`selectDocuments` in `packages/game-rules`) — the only genuinely _new_ implementation work, which, like Phases 6–7, is a pure, version-pinned, seeded generator.
5. Character document assignment, per-character pools, and location document consumption are explicitly **deferred**; conditions remain opaque until Phase 11; Case Instance/document runtime state remains Phase 14.
