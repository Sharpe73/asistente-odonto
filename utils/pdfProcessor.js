const fs = require("fs");
const pdfjsLib = require("pdfjs-dist/legacy/build/pdf.js");

// =============================================
// 🧹 LIMPIAR TEXTO EXTRAÍDO DEL PDF
// =============================================
function limpiarTexto(raw) {
  if (!raw) return "";

  let texto = raw;

  // Unir palabras cortadas con guion al final de línea
  texto = texto.replace(/-\n/g, "");

  // Remover saltos de línea múltiples
  texto = texto.replace(/\n{2,}/g, " ");

  // Remover saltos simples reemplazando por espacio
  texto = texto.replace(/\n/g, " ");

  // Remover múltiples espacios
  texto = texto.replace(/\s{2,}/g, " ");

  // Quitar páginas, headers, footers
  texto = texto.replace(/\bPage\s*\d+\b/gi, "");
  texto = texto.replace(/\b\d+\s*\/\s*\d+\b/g, "");
  texto = texto.replace(/©.*?(\.|\s)/g, "");
  texto = texto.replace(/All rights reserved.*/gi, "");

  return texto.trim();
}

// =============================================
// 📄 NUEVA FUNCIÓN SEGURA: EXTRAER TEXTO (pdfjs-dist)
// =============================================
async function extraerTextoPDF_Seguro(rutaPDF) {
  try {
    const data = new Uint8Array(fs.readFileSync(rutaPDF));

    const pdf = await pdfjsLib.getDocument({ data }).promise;

    let textoCompleto = "";

    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const content = await page.getTextContent();

      const strings = content.items.map(item => item.str).join(" ");
      textoCompleto += strings + "\n";
    }

    return limpiarTexto(textoCompleto);

  } catch (error) {
    console.error("❌ Error leyendo PDF con pdfjs-dist:", error);
    throw new Error("No se pudo procesar el PDF (pdfjs)");
  }
}

// =============================================
// ✂️ FRAGMENTAR TEXTO (igual al tuyo)
// =============================================
function fragmentarTexto(texto, maxLength = 1400) {
  const fragmentos = [];

  for (let i = 0; i < texto.length; i += maxLength) {
    fragmentos.push(texto.substring(i, i + maxLength));
  }

  return fragmentos;
}

// =============================================
module.exports = {
  extraerTextoPDF_Seguro,
  fragmentarTexto
};
