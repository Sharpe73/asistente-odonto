const pool = require("../database");
const OpenAI = require("openai");

// ============================
// 🔧 Cargar OpenAI
// ============================
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// ========================================================
// 🧮 Función: calcular similitud coseno
// ========================================================
function cosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB || !Array.isArray(vecA) || !Array.isArray(vecB)) return -1;

  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dot += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }

  if (normA === 0 || normB === 0) return -1;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// ========================================================
// 😎 IA ULTRA ESTRICTA — SOLO PDF, SOLO ESPAÑOL, CERO INVENTOS
// ========================================================
async function generarRespuestaIA(pregunta, fragmentosTexto) {
  const systemPrompt = `
Eres un asistente EXTREMADAMENTE ESTRICTO especializado en documentos odontológicos.

REGLAS OBLIGATORIAS:
1. Respondes SIEMPRE en español.
2. NO inventas información.
3. NO usas conocimientos externos.
4. SOLO puedes usar información que esté en los fragmentos entregados.
5. Si algo NO aparece en los fragmentos, debes responder EXACTAMENTE:
   "No tengo información suficiente en el documento para responder eso."
6. Puedes traducir del inglés al español, pero SIN agregar nada adicional.
`;

  const mensajes = [
    { role: "system", content: systemPrompt },
    {
      role: "assistant",
      content: `Fragmentos relevantes del documento:\n${fragmentosTexto}`
    },
    { role: "user", content: pregunta }
  ];

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: mensajes,
  });

  return completion.choices[0].message.content;
}

// ========================================================
// 📌 Controlador principal: RAG REAL CON TODOS LOS PDFs
// ========================================================
exports.preguntar = async (req, res) => {
  try {
    const { pregunta } = req.body;

    if (!pregunta) {
      return res.status(400).json({
        ok: false,
        mensaje: "La pregunta es obligatoria",
      });
    }

    // 1️⃣ TRAER TODOS LOS FRAGMENTOS DE TODA LA BASE
    const result = await pool.query(`
      SELECT fragmento_index, texto, embedding
      FROM documentos_fragmentos
    `);

    if (result.rows.length === 0) {
      return res.status(404).json({
        ok: false,
        mensaje: "No existen documentos cargados en la base",
      });
    }

    // 2️⃣ EMBEDDING de la pregunta
    const embPregunta = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: pregunta,
    });

    const preguntaEmbedding = embPregunta.data[0].embedding;

    // 3️⃣ PROCESAR fragmentos
    const fragmentosProcesados = result.rows.map(f => {
      let emb = f.embedding;

      if (typeof emb === "string") {
        try {
          emb = emb.replace(/{/g, "[").replace(/}/g, "]");
          emb = JSON.parse(emb);
        } catch (e) {
          emb = null;
        }
      }

      return {
        index: f.fragmento_index,
        texto: f.texto,
        embedding: emb,
        score: emb ? cosineSimilarity(preguntaEmbedding, emb) : -1,
      };
    });

    // 4️⃣ RANKING GLOBAL
    const top = fragmentosProcesados
      .filter(f => f.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    const contexto = top.map(f => f.texto).join("\n\n");

    // 5️⃣ LLM estricto
    const respuestaIA = await generarRespuestaIA(pregunta, contexto);

    // 6️⃣ RESPUESTA FINAL
    res.json({
      ok: true,
      respuesta: respuestaIA,
      fragmentos_usados: top.length,
    });

  } catch (error) {
    console.error("❌ Error en preguntar:", error);

    res.status(500).json({
      ok: false,
      mensaje: "Error interno del servidor",
      error: error.message,
    });
  }
};
