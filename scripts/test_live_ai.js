// Live API verification script for Gemini & Groq using keys from .env.local
// Run: node scripts/test_live_ai.js
"use strict";

const fs = require("fs");
const path = require("path");

// Load .env.local
const envPath = path.join(__dirname, "..", ".env.local");
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq > 0) {
      const k = trimmed.slice(0, eq).trim();
      const v = trimmed.slice(eq + 1).trim();
      if (!process.env[k]) process.env[k] = v;
    }
  }
}

const { callGemini } = require("../lib/providers/gemini.js");
const { callGroq } = require("../lib/providers/groq.js");

async function checkGemini() {
  console.log("\n=================== TESTING GEMINI LIVE ===================");
  const key = process.env.GEMINI_API_KEY;
  if (!key || key.startsWith("YOUR_")) {
    console.log("ℹ️ GEMINI_API_KEY is not set in .env.local");
    return;
  }
  console.log("Found GEMINI_API_KEY:", key.slice(0, 6) + "..." + key.slice(-4));

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`;
    const r = await fetch(url);
    const data = await r.json();
    if (!r.ok) {
      console.log("❌ Gemini auth failed:", data);
      return;
    }
    console.log("✅ Gemini API Key authenticated successfully!");

    // Test a real meal scan using a sample dish
    const sampleImgPath = path.join(__dirname, "../public/img/samples/s01.jpg");
    const imgBase64 = fs.existsSync(sampleImgPath)
      ? fs.readFileSync(sampleImgPath).toString("base64")
      : "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

    const model = process.env.AI_MODEL_DEFAULT || "gemini-3.5-flash-lite";
    console.log(`Sending live meal photo scan to ${model}...`);
    const t0 = Date.now();

    const res = await callGemini(
      { geminiKey: key },
      {
        model,
        prompt: 'Identify the food in the photo. Reply with JSON: {"context":"home","items":[{"dish_id":"veg_biryani","label":"Veg Biryani","grams":300,"grams_low":250,"grams_high":350,"unit":"plate","count":1,"oil":"normal","confidence":0.9}],"note":"sample"}',
        images: [{ media_type: "image/jpeg", data: imgBase64 }],
        purpose: "scan",
        maxTokens: 500,
      },
      "You are a food recognition assistant for Indian meals. Output valid JSON."
    );

    if (res.ok) {
      console.log(`✅ Gemini live meal scan succeeded in ${Date.now() - t0}ms!`);
      console.log("Model:", res.modelApplied, `(Tokens: In ${res.inTokens}, Out ${res.outTokens})`);
      console.log("Output:\n", res.text.trim());
    } else {
      console.log("❌ Gemini call failed:", res);
    }
  } catch (err) {
    console.log("❌ Gemini error:", err.message);
  }
}

async function checkGroq() {
  console.log("\n==================== TESTING GROQ LIVE ====================");
  const key = process.env.GROQ_API_KEY;
  if (!key || key.startsWith("YOUR_")) {
    console.log("ℹ️ GROQ_API_KEY is not set in .env.local");
    return;
  }
  console.log("Found GROQ_API_KEY:", key.slice(0, 6) + "..." + key.slice(-4));

  try {
    const r = await fetch("https://api.groq.com/openai/v1/models", {
      headers: { Authorization: `Bearer ${key}` },
    });
    const data = await r.json();
    if (!r.ok) {
      console.log("❌ Groq auth failed:", data);
      return;
    }
    console.log("✅ Groq API Key authenticated successfully!");

    const model = "qwen/qwen3.8-27b";
    console.log(`Sending live meal photo scan to Groq vision model (${model})...`);
    const sampleImgPath = path.join(__dirname, "../public/img/samples/s01.jpg");
    const imgBase64 = fs.existsSync(sampleImgPath) ? fs.readFileSync(sampleImgPath).toString("base64") : "";

    const t0 = Date.now();
    const res = await callGroq(
      { groqKey: key },
      {
        model,
        prompt: 'Identify the food in the photo. Reply with JSON: {"dish":"name"}',
        images: imgBase64 ? [{ media_type: "image/jpeg", data: imgBase64 }] : [],
        purpose: "scan",
        maxTokens: 100,
      },
      "You are a food recognition assistant for Indian meals."
    );

    if (res.ok) {
      console.log(`✅ Groq live call succeeded in ${Date.now() - t0}ms!`);
      console.log("Model:", res.modelApplied, `(Tokens: In ${res.inTokens}, Out ${res.outTokens})`);
      console.log("Output:\n", res.text.trim());
    } else {
      console.log("❌ Groq call failed:", res);
    }
  } catch (err) {
    console.log("❌ Groq error:", err.message);
  }
}

async function main() {
  await checkGemini();
  await checkGroq();
}

main();
