const express = require("express");
const router = express.Router();
const chatController = require("../controllers/chatController");

// ================================
// 🆕 Crear nueva sesión ASOCIADA A UN DOCUMENTO
// ================================
router.post("/sesion", chatController.crearSesion);

// ================================
// 📝 Registrar un mensaje
// ================================
router.post("/registrar", chatController.registrarMensaje);

// ================================
// 📚 Obtener historial por session_id
// ================================
router.get("/historial/:session_id", chatController.obtenerHistorial);

// ================================
// 🤖 Bot: procesar pregunta con RAG
// ================================
router.post("/preguntar", chatController.preguntar);

module.exports = router;
