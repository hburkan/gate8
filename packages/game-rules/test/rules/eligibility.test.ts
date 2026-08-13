import { describe, expect, it } from 'vitest';
import { buildGenerationContext, type GenerationContextData } from '../../src/rules/context.js';
import { evaluateEligibility } from '../../src/rules/evaluate.js';
import { parseRulePayload } from '../../src/rules/parse.js';
import {
  selectCharacters,
  type CharacterSelectionCandidate,
  type CharacterSelectionInput,
} from '../../src/generation/selection.js';
import {
  selectDocuments,
  type DocumentSelectionCandidate,
  type DocumentSelectionInput,
} from '../../src/generation/document-selection.js';
import {
  selectEvidence,
  type EvidenceSelectionCandidate,
  type EvidenceSelectionInput,
} from '../../src/generation/evidence-selection.js';
import {
  selectItems,
  type ItemSelectionCandidate,
  type ItemSelectionInput,
} from '../../src/generation/item-selection.js';

const VERSION = 1;

const baseGen: GenerationContextData = {
  difficulty: 'hard',
  type: 'murder',
  characters: [{ id: 'c1', role: 'businessman', occupation: 'importer' }],
  items: [{ id: 'i1', name: 'phone' }],
  documents: [{ id: 'd1', role: 'real' }],
  evidence: [{ id: 'e1', name: 'imei_mismatch', role: 'critical', importance: 'high' }],
};

const hasPhone = () => [{ op: 'hasItem', ref: 'phone' }];

