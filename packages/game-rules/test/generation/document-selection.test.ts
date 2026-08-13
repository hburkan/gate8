import { describe, expect, it } from 'vitest';
import {
  selectDocuments,
  type DocumentSelectionCandidate,
  type DocumentSelectionInput,
} from '../../src/generation/document-selection.js';

const VERSION = 1;

function d(
  documentId: string,
  overrides: Partial<DocumentSelectionCandidate> = {},
): DocumentSelectionCandidate {
  return {
    documentId,
    required: false,
    weight: 1,
    role: null,
    hidden: false,
    discoveryMethod: null,
    priority: 0,
    conditions: [],
    version: VERSION,
    ...overrides,
  };
}

function makeInput(
  overrides: Partial<DocumentSelectionInput> = {},
  documents: DocumentSelectionCandidate[] = [
    d('passport', { required: true, weight: 100, priority: 0 }),
    d('invoice', { weight: 50, priority: 1 }),
    d('license', { weight: 20, priority: 2 }),
    d('warrant', { weight: 10, priority: 3 }),
  ],
): DocumentSelectionInput {
  return {
    caseTemplateId: 'case-1',
    templateVersion: VERSION,
    minDocuments: 2,
    maxDocuments: 4,
    documents,
    seed: 'seed-1',
    ...overrides,
  };
}

function idsOf(result: NonNullable<ReturnType<typeof selectDocuments>>) {
  if (!result.ok) throw new Error(`expected ok result, got ${result.error.type}`);
  return result.documents.map((d) => d.documentId);
}

describe('selectDocuments — golden regression (PRNG + draw ordering contract)', () => {
  it('reproduces the exact reference selection for a fixed seed', () => {
    const result = selectDocuments(makeInput({ seed: 'case-demo-seed-123' }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.documents).toEqual([
        { documentId: 'passport', role: null, hidden: false, discoveryMethod: null },
        { documentId: 'license', role: null, hidden: false, discoveryMethod: null },
        { documentId: 'warrant', role: null, hidden: false, discoveryMethod: null },
      ]);
      expect(result.templateVersion).toBe(VERSION);
      expect(result.seed).toBe('case-demo-seed-123');
    }
  });
});

describe('selectDocuments — bounds and counts (distinct document types)', () => {
  it('keeps the selected count within [min, max] across seeds', () => {
    const input = makeInput();
    for (let s = 0; s < 200; s++) {
      const result = selectDocuments({ ...input, seed: `s${s}` });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.documents.length).toBeGreaterThanOrEqual(2);
        expect(result.documents.length).toBeLessThanOrEqual(4);
      }
    }
  });

  it('succeeds when max_documents > pool (upper bound is capped by pool)', () => {
    const input = makeInput({ minDocuments: 2, maxDocuments: 6 }, [
      d('a'),
      d('b'),
      d('c'),
      d('d'),
      d('e'),
    ]);
    for (let s = 0; s < 100; s++) {
      const result = selectDocuments({ ...input, seed: `c${s}` });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.documents.length).toBeGreaterThanOrEqual(2);
        expect(result.documents.length).toBeLessThanOrEqual(5);
      }
    }
  });

  it('treats max_documents = 0 as unbounded (upper = pool size)', () => {
    const pool = [d('a'), d('b'), d('c')];
    const input = makeInput({ minDocuments: 0, maxDocuments: 0 }, pool);
    for (let s = 0; s < 200; s++) {
      const result = selectDocuments({ ...input, seed: `u${s}` });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.documents.length).toBeLessThanOrEqual(3);
    }
  });

  it('selects exactly the minimum when min === max', () => {
    const input = makeInput({ minDocuments: 3, maxDocuments: 3 });
    for (let s = 0; s < 100; s++) {
      const result = selectDocuments({ ...input, seed: `s${s}` });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.documents.length).toBe(3);
    }
  });
});

