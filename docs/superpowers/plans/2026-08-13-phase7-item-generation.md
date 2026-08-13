# Phase 7 — Item Generation Design

> **Status:** DESIGN — approved; implemented in `@gate8/game-rules` (pure `selectItems` over a version-pinned `case_items` snapshot). This document specifies the item-generation system and the module/API boundary. No database, migration, shared-types, content-schema, Admin UI, or Mobile UI changes in this phase.

**Goal:** Design how a Case Template deterministically generates its actual Item set from the existing canonical relation `case_items`, using the existing `cases.min_items`/`max_items` bounds and the per-row `min_quantity`/`max_quantity`/`hidden`/`discovery_method` configuration — without creating pool tables, duplicate relations, case instances, a generator implementation, or any database change.

**Architecture:** The selection algorithm is a pure, deterministic domain operation. It consumes a version-pinned content snapshot (template + relation rows) and a seed; it never touches the database, Supabase, HTTP, UI, or AI. It reuses the Phase 6 PRNG (`cyrb128` + `mulberry32`). The natural home is `packages/game-rules` (generation is a game rule). Phase 7 designs and specifies; Phase 12/14 wires it into the seeded pipeline and Case Instance.

**Tech Stack:** TypeScript (pure functions), the existing seeded PRNG (Phase 6, dependency-free), `packages/game-rules` for the algorithm + types.

## Global Constraints (Phase 7)

- `case_items` is the **canonical** relation and the single source of truth for per-item selection and instance configuration. `cases.min_items`/`max_items` are the single source of truth for the **distinct-item-type** count bounds.
- No `case_item_pool` table. (TODO §8 is satisfied by `case_items`, per audit decision R1 — the relation is the pool.) No other separate item pool table, ever.
- `case_items.min_quantity`/`max_quantity` are per-item-type **physical quantity** bounds; they never feed the distinct-item count.
- Per-character item limits already live on `case_characters.min_items`/`max_items` and are **NOT** duplicated or consumed by Phase 7 (see §13).
- No case instance tables, no generator implementation, no rule engine, no AI, no Admin UI, no Mobile UI.
- Deterministic: same (template, published version, seed) ⇒ same item set (distinct types, quantities, ordering). Different seeds ⇒ may differ.
- Prefer deterministic explicit errors over silent fallback. Invalid configurations are caught at **publish time** (Phase 26) and defensively re-checked by the generator.
- `hidden` and `discovery_method` are carried through to the generated item **unchanged**; they are instance state, not selection inputs.

---

## 1. Sources of Truth (current schema — sufficient)

From migration `0012` (`case_items`) — **unchanged**:

| Column             | Type    | Constraint                          | Role in generation                                |
| ------------------ | ------- | ----------------------------------- | ------------------------------------------------- |
| `item_id`          | uuid FK | RESTRICT, UNIQUE(case_id, item_id)  | which item; duplicate prevention is structural    |
| `required`         | bool    | NOT NULL                            | must always be selected                           |
| `weight`           | numeric | NOT NULL, CHECK (weight >= 0)       | optional-selection probability                    |
| `min_quantity`     | int     | NOT NULL, CHECK (min_quantity >= 0) | per-type physical quantity lower bound (§3)       |
| `max_quantity`     | int     | NOT NULL, CHECK (max_quantity >= 0) | per-type physical quantity upper bound (§3)       |
| `hidden`           | bool    | NOT NULL                            | initial visibility of the generated instance item |
| `discovery_method` | text    | NULL allowed (free text, R4)        | discovery configuration carried to the instance   |
| `priority`         | int     | NOT NULL DEFAULT 0                  | deterministic ordering (defined §9)               |
| `conditions`       | jsonb   | NOT NULL DEFAULT '[]'               | deferred to Phase 11 (§8)                         |
| `version`          | int     | NOT NULL                            | version pinning (§10)                             |

Note: `case_items` has **no `role` column** (unlike `case_characters`). The output model therefore carries no role (§11).

From migration `0016` (`cases`) — **unchanged**:

| Column      | Constraint | Role                                             |
| ----------- | ---------- | ------------------------------------------------ |
| `min_items` | CHECK >= 0 | distinct-item-type lower bound; `0` = no minimum |
| `max_items` | CHECK >= 0 | distinct-item-type upper bound; `0` = no maximum |
| `version`   | NOT NULL   | template version pin (§10)                       |

