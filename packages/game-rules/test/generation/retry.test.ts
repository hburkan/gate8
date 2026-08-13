import { describe, expect, it } from 'vitest';
import {
  deriveDomainSeed,
  generateCase,
  type CaseTemplateSnapshot,
} from '../../src/generation/pipeline.js';
import { deriveRetrySeed, seedFromEntropy } from '../../src/generation/seed.js';
import { validateGeneratedCase } from '../../src/generation/validate.js';

/**
 * Retry semantics + reproducibility contract tests (Phase 13).
 *
 * Retry is simply `generateCase(snapshot, newSeed)`: the pipeline is pure, so
 * a retry can never mutate an existing `GeneratedCase`, must use a NEW seed,
 * and never relaxes constraints (no fallback generation). The reproducibility
 * contract keys on (templateVersion, seed, pipelineAlgorithmVersion) — a
 * stored seed reproduces its case exactly.
 */

const VERSION = 1;
const CANONICAL = '000102030405060708090a0b0c0d0e0f';

function makeSnapshot(overrides: Partial<CaseTemplateSnapshot> = {}): CaseTemplateSnapshot {
  return {
    caseTemplateId: 'case-golden',
    templateVersion: VERSION,
    type: 'contraband',
    difficulty: 'medium',
    minCharacters: 1,
    maxCharacters: 3,
    minItems: 1,
    maxItems: 3,
    minDocuments: 1,
    maxDocuments: 3,
    minEvidence: 1,
    maxEvidence: 3,
    characters: [
      {
        characterId: 'alice',
        required: true,
        weight: 100,
        priority: 0,
        conditions: [],
        version: VERSION,
        role: 'businessman',
        occupation: 'importer',
      },
      {
        characterId: 'bob',
        required: false,
        weight: 10,
        priority: 1,
        conditions: [],
        version: VERSION,
        role: null,
        occupation: null,
      },
      {
        characterId: 'carol',
        required: false,
        weight: 5,
        priority: 2,
        conditions: [],
        version: VERSION,
        role: null,
        occupation: null,
      },
    ],
    items: [
      {
        itemId: 'phone',
        required: true,
        weight: 100,
        minQuantity: 1,
        maxQuantity: 1,
        hidden: false,
        discoveryMethod: null,
        priority: 0,
        conditions: [],
        version: VERSION,
        name: 'phone',
      },
      {
        itemId: 'handgun',
        required: false,
        weight: 10,
        minQuantity: 2,
        maxQuantity: 3,
        hidden: false,
        discoveryMethod: null,
        priority: 1,
        conditions: [],
        version: VERSION,
        name: 'handgun',
      },
      {
        itemId: 'watch',
        required: false,
        weight: 5,
        minQuantity: 1,
        maxQuantity: 1,
        hidden: false,
        discoveryMethod: null,
        priority: 2,
        conditions: [],
        version: VERSION,
        name: 'watch',
      },
    ],
    documents: [
      {
        documentId: 'invoice',
        required: true,
        weight: 100,
        role: 'real',
        hidden: false,
        discoveryMethod: null,
        priority: 0,
        conditions: [],
        version: VERSION,
      },
      {
        documentId: 'passport',
        required: false,
        weight: 10,
        role: 'real',
        hidden: false,
        discoveryMethod: null,
        priority: 1,
        conditions: [],
        version: VERSION,
      },
    ],
    evidence: [
      {
        evidenceId: 'fingerprint',
        role: 'required',
        weight: 100,
        importance: 'high',
        discoveryMethod: null,
        priority: 0,
        version: VERSION,
        name: 'fingerprint',
        conditions: [],
        discoveryCondition: null,
      },
      {
        evidenceId: 'cctv',
        role: null,
        weight: 10,
        importance: 'medium',
        discoveryMethod: null,
        priority: 1,
        version: VERSION,
        name: 'cctv',
        conditions: [],
        discoveryCondition: null,
      },
      {
        evidenceId: 'note',
        role: null,
        weight: 5,
        importance: 'low',
        discoveryMethod: null,
        priority: 2,
        version: VERSION,
        name: 'note',
        conditions: [],
        discoveryCondition: null,
      },
    ],
    ...overrides,
  };
}

