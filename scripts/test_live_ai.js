// Live API verification script for Gemini & Groq
// Run: node scripts/test_live_ai.js
"use strict";

const fs = require("fs");
const path = require("path");

// Load .env.local manually if not in process.env
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
    console.log("❌ GEMINI_API_KEY is not set in .env.local");
    return;
  }
  console.log("Found GEMINI_API_KEY:", key.slice(0, 6) + "..." + key.slice(-4));

  // 1. List available models on this key
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`;
    const r = await fetch(url);
    const data = await r.json();
    if (!r.ok) {
      console.log("❌ Gemini models.list failed:", data);
    } else {
      console.log("✅ Gemini API Key authenticated successfully!");
      const modelNames = (data.models || []).map((m) => m.name.replace("models/", ""));
      const flashModels = modelNames.filter((m) => m.includes("flash") || m.includes("lite"));
      console.log("Flash / Lite models available (" + flashModels.length + "):", flashModels.slice(0, 10));
    }
  } catch (err) {
    console.log("❌ Gemini listModels network error:", err.message);
  }

  // 2. Test actual call through our lib/providers/gemini.js adapter
  try {
    const modelToTest = process.env.AI_MODEL_DEFAULT || "gemini-3.5-flash-lite";
    console.log(`\nTesting generateContent via lib/providers/gemini.js with model: ${modelToTest}...`);

    // 1x1 transparent png
    const dummyPngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    const prompt = 'Identify the food in the photo. If none, reply {"context":"home","items":[],"note":"No food found"}.';

    const cfg = { geminiKey: key };
    const v = {
      model: modelToTest,
      prompt,
      images: [{ media_type: "image/png", data: dummyPngBase64 }],
      purpose: "scan",
      maxTokens: 500
    };

    const result = await callGemini(cfg, v, "You are a food recognition assistant for Indian meals. Output JSON.");

    if (result.ok) {
      console.log("✅ Gemini live call succeeded!");
      console.log("Model applied:", result.modelApplied);
      console.log("Tokens - In:", result.inTokens, "Out:", result.outTokens);
      console.log("Response text:\n", result.text);
    } else {
      console.log("❌ Gemini live call returned error:", result);
    }
  } catch (err) {
    console.log("❌ Gemini adapter test error:", err);
  }
}

async function checkGroq() {
  console.log("\n==================== TESTING GROQ LIVE ====================");
  const key = process.env.GROQ_API_KEY;
  if (!key || key.startsWith("YOUR_")) {
    console.log("❌ GROQ_API_KEY is not set in .env.local");
    return;
  }
  console.log("Found GROQ_API_KEY:", key.slice(0, 6) + "..." + key.slice(-4));

  // 1. List models on Groq
  let availableModels = [];
  try {
    const r = await fetch("https://api.groq.com/openai/v1/models", {
      headers: { Authorization: `Bearer ${key}` }
    });
    const data = await r.json();
    if (!r.ok) {
      console.log("❌ Groq models.list failed:", data);
    } else {
      console.log("✅ Groq API Key authenticated successfully!");
      availableModels = (data.data || []).map((m) => m.id);
      console.log("Available Groq models:", availableModels);
    }
  } catch (err) {
    console.log("❌ Groq listModels network error:", err.message);
  }

  // 2. Test actual call through lib/providers/groq.js
  try {
    // Pick an available model from Groq
    const modelToTest = availableModels.find(m => m.includes("vision") || m.includes("llama")) || "llama-3.3-70b-versatile";
    console.log(`\nTesting call via lib/providers/groq.js with model: ${modelToTest}...`);

    const cfg = { groqKey: key };
    const v = {
      model: modelToTest,
      prompt: 'Hello! Reply in one short sentence: {"status":"healthy"}',
      images: [], // text-only or vision if supported
      purpose: "assistant",
      maxTokens: 100
    };

    const result = await callGroq(cfg, v, "You are a nutrition assistant. Reply concisely.");

    if (result.ok) {
      console.log("✅ Groq live call succeeded!");
      console.log("Model applied:", result.modelApplied);
      console.log("Tokens - In:", result.inTokens, "Out:", result.outTokens);
      console.log("Response text:\n", result.text);
    } else {
      console.log("❌ Groq live call returned error:", result);
    }
  } catch (err) {
    console.log("❌ Groq adapter test error:", err);
  }
}

async function run() {
  await checkGemini();
  await checkGroq();
}

run();
