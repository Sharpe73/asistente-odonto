const pool = require("../database");
const OpenAI = require("openai");

// ============================
// 🔧 Cliente OpenAI
// ============================
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// ========================================================
// 🧮 Normalizar vector
// ========================================================
function normalize(vec) {
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
  return norm === 0 ? vec : vec.map(v => v / norm);
}

// ========================================================
// 🧮 Similitud coseno (dot product)
// ========================================================
function cosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB) return -1;
  let dot = 0;
  for (let i = 0; i < vecA.length; i++) dot += vecA[i] * vecB[i];
  return dot;
}

// ========================================================
// 🤖 IA ULTRA ESTRICTA — SOLO PDF, SIN INVENTAR
// ========================================================
async function generarRespuestaIA(pregunta, fragmentosTexto) {
  const systemPrompt = `
Eres un asistente extremadamente estricto especializado en documentos odontológicos.

REGLAS:
1. Respondes SIEMPRE en español.
2. NO inventas nada.
3. NO usas información externa.
4. SOLO usas los fragmentos entregados.
5. Si la información NO aparece literal, responde exactamente:
   "No dispongo de información que permita responder esa pregunta."
6. Puedes traducir contenido del inglés al español sin agregar detalles.
`;

  const messages = [
    { role: "system", content: systemPrompt },
    { role: "assistant", content: `Fragmentos relevantes:\n${fragmentosTexto}` },
    { role: "user", content: pregunta }
  ];

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages,
  });

  return completion.choices[0].message.content.trim();
}

// ========================================================
// 📌 Controlador principal — RAG uniforme
// ========================================================
exports.preguntar = async (req, res) => {
  try {
    const { pregunta } = req.body;

    if (!pregunta?.trim()) {
      return res.status(400).json({
        ok: false,
        mensaje: "La pregunta es obligatoria",
      });
    }

    // 1️⃣ Obtener embedding de la pregunta tal cual
    const embPregunta = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: pregunta,
    });

    const preguntaEmbedding = normalize(embPregunta.data[0].embedding);

    // 2️⃣ Obtener fragmentos desde la BD
    const result = await pool.query(`
      SELECT fragmento_index, texto, embedding
      FROM documentos_fragmentos
    `);

    if (result.rows.length === 0) {
      return res.status(404).json({
        ok: false,
        mensaje: "No existen documentos cargados",
      });
    }

    // 3️⃣ Procesar fragmentos (normalización + similitud)
    const fragmentosProcesados = result.rows.map(f => {
      let emb = null;

      try {
        if (typeof f.embedding === "string") {
          emb = JSON.parse(f.embedding);
        } else if (Array.isArray(f.embedding)) {
          emb = f.embedding;
        }
      } catch {
        emb = null;
      }

      emb = emb ? normalize(emb) : null;

      return {
        index: f.fragmento_index,
        texto: f.texto,
        score: emb ? cosineSimilarity(preguntaEmbedding, emb) : -1,
      };
    });

    // 4️⃣ Tomar top 12 (sin filtros)
    const top = fragmentosProcesados
      .sort((a, b) => b.score - a.score)
      .slice(0, 12);

    const contexto = top.map(f => f.texto).join("\n\n");

    // 5️⃣ Respuesta ultra estricta
    const respuestaIA = await generarRespuestaIA(pregunta, contexto);

    res.json({
      ok: true,
      respuesta: respuestaIA,
      fragmentos_usados: top.length,
      scores: top.map(t => t.score),
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
