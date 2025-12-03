const pool = require("../database");
const OpenAI = require("openai");

// Inicializar cliente OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// ========================================================
// 🧠 Función IA: Generar respuesta basada SOLO en el PDF
// ========================================================
async function generarRespuestaIA(pregunta, contexto) {
  const prompt = `
Eres un asistente especializado en documentos odontológicos.
Responde SOLO usando la información del siguiente contenido:

------------------------
${contexto}
------------------------

Pregunta del usuario: "${pregunta}"

Si la respuesta no está en el contenido, responde:
"No tengo información suficiente en el documento para responder eso."
  `;

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }],
  });

  return completion.choices[0].message.content;
}

// ========================================================
// 📌 Controlador principal: Buscar fragmentos + IA
// ========================================================
exports.preguntar = async (req, res) => {
  try {
    const { documentoId, pregunta } = req.body;

    if (!documentoId || !pregunta) {
      return res.status(400).json({
        ok: false,
        mensaje: "documentoId y pregunta son obligatorios",
      });
    }

    // 1️⃣ Buscar fragmentos del documento
    const result = await pool.query(
      `SELECT fragmento_index, texto
       FROM documentos_fragmentos
       WHERE documento_id = $1
       ORDER BY fragmento_index ASC`,
      [documentoId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        ok: false,
        mensaje: "No se encontraron fragmentos para este documento",
      });
    }

    // 2️⃣ Unir fragmentos como contexto
    const contexto = result.rows.map(f => f.texto).join("\n");

    // 3️⃣ Llamar a OpenAI
    const respuestaIA = await generarRespuestaIA(pregunta, contexto);

    // 4️⃣ Enviar respuesta
    res.json({
      ok: true,
      mensaje: "Respuesta generada por IA",
      respuesta: respuestaIA,
    });

  } catch (error) {
    console.error("❌ Error en preguntar:", error);

    res.status(500).json({
      ok: false,
      mensaje: "Error interno del servidor",
      error: error.message
    });
  }
};
