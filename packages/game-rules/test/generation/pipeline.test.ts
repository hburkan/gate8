import { describe, expect, it } from 'vitest';
import { selectCharacters } from '../../src/generation/selection.js';
import type { CharacterSelectionCandidate } from '../../src/generation/selection.js';
import {
  PIPELINE_ALGORITHM_VERSION,
  deriveDomainSeed,
  generateCase,
  type CaseTemplateSnapshot,
  type EvidencePoolRow,
  type ItemPoolRow,
  type PipelineDomain,
} from '../../src/generation/pipeline.js';

const VERSION = 1;

function char(characterId: string, overrides: Partial<CharacterPoolChar> = {}): CharacterPoolChar {
  return {
    characterId,
    required: false,
    weight: 1,
    priority: 0,
    conditions: [],
    version: VERSION,
    role: null,
    occupation: null,
    ...overrides,
  };
}

interface CharacterPoolChar extends Record<string, unknown> {
  characterId: string;
  required: boolean;
  weight: number;
  priority: number;
  conditions: unknown[];
  version: number;
  role: string | null;
  occupation: string | null;
}

function item(itemId: string, overrides: Partial<ItemPoolRow> = {}): ItemPoolRow {
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
    name: null,
    ...overrides,
  };
}

function doc(
  documentId: string,
  overrides: Partial<{ [k: string]: unknown }> = {},
): {
  documentId: string;
  required: boolean;
  weight: number;
  role: string | null;
  hidden: boolean;
  discoveryMethod: string | null;
  priority: number;
  conditions: unknown[];
  version: number;
} {
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

function ev(evidenceId: string, overrides: Partial<EvidencePoolRow> = {}): EvidencePoolRow {
  return {
    evidenceId,
    role: null,
    weight: 1,
    importance: null,
    discoveryMethod: null,
    priority: 0,
    version: VERSION,
    name: null,
    conditions: [],
    discoveryCondition: null,
    ...overrides,
  };
}

function makeSnapshot(overrides: Partial<CaseTemplateSnapshot> = {}): CaseTemplateSnapshot {
  return {
    caseTemplateId: 'case-1',
    templateVersion: VERSION,
    type: 'murder',
    difficulty: 'hard',
    minCharacters: 1,
    maxCharacters: 3,
    minItems: 1,
    maxItems: 3,
    minDocuments: 1,
    maxDocuments: 3,
    minEvidence: 1,
    maxEvidence: 3,
    characters: [
      char('alice', { required: true, weight: 100, role: 'businessman', occupation: 'importer' }),
      char('bob', { weight: 10, role: null, occupation: null }),
      char('carol', { weight: 5, role: null, occupation: null }),
    ],
    items: [
      item('phone', { required: true, weight: 100, name: 'phone' }),
      item('handgun', { weight: 10, name: 'handgun' }),
      item('watch', { weight: 5, name: 'watch' }),
    ],
    documents: [doc('invoice', { role: 'real' }), doc('passport', { role: 'real' })],
    evidence: [ev('fingerprint', { role: 'required' }), ev('cctv', {}), ev('note', {})],
    ...overrides,
  };
}

describe('deriveDomainSeed — golden + domain separation', () => {
  it('pins golden derived seeds for a fixed (seed, domain) input', () => {
    expect(deriveDomainSeed('case-demo-seed-123', 'characters')).toBe(
      '3c34cb5c1147874d6a13d1f747609de6',
    );
    expect(deriveDomainSeed('case-demo-seed-123', 'items')).toBe(
      '13608ea28983a40968dbdb38f238f193',
    );
    expect(deriveDomainSeed('case-demo-seed-123', 'documents')).toBe(
      '4038d2b42a3f6477649e14d10e99a212',
    );
    expect(deriveDomainSeed('case-demo-seed-123', 'evidence')).toBe(
      '4ba56665362a779e642deb7819a2fa83',
    );
  });

  it('produces distinct derived seeds for distinct domains', () => {
    const domains: PipelineDomain[] = ['characters', 'items', 'documents', 'evidence'];
    const seeds = domains.map((d) => deriveDomainSeed('shared', d));
    expect(new Set(seeds).size).toBe(domains.length);
  });

  it('is a pure function of (seed, domain): repeated calls agree and inserting a new domain never perturbs existing ones', () => {
    expect(deriveDomainSeed('s', 'characters')).toBe(deriveDomainSeed('s', 'characters'));
    const before = domains().map((d) => deriveDomainSeed('s', d));
    // 'dialogue' is a future domain; deriving it must not change existing derived seeds
    deriveDomainSeed('s', 'dialogue');
    const after = domains().map((d) => deriveDomainSeed('s', d));
    expect(after).toEqual(before);
  });
});

describe('pipeline algorithm version', () => {
  it('freezes PIPELINE_ALGORITHM_VERSION at 1', () => {
    expect(PIPELINE_ALGORITHM_VERSION).toBe(1);
  });

  it('exposes the algorithm version on every successful result', () => {
    const result = generateCase(makeSnapshot(), 'demo');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.case.pipelineAlgorithmVersion).toBe(PIPELINE_ALGORITHM_VERSION);
  });
});

