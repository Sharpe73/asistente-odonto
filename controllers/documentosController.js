const pool = require("../database");
const fs = require("fs");
const path = require("path");
const { extraerTextoDesdePDF, fragmentarTexto } = require("../utils/pdfProcessor");

// =========================================================
// 📌 1. Subir PDF, extraer texto, guardarlo y fragmentarlo
// =========================================================
exports.subirDocumento = async (req, res) => {
  try {
    // Validar archivo
    if (!req.file) {
      return res.status(400).json({ ok: false, mensaje: "Debes subir un archivo PDF" });
    }

    const archivo = req.file;
    const rutaPDF = archivo.path; // ruta física temporal del PDF subido

    console.log("📄 PDF recibido:", rutaPDF);

    // 1️⃣ EXTRAER TEXTO USANDO OPENAI
    const textoExtraído = await extraerTextoDesdePDF(rutaPDF);

    if (!textoExtraído || textoExtraído.trim() === "") {
      return res.status(400).json({
        ok: false,
        mensaje: "No se pudo extraer texto del PDF"
      });
    }

    // 2️⃣ GUARDAR DOCUMENTO EN TABLA 'documentos'
    const resultadoDoc = await pool.query(
      `INSERT INTO documentos (titulo, ruta_archivo)
       VALUES ($1, $2)
       RETURNING id`,
      [archivo.originalname, archivo.filename]
    );

    const documentoId = resultadoDoc.rows[0].id;

    // 3️⃣ FRAGMENTAR TEXTO
    const fragmentos = fragmentarTexto(textoExtraído, 700);

    // 4️⃣ GUARDAR CADA FRAGMENTO EN DB
    for (const frag of fragmentos) {
      await pool.query(
        `INSERT INTO documentos_fragmentos (documento_id, texto)
         VALUES ($1, $2)`,
        [documentoId, frag]
      );
    }

    // 5️⃣ BORRAR ARCHIVO TEMPORAL
    fs.unlinkSync(rutaPDF);

    res.json({
      ok: true,
      mensaje: "Documento subido y procesado correctamente ✔",
      documentoId,
      total_fragmentos: fragmentos.length
    });

  } catch (error) {
    console.error("❌ Error al subir documento:", error);
    res.status(500).json({
      ok: false,
      mensaje: "Error interno del servidor",
      error: error.message
    });
  }
};
