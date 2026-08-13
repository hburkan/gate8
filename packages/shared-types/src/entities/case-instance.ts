import type { InstanceStatus } from '../enums.js';

/**
 * Case instance — the persistent runtime record of a generated case.
 *
 * A Case Template (categories `Case` + `case_*` + global entities) is
 * immutable published content; a Case Instance is runtime data produced from
 * a `GeneratedCase` (Phase 12) and a seed (Phase 13). The instance pins the
 * reproduction key as queryable columns (`caseTemplateId`, `templateVersion`,
 * `pipelineAlgorithmVersion`, `seed`) AND stores the authoritative generated
 * payload as `generatedSnapshot` (strategy C, Phase 14 design §8).
 *
 * NOTE: shared-types must NOT import from game-rules. game-rules already
 * depends on @gate8/shared-types (its only dependency); importing
 * `GeneratedCase` back into shared-types would create a workspace dependency
 * cycle (shared-types → game-rules → shared-types). shared-types stays a
 * leaf-level DB-mirror package. `generatedSnapshot` is therefore typed as
 * `unknown` — a JSON-opaque mirror of the DB jsonb column. The typed
 * `GeneratedCase` parse/refinement lives in the runtime layer (packages/
 * runtime), which is allowed to depend on both shared-types and game-rules.
 *
 * Ownership (`playerId`) is deliberately absent: no player model exists
 * (Phase 38 adds it additively).
 */
export interface CaseInstance {
  id: string;
  caseTemplateId: string;
  templateVersion: number;
  pipelineAlgorithmVersion: number;
  seed: string; // 32 lowercase hex
  generatedSnapshot: unknown; // JSON-opaque DB mirror; the typed GeneratedCase parse lives in the runtime layer
  status: InstanceStatus;
  generationAttempts: number;
  lastGenerationError: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
