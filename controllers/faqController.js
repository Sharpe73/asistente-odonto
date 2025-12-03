const faqService = require("../services/faqService");

// Registrar palabra clave detectada
exports.registrarDeteccion = async (req, res) => {
  try {
    const { usuario_id, palabra_clave } = req.body;

    if (!usuario_id || !palabra_clave) {
      return res.status(400).json({
        ok: false,
        mensaje: "usuario_id y palabra_clave son obligatorios"
      });
    }

    const datos = await faqService.registrarDeteccion(usuario_id, palabra_clave);

    res.json({
      ok: true,
      mensaje: "Palabra clave registrada",
      data: datos
    });

  } catch (error) {
    console.error("Error registrar detección:", error);
    res.status(500).json({
      ok: false,
      mensaje: "Error interno al registrar la detección"
    });
  }
};

// Obtener historial de palabras clave
exports.obtenerDetecciones = async (req, res) => {
  try {
    const usuario_id = req.params.usuario_id;

    const datos = await faqService.obtenerDeteccionesPorUsuario(usuario_id);

    res.json({
      ok: true,
      data: datos
    });

  } catch (error) {
    console.error("Error obtener detecciones:", error);
    res.status(500).json({
      ok: false,
      mensaje: "Error interno"
    });
  }
};
