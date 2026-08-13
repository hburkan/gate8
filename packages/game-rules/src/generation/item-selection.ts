import { createSeededRandom } from './prng.js';
import type { ItemSelectionError } from './item-errors.js';
import { drawQuantity, effectiveQuantityBounds } from './quantity.js';
import type {
  GeneratedItem,
  ItemSelectionCandidate,
  ItemSelectionInput,
  ItemSelectionResult,
} from './item-types.js';

export type {
  GeneratedItem,
  ItemSelectionCandidate,
  ItemSelectionInput,
  ItemSelectionResult,
} from './item-types.js';

/**
 * Pure, deterministic item selection for a Case Template.
 *
 * Consumes a version-pinned snapshot (template bounds + `case_items` relation
 * rows) and a seed; returns a typed result. It never touches the database,
 * Supabase, HTTP, filesystem, UI, or AI. Same template + published version +
 * seed always yields identical output (types, quantities, ordering).
 *
 * Draw sequence (part of the generator contract): draw #1 = target distinct
 * item-type count, then one weighted draw per optional slot, then one
 * quantity draw per selected item in canonical `(priority, item_id)` order.
 * Quantities are generated AFTER the complete item set is selected so the
 * selection phase is independent of quantity configuration.
 *
 * Bounds semantics: `min_items`/`max_items` bound the number of DISTINCT
 * item types, never the physical quantity of each type. `0` on a bound means
 * "no bound" (Phase 5 convention). The effective upper bound is capped by the
 * eligible pool size: `upper = max_items > 0 ? min(max_items, |E|) : |E|`.
 */
export function selectItems(input: ItemSelectionInput): ItemSelectionResult {
  const failure = validate(input);
  if (failure !== null) {
    return { ok: false, error: failure };
  }

  const rng = createSeededRandom(input.seed);

  const canonical = canonicalOrder(input.items);
  const eligible = input.eligibilityFilter ? canonical.filter(input.eligibilityFilter) : canonical;

  const required = eligible.filter((i) => i.required);
  const optional = eligible.filter((i) => !i.required);

  if (eligible.length === 0) {
    return {
      ok: false,
      error: { type: 'NoEligibleItems', caseTemplateId: input.caseTemplateId },
    };
  }

  const lower = Math.max(input.minItems, required.length);
  const upper = input.maxItems > 0 ? Math.min(input.maxItems, eligible.length) : eligible.length;

  if (eligible.length < input.minItems) {
    return {
      ok: false,
      error: {
        type: 'PoolBelowMinimum',
        poolSize: eligible.length,
        minItems: input.minItems,
      },
    };
  }
  if (input.maxItems > 0 && required.length > input.maxItems) {
    return {
      ok: false,
      error: {
        type: 'RequiredExceedsMax',
        requiredCount: required.length,
        maxItems: input.maxItems,
      },
    };
  }

  const target = lower + rng.int(upper - lower + 1);

  const selected: ItemSelectionCandidate[] = [...required];
  let remaining = optional;

  while (selected.length < target) {
    const drawPool = remaining.filter((i) => i.weight > 0);
    if (drawPool.length === 0) {
      return {
        ok: false,
        error: { type: 'InsufficientPool', target, selectedCount: selected.length },
      };
    }
    const picked = weightedPick(drawPool, rng.float());
    selected.push(picked);
    remaining = remaining.filter((i) => i.itemId !== picked.itemId);
  }

  const items: GeneratedItem[] = canonicalOrder(selected).map((i) => {
    const bounds = effectiveQuantityBounds(i.minQuantity, i.maxQuantity)!;
    return {
      itemId: i.itemId,
      quantity: drawQuantity(rng, bounds),
      hidden: i.hidden,
      discoveryMethod: i.discoveryMethod,
    };
  });

  return {
    ok: true,
    items,
    caseTemplateId: input.caseTemplateId,
    templateVersion: input.templateVersion,
    seed: input.seed,
  };
}

/**
 * Structural validation shared by every code path. Returns the first
 * deterministic error, or `null` when the snapshot is well-formed.
 */
function validate(input: ItemSelectionInput): ItemSelectionError | null {
  if (input.minItems < 0 || input.maxItems < 0) {
    return {
      type: 'InvalidBounds',
      minItems: input.minItems,
      maxItems: input.maxItems,
    };
  }
  if (input.maxItems > 0 && input.minItems > input.maxItems) {
    return {
      type: 'InvalidBounds',
      minItems: input.minItems,
      maxItems: input.maxItems,
    };
  }

  const seen = new Set<string>();
  for (const i of input.items) {
    if (i.version !== input.templateVersion) {
      return {
        type: 'VersionMismatch',
        templateVersion: input.templateVersion,
        itemId: i.itemId,
        version: i.version,
      };
    }
    if (seen.has(i.itemId)) {
      return { type: 'DuplicateItem', itemId: i.itemId };
    }
    seen.add(i.itemId);
    if (!Number.isFinite(i.weight) || i.weight < 0) {
      return { type: 'InvalidWeight', itemId: i.itemId, weight: i.weight };
    }
    if (effectiveQuantityBounds(i.minQuantity, i.maxQuantity) === null) {
      return {
        type: 'InvalidQuantityBounds',
        itemId: i.itemId,
        minQuantity: i.minQuantity,
        maxQuantity: i.maxQuantity,
      };
    }
  }
  return null;
}

/** Stable deterministic ordering key: `(priority ASC, item_id ASC)`. */
function canonicalOrder<T extends ItemSelectionCandidate>(rows: T[]): T[] {
  return [...rows].sort(
    (a, b) => a.priority - b.priority || (a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0),
  );
}

/**
 * Weighted draw without replacement: `draw = prng.float() * Σweight`, then
 * the first row (canonical order) whose cumulative weight exceeds `draw`.
 * Caller ensures at least one row has `weight > 0`.
 */
function weightedPick(pool: ItemSelectionCandidate[], draw: number): ItemSelectionCandidate {
  const total = pool.reduce((sum, i) => sum + i.weight, 0);
  const scaled = draw * total;
  let cumulative = 0;
  for (const i of pool) {
    cumulative += i.weight;
    if (cumulative > scaled) {
      return i;
    }
  }
  return pool[pool.length - 1]!;
}
