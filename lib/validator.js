// Request validation and limits check for /api/ai
"use strict";

const MEDIA = ["image/jpeg", "image/png", "image/webp"];
const PURPOSES = { scan: 2000, test: 2000, assistant: 700 };   // max output tokens per use

function validate(b, cfg, tester) {
  if (!b || typeof b !== "object") return { error: "bad_request" };
  const purpose = PURPOSES[b.purpose] ? b.purpose : null;
  if (!purpose) return { error: "bad_purpose" };
  if (purpose === "test" && !tester) return { error: "tester_only" };
  const prompt = typeof b.prompt === "string" ? b.prompt : "";
  if (!prompt.trim()) return { error: "empty_prompt" };
  if (prompt.length > cfg.maxPromptChars) return { error: "prompt_too_long" };

  const images = Array.isArray(b.images) ? b.images : [];
  if (purpose === "assistant" && images.length) return { error: "no_images_for_assistant" };
  if ((purpose === "scan" || purpose === "test") && images.length !== 1) return { error: "one_photo_needed" };
  if (images.length > cfg.maxImages) return { error: "too_many_images" };
  for (const im of images) {
    if (!im || !MEDIA.includes(im.media_type) || typeof im.data !== "string" || !/^[A-Za-z0-9+/=]+$/.test(im.data)) return { error: "bad_image" };
    if (Math.floor(im.data.length * 3 / 4) > cfg.maxImageBytes) return { error: "image_too_large" };
  }

  // The browser asks for a tier, never a model name. The strongest tier is for the tester only.
  let tier = ["quick", "default", "complex"].includes(b.tier) ? b.tier : "default";
  if (tier === "complex" && !tester) tier = "default";
  return { purpose, prompt, images, tier, model: cfg.models[tier], maxTokens: Math.min(PURPOSES[purpose], cfg.maxOutputTokens) };
}

module.exports = { validate, MEDIA, PURPOSES };
