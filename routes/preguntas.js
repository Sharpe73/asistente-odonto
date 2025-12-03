const express = require("express");
const router = express.Router();

// Importa SOLO la función preguntar
const { preguntar } = require("../controllers/preguntasController");

// Ruta correcta
router.post("/preguntar", preguntar);

module.exports = router;