**Verdict: the Phase 2–5 schema fully supports item generation. No migration required for Phase 7.** `case_items` already carries the full selection + instance configuration, and `cases.min_items`/`max_items` carry the distinct-item-type count bounds.

---

## 2. Item Selection Count (distinct item types)

`cases.min_items`/`max_items` control the number of **distinct Item entities (types)** selected into the generated case item set.

```
min_items = 3, max_items = 6
Pool: Item A, Item B, Item C, Item D, Item E  (|E| = 5)

target ∈ {3, 4, 5}   — capped by the pool, not 6
```

- **Lower bound** `lower = max(min_items, |R|)` — never fewer than the required item types.
- **Upper bound** `upper = max_items > 0 ? min(max_items, |E|) : |E|` — `0` = no upper bound (Phase 5 convention), resolved to the eligible pool size; a positive `max_items` is capped by the eligible pool size (corrected Phase 6 semantics; no `PoolBelowMaximum` failure).
- **Target** `target = lower + prng.int(upper - lower + 1)` — one seeded draw, uniform, inclusive.

Each selected row is one distinct item type. The generator selects **distinct `item_id`s only** (structural `UNIQUE(case_id, item_id)` + selection bookkeeping); no item type is ever duplicated in the output.

**The count is a count of item types, never a count of physical copies.** Physical quantity is governed by per-row `min_quantity`/`max_quantity` (§3, §14).

---

## 3. Quantity Semantics (per selected item type)

Each selected item type carries a physical quantity drawn deterministically from its own `[min_quantity, max_quantity]` range.

### 3.1 Effective quantity bounds

The DB permits `0` (CHECK >= 0) and Phase 5 established `0 = no bound` for the min/max columns. Applied to quantity:

```
effectiveMin = max(min_quantity, 1)
effectiveMax = max_quantity > 0 ? max_quantity : effectiveMin
quantity     = effectiveMin + prng.int(effectiveMax - effectiveMin + 1)
```

A selected item type always has **at least one physical copy** — quantity `0` is never generated. A row that is not selected (optional, not drawn) contributes no copies at all; quantity is only generated for selected rows.

| `min_quantity` | `max_quantity` | Generated quantity | Meaning                                                        |
| -------------- | -------------- | ------------------ | -------------------------------------------------------------- |
| 0              | 0              | exactly 1          | unset default ⇒ single copy                                    |
| 0              | 3              | 1..3               | no minimum ⇒ floor at 1                                        |
| 2              | 5              | 2..5               | full range                                                     |
| 2              | 2              | exactly 2          | fixed quantity (`min = max`)                                   |
| 2              | 0              | exactly 2          | no upper bound ⇒ fixed at effective minimum                    |
| 5              | 2              | **error**          | `InvalidQuantityBounds`                                        |
| negative       | any            | **error**          | `InvalidQuantityBounds` (DB CHECK already prevents; defensive) |

- **`min_quantity = max_quantity`** — deterministic fixed quantity (zero draws consumed beyond the draw contract, see below; the draw still consumes one PRNG integer for the single value).
- **`min_quantity > max_quantity`** (both bounded) — `InvalidQuantityBounds` (§12). Invalid at publish (Phase 26) with a generator backstop, exactly like `min_items > max_items`.
- **Negative** — impossible at the DB (`CHECK (min_quantity >= 0)`, `CHECK (max_quantity >= 0)`); the generator defensively rejects a snapshot carrying negatives.
- **Zero quantity output** — never generated (§3.1). The `0` on `min_quantity` means "no minimum" (per the Phase 5 nonnegativity-only convention), not "zero copies"; a zero-copy item type is simply not selected at all.
- Zero-weight-optional rows, hidden rows, and rows with a `discovery_method` are **not** exempt: if selected, they receive a normal quantity draw.

### 3.2 Quantity is generated after selection

Quantity draws happen **after the complete item set is selected** (choice B in the review question), in canonical output order (`priority ASC, item_id ASC`). Justification:

