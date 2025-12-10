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
// 🔧 Similitud coseno (producto punto normalizado)
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
// 🔧 Pequeño boost semántico real
// ========================================================
function semanticBoost(pregunta, texto) {
  const palabrasPregunta = pregunta.toLowerCase().split(/\W+/);
  const palabrasTexto = texto.toLowerCase().split(/\W+/);

  let coincidencias = 0;
  for (const palabra of palabrasPregunta) {
    if (palabra.length > 3 && palabrasTexto.includes(palabra)) {
      coincidencias += 1;
    }
  }

  return coincidencias * 0.25;
}

// ========================================================
// 🔧 Reformular pregunta para mejor embedding
// ========================================================
async function reformularPregunta(preguntaOriginal) {
  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: "Reformula la pregunta sin cambiar su intención." },
      { role: "user", content: preguntaOriginal }
    ],
  });

  return completion.choices[0].message.content.trim();
}

// ========================================================
// 🔧 IA estricta SIN inventar NADA
// ========================================================
async function generarRespuestaIA(pregunta, textoBase) {
  const systemPrompt = `
Eres Odonto-Bot.
Responde SIEMPRE en español.
No inventes información.
Utiliza únicamente el contenido proporcionado como referencia.
Si no encuentras información suficiente para responder, responde EXACTAMENTE:
"No dispongo de información que permita responder esa pregunta."
`;

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "assistant", content: textoBase },
      { role: "user", content: pregunta },
    ],
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
// 🤖 PROCESAR PREGUNTA — RAG PROFESIONAL
// =========================================================
exports.preguntar = async (req, res) => {
  try {
    const { session_id, pregunta } = req.body;

    if (!session_id)
      return res.status(400).json({ ok: false, mensaje: "session_id es obligatorio" });

    if (!pregunta?.trim())
      return res.status(400).json({ ok: false, mensaje: "La pregunta no puede estar vacía" });

    // Guardar pregunta
    await pool.query(
      `INSERT INTO chat_historial (session_id, role, mensaje)
       VALUES ($1, 'user', $2)`,
      [session_id, pregunta]
    );

    // 1️⃣ Reformular
    const preguntaReformulada = await reformularPregunta(pregunta);

    // 2️⃣ Embedding
    const embPregunta = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: preguntaReformulada,
    });

    const preguntaEmbedding = normalize(embPregunta.data[0].embedding);

    // 3️⃣ Obtener fragmentos
    const result = await pool.query(`
      SELECT fragmento_index, texto, embedding
      FROM documentos_fragmentos
    `);

    const fragmentos = result.rows.map(f => {
      let emb = null;

      try {
        if (typeof f.embedding === "string") emb = JSON.parse(f.embedding);
        else if (Array.isArray(f.embedding)) emb = f.embedding;
      } catch {
        emb = null;
      }

      emb = emb ? normalize(emb) : null;

      return {
        index: f.fragmento_index,
        texto: f.texto,
        embedding: emb,
      };
    });

    // 4️⃣ Ranking
    const ranked = fragmentos.map(f => {
      const sim = f.embedding ? cosineSimilarity(preguntaEmbedding, f.embedding) : 0;
      const boost = semanticBoost(preguntaReformulada, f.texto);
      return { ...f, score: sim + boost };
    });

    const top = ranked.sort((a, b) => b.score - a.score).slice(0, 12);

    // Si los puntajes son extremadamente bajos → no hay información suficiente
    const maxScore = top.length > 0 ? top[0].score : 0;

    if (maxScore < 0.05) {
      const finalResp = "No dispongo de información que permita responder esa pregunta.";

      await pool.query(
        `INSERT INTO chat_historial (session_id, role, mensaje)
         VALUES ($1, 'assistant', $2)`,
        [session_id, finalResp]
      );

      return res.json({ ok: true, respuesta: finalResp });
    }

    // Crear contexto
    const contexto = top.map(f => f.texto).join("\n\n");

    // 5️⃣ Generar respuesta de IA sin inventar
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
    });

  } catch (e) {
    console.error("❌ Error procesando pregunta:", e);
    res.status(500).json({ ok: false, mensaje: "Error interno", error: e.message });
  }
};
