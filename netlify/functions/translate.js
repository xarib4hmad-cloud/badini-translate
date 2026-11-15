// netlify/functions/translate.js  (وەشانا 2 - کوالیتیا بادینی یا باشتر)
//
// چ هاتیە گوهورین:
//  1) پرۆمپتا رێزمانێ یا بادینی گەلەک بهێزتر (جێناڤ، ئێرگەتیڤ، ئیزافە، کەسێن کردارێ، نەرێکرن)
//  2) دەقێ درێژ دهێتە دابەشکرن بۆ پارچەیێن بچووک و ب هەڤڕا دهێنە وەرگێڕان (باشتر + زویتر)
//  3) پشتی وەرگێڕانێ، پێداچوونەکا رێزمانی ب مۆدێلەکێ دی دهێتە کرن، ب بەراورد دگەل دەقێ ڕەسەن
//  4) فەرهەنگا چاککرنا Sorani -> Badini فرەهتر و ب ئاسانی دهێتە زێدەکرن

// ───────────── ڕێکخستن ─────────────
const TOTAL_BUDGET_MS = Number(process.env.FUNCTION_BUDGET_MS) || 23000;
const CHUNK_MAX_CHARS = 400; // درێژاتیا هەر پارچەیەکێ
const CONCURRENCY = 3; // چەند پارچە ب هەڤڕا

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
const MAX_CHARS = 3000;

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

