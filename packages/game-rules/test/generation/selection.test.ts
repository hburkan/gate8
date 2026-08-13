import { describe, expect, it } from 'vitest';
import {
  selectCharacters,
  type CharacterSelectionCandidate,
  type CharacterSelectionInput,
} from '../../src/generation/selection.js';

const VERSION = 1;

function char(
  characterId: string,
  overrides: Partial<CharacterSelectionCandidate> = {},
): CharacterSelectionCandidate {
  return {
    characterId,
    required: false,
    weight: 1,
    priority: 0,
    conditions: [],
    version: VERSION,
    role: null,
    ...overrides,
  };
}

function makeInput(
  overrides: Partial<CharacterSelectionInput> = {},
  characters: CharacterSelectionCandidate[] = [
    char('mehmet', { required: true, weight: 100, priority: 0 }),
    char('ayse', { weight: 50, priority: 1 }),
    char('john', { weight: 20, priority: 2 }),
    char('laura', { weight: 10, priority: 3 }),
  ],
): CharacterSelectionInput {
  return {
    caseTemplateId: 'case-1',
    templateVersion: VERSION,
    minCharacters: 2,
    maxCharacters: 4,
    characters,
    seed: 'seed-1',
    ...overrides,
  };
}

function idsOf(result: NonNullable<ReturnType<typeof selectCharacters>>) {
  if (!result.ok) throw new Error(`expected ok result, got ${result.error.type}`);
  return result.characters.map((c) => c.characterId);
}

describe('selectCharacters — golden regression (PRNG + draw ordering contract)', () => {
  it('reproduces the exact reference selection for a fixed seed', () => {
    const result = selectCharacters(makeInput({ seed: 'case-demo-seed-123' }));
    expect(result.ok).toBe(true);
    expect(idsOf(result)).toEqual(['mehmet', 'john', 'laura']);
    if (result.ok) {
      expect(result.templateVersion).toBe(VERSION);
      expect(result.seed).toBe('case-demo-seed-123');
    }
  });
});

describe('selectCharacters — bounds and counts', () => {
  it('keeps the selected count within [min, max] across seeds', () => {
    const input = makeInput();
    for (let s = 0; s < 200; s++) {
      const result = selectCharacters({ ...input, seed: `s${s}` });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.characters.length).toBeGreaterThanOrEqual(2);
        expect(result.characters.length).toBeLessThanOrEqual(4);
      }
    }
  });

  it('selects exactly the minimum when min === max', () => {
    const input = makeInput({ minCharacters: 3, maxCharacters: 3 });
    for (let s = 0; s < 100; s++) {
      const result = selectCharacters({ ...input, seed: `s${s}` });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.characters.length).toBe(3);
    }
  });

  it('selects exactly the maximum when min === max at the upper bound', () => {
    const pool = [char('a'), char('b'), char('c'), char('d'), char('e')];
    const input = makeInput({ minCharacters: 4, maxCharacters: 4 }, pool);
    for (let s = 0; s < 100; s++) {
      const result = selectCharacters({ ...input, seed: `s${s}` });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.characters.length).toBe(4);
    }
  });

  it('never exceeds the pool size even when max is unbounded', () => {
    const pool = [char('a'), char('b'), char('c')];
    const input = makeInput({ minCharacters: 0, maxCharacters: 0 }, pool);
    for (let s = 0; s < 200; s++) {
      const result = selectCharacters({ ...input, seed: `s${s}` });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.characters.length).toBeLessThanOrEqual(3);
    }
  });
});

describe('selectCharacters — required semantics', () => {
  it('always includes the required character', () => {
    const input = makeInput();
    for (let s = 0; s < 200; s++) {
      const result = selectCharacters({ ...input, seed: `s${s}` });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.characters.map((c) => c.characterId)).toContain('mehmet');
      }
    }
  });

  it('always includes multiple required characters', () => {
    const input = makeInput({}, [
      char('mehmet', { required: true }),
      char('ayse', { required: true }),
      char('john'),
      char('laura'),
    ]);
    for (let s = 0; s < 200; s++) {
      const result = selectCharacters({ ...input, seed: `s${s}` });
      expect(result.ok).toBe(true);
      if (result.ok) {
        const ids = result.characters.map((c) => c.characterId);
        expect(ids).toContain('mehmet');
        expect(ids).toContain('ayse');
      }
    }
  });

  it('returns RequiredExceedsMax when required > max_characters', () => {
    const result = selectCharacters(
      makeInput({ minCharacters: 1, maxCharacters: 2 }, [
        char('r1', { required: true }),
        char('r2', { required: true }),
        char('r3', { required: true }),
        char('o1'),
      ]),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe('RequiredExceedsMax');
  });

  it('returns a deterministic failure when required count pushes lower above the pool (required > pool)', () => {
    const result = selectCharacters(
      makeInput({ minCharacters: 3, maxCharacters: 0 }, [
        char('r1', { required: true }),
        char('r2', { required: true }),
      ]),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe('PoolBelowMinimum');
  });
});

