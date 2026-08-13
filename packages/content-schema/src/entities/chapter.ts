import { z } from 'zod';
import { contentBaseSchema } from '../base.js';

/**
 * Chapter: a content/story grouping layer over global reusable entities.
 * Lifecycle/versioning mirror all other content entities.
 */
export const chapterSchema = contentBaseSchema.extend({
  title: z.string().min(1).max(200),
  description: z.string().nullable(),
  sortOrder: z.number().int().nonnegative(),
});

export const chapterDraftSchema = chapterSchema.partial().omit({
  id: true,
  status: true,
  version: true,
  createdAt: true,
  updatedAt: true,
});

export type Chapter = z.infer<typeof chapterSchema>;
export type ChapterDraft = z.infer<typeof chapterDraftSchema>;
