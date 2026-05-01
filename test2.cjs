const { GoogleGenAI } = require('@google/genai');

async function test() {
  try {
    const aiInstance = new GoogleGenAI({ apiKey: 'AIzaSyA39cCZtGqxVZf4UxwdzyVk0vncQ2fvXLM' });
    const responseStream = await aiInstance.models.generateContentStream({
      model: 'gemini-2.0-flash',
      contents: [
        { role: 'user', parts: [{ text: "Explain the High Demand MOU" }] }
      ]
    });

    for await (const chunk of responseStream) {
      process.stdout.write(chunk.text);
    }
  } catch (err) {
    console.error("ERROR CAUGHT:");
    console.error(err);
  }
}

test();
