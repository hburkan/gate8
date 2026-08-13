import { describe, expect, it } from 'vitest';
import {
  selectItems,
  type ItemSelectionCandidate,
  type ItemSelectionInput,
} from '../../src/generation/item-selection.js';

const VERSION = 1;

function item(
  itemId: string,
  overrides: Partial<ItemSelectionCandidate> = {},
): ItemSelectionCandidate {
  return {
    itemId,
    required: false,
    weight: 1,
    minQuantity: 1,
    maxQuantity: 1,
    hidden: false,
    discoveryMethod: null,
    priority: 0,
    conditions: [],
    version: VERSION,
    ...overrides,
  };
}

function makeInput(
  overrides: Partial<ItemSelectionInput> = {},
  items: ItemSelectionCandidate[] = [
    item('handgun', { required: true, weight: 100, priority: 0 }),
    item('passport', { weight: 50, priority: 1 }),
    item('phone', { weight: 20, priority: 2 }),
    item('watch', { weight: 10, priority: 3 }),
  ],
): ItemSelectionInput {
  return {
    caseTemplateId: 'case-1',
    templateVersion: VERSION,
    minItems: 2,
    maxItems: 4,
    items,
    seed: 'seed-1',
    ...overrides,
  };
}

function idsOf(result: NonNullable<ReturnType<typeof selectItems>>) {
  if (!result.ok) throw new Error(`expected ok result, got ${result.error.type}`);
  return result.items.map((i) => i.itemId);
}

describe('selectItems — golden regression (PRNG + draw ordering contract)', () => {
  it('reproduces the exact reference selection and quantities for a fixed seed', () => {
    const result = selectItems(
      makeInput({ seed: 'case-demo-seed-123' }, [
        item('handgun', {
          required: true,
          weight: 100,
          priority: 0,
          minQuantity: 1,
          maxQuantity: 1,
        }),
        item('passport', { weight: 50, priority: 1, minQuantity: 1, maxQuantity: 1 }),
        item('phone', { weight: 20, priority: 2, minQuantity: 1, maxQuantity: 2 }),
        item('watch', { weight: 10, priority: 3, minQuantity: 2, maxQuantity: 5 }),
      ]),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.items).toEqual([
        { itemId: 'handgun', quantity: 1, hidden: false, discoveryMethod: null },
        { itemId: 'phone', quantity: 2, hidden: false, discoveryMethod: null },
        { itemId: 'watch', quantity: 5, hidden: false, discoveryMethod: null },
      ]);
      expect(result.templateVersion).toBe(VERSION);
      expect(result.seed).toBe('case-demo-seed-123');
    }
  });
});

describe('selectItems — bounds and counts (distinct item types)', () => {
  it('keeps the selected count within [min, max] across seeds', () => {
    const input = makeInput();
    for (let s = 0; s < 200; s++) {
      const result = selectItems({ ...input, seed: `s${s}` });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.items.length).toBeGreaterThanOrEqual(2);
        expect(result.items.length).toBeLessThanOrEqual(4);
      }
    }
  });

  it('succeeds when max_items > pool (upper bound is capped by pool)', () => {
    const input = makeInput({ minItems: 2, maxItems: 6 }, [
      item('a'),
      item('b'),
      item('c'),
      item('d'),
      item('e'),
    ]);
    for (let s = 0; s < 100; s++) {
      const result = selectItems({ ...input, seed: `c${s}` });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.items.length).toBeGreaterThanOrEqual(2);
        expect(result.items.length).toBeLessThanOrEqual(5);
      }
    }
  });

  it('treats max_items = 0 as unbounded (upper = pool size)', () => {
    const pool = [item('a'), item('b'), item('c')];
    const input = makeInput({ minItems: 0, maxItems: 0 }, pool);
    for (let s = 0; s < 200; s++) {
      const result = selectItems({ ...input, seed: `u${s}` });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.items.length).toBeLessThanOrEqual(3);
    }
  });

  it('selects exactly the minimum when min === max', () => {
    const input = makeInput({ minItems: 3, maxItems: 3 });
    for (let s = 0; s < 100; s++) {
      const result = selectItems({ ...input, seed: `s${s}` });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.items.length).toBe(3);
    }
  });
});

