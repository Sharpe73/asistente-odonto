const fs = require("fs");
const pdfjsLib = require("pdfjs-dist");

// ============================
// 🧹 LIMPIEZA PROFESIONAL DEL TEXTO
// ============================
function limpiarTexto(raw) {
  if (!raw) return "";

  let texto = raw;

  // Unir palabras cortadas por guiones
  texto = texto.replace(/-\s*\n/g, "");

  // Reemplazar saltos múltiples por un solo salto
  texto = texto.replace(/\n{2,}/g, "\n");

  // Remover números de página típicos
  texto = texto.replace(/\bPage\s*\d+\b/gi, "");
  texto = texto.replace(/\b\d+\s*\/\s*\d+\b/g, "");

  // Normalizar espacios
  texto = texto.replace(/[ \t]{2,}/g, " ");

  // Mantener saltos de línea para conservar estructura
  texto = texto.replace(/\n/g, " ");

  // Normalizar acentos
  texto = texto.normalize("NFC").trim();

  return texto;
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

      // Respetar estructura de párrafos
      const strings = content.items.map((item) => item.str).join(" ");
      texto += strings + "\n\n";
    }

    return limpiarTexto(texto);
  } catch (error) {
    console.error("❌ Error leyendo PDF con pdfjs-dist:", error);
    throw new Error("No se pudo procesar el PDF");
  }
}

// ============================
// ✂️ FRAGMENTAR TEXTO (OPTIMIZADO)
// ============================
// 🔥 Usa fragmentos de 1800 + corte inteligente en puntos finales
function fragmentarTexto(texto, maxLength = 1800) {
  const fragmentos = [];
  let inicio = 0;

  while (inicio < texto.length) {
    let fin = inicio + maxLength;

    // Si se corta en medio de una frase, mover hacia atrás hasta un punto
    if (fin < texto.length) {
      const ultimoPunto = texto.lastIndexOf(".", fin);
      if (ultimoPunto > inicio + 300) {
        fin = ultimoPunto + 1;
      }
    }

    const fragmento = texto.substring(inicio, fin).trim();
    fragmentos.push(fragmento);

    inicio = fin;
  }

  return fragmentos;
}

module.exports = {
  extraerTextoDesdePDF,
  fragmentarTexto
};
