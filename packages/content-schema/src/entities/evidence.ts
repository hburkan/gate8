import { z } from 'zod';
import { contentBaseSchema } from '../base.js';

export const evidenceTypeSchema = z.enum([
  'physical',
  'digital',
  'documentary',
  'forensic',
  'testimony',
]);
export const evidenceImportanceSchema = z.enum(['low', 'medium', 'high', 'critical']);

/**
 * Global evidence entity.
 * `type` is the evidence CATEGORY. Generation roles (REQUIRED/OPTIONAL/DECOY/
 * HIDDEN) live on the case relation (Phase 3/10), not on this entity.
 */
export const evidenceSchema = contentBaseSchema.extend({
  name: z.string().min(1).max(200),
  description: z.string().nullable(),
  type: evidenceTypeSchema,
  importance: evidenceImportanceSchema,
});

export const evidenceDraftSchema = evidenceSchema.partial().omit({
  id: true,
  status: true,
  version: true,
  createdAt: true,
  updatedAt: true,
});

export type Evidence = z.infer<typeof evidenceSchema>;
export type EvidenceDraft = z.infer<typeof evidenceDraftSchema>;
