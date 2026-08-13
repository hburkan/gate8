# Phase 6 — Character Generation Design

> **Status:** DESIGN — approved; implemented in `@gate8/game-rules` (commit `ddf630d`). This document specifies the character-selection system and the module/API boundary. `max_characters` semantics: capped by pool size — see §2.1.1. No database, migration, shared-types, content-schema, Admin UI, or Mobile UI changes in this phase.

**Goal:** Design how a Case Template deterministically generates its actual Character set from the existing canonical relation `case_characters`, using the existing `cases.min_characters`/`max_characters` bounds — without creating pool tables, duplicate relations, case instances, a generator implementation, or any database change.

**Architecture:** The selection algorithm is a pure, deterministic domain operation. It consumes a version-pinned content snapshot (template + relation rows) and a seed; it never touches the database, Supabase, HTTP, UI, or AI. The natural home is `packages/game-rules` (generation is a game rule). Phase 6 designs and specifies; Phase 12/14 wires it into the seeded pipeline and Case Instance.

**Tech Stack:** TypeScript (pure functions), seeded PRNG (small, dependency-free), `packages/game-rules` for the algorithm + types.

## Global Constraints (Phase 6)

- `case_characters` is the **canonical** relation and the single source of truth for per-character selection config. `cases.min_characters`/`max_characters` are the single source of truth for the count bounds.
- No `case_character_pool` table. (TODO §6.1 is satisfied by `case_characters`, per audit decision R1 — the pool is the relation.)
- No case instance tables, no generator implementation, no rule engine, no AI, no Admin UI, no Mobile UI.
- Deterministic: same (template, published version, seed) ⇒ same selection. Different seeds ⇒ may differ.
- Prefer deterministic explicit errors over silent fallback. Invalid configurations are caught at **publish time** (Phase 26) and defensively re-checked by the generator.

---

## 1. Sources of Truth (current schema — sufficient)

From migration `0012` (`case_characters`) — **unchanged**:

| Column         | Type    | Constraint                              | Role in generation                                  |
| -------------- | ------- | --------------------------------------- | --------------------------------------------------- |
| `character_id` | uuid FK | RESTRICT, UNIQUE(case_id, character_id) | which character; duplicate prevention is structural |
| `required`     | bool    | NOT NULL                                | must always be selected                             |
| `weight`       | numeric | NOT NULL, CHECK (weight >= 0)           | optional-selection probability                      |
| `min_items`    | int     | NOT NULL, CHECK (min_items >= 0)        | Phase 7 (character item limits), not Phase 6        |
| `max_items`    | int     | NOT NULL, CHECK (max_items >= 0)        | Phase 7, not Phase 6                                |
| `role`         | text    | NULL allowed                            | generation metadata carried through to the instance |
| `priority`     | int     | NOT NULL DEFAULT 0                      | deterministic ordering (defined §7)                 |
| `conditions`   | jsonb   | NOT NULL DEFAULT '[]'                   | deferred to Phase 11 (§8)                           |
| `version`      | int     | NOT NULL                                | version pinning (§9)                                |

From migration `0016` (`cases`) — **unchanged**:

| Column           | Constraint | Role                          |
| ---------------- | ---------- | ----------------------------- |
| `min_characters` | CHECK >= 0 | lower bound; `0` = no minimum |
| `max_characters` | CHECK >= 0 | upper bound; `0` = no maximum |
| `version`        | NOT NULL   | template version pin (§9)     |

**Verdict: the Phase 2–5 schema fully supports character selection. No migration required for Phase 6.**

---

## 2. Character Selection Semantics

Definitions used throughout:

- **Pool** — the set of `case_characters` rows for a case, ordered canonically by `(priority, character_id)` (§7).
- **Required set R** — rows with `required = true`.
- **Optional set O** — rows with `required = false`.
- **Eligible** — a row that may be selected. In Phase 6 all pool rows are eligible (§8 conditions are ignored until Phase 11).
- **Target count** — the number of characters the template wants for this generation.

### 2.1 `min_characters` / `max_characters` (count semantics)

`min_characters = 2, max_characters = 4` means: **generate a random target count drawn uniformly from the inclusive interval `[lower, upper]`**, then select that many characters from the eligible pool.

`min_characters` and `max_characters` are the **minimum and maximum number that may be generated** — they are **not** pool-size requirements. A pool smaller than `max_characters` is valid: the effective upper bound is capped by the eligible pool.

