import { describe, expect, it } from 'vitest';
import type { Rule } from '../../src/rules/ast.js';
import {
  buildGenerationContext,
  buildRuntimeContext,
  type GenerationContextData,
  type RuntimeContextData,
} from '../../src/rules/context.js';
import { evaluateRule, evaluateRules } from '../../src/rules/evaluate.js';
import { parseRulePayload } from '../../src/rules/parse.js';

/**
 * Property-style invariant tests for the rule engine. Templates, rules, and
 * seeds are generated deterministically from an independent LCG so the run is
 * reproducible and adds no new package (same pattern as the Phase 6-10
 * generator invariants).
 */

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function pick<T>(rnd: () => number, items: readonly T[]): T {
  return items[Math.floor(rnd() * items.length)]!;
}

function randomRule(rnd: () => number, depth: number): Rule {
  const op = pick(rnd, [
    'and',
    'or',
    'not',
    'equals',
    'greaterThan',
    'lessThan',
    'contains',
    'hasItem',
    'hasEvidence',
    'characterRole',
    'locationType',
    'difficulty',
    'previousDecision',
  ] as const);
  switch (op) {
    case 'and':
    case 'or': {
      const n = 1 + Math.floor(rnd() * 3);
      const rules: Rule[] = [];
      for (let i = 0; i < n; i++) {
        rules.push(depth > 0 ? randomRule(rnd, depth - 1) : { op: 'difficulty', value: 'hard' });
      }
      return { op, rules };
    }
    case 'not':
      return {
        op: 'not',
        rule: depth > 0 ? randomRule(rnd, depth - 1) : { op: 'difficulty', value: 'hard' },
      };
    case 'equals':
      return {
        op,
        path: pick(rnd, ['case.difficulty', 'character.role', 'item.name']),
        value: pick(rnd, ['hard', 'businessman', 'phone']),
      };
    case 'greaterThan':
      return { op, path: 'case.difficulty', value: pick(rnd, [1, 2, 3]) };
    case 'lessThan':
      return { op, path: 'case.difficulty', value: pick(rnd, [1, 2, 3]) };
    case 'contains':
      return {
        op,
        path: pick(rnd, ['character.role', 'item.name']),
        value: pick(rnd, ['businessman', 'phone', 'x']),
      };
    case 'hasItem':
      return { op, ref: pick(rnd, ['phone', 'wallet', 'absent']) };
    case 'hasEvidence':
      return { op, ref: pick(rnd, ['imei_mismatch', 'invoice', 'absent']) };
    case 'characterRole':
    case 'locationType':
    case 'difficulty':
    case 'previousDecision':
      return { op, value: pick(rnd, ['businessman', 'office', 'hard', 'd0-123']) };
  }
}

const generationData: GenerationContextData = {
  difficulty: 'hard',
  type: 'murder',
  characters: [{ id: 'c1', role: 'businessman', occupation: 'importer' }],
  items: [{ id: 'i1', name: 'phone' }],
  documents: [{ id: 'd1', role: 'real' }],
  evidence: [{ id: 'e1', name: 'imei_mismatch', role: 'critical', importance: 'high' }],
};

const runtimeData: RuntimeContextData = {
  difficulty: 'hard',
  type: 'murder',
  flags: { fake_invoice: true },
  previousDecision: 'd0-123',
  activeCharacter: { id: 'c1', role: 'businessman' },
  location: { id: 'l1', type: 'office' },
  inventory: [{ id: 'i1', name: 'phone' }],
  discoveredEvidence: [{ id: 'e1', name: 'imei_mismatch' }],
};

const SAMPLES = 300;

