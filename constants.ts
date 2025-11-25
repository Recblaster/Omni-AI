import { ModelType } from './types';

export const SYSTEM_INSTRUCTIONS = {
  CHAT: "You are a helpful AI assistant. Use Markdown for formatting.",
  CODING: "You are an expert software engineer. Provide clean, efficient code.",
  IMAGE_EDIT: "You are an expert image editor. Follow the user's instructions to modify the provided image.",
  LIVE: "You are a conversational partner. Keep responses concise and natural."
};

export const DEFAULT_IMAGE_CONFIG = {
  aspectRatio: "1:1",
  imageSize: "1K"
};

export const SAMPLE_RATE = 24000; // Standard for Gemini Audio
export const INPUT_SAMPLE_RATE = 16000; // Standard for Gemini Live Input