import type { ContentEntity } from '../base.js';
import type { LocationType } from '../enums.js';

export interface Location extends ContentEntity {
  name: string;
  type: LocationType;
  description: string | null;
  parentId: string | null;
  asset: string | null;
}
