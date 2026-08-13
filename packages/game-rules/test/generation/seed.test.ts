import { describe, expect, it } from 'vitest';
import { deriveDomainSeed } from '../../src/generation/pipeline.js';
import {
  SEED_BYTES,
  deriveRetrySeed,
  isValidSeed,
  seedFromEntropy,
} from '../../src/generation/seed.js';

/**
 * Seed lifecycle contract tests (Phase 13).
 *
 * The canonical seed is exactly 32 lowercase hex characters (128 bits). Seed
 * creation is pure (entropy is supplied by the caller, never sourced inside
 * game-rules); the format is validated at creation/storage boundaries only —
 * `generateCase` itself stays permissive so existing arbitrary test seeds
 * keep working.
 */

const ZEROS = '00000000000000000000000000000000';

describe('seedFromEntropy — formatting', () => {
  it('pins a golden seed for 16 known bytes (fixed-width hex, zero-padded)', () => {
    const result = seedFromEntropy(
      new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]),
    );
    expect(result).toEqual({ ok: true, seed: '000102030405060708090a0b0c0d0e0f' });
  });

  it('preserves leading zero bytes — 16 zero bytes renders 32 zeros, not a short string', () => {
    expect(seedFromEntropy(new Uint8Array(SEED_BYTES))).toEqual({ ok: true, seed: ZEROS });
  });

  it('always produces a 32-char lowercase hex seed of length 2 * SEED_BYTES', () => {
    const bytes = new Uint8Array(SEED_BYTES).fill(0xab);
    const result = seedFromEntropy(bytes);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.seed).toBe('abababababababababababababababab');
      expect(result.seed).toMatch(/^[0-9a-f]{32}$/);
    }
  });

  it('is a pure function of its bytes: identical inputs yield identical seeds', () => {
    const bytes = new Uint8Array(SEED_BYTES).fill(0x0f);
    expect(seedFromEntropy(bytes)).toEqual(seedFromEntropy(bytes));
  });

  it('copies its input — mutating the source bytes afterwards never changes the returned seed', () => {
    const bytes = new Uint8Array(SEED_BYTES).fill(0x11);
    const before = seedFromEntropy(bytes);
    bytes.fill(0x22);
    const after = seedFromEntropy(bytes);
    expect(before).toEqual({ ok: true, seed: '11111111111111111111111111111111' });
    expect(after).toEqual({ ok: true, seed: '22222222222222222222222222222222' });
  });
});

describe('seedFromEntropy — entropy-length validation', () => {
  it('rejects a byte length other than 16 with a typed error carrying expected/actual', () => {
    expect(seedFromEntropy(new Uint8Array(15))).toEqual({
      ok: false,
      error: { type: 'InvalidEntropyLength', expected: SEED_BYTES, actual: 15 },
    });
    expect(seedFromEntropy(new Uint8Array(17))).toEqual({
      ok: false,
      error: { type: 'InvalidEntropyLength', expected: SEED_BYTES, actual: 17 },
    });
    expect(seedFromEntropy(new Uint8Array(0))).toEqual({
      ok: false,
      error: { type: 'InvalidEntropyLength', expected: SEED_BYTES, actual: 0 },
    });
  });
});

describe('isValidSeed — canonical format validation (creation/storage boundary)', () => {
  it('accepts a canonical 32-char lowercase hex seed', () => {
    expect(isValidSeed(ZEROS)).toBe(true);
    expect(isValidSeed('0123456789abcdef0123456789abcdef')).toBe(true);
  });

  it('rejects an empty seed', () => {
    expect(isValidSeed('')).toBe(false);
  });

  it('rejects a wrong-length seed', () => {
    expect(isValidSeed('0123456789abcdef0123456789abcd')).toBe(false);
    expect(isValidSeed('0123456789abcdef0123456789abcdef0')).toBe(false);
  });

  it('rejects uppercase hex', () => {
    expect(isValidSeed('0123456789ABCDEF0123456789ABCDEF')).toBe(false);
  });

  it('rejects non-hex characters', () => {
    expect(isValidSeed('g123456789abcdef0123456789abcdef')).toBe(false);
    expect(isValidSeed('0123456789abcdef0123456789abcdeg')).toBe(false);
  });

  it('rejects non-canonical deterministic test seeds — format lives at the boundary, not in generateCase', () => {
    expect(isValidSeed('case-demo-seed-123')).toBe(false);
    expect(isValidSeed('seed-0')).toBe(false);
  });
});

describe('deriveRetrySeed — deterministic attempt-keyed retry seeds', () => {
  it('pins golden values for fixed (seed, attempt) inputs', () => {
    expect(deriveRetrySeed('case-demo-seed-123', 1)).toBe('598a51231c59ec2b448bbade015807d6');
    expect(deriveRetrySeed('another', 2)).toBe('3c957698f280d4067e363a3ab02398a4');
    expect(deriveRetrySeed('case-demo-seed-123', 3)).toBe('77dc077d26712fbb55320f1a049f27dc');
  });

  it('reuses the frozen derivation: deriveRetrySeed(seed, n) === deriveDomainSeed(seed, `retry:${n}`)', () => {
    for (const n of [1, 2, 3, 10]) {
      expect(deriveRetrySeed('case-demo-seed-123', n)).toBe(
        deriveDomainSeed('case-demo-seed-123', `retry:${n}`),
      );
    }
  });

  it('is a pure function of (seed, attempt)', () => {
    expect(deriveRetrySeed('s', 1)).toBe(deriveRetrySeed('s', 1));
    expect(deriveRetrySeed('t', 2)).toBe(deriveRetrySeed('t', 2));
  });

  it('always differs from the base seed', () => {
    for (const n of [1, 2, 3]) {
      expect(deriveRetrySeed('base', n)).not.toBe('base');
    }
  });

  it('produces distinct seeds across distinct attempts', () => {
    const seen = new Set<string>();
    for (let n = 1; n <= 5; n++) {
      seen.add(deriveRetrySeed('case-demo-seed-123', n));
    }
    expect(seen.size).toBe(5);
  });

  it('differs from every pipeline domain-derived seed for the same base seed (no namespace collision)', () => {
    const base = 'case-demo-seed-123';
    const domains = ['characters', 'items', 'documents', 'evidence'] as const;
    const retry = deriveRetrySeed(base, 1);
    for (const domain of domains) {
      expect(retry).not.toBe(deriveDomainSeed(base, domain));
    }
  });
});