describe('selectItems — required semantics', () => {
  it('always includes the required item', () => {
    const input = makeInput();
    for (let s = 0; s < 200; s++) {
      const result = selectItems({ ...input, seed: `s${s}` });
      expect(result.ok).toBe(true);
      if (result.ok) expect(idsOf(result)).toContain('handgun');
    }
  });

  it('always includes multiple required items', () => {
    const input = makeInput({}, [
      item('r1', { required: true }),
      item('r2', { required: true }),
      item('o1'),
      item('o2'),
    ]);
    for (let s = 0; s < 200; s++) {
      const result = selectItems({ ...input, seed: `s${s}` });
      expect(result.ok).toBe(true);
      if (result.ok) {
        const ids = idsOf(result);
        expect(ids).toContain('r1');
        expect(ids).toContain('r2');
      }
    }
  });

  it('returns RequiredExceedsMax when required > max_items', () => {
    const result = selectItems(
      makeInput({ minItems: 1, maxItems: 2 }, [
        item('r1', { required: true }),
        item('r2', { required: true }),
        item('r3', { required: true }),
        item('o1'),
      ]),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe('RequiredExceedsMax');
  });

  it('returns PoolBelowMinimum when required count exceeds the pool', () => {
    const result = selectItems(
      makeInput({ minItems: 3, maxItems: 0 }, [
        item('r1', { required: true }),
        item('r2', { required: true }),
      ]),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe('PoolBelowMinimum');
  });

  it('returns InvalidQuantityBounds for a required item with an invalid quantity range', () => {
    const result = selectItems(
      makeInput({}, [item('r1', { required: true, minQuantity: 5, maxQuantity: 2 })]),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe('InvalidQuantityBounds');
  });
});

describe('selectItems — pool size validation', () => {
  it('returns PoolBelowMinimum when pool < min_items', () => {
    const result = selectItems(
      makeInput({ minItems: 5, maxItems: 0 }, [item('a'), item('b'), item('c')]),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe('PoolBelowMinimum');
  });

  it('target count never exceeds the pool', () => {
    const pool = [item('a'), item('b'), item('c')];
    const input = makeInput({ minItems: 1, maxItems: 0 }, pool);
    for (let s = 0; s < 300; s++) {
      const result = selectItems({ ...input, seed: `e${s}` });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.items.length).toBeLessThanOrEqual(pool.length);
    }
  });

  it('allows an empty item set when min_items = 0 and no required items', () => {
    const result = selectItems(makeInput({ minItems: 0, maxItems: 0, seed: 'empty' }, [item('a')]));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.items.length).toBeLessThanOrEqual(1);
  });
});

describe('selectItems — weighted selection', () => {
  it('picks higher-weight optionals more often than lower-weight ones', () => {
    const pool = [
      item('heavy', { weight: 100 }),
      item('mid', { weight: 10 }),
      item('light', { weight: 1 }),
    ];
    const input = makeInput({ minItems: 1, maxItems: 1 }, pool);
    const counts: Record<string, number> = { heavy: 0, mid: 0, light: 0 };
    const seeds = 500;
    for (let s = 0; s < seeds; s++) {
      const result = selectItems({ ...input, seed: `w${s}` });
      expect(result.ok).toBe(true);
      if (result.ok) counts[result.items[0]!.itemId]!++;
    }
    const heavy = counts.heavy ?? 0;
    const mid = counts.mid ?? 0;
    const light = counts.light ?? 0;
    expect(heavy).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThan(light);
    expect(heavy).toBeGreaterThan(light);
  });

  it('never selects a zero-weight optional while positive-weight candidates exist', () => {
    const pool = [item('winner', { weight: 1 }), item('loser', { weight: 0 })];
    const input = makeInput({ minItems: 1, maxItems: 1 }, pool);
    for (let s = 0; s < 200; s++) {
      const result = selectItems({ ...input, seed: `z${s}` });
      expect(result.ok).toBe(true);
      if (result.ok) expect(idsOf(result)).not.toContain('loser');
    }
  });

  it('succeeds with exactly the required set when all optionals are weight 0 and target === |R|', () => {
    const result = selectItems(
      makeInput({ minItems: 1, maxItems: 1 }, [
        item('r1', { required: true, weight: 0 }),
        item('o1', { weight: 0 }),
      ]),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(idsOf(result)).toEqual(['r1']);
  });

  it('returns InsufficientPool when all optionals are weight 0 and target > |R|', () => {
    const result = selectItems(
      makeInput({ minItems: 2, maxItems: 2 }, [
        item('r1', { required: true, weight: 0 }),
        item('o1', { weight: 0 }),
      ]),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe('InsufficientPool');
  });
});

describe('selectItems — quantity generation', () => {
  it('keeps quantity within the effective bounds for every selected item', () => {
    const pool = [
      item('a', { minQuantity: 2, maxQuantity: 5 }),
      item('b', { minQuantity: 1, maxQuantity: 3 }),
      item('c', { minQuantity: 4, maxQuantity: 4 }),
      item('d', { minQuantity: 0, maxQuantity: 0 }),
    ];
    const input = makeInput({ minItems: 4, maxItems: 4 }, pool);
    for (let s = 0; s < 100; s++) {
      const result = selectItems({ ...input, seed: `q${s}` });
      expect(result.ok).toBe(true);
      if (result.ok) {
        const byId = Object.fromEntries(pool.map((i) => [i.itemId, i]));
        for (const g of result.items) {
          const src = byId[g.itemId]!;
          const min = Math.max(src.minQuantity, 1);
          const max = src.maxQuantity > 0 ? src.maxQuantity : min;
          expect(g.quantity).toBeGreaterThanOrEqual(min);
          expect(g.quantity).toBeLessThanOrEqual(max);
        }
      }
    }
  });

  it('draws a fixed quantity when min_quantity === max_quantity', () => {
    const result = selectItems(
      makeInput({ minItems: 3, maxItems: 3, seed: 'fix' }, [
        item('a', { minQuantity: 2, maxQuantity: 2 }),
        item('b', { minQuantity: 7, maxQuantity: 7 }),
        item('c', { minQuantity: 1, maxQuantity: 1 }),
      ]),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.items.find((i) => i.itemId === 'a')!.quantity).toBe(2);
      expect(result.items.find((i) => i.itemId === 'b')!.quantity).toBe(7);
      expect(result.items.find((i) => i.itemId === 'c')!.quantity).toBe(1);
    }
  });

  it('returns InvalidQuantityBounds for min_quantity > max_quantity', () => {
    const result = selectItems(makeInput({}, [item('a', { minQuantity: 5, maxQuantity: 2 })]));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe('InvalidQuantityBounds');
  });

  it('never generates a zero quantity', () => {
    const result = selectItems(
      makeInput({ minItems: 4, maxItems: 4, seed: 'zero' }, [
        item('a', { minQuantity: 0, maxQuantity: 0 }),
        item('b', { minQuantity: 0, maxQuantity: 3 }),
        item('c', { minQuantity: 2, maxQuantity: 2 }),
        item('d', { minQuantity: 1, maxQuantity: 5 }),
      ]),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      for (const g of result.items) expect(g.quantity).toBeGreaterThan(0);
    }
  });
});

describe('selectItems — hidden and discovery_method propagation', () => {
  it('propagates hidden unchanged to the generated items', () => {
    const pool = [
      item('h', { hidden: true }),
      item('v', { hidden: false }),
      item('r', { required: true, hidden: true }),
    ];
    const input = makeInput({ minItems: 3, maxItems: 3, seed: 'hid' }, pool);
    const result = selectItems(input);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.items.find((i) => i.itemId === 'h')!.hidden).toBe(true);
      expect(result.items.find((i) => i.itemId === 'v')!.hidden).toBe(false);
      expect(result.items.find((i) => i.itemId === 'r')!.hidden).toBe(true);
    }
  });

  it('propagates discovery_method unchanged, including null', () => {
    const pool = [
      item('a', { discoveryMethod: 'search' }),
      item('b', { discoveryMethod: null }),
      item('c', { required: true, discoveryMethod: 'inspect' }),
    ];
    const input = makeInput({ minItems: 3, maxItems: 3, seed: 'disc' }, pool);
    const result = selectItems(input);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.items.find((i) => i.itemId === 'a')!.discoveryMethod).toBe('search');
      expect(result.items.find((i) => i.itemId === 'b')!.discoveryMethod).toBeNull();
      expect(result.items.find((i) => i.itemId === 'c')!.discoveryMethod).toBe('inspect');
    }
  });
});

