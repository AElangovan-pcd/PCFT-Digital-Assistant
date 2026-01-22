
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { MessageRole, ChatMessage, AppMode } from './types';
import { GeminiService } from './services/geminiService';
import { APP_TITLE, APP_SUBTITLE, PCFT_CONTRACT_CONTEXT } from './constants';
import { GoogleGenAI, LiveServerMessage, Modality, Blob } from '@google/genai';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

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
  
  // Transcripts for the active turn in Live Mode
  const [currentAiTranscript, setCurrentAiTranscript] = useState('');
  const [currentUserTranscript, setCurrentUserTranscript] = useState('');
  
  // Accumulate full transcripts for the chat history
  const activeAiTranscriptRef = useRef('');
  const activeUserTranscriptRef = useRef('');
  
  // States
  const [bookmarks, setBookmarks] = useState<ChatMessage[]>(() => {
    const saved = localStorage.getItem('pcft_bookmarks');
    return saved ? JSON.parse(saved) : [];
  });
  const [showBookmarks, setShowBookmarks] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const gemini = useRef(new GeminiService());
  const contactMenuRef = useRef<HTMLDivElement>(null);

  // Live API & Audio Refs
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
  }, [messages, scrollToBottom, currentAiTranscript]);

  useEffect(() => {
    if (messages.length === 0) {
      setMessages([{
        id: '1',
        role: MessageRole.ASSISTANT,
        content: "Welcome, colleague. I am your **PCFT Digital Assistant**. \n\nHow can I help you understand your rights, workload, or the grievance procedure today?",
        timestamp: new Date()
      }]);
    }
  }, []);

  useEffect(() => {
    localStorage.setItem('pcft_bookmarks', JSON.stringify(bookmarks));
  }, [bookmarks]);

  // Close contact menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (contactMenuRef.current && !contactMenuRef.current.contains(event.target as Node)) {
        setShowContactMenu(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const toggleBookmark = (message: ChatMessage) => {
    setBookmarks(prev => {
      const exists = prev.find(b => b.id === message.id);
      if (exists) {
        return prev.filter(b => b.id !== message.id);
      }
      return [...prev, { ...message, isBookmarked: true }];
    });
    setMessages(prev => prev.map(m => m.id === message.id ? { ...m, isBookmarked: !m.isBookmarked } : m));
  };

  const handleTTS = async (message: ChatMessage) => {
    if (isSpeaking === message.id) return;
    setIsSpeaking(message.id);

    const base64Audio = await gemini.current.generateSpeech(message.content);
    if (base64Audio) {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      const audioBuffer = await decodeAudioData(decode(base64Audio), ctx, 24000, 1);
      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(ctx.destination);
      source.onended = () => {
        setIsSpeaking(null);
        ctx.close();
      };
      source.start();
    } else {
      setIsSpeaking(null);
    }
  };

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

    const assistantId = (Date.now() + 1).toString();
    setMessages(prev => [...prev, {
      id: assistantId,
      role: MessageRole.ASSISTANT,
      content: '',
      timestamp: new Date()
    }]);

    try {
      const history = messages.slice(-10).map(m => ({
        role: m.role,
        content: m.content
      }));
      
      const stream = gemini.current.generateTextResponseStream(query, history, isThinkingEnabled);
      let fullContent = '';
      
      for await (const chunk of stream) {
        fullContent += chunk;
        setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: fullContent } : m));
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  const emailExecBoard = () => {
    const emails = "LMurray@pierce.ctc.edu,ABluitt@pierce.ctc.edu";
    const subject = encodeURIComponent("Contract Inquiry via PCFT Assistant");
    window.location.href = `mailto:${emails}?subject=${subject}`;
    setShowContactMenu(false);
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
            // 1. Handle Audio Playback
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

            // 2. Handle AI Output Transcriptions (Captions)
            if (message.serverContent?.outputTranscription) {
              const text = message.serverContent.outputTranscription.text;
              activeAiTranscriptRef.current += text;
              setCurrentAiTranscript(activeAiTranscriptRef.current);
            }

            // 3. Handle User Input Transcriptions
            if (message.serverContent?.inputTranscription) {
              const text = message.serverContent.inputTranscription.text;
              activeUserTranscriptRef.current += text;
              setCurrentUserTranscript(activeUserTranscriptRef.current);
            }

            // 4. Handle Interruption
            if (message.serverContent?.interrupted) {
              activeSourcesRef.current.forEach(s => s.stop());
              activeSourcesRef.current.clear();
              nextStartTimeRef.current = 0;
            }

            // 5. Handle Turn Complete (Store in Chat History)
            if (message.serverContent?.turnComplete) {
              const finalUser = activeUserTranscriptRef.current;
              const finalAi = activeAiTranscriptRef.current;
              
              const newMsgs: ChatMessage[] = [];
              if (finalUser.trim()) {
                newMsgs.push({
                  id: Date.now().toString() + "-user",
                  role: MessageRole.USER,
                  content: finalUser.trim(),
                  timestamp: new Date()
                });
              }
              if (finalAi.trim()) {
                newMsgs.push({
                  id: (Date.now() + 1).toString() + "-ai",
                  role: MessageRole.ASSISTANT,
                  content: finalAi.trim(),
                  timestamp: new Date()
                });
              }

              if (newMsgs.length > 0) {
                setMessages(prev => [...prev, ...newMsgs]);
              }

              // Reset buffers for next turn
              activeAiTranscriptRef.current = '';
              activeUserTranscriptRef.current = '';
              setCurrentAiTranscript('');
              setCurrentUserTranscript('');
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
          systemInstruction: PCFT_CONTRACT_CONTEXT + "\nYou are in LIVE MODE. Provide short, concise verbal answers.",
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
    setCurrentAiTranscript('');
    setCurrentUserTranscript('');
    activeAiTranscriptRef.current = '';
    activeUserTranscriptRef.current = '';
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

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden text-gray-900">
      {/* Sidebar */}
      <aside className={`${isSidebarOpen ? 'w-80' : 'w-0'} bg-[#002B44] text-white transition-all duration-300 flex flex-col overflow-hidden shadow-2xl z-20`}>
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
            <div className="flex items-center justify-between px-2 mb-2">
              <h3 className="text-[11px] font-bold text-blue-400 uppercase tracking-widest">Contract Knowledge</h3>
              <button 
                onClick={() => setShowBookmarks(!showBookmarks)}
                className={`p-1 rounded hover:bg-blue-800 transition-colors ${showBookmarks ? 'text-yellow-400' : 'text-blue-400'}`}
                title="View Bookmarks"
              >
                <svg className="w-4 h-4" fill={showBookmarks ? "currentColor" : "none"} stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
                </svg>
              </button>
            </div>
            
            {showBookmarks ? (
              <div className="space-y-2 animate-in fade-in slide-in-from-left-2">
                {bookmarks.length === 0 ? (
                  <p className="px-2 text-[10px] italic text-blue-300">No bookmarks saved yet.</p>
                ) : (
                  bookmarks.map(b => (
                    <div 
                      key={b.id} 
                      className="group p-3 bg-blue-900/20 border border-blue-800 rounded-lg hover:bg-blue-800/40 transition-all cursor-pointer relative"
                      onClick={() => setMessages(prev => [...prev, b])}
                    >
                      <p className="text-xs text-blue-100 line-clamp-3 leading-relaxed">{b.content}</p>
                      <button 
                        className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity text-red-400 hover:text-red-300"
                        onClick={(e) => { e.stopPropagation(); toggleBookmark(b); }}
                      >
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  ))
                )}
                <button 
                  onClick={() => setShowBookmarks(false)}
                  className="w-full text-center py-2 text-[10px] text-blue-400 hover:text-white uppercase font-bold tracking-widest border-t border-blue-900 mt-2"
                >
                  Back to Topics
                </button>
              </div>
            ) : (
              [
                { label: "Faculty Load & Preps", q: "What is the faculty load, including maximum preparations and credit hours?" },
                { label: "Class Size Limits", q: "What are the maximum class sizes for grounded and online courses?" },
                { label: "Grievance Procedure", q: "Explain the grievance procedure as outlined in the PCFT agreement." },
                { label: "Sick Leave Policy", q: "How does sick leave work under the contract?" },
                { label: "High Demand Stipend", q: "Explain the High Demand/High Wage MOU" },
                { label: "Nursing Stipend", q: "What are the details of the Nursing Faculty MOU?" }
              ].map((item, idx) => (
                <button 
                  key={idx} 
                  className="w-full text-left px-3 py-2 text-sm rounded-md hover:bg-blue-800 transition-colors text-blue-100"
                  onClick={() => handleSend(undefined, item.q)}
                >
                  {item.label}
                </button>
              ))
            )}
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
                </p>
              </div>
            )}
          </div>
          
          <button 
            className="w-full bg-red-600 hover:bg-red-500 text-white font-bold py-3 px-4 rounded-xl flex items-center justify-center gap-2 transition-all hover:shadow-lg active:scale-95 text-sm"
            onClick={() => window.open('https://pcft.wa.aft.org/grievance-form', '_blank')}
          >
            File a Grievance
          </button>

          <div className="relative">
            <button 
              className="w-full bg-yellow-500 hover:bg-yellow-400 text-[#003B5C] font-bold py-3 px-4 rounded-xl flex items-center justify-center gap-2 transition-all hover:shadow-lg active:scale-95 text-sm"
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
                  Email President & VP
                </button>
                <div className="bg-gray-50 px-4 py-2 text-[10px] text-gray-400 font-semibold uppercase tracking-wider">
                  Lisa M. Murray & Aaron Bluitt
                </div>
              </div>
            )}
          </div>
        </div>
      </aside>

      {/* Main Area */}
      <main className="flex-1 flex flex-col relative bg-white">
        {/* Header */}
        <header className="h-16 bg-white border-b flex items-center justify-between px-6 shrink-0 z-10 shadow-sm">
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
              <h2 className="font-bold text-gray-800 tracking-tight leading-none mb-1">{APP_TITLE}</h2>
              <div className="flex items-center gap-1.5">
                 <span className={`w-1.5 h-1.5 rounded-full ${isLoading || isLiveActive ? 'bg-yellow-500 animate-pulse' : 'bg-green-500'}`}></span>
                 <p className="text-[9px] font-bold text-gray-400 uppercase tracking-widest">
                   {isLiveActive ? 'Live Audio Session' : isLoading ? 'Contract Assistant Working...' : 'Verified Contract Data Active'}
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
          </div>
        </header>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 md:p-8 space-y-8 bg-gray-50/50">
          {messages.map((m) => (
            <div 
              key={m.id} 
              className={`flex ${m.role === MessageRole.USER ? 'justify-end' : 'justify-start'} animate-in fade-in slide-in-from-bottom-4 duration-500`}
            >
              <div className={`max-w-[95%] md:max-w-[85%] lg:max-w-[75%] flex gap-4 ${m.role === MessageRole.USER ? 'flex-row-reverse' : ''}`}>
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 shadow-md transition-transform hover:scale-105
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
                <div className={`relative group p-6 rounded-2xl shadow-sm
                  ${m.role === MessageRole.USER ? 'bg-[#003B5C] text-white rounded-tr-none' : 'bg-white text-gray-800 border border-gray-100 rounded-tl-none'}
                `}>
                   {/* Actions (Bookmark & TTS) */}
                   {m.role === MessageRole.ASSISTANT && (
                     <div className="absolute -top-3 right-4 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button 
                          onClick={() => handleTTS(m)}
                          className={`p-2 rounded-full shadow-lg border transition-all ${isSpeaking === m.id ? 'bg-blue-600 text-white animate-pulse' : 'bg-white text-blue-600 hover:bg-blue-50'}`}
                          title="Read Aloud"
                        >
                           <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                             <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                           </svg>
                        </button>
                        <button 
                          onClick={() => toggleBookmark(m)}
                          className={`p-2 rounded-full shadow-lg border transition-all ${m.isBookmarked || bookmarks.find(b => b.id === m.id) ? 'bg-yellow-400 text-white' : 'bg-white text-gray-400 hover:bg-gray-50'}`}
                          title="Bookmark Response"
                        >
                           <svg className="w-3.5 h-3.5" fill={m.isBookmarked ? "currentColor" : "none"} stroke="currentColor" viewBox="0 0 24 24">
                             <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
                           </svg>
                        </button>
                     </div>
                   )}

                   {/* Rich Text Content */}
                   <div className="prose prose-blue max-w-none text-[15px] leading-relaxed">
                      {m.role === MessageRole.USER ? (
                        <p className="font-medium">{m.content}</p>
                      ) : (
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {m.content || "*(Generating contract analysis...)*"}
                        </ReactMarkdown>
                      )}
                   </div>
                   
                   <div className={`mt-4 text-[9px] font-bold uppercase tracking-widest opacity-40 ${m.role === MessageRole.USER ? 'text-right' : 'text-left'}`}>
                     {m.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                   </div>
                </div>
              </div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        {/* Input Area */}
        <div className="p-6 bg-white border-t border-gray-100">
          {isLiveActive ? (
            <div className="max-w-4xl mx-auto flex flex-col items-center gap-6 py-6 animate-in zoom-in duration-300">
              <div className="relative">
                 <div className="absolute inset-0 bg-blue-500 rounded-full animate-ping opacity-25"></div>
                 <div className="relative w-24 h-24 bg-blue-600 rounded-full flex items-center justify-center text-white shadow-2xl">
                    <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                    </svg>
                 </div>
              </div>

              {/* LIVE CAPTIONS OVERLAY */}
              <div className="w-full max-w-2xl bg-[#001D2D]/90 backdrop-blur-md rounded-2xl p-6 border border-blue-900/50 shadow-2xl min-h-[160px] flex flex-col items-center justify-center text-center">
                 {currentAiTranscript ? (
                   <div className="animate-in fade-in slide-in-from-bottom-2">
                     <p className="text-blue-400 text-[10px] uppercase font-bold tracking-widest mb-2">AI Speaking</p>
                     <p className="text-white text-xl font-medium leading-relaxed italic">
                       "{currentAiTranscript}"
                     </p>
                   </div>
                 ) : currentUserTranscript ? (
                   <div className="animate-in fade-in slide-in-from-bottom-2">
                     <p className="text-green-400 text-[10px] uppercase font-bold tracking-widest mb-2">Listening to You</p>
                     <p className="text-gray-300 text-lg font-medium leading-relaxed">
                       {currentUserTranscript}...
                     </p>
                   </div>
                 ) : (
                   <p className="text-gray-500 text-sm font-medium tracking-wide animate-pulse">
                     Speak clearly. The digital assistant is listening...
                   </p>
                 )}
              </div>

              <div className="flex gap-4">
                <button 
                  onClick={stopLiveMode}
                  className="bg-red-500 text-white px-10 py-3 rounded-full font-bold hover:bg-red-600 transition-all shadow-lg hover:scale-105 active:scale-95"
                >
                  End Session
                </button>
              </div>
            </div>
          ) : (
            <form 
              onSubmit={handleSend}
              className="max-w-4xl mx-auto flex items-center gap-4 bg-white border-2 border-gray-100 rounded-2xl p-2 focus-within:border-blue-500 transition-all shadow-lg"
            >
              <button 
                type="button"
                onClick={toggleLive}
                className="p-3 rounded-xl transition-all hover:bg-gray-100 text-gray-400"
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
                placeholder="Ask about your rights or workload..."
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
          )}
        </div>
      </main>
    </div>
  );
};

export default App;
