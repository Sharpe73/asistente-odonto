require("dotenv").config();
const express = require("express");
const cors = require("cors");
const pool = require("./database"); // 👈 Importa la conexión PostgreSQL

const app = express();

app.use(cors());
app.use(express.json());

// Ruta de prueba temporal para verificar Railway
app.get("/", async (req, res) => {
  try {
    const result = await pool.query("SELECT NOW()");
    res.send("Backend Odonto-Bot funcionando ✔ | DB OK: " + result.rows[0].now);
  } catch (error) {
    res.send("Backend OK pero error con DB ❌: " + error.message);
  }
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Servidor backend iniciado en el puerto ${PORT}`);
});
