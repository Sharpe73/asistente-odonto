const express = require("express");
const router = express.Router();
const preguntasController = require("../controllers/preguntasController");

router.post("/preguntar", preguntasController.preguntarSobreDocumento);

module.exports = router;
