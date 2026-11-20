// Server settings, all from environment variables. Nothing secret lives in the code.
// See .env.example for what each one does.
"use strict";

const num = (name, def) => {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : def;
};
const list = (name) => (process.env[name] || "").split(",").map((s) => s.trim()).filter(Boolean);

const DEFAULT_MODELS = {
  gemini: {
    quick: "gemini-3.1-flash-lite",
    default: "gemini-3.5-flash-lite",
    complex: "gemini-3.8-flash",
  },
  groq: {
    quick: "qwen/qwen3.8-27b",
    default: "qwen/qwen3.8-27b",
    complex: "openai/gpt-oss-120b",
  },
  anthropic: {
    quick: "claude-haiku-5-5",
    default: "claude-sonnet-5-5",
    complex: "claude-opus-5-5",
  },
  openai: {
    quick: "gpt-4o-mini",
    default: "gpt-4o-mini",
    complex: "gpt-4o",
  },
};

function collectGeminiKeys() {
  const keys = [];
  if (process.env.GEMINI_API_KEY) {
    process.env.GEMINI_API_KEY.split(",").map((s) => s.trim()).filter(Boolean).forEach((k) => keys.push(k));
  }
  for (let i = 2; i <= 10; i++) {
    const k = (process.env[`GEMINI_API_KEY_${i}`] || "").trim();
    if (k && !keys.includes(k)) keys.push(k);
  }
  if (process.env.GEMINI_API_KEYS) {
    process.env.GEMINI_API_KEYS.split(",").map((s) => s.trim()).filter(Boolean).forEach((k) => {
      if (!keys.includes(k)) keys.push(k);
    });
  }
  return keys;
}

function detectProvider() {
  const explicit = (process.env.AI_PROVIDER || "").trim().toLowerCase();
  if (explicit) {
    if (explicit === "claude") return "anthropic";
    return explicit;
  }
  // Auto-detect based on configured key:
  if (process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEYS) return "gemini";
  if (process.env.GROQ_API_KEY) return "groq";
  if (process.env.OPENAI_API_KEY) return "openai";
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  return "gemini";
}

function load() {
  const env = process.env.VERCEL_ENV || "development";
  const provider = detectProvider();
  const defModels = DEFAULT_MODELS[provider] || DEFAULT_MODELS.gemini;
  const geminiKeys = collectGeminiKeys();

  // Strict security (demanding external Upstash Redis, salt, and origins) is only enforced
  // if explicitly requested via STRICT_SECURITY=true, or during unit test suite checks
  const isTest = process.env.NODE_ENV === "test";
  const strictExplicit = String(process.env.STRICT_SECURITY || "").trim().toLowerCase() === "true";
  const strict = strictExplicit || (isTest && (env === "production" || env === "preview"));

  return {
    env,
    strict,
    aiEnabled: String(process.env.AI_ENABLED || "").trim().toLowerCase() === "true",

    provider,
    geminiKey: geminiKeys[0] || "",
    geminiKeys,
    groqKey: (process.env.GROQ_API_KEY || "").trim(),
    anthropicKey: (process.env.ANTHROPIC_API_KEY || "").trim(),
    openaiKey: (process.env.OPENAI_API_KEY || "").trim(),
    openaiBaseUrl: process.env.OPENAI_BASE_URL || (provider === "groq" ? "https://api.groq.com/openai/v1" : "https://api.openai.com/v1"),

    fallbackEnabled: String(process.env.AI_FALLBACK || "true").trim().toLowerCase() !== "false",

    models: {
      quick: process.env.AI_MODEL_QUICK || defModels.quick,
      default: process.env.AI_MODEL_DEFAULT || defModels.default,
      complex: process.env.AI_MODEL_COMPLEX || defModels.complex,
    },

    allowedOrigins: list("ALLOWED_ORIGINS"),

    redisUrl: process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || "",
    redisToken: process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || "",
    salt: process.env.RATE_LIMIT_SALT || "",

    perMinute: num("RATE_LIMIT_PER_MINUTE", 15),
    perDay: num("RATE_LIMIT_PER_DAY", 500),
    globalPerDay: num("GLOBAL_DAILY_LIMIT", 5000),

    testerToken: process.env.TESTER_TOKEN || "",
    testerPerMinute: num("TESTER_PER_MINUTE", 30),
    testerPerDay: num("TESTER_PER_DAY", 400),

    maxBodyBytes: Math.min(num("MAX_BODY_BYTES", 2500000), 4400000),
    maxImageBytes: num("MAX_IMAGE_BYTES", 1800000),
    maxImages: num("MAX_IMAGES", 1),
    maxPromptChars: num("MAX_PROMPT_CHARS", 40000),
    maxOutputTokens: num("MAX_OUTPUT_TOKENS", 2000),
  };
}

function missing(c) {
  const out = [];
  if (!c.aiEnabled) return out;

  if (c.provider === "gemini") {
    if (!c.geminiKey && (!c.geminiKeys || !c.geminiKeys.length)) out.push("GEMINI_API_KEY");
  } else if (c.provider === "groq") {
    if (!c.groqKey) out.push("GROQ_API_KEY");
  } else if (c.provider === "openai") {
    if (!c.openaiKey) out.push("OPENAI_API_KEY");
  } else if (c.provider === "anthropic") {
    if (!c.anthropicKey) out.push("ANTHROPIC_API_KEY");
  } else {
    out.push("AI_API_KEY");
  }

  if (c.strict) {
    if (!c.allowedOrigins.length) out.push("ALLOWED_ORIGINS");
    if (!c.redisUrl) out.push("UPSTASH_REDIS_REST_URL (or KV_REST_API_URL)");
    if (!c.redisToken) out.push("UPSTASH_REDIS_REST_TOKEN (or KV_REST_API_TOKEN)");
    if (c.salt.length < 16) out.push("RATE_LIMIT_SALT (16+ random characters)");
  }
  return out;
}

module.exports = { load, missing, DEFAULT_MODELS };