describe('eligibility filter wiring (§15.3) — conditions narrow the pool', () => {
  it('characters: a condition-gated required row is filtered out when its condition fails', () => {
    const pool: CharacterSelectionCandidate[] = [
      {
        characterId: 'gated',
        required: true,
        weight: 100,
        priority: 0,
        conditions: hasPhone(),
        version: VERSION,
        role: null,
      },
      {
        characterId: 'b',
        required: false,
        weight: 1,
        priority: 1,
        conditions: [],
        version: VERSION,
        role: null,
      },
      {
        characterId: 'c',
        required: false,
        weight: 1,
        priority: 2,
        conditions: [],
        version: VERSION,
        role: null,
      },
      {
        characterId: 'd',
        required: false,
        weight: 1,
        priority: 3,
        conditions: [],
        version: VERSION,
        role: null,
      },
    ];

    const withPhone = selectCharacters({
      caseTemplateId: 'case-1',
      templateVersion: VERSION,
      minCharacters: 3,
      maxCharacters: 4,
      characters: pool,
      seed: 'elig-1',
      eligibilityFilter: (c) =>
        evaluateEligibility(parseRulePayload(c.conditions), buildGenerationContext(baseGen)),
    });
    expect(withPhone.ok).toBe(true);
    if (withPhone.ok) {
      expect(withPhone.characters.map((c) => c.characterId)).toContain('gated');
    }

    const withoutPhone = selectCharacters({
      caseTemplateId: 'case-1',
      templateVersion: VERSION,
      minCharacters: 3,
      maxCharacters: 4,
      characters: pool,
      seed: 'elig-1',
      eligibilityFilter: (c) =>
        evaluateEligibility(
          parseRulePayload(c.conditions),
          buildGenerationContext({ ...baseGen, items: [] }),
        ),
    });
    expect(withoutPhone.ok).toBe(true);
    if (withoutPhone.ok) {
      expect(withoutPhone.characters.map((c) => c.characterId)).not.toContain('gated');
    }
  });

  it('items: conditions narrow the item pool', () => {
    const pool: ItemSelectionCandidate[] = [
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
      },
      {
        itemId: 'handgun',
        required: false,
        weight: 50,
        minQuantity: 1,
        maxQuantity: 1,
        hidden: false,
        discoveryMethod: null,
        priority: 1,
        conditions: hasPhone(),
        version: VERSION,
      },
      {
        itemId: 'watch',
        required: false,
        weight: 10,
        minQuantity: 1,
        maxQuantity: 1,
        hidden: false,
        discoveryMethod: null,
        priority: 2,
        conditions: [],
        version: VERSION,
      },
    ];
    const input: ItemSelectionInput = {
      caseTemplateId: 'case-1',
      templateVersion: VERSION,
      minItems: 2,
      maxItems: 2,
      items: pool,
      seed: 'elig-2',
      eligibilityFilter: (i) =>
        evaluateEligibility(parseRulePayload(i.conditions), buildGenerationContext(baseGen)),
    };
    const result = selectItems(input);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.items.map((i) => i.itemId)).not.toContain('handgun');
    }
  });

  it('documents: worked example 2 — invoice gated on a settled businessman', () => {
    const pool: DocumentSelectionCandidate[] = [
      {
        documentId: 'invoice',
        required: true,
        weight: 100,
        role: 'real',
        hidden: false,
        discoveryMethod: null,
        priority: 0,
        conditions: [{ op: 'equals', path: 'character.role', value: 'businessman' }],
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
    ];
    const input: DocumentSelectionInput = {
      caseTemplateId: 'case-1',
      templateVersion: VERSION,
      minDocuments: 1,
      maxDocuments: 2,
      documents: pool,
      seed: 'elig-3',
      eligibilityFilter: (d) =>
        evaluateEligibility(parseRulePayload(d.conditions), buildGenerationContext(baseGen)),
    };
    const result = selectDocuments(input);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.documents.map((d) => d.documentId)).toContain('invoice');
    }
  });

  it('evidence: conditions resolve via an external conditions map (evidence candidates carry none)', () => {
    const conditionsByEvidenceId = new Map<string, unknown[]>([['note', hasPhone()]]);
    const pool: EvidenceSelectionCandidate[] = [
      {
        evidenceId: 'fingerprint',
        role: 'required',
        weight: 100,
        importance: 'high',
        discoveryMethod: null,
        priority: 0,
        version: VERSION,
      },
      {
        evidenceId: 'note',
        role: 'optional',
        weight: 50,
        importance: 'medium',
        discoveryMethod: null,
        priority: 1,
        version: VERSION,
      },
      {
        evidenceId: 'cctv',
        role: 'decoy',
        weight: 10,
        importance: 'medium',
        discoveryMethod: null,
        priority: 2,
        version: VERSION,
      },
    ];
    const input: EvidenceSelectionInput = {
      caseTemplateId: 'case-1',
      templateVersion: VERSION,
      minEvidence: 2,
      maxEvidence: 2,
      evidence: pool,
      seed: 'elig-4',
      eligibilityFilter: (e) =>
        evaluateEligibility(
          parseRulePayload(conditionsByEvidenceId.get(e.evidenceId) ?? []),
          buildGenerationContext({ ...baseGen, items: [] }),
        ),
    };
    const result = selectEvidence(input);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.evidence.map((e) => e.evidenceId)).not.toContain('note');
    }
  });
});

