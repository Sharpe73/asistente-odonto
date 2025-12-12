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

    // 👉 admin que sube el documento (desde JWT)
    const adminUsuario = req.admin.usuario;

    const archivo = req.file;
    const rutaPDF = archivo.path;

    console.log("📄 PDF recibido:", rutaPDF);
    console.log("👤 Subido por:", adminUsuario);

    // 1️⃣ EXTRAER TEXTO LIMPIO
    let textoExtraído = await extraerTextoDesdePDF(rutaPDF);

    if (!textoExtraído || textoExtraído.trim() === "") {
      return res.status(400).json({
        ok: false,
        mensaje: "No se pudo extraer texto del PDF",
      });
    }

    // 🔥 LIMPIEZA PROFESIONAL DEL TEXTO
    textoExtraído = textoExtraído
      .replace(/\r/g, " ")
      .replace(/\n{2,}/g, "\n")
      .replace(/ {2,}/g, " ")
      .trim()
      .normalize("NFC");

    console.log("🔍 Largo del texto extraído:", textoExtraído.length, "caracteres");

    // 2️⃣ LEER PDF ORIGINAL
    const bufferOriginal = fs.readFileSync(rutaPDF);

    // 3️⃣ GUARDAR DOCUMENTO (CON subido_por)
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
        adminUsuario
      ]
    );

    const documentoId = resultadoDoc.rows[0].id;

    // 4️⃣ FRAGMENTAR TEXTO
    const fragmentos = fragmentarTexto(textoExtraído, 500);
    console.log(`🧩 Total de fragmentos generados: ${fragmentos.length}`);

    // 5️⃣ EMBEDDINGS + GUARDAR FRAGMENTOS
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
          JSON.stringify(embedding)
        ]
      );
    }

    // 6️⃣ ELIMINAR ARCHIVO TEMPORAL
    fs.unlinkSync(rutaPDF);

    res.json({
      ok: true,
      mensaje: "Documento subido, limpiado, fragmentado y embebido correctamente ✔",
      documentoId,
      total_fragmentos: fragmentos.length,
      subido_por: adminUsuario
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
      total: result.rows.length,
      documentos: result.rows
    });

  } catch (error) {
    console.error("❌ Error al listar documentos:", error);

    res.status(500).json({
      ok: false,
      mensaje: "Error al listar documentos",
      error: error.message
    });
  }
};
