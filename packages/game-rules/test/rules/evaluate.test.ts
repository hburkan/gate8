import { describe, expect, it } from 'vitest';
import type { Rule } from '../../src/rules/ast.js';
import {
  buildGenerationContext,
  buildRuntimeContext,
  type GenerationContextData,
  type RuntimeContextData,
} from '../../src/rules/context.js';
import {
  evaluateAvailability,
  evaluateDiscovery,
  evaluateEligibility,
  evaluateRule,
  evaluateRules,
  evaluateRuntime,
} from '../../src/rules/evaluate.js';

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

const gen = buildGenerationContext(generationData);
const run = buildRuntimeContext(runtimeData);

describe('evaluateRule — logical operators', () => {
  it('and: true iff all children true', () => {
    const r: Rule = {
      op: 'and',
      rules: [
        { op: 'difficulty', value: 'hard' },
        { op: 'difficulty', value: 'hard' },
      ],
    };
    expect(evaluateRule(r, gen)).toBe(true);
    const r2: Rule = {
      op: 'and',
      rules: [
        { op: 'difficulty', value: 'hard' },
        { op: 'difficulty', value: 'easy' },
      ],
    };
    expect(evaluateRule(r2, gen)).toBe(false);
  });

  it('or: true iff any child true', () => {
    const r: Rule = {
      op: 'or',
      rules: [
        { op: 'difficulty', value: 'easy' },
        { op: 'difficulty', value: 'hard' },
      ],
    };
    expect(evaluateRule(r, gen)).toBe(true);
    const r2: Rule = {
      op: 'or',
      rules: [
        { op: 'difficulty', value: 'easy' },
        { op: 'difficulty', value: 'medium' },
      ],
    };
    expect(evaluateRule(r2, gen)).toBe(false);
  });

  it('not: negates its child', () => {
    const r: Rule = { op: 'not', rule: { op: 'difficulty', value: 'hard' } };
    expect(evaluateRule(r, gen)).toBe(false);
    const r2: Rule = { op: 'not', rule: { op: 'difficulty', value: 'easy' } };
    expect(evaluateRule(r2, gen)).toBe(true);
  });

  it('nests and/or/not arbitrarily', () => {
    const r: Rule = {
      op: 'and',
      rules: [
        {
          op: 'or',
          rules: [
            { op: 'difficulty', value: 'easy' },
            { op: 'not', rule: { op: 'difficulty', value: 'easy' } },
          ],
        },
        { op: 'equals', path: 'case.type', value: 'murder' },
      ],
    };
    expect(evaluateRule(r, gen)).toBe(true);
  });
});

describe('evaluateRule — comparison operators', () => {
  it('equals: strict equality on a scalar path', () => {
    expect(evaluateRule({ op: 'equals', path: 'case.difficulty', value: 'hard' }, gen)).toBe(true);
    expect(evaluateRule({ op: 'equals', path: 'case.difficulty', value: 'easy' }, gen)).toBe(false);
    expect(evaluateRule({ op: 'equals', path: 'case.type', value: 'murder' }, gen)).toBe(true);
  });

  it('equals: collection paths resolve by existence (§12.1)', () => {
    expect(evaluateRule({ op: 'equals', path: 'character.role', value: 'businessman' }, gen)).toBe(
      true,
    );
    expect(evaluateRule({ op: 'equals', path: 'character.role', value: 'lawyer' }, gen)).toBe(
      false,
    );
    expect(evaluateRule({ op: 'equals', path: 'item.name', value: 'phone' }, gen)).toBe(true);
  });

  it('equals: missing path ⇒ false', () => {
    expect(evaluateRule({ op: 'equals', path: 'never_set', value: true }, run)).toBe(false);
    expect(
      evaluateRule(
        { op: 'equals', path: 'case.difficulty', value: 'hard' },
        buildRuntimeContext({ ...runtimeData, difficulty: null }),
      ),
    ).toBe(false);
  });

  it('greaterThan: numeric comparison', () => {
    expect(
      evaluateRule({ op: 'greaterThan', path: 'evidence.importanceCount', value: 2 }, run),
    ).toBe(false);
  });

  it('greaterThan/lessThan: numeric strings accepted for value', () => {
    const data: RuntimeContextData = { ...runtimeData, flags: { score: '7', small: '2' } };
    const ctx = buildRuntimeContext(data);
    expect(evaluateRule({ op: 'greaterThan', path: 'score', value: '5' }, ctx)).toBe(true);
    expect(evaluateRule({ op: 'greaterThan', path: 'score', value: 5 }, ctx)).toBe(true);
    expect(evaluateRule({ op: 'lessThan', path: 'small', value: 5 }, ctx)).toBe(true);
    expect(evaluateRule({ op: 'lessThan', path: 'score', value: 5 }, ctx)).toBe(false);
  });

  it('greaterThan/lessThan: type mismatch and missing ⇒ false', () => {
    const ctx = buildRuntimeContext({ ...runtimeData, flags: { str: 'abc', bool: true } });
    expect(evaluateRule({ op: 'greaterThan', path: 'str', value: 1 }, ctx)).toBe(false);
    expect(evaluateRule({ op: 'greaterThan', path: 'bool', value: 0 }, ctx)).toBe(false);
    expect(evaluateRule({ op: 'greaterThan', path: 'missing', value: 1 }, ctx)).toBe(false);
    expect(evaluateRule({ op: 'lessThan', path: 'missing', value: 1 }, ctx)).toBe(false);
  });

  it('contains: string substring', () => {
    const ctx = buildRuntimeContext({
      ...runtimeData,
      flags: { note: 'the fake invoice was found' },
    });
    expect(evaluateRule({ op: 'contains', path: 'note', value: 'invoice' }, ctx)).toBe(true);
    expect(evaluateRule({ op: 'contains', path: 'note', value: 'luggage' }, ctx)).toBe(false);
  });

  it('contains: array membership', () => {
    const ctx = buildRuntimeContext({ ...runtimeData, flags: { tags: ['a', 'b', 'c'] } });
    expect(evaluateRule({ op: 'contains', path: 'tags', value: 'b' }, ctx)).toBe(true);
    expect(evaluateRule({ op: 'contains', path: 'tags', value: 'z' }, ctx)).toBe(false);
  });

  it('contains: missing and type mismatch ⇒ false', () => {
    const ctx = buildRuntimeContext({ ...runtimeData, flags: { n: 5 } });
    expect(evaluateRule({ op: 'contains', path: 'n', value: '5' }, ctx)).toBe(false);
    expect(evaluateRule({ op: 'contains', path: 'missing', value: 'x' }, ctx)).toBe(false);
  });
});

