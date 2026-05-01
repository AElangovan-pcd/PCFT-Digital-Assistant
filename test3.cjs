const { GoogleGenAI } = require('@google/genai');

async function test() {
  try {
    const aiInstance = new GoogleGenAI({ apiKey: 'AIzaSyDoUfJMyOoLNZHEKn2UC6beVW3sNdUB_BQ' });
    const responseStream = await aiInstance.models.generateContentStream({
      model: 'gemini-2.5-flash',
      contents: [
        { role: 'user', parts: [{ text: "Are you alive?" }] }
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
