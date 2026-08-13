import { z } from 'zod';
import { contentBaseSchema } from '../base.js';

export const locationTypeSchema = z.enum([
  'country',
  'city',
  'airport',
  'terminal',
  'area',
  'room',
]);

export const locationSchema = contentBaseSchema.extend({
  name: z.string().min(1).max(200),
  type: locationTypeSchema,
  description: z.string().nullable(),
  parentId: z.string().uuid().nullable(),
  asset: z.string().nullable(),
});

export const locationDraftSchema = locationSchema.partial().omit({
  id: true,
  status: true,
  version: true,
  createdAt: true,
  updatedAt: true,
});

export type Location = z.infer<typeof locationSchema>;
export type LocationDraft = z.infer<typeof locationDraftSchema>;
