import { describe, expect, it } from 'vitest';
import {
  selectDocuments,
  type DocumentSelectionCandidate,
} from '../../src/generation/document-selection.js';

/**
 * Property-style invariant tests. Rather than pull in a large dependency,
 * templates are generated deterministically from an independent LCG so the
 * run is reproducible and adds no new package (mirrors invariants.test.ts
 * and item-invariants.test.ts).
 */

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function makeTemplate(t: number): { input: Parameters<typeof selectDocuments>[0] } {
  const rnd = lcg(1000003 * (t + 1));
  const poolSize = 1 + Math.floor(rnd() * 6);
  const documents: DocumentSelectionCandidate[] = [];
  for (let i = 0; i < poolSize; i++) {
    documents.push({
      documentId: `d-${t}-${i}`,
      required: rnd() < 0.35,
      weight: Math.floor(rnd() * 6),
      role: rnd() < 0.4 ? 'real' : rnd() < 0.6 ? 'fake' : rnd() < 0.8 ? 'decoy' : null,
      hidden: rnd() < 0.5,
      discoveryMethod: rnd() < 0.4 ? 'search' : null,
      priority: Math.floor(rnd() * 4),
      conditions: [],
      version: 1,
    });
  }
  const minDocuments = Math.floor(rnd() * (poolSize + 1));
  const maxDocuments = Math.floor(rnd() * (poolSize + 1));
  return {
    input: {
      caseTemplateId: `case-${t}`,
      templateVersion: 1,
      minDocuments,
      maxDocuments,
      documents,
      seed: `template-${t}`,
    },
  };
}

const SAMPLES = 300;
const SEEDS = 20;

describe('property invariants', () => {
  for (let t = 0; t < SAMPLES; t++) {
    const { input } = makeTemplate(t);
    const requiredIds = input.documents.filter((d) => d.required).map((d) => d.documentId);
    const requiredCount = requiredIds.length;
    const optionalPositive = input.documents.filter((d) => !d.required && d.weight > 0).length;
    const lower = Math.max(input.minDocuments, requiredCount);
    const effectiveUpper =
      input.maxDocuments > 0
        ? Math.min(input.maxDocuments, input.documents.length)
        : input.documents.length;
    const fillable = requiredCount + optionalPositive;
    const guaranteedOk =
      input.documents.length >= input.minDocuments &&
      (input.maxDocuments === 0 || requiredCount <= input.maxDocuments) &&
      lower <= effectiveUpper &&
      fillable >= effectiveUpper;

    if (!guaranteedOk) continue;

    it(`template ${t}: invariants hold across seeds`, () => {
      const previous = new Set<string>();
      for (let s = 0; s < SEEDS; s++) {
        const result = selectDocuments({ ...input, seed: `t${t}-s${s}` });
        expect(result.ok).toBe(true);
        if (!result.ok) continue;

        const ids = result.documents.map((d) => d.documentId);

        expect(result.documents.length).toBeGreaterThanOrEqual(input.minDocuments);
        expect(result.documents.length).toBeLessThanOrEqual(effectiveUpper);
        expect(result.documents.length).toBeLessThanOrEqual(input.documents.length);
        for (const id of requiredIds) {
          expect(ids).toContain(id);
        }
        expect(new Set(ids).size).toBe(ids.length);

        for (const g of result.documents) {
          const src = input.documents.find((d) => d.documentId === g.documentId);
          expect(src).toBeDefined();
          if (!src) continue;
          expect(g.role).toBe(src.role);
          expect(g.hidden).toBe(src.hidden);
          expect(g.discoveryMethod).toBe(src.discoveryMethod);
          expect(g).not.toHaveProperty('quantity');
        }

        previous.add(JSON.stringify(result.documents));
      }
      expect(previous.size).toBeGreaterThan(0);
    });
  }
});
