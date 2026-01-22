
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { MessageRole, ChatMessage, AppMode } from './types';
import { GeminiService } from './services/geminiService';
import { APP_TITLE, APP_SUBTITLE, PCFT_CONTRACT_CONTEXT } from './constants';
import { GoogleGenAI, LiveServerMessage, Modality, Blob } from '@google/genai';

// Audio Utility Functions
function decode(base64: string) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number,
  numChannels: number,
): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

function encode(bytes: Uint8Array) {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function createBlob(data: Float32Array): Blob {
  const l = data.length;
  const int16 = new Int16Array(l);
  for (let i = 0; i < l; i++) {
    int16[i] = data[i] * 32768;
  }
  return {
    data: encode(new Uint8Array(int16.buffer)),
    mimeType: 'audio/pcm;rate=16000',
  };
}

const App: React.FC = () => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [mode, setMode] = useState<AppMode>(AppMode.TEXT);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isThinkingEnabled, setIsThinkingEnabled] = useState(true);
  const [showThinkingInfo, setShowThinkingInfo] = useState(false);
  const [showContactMenu, setShowContactMenu] = useState(false);
  const [isLiveActive, setIsLiveActive] = useState(false);
  const [liveTranscription, setLiveTranscription] = useState('');
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const gemini = useRef(new GeminiService());
  const contactMenuRef = useRef<HTMLDivElement>(null);

  // Live API Refs
  const audioContextRef = useRef<{ input: AudioContext; output: AudioContext } | null>(null);
  const nextStartTimeRef = useRef(0);
  const activeSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const sessionRef = useRef<any>(null);
  const liveStreamRef = useRef<MediaStream | null>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom, liveTranscription]);

  useEffect(() => {
    if (messages.length === 0) {
      setMessages([{
        id: '1',
        role: MessageRole.ASSISTANT,
        content: "Welcome, colleague. I am your PCFT Contract Assistant. How can I help you understand your rights, workload, or the grievance procedure today?",
        timestamp: new Date()
      }]);
    }
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (contactMenuRef.current && !contactMenuRef.current.contains(event.target as Node)) {
        setShowContactMenu(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSend = async (e?: React.FormEvent, customInput?: string) => {
    e?.preventDefault();
    const query = customInput || input;
    if (!query.trim() || isLoading) return;

    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      role: MessageRole.USER,
      content: query,
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMessage]);
    if (!customInput) setInput('');
    setIsLoading(true);

    try {
      const history = messages.slice(-10).map(m => ({
        role: m.role,
        content: m.content
      }));
      
      const response = await gemini.current.generateTextResponse(query, history, isThinkingEnabled);
      
      const assistantMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: MessageRole.ASSISTANT,
        content: response || "I'm sorry, I couldn't process that.",
        timestamp: new Date()
      };
      
      setMessages(prev => [...prev, assistantMessage]);
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  const startLiveMode = async () => {
    try {
      setIsLoading(true);
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });
      
      const inputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      const outputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      audioContextRef.current = { input: inputCtx, output: outputCtx };
      
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      liveStreamRef.current = stream;

      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        callbacks: {
          onopen: () => {
            setIsLiveActive(true);
            setIsLoading(false);
            const source = inputCtx.createMediaStreamSource(stream);
            const scriptProcessor = inputCtx.createScriptProcessor(4096, 1, 1);
            
            scriptProcessor.onaudioprocess = (audioProcessingEvent) => {
              const inputData = audioProcessingEvent.inputBuffer.getChannelData(0);
              const pcmBlob = createBlob(inputData);
              sessionPromise.then((session) => {
                session.sendRealtimeInput({ media: pcmBlob });
              });
            };
            
            source.connect(scriptProcessor);
            scriptProcessor.connect(inputCtx.destination);
          },
          onmessage: async (message: LiveServerMessage) => {
            // Handle Audio Output
            const base64Audio = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
            if (base64Audio) {
              const outCtx = audioContextRef.current!.output;
              nextStartTimeRef.current = Math.max(nextStartTimeRef.current, outCtx.currentTime);
              
              const audioBuffer = await decodeAudioData(decode(base64Audio), outCtx, 24000, 1);
              const source = outCtx.createBufferSource();
              source.buffer = audioBuffer;
              source.connect(outCtx.destination);
              
              source.addEventListener('ended', () => {
                activeSourcesRef.current.delete(source);
              });

              source.start(nextStartTimeRef.current);
              nextStartTimeRef.current += audioBuffer.duration;
              activeSourcesRef.current.add(source);
            }

            // Handle Transcriptions
            if (message.serverContent?.outputTranscription) {
              setLiveTranscription(prev => prev + message.serverContent!.outputTranscription!.text);
            }

            if (message.serverContent?.interrupted) {
              activeSourcesRef.current.forEach(s => s.stop());
              activeSourcesRef.current.clear();
              nextStartTimeRef.current = 0;
            }

            if (message.serverContent?.turnComplete) {
              setMessages(prev => [...prev, {
                id: Date.now().toString(),
                role: MessageRole.ASSISTANT,
                content: "[Live Response Completed]",
                timestamp: new Date()
              }]);
              setLiveTranscription('');
            }
          },
          onerror: (e) => {
            console.error("Live Error:", e);
            stopLiveMode();
          },
          onclose: () => {
            setIsLiveActive(false);
          }
        },
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } },
          },
          systemInstruction: PCFT_CONTRACT_CONTEXT + "\nYou are in LIVE MODE. Provide short, concise verbal answers. Use plain language for audio clarity.",
          outputAudioTranscription: {},
          inputAudioTranscription: {},
        }
      });

      sessionRef.current = await sessionPromise;
    } catch (err) {
      console.error("Failed to start live mode:", err);
      setIsLoading(false);
    }
  };

  const stopLiveMode = () => {
    if (sessionRef.current) {
      sessionRef.current.close();
      sessionRef.current = null;
    }
    if (liveStreamRef.current) {
      liveStreamRef.current.getTracks().forEach(track => track.stop());
      liveStreamRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.input.close();
      audioContextRef.current.output.close();
      audioContextRef.current = null;
    }
    setIsLiveActive(false);
    setLiveTranscription('');
    activeSourcesRef.current.forEach(s => s.stop());
    activeSourcesRef.current.clear();
  };

  const toggleLive = () => {
    if (isLiveActive) {
      stopLiveMode();
    } else {
      startLiveMode();
    }
  };

  const emailExecBoard = () => {
    const emails = "president@pcft.wa.aft.org,vicepresident@pcft.wa.aft.org,treasurer@pcft.wa.aft.org";
    const subject = encodeURIComponent("Contract Inquiry via PCFT Assistant");
    window.location.href = `mailto:${emails}?subject=${subject}`;
    setShowContactMenu(false);
  };

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden text-gray-900">
      {/* Sidebar */}
      <aside 
        className={`${isSidebarOpen ? 'w-80' : 'w-0'} bg-[#002B44] text-white transition-all duration-300 flex flex-col overflow-hidden shadow-2xl z-20`}
      >
        <div className="p-6 border-b border-blue-900 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-yellow-400 rounded-lg flex items-center justify-center shadow-inner">
              <svg className="w-6 h-6 text-[#003B5C]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
              </svg>
            </div>
            <div>
              <h1 className="font-bold text-lg leading-tight tracking-tight text-white">PCFT Union</h1>
              <p className="text-[10px] text-blue-300 uppercase font-semibold tracking-widest">Digital Assistant</p>
            </div>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto p-4 space-y-4">
          <div className="space-y-1">
            <h3 className="text-[11px] font-bold text-blue-400 uppercase tracking-widest px-2 mb-2">Contract Knowledge</h3>
            {[
              { label: "Faculty Load & Preps", q: "What is the faculty load, including maximum preparations and credit hours?" },
              { label: "Class Size Limits", q: "What are the maximum class sizes for grounded and online courses?" },
              { label: "Grievance Procedure", q: "Explain the grievance procedure as outlined in the PCFT collective bargaining agreement, detailing the steps, time limits, and required documentation." },
              { label: "Sick Leave Policy", q: "How does sick leave work under the contract?" },
              { label: "RIF Layoff Order", q: "What is the RIF layoff order for faculty?" }
            ].map((item, idx) => (
              <button 
                key={idx} 
                className="w-full text-left px-3 py-2 text-sm rounded-md hover:bg-blue-800 transition-colors text-blue-100"
                onClick={() => handleSend(undefined, item.q)}
              >
                {item.label}
              </button>
            ))}
          </div>

          <div className="space-y-1 mt-8">
            <h3 className="text-[11px] font-bold text-blue-400 uppercase tracking-widest px-2 mb-2">MOUs & Stipends</h3>
            {[
              { label: "High Demand Stipend", q: "Explain the High Demand/High Wage MOU" },
              { label: "Nursing Stipend", q: "What are the details of the Nursing Faculty MOU?" },
              { label: "Digital Accessibility", q: "Tell me about the Title II Accessibility stipend." }
            ].map((item, idx) => (
              <button 
                key={idx} 
                className="w-full text-left px-3 py-2 text-sm rounded-md hover:bg-blue-800 transition-colors text-blue-100"
                onClick={() => handleSend(undefined, item.q)}
              >
                {item.label}
              </button>
            ))}
          </div>
        </nav>

        <div className="p-4 bg-[#001D2D] border-t border-blue-900 shrink-0 space-y-3 relative" ref={contactMenuRef}>
          <div className="relative">
            <div className="flex items-center justify-between mb-1 px-2">
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-blue-200 font-medium">Thinking Mode</span>
                <button 
                  onMouseEnter={() => setShowThinkingInfo(true)}
                  onMouseLeave={() => setShowThinkingInfo(false)}
                  className="text-blue-400 hover:text-white transition-colors"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </button>
              </div>
              <button 
                onClick={() => setIsThinkingEnabled(!isThinkingEnabled)}
                className={`w-10 h-5 rounded-full relative transition-colors ${isThinkingEnabled ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.5)]' : 'bg-gray-600'}`}
              >
                <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-transform ${isThinkingEnabled ? 'left-6' : 'left-1'}`}></div>
              </button>
            </div>
            {showThinkingInfo && (
              <div className="absolute bottom-full mb-2 left-0 right-0 bg-blue-900 p-3 rounded-lg text-[11px] text-blue-50 border border-blue-700 shadow-xl z-30 animate-in fade-in slide-in-from-bottom-2">
                <strong>What is Thinking Mode?</strong>
                <p className="mt-1 opacity-90 leading-relaxed">
                  Enables deep reasoning. The AI cross-references multiple articles and scenarios before responding. 
                  Best for complex workload or legalistic grievance questions.
                </p>
              </div>
            )}
          </div>
          
          <button 
            className="w-full bg-red-600 hover:bg-red-500 text-white font-bold py-3 px-4 rounded-xl flex items-center justify-center gap-2 transition-all hover:shadow-lg active:scale-95"
            onClick={() => window.open('https://pcft.wa.aft.org/grievance-form', '_blank')}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            File a Grievance
          </button>

          <div className="relative">
            <button 
              className="w-full bg-yellow-500 hover:bg-yellow-400 text-[#003B5C] font-bold py-3 px-4 rounded-xl flex items-center justify-center gap-2 transition-all hover:shadow-lg active:scale-95"
              onClick={() => setShowContactMenu(!showContactMenu)}
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                <path d="M2.003 5.884L10 9.882l7.997-3.998A2 2 0 0016 4H4a2 2 0 00-1.997 1.884z" />
                <path d="M18 8.118l-8 4-8-4V14a2 2 0 002 2h12a2 2 0 002-2V8.118z" />
              </svg>
              Contact Union
              <svg className={`w-4 h-4 transition-transform ${showContactMenu ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            
            {showContactMenu && (
              <div className="absolute bottom-full mb-2 left-0 right-0 bg-white rounded-xl shadow-2xl border border-gray-100 overflow-hidden animate-in fade-in slide-in-from-bottom-2 z-50">
                <button 
                  onClick={() => { window.open('https://pcft.wa.aft.org/contact-us', '_blank'); setShowContactMenu(false); }}
                  className="w-full text-left px-4 py-3 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-3 border-b border-gray-50 transition-colors"
                >
                  <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
                  </svg>
                  Visit PCFT Website
                </button>
                <button 
                  onClick={emailExecBoard}
                  className="w-full text-left px-4 py-3 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-3 transition-colors"
                >
                  <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                  Email Executive Board
                </button>
                <div className="bg-gray-50 px-4 py-2 text-[10px] text-gray-400 font-semibold uppercase tracking-wider">
                  President, VP & Treasurer
                </div>
              </div>
            )}
          </div>
        </div>
      </aside>

      {/* Main Area */}
      <main className="flex-1 flex flex-col relative bg-white">
        {/* Header */}
        <header className="h-16 bg-white border-b flex items-center justify-between px-6 shrink-0 z-10">
          <div className="flex items-center gap-4">
            <button 
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
              className="p-2 hover:bg-gray-100 rounded-lg text-gray-500 transition-colors"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            <div className="flex flex-col">
              <h2 className="font-bold text-gray-800 tracking-tight">{APP_TITLE}</h2>
              <div className="flex items-center gap-1.5">
                 <span className={`w-1.5 h-1.5 rounded-full ${isLoading || isLiveActive ? 'bg-yellow-500 animate-pulse' : 'bg-green-500'}`}></span>
                 <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
                   {isLiveActive ? 'Live Audio Conversation' : isLoading ? (isThinkingEnabled ? 'Analyzing Contract Articles...' : 'Generating...') : 'System Ready'}
                 </p>
              </div>
            </div>
          </div>
          
          <div className="flex items-center gap-4">
             <button 
              onClick={toggleLive}
              className={`flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-bold transition-all shadow-sm ${isLiveActive ? 'bg-red-500 text-white' : 'bg-blue-100 text-blue-700 hover:bg-blue-200'}`}
             >
               <div className={`w-2 h-2 rounded-full ${isLiveActive ? 'bg-white animate-ping' : 'bg-blue-600'}`}></div>
               {isLiveActive ? 'STOP LIVE MODE' : 'START LIVE MODE'}
             </button>
             <div className="hidden md:flex flex-col items-end">
                <span className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">Current Contract</span>
                <span className="text-xs text-blue-700 font-semibold">2024 - 2027 CBA</span>
             </div>
          </div>
        </header>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 md:p-8 space-y-8 bg-gray-50/50">
          {messages.map((m) => (
            <div 
              key={m.id} 
              className={`flex ${m.role === MessageRole.USER ? 'justify-end' : 'justify-start'} animate-in fade-in slide-in-from-bottom-4 duration-500`}
            >
              <div className={`max-w-[90%] md:max-w-[75%] flex gap-4 ${m.role === MessageRole.USER ? 'flex-row-reverse' : ''}`}>
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 shadow-md
                  ${m.role === MessageRole.USER ? 'bg-[#003B5C] text-white' : 'bg-white text-blue-700 border border-blue-100'}
                `}>
                  {m.role === MessageRole.USER ? (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                    </svg>
                  ) : (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                    </svg>
                  )}
                </div>
                <div className={`p-5 rounded-2xl shadow-sm text-[15px] leading-relaxed
                  ${m.role === MessageRole.USER ? 'bg-[#003B5C] text-white rounded-tr-none' : 'bg-white text-gray-800 border border-gray-100 rounded-tl-none'}
                `}>
                   <div className="prose prose-blue max-w-none whitespace-pre-wrap font-medium">
                      {m.content}
                   </div>
                   <div className={`mt-3 text-[10px] font-bold uppercase tracking-widest opacity-40 ${m.role === MessageRole.USER ? 'text-right' : 'text-left'}`}>
                     {m.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                   </div>
                </div>
              </div>
            </div>
          ))}
          
          {isLiveActive && liveTranscription && (
            <div className="flex justify-start animate-in fade-in duration-300">
               <div className="flex gap-4 max-w-[75%]">
                 <div className="w-10 h-10 rounded-xl bg-blue-600 text-white flex items-center justify-center shrink-0 shadow-lg animate-pulse">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                    </svg>
                 </div>
                 <div className="bg-blue-50 border border-blue-100 p-5 rounded-2xl rounded-tl-none text-blue-900 shadow-sm italic font-medium">
                    {liveTranscription}...
                 </div>
               </div>
            </div>
          )}

          {isLoading && !isLiveActive && (
            <div className="flex justify-start">
               <div className="bg-white border border-blue-50 rounded-2xl p-6 shadow-sm flex flex-col gap-3 max-w-[80%]">
                 <div className="flex items-center gap-4">
                   <div className="flex gap-1.5">
                      <div className="w-2.5 h-2.5 bg-blue-600 rounded-full animate-bounce"></div>
                      <div className="w-2.5 h-2.5 bg-blue-400 rounded-full animate-bounce [animation-delay:-0.15s]"></div>
                      <div className="w-2.5 h-2.5 bg-blue-200 rounded-full animate-bounce [animation-delay:-0.3s]"></div>
                   </div>
                   {isThinkingEnabled && (
                     <span className="text-xs font-bold text-blue-600 uppercase tracking-widest animate-pulse">
                       Reasoning through contract clauses...
                     </span>
                   )}
                 </div>
                 {isThinkingEnabled && (
                   <div className="text-[11px] text-gray-500 italic border-t pt-2 border-gray-50">
                     Verifying Article 16 grievance timelines and Article 7 workload maximums to ensure a precise answer.
                   </div>
                 )}
               </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input Area */}
        <div className="p-6 bg-white border-t border-gray-100">
          {isLiveActive ? (
            <div className="max-w-4xl mx-auto flex flex-col items-center gap-4 py-4 animate-in zoom-in duration-300">
              <div className="relative">
                 <div className="absolute inset-0 bg-blue-500 rounded-full animate-ping opacity-25"></div>
                 <div className="relative w-20 h-20 bg-blue-600 rounded-full flex items-center justify-center text-white shadow-2xl">
                    <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                    </svg>
                 </div>
              </div>
              <p className="text-sm font-bold text-blue-600 uppercase tracking-widest animate-pulse">Live Session Active - Speaking Allowed</p>
              <button 
                onClick={stopLiveMode}
                className="bg-red-500 text-white px-8 py-2 rounded-full font-bold hover:bg-red-600 transition-colors shadow-lg"
              >
                End Live Conversation
              </button>
            </div>
          ) : (
            <>
              <form 
                onSubmit={handleSend}
                className="max-w-4xl mx-auto flex items-center gap-4 bg-white border-2 border-gray-100 rounded-2xl p-2 focus-within:border-blue-500 transition-all shadow-lg"
              >
                <button 
                  type="button"
                  onClick={toggleLive}
                  className={`p-3 rounded-xl transition-all ${mode === AppMode.VOICE ? 'bg-red-50 text-red-600 scale-110' : 'hover:bg-gray-100 text-gray-400'}`}
                  title="Toggle Live Audio Mode"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                  </svg>
                </button>
                <input 
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Ask a contract question... (e.g., 'What is the grievance timeline?')"
                  className="flex-1 bg-transparent border-none focus:ring-0 text-gray-700 font-medium py-3 px-2 placeholder:text-gray-400"
                />
                <button 
                  type="submit"
                  disabled={!input.trim() || isLoading}
                  className="bg-[#003B5C] hover:bg-blue-800 disabled:opacity-30 text-white px-6 py-3 rounded-xl shadow-md transition-all active:scale-95 font-bold flex items-center gap-2"
                >
                  <span>Ask</span>
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 5l7 7m0 0l-7 7m7-7H3" />
                  </svg>
                </button>
              </form>
              <div className="flex justify-center gap-6 mt-4">
                <p className="text-[10px] text-gray-400 font-bold uppercase tracking-[0.2em]">
                  Exclusively PCFT Data
                </p>
                <p className="text-[10px] text-gray-400 font-bold uppercase tracking-[0.2em]">
                  Union Member Confidentiality
                </p>
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
};

export default App;
