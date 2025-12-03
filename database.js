const { Pool } = require("pg");

console.log("🔍 DATABASE_URL desde Railway:", process.env.DATABASE_URL);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

pool.connect()
  .then(() => console.log("📌 Conectado a PostgreSQL en Railway"))
  .catch(err => console.error("❌ Error conectando a PostgreSQL:", err));

module.exports = pool;
