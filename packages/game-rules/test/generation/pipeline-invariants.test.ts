import { describe, expect, it } from 'vitest';
import type { DocumentSelectionCandidate } from '../../src/generation/document-types.js';
import { selectDocuments } from '../../src/generation/document-selection.js';
import type { EvidenceSelectionCandidate } from '../../src/generation/evidence-types.js';
import { selectEvidence } from '../../src/generation/evidence-selection.js';
import type { ItemSelectionCandidate } from '../../src/generation/item-types.js';
import { selectItems } from '../../src/generation/item-selection.js';
import type { CharacterSelectionCandidate } from '../../src/generation/types.js';
import { selectCharacters } from '../../src/generation/selection.js';
import {
  deriveDomainSeed,
  generateCase,
  type CaseTemplateSnapshot,
  type CharacterPoolRow,
  type DocumentPoolRow,
  type EvidencePoolRow,
  type GeneratedCase,
  type ItemPoolRow,
  type PipelineDomain,
} from '../../src/generation/pipeline.js';

/**
 * Property-style invariants for the seeded generation pipeline (Phase 12).
 *
 * Templates come from an independent LCG so the run is reproducible and
 * adds no new dependency (mirrors the Phase 6–10 invariants tests). All
 * rows carry empty conditions, so eligibility is constant — this isolates
 * the pipeline's composition/seed behavior from rule evaluation.
 */

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const VERSION = 1;
const SAMPLES = 100;
const SEEDS = 10;

/** Type-safe id extraction from a generated set for a domain. */
function idsOf(domain: PipelineDomain, generated: GeneratedCase): string[] {
  switch (domain) {
    case 'characters':
      return generated.characters.map((c) => c.characterId);
    case 'items':
      return generated.items.map((i) => i.itemId);
    case 'documents':
      return generated.documents.map((d) => d.documentId);
    case 'evidence':
      return generated.evidence.map((e) => e.evidenceId);
  }
}