describe('selectDocuments — required semantics', () => {
  it('always includes the required document', () => {
    const input = makeInput();
    for (let s = 0; s < 200; s++) {
      const result = selectDocuments({ ...input, seed: `s${s}` });
      expect(result.ok).toBe(true);
      if (result.ok) expect(idsOf(result)).toContain('passport');
    }
  });

  it('always includes multiple required documents', () => {
    const input = makeInput({}, [
      d('r1', { required: true }),
      d('r2', { required: true }),
      d('o1'),
      d('o2'),
    ]);
    for (let s = 0; s < 200; s++) {
      const result = selectDocuments({ ...input, seed: `s${s}` });
      expect(result.ok).toBe(true);
      if (result.ok) {
        const ids = idsOf(result);
        expect(ids).toContain('r1');
        expect(ids).toContain('r2');
      }
    }
  });

  it('returns RequiredExceedsMax when required > max_documents', () => {
    const result = selectDocuments(
      makeInput({ minDocuments: 1, maxDocuments: 2 }, [
        d('r1', { required: true }),
        d('r2', { required: true }),
        d('r3', { required: true }),
        d('o1'),
      ]),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe('RequiredExceedsMax');
  });

  it('returns PoolBelowMinimum when required count exceeds the pool', () => {
    const result = selectDocuments(
      makeInput({ minDocuments: 3, maxDocuments: 0 }, [
        d('r1', { required: true }),
        d('r2', { required: true }),
      ]),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe('PoolBelowMinimum');
  });
});

describe('selectDocuments — pool size validation', () => {
  it('returns PoolBelowMinimum when pool < min_documents', () => {
    const result = selectDocuments(
      makeInput({ minDocuments: 5, maxDocuments: 0 }, [d('a'), d('b'), d('c')]),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe('PoolBelowMinimum');
  });

  it('target count never exceeds the pool', () => {
    const pool = [d('a'), d('b'), d('c')];
    const input = makeInput({ minDocuments: 1, maxDocuments: 0 }, pool);
    for (let s = 0; s < 300; s++) {
      const result = selectDocuments({ ...input, seed: `e${s}` });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.documents.length).toBeLessThanOrEqual(pool.length);
    }
  });

  it('allows an empty document set when min_documents = 0 and no required documents', () => {
    const result = selectDocuments(
      makeInput({ minDocuments: 0, maxDocuments: 0, seed: 'empty' }, [d('a')]),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.documents.length).toBeLessThanOrEqual(1);
  });
});

describe('selectDocuments — weighted selection', () => {
  it('picks higher-weight optionals more often than lower-weight ones', () => {
    const pool = [d('heavy', { weight: 100 }), d('mid', { weight: 10 }), d('light', { weight: 1 })];
    const input = makeInput({ minDocuments: 1, maxDocuments: 1 }, pool);
    const counts: Record<string, number> = { heavy: 0, mid: 0, light: 0 };
    const seeds = 500;
    for (let s = 0; s < seeds; s++) {
      const result = selectDocuments({ ...input, seed: `w${s}` });
      expect(result.ok).toBe(true);
      if (result.ok) counts[result.documents[0]!.documentId]!++;
    }
    const heavy = counts.heavy ?? 0;
    const mid = counts.mid ?? 0;
    const light = counts.light ?? 0;
    expect(heavy).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThan(light);
    expect(heavy).toBeGreaterThan(light);
  });

  it('never selects a zero-weight optional while positive-weight candidates exist', () => {
    const pool = [d('winner', { weight: 1 }), d('loser', { weight: 0 })];
    const input = makeInput({ minDocuments: 1, maxDocuments: 1 }, pool);
    for (let s = 0; s < 200; s++) {
      const result = selectDocuments({ ...input, seed: `z${s}` });
      expect(result.ok).toBe(true);
      if (result.ok) expect(idsOf(result)).not.toContain('loser');
    }
  });

  it('succeeds with exactly the required set when all optionals are weight 0 and target === |R|', () => {
    const result = selectDocuments(
      makeInput({ minDocuments: 1, maxDocuments: 1 }, [
        d('r1', { required: true, weight: 0 }),
        d('o1', { weight: 0 }),
      ]),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(idsOf(result)).toEqual(['r1']);
  });

  it('returns InsufficientPool when all optionals are weight 0 and target > |R|', () => {
    const result = selectDocuments(
      makeInput({ minDocuments: 2, maxDocuments: 2 }, [
        d('r1', { required: true, weight: 0 }),
        d('o1', { weight: 0 }),
      ]),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe('InsufficientPool');
  });
});

describe('selectDocuments — no quantity (single instance)', () => {
  it('output documents carry no quantity field and each document appears exactly once', () => {
    const result = selectDocuments(makeInput({ minDocuments: 4, maxDocuments: 4, seed: 'single' }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.documents).toHaveLength(4);
      const ids = result.documents.map((d) => d.documentId);
      expect(new Set(ids).size).toBe(ids.length);
      for (const doc of result.documents) {
        expect(doc).not.toHaveProperty('quantity');
      }
    }
  });
});

describe('selectDocuments — role, hidden and discovery_method propagation', () => {
  it('propagates role unchanged, including null', () => {
    const pool = [
      d('real', { role: 'real' }),
      d('fake', { role: 'fake' }),
      d('decoy', { role: 'decoy' }),
      d('none', { role: null }),
    ];
    const input = makeInput({ minDocuments: 4, maxDocuments: 4, seed: 'role' }, pool);
    const result = selectDocuments(input);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.documents.find((d) => d.documentId === 'real')!.role).toBe('real');
      expect(result.documents.find((d) => d.documentId === 'fake')!.role).toBe('fake');
      expect(result.documents.find((d) => d.documentId === 'decoy')!.role).toBe('decoy');
      expect(result.documents.find((d) => d.documentId === 'none')!.role).toBeNull();
    }
  });

  it('propagates hidden unchanged to the generated documents', () => {
    const pool = [
      d('h', { hidden: true }),
      d('v', { hidden: false }),
      d('r', { required: true, hidden: true }),
    ];
    const input = makeInput({ minDocuments: 3, maxDocuments: 3, seed: 'hid' }, pool);
    const result = selectDocuments(input);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.documents.find((d) => d.documentId === 'h')!.hidden).toBe(true);
      expect(result.documents.find((d) => d.documentId === 'v')!.hidden).toBe(false);
      expect(result.documents.find((d) => d.documentId === 'r')!.hidden).toBe(true);
    }
  });

  it('propagates discovery_method unchanged, including null', () => {
    const pool = [
      d('a', { discoveryMethod: 'search' }),
      d('b', { discoveryMethod: null }),
      d('c', { required: true, discoveryMethod: 'inspect' }),
    ];
    const input = makeInput({ minDocuments: 3, maxDocuments: 3, seed: 'disc' }, pool);
    const result = selectDocuments(input);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.documents.find((d) => d.documentId === 'a')!.discoveryMethod).toBe('search');
      expect(result.documents.find((d) => d.documentId === 'b')!.discoveryMethod).toBeNull();
      expect(result.documents.find((d) => d.documentId === 'c')!.discoveryMethod).toBe('inspect');
    }
  });

  it('never lets role affect selection: fake/decoy roles produce identical picks to real', () => {
    const realPool = [
      d('p', { required: true, weight: 100, priority: 0, role: 'real' }),
      d('i', { weight: 50, priority: 1, role: 'real' }),
      d('l', { weight: 20, priority: 2, role: 'real' }),
      d('w', { weight: 10, priority: 3, role: 'real' }),
    ];
    const mixedPool = realPool.map((doc) => ({
      ...doc,
      role: doc.documentId === 'i' ? 'fake' : doc.documentId === 'l' ? 'decoy' : null,
    }));
    const a = selectDocuments(
      makeInput({ minDocuments: 2, maxDocuments: 4, seed: 'role' }, realPool),
    );
    const b = selectDocuments(
      makeInput({ minDocuments: 2, maxDocuments: 4, seed: 'role' }, mixedPool),
    );
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(a.documents.map((d) => d.documentId)).toEqual(b.documents.map((d) => d.documentId));
      expect(a.documents.length).toBe(b.documents.length);
    }
  });
});

