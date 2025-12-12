const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken"); // Agregamos jwt
const pool = require("../database");

const router = express.Router();

router.post("/login", async (req, res) => {
  try {
    const { usuario, password } = req.body;

    if (!usuario || !password) {
      return res.status(400).json({
        ok: false,
        mensaje: "Faltan datos"
      });
    }

    const result = await pool.query(
      "SELECT * FROM usuarios_admin WHERE usuario = $1",
      [usuario]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        ok: false,
        mensaje: "Usuario o contraseña incorrectos"
      });
    }

    const admin = result.rows[0];

    const passwordValido = await bcrypt.compare(
      password,
      admin.password_hash
    );

    if (!passwordValido) {
      return res.status(401).json({
        ok: false,
        mensaje: "Usuario o contraseña incorrectos"
      });
    }

    // ✔️ Login OK - Crear JWT
    const token = jwt.sign(
      { id: admin.id, usuario: admin.usuario },
      process.env.JWT_SECRET, // Asegúrate de tener una clave secreta en el .env
      { expiresIn: "1h" } // El token expira en 1 hora
    );

    return res.json({
      ok: true,
      mensaje: "Login correcto",
      token
    });

  } catch (error) {
    console.error("Error login:", error);
    res.status(500).json({
      ok: false,
      mensaje: "Error interno"
    });
  }
});

module.exports = router;
