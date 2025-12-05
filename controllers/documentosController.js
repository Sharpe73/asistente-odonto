const pool = require("../database");
const fs = require("fs");
const path = require("path");
const { extraerTextoDesdePDF, fragmentarTexto } = require("../utils/pdfProcessor");
const OpenAI = require("openai");

// Inicializar OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// =========================================================
// 📌 SUBIR DOCUMENTO PDF + LIMPIEZA + EMBEDDINGS
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

    // 1️⃣ EXTRAER TEXTO LIMPIO
    let textoExtraído = await extraerTextoDesdePDF(rutaPDF);

    if (!textoExtraído || textoExtraído.trim() === "") {
      return res.status(400).json({
        ok: false,
        mensaje: "No se pudo extraer texto del PDF",
      });
    }

    // 🔥 1.1 LIMPIEZA PROFESIONAL DEL TEXTO
    textoExtraído = textoExtraído
      .replace(/\r/g, " ")
      .replace(/\n{2,}/g, "\n")
      .replace(/ {2,}/g, " ")
      .trim()
      .normalize("NFC");

    console.log("🔍 Largo del texto extraído:", textoExtraído.length, "caracteres");

    // 2️⃣ LEER PDF ORIGINAL
    const bufferOriginal = fs.readFileSync(rutaPDF);

    // 3️⃣ GUARDAR DOCUMENTO
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
        null, // <- si luego quieres detectar páginas reales se cambia aquí
        true,
        null,
        {},
        archivo.originalname,
        archivo.filename,
      ]
    );

    const documentoId = resultadoDoc.rows[0].id;

    // 4️⃣ FRAGMENTAR (nueva longitud óptima)
    const fragmentos = fragmentarTexto(textoExtraído, 1800);

    console.log(`🧩 Total de fragmentos generados: ${fragmentos.length}`);

    // 5️⃣ EMBEDDINGS + GUARDAR EN TABLA documentos_fragmentos
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
        [
          documentoId,
          i + 1,
          textoFragmento,
          embedding // JSONB directo
        ]
      );
    }

    // 6️⃣ ELIMINAR ARCHIVO FÍSICO TEMPORAL
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
