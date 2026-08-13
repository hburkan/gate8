import { describe, expect, it } from 'vitest';
import {
  characterSchema,
  documentSchema,
  evidenceSchema,
  itemSchema,
  locationSchema,
  missionSchema,
  caseSchema,
  chapterSchema,
  caseCharacterSchema,
  caseItemSchema,
  caseDocumentSchema,
  caseEvidenceSchema,
  locationCharacterSchema,
  locationItemSchema,
  locationDocumentSchema,
  locationEvidenceSchema,
  locationCaseSchema,
  chapterLocationSchema,
  chapterCaseSchema,
  dialogueNodeChoiceSchema,
  dialogueNodeSchema,
} from '../src/index.js';

const base = {
  id: '3f9ecaf3-1d4a-4d1a-8c7e-0a1b2c3d4e5f',
  status: 'published',
  version: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
} as const;

const relationBase = {
  id: base.id,
  version: 1,
  createdAt: base.createdAt,
  updatedAt: base.updatedAt,
} as const;

const nullable = (): Record<string, null> => ({
  surname: null,
  age: null,
  nationality: null,
  occupation: null,
  description: null,
  portraitAsset: null,
});

describe('content entity schemas', () => {
  it('parses a valid character', () => {
    const c = characterSchema.parse({ ...base, ...nullable(), name: 'Mehmet' });
    expect(c.name).toBe('Mehmet');
    expect(c.status).toBe('published');
  });

  it('rejects a character without a name', () => {
    expect(() => characterSchema.parse({ ...base, ...nullable(), name: '' })).toThrow();
  });

  it('parses a valid item', () => {
    const i = itemSchema.parse({
      ...base,
      name: 'Passport',
      description: null,
      category: 'documents',
      rarity: 'rare',
      value: 100,
      riskLevel: 'high',
      asset: null,
    });
    expect(i.category).toBe('documents');
  });

  it('rejects an item with an unknown category', () => {
    expect(() =>
      itemSchema.parse({
        ...base,
        name: 'x',
        description: null,
        category: 'banana',
        rarity: 'common',
        value: 0,
        riskLevel: 'none',
        asset: null,
      }),
    ).toThrow();
  });

  it('parses a valid document', () => {
    const d = documentSchema.parse({
      ...base,
      title: 'Invoice',
      type: 'invoice',
      description: null,
      asset: null,
    });
    expect(d.type).toBe('invoice');
  });

  it('parses a valid evidence', () => {
    const e = evidenceSchema.parse({
      ...base,
      name: 'Dashboard camera',
      description: null,
      type: 'digital',
      importance: 'high',
    });
    expect(e.importance).toBe('high');
  });

  it('parses a valid location with parentId', () => {
    const l = locationSchema.parse({
      ...base,
      name: 'Istanbul Airport',
      type: 'airport',
      description: null,
      parentId: null,
      asset: null,
    });
    expect(l.parentId).toBeNull();
  });

  it('parses a valid mission', () => {
    const m = missionSchema.parse({
      ...base,
      title: 'Find the smuggled goods',
      description: null,
      objective: null,
      reward: {},
      completionCondition: {},
    });
    expect(m.title).toBe('Find the smuggled goods');
  });

  it('parses a valid dialogue node and choice', () => {
    const n = dialogueNodeSchema.parse({
      id: '3f9ecaf3-1d4a-4d1a-8c7e-0a1b2c3d4e5f',
      definitionId: '3f9ecaf3-1d4a-4d1a-8c7e-0a1b2c3d4e5f',
      nodeType: 'dialogue',
      speakerCharacterId: null,
      text: 'Welcome.',
      conditions: [],
      actions: [],
      nextNodeId: null,
      orderIndex: 0,
    });
    const ch = dialogueNodeChoiceSchema.parse({
      id: '3f9ecaf3-1d4a-4d1a-8c7e-0a1b2c3d4e5f',
      nodeId: '3f9ecaf3-1d4a-4d1a-8c7e-0a1b2c3d4e5f',
      text: 'Hello.',
      conditions: [],
      actions: [],
      nextNodeId: null,
      orderIndex: 0,
    });
    expect(n.nodeType).toBe('dialogue');
    expect(ch.text).toBe('Hello.');
  });

  it('parses a valid case template with bounds config', () => {
    const c = caseSchema.parse({
      ...base,
      title: 'Suspicious Suitcase',
      description: null,
      type: 'smuggling',
      difficulty: 'medium',
      minCharacters: 2,
      maxCharacters: 4,
      minItems: 3,
      maxItems: 7,
      minDocuments: 1,
      maxDocuments: 4,
      minEvidence: 1,
      maxEvidence: 3,
    });
    expect(c.title).toBe('Suspicious Suitcase');
    expect(c.type).toBe('smuggling');
    expect(c.difficulty).toBe('medium');
    expect(c.minCharacters).toBe(2);
    expect(c.maxEvidence).toBe(3);
  });

  it('parses a case template with zero bounds (no bound)', () => {
    const c = caseSchema.parse({
      ...base,
      title: 'Minimal',
      description: null,
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
    });
    expect(c.maxCharacters).toBe(0);
  });

  it('rejects a case template with a negative min/max bound', () => {
    expect(() =>
      caseSchema.parse({
        ...base,
        title: 'Bad',
        description: null,
        type: null,
        difficulty: null,
        minCharacters: -1,
        maxCharacters: 4,
        minItems: 0,
        maxItems: 0,
        minDocuments: 0,
        maxDocuments: 0,
        minEvidence: 0,
        maxEvidence: 0,
      }),
    ).toThrow();
  });

  it('rejects a case template without a title', () => {
    expect(() =>
      caseSchema.parse({
        ...base,
        title: '',
        description: null,
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
      }),
    ).toThrow();
  });

  it('parses a valid case_character relation', () => {
    const r = caseCharacterSchema.parse({
      ...relationBase,
      caseId: base.id,
      characterId: base.id,
      required: true,
      weight: 1,
      minItems: 1,
      maxItems: 3,
      role: 'perpetrator',
      priority: 0,
      conditions: [],
    });
    expect(r.required).toBe(true);
    expect(r.role).toBe('perpetrator');
  });

  it('rejects a case_character relation with negative weight', () => {
    expect(() =>
      caseCharacterSchema.parse({
        ...relationBase,
        caseId: base.id,
        characterId: base.id,
        required: false,
        weight: -1,
        minItems: 0,
        maxItems: 0,
        role: null,
        priority: 0,
        conditions: [],
      }),
    ).toThrow();
  });

  it('parses valid case_item and case_document relations', () => {
    const ci = caseItemSchema.parse({
      ...relationBase,
      caseId: base.id,
      itemId: base.id,
      required: true,
      weight: 1,
      minQuantity: 1,
      maxQuantity: 2,
      hidden: false,
      discoveryMethod: null,
      conditions: [],
      priority: 0,
    });
    const cd = caseDocumentSchema.parse({
      ...relationBase,
      caseId: base.id,
      documentId: base.id,
      required: false,
      weight: 1,
      role: 'decoy',
      hidden: true,
      discoveryMethod: 'inspect',
      conditions: [],
      priority: 0,
    });
    expect(ci.maxQuantity).toBe(2);
    expect(cd.role).toBe('decoy');
  });

  it('parses a valid case_evidence relation with importance override', () => {
    const ce = caseEvidenceSchema.parse({
      ...relationBase,
      caseId: base.id,
      evidenceId: base.id,
      role: 'required',
      weight: 1,
      importance: 'critical',
      discoveryMethod: null,
      discoveryCondition: null,
      conditions: [],
      priority: 0,
    });
    expect(ce.importance).toBe('critical');
  });

  it('parses valid location relations including location_cases', () => {
    const lc = locationCharacterSchema.parse({
      ...relationBase,
      locationId: base.id,
      characterId: base.id,
      availability: true,
      weight: 1,
      spawnProbability: 0.8,
      minQuantity: 1,
      maxQuantity: 1,
      role: null,
      priority: 0,
      sortOrder: 0,
      conditions: [],
    });
    const li = locationItemSchema.parse({
      ...relationBase,
      locationId: base.id,
      itemId: base.id,
      availability: true,
      weight: 1,
      spawnProbability: 0.5,
      minQuantity: 0,
      maxQuantity: 0,
      hidden: false,
      discoveryMethod: null,
      priority: 0,
      sortOrder: 0,
      conditions: [],
    });
    const ld = locationDocumentSchema.parse({
      ...relationBase,
      locationId: base.id,
      documentId: base.id,
      availability: true,
      weight: 1,
      spawnProbability: 0.5,
      role: null,
      hidden: false,
      discoveryMethod: null,
      priority: 0,
      sortOrder: 0,
      conditions: [],
    });
    const le = locationEvidenceSchema.parse({
      ...relationBase,
      locationId: base.id,
      evidenceId: base.id,
      availability: true,
      weight: 1,
      spawnProbability: 0.3,
      role: null,
      importance: null,
      discoveryMethod: null,
      discoveryCondition: null,
      priority: 0,
      sortOrder: 0,
      conditions: [],
    });
    const lcase = locationCaseSchema.parse({
      ...relationBase,
      locationId: base.id,
      caseId: base.id,
      availability: true,
      weight: 1,
      spawnProbability: 1,
      priority: 0,
      sortOrder: 0,
      conditions: [],
    });
    expect(lc.spawnProbability).toBe(0.8);
    expect(li.hidden).toBe(false);
    expect(ld.spawnProbability).toBe(0.5);
    expect(le.importance).toBeNull();
    expect(lcase.caseId).toBe(base.id);
  });

  it('rejects a location relation with out-of-range spawn probability', () => {
    expect(() =>
      locationCharacterSchema.parse({
        ...relationBase,
        locationId: base.id,
        characterId: base.id,
        availability: true,
        weight: 1,
        spawnProbability: 1.5,
        minQuantity: 0,
        maxQuantity: 0,
        role: null,
        priority: 0,
        sortOrder: 0,
        conditions: [],
      }),
    ).toThrow();
  });

  it('parses a valid chapter', () => {
    const c = chapterSchema.parse({
      ...base,
      title: 'Chapter 1',
      description: null,
      sortOrder: 1,
    });
    expect(c.title).toBe('Chapter 1');
    expect(c.sortOrder).toBe(1);
  });

  it('rejects a chapter without a title', () => {
    expect(() =>
      chapterSchema.parse({ ...base, title: '', description: null, sortOrder: 0 }),
    ).toThrow();
  });

  it('rejects a chapter with negative sort order', () => {
    expect(() =>
      chapterSchema.parse({ ...base, title: 'Chapter 1', description: null, sortOrder: -1 }),
    ).toThrow();
  });

  it('parses valid chapter location and case relations', () => {
    const cl = chapterLocationSchema.parse({
      ...relationBase,
      chapterId: base.id,
      locationId: base.id,
      sortOrder: 1,
    });
    const cc = chapterCaseSchema.parse({
      ...relationBase,
      chapterId: base.id,
      caseId: base.id,
      sortOrder: 2,
    });
    expect(cl.locationId).toBe(base.id);
    expect(cc.sortOrder).toBe(2);
  });
});
