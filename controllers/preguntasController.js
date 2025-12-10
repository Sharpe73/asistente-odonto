const pool = require("../database");
const OpenAI = require("openai");

// ============================
// 🔧 Cargar OpenAI
// ============================
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// ========================================================
// 🧮 Normalizar vector
// ========================================================
function normalize(vec) {
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
  return norm === 0 ? vec : vec.map(v => v / norm);
}

// ========================================================
// 🧮 Similitud coseno (dot product)
// ========================================================
function cosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB) return -1;
  let dot = 0;
  for (let i = 0; i < vecA.length; i++) dot += vecA[i] * vecB[i];
  return dot;
}

// ========================================================
// 🔥 BOOST semántico para PDFs muy cortos
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
// 🔥 Reformular pregunta
// ========================================================
async function reformularPregunta(preguntaOriginal) {
  const prompt = `
Reformula la siguiente pregunta para que sea clara y específica,
sin cambiar su intención. Responde solo la pregunta reformulada:

"${preguntaOriginal}"
`;

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: "Reformula preguntas sin cambiar su intención." },
      { role: "user", content: prompt },
    ],
  });

  return completion.choices[0].message.content.trim();
}

// ========================================================
// 😎 IA ULTRA ESTRICTA MODO B — SIN INVENTOS
// ========================================================
async function generarRespuestaIA(pregunta, fragmentosTexto) {

  const systemPrompt = `
Eres un asistente extremadamente estricto. 

REGLAS:
1. Respondes SIEMPRE en español.
2. NO inventas absolutamente nada.
3. NO usas conocimientos externos.
4. SOLO puedes usar la información contenida en los fragmentos.
5. Si la respuesta está parcialmente en fragmentos, entrega SOLO la parte presente.
6. Si falta información, dilo explícitamente.
7. Si NO hay información útil en los fragmentos, responde exactamente:
   "No dispongo de información que permita responder esa pregunta."
`;

  const userPrompt = `
Pregunta: ${pregunta}

Fragmentos:
${fragmentosTexto}

INSTRUCCIONES:
- Si un fragmento responde parte de la pregunta, úsalo.
- Si falta información, dilo claramente.
- No completes nada que no esté en los fragmentos.
`;

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  });

  return completion.choices[0].message.content.trim();
}

// ========================================================
// 📌 Controlador principal RAG mejorado MODO B
// ========================================================
exports.preguntar = async (req, res) => {
  try {
    const { pregunta } = req.body;

    if (!pregunta) {
      return res.status(400).json({
        ok: false,
        mensaje: "La pregunta es obligatoria",
      });
    }

    // 1️⃣ Reformular
    const preguntaReformulada = await reformularPregunta(pregunta);

    // 2️⃣ Embedding pregunta
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

    if (result.rows.length === 0) {
      return res.status(404).json({
        ok: false,
        mensaje: "No existen documentos cargados",
      });
    }

    // 4️⃣ Procesar fragmentos con BOOST + similitud
    const fragmentosProcesados = result.rows.map(f => {
      let emb = null;

      try {
        if (typeof f.embedding === "string") {
          emb = JSON.parse(f.embedding);
        } else if (Array.isArray(f.embedding)) {
          emb = f.embedding;
        }
      } catch {
        emb = null;
      }

      emb = emb ? normalize(emb) : null;

      const scoreBase = emb ? cosineSimilarity(preguntaEmbedding, emb) : 0;
      const boost = semanticBoost(preguntaReformulada, f.texto);

      return {
        index: f.fragmento_index,
        texto: f.texto,
        score: scoreBase + boost,
      };
    });

    // 5️⃣ Tomar top 12 fragmentos
    const top = fragmentosProcesados
      .sort((a, b) => b.score - a.score)
      .slice(0, 12);

    const contexto = top.map(f => f.texto).join("\n\n");

    // 6️⃣ Generar respuesta MODO B
    const respuestaIA = await generarRespuestaIA(pregunta, contexto);

    res.json({
      ok: true,
      pregunta_reformulada: preguntaReformulada,
      respuesta: respuestaIA,
      scores: top.map(t => t.score),
      fragmentos_usados: top.length,
    });

  } catch (error) {
    console.error("❌ Error en preguntar:", error);
    res.status(500).json({
      ok: false,
      mensaje: "Error interno del servidor",
      error: error.message,
    });
  }
};
