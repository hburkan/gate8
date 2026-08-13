import { z } from 'zod';
import { contentBaseSchema } from '../base.js';

export const missionSchema = contentBaseSchema.extend({
  title: z.string().min(1).max(200),
  description: z.string().nullable(),
  objective: z.string().nullable(),
  reward: z.record(z.string(), z.unknown()),
  completionCondition: z.record(z.string(), z.unknown()),
});

export const missionDraftSchema = missionSchema.partial().omit({
  id: true,
  status: true,
  version: true,
  createdAt: true,
  updatedAt: true,
});

export type Mission = z.infer<typeof missionSchema>;
export type MissionDraft = z.infer<typeof missionDraftSchema>;
