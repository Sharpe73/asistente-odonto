const pool = require("../database");
const fs = require("fs");
const path = require("path");
const { extraerTextoDesdePDF, fragmentarTexto } = require("../utils/pdfProcessor");

const OpenAI = require("openai");

// 🔹 Inicializar OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// =========================================================
// 📌 SUBIR DOCUMENTO PDF + GENERAR EMBEDDINGS
// =========================================================
exports.subirDocumento = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        ok: false,
        mensaje: "Debes subir un archivo PDF",
      });
    }

    const archivo = req.file;
    const rutaPDF = archivo.path;

    console.log("📄 PDF recibido:", rutaPDF);

    // 1️⃣ EXTRAER TEXTO LIMPIO DEL PDF — FUNCIÓN CORRECTA
    const textoExtraído = await extraerTextoDesdePDF(rutaPDF);

    if (!textoExtraído || textoExtraído.trim() === "") {
      return res.status(400).json({
        ok: false,
        mensaje: "No se pudo extraer texto del PDF",
      });
    }

    // 2️⃣ GUARDAR DOCUMENTO COMPLETO
    const bufferOriginal = fs.readFileSync(rutaPDF);

    const resultadoDoc = await pool.query(
      `INSERT INTO documentos (
          nombre_original,
          extension,
          tipo,
          tamano,
          archivo_original,
          contenido_texto,
          paginas,
          procesado,
          resumen,
          metadata,
          titulo,
          ruta_archivo
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      RETURNING id`,
      [
        archivo.originalname,
        path.extname(archivo.originalname),
        archivo.mimetype,
        archivo.size,
        bufferOriginal,
        textoExtraído,
        null, 
        true,
        null,
        {},
        archivo.originalname,
        archivo.filename,
      ]
    );

    const documentoId = resultadoDoc.rows[0].id;

    // 3️⃣ FRAGMENTAR TEXTO (1400 caracteres)
    const fragmentos = fragmentarTexto(textoExtraído, 1400);

    // 4️⃣ GENERAR EMBEDDINGS + GUARDAR FRAGMENTOS
    for (let i = 0; i < fragmentos.length; i++) {
      const textoFragmento = fragmentos[i];

      const embeddingResponse = await openai.embeddings.create({
        model: "text-embedding-3-small",
        input: textoFragmento,
      });

      const embedding = embeddingResponse.data[0].embedding;

      await pool.query(
        `INSERT INTO documentos_fragmentos 
          (documento_id, fragmento_index, texto, embedding)
         VALUES ($1, $2, $3, $4)`,
        [documentoId, i + 1, textoFragmento, JSON.stringify(embedding)]
      );
    }

    // 5️⃣ ELIMINAR ARCHIVO TEMPORAL
    fs.unlinkSync(rutaPDF);

    res.json({
      ok: true,
      mensaje: "Documento subido, limpiado, fragmentado y embebido correctamente ✔",
      documentoId,
      total_fragmentos: fragmentos.length,
    });

  } catch (error) {
    console.error("❌ Error al subir documento:", error);
    res.status(500).json({
      ok: false,
      mensaje: "Error interno del servidor",
      error: error.message,
    });
  }
};