describe('selectDocuments — duplicates', () => {
  it('returns DuplicateDocument when the snapshot contains a duplicate document_id', () => {
    const result = selectDocuments(makeInput({}, [d('a'), d('a', { priority: 1 })]));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe('DuplicateDocument');
  });

  it('never returns duplicate document ids in a successful selection', () => {
    const pool = [d('a'), d('b'), d('c'), d('d'), d('e')];
    const input = makeInput({ minDocuments: 2, maxDocuments: 4 }, pool);
    for (let s = 0; s < 200; s++) {
      const result = selectDocuments({ ...input, seed: `d${s}` });
      expect(result.ok).toBe(true);
      if (result.ok) {
        const ids = result.documents.map((d) => d.documentId);
        expect(new Set(ids).size).toBe(ids.length);
      }
    }
  });
});

describe('selectDocuments — determinism', () => {
  it('produces identical output (types, roles, order) for the same seed', () => {
    const a = selectDocuments(makeInput({ seed: 'repeat' }));
    const b = selectDocuments(makeInput({ seed: 'repeat' }));
    expect(a).toEqual(b);
  });

  it('is capable of producing different outputs for different seeds', () => {
    const pool = [d('a'), d('b'), d('c'), d('d'), d('e')];
    const input = makeInput({ minDocuments: 2, maxDocuments: 4 }, pool);
    const outputs = new Set<string>();
    for (let s = 0; s < 50; s++) {
      const result = selectDocuments({ ...input, seed: `v${s}` });
      expect(result.ok).toBe(true);
      if (result.ok) outputs.add(JSON.stringify(result.documents));
    }
    expect(outputs.size).toBeGreaterThan(1);
  });
});

