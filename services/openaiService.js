const OpenAI = require("openai");

// Crear cliente OPENAI usando la API KEY cargada desde Railway
const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

/**
 * 🤖 Llama a OpenAI para generar una respuesta basada en contexto.
 * @param {string} pregunta - La pregunta del usuario
 * @param {string} contexto - Texto relevante extraído de los documentos
 */
exports.generarRespuestaIA = async (pregunta, contexto) => {
  try {
    const prompt = `
Eres un asistente experto en odontología para una universidad.
Responde SOLO basándote en el siguiente material:

================ CONTEXTO ================
${contexto || "No hay información disponible."}
==========================================

Pregunta del usuario: ${pregunta}

Da una respuesta clara, breve y profesional.
Si no tienes información suficiente, di: 
"No tengo información suficiente en los documentos cargados para responder eso."
    `;

    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini", // rápido y barato
      messages: [
        { role: "system", content: "Eres un asistente experto en odontología basado en documentos." },
        { role: "user", content: prompt }
      ]
    });

    const respuesta = completion.choices[0].message.content;
    return respuesta;

  } catch (error) {
    console.error("❌ Error llamando a OpenAI:", error);
    return "Hubo un error al generar la respuesta con inteligencia artificial.";
  }
};
