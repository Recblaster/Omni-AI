import React, { useEffect, useRef, useState } from 'react';
import { LiveSession } from '../services/geminiService';
import { decodeAudioData, b64ToUint8Array } from '../services/audioUtils';

interface Props {
  onClose: () => void;
}

const LiveInterface: React.FC<Props> = ({ onClose }) => {
  const [status, setStatus] = useState<'connecting' | 'active' | 'error' | 'disconnected'>('connecting');
  const sessionRef = useRef<LiveSession | null>(null);
  const inputCtxRef = useRef<AudioContext | null>(null);
  const outputCtxRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    startSession();
    return () => stopSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startSession = async () => {
    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      outputCtxRef.current = new AudioContextClass({ sampleRate: 24000 });
      inputCtxRef.current = new AudioContextClass({ sampleRate: 16000 });
      streamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true });
      const source = inputCtxRef.current.createMediaStreamSource(streamRef.current);
      processorRef.current = inputCtxRef.current.createScriptProcessor(4096, 1, 1);
      
      sessionRef.current = new LiveSession(
        (b64Audio) => playAudio(b64Audio),
        () => setStatus('disconnected')
      );

      await sessionRef.current.connect();
      setStatus('active');

      processorRef.current.onaudioprocess = (e) => {
        const inputData = e.inputBuffer.getChannelData(0);
        sessionRef.current?.sendAudio(inputData);
      };

      source.connect(processorRef.current);
      processorRef.current.connect(inputCtxRef.current.destination);

    } catch (err) {
      console.error("Failed to start live session", err);
      setStatus('error');
    }
  };

  const playAudio = async (base64Data: string) => {
    if (!outputCtxRef.current) return;
    const ctx = outputCtxRef.current;
    nextStartTimeRef.current = Math.max(nextStartTimeRef.current, ctx.currentTime);
    const audioBytes = b64ToUint8Array(base64Data);
    const audioBuffer = await decodeAudioData(audioBytes, ctx, 24000, 1);
    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(ctx.destination);
    source.start(nextStartTimeRef.current);
    nextStartTimeRef.current += audioBuffer.duration;
  };

  const stopSession = () => {
    if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
    if (processorRef.current) processorRef.current.disconnect();
    if (inputCtxRef.current) inputCtxRef.current.close();
    if (outputCtxRef.current) outputCtxRef.current.close();
    sessionRef.current?.disconnect();
  };

  return (
    <div className="flex flex-col items-center justify-center h-screen w-full bg-neutral-950 text-white overflow-hidden relative font-sans">
       {/* Ambient Background */}
       <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-indigo-900/20 via-neutral-950 to-neutral-950 pointer-events-none" />

      <div className="relative z-10 flex flex-col items-center">
        <div className="mb-12 relative group">
          <div className={`w-40 h-40 rounded-full flex items-center justify-center transition-all duration-1000 ${status === 'active' ? 'bg-gradient-to-tr from-indigo-500 to-purple-500 shadow-[0_0_100px_rgba(99,102,241,0.3)]' : 'bg-neutral-800'}`}>
             {status === 'active' ? (
                <div className="flex gap-2 items-center h-10">
                   <div className="w-2 bg-white/80 rounded-full animate-[live-pulse_1s_ease-in-out_infinite] h-8"></div>
                   <div className="w-2 bg-white/80 rounded-full animate-[live-pulse_1.2s_ease-in-out_infinite] h-12"></div>
                   <div className="w-2 bg-white/80 rounded-full animate-[live-pulse_0.8s_ease-in-out_infinite] h-6"></div>
                   <div className="w-2 bg-white/80 rounded-full animate-[live-pulse_1.5s_ease-in-out_infinite] h-10"></div>
                </div>
             ) : (
                <svg className="w-12 h-12 text-neutral-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" /></svg>
             )}
          </div>
          
          {status === 'active' && (
             <>
              <div className="absolute -inset-4 border border-indigo-500/30 rounded-full animate-[ping_3s_linear_infinite] opacity-50"></div>
              <div className="absolute -inset-12 border border-indigo-500/10 rounded-full animate-[ping_4s_linear_infinite] opacity-30"></div>
             </>
          )}
        </div>

        <h2 className="text-4xl font-display font-medium mb-3 tracking-tight text-transparent bg-clip-text bg-gradient-to-b from-white to-neutral-400">Gemini Live</h2>
        <p className="text-neutral-500 mb-12 text-lg font-light tracking-wide">
          {status === 'connecting' ? 'Establishing secure connection...' : 
           status === 'active' ? 'Listening...' :
           status === 'error' ? 'Connection failed' : 'Session ended'}
        </p>

        <button 
          onClick={onClose}
          className="group px-10 py-4 bg-white/5 hover:bg-red-500/10 hover:border-red-500/50 border border-white/10 rounded-full font-medium transition-all duration-300 backdrop-blur-md"
        >
          <span className="text-neutral-300 group-hover:text-red-400 transition-colors">End Session</span>
        </button>
      </div>
      
      <style>{`
        @keyframes live-pulse {
          0%, 100% { height: 20%; opacity: 0.5; }
          50% { height: 100%; opacity: 1; }
        }
      `}</style>
    </div>
  );
};

export default LiveInterface;