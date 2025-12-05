const fs = require("fs");
// ======================================================
// 🛠 CARGAR pdf-parse DE FORMA SEGURA (Railway compatible)
// ======================================================
let pdfParse = null;

try {
  const lib = require("pdf-parse");
  pdfParse = typeof lib === "function" ? lib : lib.default;

  if (typeof pdfParse !== "function") {
    console.error("❌ pdf-parse no entregó una función válida:", pdfParse);
    pdfParse = null;
  }
} catch (err) {
  console.error("❌ No se pudo cargar pdf-parse:", err);
}


// ======================================================
// 🧹 LIMPIAR TEXTO EXTRAÍDO DEL PDF
// ======================================================
function limpiarTexto(raw) {
  if (!raw) return "";

  let texto = raw;

  texto = texto.replace(/-\n/g, "");        // Palabras cortadas
  texto = texto.replace(/\n{2,}/g, " ");    // Saltos múltiples
  texto = texto.replace(/\n/g, " ");        // Saltos simples
  texto = texto.replace(/\s{2,}/g, " ");    // Espacios demás

  texto = texto.replace(/\bPage\s*\d+\b/gi, "");
  texto = texto.replace(/\b\d+\s*\/\s*\d+\b/g, "");
  texto = texto.replace(/©.*?(\.|\s)/g, "");
  texto = texto.replace(/All rights reserved.*/gi, "");

  return texto.trim();
}


// ======================================================
// 📄 EXTRAER TEXTO DE PDF (pdf-parse REAL)
// ======================================================
async function extraerTextoDesdePDF(rutaPDF) {
  try {
    if (!pdfParse) {
      throw new Error("pdfParse no es una función válida");
    }

    const buffer = fs.readFileSync(rutaPDF);
    const resultado = await pdfParse(buffer);

    return limpiarTexto(resultado.text || "");

  } catch (error) {
    console.error("❌ Error procesando PDF:", error);
    throw error;
  }
}


// ======================================================
// ✂️ FRAGMENTAR TEXTO
// ======================================================
function fragmentarTexto(texto, maxLength = 1400) {
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
