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

// =========================================================
// 🤖 4. Procesar pregunta del usuario (CON OPENAI)
// =========================================================
exports.preguntar = async (req, res) => {
  try {
    const { session_id, pregunta } = req.body;

    // Validaciones
    if (!session_id) {
      return res.status(400).json({ ok: false, mensaje: "session_id es obligatorio" });
    }

    if (!pregunta || pregunta.trim() === "") {
      return res.status(400).json({ ok: false, mensaje: "La pregunta no puede estar vacía" });
    }

    // 1️⃣ Guardar la pregunta del usuario
    await pool.query(
      `INSERT INTO chat_historial (session_id, role, mensaje)
       VALUES ($1, 'user', $2)`,
      [session_id, pregunta]
    );

    // 2️⃣ Buscar fragmentos relevantes (columna correcta = texto)
    const fragmentos = await pool.query(
      `SELECT texto 
       FROM documentos_fragmentos
       WHERE texto ILIKE $1
       LIMIT 8`,
      [`%${pregunta}%`]
    );

    const contexto = fragmentos.rows.map(f => f.texto).join("\n\n");

    // 3️⃣ Generar respuesta con OpenAI
    const { generarRespuestaIA } = require("../services/openaiService");
    const respuestaIA = await generarRespuestaIA(pregunta, contexto);

    // 4️⃣ Guardar respuesta del bot
    await pool.query(
      `INSERT INTO chat_historial (session_id, role, mensaje)
       VALUES ($1, 'assistant', $2)`,
      [session_id, respuestaIA]
    );

    // 5️⃣ Respuesta al frontend
    res.json({
      ok: true,
      respuesta: respuestaIA,
      fragmentos_encontrados: fragmentos.rowCount
    });

  } catch (error) {
    console.error("❌ Error procesando pregunta:", error);
    res.status(500).json({ ok: false, mensaje: "Error interno del servidor" });
  }
};
