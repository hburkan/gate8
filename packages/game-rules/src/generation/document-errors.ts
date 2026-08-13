/**
 * Typed, data-carrying failures for document selection. Never a silent
 * fallback: every invalid configuration maps to exactly one discriminated
 * member. Publish-time validation (Phase 26) is the preferred detection layer;
 * these errors are the pure-generator backstop for already-published or
 * historical content (approved Phase 9 design §10).
 *
 * Discriminant `type` strings follow the approved design (identical to the
 * character/item-selection errors where the failure is shared). Interface
 * identifiers carry a `Document` prefix to avoid `export *` collisions with
 * the Phase 6 character `errors.ts` and the Phase 7 `item-errors.ts`.
 */

export interface DocumentRequiredExceedsMaxError {
  type: 'RequiredExceedsMax';
  requiredCount: number;
  maxDocuments: number;
}

export interface DocumentPoolBelowMinimumError {
  type: 'PoolBelowMinimum';
  poolSize: number;
  minDocuments: number;
}

export interface DocumentNoEligibleDocumentsError {
  type: 'NoEligibleDocuments';
  caseTemplateId: string;
}

export interface DocumentInsufficientPoolError {
  type: 'InsufficientPool';
  target: number;
  selectedCount: number;
}

export interface DocumentInvalidWeightError {
  type: 'InvalidWeight';
  documentId: string;
  weight: number;
}

export interface DocumentVersionMismatchError {
  type: 'VersionMismatch';
  templateVersion: number;
  documentId: string;
  version: number;
}

export interface DocumentInvalidBoundsError {
  type: 'InvalidBounds';
  minDocuments: number;
  maxDocuments: number;
}

export interface DocumentDuplicateDocumentError {
  type: 'DuplicateDocument';
  documentId: string;
}

export type DocumentSelectionError =
  | DocumentRequiredExceedsMaxError
  | DocumentPoolBelowMinimumError
  | DocumentNoEligibleDocumentsError
  | DocumentInsufficientPoolError
  | DocumentInvalidWeightError
  | DocumentVersionMismatchError
  | DocumentInvalidBoundsError
  | DocumentDuplicateDocumentError;
