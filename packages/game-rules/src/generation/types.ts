import type { CharacterSelectionError } from './errors.js';

/**
 * One `case_characters` relation row as consumed by the generator. The
 * generator is a pure function over a version-pinned snapshot; it never
 * queries the database itself (Phase 12/14 load the snapshot and call it).
 */
export interface CharacterSelectionCandidate {
  characterId: string;
  required: boolean;
  weight: number;
  priority: number;
  /** Opaque in Phase 6 — not evaluated until the Phase 11 rule engine. */
  conditions: unknown[];
  version: number;
  /** Generation metadata carried through to the instance. */
  role: string | null;
}

/** Fully prepared input: version-pinned template + relation snapshot + seed. */
export interface CharacterSelectionInput {
  caseTemplateId: string;
  templateVersion: number;
  /** Lower bound on the generated count; `0` means no minimum. */
  minCharacters: number;
  /** Upper bound on the generated count; `0` means no maximum. */
  maxCharacters: number;
  characters: CharacterSelectionCandidate[];
  seed: string;
  /**
   * Phase 11 extension point: a caller-provided predicate that narrows the
   * eligible pool. When omitted, every snapshot row is eligible (Phase 6).
   */
  eligibilityFilter?: (candidate: CharacterSelectionCandidate) => boolean;
}

export interface SelectedCharacter {
  characterId: string;
  role: string | null;
}

export type CharacterSelectionResult =
  | {
      ok: true;
      characters: SelectedCharacter[];
      caseTemplateId: string;
      templateVersion: number;
      seed: string;
    }
  | { ok: false; error: CharacterSelectionError };