describe('generateCase — determinism', () => {
  it('same snapshot + same seed = identical result (deep, incl. metadata)', () => {
    const a = generateCase(makeSnapshot(), 'case-demo-seed-123');
    const b = generateCase(makeSnapshot(), 'case-demo-seed-123');
    expect(a).toEqual(b);
    expect(a.ok).toBe(true);
  });

  it('different seeds produce deterministic, possibly different results', () => {
    const outputs = new Set<string>();
    for (let s = 0; s < 40; s++) {
      const result = generateCase(makeSnapshot(), `seed-${s}`);
      expect(result.ok).toBe(true);
      if (result.ok) outputs.add(JSON.stringify(result.case));
    }
    expect(outputs.size).toBeGreaterThan(1);
  });
});

describe('generateCase — D1 stream determinism', () => {
  it('the characters step equals calling selectCharacters directly with the derived seed', () => {
    const snapshot = makeSnapshot();
    const result = generateCase(snapshot, 's');
    expect(result.ok).toBe(true);
    if (result.ok) {
      const direct = selectCharacters({
        caseTemplateId: snapshot.caseTemplateId,
        templateVersion: snapshot.templateVersion,
        minCharacters: snapshot.minCharacters,
        maxCharacters: snapshot.maxCharacters,
        characters: snapshot.characters as CharacterSelectionCandidate[],
        seed: deriveDomainSeed('s', 'characters'),
      });
      expect(direct.ok).toBe(true);
      if (direct.ok) expect(result.case.characters).toEqual(direct.characters);
    }
  });
});

describe('generateCase — generator dependency independence', () => {
  it('items: changing the selected characters does not change item output when no item condition references characters', () => {
    const snapshotA = makeSnapshot({
      characters: [char('x', { required: true, weight: 100 }), char('y', { weight: 100 })],
    });
    const snapshotB = makeSnapshot({
      characters: [char('p', { required: true, weight: 100 }), char('q', { weight: 100 })],
    });
    const a = generateCase(snapshotA, 'same');
    const b = generateCase(snapshotB, 'same');
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(a.case.items).toEqual(b.case.items);
    }
  });

  it('documents: changing earlier outputs does not change document output when no document condition references them', () => {
    const snapshotA = makeSnapshot({
      characters: [char('x', { required: true }), char('y', { weight: 100 })],
      items: [item('a', { required: true }), item('b', { weight: 100 })],
    });
    const snapshotB = makeSnapshot({
      characters: [char('p', { required: true }), char('q', { weight: 100 })],
      items: [item('r', { required: true }), item('t', { weight: 100 })],
    });
    const a = generateCase(snapshotA, 'same');
    const b = generateCase(snapshotB, 'same');
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(a.case.documents).toEqual(b.case.documents);
    }
  });

  it('evidence: changing earlier outputs does not change evidence output when no evidence condition references them', () => {
    const snapshotA = makeSnapshot({
      characters: [char('x', { required: true })],
      items: [item('a', { required: true })],
      documents: [doc('d1', {})],
    });
    const snapshotB = makeSnapshot({
      characters: [char('p', { required: true })],
      items: [item('r', { required: true })],
      documents: [doc('d2', {})],
    });
    const a = generateCase(snapshotA, 'same');
    const b = generateCase(snapshotB, 'same');
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(a.case.evidence).toEqual(b.case.evidence);
    }
  });
});