// ───────────── رێزمانا بادینی ─────────────
const BADINI_STYLE_RULES = `
CRITICAL BADINI KURDISH (BEHDINI) RULES - follow every rule exactly:

1. DIALECT: Write ONLY pure, natural Badini (Duhok / Zakho / Amedi / Akre). NEVER use Sorani words, Sorani verb forms, or Sorani spelling.

2. VOCABULARY (Badini, NOT Sorani):
   گەلەک (not زۆر), چاوا (not چۆن), ئەڤە/ئەڤ (not ئەمە), دگەل (not لەگەڵ), نینە (not نییە), بەلێ (not بەڵێ/بەڵام), هەروەسا (not هەروەها), ب تنێ (not تەنیا/تەنها), ڤێرێ (not ئێرە), وێرێ (not ئەوێ), ژ بەر کو (not چونکە), پێدڤی (not پێویست), سەقا (not هەوا), زوی (not زوو), دشێم (not دەتوانم), دزانم (not دەزانم), هیڤی یە / بێ زەحمەت (not تکایە), ئەلمانی (not ئەڵمانی), پاقژکرن (not پاککرن), مال (not ماڵ), نها (not ئێستا), ئەڤرۆ (not ئەمڕۆ), دوهی (not دوێنێ), سباهی (not سبەی), کیڤە (not کوێ), هندەک (not هەندێک), هەمی (not هەموو), ئەم (not ئێمە), هوین (not ئێوە), تو (not تۆ), زاڕۆک (not منداڵ).

3. PRONOUNS:
   Direct: ئەز (I), تو (you), ئەو (he/she/it/they), ئەم (we), هوین (you pl.).
   Oblique / ergative agent: من، تە، وی (masc.)، وێ (fem.)، مە، هەوە، وان.

4. PRESENT TENSE = prefix د + stem + personal ending:
   ئەز دچم، تو دچی، ئەو دچیت، ئەم دچین، هوین دچن، ئەو دچن.
   ئەز دخوینم، تو دخوینی، ئەو دخوینیت، ئەم دخوینین.
   Negative: prefix نا or ن: ئەز ناچم، ئەز نزانم، ئەو ناخۆت.
   Progressive: ئەز یێ دچم (m.), ئەز یا دچم (f.), ئەم یێن دچین.

5. FUTURE: دێ + verb: ئەز دێ چم، ئەو دێ هێت، ئەم دێ چینە دهۆکێ.
   Ability: دشێم + subjunctive: ئەز دشێم بچم. Need/want: من دڤێت بچم، پێدڤی یە ئەز بچم.
   Subjunctive uses prefix ب: بچم، بکەم، بنڤیسم.

6. PAST INTRANSITIVE (agent in direct case, verb agrees with the agent):
   ئەز چووم، تو چووی، ئەو چوو، ئەم چووین، هوین چووین، ئەو چوون. ئەز هاتم، ئەو هات.

7. PAST TRANSITIVE = ERGATIVE (VERY IMPORTANT):
   The agent is in the OBLIQUE case (من، تە، وی، وێ، مە، هەوە، وان) and the verb agrees with the OBJECT, never with the agent.
   من نان خوار. تە فیلم دیت. وی نامەک نڤیسی. وێ مال پاقژ کر. مە گۆت. وان خانییەک کڕی.
   NEVER write Sorani forms like وتم / کردم / خواردم / نووسیم.

8. NOUN CASES AND IZAFE:
   Izafe: masculine -ێ (هەڤالێ من), feminine -ا (مالا من, کتێبا من), plural -ێن (هەڤالێن من).
   After a noun ending in ە the feminine izafe is written with یا: نموونەیا (NEVER نموونەا).
   Oblique after prepositions: masculine -ی (ل بازاری), feminine -ێ (ل مالێ).

9. PREPOSITIONS: ل (at/in), ژ (from), ب (with/by), بۆ (for/to), د ... دا (in), دگەل (with), ل سەر (on), ل ژێر (under), ل پشت (behind), ل ناڤ (inside).

10. BE / EXIST: هەیە (there is/has), نینە (there is not), ئەو ل مالێ یە، ئەو ل ڤێرێ نینە.

11. QUESTIONS: چ (what), کێ (who), ل کیڤە (where), کەنگی (when), چاوا (how), چەند (how many), ژ بەر چ (why).

12. SPELLING: use Kurdish ک (not ك), ی (not ي), ە (not ه at word end), ڤ for the V sound, ێ ۆ ڕ ڵ correctly. Never write ەا together. Put spaces correctly around prepositions (ل ، ژ ، ب ، د are separate words except د as a verb prefix).

13. STYLE: Translate the MEANING, not word by word. Re-order the sentence naturally (verb at the end, as in Badini). Do not copy the grammar or word order of the source language.

14. EXAMPLES of correct natural Badini:
   - "I am going to the market." -> "ئەز یێ دچمە بازاری."
   - "I bought bread this morning and came home." -> "من ئەڤ سپێدێ نان کڕی و هاتمە مال."
   - "Did you see my friend yesterday?" -> "تە دوهی هەڤالێ من دیت؟"
   - "Tomorrow we will go to Duhok." -> "سباهی ئەم دێ چینە دهۆکێ."
   - "I don't know where he is, he is not here." -> "ئەز نزانم ئەو ل کیڤە یە، ئەو ل ڤێرێ نینە."
   - "Please wait a little, the weather is cold today." -> "بێ زەحمەت کێمەکێ چاڤەڕێ بکە، ئەڤرۆ سەقا سارە."
   - "The bathroom is between the kitchen and my parents' bedroom." -> "سەرشۆ د ناڤبەرا مەتبەخێ و ژوورا نڤستنا دایبابێن من دایە."
   - "Thank you very much for helping me." -> "گەلەک سوپاس بۆ هاریکاریکرنا تە."
   - "We clean the whole house on Sunday." -> "ئەم رۆژا یەکشەمبێ هەمی مالێ پاقژ دکەین."
   - "He wrote a letter yesterday." -> "وی دوهی نامەک نڤیسی."
   - "I will call you tomorrow." -> "ئەز دێ سباهی تلفونێ بۆ تە کەم."
   - "Where do you live?" -> "تو ل کیڤە دمینی؟"
   - "She doesn't like tea." -> "ئەو حەز ژ چایێ ناکەت."
`.trim();

// ───────────── یارمەتیدەر ─────────────
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

function logFail(provider, detail) {
  console.error(`[translate] ${provider} failed: ${detail}`);
}

