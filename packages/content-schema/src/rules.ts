import { z } from 'zod';

/**
 * Zod mirror of the `Rule` union from `@gate8/game-rules` (Phase 11).
 *
 * Validates condition/action payloads against the rule shapes while keeping
 * every existing carrier form representable (§14): a single rule object OR
 * an array of rule objects (implicit AND), plus each carrier's no-condition
 * default (`[]` for relations/dialogue, `{}` for mission completion, `null`
 * for discovery). Unknown keys are rejected (strict objects) so a typo like
 * `eqauls` cannot silently pass validation.
 */

/** Any JSON value (required where referenced — e.g. `value` in comparisons). */
const jsonValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
  z.array(z.unknown()),
  z.record(z.string(), z.unknown()),
]);

type RuleObject =
  | { op: 'and'; rules: RuleObject[] }
  | { op: 'or'; rules: RuleObject[] }
  | { op: 'not'; rule: RuleObject }
  | { op: 'equals'; path: string; value: unknown }
  | { op: 'greaterThan'; path: string; value: unknown }
  | { op: 'lessThan'; path: string; value: unknown }
  | { op: 'contains'; path: string; value: unknown }
  | { op: 'hasItem'; ref: string }
  | { op: 'hasEvidence'; ref: string }
  | { op: 'characterRole'; value: string }
  | { op: 'locationType'; value: string }
  | { op: 'difficulty'; value: string }
  | { op: 'previousDecision'; value: string };

const ruleObjectSchema: z.ZodType<RuleObject> = z.lazy(() =>
  z.union([
    z
      .object({
        op: z.literal('and'),
        rules: z.array(ruleObjectSchema).min(1),
      })
      .strict(),
    z
      .object({
        op: z.literal('or'),
        rules: z.array(ruleObjectSchema).min(1),
      })
      .strict(),
    z
      .object({
        op: z.literal('not'),
        rule: ruleObjectSchema,
      })
      .strict(),
    z
      .object({
        op: z.literal('equals'),
        path: z.string(),
        value: jsonValueSchema,
      })
      .strict(),
    z
      .object({
        op: z.literal('greaterThan'),
        path: z.string(),
        value: jsonValueSchema,
      })
      .strict(),
    z
      .object({
        op: z.literal('lessThan'),
        path: z.string(),
        value: jsonValueSchema,
      })
      .strict(),
    z
      .object({
        op: z.literal('contains'),
        path: z.string(),
        value: jsonValueSchema,
      })
      .strict(),
    z
      .object({
        op: z.literal('hasItem'),
        ref: z.string(),
      })
      .strict(),
    z
      .object({
        op: z.literal('hasEvidence'),
        ref: z.string(),
      })
      .strict(),
    z
      .object({
        op: z.literal('characterRole'),
        value: z.string(),
      })
      .strict(),
    z
      .object({
        op: z.literal('locationType'),
        value: z.string(),
      })
      .strict(),
    z
      .object({
        op: z.literal('difficulty'),
        value: z.string(),
      })
      .strict(),
    z
      .object({
        op: z.literal('previousDecision'),
        value: z.string(),
      })
      .strict(),
  ]),
);

/** A single rule object mirroring the `Rule` union. */
export const ruleSchema = ruleObjectSchema;

/**
 * Condition payloads (relations `conditions`, dialogue `conditions`/`actions`):
 * either carrier form — single rule object or array of rules (implicit AND).
 * The empty array `[]` (the relations/dialogue default) is valid.
 */
export const rulePayloadSchema = z.union([ruleObjectSchema, z.array(ruleObjectSchema)]);

/**
 * Mission `completion_condition`: also accepts the empty-object default `{}`.
 */
export const completionConditionSchema = z.union([
  ruleObjectSchema,
  z.array(ruleObjectSchema),
  z.object({}).strict(),
]);

/**
 * Nullable discovery condition (class B): also accepts `null` (always
 * discoverable). Either carrier form remains valid.
 */
export const discoveryConditionSchema = z.union([
  ruleObjectSchema,
  z.array(ruleObjectSchema),
  z.null(),
]);
