# Phase 12 — Seeded Generation Pipeline Design

> **Status:** DESIGN — for review (design-only; nothing implemented, migrated, or committed). This document specifies the deterministic seeded Case Generation Pipeline that composes the Phase 6–10 generators (`selectCharacters`, `selectItems`, `selectDocuments`, `selectEvidence`) and the Phase 11 rule engine into one reproducible `generateCase(snapshot, seed)` operation. No database, migration, shared-types, content-schema, game-rules implementation, Admin, or Mobile change is made by this document.

**Goal:** Design one pure, deterministic, typed, atomic pipeline that turns a version-pinned content snapshot plus a seed into a complete generated case (characters, items, documents, evidence), with a precisely specified seed namespace, validation order, failure behavior, and extensibility path — while preserving the Phase 6–10 draw contracts byte-for-byte.

**Architecture:** A pure two-phase function in `packages/game-rules`: **Phase 1 snapshot validation** (template bounds, version pinning across all four pools, condition parsing) that fails fast with typed errors before any PRNG exists; then **Phase 2 dependency-ordered generation** (characters → items → documents → evidence) where each step builds a fresh per-step `GenerationContext` from the snapshot plus settled earlier-step output and passes a per-pool eligibility predicate into the existing `eligibilityFilter` hook (runs before draw #1, zero PRNG draws). Each generator receives a **domain-separated derived seed** — `hash(seed ∥ domain)` — so streams are independent, decorrelated, and insertion of future generators never perturbs existing outputs. No Case Instance persistence.

**Tech Stack:** TypeScript (pure functions), the existing `createSeededRandom`/`cyrb128`/`mulberry32` PRNG, the Phase 11 `parseRulePayload`/`evaluateEligibility`/`buildGenerationContext` API, and the existing four generators. No new dependencies, no new tables, no migration.

## Global Constraints (Phase 12)

- **Determinism is the contract:** same (snapshot, seed) ⇒ identical generated case, including exact PRNG draw sequence. No wall clock, no DB reads mid-generation, no uncontrolled randomness.
- **Preserve the Phase 6–10 generator contracts unchanged:** draw order, canonical ordering `(priority ASC, id ASC)`, bounds semantics (`0` = no bound), error discriminants, and the `eligibilityFilter`-before-draw-#1 property. Golden tests must keep passing unmodified.
- **Zero PRNG consumption by rule evaluation:** eligibility predicates are pure; filtering never calls `rng.*` (Phase 11 §17).
- **Atomicity:** the pipeline returns either a complete valid `GeneratedCase` or a deterministic typed error — never a partial case.
- **Version pinning:** every relation row's `version` must equal `templateVersion`; a mismatch fails deterministically before generation.
- **Only class A (generation eligibility) executes.** Discovery (B), availability (C), and runtime (D) conditions never evaluate during generation.
- **Pure function boundary:** `generateCase` takes a fully-loaded immutable snapshot as input. DB access, auth, persistence, and seed generation live outside the pure layer (seed generation is Phase 14; persistence is Phase 14; the loader is a caller concern).
- **No migration, no new tables** (Case Instance is Phase 14). No new SQL enums (R4). No AI/Admin/Mobile work.
- **Seed namespace is domain-separated** (Decision D1 below): future generators insert without changing existing results.

---

## 1. Verified Context (from the repository, not assumptions)

All contracts below were verified by reading the actual code at `0558e63`:

- **PRNG** (`src/generation/prng.ts`): `createSeededRandom(seed: string)` derives `mulberry32(cyrb128(seed)[0])`; exposes `float()` ∈ [0,1) and `int(bound)`. **No fork/split/clone primitive exists.** Each generator creates its own stream from its own `seed` string.
- **Draw sequence per generator** (the contract):
  - Draw #1 (count): `target = lower + rng.int(upper - lower + 1)` where `lower = max(minBound, |required|)`, `upper = maxBound > 0 ? min(maxBound, |E|) : |E|`.
  - One `rng.float()` per optional slot (weighted pick without replacement, canonical order).
  - Items only, AFTER selection: one `rng.int` per selected item for quantity (`drawQuantity`, `item-selection.ts:100–108`).
  - Draw sequence is part of the contract and pinned by golden tests (seed `'case-demo-seed-123'` in each of `test/generation/*.test.ts`).
- **`eligibilityFilter` hook** (all four generators, verified): runs as `const eligible = input.eligibilityFilter ? canonical.filter(input.eligibilityFilter) : canonical;` — **after** `canonicalOrder` and **before** draw #1. Signature `(candidate) => boolean`. Evidence candidates carry **no** `conditions` field; evidence conditions resolve via an external `Map<evidenceId, conditions>` (`test/rules/eligibility.test.ts:212`).
- **Errors** are returned as discriminated unions `{ ok: false, error }`, never thrown: `InvalidBounds`, `VersionMismatch`, `Duplicate*`, `InvalidWeight`, `InvalidQuantityBounds` (items only), `NoEligible*`, `PoolBelowMinimum`, `RequiredExceedsMax`, `InsufficientPool`. Deterministic, data-carrying.
- **Rule engine** (Phase 11): `parseRulePayload(payload)` (normalizes `[]`/`{}`/`null` ⇒ no rules; **throws `InvalidRule`** on malformed payloads), `evaluateEligibility(conditions, ctx: GenerationContext)`, `buildGenerationContext(data: GenerationContextData)`. `GenerationContextData` requires `difficulty`, `type`, `characters[] {id, role, occupation}`, `items[] {id, name}`, `documents[] {id, role}`, `evidence[] {id, name, role, importance}`.
- **Entity tables** provide the context metadata the candidate rows omit: `characters.occupation`, `items.name`, `evidence.name` (migrations 0003–0006). The snapshot must therefore join these columns.
- **Schema** (`cases` + `case_characters`/`case_items`/`case_documents`/`case_evidence`): each relation row carries `version`, `weight`, `priority`, `conditions` (jsonb, default `[]`); `case_evidence` also carries `discovery_condition` (nullable) and `role`/`importance`. No generated-case table exists (Case Instance is Phase 14).
- **TODO §12** (lines 512–579) describes "Random Generation Engine" with subsections 12.1 Seed, 12.2 Character, 12.3 Item, 12.4 Document, 12.5 Evidence. Several bullets (seed generation, per-character item pools, character-linked documents, retry, evidence-from-discovered-content) are **not** satisfiable by a case-level pipeline and are deferred (see §17).

---

## 2. Pipeline Overview

```
CaseTemplateSnapshot (immutable, fully loaded, version-pinned)
        │
        ▼
┌────────────────────────────────────────────────────────────────┐
│ Phase 1 — Snapshot Validation (pure, no PRNG created)           │
│  1. template bounds (min≥0, max≥0, bounded min≤max, version>0)   │
│  2. version pinning: every row.version === snapshot.templateVersion
│  3. condition parse: every row's conditions → Rule[] (else InvalidRule)
│  → first deterministic error in fixed order ⇒ return {ok:false}  │
└────────────────────────────────────────────────────────────────┘
        │ ok
        ▼
┌────────────────────────────────────────────────────────────────┐
│ Phase 2 — Generation (dependency-ordered, per-step context)     │
│                                                                │
│  seed' = deriveDomainSeed(seed, "characters")                  │
│  step 1: selectCharacters({…, seed: seed', eligibilityFilter})  │
│           ↓ characters (settled)                               │
│  seed' = deriveDomainSeed(seed, "items")                       │
│  step 2: selectItems({…, seed: seed', eligibilityFilter})       │
│           ↓ items (settled)                                    │
│  seed' = deriveDomainSeed(seed, "documents")                   │
│  step 3: selectDocuments({…, seed: seed', eligibilityFilter})   │
│           ↓ documents (settled)                                │
│  seed' = deriveDomainSeed(seed, "evidence")                    │
│  step 4: selectEvidence({…, seed: seed', eligibilityFilter})    │
│           ↓ evidence (settled)                                 │
│  assemble GeneratedCase                                        │
└────────────────────────────────────────────────────────────────┘
        │
        ▼
GeneratedCase | GenerationPipelineError (never partial)
```

The user's objective diagram (Case Template → Pinned version → Seed → Eligibility evaluation → Character → Item → Document → Evidence → Generated Case) is satisfied exactly: eligibility evaluation happens per step, immediately before that step's generator, using the per-step context.

---

## 3. Seed Handling and Stream Strategy (Decision D1)

This is the highest-risk design decision. The three candidate strategies:

### A. One shared PRNG stream

`const rng = createSeededRandom(seed)` threaded through all four generators.

- **Would require changing the generator contracts** (they currently accept `seed: string` and construct their own stream — `selection.ts:40`, `item-selection.ts:43`, etc.). Threading a shared `SeededRandom` through them (or adding it to the input type) breaks the existing input shapes and golden tests.
- **Extensibility failure:** inserting a future generator (e.g., dialogue generation) _before_ evidence changes evidence's draw position ⇒ silently changes existing evidence output. Violates requirement 11/2/13.
- **Correlation hazard:** even a naive "pass the same seed string to all four" (no code change) makes all four streams **identical**, so draw #1 (count) of every class uses the same PRNG value — strong cross-class correlation.
- **Verdict: rejected.**

### B. Deterministic sub-streams (forked)

`seed → character stream → item stream → document stream → evidence stream` via a PRNG fork/split primitive.

- **No fork primitive exists** in `prng.ts`; a new one would be added.
- If sub-streams are assigned sequentially (stream N = next chunk of stream N−1), inserting a generator shifts every later stream ⇒ same extensibility failure as A.
- Only acceptable if each sub-stream is derived by a _stable key_ (which is exactly option C).
- **Verdict: rejected as stated; its stable-key variant collapses into C.**

### C. Stable domain-separated seeds (CHOSEN)

```
seed' = deriveDomainSeed(seed, domain) = cyrb128(`${seed}\u0000${domain}`)
                                        .map(n => n.toString(16).padStart(8,'0')).join('')
```

- Each generator receives its own derived seed string; `createSeededRandom(seed')` produces an independent, decorrelated stream (different hash inputs ⇒ different streams).
- The `\u0000` separator guarantees the (seed, domain) split is unambiguous for any seed content.
- **Extensibility (insertion-safe):** a future generator with a new domain (e.g. `'dialogue'`, `'missions'`, `'locations'`) derives a different seed and **cannot change** any existing domain's draw values or outputs — insertion is safe by construction because each derived seed is a pure function of `(seed, domain)` and a new domain never touches an existing pair.
- **Reordering is NOT covered by this safety:** reordering steps changes the per-step context contents and therefore eligibility outcomes (though never PRNG values, §4). The step order is therefore **fixed as a pipeline contract** (D3), not an implementation detail.
- **Determinism:** same (seed, domain) ⇒ same derived seed ⇒ same stream. The derivation is pinned by a golden test.
- **Backward compatibility:** the pipeline is a _new composition layer_; Phase 6–10 golden tests call the generators directly with their own seeds and are untouched. The pipeline defines its own seed namespace: `generateCase(snapshot, seed)` will generally NOT equal the four generators called directly with the raw `seed` (each gets a derived seed instead). This is an explicit, intended contract of the pipeline layer, stated here so it is never "fixed" by accident.
- **Reproducibility:** the pipeline result carries the raw pipeline `seed` and the per-domain derived seeds (metadata), so a stored seed reproduces the case exactly (Phase 14 stores the raw seed).
- **Verdict: chosen.** Implementation is a pure, dependency-free function over the existing `cyrb128`.

**Tradeoff table:**

| Criterion                       | A (shared stream) | B (forked sub-streams) | C (domain-separated seeds) |
| ------------------------------- | ----------------- | ---------------------- | -------------------------- |
| Generator contract unchanged    | ✗ (breaking)      | ✓ (with new primitive) | ✓                          |
| Inserting future generator safe | ✗                 | ✗ (unless keyed)       | ✓                          |
| Cross-class decorrelation       | ✗ (identical)     | ✓                      | ✓                          |
| Requires new PRNG primitive     | ✗                 | ✓                      | ✗ (reuses cyrb128)         |
| Backward compatible with 6–10   | ✓ (raw seed)      | ✓ (layer defines ns)   | ✓ (layer defines ns)       |
| Simple, dependency-free         | ✓                 | ✗                      | ✓                          |

**Decision D1:** option C — stable domain-separated seeds via `deriveDomainSeed(seed, domain)`. Domains are a closed enum `'characters' | 'items' | 'documents' | 'evidence'`; future phases append domains (e.g. `'dialogue'`, `'missions'`, `'locations'`, `'charItems'` for per-character item assignment) without touching existing ones.

### 3.1 Seed Derivation is Part of the Deterministic Contract (versioned)

**Decision D11:** the seed derivation algorithm — `deriveDomainSeed` and, transitively, the `cyrb128` → `mulberry32` PRNG pairing it feeds — is **part of the deterministic generation contract**, exactly like the per-generator draw sequence. For a given `(seed, templateVersion, pipelineAlgorithmVersion)`, the derived per-domain seeds and therefore the entire generated case are fully determined.

- **What is frozen:** the `cyrb128` input-string construction (`${seed}\u0000${domain}`), the NUL separator, the hex encoding (`.toString(16).padStart(8,'0')` join), the domain enum values, and the `createSeededRandom` pairing (`mulberry32(cyrb128(seed')[0])`). All are pinned by golden tests (Phase 6–10 pin `cyrb128`/`mulberry32`; §13 pins `deriveDomainSeed`).
- **What must NOT silently change:** if `cyrb128` or `deriveDomainSeed` is changed in a future release _without_ bumping the pipeline algorithm version, then for the same stored `(seed, templateVersion)` the pipeline would silently produce a **different case**. This violates TODO 12.1 ("Same seed must generate same result") and Phase 14 regeneration-from-stored-seed. Any change to the derivation algorithm, the PRNG, or the draw sequence is a **breaking change gated by a version bump** — never a silent in-place edit.
- **Versioning mechanism (future-proof, NOT implemented in Phase 12):** the pipeline carries a `pipelineAlgorithmVersion: number` constant (initial value `1`) exposed on `GeneratedCase.metadata` (see §11). Phase 14 stores the raw seed **and** `pipelineAlgorithmVersion` on the Case Instance. If a future release must change `cyrb128`/`deriveDomainSeed`/draw sequence, it does so under a new algorithm version, and regeneration keys on `(seed, templateVersion, pipelineAlgorithmVersion)` so a stored instance always regenerates identically. Version `1` remains frozen and its derivation stays available for reproducing legacy instances.
- **Alternative considered and rejected:** namespacing the derived seed itself (e.g. embedding a version token inside the seed string). This would leak algorithm metadata into the PRNG input and change every stream for _every_ seed; the version belongs in the result metadata, not the derivation input.
- **Scope note:** `pipelineAlgorithmVersion` is distinct from `templateVersion` (content version). A content update (new `templateVersion`) legitimately changes the output; an algorithm update requires a version bump to preserve the reproducibility contract.

---

## 4. Draw Ordering and Per-Generator Contract Preservation

- **Each generator's internal draw sequence is untouched.** The pipeline passes exactly the input fields each generator already consumes (`caseTemplateId`, `templateVersion`, bounds, candidate rows, a derived seed, and an `eligibilityFilter`). No generator file changes.
- **Pipeline step order** is characters → items → documents → evidence. This is the dependency-aware order required by Phase 11 §29 so that class-A `hasItem`/`hasEvidence`/`characterRole` resolve against _settled_ earlier output (evidence gated on selected items, documents gated on selected characters, items gated on selected characters).
- **Because streams are domain-separated (D1), step order does not affect any draw value** — it only affects _context availability_ (what is "settled" for the current step). Reordering steps would change context contents (and hence eligibility outcomes) but never PRNG values; the design fixes the order so eligibility outcomes are also stable.
- **Zero-PRNG property holds:** each step's `eligibilityFilter` runs inside the generator before draw #1 and consumes no `rng.*` calls (Phase 11 §17, verified at the hook sites). The pipeline adds nothing to the draw sequence.
- **Quantity draws** (items) remain after selection, in canonical order, exactly as today. Conditions never reorder or re-draw quantities.

**Exact per-generator draw counts (unchanged from Phases 6–10):**

| Generator  | Draw #1 | Per optional pick | Post-selection | Total    |
| ---------- | ------- | ----------------- | -------------- | -------- |
| characters | 1 int   | 1 float           | —              | 1 + (t − | R   | )     |
| items      | 1 int   | 1 float           | 1 int/item     | 1 + (t − | R   | ) + t |
| documents  | 1 int   | 1 float           | —              | 1 + (t − | R   | )     |
| evidence   | 1 int   | 1 float           | —              | 1 + (t − | R   | )     |

---

## 5. Version Pinning — Validation Order and Failure Behavior

The pipeline pins **template version** and **relation versions** before any generation.

Validation is separated into four strata. **A/B run entirely in Phase 1 (context-free, fail-fast). C is inherently step-local and runs at the start of each Phase 2 step (it depends on the per-step context, including earlier-step output). D is the generators themselves.** No context-dependent check is ever moved into Phase 1; Phase 1 contains only checks whose outcome is independent of generation.

- **A. Snapshot/schema validation (Phase 1):** the snapshot must be well-formed (template present, bounded pairs `min ≤ max`, `version > 0`). Failure ⇒ `InvalidSnapshot`.
- **B. Static validation (Phase 1):** version pinning across all four pools, duplicate detection, condition parsing — all purely syntactic, context-free. Failure ⇒ `VersionMismatch` / `DuplicateEntity` / `InvalidRule`. These are deterministic _before_ any PRNG exists.
- **C. Step-local eligibility validation (Phase 2, per step):** the per-step `eligibilityFilter` evaluates each candidate's class-A conditions against that step's context (settled earlier output + current pool). This CANNOT be hoisted to Phase 1 because the context — e.g. `hasItem('phone')` on evidence — depends on earlier steps' generated output. Unsatisfiable required conditions surface here as deterministic generator errors (`PoolBelowMinimum`, `NoEligible*`, `RequiredExceedsMax`, `InsufficientPool`), wrapped by the pipeline.
- **D. Generation (Phase 2, per step):** the four `select*` calls. Never a fallback, retry, or relaxed re-evaluation.

**Validation order (fail-fast, first error wins):**

1. **A — Template:** the snapshot must contain a template row; `templateVersion` is a positive integer; each min/max bound is `≥ 0`; for each bounded pair (`max > 0`), `min ≤ max`. Failure ⇒ `InvalidSnapshot` (pipeline error).
2. **B — Per pool, in fixed order** characters → items → documents → evidence, **rows in canonical order** `(priority ASC, id ASC)`:
   - `row.version === snapshot.templateVersion` for every row. First mismatch ⇒ **`VersionMismatch`** (pipeline error carrying `templateVersion`, the pool, the entity id, and the offending `version`). The mismatch is caught **before** any generator runs, so no draws are consumed and no earlier step has "succeeded" — atomicity holds even across pools.
   - Duplicate entity id within a pool ⇒ `DuplicateEntity` (pipeline error) — deterministic; the DB `UNIQUE(parent, entity)` prevents this in practice; the pipeline is the backstop.
3. **B — Condition parsing:** for every row (characters/items/documents `conditions`; evidence `conditions` from the evidence map), call `parseRulePayload`. A thrown `InvalidRule` is caught and returned as a typed `InvalidRule` pipeline error carrying the payload and reason. Conditions are parsed **once** into a `Map<entityId, Rule[]>`; the per-step filter reuses the map (no per-candidate re-parsing).

**Rationale for pipeline-level (vs generator-level) version checking:** the generators already re-check version per candidate (backstop, e.g. `selection.ts:134`), but they check only their own pool and _after_ earlier steps may have run. The pipeline pre-check makes version pinning **atomic across all four pools** — a single mismatch anywhere fails the whole run deterministically and cheaply, before any PRNG exists. The generator checks remain as defense-in-depth (per Phase 6–10 design).

**Failure behavior:** fail-fast, first error in the fixed order, returned as a typed `GenerationPipelineError`. Never a partial result.

---

## 6. Immutable Content Snapshot

The pure layer receives a fully-loaded, immutable snapshot. The pipeline never queries the database (requirement 4) and never mutates its input (verified: generators copy via `canonicalOrder` and `filter`, never mutate row objects).

```ts
// Proposed snapshot type (build-step; defined in game-rules/src/generation/pipeline-types.ts)
export interface CaseTemplateSnapshot {
  caseTemplateId: string;
  templateVersion: number;
  type: string | null;
  difficulty: string | null;
  minCharacters: number;
  maxCharacters: number;
  minItems: number;
  maxItems: number;
  minDocuments: number;
  maxDocuments: number;
  minEvidence: number;
  maxEvidence: number;
  characters: CharacterPoolRow[];
  items: ItemPoolRow[];
  documents: DocumentPoolRow[];
  evidence: EvidencePoolRow[];
}

// Pool rows = generator candidates PLUS the context metadata the candidates omit
// (joined from the entity tables, migrations 0003–0006).
export interface CharacterPoolRow extends CharacterSelectionCandidate {
  occupation: string | null; // from characters.occupation (for character.occupation path)
}
export interface ItemPoolRow extends ItemSelectionCandidate {
  name: string | null; // from items.name (for item.name / hasItem)
}
export interface DocumentPoolRow extends DocumentSelectionCandidate {
  // documents context needs only id + role (relation row); no extra join needed
}
export interface EvidencePoolRow extends EvidenceSelectionCandidate {
  name: string | null; // from evidence.name (for evidence.name / hasEvidence)
  conditions: unknown[]; // case_evidence.conditions — NOT on the candidate (evidence-types.ts)
  discoveryCondition: unknown | null; // carried, NEVER evaluated at generation (class B)
}
```

- The snapshot carries the candidate fields (`required`, `weight`, `priority`, `role`, `hidden`, `discoveryMethod`, `minQuantity`/`maxQuantity`, `version`) **plus** the context metadata. The pipeline maps rows → candidates for the generators and rows → `GenerationContextData` for the contexts.
- Evidence `conditions` live on the snapshot row (they are a `case_evidence` column) but are **removed** before constructing `EvidenceSelectionCandidate[]` (which has no such field); the pipeline builds the `Map<evidenceId, Rule[]>` for the evidence filter.
- `discoveryCondition` is carried through the snapshot **only** for future Phase 14 use; generation never evaluates it.
- The loader (caller concern — Phase 14/36 or a thin adapter) is responsible for loading exactly the published version and joining entity metadata. The design does not specify a loader; it specifies the shape the loader must produce.
- **Immutability guarantee:** the pipeline treats the snapshot as read-only; a test deep-freezes a snapshot and asserts the pipeline neither mutates it nor returns objects sharing identity with it (see §13).

---

## 7. Generation Ordering and Dependency Analysis

Requirement 5 asks whether any generator needs another's output. Verified: **the selection algorithms do not consume each other's output — only the Phase 11 contexts do.**

- `selectCharacters` reads only the character pool + template bounds + seed.
- `selectItems` reads only the item pool + template bounds + seed (case-level; per-character item assignment is future work).
- `selectDocuments` reads only the document pool + template bounds + seed.
- `selectEvidence` reads only the evidence pool + template bounds + seed.

The **only** cross-step dependency is class-A eligibility: `hasItem('phone')` on an evidence row must resolve against the **selected** items, `characterRole('businessman')` on a document must resolve against **selected** characters. This is satisfied by the dependency-ordered step sequence + the per-step context model below.

**Per-step context model (resolves Phase 11's §16 "builds GenerationContext once" vs §29 "snapshot + settled earlier-step output" wording):** build a fresh `GenerationContext` at the start of each step from the snapshot **plus** the settled output of completed steps. For the _current_ step's own entity class, the context holds its **candidate pool** (roles/occupations/names are authoring data known pre-selection; there is no selection yet). This matches Phase 11 §24 (`characterRole` resolves against `case_characters.role`).

| Step       | `characters`   | `items`        | `documents`    | `evidence`     |
| ---------- | -------------- | -------------- | -------------- | -------------- |
| characters | candidate pool | `[]`           | `[]`           | `[]`           |
| items      | **selected**   | candidate pool | `[]`           | `[]`           |
| documents  | **selected**   | **selected**   | candidate pool | `[]`           |
| evidence   | **selected**   | **selected**   | **selected**   | candidate pool |

Consequences:

- Example 1 (`IF item == phone THEN allow evidence == imei_mismatch`): evidence step, items = **selected** ⇒ true iff a phone was generated. Correct per Phase 11 §16 ("settled generated item set").
- Example 2 (`IF character.role == businessman THEN allow document == invoice`): documents step, characters = **selected** ⇒ true iff a businessman was generated.
- A character row's own `characterRole` condition resolves against the pool (Phase 11 §24).
- Item → character gating (`hasItem` on items can't see selected items yet) resolves against the item pool; character-gated item conditions resolve against selected characters.

**Independence invariant (no accidental coupling):** a generator's output depends on earlier-step output **only through conditions that explicitly reference it**. If a step's candidate rows carry no condition reading an earlier class's context paths (`item.name`/`item.id`/`hasItem`, `character.*`, `document.*`, `evidence.*`, etc.), then the per-step `eligibilityFilter` is constant with respect to that earlier output and the generator's draw sequence is a pure function of its own pool + derived seed + bounds. Concretely: because streams are domain-separated (D1) and each generator reads only `{pool, bounds, seed, eligibilityFilter}`, _changing the settled earlier output cannot change a later generator's output unless that later generator's conditions reference the earlier output_. This is what makes the pipeline's determinism/reproducibility contract compositional, not merely total. It is pinned by the §13 "zero-PRNG / draw determinism" and "insertion safety" tests (all-empty-conditions pipeline equals no-filter pipeline, per step).

**Context metadata mapping** (rows → `GenerationContextData`): `characters` from `{id, role, occupation}`; `items` from `{id, name}`; `documents` from `{id, role}`; `evidence` from `{id, name, role, importance}`. `difficulty`/`type` from the snapshot template.

---

## 8. Conditions / Eligibility — Exactly When They Execute

- **Class A (generation eligibility) executes** at each step, exclusively via the existing `eligibilityFilter` hook: `evaluateEligibility(parseRulePayload(row.conditions), stepContext)`. Empty `conditions` ⇒ `[]` ⇒ `true` (row always eligible), preserving Phase 6–10 behavior.
- **Evidence:** conditions come from the `case_evidence.conditions` column via the pipeline's evidence map; candidates carry none.
- **Discovery (class B), availability (class C), runtime (class D) NEVER execute during generation.** Specifically:
  - `discovery_condition` is carried in the snapshot but never parsed or evaluated by the pipeline (Phase 11 §28: "selection never evaluates discovery").
  - `availability`/`hidden`/`role` remain static data passed through unchanged; they are never re-interpreted as rules (Phase 11 §20/D5).
  - `previousDecision` and runtime flags are always `false`/`undefined` under a `GenerationContext` (`context.ts:111,113`); class-D operators can never fire at generation.
  - `locationType` always `false` under a generation context (no location at case level).
- **Parsing happens once in Phase 1** (validation); evaluation happens per step. Malformed conditions fail the whole pipeline before any draw — never silently.

---

## 9. Required Entities — No Silent Fallback

Requirement 7 — when a required entity becomes ineligible (its class-A condition fails), the generator deterministically reports it; the pipeline propagates it; nothing is silently substituted or relaxed.

| Scenario                                                      | Deterministic result                                                                                                                               |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| required character/item/document ineligible (condition fails) | row drops out of `E`/`R` ⇒ generator returns `PoolBelowMinimum` (pool < min) or `RequiredExceedsMax` (if max bounded and required shrink/mismatch) |
| required evidence (`role === 'required'`) ineligible          | same, via the evidence generator (`role === 'required'` is the one role-derived selection input)                                                   |
| all rows ineligible                                           | `NoEligible*`                                                                                                                                      |
| all optional weight 0 and target > required                   | `InsufficientPool`                                                                                                                                 |

- No retry, no fallback, no relaxed re-evaluation (Phase 11 §17/D4). Phase 13 provides a seed-only retry mechanism later; Phase 26 is the publish-time guard.
- Each generator error is wrapped by the pipeline with the step name (`PipelineStepError { step, cause }`) so callers know exactly which pool failed.

---

## 10. Failure Atomicity and Typed Errors

Requirement 8 — the pipeline either produces a complete valid case or a deterministic typed error.

```ts
// Proposed error union (build-step; pipeline-types.ts)
export type GenerationPipelineError =
  | { type: 'InvalidSnapshot'; reason: string } // template missing / bounds invalid / version invalid
  | {
      type: 'VersionMismatch';
      pool: PipelineDomain;
      templateVersion: number;
      entityId: string;
      version: number;
    }
  | { type: 'DuplicateEntity'; pool: PipelineDomain; entityId: string }
  | {
      type: 'InvalidRule';
      pool: PipelineDomain;
      entityId: string;
      payload: unknown;
      reason: string;
    }
  | {
      type: 'PipelineStepError';
      step: PipelineDomain;
      cause:
        | CharacterSelectionError
        | ItemSelectionError
        | DocumentSelectionError
        | EvidenceSelectionError;
    };

export type GenerationPipelineResult =
  { ok: true; case: GeneratedCase } | { ok: false; error: GenerationPipelineError };
```

- **Error information preservation (point 6):** `PipelineStepError` keeps the **full Phase 6–10 discriminated union** as `cause` — it never flattens or re-encodes generator errors. Each underlying discriminant carries its entity id where applicable (`characterId`/`itemId`/`documentId`/`evidenceId` for `VersionMismatch`, `Duplicate*`, `InvalidWeight`; `InvalidQuantityBounds` carries `itemId`; pool-level errors carry counts). `step: PipelineDomain` names the pool, so a consumer can route on `step` + `cause.type` and remains fully machine-readable. The pipeline adds _wrapping_ only (step + cause), never _coercion_.
- **Atomicity:** Phase 1 runs to completion (or returns the first error) before any generator is called. Phase 2 calls the four generators in order; the first `ok: false` is returned immediately and the pipeline constructs **no** result object. There is no partial-success state observable by the caller.
- **Deterministic ordering of errors:** template errors → version/duplicate errors (pool order, canonical row order) → rule parse errors (pool order, canonical row order) → generator step errors (step order). The first error in that order wins.
- **Pure:** the pipeline never throws (all generator results are `{ok:false}` unions; the only throw site, `parseRulePayload`, is caught in Phase 1). Callers get a value, never an exception.

---

## 11. Pipeline Result Structure

Requirement 9 — a strongly typed result distinguishing identity, seed, generated sets, and metadata. **No Case Instance persistence.**

```ts
export interface GeneratedCase {
  caseTemplateId: string;
  templateVersion: number;
  pipelineAlgorithmVersion: number; // frozen at 1; bumped ONLY on derivation/PRNG/draw changes (§3.1)
  seed: string; // the raw pipeline seed (what Phase 14 stores)
  characters: SelectedCharacter[];
  items: GeneratedItem[];
  documents: GeneratedDocument[];
  evidence: GeneratedEvidence[];
  metadata: {
    derivedSeeds: Record<PipelineDomain, string>; // per-step derived seeds (audit/reproducibility)
    poolSizes: Record<PipelineDomain, number>; // |eligible pool| per step (post-filter)
    selectedCounts: Record<PipelineDomain, number>; // output sizes per step
  };
}
```

- Uses the existing output types: `SelectedCharacter`, `GeneratedItem`, `GeneratedDocument`, `GeneratedEvidence` (unchanged from Phases 6–10).
- `seed` is the raw input seed so Phase 14 can store and later regenerate (Phase 13 seeded retry) from it.
- `metadata` is derived deterministically from inputs; it contains no timestamps, no instance state.

---

## 12. Pure Function Architecture

Requirement 10 — DB access, Supabase, auth, persistence stay outside.

- **In scope (pure):** `deriveDomainSeed`, `validateSnapshot` (Phase 1), `buildStepContext`/`buildPoolPredicate` (per-step), `generateCase(snapshot, seed): GenerationPipelineResult`. All synchronous, dependency-free, no I/O, no mutable module state (matching the existing package style, verified: zero module-level `let`/`var`).
- **Out of scope (caller/Phase 14):** loading the snapshot from Postgres (the loader adapter), generating the seed (TODO 12.1 — "generate seed when Case Instance starts" is Phase 14), persisting the `GeneratedCase` (Case Instance, Phase 14), and the Case Engine orchestration (Phase 36).
- The pipeline's only function is _compose validated inputs → deterministic result_. This keeps it trivially unit-testable and reusable by Phase 13 (retry = new seed, same snapshot) and Phase 14 (instance build).

---

## 13. Test Strategy (design-level; for the Phase 12 build step)

Following the Phase 6–10 deterministic-test pattern (vitest, no new test framework; property loops use the existing independent LCG where needed):

| Category                      | Asserts                                                                                                                                                                                                                                                                                                                         |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Same-seed determinism         | `generateCase(snapshot, 's')` called twice ⇒ `toEqual` (deep, incl. metadata)                                                                                                                                                                                                                                                   |
| Different-seed                | property across many seeds: at least one pair differs in output                                                                                                                                                                                                                                                                 |
| Golden pipeline               | fixed snapshot + fixed seed ⇒ exact pinned `GeneratedCase` (like `'case-demo-seed-123'`, but for the composed pipeline)                                                                                                                                                                                                         |
| Derived-seed stability        | `deriveDomainSeed` golden values; `deriveDomainSeed(seed, d1) !== deriveDomainSeed(seed, d2)`; NUL separation unambiguous; **frozen derivation contract**: `GeneratedCase.pipelineAlgorithmVersion === 1` and a golden `(seed, templateVersion)` ⇒ exact pinned output (regression guard against silent algorithm change, §3.1) |
| Stream determinism (D1)       | calling `selectCharacters` with `deriveDomainSeed('s','characters')` alone ⇒ equal to the characters step inside `generateCase('s')`                                                                                                                                                                                            |
| Insertion safety (D1)         | adding a new domain seed doesn't change existing domain outputs (unit test on `deriveDomainSeed`; contract test that domains are disjoint)                                                                                                                                                                                      |
| Independence invariant (§7)   | a documents step whose rows reference no earlier class ⇒ its output is identical regardless of generated items/characters content (fixed pools, varied settled context)                                                                                                                                                         |
| Version mismatch              | one row `version ≠ templateVersion` in each of the four pools ⇒ `VersionMismatch` with correct pool/entity, before any generation                                                                                                                                                                                               |
| Required-entity failure       | unsatisfiable required condition in each class ⇒ `PipelineStepError` with `PoolBelowMinimum`/`NoEligible*`/`RequiredExceedsMax` cause                                                                                                                                                                                           |
| Condition filtering           | worked examples 1 & 2 (phone→imei_mismatch, businessman→invoice) across the full pipeline; evidence map wiring                                                                                                                                                                                                                  |
| Empty pools                   | a class with `[]` pool and `min>0` ⇒ `PoolBelowMinimum`; with `min=0` ⇒ `NoEligible*` (existing generator semantics, per Phase 6 §10)                                                                                                                                                                                           |
| Invalid bounds                | negative bound or bounded `min>max` on the snapshot ⇒ `InvalidSnapshot`                                                                                                                                                                                                                                                         |
| Malformed conditions          | a row with `conditions: [{op:'eqauls',…}]` ⇒ `InvalidRule` (typed, carried), pipeline fails before any draw                                                                                                                                                                                                                     |
| Generator failure propagation | `PipelineStepError` wraps the exact generator error discriminant and step name                                                                                                                                                                                                                                                  |
| Atomicity                     | a failure in evidence ⇒ result is `{ok:false}` only; no characters/items/documents leak into any result                                                                                                                                                                                                                         |
| Snapshot immutability         | deep-freeze snapshot; pipeline succeeds; snapshot unchanged; output objects share no identity with input rows                                                                                                                                                                                                                   |
| Draw/stream determinism       | zero-PRNG proof: pipeline with all-empty conditions === pipeline running the same generators with no filter (equivalent output)                                                                                                                                                                                                 |
| Property/invariants           | LCG-generated random snapshots + seeds: required ⊆ output, uniqueness, `lower ≤                                                                                                                                                                                                                                                 | output | ≤ upper`per class, determinism (mirrors the four`*-invariants.test.ts`) |
| Discovery/runtime isolation   | a payload using `previousDecision` or `locationType` in a generation context evaluates `false`; `discovery_condition` never affects output                                                                                                                                                                                      |
| Golden regression (6–10)      | existing per-generator golden tests pass **unmodified**                                                                                                                                                                                                                                                                         |

---

## 14. Backward Compatibility

- **No generator, PRNG, rule-engine, or schema change.** The pipeline is an additive pure function in `packages/game-rules`. Phase 6–10 golden tests call the generators directly and are byte-for-byte unchanged.
- The pipeline's seed namespace differs from direct calls by design (D1); this is documented, not a regression.
- Empty `conditions` (`[]`/`{}`/`null`) parse to no rules ⇒ all rows eligible ⇒ pipeline behavior reduces exactly to Phase 6–10 behavior for condition-free content.
- The `eligibilityFilter` hook is unchanged; the pipeline is the caller Phase 11 §15.3 described.

---

## 15. Future Extensibility (no implementation now)

| Future system                          | How Phase 12 leaves room                                                                                                                                |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| character → item assignment            | new step after characters with a new domain (`'charItems'`); item selection can consume settled characters; existing item/evidence draws untouched (D1) |
| location-dependent content             | new step with `'locations'` domain + `location_*` relations in a future snapshot; case-level steps unaffected                                           |
| dialogue / mission generation          | new steps with `'dialogue'`/`'missions'` domains; phase 11 class-D contexts at runtime                                                                  |
| runtime state, Case Instance snapshots | Phase 14; pipeline result (`GeneratedCase`) is the exact payload the instance persists                                                                  |
| seeded retry / regeneration (Phase 13) | retry = new seed, same snapshot; `generateCase` is pure and re-callable; no state to reset                                                              |
| publish validation (Phase 26)          | pipeline's Phase 1 validations are a subset the publish validator reuses; `InvalidRule`/version/required-condition checks already named                 |
| new operators / new domains            | domain enum appends; operator extension is content-breaking and gated by Phase 26 (Phase 11 §37)                                                        |

The pipeline is written as an explicit sequential composition (four named steps), not a generic loop, so a future step is a _new named step_ with its own context construction — not a refactor of existing code.

---

## 16. Database Verdict

**No migration is required.** The Phase 2–5 schema fully supports the pipeline:

- `cases` (0011 + 0016) provides the template identity, `version`, `type`, `difficulty`, and all eight min/max bounds.
- `case_*` relations (0012) provide `version`, `weight`, `priority`, `required` (or `role = 'required'` for evidence), `conditions` jsonb, and the per-entity config (`role`, `hidden`, `discovery_method`, `min/max_quantity`, `discovery_condition`).
- Version pinning is enforced by the pure layer (no DB constraint needed; R2 + generator backstop, Phase 6 §9).
- **No `case_instances` table** — that is Phase 14. No seed column, no generated-case table, no pool duplicates (R1).
- `supabase db reset` (0001–0016) remains the untouched baseline.

---

## 17. Shared Types / Schemas

New types (design-only; defined during the Phase 12 build step):

- **`packages/game-rules/src/generation/pipeline-types.ts`:** `PipelineDomain`, `deriveDomainSeed` signature, `CaseTemplateSnapshot`, pool row interfaces, `GeneratedCase`, `GenerationPipelineError`, `GenerationPipelineResult`.
- **`packages/game-rules/src/generation/pipeline.ts`:** `generateCase`, `validateSnapshot`, `buildStepContext`, `buildPoolPredicate` (pure, exported for testability).
- **`packages/game-rules/src/generation/pipeline-errors.ts`:** the error union + a narrow `PipelineStepError` wrapper (avoids re-defining the four existing error unions).

**shared-types / content-schema:** **no change.** `conditions: unknown[]` / `discoveryCondition: unknown` remain as-is (Phase 11 §34 recommendation); the pipeline is the first consumer and parses payloads itself. Evidence `role`/`importance` continue to use the existing `EvidenceRole`/`EvidenceImportance` enums.

---

## 18. TODO Alignment (precise mapping — no blind marking)

TODO §12 describes a "Random Generation Engine". Historical note: Phases 6–10 already implemented the four individual generators; Phase 11 implemented eligibility. **Phase 12 contributes the composition layer** (pipeline, seed namespace, per-step contexts, version/atomic validation). The mapping is deliberately partial:

| TODO bullet (lines 512–579)                                                                             | Satisfied by                          | Status / note                                                                                        |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| 12.1 "Use deterministic random generator"                                                               | Phases 6–10 + Phase 12 `generateCase` | ✓ Phase 12 composes them; golden determinism pinned                                                  |
| 12.1 "Same seed must generate same result"                                                              | Phase 12 determinism + tests          | ✓ core requirement                                                                                   |
| 12.1 "Generate seed when Case Instance starts"                                                          | —                                     | ✗ **Phase 14** (seed generation is instance lifecycle, not pipeline)                                 |
| 12.1 "Store seed"                                                                                       | —                                     | ✗ **Phase 14** (stored on Case Instance; `GeneratedCase.seed` is the payload)                        |
| 12.1 "Never regenerate an active case"                                                                  | —                                     | ✗ **Phase 14** (instance lifecycle)                                                                  |
| 12.2 Character Generation algorithm (load, min/max, required, pool, invalid, weights, select, validate) | Phases 6 + 11 + 12 pipeline           | ✓ Phase 12 provides the eligibility evaluation ("remove invalid"), the composed call, and validation |
| 12.2 "Retry if invalid"                                                                                 | —                                     | ✗ **Phase 13** (seed-only retry)                                                                     |
| 12.2 "Save generated result"                                                                            | —                                     | ✗ **Phase 14** (instance persistence)                                                                |
| 12.3 Item Generation (case-level: min/max, pool, restrictions, required, weighted, quantity, validate)  | Phases 7 + 11 + 12                    | ✓ case-level steps; the pipeline calls them in order                                                 |
| 12.3 "For each character" (per-character pools)                                                         | —                                     | ✗ deferred (case-level in Phase 12; character→item assignment is §15 future work)                    |
| 12.3 "Load location restrictions"                                                                       | —                                     | ✗ deferred (location-dependent content, §15)                                                         |
| 12.4 Required / random / fake / decoy documents                                                         | Phase 9 (`role` + weighted draws)     | ✓                                                                                                    |
| 12.4 "Character-linked documents"                                                                       | —                                     | ✗ deferred (document→character assignment is future)                                                 |
| 12.4 "Case-linked documents"                                                                            | Phase 9 (`case_documents` pool)       | ✓                                                                                                    |
| 12.5 Required / optional / decoy evidence                                                               | Phase 10 (`role`)                     | ✓                                                                                                    |
| 12.5 "Conditional evidence"                                                                             | Phase 11 + Phase 12 eligibility       | ✓ class-A conditions via evidence map                                                                |
| 12.5 "Evidence generated from discovered content"                                                       | —                                     | ✗ **runtime** (discovery is class B; Phase 14/36)                                                    |

**Conclusion:** Phase 12 satisfies TODO §12 only **partially and compositionally**. Sections 12.1 (seed lifecycle), 12.2 (retry/save), 12.3 (per-character), 12.4 (character-linked), and 12.5 (discovered content) remain open and map to Phases 13/14/36. TODO should be updated to mark **only** the satisfied bullets and to annotate the deferred ones — never to check the whole phase.

---

## 19. Proposed Code / Package Changes (Phase 12 build step)

All in `packages/game-rules` (new files):

```
packages/game-rules/src/generation/
  pipeline-types.ts   — PipelineDomain, CaseTemplateSnapshot, pool rows, GeneratedCase, error/result unions
  pipeline-errors.ts  — GenerationPipelineError union + PipelineStepError wrapper
  pipeline.ts         — deriveDomainSeed, validateSnapshot, buildStepContext, buildPoolPredicate, generateCase
```

- `src/generation/index.ts` adds three re-exports.
- `package.json` description updated to mention the seeded pipeline (no dependency changes).
- **Tests:** `packages/game-rules/test/generation/pipeline.test.ts` (+ `pipeline-invariants.test.ts` for the LCG property loops).
- No other package, migration, shared-types, content-schema, Admin, or Mobile changes.
- `docs/superpowers/plans/2026-08-13-phase12-seeded-generation-pipeline.md` and TODO §12 updated in the build step.

---

## 20. Risks and Architectural Concerns

- **Seed-namespace surprise (highest).** A future developer may "simplify" the pipeline to pass the raw seed to all four generators (identical streams, correlated counts) or to one shared stream. Mitigation: D1 documented with the tradeoff table, `deriveDomainSeed` golden tests, and an explicit doc-comment on `generateCase` ("each step receives a domain-separated derived seed — do not pass the raw seed").
- **Context ambiguity.** Phase 11's "build once" vs "settled earlier output" wording is resolved here (per-step context, current pool for the current class, §7). Mitigation: explicit table and tests for each step's context contents.
- **Evidence conditions drift.** Evidence candidates carry no `conditions`; the pipeline must source them from `case_evidence.conditions`. Mitigation: the snapshot `EvidencePoolRow.conditions` + evidence map, tested.
- **Atomicity regressions.** If a future step mutates shared state or a caller reads partial output. Mitigation: pure functions, fail-fast Phase 1, `GenerationPipelineResult` union with no partial case.
- **Over-design.** A pipeline could balloon into a framework. Mitigation: four explicit steps, no generic step engine, no new dependencies (mirrors Phase 11 §38).
- **Double version checks.** Pipeline + generators both check version. Mitigation: pipeline check gives atomicity/fail-fast; generator checks are the documented Phase 6–10 backstop; no conflict (same semantics).
- **Location/chapter/dialogue relations** are deliberately untouched; attempting to consume them here would violate R1/scope and break determinism. Mitigation: §15 explicitly defers them.

---

## 21. Decision Log

| #   | Decision                                                                                                        | Rationale                                                                                                                                                                                                                              |
| --- | --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | **Domain-separated derived seeds** (`deriveDomainSeed(seed, domain)`, cyrb128-hex)                              | Independent, decorrelated streams; future generators insert without changing existing results; no PRNG/generator change (§3)                                                                                                           |
| D2  | **Two-phase pipeline** (validate-all → generate-in-order)                                                       | Atomicity: any snapshot/version/rule error fails before a single PRNG draw                                                                                                                                                             |
| D3  | **Step order characters → items → documents → evidence**                                                        | Dependency-aware class-A resolution (settled earlier output); matches Phase 11 §29                                                                                                                                                     |
| D4  | **Per-step `GenerationContext`** (current class = candidate pool; earlier = settled)                            | Resolves Phase 11 §16 vs §29; makes examples 1 & 2 correct; `characterRole` on characters resolves per §24                                                                                                                             |
| D5  | **Class A only at generation**; B/C/D never evaluated; `discovery_condition` carried, unparsed                  | Preserves the Phase 11 class boundary; runtime is Phase 14 (§8)                                                                                                                                                                        |
| D6  | **Pipeline-level version pinning across all pools, fail-fast, typed `VersionMismatch`**                         | Atomic cross-pool pinning before any generation; generators remain the backstop (§5)                                                                                                                                                   |
| D7  | **Conditions parsed once in Phase 1** into `Map<entityId, Rule[]>`; `InvalidRule` caught                        | Malformed content fails deterministically before draws; no per-candidate re-parse (§5/§8)                                                                                                                                              |
| D8  | **`GeneratedCase` carries raw `seed` + derived seeds in metadata**                                              | Phase 13/14 reproduce exactly; no new persistence in Phase 12 (§11)                                                                                                                                                                    |
| D9  | **No migration, no shared-types/content-schema change**                                                         | Schema fully sufficient; R1/R4 respected; instance is Phase 14 (§16/§17)                                                                                                                                                               |
| D10 | **Explicit sequential composition** (four named steps), not a generic step engine                               | Future steps are additive named steps; no framework, no over-design (§15/§20)                                                                                                                                                          |
| D11 | **Seed derivation is a versioned part of the deterministic contract** (`pipelineAlgorithmVersion`, frozen at 1) | Changing `cyrb128`/`deriveDomainSeed`/draw sequence must never silently change a stored seed's output; version bump gates any future algorithm change; `GeneratedCase.metadata` + Phase 14 store the version alongside the seed (§3.1) |

---

## 22. Self-Review

- [x] Global constraints stated (determinism, 6–10 contract preservation, atomicity, version pinning, class-A-only, purity, no migration, D1).
- [x] §3 compares A/B/C seed strategies and **explicitly chooses C** with rationale and tradeoff table (requirement 11).
- [x] §3/§4 define exactly where the seed enters, per-step derived streams, and draw ordering (requirement 2).
- [x] §3.1 freezes the seed derivation as a **versioned deterministic contract** (`pipelineAlgorithmVersion`), and specifies the future-proof mechanism for algorithm changes (requirement 3 — "must not silently produce a different case").
- [x] §5 defines validation order split into **A snapshot/schema, B static, C step-local eligibility, D generation** — context-dependent checks (C) stay in Phase 2, never hoisted (requirement 5).
- [x] §6 defines the immutable snapshot; no mid-generation DB (requirements 4, 10).
- [x] §7 dependency analysis + **independence invariant** (a step's output is independent of earlier output unless its conditions reference it) (requirement 7).
- [x] §8 distinguishes generation eligibility vs discovery/availability/runtime, and proves only class A runs (requirement 6).
- [x] §9 required-entity failure is deterministic and typed, no fallback (requirement 7).
- [x] §10 atomicity — complete result or typed error, never partial; `PipelineStepError` preserves the full Phase 6–10 cause, entity id, and step (requirements 6, 8).
- [x] §11 strongly typed result distinguishing identity/version/algorithm-version/seed/sets/metadata; no instance persistence (requirement 9).
- [x] §13 comprehensive test strategy covering all 16 requested categories + derivation-version regression and independence invariants (requirement 16).
- [x] §15 future extensibility mapped without implementation (requirement 13).
- [x] §16 database verdict: no migration (requirement 14).
- [x] §17 shared-types/schemas: new types listed, not implemented (requirement 15).
- [x] §18 precise TODO mapping — partial, with deferred bullets annotated, no blind marking (requirement 17).
- [x] No code, migration, shared-types, content-schema, game-rules, Admin, or Mobile change made by this document (requirement 18).

---

## 23. Conclusion

Phase 12 (Seeded Generation Pipeline) composes the four verified generators and the Phase 11 rule engine into one pure `generateCase(snapshot, seed)`. It adds **no schema, no migration, no generator change, and no new source of truth**: determinism comes from the existing PRNG and draw contracts; atomicity comes from a fail-fast validation phase; extensibility comes from domain-separated derived seeds (D1); class-A-only eligibility is enforced by per-step `GenerationContext`s over settled earlier output; and the derivation is frozen as a **versioned deterministic contract** (`pipelineAlgorithmVersion`, D11) so no future algorithm change can silently alter a stored seed's output. The seed namespace decision (D1) is the crux: it makes future generators insertable without silently changing existing results, which is precisely the property the objective demanded. Implementation belongs in `packages/game-rules` (`src/generation/pipeline*.ts`) in the Phase 12 build step, gated on this document's approval.