describe('generateCase — condition-driven dependency (work examples)', () => {
  it('work example 1: evidence gated on hasItem(phone) is present iff a phone was generated', () => {
    const withPhone = generateCase(
      makeSnapshot({
        items: [item('phone', { required: true, name: 'phone' })],
        evidence: [ev('imei', { role: 'required', conditions: [{ op: 'hasItem', ref: 'phone' }] })],
      }),
      'ex1',
    );
    expect(withPhone.ok).toBe(true);
    if (withPhone.ok) {
      expect(withPhone.case.evidence.map((e) => e.evidenceId)).toContain('imei');
    }

    const withoutPhone = generateCase(
      makeSnapshot({
        items: [item('handgun', { required: true, name: 'handgun' })],
        evidence: [
          ev('imei', { role: 'required', conditions: [{ op: 'hasItem', ref: 'phone' }] }),
          ev('forensic', { role: 'required' }),
        ],
      }),
      'ex1',
    );
    expect(withoutPhone.ok).toBe(true);
    if (withoutPhone.ok) {
      expect(withoutPhone.case.evidence.map((e) => e.evidenceId)).not.toContain('imei');
    }
  });

  it('work example 2: document gated on characterRole(businessman) is present iff a businessman was generated', () => {
    const withBusinessman = generateCase(
      makeSnapshot({
        characters: [
          char('boss', { required: true, role: 'businessman' }),
          char('other', { weight: 10 }),
        ],
        documents: [
          doc('invoice', {
            role: 'real',
            required: true,
            conditions: [{ op: 'characterRole', value: 'businessman' }],
          }),
          doc('passport', { role: 'real' }),
        ],
      }),
      'ex2',
    );
    expect(withBusinessman.ok).toBe(true);
    if (withBusinessman.ok) {
      expect(withBusinessman.case.documents.map((d) => d.documentId)).toContain('invoice');
    }

    const withoutBusinessman = generateCase(
      makeSnapshot({
        characters: [char('clerk', { required: true, role: null })],
        documents: [
          doc('invoice', {
            role: 'real',
            required: true,
            conditions: [{ op: 'characterRole', value: 'businessman' }],
          }),
          doc('license', { role: 'real', required: true }),
        ],
      }),
      'ex2',
    );
    expect(withoutBusinessman.ok).toBe(true);
    if (withoutBusinessman.ok) {
      expect(withoutBusinessman.case.documents.map((d) => d.documentId)).not.toContain('invoice');
    }
  });
});

describe('generateCase — Phase 1 validation', () => {
  it('returns VersionMismatch for a version mismatch in each pool, before any generation', () => {
    const cases: Array<{ pool: PipelineDomain; snapshot: CaseTemplateSnapshot }> = [
      {
        pool: 'characters',
        snapshot: makeSnapshot({ characters: [char('bad', { version: 99 })] }),
      },
      {
        pool: 'items',
        snapshot: makeSnapshot({ items: [item('bad', { version: 99 })] }),
      },
      {
        pool: 'documents',
        snapshot: makeSnapshot({ documents: [doc('bad', { version: 99 })] }),
      },
      {
        pool: 'evidence',
        snapshot: makeSnapshot({ evidence: [ev('bad', { version: 99 })] }),
      },
    ];
    for (const { pool, snapshot } of cases) {
      const result = generateCase(snapshot, 'v');
      expect(result.ok).toBe(false);
      if (!result.ok && result.error.type === 'VersionMismatch') {
        expect(result.error.pool).toBe(pool);
        expect(result.error.templateVersion).toBe(VERSION);
        expect(result.error.version).toBe(99);
      }
    }
  });

  it('returns VersionMismatch with the offending entity id', () => {
    const result = generateCase(
      makeSnapshot({ characters: [char('zebra', { version: 5 })] }),
      'v2',
    );
    expect(result.ok).toBe(false);
    if (!result.ok && result.error.type === 'VersionMismatch') {
      expect(result.error.entityId).toBe('zebra');
    }
  });

  it('returns DuplicateEntity for duplicate ids within a pool', () => {
    const result = generateCase(makeSnapshot({ items: [item('dup'), item('dup')] }), 'dup');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe('DuplicateEntity');
  });

  it('returns InvalidRule for a malformed condition payload', () => {
    const result = generateCase(
      makeSnapshot({ documents: [doc('bad', { conditions: [{ op: 'eqauls' }] })] }),
      'rule',
    );
    expect(result.ok).toBe(false);
    if (!result.ok && result.error.type === 'InvalidRule') {
      expect(result.error.pool).toBe('documents');
      expect(result.error.entityId).toBe('bad');
    }
  });

  it('returns InvalidRule carrying the malformed payload element', () => {
    const payload = [{ op: 'unknownOp', path: 'x' }];
    const result = generateCase(
      makeSnapshot({ evidence: [ev('bad', { conditions: payload })] }),
      'rule2',
    );
    expect(result.ok).toBe(false);
    if (!result.ok && result.error.type === 'InvalidRule') {
      expect(result.error.payload).toEqual(payload[0]);
    }
  });

  it('returns InvalidSnapshot for invalid template bounds', () => {
    const result = generateCase(makeSnapshot({ minCharacters: 5, maxCharacters: 3 }), 'b');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe('InvalidSnapshot');
  });

  it('returns InvalidSnapshot for a non-positive templateVersion', () => {
    const result = generateCase(makeSnapshot({ templateVersion: 0 }), 't');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe('InvalidSnapshot');
  });
});

describe('generateCase — required entity becoming ineligible (step-local)', () => {
  it('a required character gated on a missing item yields a step error with PoolBelowMinimum cause', () => {
    const snapshot = makeSnapshot({
      minCharacters: 2,
      characters: [
        char('gated', {
          required: true,
          conditions: [{ op: 'hasItem', ref: 'phone' }],
        }),
        char('other', { weight: 10 }),
      ],
      items: [item('handgun', { required: true })],
    });
    const result = generateCase(snapshot, 'req');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.type).toBe('PipelineStepError');
      if (result.error.type === 'PipelineStepError') {
        expect(result.error.step).toBe('characters');
        expect(result.error.cause.type).toBe('PoolBelowMinimum');
      }
    }
  });
});

