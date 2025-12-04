const pool = require("../database");
const { generarSessionId } = require("../utils/session");
const OpenAI = require("openai");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// =========================================================
// 🧮 Función para similitud coseno entre dos vectores
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
// 📝 1. Registrar mensaje en historial
// =========================================================
exports.registrarMensaje = async (req, res) => {
  try {
    const { session_id, role, mensaje } = req.body;

    if (!session_id) {
      return res.status(400).json({ ok: false, mensaje: "session_id es obligatorio" });
    }

    if (!role || (role !== "user" && role !== "assistant")) {
      return res.status(400).json({ ok: false, mensaje: "role debe ser 'user' o 'assistant'" });
    }

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
// 📚 2. Obtener historial completo de una sesión
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
// 🆕 3. Crear nueva sesión ASOCIADA A UN DOCUMENTO
// =========================================================
exports.crearSesion = async (req, res) => {
  try {
    const { documento_id } = req.body;

    if (!documento_id) {
      return res.status(400).json({
        ok: false,
        mensaje: "documento_id es obligatorio para crear una sesión",
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
// 🤖 4. Procesar pregunta con RAG SEMÁNTICO (Embeddings)
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

    // 1️⃣ Recuperar el documento asociado a la sesión
    const sesionResult = await pool.query(
      `SELECT documento_id FROM sesiones WHERE session_id = $1`,
      [session_id]
    );

    if (sesionResult.rows.length === 0) {
      return res.status(404).json({
        ok: false,
        mensaje: "Sesión no encontrada",
      });
    }

    const documento_id = sesionResult.rows[0].documento_id;

    // 2️⃣ Guardamos la pregunta en historial
    await pool.query(
      `INSERT INTO chat_historial (session_id, role, mensaje)
       VALUES ($1, 'user', $2)`,
      [session_id, pregunta]
    );

    // 3️⃣ Generar embedding de la pregunta
    const preguntaEmbeddingResp = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: pregunta,
    });

    const preguntaEmbedding = preguntaEmbeddingResp.data[0].embedding;

    // 4️⃣ Recuperar TODOS los fragmentos del documento
    const fragmentosBD = await pool.query(
      `SELECT fragmento_index, texto, embedding
       FROM documentos_fragmentos
       WHERE documento_id = $1`,
      [documento_id]
    );

    // Convertimos embeddings desde JSONB
    const fragmentos = fragmentosBD.rows.map((f) => ({
      index: f.fragmento_index,
      texto: f.texto,
      embedding: JSON.parse(f.embedding),
    }));

    // 5️⃣ Calcular similitud coseno con cada fragmento
    const fragmentosConScore = fragmentos.map((frag) => ({
      ...frag,
      score: cosineSimilarity(preguntaEmbedding, frag.embedding),
    }));

    // 6️⃣ Ordenar fragmentos por relevancia (DESC)
    fragmentosConScore.sort((a, b) => b.score - a.score);

    // 7️⃣ Seleccionar los mejores 5 fragmentos
    const topFragmentos = fragmentosConScore.slice(0, 5);
    const contexto = topFragmentos.map((f) => f.texto).join("\n\n");

    // 8️⃣ Generar respuesta usando OpenAI
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "Eres un asistente especializado en documentos odontológicos. Responde SOLO en base al texto entregado. Si no está en el contexto, responde: 'No tengo información suficiente en el documento para responder eso.'",
        },
        {
          role: "user",
          content: `Contexto del documento:\n${contexto}\n\nPregunta: ${pregunta}`,
        },
      ],
    });

    const respuestaIA = completion.choices[0].message.content;

    // 9️⃣ Guardamos respuesta del asistente
    await pool.query(
      `INSERT INTO chat_historial (session_id, role, mensaje)
       VALUES ($1, 'assistant', $2)`,
      [session_id, respuestaIA]
    );

    // 🔟 Devolver respuesta al frontend
    res.json({
      ok: true,
      respuesta: respuestaIA,
      fragmentos_usados: topFragmentos.length,
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
