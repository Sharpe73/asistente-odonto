const pool = require("../database");
const fs = require("fs");
const path = require("path");
const { extraerTextoDesdePDF } = require("../utils/pdfProcessor");

// =========================================================
// ✂️ Fragmentar texto
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
// 📌 SUBIR DOCUMENTO PDF
// =========================================================
exports.subirDocumento = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        ok: false,
        mensaje: "Debes subir un archivo PDF"
      });
    }

    const archivo = req.file;
    const rutaPDF = archivo.path;

    console.log("📄 PDF recibido:", rutaPDF);

    // 1️⃣ EXTRAER TEXTO DEL PDF
    const textoExtraído = await extraerTextoDesdePDF(rutaPDF);

    if (!textoExtraído || textoExtraído.trim() === "") {
      return res.status(400).json({
        ok: false,
        mensaje: "No se pudo extraer texto del PDF"
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
        null,             // páginas
        true,             // procesado
        null,             // resumen
        {},               // metadata (json vacío)
        archivo.originalname,
        archivo.filename
      ]
    );

    const documentoId = resultadoDoc.rows[0].id;

    // 3️⃣ FRAGMENTAR TEXTO
    const fragmentos = fragmentarTexto(textoExtraído, 700);

    // 4️⃣ GUARDAR FRAGMENTOS CON ÍNDICE
    for (let i = 0; i < fragmentos.length; i++) {
      await pool.query(
        `INSERT INTO documentos_fragmentos (documento_id, fragmento_index, texto)
         VALUES ($1, $2, $3)`,
        [documentoId, i + 1, fragmentos[i]]
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
