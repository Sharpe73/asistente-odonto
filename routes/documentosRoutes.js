const express = require("express");
const router = express.Router();
const documentosController = require("../controllers/documentosController");

// Subir documentos
router.post("/subir", documentosController.subirDocumento);

module.exports = router;
