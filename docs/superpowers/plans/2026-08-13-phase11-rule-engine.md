# Phase 11 — Rule / Condition Engine Design

> **Status:** DESIGN — for review (design-only; nothing implemented or migrated). This document specifies the generic rule system (TODO §11) and the module/API boundary: the shared rule AST, the pure evaluation core, the four condition classes, the context model, and the eligibility-filter wiring into the Phase 6–10 generators. No database, migration, shared-types, content-schema, Admin UI, or Mobile UI changes are made by this document.

**Goal:** Design a generic, data-driven condition/rule system covering the four distinct condition classes the schema already carries — generation eligibility, discovery, availability, and runtime/gameplay — over a single shared rule AST, without creating pool tables, without new sources of truth, without new SQL enums (R4), and without changing the Phase 6–10 deterministic output contract.

**Architecture:** One pure, deterministic rule-evaluation core over the existing `Rule` discriminated union (declared in `packages/game-rules/src/index.ts`), exposed through **separate typed entry points** — one per condition class — so generation, discovery, availability, and runtime semantics cannot be conflated. Each entry point takes a class-specific read-only context; the core walker and operators are shared. Generation eligibility is wired through the already-deployed `eligibilityFilter` hook on all four selection functions; it runs before draw #1 and consumes zero PRNG draws, preserving the Phase 6–10 contract. The natural home is `packages/game-rules` (rule evaluation is a game rule). Phase 11 designs and specifies; Phase 12/14 wire it into the seeded pipeline and Case Instance.

**Tech Stack:** TypeScript (pure functions), the existing `Rule` union, `packages/game-rules` for the evaluator + types + contexts. No new dependencies.

## Global Constraints (Phase 11)

- **Conditions are data, not code.** Every rule lives in an existing JSONB column (`conditions`, `discovery_condition`, `completion_condition`, dialogue `conditions`/`actions`). The engine reads and evaluates; it never hard-codes content. New rule _values_ require content changes only; new _operators_ require an engine/AST change.
- **No new tables, no new columns, no new SQL enums.** All condition-bearing fields already exist (R4: no SQL enum without strong justification; none needed).
- **No new sources of truth.** Rules are consumed from the same canonical relation/entity rows the generators read; nothing is copied or mirrored.
- **One rule AST, four entry points.** The `Rule` union is shared. The **evaluation core** is shared. The **entry functions** and **context resolvers** are per-class so (A) generation eligibility, (B) discovery, (C) availability, and (D) runtime/gameplay semantics cannot be conflated.
- **Generation evaluation is pure and deterministic.** It runs against a version-pinned snapshot plus settled results of earlier pipeline steps — never against a live database, never against Case Instance runtime state, never with randomness.
- **The Phase 6–10 deterministic contract is preserved.** Eligibility filtering happens before draw #1, before the required/optional split, and consumes zero PRNG draws. Same (snapshot including evaluated conditions, seed) ⇒ same output. Empty `conditions` (`[]`) is equivalent to Phase 6–10 behavior: every row eligible.
- **No mixing of generation rules with instance state.** The generation evaluator cannot read the Case Instance; the runtime evaluator never runs during generation.
- **No AI, no Admin UI, no Mobile UI.** The engine is a pure library; authoring surfaces are later phases.
- **Existing published content remains representable.** All current JSONB defaults (`[]`, `{}`) parse as "no conditions" and evaluate to _eligible_ / _available_, so zero-condition content is byte-for-byte Phase 6–10 behavior.
- **Deterministic false, never silent true.** A rule that cannot be satisfied (missing path, type mismatch, unknown ref) evaluates to `false`, making the entity ineligible — except during publish-time validation (Phase 26), which reports it. No fallback, no clamping, no retry-with-relaxed-conditions.

---

## 1. Objective

Phase 11 is the **Rule / Condition Engine**. It implements TODO §11 "Create generic rule system" and §11.1's thirteen operators (AND, OR, NOT, equals, greaterThan, lessThan, contains, hasItem, hasEvidence, characterRole, locationType, difficulty, previousDecision), satisfying the three worked examples:

- `IF item == phone THEN allow evidence == imei_mismatch` — a **generation eligibility** rule (evidence `imei_mismatch` is eligible only when the case contains item `phone`).
- `IF character.role == businessman THEN allow document == invoice` — a **generation eligibility** rule (document `invoice` eligible only when a character with role `businessman` is in the case).
- `IF fake_invoice == true THEN evidence fake_invoice_detected becomes available` — a **runtime discovery/availability** rule (a runtime flag set during play unlocks the evidence).

This document freezes the contract at the **domain-rule boundary** (`packages/game-rules`). It deliberately does **not** implement the evaluator, does **not** add tables or columns, does **not** wire the pipeline, and does **not** build the Phase 12 Random Generation Engine, the Phase 13 Constraint Validator, the Phase 14 Case Instance, or the Phase 26 publish validator.

The single architectural decision this phase must nail down: **one evaluator or several?** The answer is **one pure evaluation core over a common AST, exposed through separate class-specific entry points and contexts** (§13). This avoids duplicating operator logic while making semantic conflation structurally impossible.

---

## 2. Current Architecture

Existing (all committed, `48d7acf`):

- **Rule AST already declared** in `packages/game-rules/src/index.ts:9–56`: `RULE_OPERATORS = ['and','or','not','equals','greaterThan','lessThan','contains','hasItem','hasEvidence','characterRole','locationType','difficulty','previousDecision']`; discriminated union `Rule = ComparisonRule | HasRule | ContextRule | NotRule | GroupRule`; `ComparisonRule {op, path, value}`, `HasRule {op, ref}`, `ContextRule {op, value}`, `NotRule {rule}`, `GroupRule {rules}`. Package `description` and module doc both state the engine ships in Phase 11.
- **Condition-bearing JSONB fields** (see §3) on case relations (`conditions`, `discovery_condition`), location relations (`conditions`, `availability` bool, `discovery_condition`), missions (`completion_condition` object, `reward`), and dialogue nodes/choices (`conditions`/`actions`).
- **Four pure generators** in `packages/game-rules/src/generation/` — `selection.ts` (characters), `item-selection.ts`, `document-selection.ts`, `evidence-selection.ts` — each consuming a version-pinned snapshot + seed, each exposing an optional `eligibilityFilter?: (candidate) => boolean` input that narrows the eligible pool **before** draw #1 (§17). `conditions: unknown[]` is carried on every candidate but is **opaque** (never evaluated).
- **Seeded PRNG** (Phase 6, `prng.ts`): `cyrb128` + `mulberry32` via `createSeededRandom(seed)`; `int(n)` and `float()`. Algorithm and draw order are part of the generator contract.
- **Shared-types** `relations.ts`: `conditions: unknown[]` on all case/location relations; `discoveryCondition: unknown` on evidence relations; typed unions (`EvidenceRole`, `LocationType`, …) in `enums.ts`. **Content-schema** validates condition payloads structurally only (`relationConditionsSchema = z.array(z.record(z.string(), z.unknown()))`; `rulePayloadSchema` for dialogue; `completionCondition: z.record(z.string(), z.unknown())` for missions).
- **No evaluator exists.** No `rules/` module, no context builder, no entry point. `eligibilityFilter` is never passed by any caller today (the pipeline is Phase 12).

The pipeline (Phase 12) will load a version-pinned snapshot, build the generation context, evaluate eligibility conditions, and pass the resulting predicate into each generator. Neither the pipeline nor the instance exists in Phase 11.

---

## 3. Existing Schema Analysis

Every condition-bearing field, as implemented:

| Field                                                         | Carrier (migration) | Shape today                    | Class                                     |
| ------------------------------------------------------------- | ------------------- | ------------------------------ | ----------------------------------------- |
| `case_characters.conditions`                                  | `0012`              | jsonb `[]` (array of records)  | A generation eligibility                  |
| `case_items.conditions`                                       | `0012`              | jsonb `[]`                     | A generation eligibility                  |
| `case_documents.conditions`                                   | `0012`              | jsonb `[]`                     | A generation eligibility                  |
| `case_evidence.conditions`                                    | `0012`              | jsonb `[]`                     | A generation eligibility                  |
| `case_evidence.discovery_condition`                           | `0012`              | jsonb nullable (single record) | B discovery                               |
| `case_items.hidden`, `case_documents.hidden`                  | `0012`              | boolean                        | C availability (static)                   |
| `case_evidence.role` (`required`/`optional`/`decoy`/`hidden`) | `0012`              | text (R4)                      | C availability (static)                   |
| `location_*.conditions`                                       | `0013`              | jsonb `[]`                     | A generation eligibility (+ C at runtime) |
| `location_*.availability`                                     | `0013`              | boolean default true           | C availability (static)                   |
| `location_*.discovery_condition`                              | `0013`              | jsonb nullable (single record) | B discovery                               |
| `missions.completion_condition`                               | `0009`              | jsonb `{}` (**object**)        | D runtime/gameplay                        |
| `dialogue_nodes.conditions` / `actions`                       | `0008`              | jsonb `[]`                     | D runtime/gameplay                        |
| `dialogue_node_choices.conditions` / `actions`                | `0008`              | jsonb `[]`                     | D runtime/gameplay                        |

