import { z } from 'zod';
import { contentBaseSchema } from '../base.js';

export const itemCategorySchema = z.enum([
  'electronics',
  'textile',
  'food',
  'personal',
  'currency',
  'documents',
  'chemical',
  'weapon',
  'other',
]);

export const itemRaritySchema = z.enum(['common', 'uncommon', 'rare', 'epic', 'legendary']);

export const riskLevelSchema = z.enum(['none', 'low', 'medium', 'high', 'critical']);

export const itemSchema = contentBaseSchema.extend({
  name: z.string().min(1).max(200),
  description: z.string().nullable(),
  category: itemCategorySchema,
  rarity: itemRaritySchema,
  value: z.number().nonnegative(),
  riskLevel: riskLevelSchema,
  asset: z.string().nullable(),
});

export const itemDraftSchema = itemSchema.partial().omit({
  id: true,
  status: true,
  version: true,
  createdAt: true,
  updatedAt: true,
});

export type Item = z.infer<typeof itemSchema>;
export type ItemDraft = z.infer<typeof itemDraftSchema>;
