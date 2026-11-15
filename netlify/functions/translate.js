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

const UI_LANG_NAMES = {
  ku: "Badini Kurdish (Behdini dialect, Arabic script)",
  ar: "Arabic",
  en: "English",
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

function buildPrompt({ mode, text, translation, from, to, style, ui, hasImage }) {
  const fromName = LANG_NAMES[from] || from;
  const toName = LANG_NAMES[to] || to;

  if (mode === "fix") {
    const scriptHint =
      from === "ku-Latn"
        ? "Use Hawar Latin script."
        : from === "ku-Ar"
        ? "Use Kurdish Arabic script (پ، چ، ژ، ڤ، گ، ێ، ۆ)."
        : "Keep the exact same script (Arabic script or Hawar Latin) that the user wrote in.";
    return [
      `You are an expert editor of Badini Kurdish (Behdini dialect).`,
      `Fix spelling, grammar, word spacing, and punctuation mistakes in the Badini Kurdish text below.`,
      `Rules:`,
      `- Keep authentic Behdini/Badini vocabulary and meaning; do NOT change it to Sorani.`,
      `- ${scriptHint}`,
      `- Output ONLY the corrected text without explanations or quotes.`,
      `\nText:\n${text}`,
    ].join("\n");
  }

  if (mode === "explain") {
    const explainLang = UI_LANG_NAMES[ui] || UI_LANG_NAMES.ku;
    return [
      `You are a helpful language teacher specializing in Badini Kurdish (Behdini) and world languages.`,
      `Write your response in ${explainLang}.`,
      `Source language: ${fromName}. Target language: ${toName}.`,
      text ? `Original text: ${text}` : "",
      translation ? `Translated text: ${translation}` : "",
      `Provide:`,
      `1) A brief, clear explanation of the meaning and usage/grammar (2-3 short lines).`,
      `2) Exactly 2 practical example sentences showing how it is used, each with its translation.`,
      `Keep the formatting clean and easy to read.`,
    ]
      .filter(Boolean)
      .join("\n");
  }

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

const BADINI_FIXES = {
  "هەروتسا": "هەروەسا",
  "هەر وەتسا": "هەروەسا",
  "پەیفا": "پەیڤا",
  "ئەفە": "ئەڤە",
  "بەله": "بەلێ",
  "گەلەك": "گەلەک",
};

function cleanOutput(raw) {
  let out = (raw || "").replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  for (const [wrong, right] of Object.entries(BADINI_FIXES)) {
    out = out.split(wrong).join(right);
  }
  return out;
}

async function fetchWithTimeout(url, options, ms = 4200) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// 1) Google Gemini
async function callGemini(prompt, image) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("NO_KEY");

  const model = image ? "gemini-3.8-flash" : "gemini-3.5-flash-lite";
  const parts = [{ text: prompt }];
  if (image?.data && image?.mimeType) {
    parts.push({ inline_data: { mime_type: image.mimeType, data: image.data } });
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const res = await fetchWithTimeout(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents: [{ parts }], generationConfig: { temperature: 0.25 } }),
  });

  if (res.status === 401 || res.status === 403) throw new Error("api_key");
  if (res.status === 429) throw new Error("quota");
  if (!res.ok) throw new Error("server");

  const data = await res.json();
  const out = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("").trim();
  if (!out) throw new Error("server");
  return cleanOutput(out);
}

// 2) Groq
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
    body: JSON.stringify({ model, messages: [{ role: "user", content }], temperature: 0.25 }),
  });

  if (res.status === 401 || res.status === 403) throw new Error("api_key");
  if (res.status === 429) throw new Error("rate");
  if (!res.ok) throw new Error("server");

  const data = await res.json();
  const out = data?.choices?.[0]?.message?.content;
  if (!out) throw new Error("server");
  return cleanOutput(out);
}