describe('selectDocuments — ordering', () => {
  it('orders output by (priority ASC, document_id ASC)', () => {
    const result = selectDocuments(
      makeInput({ minDocuments: 3, maxDocuments: 3 }, [
        d('zulu', { priority: 10 }),
        d('alpha', { priority: 1 }),
        d('middle', { priority: 5 }),
      ]),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.documents.map((d) => d.documentId)).toEqual(['alpha', 'middle', 'zulu']);
    }
  });

  it('breaks priority ties by document_id ascending', () => {
    const result = selectDocuments(
      makeInput({ minDocuments: 4, maxDocuments: 4 }, [
        d('delta', { priority: 0 }),
        d('bravo', { priority: 0 }),
        d('charlie', { priority: 0 }),
        d('alpha', { priority: 0 }),
      ]),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.documents.map((d) => d.documentId)).toEqual([
        'alpha',
        'bravo',
        'charlie',
        'delta',
      ]);
    }
  });
});

describe('selectDocuments — version pinning', () => {
  it('returns VersionMismatch when a relation version differs from the template version', () => {
    const result = selectDocuments(makeInput({}, [d('a'), d('b', { version: 2 })]));
    expect(result.ok).toBe(false);
    if (!result.ok && result.error.type === 'VersionMismatch') {
      expect(result.error.templateVersion).toBe(VERSION);
    }
  });
});

