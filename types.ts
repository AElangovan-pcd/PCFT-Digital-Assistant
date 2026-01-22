
export enum MessageRole {
  USER = 'user',
  ASSISTANT = 'assistant',
  SYSTEM = 'system'
}

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: Date;
}

export interface ContractSection {
  title: string;
  id: string;
  content: string;
}

export enum AppMode {
  TEXT = 'text',
  VOICE = 'voice',
  LIVE = 'live'
}
