const pool = require("../database");
const { generarSessionId } = require("../utils/session");
const OpenAI = require("openai");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// =========================================================
// 🧮 Similitud coseno correcta (VERSIÓN QUE SI FUNCIONA)
// =========================================================
function cosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB) return -1;
  if (!Array.isArray(vecA) || !Array.isArray(vecB)) return -1;

  let dot = 0, normA = 0, normB = 0;

  for (let i = 0; i < vecA.length; i++) {
    dot += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }

  if (normA === 0 || normB === 0) return -1;

  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// =========================================================
// 📌 Registrar mensaje
// =========================================================
exports.registrarMensaje = async (req, res) => {
  try {
    const { session_id, role, mensaje } = req.body;

    if (!session_id)
      return res.status(400).json({ ok: false, mensaje: "session_id es obligatorio" });

    if (!["user", "assistant"].includes(role))
      return res.status(400).json({ ok: false, mensaje: "role debe ser user o assistant" });

    await pool.query(
      `INSERT INTO chat_historial (session_id, role, mensaje)
       VALUES ($1, $2, $3)`,
      [session_id, role, mensaje]
    );

    res.json({ ok: true });

  } catch (e) {
    console.error("Error registrar mensaje:", e);
    res.status(500).json({ ok: false });
  }
};

// =========================================================
// 📌 Obtener historial
// =========================================================
exports.obtenerHistorial = async (req, res) => {
  try {
    const { session_id } = req.params;

    const result = await pool.query(
      `SELECT * FROM chat_historial
       WHERE session_id = $1
       ORDER BY creado_en ASC`,
      [session_id]
    );

    res.json({ ok: true, historial: result.rows });

  } catch (e) {
    console.error("Error historial:", e);
    res.status(500).json({ ok: false });
  }
};

// =========================================================
// 🆕 Crear sesión
// =========================================================
exports.crearSesion = async (req, res) => {
  try {
    const session_id = generarSessionId();

    await pool.query(
      `INSERT INTO sesiones (session_id, ultima_pregunta_clara)
       VALUES ($1, NULL)`,
      [session_id]
    );

    res.json({
      ok: true,
      session_id,
      mensaje: "Sesión creada correctamente"
    });

  } catch (error) {
    console.error("Error creando sesión:", error);
    res.status(500).json({ ok: false });
  }
};

// =========================================================
// 🤖 PROCESAR PREGUNTA (RAG PURO SIN MEMORIA, SIN EXPANSIÓN)
// =========================================================
exports.preguntar = async (req, res) => {
  try {
    const { session_id, pregunta } = req.body;

    if (!session_id)
      return res.status(400).json({ ok: false, mensaje: "session_id es obligatorio" });

    if (!pregunta?.trim())
      return res.status(400).json({ ok: false, mensaje: "La pregunta no puede estar vacía" });

    // Guardar la pregunta original
    await pool.query(
      `INSERT INTO chat_historial (session_id, role, mensaje)
       VALUES ($1, 'user', $2)`,
      [session_id, pregunta]
    );

    // =====================================================
    // Embedding de la pregunta
    // =====================================================
    const embPregunta = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: pregunta,
    });

    const preguntaEmbedding = embPregunta.data[0].embedding;

    // =====================================================
    // Obtener TODOS los fragmentos de TODOS los PDFs
    // =====================================================
    const fragRes = await pool.query(`
      SELECT fragmento_index, texto, embedding
      FROM documentos_fragmentos
    `);

    const fragmentos = fragRes.rows.map(f => ({
      index: f.fragmento_index,
      texto: f.texto,
      embedding: typeof f.embedding === "string"
        ? JSON.parse(f.embedding.replace(/{/g, "[").replace(/}/g, "]"))
        : f.embedding
    }));

    // =====================================================
    // Ranking RAG (TOP 5 fragmentos más similares)
    // =====================================================
    const top = fragmentos
      .map(f => ({
        ...f,
        score: f.embedding ? cosineSimilarity(preguntaEmbedding, f.embedding) : -1
      }))
      .filter(f => f.score > 0) // si no pasa este filtro, realmente NO coincide con nada
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    const contexto = top.length > 0
      ? top.map(f => f.texto).join("\n\n")
      : "";

    // =====================================================
    // Prompt final al modelo (SIN MEMORIA, SIN EXPANSIONES)
    // =====================================================
    const mensajes = [
      {
        role: "system",
        content: `
Eres Odonto-Bot, un asistente extremadamente estricto.
REGLAS:
1. Respondes SOLO en español de Chile.
2. NO inventas nada.
3. Si algo NO aparece en los fragmentos debes decir EXACTAMENTE:
   "No tengo información suficiente en el documento para responder eso."
4. Usa ÚNICAMENTE los fragmentos entregados.
`
      },
      {
        role: "assistant",
        content: `Fragmentos relevantes del documento:\n${contexto}`
      },
      {
        role: "user",
        content: pregunta
      }
    ];

    // =====================================================
    // LLM
    // =====================================================
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: mensajes
    });

    const respuesta = completion.choices[0].message.content;

    // Guardar respuesta
    await pool.query(
      `INSERT INTO chat_historial (session_id, role, mensaje)
       VALUES ($1, 'assistant', $2)`,
      [session_id, respuesta]
    );

    res.json({
      ok: true,
      respuesta,
      fragmentos_usados: top.length
    });

  } catch (e) {
    console.error("❌ Error procesando pregunta:", e);
    res.status(500).json({ ok: false, mensaje: "Error interno", error: e.message });
  }
};
