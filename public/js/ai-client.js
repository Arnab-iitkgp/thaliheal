/* ai-client.js: AI prompt builder, JSON parser, and API communication adapter.
   Supports Gemini, Groq, Claude, and OpenAI via /api/ai.
   Part of the ThaliHeal modular frontend. */
window.App = window.App || {};

(function () {
  "use strict";

  App.PROMPT_VERSION = "scan-v2 (14 Nov 2026)";
  App.LIMIT_MS = { status: 10000, scan: 100000, test: 100000, assistant: 75000 };

  // ---------- Prompt Building ----------
  App.buildPrompt = function () {
    const lines = App.dishes
      .map(
        (d) =>
          `${d.id} | ${d.name}${d.aliases && d.aliases.length ? " (" + d.aliases.slice(0, 3).join(", ") + ")" : ""} | ${d.units.map((u) => u.name + "=" + u.g + "g").join(", ")}`
      )
      .join("\n");

    return `You are a food recognition assistant for Indian meals. Look at the attached photo of a plate or meal.

TASK
1. Identify every distinct food or drink that is visible. Count pieces (rotis, puris, idlis, pakoras) instead of estimating them as one blob.
2. Match each one to an id from the DISH LIST below. If nothing fits, set dish_id to null and describe it in label.
3. Estimate the edible weight in grams of each item as served (no bones, plate or packaging). Use these references: a dinner plate or thali is 26 to 28 cm across, a medium katori holds about 150 ml, a chapati is 15 to 18 cm across and weighs about 38 g, a serving ladle is about 60 g, a glass is about 250 ml.
4. Give grams_low and grams_high: a range you are about 80% sure contains the true weight.
5. Express the portion as a household measure using one of that dish's units from the list, with a count (for example 2 for two rotis, 1.5 for one and a half katori).
6. Judge visible oiliness for each item: low, normal or high (glossy gravy, oil pooling or a fried look means high).
7. Guess where the meal was cooked: home, restaurant or street.
8. confidence is how sure you are about the dish identity, from 0 to 1. Do not give any nutrition numbers.

DISH LIST (id | name (aliases) | units)
${lines}

Reply with only JSON in this exact shape:
{"context":"home","items":[{"dish_id":"dal_tadka","label":"yellow dal","grams":150,"grams_low":120,"grams_high":190,"unit":"katori","count":1,"oil":"normal","confidence":0.8}],"note":"one short sentence about anything uncertain"}
If the photo shows no food, reply {"context":"home","items":[],"note":"No food found"}.`;
  };

  // Read JSON out of a reply: whole text, a fenced block, or first { to last }.
  App.parseJSON = function (text) {
    const tries = [text];
    const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
    if (fence) tries.push(fence[1]);
    const a = text.indexOf("{"),
      b = text.lastIndexOf("}");
    if (a >= 0 && b > a) tries.push(text.slice(a, b + 1));
    for (const t of tries) {
      try {
        return JSON.parse(t);
      } catch (e) {}
    }
    throw { code: "invalid_json", message: "No JSON in reply", text };
  };

  // Ask model about one photo. Returns the parsed reply plus which model answered.
  App.askModel = async function (blob, opts = {}) {
    if (!App.claudeSample) throw { code: "sampling_disabled", message: "AI model is not available here" };
    const callOpts = { images: [blob], signal: opts.signal };
    if (opts.model) callOpts.model = opts.model;
    callOpts.modelTier = opts.modelTier || "default";
    if (opts.cache === false) callOpts.cache = false;
    const t0 = performance.now();
    const res = await App.claudeSample(App.buildPrompt(), callOpts);
    return {
      out: App.parseJSON(res.text),
      text: res.text,
      ms: Math.round(performance.now() - t0),
      modelApplied: res.modelApplied || null,
      modelTierApplied: res.modelTierApplied || null,
    };
  };

  // Turn a model reply into plate items, exactly as the scan screen shows them.
  App.itemsFromModel = function (out) {
    const ctx = out && ["home", "restaurant", "street"].includes(out.context) ? out.context : "home";
    const raw = Array.isArray(out && out.items) ? out.items.slice(0, 20) : [];
    const items = raw.map((x) => {
      x = x || {};
      let dish = typeof x.dish_id === "string" ? App.byId[x.dish_id] : null;
      let aiConf = App.clamp(Number(x.confidence) || 0.5, 0, 1);
      if (!dish && x.label) {
        dish = App.matchDish(x.label);
        if (dish) aiConf = Math.min(aiConf, 0.6);
      }
      let grams = App.clamp(Number(x.grams) || 0, 0, 1500);
      if (dish && !grams && x.count) {
        const u = dish.units.find((u) => u.name === x.unit) || dish.units[0];
        grams = u.g * Number(x.count);
      }
      if (dish && !grams) grams = dish.units[0].g;
      let spread = null;
      const lo = Number(x.grams_low),
        hi = Number(x.grams_high);
      if (grams > 0 && lo > 0 && hi >= lo) {
        spread = [App.clamp(lo / grams, 0.2, 1), App.clamp(hi / grams, 1, 4)];
      }
      return App.newItem(dish ? dish.id : null, grams, {
        origin: "ai",
        aiConf,
        label: String(x.label || "Unknown"),
        unit: x.unit,
        oil: x.oil,
        spread,
        ctx,
      });
    });
    return { ctx, items, note: out && typeof out.note === "string" ? out.note : "" };
  };

  // Client sample adapter for /api/ai proxy
  App.serverSample = async function () {
    let L = { maxBodyBytes: 2500000, maxImageBytes: 1800000, maxImages: 1, mediaTypes: ["image/jpeg", "image/png", "image/webp"] };
    const probe = async () => {
      try {
        const { r, body } = await App.fetchFor(
          App.apiUrl,
          { headers: { Accept: "application/json", "ngrok-skip-browser-warning": "true" }, cache: "no-store" },
          App.LIMIT_MS.status,
          App.readJSON(null)
        );
        App.net.set(false);
        const info = r.ok ? body : null;
        if (info && info.enabled === false) {
          App.setAI(false);
          return false;
        }
        if (info && info.enabled === true) App.setAI(true);
        if (info && info.limits) L = info.limits;
        if (info && info.provider) App.aiProvider = info.provider;
        if (info && info.models) App.aiModels = info.models;
        return !!(info && info.configured);
      } catch (e) {
        if (e && e.code === "timeout") return undefined;
        App.net.set(true);
        return null;
      }
    };

    const state = await probe();
    if (state === false) return null;
    if (state === null) {
      App.net.retry = async () => {
        const st = await probe();
        if (st === null) return;
        App.net.retry = null;
        if (st === false) App.claudeSample = null;
        Object.values(App.views).forEach((v) => v.onClaude && v.onClaude(!!App.claudeSample));
      };
      App.net.set(true);
    }

    const toB64 = (blob) =>
      new Promise((res, rej) => {
        const fr = new FileReader();
        fr.onload = () => res(String(fr.result).split(",")[1]);
        fr.onerror = rej;
        fr.readAsDataURL(blob);
      });

    const fn = async (prompt, o = {}) => {
      const images = [];
      for (const b of o.images || []) {
        images.push({ media_type: b.type || "image/jpeg", data: await toB64(b) });
      }
      const purpose = o.purpose || (images.length ? (App.testModeOn() && App.store.get("thali.testerToken", "") ? "test" : "scan") : "assistant");
      const body = JSON.stringify({ prompt, images, tier: o.modelTier || "default", purpose });
      if (body.length > L.maxBodyBytes) throw { code: "too_large" };
      const headers = { "Content-Type": "application/json", "ngrok-skip-browser-warning": "true" };
      const tok = App.store.get("thali.testerToken", "");
      if (tok) headers["X-ThaliHeal-Tester"] = tok;

      let res;
      try {
        res = await App.fetchFor(
          App.apiUrl,
          { method: "POST", headers, body, signal: o.signal },
          App.LIMIT_MS[purpose] || App.LIMIT_MS.scan,
          App.readJSON({})
        );
      } catch (e) {
        if (e && (e.code === "timeout" || e.code === "cancelled")) throw e;
        App.net.set(true);
        throw { code: "network" };
      }

      App.net.set(false);
      const r = res.r,
        out = res.body || {};
      if (out.code === "scanning_off") {
        App.setAI(false);
        throw { code: "scanning_off" };
      }
      if (!r.ok) {
        throw { code: out.error === "rate_limited" ? (out.scope === "minute" ? "rate_limited" : "rate_limited_day") : out.error || "server_error" };
      }
      if (/^\s*\{\s*"error"\s*:\s*"out_of_scope"/.test(out.text || "")) {
        throw { code: "refused" };
      }
      return { text: out.text, modelApplied: out.modelApplied, modelTierApplied: out.modelTierApplied };
    };

    fn.limits = async () => ({
      images: { maxCount: L.maxImages, maxInputBytes: L.maxImageBytes, mediaTypes: L.mediaTypes },
    });
    return fn;
  };
})();

