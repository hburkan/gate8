import type { CaseInstance } from '@gate8/shared-types';
import type { CaseTemplateSnapshot, GeneratedCase } from '@gate8/game-rules';

/**
 * Repository / loader ports for the Case Instance (design §24). These are the
 * pure contracts a Phase 36 Supabase implementation must uphold: `insert` is
 * the single atomic `INSERT ... RETURNING *` (design §20), and `loadTemplate`
 * is the Phase 14 loader that joins `cases` + relations into the frozen
 * `CaseTemplateSnapshot` (defined here, implemented later).
 */

/** The insert payload: identity + immutable snapshot + initial lifecycle. */
export interface NewCaseInstance {
  caseTemplateId: string;
  templateVersion: number;
  pipelineAlgorithmVersion: number;
  seed: string;
  generatedSnapshot: GeneratedCase;
  status: 'generated';
  generationAttempts: number;
  lastGenerationError: string | null;
  startedAt: null;
  completedAt: null;
}

export type InsertInstanceResult =
  | { ok: true; instance: CaseInstance }
  | { ok: false; error: { type: 'PersistenceError'; reason: string } };

/** One row, whole payload, atomic insert — no multi-row partial state (design §20). */
export interface CaseInstanceRepository {
  insert(row: NewCaseInstance): Promise<InsertInstanceResult>;
}

/** Result of sourcing a template for creation (design §21 TemplateNotFound). */
export type TemplateLoadResult =
  | { ok: true; snapshot: CaseTemplateSnapshot }
  | { ok: false; error: { type: 'TemplateNotFound'; caseTemplateId: string } };
