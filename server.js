const express = require("express");
const cors = require("cors");
const pool = require("./database");

// Rutas existentes
const documentosRoutes = require("./routes/documentosRoutes");
const chatRoutes = require("./routes/chatRoutes");
const faqRoutes = require("./routes/faqRoutes");

// 👉 Ruta que maneja las preguntas al documento
const preguntasRoutes = require("./routes/preguntas");

// 👉 NUEVA RUTA: login admin
const authRoutes = require("./routes/authRoutes");

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// =====================================
// 📌 Registrar rutas
// =====================================

// Subida + fragmentación de PDFs
app.use("/documentos", documentosRoutes);

// Preguntar a un documento
app.use("/documentos", preguntasRoutes);

// Chat general del bot
app.use("/chat", chatRoutes);

// Preguntas frecuentes
app.use("/faq", faqRoutes);

// 🔐 Login admin
app.use("/auth", authRoutes);

// =====================================
// 📌 Ruta de prueba Railway
// =====================================
app.get("/", async (req, res) => {
  try {
    const result = await pool.query("SELECT NOW()");
    res.send(
      "Backend Odonto-Bot funcionando ✔ | DB OK: " +
        result.rows[0].now
    );
  } catch (error) {
    res.send(
      "Backend OK pero error con DB ❌: " + error.message
    );
  }
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Servidor backend iniciado en el puerto ${PORT}`);
});