describe('evaluateRule — hasItem / hasEvidence', () => {
  it('generation: resolves against settled sets', () => {
    expect(evaluateRule({ op: 'hasItem', ref: 'phone' }, gen)).toBe(true);
    expect(evaluateRule({ op: 'hasItem', ref: 'i1' }, gen)).toBe(true);
    expect(evaluateRule({ op: 'hasItem', ref: 'wallet' }, gen)).toBe(false);
    expect(evaluateRule({ op: 'hasEvidence', ref: 'imei_mismatch' }, gen)).toBe(true);
    expect(evaluateRule({ op: 'hasEvidence', ref: 'e1' }, gen)).toBe(true);
    expect(evaluateRule({ op: 'hasEvidence', ref: 'invoice' }, gen)).toBe(false);
  });

  it('runtime: player inventory and discovered evidence', () => {
    expect(evaluateRule({ op: 'hasItem', ref: 'phone' }, run)).toBe(true);
    expect(evaluateRule({ op: 'hasItem', ref: 'wallet' }, run)).toBe(false);
    expect(evaluateRule({ op: 'hasEvidence', ref: 'imei_mismatch' }, run)).toBe(true);
    expect(evaluateRule({ op: 'hasEvidence', ref: 'invoice' }, run)).toBe(false);
  });
});

describe('evaluateRule — context operators', () => {
  it('characterRole: generation resolves by existence; runtime resolves active character', () => {
    expect(evaluateRule({ op: 'characterRole', value: 'businessman' }, gen)).toBe(true);
    expect(evaluateRule({ op: 'characterRole', value: 'doctor' }, gen)).toBe(false);
    expect(evaluateRule({ op: 'characterRole', value: 'businessman' }, run)).toBe(true);
    const inactiveRun = buildRuntimeContext({ ...runtimeData, activeCharacter: null });
    expect(evaluateRule({ op: 'characterRole', value: 'businessman' }, inactiveRun)).toBe(false);
  });

  it('locationType: case-level generation ⇒ false; runtime uses current location', () => {
    expect(evaluateRule({ op: 'locationType', value: 'office' }, gen)).toBe(false);
    expect(evaluateRule({ op: 'locationType', value: 'office' }, run)).toBe(true);
    expect(evaluateRule({ op: 'locationType', value: 'harbor' }, run)).toBe(false);
  });

  it('difficulty: compares cases.difficulty / instance template difficulty', () => {
    expect(evaluateRule({ op: 'difficulty', value: 'hard' }, gen)).toBe(true);
    expect(evaluateRule({ op: 'difficulty', value: 'easy' }, gen)).toBe(false);
    expect(evaluateRule({ op: 'difficulty', value: 'hard' }, run)).toBe(true);
    const nullDiff = buildGenerationContext({ ...generationData, difficulty: null });
    expect(evaluateRule({ op: 'difficulty', value: 'hard' }, nullDiff)).toBe(false);
  });

  it('previousDecision: not usable at generation ⇒ false; runtime uses last decision', () => {
    expect(evaluateRule({ op: 'previousDecision', value: 'd0-123' }, gen)).toBe(false);
    expect(evaluateRule({ op: 'previousDecision', value: 'd0-123' }, run)).toBe(true);
    expect(evaluateRule({ op: 'previousDecision', value: 'other' }, run)).toBe(false);
    const noDecision = buildRuntimeContext({ ...runtimeData, previousDecision: null });
    expect(evaluateRule({ op: 'previousDecision', value: 'd0-123' }, noDecision)).toBe(false);
  });
});

