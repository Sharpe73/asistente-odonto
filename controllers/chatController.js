const pool = require("../database");
const { generarSessionId } = require("../utils/session");
const OpenAI = require("openai");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// =========================================================
// 🧮 Similitud coseno segura (tolera vectores inválidos)
// =========================================================
function cosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB || !Array.isArray(vecA) || !Array.isArray(vecB)) {
    return -1; // fuerza score muy bajo → automáticamente ignorado
  }

  let dot = 0.0;
  let normA = 0.0;
  let normB = 0.0;

  for (let i = 0; i < vecA.length; i++) {
    dot += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }

  if (normA === 0 || normB === 0) return -1;

  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// =========================================================
// 📝 Registrar mensaje
// =========================================================
exports.registrarMensaje = async (req, res) => {
  try {
    const { session_id, role, mensaje } = req.body;

    if (!session_id) return res.status(400).json({ ok: false, mensaje: "session_id es obligatorio" });
    if (!role || (role !== "user" && role !== "assistant"))
      return res.status(400).json({ ok: false, mensaje: "role debe ser 'user' o 'assistant'" });

    await pool.query(
      `INSERT INTO chat_historial (session_id, role, mensaje)
      VALUES ($1, $2, $3)`,
      [session_id, role, mensaje]
    );

    res.json({ ok: true, mensaje: "Mensaje registrado correctamente" });

  } catch (error) {
    console.error("Error al registrar mensaje:", error);
    res.status(500).json({ ok: false, mensaje: "Error en el servidor" });
  }
};

// =========================================================
// 📚 Obtener historial
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

  } catch (error) {
    console.error("Error obteniendo historial:", error);
    res.status(500).json({ ok: false, mensaje: "Error en el servidor" });
  }
};

// =========================================================
// 🆕 Crear sesión (ACEPTA documento_id POR BODY O QUERY)
// =========================================================
exports.crearSesion = async (req, res) => {
  try {
    const documento_id = req.body.documento_id || req.query.documento_id;

    console.log("📥 documento_id recibido:", documento_id);

    if (!documento_id) {
      return res.status(400).json({
        ok: false,
        mensaje: "documento_id es obligatorio para crear una sesión"
      });
    }

    const session_id = generarSessionId();

    await pool.query(
      `INSERT INTO sesiones (session_id, documento_id)
       VALUES ($1, $2)`,
      [session_id, documento_id]
    );

    res.json({
      ok: true,
      session_id,
      documento_id,
      mensaje: "Sesión creada correctamente",
    });

  } catch (error) {
    console.error("Error creando sesión:", error);
    res.status(500).json({ ok: false, mensaje: "Error en el servidor" });
  }
};

// =========================================================
// 🤖 Procesar pregunta con RAG + memoria
// =========================================================
exports.preguntar = async (req, res) => {
  try {
    const { session_id, pregunta } = req.body;

    if (!session_id)
      return res.status(400).json({ ok: false, mensaje: "session_id es obligatorio" });

    if (!pregunta || pregunta.trim() === "")
      return res.status(400).json({ ok: false, mensaje: "La pregunta no puede estar vacía" });

    // 1️⃣ Buscar documento asociado
    const sesRes = await pool.query(
      `SELECT documento_id FROM sesiones WHERE session_id = $1`,
      [session_id]
    );

    if (sesRes.rows.length === 0)
      return res.status(404).json({ ok: false, mensaje: "Sesión no encontrada" });

    const documento_id = sesRes.rows[0].documento_id;

    // 2️⃣ Guardar pregunta en historial
    await pool.query(
      `INSERT INTO chat_historial (session_id, role, mensaje)
      VALUES ($1, 'user', $2)`,
      [session_id, pregunta]
    );

    // 3️⃣ Embedding de la pregunta
    const pregEmb = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: pregunta,
    });

    const preguntaEmbedding = pregEmb.data[0].embedding;

    // 4️⃣ Obtener fragmentos del documento
    const fragRes = await pool.query(
      `SELECT fragmento_index, texto, embedding
      FROM documentos_fragmentos
      WHERE documento_id = $1`,
      [documento_id]
    );

    const fragmentos = fragRes.rows.map(f => ({
      index: f.fragmento_index,
      texto: f.texto,
      embedding: f.embedding ? JSON.parse(f.embedding) : null,
    }));

    // 5️⃣ Calcular similitud coseno y filtrar NULL
    const puntuados = fragmentos
      .map(f => ({
        ...f,
        score: cosineSimilarity(preguntaEmbedding, f.embedding)
      }))
      .filter(f => f.score > 0)
      .sort((a, b) => b.score - a.score);

    let top = puntuados.slice(0, 5);
    let contexto = top.map(f => f.texto).join("\n\n");

    if (top.length === 0) contexto = "";

    // 6️⃣ Generar respuesta con OpenAI
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "Eres Odonto-Bot. Responde SOLO usando información del contexto. Si no está en el documento, responde exactamente: 'No tengo información suficiente en el documento para responder eso.'",
        },
        {
          role: "user",
          content: `Contexto del documento:\n${contexto}\n\nPregunta: ${pregunta}`,
        },
      ],
    });

    const respuesta = completion.choices[0].message.content;

    // 7️⃣ Guardar respuesta
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

  } catch (error) {
    console.error("❌ Error procesando pregunta:", error);
    res.status(500).json({
      ok: false,
      mensaje: "Error interno del servidor",
      error: error.message,
    });
  }
};
