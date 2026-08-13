/**
 * Shared rule AST (the canonical rule shape).
 *
 * Moved from `src/index.ts` so the rule engine modules can import the AST
 * without a circular dependency. `src/index.ts` re-exports this module, so
 * the public API is unchanged.
 */
export const RULE_OPERATORS = [
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
] as const;
export type RuleOperator = (typeof RULE_OPERATORS)[number];

export interface RuleBase {
  op: RuleOperator;
}

export interface ComparisonRule extends RuleBase {
  op: 'equals' | 'greaterThan' | 'lessThan' | 'contains';
  path: string;
  value: unknown;
}

export interface HasRule extends RuleBase {
  op: 'hasItem' | 'hasEvidence';
  ref: string;
}

export interface ContextRule extends RuleBase {
  op: 'characterRole' | 'locationType' | 'difficulty' | 'previousDecision';
  value: string;
}

export interface NotRule extends RuleBase {
  op: 'not';
  rule: Rule;
}

export interface GroupRule extends RuleBase {
  op: 'and' | 'or';
  rules: Rule[];
}

export type Rule = ComparisonRule | HasRule | ContextRule | NotRule | GroupRule;
