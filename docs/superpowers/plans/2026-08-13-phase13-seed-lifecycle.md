# Phase 13 — Seed Lifecycle & Retry Design

> **Status:** IMPLEMENTED — Phase 13 seed lifecycle and retry implemented per this design in `packages/game-rules` (`src/generation/seed.ts`, `src/generation/validate.ts`), verified (1317 tests) and committed. No database, migration, shared-types, content-schema, Admin, Mobile, or Case Instance persistence change is made by this document.

**Goal:** Give the Phase 12 `generateCase(snapshot, seed)` pipeline a governed _seed lifecycle_ (create → generate → retry → future persistence) without moving entropy sourcing, retry counters, idempotency, or instance state into game-rules, and pin the deterministic reproducibility contract so Phase 14 can store `(seed, templateVersion, pipelineAlgorithmVersion)` and regenerate identically.

**Architecture:** Three additive pieces in `packages/game-rules`: (1) `seed.ts` — canonical seed format + pure entropy-to-seed formatting (`seedFromEntropy`), format validation (`isValidSeed`), and a deterministic, attempt-keyed retry seed derivation (`deriveRetrySeed`); (2) `validate.ts` — a verify-only `validateGeneratedCase(snapshot, generatedCase)` structural re-check returning typed issues (never a repair path); (3) a reproducibility/retry test suite that pins the contract at the canonical-seed level. `generateCase` itself is unchanged. Retry is exactly `generateCase(snapshot, newSeed)`; maximum-retry-limit, idempotency, and instance persistence are explicitly Phase 14.

---

## 1. Current Architecture (verified from the repository, not assumptions)

All facts below were verified by reading the code at `4447833` (HEAD == `origin/main`):

- **Pipeline** (`packages/game-rules/src/generation/pipeline.ts`): pure `generateCase(snapshot: CaseTemplateSnapshot, seed: string): GenerationPipelineResult`. Same `(snapshot, seed)` ⇒ identical `GeneratedCase`, including exact PRNG draw sequence and eligibility outcomes. Atomic: complete case or typed error, never partial.
- **Seed handling** (`pipeline.ts:62`): each step receives `deriveDomainSeed(seed, domain) = cyrb128(seed + '\u0000' + domain)` hex-encoded. Domains `'characters' | 'items' | 'documents' | 'evidence'` (closed union, `pipeline-types.ts:17`). `PIPELINE_ALGORITHM_VERSION = 1` (`pipeline-types.ts:27`), carried on `GeneratedCase.pipelineAlgorithmVersion` and in metadata along with derived seeds, pool sizes, selected counts.
- **`generateCase` accepts any string seed** — no format check today. Golden tests use `'case-demo-seed-123'` and arbitrary strings (`seed-0`, `demo`, …). This must be preserved: the seed _format_ is enforced at the creation/storage boundary, never at the pipeline input.
- **`GeneratedCase`** (`pipeline-types.ts:96`): `caseTemplateId`, `templateVersion`, `pipelineAlgorithmVersion`, `seed`, `characters`, `items`, `documents`, `evidence`, `metadata {derivedSeeds, poolSizes, selectedCounts}`. Raw `seed` is the Phase 14 storage payload; everything needed to regenerate is already carried.
- **Errors** (`pipeline-errors.ts`): `InvalidSnapshot` | `VersionMismatch` | `DuplicateEntity` | `InvalidRule` | `PipelineStepError{step, cause}` where `cause` is the full Phase 6–10 generator union (`NoEligible*`, `PoolBelowMinimum`, `RequiredExceedsMax`, `InsufficientPool`, `InvalidWeight`, `InvalidQuantityBounds`, …). Fail-fast, typed, deterministic; no throw except a caught `InvalidRule` in Phase 1.
- **No seed handling exists anywhere else**: `grep -rni seed` over `backend/supabase/migrations/`, `packages/shared-types/src/`, `packages/content-schema/src/` returns nothing. There is no `case_instances` table, no seed column, no seed type, no CSPRNG usage in game-rules (its only dependency is `@gate8/shared-types`).
- **PRNG** (`prng.ts`): `cyrb128` → `mulberry32(cyrb128(seed)[0])`. Pure, no module-level mutable state (verified throughout `src/generation/`: zero module-level `let`/`var`).
- **Type/entity boundary**: `shared-types/src/entities/case.ts` states explicitly that a Case Template "never contains generated runtime state — that is the future Case Instance (Phase 14)." `shared-types`/`content-schema` mirror the schema; no instance types exist.
- **Schema/migrations**: `cases` (0011 + 0016) is the template anchor with the eight min/max bounds; `case_*` relations (0012) carry pool/config; nothing generation-instance-related exists. `supabase db reset` baseline is 0001–0016.
- **Package scripts** (`packages/game-rules`): `test` = `vitest run`, `typecheck`, `lint` = `eslint src`, `build`. Root `lint`/`typecheck` run all workspaces.

---

## 2. TODO Mapping (precise — no blind marking)

