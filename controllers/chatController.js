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
// 🧠 NUEVA MEMORIA SEMÁNTICA PROFESIONAL (Opción A)
// =========================================================
async function expandirPreguntaCorta(session_id, pregunta) {
  const p = pregunta.trim().toLowerCase();

  const patronesCortos = [
    /^y\s*.+/i,
    /^y$/,
    /^y eso/i,
    /^y que/i,
    /^y qué/i,
    /^y cual/i,
    /^y cuál/i,
    /^y cuales/i,
    /^y entonces/i
  ];

  const esCorta = patronesCortos.some(pat => pat.test(p));
  if (!esCorta) return pregunta;

  const r = await pool.query(
    `SELECT mensaje FROM chat_historial
     WHERE session_id = $1 AND role = 'assistant'
     ORDER BY creado_en DESC
     LIMIT 1`,
    [session_id]
  );
  const ultimaRespuesta = r.rows[0]?.mensaje;

  if (!ultimaRespuesta) return pregunta;

  const emb = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: [ultimaRespuesta, pregunta]
  });

  const embRespuesta = emb.data[0].embedding;
  const embPregunta = emb.data[1].embedding;

  const similitud = cosineSimilarity(embRespuesta, embPregunta);

  if (similitud < 0.75) {
    return `
La nueva pregunta del usuario no está relacionada con el tema anterior.
Responder únicamente esto:
"${pregunta.replace(/^y\s*/i, "")}".
    `;
  }

  return `
La siguiente pregunta depende del contexto anterior.
Contexto previo del asistente: "${ultimaRespuesta}".
Nueva pregunta del usuario: "${pregunta}".
  `;
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
// 🤖 PROCESAR PREGUNTA (RAG con TODOS los PDFs)
// =========================================================
exports.preguntar = async (req, res) => {
  try {
    const { session_id, pregunta } = req.body;

    if (!session_id)
      return res.status(400).json({ ok: false, mensaje: "session_id es obligatorio" });

    if (!pregunta?.trim())
      return res.status(400).json({ ok: false, mensaje: "La pregunta no puede estar vacía" });

    const preguntaExpandida = await expandirPreguntaCorta(session_id, pregunta);

    await pool.query(
      `INSERT INTO chat_historial (session_id, role, mensaje)
       VALUES ($1, 'user', $2)`,
      [session_id, pregunta]
    );

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

    const embPregunta = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: preguntaExpandida,
    });

    const preguntaEmbedding = embPregunta.data[0].embedding;

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

    const top = fragmentos
      .map(f => ({
        ...f,
        score: f.embedding ? cosineSimilarity(preguntaEmbedding, f.embedding) : -1
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    // =========================================================
    // 🔥 ESTA LÍNEA ES LA CORRECCIÓN REAL
    // =========================================================
    const contexto = top.map(f => f.texto).join("\n\n");

    // =========================================================
    // Prompt final
    // =========================================================
    const mensajes = [
      {
        role: "system",
        content: `
Eres Odonto-Bot, un asistente extremadamente estricto.
REGLAS:
1. Respondes SOLO en español de chile.
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
