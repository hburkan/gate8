import type { ContentEntity } from '../base.js';

export interface Document extends ContentEntity {
  title: string;
  type: string;
  description: string | null;
  asset: string | null;
}