`cases.difficulty` (migration `0016`, free text, nullable) is the value source for the `difficulty` operator at generation time and at runtime. `cases.type` is available the same way. Entity-level `items.name`, `characters.role`/`occupation`, `evidence` ids/names, `locations.type` are the attribute sources that `equals`/`characterRole`/`locationType`/`hasItem`/`hasEvidence` resolve against.

**Shape inconsistency (must be addressed by the design, no migration needed):** relations and dialogue carry condition payloads as **arrays of records** (`[]` default), while missions carry `completion_condition` as a **single record object** (`{}` default). Phase 11 defines a normalizer (§14) that accepts both a single rule object and an array of rule objects (implicit AND), so one AST and one parser serve all carriers.

---

## 4. Schema Sufficiency

**Verdict: the Phase 2–5 schema fully supports the rule engine. No migration required for Phase 11.**

Every TODO §11 concern maps to an existing carrier:

| §11 / §11.1 need                                             | Existing carrier                                                      |
| ------------------------------------------------------------ | --------------------------------------------------------------------- |
| AND / OR / NOT                                               | JSONB rule payloads composed as `GroupRule`/`NotRule`                 |
| equals / greaterThan / lessThan / contains                   | `ComparisonRule` against snapshot/instance attributes                 |
| hasItem / hasEvidence                                        | `HasRule` against generated set / player state                        |
| characterRole / locationType / difficulty / previousDecision | `ContextRule` against context                                         |
| Data-driven conditions                                       | All condition JSONB columns (§3)                                      |
| Generation-eligibility gating                                | relation `conditions` → `eligibilityFilter` (§16)                     |
| Discovery gating                                             | `discovery_condition` (§19)                                           |
| Availability                                                 | `availability` bool + `hidden`/`role` + runtime conditions (§20)      |
| Runtime/gameplay                                             | mission `completion_condition`, dialogue `conditions`/`actions` (§21) |

No new column is required to express any of the three worked examples: they are authored as JSONB rules inside existing columns. The schema intentionally carried `conditions` as opaque JSONB until this phase (audit §3.4, Phase 6–10 docs §14) precisely so the evaluator could be layered on without schema change.

---

## 5. Required DB Changes

**None.** No new tables, no new columns, no new enums, no constraint changes, no triggers, no RLS changes.

This is consistent with Phases 6–10, which made zero schema changes by treating existing relations as pools (R1) and existing JSONB as rule storage.

---

## 6. New Tables and Relations

**None proposed.** The only Phase 11 artifacts are design/implementation-level, in `packages/game-rules` (§34), implemented in the Phase 11 build step, not by this document.

---

## 7. Source-of-Truth and Duplication Analysis

- **The `Rule` union is the single source of truth for rule structure**, already declared in `packages/game-rules/src/index.ts`. Content-schema validates payloads against it (Phase 11 build step); no second AST anywhere.
- **The relation/entity rows are the single source of truth for rule _values_** (the JSONB payloads). The evaluator reads them; it never persists, caches, or copies evaluated results.
- **No `*_pool` duplicates.** Conditions live on the canonical relation rows (`case_characters`, `case_items`, `case_documents`, `case_evidence`, `location_*`) exactly as in Phases 6–10. No rule-condition table is introduced.
- **No cached "effective pool"** anywhere. The Phase 12 pipeline builds the snapshot, the eligibility predicate, and calls the generator; nothing stores a pre-filtered pool.
- **`availability` / `hidden` / `role` remain static data** (§20); rules may _add_ gating but never redefine these flags.
- **Context is constructed per evaluation**, from the snapshot (generation) or the instance (runtime), and discarded. No context is ever stored in the DB.
- **Difficulty/type stay on `cases`** (free text, R4); the `difficulty` operator reads them, it does not duplicate them.

---

## 8. Entity and Relation Diagrams

```
Case relation row (e.g. case_evidence, 0012)
  ... role/weight/priority/version ...
  conditions jsonb []        ──► generation eligibility (A) [Phase 12 wiring]
  discovery_condition jsonb  ──► discovery (B)              [Phase 14 wiring]

Location relation row (e.g. location_items, 0013)
  ... availability bool, spawn_probability, min/max ...
  conditions jsonb []        ──► eligibility (A) / runtime availability (C)
  discovery_condition jsonb  ──► discovery (B)

Mission (0009): completion_condition jsonb object ──► runtime/gameplay (D)
Dialogue node/choice (0008): conditions/actions jsonb [] ──► runtime (D)
```

Evaluation flow (pure, no DB):

```
snapshot (template + relation rows, pinned to cases.version)
        + settled earlier-pipeline output (Phase 12)
        └─► buildGenerationContext ─► buildEligibilityFilter ─► select*({ eligibilityFilter }) ─► Generated*
        └─► evaluateRule(rule, generationContext): boolean      (shared core)

Case Instance (Phase 14) + player state
        └─► buildRuntimeContext ─► evaluateDiscovery / evaluateRuntime / availability checks
        └─► evaluateRule(rule, runtimeContext): boolean          (shared core)
```

---

## 9. The Four Condition Classes

The schema carries four semantically distinct condition classes. **They must not be conflated**, so each has its own entry point (§13) and its own context (§12).

| #     | Class                      | Meaning                                                         | Carrier                                                                  | Evaluated when                        | Context                                             |
| ----- | -------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------- | --------------------------------------------------- |
| **A** | **Generation eligibility** | "May this pool row be considered for selection?"                | relation `conditions`                                                    | During generation, before draw #1     | Generation context (snapshot + settled prior steps) |
| **B** | **Discovery**              | "May this evidence be discovered right now?"                    | `discovery_condition`                                                    | At runtime discovery attempts         | Runtime context (instance + player state)           |
| **C** | **Availability**           | "Is this entity obtainable/exposed at all?"                     | `availability` bool + `hidden`/`role` + relation `conditions` at runtime | Static at authoring; rules at runtime | N/A (static) or runtime context                     |
| **D** | **Runtime / gameplay**     | "Does this dialogue branch / mission completion / action fire?" | mission `completion_condition`, dialogue `conditions`/`actions`          | At runtime, driven by the case engine | Runtime context                                     |

The three TODO examples map onto classes as follows: examples 1 and 2 are **class A** (they gate which evidence/document rows are eligible at generation); example 3 is **class B/C** (a runtime flag set when the player inspects the fake invoice unlocks the evidence `fake_invoice_detected`). `previousDecision` and player-inventory `hasItem`/`hasEvidence` are **class D only** — they have no generation-time meaning (there is no "previous decision" and no player inventory before an instance exists).

---

## 10. Shared Rule AST and Operators

The AST already declared in `packages/game-rules/src/index.ts:9–56` is frozen as the canonical shape:

```ts
type Rule = ComparisonRule | HasRule | ContextRule | NotRule | GroupRule;
ComparisonRule { op: 'equals' | 'greaterThan' | 'lessThan' | 'contains'; path: string; value: unknown }
HasRule        { op: 'hasItem' | 'hasEvidence'; ref: string }
ContextRule    { op: 'characterRole' | 'locationType' | 'difficulty' | 'previousDecision'; value: string }
NotRule        { op: 'not'; rule: Rule }
GroupRule      { op: 'and' | 'or'; rules: Rule[] }
```

- All thirteen TODO §11.1 operators are present; no operator is added or removed.
- `equals`/`greaterThan`/`lessThan`/`contains` read a value at `path` in the context and compare to `value`.
- `hasItem`/`hasEvidence` test membership of `ref` (an entity id or name) in the context's item/evidence set.
- `characterRole`/`locationType`/`difficulty`/`previousDecision` are context facts resolved by the class-specific context.
- Because this union is already validated by content-schema and documented across Phases 6–10, reusing it guarantees existing payload shapes stay representable (§14).

**Not in scope for §11.1, noted for §37:** dialogue `actions` are rule-_shaped_ payloads but _execute_ effects (unlock, set flag, grant item). Phase 11 defines the shared evaluation core they draw from; the action _execution_ engine is a Phase 14/36/37 runtime concern.

---

## 11. Operator Semantics per Class

Semantics differ **by class** for operators that read context facts. The core walker is identical; the context resolver defines what each fact means.

