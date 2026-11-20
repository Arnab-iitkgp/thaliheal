// Google Gemini Generative Language API Provider with Multi-Key Rotation
"use strict";

let currentKeyIndex = 0;

async function callGeminiSingleKey(key, model, v, systemPrompt, signal) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;

  const parts = [];
  for (const im of v.images) {
    parts.push({
      inlineData: {
        mimeType: im.media_type,
        data: im.data,
      },
    });
  }
  parts.push({ text: v.prompt });

  const body = {
    systemInstruction: {
      parts: [{ text: systemPrompt }],
    },
    contents: [
      {
        role: "user",
        parts,
      },
    ],
    generationConfig: {
      maxOutputTokens: v.maxTokens,
      temperature: 0.2,
    },
  };

  if (v.json || v.purpose === "scan" || v.purpose === "test") {
    body.generationConfig.responseMimeType = "application/json";
  }

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });

  const out = await res.json().catch(() => ({}));
  if (!res.ok) {
    const errMsg = String((out && out.error && out.error.message) || "");
    let errorType = "upstream_error";
    if (res.status === 429) errorType = "busy";
    else if (res.status === 400 && /API key|invalid/i.test(errMsg)) errorType = "key_rejected";
    else if (res.status === 401 || res.status === 403) errorType = "key_rejected";
    else if (res.status === 400) errorType = "image_rejected";
    return { ok: false, status: res.status, errorType, rawError: out.error };
  }

  const candidate = out.candidates && out.candidates[0];
  const text = candidate && candidate.content && candidate.content.parts
    ? candidate.content.parts.map((p) => p.text || "").join("")
    : "";

  if (!text && candidate && candidate.finishReason === "SAFETY") {
    return { ok: false, status: 400, errorType: "image_rejected", rawError: "safety" };
  }

  const inTokens = (out.usageMetadata && out.usageMetadata.promptTokenCount) || 0;
  const outTokens = (out.usageMetadata && out.usageMetadata.candidatesTokenCount) || 0;
  const stopReason = (candidate && candidate.finishReason) || "STOP";

  return {
    ok: true,
    text,
    modelApplied: model,
    inTokens,
    outTokens,
    stopReason,
  };
}

async function callGemini(cfg, v, systemPrompt, signal) {
  const model = v.model || "gemini-3.5-flash-lite";
  const keys = cfg.geminiKeys && cfg.geminiKeys.length ? cfg.geminiKeys : [cfg.geminiKey].filter(Boolean);
  if (!keys.length) {
    return { ok: false, status: 503, errorType: "not_configured" };
  }

  let lastResult = null;
  const startIndex = currentKeyIndex;

  for (let i = 0; i < keys.length; i++) {
    const key = keys[(startIndex + i) % keys.length];
    currentKeyIndex = (startIndex + i + 1) % keys.length;

    const res = await callGeminiSingleKey(key, model, v, systemPrompt, signal);
    if (res.ok) {
      res.keyIndex = (startIndex + i) % keys.length;
      return res;
    }

    lastResult = res;

    // If rate-limited (429 or quota limit) or key is rejected, try the next key in the pool
    if (res.status === 429 || res.errorType === "busy") {
      console.warn(`ai: gemini key #${((startIndex + i) % keys.length) + 1} hit rate limit / quota, rotating to next key...`);
      continue;
    }

    if (res.errorType === "key_rejected" && keys.length > 1) {
      console.warn(`ai: gemini key #${((startIndex + i) % keys.length) + 1} was rejected, trying next key...`);
      continue;
    }

    // Fatal error (bad image payload, client abort), break immediately
    break;
  }

  return lastResult;
}

module.exports = { callGemini };
