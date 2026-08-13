import type { SeededRandom } from './prng.js';

/**
 * Per-selected-item physical quantity generation.
 *
 * Semantics (approved Phase 7 design §3.1): `0` on a quantity bound means "no
 * bound" (Phase 5 convention), not "zero copies". A selected item type always
 * has at least one physical copy.
 *
 *   effectiveMin = max(min_quantity, 1)
 *   effectiveMax = max_quantity > 0 ? max_quantity : effectiveMin
 *   quantity     = effectiveMin + rng.int(effectiveMax - effectiveMin + 1)
 */

export interface EffectiveQuantityBounds {
  effectiveMin: number;
  effectiveMax: number;
}

/**
 * Resolves raw `min_quantity`/`max_quantity` to effective draw bounds.
 * Returns `null` for an invalid range (negative bound, or a bounded
 * `min_quantity > max_quantity`). The DB prevents these via CHECK
 * constraints; the generator rejects them defensively.
 */
export function effectiveQuantityBounds(
  minQuantity: number,
  maxQuantity: number,
): EffectiveQuantityBounds | null {
  if (minQuantity < 0 || maxQuantity < 0) {
    return null;
  }
  if (maxQuantity > 0 && minQuantity > maxQuantity) {
    return null;
  }
  const effectiveMin = Math.max(minQuantity, 1);
  const effectiveMax = maxQuantity > 0 ? maxQuantity : effectiveMin;
  return { effectiveMin, effectiveMax };
}

/**
 * Draws one quantity for a selected item type from its effective bounds.
 * The caller guarantees valid bounds (from `effectiveQuantityBounds`).
 * Consumes exactly one PRNG integer (part of the generator draw contract).
 */
export function drawQuantity(rng: SeededRandom, bounds: EffectiveQuantityBounds): number {
  return bounds.effectiveMin + rng.int(bounds.effectiveMax - bounds.effectiveMin + 1);
}
