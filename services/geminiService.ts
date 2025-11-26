import { GoogleGenAI, LiveServerMessage, Modality, FunctionDeclaration, Type, Schema } from "@google/genai";
import { ModelType, ContentBlock, AppMode, StreamUpdate } from "../types";
import { convertFloat32ToInt16, arrayBufferToBase64 } from "./audioUtils";

// Safely retrieve API Key (handles browser, vite, and node environments)
const getApiKey = () => {
  try {
    // Check for standard process.env (Build tools/Node)
    if (typeof process !== 'undefined' && process.env && process.env.API_KEY) {
      return process.env.API_KEY;
    }
    // Check for Vite specific env (if using Vite)
    if (typeof import.meta !== 'undefined' && (import.meta as any).env && (import.meta as any).env.VITE_API_KEY) {
      return (import.meta as any).env.VITE_API_KEY;
    }
  } catch (e) {
    console.warn("Could not retrieve API_KEY from environment");
  }
  return '';
};

const apiKey = getApiKey();

let aiClient: GoogleGenAI | null = null;

const getAiClient = () => {
  if (!aiClient) {
    aiClient = new GoogleGenAI({ apiKey });
  }
  return aiClient;
};

// --- ORCHESTRATOR TOOLS ---

const generateImageTool: FunctionDeclaration = {
  name: "generate_image",
  description: "Generate or edit an image. Mandatory tool when the user asks for a visual, picture, drawing, or design.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      prompt: { type: Type.STRING, description: "The detailed prompt for the image generator." },
      aspectRatio: { type: Type.STRING, enum: ["1:1", "16:9", "9:16", "4:3", "3:4"], description: "The aspect ratio of the image." }
    },
    required: ["prompt"]
  }
};

const generateAudioTool: FunctionDeclaration = {
  name: "generate_audio",
  description: "Generate spoken audio (TTS). Mandatory tool when the user asks to 'say', 'speak', or 'narrate' something.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      text: { type: Type.STRING, description: "The text to be spoken." }
    },
    required: ["text"]
  }
};

const SYSTEM_PROMPT = `
You are Gemini Omni, an intelligent multimodal interface.
Your goal is to satisfy the user's request using the optimal mix of Text, Images, and Audio.

**Workflow:**
1. **Analyze**: specific intent (Information? Visual? Speech?).
2. **Strategy**:
   - If the user asks for a visual (e.g., "draw a cat", "show me..."), you **MUST** use \`generate_image\`.
   - If the user asks for audio (e.g., "say hello", "read this"), you **MUST** use \`generate_audio\`.
   - If the user asks a question about current events, use \`googleSearch\`.
   - Always provide a helpful text response to accompany generated media.

**Rules:**
- Do not ask for confirmation. Execute the tools immediately.
- You can mix modalities: e.g., generate an image AND text explaining it.
`;

export async function* streamOrchestrateResponse(
  userInput: string, 
  attachment: { data: string; mimeType: string } | null
): AsyncGenerator<StreamUpdate, void, unknown> {
  const ai = getAiClient();
  
  const requestParts: any[] = [];
  if (attachment) {
    requestParts.push({
      inlineData: { mimeType: attachment.mimeType, data: attachment.data }
    });
    const mediaType = attachment.mimeType.startsWith('image') ? 'image' : 'audio';
    requestParts.push({ text: `User attached an ${mediaType}. ` + userInput });
  } else {
    requestParts.push({ text: userInput });
  }

  const stream = await ai.models.generateContentStream({
    model: ModelType.PRO,
    contents: { parts: requestParts },
    config: {
      systemInstruction: SYSTEM_PROMPT,
      tools: [
        { functionDeclarations: [generateImageTool, generateAudioTool] },
        { googleSearch: {} }
      ]
    }
  });

  for await (const chunk of stream) {
    // 1. Handle Text
    const text = chunk.text;
    if (text) {
      yield { type: 'text_delta', content: text };
    }

    // 2. Handle Grounding
    if (chunk.candidates?.[0]?.groundingMetadata?.groundingChunks) {
      yield { type: 'grounding', metadata: chunk.candidates[0].groundingMetadata.groundingChunks };
    }

    // 3. Handle Function Calls (Images/Audio)
    // Note: In streaming, function calls usually arrive in a specific chunk.
    const functionCalls = chunk.functionCalls;
    if (functionCalls && functionCalls.length > 0) {
      for (const fc of functionCalls) {
        if (fc.name === 'generate_image') {
          const args = fc.args as any;
          yield { type: 'thought', content: `Generating image: "${args.prompt}"...` };
          
          try {
            // Execute Image Gen
            const imageBlock = await generateImage(ai, args.prompt, args.aspectRatio, attachment);
            if (imageBlock) yield { type: 'block', block: imageBlock };
          } catch (e) {
            yield { type: 'text_delta', content: `\n[Error generating image: ${e}]` };
          }
        }
        else if (fc.name === 'generate_audio') {
          const args = fc.args as any;
          yield { type: 'thought', content: `Generating audio...` };
          
          try {
            // Execute TTS
            const audioBlock = await generateAudio(ai, args.text);
            if (audioBlock) yield { type: 'block', block: audioBlock };
          } catch (e) {
             yield { type: 'text_delta', content: `\n[Error generating audio: ${e}]` };
          }
        }
      }
    }
  }
}

