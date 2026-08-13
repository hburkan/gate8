import { describe, expect, it } from 'vitest';
import {
  generateCase,
  type CaseTemplateSnapshot,
  type GeneratedCase,
} from '../../src/generation/pipeline.js';
import type { GeneratedDocument } from '../../src/generation/document-types.js';
import type { GeneratedEvidence } from '../../src/generation/evidence-types.js';
import type { GeneratedItem } from '../../src/generation/item-types.js';
import type { SelectedCharacter } from '../../src/generation/types.js';
import { validateGeneratedCase } from '../../src/generation/validate.js';

/**
 * Verify-only generated-case guard tests (Phase 13).
 *
 * `validateGeneratedCase(snapshot, generatedCase)` returns typed structural
 * issues or `[]`; it NEVER repairs or mutates. For a correctly generated case
 * it always returns `[]`; each injected defect yields the matching typed
 * issue. Count bounds reuse the exact generator math (lower = max(min,
 * conditionless-required), upper = bounded effective pool size).
 */

const VERSION = 1;

type CharacterPoolRow = CaseTemplateSnapshot['characters'][number];
type ItemPoolRow = CaseTemplateSnapshot['items'][number];
type DocumentPoolRow = CaseTemplateSnapshot['documents'][number];
type EvidencePoolRow = CaseTemplateSnapshot['evidence'][number];

function char(characterId: string, overrides: Partial<CharacterPoolRow> = {}): CharacterPoolRow {
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

function doc(documentId: string, overrides: Partial<DocumentPoolRow> = {}): DocumentPoolRow {
  return {
    documentId,
    required: false,
    weight: 1,
    role: 'real',
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
    importance: 'medium',
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
    caseTemplateId: 'case-v',
    templateVersion: VERSION,
    type: 'smuggling',
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
      char('alice', { required: true }),
      char('bob', { weight: 10 }),
      char('carol', { weight: 5 }),
    ],
    items: [
      item('phone', { required: true, weight: 100 }),
      item('handgun', { weight: 10, minQuantity: 2, maxQuantity: 3 }),
      item('watch', { weight: 5 }),
    ],
    documents: [doc('invoice', { required: true }), doc('passport', { weight: 10 })],
    evidence: [
      ev('fingerprint', { role: 'required', weight: 100 }),
      ev('cctv', {}),
      ev('note', {}),
    ],
    ...overrides,
  };
}

const selChar = (
  characterId: string,
  role: SelectedCharacter['role'] = null,
): SelectedCharacter => ({
  characterId,
  role,
});
const genItem = (
  itemId: string,
  quantity: number,
  hidden = false,
  discoveryMethod: GeneratedItem['discoveryMethod'] = null,
): GeneratedItem => ({ itemId, quantity, hidden, discoveryMethod });
const genDoc = (
  documentId: string,
  role: GeneratedDocument['role'] = 'real',
  hidden = false,
  discoveryMethod: GeneratedDocument['discoveryMethod'] = null,
): GeneratedDocument => ({ documentId, role, hidden, discoveryMethod });
const genEv = (
  evidenceId: string,
  role: GeneratedEvidence['role'] = null,
  importance: GeneratedEvidence['importance'] = 'medium',
  discoveryMethod: GeneratedEvidence['discoveryMethod'] = null,
): GeneratedEvidence => ({ evidenceId, role, importance, discoveryMethod });

function defect(base: GeneratedCase, patch: Partial<GeneratedCase>): GeneratedCase {
  return { ...base, ...patch };
}

describe('validateGeneratedCase — valid generated cases', () => {
  it('returns [] for a pipeline-generated case', () => {
    const snapshot = makeSnapshot();
    const result = generateCase(snapshot, 'case-demo-seed-123');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(validateGeneratedCase(snapshot, result.case)).toEqual([]);
  });

  it('returns [] for a condition-free snapshot where a condition-carrying required row is legitimately absent', () => {
    // A required character gated on hasItem(phone) becomes ineligible when no
    // phone is generated; the pipeline legitimately succeeds without it. The
    // structural guard must NOT raise MissingRequiredEntity for rows whose
    // conditions it cannot evaluate.
    const snapshot = makeSnapshot({
      minCharacters: 1,
      maxCharacters: 2,
      characters: [
        char('gated', {
          required: true,
          conditions: [{ op: 'hasItem', ref: 'phone' }],
        }),
        char('clerk', { weight: 10 }),
      ],
      items: [item('handgun', { required: true })],
    });
    const result = generateCase(snapshot, 'cond');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(validateGeneratedCase(snapshot, result.case)).toEqual([]);
  });
});

