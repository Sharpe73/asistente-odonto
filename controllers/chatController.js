const pool = require("../database");
const { generarSessionId } = require("../utils/session");
const OpenAI = require("openai");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// =========================================================
// 🧮 Similitud coseno entre dos vectores
// =========================================================
function cosineSimilarity(vecA, vecB) {
  let dot = 0.0;
  let normA = 0.0;
  let normB = 0.0;

  for (let i = 0; i < vecA.length; i++) {
    dot += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }

  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// =========================================================
// 📝 Registrar mensaje en historial
// =========================================================
exports.registrarMensaje = async (req, res) => {
  try {
    const { session_id, role, mensaje } = req.body;

    if (!session_id) {
      return res.status(400).json({ ok: false, mensaje: "session_id es obligatorio" });
    }

    if (!role || (role !== "user" && role !== "assistant")) {
      return res.status(400).json({ ok: false, mensaje: "role inválido" });
    }

    await pool.query(
      `INSERT INTO chat_historial (session_id, role, mensaje)
       VALUES ($1, $2, $3)`,
      [session_id, role, mensaje]
    );

    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ ok: false, mensaje: "Error en el servidor" });
  }
};

// =========================================================
// 📚 Obtener historial de conversación
// =========================================================
exports.obtenerHistorial = async (req, res) => {
  try {
    const { session_id } = req.params;

    const result = await pool.query(
      `SELECT role, mensaje 
       FROM chat_historial
       WHERE session_id = $1
       ORDER BY creado_en ASC`,
      [session_id]
    );

    res.json({ ok: true, historial: result.rows });
  } catch (error) {
    res.status(500).json({ ok: false });
  }
};

// =========================================================
// 🆕 Crear sesión vinculada a documento
// =========================================================
exports.crearSesion = async (req, res) => {
  try {
    const { documento_id } = req.body;

    if (!documento_id) {
      return res.status(400).json({ ok: false, mensaje: "documento_id requerido" });
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
    });
  } catch (error) {
    res.status(500).json({ ok: false });
  }
};

// =========================================================
// 🤖 PROCESAR PREGUNTA — RAG SEMÁNTICO + MEMORIA
// =========================================================
exports.preguntar = async (req, res) => {
  try {
    const { session_id, pregunta } = req.body;

    if (!session_id) {
      return res.status(400).json({ ok: false, mensaje: "session_id es obligatorio" });
    }

    if (!pregunta || pregunta.trim() === "") {
      return res.status(400).json({ ok: false, mensaje: "La pregunta no puede estar vacía" });
    }

    // ---------------------------------------------
    // 1️⃣ Recuperar documento asociado a la sesión
    // ---------------------------------------------
    const sesionResult = await pool.query(
      `SELECT documento_id FROM sesiones WHERE session_id = $1`,
      [session_id]
    );

    if (sesionResult.rows.length === 0) {
      return res.status(404).json({ ok: false, mensaje: "Sesión no encontrada" });
    }

    const documento_id = sesionResult.rows[0].documento_id;

    // ---------------------------------------------
    // 2️⃣ Guardar pregunta en historial
    // ---------------------------------------------
    await pool.query(
      `INSERT INTO chat_historial (session_id, role, mensaje)
       VALUES ($1, 'user', $2)`,
      [session_id, pregunta]
    );

    // ---------------------------------------------
    // 3️⃣ Obtener historial para memoria conversacional
    // ---------------------------------------------
    const historialDB = await pool.query(
      `SELECT role, mensaje 
       FROM chat_historial
       WHERE session_id = $1
       ORDER BY creado_en ASC`,
      [session_id]
    );

    const mensajesPrevios = historialDB.rows.map((m) => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: m.mensaje,
    }));

    // ---------------------------------------------
    // 4️⃣ Embedding de la pregunta
    // ---------------------------------------------
    const preguntaEmb = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: pregunta,
    });

    const preguntaEmbedding = preguntaEmb.data[0].embedding;

    // ---------------------------------------------
    // 5️⃣ Obtener fragmentos del documento
    // ---------------------------------------------
    const fragBD = await pool.query(
      `SELECT texto, embedding 
       FROM documentos_fragmentos 
       WHERE documento_id = $1`,
      [documento_id]
    );

    if (fragBD.rows.length === 0) {
      // ❗ Documento sin texto indexado → responder fijo
      const msg = "Lo siento, no tengo esa información en los documentos cargados.";

      await pool.query(
        `INSERT INTO chat_historial (session_id, role, mensaje)
         VALUES ($1, 'assistant', $2)`,
        [session_id, msg]
      );

      return res.json({ ok: true, respuesta: msg });
    }

    // ---------------------------------------------
    // 6️⃣ Calcular similitud coseno por cada fragmento
    // ---------------------------------------------
    const fragmentos = fragBD.rows.map((f) => ({
      texto: f.texto,
      embedding: JSON.parse(f.embedding),
    }));

    const fragmentosRanked = fragmentos
      .map((frag) => ({
        texto: frag.texto,
        score: cosineSimilarity(preguntaEmbedding, frag.embedding),
      }))
      .sort((a, b) => b.score - a.score);

    // ---------------------------------------------
    // 7️⃣ Seleccionar top 5
    // ---------------------------------------------
    const topFragmentos = fragmentosRanked.slice(0, 5);

    // ❗ Si no hay fragmentos relevantes → responder fijo
    if (!topFragmentos || topFragmentos.length === 0 || topFragmentos[0].score < 0.15) {
      const msg = "Lo siento, no tengo esa información en los documentos cargados.";

      await pool.query(
        `INSERT INTO chat_historial (session_id, role, mensaje)
         VALUES ($1, 'assistant', $2)`,
        [session_id, msg]
      );

      return res.json({ ok: true, respuesta: msg });
    }

    const contexto = topFragmentos.map((f) => f.texto).join("\n\n");

    // ---------------------------------------------
    // 8️⃣ Llamar a OpenAI con MEMORIA + CONTEXTO
    // ---------------------------------------------
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "Eres Odonto-Bot, un asistente odontológico. Responde SOLO en base al contexto del documento y el historial. Si no existe información, responde exactamente: 'Lo siento, no tengo esa información en los documentos cargados.'",
        },
        ...mensajesPrevios,
        {
          role: "user",
          content: `Contexto del documento:\n${contexto}\n\nPregunta: ${pregunta}`,
        },
      ],
    });

    const respuestaIA = completion.choices[0].message.content;

    // ---------------------------------------------
    // 9️⃣ Guardar respuesta
    // ---------------------------------------------
    await pool.query(
      `INSERT INTO chat_historial (session_id, role, mensaje)
       VALUES ($1, 'assistant', $2)`,
      [session_id, respuestaIA]
    );

    res.json({
      ok: true,
      respuesta: respuestaIA,
    });

  } catch (error) {
    console.error("❌ ERROR:", error);
    res.status(500).json({ ok: false, mensaje: "Error interno del servidor" });
  }
};
