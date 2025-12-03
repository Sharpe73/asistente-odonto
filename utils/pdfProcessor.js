const fs = require("fs");

// ======================================================
// 🛠 CARGAR pdf-parse DE FORMA SEGURA (Railway compatible)
// ======================================================
let pdfParse = null;

try {
  // Carga pdf-parse
  const lib = require("pdf-parse");

  // pdf-parse a veces exporta la función directo, otras veces en default
  pdfParse = typeof lib === "function" ? lib : lib.default;
  
  if (typeof pdfParse !== "function") {
    console.error("❌ pdf-parse no entregó una función. Valor recibido:", pdfParse);
    pdfParse = null;
  }

} catch (err) {
  console.error("❌ No se pudo cargar pdf-parse:", err);
}


// ======================================================
// 📄 EXTRAER TEXTO DE PDF
// ======================================================
async function extraerTextoDesdePDF(rutaPDF) {
  try {
    if (!pdfParse) {
      throw new Error("pdfParse no es una función");
    }

    const buffer = fs.readFileSync(rutaPDF);

    const resultado = await pdfParse(buffer);

    return resultado.text || "";

  } catch (error) {
    console.error("❌ Error procesando PDF:", error);
    throw error;
  }
}


// ======================================================
// ✂️ FRAGMENTAR TEXTO
// ======================================================
function fragmentarTexto(texto, maxLength = 700) {
  const fragmentos = [];

  for (let i = 0; i < texto.length; i += maxLength) {
    fragmentos.push(texto.substring(i, i + maxLength));
  }

  return fragmentos;
}


// ======================================================
module.exports = {
  extraerTextoDesdePDF,
  fragmentarTexto
};