1. **Separation of concerns** — the selection phase becomes structurally identical to Phase 6 character selection, so the distinct-item set is provably independent of quantity configuration. Changing a row's quantity bounds never changes which items are selected (or the count).
2. **Simple, fixed stream layout** — count draw first, then selection draws, then quantity draws. The stream shape does not depend on interleaving, so the contract is easy to specify, implement, and regression-test.
3. **Deterministic** — the same seed + snapshot yields the same count, the same picks, and the same quantities regardless of ordering choice; this ordering is simply the chosen contract.

---

## 4. Required Items

`required = true` ⇒ the item type is selected unconditionally and always present in the output, regardless of weight, priority, conditions, hidden, or seed. Required items count against `max_items` and against the distinct-item count.

| Situation                                                                 | Resolution                                                                                                  |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `required count > max_items` (bounded)                                    | `RequiredExceedsMax` — publish-time validation (Phase 26) + generator backstop; never satisfiable otherwise |
| `required count > eligible pool`                                          | `PoolBelowMinimum` — pool smaller than the required set; invalid template                                   |
| required item with invalid quantity range (`min_quantity > max_quantity`) | `InvalidQuantityBounds` — quantity bounds are validated per row, independent of `required`                  |

A required item with `weight = 0` is still selected (weight governs optional selection only, §5). A required item's quantity is drawn exactly like any selected item (§3.2).

---

## 5. Weighted Random (deterministic)

Identical conceptual model to Phase 6:

```
p(X) = weight(X) / Σ weight(eligible optional rows)
```

Sampling **without replacement** — after each pick the row is removed and remaining weights re-normalize. Weighted pick: `draw = prng.float() * Σweight`; select the first row (canonical `(priority ASC, item_id ASC)` order) whose cumulative weight exceeds `draw`.

| Case                                    | Behavior                                                                                                  |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `weight = 0`                            | Excluded from optional selection. Only selectable if `required = true`.                                   |
| all optional `weight = 0`               | `InsufficientPool` if `target > \|R\|`; succeeds with exactly `\|R\|` items if `target = \|R\|`.          |
| required with `weight = 0`              | Still selected (required wins).                                                                           |
| insufficient positive-weight candidates | `InsufficientPool` — while `\|selected\| < target`, `O'` empty ⇒ deterministic error. No silent fallback. |
| negative / non-finite `weight`          | Impossible at DB (`CHECK (weight >= 0)`); generator defensively rejects (`InvalidWeight`).                |

No new columns; existing CHECK constraints and types are respected and relied upon.

---

## 6. Hidden

`hidden` is **generated item instance state**, not a selection input.

- `hidden` does **NOT** mean excluded from generation — a hidden row participates in selection exactly like any other (weighted, required, etc.).
- `hidden` does **NOT** mean zero weight and does **NOT** mean unavailable.
- `hidden` determines whether the generated item is **initially visible to the player** in the future Case Instance.

Phase 7 propagates the row's `hidden` boolean unchanged into the generated item output (§11). No runtime modeling is needed in the template — `hidden` is already a `NOT NULL` column on `case_items`. The future Case Instance (Phase 14) preserves it by copying the generated item's `hidden` value into its item-state record; changing visibility later is instance/runtime behavior, never template or generation behavior.

---

## 7. Discovery Method

`case_items.discovery_method` is **free text** (`text`, nullable, R4). It is **not** an enum by design — the architecture intentionally keeps content-defined values flexible, and Phase 7 does not invent an enum.

- Phase 7 does **not** implement discovery mechanics (no discovery probability, no unlock rules, no inventory logic).
- The generated item **carries its discovery configuration** into the future Case Instance: `discoveryMethod` is copied through unchanged (`string | null`).
- A `NULL` `discovery_method` means "no special discovery config" and is preserved as `null`.

---

## 8. Conditions

Identical treatment to Phase 6:

```
CONTENT (case_items.conditions, opaque JSONB)
  ↓
future eligibility evaluation (Phase 11 rule engine)
  ↓
eligible item pool E
  ↓
deterministic selection (Phase 7 algorithm)
```

- **Phase 7 treatment: ignored.** All pool rows are eligible; `conditions` are not evaluated.
- This is an explicit, documented decision. The generator input includes `conditions` as opaque payloads and the algorithm exposes an optional **eligibility filter** extension point (`eligibilityFilter?: (candidate) => boolean`, §16). When the Phase 11 rule engine ships, a caller-provided predicate may narrow `E`; without it, all rows are eligible — behavior identical to Phase 7.
- No condition semantics are invented now.

