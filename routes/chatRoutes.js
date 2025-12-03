const express = require("express");
const router = express.Router();
const chatController = require("../controllers/chatController");

// ================================
// 🆕 Crear nueva sesión
// ================================
router.get("/nueva-sesion", chatController.crearSesion);

// ================================
// 📝 Registrar un mensaje (usuario o bot)
// ================================
router.post("/registrar", chatController.registrarMensaje);

// ================================
// 📚 Obtener historial por session_id
// ================================
router.get("/historial/:session_id", chatController.obtenerHistorial);

module.exports = router;