describe('zero-PRNG proof (§17) — the filter changes pool membership only', () => {
  it('a fixed eligible pool with a filter yields the same output as the identical pool without a filter', () => {
    const gated: CharacterSelectionCandidate[] = [
      {
        characterId: 'gated',
        required: false,
        weight: 50,
        priority: 0,
        conditions: hasPhone(),
        version: VERSION,
        role: null,
      },
      {
        characterId: 'a',
        required: false,
        weight: 1,
        priority: 1,
        conditions: [],
        version: VERSION,
        role: null,
      },
      {
        characterId: 'b',
        required: false,
        weight: 1,
        priority: 2,
        conditions: [],
        version: VERSION,
        role: null,
      },
      {
        characterId: 'c',
        required: false,
        weight: 1,
        priority: 3,
        conditions: [],
        version: VERSION,
        role: null,
      },
    ];
    const eligible = gated.filter((c) => c.characterId !== 'gated');

    const withFilter = selectCharacters({
      caseTemplateId: 'case-1',
      templateVersion: VERSION,
      minCharacters: 2,
      maxCharacters: 3,
      characters: gated,
      seed: 'zero-prng',
      eligibilityFilter: (c) =>
        evaluateEligibility(
          parseRulePayload(c.conditions),
          buildGenerationContext({ ...baseGen, items: [] }),
        ),
    });
    const withoutFilter = selectCharacters({
      caseTemplateId: 'case-1',
      templateVersion: VERSION,
      minCharacters: 2,
      maxCharacters: 3,
      characters: eligible,
      seed: 'zero-prng',
    });

    expect(withFilter).toEqual(withoutFilter);
    expect(withFilter.ok).toBe(true);
  });

  it('holds across seeds for all four generators', () => {
    for (let s = 0; s < 40; s++) {
      const seed = `zero-${s}`;
      const gen = buildGenerationContext({ ...baseGen, items: [] });

      const charsPool: CharacterSelectionCandidate[] = [
        {
          characterId: 'gated',
          required: false,
          weight: 50,
          priority: 0,
          conditions: hasPhone(),
          version: VERSION,
          role: null,
        },
        {
          characterId: 'a',
          required: false,
          weight: 1,
          priority: 1,
          conditions: [],
          version: VERSION,
          role: null,
        },
        {
          characterId: 'b',
          required: false,
          weight: 1,
          priority: 2,
          conditions: [],
          version: VERSION,
          role: null,
        },
      ];
      const charsInput: CharacterSelectionInput = {
        caseTemplateId: 'case-1',
        templateVersion: VERSION,
        minCharacters: 1,
        maxCharacters: 2,
        characters: charsPool,
        seed,
      };
      expect(
        selectCharacters({
          ...charsInput,
          eligibilityFilter: (c) => evaluateEligibility(parseRulePayload(c.conditions), gen),
        }),
      ).toEqual(
        selectCharacters({
          ...charsInput,
          characters: charsPool.filter((c) => c.characterId !== 'gated'),
        }),
      );

      const itemsPool: ItemSelectionCandidate[] = [
        {
          itemId: 'gated',
          required: false,
          weight: 50,
          minQuantity: 1,
          maxQuantity: 1,
          hidden: false,
          discoveryMethod: null,
          priority: 0,
          conditions: hasPhone(),
          version: VERSION,
        },
        {
          itemId: 'a',
          required: false,
          weight: 1,
          minQuantity: 1,
          maxQuantity: 1,
          hidden: false,
          discoveryMethod: null,
          priority: 1,
          conditions: [],
          version: VERSION,
        },
        {
          itemId: 'b',
          required: false,
          weight: 1,
          minQuantity: 1,
          maxQuantity: 1,
          hidden: false,
          discoveryMethod: null,
          priority: 2,
          conditions: [],
          version: VERSION,
        },
      ];
      const itemsInput: ItemSelectionInput = {
        caseTemplateId: 'case-1',
        templateVersion: VERSION,
        minItems: 1,
        maxItems: 2,
        items: itemsPool,
        seed,
      };
      expect(
        selectItems({
          ...itemsInput,
          eligibilityFilter: (i) => evaluateEligibility(parseRulePayload(i.conditions), gen),
        }),
      ).toEqual(
        selectItems({ ...itemsInput, items: itemsPool.filter((i) => i.itemId !== 'gated') }),
      );

      const docsPool: DocumentSelectionCandidate[] = [
        {
          documentId: 'gated',
          required: false,
          weight: 50,
          role: null,
          hidden: false,
          discoveryMethod: null,
          priority: 0,
          conditions: hasPhone(),
          version: VERSION,
        },
        {
          documentId: 'a',
          required: false,
          weight: 1,
          role: null,
          hidden: false,
          discoveryMethod: null,
          priority: 1,
          conditions: [],
          version: VERSION,
        },
        {
          documentId: 'b',
          required: false,
          weight: 1,
          role: null,
          hidden: false,
          discoveryMethod: null,
          priority: 2,
          conditions: [],
          version: VERSION,
        },
      ];
      const docsInput: DocumentSelectionInput = {
        caseTemplateId: 'case-1',
        templateVersion: VERSION,
        minDocuments: 1,
        maxDocuments: 2,
        documents: docsPool,
        seed,
      };
      expect(
        selectDocuments({
          ...docsInput,
          eligibilityFilter: (d) => evaluateEligibility(parseRulePayload(d.conditions), gen),
        }),
      ).toEqual(
        selectDocuments({
          ...docsInput,
          documents: docsPool.filter((d) => d.documentId !== 'gated'),
        }),
      );

      const conditionsByEvidenceId = new Map<string, unknown[]>([['note', hasPhone()]]);
      const evPool: EvidenceSelectionCandidate[] = [
        {
          evidenceId: 'note',
          role: 'optional',
          weight: 50,
          importance: 'medium',
          discoveryMethod: null,
          priority: 0,
          version: VERSION,
        },
        {
          evidenceId: 'a',
          role: 'optional',
          weight: 1,
          importance: 'medium',
          discoveryMethod: null,
          priority: 1,
          version: VERSION,
        },
        {
          evidenceId: 'b',
          role: 'optional',
          weight: 1,
          importance: 'medium',
          discoveryMethod: null,
          priority: 2,
          version: VERSION,
        },
      ];
      const evInput: EvidenceSelectionInput = {
        caseTemplateId: 'case-1',
        templateVersion: VERSION,
        minEvidence: 1,
        maxEvidence: 2,
        evidence: evPool,
        seed,
      };
      expect(
        selectEvidence({
          ...evInput,
          eligibilityFilter: (e) =>
            evaluateEligibility(
              parseRulePayload(conditionsByEvidenceId.get(e.evidenceId) ?? []),
              gen,
            ),
        }),
      ).toEqual(
        selectEvidence({ ...evInput, evidence: evPool.filter((e) => e.evidenceId !== 'note') }),
      );
    }
  });
});

