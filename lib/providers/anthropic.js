// Anthropic Claude Messages API Provider
"use strict";

async function callAnthropic(cfg, v, systemPrompt, signal) {
  const model = v.model || "claude-sonnet-5-5";
  const url = "https://api.anthropic.com/v1/messages";

  const content = v.images.map((im) => ({
    type: "image",
    source: { type: "base64", media_type: im.media_type, data: im.data },
  }));
  content.push({ type: "text", text: v.prompt });

  const res = await fetch(url, {
    method: "POST",
    signal,
    headers: {
      "x-api-key": cfg.anthropicKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: v.maxTokens,
      system: systemPrompt,
      messages: [{ role: "user", content }],
    }),
  });

  const out = await res.json().catch(() => ({}));
  if (!res.ok) {
    const why = String((out && out.error && out.error.message) || "");
    let errorType = "upstream_error";
    if (res.status === 429 || res.status === 529) errorType = "busy";
    else if (res.status === 400 && /credit balance/i.test(why)) errorType = "no_credit";
    else if (res.status === 401 || res.status === 403) errorType = "key_rejected";
    else if (res.status === 400) errorType = "image_rejected";
    return { ok: false, status: res.status, errorType, rawError: out.error };
  }

  const text = (out.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");
  const inTokens = (out.usage && out.usage.input_tokens) || 0;
  const outTokens = (out.usage && out.usage.output_tokens) || 0;

  return {
    ok: true,
    text,
    modelApplied: out.model || model,
    inTokens,
    outTokens,
    stopReason: out.stop_reason,
  };
}

module.exports = { callAnthropic };
