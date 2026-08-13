# Phase 14 — Case Instance / Runtime Persistence Model

> **Status:** DESIGN — for review (design-only; nothing implemented, migrated, or committed). This document specifies the Case Instance model: the persistent, playable runtime record produced from a Phase 12 `GeneratedCase` and a Phase 13 seed. It fixes the table, the identity/version/seed columns, the hybrid snapshot strategy (canonical generation identity + persisted generated snapshot), the CREATE-time-vs-load verification gate, the lifecycle state machine, retry/idempotency semantics, RLS, and the game-rules ↔ runtime boundary. No database, migration, shared-types, content-schema, game-rules, Admin, or Mobile change is made by this document.

**Goal:** Convert a pure generated `GeneratedCase` into a durable, replayable, auditable "Suspicious Luggage #829183" row — the explicit architectural boundary between CASE TEMPLATE (content) and CASE INSTANCE (runtime).

**Architecture:** One new table (`case_instances`) plus one new enum (`instance_status`) in a single additive migration (`0017`). The instance stores the reproduction key as queryable columns (`case_template_id`, `template_version`, `seed`, `pipeline_algorithm_version`) AND the authoritative generated payload as a strongly typed JSONB snapshot (strategy C — §8). game-rules stays a pure dependency-free library; every DB/runtime concern lives in the future runtime layer with the loader/orchestrator contract defined here, not implemented.

---

## 1. Current Architecture (verified against the repository at `ba97595`)

- **Monorepo:** npm workspaces. `packages/shared-types` (compile-time types mirroring the DB), `packages/content-schema` (zod validation of _content_ payloads), `packages/game-rules` (pure rule engine + Phase 6–13 generators/pipeline). `apps/admin` (Next.js shell), `apps/mobile` (placeholder). `backend/supabase` holds migrations 0001–0016, an empty `functions/` directory, and no runtime/service package anywhere.
- **Migrations (0001–0016, frozen):** global entities (`characters`, `items`, `documents`, `evidence`, `locations`, `dialogue_*`, `missions`), shared lifecycle (`content_status` enum, `set_updated_at()` trigger), relation tables (`case_*`, `location_*`, `chapter_*`), `cases` anchor + template config (bounds), RLS enabled on every content table **with zero policies** (0010 and per-relation `alter table … enable row level security`).
- **`cases` (1011/0016):** `id uuid pk`, `title`, `description`, `status content_status`, `version int`, `type`/`difficulty` free text, eight `min_*`/`max_*` count bounds. Relations carry `version` = parent version (R2), `UNIQUE(parent_id, entity_id)` (R3), entity FKs RESTRICT, parent CASCADE.
- **Phase 12 pipeline (`packages/game-rules`):** pure `generateCase(snapshot, seed) ⇒ GenerationPipelineResult` — either a complete `GeneratedCase` or a typed `GenerationPipelineError`. `GeneratedCase = { caseTemplateId, templateVersion, pipelineAlgorithmVersion, seed, characters: SelectedCharacter[], items: GeneratedItem[], documents: GeneratedDocument[], evidence: GeneratedEvidence[], metadata: { derivedSeeds, poolSizes, selectedCounts } }`. `pipelineAlgorithmVersion` frozen at 1 (D11).
- **Phase 13 (`seed.ts`, `validate.ts`):** `seedFromEntropy` (16 bytes ⇒ 32 lowercase hex), `isValidSeed` (creation/storage boundary only, D8), `deriveRetrySeed`, and `validateGeneratedCase(snapshot, generatedCase) ⇒ GeneratedCaseIssue[]` (verify-only, never repairs). Retry semantics: `retry = generateCase(snapshot, newSeed)`; counters/limits/idempotency/persistence explicitly Phase 14 (D5, D7).
- **Ownership/auth:** **no player, user, profile, or ownership table exists.** `auth.users` is the standard Supabase side-table (not referenced by any migration); anonymous sign-ins disabled in `config.toml`. Phase 15 = Admin authentication (roles `SUPER_ADMIN…REVIEWER`); **Phase 38 = Player data** (User/Profile/Level/XP/Currency/Inventory/Achievements/Case progress). No migration references `player_id`.
- **No `case_instances` table and no instance persistence exists anywhere** — verified: zero `create table case_instances` in migrations, zero `case_instances` reference in shared-types/content-schema/game-rules.

---

## 2. TODO Mapping

TODO.md Phase 14 (lines 623–647) "Case Instance System — Create separate Case Instance model. 'Suspicious Luggage' vs 'Suspicious Luggage #829183'."

| TODO bullet               | Verdict  | Phase / mechanism                                                                                                                                                                                   |
| ------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `caseTemplateId`          | ✓ (this) | `case_instances.case_template_id` FK → `cases.id` (§5)                                                                                                                                              |
| `playerId`                | ✗ defer  | **No player model exists.** Ownership is Phase 38 (§6). The column is deliberately NOT added now — adding an FK to a non-existent table is impossible, and a dangling nullable uuid is speculative. |
| `seed`                    | ✓ (this) | `case_instances.seed` (32 lowercase hex, CHECK-constrained) + `pipeline_algorithm_version` (§12)                                                                                                    |
| `generatedCharacters`     | ✓ (this) | inside `generated_snapshot` JSONB (strategy C, §8/§9)                                                                                                                                               |
| `generatedItems`          | ✓ (this) | inside `generated_snapshot` (§9)                                                                                                                                                                    |
| `generatedDocuments`      | ✓ (this) | inside `generated_snapshot` (§9)                                                                                                                                                                    |
| `generatedEvidence`       | ✓ (this) | inside `generated_snapshot` (§9)                                                                                                                                                                    |
| `generatedDialogue state` | ✗ defer  | Dialogue generation does not exist (Phase 36/37 engine; Phase 39 save). Deferred.                                                                                                                   |
| `decisions`               | ✗ defer  | Player decisions are Class-D runtime state → Phase 37/38/39. Deferred.                                                                                                                              |
| `status`                  | ✓ (this) | `instance_status` enum: generated → active → completed \| abandoned (§19)                                                                                                                           |
| `startedAt`               | ✓ (this) | `started_at timestamptz null` (§19)                                                                                                                                                                 |
| `completedAt`             | ✓ (this) | `completed_at timestamptz null` (§19)                                                                                                                                                               |

**Conclusion:** Phase 14 implements the runtime record and the template/instance boundary; player ownership, dialogue state, and decisions are explicitly deferred to the phases that introduce those systems. No TODO bullet is blindly checked.

---

## 3. Problem Statement

