const LANG_NAMES = {
  auto: "Auto-Detect the source language",
  "ku-Ar": "Badini Kurdish (Behdini dialect of Duhok, Zakho, Amedi, Akre) in Kurdish Arabic script (پ، چ، ژ، ڤ، گ، ێ، ۆ، ک، ی، ە)",
  "ku-Latn": "Badini Kurdish (Behdini / Kurmanji) in Hawar Latin script (ê, î, û, ç, ş)",
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

const BADINI_STYLE_RULES = `
CRITICAL BADINI KURDISH (BEHDINI) RULES:
1. You MUST write in pure, natural Badini Kurdish (Duhok/Zakho/Amedi/Akre dialect), NEVER Sorani.
2. Vocabulary:
   - Use: گەلەک (NOT زۆر), چاوا (NOT چۆن), ئەڤە/ئەڤ (NOT ئەمە), دگەل (NOT لەگەڵ), نینە (NOT نییە), بەلێ (NOT بەڵام/بەڵێ), هەروەسا (NOT هەروەها), ب تنێ (NOT تەنیا/تەنها), ڤێرێ (NOT ئێرە), وێرێ (NOT ئەوێ), ژ بەر کو (NOT چونکە/لەبەرئەوەی), پێدڤی (NOT پێویست/پێتڤی), سەقا (NOT کەشوهەوا/هوا), زوی (NOT زوو), دشێم (NOT دەتوانم), دزانم (NOT دەزانم), دکەم (NOT دەکەم), بێ زەحمەت / هیڤی یە (NOT تکایە), ئەلمانی (NOT ئەڵمانی), لێ (NOT بەڵێ in wrong places).
3. Grammar:
   - Future tense uses "دێ": ئەز دێ چم (I will go), ئەو دێ هێت (he/she will come).
   - Present continuous uses "یێ / یا / یێن" + "دـ": ئەز یێ دچم (I am going), ئەو یا دخوینیت (she is reading).
   - Past transitive verbs are ERGATIVE: من گۆت (I said), من کر (I did), تە دیت (you saw), وی نڤیسی (he wrote) — NEVER Sorani "وتم/کردم".
   - Script (Arabic): Use Kurdish ک (not ك), ی (not ي), ە (not ه at word ends), and NEVER write "ەا" together (write نموونەیا, NOT نموونەا).
4. Examples of natural Badini:
   - "I am going to the market." -> "ئەز یێ دچمە بازاری."
   - "I bought bread this morning and came home." -> "من ئەڤ سپێدێ نان کڕی و هاتمە مال."
   - "Did you see my friend yesterday?" -> "تە دوهی هەڤالێ من دیت؟"
   - "Tomorrow we will go to Duhok." -> "سباهی ئەم دێ چینە دهۆکێ."
   - "I don't know where he is, he is not here." -> "ئەز نزانم ئەو ل کیڤە یە، ئەو ل ڤێرێ نینە."
   - "Please wait a little, the weather is cold today." -> "بێ زەحمەت کێمەکێ چاڤەڕێ بکە، ئەڤرۆ سەقا سارە."
   - "Thank you very much for helping me." -> "گەلەک سوپاس بۆ هاریکاریکرنا تە."
`.trim();

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
  const isBadiniTarget = to === "ku-Ar" || to === "ku-Latn";

  if (mode === "fix") {
    const scriptHint =
      from === "ku-Latn"
        ? "Write in Hawar Latin script (ê, î, û, ç, ş)."
        : from === "ku-Ar"
        ? "Write in Kurdish Arabic script (پ، چ، ژ، ڤ، گ، ێ، ۆ، ک، ی، ە)."
        : "Keep the exact same script (Arabic script or Hawar Latin) that the user wrote in.";
    return [
      `You are an expert editor of Badini Kurdish (Behdini dialect).`,
      `Fix spelling, grammar, ergativity, word spacing, and punctuation mistakes in the text below.`,
      BADINI_STYLE_RULES,
      `- ${scriptHint}`,
      `- Output ONLY the corrected text without explanations, quotes, or markdown.`,
      `\nText:\n${text}`,
    ].join("\n");
  }

  if (mode === "explain") {
    const explainLang = UI_LANG_NAMES[ui] || UI_LANG_NAMES.ku;
    return [
      `You are a clear, accurate language teacher specializing in Badini Kurdish (Behdini) and world languages.`,
      `Write your explanation in ${explainLang}.`,
      ui === "ku" ? BADINI_STYLE_RULES : "",
      `Source language: ${fromName}. Target language: ${toName}.`,
      text ? `Original text: ${text}` : "",
      translation ? `Translated text: ${translation}` : "",
      `Provide:`,
      `1) A brief, simple explanation of the meaning and grammar (2 short lines, using simple grammar terms without weird invented words).`,
      `2) 2 natural practical example sentences with translations.`,
      `Strict formatting rules:`,
      `- Do NOT write any greeting (like "سلاڤ").`,
      `- Do NOT use markdown symbols like **, *, or #.`,
      `- Double-check every Badini word spelling carefully.`,
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
    `You are an expert professional translator specializing in Badini Kurdish (Behdini) and world languages.`,
    `Source language: ${fromName}.`,
    `Target language: ${toName}.`,
    `Style: ${styleDesc}`,
    isBadiniTarget ? BADINI_STYLE_RULES : "",
    `Output rules:`,
    `- Output ONLY the final translation without explanations, quotes, greetings, or markdown.`,
    hasImage
      ? `- Read all visible text in the image and translate it accurately. If there is no readable text in the image and no user text was provided, reply with exactly: __NO_TEXT__`
      : "",
    text ? `\nText to translate:\n${text}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

const BADINI_SUBSTRING_FIXES = {
  "هەروتسا": "هەروەسا",
  "هەر وەتسا": "هەروەسا",
  "نموونەا": "نموونەیا",
  "پێتڤی": "پێدڤی",
  "پەیفا": "پەیڤا",
  "ئەفە": "ئەڤە",
  "بەله": "بەلێ",
  "گەلەك": "گەلەک",
  "ئێكێ": "ئێکێ",
  "بێهۆنەکێ ڤەگرتم": "بێهنەکێ ڤەدەم",
  "بێهۆنەکێ": "بێهنەکێ",
};

const BADINI_WORD_FIXES = [
  ["زۆر", "گەلەک"],
  ["چۆن", "چاوا"],
  ["لەگەڵ", "دگەل"],
  ["نییە", "نینە"],
  ["ئەمە", "ئەڤە"],
  ["هەروەها", "هەروەسا"],
  ["تەنیا", "ب تنێ"],
  ["تەنها", "ب تنێ"],
  ["ئێرە", "ڤێرێ"],
  ["چونکە", "ژ بەر کو"],
  ["لەبەرئەوەی", "ژ بەر کو"],
  ["پێویست", "پێدڤی"],
  ["تکایە", "هیڤی یە"],
  ["بەڵام", "بەلێ"],
  ["بەڵێ", "بەلێ"],
  ["دەتوانم", "دشێم"],
  ["دەزانم", "دزانم"],
  ["دەکەم", "دکەم"],
  ["زوو", "زوی"],
  ["هوا", "سەقا"],
];

function cleanOutput(raw, polishBadini) {
  let out = (raw || "")
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/\*\*/g, "")
    .replace(/^#{1,4}\s+/gm, "")
    .trim();

  if (polishBadini) {
    for (const [wrong, right] of Object.entries(BADINI_SUBSTRING_FIXES)) {
      out = out.split(wrong).join(right);
    }
    for (const [wrong, right] of BADINI_WORD_FIXES) {
      const re = new RegExp(`(^|[\\s،.؛؟!«»"()\\-])${wrong}(?=$|[\\s،.؛؟!«»"()\\-])`, "g");
      out = out.replace(re, `$1${right}`);
    }
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

// 1) Google Gemini (Smart 3.8-flash first, then 3.5-flash-lite)
async function callGemini(prompt, image, polishBadini) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("NO_KEY");

  const models = ["gemini-3.8-flash", "gemini-3.5-flash-lite"];
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
        body: JSON.stringify({ contents: [{ parts }], generationConfig: { temperature: 0.2 } }),
      });

      if (res.status === 401 || res.status === 403) { lastErr = "api_key"; continue; }
      if (res.status === 429) { lastErr = "quota"; continue; }
      if (!res.ok) { lastErr = "server"; continue; }

      const data = await res.json();
      const out = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("").trim();
      if (out) return cleanOutput(out, polishBadini);
    } catch {
      lastErr = "timeout";
    }
  }
  throw new Error(lastErr);
}

// 2) Groq
async function callGroq(prompt, image, polishBadini) {
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
  return cleanOutput(out, polishBadini);
}

// 3) NVIDIA NIM
async function callNvidia(prompt, image, polishBadini) {
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
    body: JSON.stringify({ model, messages: [{ role: "user", content }], temperature: 0.2, max_tokens: 1024 }),
  });

  if (res.status === 401 || res.status === 403) throw new Error("api_key");
  if (res.status === 429) throw new Error("rate");
  if (!res.ok) throw new Error("server");

  const data = await res.json();
  const out = data?.choices?.[0]?.message?.content;
  if (!out) throw new Error("server");
  return cleanOutput(out, polishBadini);
}

// 4) OpenRouter
async function callOpenRouter(prompt, image, polishBadini) {
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
  return cleanOutput(out, polishBadini);
}

// 5) Cloudflare Workers AI (Text)
async function callCloudflare(prompt, image, polishBadini) {
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
  return cleanOutput(out, polishBadini);
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

  const polishBadini =
    mode === "fix" ||
    (mode === "explain" && ui === "ku") ||
    (mode === "translate" && to === "ku-Ar");

  const prompt = buildPrompt({ mode, text, translation, from, to, style, ui, hasImage: !!image?.data });
  const providers = [
    ["Gemini", callGemini],
    ["Groq", callGroq],
    ["NVIDIA", callNvidia],
    ["OpenRouter", callOpenRouter],
    ["Cloudflare", callCloudflare],
  ];

  const startedAt = Date.now();
  let lastError = "server";
  let hasAnyKey = false;

  for (const [name, run] of providers) {
    if (Date.now() - startedAt > 8200) break;
    try {
      const result = await run(prompt, image, polishBadini);
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
