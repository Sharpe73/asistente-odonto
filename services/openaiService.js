// ============================================================
// 🚫 OpenAI DESACTIVADO TEMPORALMENTE
// Esto evita que Railway falle al iniciar porque aún no existe
// la variable OPENAI_API_KEY configurada.
// ============================================================

/**
 * 🤖 Simulación de respuesta IA sin usar OpenAI.
 * Útil mientras probamos el flujo completo.
 */
exports.generarRespuestaIA = async (pregunta, contexto) => {
  try {
    // Si no hay contexto, devolvemos respuesta acorde
    if (!contexto || contexto.trim() === "") {
      return "No tengo información suficiente en los documentos cargados para responder eso.";
    }

    // Respuesta simulada usando solo fragmentos encontrados
    return `
🧪 *IA temporal (sin OpenAI)*  
Basándome solo en los fragmentos encontrados:

${contexto}
    `;
  } catch (error) {
    console.error("❌ Error en generarRespuestaIA:", error);
    return "Hubo un error al procesar la respuesta.";
  }
};
