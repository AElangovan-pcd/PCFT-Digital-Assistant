import React, { useState, useEffect, useRef } from 'react';
import { Mic, MicOff, Send, MessageSquare, Loader2, Bot, User, FileText } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { sendMessage } from './gemini';
import { useLiveAPI } from './useLiveAPI';
import { Content } from '@google/genai';

export default function App() {
  const [messages, setMessages] = useState<{ role: string, text: string }[]>([]);
  const [context, setContext] = useState<Content[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  
  const bottomRef = useRef<HTMLDivElement>(null);

  const { connect: connectLive, disconnect: disconnectLive, isConnected: isLiveConnected, isConnecting: isLiveConnecting, transcript } = useLiveAPI();

  useEffect(() => {
    // Initial greeting
    setMessages([{ role: 'model', text: 'Hello! I am the PCFT AI Digital Assistant. How can I help you understand your rights, benefits, or the negotiated agreement today?' }]);
  }, []);

  useEffect(() => {
    if (bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, transcript]);

  const handleSend = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!inputValue.trim() || isLoading) return;

    const userMessage = inputValue.trim();
    setInputValue('');
    setMessages(prev => [...prev, { role: 'user', text: userMessage }]);
    setIsLoading(true);
    setError('');

    try {
      const { text, newContext } = await sendMessage(context, userMessage);
      setMessages(prev => [...prev, { role: 'model', text }]);
      setContext(newContext);
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Failed to get a response.');
      setMessages(prev => [...prev, { role: 'system', text: 'Error: ' + (err.message || 'Failed to get a response.') }]);
    } finally {
      setIsLoading(false);
    }
  };

  const toggleLive = () => {
    if (isLiveConnected || isLiveConnecting) {
      disconnectLive();
    } else {
      connectLive();
    }
  };

  return (
    <div className="flex flex-col h-screen bg-slate-50 font-sans text-slate-800">
      {/* Header */}
      <header className="bg-white shadow-sm border-b border-slate-200 px-6 py-4 flex items-center justify-between z-10 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-blue-600 flex items-center justify-center text-white shadow-md">
            <Bot size={24} />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-slate-900 leading-none">PCFT Digital Assistant</h1>
            <p className="text-sm text-slate-500 font-medium">Pierce College Federation of Teachers</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <button
            onClick={() => {
              const key = prompt('Enter your Gemini API Key (saved locally):');
              if (key) {
                localStorage.setItem('gemini_api_key', key);
                alert('API Key saved to your browser!');
                window.location.reload();
              }
            }}
            className="text-sm px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg transition-colors border border-slate-200"
          >
            Set API Key
          </button>
          <button
            onClick={toggleLive}
            disabled={isLiveConnecting}
            className={`flex items-center gap-2 px-4 py-2 rounded-full font-medium transition-all shadow-sm ${
              isLiveConnected 
              ? 'bg-red-50 text-red-600 border border-red-200 hover:bg-red-100'
              : 'bg-white border border-slate-200 hover:bg-slate-50 hover:border-slate-300'
            }`}
          >
            {isLiveConnecting ? (
              <Loader2 size={18} className="animate-spin text-blue-600" />
            ) : isLiveConnected ? (
              <MicOff size={18} />
            ) : (
              <Mic size={18} className="text-blue-600" />
            )}
            {isLiveConnecting ? 'Connecting...' : isLiveConnected ? 'End Voice Session' : 'Start Voice Live'}
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 overflow-hidden flex flex-col sm:flex-row relative">
        {/* Knowledge Base Sidebar hint (optional desktop visual, hidden on mobile for simplicity) */}
        <div className="hidden sm:flex flex-col w-64 border-r border-slate-200 bg-white p-4 shrink-0 overflow-y-auto shadow-[2px_0_10px_rgba(0,0,0,0.02)]">
          <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4 border-b border-slate-100 pb-2">Reference Documents</h2>
          <ul className="space-y-4">
            <li className="flex gap-3 text-sm text-slate-600 items-start">
              <FileText size={16} className="text-blue-500 shrink-0 mt-0.5" />
              <span className="leading-snug">Negotiated Agreement (2024-2027)</span>
            </li>
            <li className="flex gap-3 text-sm text-slate-600 items-start">
              <FileText size={16} className="text-blue-500 shrink-0 mt-0.5" />
              <span className="leading-snug">Nursing MOU (2025-26)</span>
            </li>
            <li className="flex gap-3 text-sm text-slate-600 items-start">
              <FileText size={16} className="text-blue-500 shrink-0 mt-0.5" />
              <span className="leading-snug">High Demand MOU (2025-26)</span>
            </li>
            <li className="flex gap-3 text-sm text-slate-600 items-start">
              <FileText size={16} className="text-blue-500 shrink-0 mt-0.5" />
              <span className="leading-snug">Digital Accessibility MOU (2026)</span>
            </li>
          </ul>
        </div>

        {/* Chat Area */}
        {isLiveConnected ? (
          <div className="flex-1 flex flex-col items-center justify-center p-8 bg-slate-50 relative overflow-hidden">
             {/* Live UI State */}
             <motion.div 
               initial={{ opacity: 0, scale: 0.9 }}
               animate={{ opacity: 1, scale: 1 }}
               className="flex flex-col items-center gap-8"
             >
                <div className="relative">
                  <motion.div
                    animate={{ scale: [1, 1.2, 1] }}
                    transition={{ repeat: Infinity, duration: 2 }}
                    className="absolute inset-0 bg-blue-400 rounded-full blur-xl opacity-30"
                  />
                  <div className="w-32 h-32 bg-white rounded-full flex items-center justify-center shadow-xl border border-slate-100 relative z-10">
                     <Mic size={48} className="text-blue-600" />
                  </div>
                </div>
                <div className="text-center">
                  <h2 className="text-2xl font-bold tracking-tight text-slate-800 mb-2">Live Voice Mode Active</h2>
                  <p className="text-slate-500 px-4 max-w-md">I am listening. Feel free to ask me anything about the PCFT agreement or your faculty rights.</p>
                </div>
                
                {/* Closed Captioning */}
                <div className="w-full max-w-2xl mt-8">
                  <div className="bg-white/80 backdrop-blur-md border border-slate-200 rounded-2xl shadow-sm h-64 overflow-y-auto p-4 flex flex-col space-y-4">
                    {transcript.length === 0 ? (
                      <div className="flex-1 flex items-center justify-center text-slate-400 italic">
                        Start speaking...
                      </div>
                    ) : (
                      transcript.map((msg, i) => (
                        <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                          <div className={`rounded-2xl px-4 py-2 max-w-[80%] ${
                            msg.role === 'user' 
                             ? 'bg-slate-800 text-white rounded-br-sm' 
                             : 'bg-blue-50 text-slate-800 border border-blue-100 rounded-bl-sm'
                          }`}>
                            <p className="text-sm font-medium">{msg.text}</p>
                          </div>
                        </div>
                      ))
                    )}
                    <div ref={bottomRef} />
                  </div>
                </div>
             </motion.div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col relative overflow-hidden bg-white shadow-inner">
            <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">
              <AnimatePresence initial={false}>
                {messages.map((msg, idx) => (
                  <motion.div 
                    key={idx}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} max-w-4xl mx-auto w-full group`}
                  >
                    <div className={`flex gap-3 max-w-[85%] ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                      {msg.role !== 'system' && (
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 shadow-sm transition-transform group-hover:scale-105 ${msg.role === 'user' ? 'bg-slate-800 text-white' : 'bg-blue-600 text-white'}`}>
                          {msg.role === 'user' ? <User size={16} /> : <Bot size={16} />}
                        </div>
                      )}
                      
                      <div className={`rounded-2xl px-5 py-3.5 shadow-sm text-[15px] leading-relaxed ${
                        msg.role === 'user' 
                          ? 'bg-slate-800 text-white rounded-tr-sm' 
                          : msg.role === 'system'
                            ? 'bg-red-50 text-red-800 border border-red-100 rounded-xl w-full text-center'
                            : 'bg-slate-50 text-slate-800 border border-slate-100 rounded-tl-sm prose-slate prose-sm max-w-none'
                      }`}>
                        {msg.role === 'model' ? (
                          <div className="markdown-body custom-md">
                            <Markdown remarkPlugins={[remarkGfm]}>{msg.text}</Markdown>
                          </div>
                        ) : (
                          <p className="whitespace-pre-wrap font-medium">{msg.text}</p>
                        )}
                      </div>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
              
              {isLoading && (
                <motion.div 
                  initial={{ opacity: 0 }} 
                  animate={{ opacity: 1 }}
                  className="flex justify-start max-w-4xl mx-auto w-full"
                >
                  <div className="flex gap-3">
                    <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center shrink-0 text-white shadow-sm">
                      <Bot size={16} />
                    </div>
                    <div className="bg-slate-50 border border-slate-100 rounded-2xl rounded-tl-sm px-5 py-4 shadow-sm flex items-center gap-2">
                       <span className="w-2 h-2 bg-slate-300 rounded-full animate-bounce [animation-delay:-0.3s]"></span>
                       <span className="w-2 h-2 bg-slate-300 rounded-full animate-bounce [animation-delay:-0.15s]"></span>
                       <span className="w-2 h-2 bg-slate-300 rounded-full animate-bounce"></span>
                    </div>
                  </div>
                </motion.div>
              )}
              <div ref={bottomRef} className="h-2" />
            </div>

            <div className="p-4 sm:p-6 bg-white border-t border-slate-100 shadow-[0_-4px_10px_rgba(0,0,0,0.01)]">
              <form onSubmit={handleSend} className="max-w-4xl mx-auto relative flex items-center">
                <input
                  type="text"
                  value={inputValue}
                  onChange={e => setInputValue(e.target.value)}
                  placeholder="Ask about leave, teaching load, stipends, or union rights..."
                  className="w-full bg-slate-50 border border-slate-200 text-slate-900 rounded-full pl-6 pr-14 py-3.5 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-all font-medium placeholder:text-slate-400 placeholder:font-normal shadow-inner text-base"
                  disabled={isLoading}
                />
                <button
                  type="submit"
                  disabled={!inputValue.trim() || isLoading}
                  className="absolute right-2 p-2.5 bg-blue-600 text-white rounded-full hover:bg-blue-700 disabled:opacity-50 disabled:hover:bg-blue-600 transition-colors shadow-sm"
                >
                  <Send size={18} />
                </button>
              </form>
              <div className="text-center mt-3">
                <p className="text-xs text-slate-400">AI assistants can make mistakes. Please verify important information with PCFT leadership.</p>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
