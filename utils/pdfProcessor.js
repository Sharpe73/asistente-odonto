const fs = require("fs");
const path = require("path");

// 👀 IMPORTACIÓN SEGURA DE pdf-parse (compatible con Railway)
let pdfParse;
try {
  pdfParse = require("pdf-parse");
  if (pdfParse && pdfParse.default) {
    pdfParse = pdfParse.default;
  }
} catch (err) {
  console.error("❌ No se pudo cargar pdf-parse:", err);
}

// ======================================================
// 🧩 EXTRAER TEXTO DE PDF
// ======================================================
async function extraerTextoDesdePDF(rutaPDF) {
  try {
    if (!pdfParse) {
      throw new Error("pdf-parse no está disponible");
    }

    const buffer = fs.readFileSync(rutaPDF);
    const data = await pdfParse(buffer);

    return data.text || "";
  } catch (error) {
    console.error("❌ Error procesando PDF:", error);
    throw error;
  }
}

// ======================================================
// ✂️ FRAGMENTAR TEXTO (por tamaño)
// ======================================================
function fragmentarTexto(texto, maxLength = 700) {
  const fragmentos = [];

  for (let i = 0; i < texto.length; i += maxLength) {
    fragmentos.push(texto.substring(i, i + maxLength));
  }

  return fragmentos;
}

module.exports = {
  extraerTextoDesdePDF,
  fragmentarTexto
};