Phase 12 deferred "12.2 Retry if invalid" to Phase 13 (§18 of the Phase 12 design) and "12.1 seed lifecycle" (generate/store seed when a Case Instance starts) to Phase 14. The current TODO Phase 13 section is titled **CONSTRAINT VALIDATION** and contains example bullets plus an "Add:" list. The mapping:

| TODO bullet (Phase 13, lines 581–625)                               | Verdict           | Phase / mechanism                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Headline: "Random generation must NEVER produce an impossible case" | ✓                 | Phase 12 pipeline already guarantees a complete valid case or a typed error (atomicity, §12 design). Phase 13 adds a verify-only guard.                                                                                                                    |
| "At least one suspect."                                             | ✗ defer           | Content semantics (what makes a character "a suspect" — role? dialogue graph?) → publish-time validation (Phase 26), not a seed-layer check. Structural guarantee for _required_ characters already holds.                                                 |
| "At least one critical evidence."                                   | ✗ defer           | "Critical" = role/importance content semantics → Phase 26. Structural guarantee for _required_/_importance_ rows already holds at generation.                                                                                                              |
| "Required document must exist."                                     | ✓                 | Phase 12: required rows are always selected when satisfiable; an unsatisfiable/missing required row ⇒ deterministic typed generator error (`PoolBelowMinimum`/`RequiredExceedsMax`/`NoEligibleDocuments`). Phase 13 re-checks via `validateGeneratedCase`. |
| "Required character must exist."                                    | ✓                 | Same structural guarantee (character step).                                                                                                                                                                                                                |
| "Evidence dependencies must exist."                                 | ✓/✗               | Class-A condition dependencies ARE enforced at generation (a required evidence gated on `hasItem(phone)` with no phone ⇒ `PipelineStepError`). Cross-content dependency bookkeeping ⇒ Phase 26.                                                            |
| "Dialogue dependencies must exist."                                 | ✗ defer           | Dialogue generation does not exist; runtime + Phase 26.                                                                                                                                                                                                    |
| "Required item must exist."                                         | ✓                 | Same structural guarantee (item step).                                                                                                                                                                                                                     |
| "Case must remain solvable."                                        | ✗ defer           | Solvability is a runtime/content-graph property (dialogues, missions, decisions) → Phase 26 publish guard + Phase 36 runtime.                                                                                                                              |
| "Generation validation."                                            | ✓                 | Phase 1 validation + per-step generator errors (Phase 12) + NEW pure `validateGeneratedCase` (Phase 13, §7).                                                                                                                                               |
| "Retry mechanism."                                                  | ✓                 | Phase 13: retry = `generateCase(snapshot, newSeed)` (fresh entropy or `deriveRetrySeed`), §5.                                                                                                                                                              |
| "Maximum retry limit."                                              | ✗ defer           | Orchestration/instance policy → **Phase 14** instance metadata (§10). Not game-rules state (decided here, D5).                                                                                                                                             |
| "Fallback generation."                                              | ✗ NOT implemented | Constraint relaxation would break determinism and atomicity (Phase 12 §9: "never a fallback, retry, or relaxed re-evaluation"). The only sanctioned re-run is a **new seed**. D6.                                                                          |
| "Error reporting."                                                  | ✓                 | Typed `GenerationPipelineResult` errors (Phase 12); retries surface the identical union. No new error kind needed unless it helps (§7).                                                                                                                    |
| Phase 12 §18 "12.2 Retry if invalid"                                | ✓                 | This phase.                                                                                                                                                                                                                                                |
| Phase 12 §18 "12.1 Generate/store seed when a Case Instance starts" | ✗ defer           | The _primitive_ (`seedFromEntropy`/`isValidSeed`) is defined here; the instance-timing hook → **Phase 14**.                                                                                                                                                |

**Conclusion:** Phase 13 satisfies the seed-lifecycle/retry scope and the structural half of TODO Phase 13. The content-semantic examples ("suspect", "critical", "solvable", dialogue) are deferred to Phase 26/36; "maximum retry limit" is Phase 14; "fallback generation" is intentionally not implemented. TODO will be updated after approval to mark only the satisfied bullets.

---

## 3. Problem Statement

Phase 12 made `generateCase(snapshot, seed)` deterministic but deliberately said nothing about _where seeds come from_: any string works, nothing validates entropy, nothing defines retry, and nothing pins the reproducibility contract at a level Phase 14 can rely on. Without governance:

1. Two callers would invent seed formats (`seed-0`, timestamps, UUIDs, counters) with wildly different entropy — weak seeds make instances predictable and collide.
2. "Retry" is undefined: who picks the new seed, and is it guaranteed new? Nothing currently enforces it (a caller could retry with the _same_ seed and get the _same_ failure — the classic retry bug).
3. Nothing verifies a `GeneratedCase` in isolation against its snapshot — the "impossible case" guarantee is trusted only from generation internals, not provable on stored/loaded data.
4. No clear boundary between what the pure layer owns (format, derivation, verification) and what the runtime owns (entropy sourcing, counters, persistence, idempotency). Without this, game-rules risks absorbing Supabase/HTTP/instance concerns by accretion.