describe('evaluateRules — implicit AND over a payload array', () => {
  it('returns true for an empty array (§14: [] ⇒ true)', () => {
    expect(evaluateRules([], gen)).toBe(true);
  });

  it('conjoins all rules', () => {
    const rules: Rule[] = [
      { op: 'hasItem', ref: 'phone' },
      { op: 'characterRole', value: 'businessman' },
    ];
    expect(evaluateRules(rules, gen)).toBe(true);
    expect(evaluateRules([...rules, { op: 'hasEvidence', ref: 'invoice' }], gen)).toBe(false);
  });
});

describe('entry points — §13/§15.2 class separation', () => {
  it('evaluateEligibility (A): implicit AND over relation conditions', () => {
    const conditions: Rule[] = [{ op: 'hasItem', ref: 'phone' }];
    expect(evaluateEligibility(conditions, gen)).toBe(true);
    expect(evaluateEligibility([], gen)).toBe(true);
    expect(evaluateEligibility([{ op: 'hasItem', ref: 'wallet' }], gen)).toBe(false);
  });

  it('evaluateDiscovery (B): a single discovery condition', () => {
    const condition: Rule = { op: 'equals', path: 'fake_invoice', value: true };
    expect(evaluateDiscovery(condition, run)).toBe(true);
    expect(evaluateDiscovery({ op: 'equals', path: 'fake_invoice', value: false }, run)).toBe(
      false,
    );
  });

  it('evaluateAvailability (C): static flag ANDed with runtime conditions', () => {
    const conditions: Rule[] = [{ op: 'equals', path: 'fake_invoice', value: true }];
    expect(evaluateAvailability(true, conditions, run)).toBe(true);
    expect(evaluateAvailability(false, conditions, run)).toBe(false);
    expect(evaluateAvailability(true, [], run)).toBe(true);
    expect(evaluateAvailability(false, [], run)).toBe(false);
  });

  it('evaluateRuntime (D): dialogue/mission conditions', () => {
    const conditions: Rule[] = [{ op: 'previousDecision', value: 'd0-123' }];
    expect(evaluateRuntime(conditions, run)).toBe(true);
    expect(evaluateRuntime([], run)).toBe(true);
    expect(evaluateRuntime([{ op: 'previousDecision', value: 'other' }], run)).toBe(false);
  });
});

describe('worked examples (§1/§16/§19)', () => {
  it('example 1: evidence imei_mismatch eligible only when the case contains item phone', () => {
    const withPhone = buildGenerationContext(generationData);
    const withoutPhone = buildGenerationContext({ ...generationData, items: [] });
    const condition: Rule[] = [{ op: 'hasItem', ref: 'phone' }];
    expect(evaluateEligibility(condition, withPhone)).toBe(true);
    expect(evaluateEligibility(condition, withoutPhone)).toBe(false);
  });

  it('example 2: document invoice eligible only when a businessman character is settled', () => {
    const withBusinessman = buildGenerationContext(generationData);
    const without = buildGenerationContext({ ...generationData, characters: [] });
    const condition: Rule[] = [{ op: 'equals', path: 'character.role', value: 'businessman' }];
    expect(evaluateEligibility(condition, withBusinessman)).toBe(true);
    expect(evaluateEligibility(condition, without)).toBe(false);
  });

  it('example 3: runtime flag fake_invoice unlocks evidence fake_invoice_detected', () => {
    const before = buildRuntimeContext({ ...runtimeData, flags: { fake_invoice: false } });
    const after = buildRuntimeContext({ ...runtimeData, flags: { fake_invoice: true } });
    const condition: Rule = { op: 'equals', path: 'fake_invoice', value: true };
    expect(evaluateDiscovery(condition, before)).toBe(false);
    expect(evaluateDiscovery(condition, after)).toBe(true);
  });
});
