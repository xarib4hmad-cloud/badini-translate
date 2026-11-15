// netlify/functions/translate.js
// وەرگێڕا بادینی - فەنکشنا Netlify (نڤیسینا نوی و چاککری)

// ───────────── ڕێکخستن ─────────────
// کۆمێ وەختێ فەنکشنێ (ms). دڤێت ل netlify.toml ژی timeout = 26 بیت.
const TOTAL_BUDGET_MS = Number(process.env.FUNCTION_BUDGET_MS) || 23000;

// ناڤێن مۆدێلان: ئەگەر ناڤەک نەمایە، ل Netlify ل Environment variables بگۆڕە، پێدڤی ب دەستکارییا کۆدی نینە.
const MODELS = {
  gemini: [
    process.env.GEMINI_MODEL_1 || "gemini-3.8-flash",
    process.env.GEMINI_MODEL_2 || "gemini-3.5-flash-lite",
    process.env.GEMINI_MODEL_3 || "gemini-2.5-flash",
  ],
  groqText: process.env.GROQ_TEXT_MODEL || "openai/gpt-oss-120b",
  groqVision: process.env.GROQ_VISION_MODEL || "qwen/qwen3.8-27b",
  nvidia: process.env.NVIDIA_MODEL || "nvidia/nemotron-3.5-super-vl-120b-a12b",
  openrouterText: process.env.OPENROUTER_TEXT_MODEL || "openrouter/free",
  openrouterVision: process.env.OPENROUTER_VISION_MODEL || "nvidia/nemotron-3.5-super-vl:free",
  cloudflare: process.env.CLOUDFLARE_MODEL || "@cf/moonshotai/kimi-k2.6",
};

const MAX_WORDS = 500;
const MAX_CHARS = 3000; // وەک ل ئینتەرفەیسی دیار دبیت (3000)

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
1. Write ONLY in pure, eloquent, natural Badini Kurdish (Duhok/Zakho/Amedi/Akre dialect). NEVER mix in Sorani words or Sorani grammar.
2. Authentic Badini Vocabulary (Badini vs Sorani):
   - گەلەک (NOT زۆر), چاوا (NOT چۆن), ئەڤە / ئەڤ (NOT ئەمە), دگەل (NOT لەگەڵ), نینە (NOT نییە), بەلێ (NOT بەڵێ/بەڵام), لێ / بەلێ (for "but"), هەروەسا (NOT هەروەها), ب تنێ (NOT تەنیا/تەنها), ڤێرێ (NOT ئێرە), وێرێ (NOT ئەوێ), ژ بەر کو (NOT چونکە/لەبەرئەوەی), پێدڤی (NOT پێویست/پێتڤی), سەقا (NOT کەشوهەوا/هوا), زوی (NOT زوو), دشێم (NOT دەتوانم), دزانم (NOT دەزانم), دکەم (NOT دەکەم), بێ زەحمەت / هیڤی یە (NOT تکایە), ئەلمانی (NOT ئەڵمانی), بێهنەکێ ڤەدەم (NOT پشوو/بێهۆنەکێ), دووماهی (NOT دوماهی), ڕووکار (NOT رووکار), پاقژکرن (NOT پاککرن).
3. Grammar:
   - Future tense uses "دێ": ئەز دێ چم (I will go), ئەو دێ هێت (he/she will come).
   - Present continuous uses "یێ / یا / یێن" + "دـ": ئەز یێ دچم (I am going), ئەو یا دخوینیت (she is reading).
   - Past transitive verbs are ERGATIVE: من گۆت (I said), من کر (I did), تە دیت (you saw), وی نڤیسی (he wrote) — NEVER Sorani "وتم/کردم".
   - Arabic script spelling: Use Kurdish ک (not ك), ی (not ي), ە (not ه at word ends), and NEVER write "ەا" together (write نموونەیا, NOT نموونەا).
