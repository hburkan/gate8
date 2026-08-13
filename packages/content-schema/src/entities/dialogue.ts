import { z } from 'zod';
import { contentBaseSchema } from '../base.js';

export const dialogueNodeTypeSchema = z.enum([
  'dialogue',
  'choice',
  'condition',
  'action',
  'evidence',
  'mission',
  'end',
]);

/**
 * Condition/action payloads are validated against the rule shapes from
 * @gate8/game-rules once the rule engine ships (Phase 11). Until then they
 * are structurally validated as arrays of records.
 */
export const rulePayloadSchema = z.array(z.record(z.string(), z.unknown()));

export const dialogueDefinitionSchema = contentBaseSchema.extend({
  title: z.string().min(1).max(200),
  description: z.string().nullable(),
});

export const dialogueNodeSchema = z.object({
  id: z.string().uuid(),
  definitionId: z.string().uuid(),
  nodeType: dialogueNodeTypeSchema,
  speakerCharacterId: z.string().uuid().nullable(),
  text: z.string().nullable(),
  conditions: rulePayloadSchema,
  actions: rulePayloadSchema,
  nextNodeId: z.string().uuid().nullable(),
  orderIndex: z.number().int().nonnegative(),
});

export const dialogueNodeChoiceSchema = z.object({
  id: z.string().uuid(),
  nodeId: z.string().uuid(),
  text: z.string().min(1),
  conditions: rulePayloadSchema,
  actions: rulePayloadSchema,
  nextNodeId: z.string().uuid().nullable(),
  orderIndex: z.number().int().nonnegative(),
});

export const dialogueDefinitionDraftSchema = dialogueDefinitionSchema.partial().omit({
  id: true,
  status: true,
  version: true,
  createdAt: true,
  updatedAt: true,
});

export type DialogueDefinition = z.infer<typeof dialogueDefinitionSchema>;
export type DialogueDefinitionDraft = z.infer<typeof dialogueDefinitionDraftSchema>;
export type DialogueNode = z.infer<typeof dialogueNodeSchema>;
export type DialogueNodeChoice = z.infer<typeof dialogueNodeChoiceSchema>;
