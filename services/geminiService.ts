
import { GoogleGenAI, Modality } from "@google/genai";
import { PCFT_CONTRACT_CONTEXT } from "../constants";

export class GeminiService {
  constructor() {}

  async *generateTextResponseStream(
    prompt: string, 
    history: { role: string; content: string }[] = [],
    useThinking: boolean = true
  ) {
    try {
      // Re-initialize for each stream to ensure the latest API key is used if it changes
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });
      
      const responseStream = await ai.models.generateContentStream({
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
          1. Start with a direct answer (1-2 sentences). Offer only brief answers unless the user asks for more details.
          2. Use clear headings for multi-part answers.
          3. Present contract citations in bold: **Article X, Section Y**.
          4. Include page numbers if known: (Contract, p. Z).
          5. Keep paragraphs concise (1-2 sentences max). Do not give too elaborate answers.
          6. Use bullet points for lists.
          7. End with: "Any follow-ups? Access the grievance form via your reps."
          8. NEVER provide "Action Guidance" or "Application" sections unless explicitly requested.
          9. Output strictly in Markdown format for rich text rendering.
          `,
          temperature: 0.2,
          thinkingConfig: useThinking ? { thinkingBudget: 4000 } : { thinkingBudget: 0 }
        },
      });

      for await (const chunk of responseStream) {
        // Access .text property directly as per @google/genai guidelines
        if (chunk.text) {
          yield chunk.text;
        }
      }
    } catch (error: any) {
      console.error("Gemini Streaming Error:", error);
      yield "I apologize, but I encountered an error processing your request. Please ensure your API key or other configuration is correct.";
    }
  }

  async generateSpeech(text: string): Promise<string | null> {
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [{ parts: [{ text: `Read this contract information clearly and professionally. Content: ${text}` }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: 'Kore' },
            },
          },
        },
      });

      // Navigate response object carefully
      const base64Audio = response.candidates?.[0]?.content?.parts?.find(p => p.inlineData)?.inlineData?.data;
      return base64Audio || null;
    } catch (error) {
      console.error("TTS Error:", error);
      return null;
    }
  }
}