| Operator                   | Generation eligibility (A)                                                                | Discovery (B) / Availability (C)         | Runtime / gameplay (D)                                  |
| -------------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------- |
| `and` / `or` / `not`       | logical composition                                                                       | logical composition                      | logical composition                                     |
| `equals`                   | snapshot attribute equals `value`                                                         | runtime attribute equals `value`         | runtime attribute equals `value`                        |
| `greaterThan` / `lessThan` | numeric comparison on snapshot attribute                                                  | numeric comparison on runtime attribute  | numeric comparison on runtime attribute                 |
| `contains`                 | string-substring / array-membership on snapshot attribute                                 | same, runtime attribute                  | same, runtime attribute                                 |
| `hasItem`                  | **the generated case instance contains item `ref`** (settled earlier pipeline output)     | —                                        | the player currently holds item `ref`                   |
| `hasEvidence`              | **the generated case instance contains evidence `ref`** (settled earlier pipeline output) | —                                        | the player has discovered evidence `ref`                |
| `characterRole`            | the case contains ≥1 character whose `role` equals `value`                                | —                                        | the active/interacted character's `role` equals `value` |
| `locationType`             | (case-level: not meaningful; available at location-level generation)                      | current location's `type` equals `value` | current location's `type` equals `value`                |
| `difficulty`               | `cases.difficulty` equals `value`                                                         | `cases.difficulty` equals `value`        | the instance's template `difficulty` equals `value`     |
| `previousDecision`         | **not usable** (no decisions at generation)                                               | not usable                               | the player's last decision id/ref equals `value`        |

This table is the concrete answer to the conflation risk: the **same AST and same evaluator** are used everywhere, but `hasItem`/`hasEvidence`/`characterRole`/`locationType`/`difficulty`/`previousDecision` resolve differently per class through the class-specific context. Generation (A) may never call the runtime resolvers and vice versa — enforced by separate entry points taking **nominally branded** context types (§13, §15.1) so the mixing is a compile-time error, not a convention.

### 11.1 Exact Operator Contracts

For each of the thirteen operators, the exact contract. "Resolved value" means `context.get(path)` per §12. "Missing" means the resolved value is `undefined`/`null`. Every failure case is a deterministic `false` (never a throw, never a silent `true`).

| Operator           | Operand types                                             | Context fields read                                                                              | Generation meaning (A)                                                                            | Runtime meaning (B/C/D)                                                            | Missing value                                                    | Type mismatch                                                                | Unknown entity / ref                              | Arrays                                                 |
| ------------------ | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------ |
| `and`              | `rules: Rule[]` (≥1)                                      | none directly (children)                                                                         | all children true                                                                                 | all children true                                                                  | n/a (parser rejects empty)                                       | n/a                                                                          | n/a                                               | yes — the operand IS a list                            |
| `or`               | `rules: Rule[]` (≥1)                                      | none directly (children)                                                                         | ≥1 child true                                                                                     | ≥1 child true                                                                      | n/a (parser rejects empty)                                       | n/a                                                                          | n/a                                               | yes — the operand IS a list                            |
| `not`              | `rule: Rule` (exactly 1)                                  | none directly (child)                                                                            | negation of child                                                                                 | negation of child                                                                  | n/a (parser rejects wrong arity)                                 | n/a                                                                          | n/a                                               | no — single child; compose `and`/`or` inside for lists |
| `equals`           | `path: string`, `value: unknown` (scalar)                 | `get(path)`                                                                                      | resolved snapshot value `===` `value` (strict, no coercion)                                       | resolved runtime value `===` `value` (strict)                                      | `false` unless `value` is also `undefined` (missing ≠ any value) | `false` (e.g. number `value` vs string resolved)                             | unknown path ⇒ `false` (`UnknownPath` at publish) | no — `value` must be scalar; use `contains` for lists  |
| `greaterThan`      | `path: string`, `value: number` (numeric string accepted) | `get(path)` as number                                                                            | resolved number `>` `value`                                                                       | resolved number `>` `value`                                                        | `false`                                                          | `false` — resolved value not a number/numeric string ⇒ `false` (no coercion) | unknown path ⇒ `false`                            | no                                                     |
| `lessThan`         | `path: string`, `value: number` (numeric string accepted) | `get(path)` as number                                                                            | resolved number `<` `value`                                                                       | resolved number `<` `value`                                                        | `false`                                                          | `false` — same as `greaterThan`                                              | unknown path ⇒ `false`                            | no                                                     |
| `contains`         | `path: string`, `value: unknown` (string or element)      | `get(path)`                                                                                      | string: `get(path)` contains substring `value`; array: array contains element `value`             | same                                                                               | `false`                                                          | resolved is neither string nor array ⇒ `false`                               | unknown path ⇒ `false`                            | yes — when resolved value is an array, membership test |
| `hasItem`          | `ref: string`                                             | settled item set (A) / player inventory (runtime)                                                | true iff any **settled** item `id === ref                                                         |                                                                                    | name === ref`                                                    | true iff the **player currently possesses** an item `id === ref              |                                                   | name === ref`                                          | n/a (parser rejects missing `ref`) | n/a | `false`; publish warning if no entity named/identified by `ref` exists | no — membership over a set, not an array operand |
| `hasEvidence`      | `ref: string`                                             | settled evidence set (A) / discovered evidence (runtime)                                         | true iff any **settled** evidence `id === ref                                                     |                                                                                    | name === ref`                                                    | true iff the **player has discovered** an evidence `id === ref               |                                                   | name === ref`                                          | n/a                                | n/a | `false`; publish warning as above                                      | no — membership over a set                       |
| `characterRole`    | `value: string` (free text role, R4)                      | settled characters' `role` (A) / active character's `role` (runtime)                             | true iff any **settled** character `role === value`                                               | true iff the active/interacted character's `role === value` (false if none active) | `false` (no character / null role)                               | n/a (both strings)                                                           | n/a — roles are free text (R4)                    | no                                                     |
| `locationType`     | `value: string`                                           | `location.type` of current location (runtime) / of the location being generated (location-level) | case-level: not meaningful ⇒ `false`; location-level generation: that location's `type === value` | true iff current location `type === value`                                         | `false` (no current location)                                    | n/a (both strings)                                                           | n/a — `type` is a free-text/union value           | no                                                     |
| `difficulty`       | `value: string`                                           | `cases.difficulty`                                                                               | true iff `cases.difficulty === value`                                                             | true iff the instance's template `difficulty === value`                            | `false` (difficulty is `null`)                                   | n/a (both strings)                                                           | n/a — difficulty is free text (R4)                | no                                                     |
| `previousDecision` | `value: string` (decision id/ref)                         | last recorded player decision                                                                    | **not usable** ⇒ always `false` (no decisions at generation); publish flags `DisallowedClassOp`   | true iff the last recorded decision's id/ref `=== value`                           | `false` (no decision recorded)                                   | n/a (both strings)                                                           | `false` (no decision with that ref)               | no                                                     |

Authoring equivalence (canonical spellings): `{ op: 'hasItem', ref: 'phone' }` ≡ `{ op: 'equals', path: 'item.name', value: 'phone' }` (or `item.id`); `{ op: 'characterRole', value: 'businessman' }` ≡ `{ op: 'equals', path: 'character.role', value: 'businessman' }`. Both spellings are valid; §12.1 defines the closed path vocabulary they resolve against.

---

## 12. Context Model

Two read-only context types, both built once per evaluation and never persisted.

### 12.1 `GenerationContext` (class A)

Built by Phase 12 from the version-pinned snapshot **plus the settled output of earlier pipeline steps** (selection order is dependency-ordered in Phase 12: characters → items → documents → evidence, so later pools can gate on earlier results):

| Fact                                                        | Resolution                                                                                                                                  |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `difficulty`, `type`                                        | `cases.difficulty` / `cases.type` (free text)                                                                                               |
| `characters[].role`, `characters[].id`                      | `case_characters.role` / id                                                                                                                 |
| `items[].id`, `items[].name`, `items[].quantity`            | `case_items` rows + generated quantity                                                                                                      |
| `documents[].id`, `documents[].role`                        | `case_documents` rows                                                                                                                       |
| `evidence[].id`, `evidence[].role`, `evidence[].importance` | `case_evidence` rows                                                                                                                        |
| `hasItem(ref)` / `hasEvidence(ref)`                         | membership in the settled generated sets                                                                                                    |
| `characterRole(value)`                                      | any settled character role equals `value`                                                                                                   |
| custom flags (e.g. `fake_invoice`)                          | **not present** — a generation context has no play state; a rule referencing it at generation evaluates `false` (validated at publish, §39) |

Path resolution: `path` resolves against the **closed vocabulary below** — no arbitrary unrestricted object-path traversal (a `path` like `character.items.0.name` is rejected by the parser as `UnknownPath`). Each path maps to an explicit resolver:

