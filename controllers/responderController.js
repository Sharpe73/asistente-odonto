const pool = require("../database");
const OpenAI = require("openai");

// Inicializar cliente OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// =========================================================
// 🧮 Normalizar vector
// =========================================================
function normalize(vec) {
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
  return norm === 0 ? vec : vec.map(v => v / norm);
}

// =========================================================
// 🧮 Similitud coseno normalizada
// =========================================================
function cosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB) return -1;

  let dot = 0;
  for (let i = 0; i < vecA.length; i++) {
    dot += vecA[i] * vecB[i];
  }
  return dot;
}

// =========================================================
// 🤖 IA ULTRA ESTRICTA — SOLO PDF, SOLO ESPAÑOL, SIN INVENTAR
// =========================================================
async function generarRespuestaIA(pregunta, fragmentosTexto) {
  const mensajes = [
    {
      role: "system",
      content: `
Eres un asistente extremadamente estricto especializado en documentos odontológicos.

REGLAS:
1. Respondes siempre en español.
2. No inventas nada.
3. No usas información externa.
4. Solo respondes usando los fragmentos entregados.
5. Si la información no aparece en los fragmentos, responde EXACTAMENTE:
   "No dispongo de información que permita responder esa pregunta."
      `
    },
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

// =========================================================
// 🤖 CONTROLADOR FINAL optimizado: RAG real + IA segura
// =========================================================
exports.responderPregunta = async (req, res) => {
  try {
    const { documentoId, pregunta } = req.body;

    if (!documentoId || !pregunta) {
      return res.status(400).json({
        ok: false,
        mensaje: "Debes enviar 'documentoId' y 'pregunta'"
      });
    }

    // 1️⃣ OBTENER FRAGMENTOS + EMBEDDINGS
    const result = await pool.query(
      `SELECT fragmento_index, texto, embedding
       FROM documentos_fragmentos
       WHERE documento_id = $1`,
      [documentoId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        ok: false,
        mensaje: "No existen fragmentos para este documento"
      });
    }

    // 2️⃣ EMBEDDING DE LA PREGUNTA + normalización
    const embPregunta = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: pregunta,
    });

    const preguntaEmbedding = normalize(embPregunta.data[0].embedding);

    // 3️⃣ PROCESAR FRAGMENTOS (parse + normalización)
    const fragmentosProcesados = result.rows.map(f => {
      let emb = f.embedding;

      if (typeof emb === "string") {
        try {
          emb = JSON.parse(emb.replace(/{/g, "[").replace(/}/g, "]"));
        } catch {
          emb = null;
        }
      }

      emb = Array.isArray(emb) ? normalize(emb) : null;

      return {
        index: f.fragmento_index,
        texto: f.texto,
        embedding: emb,
        score: emb ? cosineSimilarity(preguntaEmbedding, emb) : -1
      };
    });

    // 4️⃣ RANKING — AHORA NO FILTRAMOS SCORE > 0
    const top = fragmentosProcesados
      .sort((a, b) => b.score - a.score)
      .slice(0, 12); // más robusto

    const contexto = top.map(f => f.texto).join("\n\n");

    // 5️⃣ OBTENER RESPUESTA ULTRA ESTRICTA
    const respuestaIA = await generarRespuestaIA(pregunta, contexto);

    // 6️⃣ RESPUESTA FINAL
    res.json({
      ok: true,
      respuesta: respuestaIA,
      fragmentos_usados: top.length
    });

  } catch (error) {
    console.error("❌ Error al responder pregunta:", error);
    res.status(500).json({
      ok: false,
      mensaje: "Error interno del servidor",
      error: error.message
    });
  }
};
