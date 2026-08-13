/**
 * Typed, data-carrying failures for character selection. Never a silent
 * fallback: every invalid configuration maps to exactly one discriminated
 * member. Publish-time validation (Phase 26) is the preferred detection
 * layer; these errors are the pure-generator backstop for already-published
 * or historical content.
 */

export interface RequiredExceedsMaxError {
  type: 'RequiredExceedsMax';
  requiredCount: number;
  maxCharacters: number;
}

export interface PoolBelowMinimumError {
  type: 'PoolBelowMinimum';
  poolSize: number;
  minCharacters: number;
}

export interface PoolBelowMaximumError {
  type: 'PoolBelowMaximum';
  poolSize: number;
  maxCharacters: number;
}

export interface NoEligibleCharactersError {
  type: 'NoEligibleCharacters';
  caseTemplateId: string;
}

export interface InsufficientPoolError {
  type: 'InsufficientPool';
  target: number;
  selectedCount: number;
}

export interface InvalidWeightError {
  type: 'InvalidWeight';
  characterId: string;
  weight: number;
}

export interface VersionMismatchError {
  type: 'VersionMismatch';
  templateVersion: number;
  characterId: string;
  version: number;
}

export interface InvalidBoundsError {
  type: 'InvalidBounds';
  minCharacters: number;
  maxCharacters: number;
}

export interface DuplicateCharacterError {
  type: 'DuplicateCharacter';
  characterId: string;
}

export type CharacterSelectionError =
  | RequiredExceedsMaxError
  | PoolBelowMinimumError
  | PoolBelowMaximumError
  | NoEligibleCharactersError
  | InsufficientPoolError
  | InvalidWeightError
  | VersionMismatchError
  | InvalidBoundsError
  | DuplicateCharacterError;
