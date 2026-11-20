// POST /api/ai: talks to the AI provider (Google Gemini, Groq, Claude, or OpenAI).
// The API key stays securely on the server. The browser sends a prompt and
// at most one photo; this function checks where the request came from, how big it is and
// how often this person has asked, then calls the AI provider with a fixed system prompt.
// GET /api/ai: tells the page whether AI is on and set up, the provider and model limits.
// Scan off mode (AI_ENABLED is not "true"): both GET and POST answer 200 with { enabled: false, code: "scanning_off" }
// and a message, without reading the body, counting rate limits or calling the model.
"use strict";
const crypto = require("crypto");
const { load, missing } = require("../lib/config");
const { callModel } = require("../lib/ai-providers");
const { validate, MEDIA } = require("../lib/validator");
const rate = require("../lib/ratelimit");

const OFF = {
  enabled: false, configured: false, code: "scanning_off",
  message: "Photo scanning and the assistant are off on this site for now. Everything else works: sample dishes, adding dishes by hand, your log, targets and exports.",
};

const SYSTEM = [
  "You are the AI service behind ThaliHeal, an Indian food logging app for healthy adults.",
  "Only do two kinds of task: identify dishes and portions in a meal photo, or answer a question about the person's own food log using the data given.",
  "If the request is anything else, reply with exactly: {\"error\":\"out_of_scope\"}",
  "Never diagnose, never give supplement or medicine doses, and follow the output format the request asks for.",
].join(" ");

module.exports = async function handler(req, res) {
  const cfg = load();
  const t0 = Date.now();
  const send = (status, body, extra) => {
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    Object.entries(extra || {}).forEach(([k, v]) => res.setHeader(k, String(v)));
    res.end(JSON.stringify(body));
  };

  // ---- where the request came from ----
  const origin = req.headers.origin || "";
  const originOk = (!cfg.strict || /^https:\/\//.test(origin)) && (!cfg.allowedOrigins.length ? !cfg.strict : cfg.allowedOrigins.some((o) => originMatches(o, origin)));
  if (origin && originOk) { res.setHeader("Access-Control-Allow-Origin", origin); res.setHeader("Vary", "Origin"); }
  if (req.method === "OPTIONS") {
    if (!originOk) return send(403, { error: "origin_not_allowed" });
    res.setHeader("Access-Control-Allow-Methods", "GET, POST");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-ThaliHeal-Tester, ngrok-skip-browser-warning");
    res.statusCode = 204; return res.end();
  }

  // ---- scan off mode: a clear answer, never an error, and nothing else runs ----
  if (!cfg.aiEnabled) {
    if (!res.getHeader("Access-Control-Allow-Origin")) res.setHeader("Access-Control-Allow-Origin", "*");
    if (req.method !== "GET" && req.method !== "POST") return send(405, { error: "method_not_allowed" }, { Allow: "GET, POST, OPTIONS" });
    if (req.method === "POST" && typeof req.resume === "function") req.resume();   // drain whatever was sent, unread
    return send(200, OFF, { "X-ThaliHeal-AI": "off" });
  }

  const gaps = missing(cfg);
  if (req.method === "GET") {
    if (!res.getHeader("Access-Control-Allow-Origin")) res.setHeader("Access-Control-Allow-Origin", "*");
    return send(200, {
      enabled: true,
      configured: gaps.length === 0,
      provider: cfg.provider,
      keysCount: cfg.provider === "gemini" ? cfg.geminiKeys.length : 1,
      fallback: cfg.fallbackEnabled && !!(cfg.provider === "gemini" ? cfg.groqKey : cfg.geminiKey) ? (cfg.provider === "gemini" ? "groq" : "gemini") : null,
      models: cfg.models,
      missing: cfg.strict ? undefined : gaps,
      limits: { maxBodyBytes: cfg.maxBodyBytes, maxImageBytes: cfg.maxImageBytes, maxImages: cfg.maxImages, mediaTypes: MEDIA, maxPromptChars: cfg.maxPromptChars },
    });
  }
  if (req.method !== "POST") return send(405, { error: "method_not_allowed" }, { Allow: "GET, POST, OPTIONS" });
  if (gaps.length) { console.error("ai: not configured, missing", gaps.join(", ")); return send(503, { error: "not_configured" }); }
  if (cfg.strict && !originOk) return send(403, { error: "origin_not_allowed" });

  // ---- size, before reading anything ----
  const declared = Number(req.headers["content-length"] || 0);
  if (declared > cfg.maxBodyBytes) return send(413, { error: "too_large", maxBodyBytes: cfg.maxBodyBytes });
  if (!String(req.headers["content-type"] || "").includes("application/json")) return send(415, { error: "json_only" });

  // ---- rate limits (counted before the body is read, so spam costs nothing) ----
  const tester = isTester(req, cfg);
  const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.headers["x-real-ip"] || (req.socket && req.socket.remoteAddress) || "";
  let rl;
  try { rl = await rate.check(cfg, ip, tester); }
  catch (e) { console.error("ai: rate limit store failed"); return send(503, { error: "busy" }); }
  if (!rl.ok) return send(429, { error: "rate_limited", scope: rl.reason, retryAfter: rl.retryAfter }, { "Retry-After": rl.retryAfter });

  // ---- read and check the body ----
  let body;
  try { body = JSON.parse(await readBody(req, cfg.maxBodyBytes)); }
  catch (e) { return e && e.tooLarge ? send(413, { error: "too_large", maxBodyBytes: cfg.maxBodyBytes }) : send(400, { error: "bad_json" }); }
  const v = validate(body, cfg, tester);
  if (v.error) return send(400, { error: v.error });

  // ---- call model provider ----
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 55000);
  let result;
  try {
    result = await callModel(cfg, v, SYSTEM, ctl.signal);
  } catch (e) {
    return send(504, { error: "upstream_timeout" });
  } finally {
    clearTimeout(timer);
  }

  if (!result.ok) {
    console.error("ai:", cfg.provider, "error", result.status, result.errorType);
    if (result.errorType === "busy") return send(503, { error: "busy" });
    if (result.errorType === "no_credit") return send(503, { error: "no_credit" });
    if (result.errorType === "key_rejected") return send(503, { error: "key_rejected" });
    if (result.errorType === "image_rejected") return send(400, { error: "image_rejected" });
    return send(502, { error: "upstream_error" });
  }

  console.log("ai:", JSON.stringify({
    provider: cfg.provider,
    purpose: v.purpose,
    tier: v.tier,
    ms: Date.now() - t0,
    in: result.inTokens,
    out: result.outTokens,
  }));

  return send(200, {
    text: result.text,
    modelApplied: result.modelApplied,
    modelTierApplied: v.tier,
    stop: result.stopReason,
  }, { "X-RateLimit-Remaining-Day": rl.remainingDay });
};

module.exports.config = { maxDuration: 60 };

function originMatches(pattern, origin) {
  if (!origin) return false;
  if (!pattern.includes("*")) return pattern === origin;
  const re = new RegExp("^" + pattern.split("*").map((x) => x.replace(/[.+?^${}()|[\]\\/]/g, "\\$&")).join("[a-z0-9-]+") + "$");
  return re.test(origin);
}

function isTester(req, cfg) {
  const got = String(req.headers["x-thaliheal-tester"] || "");
  if (!cfg.testerToken || !got) return false;
  const a = Buffer.from(got), b = Buffer.from(cfg.testerToken);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function readBody(req, max) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > max) { reject({ tooLarge: true }); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}
