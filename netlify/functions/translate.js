const LANG_NAMES = {
  auto: "Auto-Detect the source language",
  "ku-Ar": "Badini Kurdish (Behdini dialect) in Arabic script (using پ، چ، ژ، ڤ، گ، ێ، ۆ)",
  "ku-Latn": "Badini Kurdish (Behdini / Kurmanji) in Hawar Latin script",
  ar: "Arabic",
  en: "English",
  de: "German",
  tr: "Turkish",
  fr: "French",
  fa: "Persian",
  es: "Spanish",
  it: "Italian",
  nl: "Dutch",
  sv: "Swedish",
  ru: "Russian",
  zh: "Chinese",
  ja: "Japanese",
};

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
    },
    body: JSON.stringify(body),
  };
}

function buildPrompt({ text, from, to, style, hasImage }) {
  const fromName = LANG_NAMES[from] || from;
  const toName = LANG_NAMES[to] || to;
  const styleDesc =
    style === "formal"
      ? "Use a formal, polite, and professional tone."
      : style === "everyday"
      ? "Use natural everyday spoken language."
      : "Use clear, accurate, and natural language.";

  return [
    `You are an expert AI translator specializing in Badini Kurdish (Behdini dialect) and world languages.`,
    `Source language: ${fromName}.`,
    `Target language: ${toName}.`,
    `Style: ${styleDesc}`,
    `Rules:`,
    `- When translating into Badini Kurdish (ku-Ar or ku-Latn), use authentic Behdini/Badini vocabulary and grammar (e.g., "دێ", "چاوا", "ئەڤە", "گەلەک", "نە") rather than Sorani, and strictly follow the requested script.`,
    `- Output ONLY the final translation without explanations, quotes, or extra notes.`,
    hasImage
      ? `- Read all visible text in the image and translate it accurately. If there is no readable text in the image and no user text was provided, reply with exactly: __NO_TEXT__`
      : "",
    text ? `\nText to translate:\n${text}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function cleanOutput(raw) {
  return (raw || "").replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}

async function fetchWithTimeout(url, options, ms = 6000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function callGemini(prompt, image) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("NO_KEY");

  const models = image
    ? ["gemini-3.8-flash", "gemini-3.5-flash-lite", "gemini-2.5-flash"]
    : ["gemini-3.5-flash-lite", "gemini-3.8-flash", "gemini-2.5-flash"];

  const parts = [{ text: prompt }];
  if (image?.data && image?.mimeType) {
    parts.push({ inline_data: { mime_type: image.mimeType, data: image.data } });
  }

  let lastErr = "server";
  for (const model of models) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
      const res = await fetchWithTimeout(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts }],
          generationConfig: { temperature: 0.2 },
        }),
      });

      if (res.status === 401 || res.status === 403) { lastErr = "api_key"; continue; }
      if (res.status === 429) { lastErr = "quota"; continue; }
      if (!res.ok) { lastErr = "server"; continue; }

      const data = await res.json();
      const out = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("").trim();
      if (out) return cleanOutput(out);
    } catch {
      lastErr = "timeout";
    }
  }
  throw new Error(lastErr);
}

async function callGroq(prompt, image) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("NO_KEY");

  const model = image ? "qwen/qwen3.8-27b" : "openai/gpt-oss-120b";
  const content = image?.data
    ? [
        { type: "text", text: prompt },
        { type: "image_url", image_url: { url: `data:${image.mimeType};base64,${image.data}` } },
      ]
    : prompt;

  const res = await fetchWithTimeout("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, messages: [{ role: "user", content }], temperature: 0.2 }),
  });

  if (res.status === 401 || res.status === 403) throw new Error("api_key");
  if (res.status === 429) throw new Error("rate");
  if (!res.ok) throw new Error("server");

  const data = await res.json();
  const out = data?.choices?.[0]?.message?.content;
  if (!out) throw new Error("server");
  return cleanOutput(out);
}

async function callOpenRouter(prompt, image) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("NO_KEY");

  const model = image ? "nvidia/nemotron-3.5-super-vl:free" : "openrouter/free";
  const content = image?.data
    ? [
        { type: "text", text: prompt },
        { type: "image_url", image_url: { url: `data:${image.mimeType};base64,${image.data}` } },
      ]
    : prompt;

  const res = await fetchWithTimeout("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "HTTP-Referer": "https://badini-translate.netlify.app",
      "X-Title": "Badini Translate",
    },
    body: JSON.stringify({ model, messages: [{ role: "user", content }], temperature: 0.2 }),
  });

  if (res.status === 401 || res.status === 403) throw new Error("api_key");
  if (res.status === 429) throw new Error("rate");
  if (!res.ok) throw new Error("server");

  const data = await res.json();
  const out = data?.choices?.[0]?.message?.content;
  if (!out) throw new Error("server");
  return cleanOutput(out);
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return json(200, { ok: true });
  if (event.httpMethod !== "POST") return json(405, { error: "server" });

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "bad_input" });
  }

  const text = typeof body.text === "string" ? body.text.trim() : "";
  const from = body.from || "auto";
  const to = body.to || "ku-Ar";
  const style = body.style || "normal";
  const image = body.image || null;

  if (!text && !image?.data) return json(400, { error: "bad_input" });
  if (text.length > 3000) return json(400, { error: "bad_input" });
  if (image?.data) {
    if (!String(image.mimeType || "").startsWith("image/")) return json(400, { error: "bad_image" });
    if (image.data.length > 2 * 1024 * 1024) return json(413, { error: "too_large" });
  }

  const prompt = buildPrompt({ text, from, to, style, hasImage: !!image?.data });
  const providers = [callGemini, callGroq, callOpenRouter];

  let lastError = "server";
  let hasAnyKey = false;

  for (const run of providers) {
    try {
      const result = await run(prompt, image);
      if (result.includes("__NO_TEXT__")) {
        return json(200, { translation: "", noText: true });
      }
      return json(200, { translation: result, noText: false });
    } catch (err) {
      if (err.message !== "NO_KEY") {
        hasAnyKey = true;
        lastError = err.message;
      }
    }
  }

  if (!hasAnyKey) return json(401, { error: "api_key" });
  return json(lastError === "rate" || lastError === "quota" ? 429 : 500, { error: lastError });
};
