import { describe, expect, it } from 'vitest';
import type { Rule } from '../../src/rules/ast.js';
import {
  InvalidRule,
  GENERATION_PATHS,
  RUNTIME_CLOSED_PATHS,
  isKnownPath,
  parseRuleArray,
  parseRulePayload,
} from '../../src/rules/parse.js';

describe('parseRulePayload — §14 normalization', () => {
  it('parses [] to no rules (Phase 6-10 backward compatibility)', () => {
    expect(parseRulePayload([])).toEqual([]);
  });

  it('parses {} to no rules (mission completion default)', () => {
    expect(parseRulePayload({})).toEqual([]);
  });

  it('parses null to no rules (nullable discovery_condition)', () => {
    expect(parseRulePayload(null)).toEqual([]);
  });

  it('parses undefined/absent to no rules', () => {
    expect(parseRulePayload(undefined)).toEqual([]);
  });

  it('parses a single rule object to a one-element array', () => {
    const rule = { op: 'hasItem', ref: 'phone' } as const;
    expect(parseRulePayload(rule)).toEqual([rule]);
  });

  it('parses an array of rules to the same array (implicit AND, never OR/NOT)', () => {
    const rules: Rule[] = [
      { op: 'hasItem', ref: 'phone' },
      { op: 'characterRole', value: 'businessman' },
    ];
    expect(parseRulePayload(rules)).toEqual(rules);
  });

  it('parses nested and/or/not exactly as authored (grouping is only ever explicit)', () => {
    const payload: unknown = {
      op: 'or',
      rules: [
        { op: 'not', rule: { op: 'equals', path: 'case.difficulty', value: 'easy' } },
        { op: 'and', rules: [{ op: 'characterRole', value: 'businessman' }] },
      ],
    };
    expect(parseRulePayload(payload)).toEqual([
      {
        op: 'or',
        rules: [
          { op: 'not', rule: { op: 'equals', path: 'case.difficulty', value: 'easy' } },
          { op: 'and', rules: [{ op: 'characterRole', value: 'businessman' }] },
        ],
      },
    ]);
  });

  it('parseRuleArray behaves identically to parseRulePayload across all carrier shapes', () => {
    expect(parseRuleArray([])).toEqual(parseRulePayload([]));
    expect(parseRuleArray({})).toEqual(parseRulePayload({}));
    expect(parseRuleArray(null)).toEqual(parseRulePayload(null));
    const single: unknown = { op: 'equals', path: 'case.type', value: 'murder' };
    expect(parseRuleArray(single)).toEqual(parseRulePayload(single));
    const many: unknown = [
      { op: 'hasItem', ref: 'phone' },
      { op: 'hasEvidence', ref: 'ev-1' },
    ];
    expect(parseRuleArray(many)).toEqual(parseRulePayload(many));
  });

  it('accepts numeric-string values for greaterThan/lessThan', () => {
    expect(parseRulePayload({ op: 'greaterThan', path: 'x', value: '5' })).toEqual([
      { op: 'greaterThan', path: 'x', value: '5' },
    ]);
    expect(parseRulePayload({ op: 'lessThan', path: 'x', value: '5' })).toEqual([
      { op: 'lessThan', path: 'x', value: '5' },
    ]);
  });
});