describe('selectItems — duplicates', () => {
  it('returns DuplicateItem when the snapshot contains a duplicate item_id', () => {
    const result = selectItems(makeInput({}, [item('a'), item('a', { priority: 1 })]));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe('DuplicateItem');
  });

  it('never returns duplicate item ids in a successful selection', () => {
    const pool = [item('a'), item('b'), item('c'), item('d'), item('e')];
    const input = makeInput({ minItems: 2, maxItems: 4 }, pool);
    for (let s = 0; s < 200; s++) {
      const result = selectItems({ ...input, seed: `d${s}` });
      expect(result.ok).toBe(true);
      if (result.ok) {
        const ids = result.items.map((i) => i.itemId);
        expect(new Set(ids).size).toBe(ids.length);
      }
    }
  });
});

describe('selectItems — determinism', () => {
  it('produces identical output (types, quantities, order) for the same seed', () => {
    const a = selectItems(makeInput({ seed: 'repeat' }));
    const b = selectItems(makeInput({ seed: 'repeat' }));
    expect(a).toEqual(b);
  });

  it('is capable of producing different outputs for different seeds', () => {
    const pool = [item('a'), item('b'), item('c'), item('d'), item('e')];
    const input = makeInput({ minItems: 2, maxItems: 4 }, pool);
    const outputs = new Set<string>();
    for (let s = 0; s < 50; s++) {
      const result = selectItems({ ...input, seed: `v${s}` });
      expect(result.ok).toBe(true);
      if (result.ok) outputs.add(JSON.stringify(result.items));
    }
    expect(outputs.size).toBeGreaterThan(1);
  });
});

