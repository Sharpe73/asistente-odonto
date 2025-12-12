const express = require("express");
const router = express.Router();
const documentosController = require("../controllers/documentosController");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

// 🔐 Middleware JWT
const authMiddleware = require("../middleware/authMiddleware");

// ===============================================
// 🛠 Crear carpeta uploads si no existe
// ===============================================
const uploadsPath = path.join(__dirname, "..", "uploads");

if (!fs.existsSync(uploadsPath)) {
  fs.mkdirSync(uploadsPath, { recursive: true });
  console.log("📁 Carpeta 'uploads' creada automáticamente");
}

// ===============================================
// ⚙️ Configuración de Multer para subir PDF
// ===============================================
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsPath);
  },
  filename: (req, file, cb) => {
    const nombreFinal = Date.now() + path.extname(file.originalname);
    cb(null, nombreFinal);
  }
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype !== "application/pdf") {
      return cb(new Error("Solo se permiten archivos PDF"));
    }
    cb(null, true);
  }
});

// ===============================================
// 🚀 SUBIR Y PROCESAR PDF (PROTEGIDA)
// ===============================================
router.post(
  "/subir",
  authMiddleware,              // 🔐 JWT obligatorio
  upload.single("archivo"),
  documentosController.subirDocumento
);

// ===============================================
// 📄 LISTAR DOCUMENTOS (ADMIN - PROTEGIDA)
// ===============================================
router.get(
  "/listar",
  authMiddleware,              // 🔐 solo admins logueados
  documentosController.listarDocumentos
);

module.exports = router;