// پارچەکرنا دەقی ب پەرگراف و ڕستە، دا کو هەر پارچەیەک نە درێژ بیت
function splitText(text, maxLen = CHUNK_MAX_CHARS) {
  const segs = [];
  const paras = text.split(/\n{2,}/);
  paras.forEach((para, pi) => {
    const lines = para.split("\n").map((s) => s.trim()).filter(Boolean);
    lines.forEach((line, li) => {
      const sentences = line.split(/(?<=[.!?؟…])\s+/);
      let cur = "";
      const flush = (sep) => {
        if (cur) {
          segs.push({ t: cur, sep });
          cur = "";
        }
      };
      sentences.forEach((s) => {
        if (cur && cur.length + s.length + 1 > maxLen) flush(" ");
        cur = cur ? `${cur} ${s}` : s;
      });
      flush(li < lines.length - 1 ? "\n" : pi < paras.length - 1 ? "\n\n" : "");
    });
  });
  return segs.length ? segs : [{ t: text, sep: "" }];
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

// ───────────── پرۆمپت ─────────────
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
        `Fix spelling, grammar, ergativity, izafe, verb agreement, word spacing, and punctuation mistakes in the user's text. Replace every Sorani word with its Badini equivalent. Do not change the meaning and do not add or remove sentences.`,
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
      `- Translate the COMPLETE text. Do not skip, shorten or add anything.`,
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

function buildReviewSystem(to) {
  const script =
    to === "ku-Latn"
      ? "Keep the Hawar Latin script."
      : "Keep the Kurdish Arabic script.";
  return [
    `You are a senior Badini Kurdish (Behdini) editor and grammar checker.`,
    `You receive a BADINI DRAFT and, when available, the SOURCE text it was translated from (the source is for checking meaning only).`,
    `Check the draft sentence by sentence against this checklist and correct every error:`,
    `a) Sorani words or Sorani verb forms -> replace with Badini.`,
    `b) Ergative construction in past transitive verbs (agent in oblique case, verb agrees with the object).`,
    `c) Izafe (-ێ / -ا / -ێن) and oblique endings (-ی / -ێ) on nouns.`,
    `d) Verb prefix د, personal endings, negation, future with دێ, subjunctive with ب.`,
    `e) Spelling and spacing (ک ی ە ڤ ێ ۆ, never ەا together, separate prepositions).`,
    `f) Missing or added content compared with the SOURCE: restore anything missing, remove anything invented.`,
    `g) Unnatural word-for-word calques from the source language: rewrite them as a native Badini speaker would say it.`,
    `If the draft is already correct, return it UNCHANGED.`,
    script,
    `Keep the same paragraph breaks. Output ONLY the final corrected Badini text with NO comments, NO quotes, NO greetings and NO markdown.`,
    BADINI_STYLE_RULES,
  ].join("\n");
}

// ───────────── چاککرنا دەرکەفتنێ ─────────────
const BADINI_SUBSTRING_FIXES = {
  "هەروتسا": "هەروەسا",
  "هەر وەتسا": "هەروەسا",
  "پێتڤی": "پێدڤی",
  "پەیفا": "پەیڤا",
  "ئەفە": "ئەڤە",
  "گەلەك": "گەلەک",
  "ئێكێ": "ئێکێ",
  "بێهۆنەکێ ڤەگرتم": "بێهنەکێ ڤەدەم",
  "بێهۆنەکێ": "بێهنەکێ",
};

// پەیڤێن ب تنێ (Sorani -> Badini)
const BADINI_WORD_FIXES = [
  // پەیڤێن گشتی
  ["زۆر", "گەلەک"],
  ["چۆن", "چاوا"],
  ["لەگەڵ", "دگەل"],
  ["نییە", "نینە"],
  ["ئەمە", "ئەڤە"],
  ["هەروەها", "هەروەسا"],
  ["تەنیا", "ب تنێ"],
  ["تەنها", "ب تنێ"],
  ["ئێرە", "ڤێرێ"],
  ["لێرە", "ل ڤێرێ"],
  ["لەوێ", "ل وێرێ"],
  ["چونکە", "ژ بەر کو"],
  ["لەبەرئەوەی", "ژ بەر کو"],
  ["پێویست", "پێدڤی"],
  ["تکایە", "هیڤی یە"],
  ["بەڵام", "بەلێ"],
  ["بەڵێ", "بەلێ"],
  ["بەله", "بەلێ"],
  ["بەڵکو", "بەلکو"],
  ["زوو", "زوی"],
  ["هوا", "سەقا"],
  ["ئێستا", "نها"],
  ["ئەمڕۆ", "ئەڤرۆ"],
  ["ئەمشەو", "ئەڤشەڤ"],
  ["دوێنێ", "دوهی"],
  ["سبەی", "سباهی"],
  ["کوێ", "کیڤە"],
  ["هەندێک", "هندەک"],
  ["هەموو", "هەمی"],
  ["ماڵ", "مال"],
  ["منداڵ", "زاڕۆک"],
  ["ئەڵمانی", "ئەلمانی"],
  ["پاککرن", "پاقژکرن"],
  // جێناڤ
  ["ئێمە", "ئەم"],
  ["ئێوە", "هوین"],
  ["تۆ", "تو"],
  // کردارێن ڕەوشا نها (Sorani دە- -> Badini د-)
  ["دەتوانم", "دشێم"],
  ["دەتوانیت", "دشێیت"],
  ["دەتوانین", "دشێین"],
  ["دەزانم", "دزانم"],
  ["دەزانیت", "دزانیت"],
  ["دەزانین", "دزانین"],
  ["دەکەم", "دکەم"],
  ["دەکەیت", "دکەیت"],
  ["دەکات", "دکەت"],
  ["دەکەین", "دکەین"],
  ["دەکەن", "دکەن"],
  ["دەچم", "دچم"],
  ["دەچیت", "دچیت"],
  ["دەچین", "دچین"],
  ["دەچن", "دچن"],
  ["دەخۆم", "دخۆم"],
  ["دەخوێنم", "دخوینم"],
  ["دەنووسم", "دنڤیسم"],
  ["دەبینم", "دبینم"],
  ["دەبێت", "دبیت"],
  ["دەبن", "دبن"],
  ["دەهێم", "دهێم"],
  // کردارێن دەمێ بۆری (Sorani -> ئێرگەتیڤ)
  ["وتم", "من گۆت"],
  ["کردم", "من کر"],
];

const WORD_BOUNDARY = "[\\s،.؛؟!«»\"()\\-:]";
const WORD_FIX_REGEXES = BADINI_WORD_FIXES.map(([wrong, right]) => ({
  re: new RegExp(`(^|${WORD_BOUNDARY})${wrong}(?=$|${WORD_BOUNDARY})`, "g"),
  right,
}));
const IZAFE_FIX_RE = new RegExp(`ەا(?=$|${WORD_BOUNDARY})`, "g");

function cleanOutput(raw, polishBadini) {
  let out = (raw || "")
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/\*\*/g, "")
    .replace(/^#{1,4}\s+/gm, "")
    .trim();

  if (polishBadini) {
    // یەکخستنا پیتێن عەرەبی بۆ کوردی
    out = out.replace(/ك/g, "ک").replace(/[يى]/g, "ی").replace(/ة/g, "ە");
    for (const [wrong, right] of Object.entries(BADINI_SUBSTRING_FIXES)) {
      out = out.split(wrong).join(right);
    }
    for (const { re, right } of WORD_FIX_REGEXES) {
      out = out.replace(re, `$1${right}`);
    }
    // نموونەا -> نموونەیا
    out = out.replace(IZAFE_FIX_RE, "ەیا");
  }
  return out;
}

// ───────────── داخوازیا تۆڕێ ب وەختێ دیارکری ─────────────
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

function geminiGenerationConfig(model) {
  const config = { temperature: 0.1, maxOutputTokens: 4096 };
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
      continue;
    }
  }
  throw new Error(lastErr);
}

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
        temperature: 0.1,
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
    extraBody: image ? {} : { reasoning_effort: "medium" },
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

