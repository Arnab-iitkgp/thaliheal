// Multi-provider AI facade for ThaliHeal with Automatic Cross-Provider Failover.
// Dispatches requests to the primary provider and seamlessly fails over to backup providers
// when rate limits or quotas are reached.
"use strict";

const { callGemini } = require("./providers/gemini");
const { callGroq, callOpenAI } = require("./providers/groq");
const { callAnthropic } = require("./providers/anthropic");

async function callProviderDirect(provider, cfg, v, systemPrompt, signal) {
  switch (provider) {
    case "gemini":
      return callGemini(cfg, v, systemPrompt, signal);
    case "groq":
      return callGroq(cfg, v, systemPrompt, signal);
    case "openai":
      return callOpenAI(cfg, v, systemPrompt, signal);
    case "anthropic":
    case "claude":
      return callAnthropic(cfg, v, systemPrompt, signal);
    default:
      return callGemini(cfg, v, systemPrompt, signal);
  }
}

async function callModel(cfg, v, systemPrompt, signal) {
  const primary = (cfg.provider || "gemini").toLowerCase();

  // 1. Attempt primary provider (which may have its own multi-key rotation)
  const res = await callProviderDirect(primary, cfg, v, systemPrompt, signal);
  if (res.ok) {
    res.providerApplied = primary;
    return res;
  }

  // 2. Check if failover is appropriate
  const canFallback = cfg.fallbackEnabled !== false && !signal.aborted;
  const isRecoverable = res.status === 429 || res.errorType === "busy" || res.errorType === "upstream_error" || res.errorType === "key_rejected";

  if (canFallback && isRecoverable) {
    // Fallback Scenario A: Gemini failed -> Fallback to Groq
    if (primary === "gemini" && cfg.groqKey) {
      console.warn(`ai: Primary provider (Gemini) failed (${res.errorType || res.status}), failing over to Groq (qwen/qwen3.8-27b)...`);
      const fallbackV = Object.assign({}, v, {
        model: v.images && v.images.length ? "qwen/qwen3.8-27b" : "qwen/qwen3.8-27b",
      });
      const groqRes = await callGroq(cfg, fallbackV, systemPrompt, signal);
      if (groqRes.ok) {
        groqRes.providerApplied = "groq (fallback)";
        return groqRes;
      }
      console.warn("ai: Groq fallback also failed:", groqRes.errorType || groqRes.status);
    }

    // Fallback Scenario B: Groq failed -> Fallback to Gemini
    else if (primary === "groq" && (cfg.geminiKey || (cfg.geminiKeys && cfg.geminiKeys.length))) {
      console.warn(`ai: Primary provider (Groq) failed (${res.errorType || res.status}), failing over to Gemini...`);
      const fallbackV = Object.assign({}, v, {
        model: "gemini-3.5-flash-lite",
      });
      const geminiRes = await callGemini(cfg, fallbackV, systemPrompt, signal);
      if (geminiRes.ok) {
        geminiRes.providerApplied = "gemini (fallback)";
        return geminiRes;
      }
      console.warn("ai: Gemini fallback also failed:", geminiRes.errorType || geminiRes.status);
    }
  }

  return res;
}

module.exports = { callModel };
