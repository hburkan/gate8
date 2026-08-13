import { describe, expect, it } from 'vitest';
import {
  selectEvidence,
  type EvidenceSelectionCandidate,
  type EvidenceSelectionInput,
} from '../../src/generation/evidence-selection.js';

const VERSION = 1;

function ev(
  evidenceId: string,
  overrides: Partial<EvidenceSelectionCandidate> = {},
): EvidenceSelectionCandidate {
  return {
    evidenceId,
    role: null,
    weight: 1,
    importance: null,
    discoveryMethod: null,
    priority: 0,
    version: VERSION,
    ...overrides,
  };
}

function makeInput(
  overrides: Partial<EvidenceSelectionInput> = {},
  evidence: EvidenceSelectionCandidate[] = [
    ev('fingerprint', { role: 'required', weight: 100, priority: 0 }),
    ev('imei', { role: 'optional', weight: 50, priority: 1 }),
    ev('cctv', { role: 'decoy', weight: 20, priority: 2 }),
    ev('note', { role: 'hidden', weight: 10, priority: 3 }),
  ],
): EvidenceSelectionInput {
  return {
    caseTemplateId: 'case-1',
    templateVersion: VERSION,
    minEvidence: 2,
    maxEvidence: 4,
    evidence,
    seed: 'seed-1',
    ...overrides,
  };
}

function idsOf(result: ReturnType<typeof selectEvidence>) {
  if (!result.ok) throw new Error(`expected ok result, got ${result.error.type}`);
  return result.evidence.map((e) => e.evidenceId);
}

describe('selectEvidence — golden regression (PRNG + draw ordering contract)', () => {
  it('reproduces the exact reference selection for a fixed seed', () => {
    const result = selectEvidence(makeInput({ seed: 'case-demo-seed-123' }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.evidence).toEqual([
        { evidenceId: 'fingerprint', role: 'required', importance: null, discoveryMethod: null },
        { evidenceId: 'cctv', role: 'decoy', importance: null, discoveryMethod: null },
        { evidenceId: 'note', role: 'hidden', importance: null, discoveryMethod: null },
      ]);
      expect(result.templateVersion).toBe(VERSION);
      expect(result.seed).toBe('case-demo-seed-123');
    }
  });
});

describe('selectEvidence — bounds and counts (distinct evidence types)', () => {
  it('keeps the selected count within [min, max] across seeds', () => {
    const input = makeInput();
    for (let s = 0; s < 200; s++) {
      const result = selectEvidence({ ...input, seed: `s${s}` });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.evidence.length).toBeGreaterThanOrEqual(2);
        expect(result.evidence.length).toBeLessThanOrEqual(4);
      }
    }
  });

  it('succeeds when max_evidence > pool (upper bound is capped by pool)', () => {
    const input = makeInput({ minEvidence: 2, maxEvidence: 6 }, [
      ev('a'),
      ev('b'),
      ev('c'),
      ev('d'),
      ev('e'),
    ]);
    for (let s = 0; s < 100; s++) {
      const result = selectEvidence({ ...input, seed: `c${s}` });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.evidence.length).toBeGreaterThanOrEqual(2);
        expect(result.evidence.length).toBeLessThanOrEqual(5);
      }
    }
  });

  it('treats max_evidence = 0 as unbounded (upper = pool size)', () => {
    const pool = [ev('a'), ev('b'), ev('c')];
    const input = makeInput({ minEvidence: 0, maxEvidence: 0 }, pool);
    for (let s = 0; s < 200; s++) {
      const result = selectEvidence({ ...input, seed: `u${s}` });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.evidence.length).toBeLessThanOrEqual(3);
    }
  });

  it('selects exactly the minimum when min === max', () => {
    const input = makeInput({ minEvidence: 3, maxEvidence: 3 });
    for (let s = 0; s < 100; s++) {
      const result = selectEvidence({ ...input, seed: `s${s}` });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.evidence.length).toBe(3);
    }
  });
});

