import { z } from 'zod';

/**
 * Server-generated columns shared by every relation table (Phase 3).
 * Relations carry `version` (R2) but no `status` — they version with their
 * parent content entity.
 */
export const relationBaseSchema = z.object({
  id: z.string().uuid(),
  version: z.number().int().positive(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

/** Condition payloads are validated by the rule engine in Phase 11. */
export const relationConditionsSchema = z.array(z.record(z.string(), z.unknown()));

/** 0..1 spawn probability (location relations). */
export const spawnProbabilitySchema = z.number().min(0).max(1);

export const caseCharacterSchema = relationBaseSchema.extend({
  caseId: z.string().uuid(),
  characterId: z.string().uuid(),
  required: z.boolean(),
  weight: z.number().nonnegative(),
  minItems: z.number().int().nonnegative(),
  maxItems: z.number().int().nonnegative(),
  role: z.string().nullable(),
  priority: z.number().int(),
  conditions: relationConditionsSchema,
});

export const caseItemSchema = relationBaseSchema.extend({
  caseId: z.string().uuid(),
  itemId: z.string().uuid(),
  required: z.boolean(),
  weight: z.number().nonnegative(),
  minQuantity: z.number().int().nonnegative(),
  maxQuantity: z.number().int().nonnegative(),
  hidden: z.boolean(),
  discoveryMethod: z.string().nullable(),
  conditions: relationConditionsSchema,
  priority: z.number().int(),
});

export const caseDocumentSchema = relationBaseSchema.extend({
  caseId: z.string().uuid(),
  documentId: z.string().uuid(),
  required: z.boolean(),
  weight: z.number().nonnegative(),
  role: z.string().nullable(),
  hidden: z.boolean(),
  discoveryMethod: z.string().nullable(),
  conditions: relationConditionsSchema,
  priority: z.number().int(),
});

export const caseEvidenceSchema = relationBaseSchema.extend({
  caseId: z.string().uuid(),
  evidenceId: z.string().uuid(),
  role: z.string().nullable(),
  weight: z.number().nonnegative(),
  importance: z.string().nullable(),
  discoveryMethod: z.string().nullable(),
  discoveryCondition: z.record(z.string(), z.unknown()).nullable(),
  conditions: relationConditionsSchema,
  priority: z.number().int(),
});

export const locationCharacterSchema = relationBaseSchema.extend({
  locationId: z.string().uuid(),
  characterId: z.string().uuid(),
  availability: z.boolean(),
  weight: z.number().nonnegative(),
  spawnProbability: spawnProbabilitySchema,
  minQuantity: z.number().int().nonnegative(),
  maxQuantity: z.number().int().nonnegative(),
  role: z.string().nullable(),
  priority: z.number().int(),
  sortOrder: z.number().int(),
  conditions: relationConditionsSchema,
});

export const locationItemSchema = relationBaseSchema.extend({
  locationId: z.string().uuid(),
  itemId: z.string().uuid(),
  availability: z.boolean(),
  weight: z.number().nonnegative(),
  spawnProbability: spawnProbabilitySchema,
  minQuantity: z.number().int().nonnegative(),
  maxQuantity: z.number().int().nonnegative(),
  hidden: z.boolean(),
  discoveryMethod: z.string().nullable(),
  priority: z.number().int(),
  sortOrder: z.number().int(),
  conditions: relationConditionsSchema,
});

export const locationDocumentSchema = relationBaseSchema.extend({
  locationId: z.string().uuid(),
  documentId: z.string().uuid(),
  availability: z.boolean(),
  weight: z.number().nonnegative(),
  spawnProbability: spawnProbabilitySchema,
  role: z.string().nullable(),
  hidden: z.boolean(),
  discoveryMethod: z.string().nullable(),
  priority: z.number().int(),
  sortOrder: z.number().int(),
  conditions: relationConditionsSchema,
});

export const locationEvidenceSchema = relationBaseSchema.extend({
  locationId: z.string().uuid(),
  evidenceId: z.string().uuid(),
  availability: z.boolean(),
  weight: z.number().nonnegative(),
  spawnProbability: spawnProbabilitySchema,
  role: z.string().nullable(),
  importance: z.string().nullable(),
  discoveryMethod: z.string().nullable(),
  discoveryCondition: z.record(z.string(), z.unknown()).nullable(),
  priority: z.number().int(),
  sortOrder: z.number().int(),
  conditions: relationConditionsSchema,
});

export const locationCaseSchema = relationBaseSchema.extend({
  locationId: z.string().uuid(),
  caseId: z.string().uuid(),
  availability: z.boolean(),
  weight: z.number().nonnegative(),
  spawnProbability: spawnProbabilitySchema,
  priority: z.number().int(),
  sortOrder: z.number().int(),
  conditions: relationConditionsSchema,
});

export const chapterLocationSchema = relationBaseSchema.extend({
  chapterId: z.string().uuid(),
  locationId: z.string().uuid(),
  sortOrder: z.number().int().nonnegative(),
});

export const chapterCaseSchema = relationBaseSchema.extend({
  chapterId: z.string().uuid(),
  caseId: z.string().uuid(),
  sortOrder: z.number().int().nonnegative(),
});

export type CaseCharacter = z.infer<typeof caseCharacterSchema>;
export type CaseItem = z.infer<typeof caseItemSchema>;
export type CaseDocument = z.infer<typeof caseDocumentSchema>;
export type CaseEvidence = z.infer<typeof caseEvidenceSchema>;
export type LocationCharacter = z.infer<typeof locationCharacterSchema>;
export type LocationItem = z.infer<typeof locationItemSchema>;
export type LocationDocument = z.infer<typeof locationDocumentSchema>;
export type LocationEvidence = z.infer<typeof locationEvidenceSchema>;
export type LocationCase = z.infer<typeof locationCaseSchema>;
export type ChapterLocation = z.infer<typeof chapterLocationSchema>;
export type ChapterCase = z.infer<typeof chapterCaseSchema>;
