const fs = require("fs");
const OpenAI = require("openai");

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Extrae texto desde un PDF usando OpenAI
 */
async function extraerTextoDesdePDF(rutaPDF) {
  try {
    console.log("📄 Enviando PDF a OpenAI para extraer texto...");

    const response = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "Eres un extractor de texto. Devuelve el contenido EXACTO del PDF sin resumir ni inventar nada.",
        },
      ],
      input: fs.createReadStream(rutaPDF), // 👈 PDF real
    });

    const texto = response.choices?.[0]?.message?.content || "";

    console.log("📄 Texto extraído correctamente");

    return texto;
  } catch (error) {
    console.error("❌ Error extrayendo texto desde PDF:", error);
    throw new Error("No se pudo extraer el texto del PDF");
  }
}

/**
 * Divide el texto grande en fragmentos pequeños para búsqueda eficiente
 */
function fragmentarTexto(texto, tamaño = 700) {
  const palabras = texto.split(" ");
  const fragmentos = [];
  let actual = [];

  for (const palabra of palabras) {
    actual.push(palabra);

    if (actual.join(" ").length >= tamaño) {
      fragmentos.push(actual.join(" "));
      actual = [];
    }
  }

  if (actual.length > 0) {
    fragmentos.push(actual.join(" "));
  }

  return fragmentos;
}

module.exports = {
  extraerTextoDesdePDF,
  fragmentarTexto,
};