describe('selectEvidence — required evidence (role = required)', () => {
  it('always includes the required evidence', () => {
    const input = makeInput();
    for (let s = 0; s < 200; s++) {
      const result = selectEvidence({ ...input, seed: `s${s}` });
      expect(result.ok).toBe(true);
      if (result.ok) expect(idsOf(result)).toContain('fingerprint');
    }
  });

  it('always includes multiple required evidence rows', () => {
    const input = makeInput({}, [
      ev('r1', { role: 'required' }),
      ev('r2', { role: 'required' }),
      ev('o1'),
      ev('o2'),
    ]);
    for (let s = 0; s < 200; s++) {
      const result = selectEvidence({ ...input, seed: `s${s}` });
      expect(result.ok).toBe(true);
      if (result.ok) {
        const ids = idsOf(result);
        expect(ids).toContain('r1');
        expect(ids).toContain('r2');
      }
    }
  });

  it('returns RequiredExceedsMax when required > max_evidence', () => {
    const result = selectEvidence(
      makeInput({ minEvidence: 1, maxEvidence: 2 }, [
        ev('r1', { role: 'required' }),
        ev('r2', { role: 'required' }),
        ev('r3', { role: 'required' }),
        ev('o1'),
      ]),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe('RequiredExceedsMax');
  });

  it('returns PoolBelowMinimum when required count exceeds the pool', () => {
    const result = selectEvidence(
      makeInput({ minEvidence: 3, maxEvidence: 0 }, [
        ev('r1', { role: 'required' }),
        ev('r2', { role: 'required' }),
      ]),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe('PoolBelowMinimum');
  });
});

describe('selectEvidence — pool size validation', () => {
  it('returns PoolBelowMinimum when pool < min_evidence', () => {
    const result = selectEvidence(
      makeInput({ minEvidence: 5, maxEvidence: 0 }, [ev('a'), ev('b'), ev('c')]),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe('PoolBelowMinimum');
  });

  it('target count never exceeds the pool', () => {
    const pool = [ev('a'), ev('b'), ev('c')];
    const input = makeInput({ minEvidence: 1, maxEvidence: 0 }, pool);
    for (let s = 0; s < 300; s++) {
      const result = selectEvidence({ ...input, seed: `e${s}` });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.evidence.length).toBeLessThanOrEqual(pool.length);
    }
  });

  it('allows an empty evidence set when min_evidence = 0 and no required evidence', () => {
    const result = selectEvidence(
      makeInput({ minEvidence: 0, maxEvidence: 0, seed: 'empty' }, [ev('a')]),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.evidence.length).toBeLessThanOrEqual(1);
  });
});

describe('selectEvidence — weighted selection', () => {
  it('picks higher-weight optionals more often than lower-weight ones', () => {
    const pool = [
      ev('heavy', { weight: 100 }),
      ev('mid', { weight: 10 }),
      ev('light', { weight: 1 }),
    ];
    const input = makeInput({ minEvidence: 1, maxEvidence: 1 }, pool);
    const counts: Record<string, number> = { heavy: 0, mid: 0, light: 0 };
    const seeds = 500;
    for (let s = 0; s < seeds; s++) {
      const result = selectEvidence({ ...input, seed: `w${s}` });
      expect(result.ok).toBe(true);
      if (result.ok) counts[result.evidence[0]!.evidenceId]!++;
    }
    const heavy = counts.heavy ?? 0;
    const mid = counts.mid ?? 0;
    const light = counts.light ?? 0;
    expect(heavy).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThan(light);
    expect(heavy).toBeGreaterThan(light);
  });

  it('never selects a zero-weight optional while positive-weight candidates exist', () => {
    const pool = [ev('winner', { weight: 1 }), ev('loser', { weight: 0 })];
    const input = makeInput({ minEvidence: 1, maxEvidence: 1 }, pool);
    for (let s = 0; s < 200; s++) {
      const result = selectEvidence({ ...input, seed: `z${s}` });
      expect(result.ok).toBe(true);
      if (result.ok) expect(idsOf(result)).not.toContain('loser');
    }
  });

  it('succeeds with exactly the required set when all optionals are weight 0 and target === |R|', () => {
    const result = selectEvidence(
      makeInput({ minEvidence: 1, maxEvidence: 1 }, [
        ev('r1', { role: 'required', weight: 0 }),
        ev('o1', { weight: 0 }),
      ]),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(idsOf(result)).toEqual(['r1']);
  });

  it('returns InsufficientPool when all optionals are weight 0 and target > |R|', () => {
    const result = selectEvidence(
      makeInput({ minEvidence: 2, maxEvidence: 2 }, [
        ev('r1', { role: 'required', weight: 0 }),
        ev('o1', { weight: 0 }),
      ]),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe('InsufficientPool');
  });
});

describe('selectEvidence — no quantity (single instance)', () => {
  it('output evidence carries no quantity field and each evidence appears exactly once', () => {
    const result = selectEvidence(makeInput({ minEvidence: 4, maxEvidence: 4, seed: 'single' }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.evidence).toHaveLength(4);
      const ids = result.evidence.map((e) => e.evidenceId);
      expect(new Set(ids).size).toBe(ids.length);
      for (const evRow of result.evidence) {
        expect(evRow).not.toHaveProperty('quantity');
      }
    }
  });
});

describe('selectEvidence — role, importance and discovery_method propagation', () => {
  it('propagates role unchanged for every evidence type, including null', () => {
    const pool = [
      ev('req', { role: 'required' }),
      ev('opt', { role: 'optional' }),
      ev('dec', { role: 'decoy' }),
      ev('hid', { role: 'hidden' }),
      ev('none', { role: null }),
    ];
    const input = makeInput({ minEvidence: 5, maxEvidence: 5, seed: 'role' }, pool);
    const result = selectEvidence(input);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.evidence.find((e) => e.evidenceId === 'req')!.role).toBe('required');
      expect(result.evidence.find((e) => e.evidenceId === 'opt')!.role).toBe('optional');
      expect(result.evidence.find((e) => e.evidenceId === 'dec')!.role).toBe('decoy');
      expect(result.evidence.find((e) => e.evidenceId === 'hid')!.role).toBe('hidden');
      expect(result.evidence.find((e) => e.evidenceId === 'none')!.role).toBeNull();
    }
  });

  it('propagates importance unchanged, including null', () => {
    const pool = [
      ev('critical', { importance: 'critical' }),
      ev('low', { importance: 'low' }),
      ev('none', { importance: null }),
    ];
    const input = makeInput({ minEvidence: 3, maxEvidence: 3, seed: 'imp' }, pool);
    const result = selectEvidence(input);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.evidence.find((e) => e.evidenceId === 'critical')!.importance).toBe('critical');
      expect(result.evidence.find((e) => e.evidenceId === 'low')!.importance).toBe('low');
      expect(result.evidence.find((e) => e.evidenceId === 'none')!.importance).toBeNull();
    }
  });

  it('propagates discovery_method unchanged, including null', () => {
    const pool = [
      ev('a', { discoveryMethod: 'search' }),
      ev('b', { discoveryMethod: null }),
      ev('c', { role: 'required', discoveryMethod: 'inspect' }),
    ];
    const input = makeInput({ minEvidence: 3, maxEvidence: 3, seed: 'disc' }, pool);
    const result = selectEvidence(input);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.evidence.find((e) => e.evidenceId === 'a')!.discoveryMethod).toBe('search');
      expect(result.evidence.find((e) => e.evidenceId === 'b')!.discoveryMethod).toBeNull();
      expect(result.evidence.find((e) => e.evidenceId === 'c')!.discoveryMethod).toBe('inspect');
    }
  });

  it('does not add required or hidden booleans that duplicate role semantics', () => {
    const pool = [
      ev('req', { role: 'required' }),
      ev('hid', { role: 'hidden' }),
      ev('dec', { role: 'decoy' }),
    ];
    const input = makeInput({ minEvidence: 3, maxEvidence: 3, seed: 'nobool' }, pool);
    const result = selectEvidence(input);
    expect(result.ok).toBe(true);
    if (result.ok) {
      for (const e of result.evidence) {
        expect(e).not.toHaveProperty('required');
        expect(e).not.toHaveProperty('hidden');
      }
    }
  });

  it('never lets decoy/hidden/optional classification affect selection: equal weights/priorities produce identical picks', () => {
    const plainPool = [
      ev('p', { role: 'required', weight: 100, priority: 0 }),
      ev('i', { weight: 50, priority: 1 }),
      ev('l', { weight: 20, priority: 2 }),
      ev('w', { weight: 10, priority: 3 }),
    ];
    const typedPool = [
      ev('p', { role: 'required', weight: 100, priority: 0 }),
      ev('i', { role: 'optional', weight: 50, priority: 1 }),
      ev('l', { role: 'decoy', weight: 20, priority: 2 }),
      ev('w', { role: 'hidden', weight: 10, priority: 3 }),
    ];
    const a = selectEvidence(
      makeInput({ minEvidence: 2, maxEvidence: 4, seed: 'role' }, plainPool),
    );
    const b = selectEvidence(
      makeInput({ minEvidence: 2, maxEvidence: 4, seed: 'role' }, typedPool),
    );
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(a.evidence.map((e) => e.evidenceId)).toEqual(b.evidence.map((e) => e.evidenceId));
      expect(a.evidence.length).toBe(b.evidence.length);
    }
  });
});

