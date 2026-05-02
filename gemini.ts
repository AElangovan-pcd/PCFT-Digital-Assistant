import { GoogleGenAI, Modality, Content, Part, Type } from "@google/genai";
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

export type Attachment = { mimeType: string, base64: string, name: string };

export type SlideDeckData = {
    title: string;
    slides: { title: string; bullets: string[] }[];
};

export async function sendMessage(chatContext: Content[], message: string, attachments: Attachment[] = []): Promise<{ text: string, newContext: Content[], slideDeck?: SlideDeckData }> {
    const ai = getAI();
    
    const parts: Part[] = [];
    if (message.trim()) {
      parts.push({ text: message });
    }
    for (const att of attachments) {
      parts.push({
        inlineData: {
          mimeType: att.mimeType,
          data: att.base64
        }
      });
    }

    const newContext: Content[] = [...chatContext, { role: "user", parts }];
    
    let slideDeck: SlideDeckData | undefined;

    const response = await ai.models.generateContent({
        model: "gemini-3.1-pro-preview",
        contents: newContext,
        config: {
            systemInstruction: SYSTEM_INSTRUCTION + "\n\nIf the user asks for a presentation slide deck, use the generate_slide_deck tool.",
            tools: [{
                functionDeclarations: [{
                    name: "generate_slide_deck",
                    description: "Generates a presentation slide deck based on the provided title and slides.",
                    parameters: {
                        type: Type.OBJECT,
                        properties: {
                            title: { type: Type.STRING },
                            slides: {
                                type: Type.ARRAY,
                                items: {
                                    type: Type.OBJECT,
                                    properties: {
                                        title: { type: Type.STRING },
                                        bullets: { type: Type.ARRAY, items: { type: Type.STRING } }
                                    }
                                }
                            }
                        },
                        required: ["title", "slides"]
                    }
                }]
            }]
        }
    });

    let assistantText = response.text || "";

    if (response.functionCalls && response.functionCalls.length > 0) {
        for (const call of response.functionCalls) {
            if (call.name === 'generate_slide_deck') {
                const args = call.args as unknown as SlideDeckData;
                slideDeck = args;
                assistantText += "\n\n*I have generated your presentation slide deck!*";
                
                // Add the function call and response to context
                newContext.push({
                    role: "model",
                    parts: [{ functionCall: { id: call.id, name: 'generate_slide_deck', args: call.args } }]
                });
                newContext.push({
                    role: "user",
                    parts: [{ functionResponse: { id: call.id, name: 'generate_slide_deck', response: { status: "success" } } }]
                });
            }
        }
    }

    newContext.push({ role: "model", parts: [{ text: assistantText }] });

    return { text: assistantText, newContext, slideDeck };
}
