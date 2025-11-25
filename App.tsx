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
  const [attachment, setAttachment] = useState<{data: string, mimeType: string} | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  
  const bottomRef = useRef<HTMLDivElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

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
      setAttachment({ data: b64, mimeType: file.type });
    };
    reader.readAsDataURL(file);
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      audioChunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const reader = new FileReader();
        reader.onloadend = () => {
          const base64String = (reader.result as string).split(',')[1];
          setAttachment({
            data: base64String,
            mimeType: 'audio/webm'
          });
        };
        reader.readAsDataURL(audioBlob);
        
        // Stop all tracks
        stream.getTracks().forEach(track => track.stop());
      };

      recorder.start();
      setIsRecording(true);
    } catch (err) {
      console.error("Error accessing microphone:", err);
      alert("Could not access microphone.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  const handleSend = async () => {
    if (!input.trim() && !attachment) return;

    // 1. User Message
    const userContent: ContentBlock[] = [];
    if (attachment) {
      if (attachment.mimeType.startsWith('image/')) {
        userContent.push({ 
          type: 'image', 
          url: `data:${attachment.mimeType};base64,${attachment.data}`, 
          prompt: 'User Upload' 
        });
      } else if (attachment.mimeType.startsWith('audio/')) {
        userContent.push({
          type: 'audio',
          url: `data:${attachment.mimeType};base64,${attachment.data}`,
          text: 'Voice Input'
        });
      }
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
    const currentAttachment = attachment;
    setAttachment(null);
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
      const stream = streamOrchestrateResponse(input, currentAttachment);
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
    <div className="flex flex-col h-screen bg-neutral-950 text-neutral-100 overflow-hidden font-sans selection:bg-indigo-500/30 selection:text-indigo-200">
      
      {/* Background Gradient */}
      <div className="fixed inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-indigo-900/20 via-neutral-950/0 to-neutral-950/0 pointer-events-none" />

      {/* Header */}
      <header className="h-20 flex items-center justify-between px-8 z-20 sticky top-0 bg-neutral-950/50 backdrop-blur-md border-b border-white/5">
        <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-500/20">
               <svg className="w-6 h-6 text-white" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                 <path d="M12 4L14.5 9.5L20 12L14.5 14.5L12 20L9.5 14.5L4 12L9.5 9.5L12 4Z" fill="currentColor"/>
               </svg>
            </div>
            <div>
              <h1 className="font-display font-semibold text-lg tracking-tight text-white leading-none">Gemini Omni</h1>
              <span className="text-[11px] text-neutral-400 font-medium tracking-wide uppercase opacity-70">Multimodal Interface</span>
            </div>
        </div>
        
        <div className="flex items-center gap-1 bg-neutral-900/50 p-1 rounded-full border border-white/5">
            <button
                onClick={() => setMode(AppMode.OMNI)}
                className="px-5 py-2 rounded-full text-xs font-medium transition-all duration-300 bg-neutral-800 text-white shadow-sm"
            >
                Chat
            </button>
            <button
                onClick={() => setMode(AppMode.LIVE)}
                className="px-5 py-2 rounded-full text-xs font-medium transition-all duration-300 flex items-center gap-2 text-neutral-500 hover:text-neutral-300"
            >
                <div className="w-2 h-2 rounded-full bg-current opacity-50" />
                Live
            </button>
        </div>
      </header>

      {/* Chat Area */}
      <main className="flex-1 overflow-y-auto px-4 md:px-0 pt-6 pb-32 scroll-smooth z-10 custom-scrollbar">
        {messages.length === 0 && (
            <div className="h-full flex flex-col items-center justify-center animate-in fade-in duration-700 slide-in-from-bottom-4">
                <div className="w-24 h-24 bg-gradient-to-tr from-neutral-800 to-neutral-900 rounded-[2rem] border border-white/5 flex items-center justify-center mb-8 shadow-2xl rotate-3 ring-1 ring-white/10">
                  <span className="text-5xl drop-shadow-lg">✨</span>
                </div>
                <h2 className="text-3xl font-display font-medium text-transparent bg-clip-text bg-gradient-to-b from-white to-neutral-500 mb-3 text-center">Hello, Creator</h2>
                <p className="text-neutral-500 max-w-md text-center text-lg leading-relaxed font-light">
                  I can see, hear, and create. <br/>What shall we build together today?
                </p>
                
                <div className="mt-12 grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-2xl w-full px-8">
                  {[
                    { icon: '🎨', text: 'Draw a futuristic city', sub: 'Image Generation' },
                    { icon: '💻', text: 'Explain React Hooks', sub: 'Coding Assistance' },
                    { icon: '🗣️', text: 'Tell me a bedtime story', sub: 'Text to Speech' },
                    { icon: '🌍', text: 'Find coffee shops nearby', sub: 'Grounding with Maps' }
                  ].map((item, i) => (
                    <button 
                      key={i} 
                      onClick={() => setInput(item.text)} 
                      className="group p-4 bg-neutral-900/40 hover:bg-neutral-800/60 border border-white/5 hover:border-indigo-500/30 rounded-2xl text-left transition-all duration-200 hover:-translate-y-1"
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-xl group-hover:scale-110 transition-transform duration-200">{item.icon}</span>
                        <div>
                          <div className="text-sm font-medium text-neutral-200 group-hover:text-white">{item.text}</div>
                          <div className="text-[10px] text-neutral-500 uppercase tracking-wider mt-0.5">{item.sub}</div>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
            </div>
        )}
        <div className="max-w-4xl mx-auto w-full space-y-8 px-4">
          {messages.map((msg) => (
              <ChatMessage key={msg.id} message={msg} />
          ))}
          <div ref={bottomRef} className="h-8" />
        </div>
      </main>

      {/* Floating Input Area */}
      <div className="fixed bottom-0 left-0 right-0 p-6 z-30 pointer-events-none">
        <div className="max-w-3xl mx-auto pointer-events-auto">
            {/* Attachment Preview */}
            {attachment && (
                <div className="absolute -top-16 left-6 animate-in slide-in-from-bottom-2 fade-in">
                  <div className="bg-neutral-900/90 backdrop-blur-xl pl-2 pr-4 py-2 rounded-2xl border border-white/10 flex items-center gap-3 shadow-xl">
                       {attachment.mimeType.startsWith('image/') ? (
                         <div className="w-10 h-10 bg-neutral-800 rounded-lg overflow-hidden ring-1 ring-white/10">
                           <img src={`data:${attachment.mimeType};base64,${attachment.data}`} className="w-full h-full object-cover" alt="preview" />
                         </div>
                       ) : (
                         <div className="w-10 h-10 bg-neutral-800 rounded-lg flex items-center justify-center text-red-400 ring-1 ring-white/10">
                           <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" /></svg>
                         </div>
                       )}
                       <div className="flex flex-col">
                         <span className="text-xs text-white font-medium">{attachment.mimeType.startsWith('image/') ? 'Image attached' : 'Audio recorded'}</span>
                         <span className="text-[10px] text-neutral-500">Ready to send</span>
                       </div>
                       <button onClick={() => setAttachment(null)} className="ml-2 w-6 h-6 rounded-full bg-neutral-800 hover:bg-neutral-700 text-neutral-400 flex items-center justify-center transition-colors">×</button>
                  </div>
                </div>
            )}
            
            <div className={`
              bg-neutral-900/80 backdrop-blur-2xl border border-white/10 
              rounded-[2rem] flex items-end p-2 shadow-2xl shadow-black/50 
              transition-all duration-300
              ${isRecording ? 'ring-2 ring-red-500/50 border-red-500/30' : 'focus-within:ring-2 focus-within:ring-indigo-500/30 focus-within:border-indigo-500/50'}
            `}>
                <label className="p-4 text-neutral-400 hover:text-white cursor-pointer transition-colors rounded-full hover:bg-white/5 active:scale-95" title="Attach Image">
                    <input type="file" className="hidden" accept="image/*" onChange={handleFileSelect} />
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                </label>

                <button 
                  onMouseDown={startRecording}
                  onMouseUp={stopRecording}
                  onTouchStart={startRecording}
                  onTouchEnd={stopRecording}
                  className={`p-4 rounded-full transition-all active:scale-95 ${isRecording ? 'text-red-500 bg-red-500/10' : 'text-neutral-400 hover:text-white hover:bg-white/5'}`}
                  title="Hold to record"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill={isRecording ? "currentColor" : "none"} viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                  </svg>
                </button>

                <textarea
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                        if(e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            handleSend();
                        }
                    }}
                    placeholder={isRecording ? "Listening..." : "Ask me anything..."}
                    className="flex-1 bg-transparent border-none text-neutral-100 placeholder-neutral-500 focus:ring-0 resize-none py-4 max-h-32 min-h-[56px] text-base leading-relaxed"
                    rows={1}
                />

                <button 
                    onClick={handleSend}
                    disabled={isLoading || (!input.trim() && !attachment)}
                    className="p-4 bg-white text-black hover:bg-neutral-200 disabled:bg-neutral-800 disabled:text-neutral-600 rounded-[1.5rem] transition-all duration-200 active:scale-95 shadow-lg shadow-white/5"
                >
                    {isLoading ? (
                        <div className="w-5 h-5 border-2 border-black/30 border-t-black rounded-full animate-spin"></div>
                    ) : (
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                            <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" />
                        </svg>
                    )}
                </button>
            </div>
            
        </div>
      </div>
    </div>
  );
};

export default App;