import { z } from 'zod';
import { contentBaseSchema } from '../base.js';

export const documentSchema = contentBaseSchema.extend({
  title: z.string().min(1).max(200),
  type: z.string().min(1).max(100),
  description: z.string().nullable(),
  asset: z.string().nullable(),
});

export const documentDraftSchema = documentSchema.partial().omit({
  id: true,
  status: true,
  version: true,
  createdAt: true,
  updatedAt: true,
});

export type Document = z.infer<typeof documentSchema>;
export type DocumentDraft = z.infer<typeof documentDraftSchema>;