describe('selectEvidence — duplicates', () => {
  it('returns DuplicateEvidence when the snapshot contains a duplicate evidence_id', () => {
    const result = selectEvidence(makeInput({}, [ev('a'), ev('a', { priority: 1 })]));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe('DuplicateEvidence');
  });

  it('never returns duplicate evidence ids in a successful selection', () => {
    const pool = [ev('a'), ev('b'), ev('c'), ev('d'), ev('e')];
    const input = makeInput({ minEvidence: 2, maxEvidence: 4 }, pool);
    for (let s = 0; s < 200; s++) {
      const result = selectEvidence({ ...input, seed: `d${s}` });
      expect(result.ok).toBe(true);
      if (result.ok) {
        const ids = result.evidence.map((e) => e.evidenceId);
        expect(new Set(ids).size).toBe(ids.length);
      }
    }
  });
});

describe('selectEvidence — determinism', () => {
  it('produces identical output (types, roles, order) for the same seed', () => {
    const a = selectEvidence(makeInput({ seed: 'repeat' }));
    const b = selectEvidence(makeInput({ seed: 'repeat' }));
    expect(a).toEqual(b);
  });

  it('is capable of producing different outputs for different seeds', () => {
    const pool = [ev('a'), ev('b'), ev('c'), ev('d'), ev('e')];
    const input = makeInput({ minEvidence: 2, maxEvidence: 4 }, pool);
    const outputs = new Set<string>();
    for (let s = 0; s < 50; s++) {
      const result = selectEvidence({ ...input, seed: `v${s}` });
      expect(result.ok).toBe(true);
      if (result.ok) outputs.add(JSON.stringify(result.evidence));
    }
    expect(outputs.size).toBeGreaterThan(1);
  });
});