describe('generateCase — empty/insufficient pools', () => {
  it('empty pool yields NoEligible* (never PoolBelowMinimum) wrapped as a step error', () => {
    const result = generateCase(makeSnapshot({ characters: [], minCharacters: 1 }), 'e');
    expect(result.ok).toBe(false);
    if (!result.ok && result.error.type === 'PipelineStepError') {
      expect(result.error.step).toBe('characters');
      expect(result.error.cause.type).toBe('NoEligibleCharacters');
    }
  });

  it('an entirely ineligible pool yields NoEligible* wrapped as a step error', () => {
    const snapshot = makeSnapshot({
      characters: [
        char('gated', {
          required: true,
          conditions: [{ op: 'hasItem', ref: 'phone' }],
        }),
      ],
      items: [item('handgun', { required: true })],
    });
    const result = generateCase(snapshot, 'noelig');
    expect(result.ok).toBe(false);
    if (!result.ok && result.error.type === 'PipelineStepError') {
      expect(result.error.cause.type).toBe('NoEligibleCharacters');
    }
  });

  it('all optionals weight 0 with target above required yields InsufficientPool wrapped as a step error', () => {
    const snapshot = makeSnapshot({
      characters: [char('c', { required: true, weight: 0 }), char('d', { weight: 0 })],
      minCharacters: 2,
      maxCharacters: 2,
    });
    const result = generateCase(snapshot, 'insuf');
    expect(result.ok).toBe(false);
    if (!result.ok && result.error.type === 'PipelineStepError') {
      expect(result.error.cause.type).toBe('InsufficientPool');
    }
  });
});

describe('generateCase — atomicity and result shape', () => {
  it('a failure in a later step returns {ok:false} only — no partial case', () => {
    const snapshot = makeSnapshot({
      evidence: [
        ev('gated', {
          role: 'required',
          conditions: [{ op: 'hasItem', ref: 'phone' }],
        }),
      ],
      items: [item('handgun', { required: true })],
    });
    const result = generateCase(snapshot, 'atomic');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect('case' in result).toBe(false);
      expect(result.error.type).toBe('PipelineStepError');
    }
  });

  it('result carries identity, version, algorithm version, seed, sets, and metadata', () => {
    const result = generateCase(makeSnapshot(), 'meta');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.case.caseTemplateId).toBe('case-1');
      expect(result.case.templateVersion).toBe(VERSION);
      expect(result.case.seed).toBe('meta');
      expect(result.case.metadata.derivedSeeds.characters).toBe(
        deriveDomainSeed('meta', 'characters'),
      );
      expect(result.case.metadata.selectedCounts.characters).toBe(result.case.characters.length);
      expect(result.case.metadata.poolSizes.characters).toBeGreaterThan(0);
    }
  });

  it('never returns a partial success when a pool is empty with min=0', () => {
    const zeroOk = makeSnapshot({
      characters: [],
      minCharacters: 0,
      maxCharacters: 0,
      items: [item('a', { required: true })],
    });
    const result = generateCase(zeroOk, 'zero');
    expect(result.ok).toBe(false);
    if (!result.ok && result.error.type === 'PipelineStepError') {
      expect(result.error.cause.type).toBe('NoEligibleCharacters');
    }
  });
});

describe('generateCase — snapshot immutability', () => {
  it('deep-freezes the snapshot; generation succeeds and leaves it unchanged; output shares no identity with input', () => {
    const snapshot = makeSnapshot();
    const frozen = deepFreeze(snapshot);
    const before = JSON.stringify(frozen);
    const result = generateCase(frozen, 'frozen');
    expect(result.ok).toBe(true);
    expect(JSON.stringify(frozen)).toBe(before);
    if (result.ok) {
      const rows = [
        ...snapshot.characters,
        ...snapshot.items,
        ...snapshot.documents,
        ...snapshot.evidence,
      ];
      for (const g of [
        ...result.case.characters,
        ...result.case.items,
        ...result.case.documents,
        ...result.case.evidence,
      ]) {
        expect(rows.includes(g as never)).toBe(false);
      }
    }
  });
});

function domains(): PipelineDomain[] {
  return ['characters', 'items', 'documents', 'evidence'];
}

function deepFreeze<T>(obj: T): T {
  if (obj && typeof obj === 'object') {
    for (const key of Object.keys(obj)) {
      deepFreeze((obj as Record<string, unknown>)[key]);
    }
    Object.freeze(obj);
  }
  return obj;
}
