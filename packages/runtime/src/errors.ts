import type { GenerationPipelineError, GeneratedCaseIssue } from '@gate8/game-rules';

/**
 * Typed, application-level failures for Phase 14 CREATE/LOAD (design §21),
 * mirroring the repository's union style. `TemplateNotPublished` and
 * `StateTransitionError` are deliberately absent: they are Phase 36
 * orchestrator forward-contracts, not codes this phase can raise.
 */
export type RuntimeFailure =
  | { type: 'TemplateNotFound'; caseTemplateId: string; templateVersion: number }
  | { type: 'InvalidSeed'; seed: string }
  | { type: 'GenerationFailed'; cause: GenerationPipelineError }
  | { type: 'ValidationFailed'; issues: GeneratedCaseIssue[] }
  | { type: 'SnapshotParseError'; reason: string }
  | { type: 'IdentityMismatch'; field: SnapshotIdentityField }
  | { type: 'PersistenceError'; reason: string };

/**
 * Snapshot identity fields that must equal their row columns. The defensive
 * consistency check that turns a tampered snapshot into an `IdentityMismatch`
 * on LOAD (design §§21/27).
 */
export type SnapshotIdentityField =
  'caseTemplateId' | 'templateVersion' | 'pipelineAlgorithmVersion' | 'seed';
