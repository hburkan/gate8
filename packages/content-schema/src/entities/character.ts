import { z } from 'zod';
import { contentBaseSchema } from '../base.js';

export const characterSchema = contentBaseSchema.extend({
  name: z.string().min(1).max(200),
  surname: z.string().max(200).nullable(),
  age: z.number().int().min(0).max(150).nullable(),
  nationality: z.string().max(100).nullable(),
  occupation: z.string().max(200).nullable(),
  description: z.string().nullable(),
  portraitAsset: z.string().nullable(),
});

export const characterDraftSchema = characterSchema.partial().omit({
  id: true,
  status: true,
  version: true,
  createdAt: true,
  updatedAt: true,
});

export type Character = z.infer<typeof characterSchema>;
export type CharacterDraft = z.infer<typeof characterDraftSchema>;