describe('selectItems — ordering', () => {
  it('orders output by (priority ASC, item_id ASC)', () => {
    const result = selectItems(
      makeInput({ minItems: 3, maxItems: 3 }, [
        item('zulu', { priority: 10 }),
        item('alpha', { priority: 1 }),
        item('middle', { priority: 5 }),
      ]),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.items.map((i) => i.itemId)).toEqual(['alpha', 'middle', 'zulu']);
    }
  });

  it('breaks priority ties by item_id ascending', () => {
    const result = selectItems(
      makeInput({ minItems: 4, maxItems: 4 }, [
        item('delta', { priority: 0 }),
        item('bravo', { priority: 0 }),
        item('charlie', { priority: 0 }),
        item('alpha', { priority: 0 }),
      ]),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.items.map((i) => i.itemId)).toEqual(['alpha', 'bravo', 'charlie', 'delta']);
    }
  });
});

describe('selectItems — version pinning', () => {
  it('returns VersionMismatch when a relation version differs from the template version', () => {
    const result = selectItems(makeInput({}, [item('a'), item('b', { version: 2 })]));
    expect(result.ok).toBe(false);
    if (!result.ok && result.error.type === 'VersionMismatch') {
      expect(result.error.templateVersion).toBe(VERSION);
    }
  });
});

