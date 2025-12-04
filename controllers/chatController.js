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
    if (!["user", "assistant"].includes(role))
      return res.status(400).json({ ok: false, mensaje: "role debe ser user o assistant" });

    await pool.query(
      `INSERT INTO chat_historial (session_id, role, mensaje)
       VALUES ($1, $2, $3)`,
      [session_id, role, mensaje]
    );

    res.json({ ok: true });

  } catch (error) {
    console.error("Error registrar mensaje:", error);
    res.status(500).json({ ok: false });
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
    console.error("Error historial:", error);
    res.status(500).json({ ok: false });
  }
};

// =========================================================
// 🆕 Crear sesión GLOBAL (sin documento_id)
// =========================================================
exports.crearSesion = async (req, res) => {
  try {
    const session_id = generarSessionId();

    await pool.query(
      `INSERT INTO sesiones (session_id)
       VALUES ($1)`,
      [session_id]
    );

    res.json({
      ok: true,
      session_id,
      mensaje: "Sesión creada correctamente",
    });

  } catch (error) {
    console.error("Error creando sesión:", error);
    res.status(500).json({ ok: false });
  }
};

// =========================================================
// 🤖 Procesar pregunta (RAG GLOBAL + MEMORIA REAL DE CHAT)
// =========================================================
exports.preguntar = async (req, res) => {
  try {
    const { session_id, pregunta } = req.body;

    if (!session_id)
      return res.status(400).json({ ok: false, mensaje: "session_id es obligatorio" });

    if (!pregunta?.trim())
      return res.status(400).json({ ok: false, mensaje: "La pregunta no puede estar vacía" });

    // =====================================================
    // 1️⃣ Guardar pregunta del usuario
    // =====================================================
    await pool.query(
      `INSERT INTO chat_historial (session_id, role, mensaje)
       VALUES ($1, 'user', $2)`,
      [session_id, pregunta]
    );

    // =====================================================
    // 2️⃣ Recuperar memoria real (últimos 10 mensajes)
    // =====================================================
    const memRes = await pool.query(
      `SELECT role, mensaje
       FROM chat_historial
       WHERE session_id = $1
       ORDER BY creado_en DESC
       LIMIT 10`,
      [session_id]
    );

    const historial = memRes.rows.reverse();

    const memoriaChat = historial.map(m => ({
      role: m.role,
      content: m.mensaje
    }));

    // =====================================================
    // 3️⃣ Embedding de la pregunta
    // =====================================================
    const pregEmb = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: pregunta,
    });

    const preguntaEmbedding = pregEmb.data[0].embedding;

    // =====================================================
    // 4️⃣ Traer todos los fragmentos de todos los documentos
    // =====================================================
    const fragRes = await pool.query(`
      SELECT fragmento_index, texto, embedding
      FROM documentos_fragmentos
    `);

    const fragmentos = fragRes.rows.map(f => {
      let emb = f.embedding;

      if (typeof emb === "string") {
        try {
          emb = emb.replace(/{/g, "[").replace(/}/g, "]");
          emb = JSON.parse(emb);
        } catch (e) {
          console.error("❌ Error convirtiendo embedding:", f.embedding);
          emb = null;
        }
      }

      return {
        index: f.fragmento_index,
        texto: f.texto,
        embedding: emb
      };
    });

    // =====================================================
    // 5️⃣ Similaridad coseno
    // =====================================================
    const puntuados = fragmentos
      .map(f => ({
        ...f,
        score: f.embedding ? cosineSimilarity(preguntaEmbedding, f.embedding) : -1
      }))
      .filter(f => f.embedding && f.score > 0)
      .sort((a, b) => b.score - a.score);

    const top = puntuados.slice(0, 5);
    const contexto = top.map(f => f.texto).join("\n\n") || "";

    // =====================================================
    // 6️⃣ Construir mensajes para OpenAI (MEMORIA + CONTEXTO)
    // =====================================================
    const mensajes = [
      {
        role: "system",
        content:
          "Eres Odonto-Bot, un asistente especializado. Usa SOLO el contexto entregado. Si falta información, responde exactamente: 'No tengo información suficiente en el documento para responder eso.'"
      },

      // 🧠 Aquí va la memoria REAL
      ...memoriaChat,

      // 🧾 Nueva pregunta del usuario, sin texto artificial
      {
        role: "user",
        content: pregunta
      },

      // 📚 Contexto del documento como mensaje del asistente
      {
        role: "assistant",
        content: `Aquí tienes el contexto relevante proveniente de los documentos:\n${contexto}`
      }
    ];

    // =====================================================
    // 7️⃣ Llamado a OpenAI
    // =====================================================
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: mensajes
    });

    const respuesta = completion.choices[0].message.content;

    // =====================================================
    // 8️⃣ Guardar respuesta del asistente
    // =====================================================
    await pool.query(
      `INSERT INTO chat_historial (session_id, role, mensaje)
       VALUES ($1, 'assistant', $2)`,
      [session_id, respuesta]
    );

    // =====================================================
    // 9️⃣ Enviar respuesta al frontend
    // =====================================================
    res.json({
      ok: true,
      respuesta,
      fragmentos_usados: top.length
    });

  } catch (error) {
    console.error("❌ Error procesando pregunta:", error);
    res.status(500).json({
      ok: false,
      mensaje: "Error interno",
      error: error.message,
    });
  }
};