describe('validateGeneratedCase — required closure', () => {
  it('reports a missing conditionless required character', () => {
    const snapshot = makeSnapshot();
    const result = generateCase(snapshot, 'req');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const issues = validateGeneratedCase(
      snapshot,
      defect(result.case, { characters: [selChar('bob'), selChar('carol')] }),
    );
    expect(issues).toEqual([
      { type: 'MissingRequiredEntity', domain: 'characters', entityId: 'alice' },
    ]);
  });

  it('reports a missing required evidence (role === required)', () => {
    const snapshot = makeSnapshot();
    const result = generateCase(snapshot, 'reqev');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const issues = validateGeneratedCase(
      snapshot,
      defect(result.case, { evidence: [genEv('cctv'), genEv('note')] }),
    );
    expect(issues).toEqual([
      { type: 'MissingRequiredEntity', domain: 'evidence', entityId: 'fingerprint' },
    ]);
  });
});

describe('validateGeneratedCase — count bounds (exact generator math)', () => {
  it('reports a count below the lower bound', () => {
    const snapshot = makeSnapshot({
      minCharacters: 2,
      maxCharacters: 3,
      characters: [char('a'), char('b'), char('c')],
    });
    const result = generateCase(snapshot, 'low');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const issues = validateGeneratedCase(
      snapshot,
      defect(result.case, { characters: [selChar('a')] }),
    );
    expect(issues).toEqual([
      { type: 'CountOutsideBounds', domain: 'characters', count: 1, lower: 2, upper: 3 },
    ]);
  });

  it('reports a count above the effective upper bound', () => {
    const snapshot = makeSnapshot({
      minCharacters: 0,
      maxCharacters: 2,
      characters: [char('a'), char('b'), char('c')],
    });
    const result = generateCase(snapshot, 'high');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const issues = validateGeneratedCase(
      snapshot,
      defect(result.case, {
        characters: [selChar('a'), selChar('b'), selChar('c')],
      }),
    );
    expect(issues).toEqual([
      { type: 'CountOutsideBounds', domain: 'characters', count: 3, lower: 0, upper: 2 },
    ]);
  });
});

describe('validateGeneratedCase — duplicates and unknown ids', () => {
  it('reports a duplicated id within an output set', () => {
    const snapshot = makeSnapshot({
      minDocuments: 2,
      maxDocuments: 0,
      documents: [doc('invoice', { required: true, weight: 100 }), doc('passport', { weight: 10 })],
    });
    const result = generateCase(snapshot, 'dup');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const issues = validateGeneratedCase(
      snapshot,
      defect(result.case, { documents: [genDoc('invoice'), genDoc('invoice')] }),
    );
    expect(issues).toEqual([
      { type: 'DuplicateEntityId', domain: 'documents', entityId: 'invoice' },
    ]);
  });

  it('reports an output id that is not in the snapshot pool', () => {
    const snapshot = makeSnapshot({
      minItems: 2,
      maxItems: 0,
      items: [item('phone', { required: true, weight: 100 }), item('wallet', { weight: 100 })],
    });
    const result = generateCase(snapshot, 'ghost');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const issues = validateGeneratedCase(
      snapshot,
      defect(result.case, {
        items: [genItem('phone', 1), genItem('ghost', 1)],
      }),
    );
    expect(issues).toEqual([{ type: 'UnknownEntityId', domain: 'items', entityId: 'ghost' }]);
  });
});

