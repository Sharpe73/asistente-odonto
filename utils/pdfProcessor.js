const fs = require("fs");
const pdfjsLib = require("pdfjs-dist");

// ============================
// 🧹 LIMPIAR TEXTO
// ============================
function limpiarTexto(raw) {
  if (!raw) return "";

  let texto = raw;
  texto = texto.replace(/-\n/g, "");
  texto = texto.replace(/\n{2,}/g, " ");
  texto = texto.replace(/\n/g, " ");
  texto = texto.replace(/\s{2,}/g, " ");
  texto = texto.replace(/\bPage\s*\d+\b/gi, "");
  texto = texto.replace(/\b\d+\s*\/\s*\d+\b/g, "");
  texto = texto.replace(/©.*?(\.|\s)/g, "");
  texto = texto.replace(/All rights reserved.*/gi, "");

  return texto.trim();
}

// ============================
// 📄 EXTRAER TEXTO CON pdfjs-dist
// ============================
async function extraerTextoDesdePDF(rutaPDF) {
  try {
    const data = new Uint8Array(fs.readFileSync(rutaPDF));

    const loadingTask = pdfjsLib.getDocument({ data });
    const pdf = await loadingTask.promise;

    let texto = "";

    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const content = await page.getTextContent();
      const strings = content.items.map((item) => item.str).join(" ");
      texto += strings + "\n";
    }

    return limpiarTexto(texto);

  } catch (error) {
    console.error("❌ Error leyendo PDF con pdfjs-dist:", error);
    throw new Error("No se pudo procesar el PDF");
  }
}

// ============================
// ✂️ FRAGMENTAR TEXTO
// ============================
function fragmentarTexto(texto, maxLength = 1400) {
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
