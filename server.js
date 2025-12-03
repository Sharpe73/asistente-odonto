require("dotenv").config();
const express = require("express");
const cors = require("cors");

const app = express();

app.use(cors());
app.use(express.json());

// Ruta de prueba temporal (solo para confirmar que Railway funciona)
app.get("/", (req, res) => {
  res.send("Backend Odonto-Bot funcionando ✔");
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Servidor backend iniciado en el puerto ${PORT}`);
});
