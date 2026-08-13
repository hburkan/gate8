import { describe, expect, it } from 'vitest';
import {
  ruleSchema,
  rulePayloadSchema,
  completionConditionSchema,
  discoveryConditionSchema,
} from '../src/index.js';

const equals = { op: 'equals', path: 'x', value: 1 };
const and = { op: 'and', rules: [{ op: 'hasItem', ref: 'abc' }] };
const not = { op: 'not', rule: { op: 'locationType', value: 'shop' } };

describe('ruleSchema (Phase 11 mirror of the Rule union)', () => {
  it('accepts every operator shape', () => {
    const ops = [
      equals,
      { op: 'greaterThan', path: 'x', value: 1 },
      { op: 'lessThan', path: 'x', value: 10 },
      { op: 'contains', path: 'name', value: 'abc' },
      { op: 'hasItem', ref: 'abc' },
      { op: 'hasEvidence', ref: 'abc' },
      { op: 'characterRole', value: 'trader' },
      { op: 'locationType', value: 'shop' },
      { op: 'difficulty', value: 'medium' },
      { op: 'previousDecision', value: 'fine' },
    ];
    for (const r of ops) {
      expect(ruleSchema.safeParse(r).success).toBe(true);
    }
  });

  it('rejects unknown operators', () => {
    expect(ruleSchema.safeParse({ op: 'eqauls', path: 'x', value: 1 }).success).toBe(false);
  });

  it('rejects unknown keys', () => {
    expect(ruleSchema.safeParse({ ...equals, extra: true }).success).toBe(false);
  });

  it('rejects a comparison missing its value', () => {
    expect(ruleSchema.safeParse({ op: 'equals', path: 'x' }).success).toBe(false);
  });

  it('accepts recursively nested group rules', () => {
    expect(ruleSchema.safeParse(and).success).toBe(true);
    expect(ruleSchema.safeParse(not).success).toBe(true);
    expect(ruleSchema.safeParse({ op: 'and', rules: [and, not, equals] }).success).toBe(true);
  });

  it('rejects empty group rules', () => {
    expect(ruleSchema.safeParse({ op: 'and', rules: [] }).success).toBe(false);
  });
});

describe('rulePayloadSchema (relations + dialogue)', () => {
  it('accepts a single rule object', () => {
    expect(rulePayloadSchema.safeParse(equals).success).toBe(true);
  });

  it('accepts an array of rules (implicit AND)', () => {
    expect(rulePayloadSchema.safeParse([equals, and]).success).toBe(true);
  });

  it('accepts the empty-array default', () => {
    expect(rulePayloadSchema.safeParse([]).success).toBe(true);
  });

  it('rejects an unknown rule inside an array', () => {
    expect(rulePayloadSchema.safeParse([{ op: 'bogus' }]).success).toBe(false);
  });
});

describe('completionConditionSchema (mission default {})', () => {
  it('accepts the empty-object default', () => {
    expect(completionConditionSchema.safeParse({}).success).toBe(true);
  });

  it('accepts both carrier forms', () => {
    expect(completionConditionSchema.safeParse(equals).success).toBe(true);
    expect(completionConditionSchema.safeParse([equals]).success).toBe(true);
  });

  it('rejects a non-empty unknown object', () => {
    expect(completionConditionSchema.safeParse({ nonsense: true }).success).toBe(false);
  });
});

describe('discoveryConditionSchema (nullable, class B)', () => {
  it('accepts null (always discoverable)', () => {
    expect(discoveryConditionSchema.safeParse(null).success).toBe(true);
  });

  it('accepts a single rule', () => {
    expect(discoveryConditionSchema.safeParse(equals).success).toBe(true);
  });
});
