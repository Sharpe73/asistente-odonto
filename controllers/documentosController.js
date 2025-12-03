const pool = require("../database");

/**
 * Subir documento y guardarlo en la base de datos
 */
exports.subirDocumento = async (req, res) => {
  try {
    const { nombre_archivo, contenido_base64 } = req.body;

    if (!nombre_archivo || !contenido_base64) {
      return res.status(400).json({
        ok: false,
        mensaje: "Faltan campos: nombre_archivo o contenido_base64",
      });
    }

    // Guardar registro del documento
    const docResult = await pool.query(
      `INSERT INTO documentos (nombre_archivo, contenido_base64)
       VALUES ($1, $2)
       RETURNING id`,
      [nombre_archivo, contenido_base64]
    );

    const documento_id = docResult.rows[0].id;

    // Registrar en logs
    await pool.query(
      `INSERT INTO logs_sistema (tipo, detalle)
       VALUES ('info', $1)`,
      [`Documento subido: ${nombre_archivo} (ID ${documento_id})`]
    );

    return res.json({
      ok: true,
      mensaje: "Documento subido correctamente",
      documento_id,
    });

  } catch (error) {
    console.error("❌ Error subirDocumento:", error);

    await pool.query(
      `INSERT INTO logs_sistema (tipo, detalle)
       VALUES ('error', $1)`,
      [error.message]
    );

    return res.status(500).json({
      ok: false,
      mensaje: "Error al subir documento",
    });
  }
};
