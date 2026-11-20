// Multi-provider AI facade for ThaliHeal.
// Dispatches requests to the appropriate modular provider adapter.
"use strict";

const { callGemini } = require("./providers/gemini");
const { callGroq, callOpenAI } = require("./providers/groq");
const { callAnthropic } = require("./providers/anthropic");

async function callModel(cfg, v, systemPrompt, signal) {
  const provider = (cfg.provider || "gemini").toLowerCase();
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

module.exports = { callModel };