async function generateImage(ai: GoogleGenAI, prompt: string, aspectRatio: string = "1:1", attachment: any): Promise<ContentBlock | null> {
    const parts: any[] = [];
    if (attachment && attachment.mimeType.startsWith('image/')) {
       parts.push({ inlineData: { mimeType: attachment.mimeType, data: attachment.data } });
    }
    parts.push({ text: prompt });

    const response = await ai.models.generateContent({
        model: ModelType.FLASH_IMAGE,
        contents: { parts },
        config: { imageConfig: { aspectRatio } }
    });

    const imgPart = response.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
    if (imgPart && imgPart.inlineData) {
        return {
            type: 'image',
            url: `data:${imgPart.inlineData.mimeType};base64,${imgPart.inlineData.data}`,
            prompt: prompt
        };
    }
    return null;
}

async function generateAudio(ai: GoogleGenAI, text: string): Promise<ContentBlock | null> {
    const response = await ai.models.generateContent({
        model: ModelType.TTS,
        contents: { parts: [{ text }] },
        config: {
            responseModalities: [Modality.AUDIO],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } }
        }
    });

    const audioPart = response.candidates?.[0]?.content?.parts?.[0]?.inlineData;
    if (audioPart) {
        return {
            type: 'audio',
            url: `data:audio/wav;base64,${audioPart.data}`,
            text: text
        };
    }
    return null;
}

// --- LIVE SESSION (Unchanged) ---

export class LiveSession {
  private sessionPromise: Promise<any> | null = null;
  private ai: GoogleGenAI;
  
  constructor(
    private onAudioData: (data: string) => void,
    private onClose: () => void
  ) {
    this.ai = getAiClient();
  }

  async connect(systemInstruction: string = "You are a helpful assistant.") {
    this.sessionPromise = this.ai.live.connect({
      model: ModelType.LIVE,
      callbacks: {
        onopen: () => console.log('Live Session Opened'),
        onmessage: (msg: LiveServerMessage) => {
          const audioData = msg.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
          if (audioData) {
            this.onAudioData(audioData);
          }
        },
        onclose: () => {
          console.log('Live Session Closed');
          this.onClose();
        },
        onerror: (e) => console.error('Live Error', e)
      },
      config: {
        responseModalities: [Modality.AUDIO],
        systemInstruction,
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } }
        }
      }
    });
    return this.sessionPromise;
  }

  async sendAudio(pcmData: Float32Array) {
    if (!this.sessionPromise) return;
    const int16Data = convertFloat32ToInt16(pcmData);
    const uint8Data = new Uint8Array(int16Data.buffer);
    const base64Data = arrayBufferToBase64(uint8Data.buffer);

    const session = await this.sessionPromise;
    session.sendRealtimeInput({
      media: {
        mimeType: 'audio/pcm;rate=16000',
        data: base64Data
      }
    });
  }

  async disconnect() {
    if (this.sessionPromise) {
        // close logic if available
    }
  }
}