import React, { useEffect, useRef, useState } from 'react';
import { LiveSession } from '../services/geminiService';
import { decodeAudioData, b64ToUint8Array } from '../services/audioUtils';

interface Props {
  onClose: () => void;
}

const LiveInterface: React.FC<Props> = ({ onClose }) => {
  const [status, setStatus] = useState<'connecting' | 'active' | 'error' | 'disconnected'>('connecting');
  const sessionRef = useRef<LiveSession | null>(null);
  
  // Audio Contexts
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
      // 1. Setup Output Audio
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      outputCtxRef.current = new AudioContextClass({ sampleRate: 24000 });
      
      // 2. Setup Input Audio
      inputCtxRef.current = new AudioContextClass({ sampleRate: 16000 });
      streamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true });
      const source = inputCtxRef.current.createMediaStreamSource(streamRef.current);
      
      // 3. Setup Processor (Deprecated but works for raw PCM stream)
      processorRef.current = inputCtxRef.current.createScriptProcessor(4096, 1, 1);
      
      // 4. Init Session
      sessionRef.current = new LiveSession(
        (b64Audio) => playAudio(b64Audio),
        () => setStatus('disconnected')
      );

      await sessionRef.current.connect();
      setStatus('active');

      // 5. Connect Input Stream
      processorRef.current.onaudioprocess = (e) => {
        const inputData = e.inputBuffer.getChannelData(0);
        // Send to Gemini
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
    
    // Sync logic
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
    if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
    }
    if (processorRef.current) processorRef.current.disconnect();
    if (inputCtxRef.current) inputCtxRef.current.close();
    if (outputCtxRef.current) outputCtxRef.current.close();
    sessionRef.current?.disconnect();
  };

  return (
    <div className="flex flex-col items-center justify-center h-full w-full bg-gradient-to-b from-slate-900 to-indigo-950 text-white">
      <div className="mb-8 relative">
        <div className={`w-32 h-32 rounded-full flex items-center justify-center transition-all duration-500 ${status === 'active' ? 'bg-blue-500 shadow-[0_0_50px_rgba(59,130,246,0.5)] animate-pulse' : 'bg-slate-700'}`}>
          <svg xmlns="http://www.w3.org/2000/svg" className="h-16 w-16 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
          </svg>
        </div>
        {status === 'active' && (
          <div className="absolute -inset-4 border-2 border-blue-400/30 rounded-full animate-ping"></div>
        )}
      </div>

      <h2 className="text-3xl font-display font-bold mb-2">Gemini Live</h2>
      <p className="text-slate-400 mb-8 text-center max-w-md">
        {status === 'connecting' ? 'Establishing connection...' : 
         status === 'active' ? 'Listening. Go ahead and speak.' :
         status === 'error' ? 'Connection failed.' : 'Disconnected.'}
      </p>

      <button 
        onClick={onClose}
        className="px-8 py-3 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/50 rounded-full font-medium transition-colors"
      >
        End Session
      </button>
    </div>
  );
};

export default LiveInterface;
