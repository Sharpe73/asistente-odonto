const fs = require("fs");
const pdfjsLib = require("pdfjs-dist");

// ============================
// 🧹 LIMPIEZA PROFESIONAL DEL TEXTO
// ============================
function limpiarTexto(raw) {
  if (!raw) return "";

  let texto = raw;

  // Unir palabras cortadas por guiones (problema común en papers científicos)
  texto = texto.replace(/-\s*\n/g, "");

  // Reducir múltiples saltos de línea a uno solo
  texto = texto.replace(/\n{2,}/g, "\n");

  // Eliminar números de página y formatos tipo "Page 1 / 12"
  texto = texto.replace(/\bPage\s*\d+\b/gi, "");
  texto = texto.replace(/\b\d+\s*\/\s*\d+\b/g, "");

  // Normalizar espacios
  texto = texto.replace(/[ \t]{2,}/g, " ");

  // Mantener saltos de línea para preservar PÁRRAFOS
  texto = texto.replace(/\r/g, "");

  // Eliminar espacios exteriores
  texto = texto.trim();

  // Normalizar acentos
  texto = texto.normalize("NFC");

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

      // Respetar estructura por líneas → luego se transforman en párrafos
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
// ✂️ FRAGMENTAR TEXTO POR PÁRRAFOS (VERSIÓN PROFESIONAL)
// ============================
//
// 🔥 Esta es la forma correcta para papers científicos.
// 🔥 Cada párrafo mantiene una idea completa.
// 🔥 MUCHÍSIMO más preciso que cortar por caracteres.
//
function fragmentarTexto(texto) {
  if (!texto) return [];

  // Separar por saltos de línea
  let parrafos = texto.split("\n");

  // Limpiar párrafos vacíos
  parrafos = parrafos
    .map(p => p.trim())
    .filter(p => p.length > 0);

  // Algunos párrafos pueden ser demasiado largos.  
  // Los dividimos inteligentemente en bloques de máximo 800 caracteres.
  const fragmentos = [];

  for (const p of parrafos) {
    if (p.length <= 800) {
      fragmentos.push(p);
    } else {
      // Dividir párrafo largo sin romper ideas
      let inicio = 0;
      while (inicio < p.length) {
        let fin = inicio + 800;

        if (fin < p.length) {
          const ultimoPunto = p.lastIndexOf(".", fin);
          const ultimoEspacio = p.lastIndexOf(" ", fin);

          if (ultimoPunto > inicio + 200) {
            fin = ultimoPunto + 1;
          } else if (ultimoEspacio > inicio + 200) {
            fin = ultimoEspacio;
          }
        }

        fragmentos.push(p.substring(inicio, fin).trim());
        inicio = fin;
      }
    }
  }

  return fragmentos;
}

module.exports = {
  extraerTextoDesdePDF,
  fragmentarTexto
};