/** All-positive weights ⇒ optional fills always possible (guaranteed ok). */
function makeRandomSnapshot(t: number): {
  snapshot: CaseTemplateSnapshot;
  effectiveUpper: Record<PipelineDomain, number>;
} {
  const rnd = lcg(1000003 * (t + 1));

  const charCount = 1 + Math.floor(rnd() * 6);
  const requiredChars = Math.floor(rnd() * (charCount + 1));
  const minCharacters = Math.floor(rnd() * (charCount + 1));
  const maxCharacters0 = Math.floor(rnd() * (charCount + 1));
  const maxCharacters = Math.max(maxCharacters0, minCharacters, requiredChars);
  const characters: CharacterPoolRow[] = [];
  for (let i = 0; i < charCount; i++) {
    characters.push({
      characterId: `c-${t}-${i}`,
      required: i < requiredChars,
      weight: 1 + Math.floor(rnd() * 5),
      priority: Math.floor(rnd() * 4),
      conditions: [],
      version: VERSION,
      role: i % 3 === 0 ? 'businessman' : i % 3 === 1 ? 'clerk' : null,
      occupation: null,
    });
  }

  const itemCount = 1 + Math.floor(rnd() * 6);
  const requiredItems = Math.floor(rnd() * (itemCount + 1));
  const minItems = Math.floor(rnd() * (itemCount + 1));
  const maxItems0 = Math.floor(rnd() * (itemCount + 1));
  const maxItems = Math.max(maxItems0, minItems, requiredItems);
  const items: ItemPoolRow[] = [];
  for (let i = 0; i < itemCount; i++) {
    items.push({
      itemId: `i-${t}-${i}`,
      required: i < requiredItems,
      weight: 1 + Math.floor(rnd() * 5),
      minQuantity: 1,
      maxQuantity: 1,
      hidden: false,
      discoveryMethod: null,
      priority: Math.floor(rnd() * 4),
      conditions: [],
      version: VERSION,
      name: `item-${i}`,
    });
  }

  const docCount = 1 + Math.floor(rnd() * 6);
  const requiredDocs = Math.floor(rnd() * (docCount + 1));
  const minDocuments = Math.floor(rnd() * (docCount + 1));
  const maxDocuments0 = Math.floor(rnd() * (docCount + 1));
  const maxDocuments = Math.max(maxDocuments0, minDocuments, requiredDocs);
  const documents: DocumentPoolRow[] = [];
  for (let i = 0; i < docCount; i++) {
    documents.push({
      documentId: `d-${t}-${i}`,
      required: i < requiredDocs,
      weight: 1 + Math.floor(rnd() * 5),
      role: ['real', 'fake', 'decoy'][i % 3] ?? 'real',
      hidden: false,
      discoveryMethod: null,
      priority: Math.floor(rnd() * 4),
      conditions: [],
      version: VERSION,
    });
  }

  const evCount = 1 + Math.floor(rnd() * 6);
  const requiredEv = Math.floor(rnd() * (evCount + 1));
  const minEvidence = Math.floor(rnd() * (evCount + 1));
  const maxEvidence0 = Math.floor(rnd() * (evCount + 1));
  const maxEvidence = Math.max(maxEvidence0, minEvidence, requiredEv);
  const evidence: EvidencePoolRow[] = [];
  for (let i = 0; i < evCount; i++) {
    evidence.push({
      evidenceId: `e-${t}-${i}`,
      role:
        i < requiredEv
          ? 'required'
          : ((['optional', 'decoy', 'hidden'] as const)[i % 3] ?? 'optional'),
      weight: 1 + Math.floor(rnd() * 5),
      importance: (['low', 'medium', 'high'] as const)[i % 3] ?? 'medium',
      discoveryMethod: null,
      priority: Math.floor(rnd() * 4),
      version: VERSION,
      name: `evidence-${i}`,
      conditions: [],
      discoveryCondition: null,
    });
  }

  return {
    snapshot: {
      caseTemplateId: `case-${t}`,
      templateVersion: VERSION,
      type: 'murder',
      difficulty: 'hard',
      minCharacters,
      maxCharacters,
      minItems,
      maxItems,
      minDocuments,
      maxDocuments,
      minEvidence,
      maxEvidence,
      characters,
      items,
      documents,
      evidence,
    },
    effectiveUpper: {
      characters: maxCharacters > 0 ? Math.min(maxCharacters, charCount) : charCount,
      items: maxItems > 0 ? Math.min(maxItems, itemCount) : itemCount,
      documents: maxDocuments > 0 ? Math.min(maxDocuments, docCount) : docCount,
      evidence: maxEvidence > 0 ? Math.min(maxEvidence, evCount) : evCount,
    },
  };
}

function lowerFor(domain: PipelineDomain, snapshot: CaseTemplateSnapshot): number {
  switch (domain) {
    case 'characters':
      return Math.max(snapshot.minCharacters, snapshot.characters.filter((c) => c.required).length);
    case 'items':
      return Math.max(snapshot.minItems, snapshot.items.filter((i) => i.required).length);
    case 'documents':
      return Math.max(snapshot.minDocuments, snapshot.documents.filter((d) => d.required).length);
    case 'evidence':
      return Math.max(
        snapshot.minEvidence,
        snapshot.evidence.filter((e) => e.role === 'required').length,
      );
  }
}