| Path                                    | Class | Resolution                                                                                    |
| --------------------------------------- | ----- | --------------------------------------------------------------------------------------------- |
| `case.difficulty`                       | A / D | `cases.difficulty` (free text, R4)                                                            |
| `case.type`                             | A / D | `cases.type` (free text)                                                                      |
| `character.role`                        | A     | **exists** — any settled character `role === value` (equiv. `characterRole`)                  |
| `character.occupation`                  | A     | **exists** — any settled character `occupation === value` (entity attribute)                  |
| `item.id` / `item.name`                 | A     | **exists** — any settled item `id`/`name === value` (equiv. `hasItem`)                        |
| `document.role`                         | A     | **exists** — any settled document `role === value`                                            |
| `evidence.role` / `evidence.importance` | A     | **exists** — any settled evidence `role`/`importance === value`                               |
| `location.type`                         | C / D | current location's `type` (runtime); the location being generated (location-level generation) |
| `previousDecision`                      | D     | last recorded player decision id/ref                                                          |

Semantics: a single-scalar path (`case.difficulty`, `location.type`) resolves to one value; a collection path (`character.role`, `item.name`, …) resolves by **existence** (any settled element matches — the worked examples are exactly this form). A missing path resolves to `undefined` ⇒ comparison operators return `false` (deterministic, §23). Any other path is `UnknownPath` (parser rejects at publish, §39); the evaluator returns `false` defensively.

### 12.2 `RuntimeContext` (classes B/C/D)

Built by Phase 14/36 from the Case Instance + player state:

| Fact                                              | Resolution                                                                           |
| ------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `difficulty`, `type`                              | instance template difficulty/type                                                    |
| `hasItem(ref)` / `hasEvidence(ref)`               | player inventory / discovered evidence                                               |
| `previousDecision`                                | the last recorded player decision                                                    |
| `characterRole(value)`                            | the currently active/interacted character's role                                     |
| `locationType(value)`                             | the player's current location type                                                   |
| custom runtime flags (e.g. `fake_invoice = true`) | instance runtime state set by actions/engine (dialogue actions, evidence inspection) |

Runtime flag paths: a dot-free path that is not in the §12.1 vocabulary (e.g. `fake_invoice`, `suspicious_luggage_opened`) resolves from the instance's flat runtime-flag map. These are the **only** dynamic paths; everything else must be in the closed vocabulary.

Both contexts are plain immutable value maps; the evaluator never mutates them and never persists them.

---

## 13. Evaluation Architecture — One Core, Separate Entry Points

**Decision: a single pure evaluation core over the common AST, exposed through separate class-specific entry points.**

- **Shared core:** `evaluateRule(rule: Rule, context: RuleContext): boolean` — walks the AST, dispatches on `op`, delegates fact resolution to the context. `evaluateRules(rules: Rule[], context): boolean` applies implicit AND over a payload array. Deterministic, side-effect-free, dependency-free, never throws (any malformed input evaluates `false`; malformed _snapshots_ are reported by the parser, §23).
- **Separate entry points** (each takes its class-specific context type, preventing cross-class calls at compile time):
  - `evaluateEligibility(conditions, generationContext)` → boolean (class A; feeds `eligibilityFilter`).
  - `evaluateDiscovery(discoveryCondition, runtimeContext)` → boolean (class B).
  - `evaluateAvailability(availability: boolean, conditions, runtimeContext)` → boolean (class C; static flag ANDed with any runtime conditions).
  - `evaluateRuntime(conditions, runtimeContext)` → boolean (class D; dialogue/mission).

**Nominal context branding (point 1/5 of the review).** `GenerationContext` and `RuntimeContext` are **nominally branded**, not just "marker types": each carries a unique `readonly kind` discriminant (§15.1). Under structural typing two types with identical members are mutually assignable, so unbranded marker types would NOT block a `RuntimeContext` being passed to `evaluateEligibility`. The `kind` discriminant makes `GenerationContext` and `RuntimeContext` structurally incompatible, so a cross-class call is a **compile-time error**. The shared `RuleContext` base (implemented by both) is deliberately narrow and contains only the resolver methods; the brand lives on the concrete classes the public entry points accept.

