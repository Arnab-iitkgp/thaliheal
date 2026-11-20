"use strict";

const crypto = require("node:crypto");
const { load } = require("../lib/config");
const { check } = require("../lib/ratelimit");
const { callGroq } = require("../lib/providers/groq");
const { tools, messagesFrom, planning, planSampleTurn, conversationContext, calendarContext } = require("../lib/zeno-agent");

module.exports = async function zenoAgent(req, res) {
  const send = (status, body) => {
    res.statusCode = status;
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify(body));
  };
  const cfg = load();
  const hosted = Boolean(process.env.VERCEL || process.env.VERCEL_ENV || process.env.NODE_ENV === "production");
  const local = ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket?.remoteAddress);
  const host = req.headers.host || "";
  const localHost = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);
  const previewOrigin = (process.env.ZENO_LIVE_DEMO_ORIGIN || "").trim();
  const preview = !hosted && local && !localHost && /^https:\/\/[a-z0-9.-]+(?::\d+)?$/.test(previewOrigin) &&
    previewOrigin === "https://" + host;
  const origin = req.headers.origin || "";
  const auth = Buffer.from(String(req.headers["x-thaliheal-tester"] || ""));
  const expected = Buffer.from(cfg.testerToken);
  const originMatches = hosted && origin.startsWith("https://") && (
    !cfg.allowedOrigins.length || cfg.allowedOrigins.includes(origin) || new URL(origin).host === host
  );
  const hostedAllowed = hosted && originMatches && (!cfg.strict || (expected.length > 0 && auth.length === expected.length && crypto.timingSafeEqual(auth, expected)));
  const configured = Boolean(cfg.aiEnabled && cfg.groqKey && (hosted ? true : local && (localHost || preview)));
  if (req.method === "GET") return send(200, { configured, testerRequired: false });
  if (req.method !== "POST") return send(405, { error: "method_not_allowed" });
  const allowed = hosted
    ? hostedAllowed
    : preview ? origin === previewOrigin
      : /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin) && new URL(origin).host === host;
  if (!configured || !allowed) {
    req.resume();
    return send(configured ? 403 : 503, { error: configured ? "agent_access_denied" : "agent_not_configured" });
  }
  let body;
  try {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 32000) return send(413, { error: "turn_too_large" });
      chunks.push(chunk);
    }
    body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch { return send(400, { error: "bad_turn" }); }
  const messages = messagesFrom(body);
  if (!messages) return send(400, { error: "bad_turn" });
  try {
    const ip = hosted ? String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "unknown" : "loopback";
    const limit = await check({ ...cfg, namespace: preview ? "zeno-agent-preview" : "zeno-agent",
      perMinute: preview ? 20 : 36, perDay: preview ? 120 : 300, globalPerDay: preview ? 120 : 900 }, ip, false);
    if (!limit.ok) {
      res.setHeader("Retry-After", limit.retryAfter);
      return send(429, { error: "agent_rate_limited" });
    }
    const model = process.env.ZENO_TEXT_MODEL || "openai/gpt-oss-120b";
    const initial = !messages.some(message => message.role === "tool");
    if (initial && body.workspace === "demo") {
      const plan = await planSampleTurn(cfg, messages, body.summary);
      if (plan) return send(200, { text: "", calls: [plan] });
    }
    const controls = {
      messages: initial ? [{ role: "system", content: planning + " Call only plan_turn with the steps. Never call a named step directly in this planning turn." + calendarContext(body.today) + conversationContext(body.summary) }, ...messages.slice(1)] : messages,
      tools: initial ? tools.filter(tool => tool.function.name === "plan_turn") : tools.filter(tool => tool.function.name !== "plan_turn"),
      model, maxTokens: initial ? 300 : 800,
      toolChoice: initial ? { type: "function", function: { name: "plan_turn" } } : "auto",
      reasoningEffort: model.startsWith("openai/gpt-oss-") ? "low" : undefined,
    };
    const signal = AbortSignal.timeout(14000);
    let result = await callGroq(cfg, controls, "", signal);
    if (result.status === 429 && !process.env.ZENO_TEXT_MODEL) {
      result = await callGroq(cfg, { ...controls, model: "openai/gpt-oss-20b" }, "", signal);
    }
    if (!result.ok) {
      if (result.status === 429) return send(429, { error: "agent_provider_rate_limited", retryAfter: Number(result.retryAfter) || 15 });
      return send(502, { error: "agent_provider_unavailable" });
    }
    return send(200, { text: result.text.slice(0, 1200), calls: result.toolCalls || [] });
  } catch { return send(503, { error: "agent_provider_unavailable" }); }
};