describe('pipeline property invariants', () => {
  for (let t = 0; t < SAMPLES; t++) {
    const { snapshot, effectiveUpper } = makeRandomSnapshot(t);

    it(`template ${t}: invariants hold across seeds`, () => {
      const seen = new Set<string>();
      for (let s = 0; s < SEEDS; s++) {
        const seed = `t${t}-s${s}`;
        const a = generateCase(snapshot, seed);
        expect(a.ok).toBe(true);
        if (!a.ok) continue;
        const b = generateCase(snapshot, seed);
        expect(b).toEqual(a);

        expect(a.case.pipelineAlgorithmVersion).toBe(1);
        expect(a.case.seed).toBe(seed);
        expect(a.case.caseTemplateId).toBe(snapshot.caseTemplateId);

        for (const domain of ['characters', 'items', 'documents', 'evidence'] as const) {
          const ids = idsOf(domain, a.case);
          expect(ids.length).toBeGreaterThanOrEqual(lowerFor(domain, snapshot));
          expect(ids.length).toBeLessThanOrEqual(effectiveUpper[domain]);
          expect(new Set(ids).size).toBe(ids.length);
          expect(a.case.metadata.selectedCounts[domain]).toBe(ids.length);
          expect(a.case.metadata.poolSizes[domain]).toBe(snapshot[domain].length);
          expect(a.case.metadata.derivedSeeds[domain]).toBe(deriveDomainSeed(seed, domain));
        }

        const charIds = a.case.characters.map((c) => c.characterId);
        for (const c of snapshot.characters) {
          if (c.required) expect(charIds).toContain(c.characterId);
        }
        const itemIds = a.case.items.map((i) => i.itemId);
        for (const i of snapshot.items) {
          if (i.required) expect(itemIds).toContain(i.itemId);
        }
        const docIds = a.case.documents.map((d) => d.documentId);
        for (const d of snapshot.documents) {
          if (d.required) expect(docIds).toContain(d.documentId);
        }
        const evIds = a.case.evidence.map((e) => e.evidenceId);
        for (const e of snapshot.evidence) {
          if (e.role === 'required') expect(evIds).toContain(e.evidenceId);
        }

        seen.add(JSON.stringify(a.case.characters));
        seen.add(JSON.stringify(a.case.items));
      }
      expect(seen.size).toBeGreaterThan(0);
    });

    it(`template ${t}: empty-conditions pipeline equals the four generators called directly with derived seeds`, () => {
      const seed = `direct-${t}`;
      const result = generateCase(snapshot, seed);
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const directChars = selectCharacters({
        caseTemplateId: snapshot.caseTemplateId,
        templateVersion: snapshot.templateVersion,
        minCharacters: snapshot.minCharacters,
        maxCharacters: snapshot.maxCharacters,
        characters: snapshot.characters as CharacterSelectionCandidate[],
        seed: deriveDomainSeed(seed, 'characters'),
      });
      const directItems = selectItems({
        caseTemplateId: snapshot.caseTemplateId,
        templateVersion: snapshot.templateVersion,
        minItems: snapshot.minItems,
        maxItems: snapshot.maxItems,
        items: snapshot.items as ItemSelectionCandidate[],
        seed: deriveDomainSeed(seed, 'items'),
      });
      const directDocs = selectDocuments({
        caseTemplateId: snapshot.caseTemplateId,
        templateVersion: snapshot.templateVersion,
        minDocuments: snapshot.minDocuments,
        maxDocuments: snapshot.maxDocuments,
        documents: snapshot.documents as DocumentSelectionCandidate[],
        seed: deriveDomainSeed(seed, 'documents'),
      });
      const directEv = selectEvidence({
        caseTemplateId: snapshot.caseTemplateId,
        templateVersion: snapshot.templateVersion,
        minEvidence: snapshot.minEvidence,
        maxEvidence: snapshot.maxEvidence,
        evidence: snapshot.evidence as EvidenceSelectionCandidate[],
        seed: deriveDomainSeed(seed, 'evidence'),
      });

      expect(directChars.ok).toBe(true);
      expect(directItems.ok).toBe(true);
      expect(directDocs.ok).toBe(true);
      expect(directEv.ok).toBe(true);
      if (directChars.ok) expect(result.case.characters).toEqual(directChars.characters);
      if (directItems.ok) expect(result.case.items).toEqual(directItems.items);
      if (directDocs.ok) expect(result.case.documents).toEqual(directDocs.documents);
      if (directEv.ok) expect(result.case.evidence).toEqual(directEv.evidence);
    });
  }
});