describe('selectItems — invalid bounds', () => {
  it('returns InvalidBounds for negative minItems', () => {
    const result = selectItems(makeInput({ minItems: -1 }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe('InvalidBounds');
  });

  it('returns InvalidBounds for negative maxItems', () => {
    const result = selectItems(makeInput({ maxItems: -1 }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe('InvalidBounds');
  });

  it('returns InvalidBounds when minItems > maxItems (bounded)', () => {
    const result = selectItems(makeInput({ minItems: 5, maxItems: 3 }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe('InvalidBounds');
  });
});

describe('selectItems — invalid weights', () => {
  it('returns InvalidWeight for a negative weight', () => {
    const result = selectItems(makeInput({}, [item('a', { weight: -1 })]));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe('InvalidWeight');
  });

  it('returns InvalidWeight for a non-finite weight', () => {
    const result = selectItems(makeInput({}, [item('a', { weight: NaN })]));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe('InvalidWeight');
  });
});

describe('selectItems — empty pool', () => {
  it('returns NoEligibleItems for an empty pool', () => {
    const result = selectItems(makeInput({}, []));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe('NoEligibleItems');
  });
});

describe('selectItems — conditions are opaque in Phase 7', () => {
  it('does not evaluate conditions; identical inputs with different condition payloads give identical results', () => {
    const conditionsA = [
      { op: 'equals', path: 'x', value: 1 },
      { op: 'hasEvidence', ref: 'ev-1' },
    ];
    const inputA = makeInput({ seed: 'opaque' }, [
      item('a', { conditions: conditionsA }),
      item('b'),
    ]);
    const inputB = makeInput({ seed: 'opaque' }, [item('a', { conditions: [] }), item('b')]);
    expect(selectItems(inputA)).toEqual(selectItems(inputB));
  });
});

describe('selectItems — eligibility filter extension point (Phase 11)', () => {
  it('applies a caller-provided eligibility filter to narrow the pool', () => {
    const pool = [item('a'), item('b'), item('c')];
    const input: ItemSelectionInput = {
      ...makeInput({ minItems: 2, maxItems: 2, seed: 'filter' }, pool),
      eligibilityFilter: (candidate: ItemSelectionCandidate) => candidate.itemId !== 'a',
    };
    const result = selectItems(input);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const ids = result.items.map((i) => i.itemId);
      expect(ids).not.toContain('a');
    }
  });
});

describe('selectItems — distinct item types vs physical quantity', () => {
  it('item count is independent of per-row quantity bounds', () => {
    const poolA = [
      item('handgun', { minQuantity: 1, maxQuantity: 1 }),
      item('passport', { minQuantity: 2, maxQuantity: 3 }),
      item('phone', { minQuantity: 1, maxQuantity: 2 }),
      item('watch', { minQuantity: 1, maxQuantity: 1 }),
    ];
    const poolB = poolA.map((i) => ({ ...i, minQuantity: 50, maxQuantity: 100 }));
    const a = selectItems(makeInput({ minItems: 2, maxItems: 4, seed: 'indep' }, poolA));
    const b = selectItems(makeInput({ minItems: 2, maxItems: 4, seed: 'indep' }, poolB));
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(a.items.map((i) => i.itemId)).toEqual(b.items.map((i) => i.itemId));
      expect(a.items.length).toBe(b.items.length);
    }
  });
});

describe('selectItems — deterministic typed failures', () => {
  const failureInputs: Array<{ name: string; input: ItemSelectionInput; type: string }> = [
    {
      name: 'RequiredExceedsMax',
      input: makeInput({ minItems: 0, maxItems: 1 }, [
        item('r1', { required: true }),
        item('r2', { required: true }),
      ]),
      type: 'RequiredExceedsMax',
    },
    {
      name: 'PoolBelowMinimum',
      input: makeInput({ minItems: 5, maxItems: 0 }, [item('a'), item('b')]),
      type: 'PoolBelowMinimum',
    },
    { name: 'NoEligibleItems', input: makeInput({}, []), type: 'NoEligibleItems' },
    {
      name: 'InsufficientPool',
      input: makeInput({ minItems: 2, maxItems: 2 }, [
        item('r1', { required: true, weight: 0 }),
        item('o1', { weight: 0 }),
      ]),
      type: 'InsufficientPool',
    },
    {
      name: 'InvalidWeight',
      input: makeInput({}, [item('a', { weight: -1 })]),
      type: 'InvalidWeight',
    },
    {
      name: 'InvalidQuantityBounds',
      input: makeInput({}, [item('a', { minQuantity: 5, maxQuantity: 2 })]),
      type: 'InvalidQuantityBounds',
    },
    {
      name: 'VersionMismatch',
      input: makeInput({}, [item('a', { version: 2 })]),
      type: 'VersionMismatch',
    },
    {
      name: 'InvalidBounds',
      input: makeInput({ minItems: 5, maxItems: 3 }),
      type: 'InvalidBounds',
    },
    {
      name: 'DuplicateItem',
      input: makeInput({}, [item('a'), item('a')]),
      type: 'DuplicateItem',
    },
  ];

  for (const { name, input, type } of failureInputs) {
    it(`returns a deterministic ${name} error`, () => {
      const a = selectItems(input);
      const b = selectItems(input);
      expect(a).toEqual(b);
      expect(a.ok).toBe(false);
      if (!a.ok) expect(a.error.type).toBe(type);
    });
  }
});
