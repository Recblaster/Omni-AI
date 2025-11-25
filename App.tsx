import React, { useState, useRef, useEffect } from 'react';
import { AppMode, ChatMessage as ChatMessageType, MessageRole, ContentBlock, GroundingChunk } from './types';
import ChatMessage from './components/ChatMessage';
import LiveInterface from './components/LiveInterface';
import { streamOrchestrateResponse } from './services/geminiService';

const App: React.FC = () => {
  const [mode, setMode] = useState<AppMode>(AppMode.OMNI);
  const [messages, setMessages] = useState<ChatMessageType[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [attachedImage, setAttachedImage] = useState<{data: string, mimeType: string} | null>(null);
  
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll logic
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onloadend = () => {
      const b64 = (reader.result as string).split(',')[1];
      setAttachedImage({ data: b64, mimeType: file.type });
    };
    reader.readAsDataURL(file);
  };

  const handleSend = async () => {
    if (!input.trim() && !attachedImage) return;

    // 1. User Message
    const userContent: ContentBlock[] = [];
    if (attachedImage) {
      userContent.push({ 
        type: 'image', 
        url: `data:${attachedImage.mimeType};base64,${attachedImage.data}`, 
        prompt: 'User Upload' 
      });
    }
    if (input.trim()) {
      userContent.push({ type: 'text', content: input });
    }

    const userMsg: ChatMessageType = {
      id: Date.now().toString(),
      role: MessageRole.USER,
      content: userContent,
      timestamp: Date.now()
    };

    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setAttachedImage(null);
    setIsLoading(true);

    // 2. Bot Message Placeholder
    const botMsgId = (Date.now() + 1).toString();
    const initialBotMsg: ChatMessageType = {
      id: botMsgId,
      role: MessageRole.MODEL,
      content: [], // Empty initially
      isThinking: true,
      timestamp: Date.now()
    };
    setMessages(prev => [...prev, initialBotMsg]);

    try {
      // 3. Start Stream
      const stream = streamOrchestrateResponse(input, attachedImage);
      let currentTextContent = "";
      let currentGrounding: GroundingChunk[] = [];

      for await (const update of stream) {
        
        if (update.type === 'text_delta') {
          currentTextContent += update.content;
          
          setMessages(prev => prev.map(msg => {
            if (msg.id === botMsgId) {
              // Update or add the first text block
              const newContent = [...msg.content];
              const textBlockIdx = newContent.findIndex(b => b.type === 'text');
              
              if (textBlockIdx !== -1) {
                newContent[textBlockIdx] = { 
                  ...newContent[textBlockIdx], 
                  content: currentTextContent,
                  grounding: currentGrounding 
                } as ContentBlock;
              } else {
                newContent.push({ type: 'text', content: currentTextContent, grounding: currentGrounding });
              }
              
              return { ...msg, content: newContent, isThinking: false };
            }
            return msg;
          }));
        } 
        else if (update.type === 'grounding') {
          currentGrounding = [...currentGrounding, ...update.metadata];
          // Refresh the text block with new grounding data
          setMessages(prev => prev.map(msg => {
            if (msg.id === botMsgId) {
              const newContent = [...msg.content];
              const textBlockIdx = newContent.findIndex(b => b.type === 'text');
              if (textBlockIdx !== -1) {
                 newContent[textBlockIdx] = { 
                   ...newContent[textBlockIdx], 
                   grounding: currentGrounding 
                 } as ContentBlock;
              }
              return { ...msg, content: newContent };
            }
            return msg;
          }));
        }
        else if (update.type === 'block') {
          // Add generated image/audio block
          setMessages(prev => prev.map(msg => {
            if (msg.id === botMsgId) {
              return { ...msg, content: [...msg.content, update.block], isThinking: false };
            }
            return msg;
          }));
        }
      }

    } catch (err) {
      console.error(err);
      setMessages(prev => prev.map(msg => {
        if (msg.id === botMsgId) {
           return { ...msg, content: [...msg.content, { type: 'text', content: "\n[Connection interrupted]" }] };
        }
        return msg;
      }));
    } finally {
      setIsLoading(false);
      setMessages(prev => prev.map(msg => {
        if (msg.id === botMsgId) return { ...msg, isThinking: false };
        return msg;
      }));
    }
  };

  if (mode === AppMode.LIVE) {
    return <LiveInterface onClose={() => setMode(AppMode.OMNI)} />;
  }

  return (
    <div className="flex flex-col h-screen bg-slate-950 text-slate-100 overflow-hidden font-inter selection:bg-blue-500/30">
      {/* Header */}
      <header className="h-16 border-b border-slate-800/60 flex items-center justify-between px-6 bg-slate-900/50 backdrop-blur-md z-10 sticky top-0">
        <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-indigo-500 via-purple-500 to-pink-500 flex items-center justify-center font-bold text-white font-display shadow-lg shadow-purple-500/20">G</div>
            <div className="flex flex-col">
              <h1 className="font-display font-semibold text-sm tracking-wide">GEMINI OMNI</h1>
              <span className="text-[10px] text-slate-500 uppercase tracking-wider">Streaming Orchestrator</span>
            </div>
        </div>
        
        <div className="flex items-center gap-2 bg-slate-900 rounded-lg p-1 border border-slate-800">
            <button
                onClick={() => setMode(AppMode.OMNI)}
                className={`px-4 py-1.5 rounded-md text-xs font-medium transition-all ${mode === AppMode.OMNI ? 'bg-slate-800 text-white shadow-sm' : 'text-slate-500 hover:text-slate-300'}`}
            >
                Chat
            </button>
            <button
                onClick={() => setMode(AppMode.LIVE)}
                className={`px-4 py-1.5 rounded-md text-xs font-medium transition-all flex items-center gap-1.5 ${mode === AppMode.LIVE ? 'bg-red-500/10 text-red-400 border border-red-500/20' : 'text-slate-500 hover:text-slate-300'}`}
            >
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
                </span>
                Live
            </button>
        </div>
      </header>

      {/* Chat Area */}
      <main className="flex-1 overflow-y-auto p-4 md:p-8 space-y-6 scroll-smooth">
        {messages.length === 0 && (
            <div className="h-full flex flex-col items-center justify-center text-slate-600 animate-in fade-in duration-700">
                <div className="w-20 h-20 bg-slate-900 rounded-2xl border border-slate-800 flex items-center justify-center mb-6 shadow-2xl rotate-3">
                  <span className="text-4xl">✨</span>
                </div>
                <h2 className="text-xl font-display font-medium text-slate-300 mb-2">How can I help you today?</h2>
                <p className="text-sm text-slate-500 max-w-md text-center">I can write code, generate images, speak responses, and search the web. Just ask.</p>
                
                <div className="mt-8 grid grid-cols-2 gap-3 max-w-lg w-full">
                  {['Draw a cyberpunk city', 'Explain quantum computing', 'Tell me a joke with audio', 'Find best sushi nearby'].map(t => (
                    <button key={t} onClick={() => setInput(t)} className="p-3 bg-slate-900/50 border border-slate-800 rounded-xl text-xs text-slate-400 hover:border-slate-600 hover:text-slate-200 transition-colors text-left">
                      {t}
                    </button>
                  ))}
                </div>
            </div>
        )}
        <div className="max-w-3xl mx-auto w-full">
          {messages.map((msg) => (
              <ChatMessage key={msg.id} message={msg} />
          ))}
          <div ref={bottomRef} />
        </div>
      </main>

      {/* Input Area */}
      <div className="p-6 bg-gradient-to-t from-slate-950 via-slate-950 to-transparent z-10">
        <div className="relative max-w-3xl mx-auto">
            {attachedImage && (
                <div className="absolute -top-14 left-0 bg-slate-900/90 backdrop-blur px-3 py-2 rounded-lg border border-slate-700 flex items-center gap-3 shadow-xl">
                     <div className="w-8 h-8 bg-slate-800 rounded flex items-center justify-center overflow-hidden">
                       <img src={`data:${attachedImage.mimeType};base64,${attachedImage.data}`} className="w-full h-full object-cover" alt="preview" />
                     </div>
                     <span className="text-xs text-slate-300 font-medium">Image attached</span>
                     <button onClick={() => setAttachedImage(null)} className="ml-2 text-slate-500 hover:text-red-400">×</button>
                </div>
            )}
            
            <div className="bg-slate-900 rounded-2xl border border-slate-800 flex items-end p-2 shadow-2xl focus-within:border-blue-500/30 focus-within:ring-1 focus-within:ring-blue-500/30 transition-all">
                <label className="p-3 text-slate-500 hover:text-indigo-400 cursor-pointer transition-colors" title="Attach Image">
                    <input type="file" className="hidden" accept="image/*" onChange={handleFileSelect} />
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                </label>

                <textarea
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                        if(e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            handleSend();
                        }
                    }}
                    placeholder="Ask Gemini anything..."
                    className="flex-1 bg-transparent border-none text-slate-200 placeholder-slate-600 focus:ring-0 resize-none py-3 max-h-32 min-h-[48px] text-sm"
                    rows={1}
                />

                <button 
                    onClick={handleSend}
                    disabled={isLoading || (!input.trim() && !attachedImage)}
                    className="p-3 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 disabled:text-slate-600 text-white rounded-xl transition-all shadow-lg shadow-indigo-500/20"
                >
                    {isLoading ? (
                        <div className="w-6 h-6 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                    ) : (
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" viewBox="0 0 20 20" fill="currentColor">
                            <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" />
                        </svg>
                    )}
                </button>
            </div>
            
            <div className="text-center mt-3">
              <p className="text-[10px] text-slate-600">Powered by Gemini 3.0 Pro & 2.5 Flash</p>
            </div>
        </div>
      </div>
    </div>
  );
};

export default App;
