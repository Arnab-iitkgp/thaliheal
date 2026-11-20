// Test only: runs the dev server with a fake Claude API (no key, no cost).
const realFetch = global.fetch;
global.fetch = async (url, opts = {}) => {
  if (String(url).startsWith("https://api.anthropic.com/")) {
    console.log("claude request bytes", opts.body.length);
    const b = JSON.parse(opts.body), prompt = b.messages[0].content.find((c) => c.type === "text").text;
    const text = prompt.includes("DISH LIST")
      ? JSON.stringify({ context: "home", items: [{ dish_id: "chole", label: "Chole", grams: 160, grams_low: 130, grams_high: 200, unit: "katori", count: 1, confidence: 0.85 }, { dish_id: "plain_rice", label: "Rice", grams: 120, grams_low: 100, grams_high: 150, confidence: 0.8 }] })
      : JSON.stringify({ reply: "Over your last 7 full days your protein averaged about 42 g a day, inside your target.", basis: "last 7 days averages", refer: false });
    return new Response(JSON.stringify({ model: b.model, content: [{ type: "text", text }], usage: { input_tokens: 1, output_tokens: 1 } }), { status: 200 });
  }
  return realFetch(url, opts);
};
if (!("AI_ENABLED" in process.env)) process.env.AI_ENABLED = "true";   // tests run with AI on unless they say otherwise
if (process.env.AI_ENABLED === "true") process.env.ANTHROPIC_API_KEY = "fake";
// Logs the size of each AI request so the test can check phone photos stay under the limit.
const devServer = require("./dev-server.js");
const fs = require("fs");
const tls = process.argv[2] === "https" ? devServer.localCert() : null;   // the same self signed certificate as npm run dev:https
const port = Number(process.env.PORT) || 8790;
devServer.start(port, tls).then(() => console.log("fake dev on", port, tls ? "https" : "http"));
// When a test stops this server, put public/js/flags.js back to the default (scan off), so test runs never leave AI on.
process.on("SIGTERM", () => { delete process.env.AI_ENABLED; try { require("./build").build(); } catch (e) {} process.exit(0); });