- `lower = max(min_characters, |R|)` — you can never select fewer than the required count.
- `upper = max_characters > 0 ? min(max_characters, |E|) : |E|` — `0` means "no upper bound" (Phase 5 convention), resolved to the pool size; a positive `max_characters` is capped by the eligible pool size.
- `target = lower + prng.int(0, upper - lower)` — one seeded draw from a uniform integer distribution.

**Precise algorithm:**

1. **Snapshot & validate** — the caller passes a version-pinned snapshot (§9). Validate: template present; all relation rows carry `version == template.version`; no duplicate `character_id`; every `weight >= 0`; `min_characters >= 0`, `max_characters >= 0`. Any violation ⇒ deterministic error (§10).
2. **Compute bounds** — `R`, `O`, `lower`, `upper` as above. If `lower > upper` ⇒ error (§10, cases: `required > max`, `pool < min`).
3. **Draw target count** — `target = lower + prng.int(upper - lower + 1)` (uniform, inclusive).
4. **Select required** — every member of `R` is selected unconditionally.
5. **Select optional to fill** — while `|selected| < target`:
   - Let `O'` = members of `O` not yet selected **with `weight > 0`** (§6.4: zero-weight rows are not selectable as optional).
   - If `O'` is empty ⇒ error "insufficient pool" (§10).
   - Pick one member of `O'` via weighted draw (§6), remove it from `O`, append to selected.
6. **Order output** — sort selected by `(priority, character_id)` (stable, deterministic).
7. **Return** — `{ characters: [{ characterId, role }], seed, templateVersion, caseTemplateId }`.

**Seed participation:** the PRNG stream is consumed in a fixed order — draw 1 for the target count, then one draw per optional pick. The same seed reproduces the same count and the same picks. (§6.3, §11.)

### 2.1.1 Effective upper bound is capped by the pool

Because `max_characters` caps the _generated count_ (not the _pool size_), the effective upper bound used for the target draw is:

```
effectiveUpper = max_characters > 0 ? min(max_characters, |E|) : |E|
```

| Pool | min | max | effective range | Note                                                       |
| ---- | --- | --- | --------------- | ---------------------------------------------------------- |
| 10   | 2   | 5   | 2..5            | pool is not the limit                                      |
| 3    | 2   | 5   | 2..3            | capped by pool                                             |
| 2    | 2   | 5   | exactly 2       | capped by pool                                             |
| 1    | 2   | 5   | error           | `PoolBelowMinimum`                                         |
| 3    | 4   | 5   | error           | `PoolBelowMinimum`                                         |
| 3    | 1   | 5   | 1..3            | pool < max is valid                                        |
| 2    | 0   | 0   | 0..2            | `0` = no upper bound                                       |
| 3    | 2   | 2   | exactly 2       | required=3 → `RequiredExceedsMax` only when required > max |

There is **no `PoolBelowMaximum` failure**: a pool smaller than `max_characters` simply narrows the generated range. `PoolBelowMinimum` (pool < min) and `RequiredExceedsMax` (required > max) remain failures.

### 2.2 Concrete example (spec)

```
Case: min_characters = 2, max_characters = 4

Mehmet  required = true   weight = 100
Ayşe    required = false  weight = 50
John    required = false  weight = 20
Laura   required = false  weight = 10
```

- `R = { Mehmet }`, `O = { Ayşe, John, Laura }`, `|E| = 4`.
- `lower = max(2, 1) = 2`; `upper = 4`.
- `target = 2 + prng.int(3)` ⇒ `2`, `3`, or `4` (uniform).
- **Mehmet is always selected** (required).
- Optional slots filled by weighted draw: Ayşe 50/80, John 20/80, Laura 10/80 per pick (weights normalized against eligible optional only).
- Possible outputs: `{Mehmet, Ayşe}`, `{Mehmet, Ayşe, Laura}`, `{Mehmet, John, Ayşe, Laura}`, etc. — Mehmet always present, never duplicated.

---

## 3. Required Semantics

- `required = true` ⇒ the character is selected unconditionally and always present in the output, regardless of weight, priority, conditions (Phase 6), or seed.
- Required characters count against `max_characters`.

### 3.1 `required > max_characters`

```
max_characters = 2
Required: Mehmet, Ayşe, John   (|R| = 3)
```

This template can never be satisfied: `lower = max(min, 3) = 3 > upper = 2`.