4. Examples of natural, eloquent Badini:
   - "I am going to the market." -> "ئەز یێ دچمە بازاری."
   - "I bought bread this morning and came home." -> "من ئەڤ سپێدێ نان کڕی و هاتمە مال."
   - "Did you see my friend yesterday?" -> "تە دوهی هەڤالێ من دیت؟"
   - "Tomorrow we will go to Duhok." -> "سباهی ئەم دێ چینە دهۆکێ."
   - "I don't know where he is, he is not here." -> "ئەز نزانم ئەو ل کیڤە یە، ئەو ل ڤێرێ نینە."
   - "Please wait a little, the weather is cold today." -> "بێ زەحمەت کێمەکێ چاڤەڕێ بکە، ئەڤرۆ سەقا سارە."
   - "The bathroom is between the kitchen and my parents' bedroom." -> "سەرشۆ د ناڤبەرا مەتبەخێ و ژوورا نڤستنا دایبابێن من دایە."
   - "Thank you very much for helping me." -> "گەلەک سوپاس بۆ هاریکاریکرنا تە."
`.trim();

// ───────────── یاریکەرێن یارمەتیدەر ─────────────
function countWords(str) {
  const t = (str || "").trim();
  return t ? t.split(/\s+/).length : 0;
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
    },
    body: JSON.stringify(body),
  };
}

function buildPrompts({ mode, text, translation, from, to, style, ui, hasImage }) {
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
    return {
      systemPrompt: [
        `You are a native Badini Kurdish (Behdini) language editor.`,
        `Fix spelling, grammar, ergativity, word spacing, and punctuation mistakes in the user's text.`,
        BADINI_STYLE_RULES,
        `- ${scriptHint}`,
        `- Output ONLY the corrected text with NO explanations, NO quotes, and NO markdown.`,
      ].join("\n"),
      userPrompt: text,
    };
  }

  if (mode === "explain") {
    const explainLang = UI_LANG_NAMES[ui] || UI_LANG_NAMES.ku;
    return {
      systemPrompt: [
        `You are a native, clear language teacher specializing in Badini Kurdish (Behdini) and world languages.`,
        `Write your entire response in ${explainLang}.`,
        ui === "ku" ? BADINI_STYLE_RULES : "",
        `Provide:`,
        `1) A brief, natural explanation of the meaning and grammar (2 short lines, simple grammar terms, NO invented words).`,
        `2) 2 practical example sentences with translations.`,
        `Strict rules: Do NOT write any greeting (like "سلاڤ"), do NOT use markdown symbols (**, *, #), and double-check every Badini word.`,
      ]
        .filter(Boolean)
        .join("\n"),
      userPrompt: [
        `Source language: ${fromName}`,
        `Target language: ${toName}`,
        text ? `Original: ${text}` : "",
        translation ? `Translation: ${translation}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    };
  }

  const styleDesc =
    style === "formal"
      ? "Use a formal, polite, and professional tone."
      : style === "everyday"
      ? "Use natural everyday spoken language."
      : "Use clear, eloquent, accurate, and natural language.";

  return {
    systemPrompt: [
      `You are an elite native translator specializing in Badini Kurdish (Behdini) and world languages.`,
      `Source language: ${fromName}.`,
      `Target language: ${toName}.`,
      `Style: ${styleDesc}`,
      isBadiniTarget ? BADINI_STYLE_RULES : "",
      `Output rules:`,
      `- Translate the COMPLETE text, every paragraph and every sentence, and do not skip or shorten anything.`,
      `- Keep the same paragraph breaks as the original.`,
      `- Output ONLY the final translation without explanations, quotes, greetings, or markdown.`,
      hasImage
        ? `- Read all visible text in the image and translate it accurately. If there is no readable text in the image and no user text was provided, reply with exactly: __NO_TEXT__`
        : "",
    ]
      .filter(Boolean)
      .join("\n"),
    userPrompt: text || "Read the visible text in the image and translate it.",
  };
}

// ───────────── چاککرنا دەرکەفتنێ ─────────────
// چاککرنێن ناڤ پەیڤێ (substring) - تنێ بۆ خەلەتیێن بێ مەترسی
const BADINI_SUBSTRING_FIXES = {
  "هەروتسا": "هەروەسا",
  "هەر وەتسا": "هەروەسا",
  "نموونەا": "نموونەیا",
  "پێتڤی": "پێدڤی",
  "پەیفا": "پەیڤا",
  "ئەفە": "ئەڤە",
  "گەلەك": "گەلەک",
  "ئێكێ": "ئێکێ",
  "بێهۆنەکێ ڤەگرتم": "بێهنەکێ ڤەدەم",
  "بێهۆنەکێ": "بێهنەکێ",
};

// چاککرنێن پەیڤا تەمام (تنێ دەمێ پەیڤ ب تنێ بیت)
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
  ["بەله", "بەلێ"],
  ["دەتوانم", "دشێم"],
  ["دەزانم", "دزانم"],
  ["دەکەم", "دکەم"],
  ["زوو", "زوی"],
  ["هوا", "سەقا"],
];

const WORD_FIX_REGEXES = BADINI_WORD_FIXES.map(([wrong, right]) => ({
  re: new RegExp(`(^|[\\s،.؛؟!«»"()\\-])${wrong}(?=$|[\\s،.؛؟!«»"()\\-])`, "g"),
  right,
}));

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
    for (const { re, right } of WORD_FIX_REGEXES) {
      out = out.replace(re, `$1${right}`);
    }
  }
  return out;
}

// ───────────── داخوازیا تۆڕێ ب وەختێ دیارکری ─────────────
// وەختێ ماى ژ deadline دبینیت، و هەرگیز ژ وی زێدەتر ناکێشیت
async function fetchWithTimeout(url, options, ms, deadline) {
  const allowed = Math.min(ms, deadline - Date.now());
  if (allowed < 1500) throw new Error("timeout");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), allowed);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function logFail(provider, detail) {
  console.error(`[translate] ${provider} failed: ${detail}`);
}

function geminiGenerationConfig(model) {
  const config = { temperature: 0.15, maxOutputTokens: 4096 };
  if (/^gemini-3/.test(model)) {
    config.thinkingConfig = { thinkingLevel: /lite/.test(model) ? "minimal" : "low" };
  } else if (/^gemini-2\.5/.test(model) && !/pro/.test(model)) {
    config.thinkingConfig = { thinkingBudget: 0 };
  }
  return config;
}

// ───────────── پرۆڤایدەر ─────────────
async function callGemini(systemPrompt, userPrompt, image, polishBadini, deadline) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("NO_KEY");

  const parts = [{ text: userPrompt }];
  if (image?.data && image?.mimeType) {
    parts.push({ inline_data: { mime_type: image.mimeType, data: image.data } });
  }

  let lastErr = "server";
  for (let i = 0; i < MODELS.gemini.length; i++) {
    if (deadline - Date.now() < 2000) break;
    const model = MODELS.gemini[i];
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
      const res = await fetchWithTimeout(
        url,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            system_instruction: { parts: [{ text: systemPrompt }] },
            contents: [{ role: "user", parts }],
            generationConfig: geminiGenerationConfig(model),
          }),
        },
        i === 0 ? 10000 : 6000,
        deadline
      );

      if (res.status === 401 || res.status === 403) { lastErr = "api_key"; logFail(model, res.status); continue; }
      if (res.status === 429) { lastErr = "quota"; logFail(model, res.status); continue; }
      if (!res.ok) { lastErr = "server"; logFail(model, `${res.status} ${(await res.text()).slice(0, 200)}`); continue; }

      const data = await res.json();
      const out = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("").trim();
      if (out) return cleanOutput(out, polishBadini);
      lastErr = "server";
      logFail(model, "empty response");
    } catch (err) {
      lastErr = "timeout";
      logFail(model, err?.name === "AbortError" ? "timeout" : err?.message);
      continue; // بچە سەر مۆدێلێ دی
    }
  }
  throw new Error(lastErr);
}

// پرۆڤایدەرێن OpenAI-compatible هەمی ب هەمان ڕێکێ
async function callOpenAICompatible({ name, url, apiKey, model, systemPrompt, userPrompt, image, polishBadini, deadline, extraBody = {}, extraHeaders = {}, timeoutMs = 8000 }) {
  const content = image?.data
    ? [
        { type: "text", text: userPrompt },
        { type: "image_url", image_url: { url: `data:${image.mimeType};base64,${image.data}` } },
      ]
    : userPrompt;

  const res = await fetchWithTimeout(
    url,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}`, ...extraHeaders },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content },
        ],
        temperature: 0.15,
        ...extraBody,
      }),
    },
    timeoutMs,
    deadline
  );

  if (res.status === 401 || res.status === 403) { logFail(name, res.status); throw new Error("api_key"); }
  if (res.status === 429) { logFail(name, res.status); throw new Error("rate"); }
  if (!res.ok) { logFail(name, `${res.status} ${(await res.text()).slice(0, 200)}`); throw new Error("server"); }

  const data = await res.json();
  const out = data?.choices?.[0]?.message?.content;
  if (!out) { logFail(name, "empty response"); throw new Error("server"); }
  return cleanOutput(out, polishBadini);
}

