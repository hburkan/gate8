import { z } from 'zod';
import { contentBaseSchema } from '../base.js';

/**
 * Case template anchor entity.
 * Phase 3 only adds the FK-target fields; Phase 5 extends this schema with
 * type/difficulty/min-max generation fields.
 */
export const caseSchema = contentBaseSchema.extend({
  title: z.string().min(1).max(200),
  description: z.string().nullable(),
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
