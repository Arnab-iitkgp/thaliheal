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
    quick: "llama-3.2-11b-vision-preview",
    default: "llama-3.2-11b-vision-preview",
    complex: "llama-3.2-90b-vision-preview",
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

function detectProvider() {
  const explicit = (process.env.AI_PROVIDER || "").trim().toLowerCase();
  if (explicit) {
    if (explicit === "claude") return "anthropic";
    return explicit;
  }
  // Auto-detect based on configured key:
  if (process.env.GEMINI_API_KEY) return "gemini";
  if (process.env.GROQ_API_KEY) return "groq";
  if (process.env.OPENAI_API_KEY) return "openai";
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  return "gemini";
}

function load() {
  const env = process.env.VERCEL_ENV || "development";
  const provider = detectProvider();
  const defModels = DEFAULT_MODELS[provider] || DEFAULT_MODELS.gemini;

  return {
    env,
    // Production and preview deployments are public URLs, so both get the strict rules.
    strict: env === "production" || env === "preview",

    // Scan off mode: AI runs only when AI_ENABLED is exactly "true". Anything else (unset, "false", a typo)
    // keeps scanning and the assistant off, and then no other variable below is needed.
    aiEnabled: String(process.env.AI_ENABLED || "").trim().toLowerCase() === "true",

    provider,
    geminiKey: process.env.GEMINI_API_KEY || "",
    groqKey: process.env.GROQ_API_KEY || "",
    anthropicKey: process.env.ANTHROPIC_API_KEY || "",
    openaiKey: process.env.OPENAI_API_KEY || "",
    openaiBaseUrl: process.env.OPENAI_BASE_URL || (provider === "groq" ? "https://api.groq.com/openai/v1" : "https://api.openai.com/v1"),

    models: {
      quick: process.env.AI_MODEL_QUICK || defModels.quick,
      default: process.env.AI_MODEL_DEFAULT || defModels.default,
      complex: process.env.AI_MODEL_COMPLEX || defModels.complex,
    },

    allowedOrigins: list("ALLOWED_ORIGINS"),

    // Upstash Redis REST: the Vercel Marketplace integration sets KV_REST_API_*, a direct Upstash setup UPSTASH_REDIS_REST_*.
    redisUrl: process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || "",
    redisToken: process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || "",
    salt: process.env.RATE_LIMIT_SALT || "",

    perMinute: num("RATE_LIMIT_PER_MINUTE", 6),
    perDay: num("RATE_LIMIT_PER_DAY", 60),
    globalPerDay: num("GLOBAL_DAILY_LIMIT", 500),

    testerToken: process.env.TESTER_TOKEN || "",
    testerPerMinute: num("TESTER_PER_MINUTE", 30),
    testerPerDay: num("TESTER_PER_DAY", 400),

    maxBodyBytes: Math.min(num("MAX_BODY_BYTES", 2500000), 4400000),   // Vercel's own cap is 4.5 MB
    maxImageBytes: num("MAX_IMAGE_BYTES", 1800000),
    maxImages: num("MAX_IMAGES", 1),
    maxPromptChars: num("MAX_PROMPT_CHARS", 40000),
    maxOutputTokens: num("MAX_OUTPUT_TOKENS", 2000),
  };
}

// Names of required variables that are missing. Only checked when AI is on; the key is needed everywhere,
// the rest only on public deployments.
function missing(c) {
  const out = [];
  if (!c.aiEnabled) return out;

  if (c.provider === "gemini") {
    if (!c.geminiKey) out.push("GEMINI_API_KEY");
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

module.exports = { load, missing };
