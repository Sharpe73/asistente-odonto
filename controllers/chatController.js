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

// ====================================================================
// 🔥 EXPANDIR SOLO SI LA PREGUNTA CORTA NO CONTIENE UNA PALABRA CLAVE
//     *** CORREGIDA CON EL FIX DEFINITIVO ***
// ====================================================================
async function expandirPreguntaCorta(session_id, pregunta) {
  const corta = pregunta.trim().toLowerCase();

  // Palabras clave → NO expandir nunca
  const palabrasClaras = [
    "dentina",
    "pulpa",
    "esmalte",
    "ligamento",
    "periodontal",
    "pulp",
    "dentin",
    "enamel"
  ];

  if (palabrasClaras.some(p => corta.includes(p))) {
    return pregunta; // NO expandir, es una pregunta real
  }

  // Patrones que SÍ se expanden
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

  if (!patrones.some(p => p.test(corta))) {
    return pregunta;
  }

  // Obtener última pregunta REAL distinta a la actual
  const q = await pool.query(
    `SELECT mensaje FROM chat_historial
     WHERE session_id = $1 AND role = 'user'
       AND mensaje <> $2
     ORDER BY creado_en DESC
     LIMIT 1`,
    [session_id, pregunta]
  );

  if (q.rows.length === 0) return pregunta;

  const ultimaPregunta = q.rows[0].mensaje;

  return `${ultimaPregunta}. Además, respecto a tu última pregunta: ${pregunta}`;
}

// =========================================================
// 🤖 Procesar pregunta
// =========================================================
exports.preguntar = async (req, res) => {
  try {
    const { session_id, pregunta } = req.body;

    if (!session_id)
      return res.status(400).json({ ok: false, mensaje: "session_id es obligatorio" });

    if (!pregunta?.trim())
      return res.status(400).json({ ok: false, mensaje: "La pregunta no puede estar vacía" });

    // EXPANDIR SI CORRESPONDE
    const preguntaExpandida = await expandirPreguntaCorta(session_id, pregunta);

    // Guardar pregunta original
    await pool.query(
      `INSERT INTO chat_historial (session_id, role, mensaje)
       VALUES ($1, 'user', $2)`,
      [session_id, pregunta]
    );

    // MEMORIA
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

    // EMBEDDING
    const emb = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: preguntaExpandida,
    });

    const preguntaEmbedding = emb.data[0].embedding;

    // FRAGMENTOS
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

      return {
        index: f.fragmento_index,
        texto: f.texto,
        embedding: emb
      };
    });

    // RANKING
    let top = [];

    if (fragmentos.length === 1) {
      top = fragmentos;
    } else {
      const puntuados = fragmentos
        .map(f => ({
          ...f,
          score: f.embedding ? cosineSimilarity(preguntaEmbedding, f.embedding) : -1
        }))
        .filter(f => f.embedding && f.score > 0)
        .sort((a, b) => b.score - a.score);

      top = puntuados.slice(0, 5);
    }

    const contexto = top.map(f => f.texto).join("\n\n") || "";

    // PROMPT
    const mensajes = [
      {
        role: "system",
        content: `
Eres Odonto-Bot, un asistente extremadamente estricto.

REGLAS:
1. Respondes SIEMPRE en español.
2. NO inventas nada.
3. NO usas conocimientos externos.
4. Si algo NO está en el documento dices:
   "No tengo información suficiente en el documento para responder eso."
5. Puedes traducir, pero no agregar contenido.
6. Usa exclusivamente los fragmentos entregados.
`
      },

      ...memoriaChat,

      { role: "user", content: preguntaExpandida },

      {
        role: "assistant",
        content: `Fragmentos relevantes del documento:\n${contexto}`
      }
    ];

    // OPENAI REQUEST
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: mensajes
    });

    const respuesta = completion.choices[0].message.content;

    // GUARDAR RESPUESTA
    await pool.query(
      `INSERT INTO chat_historial (session_id, role, mensaje)
       VALUES ($1, 'assistant', $2)`,
      [session_id, respuesta]
    );

    // RESPUESTA FINAL
    res.json({
      ok: true,
      respuesta,
      fragmentos_usados: top.length,
      pregunta_expandida: preguntaExpandida
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