describe('parseRulePayload — InvalidRule (never coerced to true)', () => {
  const invalid: Array<{ name: string; payload: unknown }> = [
    { name: 'unknown op', payload: { op: 'eqauls', path: 'x', value: 1 } },
    { name: 'non-string op', payload: { op: 5 } },
    { name: 'missing path on comparison', payload: { op: 'equals', value: 1 } },
    { name: 'missing value on comparison', payload: { op: 'equals', path: 'x' } },
    { name: 'unknown key on comparison', payload: { op: 'equals', path: 'x', value: 1, typo: 2 } },
    { name: 'non-scalar equals value (array)', payload: { op: 'equals', path: 'x', value: [1] } },
    {
      name: 'non-scalar equals value (object)',
      payload: { op: 'equals', path: 'x', value: { a: 1 } },
    },
    {
      name: 'non-numeric greaterThan value',
      payload: { op: 'greaterThan', path: 'x', value: 'abc' },
    },
    { name: 'boolean greaterThan value', payload: { op: 'greaterThan', path: 'x', value: true } },
    { name: 'non-numeric lessThan value', payload: { op: 'lessThan', path: 'x', value: {} } },
    { name: 'missing ref on hasItem', payload: { op: 'hasItem' } },
    { name: 'unknown key on hasEvidence', payload: { op: 'hasEvidence', ref: 'x', extra: true } },
    { name: 'missing value on characterRole', payload: { op: 'characterRole' } },
    { name: 'non-string value on locationType', payload: { op: 'locationType', value: 3 } },
    { name: 'missing value on difficulty', payload: { op: 'difficulty' } },
    { name: 'missing value on previousDecision', payload: { op: 'previousDecision' } },
    { name: 'missing rule on not', payload: { op: 'not' } },
    {
      name: 'unknown key on not',
      payload: { op: 'not', rule: { op: 'not', rule: { op: 'difficulty', value: 'x' } }, extra: 1 },
    },
    { name: 'empty and rules', payload: { op: 'and', rules: [] } },
    { name: 'empty or rules', payload: { op: 'or', rules: [] } },
    { name: 'non-array and rules', payload: { op: 'and', rules: 'x' } },
    { name: 'non-object array element', payload: [{ op: 'difficulty', value: 'x' }, 5] },
    { name: 'primitive payload (number)', payload: 5 },
    { name: 'primitive payload (string)', payload: 'hello' },
    { name: 'boolean payload', payload: true },
  ];

  for (const { name, payload } of invalid) {
    it(`throws InvalidRule for ${name}`, () => {
      expect(() => parseRulePayload(payload)).toThrow(InvalidRule);
    });
  }

  it('is deterministic: the same malformed payload throws the same error', () => {
    const payload = { op: 'eqauls', path: 'x', value: 1 };
    const a = (() => {
      try {
        parseRulePayload(payload);
        return null;
      } catch (e) {
        return e;
      }
    })();
    const b = (() => {
      try {
        parseRulePayload(payload);
        return null;
      } catch (e) {
        return e;
      }
    })();
    expect(a).toEqual(b);
    expect(a).toBeInstanceOf(InvalidRule);
  });

  it('reports the offending payload and reason on the error', () => {
    const payload = { op: 'eqauls', path: 'x', value: 1 };
    try {
      parseRulePayload(payload);
      throw new Error('expected InvalidRule');
    } catch (e) {
      expect(e).toBeInstanceOf(InvalidRule);
      if (e instanceof InvalidRule) {
        expect(e.payload).toEqual(payload);
        expect(typeof e.reason).toBe('string');
        expect(e.reason.length).toBeGreaterThan(0);
      }
    }
  });
});

describe('isKnownPath — §12.1/§12.2 closed path vocabulary', () => {
  it('exports the generation closed vocabulary', () => {
    expect(GENERATION_PATHS).toEqual(
      expect.arrayContaining([
        'case.difficulty',
        'case.type',
        'character.role',
        'character.occupation',
        'item.id',
        'item.name',
        'document.role',
        'evidence.role',
        'evidence.importance',
      ]),
    );
  });

  it('exports the runtime closed vocabulary (dot-free flags are additionally valid)', () => {
    expect(RUNTIME_CLOSED_PATHS).toEqual(
      expect.arrayContaining(['case.difficulty', 'case.type', 'location.type', 'previousDecision']),
    );
  });

  it('recognizes every generation path as known at generation', () => {
    for (const path of GENERATION_PATHS) {
      expect(isKnownPath(path, 'generation')).toBe(true);
    }
  });

  it('rejects runtime flags and arbitrary dotted paths at generation (UnknownPath)', () => {
    expect(isKnownPath('fake_invoice', 'generation')).toBe(false);
    expect(isKnownPath('character.items.0.name', 'generation')).toBe(false);
    expect(isKnownPath('location.type', 'generation')).toBe(false);
  });

  it('recognizes runtime closed paths at runtime', () => {
    for (const path of RUNTIME_CLOSED_PATHS) {
      expect(isKnownPath(path, 'runtime')).toBe(true);
    }
  });

  it('recognizes any dot-free path as a runtime flag at runtime', () => {
    expect(isKnownPath('fake_invoice', 'runtime')).toBe(true);
    expect(isKnownPath('suspicious_luggage_opened', 'runtime')).toBe(true);
  });

  it('rejects arbitrary dotted paths at runtime (flags are the only dynamic paths)', () => {
    expect(isKnownPath('character.items.0.name', 'runtime')).toBe(false);
    expect(isKnownPath('a.b.c', 'runtime')).toBe(false);
  });
});
