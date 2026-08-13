/**
 * Deterministic seeded PRNG utilities.
 *
 * The algorithm and draw sequence are part of the generator contract:
 * `cyrb128` (string seed -> 128-bit state) seeds `mulberry32` (float [0,1)
 * generator). Changing either changes all generated output, so regression
 * tests pin the exact reference values.
 */

/** 128-bit seed state as four unsigned 32-bit integers. */
export type Cyrb128State = [number, number, number, number];

/**
 * cyrb128 string hashing — derives a deterministic 128-bit state from an
 * arbitrary string seed. Reference implementation by bryc.
 */
export function cyrb128(str: string): Cyrb128State {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  return [(h1 ^ h2 ^ h3 ^ h4) >>> 0, (h2 ^ h1) >>> 0, (h3 ^ h1) >>> 0, (h4 ^ h1) >>> 0];
}

/**
 * mulberry32 — deterministic float generator seeded by a single uint32.
 * Returns the next float in [0, 1) on each call. Reference by bryc.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stateful seeded random source bound to a single string seed. */
export interface SeededRandom {
  /** Next float in [0, 1). */
  float(): number;
  /** Next integer in [0, bound). */
  int(bound: number): number;
}

/**
 * Creates a deterministic random source from a string seed. Identical seeds
 * produce identical streams; the cyrb128 -> mulberry32 pairing and the
 * float/int draw order are part of the generator contract.
 */
export function createSeededRandom(seed: string): SeededRandom {
  const next = mulberry32(cyrb128(seed)[0]!);
  return {
    float: () => next(),
    int: (bound: number) => Math.floor(next() * bound),
  };
}
