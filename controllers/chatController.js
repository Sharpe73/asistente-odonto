const pool = require("../database");
const { generarSessionId } = require("../utils/session");

// =========================================================
// 📝 1. Registrar mensaje en historial
// =========================================================
exports.registrarMensaje = async (req, res) => {
  try {
    const { session_id, role, mensaje } = req.body;

    if (!session_id) {
      return res.status(400).json({ ok: false, mensaje: "session_id es obligatorio" });
    }

    if (!role || (role !== "user" && role !== "assistant")) {
      return res.status(400).json({ ok: false, mensaje: "role debe ser 'user' o 'assistant'" });
    }

    await pool.query(
      `INSERT INTO chat_historial (session_id, role, mensaje)
       VALUES ($1, $2, $3)`,
      [session_id, role, mensaje]
    );

    res.json({ ok: true, mensaje: "Mensaje registrado correctamente" });

  } catch (error) {
    console.error("Error al registrar mensaje:", error);
    res.status(500).json({ ok: false, mensaje: "Error en el servidor" });
  }
};

// =========================================================
// 📚 2. Obtener historial completo de una sesión
// =========================================================
exports.obtenerHistorial = async (req, res) => {
  try {
    const { session_id } = req.params;

    const result = await pool.query(
      `SELECT * FROM chat_historial
       WHERE session_id = $1
       ORDER BY creado_en ASC`,
      [session_id]
    );

    res.json({ ok: true, historial: result.rows });

  } catch (error) {
    console.error("Error obteniendo historial:", error);
    res.status(500).json({ ok: false, mensaje: "Error en el servidor" });
  }
};

// =========================================================
// 🆕 3. Crear nueva sesión (sin login)
// =========================================================
exports.crearSesion = async (req, res) => {
  try {
    const session_id = generarSessionId();

    await pool.query(
      `INSERT INTO sesiones (session_id) VALUES ($1)`,
      [session_id]
    );

    res.json({
      ok: true,
      session_id,
      mensaje: "Sesión creada correctamente"
    });

  } catch (error) {
    console.error("Error creando sesión:", error);
    res.status(500).json({ ok: false, mensaje: "Error en el servidor" });
  }
};