**Decision — this is a PUBLISH-TIME validation rule (Phase 26), with a defensive generator error as a backstop:**

1. **Primary: publish-time validation.** Before a template may enter `published`, Phase 26 validation must reject any configuration where `|R| > max_characters` (when `max_characters > 0`), or `|E| < min_characters`, or `|E| < max_characters` (when bounded). Invalid templates are caught **before runtime** — this is the preferred layer, per the instruction.
2. **Backstop: generator-time error.** Because Phase 14 instances may reference already-published content or snapshots from older versions, the pure generator re-validates its input and returns a deterministic `Error` rather than silently emitting an impossible set. No silent fallback.

The same rule (reject before runtime) applies to `min_characters > |E|` and `max_characters > |E|`.

---

## 4. Min/Max Semantics (formal)

`min_characters = 2, max_characters = 4` ⇒ **"generate exactly a random number between 2 and 4 inclusive, then select that many"** — yes, with the required-set floor applied:

- If `min_characters = 0` and `|R| = 0`, `lower = 0` — a template may generate zero characters (Phase 13 adds the "at least one suspect" game rule; that is a Phase 13 concern, not a Phase 6 schema concern).
- The count draw is **uniform** over `[lower, upper]`; there is no weighting of the count itself.
- Selection of individual characters never exceeds `target` (loop guard) and never duplicates a character (structural UNIQUE + selection-set bookkeeping).

---

## 5. Weighted Random (deterministic)

### 5.1 Probability model

Selection probability of an optional row is proportional to its weight among currently-eligible optional rows:

```
p(X) = weight(X) / Σ weight(eligible optional rows)
```

Example: `A = 100, B = 50, C = 25` ⇒ total `175` ⇒ `p(A) ≈ 57.1%`, `p(B) ≈ 28.6%`, `p(C) ≈ 14.3%`. After each pick the picked row is removed and the remaining weights re-normalize (sampling without replacement).

### 5.2 Deterministic draw

All randomness flows through a single seeded PRNG (e.g. `cyrb128` seed-string hashing + `mulberry32` generator — tiny, dependency-free, documented, pure). A weighted pick is: `draw = prng.float() * Σweight`; select the first row (in canonical `(priority, character_id)` order) whose cumulative weight exceeds `draw`. Ties in cumulative boundaries resolve to canonical order, keeping output deterministic.

### 5.3 Same seed ⇒ same stream ⇒ same count and same picks.

### 5.4 Edge cases

| Case                      | Behavior                                                                                                       |
| ------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `weight = 0`              | Excluded from optional selection (`O'` filter, §2.1 step 5). Only selectable if `required = true`.             |
| all optional `weight = 0` | `O'` empty whenever an optional slot is needed ⇒ deterministic error "insufficient pool" if `target >          | R   | `; succeeds with exactly ` | R   | `characters if`target = | R   | `.  |
| negative `weight`         | Impossible in the DB (`CHECK (weight >= 0)`). Generator defensively rejects as invalid input.                  |
| `NULL` weight             | Impossible in the DB (`NOT NULL DEFAULT 1`). Generator treats a missing weight in a snapshot as invalid input. |

No new columns. Existing CHECK constraints and types are respected and relied upon.

---

## 6. Priority

`case_characters.priority` is defined as **the authoring-provided deterministic ordering key of the pool**:

- Pool iteration order, weighted-draw tie-breaking, and final output ordering are `(priority ASC, character_id ASC)`.
- It is **selection ordering**, not probability: it never changes the chance of selection (weights do), never overrides `required`, and never narrows the eligible set.
- It is **not** a rule-engine input in Phase 6.

**Explicit distinction:**

| Field      | Meaning in Phase 6                                                          |
| ---------- | --------------------------------------------------------------------------- |
| `required` | hard membership — always selected                                           |
| `weight`   | relative selection probability among optional rows                          |
| `priority` | deterministic ordering (iteration + tie-break + output), authoring metadata |

This meaning was chosen because it is the only non-conflicting reading consistent with the schema (a single `int` ordering key), it makes determinism independent of DB row order, and it does not collide with `weight`/`required`. It is documented here so a future system (e.g., a phase that redefines priority) does so deliberately, not silently.

---

## 7. Conditions