describe('selectEvidence — ordering', () => {
  it('orders output by (priority ASC, evidence_id ASC)', () => {
    const result = selectEvidence(
      makeInput({ minEvidence: 3, maxEvidence: 3 }, [
        ev('zulu', { priority: 10 }),
        ev('alpha', { priority: 1 }),
        ev('middle', { priority: 5 }),
      ]),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.evidence.map((e) => e.evidenceId)).toEqual(['alpha', 'middle', 'zulu']);
    }
  });

  it('breaks priority ties by evidence_id ascending', () => {
    const result = selectEvidence(
      makeInput({ minEvidence: 4, maxEvidence: 4 }, [
        ev('delta', { priority: 0 }),
        ev('bravo', { priority: 0 }),
        ev('charlie', { priority: 0 }),
        ev('alpha', { priority: 0 }),
      ]),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.evidence.map((e) => e.evidenceId)).toEqual([
        'alpha',
        'bravo',
        'charlie',
        'delta',
      ]);
    }
  });
});

describe('selectEvidence — version pinning', () => {
  it('returns VersionMismatch when a relation version differs from the template version', () => {
    const result = selectEvidence(makeInput({}, [ev('a'), ev('b', { version: 2 })]));
    expect(result.ok).toBe(false);
    if (!result.ok && result.error.type === 'VersionMismatch') {
      expect(result.error.templateVersion).toBe(VERSION);
    }
  });
});

