// database.js
const { Pool } = require("pg");
require("dotenv").config();

// Crear pool usando DATABASE_URL desde Railway
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Probar conexión
pool.connect()
  .then(() => console.log("📌 Conectado a PostgreSQL en Railway"))
  .catch(err => console.error("❌ Error conectando a PostgreSQL:", err));

module.exports = pool;