- **Phase 6 treatment: ignored.** All pool rows are eligible; `conditions` are not evaluated.
- This is an explicit, documented decision, not an accident: Phase 11 defines rule semantics. To make the change safe, the generator's input includes `conditions` as opaque payloads and the algorithm exposes an optional **eligibility filter** extension point (§11). When the rule engine ships, a caller-provided predicate may narrow `E`; without it, all rows are eligible — behavior identical to Phase 6.
- No condition semantics are invented now.

---

## 8. Seeded Determinism

**Deterministic input tuple** (everything that participates):

```
(case_template_id, template version, seed, snapshot of cases + case_characters at that version)
```

- Same template + same published version + same seed ⇒ identical selection (count, picks, output order).
- Different seeds ⇒ the PRNG stream differs ⇒ outputs may differ (including the target count and which optional rows win draws).
- The generator is a pure function: `f(template, relations, seed) → result`. Given identical inputs it always returns identical outputs; there is no time, clock, or external state.
- The seed is opaque to the algorithm (a string or integer normalized to a byte string); the caller (Phase 14) stores it on the Case Instance.

---

## 9. Versioning

- `cases.version` is the template's content version. `case_characters.version` is the relation row version, which **must equal the template version it belongs to** (R2: relations version with their parent).
- The generator **never mixes versions**: it requires a snapshot where every relation row's `version` equals the template's `version`. A single mismatch ⇒ `VersionMismatchError` (§10).
- The published template version pins the generation contract. A generator run must load content at exactly the published version; if Phase 27 later exposes a specific historical version, the same rule applies — generate against the pinned version only.
- Rationale: never accidentally generate from `cases.version N` + `case_characters.version N+1`.

---

## 10. Failure Modes (deterministic, explicit errors)

| Condition                                       | Error                  | Layer                                              |
| ----------------------------------------------- | ---------------------- | -------------------------------------------------- |
| `required > max_characters`                     | `RequiredExceedsMax`   | publish validation (Phase 26) + generator backstop |
| `pool size < min_characters`                    | `PoolBelowMinimum`     | publish validation + generator backstop            |
| no eligible characters (`                       | E                      | = 0`)                                              | `NoEligibleCharacters` | generator |
| all optional `weight = 0` + target >            | R                      |                                                    | `InsufficientPool`     | generator |
| negative weight in snapshot                     | `InvalidWeight`        | generator (defensive; DB CHECK already prevents)   |
| missing weight in snapshot                      | `InvalidWeight`        | generator (defensive; DB NOT NULL prevents)        |
| `conditions` eliminate all rows (post-Phase 11) | `NoEligibleCharacters` | generator                                          |
| relation `version` ≠ template `version`         | `VersionMismatch`      | generator                                          |
| `min_characters > max_characters` (bounded)     | `InvalidBounds`        | publish validation + generator backstop            |
| duplicate `character_id` in snapshot            | `DuplicateCharacter`   | generator (defensive; UNIQUE prevents)             |

All errors are typed, data-carrying values (discriminated union), never silent fallback. Publish-time validation is the preferred detection layer; generator errors are a defensive backstop for already-published or historical content.

---

## 11. Proposed Module / API Boundary (design only — no implementation)

Package: `packages/game-rules` (justified: character selection is a generation _rule_; `game-rules` is the shared, dependency-free rules package and already owns the rule-union types the content schema validates against).

Proposed structure (NOT created in Phase 6):

```
packages/game-rules/src/generation/
  selection.ts        — pure selectCharacters(...)
  prng.ts             — cyrb128 + mulberry32 (deterministic, dependency-free)
  errors.ts           — CharacterSelectionError discriminated union
  types.ts            — input/result types
```

Proposed API (sketch — informational):

```ts
interface CharacterSelectionInput {
  caseTemplateId: string;
  templateVersion: number;
  minCharacters: number; // 0 = no minimum
  maxCharacters: number; // 0 = no maximum
  characters: Array<{
    characterId: string;
    required: boolean;
    weight: number;
    priority: number;
    conditions: unknown[]; // opaque in Phase 6
    version: number;
  }>;
  seed: string;
  // optional extension point (Phase 11): eligibilityFilter?(row) => boolean
}

type CharacterSelectionResult =
  | {
      ok: true;
      characters: Array<{ characterId: string; role: string | null }>;
      templateVersion: number;
    }
  | { ok: false; error: CharacterSelectionError };

declare function selectCharacters(input: CharacterSelectionInput): CharacterSelectionResult;
```

The function is pure, synchronous, typed, and fully unit-testable with no external dependencies. Phase 12/14 will load the version-pinned snapshot and call it, storing the seed + result on the Case Instance.