describe('selectEvidence — invalid bounds', () => {
  it('returns InvalidBounds for negative minEvidence', () => {
    const result = selectEvidence(makeInput({ minEvidence: -1 }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe('InvalidBounds');
  });

  it('returns InvalidBounds for negative maxEvidence', () => {
    const result = selectEvidence(makeInput({ maxEvidence: -1 }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe('InvalidBounds');
  });

  it('returns InvalidBounds when minEvidence > maxEvidence (bounded)', () => {
    const result = selectEvidence(makeInput({ minEvidence: 5, maxEvidence: 3 }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe('InvalidBounds');
  });
});

describe('selectEvidence — invalid weights', () => {
  it('returns InvalidWeight for a negative weight', () => {
    const result = selectEvidence(makeInput({}, [ev('a', { weight: -1 })]));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe('InvalidWeight');
  });

  it('returns InvalidWeight for a non-finite weight', () => {
    const result = selectEvidence(makeInput({}, [ev('a', { weight: NaN })]));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe('InvalidWeight');
  });
});

describe('selectEvidence — empty pool', () => {
  it('returns NoEligibleEvidence for an empty pool', () => {
    const result = selectEvidence(makeInput({}, []));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe('NoEligibleEvidence');
  });
});

describe('selectEvidence — deterministic typed failures', () => {
  const failureInputs: Array<{ name: string; input: EvidenceSelectionInput; type: string }> = [
    {
      name: 'RequiredExceedsMax',
      input: makeInput({ minEvidence: 0, maxEvidence: 1 }, [
        ev('r1', { role: 'required' }),
        ev('r2', { role: 'required' }),
      ]),
      type: 'RequiredExceedsMax',
    },
    {
      name: 'PoolBelowMinimum',
      input: makeInput({ minEvidence: 5, maxEvidence: 0 }, [ev('a'), ev('b')]),
      type: 'PoolBelowMinimum',
    },
    { name: 'NoEligibleEvidence', input: makeInput({}, []), type: 'NoEligibleEvidence' },
    {
      name: 'InsufficientPool',
      input: makeInput({ minEvidence: 2, maxEvidence: 2 }, [
        ev('r1', { role: 'required', weight: 0 }),
        ev('o1', { weight: 0 }),
      ]),
      type: 'InsufficientPool',
    },
    {
      name: 'InvalidWeight',
      input: makeInput({}, [ev('a', { weight: -1 })]),
      type: 'InvalidWeight',
    },
    {
      name: 'VersionMismatch',
      input: makeInput({}, [ev('a', { version: 2 })]),
      type: 'VersionMismatch',
    },
    {
      name: 'InvalidBounds',
      input: makeInput({ minEvidence: 5, maxEvidence: 3 }),
      type: 'InvalidBounds',
    },
    {
      name: 'DuplicateEvidence',
      input: makeInput({}, [ev('a'), ev('a')]),
      type: 'DuplicateEvidence',
    },
  ];

  for (const { name, input, type } of failureInputs) {
    it(`returns a deterministic ${name} error`, () => {
      const a = selectEvidence(input);
      const b = selectEvidence(input);
      expect(a).toEqual(b);
      expect(a.ok).toBe(false);
      if (!a.ok) expect(a.error.type).toBe(type);
    });
  }
});

describe('selectEvidence — eligibility filter extension point (Phase 11)', () => {
  it('applies a caller-provided eligibility filter to narrow the pool', () => {
    const pool = [ev('a'), ev('b'), ev('c')];
    const input: EvidenceSelectionInput = {
      ...makeInput({ minEvidence: 2, maxEvidence: 2, seed: 'filter' }, pool),
      eligibilityFilter: (candidate: EvidenceSelectionCandidate) => candidate.evidenceId !== 'a',
    };
    const result = selectEvidence(input);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const ids = result.evidence.map((e) => e.evidenceId);
      expect(ids).not.toContain('a');
    }
  });
});
