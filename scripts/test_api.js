// Checks api/ai.js without spending money: the AI APIs (Gemini, Groq, Claude) and Upstash are replaced by fakes.
//   node scripts/test_api.js
"use strict";
process.env.NODE_ENV = "test";
const assert = require("assert");

const realFetch = global.fetch;
const redis = new Map();
let claudeCalls = 0, lastClaudeBody = null;
let geminiCalls = 0, lastGeminiBody = null;
let groqCalls = 0, lastGroqBody = null;

global.fetch = async (url, opts = {}) => {
  url = String(url);
  if (url.startsWith("https://api.anthropic.com/")) {
    claudeCalls++; lastClaudeBody = JSON.parse(opts.body);
    if (opts.headers["x-api-key"] === "broke-key") return new Response(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits." } }), { status: 400 });
    if (opts.headers["x-api-key"] !== "test-key") return new Response(JSON.stringify({ error: { type: "authentication_error" } }), { status: 401 });
    return new Response(JSON.stringify({ model: lastClaudeBody.model, content: [{ type: "text", text: '{"context":"home","items":[]}' }], usage: { input_tokens: 10, output_tokens: 5 }, stop_reason: "end_turn" }), { status: 200 });
  }
  if (url.startsWith("https://generativelanguage.googleapis.com/")) {
    geminiCalls++; lastGeminiBody = JSON.parse(opts.body);
    if (url.includes("key=wrong-gemini-key")) {
      return new Response(JSON.stringify({ error: { code: 400, message: "API key not valid." } }), { status: 400 });
    }
    return new Response(JSON.stringify({
      candidates: [{
        content: { parts: [{ text: '{"context":"home","items":[{"dish_id":"dal_tadka","grams":150}]}' }], role: "model" },
        finishReason: "STOP"
      }],
      usageMetadata: { promptTokenCount: 15, candidatesTokenCount: 8 }
    }), { status: 200 });
  }
  if (url.startsWith("https://api.groq.com/")) {
    groqCalls++; lastGroqBody = JSON.parse(opts.body);
    if (opts.headers.Authorization === "Bearer wrong-groq-key") {
      return new Response(JSON.stringify({ error: { message: "Invalid API Key" } }), { status: 401 });
    }
    return new Response(JSON.stringify({
      model: lastGroqBody.model,
      choices: [{ message: { content: '{"context":"home","items":[{"dish_id":"roti","grams":76}]}', role: "assistant" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 18, completion_tokens: 10 }
    }), { status: 200 });
  }
  if (url.startsWith("https://fake-redis.upstash.io/pipeline")) {
    assert.strictEqual(opts.headers.Authorization, "Bearer redis-token");
    const out = JSON.parse(opts.body).map(([cmd, k]) => {
      if (cmd === "INCR") { redis.set(k, (redis.get(k) || 0) + 1); return { result: redis.get(k) }; }
      return { result: 1 };
    });
    return new Response(JSON.stringify(out), { status: 200 });
  }
  return realFetch(url, opts);
};

const rate = require("../lib/ratelimit");
const base = { AI_ENABLED: "true", ANTHROPIC_API_KEY: "test-key", RATE_LIMIT_PER_MINUTE: "6", RATE_LIMIT_PER_DAY: "60", GLOBAL_DAILY_LIMIT: "500", TESTER_TOKEN: "tester-secret-123" };
function setEnv(extra) {
  for (const k of Object.keys(process.env)) if (/^(AI_ENABLED|ANTHROPIC|GEMINI|GROQ|OPENAI|AI_PROVIDER|ALLOWED|UPSTASH|KV_|RATE_|GLOBAL|TESTER|MAX_|AI_MODEL|VERCEL_ENV)/.test(k)) delete process.env[k];
  Object.assign(process.env, base, extra);
  redis.clear();
  if (rate.resetMem) rate.resetMem();
}

(async () => {
  const { start } = require("./dev-server");
  const server = await start(0), port = server.address().port, U = `http://127.0.0.1:${port}/api/ai`;
  const post = (body, h = {}) => realFetch(U, { method: "POST", headers: { "Content-Type": "application/json", Origin: "https://thaliheal.vercel.app", ...h }, body: typeof body === "string" ? body : JSON.stringify(body) });
  const img = Buffer.alloc(2000, 7).toString("base64");
  const scan = { purpose: "scan", prompt: "List the dishes.", images: [{ media_type: "image/jpeg", data: img }], tier: "default" };
  let r, j, n = 0;
  const ok = (name) => { n++; console.log("ok", name); };

  // ---- production without settings: refuses to run ----
  setEnv({ VERCEL_ENV: "production" });
  j = await (await realFetch(U)).json();
  assert.strictEqual(j.configured, false); assert.strictEqual(j.missing, undefined); ok("production with missing settings reports not configured, hides names");
  r = await post(scan); assert.strictEqual(r.status, 503); ok("production POST without settings is refused (503)");

  // ---- production, fully set ----
  setEnv({ VERCEL_ENV: "production", ALLOWED_ORIGINS: "https://thaliheal.vercel.app", UPSTASH_REDIS_REST_URL: "https://fake-redis.upstash.io", UPSTASH_REDIS_REST_TOKEN: "redis-token", RATE_LIMIT_SALT: "0123456789abcdef0123" });
  j = await (await realFetch(U)).json(); assert.strictEqual(j.configured, true); ok("production configured");
  r = await post(scan, { Origin: "https://evil.example" }); assert.strictEqual(r.status, 403); ok("other site refused (403)");
  r = await realFetch(U, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(scan) }); assert.strictEqual(r.status, 403); ok("no Origin header refused (403)");
  const before = claudeCalls;
  r = await post(scan); j = await r.json();
  assert.strictEqual(r.status, 200); assert.strictEqual(j.modelApplied, "claude-sonnet-5-5"); ok("scan goes through, default model");
  assert.ok(lastClaudeBody.system.includes("ThaliHeal")); assert.strictEqual(lastClaudeBody.max_tokens, 2000); assert.strictEqual(lastClaudeBody.messages[0].content[0].type, "image"); ok("fixed system prompt, capped output, image block");
  assert.ok(![...redis.keys()].some((k) => k.includes("127.0.0.1"))); ok("rate limit keys hold a hash, not the IP");
  r = await post({ ...scan, tier: "complex" }); j = await r.json(); assert.strictEqual(j.modelApplied, "claude-sonnet-5-5"); assert.strictEqual(j.modelTierApplied, "default"); ok("strongest model refused without tester key");
  r = await post({ ...scan, purpose: "chat" }); assert.strictEqual(r.status, 400); ok("unknown purpose refused");
  for (let i = 0; i < 6; i++) r = await post(scan);
  assert.strictEqual(r.status, 429); assert.ok(Number(r.headers.get("retry-after")) > 0); ok("calls past the per minute limit get 429 with Retry-After");
  r = await post({ ...scan, purpose: "test", tier: "complex" }, { "X-ThaliHeal-Tester": "tester-secret-123" }); j = await r.json();
  assert.strictEqual(r.status, 200); assert.strictEqual(j.modelApplied, "claude-opus-5-5"); ok("tester key: own limits and the strongest model");
  r = await post({ ...scan, purpose: "test" }); assert.strictEqual(r.status, 429); ok("test purpose without key still limited");

  // ---- preview addresses with a wildcard ----
  setEnv({ VERCEL_ENV: "preview", ALLOWED_ORIGINS: "https://thaliheal.vercel.app,https://thaliheal-*.vercel.app", UPSTASH_REDIS_REST_URL: "https://fake-redis.upstash.io", UPSTASH_REDIS_REST_TOKEN: "redis-token", RATE_LIMIT_SALT: "0123456789abcdef0123" });
  r = await post(scan, { Origin: "https://thaliheal-git-main-atharva.vercel.app" }); assert.strictEqual(r.status, 200); ok("preview address matches the wildcard");
  r = await post(scan, { Origin: "https://thaliheal-x.vercel.app.evil.com" }); assert.strictEqual(r.status, 403); ok("look alike address refused");

  // ---- https only ----
  setEnv({ VERCEL_ENV: "production", ALLOWED_ORIGINS: "https://thaliheal.vercel.app,http://thaliheal.vercel.app", UPSTASH_REDIS_REST_URL: "https://fake-redis.upstash.io", UPSTASH_REDIS_REST_TOKEN: "redis-token", RATE_LIMIT_SALT: "0123456789abcdef0123" });
  r = await post(scan, { Origin: "http://thaliheal.vercel.app" }); assert.strictEqual(r.status, 403); ok("an http page is refused, even when listed");
  r = await realFetch(U, { method: "OPTIONS", headers: { Origin: "http://thaliheal.vercel.app", "Access-Control-Request-Method": "POST" } });
  assert.strictEqual(r.status, 403); ok("http preflight refused");
  r = await post(scan, { Origin: "https://thaliheal.vercel.app" }); assert.strictEqual(r.status, 200); ok("the https site is allowed");
  r = await realFetch(U, { headers: { Origin: "https://someone-else.example" } }); assert.strictEqual(r.headers.get("access-control-allow-origin"), "*"); ok("status check readable by anyone (no secrets)");

  // ---- size limits ----
  setEnv({ VERCEL_ENV: "production", ALLOWED_ORIGINS: "https://thaliheal.vercel.app", UPSTASH_REDIS_REST_URL: "https://fake-redis.upstash.io", UPSTASH_REDIS_REST_TOKEN: "redis-token", RATE_LIMIT_SALT: "0123456789abcdef0123", MAX_BODY_BYTES: "100000", MAX_IMAGE_BYTES: "50000", RATE_LIMIT_PER_MINUTE: "50" });
  const calls0 = claudeCalls;
  r = await post({ ...scan, images: [{ media_type: "image/jpeg", data: Buffer.alloc(120000).toString("base64") }] }); assert.strictEqual(r.status, 413); ok("body over MAX_BODY_BYTES refused (413)");
  r = await post({ ...scan, images: [{ media_type: "image/jpeg", data: Buffer.alloc(60000).toString("base64") }] }); assert.strictEqual(r.status, 400); assert.strictEqual((await r.json()).error, "image_too_large"); ok("photo over MAX_IMAGE_BYTES refused");
  r = await post({ ...scan, images: [scan.images[0], scan.images[0]] }); assert.strictEqual(r.status, 400); ok("two photos refused");
  r = await post({ purpose: "assistant", prompt: "x".repeat(40001) }); assert.strictEqual(r.status, 400); ok("prompt over MAX_PROMPT_CHARS refused");
  r = await post({ purpose: "assistant", prompt: "hi", images: scan.images }); assert.strictEqual(r.status, 400); ok("assistant with a photo refused");
  r = await post({ ...scan, images: [{ media_type: "application/pdf", data: img }] }); assert.strictEqual(r.status, 400); ok("non image media type refused");
  r = await post("{not json"); assert.strictEqual(r.status, 400); ok("bad JSON refused");
  assert.strictEqual(claudeCalls, calls0); ok("none of the refused requests reached Claude");
  r = await post({ purpose: "assistant", prompt: "How was my protein?" }); assert.strictEqual(r.status, 200); assert.strictEqual(lastClaudeBody.max_tokens, 700); ok("assistant call capped at 700 tokens");

  // ---- global daily cap ----
  setEnv({ VERCEL_ENV: "production", ALLOWED_ORIGINS: "https://thaliheal.vercel.app", UPSTASH_REDIS_REST_URL: "https://fake-redis.upstash.io", UPSTASH_REDIS_REST_TOKEN: "redis-token", RATE_LIMIT_SALT: "0123456789abcdef0123", GLOBAL_DAILY_LIMIT: "3", RATE_LIMIT_PER_MINUTE: "50" });
  for (let i = 0; i < 3; i++) await post(scan);
  r = await post(scan); j = await r.json(); assert.strictEqual(r.status, 429); assert.strictEqual(j.scope, "global"); ok("global daily cap stops everyone");

  // ---- wrong key: no details leak ----
  setEnv({ ANTHROPIC_API_KEY: "wrong" });
  r = await post(scan); j = await r.json(); assert.strictEqual(r.status, 503); assert.deepStrictEqual(j, { error: "key_rejected" }); ok("bad server key gives key_rejected and nothing else");

  // ---- local dev without Redis or origins still works ----
  setEnv({});
  j = await (await realFetch(U)).json(); assert.strictEqual(j.configured, true); ok("local dev runs with only the API key");
  setEnv({ ANTHROPIC_API_KEY: "broke-key" });
  r = await post(scan); j = await r.json(); assert.strictEqual(r.status, 503); assert.strictEqual(j.error, "no_credit"); ok("used up Claude credit gives no_credit, not a photo error");
  setEnv({ ANTHROPIC_API_KEY: "wrong-key" });
  r = await post(scan); j = await r.json(); assert.strictEqual(r.status, 503); assert.strictEqual(j.error, "key_rejected"); ok("a refused API key gives key_rejected");

  // ---- 🌟 Google Gemini Provider Tests ----
  setEnv({ AI_PROVIDER: "gemini", GEMINI_API_KEY: "test-gemini-key", ANTHROPIC_API_KEY: "" });
  j = await (await realFetch(U)).json();
  assert.strictEqual(j.provider, "gemini");
  assert.strictEqual(j.models.default, "gemini-3.5-flash-lite");
  assert.strictEqual(j.configured, true);
  ok("gemini provider configured with free default models");

  r = await post(scan);
  j = await r.json();
  assert.strictEqual(r.status, 200);
  assert.strictEqual(j.modelApplied, "gemini-3.5-flash-lite");
  assert.ok(lastGeminiBody.contents[0].parts.some((p) => p.inlineData && p.inlineData.mimeType === "image/jpeg"));
  assert.strictEqual(lastGeminiBody.generationConfig.responseMimeType, "application/json");
  ok("gemini scan runs successfully with inline image and JSON mode");

  setEnv({ AI_PROVIDER: "gemini", GEMINI_API_KEY: "wrong-gemini-key", ANTHROPIC_API_KEY: "" });
  r = await post(scan);
  j = await r.json();
  assert.strictEqual(r.status, 503);
  assert.strictEqual(j.error, "key_rejected");
  ok("gemini invalid key returns key_rejected");

  // ---- 🌟 Groq Provider Tests ----
  setEnv({ AI_PROVIDER: "groq", GROQ_API_KEY: "test-groq-key", ANTHROPIC_API_KEY: "" });
  j = await (await realFetch(U)).json();
  assert.strictEqual(j.provider, "groq");
  assert.strictEqual(j.models.default, "qwen/qwen3.8-27b");
  assert.strictEqual(j.configured, true);
  ok("groq provider configured with free Qwen vision models");

  r = await post(scan);
  j = await r.json();
  assert.strictEqual(r.status, 200);
  assert.strictEqual(j.modelApplied, "qwen/qwen3.8-27b");
  assert.ok(lastGroqBody.messages[1].content.some((c) => c.type === "image_url"));
  ok("groq scan runs successfully with OpenAI-compatible vision payload");

  setEnv({ AI_PROVIDER: "groq", GROQ_API_KEY: "wrong-groq-key", ANTHROPIC_API_KEY: "" });
  r = await post(scan);
  j = await r.json();
  assert.strictEqual(r.status, 503);
  assert.strictEqual(j.error, "key_rejected");
  ok("groq invalid key returns key_rejected");

  // ---- scan off mode: no AI variables at all, on a public deployment ----
  const offEnv = (extra) => { for (const k of Object.keys(process.env)) if (/^(AI_ENABLED|ANTHROPIC|GEMINI|GROQ|OPENAI|AI_PROVIDER|ALLOWED|UPSTASH|KV_|RATE_|GLOBAL|TESTER|MAX_|AI_MODEL|VERCEL_ENV)/.test(k)) delete process.env[k]; Object.assign(process.env, extra); redis.clear(); };
  for (const val of [undefined, "false", "TRUE ", "yes"]) {
    offEnv(Object.assign({ VERCEL_ENV: "production" }, val === undefined ? {} : { AI_ENABLED: val }));
    const want = val === "TRUE " ? "on" : "off";
    j = await (await realFetch(U)).json();
    if (want === "off") { assert.strictEqual(j.enabled, false); assert.strictEqual(j.code, "scanning_off"); }
    else { assert.strictEqual(j.enabled, true); assert.strictEqual(j.configured, false); }
    ok(`AI_ENABLED ${val === undefined ? "unset" : JSON.stringify(val)}: AI is ${want}`);
  }
  offEnv({ VERCEL_ENV: "production" });
  const calls1 = claudeCalls;
  r = await realFetch(U); j = await r.json();
  assert.strictEqual(r.status, 200); assert.ok(/off/.test(j.message)); assert.strictEqual(j.missing, undefined); ok("status check says scanning is off, with a message and no missing list");
  r = await post(scan); j = await r.json();
  assert.strictEqual(r.status, 200); assert.strictEqual(j.code, "scanning_off"); assert.strictEqual(r.headers.get("x-thaliheal-ai"), "off"); ok("a scan gets a clear scanning is off answer, not an error");
  r = await post({ purpose: "assistant", prompt: "How was my protein?" }, { Origin: "https://anywhere.example" }); j = await r.json();
  assert.strictEqual(r.status, 200); assert.strictEqual(j.code, "scanning_off"); ok("the assistant gets the same answer, from any page");
  r = await post("x".repeat(3000000)); assert.strictEqual(r.status, 200); ok("even a huge body is answered without being read");
  for (let i = 0; i < 20; i++) await post(scan);
  assert.strictEqual(claudeCalls, calls1); assert.strictEqual(redis.size, 0); ok("off mode never calls Claude or the rate limit store");
  r = await realFetch(U, { method: "DELETE" }); assert.strictEqual(r.status, 405); ok("other methods still refused");

  server.close();
  console.log(`\nall ${n} API checks pass`);
})().catch((e) => { console.error("FAIL", e); process.exit(1); });
