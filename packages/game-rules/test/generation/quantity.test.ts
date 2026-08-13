import { describe, expect, it } from 'vitest';
import { drawQuantity, effectiveQuantityBounds } from '../../src/generation/quantity.js';
import { createSeededRandom, type SeededRandom } from '../../src/generation/prng.js';

function fixedRng(values: number[]): SeededRandom {
  let i = 0;
  return {
    float: () => values[i++] ?? 0,
    int: (bound: number) => Math.floor((values[i++] ?? 0) * bound),
  };
}

describe('effectiveQuantityBounds', () => {
  it('treats unset (0, 0) as a single copy', () => {
    expect(effectiveQuantityBounds(0, 0)).toEqual({ effectiveMin: 1, effectiveMax: 1 });
  });

  it('floors a zero minimum at 1 when a maximum is given', () => {
    expect(effectiveQuantityBounds(0, 3)).toEqual({ effectiveMin: 1, effectiveMax: 3 });
  });

  it('keeps a full bounded range', () => {
    expect(effectiveQuantityBounds(2, 5)).toEqual({ effectiveMin: 2, effectiveMax: 5 });
  });

  it('returns a fixed range when min === max', () => {
    expect(effectiveQuantityBounds(2, 2)).toEqual({ effectiveMin: 2, effectiveMax: 2 });
  });

  it('resolves a zero maximum to the effective minimum', () => {
    expect(effectiveQuantityBounds(2, 0)).toEqual({ effectiveMin: 2, effectiveMax: 2 });
  });

  it('rejects min_quantity > max_quantity when bounded', () => {
    expect(effectiveQuantityBounds(5, 2)).toBeNull();
  });

  it('rejects negative bounds', () => {
    expect(effectiveQuantityBounds(-1, 3)).toBeNull();
    expect(effectiveQuantityBounds(2, -1)).toBeNull();
  });
});

describe('drawQuantity', () => {
  it('never draws zero — a selected item always has at least one copy', () => {
    for (let s = 0; s < 200; s++) {
      const rng = createSeededRandom(`q${s}`);
      expect(drawQuantity(rng, { effectiveMin: 1, effectiveMax: 1 })).toBe(1);
    }
  });

  it('stays within the effective bounds across seeds', () => {
    for (let s = 0; s < 200; s++) {
      const rng = createSeededRandom(`q${s}`);
      const q = drawQuantity(rng, { effectiveMin: 2, effectiveMax: 5 });
      expect(q).toBeGreaterThanOrEqual(2);
      expect(q).toBeLessThanOrEqual(5);
    }
  });

  it('draws the exact value for a fixed range', () => {
    expect(drawQuantity(fixedRng([0.5]), { effectiveMin: 3, effectiveMax: 3 })).toBe(3);
  });

  it('maps the uniform float to the inclusive range deterministically', () => {
    expect(drawQuantity(fixedRng([0]), { effectiveMin: 2, effectiveMax: 5 })).toBe(2);
    expect(drawQuantity(fixedRng([1 - 1e-9]), { effectiveMin: 2, effectiveMax: 5 })).toBe(5);
  });

  it('is deterministic for the same seed', () => {
    const a = drawQuantity(createSeededRandom('repeat'), { effectiveMin: 1, effectiveMax: 4 });
    const b = drawQuantity(createSeededRandom('repeat'), { effectiveMin: 1, effectiveMax: 4 });
    expect(a).toBe(b);
  });
});
