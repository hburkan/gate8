import { deriveDomainSeed } from './pipeline.js';

/**
 * Seed lifecycle primitives (Phase 13).
 *
 * The canonical seed is a string of exactly 32 lowercase hex characters —
 * 128 bits of entropy (Decision D1). Seed CREATION is pure: entropy is
 * supplied by the caller (a platform CSPRNG at the Phase 14 call site, never
 * sourced inside game-rules). The canonical format is validated at the
 * creation/storage boundary via `isValidSeed`; `generateCase` itself stays
 * permissive so existing arbitrary deterministic test seeds keep working.
 *
 * Derivation functions here (`deriveRetrySeed`) are part of the frozen,
 * versioned deterministic contract family (D11) — do not change without
 * bumping `PIPELINE_ALGORITHM_VERSION`.
 */

/** Number of entropy bytes required for a canonical seed (128 bits). */
export const SEED_BYTES = 16;

/** A canonical seed string: 32 lowercase hex characters (128 bits). */
export type Seed = string;

/** Typed failure for seed creation (consistent with the package's union style). */
export type SeedError = { type: 'InvalidEntropyLength'; expected: number; actual: number };

export type SeedResult = { ok: true; seed: Seed } | { ok: false; error: SeedError };

const CANONICAL_SEED = /^[0-9a-f]{32}$/;

/**
 * Formats caller-supplied entropy bytes into a canonical seed.
 *
 * Pure and deterministic given the bytes: exactly `SEED_BYTES` (16) bytes are
 * required, each rendered as fixed-width (zero-padded) lowercase hex so
 * leading zero bytes are never lost. The input is copied, so the returned
 * seed never aliases (or changes with) the caller's buffer.
 */
export function seedFromEntropy(bytes: Uint8Array): SeedResult {
  if (bytes.length !== SEED_BYTES) {
    return {
      ok: false,
      error: { type: 'InvalidEntropyLength', expected: SEED_BYTES, actual: bytes.length },
    };
  }
  const copied = [...bytes];
  return {
    ok: true,
    seed: copied.map((byte) => byte.toString(16).padStart(2, '0')).join(''),
  };
}

/**
 * Canonical seed format validation (creation/storage boundary, not a pipeline
 * input check — Decision D8). Accepts exactly 32 lowercase hex characters, the
 * 128-bit canonical `Seed`. Rejects empty, wrong-length, uppercase, and
 * non-hex strings, and any non-canonical deterministic test seed.
 */
export function isValidSeed(seed: string): boolean {
  return CANONICAL_SEED.test(seed);
}

/**
 * Deterministic, attempt-keyed retry seed (Decision D3).
 *
 * `deriveRetrySeed(seed, attempt) = deriveDomainSeed(seed, 'retry:' + attempt)`
 * — reusing the frozen D1 derivation family. For distinct positive integer
 * attempts it yields distinct seeds that also differ from the base seed and
 * from every pipeline domain seed. `attempt` is the 1-based retry ordinal;
 * this is the ONLY retry state that touches the pure layer — counters and
 * limits are Phase 14 instance metadata.
 */
export function deriveRetrySeed(seed: string, attempt: number): string {
  return deriveDomainSeed(seed, `retry:${attempt}`);
}
