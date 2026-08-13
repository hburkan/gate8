import type { ContentEntity } from '../base.js';
import type { DialogueNodeType } from '../enums.js';

export interface DialogueDefinition extends ContentEntity {
  title: string;
  description: string | null;
}

export interface DialogueNode {
  id: string;
  definitionId: string;
  nodeType: DialogueNodeType;
  speakerCharacterId: string | null;
  text: string | null;
  conditions: unknown[];
  actions: unknown[];
  nextNodeId: string | null;
  orderIndex: number;
}

export interface DialogueNodeChoice {
  id: string;
  nodeId: string;
  text: string;
  conditions: unknown[];
  actions: unknown[];
  nextNodeId: string | null;
  orderIndex: number;
}
