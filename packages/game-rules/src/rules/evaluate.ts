import type { ComparisonRule, Rule } from './ast.js';
import type { GenerationContext, RuleContext, RuntimeContext } from './context.js';

/**
 * Pure evaluation core (§13/§15).
 *
 * One shared walker over the common AST; operators are dispatched here and
 * fact resolution is delegated to the context. Deterministic, side-effect
 * free, never throws — every impossible evaluation is a boolean `false`.
 * The four class-specific entry points take nominally branded contexts so
 * generation/runtime semantics cannot be conflated (D9).
 */

/**
 * Shared core: evaluate a single rule against a context.
 * `evaluateRule` is the internal composition primitive; the public entry
 * points below are the typed boundaries callers should use.
 */
export function evaluateRule(rule: Rule, ctx: RuleContext): boolean {
  switch (rule.op) {
    case 'and':
      return rule.rules.every((child) => evaluateRule(child, ctx));
    case 'or':
      return rule.rules.some((child) => evaluateRule(child, ctx));
    case 'not':
      return !evaluateRule(rule.rule, ctx);
    case 'equals':
      return evaluateEquals(rule, ctx);
    case 'greaterThan':
      return evaluateNumericComparison(rule, ctx, '>');
    case 'lessThan':
      return evaluateNumericComparison(rule, ctx, '<');
    case 'contains':
      return evaluateContains(rule, ctx);
    case 'hasItem':
      return ctx.hasItem(rule.ref);
    case 'hasEvidence':
      return ctx.hasEvidence(rule.ref);
    case 'characterRole':
      return ctx.characterRole(rule.value);
    case 'locationType':
      return ctx.locationType(rule.value);
    case 'difficulty':
      return ctx.difficulty(rule.value);
    case 'previousDecision':
      return ctx.previousDecision(rule.value);
  }
}

/**
 * Implicit AND over a payload array (§14): `[]` ⇒ `true` (Phase 6-10
 * behavior), every element must hold otherwise.
 */
export function evaluateRules(rules: Rule[], ctx: RuleContext): boolean {
  return rules.every((rule) => evaluateRule(rule, ctx));
}

/** Class A — generation eligibility (§15.2/§16). */
export function evaluateEligibility(conditions: Rule[], ctx: GenerationContext): boolean {
  return evaluateRules(conditions, ctx);
}

/**
 * Class B — discovery (§15.2/§19). `undefined`/no condition means always
 * discoverable (`null` discovery_condition ⇒ `true`).
 */
export function evaluateDiscovery(condition: Rule | undefined, ctx: RuntimeContext): boolean {
  if (condition === undefined) {
    return true;
  }
  return evaluateRule(condition, ctx);
}

/** Class C — availability (§15.2/§20): static flag ANDed with any rules. */
export function evaluateAvailability(
  availability: boolean,
  conditions: Rule[],
  ctx: RuntimeContext,
): boolean {
  return availability && evaluateRules(conditions, ctx);
}

/** Class D — runtime/gameplay (§15.2/§21): dialogue/mission conditions. */
export function evaluateRuntime(conditions: Rule[], ctx: RuntimeContext): boolean {
  return evaluateRules(conditions, ctx);
}

function evaluateEquals(rule: ComparisonRule, ctx: RuleContext): boolean {
  const resolved = ctx.get(rule.path);
  if (Array.isArray(resolved)) {
    return resolved.includes(rule.value);
  }
  return resolved === rule.value;
}

function evaluateNumericComparison(
  rule: ComparisonRule,
  ctx: RuleContext,
  operator: '>' | '<',
): boolean {
  const resolved = toNumber(ctx.get(rule.path));
  const operand = toNumber(rule.value);
  if (resolved === null || operand === null) {
    return false;
  }
  return operator === '>' ? resolved > operand : resolved < operand;
}

function evaluateContains(rule: ComparisonRule, ctx: RuleContext): boolean {
  const resolved = ctx.get(rule.path);
  if (typeof resolved === 'string' && typeof rule.value === 'string') {
    return resolved.includes(rule.value);
  }
  if (Array.isArray(resolved)) {
    return resolved.includes(rule.value);
  }
  return false;
}

/** Number or numeric string → number; anything else → null (⇒ false). */
function toNumber(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value))) {
    return Number(value);
  }
  return null;
}