---

## 9. Seeded Determinism and Draw Sequence

**Deterministic input tuple:**

```
(case_template_id, template version, seed, snapshot of cases + case_items at that version)
```

Same tuple ⇒ identical output. The generator is a pure function: `f(template, relations, seed) → result`. The seed is opaque to the algorithm (a string normalized by the Phase 6 PRNG); Phase 14 stores it on the Case Instance.

**Draw sequence (part of the generator contract — regression tested):**

```
draw #1   → item target count        (prng.int(upper - lower + 1))
draw #2.. → one weighted pick per optional slot   (prng.float() each)
then      → one quantity draw per selected item, in canonical output order
            (priority ASC, item_id ASC)          (prng.int(range))
```

The PRNG source is the **existing** Phase 6 `createSeededRandom(seed)` (`cyrb128` string hash → `mulberry32`). No second random implementation. Changing the algorithm or draw order changes all output, so reference values are pinned in regression tests at implementation time (mirroring Phase 6's `case-demo-seed-123`).

---

## 10. Version Pinning

- `cases.version` is the template's content version. `case_items.version` is the relation row version, which **must equal the template version it belongs to** (R2: relations version with their parent).
- The generator **never mixes versions**: it requires a snapshot where every `case_items` row's `version` equals the template's `version`. A single mismatch ⇒ `VersionMismatch` (§12).
- The published template version pins the generation contract; generate against the pinned version only. Rationale: never generate from `cases.version N` + `case_items.version N+1`.

---

## 11. Output Model

A generated item carries **the relation's instance-relevant configuration** — enough for the future Case Instance without copying the global `items` entity content (name, category, rarity, etc. resolve by `itemId`).

```ts
interface GeneratedItem {
  itemId: string;
  quantity: number; // physical copies, ≥ 1
  hidden: boolean; // initial visibility (instance state)
  discoveryMethod: string | null; // free text, carried unchanged
}
```

- Output is **canonically ordered** `(priority ASC, item_id ASC)` — the array order preserves authoring order (consistent with Phase 6, which also omits `priority` from the output type).
- **No `role`** — `case_items` has no such column (unlike `case_characters`). No field is invented that does not exist in the source model.
- `weight`, `required`, `priority`, `conditions`, `version` are not copied into the output: they are selection/ordering/validation config, not instance state.

---

## 12. Failure Modes (deterministic, explicit errors)

| Condition                                                           | Error                   | Layer                                              |
| ------------------------------------------------------------------- | ----------------------- | -------------------------------------------------- |
| `required > max_items`                                              | `RequiredExceedsMax`    | publish validation (Phase 26) + generator backstop |
| `pool size < min_items`                                             | `PoolBelowMinimum`      | publish validation + generator backstop            |
| no eligible items (`\|E\| = 0`)                                     | `NoEligibleItems`       | generator                                          |
| all optional `weight = 0` + target > `\|R\|`                        | `InsufficientPool`      | generator                                          |
| negative / non-finite weight in snapshot                            | `InvalidWeight`         | generator (defensive; DB CHECK prevents)           |
| `min_items > max_items` (bounded), or any negative bound            | `InvalidBounds`         | publish validation + generator backstop            |
| `min_quantity > max_quantity` (bounded), or negative quantity bound | `InvalidQuantityBounds` | publish validation + generator backstop            |
| relation `version` ≠ template `version`                             | `VersionMismatch`       | generator                                          |
| duplicate `item_id` in snapshot                                     | `DuplicateItem`         | generator (defensive; UNIQUE prevents)             |
| `conditions` eliminate all rows (post-Phase 11)                     | `NoEligibleItems`       | generator                                          |

**Error-by-error necessity review:**

- `InvalidBounds` — kept: `min_items > max_items` and negative bounds are structural template errors.
- `PoolBelowMinimum` — kept: required/configured floor cannot be met by the pool.
- `RequiredExceedsMax` — kept: a required set that cannot fit the upper bound is an invalid template.
- `NoEligibleItems` — kept: an empty (or fully condition-eliminated) pool.
- `InsufficientPool` — kept: target demands more positive-weight optional types than remain.
- `InvalidWeight` — kept: defensive; DB CHECK already prevents it.
- `InvalidQuantityBounds` — **new** for Phase 7: quantity is item-specific and can be invalid even when the item-count bounds are fine.
- `DuplicateItem` — kept: defensive; `UNIQUE(case_id, item_id)` prevents it.
- `VersionMismatch` — kept: version pinning is mandatory (§10).

**Not kept / not added:**

- `PoolBelowMaximum` — **no such error**, following the corrected Phase 6 semantics: a pool smaller than `max_items` merely narrows the generated range.
- No hidden/discovery errors — those fields are passive instance state, not constraints.

---

## 13. Interaction with Character Generation

Item Generation (Phase 7) is **independent** of Character Generation (Phase 6):

- It generates the **global case item set** from `case_items` + `cases.min_items`/`max_items`.
- It does **not** consume character output, does **not** depend on selected characters, and is not gated by them.
- Per-character item limits (`case_characters.min_items`/`max_items`) are **NOT** consumed or duplicated here.

**Choice A vs B:** Phase 7 implements **A — global case item set only**. The later assignment stage (**B**):

```
Character Selection (Phase 6)
    ↓
Global Item Selection (Phase 7)
    ↓
Item Assignment to Characters   ← deferred
```

is explicitly **DEFERRED** to a later phase (the future per-character item-generation work described in TODO §7 / §12.3). Phase 7 does not assign items to characters, and TODO §7's `character_item_pool` (per-character item limits/pools) is a separate, later design — it is **not** created here and does not alter the Phase 7 global set. Phase 7 output is the complete case item set; assignment to characters (and any per-character bounds interplay) is out of scope until the deferred phase.

---

## 14. Distinct Item Types vs Physical Quantity (critical distinction)

| Source                                   | Meaning                                     | Used for                    |
| ---------------------------------------- | ------------------------------------------- | --------------------------- |
| `cases.min_items`/`max_items`            | **number of distinct item types** selected  | target-count draw (§2)      |
| `case_items.min_quantity`/`max_quantity` | **physical quantity of each selected type** | per-type quantity draw (§3) |

**They are never conflated.** The distinct-item count is computed from `case_items` rows and `cases.min_items`/`max_items` only; per-row quantity bounds never influence which (or how many) types are selected.

Worked example:

```
Case: min_items = 2, max_items = 4

case_items:
  Handgun  required=false  min_quantity=1  max_quantity=1
  Passport required=false  min_quantity=2  max_quantity=3
  Phone    required=false  min_quantity=1  max_quantity=2

Selected: Handgun (qty 1), Passport (qty 3), Phone (qty 2)

Distinct items          = 3   (from cases.min_items/max_items + selection)
Total physical count    = 1 + 3 + 2 = 6   (sum of per-type quantities)
```

`3 ≠ 6`: distinct types and physical copies are different numbers. The generator never uses the total physical count (6) to compute or validate the item count (3).

---

## 15. Empty / Unlimited Semantics

Phase 5 convention: `max = 0` means "no upper bound". Applied to `cases.max_items`:

```
effectiveUpper = max_items > 0 ? min(max_items, |E|) : |E|
```

- `max_items = 0` (unbounded) ⇒ upper = eligible pool size. **No `PoolBelowMaximum` error** (a pool smaller than `max_items` is valid and simply narrows the range; the range is computed against `effectiveUpper`).
- `min_items = 0` ⇒ lower = `|R|` (required items). If `min_items = 0` and `|R| = 0`, `lower = 0` — a template may generate an empty item set (Phase 13 adds solvability/at-least-one-item game rules; a schema concern for later phases, not Phase 7).

| Pool | min_items | max_items | effective range | Note                              |
| ---- | --------- | --------- | --------------- | --------------------------------- |
| 10   | 2         | 5         | 2..5            | pool is not the limit             |
| 3    | 2         | 5         | 2..3            | capped by pool                    |
| 2    | 2         | 5         | exactly 2       | capped by pool                    |
| 1    | 2         | 5         | error           | `PoolBelowMinimum`                |
| 3    | 4         | 5         | error           | `PoolBelowMinimum`                |
| 3    | 1         | 0         | 1..3            | `0` = no upper bound              |
| 0    | 0         | 0         | exactly 0       | empty item set, allowed           |
| 3    | 2         | 2         | exactly 2       | required=3 → `RequiredExceedsMax` |

---

## 16. Proposed Module / API Boundary (design only — no implementation)

Package: `packages/game-rules`, reusing the Phase 6 `prng.ts`. Proposed structure (NOT created in Phase 7):

```
packages/game-rules/src/generation/
  item-selection.ts   — pure selectItems(...)
  quantity.ts         — quantity bounds + drawQuantity(...)
  item-errors.ts      — ItemSelectionError discriminated union
  item-types.ts       — ItemSelectionCandidate / ItemSelectionInput / GeneratedItem / result types
  prng.ts             — reused from Phase 6 (unchanged)
```

Proposed API (sketch — informational):

```ts
interface ItemSelectionCandidate {
  itemId: string;
  required: boolean;
  weight: number;
  minQuantity: number;
  maxQuantity: number;
  hidden: boolean;
  discoveryMethod: string | null;
  priority: number;
  conditions: unknown[]; // opaque in Phase 7
  version: number;
}

interface ItemSelectionInput {
  caseTemplateId: string;
  templateVersion: number;
  minItems: number; // distinct item types; 0 = no minimum
  maxItems: number; // distinct item types; 0 = no maximum
  items: ItemSelectionCandidate[];
  seed: string;
  // Phase 11 extension point:
  eligibilityFilter?: (candidate: ItemSelectionCandidate) => boolean;
}

type ItemSelectionResult =
  | {
      ok: true;
      items: GeneratedItem[]; // { itemId, quantity, hidden, discoveryMethod }
      caseTemplateId: string;
      templateVersion: number;
      seed: string;
    }
  | { ok: false; error: ItemSelectionError };

declare function selectItems(input: ItemSelectionInput): ItemSelectionResult;
```

The function is pure, synchronous, typed, and fully unit-testable with no external dependencies. Phase 12/14 load the version-pinned snapshot and call it, storing the seed + result on the Case Instance.

---

## 17. Test Strategy (design only — no implementation)

Deterministic unit tests (in `packages/game-rules`, Phase 7 implementation):

| #   | Test                             | Asserts                                                                 |
| --- | -------------------------------- | ----------------------------------------------------------------------- |
| 1   | min/max item count               | count ∈ [min_items, effectiveUpper]                                     |
| 2   | max_items > pool                 | succeeds; count capped at `\|E\|`                                       |
| 3   | max_items = 0                    | unbounded ⇒ upper = `\|E\|`                                             |
| 4   | required item                    | required id always present                                              |
| 5   | multiple required items          | all required ids present; lower = `\|R\|`                               |
| 6   | required > max                   | returns `RequiredExceedsMax`                                            |
| 7   | pool < minimum                   | returns `PoolBelowMinimum`                                              |
| 8   | weighted selection               | statistical check: higher weight selected more often across seeds       |
| 9   | weight = 0                       | zero-weight optional never picked (unless required)                     |
| 10  | all optional weights = 0         | `InsufficientPool` when target > `\|R\|`; succeeds with exactly `\|R\|` |
| 11  | duplicate prevention             | no duplicate itemId in output; `DuplicateItem` on duplicate snapshot    |
| 12  | same seed ⇒ same result          | two calls, same input, equal output (types + quantities + order)        |
| 13  | different seeds can differ       | at least one differing output across seeds                              |
| 14  | quantity min/max                 | quantity ∈ [effectiveMin, effectiveMax] for every selected item         |
| 15  | fixed quantity                   | `min_quantity = max_quantity` ⇒ always that exact value                 |
| 16  | invalid quantity bounds          | `min_quantity > max_quantity` ⇒ `InvalidQuantityBounds`                 |
| 17  | zero quantity (per schema)       | quantity never 0; unset (0,0) ⇒ exactly 1; min=0,max=3 ⇒ 1..3           |
| 18  | hidden propagation               | output `hidden` equals row `hidden` for every selected item             |
| 19  | discovery_method propagation     | output `discoveryMethod` equals row value incl. `null`                  |
| 20  | version mismatch                 | relation version ≠ template version ⇒ `VersionMismatch`                 |
| 21  | conditions remain unevaluated    | all rows eligible when no filter; opaque conditions don't affect output |
| 22  | target count never exceeds pool  | `                                                                       | output | ≤   | E   | ` for all seeds |
| 23  | total physical quantity not used | changing per-row quantity bounds never changes which types/count select |
| 24  | deterministic draw ordering      | regression test pins the exact reference (count, picks, quantities)     |

**Property-based tests** — reuse the Phase 6 approach: templates generated deterministically from an independent LCG (no new dependency, matching `invariants.test.ts`). Invariants across random templates + seeds: distinct item IDs, selected count within `[lower, effectiveUpper]`, required always selected, quantity within bounds, same-seed determinism, and selection independence from quantity config.

---

## 18. Database Changes

The Phase 2–5 schema is fully sufficient: `case_items` carries weight/required/min_quantity/max_quantity/hidden/discovery_method/conditions/priority/version with `UNIQUE(case_id, item_id)` (migration `0012`), `cases` carries `min_items`/`max_items` (migration `0016`), and `items` is the global entity (migration `0004`). TODO §8's `case_item_pool` is satisfied by `case_items` (audit R1) — no pool table.

**No migration required for Phase 7.** No new columns, tables, constraints, or types are introduced. No schema change is needed to make implementation easier.

---

## 19. Risks

| Risk                                              | Mitigation                                                                                                  |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Distinct-item count conflated with physical count | §14 documents the distinction explicitly; test #23 pins selection independence from quantity config         |
| `0` on quantity misread as "zero copies"          | §3.1: `0` = no bound (Phase 5 convention); a selected type always has ≥ 1 copy; test #17                    |
| Interleaving quantity draws into selection        | Rejected: quantity draws follow the complete selection (§3.2), keeping selection Phase-6-identical          |
| Copying Phase 6 blindly (items ≠ characters)      | Item-specific fields (quantity/hidden/discovery) explicitly designed (§3, §6, §7); no `role` invented (§11) |
| Free-text `discovery_method` drift                | Content-defined by design (R4); carried through unchanged (§7)                                              |
| Per-character limits duplicated or consumed here  | Explicitly out of scope (§13); assignment deferred to a later phase                                         |
| Min/max impossible ranges                         | Deferred to Phase 26 publish validation (consistent with Phase 3/5/6 nonnegativity-only checks)             |

---

## 20. Explicitly Deferred Features

- Case Instance model (`case_instances`) — Phase 14.
- Seeded generator wiring / random generation engine — Phase 12.
- Rule/condition engine — Phase 11.
- Item assignment to characters — later phase (§13, choice B deferred).
- Per-character item pools (`character_item_pool`) — TODO §7, later design; not created here.
- Discovery mechanics (probabilities, unlock rules, inventory) — future, not Phase 7.
- Duplicate pool tables (`case_item_pool`, etc.) — never; `case_items` is canonical.
- Admin UI / Mobile UI / AI — never in this phase.

---

## Self-Review

**Spec coverage:** all 19 design questions resolved — count semantics (§2), quantity semantics + draw ordering with justification (§3), required behavior incl. all three edge cases (§4), weight model incl. all edge cases (§5), hidden (§6), discovery method free-text philosophy (§7), conditions eligibility extension (§8), deterministic seed + exact draw sequence (§9), version pinning (§10), output model with no invented fields (§11), all 9 failure modes with a necessity review (§12), character interaction with deferred assignment (§13), distinct-vs-physical count distinction (§14), empty/unlimited semantics with no `PoolBelowMaximum` (§15), module boundary reusing Phase 6 PRNG (§16), 24-test strategy + property tests with no new dependency (§17), no-migration verdict (§18), risks (§19), deferred features (§20).
**Placeholder scan:** no TBD/TODO; every behavior has a concrete decision.
**Type consistency:** field names mirror the DB/TS naming (`minItems`, `maxItems`, `minQuantity`, `maxQuantity`, `itemId`, `hidden`, `discoveryMethod`, `priority`, `conditions`, `version`, `templateVersion`, `caseTemplateId`), matching Phase 6 conventions and `shared-types` `CaseItem`/`Case`.
