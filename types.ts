
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
  isBookmarked?: boolean;
}

export interface SearchResult {
  text: string;
  context: string;
}

export enum AppMode {
  TEXT = 'text',
  VOICE = 'voice',
  LIVE = 'live'
}