describe('reproducibility contract', () => {
  it('pins a golden full GeneratedCase for a fixed snapshot + canonical seed', () => {
    const result = generateCase(makeSnapshot(), CANONICAL);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.case).toEqual({
      caseTemplateId: 'case-golden',
      templateVersion: 1,
      pipelineAlgorithmVersion: 1,
      seed: CANONICAL,
      characters: [
        { characterId: 'alice', role: 'businessman' },
        { characterId: 'bob', role: null },
      ],
      items: [
        { itemId: 'phone', quantity: 1, hidden: false, discoveryMethod: null },
        { itemId: 'handgun', quantity: 2, hidden: false, discoveryMethod: null },
        { itemId: 'watch', quantity: 1, hidden: false, discoveryMethod: null },
      ],
      documents: [
        { documentId: 'invoice', role: 'real', hidden: false, discoveryMethod: null },
        { documentId: 'passport', role: 'real', hidden: false, discoveryMethod: null },
      ],
      evidence: [
        { evidenceId: 'fingerprint', role: 'required', importance: 'high', discoveryMethod: null },
        { evidenceId: 'cctv', role: null, importance: 'medium', discoveryMethod: null },
      ],
      metadata: {
        derivedSeeds: {
          characters: 'db78cba3a645ffe7233fcb5a5e02ff1e',
          items: '35695b908c1bdce202afc341bbdd4433',
          documents: '35e278efedb209bac9f86d5211a81c07',
          evidence: '5bc371136d13de9ca108749997d8db16',
        },
        poolSizes: { characters: 3, items: 3, documents: 2, evidence: 3 },
        selectedCounts: { characters: 2, items: 3, documents: 2, evidence: 2 },
      },
    });
  });

  it('regenerating from the stored reproduction key (templateVersion + seed + pipelineAlgorithmVersion) reproduces the case', () => {
    const a = generateCase(makeSnapshot(), CANONICAL);
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    // Phase 14 will store exactly these three fields; regenerate from them.
    const key = {
      templateVersion: a.case.templateVersion,
      seed: a.case.seed,
      pipelineAlgorithmVersion: a.case.pipelineAlgorithmVersion,
    };
    const b = generateCase(makeSnapshot(), key.seed);
    expect(b.ok).toBe(true);
    if (b.ok) expect(b.case).toEqual(a.case);
    expect(key.pipelineAlgorithmVersion).toBe(1);
  });

  it('a re-invocation with the same seed returns a deep-equal but distinct object (fresh result, no shared state)', () => {
    const a = generateCase(makeSnapshot(), 'case-demo-seed-123');
    const b = generateCase(makeSnapshot(), 'case-demo-seed-123');
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(b.case).toEqual(a.case);
      expect(b.case).not.toBe(a.case);
    }
  });

  it('distinct canonical seeds yield distinct generated outputs across seeds', () => {
    const rnd = lcg(8675309);
    const seeds: string[] = [];
    for (let i = 0; i < 40; i++) {
      const bytes = new Uint8Array(16);
      for (let j = 0; j < 16; j++) bytes[j] = Math.floor(rnd() * 256);
      const made = seedFromEntropy(bytes);
      expect(made.ok).toBe(true);
      if (made.ok) seeds.push(made.seed);
    }
    const outputs = new Set<string>();
    for (const seed of seeds) {
      const result = generateCase(makeSnapshot(), seed);
      expect(result.ok).toBe(true);
      if (result.ok) outputs.add(JSON.stringify(result.case));
    }
    expect(outputs.size).toBeGreaterThan(1);
  });

  it('generateCase stays permissive for arbitrary deterministic test seeds', () => {
    for (const seed of ['case-demo-seed-123', 'seed-0', 'demo', '']) {
      const result = generateCase(makeSnapshot(), seed);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.case.seed).toBe(seed);
    }
  });
});

describe('retry semantics', () => {
  it('retry is generateCase(snapshot, newSeed) and echoes the new seed', () => {
    const first = generateCase(makeSnapshot(), 'initial-seed');
    expect(first.ok).toBe(true);
    const retrySeed = deriveRetrySeed('initial-seed', 1);
    expect(retrySeed).not.toBe('initial-seed');
    const retry = generateCase(makeSnapshot(), retrySeed);
    expect(retry.ok).toBe(true);
    if (retry.ok) expect(retry.case.seed).toBe(retrySeed);
  });

  it('a retry never mutates the previous GeneratedCase', () => {
    const first = generateCase(makeSnapshot(), 'initial-seed');
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const frozen = deepFreeze(first.case);
    const before = JSON.stringify(frozen);

    const retry = generateCase(makeSnapshot(), deriveRetrySeed('initial-seed', 1));
    expect(retry.ok).toBe(true);

    expect(JSON.stringify(frozen)).toBe(before);
    expect(frozen.seed).toBe('initial-seed');
    expect(retry.ok && retry.case).not.toBe(frozen);
  });

  it('requires a new seed: the retry seed differs from the base and from every pipeline domain seed', () => {
    const base = 'case-demo-seed-123';
    const retrySeed = deriveRetrySeed(base, 1);
    expect(retrySeed).not.toBe(base);
    for (const domain of ['characters', 'items', 'documents', 'evidence'] as const) {
      expect(retrySeed).not.toBe(deriveDomainSeed(base, domain));
    }
  });

  it('deterministic retry: (snapshot, seed, attempt) fully determines the retry output', () => {
    const a = generateCase(makeSnapshot(), deriveRetrySeed('case-demo-seed-123', 1));
    const b = generateCase(makeSnapshot(), deriveRetrySeed('case-demo-seed-123', 1));
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    if (a.ok && b.ok) expect(b.case).toEqual(a.case);
  });

  it('distinct attempts of the same seed produce (usually) different outputs', () => {
    const outputs = new Set<string>();
    for (let attempt = 1; attempt <= 10; attempt++) {
      const result = generateCase(makeSnapshot(), deriveRetrySeed('case-demo-seed-123', attempt));
      expect(result.ok).toBe(true);
      if (result.ok) outputs.add(JSON.stringify(result.case));
    }
    expect(outputs.size).toBeGreaterThan(1);
  });

  it('no fallback generation: a failing snapshot fails identically under a retry seed with the same typed error', () => {
    const failing = makeSnapshot({ characters: [], minCharacters: 1, maxCharacters: 1 });
    const first = generateCase(failing, 'attempt-0');
    const retry = generateCase(failing, deriveRetrySeed('attempt-0', 1));
    expect(first.ok).toBe(false);
    expect(retry.ok).toBe(false);
    if (!first.ok && !retry.ok) {
      expect(first.error).toEqual(retry.error);
      expect(retry.error.type).toBe('PipelineStepError');
      if (retry.error.type === 'PipelineStepError') {
        expect(retry.error.cause.type).toBe('NoEligibleCharacters');
      }
    }
  });

  it('a successful retry result passes the verify-only generated-case guard', () => {
    const retry = generateCase(makeSnapshot(), deriveRetrySeed('initial-seed', 1));
    expect(retry.ok).toBe(true);
    if (retry.ok) expect(validateGeneratedCase(makeSnapshot(), retry.case)).toEqual([]);
  });
});

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
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