Phase 12/13 produce a pure `GeneratedCase` + a governed seed, but **nothing persists it**. Without an instance model:

1. Two callers cannot both start "Suspicious Luggage" and get distinguishable playable runs; there is no durable identity for "Suspicious Luggage #829183".
2. There is no place to store the reproduction key or the generated payload, so an active case cannot be resumed (save/load is Phase 39, but the _record_ must exist first).
3. Template edits, archives, or generator algorithm bumps silently change what a previously generated case _would_ regenerate to — nothing pins the generated output at creation time.
4. No runtime-state boundary exists, so content and runtime data can creep together (Phase 32 explicitly forbids storing player progress in the content layer).

The design must fix the template-vs-instance boundary, choose ONE snapshot strategy, and define exactly what the durable record owns today versus what later phases add.

---

## 4. Case Template vs Case Instance Boundary

|            | CASE TEMPLATE (`cases` + `case_*` + global entities)                                 | CASE INSTANCE (`case_instances`)                                                   |
| ---------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| Nature     | Immutable **published content**                                                      | **Runtime data**                                                                   |
| Versioning | `version` + relation `version` (R2); published snapshots (Phase 27 revision history) | `template_version` pinned at creation, forever                                     |
| Written by | Admin/content authors (Phase 17+)                                                    | The runtime orchestrator (Phase 36) at a player interaction                        |
| Read by    | The Phase 14 loader → `CaseTemplateSnapshot`                                         | The Case Engine → playable state                                                   |
| Mutability | New version per publish; never edited in place post-publish                          | `status`, `started_at`, `completed_at` mutate; the generated payload NEVER mutates |
| Storage    | 0003–0016 tables                                                                     | `case_instances` (this phase)                                                      |

**Rule:** the template never contains instance state; the instance never _owns_ content (it references `case_template_id` and pins values it needs as an auditable record). The two never share a table.

---

## 5. Instance Identity

- **Primary key:** `id uuid primary key default gen_random_uuid()` — the deterministic-identifier convention (migration-strategy rule 6). Human-facing label "Suspicious Luggage #<short>" is presentation, derived from `id` (Phase 37 UI), never a second key.
- **Template:** `case_template_id uuid not null references cases (id)`.
- **Exact template version:** `template_version int not null` (copied from `GeneratedCase.templateVersion`, `snapshot.templateVersion`).
- **Generation algorithm version:** `pipeline_algorithm_version int not null` (copied from `GeneratedCase.pipelineAlgorithmVersion`, frozen at 1).
- **Seed:** `seed text not null` — the raw pipeline seed (`GeneratedCase.seed`). Canonical 32 lowercase hex enforced by `check (seed ~ '^[0-9a-f]{32}$')` (the `isValidSeed` storage-boundary rule, D8). This is the value Phase 13 says Phase 14 stores.
- **Multiple instances sharing a tuple?** **Yes, explicitly allowed.** `UNIQUE(template_id, seed, algorithm_version)` is **rejected** (§14): two different players starting the same template can legitimately share a seed tuple, and rapid re-rolls during authoring/testing would collide. The PK is the only uniqueness; identity = id.

---

## 6. Ownership

- **Verified: no player/user/profile/ownership model exists.** `auth.users` is Supabase infrastructure, unreferenced; anonymous sign-ins are disabled; no migration carries `player_id`.
- **Decision: ownership is explicitly deferred to Phase 38 (Player Data).** Phase 14 adds NO `player_id` column. Rationale:
  - TODO Phase 38 ("Separate player data from content. Player: User, Profile, Level, …, Case progress, Generated case instances") is the phase that introduces the players table and the ownership link.
  - Adding a nullable `player_id` FK to a table that does not exist is a schema error; adding it without an FK invites the exact "invent an auth system" fragmentation the objective forbids.
  - Phase 38 will ship the additive `alter table case_instances add column player_id uuid` (and the ownership RLS policy). Everything Phase 14 builds is ownership-agnostic — instances are service-created records whose lifecycle is player-free until then.
- **Implication for idempotency:** "same player+template" duplicate prevention (Phase 13 §8) cannot be enforced before a player identity exists; the Phase 14 idempotency story is therefore PK-only + the reproduction determinism (§14).

---

## 7. Snapshot Strategy Comparison

| Criterion                | A) Regenerate from (template, version, seed, algoVersion)                      | B) Persist generated snapshot only              | C) Hybrid: canonical identity + persisted snapshot                                          |
| ------------------------ | ------------------------------------------------------------------------------ | ----------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Reproducibility          | Exact — **IF** content at `templateVersion` is still loadable and unchanged    | N/A (no regeneration)                           | Snapshot is authoritative; regeneration verified when content available                     |
| Template changes         | Breaks: no revision history exists (Phase 27) → old content is gone after edit | Unaffected                                      | Unaffected (snapshot immutable)                                                             |
| Algorithm changes        | Requires a version registry per algorithm (Phase 14/36 when v2 exists)         | Unaffected                                      | Unaffected (snapshot); identity carries algorithm version for audit                         |
| Deleted/archived content | Breaks: loader cannot reshape the snapshot                                     | Unaffected                                      | Unaffected at runtime; regeneration path reports content-unavailable (audit only)           |
| Performance              | Recompute per load (CPU + joins every resume)                                  | Instant load (one row)                          | Instant load; regeneration only as an audit/verification option                             |
| Debugging/audit          | Can recompute the case at any time with a valid content version                | Weak — no way to prove a snapshot is genuine    | Strong: regeneration equals stored snapshot when content is intact                          |
| Future migrations        | Must keep every historic version of content forever (Phase 27) — heavy         | Snapshot format must be versioned independently | Snapshot format versioned by `pipeline_algorithm_version`; no dependence on content history |
| Offline/mobile           | Requires full content pack at exact version locally (Phase 32–34)              | Snapshot travels with the instance              | Snapshot travels with the instance (Phase 32/34)                                            |
| Runtime mutations        | Every mutation would need to be overlayed on a regenerated base                | Snapshot is the single mutable-adjacent record  | Only the lightweight runtime columns (`status`/timestamps) mutate; payload immutable        |

---

## 8. Chosen Snapshot Strategy

**C — Hybrid: canonical generation identity (as queryable columns) + persisted generated snapshot (as one JSONB column).**