describe('unsatisfiable required conditions (§17) — deterministic failure, no retry', () => {
  it('a required row filtered out shrinks the pool; no fallback, deterministic error', () => {
    const pool: CharacterSelectionCandidate[] = [
      {
        characterId: 'gated',
        required: true,
        weight: 100,
        priority: 0,
        conditions: hasPhone(),
        version: VERSION,
        role: null,
      },
      {
        characterId: 'a',
        required: false,
        weight: 1,
        priority: 1,
        conditions: [],
        version: VERSION,
        role: null,
      },
      {
        characterId: 'b',
        required: false,
        weight: 1,
        priority: 2,
        conditions: [],
        version: VERSION,
        role: null,
      },
    ];
    const input: CharacterSelectionInput = {
      caseTemplateId: 'case-1',
      templateVersion: VERSION,
      minCharacters: 3,
      maxCharacters: 3,
      characters: pool,
      seed: 'fail-1',
      eligibilityFilter: (c) =>
        evaluateEligibility(
          parseRulePayload(c.conditions),
          buildGenerationContext({ ...baseGen, items: [] }),
        ),
    };
    const a = selectCharacters(input);
    const b = selectCharacters(input);
    expect(a).toEqual(b);
    expect(a.ok).toBe(false);
    if (!a.ok) {
      expect(a.error.type).toBe('PoolBelowMinimum');
    }
  });

  it('an entirely ineligible pool yields NoEligible*', () => {
    const pool: CharacterSelectionCandidate[] = [
      {
        characterId: 'gated',
        required: true,
        weight: 100,
        priority: 0,
        conditions: hasPhone(),
        version: VERSION,
        role: null,
      },
    ];
    const input: CharacterSelectionInput = {
      caseTemplateId: 'case-1',
      templateVersion: VERSION,
      minCharacters: 1,
      maxCharacters: 1,
      characters: pool,
      seed: 'fail-2',
      eligibilityFilter: (c) =>
        evaluateEligibility(
          parseRulePayload(c.conditions),
          buildGenerationContext({ ...baseGen, items: [] }),
        ),
    };
    const result = selectCharacters(input);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.type).toBe('NoEligibleCharacters');
    }
  });
});
