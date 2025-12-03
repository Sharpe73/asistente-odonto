const express = require("express");
const router = express.Router();
const faqController = require("../controllers/faqController");

// Registrar palabra clave detectada
router.post("/registrar", faqController.registrarDeteccion);

// Obtener historial de detecciones por usuario
router.get("/historial/:usuario_id", faqController.obtenerDetecciones);

module.exports = router;
