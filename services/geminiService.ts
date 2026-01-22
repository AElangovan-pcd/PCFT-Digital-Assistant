
import { GoogleGenAI, GenerateContentResponse } from "@google/genai";
import { PCFT_CONTRACT_CONTEXT } from "../constants";

export class GeminiService {
  private ai: any;

  constructor() {
    this.ai = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });
  }

  async generateTextResponse(
    prompt: string, 
    history: { role: string; content: string }[] = [],
    useThinking: boolean = true
  ) {
    try {
      // Create a fresh instance to ensure the latest API key is used (standard for this env)
      const aiInstance = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });
      
      const response: GenerateContentResponse = await aiInstance.models.generateContent({
        model: 'gemini-3-pro-preview',
        contents: [
          ...history.map(h => ({
            role: h.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: h.content }]
          })),
          { role: 'user', parts: [{ text: prompt }] }
        ],
        config: {
          systemInstruction: PCFT_CONTRACT_CONTEXT,
          temperature: 0.7,
          thinkingConfig: useThinking ? { thinkingBudget: 4000 } : { thinkingBudget: 0 }
        },
      });

      return response.text;
    } catch (error: any) {
      console.error("Gemini Text Error:", error);
      if (error?.message?.includes("Requested entity was not found")) {
        return "ERROR: API Key issue. Please refresh or check your project permissions.";
      }
      return "I apologize, but I encountered an error processing your request. Please try again or contact PCFT leadership.";
    }
  }
}
