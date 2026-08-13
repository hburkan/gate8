import type { Rule, RuleOperator } from './ast.js';
import type { ComparisonRule, ContextRule, GroupRule, HasRule, NotRule } from './ast.js';

/**
 * Rule payload normalization (§14).
 *
 * Maps the three existing carrier shapes onto the single AST without a
 * migration: `[]`/`{}`/`null` ⇒ no rules (evaluates `true`), a non-empty
 * object ⇒ a single rule, an array ⇒ implicit AND. Malformed payloads throw
 * a deterministic `InvalidRule` — never coerced to `true`.
 */

/** Thrown when a rule payload cannot be normalized to a valid AST. */
export class InvalidRule extends Error {
  readonly reason: string;
  readonly payload: unknown;

  constructor(payload: unknown, reason: string) {
    super(`Invalid rule: ${reason}`);
    this.name = 'InvalidRule';
    this.reason = reason;
    this.payload = payload;
  }
}

/** §12.1 closed path vocabulary, class A (generation eligibility). */
export const GENERATION_PATHS = [
  'case.difficulty',
  'case.type',
  'character.role',
  'character.occupation',
  'item.id',
  'item.name',
  'document.role',
  'evidence.role',
  'evidence.importance',
] as const;

/** §12.1/§12.2 closed dotted path vocabulary, classes B/C/D (runtime). */
export const RUNTIME_CLOSED_PATHS = [
  'case.difficulty',
  'case.type',
  'location.type',
  'previousDecision',
] as const;

/**
 * §12.1/§12.2 closed path vocabulary guard (D10).
 *
 * At generation only the class-A vocabulary is legal. At runtime the closed
 * dotted vocabulary plus any dot-free path (a runtime flag, e.g.
 * `fake_invoice`) is legal. Arbitrary dotted traversal (`a.b.c`) is always
 * rejected. The Phase 26 publish validator calls this; the evaluator
 * returns `false` defensively for unknown paths.
 */
export function isKnownPath(path: string, kind: 'generation' | 'runtime'): boolean {
  if (kind === 'generation') {
    return (GENERATION_PATHS as readonly string[]).includes(path);
  }
  if ((RUNTIME_CLOSED_PATHS as readonly string[]).includes(path)) {
    return true;
  }
  return !path.includes('.');
}

/**
 * Normalize a rule payload into `Rule[]` (§14). Accepts a single rule
 * object, an array of rule objects (implicit AND), or the no-rule forms
 * `[]` / `{}` / `null` / `undefined`.
 */
export function parseRulePayload(payload: unknown): Rule[] {
  if (payload === null || payload === undefined) {
    return [];
  }
  if (Array.isArray(payload)) {
    if (payload.length === 0) {
      return [];
    }
    return payload.map((element) => parseRule(element));
  }
  if (typeof payload === 'object') {
    if (Object.keys(payload).length === 0) {
      return [];
    }
    return [parseRule(payload)];
  }
  throw new InvalidRule(payload, `rule payload must be an object or array, got ${typeof payload}`);
}

/**
 * Normalize a rule payload into `Rule[]`, accepting the same shapes as
 * `parseRulePayload` (§14/§34). Provided so array-oriented carriers read
 * clearly; behavior is identical.
 */
export function parseRuleArray(payload: unknown): Rule[] {
  return parseRulePayload(payload);
}

function parseRule(value: unknown): Rule {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new InvalidRule(value, 'rule must be a non-null object');
  }
  const record = value as Record<string, unknown>;
  const op = record.op;
  if (typeof op !== 'string') {
    throw new InvalidRule(value, 'rule op must be a string');
  }
  switch (op) {
    case 'and':
    case 'or':
      return parseGroup(record, op);
    case 'not':
      return parseNot(record);
    case 'equals':
    case 'greaterThan':
    case 'lessThan':
    case 'contains':
      return parseComparison(record, op);
    case 'hasItem':
    case 'hasEvidence':
      return parseHas(record, op);
    case 'characterRole':
    case 'locationType':
    case 'difficulty':
    case 'previousDecision':
      return parseContext(record, op);
    default:
      throw new InvalidRule(value, `unknown rule op '${String(op)}'`);
  }
}

function parseGroup(record: Record<string, unknown>, op: 'and' | 'or'): GroupRule {
  assertKeys(record, ['op', 'rules'], op);
  const rules = record.rules;
  if (!Array.isArray(rules) || rules.length === 0) {
    throw new InvalidRule(record, `'${op}' requires a non-empty rules array`);
  }
  return { op, rules: rules.map(parseRule) };
}

function parseNot(record: Record<string, unknown>): NotRule {
  assertKeys(record, ['op', 'rule'], 'not');
  if (!('rule' in record)) {
    throw new InvalidRule(record, "'not' requires a rule");
  }
  return { op: 'not', rule: parseRule(record.rule) };
}

function parseComparison(
  record: Record<string, unknown>,
  op: 'equals' | 'greaterThan' | 'lessThan' | 'contains',
): ComparisonRule {
  assertKeys(record, ['op', 'path', 'value'], op);
  const path = record.path;
  if (typeof path !== 'string') {
    throw new InvalidRule(record, `'${op}' requires a string path`);
  }
  if (!('value' in record)) {
    throw new InvalidRule(record, `'${op}' requires a value`);
  }
  const value = record.value;
  if (op === 'greaterThan' || op === 'lessThan') {
    if (!isNumeric(value)) {
      throw new InvalidRule(record, `'${op}' value must be a number or numeric string`);
    }
  } else if (!isScalar(value)) {
    throw new InvalidRule(record, `'${op}' value must be scalar (use 'contains' for lists)`);
  }
  return { op, path, value };
}

function parseHas(record: Record<string, unknown>, op: 'hasItem' | 'hasEvidence'): HasRule {
  assertKeys(record, ['op', 'ref'], op);
  const ref = record.ref;
  if (typeof ref !== 'string') {
    throw new InvalidRule(record, `'${op}' requires a string ref`);
  }
  return { op, ref };
}

function parseContext(
  record: Record<string, unknown>,
  op: 'characterRole' | 'locationType' | 'difficulty' | 'previousDecision',
): ContextRule {
  assertKeys(record, ['op', 'value'], op);
  const value = record.value;
  if (typeof value !== 'string') {
    throw new InvalidRule(record, `'${op}' requires a string value`);
  }
  return { op, value };
}

/** Unknown JSONB keys are rejected, not silently ignored (§14). */
function assertKeys(
  record: Record<string, unknown>,
  allowed: readonly string[],
  op: RuleOperator,
): void {
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) {
      throw new InvalidRule(record, `unknown key '${key}' for op '${op}'`);
    }
  }
}

function isNumeric(value: unknown): boolean {
  if (typeof value === 'number') {
    return Number.isFinite(value);
  }
  if (typeof value === 'string' && value.trim() !== '') {
    return !Number.isNaN(Number(value));
  }
  return false;
}

function isScalar(value: unknown): boolean {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  );
}
