import { z } from 'zod';

export const contentStatusSchema = z.enum(['draft', 'review', 'published', 'archived']);

/** Shared lifecycle fields present on every content record (server-generated, read-only). */
export const contentBaseSchema = z.object({
  id: z.string().uuid(),
  status: contentStatusSchema,
  version: z.number().int().positive(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

/** Fields an author supplies when creating a new content entity. */
export const contentDraftSchema = contentBaseSchema.partial().omit({
  id: true,
  status: true,
  version: true,
  createdAt: true,
  updatedAt: true,
});

export type ContentDraft = z.infer<typeof contentDraftSchema>;