describe('selectCharacters — pool size validation', () => {
  it('returns PoolBelowMinimum when pool < min_characters', () => {
    const result = selectCharacters(
      makeInput({ minCharacters: 5, maxCharacters: 0 }, [char('a'), char('b'), char('c')]),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe('PoolBelowMinimum');
  });

  it('returns PoolBelowMaximum when pool < max_characters but >= min_characters', () => {
    const result = selectCharacters(
      makeInput({ minCharacters: 1, maxCharacters: 4 }, [char('a'), char('b'), char('c')]),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe('PoolBelowMaximum');
  });
});

describe('selectCharacters — weighted selection', () => {
  it('picks higher-weight optionals more often than lower-weight ones', () => {
    const pool = [
      char('heavy', { weight: 100 }),
      char('mid', { weight: 10 }),
      char('light', { weight: 1 }),
    ];
    const input = makeInput({ minCharacters: 1, maxCharacters: 1 }, pool);
    const counts: Record<string, number> = { heavy: 0, mid: 0, light: 0 };
    const seeds = 500;
    for (let s = 0; s < seeds; s++) {
      const result = selectCharacters({ ...input, seed: `w${s}` });
      expect(result.ok).toBe(true);
      if (result.ok) counts[result.characters[0]!.characterId]!++;
    }
    const heavy = counts.heavy ?? 0;
    const mid = counts.mid ?? 0;
    const light = counts.light ?? 0;
    expect(heavy).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThan(light);
    expect(heavy).toBeGreaterThan(light);
  });

  it('never selects a zero-weight optional while positive-weight candidates exist', () => {
    const pool = [char('winner', { weight: 1 }), char('loser', { weight: 0 })];
    const input = makeInput({ minCharacters: 1, maxCharacters: 1 }, pool);
    for (let s = 0; s < 200; s++) {
      const result = selectCharacters({ ...input, seed: `z${s}` });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.characters.map((c) => c.characterId)).not.toContain('loser');
    }
  });

  it('succeeds with exactly the required set when all optionals are weight 0 and target === |R|', () => {
    const result = selectCharacters(
      makeInput({ minCharacters: 1, maxCharacters: 1 }, [
        char('r1', { required: true, weight: 0 }),
        char('o1', { weight: 0 }),
      ]),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.characters.map((c) => c.characterId)).toEqual(['r1']);
  });

  it('returns InsufficientPool when all optionals are weight 0 and target > |R|', () => {
    const result = selectCharacters(
      makeInput({ minCharacters: 2, maxCharacters: 2 }, [
        char('r1', { required: true, weight: 0 }),
        char('o1', { weight: 0 }),
      ]),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe('InsufficientPool');
  });
});

describe('selectCharacters — duplicates', () => {
  it('returns DuplicateCharacter when the snapshot contains a duplicate character_id', () => {
    const result = selectCharacters(makeInput({}, [char('a'), char('a', { priority: 1 })]));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe('DuplicateCharacter');
  });

  it('never returns duplicate character ids in a successful selection', () => {
    const pool = [char('a'), char('b'), char('c'), char('d'), char('e')];
    const input = makeInput({ minCharacters: 2, maxCharacters: 4 }, pool);
    for (let s = 0; s < 200; s++) {
      const result = selectCharacters({ ...input, seed: `d${s}` });
      expect(result.ok).toBe(true);
      if (result.ok) {
        const ids = result.characters.map((c) => c.characterId);
        expect(new Set(ids).size).toBe(ids.length);
      }
    }
  });
});

describe('selectCharacters — determinism', () => {
  it('produces identical output for the same seed', () => {
    const a = selectCharacters(makeInput({ seed: 'repeat' }));
    const b = selectCharacters(makeInput({ seed: 'repeat' }));
    expect(a).toEqual(b);
  });

  it('is capable of producing different outputs for different seeds', () => {
    const pool = [char('a'), char('b'), char('c'), char('d'), char('e')];
    const input = makeInput({ minCharacters: 2, maxCharacters: 4 }, pool);
    const outputs = new Set<string>();
    for (let s = 0; s < 50; s++) {
      const result = selectCharacters({ ...input, seed: `v${s}` });
      expect(result.ok).toBe(true);
      if (result.ok) outputs.add(JSON.stringify(result.characters));
    }
    expect(outputs.size).toBeGreaterThan(1);
  });
});

describe('selectCharacters — ordering', () => {
  it('orders output by (priority ASC, character_id ASC)', () => {
    const result = selectCharacters(
      makeInput({ minCharacters: 3, maxCharacters: 3 }, [
        char('zulu', { priority: 10 }),
        char('alpha', { priority: 1 }),
        char('middle', { priority: 5 }),
      ]),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.characters.map((c) => c.characterId)).toEqual(['alpha', 'middle', 'zulu']);
    }
  });

  it('breaks priority ties by character_id ascending', () => {
    const result = selectCharacters(
      makeInput({ minCharacters: 4, maxCharacters: 4 }, [
        char('delta', { priority: 0 }),
        char('bravo', { priority: 0 }),
        char('charlie', { priority: 0 }),
        char('alpha', { priority: 0 }),
      ]),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.characters.map((c) => c.characterId)).toEqual([
        'alpha',
        'bravo',
        'charlie',
        'delta',
      ]);
    }
  });
});