async function callGroq(systemPrompt, userPrompt, image, polishBadini, deadline) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("NO_KEY");
  return callOpenAICompatible({
    name: "Groq",
    url: "https://api.groq.com/openai/v1/chat/completions",
    apiKey,
    model: image ? MODELS.groqVision : MODELS.groqText,
    systemPrompt, userPrompt, image, polishBadini, deadline,
    extraBody: image ? {} : { reasoning_effort: "low" },
  });
}

async function callNvidia(systemPrompt, userPrompt, image, polishBadini, deadline) {
  const apiKey = process.env.NVIDIA_API_KEY;
  if (!apiKey) throw new Error("NO_KEY");
  return callOpenAICompatible({
    name: "NVIDIA",
    url: "https://integrate.api.nvidia.com/v1/chat/completions",
    apiKey,
    model: MODELS.nvidia,
    systemPrompt, userPrompt, image, polishBadini, deadline,
    extraBody: { max_tokens: 2048 },
  });
}

async function callOpenRouter(systemPrompt, userPrompt, image, polishBadini, deadline) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("NO_KEY");
  return callOpenAICompatible({
    name: "OpenRouter",
    url: "https://openrouter.ai/api/v1/chat/completions",
    apiKey,
    model: image ? MODELS.openrouterVision : MODELS.openrouterText,
    systemPrompt, userPrompt, image, polishBadini, deadline,
    extraHeaders: {
      "HTTP-Referer": "https://badini-translate.netlify.app",
      "X-Title": "Badini Translate",
    },
  });
}