This gives the best of both designs: **no duplicated operator logic** (one walker), and **no semantic conflation** (each class has a distinct typed boundary; `GenerationContext` does not satisfy a runtime entry point's parameter and vice versa — enforced by the `kind` discriminant, not convention). A separate-evaluators-per-class design would duplicate the entire operator switch four times; a single-blind-evaluator design would make `previousDecision` or player-inventory `hasItem` silently meaningful at generation. The chosen design avoids both.

---

## 14. Rule Payload Normalization

The parser (`parseRulePayload(payload)` / `parseRuleArray(payload)`) maps the three existing carrier shapes onto the single AST, resolving the §3 shape inconsistency **without a migration**. Exact normalization rules:

- **`[]` (empty array — relations, dialogue) ⇒ no rules ⇒ evaluates `true`** (all eligible / always available). This is the Phase 6–10 backward-compatibility guarantee: existing empty-condition rows behave exactly as before (§9 point).
- **`[rule1, rule2, …]` ⇒ implicit AND** of the elements (`evaluateRules`). The array form is ALWAYS a conjunction — it is never inferred as OR, never as NOT, and never as a grouping. To express OR or NOT an author MUST write an explicit `GroupRule` (`{ op: 'or', rules: [...] }`) or `NotRule` (`{ op: 'not', rule }`). Grouping is only ever explicit in the AST; it is never inferred from array nesting.
- **`{}` (empty object — mission `completion_condition`) ⇒ no rule ⇒ evaluates `true`** (mission completes by no-op — current behavior). A non-empty object parses as a single `Rule`.
- **`null`** (e.g. nullable `discovery_condition`) ⇒ no rule ⇒ evaluates `true` (always discoverable). `undefined`/absent is treated identically to `null`.
- **Malformed payload** (unknown `op`, missing fields, wrong arity for `not`/`and`/`or`, non-object element, empty `and`/`or` `rules`): the parser returns a deterministic `InvalidRule` error. At **publish time** (Phase 26) this rejects the content; at **generation time** it surfaces as a snapshot validation failure. The evaluator itself never sees a malformed AST. A malformed rule is NEVER coerced to `true` (which would silently include content); it is an explicit error.
- Unknown JSONB keys are rejected by the parser (not silently ignored), so a typo like `"eqauls"` cannot silently become an always-true rule.

The Phase 11 build step updates content-schema's `relationConditionsSchema` / `rulePayloadSchema` / mission `completionCondition` to validate against a zod mirror of the `Rule` union, preserving both shapes (`z.union([ruleSchema, z.array(ruleSchema)])`), so authors keep writing either form and both remain representable.

---

## 15. Field-Level Design

### 15.1 `RuleContext`

```ts
/** Shared resolver surface; deliberately narrow (no state access). */
interface RuleContext {
  /** Path resolution per §12.1 closed vocabulary; unknown paths → undefined. */
  get(path: string): unknown;
  /** hasItem / hasEvidence (class-specific semantics, §11.1). */
  hasItem(ref: string): boolean;
  hasEvidence(ref: string): boolean;
  characterRole(value: string): boolean;
  locationType(value: string): boolean;
  difficulty(value: string): boolean;
  previousDecision(value: string): boolean;
}

/** Nominally branded (kind discriminant) so the two contexts are NOT
 *  structurally interchangeable — see §13. Building one from the other
 *  is a compile-time error, preventing class-A/runtime conflation. */
interface GenerationContext extends RuleContext {
  readonly kind: 'generation';
}
interface RuntimeContext extends RuleContext {
  readonly kind: 'runtime';
}
```

`GenerationContext` and `RuntimeContext` are built by `buildGenerationContext(snapshot, settled)` (Phase 12) and `buildRuntimeContext(instance)` (Phase 14); the builders are the only way to construct them. Phase 11 defines the interface, the brand, and the core; the Phase 12/14 build steps provide the concrete builders. `RuleContext` itself is not a public entry-point parameter — only the branded concrete types are.

### 15.2 Entry points (Phase 11 public API)

```ts
parseRulePayload(payload: unknown): Rule[]            // normalization (§14)
evaluateRule(rule: Rule, ctx: RuleContext): boolean   // shared core (internal composition)
evaluateRules(rules: Rule[], ctx: RuleContext): boolean  // implicit AND over array
evaluateEligibility(conditions: Rule[], ctx: GenerationContext): boolean   // class A
evaluateDiscovery(condition: Rule, ctx: RuntimeContext): boolean           // class B
evaluateAvailability(availability: boolean, conditions: Rule[], ctx: RuntimeContext): boolean  // class C
evaluateRuntime(conditions: Rule[], ctx: RuntimeContext): boolean           // class D
```

### 15.3 Eligibility predicate wiring (class A)

Phase 12 builds, per pool, a single predicate from the snapshot's generation context and each row's `conditions`:

```ts
const eligible = (candidate) =>
  evaluateEligibility(parseRulePayload(candidate.conditions), generationContext);
// passed as: select*({ ..., eligibilityFilter: eligible })
```

- Conditions on a row are **implicit AND**; a row with `[]` is always eligible.
- The predicate is built once per generator run and is **pure** (no closures over DB/instance state), so the generators' determinism guarantee is preserved (§17).
- No generator code changes: the `eligibilityFilter` hook already exists in all four functions (Phase 6–10) and already runs before draw #1.

---

## 16. Generation Eligibility Evaluation

Class A runs **only** at generation time, wired through `eligibilityFilter`:

1. Phase 12 loads the version-pinned snapshot (template + relation rows) and the settled output of earlier pipeline steps.
2. Phase 12 builds `GenerationContext` once.
3. Phase 12 parses each pool row's `conditions` (`parseRulePayload`) and builds the row's eligibility predicate (implicit AND).
4. Each generator calls `canonical.filter(eligibilityFilter)` — exactly the hook already in `selection.ts:43`, `item-selection.ts:46`, `document-selection.ts:45`, `evidence-selection.ts:52`.
5. Selection proceeds identically over the filtered pool; conditions never influence the draw _sequence_ (they influence only pool _membership_).

Per the worked examples: evidence `imei_mismatch` carries `conditions: [{ op: 'hasItem', ref: 'phone' }]`; if no `phone` item is in the settled generated item set, the evidence row is ineligible. Document `invoice` carries `conditions: [{ op: 'characterRole', value: 'businessman' }]`; if no settled character has role `businessman`, it is ineligible. Either condition failing simply narrows `E` — deterministically, before any draw.

---

## 17. Eligibility Impact on Required / Optional / Bounds / PRNG

This is the section that proves the Phase 6–10 contract is unchanged. Let `R` = required rows, `E` = eligible rows, `P` = pool rows.

**Where the filter runs (identical in all four generators — verified `48d7acf`):**

```
canonical  = canonicalOrder(P)                        // (priority ASC, id ASC)
eligible   = filter ? canonical.filter(filter) : canonical   // selection.ts:43 (chars), item-selection.ts:46, document-selection.ts:45, evidence-selection.ts:52
required   = eligible.filter(isRequired)
optional   = eligible.filter(!isRequired)
lower      = max(minBound, |R|)
upper      = maxBound > 0 ? min(maxBound, |E|) : |E|
target     = lower + rng.int(upper - lower + 1)       // draw #1 (count) — selection.ts:80, item/document:82, evidence:89
... per optional slot: weightedPick(pool, rng.float())  // one float each
... items only, after selection: quantity = drawQuantity(rng, bounds)  // one int per selected item
```

**Zero-PRNG proof (determinism, review point 4).** `createSeededRandom` is created at line 40/43/42/49 — creation draws nothing. The eligibility filter runs at line 43/46/45/52, **before** the first `rng.*` call (the count draw at line 80/82/82/89). The predicate's signature is `(candidate) => boolean`: it receives only the candidate row and cannot touch `rng`, the DB, instance state, or any non-deterministic source. Rule evaluation therefore consumes **exactly zero** PRNG draws by construction. Same (snapshot incl. evaluated conditions, seed) ⇒ same eligible pool ⇒ same draw sequence ⇒ identical output.

**How conditions affect each component:**

| Component     | Effect of a failing condition on a row                                                                         | Effect on PRNG                                                                                       |
| ------------- | -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Required rows | Row removed from `E` ⇒ not selected; `                                                                         | R                                                                                                    | ` shrinks                                       | **None** — filtering calls no `rng.*` |
| Optional rows | Row removed from `E` ⇒ ineligible for weighted draws; weighted probabilities renormalize over the smaller pool | **None** — the same number of `float()` draws is consumed per optional slot, over a different `pool` |
| `lower`       | `lower = max(min,                                                                                              | R                                                                                                    | )` can shrink if a required row is filtered out | **None**                              |
| `upper`       | `upper = min(max,                                                                                              | E                                                                                                    | )`shrinks with`                                 | E                                     | `   | **None** |
| `target`      | Range `[lower, upper]` narrows; the `int()` draw itself is unchanged in form                                   | Draw #1 still consumes exactly one `int()`                                                           |
| Output        | Different id set / possibly different count — intended, data-driven                                            | —                                                                                                    |

**Contract statement:** _For a fixed eligible pool, conditions change nothing about the draw sequence_ — the same number of PRNG calls, in the same order, with the same canonical ordering. Conditions change **which rows are in the pool**, and therefore deterministically change _outcomes_ (which entities are selected, and the count range). `same (snapshot incl. evaluated conditions, seed) ⇒ same output` holds by construction. The existing golden tests pin behavior with no conditions; the Phase 11 test suite pins behavior with conditions (§35) and verifies the identical sequence property.

**The required-row consequence (explicit):** a **required** row whose eligibility condition is unsatisfiable is filtered out, so it cannot be force-selected (the generator's `required` list is built from `eligible`). This may shrink `|R|` below `minBound` ⇒ deterministic `PoolBelowMinimum`, or empty `E` ⇒ `NoEligible*.` There is **no retry, no fallback, no relaxed re-evaluation** — that would break determinism. The correct place to catch this is **publish time** (Phase 26) and, defensively, Phase 13 constraint validation: a required row must carry only conditions satisfiable within its own snapshot, or the content is invalid. This is the Phase 12 TODO step 5 ("Remove invalid characters") made explicit: eligibility conditions _are_ the invalidity filter, and an unsatisfiable required condition is a content error, not a runtime coin-flip.

---

## 18. Determinism and Seeded Behavior

- Determinism is inherited from Phase 6–10: the PRNG (`cyrb128`+`mulberry32`), the canonical ordering `(priority ASC, id ASC)`, and the fixed draw order are untouched.
- Rule evaluation adds **no randomness**: `evaluateRule` is pure; `eligibilityFilter` is pure; building the context is pure.
- The evaluator never reads wall-clock time, DB, network, instance state, or global mutable state — `GenerationContext` is constructed only from the snapshot and settled pipeline output.
- Same (published template version, seed, evaluated conditions) ⇒ identical generated characters/items/documents/evidence. Different seed ⇒ may differ.
- Evaluation must be **stable across runs**: the Phase 12 predicate is derived from the snapshot each run; a content change (a condition edit) changes results only through the pool membership path, never through reordering.
- Golden regression tests (Phase 6–10) must continue to pass **unchanged**, because empty `conditions` ≡ no filter, and no generator behavior is modified.

---

## 19. Discovery Conditions

Class B gates **when an evidence can be found during play** — distinct from selection (the evidence may already be in the generated set) and from availability (it may be present but undiscoverable until a condition holds).

- Carrier: `case_evidence.discovery_condition` / `location_evidence.discovery_condition` (single record, nullable; `null` = always discoverable via its `discovery_method`).
- Evaluated at runtime (Phase 14/36) when the player attempts discovery: `evaluateDiscovery(parseRulePayload(row.discovery_condition)[0], runtimeContext)`.
- Worked example 3: `fake_invoice_detected` evidence carries `discovery_condition: { op: 'equals', path: 'fake_invoice', value: true }`. While the player has not inspected the fake invoice, `runtimeContext.get('fake_invoice')` is `false`/`undefined` ⇒ the evidence cannot be discovered; once the inspection action sets the runtime flag, it becomes discoverable.
- **Not evaluated at generation.** Phase 10/6–9 output never includes discovery evaluation; the generated evidence set is fixed at generation, discovery state is instance state (Phase 14).
- A `discovery_condition` that can never be satisfied (referencing a flag no action ever sets) is a **publish-time error** (Phase 26, §39) — the evidence would be permanently undiscoverable.

---

## 20. Availability Conditions

Class C determines **whether an entity is obtainable/exposed at all**. It has two layers, with explicit precedence:

1. **Static data (author-time, no evaluation):** `location_*.availability` boolean (default `true`), `case_items.hidden` / `case_documents.hidden` boolean, `case_evidence.role = 'hidden'` / `'decoy'`. These are **data, not rules** (R4; no new enum). Phase 11 does not convert them into rules — that would duplicate signal (Phase 10 §4/§7 reasoning applies).
2. **Dynamic rules (runtime):** relation `conditions` re-evaluated against the `RuntimeContext` can additionally gate availability mid-play (e.g. an item appears in a location only after a dialogue flag). Precedence: `availability = false` ⇒ **never available regardless of rules**; `availability = true` ⇒ rules (if any) further gate.

Entry point: `evaluateAvailability(availability, conditions, runtimeContext) = availability && evaluateRuntime(conditions, runtimeContext)`.

**Generation vs runtime:** at generation (class A) the same `conditions` gate _selection_; at runtime (class C) they gate _exposure_. The payload is shared; the entry point and context differ. This is deliberate — one authored rule serves both, with class-specific semantics documented in §11.

---

## 21. Runtime and Gameplay Conditions

Class D drives gameplay decisions from the Case Engine (Phase 36) and is never invoked at generation:

- **Mission completion:** `missions.completion_condition` (single rule object) evaluated against the runtime context when a mission is checked. `{}` ⇒ no condition (completes unconditionally / driven by engine).
- **Dialogue branching:** `dialogue_nodes.conditions` / `dialogue_node_choices.conditions` (array) gate whether a node/choice is available; `actions` are rule-shaped payloads whose _execution_ (effect application) is Phase 14/36/37 (they are read by Phase 11's parser/evaluator only insofar as actions carry rule-shaped payloads; execution is out of scope).
- **`previousDecision`** is class-D only: it requires instance decision history, which does not exist at generation. A payload using it in a generation-eligibility context is a publish-time validation error (§39) — the parser accepts the shape, the validator rejects the placement.

---

## 22. Versioning Strategy

- Rule payloads version **with their carrier row**, exactly as in Phases 6–10: `case_*`/`location_*` rows carry `version` pinned to `cases.version` (R2); missions/dialogues carry their own content `version`. No new version columns.
- A condition edit is a content edit: it bumps the carrier's version (and, for relations, the template version), and the next generation run reads the new payload under the new pin. `VersionMismatch` remains the deterministic guard against mixed-version snapshots.
- The evaluator itself is version-agnostic: it reads whatever payload the pinned snapshot contains. Determinism therefore means "same pinned payload + seed ⇒ same output."
- Phase 11 adds no versioning machinery.

---

## 23. Failure Modes and Validation

Rule _evaluation_ never throws: every operator returns a boolean, and impossible evaluations return `false` (deterministic false, not silent true). Errors are concentrated in two deterministic boundaries:

| Boundary                | Error                                                                                                                                         | Trigger                                                                                                                                                            |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Parser (§14)            | `InvalidRule`                                                                                                                                 | unknown `op`; missing/incorrect fields; wrong arity; non-object element; unknown JSONB key                                                                         |
| Publish validator (§39) | `UnsatizableRequiredCondition`, `UnknownPath`, `UnknownRef`, `DisallowedClassOp` (e.g. `previousDecision` in class A), `AlwaysFalseDiscovery` | unsatisfiable required-row condition; path/ref never resolvable in the class context; class-inappropriate operator; discovery condition that can never become true |

Null/missing-value semantics (core, matching §11.1):

- `context.get(path) === undefined` (unknown path in the closed vocabulary, or a scalar path with a null value) ⇒ `equals` false (unless `value === undefined`), `greaterThan`/`lessThan` false, `contains` false.
- Type mismatch (`value` is a string, resolved value is a number) ⇒ `false` for comparisons; `greaterThan`/`lessThan` compare numbers or numeric strings only (no coercion).
- `hasItem`/`hasEvidence` with an unknown `ref` ⇒ `false` at runtime; a **publish-time warning** if no entity named/identified by `ref` exists.
- `characterRole`/`locationType`/`difficulty`/`previousDecision` with no resolvable value (no active character, no current location, `null` difficulty, no decision recorded) ⇒ `false`.
- `and`/`or` short-circuit (safe: no side effects); `not` negates.
- Empty payload (`[]`/`{}`/`null`) ⇒ `true` (all eligible / always available) — preserves Phase 6–10 behavior (§14).

All parse/validation errors are data-driven and report the offending payload and carrier, so authors can fix content rather than debug silent misbehavior.

---

## 24. Phase 6 Interaction (Character Selection)

- `case_characters.conditions` becomes a class-A gate via `eligibilityFilter` on `selectCharacters` (hook at `selection.ts:43`). The hook already runs before draw #1 and consumes no PRNG.
- A required character with a failing condition drops out of `R` ⇒ shrinks `lower`; if `E` empties ⇒ `NoEligibleCharacters`; if `|E| < minCharacters` ⇒ `PoolBelowMinimum`. No retry (Phase 6 §3.1 publish-time rule stands; Phase 11 extends it to conditions).
- `characterRole` at generation resolves against the settled character set (`case_characters.role`, free text R4).
- No changes to `selection.ts` internals; `conditions` remains on `CharacterSelectionCandidate` (already present, `types.ts:14`).

---

## 25. Phase 7 Interaction (Item Selection)

- `case_items.conditions` gates `selectItems` via `eligibilityFilter` (`item-selection.ts:46`); `case_items.hidden`/`discovery_method` stay passive instance config (unchanged).
- Quantity generation is untouched: per-item `min_quantity`/`max_quantity` draws happen after selection, in canonical order, exactly as today (`item-selection.ts:100–108`); conditions never reorder or re-draw quantities.
- Generation-time `hasItem('x')`/`hasEvidence('x')` resolves against the settled item/evidence sets of earlier pipeline steps — enabling example 1 (`IF item == phone`) when items settle before evidence.

---

## 26. Phase 8 Interaction (Case Item Pool)

- `case_items` _is_ the case item pool (audit R1); conditions already live on it. Phase 11 adds evaluation; nothing is duplicated into a separate pool table.
- The `hidden` bool and `discovery_method` remain availability/discovery data, not rules (consistent with Phase 8's own framing of them as carried configuration).

---

## 27. Phase 9 Interaction (Document Selection)

- `case_documents.conditions` gates `selectDocuments` via `eligibilityFilter` (`document-selection.ts:45`).
- Worked example 2 (`IF character.role == businessman THEN allow document == invoice`) is a class-A rule on `invoice`'s `conditions`.
- `role` (real/fake/decoy) and `hidden` remain passive carried classification (Phase 9); conditions do not change role semantics.

---

## 28. Phase 10 Interaction (Evidence Selection)

- `case_evidence.conditions` gates `selectEvidence` via `eligibilityFilter` (`evidence-selection.ts:52`); `role === 'required'` remains the only role-derived selection input (Phase 10 §9.1). A required-role evidence whose `conditions` fail drops out of `R` and `E` (§17).
- Worked example 1 (`IF item == phone THEN allow evidence == imei_mismatch`) is a class-A rule on `imei_mismatch`'s `conditions`.
- `discovery_condition` is **not** consumed by `selectEvidence` — it is class B (runtime), evaluated by `evaluateDiscovery` (Phase 14). Phase 10's boundary ("deferred to Phase 11, opaque to selection") is now fully resolved: selection never evaluates discovery.
- `GeneratedEvidence` output is unchanged (`evidenceId`, `role`, `importance`, `discoveryMethod`); no condition output is added.

---

## 29. Phase 12 Interaction (Generation Pipeline)

- Phase 12 builds `GenerationContext` from the version-pinned snapshot + settled earlier-step output; builds per-pool eligibility predicates (§15.3); passes them as `eligibilityFilter` to all four `select*` calls.
- Pipeline selection order becomes dependency-aware so class-A `hasItem`/`hasEvidence`/`characterRole` resolve correctly: characters → items → documents → evidence (documented contract; exact ordering is a Phase 12 decision that must precede evidence/document gating).
- Phase 12 TODO step 5 ("Remove invalid characters") is realized as: parse each row's `conditions`; rows whose conditions fail are invalid and removed from the pool — with the deterministic errors of §17 for unsatisfiable required rows (surface as Phase 13 constraint failures / Phase 26 publish errors, never silent).
- Phase 12 seeds the pipeline, calls the generators, and persists results exactly as designed in Phases 6–10; Phase 11 adds only the predicate construction and context building.

---

## 30. Phase 13 Interaction (Constraint Validation)

- Phase 13 ("generation must NEVER produce an impossible case") must be satisfied **with** conditions, not by relaxing them. If a required row is gated by a condition unsatisfiable within the snapshot, Phase 13 reports the case as ungeneratable (no retry-with-relaxed-conditions — that would break determinism and could produce a solvable-but-wrong case).
- The existing retry mechanism must re-roll with a **new seed only** (never re-evaluate conditions differently). Deterministic contract: same seed ⇒ same outcome including condition outcomes.
- Publish-time validation (Phase 26) is the primary guard; Phase 13 is the defensive backstop, mirroring Phase 6 §3.1's "publish-time + generator backstop" pattern.

---

## 31. Phase 14 Interaction (Case Instance)

- The Case Instance stores the generated set + `seed` + decisions + status (TODO §14). **Instance state is runtime state only**; generation-time rule evaluation never reads it (§13 boundary).
- Phase 14/36 builds `RuntimeContext` from the instance and player state, enabling `evaluateDiscovery` (B), `evaluateAvailability` (C), and `evaluateRuntime` (D).
- Runtime flags (e.g. `fake_invoice`) live as instance runtime state, set by actions/engine; the evaluator only reads them.
- `hidden`/`decoy` derived from `role` (Phase 10 §16), availability from `availability`/`hidden`, discovery from `discovery_condition` — three separate mechanisms, three separate evaluation paths.

---

## 32. Phase 26 Interaction (Content Validation)

Phase 26 adds publish-time rule checks (TODO §26 "Validate impossible rules"). The exact list of hooks is specified in §39: malformed rules (`InvalidRule`), unknown paths (`UnknownPath`), unknown entity refs (warn), disallowed operators for a class (`DisallowedClassOp`), impossible required conditions, always-false discovery, and solvability. Each hook runs over every released payload; Phase 11 provides the parser and evaluator the hooks call but implements none of the publish gating.

---

## 33. Phase 36 / 37 Interaction (Case Engine / Gameplay)

- Phase 36 (Case Engine) owns generation orchestration (Phase 12 pipeline) and runtime evaluation: it constructs `RuntimeContext`, calls `evaluateDiscovery`/`evaluateAvailability`/`evaluateRuntime`, and drives dialogue branches and mission completion through class D.
- Phase 11 provides the evaluation primitives; the Case Engine decides _when_ to call them. Rule evaluation stays in `packages/game-rules`; the engine never reimplements operators.
- Dialogue `actions` execution (setting `fake_invoice = true`, granting items, unlocking nodes) is the engine's responsibility; Phase 11's parser already accepts action payloads as rule-shaped data so the engine can validate them at publish time.

---

## 34. Proposed Code and Package Changes

All changes are **Phase 11 build-step** work (this document only specifies them):

`packages/game-rules` (new):

- `src/rules/ast.ts` — moves/re-exports the existing `Rule` union, `RULE_OPERATORS`, `RuleOperator` from `src/index.ts` (index re-exports; public API unchanged).
- `src/rules/context.ts` — `RuleContext` shared resolver surface; nominally branded `GenerationContext` (`kind: 'generation'`) and `RuntimeContext` (`kind: 'runtime'`); `buildGenerationContext`/`buildRuntimeContext` (builders filled by Phase 12/14, interface + brand + base resolution here).
- `src/rules/parse.ts` — `parseRulePayload`, `parseRuleArray`, `InvalidRule` error, `UnknownPath` guard for the §12.1 closed vocabulary.
- `src/rules/evaluate.ts` — `evaluateRule`, `evaluateRules`, `evaluateEligibility`, `evaluateDiscovery`, `evaluateAvailability`, `evaluateRuntime` (§13/§15).
- `src/rules/index.ts` — re-export; update `src/index.ts` to re-export `./rules/index.js`.
- Update package `description` (drop "ships in Phase 11").

`packages/content-schema` (Phase 11 build step):

- Add a zod `ruleSchema` mirroring the `Rule` union; update `relationConditionsSchema`, `rulePayloadSchema`, and mission `completionCondition` to validate via `z.union([ruleSchema, z.array(ruleSchema)])` (both carrier shapes remain valid, §14).

`packages/shared-types` (Phase 11 build step, if needed):

- Keep `conditions: unknown[]` / `discoveryCondition: unknown` as-is **unless** the Phase 11 build step upgrades them to `Rule[]`/`Rule`. Recommendation: upgrade to `Rule[]`/`Rule` once the AST is imported from `@gate8/game-rules` — but this is an implementation-step decision, not required by this design; existing `unknown` typing is forward-compatible.

`backend`/Admin/Mobile: **no changes.** No migration, no Admin UI, no Mobile UI.

---

## 35. Testing Strategy

Design-level plan for the Phase 11 build step (no tests written in this document):

- **Evaluator unit tests:** every operator; nesting (`and`/`or`/`not`); short-circuiting; missing-path ⇒ false; type mismatch ⇒ false; numeric-string comparisons; `contains` on strings and arrays; empty payload ⇒ true.
- **Class semantics tests:** `hasItem`/`hasEvidence`/`characterRole`/`previousDecision` resolution differs per class; generation contexts reject runtime-only operators at parse/validation.
- **Parser tests:** array vs object vs `null` shape; `[]`/`{}`/`null` ⇒ no rules ⇒ `true`; `[r1, r2]` ⇒ implicit AND (never OR/NOT inferred); explicit `GroupRule`/`NotRule` nesting; every malformed case → `InvalidRule`; unknown `path` → `UnknownPath`.
- **Context isolation tests:** a `RuntimeContext` is a compile-time error where a `GenerationContext` is expected (branded `kind`); generation evaluation never reads player state; `previousDecision`/player-inventory `hasItem` are `false` at generation and `true`-reachable only at runtime.
- **Path-vocabulary tests:** each §12.1 path resolves as specified (scalar vs existence); collection paths match the worked examples; out-of-vocabulary paths → `UnknownPath`/`false`.
- **Determinism + golden tests:** fixed seed + fixed snapshot (with conditions) ⇒ identical output, pinned; **unchanged Phase 6–10 golden tests must pass unmodified** (empty conditions ≡ no filter).
- **Eligibility-integration tests** (per generator): conditions narrow the pool; the PRNG draw count and order are identical for a fixed eligible pool with and without a filter; `NoEligible*` / `PoolBelowMinimum` / `RequiredExceedsMax` surface for unsatisfiable required rows.
- **Worked-example tests:** the three TODO examples authored as payloads evaluate as specified (example 1/2 at generation; example 3 at runtime).
- **Property-based (fast-check, per Phase 6 recommendation):** random snapshots + random conditions + random seeds must satisfy required ⊆ output, uniqueness, `lower ≤ |output| ≤ upper`, determinism.

---

## 36. Migration Strategy

- **No migration.** The design touches zero SQL. All rule storage already exists as JSONB (§3); the shape inconsistency is resolved in the type layer (§14). The `supabase db reset` baseline (0001–0016) is unaffected.
- No enum changes: rule operators live only in the `RULE_OPERATORS` const and the `Rule` union in `packages/game-rules` (R4).
- If a future phase needs to persist evaluated rule state (e.g. runtime flags), that is Case Instance state in Phase 14 — not Phase 11.

---

## 37. Deferred Features

Deliberately out of Phase 11 scope (designed here, implemented elsewhere):

- Evaluator implementation + tests (Phase 11 build step, not this document).
- Pipeline integration: `GenerationContext` builder, per-pool predicate wiring, dependency-ordered selection (Phase 12).
- Constraint validation with conditions; seed-only retry semantics (Phase 13).
- Case Instance + `RuntimeContext` builder; discovery/availability/runtime evaluation wiring (Phase 14 / Phase 36).
- Dialogue **action** execution (effects: set flags, grant items, unlock nodes) — the parser accepts action payloads, the execution engine is Phase 36/37.
- Publish-time rule validation: `InvalidRule`, `DisallowedClassOp`, unknown path/ref, unsatisfiable required rows, always-false discovery, solvability (Phase 26).
- Authoring UX for conditions in the Admin UI and any Mobile UI presentation (later phases; Phase 21 lists evidence "Conditions/Dependencies").
- Rule operator extensions (new operators are content-breaking; require AST + parser + schema change, gated by Phase 26 validation).

---

## 38. Risks and Architectural Concerns

- **Semantic conflation (highest risk).** A single blind evaluator would let `previousDecision`, player-inventory `hasItem`, or runtime flags silently mean something (or nothing) at generation. Mitigation: separate typed entry points per class with **nominally branded** context types (§13/§15.1, D9), plus Phase 26 `DisallowedClassOp` checks (§39).
- **`hasItem`/`hasEvidence` ambiguity.** The same operator means "case contains X" at generation and "player holds X" at runtime. Mitigation: the §11.1 exact contracts and the distinct contexts make the meaning explicit; nominal branding (D9) makes mixing impossible; documented in §11.1/§19/§21.
- **Eligibility shrinking the pool.** Conditions can make generation fail (`PoolBelowMinimum`, `NoEligible*`) or drop required rows. Mitigation: deterministic errors (never silent fallback), publish-time checks (§39), Phase 13 backstop; authors are told a required row's conditions must be satisfiable.
- **Determinism regressions.** Any change to draw order, canonical ordering, or pool semantics is breaking. Mitigation: the filter-runs-before-draw-#1 property (§17), unchanged golden tests (§35), and the explicit "conditions never call the PRNG" rule.
- **Shape mismatch (array vs object).** Mission `completion_condition` is an object while relations/dialogue are arrays. Mitigation: the §14 normalizer accepts both; content-schema validates both forms.
- **Static availability vs rules.** Converting `availability`/`hidden`/`role` into rules would duplicate signal (Phase 10 §7 reasoning). Mitigation: they stay data; rules only add gating (§20).
- **Over-design.** The phase is a small pure library over an already-declared AST. Mitigation: no new dependencies, no new tables, entry points stay minimal; the package's dependency-free, pure-function style is preserved.

---

## 39. Publish-Time Validation (Phase 26 preview)

The validator that Phase 26 will implement, specified now so the design is complete. It is a list of **hooks**, each run over every released payload; Phase 11 defines only the parser/evaluator they call:

1. **Malformed rules:** parse every rule payload in the release; collect every `InvalidRule` (unknown `op`, wrong arity, non-object element, empty `and`/`or`, unknown JSONB key) — blocks publish.
2. **Unknown paths:** for every `ComparisonRule`, verify `path` is in the §12.1 closed vocabulary for its class; `UnknownPath` blocks publish.
3. **Unknown entity references:** for every `hasItem`/`hasEvidence` `ref`, verify an entity named/identified by `ref` exists in the release; warn if unresolved.
4. **Disallowed operators for a class:** verify every operator is class-legal for its carrier; `previousDecision` (and player-inventory operators) in class A, or player-state `hasItem` at generation, blocks publish (`DisallowedClassOp`).
5. **Impossible required conditions:** evaluate each required row's class-A conditions over the maximal snapshot (all rows eligible); a required row that can never be eligible blocks publish (prevents the §17 shrink/`PoolBelowMinimum` class of runtime failures).
6. **Unreachable content / always-false discovery:** verify each `discovery_condition`'s referenced flags can be set by some action/engine path; permanently-unreachable evidence blocks publish.
7. **Solvability (TODO §26 "Validate case solvability"):** prove a satisfiable world under the rules (at least one suspect, at least one critical evidence, required documents/characters/items reachable) — the Phase 13 rule set, checked against evaluated eligibility.

A template failing any of these is rejected before publish; no silent content reaches players.

---

## 40. Decision Log

| #   | Decision                                                                                 | Rationale                                                                                  |
| --- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| D1  | One pure evaluation core over the shared `Rule` AST                                      | No duplicated operator logic across four classes                                           |
| D2  | Separate typed entry points + contexts per condition class                               | Makes conflation (A/B/C/D) structurally impossible                                         |
| D3  | Class A wired through the existing `eligibilityFilter` before draw #1                    | Reuses the Phase 6–10 hook; zero PRNG consumption; contract preserved                      |
| D4  | No retry / no relaxed fallback for unsatisfiable conditions                              | Preserves determinism; errors surface at Phase 13/26                                       |
| D5  | `availability`/`hidden`/`role` stay static data; rules only add gating                   | Avoids duplicating existing signal (Phase 10 §7)                                           |
| D6  | Normalizer accepts both single-object and array payloads                                 | Resolves the mission-vs-relation shape mismatch without a migration                        |
| D7  | Missing path / type mismatch ⇒ deterministic `false`                                     | No silent true; publish validator reports root cause                                       |
| D8  | No migration, no new tables, no new SQL enums                                            | All storage exists; R4 respected                                                           |
| D9  | **Nominally branded contexts** (`GenerationContext.kind` vs `RuntimeContext.kind`)       | Structural typing would otherwise allow cross-class call misuse (§13)                      |
| D10 | **Closed path vocabulary** (§12.1) instead of free object-path traversal                 | Review point 6: no arbitrary `a.b.c` access; explicit scalars + existence collection paths |
| D11 | Array payload is **always** implicit AND; OR/NOT only via explicit `GroupRule`/`NotRule` | Grouping is never inferred; malformed is `InvalidRule`, never coerced to `true` (§14)      |

---

## Self-Review

- [x] Global constraints stated (one AST, four entry points, no tables/enums, no new sources of truth, determinism preserved, no AI/UI).
- [x] All 42 required sections present in order (objective → decision log).
- [x] §9 separates generation eligibility (A), discovery (B), availability (C), runtime/gameplay (D); never conflated.
- [x] §11.1 exact operator contracts: operand types, context fields, generation/runtime meanings, missing/type-mismatch/unknown-ref/array behavior for all 13 operators.
- [x] §12.1 closed path vocabulary (scalar vs existence collection paths; no arbitrary traversal); §12.2 runtime flag paths.
- [x] §13 answers the evaluator question: one core + shared AST, separate per-class APIs/contexts with **nominal branding** (D9).
- [x] §14 exact normalization: `[]`/`{}`/`null` ⇒ true; array ⇒ implicit AND only (D11); malformed ⇒ `InvalidRule`.
- [x] §15.1 branded context types; `RuleContext` is not a public entry-point parameter.
- [x] §17 proves conditions' effect on required/optional/bounds/PRNG with file:line refs and the **zero-PRNG-draw proof** (D3).
- [x] §5/§36 verdict: no migration required.
- [x] §34 lists proposed code/package changes; none touch the DB, Admin, or Mobile.
- [x] §35 testing strategy defined (for the Phase 11 build step); §39 seven named publish-validation hooks (Phase 26-only).
- [x] §37 deferred features explicit (runtime action execution, pipeline, instance, publish validator, UI).
- [x] §38 risks + mitigations; §39 publish-time validation; §40 decision log incl. D9–D11.
- [x] Review point coverage: (1) gen/runtime hasItem semantics §11.1; (2) normalization §14; (3) 13 operator contracts §11.1; (4) zero-PRNG proof §17; (5) context isolation/branding §13/§15.1; (6) resolver/vocabulary §12; (7) required-condition failure §17; (8) publish hooks §39; (9) backward compat `[]`/`{}` §14; (10) resolved ambiguities §41.
- [x] TODO §11 / §11.1 (13 operators) fully covered; Phase 12/13/14/26/36 roadmap items confirmed in TODO.md (§475–508, §512+, §948+, §1172+).
- [x] No code, migration, shared-types, content-schema, Admin, or Mobile change made by this document.

---

## 41. Review Resolution (2026-08-13)

Outcome of the final architecture review; each item marks an ambiguity or a confirmation:

1. **`hasItem`/`hasEvidence` semantics** — Confirmed & tightened. Generation = settled-case membership (item/evidence `id`/`name`); runtime = player possession/discovery. Enforced structurally: nominal `kind` branding (§13, D9) makes a cross-class call a compile error. Resolved in §11.1.
2. **Conditions normalization** — Made fully explicit (§14, D11): `[]` ⇒ true, `[r1,r2]` ⇒ implicit AND (never OR/NOT inferred — grouping only via explicit `GroupRule`/`NotRule`), `{}`/`null` ⇒ true, malformed ⇒ `InvalidRule` (never coerced to `true`).
3. **Operator semantics** — Added §11.1 exact contract table for all 13 operators (operand types, context fields, generation/runtime meaning, missing-value, type-mismatch, unknown-ref, arrays).
4. **Determinism** — Proven (§17) with verified file:line refs: `eligibilityFilter` runs before the first `rng.*` call and receives only the candidate (no rng access); rule evaluation consumes zero PRNG draws. Existing golden tests already cover the filter and remain unmodified.
5. **Context isolation** — Real gap found & fixed: §15.1 previously described unbranded marker types, which structural typing would allow to interconvert. Now `GenerationContext`/`RuntimeContext` carry disjoint `kind` discriminants; `RuleContext` is not a public entry-point parameter (D9).
6. **Resolver behavior** — Added a **closed path vocabulary** (§12.1): scalar paths (`case.difficulty`, `location.type`, `previousDecision`) vs existence collection paths (`character.role`, `character.occupation`, `item.id/name`, `document.role`, `evidence.role/importance`); out-of-vocabulary paths are `UnknownPath`. No arbitrary `a.b.c` object traversal (D10). Runtime dot-free flags are the only dynamic paths (§12.2).
7. **Required-condition failure** — Confirmed (§17): a required row with a false condition drops out of `E`/`R` ⇒ deterministic `PoolBelowMinimum`/`NoEligible*`/`RequiredExceedsMax`; no retry, no relaxed re-evaluation, no silent inclusion. Publish-time (Phase 26 hook 5) + Phase 13 backstop.
8. **Publish-time validation** — Specified §39 as seven named hooks (malformed → unknown path → unknown ref → disallowed class op → impossible required → unreachable/always-false discovery → solvability); Phase 11 implements only the parser/evaluator they call.
9. **Backward compatibility** — Confirmed (§14/§17/§23): empty `[]`/`{}`/`null` evaluate `true` ⇒ Phase 6–10 seeded behavior is byte-identical; golden tests unchanged.
10. **Document updates** — All resolved decisions written back: §11.1, §12.1, §12.2, §13, §14, §15.1, §15.2, §17, §23, §32, §34, §35, §39, §40 (D9–D11), §41.

No code, migration, content-schema, shared-types, Admin, or Mobile change was made during this review.

---

## Conclusion

Phase 11 (Rule / Condition Engine) requires **no schema change and no new tables**: every condition already lives in existing JSONB columns, and the `Rule` union — the AST — is already declared in `@gate8/game-rules`. The design resolves the one architectural question (one evaluator or several) as **one pure evaluation core over the shared AST, exposed through four class-specific entry points and nominally branded contexts**, so generation eligibility, discovery, availability, and runtime/gameplay semantics are data-driven, deterministic, and impossible to conflate at compile time. Generation eligibility plugs into the Phase 6–10 `eligibilityFilter` hooks before draw #1, consuming zero PRNG draws and preserving the seeded deterministic contract byte-for-byte for unchanged content. The final review tightened five areas — §11.1 exact operator contracts, §12.1/12.2 closed path vocabulary, §13/§15.1 nominal context branding, §14 array-is-always-AND normalization, and §39 named publish-validation hooks (§41) — with no change to the schema or generator contract. Implementation belongs in `packages/game-rules` (`src/rules/`: ast, context, parse, evaluate, index) in the Phase 11 build step, with content-schema validation upgraded in the same step; this document freezes the contract.