- The instance row is created **atomically in one INSERT** from an already-validated `GeneratedCase`; the `generated_snapshot` is immutable from that moment.
- The reproduction identity (`case_template_id`, `template_version`, `seed`, `pipeline_algorithm_version`) is **duplicated as columns** so it is queryable (analytics Phase 41/42, admin, debugging) and is the Phase 13 reproduction key.
- **Why not A (regenerate-only):** the repository has **no content revision history** (Phase 27 hasn't shipped; `cases`/relations are edited in place with `version` bumped, and old rows are overwritten). A "Suspicious Luggage #829183" generated yesterday must survive today's template edit; regeneration-only would silently produce a different case the moment content changed. Reproducibility is therefore not the _authority_ — the snapshot is.
- **Why not B (snapshot-only):** without the identity columns you lose the audit trail (which seed, which template version, which algorithm produced this case) that Phase 26 publish validation, Phase 27 history, and debugging all need; and you forfeit the "regenerate ⇒ deep-equals stored" integrity proof that Phase 13 §6 explicitly designed.
- Snapshot and regeneration agree with the Phase 13 reproduction contract: `"load content at templateVersion ⇒ generateCase(snapshot, seed) ⇒ validateGeneratedCase ⇒ deep-equals."` That procedure becomes the **audit/verification path**; when content is edited/archived it reports a mismatch (content changed since generation) rather than corrupting the instance.

---

## 9. Generated Content Persistence

Three layers must not be conflated:

1. **TEMPLATE DATA** — the global entities + `case_*` relations. Referenced live by their stable ids (`character_id`, `item_id`, …). Authoritative content; Versioned `cases.version`. The Phase 14 loader joins entity metadata (occupation/name) into a `CaseTemplateSnapshot` at runtime — **never persisted into the instance** (avoids duplicating content pools; the entity content is fetched from global tables at play time).
2. **GENERATED INSTANCE DATA** — the pipeline's actual decisions, which the roadmap says must be stored under `generatedCharacters/generatedItems/generatedDocuments/generatedEvidence`. These are the **selected entity ids plus the instance-level values the generator derived**: `characterId`+`role`, `itemId`+`quantity`+`hidden`+`discoveryMethod`, `documentId`+`role`+`hidden`+`discoveryMethod`, `evidenceId`+`role`+`importance`+`discoveryMethod`, and the `metadata.derivedSeeds/poolSizes/selectedCounts`. Persisted **in full** inside `generated_snapshot` (§25). Rationale: `quantity`, `hidden`, `role`, `importance`, `discoveryMethod` are _instance state_ (Phase 7–10 docs call them "carried unchanged" / "initial visibility (instance state)") — storing only global ids would lose them on content drift and break the "no re-interpretation" guarantees.
3. **RUNTIME MUTABLE STATE** — `status`, `started_at`, `completed_at` (this phase); everything else (discovered flags, decisions, dialogue cursors, inventory, missions, scoring) is deferred (§10).

**Decision:** the generated payload is stored **whole**, not as relational child tables. There is no `case_instance_characters/items/documents/evidence` family — that would re-create per-instance "pools" (a new layer of duplicated content), add FK grid, and complicate the single-row atomic insert, all without a cross-instance query need today (instance analytics stay at the template/status level).

---

## 10. Runtime State Boundary

**Belongs to the Case Instance (this phase):**

- `status` (lifecycle state machine, §19), `started_at`, `completed_at` — directly required by TODO Phase 14.
- `generation_attempts`, `last_generation_error` — the retry metadata Phase 13 explicitly deferred here (D5, §13).

**Explicitly deferred (with their owning phases):**

- Dialogue state / dialogue generation — Phase 36/37 (engine), Phase 39 (save).
- Decisions — Phase 37/38 (runtime, player data).
- Discovery progression (found/non-found flags on evidence/docs/items) — Phase 37 (Evidence Engine), Phase 39.
- Inventory — Phase 38 (Player Data), Phase 35/37 (Inventory Engine).
- Missions / mission progress — Phase 39 / Phase 35 (Mission Engine).
- Scoring, rewards, completion analytics — Phase 38/42.
- Save/load UX, auto-save, sync queue — Phase 39, Phase 34 offline.
- Any per-entity mutable table (`case_instance_evidence_state`, etc.) — Phase 37 when evidence discovery actually exists.

Nothing in Phase 14Timestamped defers these: no speculative column, JSON blobs, or tables for dialogue/decisions/discovery/inventory.

---

## 11. Template / Version Semantics

- **Editing after creation:** a template edit bumps `cases.version` and relation `version` (R2). The instance is **immune** — its `template_version` and snapshot are pinned. This is the core guarantee the hybrid strategy provides.
- **Published version:** publishing sets `status = 'published'` (Phase 26 validates first). Creation is a runtime policy: **only a PUBLISHED template may be instantiated** (§21). This is enforced at the orchestrator (Phase 36), not as a DB constraint — matching how `min <= max` and other content invariants are publish-time checks (§0016 comment; Phase 26).
- **Archived template / archived entities:** `status = 'archived'` is a soft-delete (archive, never hard-delete — global entity FKs are RESTRICT). A previously generated instance still loads from its snapshot and still resolves entity display data from the global rows (which still exist). Regeneration's audit path reports content-version-change (template updated further or relations changed) — a log line, not a failure.
- **Algorithm version change:** new instances use the new `pipeline_algorithm_version`; stored instances keep theirs and are never silently re-generated (§12). A version registry is explicitly NOT built until an actual v2 exists (Phase 14/36 plan per Phase 13 §7).
- **Deletion:** `case_instances.case_template_id` FK is RESTRICT → a template with instances cannot be hard-deleted (same policy as global-entity references).

---

## 12. Seed Integration (Phase 13 contract)

- **Persisted exactly:** `seed` (canonical 32 lower-hex; DB CHECK mirrors `isValidSeed`), `pipeline_algorithm_version`, `template_version`, `case_template_id`. This is the reproduction key tuple from Phase 13 §6.
- **Stored once, from the winning `GeneratedCase`:** `case_instances.seed = generatedCase.seed`, `pipeline_algorithm_version = generatedCase.pipelineAlgorithmVersion`, both copied at INSERT.
- **Never changed after creation.** A retry that re-runs with a new seed yields a _new_ instance row only if the new generation succeeds (§13); an existing instance's seed is immutable.
- **`isValidSeed` is applied at the storage boundary** (D8) by the runtime orchestrator AND by the DB CHECK — defense in depth. `generateCase` itself stays permissive (Phase 13 D1; tests use non-canonical seeds).

---

## 13. Retry Semantics

Retry happens **during creation**, before any instance exists. Trace: TODO has no "retry" bullet in Phase 14; Phase 13 D4/D5 defer counters/limits/persistence to Phase 14/36; Phase 36 Case Engine "Apply seed / Generate / Save instance".

Decisions:

- **Retry = a new generation, not a new persisted instance per attempt.** The orchestrator loops `generateCase(snapshot, newSeed)` with `newSeed = deriveRetrySeed(seed, attempt)` (deterministic) or fresh CSPRNG entropy; on the first `ok:true`, it `validateGeneratedCase`s and INSERTs exactly **one** `case_instances` row carrying the winning seed. Failed attempts leave **zero** rows (no "attempt records", no per-attempt state — the pure pipeline is naturally stateless).
- **Never replaces an existing instance.** An existing instance is a started/terminal case; replacing it would break save/load and determinism. Retry is only reachable when no row exists (creation).
- **No separate generation-record table.** Creating one would duplicate the pipeline's typed errors and add an abandonment path with no consumer. Failed-attempt observability lives in the orchestration layer (logging) and, minimally, on the winning row as `generation_attempts` + `last_generation_error`.
- **Retry metadata on the row** (Phase 13 §10 deferred columns): `generation_attempts int not null default 1` (number of `generateCase` calls before the winner), `last_generation_error text null` (the typed `GenerationPipelineError`/validation issue tag of the last failed attempt, for debugging). `max_attempts` **is not stored** — a retry limit is runtime policy belonging to the Phase 36 orchestrator (a number on the row would be dead storage today).

**No fallback generation** — constraint relaxation stays banned (Phase 13 D6): a failing snapshot fails identically on every retry seed (pinned by the Phase 13 retry tests); retry seeds never fix content, they only change the draw.

---

## 14. Idempotency / Duplicate Prevention

- **No DB uniqueness on the generation tuple.** `UNIQUE(case_template_id, seed, pipeline_algorithm_version)` is rejected: two legitimate instances may share it (two players; a "same case for everyone" authoring experiment; re-rolling during content validation). The objective's warning "do not make one seed unusable for two legitimate players/instances" is honored by omitting it.
- **PK uniqueness is the only SQL-level guarantee** (each instance is a distinct `id`).
- **Idempotent-by-construction property carried from Phase 13:** regenerating from the stored key produces a deep-equal `GeneratedCase` (when content@version is still loadable) — so re-running creation logic never invents a _different_ case; `INSERT` is the only state-changing op and it's single-row atomic.
- **Active-instance guard & player-scoped "at most one active per player+template"** need a player identity → **deferred to Phase 38** (owner_id + partial UNIQUE among active rows, or a status guard). Documented here, not built (Phase 13 §8 names exactly this).
- **Request/generation idempotency keys:** with no API layer yet and server-only creation not yet existing (Phase 36/40), an `idempotency_key` column would be speculative. **Deferred to the Phase 36 creation API**, which will expose `client_request_id` semantics if PostgREST/Edge needs them.

---

## 15. Proposed Database Schema

Migration **`0017_case_instances.sql`** (single migration, one concern):

```sql
-- 0017_case_instances.sql
-- Case Instance: the persistent runtime record of a generated case.
-- Boundary: a Case Template is immutable published content; a Case Instance
-- is runtime data. The instance pins the reproduction key (case, template
-- version, seed, algorithm version) as queryable columns AND stores the
-- authoritative generated payload as one strongly typed JSONB snapshot
-- (Phase 14 design strategy C). The payload is immutable after creation;
-- instance status/timestamps are the only mutable columns.
--
-- Convention alignment (Migration Strategy §rules): uuid PK, timestamps,
-- set_updated_at() trigger, RLS enabled with no policies yet (0010/0012
-- pattern); entity-style FK uses RESTRICT because deleting a template with
-- live instances is a soft-delete (archive) concern.
-- Ownership (player_id) is deliberately absent: no player model exists
-- (Phase 38 adds it additively). No *_pool duplicate tables are created.

create type instance_status as enum (
  'generated',   -- created from a validated GeneratedCase, play not started
  'active',      -- started_at set; loaded by the Case Engine
  'completed',   -- completed_at set (case finished)
  'abandoned'    -- player left / case discarded without completion
);

create table case_instances (
  id uuid primary key default gen_random_uuid(),
  case_template_id uuid not null references cases (id) on delete restrict,
  template_version int not null,
  pipeline_algorithm_version int not null,
  seed text not null check (seed ~ '^[0-9a-f]{32}$'), -- canonical 128-bit seed (isValidSeed boundary, Phase 13 D8)
  generated_snapshot jsonb not null,                  -- Phase 14 §25: the GeneratedCase payload; immutable
  status instance_status not null default 'generated',
  generation_attempts int not null default 1 check (generation_attempts >= 1),
  last_generation_error text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (completed_at is null or status = 'completed'),
  check (started_at is null or status in ('active', 'completed', 'abandoned'))
);

create index case_instances_case_template_id_idx on case_instances (case_template_id);
create index case_instances_status_idx on case_instances (status);

create trigger case_instances_set_updated_at
  before update on case_instances
  for each row execute function set_updated_at();

alter table case_instances enable row level security;
```

- **Status/timestamp CHECK constraints** enforce the state machine at the DB (a completed instance must have `completed_at`; `started_at` implies a marching status) — a cheap integrity guard, not a content constraint.
- **No new global entity or relation table is touched.**

---

## 16. FK / Delete Strategy

| FK                   | Referenced   | ON DELETE                                                             | Rationale (matches 0012/0013 convention)                                                                            |
| -------------------- | ------------ | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `case_template_id`   | `cases.id`   | **RESTRICT**                                                          | A template with live instances must not be hard-deleted; archive is the soft-delete path (same rule as entity FKs). |
| (future) `player_id` | `players.id` | (Phase 38, additive; likely `SET NULL` or `RESTRICT` — decided there) | —                                                                                                                   |

- No FKs from the snapshot to global entities (snapshot is self-describing instance data; avoids drift).

---

## 17. Index Strategy

- `case_instances_case_template_id_idx` on `(case_template_id)` — "instances of template X" (admin, analytics).
- `case_instances_status_idx` on `(status)` — lifecycle sweeps (analytics: started/completed/abandoned counts).
- No index on `seed` (no lookup path uses it; PK covers identity). No index on `generated_snapshot` (JSONB never filtered; it's loaded whole).
- These are the only indexes justified today; YAGNI on `(case_template_id, status)` composite until an actual query needs it.

---

## 18. RLS Strategy

- **Convention preserved:** `alter table case_instances enable row level security;` with **no policies** — identical to 0010/0012/0013/0015. Service role bypasses RLS; `anon`/`authenticated` are denied until policies exist.
- **Who reads/creates/updates today:** nobody but the service role (server-only orchestration). There is no client app (mobile is Phase 31+), no API (Phase 36), no auth (Phase 15 admin / Phase 38 player).
- **Future ownership policies (Phase 38):** `player_id`-scoped SELECT/UPDATE; creation from a server-only Edge Function (Phase 36/40), never client-generated. This is the existing trust-boundary posture (api-contract-strategy: Edge Functions for privileged work; Phase 40 "never trust client-generated … Decidue server-side").
- **Explicitly NOT done now:** a permissive policy so "anybody can insert" during development is rejected — RLS-off-by-default is the migration convention and enables the correctness testing §27 requires.

---

## 19. Lifecycle / State Model

```
                 ┌──────────────────────────────────────────────┐
                 │  status = generated (row INSERTed, validated) │
                 └──────────────────────────────────────────────┘
                                    │ Case Engine loads + starts (started_at = now)
                                    ▼
                              status = active
                             /        \
                            /          \
              player completes    player abandons / leaves
                 │                     │
                 ▼                     ▼
           active → completed     active → abandoned
           completed_at = now    (completed_at stays null)
```

- **`generated`** — the row was created from a `validateGeneratedCase`-clean `GeneratedCase`; not yet entered by a player.
- **`active`** — loaded by the Case Engine (Phase 36), `started_at` set.
- **`completed`** — finished; `completed_at` set (Phase 37/39/42 analytics read this).
- **`abandoned`** — discarded without completion (Phase 37/42).
- **Rejected states:** `failed` is NOT a status (a failed generation writes no row — §13); `archived` is deferred (admin lifecycle; no Phase-14 consumer). The four states map 1:1 to roads the TODO/roadmap already names (Phase 14 `status/startedAt/completedAt`; Phase 42 started/completed/abandoned; Phase 39 completion status).

---

## 20. Atomicity

- **Generation + persistence are NOT one DB transaction — by design.** `generateCase` is pure and never touches the DB (Phase 12 D9/D10; verified: no import of any DB/Supabase module). "Atomicity" lives at two points:
  1. **Pipeline atomicity** (existing): `generateCase` returns a complete case or a typed error, never a partial one.
  2. **Insert atomicity:** the orchestrator performs exactly **one** `INSERT … RETURNING *` with the whole row (identity + snapshot + status='generated'). PostgreSQL row insert is atomic; there is no multi-row partial state to manage.
- **If DB INSERT fails** (constraint violation, connection, etc.): no row exists, the typed `PersistenceError` (§21) is returned, the orchestrator may retry the CREATE path (new attempt counter) — content generation is re-runnable/pure, so nothing is corrupted.
- **If generation fails:** no instance, typed `GenerationPipelineError` propagates; retry policy (§13) decides next.
- No future step may make generation depend on a partially-inserted row: the snapshot is immutable; only status/timestamps mutate via `UPDATE` (each single-row, atomic).

---

## 21. Failure Handling

Typed, application-level failures for Phase 14 CREATE/LOAD operations (mirroring the repo's union style; only what this phase needs):

| Code                   | Meaning                                                                              | Raised when                                                                    |
| ---------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| `TemplateNotFound`     | `case_template_id` does not exist or `template_version` mismatches current           | CREATION: loader cannot source a `CaseTemplateSnapshot` (or version pin fails) |
| `TemplateNotPublished` | template `status != 'published'`                                                     | CREATION: orchestrator policy (§11)                                            |
| `InvalidSeed`          | `!isValidSeed(seed)`                                                                 | CREATION: storage-boundary format check (D8)                                   |
| `GenerationFailed`     | `generateCase` returned `ok:false` (typed `GenerationPipelineError` kept in `cause`) | CREATION: every `generateCase` call before INSERT                              |
| `ValidationFailed`     | `validateGeneratedCase` returned a non-empty `GeneratedCaseIssue[]`                  | CREATION: gate between generation and INSERT (must be `[]`; §27 test)          |
| `SnapshotParseError`   | `generated_snapshot` fails structural/typed parse on load                            | LOAD: JSON corrupt or schema-mismatched (§25/§27)                              |
| `IdentityMismatch`     | snapshot identity fields ≠ column values                                             | LOAD: defensive consistency check                                              |
| `PersistenceError`     | INSERT/UPDATE rejected by DB (constraint, trigger, connectivity)                     | CREATION/LOAD/status transitions                                               |
| `StateTransitionError` | invalid status transition (e.g. completed → active; §19 CHECK also guards)           | UPDATE: orchestrator pre-checks                                                |

These reuse the pipeline/validation error unions (never re-encode them). No speculative "not enough content", "ai failed", etc.

---

## 22. Shared-Types Design (DESIGN ONLY — not modified)

Future (Phase 14 build step), in `packages/shared-types`:

```ts
// src/enums.ts (append)
export const INSTANCE_STATUSES = ['generated', 'active', 'completed', 'abandoned'] as const;
export type InstanceStatus = (typeof INSTANCE_STATUSES)[number];

// src/entities/case-instance.ts (new)
import type { GeneratedCase } from '@gate8/game-rules/dist/index.js'; // or via exported pipeline type
export interface CaseInstance {
  id: string;
  caseTemplateId: string;
  templateVersion: number;
  pipelineAlgorithmVersion: number;
  seed: string; // 32 lowercase hex
  generatedSnapshot: unknown; // refined to GeneratedCase (§25)
  status: InstanceStatus;
  generationAttempts: number;
  lastGenerationError: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
```

- Types mirror the DB column-for-column (shared-types strategy rule 1). `generatedSnapshot` is typed as the serialized `GeneratedCase` (re-exported from game-rules) rather than re-implemented — no drift.
- Re-export from `src/index.ts`. No content-schema touch (§23).

---

## 23. Runtime Schema / content-schema Boundary

- **content-schema is exclusively for CONTENT payloads** (`caseSchema`, relation schemas, rules) validated at authoring/publish (shared-types-strategy: "what makes a content object valid"). A `CaseInstance` is **runtime data, not content**.
- **Decision: a separate runtime schema, not content-schema.** The build step adds a zod `caseInstanceSchema` (+ `generatedSnapshotSchema` = a strict mirror of `GeneratedCase`, built from the same shapes) in a **new `packages/runtime` pure package** (or, minimally, in the orchestrator module). It never enters `packages/content-schema`.
- The pure, DB-free shape parsing (snapshot ↔ object round-trip, structural reject) belongs to that runtime layer; `content-schema` stays a content-only validator. Nothing that validates `case_instances` lives inside game-rules (game-rules validates only the snapshot against a _snapshot_ — that's `validateGeneratedCase`).

---

## 24. game-rules / Runtime Boundary

| Concern                                                                    | Owner                                          | Evidence in repo                                              |
| -------------------------------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------- |
| Deterministic generation `generateCase`                                    | game-rules (pure)                              | `pipeline.ts`; zero DB imports                                |
| Seed primitives `seedFromEntropy/isValidSeed/deriveRetrySeed`              | game-rules (pure)                              | `seed.ts`                                                     |
| Verify-only guard `validateGeneratedCase`                                  | game-rules (pure)                              | `validate.ts`                                                 |
| Loading content → `CaseTemplateSnapshot` (the "Phase 14 loader")           | **runtime** (new pure package or orchestrator) | pipeline doc: "a caller (the Phase 14 loader) is responsible" |
| Entropy sourcing (`crypto.getRandomValues`)                                | runtime (Phase 14/36 call site)                | Phase 13 D2                                                   |
| Create instance, persist snapshot, load instance, status transitions, save | **runtime** (Phase 14 build / Phase 36 engine) | API/contract strategy §SServer-only>                          |
| Retry policy, `max_attempts`, request keys                                 | runtime orchestrator (Phase 36)                | Phase 13 D5; §13/§14                                          |
| Supabase/HTTP/auth/UI                                                      | runtime only                                   | game-rules has zero such imports (Phase 13 D9)                |

**Contract (no DB leak into game-rules):** game-rules exports `CaseTemplateSnapshot`, `GeneratedCase`, `GenerationPipelineError`; runtime consumes them. Runtime never imports a DB lib into game-rules, and game-rules never gains a Supabase/`node:postgres` import. The loader is specified here (it must join `cases` + `case_*` relations by `version = templateVersion` + global entity metadata into the frozen `CaseTemplateSnapshot` shape) but is **not implemented** in this design phase.

---

## 25. Serialization / Snapshot Format

- **Column:** `generated_snapshot jsonb not null`.
- **Content (exactly the validated `GeneratedCase` serialized):**
  ```json
  {
    "caseTemplateId": "…",
    "templateVersion": 1,
    "pipelineAlgorithmVersion": 1,
    "seed": "…32-hex…",
    "characters": [{ "characterId": "…", "role": "…|null" }],
    "items": [{ "itemId": "…", "quantity": 2, "hidden": false, "discoveryMethod": "…|null" }],
    "documents": [
      { "documentId": "…", "role": "…|null", "hidden": false, "discoveryMethod": "…|null" }
    ],
    "evidence": [
      { "evidenceId": "…", "role": "…|null", "importance": "…|null", "discoveryMethod": "…|null" }
    ],
    "metadata": {
      "derivedSeeds": { "characters": "…", "items": "…", "documents": "…", "evidence": "…" },
      "poolSizes": { "characters": 3, "items": 3, "documents": 2, "evidence": 3 },
      "selectedCounts": { "characters": 2, "items": 3, "documents": 2, "evidence": 2 }
    }
  }
  ```
  This is byte-for-byte the pipeline result — no wrapper, no re-shape, so the load path reconstructs the exact object and `validateGeneratedCase` round-trips (verifiable in tests).
- **Snapshot format versioning = `pipeline_algorithm_version`** (not a separate wrapper tag). If a future instance adds runtime fields (dialogue state etc., Phase 39-extension via a NEW column `runtime_state jsonb`, not by mutating `generated_snapshot`), `generated_snapshot` remains frozen. This avoids an invented envelope.
- **Why JSONB (and why justified):** the payload is a single immutable record, always read whole, never filtered/joined — exactly the shape JSONB is designed for; it keeps the instance one-row atomic (§20), avoids a `case_instance_*` FK table family with no relational query (§9/§15 comments), and its validity is enforced by the runtime schema parse + `validateGeneratedCase` at CREATE and by `SnapshotParseError` at LOAD. It is **not** a generic opaque blob — its shape is the frozen, typed `GeneratedCase` contract.

---

## 26. Migration Strategy

- **One new migration `backend/supabase/migrations/0017_case_instances.sql`** (content above). Additive; does not alter 0001–0016; does not change any content table, relation table, or enum; creates no pool duplicates.
- Follows migration rules: one concern per migration (new enum + new table + trigger + RLS in one file — precedent: 0003/0004 create table + index + trigger together), deterministic `uuid` PK, `set_updated_at()` trigger, RLS-enabled-no-policies, additive-only.
- **Verification:** `supabase db reset` (0001→0017) applies clean; no existing migration is edited.
- Follow-up same-pass work in the build step (after approval): extend `shared-types` (`InstanceStatus`, `CaseInstance`) and add the runtime snapshot schema; those are documented here, not implemented.

---

## 27. Testing Strategy

| Scenario                              | Test                                                                                                                                                     |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Instance creation                     | orchestrator: generate → validate (`[]`) → single INSERT; row has identity + snapshot + status `generated`; `generation_attempts = 1`                    |
| Same seed/version reproduction        | reload snapshot from JSONB → object deep-equals original `GeneratedCase`; `generateCase(loader(snapshot), seed)` re-produces it (contracted Phase 13 §6) |
| Duplicate/idempotency behavior        | two INSERTs with identical `(case_template_id, seed, algorithm)` both succeed ⇒ distinct ids (no tuple uniqueness); PK collision rejected                |
| FK behavior                           | `DELETE FROM cases` with an instance ⇒ RESTRICT error; `DELETE` of a bare template (no instances) still works                                            |
| RLS                                   | `anon`/`authenticated` role gets zero rows / insert denied; service role full access (no policies yet)                                                   |
| Migration reset                       | `supabase db reset` applies 0001–0017 cleanly; `dbt -r` no leftovers; enum exists                                                                        |
| Invalid snapshot rejection            | tampered JSONB fails `SnapshotParseError` on load; tampered identity (seed ≠ column) fails `IdentityMismatch`                                            |
| Creation gate                         | `validateGeneratedCase` non-`[]` blocks INSERT (`ValidationFailed`) — unit test proving a defective case never persists                                  |
| Template change after creation        | generate + insert; bump template; instance STILL loads identical snapshot; regeneration audit reports drift, instance unaffected                         |
| Algorithm version change (simulation) | reject `pipeline_algorithm_version = 2` insert if the project's known version enum rejects it; load path keys on stored version                          |
| Retry behavior                        | failing snapshot ⇒ zero rows, typed error; `deriveRetrySeed` success ⇒ one row with `generation_attempts = n` + nil error                                |
| Status transition guard               | completed → active raises `StateTransitionError`; DB CHECK independent of app layer                                                                      |
| Serialization round-trip              | `JSON.parse(JSON.stringify(GeneratedCase))` ⇄ runtime schema parse ⇒ equal; metadata preserved                                                           |

- Unit tests live in the runtime package (vitest, existing toolchain); the migration/RLS tests use `supabase db reset` + psql, matching the repo's reset-based verification. game-rules tests remain untouched (its contracts are already pinned by Phase 12/13 goldens).

---

## 28. Security

- **Seed exposure to clients:** the seed is stored server-side; any client feature (mobile local DB, Phase 32) that mirrors the instance must treat it as read-only data. Exposing the seed reveals the case the player is entitled to see anyway; the real risk (predicting _unstarted_ cases) is only a concern when seeds are also served for unstarted templates — mitigated by CSPRNG 128-bit seeds (Phase 13 §11) and by serving instances only after creation.
- **Tampering with `generated_snapshot`:** two independent defenders — runtime `SnapshotParseError`/`IdentityMismatch` on load (§21/§27) and the pure `validateGeneratedCase` gate at CREATE. A client mutating its local copy cannot alter the authoritative server row.
- **Ownership enforcement:** deferred to Phase 38 RLS (`player_id`-scoped policies). Until then, no anonymous write path exists (RLS enabled, zero policies → deny), so no bypass is possible at the DB.
- **Trust boundary:** creation/update are server-only (service role Edge Function, Phase 36/40); clients never write `case_instances` directly. This matches the existing "never trust client-generated … Vaide server-side" posture in Phase 40.
- **Not over-engineered:** no encryption at rest, no per-row crypto, no capability tokens — before authentication exists (Phase 15/38), the RLS-default-deny + server-only posture is the complete and correct control; anything more is speculative load.

---

## 29. Future Phase Compatibility

| Future system                         | Compatible? | How                                                                                                                                            |
| ------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Phase 15/40 auth + RLS                | Yes         | Policies attach to `case_instances` in Phase 38; Phase 40 hardens with role scoping.                                                           |
| Phase 26 publish                      | Yes         | Publish validator reuses the loader; creation policy "published-only" becomes a gate im the orchestrator.                                      |
| Phase 27 revision history             | Yes         | Once history exists, the regeneration/audit path becomes exact for old versions; snapshot stays the runtime authority (no backfill needed).    |
| Phase 32–34 mobile/offline            | Yes         | `generated_snapshot` is transferable/local-replayable; content still loads from local packs; save is Phase 39 (separate layer, Phase 32 rule). |
| Phase 36 Case Engine                  | Yes         | Load = one row + `generated_snapshot`; resume uses stored seed/snapshot; generation hook ready.                                                |
| Phase 37 dialogue/decisions/discovery | Yes         | New additive `runtime_state jsonb` column (or child tables) — never touches `generated_snapshot`.                                              |
| Phase 38 player data                  | Yes         | Additive `player_id` FK + ownership RLS + per-player active-instance guard.                                                                    |
| Phase 39 save system                  | Yes         | Mutation surface is exactly the 4 mutable columns; dialogue/evidence/mission progress go to new runtime state (new column/table).              |
| Phase 41/42 analytics                 | Yes         | `status`, `started_at`, `completed_at`, `case_template_id` indexes give started/completed/abandoned/average-duration aggregates.               |

---

## 30. Explicitly Deferred Features

- **Player ownership** (player_id column, ownership RLS, per-player active-instance uniqueness) — Phase 38.
- **Admin authentication / RLS policies on content** — Phase 15/40.
- **Dialogue generation & dialogue state** — Phase 36/37/39.
- **Decisions** — Phase 37/38/39.
- **Discovery progression** (evidence/item/document found flags) — Phase 37/39.
- **Inventory** — Phase 38.
- **Missions / mission progress** — Phase 35/39.
- **Scoring / rewards / completion analytics** — Phase 38/42.
- **Save/load UX, auto-save, sync queue** — Phase 39; offline sync — Phase 34.
- **Creation API / idempotency request keys / max_attempts policy** — Phase 36 runtime orchestrator.
- **Content revision history for exact historical regeneration** — Phase 27.
- **Admin UI, Mobile UI, AI** — never in this phase.

---

## 31. Risks

| Risk                                                     | Mitigation                                                                                                                          |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| **Snapshot/jsonb drift from pipeline result** (highest)  | Snapshot stores the validated `GeneratedCase` byte-for-byte; round-trip tests (§27); format version = `pipeline_algorithm_version`. |
| Regeneration vs snapshot divergence after content edits  | Snapshot is authoritative at runtime; regeneration is audit-only and logs drift rather than corrupting the row (§8/§11).            |
| Believing RLS makes instances secure before auth         | Explicit §18/§28: RLS default-deny + service-role-only until Phase 38 ownership policies.                                           |
| Adding `player_id` prematurely / inventing an auth model | Deferred to Phase 38 with the owning table; no dangling FK now (§6).                                                                |
| Status machine sprawl (`failed`, `archived`)             | Rejected; only the four roadmap-justified states; DB CHECK guards transitions (§19).                                                |
| Duplicate "instance pools" via relational child tables   | Rejected (§9); single JSONB snapshot per instance; global content pools remain canonical.                                           |
| Algorithm v2 ambiguity                                   | Version registry explicitly deferred; stored `pipeline_algorithm_version` keys all future selection (Phase 14/36).                  |
| Retry state leaking into game-rules                      | Retry = pure `generateCase(newSeed)`; counters live on the row / orchestrator, never in game-rules (§13).                           |

---

## 32. Decision Log

| #   | Decision                                                                                                                      | Rationale                                                                                                                 |
| --- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| D1  | **Instance PK = uuid, `gen_random_uuid()`**; uniqueness is the PK only; `UNIQUE(template, seed, algorithm)` rejected          | Deterministic-identifier convention; multiple legitimate instances may share a seed tuple (§5/§14).                       |
| D2  | **No `player_id` in Phase 14** — ownership deferred to Phase 38 (which owns the players table)                                | No player model exists; a dangling FK is schema-error / speculation; ownership needs the Phase 38 table & RLS (§6).       |
| D3  | **Snapshot strategy C: identity columns + persisted `generated_snapshot` JSONB**                                              | No content revision history (Phase 27) makes regenerate-only unsound; snapshot-only loses audit; C gives both (§7/§8).    |
| D4  | **Snapshot is authoritative; regeneration is an audit/verification path only**                                                | Template edits/archives must never corrupt a running instance; drift is logged, not fatal (§8/§11/§29).                   |
| D5  | **Generated payload stored whole in one JSONB column; no `case_instance_*` child tables**                                     | Single-row atomicity; no duplicated instance pools; no relational query need today; format = full GeneratedCase (§9/§25). |
| D6  | **Instance mutates only `status`/`started_at`/`completed_at`**; payload immutable                                             | Runtime boundary; everything else deferred to its owning phase (§10).                                                     |
| D7  | **Retry = pre-INSERT re-generation; failed attempts write no rows; `generation_attempts`+`last_generation_error` on the row** | Pure/stateless pipeline; no speculative attempt-record table; Phase 13 deferred these columns here (§13).                 |
| D8  | **`max_attempts`, request/idempotency keys, creation API** are Phase 36 orchestrator policy                                   | No API layer today; a constant on the row is dead storage (§13/§14).                                                      |
| D9  | **RLS enabled, zero policies; service-role-only**                                                                             | Match 0010/0012 convention; no client exists; policies arrive with player auth (§18).                                     |
| D10 | **State machine = `generated → active → completed                                                                             | abandoned`; `failed`/`archived` rejected**                                                                                | Roads map to TODO/roadmap (started/completed/abandoned analytics); failed generations never become rows (§19). |
| D11 | **Creation is orchestrator-verified then ONE atomic INSERT; generation stays DB-free**                                        | game-rules purity (Phase 12 D9); atomicity = pure pipeline + single-row insert (§20).                                     |
| D12 | **Status/timestamp DB CHECKs enforce the lifecycle independent of the app**                                                   | Integrity guard; non-content constraint (§15/§19).                                                                        |
| D13 | **New package `packages/runtime` (pure) owns loader, snapshot schema, orchestrator contract; no Supabase inside**             | Keeps DB/HTTP out of game-rules (Phase 13 D9); gives the snapshot schema a non-content home (§23/§24).                    |
| D14 | **Snapshot format version = `pipeline_algorithm_version`; no extra wrapper**                                                  | No invented envelope; future runtime fields go to a NEW `runtime_state` column (Phase 37/39), not the payload (§25).      |

---

## 33. Self-Review

- [x] **§1 verifies actual repository at `ba97595`:** migrations 0001–0016 read; no `case_instances` table; no players/user/profile table; anonymous sign-ins disabled; `functions/` empty; shared-types/content-schema/game-rules inspected; Phase 5/8/11/12/13 designs checked for the exact deferred items they place here.
- [x] **§2 maps every TODO Phase 14 bullet** to a mechanism or an explicit deferral (playerId/dialogue/decisions); no blind checkmark.
- [x] **§4 template/instance boundary** is explicit and non-overlapping.
- [x] **§5 identity** answered completely (PK, UUID, template, versions, seed, multi-instance, uniqueness).
- [x] **§6 ownership** verified absent and explicitly deferred to Phase 38 — no invented auth (§objective requirement).
- [x] **§7/§8 snapshot strategy** compares A/B/C on ten criteria and chooses C with a repo-grounded reason (no revision history yet).
- [x] **§9** separates template vs generated-instance vs runtime-mutable state and avoids "global ids only" and "duplicate pools" both ways.
- [x] **§10 runtime boundary** defers dialogue/decisions/discovery/inventory/scoring/save with owning phases.
- [x] **§11 template immutability/versioning** covers edit/publish/archive/algorithm-bump; no silent regeneration.
- [x] **§12 seed integration** persists exactly the Phase 13 reproduction key; `isValidSeed` notified at storage boundary + DB CHECK.
- [x] **§13 retry** decisions trail TODO/Phase 13 (new generation per attempt, one winner row, retry metadata columns, no policy constant).
- [x] **§14 idempotency** rejects the seed-tuple UNIQUE and defers player-scoped guards + request keys to their phases.
- [x] **§15–§18** full DDL with columns/types/PK/FK/ON DELETE/unique/indexes/timestamps/status/RLS/ownership, following the repo's migration conventions (additive, uuid pk, trigger, RLS pattern, RESTRICT entity FK).
- [x] **§19 lifecycle/§20 atomicity/§21 failures** minimal and roadmap-justified; typed failure union only where needed.
- [x] **§22–§24 shared-types (design-only), content-schema boundary, game-rules/runtime boundary** all mapped against the actual package layout.
- [x] **§25 serialization** exact; JSONB justified (not a generic blob — the frozen `GeneratedCase` shape).
- [x] **§26 migration** additive `0017`, preserves 0001–0016, `supabase db reset` clean.
- [x] **§27 testing** covers the objective's list (creation, reproduction, template-change, algorithm change, retry, idempotency, FK, RLS, reset, serialization, invalid-snapshot rejection).
- [x] **§28 security** pre-auth minimal: RLS default-deny + server-only + seed exposure reasoned; not over-engineered.
- [x] **§29–§30 future compatibility & deferred features** map dialogue/missions/decisions/discovery/inventory/scoring/save/mobile/publish/revision/runtime-rules.
- [x] **Deferred decisions marked:** ownership policy shape (Phase 38), creation API/idempotency key (Phase 36), max-attempt policy (Phase 36), per-player uniqueness (Phase 38), exact revision history (Phase 27), offline sync (Phase 34). The repository has no content-history table and no player table, so these cannot be decided here without speculation.
- [x] **No code, migration, shared-types, content-schema, game-rules, Admin, or Mobile change was made by this document** — design only; nothing committed.

---

## 34. Conclusion

Phase 14 makes the template/instance split real and durable: **Case Template is immutable published content; Case Instance is runtime data.** One new `case_instances` table (migration `0017`) carries the reproduction identity (`case_template_id`, `template_version`, `seed`, `pipeline_algorithm_version`), the authoritative, immutable `generated_snapshot` (the Phase 12 `GeneratedCase` payload, strongly typed JSONB), and a minimal four-state lifecycle (`generated → active → completed | abandoned`) with `started_at`/`completed_at` and retry metadata. Snapshot strategy **C** is chosen because the repository has no revision history (Phase 27) — the snapshot is the runtime authority, regeneration is the audit when content@version still loads. Ownership is explicitly deferred to Phase 38's player model (no invented auth), idempotency is PK-only plus determinism (no seed-tuple unique), retry writes at most one row per instance, and every dialogue/decision/discovery/inventory/scoring/save concern is traced to its owning phase. game-rules stays a pure dependency-free library; the loader and orchestrator contracts are defined as a future pure `packages/runtime`. Implementation belongs in migration `0017`, shared-types additions, and the runtime package — gated on this document's approval, exactly as this phase's boundary requires.
