import type { ContentEntity } from '../base.js';

/**
 * Chapter: a content/story grouping layer over global reusable entities.
 * Chapters reference Locations and Cases via chapter_* relation tables and
 * do NOT own Characters/Items/Documents/Evidence.
 */
export interface Chapter extends ContentEntity {
  title: string;
  description: string | null;
  sortOrder: number;
}
