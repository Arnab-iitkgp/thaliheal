// Groq and OpenAI-compatible Chat Completions Provider
"use strict";

async function callOpenAICompatible(cfg, v, systemPrompt, signal, isGroq = false) {
  const defaultModel = isGroq ? "llama-3.2-11b-vision-preview" : "gpt-4o-mini";
  const model = v.model || defaultModel;
  const baseUrl = (cfg.openaiBaseUrl || (isGroq ? "https://api.groq.com/openai/v1" : "https://api.openai.com/v1")).replace(/\/$/, "");
  const url = `${baseUrl}/chat/completions`;
  const apiKey = isGroq ? (cfg.groqKey || cfg.openaiKey) : (cfg.openaiKey || cfg.groqKey);

  let userContent;
  if (v.images && v.images.length > 0) {
    userContent = [];
    for (const im of v.images) {
      userContent.push({
        type: "image_url",
        image_url: {
          url: `data:${im.media_type};base64,${im.data}`,
        },
      });
    }
    userContent.push({ type: "text", text: v.prompt });
  } else {
    userContent = v.prompt;
  }

  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userContent },
  ];

  const body = {
    model,
    messages,
    max_tokens: v.maxTokens,
    temperature: 0.2,
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal,
  });

  const out = await res.json().catch(() => ({}));
  if (!res.ok) {
    const errMsg = String((out && out.error && out.error.message) || "");
    let errorType = "upstream_error";
    if (res.status === 429) errorType = "busy";
    else if (res.status === 401 || res.status === 403 || /api_key|invalid api key/i.test(errMsg)) errorType = "key_rejected";
    else if (res.status === 400) errorType = "image_rejected";
    return { ok: false, status: res.status, errorType, rawError: out.error };
  }

  const choice = out.choices && out.choices[0];
  const text = (choice && choice.message && choice.message.content) || "";
  const inTokens = (out.usage && out.usage.prompt_tokens) || 0;
  const outTokens = (out.usage && out.usage.completion_tokens) || 0;
  const stopReason = (choice && choice.finish_reason) || "stop";

  return {
    ok: true,
    text,
    modelApplied: out.model || model,
    inTokens,
    outTokens,
    stopReason,
  };
}

module.exports = {
  callGroq: (cfg, v, systemPrompt, signal) => callOpenAICompatible(cfg, v, systemPrompt, signal, true),
  callOpenAI: (cfg, v, systemPrompt, signal) => callOpenAICompatible(cfg, v, systemPrompt, signal, false),
};

