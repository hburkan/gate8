import type { ItemSelectionError } from './item-errors.js';

/**
 * One `case_items` relation row as consumed by the generator. The generator is
 * a pure function over a version-pinned snapshot; it never queries the
 * database itself (Phase 12/14 load the snapshot and call it).
 */
export interface ItemSelectionCandidate {
  itemId: string;
  required: boolean;
  weight: number;
  /** Physical quantity lower bound per selected type; `0` = no minimum. */
  minQuantity: number;
  /** Physical quantity upper bound per selected type; `0` = no maximum. */
  maxQuantity: number;
  /** Initial visibility of the generated instance item (instance state). */
  hidden: boolean;
  /** Free text (R4); carried unchanged to the generated item. */
  discoveryMethod: string | null;
  priority: number;
  /** Opaque in Phase 7 — not evaluated until the Phase 11 rule engine. */
  conditions: unknown[];
  version: number;
}

/**
 * Fully prepared input: version-pinned template + relation snapshot + seed.
 * `minItems`/`maxItems` bound the number of DISTINCT item types, never the
 * physical quantity of each type.
 */
export interface ItemSelectionInput {
  caseTemplateId: string;
  templateVersion: number;
  /** Lower bound on the generated distinct-item-type count; `0` = no minimum. */
  minItems: number;
  /** Upper bound on the generated distinct-item-type count; `0` = no maximum. */
  maxItems: number;
  items: ItemSelectionCandidate[];
  seed: string;
  /**
   * Phase 11 extension point: a caller-provided predicate that narrows the
   * eligible pool. When omitted, every snapshot row is eligible (Phase 7).
   */
  eligibilityFilter?: (candidate: ItemSelectionCandidate) => boolean;
}

/** A generated item in the case item set (approved design §11). */
export interface GeneratedItem {
  itemId: string;
  quantity: number;
  hidden: boolean;
  discoveryMethod: string | null;
}

export type ItemSelectionResult =
  | {
      ok: true;
      items: GeneratedItem[];
      caseTemplateId: string;
      templateVersion: number;
      seed: string;
    }
  | { ok: false; error: ItemSelectionError };
