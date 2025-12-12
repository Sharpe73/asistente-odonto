const jwt = require("jsonwebtoken");

function authMiddleware(req, res, next) {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      return res.status(401).json({
        ok: false,
        mensaje: "Token no proporcionado"
      });
    }

    const parts = authHeader.split(" ");

    if (parts.length !== 2 || parts[0] !== "Bearer") {
      return res.status(401).json({
        ok: false,
        mensaje: "Formato de token inválido"
      });
    }

    const token = parts[1];

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // dejamos info del admin disponible
    req.admin = decoded;

    next();
  } catch (error) {
    return res.status(401).json({
      ok: false,
      mensaje: "Token inválido o expirado"
    });
  }
}

module.exports = authMiddleware;
