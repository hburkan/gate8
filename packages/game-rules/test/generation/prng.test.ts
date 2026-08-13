import { describe, expect, it } from 'vitest';
import { createSeededRandom, cyrb128, mulberry32 } from '../../src/generation/prng.js';

describe('cyrb128', () => {
  it('produces the reference 128-bit hash for a known seed', () => {
    expect(cyrb128('case-demo-seed-123')).toEqual([2776025507, 3253032138, 233420223, 1769613526]);
  });

  it('is deterministic for the same seed', () => {
    expect(cyrb128('same-seed')).toEqual(cyrb128('same-seed'));
  });

  it('produces different hashes for different seeds', () => {
    expect(cyrb128('seed-a')).not.toEqual(cyrb128('seed-b'));
  });
});

describe('mulberry32', () => {
  it('reproduces the reference float sequence for a known state', () => {
    const next = mulberry32(cyrb128('case-demo-seed-123')[0]!);
    const expected = [
      0.38519544899463654, 0.636725089745596, 0.9447284841444343, 0.06003344850614667,
      0.8046919875778258, 0.8011910514906049, 0.39289957704022527, 0.839164282893762,
    ];
    for (const value of expected) {
      expect(next()).toBeCloseTo(value, 15);
    }
  });

  it('returns values in the [0, 1) range', () => {
    const next = mulberry32(42);
    for (let i = 0; i < 1000; i++) {
      const v = next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('createSeededRandom', () => {
  it('is deterministic for the same seed', () => {
    const a = createSeededRandom('alpha');
    const b = createSeededRandom('alpha');
    for (let i = 0; i < 50; i++) {
      expect(a.float()).toBeCloseTo(b.float(), 15);
      expect(a.int(7)).toBe(b.int(7));
    }
  });

  it('produces different streams for different seeds', () => {
    const a = createSeededRandom('alpha');
    const b = createSeededRandom('beta');
    const seqA = [a.float(), a.float(), a.float(), a.float()];
    const seqB = [b.float(), b.float(), b.float(), b.float()];
    expect(seqA).not.toEqual(seqB);
  });

  it('int(bound) returns integers in [0, bound)', () => {
    const rng = createSeededRandom('bounds');
    for (let i = 0; i < 2000; i++) {
      const v = rng.int(5);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(5);
    }
  });
});