describe('validateGeneratedCase — item quantities', () => {
  it('reports a quantity above the effective maximum', () => {
    const snapshot = makeSnapshot({
      minItems: 1,
      maxItems: 1,
      items: [item('phone', { required: true, minQuantity: 1, maxQuantity: 1 })],
    });
    const result = generateCase(snapshot, 'qtyhi');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const issues = validateGeneratedCase(
      snapshot,
      defect(result.case, { items: [genItem('phone', 2)] }),
    );
    expect(issues).toEqual([
      { type: 'QuantityOutsideBounds', itemId: 'phone', quantity: 2, min: 1, max: 1 },
    ]);
  });

  it('reports a quantity below the effective minimum (effective min is at least 1)', () => {
    const snapshot = makeSnapshot({
      minItems: 1,
      maxItems: 1,
      items: [item('phone', { required: true, minQuantity: 0, maxQuantity: 0 })],
    });
    const result = generateCase(snapshot, 'qtylo');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const issues = validateGeneratedCase(
      snapshot,
      defect(result.case, { items: [genItem('phone', 0)] }),
    );
    expect(issues).toEqual([
      { type: 'QuantityOutsideBounds', itemId: 'phone', quantity: 0, min: 1, max: 1 },
    ]);
  });

  it('reports a snapshot row with invalid quantity bounds', () => {
    const empty: CaseTemplateSnapshot = {
      caseTemplateId: 'case-empty',
      templateVersion: VERSION,
      type: null,
      difficulty: null,
      minCharacters: 0,
      maxCharacters: 0,
      minItems: 0,
      maxItems: 0,
      minDocuments: 0,
      maxDocuments: 0,
      minEvidence: 0,
      maxEvidence: 0,
      characters: [],
      items: [item('x', { minQuantity: 2, maxQuantity: 1 })],
      documents: [],
      evidence: [],
    };
    const handBuilt: GeneratedCase = {
      caseTemplateId: 'case-empty',
      templateVersion: VERSION,
      pipelineAlgorithmVersion: 1,
      seed: 's',
      characters: [],
      items: [genItem('x', 1)],
      documents: [],
      evidence: [],
      metadata: {
        derivedSeeds: { characters: '', items: '', documents: '', evidence: '' },
        poolSizes: { characters: 0, items: 1, documents: 0, evidence: 0 },
        selectedCounts: { characters: 0, items: 1, documents: 0, evidence: 0 },
      },
    };
    const issues = validateGeneratedCase(empty, handBuilt);
    expect(issues).toEqual([
      { type: 'InvalidQuantityBounds', itemId: 'x', minQuantity: 2, maxQuantity: 1 },
    ]);
  });
});

describe('validateGeneratedCase — identity and version', () => {
  it('reports each mismatched identity field individually', () => {
    const snapshot = makeSnapshot();
    const result = generateCase(snapshot, 'id');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const cases: Array<{ patch: Partial<GeneratedCase>; field: string }> = [
      { patch: { caseTemplateId: 'other-case' }, field: 'caseTemplateId' },
      { patch: { templateVersion: 7 }, field: 'templateVersion' },
      { patch: { pipelineAlgorithmVersion: 2 }, field: 'pipelineAlgorithmVersion' },
      { patch: { seed: 42 as unknown as string }, field: 'seed' },
    ];
    for (const { patch, field } of cases) {
      const issues = validateGeneratedCase(snapshot, defect(result.case, patch));
      expect(issues).toEqual([{ type: 'MismatchedIdentity', field: field as 'seed' }]);
    }
  });
});

describe('validateGeneratedCase — verify-only (never repairs or mutates)', () => {
  it('leaves a deep-frozen snapshot and generated case untouched, valid case returns []', () => {
    const snapshot = deepFreeze(makeSnapshot());
    const result = generateCase(snapshot, 'frozen');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const frozenCase = deepFreeze(result.case);
    const before = JSON.stringify(frozenCase);
    expect(validateGeneratedCase(snapshot, frozenCase)).toEqual([]);
    expect(JSON.stringify(frozenCase)).toBe(before);
  });

  it('reports issues for a deep-frozen defective case without mutating it', () => {
    const snapshot = makeSnapshot();
    const result = generateCase(snapshot, 'frozen-defect');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const defective = deepFreeze(
      defect(result.case, { characters: [selChar('bob'), selChar('carol')] }),
    );
    const before = JSON.stringify(defective);
    const issues = validateGeneratedCase(snapshot, defective);
    expect(issues).toEqual([
      { type: 'MissingRequiredEntity', domain: 'characters', entityId: 'alice' },
    ]);
    expect(JSON.stringify(defective)).toBe(before);
  });
});

function deepFreeze<T>(obj: T): T {
  if (obj && typeof obj === 'object') {
    for (const key of Object.keys(obj)) {
      deepFreeze((obj as Record<string, unknown>)[key]);
    }
    Object.freeze(obj);
  }
  return obj;
}
