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

    const adminUsuario = req.admin.usuario;
    const archivo = req.file;
    const rutaPDF = archivo.path;

    // 1️⃣ EXTRAER TEXTO
    let textoExtraído = await extraerTextoDesdePDF(rutaPDF);

    if (!textoExtraído || textoExtraído.trim() === "") {
      return res.status(400).json({
        ok: false,
        mensaje: "No se pudo extraer texto del PDF",
      });
    }

    textoExtraído = textoExtraído
      .replace(/\r/g, " ")
      .replace(/\n{2,}/g, "\n")
      .replace(/ {2,}/g, " ")
      .trim()
      .normalize("NFC");

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
        ruta_archivo,
        subido_por
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
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
        adminUsuario,
      ]
    );

    const documentoId = resultadoDoc.rows[0].id;

    // 4️⃣ FRAGMENTAR TEXTO
    const fragmentos = fragmentarTexto(textoExtraído, 500);

    // 5️⃣ EMBEDDINGS
    for (let i = 0; i < fragmentos.length; i++) {
      const embeddingResponse = await openai.embeddings.create({
        model: "text-embedding-3-small",
        input: fragmentos[i],
      });

      await pool.query(
        `INSERT INTO documentos_fragmentos 
         (documento_id, fragmento_index, texto, embedding)
         VALUES ($1,$2,$3,$4)`,
        [
          documentoId,
          i + 1,
          fragmentos[i],
          JSON.stringify(embeddingResponse.data[0].embedding),
        ]
      );
    }

    fs.unlinkSync(rutaPDF);

    res.json({
      ok: true,
      mensaje: "Documento subido correctamente",
      documentoId,
    });
  } catch (error) {
    console.error("❌ Error al subir documento:", error);
    res.status(500).json({
      ok: false,
      mensaje: "Error interno del servidor",
    });
  }
};

// =========================================================
// 📄 LISTAR DOCUMENTOS (ADMIN)
// =========================================================
exports.listarDocumentos = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        id,
        nombre_original,
        tipo,
        tamano,
        creado_en,
        subido_por
      FROM documentos
      ORDER BY creado_en DESC
    `);

    res.json({
      ok: true,
      documentos: result.rows,
    });
  } catch (error) {
    console.error("❌ Error al listar documentos:", error);
    res.status(500).json({
      ok: false,
      mensaje: "Error al listar documentos",
    });
  }
};

// =========================================================
// 🗑️ ELIMINAR DOCUMENTO (ADMIN)
// =========================================================
exports.eliminarDocumento = async (req, res) => {
  const { id } = req.params;

  try {
    // 1️⃣ Verificar que exista
    const existe = await pool.query(
      "SELECT id FROM documentos WHERE id = $1",
      [id]
    );

    if (existe.rowCount === 0) {
      return res.status(404).json({
        ok: false,
        mensaje: "Documento no encontrado",
      });
    }

    // 2️⃣ Eliminar fragmentos
    await pool.query(
      "DELETE FROM documentos_fragmentos WHERE documento_id = $1",
      [id]
    );

    // 3️⃣ Eliminar documento
    await pool.query(
      "DELETE FROM documentos WHERE id = $1",
      [id]
    );

    res.json({
      ok: true,
      mensaje: "Documento eliminado correctamente",
    });
  } catch (error) {
    console.error("❌ Error al eliminar documento:", error);
    res.status(500).json({
      ok: false,
      mensaje: "Error al eliminar el documento",
    });
  }
};
