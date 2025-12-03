const express = require("express");
const router = express.Router();
const responderController = require("../controllers/responderController");

// Endpoint principal para responder preguntas con IA
router.post("/responder", responderController.responderPregunta);

module.exports = router;