// 3) NVIDIA NIM
async function callNvidia(prompt, image) {
  const apiKey = process.env.NVIDIA_API_KEY;
  if (!apiKey) throw new Error("NO_KEY");

  const model = "nvidia/nemotron-3.5-super-vl-120b-a12b";
  const content = image?.data
    ? [
        { type: "text", text: prompt },
        { type: "image_url", image_url: { url: `data:${image.mimeType};base64,${image.data}` } },
      ]
    : prompt;

  const res = await fetchWithTimeout("https://integrate.api.nvidia.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, messages: [{ role: "user", content }], temperature: 0.25, max_tokens: 1024 }),
  });

  if (res.status === 401 || res.status === 403) throw new Error("api_key");
  if (res.status === 429) throw new Error("rate");
  if (!res.ok) throw new Error("server");

  const data = await res.json();
  const out = data?.choices?.[0]?.message?.content;
  if (!out) throw new Error("server");
  return cleanOutput(out);
}

// 4) Mistral AI
async function callMistral(prompt, image) {
  const apiKey = process.env.MISTRAL_API_KEY;
  if (!apiKey) throw new Error("NO_KEY");

  const model = "mistral-small-latest";
  const content = image?.data
    ? [
        { type: "text", text: prompt },
        { type: "image_url", image_url: { url: `data:${image.mimeType};base64,${image.data}` } },
      ]
    : prompt;

  const res = await fetchWithTimeout("https://api.mistral.ai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, messages: [{ role: "user", content }], temperature: 0.25 }),
  });

  if (res.status === 401 || res.status === 403) throw new Error("api_key");
  if (res.status === 429) throw new Error("rate");
  if (!res.ok) throw new Error("server");

  const data = await res.json();
  const out = data?.choices?.[0]?.message?.content;
  if (!out) throw new Error("server");
  return cleanOutput(out);
}

// 5) Cloudflare Workers AI (Text)
async function callCloudflare(prompt, image) {
  if (image?.data) throw new Error("skip_image");
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (!token || !accountId) throw new Error("NO_KEY");

  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/@cf/moonshotai/kimi-k2.6`;
  const res = await fetchWithTimeout(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ messages: [{ role: "user", content: prompt }] }),
  });

  if (res.status === 401 || res.status === 403) throw new Error("api_key");
  if (res.status === 429) throw new Error("rate");
  if (!res.ok) throw new Error("server");

  const data = await res.json();
  const out = data?.result?.response || data?.result?.choices?.[0]?.message?.content;
  if (!out) throw new Error("server");
  return cleanOutput(out);
}

// 6) OpenRouter
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
    body: JSON.stringify({ model, messages: [{ role: "user", content }], temperature: 0.25 }),
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

  const mode = body.mode === "fix" || body.mode === "explain" ? body.mode : "translate";
  const text = typeof body.text === "string" ? body.text.trim() : "";
  const translation = typeof body.translation === "string" ? body.translation.trim() : "";
  const from = body.from || "auto";
  const to = body.to || "ku-Ar";
  const style = body.style || "normal";
  const ui = body.ui || "ku";
  const image = mode === "translate" ? body.image || null : null;

  if (!text && !translation && !image?.data) return json(400, { error: "bad_input" });
  if (text.length > 3000) return json(400, { error: "bad_input" });
  if (image?.data) {
    if (!String(image.mimeType || "").startsWith("image/")) return json(400, { error: "bad_image" });
    if (image.data.length > 2 * 1024 * 1024) return json(413, { error: "too_large" });
  }

  const prompt = buildPrompt({ mode, text, translation, from, to, style, ui, hasImage: !!image?.data });
  const providers = [
    ["Gemini", callGemini],
    ["Groq", callGroq],
    ["NVIDIA", callNvidia],
    ["Mistral", callMistral],
    ["Cloudflare", callCloudflare],
    ["OpenRouter", callOpenRouter],
  ];

  const startedAt = Date.now();
  let lastError = "server";
  let hasAnyKey = false;

  for (const [name, run] of providers) {
    if (Date.now() - startedAt > 8200) break;
    try {
      const result = await run(prompt, image);
      if (result.includes("__NO_TEXT__")) {
        return json(200, { translation: "", noText: true, provider: name });
      }
      return json(200, { translation: result, noText: false, provider: name });
    } catch (err) {
      if (err.message === "NO_KEY" || err.message === "skip_image") continue;
      hasAnyKey = true;
      lastError = err.name === "AbortError" ? "timeout" : err.message;
    }
  }

  if (!hasAnyKey) return json(401, { error: "api_key" });
  return json(lastError === "rate" || lastError === "quota" ? 429 : 500, { error: lastError });
};
