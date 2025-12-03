const pool = require("../database");
const OpenAI = require("openai");

// Inicializar cliente OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// =========================================================
// 🤖 CONTROLADOR: Responder preguntas usando IA + fragmentos
// =========================================================
exports.responderPregunta = async (req, res) => {
  try {
    const { documentoId, pregunta } = req.body;

    if (!documentoId || !pregunta) {
      return res.status(400).json({
        ok: false,
        mensaje: "Debes enviar 'documentoId' y 'pregunta'"
      });
    }

    // 1️⃣ OBTENER FRAGMENTOS DEL DOCUMENTO
    const resultado = await pool.query(
      `SELECT fragmento_index, texto 
       FROM documentos_fragmentos 
       WHERE documento_id = $1
       ORDER BY fragmento_index ASC`,
      [documentoId]
    );

    if (resultado.rows.length === 0) {
      return res.status(404).json({
        ok: false,
        mensaje: "No existen fragmentos para este documento"
      });
    }

    // 2️⃣ UNIR FRAGMENTOS para contexto
    const contexto = resultado.rows
      .map(f => `Fragmento ${f.fragmento_index}:\n${f.texto}`)
      .join("\n\n");

    // 3️⃣ CREAR PROMPT PARA OPENAI
    const prompt = `
Eres un asistente experto en odontología.  
Responde a la pregunta del usuario SOLO usando la información contenida en el siguiente documento:

=========================
DOCUMENTO:
${contexto}
=========================

PREGUNTA DEL USUARIO:
${pregunta}

Da una respuesta clara, profesional y sin inventar información que no aparezca en el documento.
`;

    // 4️⃣ CONSULTAR OPENAI
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "Eres un asistente especializado en documentos clínicos odontológicos." },
        { role: "user", content: prompt }
      ]
    });

    const respuesta = completion.choices[0].message.content;

    // 5️⃣ RESPUESTA FINAL
    res.json({
      ok: true,
      mensaje: "Respuesta generada correctamente",
      respuesta
    });

  } catch (error) {
    console.error("❌ Error al responder pregunta:", error);
    res.status(500).json({
      ok: false,
      mensaje: "Error interno del servidor",
      error: error.message
    });
  }
};
