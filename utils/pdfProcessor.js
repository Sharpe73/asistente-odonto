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

  // Unir palabras cortadas con guion al final de línea
  texto = texto.replace(/-\n/g, "");

  // Remover saltos de línea múltiples
  texto = texto.replace(/\n{2,}/g, " ");

  // Remover saltos simples reemplazando por espacio
  texto = texto.replace(/\n/g, " ");

  // Remover múltiples espacios
  texto = texto.replace(/\s{2,}/g, " ");

  // Remover numeraciones típicas de páginas
  texto = texto.replace(/\bPage\s*\d+\b/gi, "");
  texto = texto.replace(/\b\d+\s*\/\s*\d+\b/g, ""); // tipo 3/20

  // Remover encabezados o footers comunes
  texto = texto.replace(/©.*?(\.|\s)/g, "");
  texto = texto.replace(/All rights reserved.*/gi, "");

  return texto.trim();
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

    const textoLimpio = limpiarTexto(resultado.text || "");

    return textoLimpio;

  } catch (error) {
    console.error("❌ Error procesando PDF:", error);
    throw error;
  }
}


// ======================================================
// ✂️ FRAGMENTAR TEXTO — VERSIÓN PROFESIONAL (SEMÁNTICA)
// ======================================================
function fragmentarTexto(texto, maxLength = 500) {
  // 1. Dividir por oraciones reales
  const oraciones = texto
    .split(/(?<=[\.!\?])\s+/)
    .map(o => o.trim())
    .filter(o => o.length > 0);

  const fragmentos = [];
  let actual = "";

  // 2. Construir fragmentos manteniendo coherencia semántica
  for (const oracion of oraciones) {
    if ((actual + " " + oracion).length > maxLength) {
      fragmentos.push(actual.trim());
      actual = oracion;
    } else {
      actual += " " + oracion;
    }
  }

  // 3. Agregar último fragmento
  if (actual.length > 0) {
    fragmentos.push(actual.trim());
  }

  return fragmentos;
}


// ======================================================
module.exports = {
  extraerTextoDesdePDF,
  fragmentarTexto
};
