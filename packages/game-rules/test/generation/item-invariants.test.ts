import { describe, expect, it } from 'vitest';
import { selectItems, type ItemSelectionCandidate } from '../../src/generation/item-selection.js';

/**
 * Property-style invariant tests. Rather than pull in a large dependency,
 * templates are generated deterministically from an independent LCG so the
 * run is reproducible and adds no new package (mirrors invariants.test.ts).
 */

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function makeTemplate(t: number): { input: Parameters<typeof selectItems>[0] } {
  const rnd = lcg(1000003 * (t + 1));
  const poolSize = 1 + Math.floor(rnd() * 6);
  const items: ItemSelectionCandidate[] = [];
  for (let i = 0; i < poolSize; i++) {
    const maxQuantity = Math.floor(rnd() * 6);
    const minQuantity = maxQuantity > 0 ? Math.floor(rnd() * (maxQuantity + 1)) : 0;
    items.push({
      itemId: `i-${t}-${i}`,
      required: rnd() < 0.35,
      weight: Math.floor(rnd() * 6),
      minQuantity,
      maxQuantity,
      hidden: rnd() < 0.5,
      discoveryMethod: rnd() < 0.4 ? 'search' : null,
      priority: Math.floor(rnd() * 4),
      conditions: [],
      version: 1,
    });
  }
  const minItems = Math.floor(rnd() * (poolSize + 1));
  const maxItems = Math.floor(rnd() * (poolSize + 1));
  return {
    input: {
      caseTemplateId: `case-${t}`,
      templateVersion: 1,
      minItems,
      maxItems,
      items,
      seed: `template-${t}`,
    },
  };
}

const SAMPLES = 300;
const SEEDS = 20;

describe('property invariants', () => {
  for (let t = 0; t < SAMPLES; t++) {
    const { input } = makeTemplate(t);
    const requiredIds = input.items.filter((i) => i.required).map((i) => i.itemId);
    const requiredCount = requiredIds.length;
    const optionalPositive = input.items.filter((i) => !i.required && i.weight > 0).length;
    const lower = Math.max(input.minItems, requiredCount);
    const effectiveUpper =
      input.maxItems > 0 ? Math.min(input.maxItems, input.items.length) : input.items.length;
    const fillable = requiredCount + optionalPositive;
    const guaranteedOk =
      input.items.length >= input.minItems &&
      (input.maxItems === 0 || requiredCount <= input.maxItems) &&
      lower <= effectiveUpper &&
      fillable >= effectiveUpper;

    if (!guaranteedOk) continue;

    it(`template ${t}: invariants hold across seeds`, () => {
      const previous = new Set<string>();
      for (let s = 0; s < SEEDS; s++) {
        const result = selectItems({ ...input, seed: `t${t}-s${s}` });
        expect(result.ok).toBe(true);
        if (!result.ok) continue;

        const ids = result.items.map((i) => i.itemId);

        expect(result.items.length).toBeGreaterThanOrEqual(input.minItems);
        expect(result.items.length).toBeLessThanOrEqual(effectiveUpper);
        expect(result.items.length).toBeLessThanOrEqual(input.items.length);
        for (const id of requiredIds) {
          expect(ids).toContain(id);
        }
        expect(new Set(ids).size).toBe(ids.length);

        for (const g of result.items) {
          const src = input.items.find((i) => i.itemId === g.itemId);
          expect(src).toBeDefined();
          if (!src) continue;
          const min = Math.max(src.minQuantity, 1);
          const max = src.maxQuantity > 0 ? src.maxQuantity : min;
          expect(g.quantity).toBeGreaterThanOrEqual(min);
          expect(g.quantity).toBeLessThanOrEqual(max);
          expect(g.hidden).toBe(src.hidden);
          expect(g.discoveryMethod).toBe(src.discoveryMethod);
        }

        previous.add(JSON.stringify(result.items));
      }
      expect(previous.size).toBeGreaterThan(0);
    });
  }
});
