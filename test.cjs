const { GoogleGenAI } = require('@google/genai');

async function test() {
  try {
    const aiInstance = new GoogleGenAI({ apiKey: 'AIzaSyA39cCZtGqxVZf4UxwdzyVk0vncQ2fvXLM' });
    const responseStream = await aiInstance.models.generateContentStream({
      model: 'gemini-2.0-flash-thinking-exp-01-21',
      contents: [
        { role: 'user', parts: [{ text: "Explain the High Demand/High Wage MOU" }] }
      ],
      config: {
        systemInstruction: "You are an assistant.",
        temperature: 0.2,
        thinkingConfig: { thinkingBudget: 4000 }
      },
    });

    for await (const chunk of responseStream) {
      console.log(chunk.text);
    }
  } catch (err) {
    console.error("ERROR CAUGHT:");
    console.error(err);
  }
}

test();