Next, "Reconcile what TODO calls Phase 13 with the actual Phase 12 implementation": TODO's headline ("never produce an impossible case") is already _structurally_ satisfied by Phase 12's atomic pipeline; the genuinely new Phase 13 work is **seed lifecycle + retry + a verify-only generation guard** plus the reproducibility contract Phase 14 keys on. This design uses the actual Phase 12 code as the axiom set.

---

## 4. Seed Lifecycle Model

The lifecycle has six states. Phase 13 owns the two pure "create" states' _primitives_; every state after generation is Phase 14.

```
  REQUEST                  (Phase 14: user/engine decides a case instance is starting)
     │
     ▼
  SEED CREATED             (Phase 14 timing; Phase 13 primitive: seedFromEntropy(freshBytes)  OR
     │                     deterministic test seed = fixed string / seedFromEntropy(known bytes))
     ▼
  GENERATION               (Phase 12: generateCase(snapshot, seed) — pure; input = generation inputs)
     │ ok:true                                  │ ok:false (typed GenerationPipelineError)
     ▼                                          ▼
  GENERATED CASE           (Phase 12 GeneratedCase;                     RETRY DECISION  (Phase 14 policy: is the failure retryable?
     │                      carries seed + pipelineAlgorithmVersion)                      have remaining attempts within maxRetryLimit?)
     │                                                                                      │ retry → new seed (Phase 13 primitive:
     │                                                                                      │   deriveRetrySeed(seed, attempt) OR fresh entropy)
     │                                                                                      │ no  → instance marked failed (Phase 14)
     ▼
  VERIFY                   (Phase 13: validateGeneratedCase(snapshot, case) → [] shields persistence; never repairs)
     ▼
  PERSIST / PLAY           (Phase 14 Case Instance: caseTemplateId, templateVersion, seed, pipelineAlgorithmVersion,
                            generated output strategy, retry metadata, player/status/timestamps)
```

**Generation input vs runtime instance state:** the **generation input** is the immutable tuple `(content snapshot, templateVersion, seed, pipelineAlgorithmVersion)` — everything `generateCase` needs, all pure. The **runtime instance state** is everything Phase 14 owns afterwards: which instance exists, who owns it, what status it has, how many retries have been attempted, when it started. This split is the whole point of the boundary: game-rules turns _generation inputs_ into _generated output_ and nothing more; it never sees an "instance".

---

## 5. Retry Semantics

- **Retry is exactly `generateCase(snapshot, newSeed)`.** No wrapper function, no new engine, no stateful retrier in game-rules (D4). Because `generateCase` is a pure function of `(snapshot, seed)`, "retry" = re-invoke with a _different_ seed. The previous `GeneratedCase` object is never touched: purity plus the Phase 12 immutability guarantee (tests deep-freeze the input _and_ the first result) mean a retry can never mutate a previous result.
- **A retry MUST use a NEW seed** (D5): the new seed must differ from the one that produced the failed attempt, and from every earlier attempt. Two governed ways to produce it:
  1. **Fresh entropy** — `seedFromEntropy(crypto.getRandomValues(new Uint8Array(16)))` at the Phase 14 call site. Unrelated to prior seeds with overwhelming probability.
  2. **Deterministic** — `deriveRetrySeed(seed, attempt)` (this phase): a pure, attempt-keyed derivation `cyrb128(seed + '\u0000retry:' + attempt)` hex-encoded, reusing the frozen derivation style of D1. `deriveRetrySeed(seed, n) !== deriveRetrySeed(seed, m)` for distinct positive integers `n ≠ m`, and both differ from the base `seed`. This makes a retry fully deterministic: `(snapshot, seed, attempt)` now completely determines the retry output — a useful property for debugging and for environments without a CSPRNG.
- **Same snapshot + same seed stays deterministic**: `generateCase(snapshot, seed)` called with the identical seed returns the identical `GeneratedCase` every time (existing Phase 12 property; pinned further below at the canonical-seed level). Retrying never relaxes the snapshot — the snapshot is the same input each attempt; only the seed changes.
- **Retry count representation (D5):** the _only_ retry state that touches the pure layer is the `attempt` argument to `deriveRetrySeed`. Attempt counters, max-retry limits, and "is this failure retryable?" are **Phase 14 instance/runtime policy** — the pure layer must not hold or enforce counters.
- **Retry metadata (D5):** belongs **Phase 14** (instance columns: `attempt`, `maxAttempts`, `lastError`, timestamps). Phase 13 defines the semantics; Phase 14 persists them.
- **Failure classification:** nested in the typed `GenerationPipelineError`. The same union is returned on every attempt; nothing in game-rules decides retryability. Phase 14 may treat `PipelineStepError`-style content failures and Phase 1 validation failures differently (e.g., `InvalidSnapshot`/`InvalidRule`/`VersionMismatch` are NOT retryable — a new seed cannot fix a broken snapshot; only pool-level generation failures can). This guidance is documented here so Phase 14 does not burn retries on non-retryable errors.

