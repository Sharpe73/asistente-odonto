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
// 📝 Función auxiliar para respuestas sin datos
// =========================================================
async function responderSinDatos(session_id, res) {
  const texto = "No tengo información suficiente en el documento para responder eso.";

  await pool.query(
    `INSERT INTO chat_historial (session_id, role, mensaje)
     VALUES ($1, 'assistant', $2)`,
    [session_id, texto]
  );

  return res.json({
    ok: true,
    respuesta: texto,
    fragmentos_usados: 0
  });
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
// 🆕 Crear sesión GLOBAL
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
// 🤖 Procesar pregunta (RAG + MEMORIA + RESPUESTAS EN ESPAÑOL)
// =========================================================
exports.preguntar = async (req, res) => {
  try {
    const { session_id, pregunta } = req.body;

    if (!session_id)
      return res.status(400).json({ ok: false, mensaje: "session_id es obligatorio" });

    if (!pregunta?.trim())
      return res.status(400).json({ ok: false, mensaje: "La pregunta no puede estar vacía" });

    // =====================================================
    // 🧹 Limpiar texto
    // =====================================================
    let normalizada = pregunta
      .toLowerCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[^\w\s]/g, "")
      .trim();

    // =====================================================
    // 👋 Detectar saludos
    // =====================================================
    const saludos = [
      "hola","holaa","holaaa","holi","oli","ola",
      "hello","hi","hey",
      "alo","aloo",
      "buenas","wenas",
      "buen dia","buenos dias",
      "buenas tardes","buenas noches",
      "hola como estas","hola que tal","como estas","como va"
    ];

    const esSaludo = saludos.some(s => normalizada.startsWith(s));

    if (esSaludo) {
      const saludo = "¡Hola! Soy Odonto-Bot. ¿En qué puedo ayudarte hoy?";

      await pool.query(
        `INSERT INTO chat_historial (session_id, role, mensaje)
         VALUES ($1, 'assistant', $2)`,
        [session_id, saludo]
      );

      return res.json({ ok: true, respuesta: saludo, fragmentos_usados: 0 });
    }

    // =====================================================
    // Guardar pregunta
    // =====================================================
    await pool.query(
      `INSERT INTO chat_historial (session_id, role, mensaje)
       VALUES ($1, 'user', $2)`,
      [session_id, pregunta]
    );

    // =====================================================
    // Recuperar memoria
    // =====================================================
    const memRes = await pool.query(
      `SELECT role, mensaje
       FROM chat_historial
       WHERE session_id = $1
       ORDER BY creado_en DESC
       LIMIT 10`,
      [session_id]
    );

    const memoriaChat = memRes.rows.reverse().map(m => ({
      role: m.role,
      content: m.mensaje
    }));

    // =====================================================
    // Embedding de la pregunta
    // =====================================================
    const emb = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: pregunta,
    });

    const preguntaEmbedding = emb.data[0].embedding;

    // =====================================================
    // Obtener fragmentos
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
        } catch {
          emb = null;
        }
      }
      return { index: f.fragmento_index, texto: f.texto, embedding: emb };
    });

    // =====================================================
    // RAG FIX: PDF con 1 fragmento → usar completo
    // =====================================================
    let top = [];

    if (fragmentos.length === 1) {
      top = fragmentos;
    } else {
      // Ranking normal
      const puntuados = fragmentos
        .map(f => ({
          ...f,
          score: f.embedding ? cosineSimilarity(preguntaEmbedding, f.embedding) : -1
        }))
        .sort((a, b) => b.score - a.score);

      // Aplicar UMBRAL de relevancia
      const filtrados = puntuados.filter(f => f.score >= 0.25);

      if (filtrados.length === 0) {
        return responderSinDatos(session_id, res);
      }

      top = filtrados.slice(0, 3);
    }

    const contexto = top.map(f => f.texto).join("\n\n") || "";

    // =====================================================
    // Prompt estricto
    // =====================================================
    const mensajes = [
      {
        role: "system",
        content: `
Eres Odonto-Bot, un asistente extremadamente estricto.

REGLAS:
1. Solo respondes usando información del documento.
2. Si NO está literalmente en los fragmentos, responde:
   "No tengo información suficiente en el documento para responder eso."
3. No inventas, no asumes, no completas ideas.
4. Prohibido usar conocimientos externos.
5. Respondes siempre en español.
`
      },
      ...memoriaChat,
      { role: "assistant", content: `Fragmentos relevantes:\n${contexto}` },
      { role: "user", content: pregunta }
    ];

    // =====================================================
    // OpenAI
    // =====================================================
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages
    });

    const respuesta = completion.choices[0].message.content;

    // =====================================================
    // Guardar respuesta
    // =====================================================
    await pool.query(
      `INSERT INTO chat_historial (session_id, role, mensaje)
       VALUES ($1, 'assistant', $2)`,
      [session_id, respuesta]
    );

    // =====================================================
    // Responder
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