describe('rule engine property invariants', () => {
  it('evaluateRule never throws and returns a boolean for any generated rule', () => {
    const gen = buildGenerationContext(generationData);
    const run = buildRuntimeContext(runtimeData);
    for (let i = 0; i < SAMPLES; i++) {
      const rule = randomRule(lcg(5009 * (i + 1)), 3);
      const g = evaluateRule(rule, gen);
      const r = evaluateRule(rule, run);
      expect(typeof g).toBe('boolean');
      expect(typeof r).toBe('boolean');
    }
  });

  it('evaluateRule is deterministic: same rule + same context ⇒ same result', () => {
    const gen = buildGenerationContext(generationData);
    for (let i = 0; i < SAMPLES; i++) {
      const rule = randomRule(lcg(5011 * (i + 1)), 3);
      expect(evaluateRule(rule, gen)).toBe(evaluateRule(rule, gen));
    }
  });

  it('parseRulePayload is idempotent on already-normalized arrays', () => {
    const rnd = lcg(1013);
    for (let i = 0; i < 50; i++) {
      const rule = randomRule(rnd, 3);
      const once = parseRulePayload(rule);
      const twice = parseRulePayload(once);
      expect(twice).toEqual(once);
    }
  });

  it('evaluateRules agrees with evaluateRule over a one-element payload', () => {
    const gen = buildGenerationContext(generationData);
    const run = buildRuntimeContext(runtimeData);
    for (let i = 0; i < SAMPLES; i++) {
      const rule = randomRule(lcg(1019 * (i + 1)), 3);
      expect(evaluateRules([rule], gen)).toBe(evaluateRule(rule, gen));
      expect(evaluateRules([rule], run)).toBe(evaluateRule(rule, run));
    }
  });

  it('not(evaluateRule(r)) === evaluateRule(not(r))', () => {
    const gen = buildGenerationContext(generationData);
    const run = buildRuntimeContext(runtimeData);
    for (let i = 0; i < SAMPLES; i++) {
      const rule = randomRule(lcg(1021 * (i + 1)), 3);
      const negated: Rule = { op: 'not', rule };
      expect(evaluateRule(negated, gen)).toBe(!evaluateRule(rule, gen));
      expect(evaluateRule(negated, run)).toBe(!evaluateRule(rule, run));
    }
  });

  it('evaluateRules conjoins: adding a false rule makes the conjunction false', () => {
    const gen = buildGenerationContext(generationData);
    for (let i = 0; i < SAMPLES; i++) {
      const rule = randomRule(lcg(1031 * (i + 1)), 2);
      const base = evaluateRules([rule], gen);
      const withFalse = evaluateRules([rule, { op: 'not', rule }], gen);
      expect(withFalse).toBe(false);
      void base;
    }
  });

  it('and is stronger than or over the same children', () => {
    const run = buildRuntimeContext(runtimeData);
    for (let i = 0; i < SAMPLES; i++) {
      const r1 = randomRule(lcg(1033 * (i + 1)), 2);
      const r2 = randomRule(lcg(1033 * (i + 1) + 7), 2);
      const and: Rule = { op: 'and', rules: [r1, r2] };
      const or: Rule = { op: 'or', rules: [r1, r2] };
      const a = evaluateRule(and, run);
      const o = evaluateRule(or, run);
      expect(a === true && o === false).toBe(false);
    }
  });

  it('empty payloads evaluate true (§14 backward compatibility)', () => {
    const gen = buildGenerationContext(generationData);
    expect(evaluateRules(parseRulePayload([]), gen)).toBe(true);
    expect(evaluateRules(parseRulePayload({}), gen)).toBe(true);
    expect(evaluateRules(parseRulePayload(null), gen)).toBe(true);
  });

  it('evaluateRule is side-effect free across repeated evaluation', () => {
    const gen = buildGenerationContext(generationData);
    const before = JSON.stringify(gen);
    const run = buildRuntimeContext(runtimeData);
    const beforeRun = JSON.stringify(run);
    for (let i = 0; i < 100; i++) {
      const rule = randomRule(lcg(1049 * (i + 1)), 3);
      evaluateRule(rule, gen);
      evaluateRule(rule, run);
    }
    expect(JSON.stringify(gen)).toBe(before);
    expect(JSON.stringify(run)).toBe(beforeRun);
  });
});
