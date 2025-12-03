const pool = require("../database");

// Guardar una palabra clave detectada
exports.registrarDeteccion = async (usuario_id, palabra_clave) => {
  const query = `
    INSERT INTO faq_detectadas (usuario_id, palabra_clave)
    VALUES ($1, $2)
    RETURNING *;
  `;
  const values = [usuario_id, palabra_clave];

  const result = await pool.query(query, values);
  return result.rows[0];
};

// Obtener todas las detecciones por usuario
exports.obtenerDeteccionesPorUsuario = async (usuario_id) => {
  const query = `
    SELECT * FROM faq_detectadas
    WHERE usuario_id = $1
    ORDER BY fecha DESC;
  `;
  const result = await pool.query(query, [usuario_id]);

  return result.rows;
};