describe('selectCharacters — version pinning', () => {
  it('returns VersionMismatch when a relation version differs from the template version', () => {
    const result = selectCharacters(makeInput({}, [char('a'), char('b', { version: 2 })]));
    expect(result.ok).toBe(false);
    if (!result.ok && result.error.type === 'VersionMismatch') {
      expect(result.error.templateVersion).toBe(VERSION);
    }
  });
});

describe('selectCharacters — invalid bounds', () => {
  it('returns InvalidBounds for negative minCharacters', () => {
    const result = selectCharacters(makeInput({ minCharacters: -1 }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe('InvalidBounds');
  });

  it('returns InvalidBounds for negative maxCharacters', () => {
    const result = selectCharacters(makeInput({ maxCharacters: -1 }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe('InvalidBounds');
  });

  it('returns InvalidBounds when minCharacters > maxCharacters (bounded)', () => {
    const result = selectCharacters(makeInput({ minCharacters: 5, maxCharacters: 3 }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe('InvalidBounds');
  });
});

describe('selectCharacters — invalid weights', () => {
  it('returns InvalidWeight for a negative weight', () => {
    const result = selectCharacters(makeInput({}, [char('a', { weight: -1 })]));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe('InvalidWeight');
  });

  it('returns InvalidWeight for a non-finite weight', () => {
    const result = selectCharacters(makeInput({}, [char('a', { weight: NaN })]));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe('InvalidWeight');
  });
});

describe('selectCharacters — empty pool', () => {
  it('returns NoEligibleCharacters for an empty pool', () => {
    const result = selectCharacters(makeInput({}, []));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe('NoEligibleCharacters');
  });
});

describe('selectCharacters — conditions are opaque in Phase 6', () => {
  it('does not evaluate conditions; identical inputs with different condition payloads give identical results', () => {
    const conditionsA = [
      { op: 'equals', path: 'x', value: 1 },
      { op: 'hasEvidence', ref: 'ev-1' },
    ];
    const inputA = makeInput({ seed: 'opaque' }, [
      char('a', { conditions: conditionsA }),
      char('b'),
    ]);
    const inputB = makeInput({ seed: 'opaque' }, [char('a', { conditions: [] }), char('b')]);
    expect(selectCharacters(inputA)).toEqual(selectCharacters(inputB));
  });
});

describe('selectCharacters — eligibility filter extension point (Phase 11)', () => {
  it('applies a caller-provided eligibility filter to narrow the pool', () => {
    const pool = [char('a'), char('b'), char('c')];
    const input: CharacterSelectionInput = {
      ...makeInput({ minCharacters: 2, maxCharacters: 2, seed: 'filter' }, pool),
      eligibilityFilter: (c: CharacterSelectionCandidate) => c.characterId !== 'a',
    };
    const result = selectCharacters(input);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const ids = result.characters.map((c) => c.characterId);
      expect(ids).not.toContain('a');
    }
  });
});

describe('selectCharacters — deterministic typed failures', () => {
  const failureInputs: Array<{ name: string; input: CharacterSelectionInput; type: string }> = [
    {
      name: 'RequiredExceedsMax',
      input: makeInput({ minCharacters: 0, maxCharacters: 1 }, [
        char('r1', { required: true }),
        char('r2', { required: true }),
      ]),
      type: 'RequiredExceedsMax',
    },
    {
      name: 'PoolBelowMinimum',
      input: makeInput({ minCharacters: 5, maxCharacters: 0 }, [char('a'), char('b')]),
      type: 'PoolBelowMinimum',
    },
    {
      name: 'PoolBelowMaximum',
      input: makeInput({ minCharacters: 1, maxCharacters: 5 }, [char('a'), char('b')]),
      type: 'PoolBelowMaximum',
    },
    { name: 'NoEligibleCharacters', input: makeInput({}, []), type: 'NoEligibleCharacters' },
    {
      name: 'InsufficientPool',
      input: makeInput({ minCharacters: 2, maxCharacters: 2 }, [
        char('r1', { required: true, weight: 0 }),
        char('o1', { weight: 0 }),
      ]),
      type: 'InsufficientPool',
    },
    {
      name: 'InvalidWeight',
      input: makeInput({}, [char('a', { weight: -1 })]),
      type: 'InvalidWeight',
    },
    {
      name: 'VersionMismatch',
      input: makeInput({}, [char('a', { version: 2 })]),
      type: 'VersionMismatch',
    },
    {
      name: 'InvalidBounds',
      input: makeInput({ minCharacters: 5, maxCharacters: 3 }),
      type: 'InvalidBounds',
    },
    {
      name: 'DuplicateCharacter',
      input: makeInput({}, [char('a'), char('a')]),
      type: 'DuplicateCharacter',
    },
  ];

  for (const { name, input, type } of failureInputs) {
    it(`returns a deterministic ${name} error`, () => {
      const a = selectCharacters(input);
      const b = selectCharacters(input);
      expect(a).toEqual(b);
      expect(a.ok).toBe(false);
      if (!a.ok) expect(a.error.type).toBe(type);
    });
  }
});
