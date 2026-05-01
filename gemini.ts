import { GoogleGenAI, Modality, Content } from "@google/genai";
import { SYSTEM_INSTRUCTION } from "./knowledge_base";

// Helper to initialize AI client
let genAIClient: GoogleGenAI | null = null;
export function getAI() {
  if (!genAIClient) {
    if (!process.env.GEMINI_API_KEY) {
      throw new Error("GEMINI_API_KEY is not defined");
    }
    genAIClient = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }
  return genAIClient;
}

export async function sendMessage(chatContext: Content[], message: string): Promise<{ text: string, newContext: Content[] }> {
    const ai = getAI();
    
    // We are going to use generateContent with history instead of chat session
    // to easily manage state across re-renders explicitly.
    const newContext: Content[] = [...chatContext, { role: "user", parts: [{ text: message }] }];
    
    const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: newContext,
        config: {
            systemInstruction: SYSTEM_INSTRUCTION
        }
    });

    const assistantText = response.text || "";
    newContext.push({ role: "model", parts: [{ text: assistantText }] });

    return { text: assistantText, newContext };
}
