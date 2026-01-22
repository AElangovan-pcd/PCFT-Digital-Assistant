
import { GoogleGenAI, GenerateContentResponse, Modality } from "@google/genai";
import { PCFT_CONTRACT_CONTEXT } from "../constants";

export class GeminiService {
  constructor() {}

  async *generateTextResponseStream(
    prompt: string, 
    history: { role: string; content: string }[] = [],
    useThinking: boolean = true
  ) {
    try {
      const aiInstance = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });
      
      const responseStream = await aiInstance.models.generateContentStream({
        model: 'gemini-3-pro-preview',
        contents: [
          ...history.map(h => ({
            role: h.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: h.content }]
          })),
          { role: 'user', parts: [{ text: prompt }] }
        ],
        config: {
          systemInstruction: PCFT_CONTRACT_CONTEXT + `
          STRICT RESPONSE FORMAT RULES:
          1. Start with a direct answer (1-2 sentences).
          2. Use clear headings for multi-part answers.
          3. Present contract citations in bold: **Article X, Section Y**.
          4. Include page numbers if known: (Contract, p. Z).
          5. Keep paragraphs concise (3-4 sentences max).
          6. Use bullet points for lists.
          7. End with a question about follow-ups and a reminder about the grievance form link.
          8. Output strictly in Markdown format for rich text rendering.
          `,
          temperature: 0.2, // Lower temperature for higher precision
          thinkingConfig: useThinking ? { thinkingBudget: 4000 } : { thinkingBudget: 0 }
        },
      });

      for await (const chunk of responseStream) {
        yield chunk.text;
      }
    } catch (error: any) {
      console.error("Gemini Streaming Error:", error);
      yield "I apologize, but I encountered an error processing your request.";
    }
  }

  async generateSpeech(text: string): Promise<string | null> {
    try {
      const aiInstance = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });
      const response = await aiInstance.models.generateContent({
        model: "gemini-2.5-flash-preview-tts",
        contents: [{ parts: [{ text: `Read this contract information clearly and professionally. Break complex info into shorter sentences. Use verbal signposting like 'First', 'Additionally', 'Most importantly'. Speak section numbers clearly (e.g. Article Five, Section Three Point Two). Content: ${text}` }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: 'Kore' },
            },
          },
        },
      });

      const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      return base64Audio || null;
    } catch (error) {
      console.error("TTS Error:", error);
      return null;
    }
  }
}
