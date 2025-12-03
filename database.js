const { Pool } = require("pg");

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

pool.connect()
    .then(() => console.log("📌 PostgreSQL conectado correctamente"))
    .catch((err) => console.error("❌ Error al conectar PostgreSQL:", err));

module.exports = pool;
