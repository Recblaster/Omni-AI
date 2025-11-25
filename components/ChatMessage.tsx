import React, { useState, useRef, useEffect } from 'react';
import { ChatMessage as ChatMessageType, MessageRole, ContentBlock } from '../types';
import { decodeAudioData, b64ToUint8Array } from '../services/audioUtils';

interface Props {
  message: ChatMessageType;
}

const ChatMessage: React.FC<Props> = ({ message }) => {
  const isUser = message.role === MessageRole.USER;
  
  return (
    <div className={`flex w-full mb-8 ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[85%] flex flex-col ${isUser ? 'items-end' : 'items-start'}`}>
        
        {/* Author Label */}
        <span className="text-xs text-slate-400 mb-2 ml-1 flex items-center gap-2">
          {isUser ? 'You' : (
            <>
              <span className="font-bold bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">Gemini 3 Pro</span>
              {message.isThinking && <span className="animate-pulse text-slate-500">(Orchestrating...)</span>}
            </>
          )}
        </span>

        <div className="flex flex-col gap-3 w-full">
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
      <div className={`p-4 rounded-2xl shadow-sm text-sm leading-relaxed ${
        isUser 
          ? 'bg-blue-600 text-white rounded-br-none' 
          : 'bg-slate-800 text-slate-200 rounded-bl-none border border-slate-700'
      }`}>
        <div className="whitespace-pre-wrap">{block.content}</div>
        
        {block.grounding && block.grounding.length > 0 && (
          <div className="mt-3 pt-3 border-t border-slate-700/50">
             <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-2">Sources</div>
             <div className="flex flex-wrap gap-2">
               {block.grounding.map((chunk, i) => {
                 if (chunk.web) {
                   return (
                     <a key={i} href={chunk.web.uri} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 bg-slate-900/50 border border-slate-700 hover:border-blue-500/50 px-2 py-1 rounded text-xs text-slate-400 hover:text-blue-300 transition-all truncate max-w-[200px]">
                       <img src={`https://www.google.com/s2/favicons?domain=${new URL(chunk.web.uri).hostname}`} className="w-3 h-3 opacity-60" alt="" />
                       {chunk.web.title}
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
      <div className="relative group overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 max-w-sm">
        <img 
          src={block.url} 
          alt={block.prompt} 
          className="w-full h-auto object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-slate-900/90 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-4">
          <p className="text-xs text-slate-300 line-clamp-2 italic">"{block.prompt}"</p>
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
      // url is data:audio/wav;base64,...
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
    <div className="flex items-center gap-3 p-3 bg-slate-800 border border-slate-700 rounded-xl w-fit">
      <button 
        onClick={play}
        className={`w-10 h-10 flex items-center justify-center rounded-full transition-all ${isPlaying ? 'bg-green-500 text-white shadow-[0_0_15px_rgba(34,197,94,0.4)]' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}
      >
        {isPlaying ? (
          <div className="flex gap-0.5 items-end h-3">
             <div className="w-1 bg-white animate-[bounce_1s_infinite] h-2"></div>
             <div className="w-1 bg-white animate-[bounce_1.2s_infinite] h-3"></div>
             <div className="w-1 bg-white animate-[bounce_0.8s_infinite] h-2"></div>
          </div>
        ) : (
          <svg className="w-4 h-4 ml-0.5" fill="currentColor" viewBox="0 0 20 20"><path d="M6.3 2.841A1.5 1.5 0 004 4.11V15.89a1.5 1.5 0 002.3 1.269l9.344-5.89a1.5 1.5 0 000-2.538L6.3 2.84z" /></svg>
        )}
      </button>
      <div className="flex flex-col">
        <span className="text-xs font-medium text-slate-300">Audio Response</span>
        <span className="text-[10px] text-slate-500 max-w-[150px] truncate">{text || "Gemini Speech"}</span>
      </div>
    </div>
  );
};

export default ChatMessage;
