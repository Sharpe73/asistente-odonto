const pool = require("../database");
const { generarSessionId } = require("../utils/session");
const OpenAI = require("openai");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// ========================================================
// 🔧 Normalizar vector
// ========================================================
function normalize(vec) {
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
  return norm === 0 ? vec : vec.map(v => v / norm);
}

// ========================================================
// 🔧 Similitud coseno (dot product)
// ========================================================
function cosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB) return -1;
  let dot = 0;
  for (let i = 0; i < vecA.length; i++) {
    dot += vecA[i] * vecB[i];
  }
  return dot;
}

// ========================================================
// 🤖 IA ULTRA ESTRICTA — SOLO PDF, SIN INVENTOS
// ========================================================
async function generarRespuestaIA(pregunta, fragmentosTexto) {
  const systemPrompt = `
Eres Odonto-Bot y respondes exclusivamente con información proveniente de los documentos cargados.

REGLAS:
1. Respondes SIEMPRE en español.
2. NO inventas nada.
3. NO usas información externa.
4. SOLO respondes usando los fragmentos entregados.
5. Si la información NO aparece literal, respondes exactamente:
   "No dispongo de información que permita responder esa pregunta."
6. Puedes traducir contenido del inglés al español sin agregar detalles adicionales.
`;

  const messages = [
    { role: "system", content: systemPrompt },
    { role: "assistant", content: `Fragmentos relevantes:\n${fragmentosTexto}` },
    { role: "user", content: pregunta }
  ];

  const completion = await openai.chat.completions.create({
    model: "gpt-4o",
    messages,
  });

  return completion.choices[0].message.content.trim();
}

// =========================================================
// 📌 registrarMensaje
// =========================================================
exports.registrarMensaje = async (req, res) => {
  try {
    const { session_id, role, mensaje } = req.body;

    if (!session_id)
      return res.status(400).json({ ok: false, mensaje: "session_id es obligatorio" });

    if (!["user", "assistant"].includes(role))
      return res.status(400).json({ ok: false, mensaje: "role inválido" });

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
// 📌 obtenerHistorial
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
// 🆕 crearSesion
// =========================================================
exports.crearSesion = async (req, res) => {
  try {
    const session_id = generarSessionId();

    await pool.query(
      `INSERT INTO sesiones (session_id, ultima_pregunta_clara)
       VALUES ($1, NULL)`,
      [session_id]
    );

    res.json({ ok: true, session_id });

  } catch (e) {
    console.error("Error crear sesión:", e);
    res.status(500).json({ ok: false });
  }
};

// =========================================================
// 🤖 PROCESAR PREGUNTA — RAG UNIFICADO Y PROFESIONAL
// =========================================================
exports.preguntar = async (req, res) => {
  try {
    const { session_id, pregunta } = req.body;

    if (!session_id)
      return res.status(400).json({ ok: false, mensaje: "session_id es obligatorio" });

    if (!pregunta?.trim())
      return res.status(400).json({ ok: false, mensaje: "La pregunta no puede estar vacía" });

    // Guardar pregunta en historial
    await pool.query(
      `INSERT INTO chat_historial (session_id, role, mensaje)
       VALUES ($1, 'user', $2)`,
      [session_id, pregunta]
    );

    // 1️⃣ Embedding directo (SIN reformulación)
    const embPregunta = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: pregunta,
    });

    const preguntaEmbedding = normalize(embPregunta.data[0].embedding);

    // 2️⃣ Obtener fragmentos
    const result = await pool.query(`
      SELECT fragmento_index, texto, embedding
      FROM documentos_fragmentos
    `);

    if (result.rows.length === 0) {
      const msg = "No dispongo de información que permita responder esa pregunta.";

      await pool.query(
        `INSERT INTO chat_historial (session_id, role, mensaje)
         VALUES ($1, 'assistant', $2)`,
        [session_id, msg]
      );

      return res.json({ ok: true, respuesta: msg });
    }

    // 3️⃣ Procesar fragmentos
    const fragmentosProcesados = result.rows.map(f => {
      let emb = null;
      try {
        if (typeof f.embedding === "string") emb = JSON.parse(f.embedding);
        else if (Array.isArray(f.embedding)) emb = f.embedding;
      } catch {}

      emb = emb ? normalize(emb) : null;

      return {
        index: f.fragmento_index,
        texto: f.texto,
        score: emb ? cosineSimilarity(preguntaEmbedding, emb) : -1
      };
    });

    // 4️⃣ Ordenar y tomar top 12
    const top = fragmentosProcesados
      .sort((a, b) => b.score - a.score)
      .slice(0, 12);

    const contexto = top.map(f => f.texto).join("\n\n");

    // 5️⃣ Respuesta ultra estricta
    const respuesta = await generarRespuestaIA(pregunta, contexto);

    // Guardar respuesta
    await pool.query(
      `INSERT INTO chat_historial (session_id, role, mensaje)
       VALUES ($1, 'assistant', $2)`,
      [session_id, respuesta]
    );

    res.json({
      ok: true,
      respuesta,
      fragmentos_usados: top.length,
      scores: top.map(t => t.score),
    });

  } catch (e) {
    console.error("❌ Error procesando pregunta:", e);
    res.status(500).json({ ok: false, mensaje: "Error interno", error: e.message });
  }
};
