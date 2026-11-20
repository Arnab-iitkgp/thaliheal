"use strict";
const { randomInt, timingSafeEqual } = require("node:crypto");
const { load } = require("../lib/config");
const { check } = require("../lib/ratelimit");
const { tools: sharedTools, companion, calendarContext } = require("../lib/zeno-agent");

const voices = new Set(["Zubenelgenubi", "Umbriel", "Algieba", "Algenib", "Achird", "Sadachbia", "Leda", "Aoede", "Sulafat"]);
const tools = [{ functionDeclarations: sharedTools.filter(tool => tool.function.name !== "plan_turn").map(({ function: definition }) => ({
  name: definition.name, description: definition.description, parametersJsonSchema: definition.parameters,
})) }];
tools[0].functionDeclarations.push({
  name: "apply_draft_preview",
  description: "Apply an existing editable draft preview only after the caller explicitly confirms that visible preview by saying Add it or equivalent. Use the proposal_id returned by edit_plate. This cannot save a meal. Never call edit_plate again just to confirm a preview.",
  parametersJsonSchema: { type: "object", properties: { proposal_id: { type: "string" } }, required: ["proposal_id"] },
});
let nextDemoProject = 0;

function matchesSecret(actual, expected) {
  if (!expected || typeof actual !== "string") return false;
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

module.exports = async function zenoLive(req, res) {
  const send = (status, body) => {
    res.statusCode = status;
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify(body));
  };
  const cfg = load();
  const hosted = Boolean(process.env.VERCEL || process.env.VERCEL_ENV || process.env.NODE_ENV === "production");
  const loopback = ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket?.remoteAddress);
  const url = new URL(req.url, "http://localhost");
  const origin = req.headers.origin || "";
  const host = req.headers.host || "";
  const localHost = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);
  const localOrigin = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  const previewOrigin = (process.env.ZENO_LIVE_DEMO_ORIGIN || "").trim();
  const preview = !hosted && loopback && !localHost && /^https:\/\/[a-z0-9.-]+(?::\d+)?$/.test(previewOrigin) &&
    previewOrigin === "https://" + host;
  const originMatches = hosted && origin.startsWith("https://") && (
    !cfg.allowedOrigins.length || cfg.allowedOrigins.includes(origin) || new URL(origin).host === host
  );
  const hostedAccess = hosted && originMatches && (!cfg.strict || matchesSecret(req.headers["x-thaliheal-tester"], cfg.testerToken));
  const privateAccess = hosted ? hostedAccess : (loopback && localHost);
  const personalKey = (process.env.ZENO_LIVE_PERSONAL_KEY || "").trim();
  const personal = Boolean((privateAccess || preview || hosted) && personalKey);
  const demoKeys = [...new Set(cfg.geminiKeys)].filter(key => key !== personalKey);
  const demo = Boolean((privateAccess || preview || hosted) && demoKeys.length);
  if (req.method === "GET") return send(200, { configured: demo || personal, demo, personal, testerRequired: false, localhostOnly: !hosted && !privateAccess && !preview, voices: [...voices] });
  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return send(405, { error: "method_not_allowed" });
  }
  req.resume();
  const mode = url.searchParams.get("mode") || "demo";
  if (!["demo", "personal"].includes(mode)) return send(400, { error: "bad_voice_mode" });
  if (preview && origin !== previewOrigin) return send(403, { error: "voice_access_denied" });
  if (!hosted && !preview && (!privateAccess || !localOrigin || new URL(origin).host !== host)) return send(403, { error: "voice_localhost_only" });
  if (mode === "demo" ? !demo : !personal) return send(503, { error: "voice_not_configured" });
  if (hosted && !hostedAccess) return send(403, { error: "voice_access_denied" });
  const voice = url.searchParams.get("voice");
  if (!voices.has(voice)) return send(400, { error: "bad_voice" });

  const model = process.env.ZENO_LIVE_MODEL || "gemini-3.8-live";
  const suppliedDate = url.searchParams.get("today") || "";
  const today = /^\d{4}-\d{2}-\d{2}$/.test(suppliedDate) ? suppliedDate : new Date().toISOString().slice(0, 10);
  const instructions = companion + `\nToday is ${today}. Stay in the same conversation and ask one useful question at a time. Call tools before claiming a log result or an edit. For edits, use the exact dish ID and source reference returned by the tools. "Take the curd off this draft" calls edit_plate with {source:"current",changes:[{op:"remove",dish:"curd"}],apply:true}. One roti is 1 piece. After the tool shows the requested result, acknowledge it and listen for the next turn. Use apply:false only for a hypothetical comparison. Call remember or forget for explicit lasting changes and tell the user to tap Confirm when the tool reports a pending change. Meals are saved after review in the app. ${mode === "demo" ? "This is a fictional workspace. Only discuss the fictional logs, draft and preferences. If personal details come up, remind the speaker to keep this session fictional." : "Use only the minimum relevant personal details."}`;
  const speechGrounding = " If garbled audio leaves the food or a stated quantity unclear, ask one short clarification in the last clearly understood language before editing. For example, ask whether they meant plain milk or coffee with milk. An omitted amount can use the default portion. Use the current draft when the caller asks to add to it. When a proposed meal card appears, say: Say add it and I’ll put it in your draft. Do not tell the caller to tap Add to draft. Only the separate Confirm save card requires a tap. After applying a draft, follow the confirmation tool’s guidance. The save card opens in place when the draft contains food. On the first such update, ask if they’d like to add anything else and mention that they can tap Confirm save when ready. On later updates, briefly acknowledge and wait. Do not ask them to say Confirm save. If the closest catalog entry assumes a different preparation, such as added sugar, confirm that with the caller. If an edit is rejected, ask about the specific missing detail or retry with a supported unit when the caller’s intended amount is clear.";
  const setup = {
    model: "models/" + model,
    generationConfig: {
      responseModalities: ["AUDIO"],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
    },
    inputAudioTranscription: {},
    outputAudioTranscription: {},
    systemInstruction: { parts: [{ text: instructions + speechGrounding + " For voice, apply_draft_preview confirms an existing preview. When the caller says Add it, call apply_draft_preview with the pending proposal ID. Do not recreate the preview or repeat the invitation. If the app already applied it, check read_context. Confirm save remains tap-only. Open every call in English, even if the previous conversation was in Hindi. Speak warmly and at an easy pace, like greeting someone you know. After the greeting, reply in English while the caller speaks English. Switch to natural Hindi when the caller speaks Hindi and mirror Hinglish when the caller mixes both languages. An isolated Hindi dish name in an English sentence does not change the language. Read profile facts with read_profile. For explicit profile changes call update_profile and say that the user needs to confirm in the app." + calendarContext(today) }] },
    tools,
  };
  try {
    const ip = hosted ? String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "unknown" : "loopback";
    const limit = await check({ ...cfg, namespace: "zeno-live", perMinute: 4, perDay: 24, globalPerDay: 80 }, ip, false);
    if (!limit.ok) {
      res.setHeader("Retry-After", limit.retryAfter);
      return send(429, { error: "voice_rate_limited" });
    }
    const key = mode === "personal" ? personalKey : demoKeys[hosted ? randomInt(demoKeys.length) : nextDemoProject++ % demoKeys.length];
    const now = Date.now();
    const upstream = await fetch("https://generativelanguage.googleapis.com/v1beta/auth_tokens", {
      method: "POST",
      headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(10000),
      body: JSON.stringify({
        uses: 1,
        newSessionExpireTime: new Date(now + 60000).toISOString(),
        expireTime: new Date(now + 600000).toISOString(),
        bidiGenerateContentSetup: setup,
      }),
    });
    if (!upstream.ok) return send(upstream.status === 429 ? 429 : 502, { error: "voice_provider_unavailable" });
    const token = (await upstream.json()).name;
    if (typeof token !== "string" || !token) return send(502, { error: "voice_provider_unavailable" });
    return send(200, { token, setup, maxSessionMs: 530000 });
  } catch {
    return send(503, { error: "voice_provider_unavailable" });
  }
};