async function callCloudflare(systemPrompt, userPrompt, image, polishBadini, deadline) {
  if (image?.data) throw new Error("skip_image");
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (!token || !accountId) throw new Error("NO_KEY");

  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${MODELS.cloudflare}`;
  const res = await fetchWithTimeout(
    url,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    },
    8000,
    deadline
  );

  if (res.status === 401 || res.status === 403) { logFail("Cloudflare", res.status); throw new Error("api_key"); }
  if (res.status === 429) { logFail("Cloudflare", res.status); throw new Error("rate"); }
  if (!res.ok) { logFail("Cloudflare", `${res.status} ${(await res.text()).slice(0, 200)}`); throw new Error("server"); }

  const data = await res.json();
  const out = data?.result?.response || data?.result?.choices?.[0]?.message?.content;
  if (!out) { logFail("Cloudflare", "empty response"); throw new Error("server"); }
  return cleanOutput(out, polishBadini);
}

// ───────────── پێداچوونا دووێ ─────────────
async function secondPassProofread(draft, mainProvider, deadline) {
  const proofSystem = [
    `You are a strict Badini Kurdish (Behdini) proofreader.`,
    `Fix ONLY spelling typos (نموونەا -> نموونەیا, پێتڤی -> پێدڤی), Sorani words (زۆر -> گەلەک, چۆن -> چاوا, نییە -> نینە, لەگەڵ -> دگەل, هوا -> سەقا), or ergative grammar errors (کردم -> من کر).`,
    `Keep the exact same meaning, the same length and the same paragraph format. Output ONLY the final Badini text with NO comments, NO greetings, and NO markdown.`,
  ].join("\n");

  try {
    let edited = "";
    if (mainProvider !== "Groq" && process.env.GROQ_API_KEY) {
      edited = await callGroq(proofSystem, draft, null, true, deadline);
    } else if (mainProvider !== "Gemini" && process.env.GEMINI_API_KEY) {
      edited = await callGemini(proofSystem, draft, null, true, deadline);
    }
    if (edited && edited.length >= draft.length * 0.75 && edited.length <= draft.length * 1.35) {
      return edited;
    }
  } catch {
    // ئەگەر پێداچوونا دووێ سەرنەکەفت، بەرسڤا ئێکێ بهێلە
  }
  return draft;
}

// ───────────── هەندلەر ─────────────
exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return json(200, { ok: true });
  if (event.httpMethod !== "POST") return json(405, { error: "server" });

  const startedAt = Date.now();
  const deadline = startedAt + TOTAL_BUDGET_MS;

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
  if ((mode === "translate" || mode === "fix") && (countWords(text) > MAX_WORDS || text.length > MAX_CHARS)) {
    return json(400, { error: "too_many_words" });
  }
  if (image?.data) {
    if (!String(image.mimeType || "").startsWith("image/")) return json(400, { error: "bad_image" });
    if (image.data.length > 2 * 1024 * 1024) return json(413, { error: "too_large" });
  }

  const polishBadini =
    mode === "fix" ||
    (mode === "explain" && ui === "ku") ||
    (mode === "translate" && to === "ku-Ar");

  const { systemPrompt, userPrompt } = buildPrompts({
    mode, text, translation, from, to, style, ui, hasImage: !!image?.data,
  });

  const providers = [
    ["Gemini", callGemini],
    ["Groq", callGroq],
    ["NVIDIA", callNvidia],
    ["OpenRouter", callOpenRouter],
    ["Cloudflare", callCloudflare],
  ];

  let lastError = "server";
  let hasAnyKey = false;

  for (const [name, run] of providers) {
    if (deadline - Date.now() < 2000) break;
    try {
      let result = await run(systemPrompt, userPrompt, image, polishBadini, deadline);
      if (result.includes("__NO_TEXT__")) {
        return json(200, { translation: "", noText: true, provider: name });
      }

      // پێداچوونا دووێ تنێ بۆ دەقێن کورت و دەمێ وەخت مایی
      const remaining = deadline - Date.now();
      if (polishBadini && result.length < 800 && remaining > 7000) {
        const proofDeadline = Math.min(deadline - 500, Date.now() + 6000);
        result = await secondPassProofread(result, name, proofDeadline);
      }
      return json(200, { translation: result, noText: false, provider: name });
    } catch (err) {
      if (err.message === "NO_KEY" || err.message === "skip_image") continue;
      hasAnyKey = true;
      lastError = err.name === "AbortError" ? "timeout" : err.message;
      logFail(name, lastError);
    }
  }

  if (!hasAnyKey) return json(401, { error: "api_key" });
  return json(lastError === "rate" || lastError === "quota" ? 429 : 500, { error: lastError });
};
