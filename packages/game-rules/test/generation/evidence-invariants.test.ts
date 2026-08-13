import { describe, expect, it } from 'vitest';
import {
  selectEvidence,
  type EvidenceSelectionCandidate,
} from '../../src/generation/evidence-selection.js';

/**
 * Property-style invariant tests for evidence selection. Templates are
 * generated deterministically from an independent LCG so the run is
 * reproducible and adds no new package (mirrors invariants.test.ts,
 * item-invariants.test.ts, and document-invariants.test.ts).
 *
 * Key evidence-specific invariant: `required` is derived solely from
 * `role === 'required'`, and the stored `role`/`importance` values are
 * preserved unchanged into the output.
 */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const ROLES = ['required', 'optional', 'decoy', 'hidden'] as const;
const IMPORTANCES = ['low', 'medium', 'high', 'critical'] as const;

function makeTemplate(t: number): { input: Parameters<typeof selectEvidence>[0] } {
  const rnd = lcg(1000003 * (t + 1));
  const poolSize = 1 + Math.floor(rnd() * 6);
  const evidence: EvidenceSelectionCandidate[] = [];
  for (let i = 0; i < poolSize; i++) {
    evidence.push({
      evidenceId: `e-${t}-${i}`,
      role: ROLES[Math.floor(rnd() * ROLES.length) % ROLES.length]! ?? null,
      weight: Math.floor(rnd() * 6),
      importance: rnd() < 0.4 ? IMPORTANCES[Math.floor(rnd() * IMPORTANCES.length)]! : null,
      discoveryMethod: rnd() < 0.4 ? 'search' : rnd() < 0.6 ? 'inspect' : null,
      priority: Math.floor(rnd() * 4),
      version: 1,
    });
  }
  const minEvidence = Math.floor(rnd() * (poolSize + 1));
  const maxEvidence = Math.floor(rnd() * (poolSize + 1));
  return {
    input: {
      caseTemplateId: `case-${t}`,
      templateVersion: 1,
      minEvidence,
      maxEvidence,
      evidence,
      seed: `template-${t}`,
    },
  };
}

const SAMPLES = 300;
const SEEDS = 20;

describe('property invariants', () => {
  for (let t = 0; t < SAMPLES; t++) {
    const { input } = makeTemplate(t);
    const pooled = input.evidence.map((e) => ({ ...e }));
    const requiredIds = pooled.filter((e) => e.role === 'required').map((e) => e.evidenceId);
    const requiredCount = requiredIds.length;
    const optionalPositive = pooled.filter((e) => e.role !== 'required' && e.weight > 0).length;
    const lower = Math.max(input.minEvidence, requiredCount);
    const effectiveUpper =
      input.maxEvidence > 0 ? Math.min(input.maxEvidence, pooled.length) : pooled.length;
    const fillable = requiredCount + optionalPositive;
    const guaranteedOk =
      pooled.length >= input.minEvidence &&
      (input.maxEvidence === 0 || requiredCount <= input.maxEvidence) &&
      lower <= effectiveUpper &&
      fillable >= effectiveUpper;

    if (!guaranteedOk) continue;

    it(`template ${t}: invariants hold across seeds`, () => {
      const previous = new Set<string>();
      for (let s = 0; s < SEEDS; s++) {
        const result = selectEvidence({ ...input, seed: `t${t}-s${s}` });
        expect(result.ok).toBe(true);
        if (!result.ok) continue;

        const ids = result.evidence.map((e) => e.evidenceId);

        expect(result.evidence.length).toBeGreaterThanOrEqual(input.minEvidence);
        expect(result.evidence.length).toBeLessThanOrEqual(effectiveUpper);
        expect(result.evidence.length).toBeLessThanOrEqual(pooled.length);
        for (const id of requiredIds) {
          expect(ids).toContain(id);
        }
        expect(new Set(ids).size).toBe(ids.length);

        for (const g of result.evidence) {
          const src = pooled.find((e) => e.evidenceId === g.evidenceId);
          expect(src).toBeDefined();
          if (!src) continue;
          expect(g.role).toBe(src.role);
          expect(g.importance).toBe(src.importance);
          expect(g.discoveryMethod).toBe(src.discoveryMethod);
          expect(g).not.toHaveProperty('quantity');
          expect(g).not.toHaveProperty('required');
          expect(g).not.toHaveProperty('hidden');
        }

        previous.add(JSON.stringify(result.evidence));
      }
      expect(previous.size).toBeGreaterThan(0);
    });
  }
});
