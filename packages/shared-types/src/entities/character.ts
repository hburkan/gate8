import type { ContentEntity } from '../base.js';

export interface Character extends ContentEntity {
  name: string;
  surname: string | null;
  age: number | null;
  nationality: string | null;
  occupation: string | null;
  description: string | null;
  portraitAsset: string | null;
}
