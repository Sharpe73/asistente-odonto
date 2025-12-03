const pool = require("../database");

exports.preguntarSobreDocumento = async (req, res) => {
  try {
    const { documentoId, pregunta } = req.body;

    if (!documentoId) {
      return res.status(400).json({
        ok: false,
        mensaje: "Falta el documentoId"
      });
    }

    if (!pregunta || pregunta.trim() === "") {
      return res.status(400).json({
        ok: false,
        mensaje: "La pregunta no puede estar vacía"
      });
    }

    // 1️⃣ Obtener todos los fragmentos de ese documento
    const resultado = await pool.query(
      `SELECT fragmento_index, texto 
       FROM documentos_fragmentos 
       WHERE documento_id = $1
       ORDER BY fragmento_index ASC`,
      [documentoId]
    );

    if (resultado.rows.length === 0) {
      return res.status(404).json({
        ok: false,
        mensaje: "Este documento no tiene fragmentos"
      });
    }

    // 2️⃣ Respuesta temporal (luego la cambiamos por IA)
    res.json({
      ok: true,
      mensaje: "Fragmentos encontrados",
      cantidad_fragmentos: resultado.rows.length,
      fragmentos: resultado.rows
    });

  } catch (error) {
    console.error("❌ Error en preguntarSobreDocumento:", error);
    res.status(500).json({
      ok: false,
      mensaje: "Error interno del servidor",
      error: error.message
    });
  }
};