---

## 12. Test Strategy (design only — no implementation)

Deterministic unit tests (in `packages/game-rules`, Phase 6 implementation):

| Test                            | Asserts                                                                              |
| ------------------------------- | ------------------------------------------------------------------------------------ |
| same seed ⇒ same result         | two calls, same input, equal output                                                  |
| different seeds ⇒ can differ    | property run across seeds; at least one differing selection (may be count or picks)  |
| min boundary                    | target never < `max(min,                                                             | R   | )`               |
| max boundary                    | selected count never > `effectiveUpper` (= `min(max_characters,                      | E   | )` when bounded) |
| required always present         | for every seed, every required id is in output                                       |
| no duplicates                   | selected ids unique                                                                  |
| weighted selection distribution | statistical check with many seeds: high-weight row chosen more often than low-weight |
| zero-weight not selectable      | weight-0 optional never picked (unless required)                                     |
| required > max                  | returns `RequiredExceedsMax`                                                         |
| pool < min                      | returns `PoolBelowMinimum`                                                           |
| all optional weights zero       | returns `InsufficientPool` (when target >                                            | R   | )                |
| version mismatch                | returns `VersionMismatch`                                                            |
| negative weight                 | returns `InvalidWeight`                                                              |

**Property-based testing** (e.g. `fast-check`) is recommended and useful for invariants: random templates + random seeds must always satisfy — required ⊆ output, output unique, `lower ≤ |output| ≤ upper`, determinism (same seed ⇒ same output). Adding `fast-check` as a devDependency of `game-rules` is part of the Phase 6 implementation decision.

---

## 13. Required Examples (all ten)

1. **Simple 2–4 random characters** — `min=2,max=4`, all optional: target ∈ {2,3,4} uniform; weighted fill; unique.
2. **Required character** — Mehmet `required=true, weight=100`: present in every seed output.
3. **Multiple required** — Mehmet+Ayşe `required=true`: both always present; `lower = 2`.
4. **Required > max** — `max=2`, 3 required ⇒ `lower=3 > upper=2` ⇒ **invalid template**, caught at publish (Phase 26) + `RequiredExceedsMax` backstop.
5. **Weighted pool** — A=100,B=50,C=25 ⇒ p ≈ 57/29/14; higher weight ⇒ more frequent.
6. **All weights zero** — optional rows all weight 0 ⇒ if `target = |R|` succeeds (required only); if `target > |R|` ⇒ `InsufficientPool`.
7. **Pool smaller than minimum** — `min=5`, pool of 3 ⇒ `lower=5 > upper=3` ⇒ invalid at publish + `PoolBelowMinimum`.
8. **Different seeds** — same template/version, seeds `s1 ≠ s2` ⇒ PRNG streams differ ⇒ counts/picks may differ.
9. **Same seed repeated** — `s` used twice ⇒ identical output (determinism).
10. **Version mismatch** — template `version=3`, a relation row `version=4` ⇒ `VersionMismatch`.

---

## 14. Database Changes

**No migration required for Phase 6.** The Phase 2–5 schema fully supports character selection: `case_characters` is the canonical pool (with weight/required/priority/conditions/version and structural UNIQUE), and `cases.min_characters`/`max_characters` provide the count bounds. TODO §6.1's `case_character_pool` is already satisfied by `case_characters` (audit R1). No new columns, tables, constraints, or types are introduced.

---

## Self-Review

**Spec coverage:** all 12 selection-semantics points defined (§2–§9); required>max decided as publish-time + generator backstop (§3.1); min/max algorithm precise with seed ordering (§2, §4); weighted random incl. all weight edge cases (§5); priority semantics explicitly defined and distinguished from required/weight, with a documented no-conflict rationale (§6); conditions explicitly deferred with a safe extension point (§7); deterministic tuple + version pinning (§8–§9); 12 explicit failure modes (§10); module boundary in `game-rules` with API sketch, no implementation (§11); deterministic + property-based test strategy (§12); all 10 required examples (§13); DB verdict (§14).
**Placeholder scan:** no TBD/TODO; every behavior has a concrete decision.
**Type consistency:** field names in the API sketch mirror the DB/TS naming used throughout (`minCharacters`, `maxCharacters`, `characterId`, `required`, `weight`, `priority`, `conditions`, `version`, `templateVersion`, `caseTemplateId`).