---

## 6. Reproducibility Contract

The deterministic contract is a **frozen tuple**:

```
deterministic case ≡ f( content at templateVersion, templateVersion, seed, PIPELINE_ALGORITHM_VERSION, pipeline order )
```

Concretely, for a fixed pipeline algorithm version, the reproduction procedure is:

1. Load the published content snapshot at `templateVersion` exactly (caller responsibility — Phase 14 loader).
2. Call `generateCase(snapshot, seed)`.
3. The result is byte-for-byte equal to the originally stored `GeneratedCase` (deep equality, including `metadata`).

**Frozen elements (must never change silently):** `cyrb128` input construction (`seed + '\u0000' + domain`), the NUL separator, hex encoding (`.toString(16).padStart(8,'0')` join), the `PipelineDomain` values, the `mulberry32(cyrb128(seed')[0])` pairing, each generator's draw sequence, and the step order characters → items → documents → evidence (Phase 12 D11/D3). All are pinned by golden tests today; Phase 13 adds a canonical-seed golden (below) so the full composed output, not just per-step seeds, is pinned.

**Golden reproducibility test:** construct one fixed snapshot; take a canonical seed (`seedFromEntropy(known 16 bytes)`); pin the exact full `GeneratedCase`. Then assert: re-invoking produces the same object; regenerating from the _stored_ reproduction key `(templateVersion, seed, pipelineAlgorithmVersion)` (read back from the result object, which carries all three) reproduces the identical case. This is the Phase 14 regeneration simulation.

**What a content update means:** a new `templateVersion` legitimately changes the output — content is versioned; the reproduction key includes `templateVersion`, so old instances regenerate against their pinned content version.

---

## 7. Algorithm Versioning

- `PIPELINE_ALGORITHM_VERSION = 1` (**frozen, unchanged in Phase 13**). It is carried on every `GeneratedCase` and is part of the reproduction key.
- Any future change to `cyrb128`, `deriveDomainSeed`, `createSeededRandom` pairing, a generator draw sequence, or the step order is a **breaking change gated by a version bump** (Phase 12 §3.1 / D11) — never a silent in-place edit.
- **Interaction with old seeds (future):** when a future algorithm version exists, regeneration keys on the _stored_ `pipelineAlgorithmVersion`. Version 1's derivation remains available so legacy instances reproduce identically; the pipeline never "migrates" a stored case silently. Phase 13 does **not** build a version registry — the mechanism is the version number + golden tests; registry/selection-by-version is Phase 14/36 when a v2 actually exists. This keeps Phase 13 additive and non-speculative.
- **Phase 13 additions to the versioned surface:** `seedFromEntropy`'s byte-to-hex encoding (fixed-length 32 lowercase hex, zero-padded — leading zeros must be preserved) and `deriveRetrySeed`'s derivation (`'retry:' + attempt` key) become part of the frozen derivation contract family and are pinned by goldens. They sit under the same "never change without a version bump" rule as `deriveDomainSeed`.

---

## 8. Duplicate / Idempotency Boundary

