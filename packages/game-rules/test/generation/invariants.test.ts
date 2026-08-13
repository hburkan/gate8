import { describe, expect, it } from 'vitest';
import {
  selectCharacters,
  type CharacterSelectionCandidate,
} from '../../src/generation/selection.js';

/**
 * Property-style invariant tests. Rather than pull in a large dependency,
 * templates are generated deterministically from an independent LCG so the
 * run is reproducible and adds no new package.
 */

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function makeTemplate(t: number): { input: Parameters<typeof selectCharacters>[0] } {
  const rnd = lcg(1000003 * (t + 1));
  const poolSize = 1 + Math.floor(rnd() * 6);
  const characters: CharacterSelectionCandidate[] = [];
  for (let i = 0; i < poolSize; i++) {
    characters.push({
      characterId: `c-${t}-${i}`,
      required: rnd() < 0.35,
      weight: Math.floor(rnd() * 6),
      priority: Math.floor(rnd() * 4),
      conditions: [],
      version: 1,
      role: null,
    });
  }
  const minCharacters = Math.floor(rnd() * (poolSize + 1));
  const maxCharacters = Math.floor(rnd() * (poolSize + 1));
  return {
    input: {
      caseTemplateId: `case-${t}`,
      templateVersion: 1,
      minCharacters,
      maxCharacters,
      characters,
      seed: `template-${t}`,
    },
  };
}

const SAMPLES = 300;
const SEEDS = 20;

describe('property invariants', () => {
  for (let t = 0; t < SAMPLES; t++) {
    const { input } = makeTemplate(t);
    const requiredIds = input.characters.filter((c) => c.required).map((c) => c.characterId);
    const requiredCount = requiredIds.length;
    const optionalPositive = input.characters.filter((c) => !c.required && c.weight > 0).length;
    const lower = Math.max(input.minCharacters, requiredCount);
    const upper = input.maxCharacters > 0 ? input.maxCharacters : input.characters.length;
    const fillable = requiredCount + optionalPositive;
    const poolOk =
      input.characters.length >= input.minCharacters &&
      (input.maxCharacters === 0 || input.characters.length >= input.maxCharacters) &&
      (input.maxCharacters === 0 || requiredCount <= input.maxCharacters);
    const guaranteedOk = lower <= upper && poolOk && fillable >= upper;

    if (!guaranteedOk) continue;

    it(`template ${t}: invariants hold across seeds`, () => {
      const previous = new Set<string>();
      for (let s = 0; s < SEEDS; s++) {
        const result = selectCharacters({ ...input, seed: `t${t}-s${s}` });
        expect(result.ok).toBe(true);
        if (!result.ok) continue;

        const ids = result.characters.map((c) => c.characterId);

        expect(result.characters.length).toBeGreaterThanOrEqual(input.minCharacters);
        if (input.maxCharacters > 0) {
          expect(result.characters.length).toBeLessThanOrEqual(input.maxCharacters);
        }
        expect(result.characters.length).toBeLessThanOrEqual(input.characters.length);
        for (const id of requiredIds) {
          expect(ids).toContain(id);
        }
        expect(new Set(ids).size).toBe(ids.length);

        for (const id of ids) {
          const c = input.characters.find((x) => x.characterId === id);
          expect(c).toBeDefined();
          if (c && !c.required) {
            const hasPositiveWeightOther = input.characters.some(
              (x) => !x.required && x.characterId !== id && x.weight > 0,
            );
            if (hasPositiveWeightOther) {
              expect(c.weight).toBeGreaterThan(0);
            }
          }
        }

        previous.add(JSON.stringify(result.characters));
      }
      expect(previous.size).toBeGreaterThan(0);
    });
  }
});
