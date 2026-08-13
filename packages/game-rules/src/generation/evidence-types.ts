import type { EvidenceImportance, EvidenceRole } from '@gate8/shared-types';
import type { EvidenceSelectionError } from './evidence-errors.js';

/**
 * One `case_evidence` relation row as consumed by the generator. The
 * generator is a pure function over a version-pinned snapshot; it never
 * queries the database itself (Phase 12/14 load the snapshot and call it).
 */
export interface EvidenceSelectionCandidate {
  evidenceId: string;
  /**
   * The four evidence types (required/optional/decoy/hidden), typed in the
   * TS layer (R4). `null` is treated as `optional`. The value is preserved
   * unchanged into the output and is never reinterpreted during generation.
   */
  role: EvidenceRole | null;
  weight: number;
  /** Per-case override of the entity default importance; carried unchanged. */
  importance: EvidenceImportance | null;
  /** Free text (R4); carried unchanged to the generated evidence. */
  discoveryMethod: string | null;
  priority: number;
  version: number;
}

/**
 * Fully prepared input: version-pinned template + relation snapshot + seed.
 * `minEvidence`/`maxEvidence` bound the number of DISTINCT evidence types;
 * each selected type contributes exactly one instance (single-instance — no
 * quantity concept exists for evidence).
 *
 * `discovery_condition` and `conditions` are intentionally NOT part of the
 * candidate: they are opaque and remain deferred to the Phase 11 rule engine.
 */
export interface EvidenceSelectionInput {
  caseTemplateId: string;
  templateVersion: number;
  /** Lower bound on the generated distinct-evidence count; `0` = no minimum. */
  minEvidence: number;
  /** Upper bound on the generated distinct-evidence count; `0` = no maximum. */
  maxEvidence: number;
  evidence: EvidenceSelectionCandidate[];
  seed: string;
  /**
   * Phase 11 extension point: a caller-provided predicate that narrows the
   * eligible pool. When omitted, every snapshot row is eligible (Phase 10).
   */
  eligibilityFilter?: (candidate: EvidenceSelectionCandidate) => boolean;
}

/** A generated evidence in the case evidence set (approved design §9). */
export interface GeneratedEvidence {
  evidenceId: string;
  role: EvidenceRole | null;
  importance: EvidenceImportance | null;
  discoveryMethod: string | null;
}

export type EvidenceSelectionResult =
  | {
      ok: true;
      evidence: GeneratedEvidence[];
      caseTemplateId: string;
      templateVersion: number;
      seed: string;
    }
  | { ok: false; error: EvidenceSelectionError };