describe('selectDocuments — invalid bounds', () => {
  it('returns InvalidBounds for negative minDocuments', () => {
    const result = selectDocuments(makeInput({ minDocuments: -1 }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe('InvalidBounds');
  });

  it('returns InvalidBounds for negative maxDocuments', () => {
    const result = selectDocuments(makeInput({ maxDocuments: -1 }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe('InvalidBounds');
  });

  it('returns InvalidBounds when minDocuments > maxDocuments (bounded)', () => {
    const result = selectDocuments(makeInput({ minDocuments: 5, maxDocuments: 3 }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe('InvalidBounds');
  });
});

describe('selectDocuments — invalid weights', () => {
  it('returns InvalidWeight for a negative weight', () => {
    const result = selectDocuments(makeInput({}, [d('a', { weight: -1 })]));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe('InvalidWeight');
  });

  it('returns InvalidWeight for a non-finite weight', () => {
    const result = selectDocuments(makeInput({}, [d('a', { weight: NaN })]));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe('InvalidWeight');
  });
});

describe('selectDocuments — empty pool', () => {
  it('returns NoEligibleDocuments for an empty pool', () => {
    const result = selectDocuments(makeInput({}, []));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe('NoEligibleDocuments');
  });
});

describe('selectDocuments — conditions are opaque in Phase 9', () => {
  it('does not evaluate conditions; identical inputs with different condition payloads give identical results', () => {
    const conditionsA = [
      { op: 'equals', path: 'x', value: 1 },
      { op: 'hasEvidence', ref: 'ev-1' },
    ];
    const inputA = makeInput({ seed: 'opaque' }, [d('a', { conditions: conditionsA }), d('b')]);
    const inputB = makeInput({ seed: 'opaque' }, [d('a', { conditions: [] }), d('b')]);
    expect(selectDocuments(inputA)).toEqual(selectDocuments(inputB));
  });
});

describe('selectDocuments — eligibility filter extension point (Phase 11)', () => {
  it('applies a caller-provided eligibility filter to narrow the pool', () => {
    const pool = [d('a'), d('b'), d('c')];
    const input: DocumentSelectionInput = {
      ...makeInput({ minDocuments: 2, maxDocuments: 2, seed: 'filter' }, pool),
      eligibilityFilter: (candidate: DocumentSelectionCandidate) => candidate.documentId !== 'a',
    };
    const result = selectDocuments(input);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const ids = result.documents.map((d) => d.documentId);
      expect(ids).not.toContain('a');
    }
  });
});

describe('selectDocuments — deterministic typed failures', () => {
  const failureInputs: Array<{ name: string; input: DocumentSelectionInput; type: string }> = [
    {
      name: 'RequiredExceedsMax',
      input: makeInput({ minDocuments: 0, maxDocuments: 1 }, [
        d('r1', { required: true }),
        d('r2', { required: true }),
      ]),
      type: 'RequiredExceedsMax',
    },
    {
      name: 'PoolBelowMinimum',
      input: makeInput({ minDocuments: 5, maxDocuments: 0 }, [d('a'), d('b')]),
      type: 'PoolBelowMinimum',
    },
    { name: 'NoEligibleDocuments', input: makeInput({}, []), type: 'NoEligibleDocuments' },
    {
      name: 'InsufficientPool',
      input: makeInput({ minDocuments: 2, maxDocuments: 2 }, [
        d('r1', { required: true, weight: 0 }),
        d('o1', { weight: 0 }),
      ]),
      type: 'InsufficientPool',
    },
    {
      name: 'InvalidWeight',
      input: makeInput({}, [d('a', { weight: -1 })]),
      type: 'InvalidWeight',
    },
    {
      name: 'VersionMismatch',
      input: makeInput({}, [d('a', { version: 2 })]),
      type: 'VersionMismatch',
    },
    {
      name: 'InvalidBounds',
      input: makeInput({ minDocuments: 5, maxDocuments: 3 }),
      type: 'InvalidBounds',
    },
    {
      name: 'DuplicateDocument',
      input: makeInput({}, [d('a'), d('a')]),
      type: 'DuplicateDocument',
    },
  ];

  for (const { name, input, type } of failureInputs) {
    it(`returns a deterministic ${name} error`, () => {
      const a = selectDocuments(input);
      const b = selectDocuments(input);
      expect(a).toEqual(b);
      expect(a.ok).toBe(false);
      if (!a.ok) expect(a.error.type).toBe(type);
    });
  }
});
