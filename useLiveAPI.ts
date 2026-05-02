import { useState, useRef, useCallback } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import { getAI } from './gemini';
import { SYSTEM_INSTRUCTION } from './knowledge_base';

export function useLiveAPI() {
    const [isConnected, setIsConnected] = useState(false);
    const [isConnecting, setIsConnecting] = useState(false);
    const [transcript, setTranscript] = useState<{role: string, text: string, finished: boolean}[]>([]);
    
    const sessionRef = useRef<any>(null); // from ai.live.connect
    const audioContextRef = useRef<AudioContext | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const processorRef = useRef<ScriptProcessorNode | null>(null);
    const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);

    const playbackContextRef = useRef<AudioContext | null>(null);
    const nextPlaybackTimeRef = useRef<number>(0);

    const addTranscript = (role: string, text: string, finished: boolean) => {
        setTranscript(prev => {
            const last = prev[prev.length - 1];
            if (last && last.role === role && !last.finished) {
                const updated = [...prev];
                let newText = text;
                // If it's accumulating text, it will typically start with the previous text.
                if (text.startsWith(last.text)) {
                    newText = text;
                } else if (last.text.startsWith(text)) {
                    // Just in case it's doing something weird, but normally won't happen
                    newText = last.text;
                } else {
                    // Delta text appending
                    newText = last.text + (last.text.endsWith(' ') || text.startsWith(' ') ? '' : ' ') + text;
                }
                updated[updated.length - 1] = { role, text: newText, finished };
                return updated;
            }
            return [...prev, { role, text, finished }];
        });
    };

    const stopAudio = useCallback(() => {
        if (processorRef.current) {
            processorRef.current.disconnect();
            processorRef.current = null;
        }
        if (sourceRef.current) {
            sourceRef.current.disconnect();
            sourceRef.current = null;
        }
        if (streamRef.current) {
            streamRef.current.getTracks().forEach(t => t.stop());
            streamRef.current = null;
        }
        if (audioContextRef.current) {
            audioContextRef.current.close();
            audioContextRef.current = null;
        }
        if (playbackContextRef.current) {
             playbackContextRef.current.close();
             playbackContextRef.current = null;
        }
        nextPlaybackTimeRef.current = 0;
    }, []);

    const disconnect = useCallback(() => {
        setIsConnecting(false);
        setIsConnected(false);
        if (sessionRef.current) {
            // How to close the session?
            // "Use session.close() when finished"
            // Actually it's a promise, we should await it if we stored the promise, but we stored the resolved session.
            try {
                sessionRef.current.close?.();
            } catch (e) {}
            sessionRef.current = null;
        }
        stopAudio();
    }, [stopAudio]);

    const connect = useCallback(async () => {
        setIsConnecting(true);
        try {
            const ai = getAI();
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
            streamRef.current = stream;

            const audioCtx = new window.AudioContext({ sampleRate: 16000 });
            audioContextRef.current = audioCtx;
            const source = audioCtx.createMediaStreamSource(stream);
            sourceRef.current = source;
            const processor = audioCtx.createScriptProcessor(4096, 1, 1);
            processorRef.current = processor;

            const gainNode = audioCtx.createGain();
            gainNode.gain.value = 0;

            source.connect(processor);
            processor.connect(gainNode);
            gainNode.connect(audioCtx.destination);

            const sessionPromise = ai.live.connect({
                model: "gemini-2.0-flash-exp",
                callbacks: {
                    onopen: () => {
                        setIsConnecting(false);
                        setIsConnected(true);
                        processor.onaudioprocess = (e) => {
                            if (!sessionRef.current) return;
                            const inputData = e.inputBuffer.getChannelData(0);
                            const pcmData = new Int16Array(inputData.length);
                            for (let i = 0; i < inputData.length; i++) {
                                pcmData[i] = Math.max(-32768, Math.min(32767, inputData[i] * 32768));
                            }
                            const buffer = new Uint8Array(pcmData.buffer);
                            let binary = '';
                            // To prevent Maximum call stack size exceeded, chunk it:
                            const chunkSize = 8192;
                            for (let i = 0; i < buffer.length; i += chunkSize) {
                                binary += String.fromCharCode.apply(null, Array.from(buffer.subarray(i, i + chunkSize)));
                            }
                            const base64Data = btoa(binary);

                            sessionPromise.then((session) => {
                                session.sendRealtimeInput({
                                    audio: { data: base64Data, mimeType: 'audio/pcm;rate=16000' }
                                });
                            });
                        };
                    },
                    onmessage: (message: LiveServerMessage) => {
                        // Play audio
                        const base64Audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
                        if (base64Audio) {
                            if (!playbackContextRef.current) {
                                playbackContextRef.current = new window.AudioContext({ sampleRate: 24000 });
                            }
                            const playbackCtx = playbackContextRef.current;
                            if (playbackCtx.state === 'suspended') {
                                playbackCtx.resume();
                            }

                            const binaryStr = atob(base64Audio);
                            const u8 = new Uint8Array(binaryStr.length);
                            for(let i=0; i<binaryStr.length; i++) u8[i] = binaryStr.charCodeAt(i);
                            const i16 = new Int16Array(u8.buffer);
                            const floats = new Float32Array(i16.length);
                            for(let i=0; i<i16.length; i++) {
                                floats[i] = i16[i] / 32768.0;
                            }

                            const audioBuffer = playbackCtx.createBuffer(1, floats.length, 24000);
                            audioBuffer.getChannelData(0).set(floats);
                            const pSource = playbackCtx.createBufferSource();
                            pSource.buffer = audioBuffer;
                            pSource.connect(playbackCtx.destination);
                            
                            const currentTime = playbackCtx.currentTime;
                            if (nextPlaybackTimeRef.current < currentTime) {
                                nextPlaybackTimeRef.current = currentTime;
                            }
                            pSource.start(nextPlaybackTimeRef.current);
                            nextPlaybackTimeRef.current += audioBuffer.duration;
                        }

                        // Interruption
                        if (message.serverContent?.interrupted) {
                            if (playbackContextRef.current) {
                                playbackContextRef.current.close().then(() => {
                                    playbackContextRef.current = new window.AudioContext({ sampleRate: 24000 });
                                    nextPlaybackTimeRef.current = 0;
                                });
                            }
                        }

                        if (message.serverContent?.inputTranscription?.text) {
                            const isFinished = message.serverContent.inputTranscription.finished ?? false;
                            addTranscript('user', message.serverContent.inputTranscription.text, isFinished);
                        }
                        if (message.serverContent?.outputTranscription?.text) {
                            const isFinished = message.serverContent.outputTranscription.finished ?? false;
                            addTranscript('model', message.serverContent.outputTranscription.text, isFinished);
                        }
                    },
                    onerror: (e) => {
                        console.error('Live API Error:', e);
                        alert('Live API WebSocket Error: ' + JSON.stringify(e));
                        disconnect();
                    },
                    onclose: () => {
                        console.log('Live API Closed');
                        disconnect();
                    }
                },
                config: {
                    responseModalities: [Modality.AUDIO],
                    speechConfig: {
                        voiceConfig: { prebuiltVoiceConfig: { voiceName: "Zephyr" } },
                    },
                    systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION + "\n\nCRITICAL: the user is speaking to you using voice right now. Provide clear, concise, conversational spoken-style answers — avoid tables or complex formatting. Keep your responses short like a real conversation. Only elaborate if the user asks." }] },
                },
            });
            sessionRef.current = await sessionPromise;
        } catch (err: any) {
            console.error('Connection failed', err);
            alert("Live Mode Error: " + (err.message || 'Unknown connection error. Please check your API Key.'));
            disconnect();
        }
    }, [disconnect]);

    return {
        connect,
        disconnect,
        isConnected,
        isConnecting,
        transcript
    };
}
