/**
 * Typed, data-carrying failures for evidence selection. Never a silent
 * fallback: every invalid configuration maps to exactly one discriminated
 * member. Publish-time validation (Phase 26) is the preferred detection layer;
 * these errors are the pure-generator backstop for already-published or
 * historical content (approved Phase 10 design §10/§13).
 *
 * Discriminant `type` strings follow the approved design (identical to the
 * character/item/document-selection errors where the failure is shared).
 * Interface identifiers carry an `Evidence` prefix to avoid `export *`
 * collisions with the Phase 6 character `errors.ts`, Phase 7 `item-errors.ts`,
 * and Phase 9 `document-errors.ts`.
 */

export interface EvidenceRequiredExceedsMaxError {
  type: 'RequiredExceedsMax';
  requiredCount: number;
  maxEvidence: number;
}

export interface EvidencePoolBelowMinimumError {
  type: 'PoolBelowMinimum';
  poolSize: number;
  minEvidence: number;
}

export interface EvidenceNoEligibleEvidenceError {
  type: 'NoEligibleEvidence';
  caseTemplateId: string;
}

export interface EvidenceInsufficientPoolError {
  type: 'InsufficientPool';
  target: number;
  selectedCount: number;
}

export interface EvidenceInvalidWeightError {
  type: 'InvalidWeight';
  evidenceId: string;
  weight: number;
}

export interface EvidenceVersionMismatchError {
  type: 'VersionMismatch';
  templateVersion: number;
  evidenceId: string;
  version: number;
}

export interface EvidenceInvalidBoundsError {
  type: 'InvalidBounds';
  minEvidence: number;
  maxEvidence: number;
}

export interface EvidenceDuplicateEvidenceError {
  type: 'DuplicateEvidence';
  evidenceId: string;
}

export type EvidenceSelectionError =
  | EvidenceRequiredExceedsMaxError
  | EvidencePoolBelowMinimumError
  | EvidenceNoEligibleEvidenceError
  | EvidenceInsufficientPoolError
  | EvidenceInvalidWeightError
  | EvidenceVersionMismatchError
  | EvidenceInvalidBoundsError
  | EvidenceDuplicateEvidenceError;