- **Phase 13 does not prevent duplicate Case Instances.** Idempotency (do not start a second instance for the same player+template; do not regenerate an active case) requires _instance state_ and therefore belongs to **Phase 14** (e.g., a `UNIQUE(player_id, case_template_id)` among active instances or a status guard — Phase 14's design decision, explicitly out of scope here).
- The **pure idempotency primitive** Phase 13 _does_ provide is determinism itself: the same `(snapshot, seed, pipelineAlgorithmVersion)` always produces the same case, so regenerating from a stored seed is always safe and stable — that is the foundation Phase 14's "never regenerate an active case unintentionally" will rest on.
- **No speculative table:** we do not invent a `seeds` table, a dedupe table, or any persistence to "solve" idempotency now. The audit (§5.6) and Phase 12 design both place instance state at Phase 14. This is reaffirmed here (D7).

---

## 9. API / Module Boundaries

All new work in `packages/game-rules` (new files, additive, existing API untouched):

```
packages/game-rules/src/generation/
  seed.ts      — SEED contract: seedFromEntropy(bytes): Seed, isValidSeed(seed): boolean,
                 deriveRetrySeed(seed, attempt): string
  validate.ts  — validateGeneratedCase(snapshot, generatedCase): GeneratedCaseIssue[]
```

**`seed.ts` — seed format & derivation:**

- `Seed` — documented string contract: **exactly 32 lowercase hex characters `[0-9a-f]{32}` = 128 bits**. Rationale: `deriveDomainSeed` already uses hex encoding; 128 bits is the industry-standard entropy floor for unique keys; a fixed-width textual seed is unambiguous to store, log, and compare. Length is pinned so leading-zero bytes are never lost.
- `seedFromEntropy(bytes: Uint8Array): Seed` — **pure**, deterministic given bytes. Requires exactly 16 bytes (128 bits); a different length returns a typed error (or throws a documented typed error — decided: returns `{ok:false}`-style consistent with package style). Renders fixed-width lowercase hex with zero-padding. No global/crypto access — the _caller_ supplies entropy.
- `isValidSeed(seed: string): boolean` — format validation (length + charset). Used by Phase 14 before storing a seed, and by tests. Note: `generateCase` does **not** call this — it remains permissive (existing goldens use non-canonical seeds like `'case-demo-seed-123'`); the canonical format is enforced only where seeds are _created_ or _stored_ (D8). `isValidSeed('') === false`, `isValidSeed('CASE...')` (uppercase) `=== false`.
- `deriveRetrySeed(seed: string, attempt: number): string` — pure attempt-keyed derivation (D5, §5). `attempt` is a positive integer, naming the 1-based retry ordinal. Total function (no errors): malformed attempts are a caller contract violation, consistent with the permissive-seed style of `deriveDomainSeed`.

**`validate.ts` — verify-only generation guard (satisfies TODO "Generation validation"):**

- `validateGeneratedCase(snapshot: CaseTemplateSnapshot, generatedCase: GeneratedCase): GeneratedCaseIssue[]` — pure, deterministic, **never repairs**. Returns an array of typed structural issues or `[]`.
- Checks (each a typed `GeneratedCaseIssue`):
  - identity: `generatedCase.caseTemplateId === snapshot.caseTemplateId`, `templateVersion` match, `pipelineAlgorithmVersion === PIPELINE_ALGORITHM_VERSION`, `seed` is a string (non-empty not required — permissive).
  - required closure: every `required` row (evidence: `role === 'required'`) present in the matching output set.
  - counts within effective bounds per domain (recompute `lower`/`upper` exactly as the generators do).
  - no duplicate entity ids within a set; every output id ∈ the snapshot pool ids.
  - quantities inside per-item bounds (items).
- For a correctly generated case this always returns `[]` — it is an assertion/defense-in-depth layer, the provable form of TODO's "never an impossible case." Phase 14 uses it after load/regeneration and before persisting or starting play. It deliberately does NOT re-evaluate conditions or re-parse rules (those are Phase 1/2 concerns).

**`index.ts`:** two re-export lines. `package.json` description: unchanged (already mentions the seeded pipeline; optionally amended with "seed lifecycle"). No dependencies added.

**What game-rules accepts today / will accept:** `generateCase(snapshot, seed)` (any string seed), `seedFromEntropy(bytes)` (exactly 16 bytes), `isValidSeed(seed)`, `deriveRetrySeed(seed, attempt)`, `validateGeneratedCase(snapshot, case)`.

**What the future runtime/service layer is responsible for** (Phase 14/36): supplying entropy bytes (the platform CSPRNG call), deciding retryability, enforcing max retry limits, owning instance state and idempotency, persisting, and loading snapshots. game-rules is never coupled to Supabase, HTTP, UI, auth, or Case Instance persistence (D9).

---

## 10. Phase 14 Compatibility

Phase 13 implements **none** of the following; it fixes the interface so Phase 14 can build on it.

**Phase 14 will persist (interface contract defined here):**

| Field                        | Type            | Source / note                                                                                                                                                                                                                 |
| ---------------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| caseTemplateId               | uuid            | `cases.id` anchor; identity of the template the instance was generated from                                                                                                                                                   |
| templateVersion              | int             | `snapshot.templateVersion` — the pinned content version at generation                                                                                                                                                         |
| seed                         | `Seed`          | `GeneratedCase.seed` (raw pipeline seed). Canonical 32-hex when created via `seedFromEntropy`; `isValidSeed` guards storage                                                                                                   |
| pipelineAlgorithmVersion     | int             | `GeneratedCase.pipelineAlgorithmVersion` — version-keys regeneration                                                                                                                                                          |
| generated output strategy    | snapshot OR ref | Store the full `GeneratedCase`, OR store `(templateVersion, seed, pipelineAlgorithmVersion)` and regenerate deterministically (audit §5.6). Either is sound because the reproduction key ⟹ identical output (this design §6). |
| retry metadata               | —               | `attempt`, `maxAttempts`, last error, timestamps — Phase 14 columns                                                                                                                                                           |
| player / status / timestamps | —               | ownership, decisions, dialogue state, completion — Phase 14                                                                                                                                                                   |

**Reproduction at Phase 14:** load content at `templateVersion` → shape a `CaseTemplateSnapshot` → `generateCase(snapshot, storedSeed)` → verify with `validateGeneratedCase` → the result deep-equals the stored/expected `GeneratedCase`. Deterministic regeneration from a stored seed is therefore Phase 14's load path, not a new algorithm.

**Retry at Phase 14:** on a retryable failure, increment `attempt`, derive `deriveRetrySeed(seed, attempt)` (or a fresh entropy seed), call `generateCase` again under the `maxRetryLimit` policy. Nothing new is required of game-rules beyond this design.

---

## 11. Security / Entropy Considerations

- **Production seeds must be cryptographically random** (128 bits from a CSPRNG). Rationale: in a competitive/inspection game, a predictable seed lets an adversary predict generated content (which items/evidence appear, which character is the smuggler, etc.) or collide instances. 128 bits of CSPRNG entropy makes this infeasible and also renders instance collisions negligible.
- **Crypto randomness lives OUTSIDE game-rules, invoked by the caller (D2).** `seedFromEntropy` requires the caller to hand it random bytes; game-rules never calls `crypto.*`. Why: (a) the package is deliberately dependency-free and runtime-agnostic (Node, Deno/Supabase Edge, browser, React Native all expose `globalThis.crypto` but with different import/caveats — e.g., Node <19 needs `node:crypto` webcrypto, RN needs a polyfill); (b) purity/testability — a pure `seedFromEntropy` is trivially testable with fixed bytes while the platform call is not; (c) the _timing_ of the call is instance lifecycle (Phase 14), not generation (Phase 12/13). This is the documented, intentional boundary.
- **Deterministic testing seeds are fine by design:** golden/unit tests use fixed canonical seeds (`seedFromEntropy(known bytes)`) or plain strings (`'case-demo-seed-123'`). They are reproducible by construction and never hit the CSPRNG. `deriveRetrySeed` gives a deterministic retry without entropy at all — appropriate for tests and constrained environments, and documented as the low-entropy alternative (production should prefer fresh CSPRNG bytes for initial seeds).
- **No hidden global/random state:** game-rules keeps zero module-level mutable state; every function in `seed.ts`/`validate.ts` is a total or typed pure function of its arguments. No `Math.random`, no timestamps, no counters inside game-rules.
- **Not over-engineered:** no KDF, no UUID import, no base64/URL-safe encodings, no per-domain randomness aside from the existing frozen D1 derivation. A plain 128-bit hex seed is the minimum that meets uniqueness + predictability goals; anything fancier would be speculative.

---

## 12. Testing Strategy

Vitest (existing framework, no new deps), mirroring the Phase 6–10/12 pattern (golden + property + pure-function).

| Category (from the requirements)              | Tests                                                                                                                                                                                                                                 |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Same seed → same output                       | `generateCase(snapshot, seed)` twice ⇒ `toEqual`; extend to a canonical seed via `seedFromEntropy(knownBytes)` and deep-compare incl. `metadata`.                                                                                     |
| Different seed → potentially different output | existing property test; add a canonical-seed pair from two distinct known byte arrays ⇒ outputs differ in at least one class (when the snapshot admits it).                                                                           |
| Retry → new seed                              | `deriveRetrySeed(seed, 1) !== seed`; `deriveRetrySeed(seed, n) !== deriveRetrySeed(seed, m)` for `n≠m`; `seedFromEntropy(a) !== seedFromEntropy(b)` for `a≠b`.                                                                        |
| Retry does not mutate previous result         | deep-freeze the `GeneratedCase` of attempt 1; run `generateCase(snapshot, deriveRetrySeed(seed,1))`; assert frozen object byte-identical, and the two results differ only through the seed.                                           |
| Algorithm version compatibility               | `PIPELINE_ALGORITHM_VERSION === 1`; present on every result; **reproduction-key simulation**: read back `(templateVersion, seed, pipelineAlgorithmVersion)` from a result and regenerate ⇒ identical case (§6 golden).                |
| Deterministic test seeds                      | `seedFromEntropy` with fixed bytes ⇒ golden pinned hex; repeat calls identical; `deriveRetrySeed` goldens.                                                                                                                            |
| Seed format validation                        | `seedFromEntropy(16×0x00)` ⇒ exactly `'0000…0'` (32 chars — zero-padding preserved); `isValidSeed` true for 32-lowercase-hex, false for wrong length/uppercase/non-hex/empty; `seedFromEntropy` rejects ≠16 bytes with a typed error. |
| Independence of domain-derived seeds          | existing `deriveDomainSeed` tests (distinct domains ⇒ distinct seeds; insertion-safe); plus assert `deriveRetrySeed(seed,1)` differs from all four pipeline `deriveDomainSeed(seed, …)` values.                                       |
| No hidden global/random state                 | pure-function proofs: `seedFromEntropy`/`deriveRetrySeed`/`validateGeneratedCase` called with identical inputs ⇒ identical outputs (no module state); reuse the existing "zero module-level let/var" convention.                      |
| No database dependency                        | all seed/validate tests construct plain in-memory snapshots and never import any DB/Supabase module; game-rules has no such import (also enforced by `eslint src`).                                                                   |
| `validateGeneratedCase` (new)                 | valid case ⇒ `[]`; injected defect ⇒ exactly the matching typed issue: missing required, count below lower / above upper, duplicate id, id ∉ snapshot, mismatched template identity/version.                                          |
| Post-retry verification                       | a successful retry's `GeneratedCase` passes `validateGeneratedCase`; a failed attempt yields the same typed error union as a first attempt.                                                                                           |

File layout: `test/generation/seed.test.ts` (seed contract), `test/generation/retry.test.ts` (retry + reproducibility golden), `test/generation/validate-generated.test.ts` (verify guard). Existing pipeline tests remain untouched and passing.

Commands run at implementation time: `npm run typecheck` (src + test), `npm run lint`, `npm test` (all 17 files), `npm run build` in `packages/game-rules`; root `npm run lint` and `npm run typecheck` across workspaces. (Pre-existing, unrelated: `apps/admin/next-env.d.ts` fails `format:check`; untouched.)

---

## 13. Migration / Schema Implications

**None.** No new tables, no new columns, no new enums, no seed column anywhere in the content schema. Seed is instance data and lands on the Phase 14 `case_instances` table (its design, not implemented here). `supabase db reset` remains at the 0001–0016 baseline with zero schema change. game-rules gains only pure TS files.

---

## 14. Risks

- **Format creep into `generateCase` (highest).** A future fix may call `isValidSeed` inside `generateCase`, breaking permissive consumption and existing goldens. Mitigation: `generateCase` stays permissive; `isValidSeed` is documented as a creation/storage-boundary check, enforced by tests (`generateCase` with non-canonical seeds must keep working).
- **Retry framework over-build.** A stateful `Retrier`/policy queue in game-rules would duplicate Phase 14. Mitigation: retry = plain `generateCase(newSeed)`; only the pure attempt-keyed derivation lives here (D4/D5).
- **`seedFromEntropy` length/encoding bugs.** Leading-zero loss or mutable-buffer aliasing would corrupt seeds. Mitigation: pinned golden tests (`16×0x00` ⇒ 32 zeros), fixed-width production, and bytes copied into a fresh array.
- **Silent algorithm drift.** Any change to the frozen derivations silently changes stored-seed reproduction. Mitigation: goldens + the version-bump rule extended to `seedFromEntropy`/`deriveRetrySeed` (§7), and the reproduction-key test (regenerate-from-stored-fields).
- **Misread of "fallback generation".** Someone may implement constraint relaxation to force a case out. Mitigation: explicitly NOT implemented (D6); documented rationale (breaks determinism/atomicity, Phase 12 §9).
- **Validation asymmetry.** `validateGeneratedCase` re-deriving bounds must match generator math exactly or it false-positives. Mitigation: reuse the exact `lower`/`upper` formulas and pin with tests against generated output.
- **Scope bleed into Phase 14.** Instance state, idempotency, limits, persistence are tempting. Mitigation: §8/§10 boundaries are explicit; D7 (no table), D9 (no coupling).

---

## 15. Explicitly Deferred Features (not implemented by Phase 13)

- Case Instance database model (table, columns, RLS) — **Phase 14**.
- Case Instance persistence, save/load, regeneration orchestration — **Phase 14**.
- Player ownership, active-instance uniqueness/idempotency enforcement — **Phase 14**.
- Initial-seed _timing_ ("when a Case Instance starts") — **Phase 14** (the primitive is this phase).
- Max retry limit policy + retry counters + retryability classification storage — **Phase 14**.
- Retry UI / admin UI / mobile UI — **later phases**.
- Authentication / any service coupling — **later phases**.
- Runtime state, dialogue generation, mission generation, class-B discovery — **Phase 14/36**.
- Content-semantic validation: "at least one suspect", "at least one critical evidence", "dialogues dependent on present characters", "case remains solvable" — **Phase 26 (publish-time) + Phase 36 (runtime)**.
- "Fallback generation" via constraint relaxation — **NOT implemented, by decision** (D6).
- Any rule-engine change — **none required** (verified: Phase 12 already evaluates class-A; this phase adds no operator, context, or parser change).
- Any migration / SQL enum / shared-types / content-schema change — **none**.

---

## 16. Decision Log

| #   | Decision                                                                                                                            | Rationale                                                                                                                                                                  |
| --- | ----------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | **Canonical seed = 32 lowercase hex chars `[0-9a-f]{32}` (128 bits)**; `generateCase`/`deriveDomainSeed` stay permissive            | Matches existing hex encoding; 128-bit entropy floor; fixed width preserves leading zeros; format enforced at creation/storage, never at pipeline input (existing goldens) |
| D2  | **Entropy sourced OUTSIDE game-rules**: `seedFromEntropy(bytes)` is pure; caller supplies 16 CSPRNG bytes                           | Keeps the package dependency- and runtime-agnostic; pur e/testable; the CSPRNG call belongs to instance lifecycle timing (§11)                                             |
| D3  | **`deriveRetrySeed(seed, attempt)` = `cyrb128(seed + '\u0000retry:' + attempt)` hex** — deterministic, attempt-keyed                | Guarantees new-seed per retry without entropy; fully deterministic retries `(snapshot, seed, attempt)`; reuses frozen D1 derivation family                                 |
| D4  | **Retry is exactly `generateCase(snapshot, newSeed)`** — no wrapper, no retrier, no state                                           | Purity + determinism make a plain re-invoke the entire retry mechanism; avoids speculative abstraction                                                                     |
| D5  | **Retry counters, max limit, and retryability policy are Phase 14 instance metadata**; the only pure-layer retry input is `attempt` | Counters/limits are orchestration state, not generation; keeps game-rules stateless (§5)                                                                                   |
| D6  | **No fallback generation** — constraint relaxation is banned; the only re-run is a new seed                                         | Phase 12 §9 "never a fallback, retry, or relaxed re-evaluation"; relaxation breaks determinism + atomicity and risks "impossible-case" silent downgrades                   |
| D7  | **No duplicate-prevention/idempotency table or case seed storage in Phase 13** — instance state is Phase 14                         | Idempotency needs instance state; audit §5.6 + Phase 12 both place it at Phase 14; no speculative table                                                                    |
| D8  | **`isValidSeed` is a creation/storage-boundary check, not a pipeline input check**                                                  | Permissive consumption preserved; goldens keep passing; validation targets authors/store keepers                                                                           |
| D9  | **game-rules stays coupled to nothing outside it** (no Supabase/HTTP/UI/auth/instance persistence)                                  | Guarded boundary; runtime/service owns CSPRNG call, loads, persistence, retry policy (§9)                                                                                  |
| D10 | **`validateGeneratedCase` is verify-only** (returns typed issues, never repairs) and reuses the exact generator bounds math         | Satisfies TODO "Generation validation" + provable "no impossible case"; safe defense-in-depth for Phase 14 load/persist (§7)                                               |
| D11 | **`seedFromEntropy` encoding + `deriveRetrySeed` enter the frozen, versioned contract** under `PIPELINE_ALGORITHM_VERSION`          | Any change would alter reproduction; goldens + version-bump rule extended to the new derivations (§7)                                                                      |

---

## 17. Self-Review

- [x] §1 verifies the architecture and Phase 12 pipeline from the actual code at `4447833`, not assumptions (including that `generateCase` accepts any string, no `case_instances`, no seed reference anywhere in migrations/shared-types/content-schema).
- [x] §2 maps TODO §12-deferred retry + every TODO Phase 13 bullet precisely; content-semantic bullets deferred to 26/36; "fallback" and "max retry limit" explicitly decided (D5/D6).
- [x] §4 lifecycle model distinguishes **generation input** (pure tuple: snapshot, templateVersion, seed, pipelineAlgorithmVersion) from **runtime instance state** (Phase 14) — requirement 8.
- [x] §5 retry: same-snapshot determinism, MUST-be-new seed (two governed paths), never mutates previous result, `generateCase(newSeed)` definition, retry count/metadata → Phase 14 — requirement 2.
- [x] §6 reproducibility contract stated as a frozen tuple + exact reproduction procedure + frozen elements + golden — requirement 3.
- [x] §7 algorithm versioning: interaction with old seeds keyed on stored `pipelineAlgorithmVersion`; v1 frozen; no registry built (non-speculative) — requirement 3.
- [x] §8 duplicate/idempotency boundary: Phase 13 does not prevent duplicates; determinism is the primitive; defers instance-state enforcement to Phase 14; no invented table — requirement 4.
- [x] §9 API/module boundaries: exactly what game-rules accepts vs what the runtime owns; no coupling — requirements 1, 7.
- [x] §10 Phase 14 compatibility: explicit persisted field list (caseTemplateId, templateVersion, seed, pipelineAlgorithmVersion, output strategy, retry metadata) and the regeneration/verify load path — requirement 8.
- [x] §11 security/entropy: CSPRNG mandatory in production; crypto randomness explicitly outside game-rules with rationale; deterministic test seeds distinguished; no hidden state; not over-engineered — requirements 6.
- [x] §12 testing strategy covers all nine required categories plus `validateGeneratedCase` and reproduction-key simulation — requirement 9.
- [x] §13 migration/schema: none; reset baseline untouched — requirement 14.
- [x] §15 explicitly deferred: instance model, persistence, ownership, runtime state, UI, auth, fallback, retry-limit persistence, content validation, rule-engine changes.
- [x] No code, migration, shared-types, content-schema, Admin, Mobile, or game-rules implementation changed by this document — design only.

---

## 18. Conclusion

Phase 12 delivered a pure, deterministic, atomic pipeline but left its seed ungoverned. Phase 13 closes that gap with three additive, dependency-free pieces in `packages/game-rules`: a canonical **seed format** with pure entropy-to-seed creation (`seedFromEntropy`) and format validation (`isValidSeed`); governed **retry semantics** where retry is exactly `generateCase(snapshot, newSeed)` with a deterministic attempt-keyed `deriveRetrySeed` — and where counters, limits, idempotency, and persistence are explicitly Phase 14; and a verify-only **`validateGeneratedCase`** guard that makes "never an impossible case" provable on any generated (and later persisted/regenerated) case. The **reproducibility contract** is frozen as `(content at templateVersion, templateVersion, seed, pipelineAlgorithmVersion, pipeline order)` and pinned by a reproduction-key golden, giving Phase 14 a sound basis to store a seed and regenerate identically. No schema, migration, shared-types, or content-schema change is proposed, and no fallback-by-relaxation is introduced. Implementation belongs in `packages/game-rules` (`seed.ts`, `validate.ts`, three test files) in the Phase 13 build step, gated on this document's approval.
