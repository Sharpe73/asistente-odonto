const pool = require("../database");
const { generarSessionId } = require("../utils/session");
const OpenAI = require("openai");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// =========================================================
// 🧮 Similitud coseno segura
// =========================================================
function cosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB) return -1;
  if (!Array.isArray(vecA) || !Array.isArray(vecB)) return -1;

  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dot += vecA[i] * vecA[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  if (normA === 0 || normB === 0) return -1;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// =========================================================
// 📌 Determinar si una pregunta es “clara”
// =========================================================
function esPreguntaClara(txt) {
  const p = txt.trim().toLowerCase();

  const claves = [
    "que es",
    "qué es",
    "esmalte",
    "dentina",
    "pulpa",
    "ligamento",
    "periodontal",
    "pulp",
    "dentin",
    "enamel"
  ];

  return claves.some(c => p.includes(c));
}

// =========================================================
// 📌 Guardar una pregunta clara en sesiones
// =========================================================
async function guardarPreguntaClara(session_id, pregunta) {
  if (!esPreguntaClara(pregunta)) return;

  await pool.query(
    `UPDATE sesiones SET ultima_pregunta_clara = $1 WHERE session_id = $2`,
    [pregunta, session_id]
  );
}

// =========================================================
// 📌 Expandir preguntas cortas
// =========================================================
async function expandirPreguntaCorta(session_id, pregunta) {
  const corta = pregunta.trim().toLowerCase();

  // Si es pregunta clara → NO expandir
  if (esPreguntaClara(corta)) return pregunta;

  const patrones = [
    /^y\s*$/i,
    /^y eso/i,
    /^y que/i,
    /^y qué/i,
    /^y cual/i,
    /^y cuál/i,
    /^y cuales/i,
    /^y entonces/i
  ];

  if (!patrones.some(p => p.test(corta))) return pregunta;

  // Obtener ultima pregunta clara desde sesiones
  const r = await pool.query(
    `SELECT ultima_pregunta_clara FROM sesiones WHERE session_id = $1`,
    [session_id]
  );

  const ultima = r.rows[0]?.ultima_pregunta_clara;

  if (!ultima) return pregunta;

  return `${ultima}. Además, respecto a tu última pregunta: ${pregunta}`;
}

// =========================================================
// 📌 Registrar mensaje (NECESARIO PARA EL ROUTER)
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
// 📌 Obtener historial (NECESARIO PARA EL ROUTER)
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
// 🤖 PROCESAR PREGUNTA (LÓGICA FINAL)
// =========================================================
exports.preguntar = async (req, res) => {
  try {
    const { session_id, pregunta } = req.body;

    if (!session_id)
      return res.status(400).json({ ok: false, mensaje: "session_id es obligatorio" });

    if (!pregunta?.trim())
      return res.status(400).json({ ok: false, mensaje: "La pregunta no puede estar vacía" });

    // 1️⃣ Guardar pregunta clara (si corresponde)
    await guardarPreguntaClara(session_id, pregunta);

    // 2️⃣ Expandir si es pregunta corta
    const preguntaExpandida = await expandirPreguntaCorta(session_id, pregunta);

    // 3️⃣ Guardar pregunta original en historial
    await pool.query(
      `INSERT INTO chat_historial (session_id, role, mensaje)
       VALUES ($1, 'user', $2)`,
      [session_id, pregunta]
    );

    // =====================================================
    // MEMORIA
    // =====================================================
    const memRes = await pool.query(
      `SELECT role, mensaje
       FROM chat_historial
       WHERE session_id = $1
       ORDER BY creado_en ASC
       LIMIT 10`,
      [session_id]
    );

    const memoriaChat = memRes.rows.map(m => ({
      role: m.role,
      content: m.mensaje
    }));

    // =====================================================
    // Embedding
    // =====================================================
    const emb = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: preguntaExpandida,
    });

    const preguntaEmbedding = emb.data[0].embedding;

    // =====================================================
    // Fragmentos
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
    // Ranking RAG
    // =====================================================
    const top = fragmentos
      .map(f => ({
        ...f,
        score: f.embedding ? cosineSimilarity(preguntaEmbedding, f.embedding) : -1
      }))
      .filter(f => f.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    const contexto = top.map(f => f.texto).join("\n\n");

    // =====================================================
    // Prompt
    // =====================================================
    const mensajes = [
      {
        role: "system",
        content: `
Eres Odonto-Bot, un asistente extremadamente estricto.
REGLAS:
1. Respondes SOLO en español.
2. NO inventas nada.
3. Si algo NO aparece en el documento debes decir EXACTAMENTE:
   "No tengo información suficiente en el documento para responder eso."
4. Usa ÚNICAMENTE los fragmentos entregados.
`
      },

      ...memoriaChat,

      { role: "user", content: preguntaExpandida },

      {
        role: "assistant",
        content: `Fragmentos relevantes del documento:\n${contexto}`
      }
    ];

    // =====================================================
    // LLM Request
    // =====================================================
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: mensajes
    });

    const respuesta = completion.choices[0].message.content;

    await pool.query(
      `INSERT INTO chat_historial (session_id, role, mensaje)
       VALUES ($1, 'assistant', $2)`,
      [session_id, respuesta]
    );

    res.json({
      ok: true,
      respuesta,
      pregunta_expandida: preguntaExpandida,
      fragmentos_usados: top.length
    });

  } catch (e) {
    console.error("❌ Error procesando pregunta:", e);
    res.status(500).json({ ok: false, mensaje: "Error interno", error: e.message });
  }
};
