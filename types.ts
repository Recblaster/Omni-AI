export enum MessageRole {
  USER = 'user',
  MODEL = 'model',
  SYSTEM = 'system'
}

export enum AppMode {
  OMNI = 'omni', // Unified Chat
  LIVE = 'live'
}

export enum ModelType {
  FLASH = 'gemini-2.5-flash',
  PRO = 'gemini-3-pro-preview',
  FLASH_IMAGE = 'gemini-2.5-flash-image', 
  PRO_IMAGE = 'gemini-3-pro-image-preview',
  TTS = 'gemini-2.5-flash-preview-tts',
  LIVE = 'gemini-2.5-flash-native-audio-preview-09-2025'
}

export interface GroundingChunk {
  web?: { uri: string; title: string };
  maps?: { 
    uri: string; 
    title: string;
    placeAnswerSources?: { reviewSnippets?: { reviewText: string }[] }[] 
  };
}

export type ContentBlock = 
  | { type: 'text'; content: string; grounding?: GroundingChunk[] }
  | { type: 'image'; url: string; prompt: string }
  | { type: 'audio'; url: string; text?: string } // url here acts as base64 data uri
  | { type: 'code'; language: string; content: string };

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: ContentBlock[];
  isThinking?: boolean;
  timestamp: number;
}

export type StreamUpdate = 
  | { type: 'text_delta'; content: string }
  | { type: 'grounding'; metadata: GroundingChunk[] }
  | { type: 'block'; block: ContentBlock }
  | { type: 'thought'; content: string };
