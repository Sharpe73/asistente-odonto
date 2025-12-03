const pdfParse = require("pdf-parse");
const fs = require("fs");
const path = require("path");

// Inicializar OpenAI SOLO si existe la API KEY
let openai = null;

function getOpenAI() {
  if (!openai) {
    const OpenAI = require("openai");
    openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }
  return openai;
}

module.exports = {
  procesarPDF: async (rutaPDF) => {
    try {
      const buffer = fs.readFileSync(rutaPDF);
      const data = await pdfParse(buffer);
      return data.text;
    } catch (error) {
      console.error("Error procesando PDF:", error);
      throw error;
    }
  },

  generarEmbedding: async (texto) => {
    try {
      const ai = getOpenAI();

      const response = await ai.embeddings.create({
        model: "text-embedding-3-small",
        input: texto,
      });

      return response.data[0].embedding;
    } catch (error) {
      console.error("Error generando embedding:", error);
      return null; 
    }
  }
};
