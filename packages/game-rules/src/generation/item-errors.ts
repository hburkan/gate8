/**
 * Typed, data-carrying failures for item selection. Never a silent fallback:
 * every invalid configuration maps to exactly one discriminated member.
 * Publish-time validation (Phase 26) is the preferred detection layer; these
 * errors are the pure-generator backstop for already-published or historical
 * content (approved Phase 7 design §12).
 *
 * Discriminant `type` strings follow the approved design (identical to the
 * character-selection errors where the failure is shared). Interface
 * identifiers carry an `Item` prefix to avoid `export *` collisions with the
 * Phase 6 character `errors.ts`.
 */

export interface ItemRequiredExceedsMaxError {
  type: 'RequiredExceedsMax';
  requiredCount: number;
  maxItems: number;
}

export interface ItemPoolBelowMinimumError {
  type: 'PoolBelowMinimum';
  poolSize: number;
  minItems: number;
}

export interface ItemNoEligibleItemsError {
  type: 'NoEligibleItems';
  caseTemplateId: string;
}

export interface ItemInsufficientPoolError {
  type: 'InsufficientPool';
  target: number;
  selectedCount: number;
}

export interface ItemInvalidWeightError {
  type: 'InvalidWeight';
  itemId: string;
  weight: number;
}

export interface ItemInvalidQuantityBoundsError {
  type: 'InvalidQuantityBounds';
  itemId: string;
  minQuantity: number;
  maxQuantity: number;
}

export interface ItemVersionMismatchError {
  type: 'VersionMismatch';
  templateVersion: number;
  itemId: string;
  version: number;
}

export interface ItemInvalidBoundsError {
  type: 'InvalidBounds';
  minItems: number;
  maxItems: number;
}

export interface ItemDuplicateItemError {
  type: 'DuplicateItem';
  itemId: string;
}

export type ItemSelectionError =
  | ItemRequiredExceedsMaxError
  | ItemPoolBelowMinimumError
  | ItemNoEligibleItemsError
  | ItemInsufficientPoolError
  | ItemInvalidWeightError
  | ItemInvalidQuantityBoundsError
  | ItemVersionMismatchError
  | ItemInvalidBoundsError
  | ItemDuplicateItemError;
