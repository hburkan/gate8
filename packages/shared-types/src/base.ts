/** Lifecycle state shared by every content entity. */
export const CONTENT_STATUSES = ['draft', 'review', 'published', 'archived'] as const;
export type ContentStatus = (typeof CONTENT_STATUSES)[number];

/** Shared lifecycle columns present on every content table. */
export interface ContentEntity {
  id: string;
  status: ContentStatus;
  version: number;
  createdAt: string;
  updatedAt: string;
}
