// server.js - Reference Implementation
// Run with: node server.js
// Requires: npm install express body-parser @google/genai dotenv cors

require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const { GoogleGenAI, Type } = require('@google/genai');

const app = express();
const port = 3000;

app.use(cors());
app.use(bodyParser.json({ limit: '10mb' }));

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || process.env.GEMINI_API_KEY });

const tools = [
  {
    functionDeclarations: [
      {
        name: "generate_image",
        description: "Generate or edit an image. Mandatory tool when the user asks for a visual, picture, drawing, or design.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            prompt: { type: Type.STRING, description: "The detailed prompt for the image generator." },
            aspectRatio: { type: Type.STRING, enum: ["1:1", "16:9", "9:16", "4:3", "3:4"], description: "Aspect ratio." }
          },
          required: ["prompt"]
        }
      },
      {
        name: "generate_audio",
        description: "Generate spoken audio (TTS). Mandatory tool when the user asks to 'say', 'speak', or 'narrate' something.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            text: { type: Type.STRING, description: "The text to be spoken." }
          },
          required: ["text"]
        }
      }
    ]
  },
  { googleSearch: {} }
];

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

app.post('/api/chat', async (req, res) => {
  const { input, attachment } = req.body; 
  if (!input && !attachment) return res.status(400).json({ error: "Input required" });

  // Set up Server-Sent Events (SSE) headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    // Construct the request parts
    const requestParts = [];
    if (attachment) {
      requestParts.push({
        inlineData: { mimeType: attachment.mimeType, data: attachment.data }
      });
      const mediaType = attachment.mimeType.startsWith('image') ? 'image' : 'audio';
      requestParts.push({ text: `User attached an ${mediaType}. ` + (input || "") });
    } else {
      requestParts.push({ text: input });
    }

    // Call Gemini 3 Pro with Tools (Streaming)
    const stream = await ai.models.generateContentStream({
      model: 'gemini-3-pro-preview',
      contents: { parts: requestParts },
      config: {
        systemInstruction: SYSTEM_PROMPT,
        tools: tools
      }
    });

    for await (const chunk of stream) {
      // 1. Send Text Delta
      if (chunk.text) {
        res.write(`data: ${JSON.stringify({ type: 'text_delta', content: chunk.text })}\n\n`);
      }
      
      // 2. Send Grounding Metadata
      const grounding = chunk.candidates?.[0]?.groundingMetadata?.groundingChunks;
      if (grounding) {
        res.write(`data: ${JSON.stringify({ type: 'grounding', metadata: grounding })}\n\n`);
      }

      // 3. Handle Tool/Function Calls
      const fcs = chunk.functionCalls;
      if (fcs) {
        for (const fc of fcs) {
          if (fc.name === 'generate_image') {
            const args = fc.args;
            res.write(`data: ${JSON.stringify({ type: 'thought', content: `Generating image: "${args.prompt}"...` })}\n\n`);
            
            try {
               // Handle attachment for image editing if present and is an image
               const imgParts = [];
               if (attachment && attachment.mimeType.startsWith('image/')) {
                  imgParts.push({ inlineData: { mimeType: attachment.mimeType, data: attachment.data } });
               }
               imgParts.push({ text: args.prompt });

               const imgRes = await ai.models.generateContent({
                  model: 'gemini-2.5-flash-image',
                  contents: { parts: imgParts },
                  config: { imageConfig: { aspectRatio: args.aspectRatio || "1:1" } }
               });
               
               const imgPart = imgRes.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
               if (imgPart) {
                 const block = {
                    type: 'image', 
                    url: `data:${imgPart.inlineData.mimeType};base64,${imgPart.inlineData.data}`, 
                    prompt: args.prompt 
                 };
                 res.write(`data: ${JSON.stringify({ type: 'block', block })}\n\n`);
               }
            } catch (err) {
               console.error("Image gen error", err);
               res.write(`data: ${JSON.stringify({ type: 'text_delta', content: `\n[Image Gen Error: ${err.message}]` })}\n\n`);
            }
          } 
          else if (fc.name === 'generate_audio') {
            const args = fc.args;
            res.write(`data: ${JSON.stringify({ type: 'thought', content: 'Generating audio...' })}\n\n`);
            
            try {
              const audioRes = await ai.models.generateContent({
                  model: 'gemini-2.5-flash-preview-tts',
                  contents: { parts: [{ text: args.text }] },
                  config: {
                      responseModalities: ['AUDIO'],
                      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } }
                  }
              });
              
              const audioPart = audioRes.candidates?.[0]?.content?.parts?.[0]?.inlineData;
              if (audioPart) {
                  const block = {
                      type: 'audio',
                      url: `data:audio/wav;base64,${audioPart.data}`,
                      text: args.text
                  };
                  res.write(`data: ${JSON.stringify({ type: 'block', block })}\n\n`);
              }
            } catch (err) {
               console.error("Audio gen error", err);
               res.write(`data: ${JSON.stringify({ type: 'text_delta', content: `\n[Audio Gen Error: ${err.message}]` })}\n\n`);
            }
          }
        }
      }
    }
    
    // End the stream
    res.write('data: [DONE]\n\n');
    res.end();

  } catch (err) {
    console.error(err);
    res.write(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`);
    res.end();
  }
});

app.listen(port, () => {
  console.log(`Gemini Omni Server running at http://localhost:${port}`);
});