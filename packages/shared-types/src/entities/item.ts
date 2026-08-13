import type { ContentEntity } from '../base.js';
import type { ItemCategory, ItemRarity, RiskLevel } from '../enums.js';

export interface Item extends ContentEntity {
  name: string;
  description: string | null;
  category: ItemCategory;
  rarity: ItemRarity;
  value: number;
  riskLevel: RiskLevel;
  asset: string | null;
}
