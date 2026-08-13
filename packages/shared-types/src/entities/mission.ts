import type { ContentEntity } from '../base.js';

export interface Mission extends ContentEntity {
  title: string;
  description: string | null;
  objective: string | null;
  reward: Record<string, unknown>;
  completionCondition: Record<string, unknown>;
}
