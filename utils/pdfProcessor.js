const fs = require("fs");
const path = require("path");
const pool = require("../db/database");
const { extraerTextoDesdePDF, fragmentarTexto } = require("../utils/pdfProcessor");

// ==========================================================
// 📌 SUBIR DOCUMENTO Y PROCESARLO
// ==========================================================
exports.subirDocumento = async (req, res) => {
  try {
    // Si no viene archivo
    if (!req.file) {
      return res.status(400).json({
        ok: false,
        mensaje: "Debe subir un archivo PDF"
      });
    }

    const archivo = req.file;
    const rutaPDF = path.join(__dirname, "..", "uploads", archivo.filename);

    // ======================================================
    // 🧩 Extraer texto REAL del PDF
    // ======================================================
    const textoExtraído = await extraerTextoDesdePDF(rutaPDF);

    if (!textoExtraído || textoExtraído.length < 10) {
      return res.status(400).json({
        ok: false,
        mensaje: "El PDF no contiene texto suficiente para procesar"
      });
    }

    // ======================================================
    // ✂️ Fragmentar el texto para el chatbot
    // ======================================================
    const fragmentos = fragmentarTexto(textoExtraído);

    // ======================================================
    // 💾 Guardar documento en tabla documentos
    // ======================================================
    const insertDoc = await pool.query(
      `INSERT INTO documentos (nombre_archivo, texto_completo)
       VALUES ($1, $2) RETURNING id`,
      [archivo.originalname, textoExtraído]
    );

    const documentoId = insertDoc.rows[0].id;

    // ======================================================
    // 💾 Guardar fragmentos en tabla documentos_fragmentos
    // ======================================================
    for (const frag of fragmentos) {
      await pool.query(
        `INSERT INTO documentos_fragmentos (documento_id, fragmento)
         VALUES ($1, $2)`,
        [documentoId, frag]
      );
    }

    return res.status(200).json({
      ok: true,
      mensaje: "PDF procesado y guardado correctamente",
      documentoId,
      fragmentos: fragmentos.length
    });

  } catch (error) {
    console.error("❌ Error al procesar documento:", error);
    return res.status(500).json({
      ok: false,
      mensaje: "Error interno del servidor",
      error: error.message
    });
  }
};
