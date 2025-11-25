import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { ChatMessage as ChatMessageType, MessageRole, ContentBlock } from '../types';
import { decodeAudioData, b64ToUint8Array } from '../services/audioUtils';

interface Props {
  message: ChatMessageType;
}

const ChatMessage: React.FC<Props> = ({ message }) => {
  const isUser = message.role === MessageRole.USER;
  
  return (
    <div className={`flex w-full mb-6 ${isUser ? 'justify-end' : 'justify-start'} animate-in fade-in slide-in-from-bottom-2 duration-500`}>
      <div className={`max-w-[85%] md:max-w-[75%] flex flex-col ${isUser ? 'items-end' : 'items-start'}`}>
        
        {/* Author Label (Only for Model) */}
        {!isUser && (
          <div className="flex items-center gap-2 mb-2 ml-1">
             <div className="w-5 h-5 rounded bg-gradient-to-tr from-indigo-500 to-purple-500 flex items-center justify-center text-[10px] text-white font-bold shadow-sm">G</div>
             <span className="text-xs font-medium text-neutral-400">Gemini</span>
             {message.isThinking && (
               <div className="flex gap-1 ml-1">
                 <div className="w-1 h-1 bg-neutral-500 rounded-full animate-bounce [animation-delay:-0.3s]"></div>
                 <div className="w-1 h-1 bg-neutral-500 rounded-full animate-bounce [animation-delay:-0.15s]"></div>
                 <div className="w-1 h-1 bg-neutral-500 rounded-full animate-bounce"></div>
               </div>
             )}
          </div>
        )}

        <div className="flex flex-col gap-2 w-full">
          {message.content.map((block, idx) => (
            <ContentBlockRenderer key={idx} block={block} isUser={isUser} />
          ))}
        </div>
      </div>
    </div>
  );
};

const ContentBlockRenderer: React.FC<{ block: ContentBlock; isUser: boolean }> = ({ block, isUser }) => {
  if (block.type === 'text') {
    return (
      <div className={`
        px-5 py-3.5 rounded-[1.25rem] text-[0.95rem] leading-relaxed shadow-sm backdrop-blur-sm
        ${isUser 
          ? 'bg-neutral-800 text-neutral-100 rounded-tr-sm border border-white/5' 
          : 'bg-transparent text-neutral-200 pl-0 border-none shadow-none'}
      `}>
        <div className="markdown-content">
          <ReactMarkdown 
            remarkPlugins={[remarkMath]} 
            rehypePlugins={[rehypeKatex]}
            components={{
              // Custom components to override default styles if needed, 
              // mostly handled by CSS class .markdown-content in index.html
              img: ({node, ...props}) => <img {...props} className="rounded-lg max-w-full my-2" alt={props.alt || ''} />,
            }}
          >
            {block.content}
          </ReactMarkdown>
        </div>
        
        {block.grounding && block.grounding.length > 0 && (
          <div className="mt-4 pt-3 border-t border-white/5">
             <div className="text-[10px] uppercase tracking-wider text-neutral-500 font-bold mb-2 flex items-center gap-1">
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" /></svg>
                Sources
             </div>
             <div className="flex flex-wrap gap-2">
               {block.grounding.map((chunk, i) => {
                 if (chunk.web) {
                   return (
                     <a key={i} href={chunk.web.uri} target="_blank" rel="noreferrer" className="flex items-center gap-2 bg-neutral-900 border border-white/10 hover:border-indigo-500/50 hover:bg-neutral-800 px-3 py-1.5 rounded-lg text-xs text-neutral-400 hover:text-indigo-300 transition-all truncate max-w-[240px]">
                       <img src={`https://www.google.com/s2/favicons?domain=${new URL(chunk.web.uri).hostname}`} className="w-3.5 h-3.5 opacity-60 rounded-sm" alt="" />
                       <span className="truncate">{chunk.web.title}</span>
                     </a>
                   );
                 }
                 return null;
               })}
             </div>
          </div>
        )}
      </div>
    );
  }

  if (block.type === 'image') {
    return (
      <div className="relative group overflow-hidden rounded-3xl border border-white/10 bg-neutral-900 shadow-xl max-w-sm my-1">
        <img 
          src={block.url} 
          alt={block.prompt} 
          className="w-full h-auto object-cover transition-transform duration-700 group-hover:scale-105"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-end p-5">
          <p className="text-sm text-white font-medium line-clamp-2">"{block.prompt}"</p>
        </div>
      </div>
    );
  }

  if (block.type === 'audio') {
    return <AudioPlayer url={block.url} text={block.text} />;
  }

  return null;
};

const AudioPlayer: React.FC<{ url: string; text?: string }> = ({ url, text }) => {
  const [isPlaying, setIsPlaying] = useState(false);
  
  const play = async () => {
    if (isPlaying) return;
    setIsPlaying(true);
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const base64 = url.split(',')[1];
      const bytes = b64ToUint8Array(base64);
      const buffer = await decodeAudioData(bytes, audioCtx, 24000, 1);
      
      const source = audioCtx.createBufferSource();
      source.buffer = buffer;
      source.connect(audioCtx.destination);
      source.onended = () => setIsPlaying(false);
      source.start();
    } catch (e) {
      console.error(e);
      setIsPlaying(false);
    }
  };

  return (
    <div className="flex items-center gap-4 p-2 pr-5 bg-neutral-800/50 backdrop-blur-sm border border-white/10 rounded-full w-fit hover:bg-neutral-800 transition-colors my-1">
      <button 
        onClick={play}
        className={`w-10 h-10 flex items-center justify-center rounded-full transition-all duration-300 ${isPlaying ? 'bg-indigo-500 text-white shadow-[0_0_20px_rgba(99,102,241,0.4)] scale-110' : 'bg-neutral-700 text-white hover:bg-neutral-600'}`}
      >
        {isPlaying ? (
          <div className="flex gap-0.5 items-end h-3">
             <div className="w-0.5 bg-white animate-[bounce_1s_infinite] h-2"></div>
             <div className="w-0.5 bg-white animate-[bounce_1.2s_infinite] h-3"></div>
             <div className="w-0.5 bg-white animate-[bounce_0.8s_infinite] h-2"></div>
          </div>
        ) : (
          <svg className="w-4 h-4 ml-0.5" fill="currentColor" viewBox="0 0 20 20"><path d="M6.3 2.841A1.5 1.5 0 004 4.11V15.89a1.5 1.5 0 002.3 1.269l9.344-5.89a1.5 1.5 0 000-2.538L6.3 2.84z" /></svg>
        )}
      </button>
      <div className="flex flex-col">
        <span className="text-xs font-semibold text-neutral-200 tracking-wide">Audio Generated</span>
        <span className="text-[10px] text-neutral-500 max-w-[150px] truncate">{text || "Gemini Speech"}</span>
      </div>
    </div>
  );
};

export default ChatMessage;