const PROVIDERS = [
  { name: "Gemini", run: callGemini, hasKey: () => !!process.env.GEMINI_API_KEY },
  { name: "Groq", run: callGroq, hasKey: () => !!process.env.GROQ_API_KEY },
  { name: "NVIDIA", run: callNvidia, hasKey: () => !!process.env.NVIDIA_API_KEY },
  { name: "OpenRouter", run: callOpenRouter, hasKey: () => !!process.env.OPENROUTER_API_KEY },
  {
    name: "Cloudflare",
    run: callCloudflare,
    hasKey: () => !!(process.env.CLOUDFLARE_API_TOKEN && process.env.CLOUDFLARE_ACCOUNT_ID),
  },
];

// ───────────── پێداچوونا رێزمانی ─────────────
// مۆدێلەکێ جودا (ئەگەر هەبیت) دەقێ بادینی دگەل ڕەسەنی بەراورد دکەت و چاک دکەت
async function reviewSegments(drafts, sources, mainProvider, to, deadline) {
  const reviewer =
    PROVIDERS.find((p) => p.name !== mainProvider.name && p.hasKey()) || mainProvider;
  const reviewDeadline = Math.min(deadline - 300, Date.now() + 9000);
  const system = buildReviewSystem(to);

  return mapLimit(drafts, CONCURRENCY, async (draft, i) => {
    if (!draft) return draft;
    const src = sources[i];
    const user = src
      ? `SOURCE (for checking meaning only):\n${src}\n\nBADINI DRAFT:\n${draft}`
      : `BADINI DRAFT:\n${draft}`;
    try {
      const edited = await reviewer.run(system, user, null, true, reviewDeadline);
      if (edited && edited.length >= draft.length * 0.7 && edited.length <= draft.length * 1.4) {
        return edited;
      }
    } catch {
      // ئەگەر پێداچوون سەرنەکەفت، دەقێ ئێکێ بهێلە
    }
    return draft;
  });
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

  const isBadiniTarget = to === "ku-Ar" || to === "ku-Latn";
  const polishBadini =
    mode === "fix" ||
    (mode === "explain" && ui === "ku") ||
    (mode === "translate" && to === "ku-Ar");
  const doReview = mode === "translate" && isBadiniTarget;

  const { systemPrompt, userPrompt } = buildPrompts({
    mode, text, translation, from, to, style, ui, hasImage: !!image?.data,
  });

  // دەقێ درێژ دهێتە پارچەکرن و ب هەڤڕا دهێتە وەرگێڕان. وێنە و explain ب ئێک داخواز.
  const useChunks = (mode === "translate" || mode === "fix") && !image?.data && !!text;
  const segments = useChunks ? splitText(text) : null;

  let lastError = "server";
  let hasAnyKey = false;

  for (const provider of PROVIDERS) {
    if (deadline - Date.now() < 2000) break;
    try {
      let result;
      let draftParts = null;

      if (useChunks) {
        draftParts = await mapLimit(segments, CONCURRENCY, (seg) =>
          provider.run(systemPrompt, seg.t, null, polishBadini, deadline)
        );
        result = draftParts.map((p, i) => p + segments[i].sep).join("").trim();
      } else {
        result = await provider.run(systemPrompt, userPrompt, image, polishBadini, deadline);
      }

      if (result.includes("__NO_TEXT__")) {
        return json(200, { translation: "", noText: true, provider: provider.name });
      }

      let reviewed = false;
      if (doReview && deadline - Date.now() > 6000) {
        if (useChunks) {
          const fixedParts = await reviewSegments(
            draftParts,
            segments.map((s) => s.t),
            provider,
            to,
            deadline
          );
          result = fixedParts.map((p, i) => p + segments[i].sep).join("").trim();
        } else {
          const [fixed] = await reviewSegments([result], [text], provider, to, deadline);
          result = fixed;
        }
        reviewed = true;
      }

      result = cleanOutput(result, polishBadini);
      return json(200, { translation: result, noText: false, provider: provider.name, reviewed });
    } catch (err) {
      if (err.message === "NO_KEY" || err.message === "skip_image") continue;
      hasAnyKey = true;
      lastError = err.name === "AbortError" ? "timeout" : err.message;
      logFail(provider.name, lastError);
    }
  }

  if (!hasAnyKey) return json(401, { error: "api_key" });
  return json(lastError === "rate" || lastError === "quota" ? 429 : 500, { error: lastError });
};
