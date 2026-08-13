import { z } from 'zod';
import { contentBaseSchema } from '../base.js';

/**
 * Case template entity.
 * `type`/`difficulty` are content-defined free text; min/max bounds use
 * `0` = "no bound". Per-entity generation config lives on the Phase 3
 * case_* relation tables, never here.
 */
export const caseSchema = contentBaseSchema.extend({
  title: z.string().min(1).max(200),
  description: z.string().nullable(),
  type: z.string().nullable(),
  difficulty: z.string().nullable(),
  minCharacters: z.number().int().nonnegative(),
  maxCharacters: z.number().int().nonnegative(),
  minItems: z.number().int().nonnegative(),
  maxItems: z.number().int().nonnegative(),
  minDocuments: z.number().int().nonnegative(),
  maxDocuments: z.number().int().nonnegative(),
  minEvidence: z.number().int().nonnegative(),
  maxEvidence: z.number().int().nonnegative(),
});

export const caseDraftSchema = caseSchema.partial().omit({
  id: true,
  status: true,
  version: true,
  createdAt: true,
  updatedAt: true,
});

export type Case = z.infer<typeof caseSchema>;
export type CaseDraft = z.infer<typeof caseDraftSchema>;
