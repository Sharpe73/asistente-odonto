const pool = require("../database");
const fs = require("fs");
const path = require("path");
const { procesarPDF } = require("../utils/pdfProcessor");

// =========================================================
// ✂️ Función local para fragmentar texto
// =========================================================
function fragmentarTexto(texto, maxLength = 700) {
  const palabras = texto.split(" ");
  const fragmentos = [];
  let actual = "";

  for (const palabra of palabras) {
    if ((actual + palabra).length > maxLength) {
      fragmentos.push(actual.trim());
      actual = palabra + " ";
    } else {
      actual += palabra + " ";
    }
  }

  if (actual.trim().length > 0) {
    fragmentos.push(actual.trim());
  }

  return fragmentos;
}

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
    const rutaPDF = archivo.path;

    console.log("📄 PDF recibido:", rutaPDF);

    // 1️⃣ EXTRAER TEXTO DEL PDF
    const textoExtraído = await procesarPDF(rutaPDF);

    if (!textoExtraído || textoExtraído.trim() === "") {
      return res.status(400).json({
        ok: false,
        mensaje: "No se pudo extraer texto del PDF"
      });
    }

    // 2️⃣ GUARDAR DOCUMENTO
    const resultadoDoc = await pool.query(
      `INSERT INTO documentos (titulo, ruta_archivo)
       VALUES ($1, $2)
       RETURNING id`,
      [archivo.originalname, archivo.filename]
    );

    const documentoId = resultadoDoc.rows[0].id;

    // 3️⃣ FRAGMENTAR TEXTO
    const fragmentos = fragmentarTexto(textoExtraído, 700);

    // 4️⃣ GUARDAR FRAGMENTOS
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
