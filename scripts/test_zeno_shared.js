/* Tests the shared tool runtime. Use --live to exercise a real Gemini audio session. */
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const data = require("../public/data/dishes.json");

async function checkRoutes() {
  const saved = { ...process.env };
  const originalFetch = global.fetch;
  const route = require("../api/zeno-live");
  const liveKeys = ["fixture-a", "fixture-b", "fixture-c", "fixture-d"];
  const selected = [];
  try {
    Object.assign(process.env, {
      NODE_ENV: "test", VERCEL: "", VERCEL_ENV: "", GEMINI_API_KEY: liveKeys[0],
      GEMINI_API_KEYS: liveKeys.slice(1).join(","), ZENO_LIVE_PERSONAL_KEY: "",
      ZENO_LIVE_DEMO_ORIGIN: "",
      UPSTASH_REDIS_REST_URL: "", KV_REST_API_URL: "",
    });
    for (let i = 2; i <= 10; i++) delete process.env["GEMINI_API_KEY_" + i];
    global.fetch = async (_, options) => {
      selected.push(options.headers["x-goog-api-key"]);
      return { ok: true, json: async () => ({ name: "auth_tokens/fixture" }) };
    };
    for (const mode of ["demo", "demo", "demo", "demo", "personal"]) {
      const request = { method: "POST", url: "/api/zeno-live?voice=Zubenelgenubi&mode=" + mode, headers: { origin: "http://localhost:3000", host: "localhost:3000" }, socket: { remoteAddress: "127.0.0.1" }, resume() {} };
      const response = { setHeader() {}, end() {} };
      await route(request, response);
      assert.equal(response.statusCode, mode === "demo" ? 200 : 503);
    }
    assert.deepEqual(selected, liveKeys);
    const external = {
      method: "POST", url: "/api/zeno-live?voice=Zubenelgenubi&mode=demo",
      headers: { origin: "https://public.example", host: "public.example" },
      socket: { remoteAddress: "127.0.0.1" }, resume() {},
    };
    const rejected = { setHeader() {}, end(body) { this.body = JSON.parse(body); } };
    await route(external, rejected);
    assert.equal(rejected.statusCode, 403);
    assert.equal(rejected.body.error, "voice_localhost_only");
    require("../lib/ratelimit").resetMem();
    process.env.ZENO_LIVE_DEMO_ORIGIN = external.headers.origin;
    const previewStatus = { ...rejected };
    await route({ ...external, method: "GET", headers: { host: external.headers.host } }, previewStatus);
    assert.equal(previewStatus.body.demo, true);
    assert.equal(previewStatus.body.personal, false);
    assert.equal(previewStatus.body.testerRequired, false);
    const previewStart = { ...rejected };
    await route(external, previewStart);
    assert.equal(previewStart.statusCode, 200);
    assert.equal(selected.at(-1), liveKeys[0]);
    await route({ ...external, url: external.url.replace("mode=demo", "mode=personal") }, rejected);
    assert.equal(rejected.statusCode, 503);
    await route({ ...external, headers: { ...external.headers, origin: "https://other.example" } }, rejected);
    assert.equal(rejected.statusCode, 403);
    assert.equal(selected.length, 5);
    process.env.ZENO_LIVE_PERSONAL_KEY = "fixture-personal";
    await route({ ...external, method: "GET" }, previewStatus);
    assert.equal(previewStatus.body.personal, true);
    const personalRequest = { ...external, url: external.url.replace("mode=demo", "mode=personal") };
    await route(personalRequest, previewStart);
    assert.equal(previewStart.statusCode, 200);
    assert.equal(selected.at(-1), "fixture-personal");
    process.env.ZENO_LIVE_PERSONAL_KEY = liveKeys[0];
    require("../lib/ratelimit").resetMem();
    for (let i = 0; i < 3; i++) {
      await route(external, previewStart);
      assert.equal(previewStart.statusCode, 200);
    }
    assert(!selected.slice(-3).includes(liveKeys[0]));
    process.env.AI_ENABLED = "true";
    process.env.GROQ_API_KEY = "fixture-groq";
    const textRoute = require("../api/zeno-agent");
    const textStatus = { ...rejected };
    await textRoute({ ...external, method: "GET" }, textStatus);
    assert.equal(textStatus.body.configured, true);
    assert.equal(textStatus.body.testerRequired, false);
    const requestText = body => ({
      ...external, async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify(body)); },
    });
    const personalTurn = { workspace: "personal", today: "2026-11-20", messages: [{ role: "user", content: "What to eat" }] };
    global.fetch = async url => {
      assert.equal(new URL(url).hostname, "api.groq.com");
      return { ok: true, json: async () => ({ choices: [{ message: { content: "What do you have on hand?" } }] }) };
    };
    await textRoute(requestText(personalTurn), textStatus);
    assert.equal(textStatus.statusCode, 200);
    assert.equal(textStatus.body.text, "What do you have on hand?");
    await textRoute({ ...requestText(personalTurn), headers: { ...external.headers, origin: "https://other.example" } }, rejected);
    assert.equal(rejected.statusCode, 403);
    const planModels = [];
    global.fetch = async url => {
      const model = new URL(url).pathname.split("/").at(-1).split(":")[0];
      planModels.push(model);
      return model === "gemini-3.5-flash-lite"
        ? { ok: false, status: 500, json: async () => ({ error: { message: "Test failure" } }) }
        : { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: '{"steps":["review_habits"]}' }] } }] }) };
    };
    const { planSampleTurn } = require("../lib/zeno-agent");
    const plan = await planSampleTurn({ geminiKeys: liveKeys }, [{ role: "user", content: "Review the sample week." }]);
    assert.deepEqual(planModels, ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite"]);
    assert.deepEqual(JSON.parse(plan.function.arguments).steps, ["review_habits"]);
    console.log("Routing: four demo projects, personal voice gate, and Flash-Lite planner fallback passed.");
  } finally {
    global.fetch = originalFetch;
    for (const name of Object.keys(process.env)) if (!(name in saved)) delete process.env[name];
    Object.assign(process.env, saved);
    require("../lib/ratelimit").resetMem();
  }
}

function fixture() {
  let draft, report;
  const App = {
    dishes: data.dishes, byId: Object.fromEntries(data.dishes.map(dish => [dish.id, dish])),
    meta: data.meta, fats: data.fats,
    Account: { getDoc() { throw Error("A sample tool accessed the real account."); } },
  };
  const localStorage = { getItem: () => null };
  const context = vm.createContext({ App, window: { App }, localStorage });
  for (const file of ["utils", "nutrition", "safety", "targets", "zeno-agent"]) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "public", "js", file + ".js"), "utf8"), context);
  }
  App.today = () => "2026-11-20";
  const sample = App.ZenoAgent.demoData();
  const ui = {
    current: () => draft,
    fromHistory: meal => meal.items.map(item => App.newItem(item.dishId, item.grams, { origin: "manual" })),
    usuals: () => sample.doc.zenoUsuals,
    memories: () => sample.doc.zenoMemories,
    draft(next) { draft = next; },
    compare() {}, options() {}, receipt() {}, review(next) { report = next; },
  };
  return { execute: App.ZenoAgent.toolSession(ui, sample), sample, current: () => draft, report: () => report };
}

async function checkTools() {
  const { execute, sample, current, report } = fixture();
  const summary = await execute("review_habits", { from: "2026-11-14", to: "2026-11-20" });
  assert.equal(summary.loggedDays, 4);
  assert.equal(summary.loggedDaysBySlot.breakfast, 1);
  assert.match(summary.note, /do not show/);
  const week = await execute("review_habits", { period: "last_week", view: "meals", compare_previous: true });
  assert.equal(week.from, "2026-11-09");
  assert.equal(week.to, "2026-11-15");
  assert.equal(week.daysInPeriod, 7);
  assert.equal(week.loggedDays, 1);
  assert.equal(week.totalLogged.proteinGrams, week.averageLoggedPerLoggedDay.proteinGrams);
  assert.equal(week.previous.to, "2026-11-08");
  assert.equal(week.previous.averageLoggedPerLoggedDay, null);
  assert.equal(report().meals.length, 2);
  assert.equal(week.cardShown, true);
  const filtered = await execute("review_habits", { period: "last_week", view: "meals", slot: "lunch" });
  assert.equal(filtered.loggedMeals, 1);
  assert.equal(report().meals[0].slot, "lunch");
  const meals = await execute("find_meals", { from: "2026-11-19", to: "2026-11-19", slot: "lunch" });
  assert.equal(meals.matches, 1);
  const edit = await execute("edit_plate", { source: meals.meals[0].ref, changes: [{ op: "add", dish: "chapati", amount: 1, unit: "piece" }], apply: true });
  assert(edit.ok);
  assert.equal(current().items.find(item => item.dishId === "chapati").grams, 114);
  await execute("edit_plate", { source: "current", changes: [{ op: "remove", dish: "curd" }], apply: true });
  assert(!current().items.some(item => item.dishId === "curd"));
  await execute("remember", { kind: "preference", name: "No curd", value: "Leave off curd", scope: "mess lunches" });
  assert.equal(sample.doc.zenoMemories[0].scope, "mess lunches");
  const secondMode = await execute("read_context", {});
  assert.equal(secondMode.draft.items.find(item => item.id === "chapati").grams, 114);
  assert.equal((await execute("find_food", { query: "दूध" })).dishes[0].id, "milk");
  const snack = await execute("edit_plate", { source: "empty", slot: "snack", apply: true, changes: [
    { op: "add", dish: "maggi", amount: 1, unit: "packet" }, { op: "add", dish: "milk", amount: 1, unit: "glass" },
  ] });
  assert.equal(snack.ok, true);
  assert.equal(snack.after.items.find(item => item.id === "instant_noodles").grams, 230);
  assert.equal(snack.after.items.find(item => item.id === "milk").grams, 250);
  const changeMilk = await execute("edit_plate", { source: "current", apply: true, changes: [{ op: "set", dish: "milk", amount: 1.5, unit: "glasses" }] });
  assert.equal(changeMilk.after.items.find(item => item.id === "milk").grams, 375);
  const unclearCoffee = await execute("edit_plate", { source: "current", apply: true, changes: [{ op: "add", dish: "coffee", amount: 1, unit: "glass" }] });
  assert.equal(unclearCoffee.ok, false);
  assert.match(unclearCoffee.error, /cup or grams/);
  assert.equal(current().items.length, 2);
  assert.equal((await execute("find_food", { query: "paneer" })).dishes[0].id, "paneer");
  assert.equal((await execute("find_food", { query: "matar paneer" })).dishes[0].id, "matar_paneer");
  const paneer = await execute("edit_plate", { source: "current", apply: true, changes: [{ op: "add", dish: "paneer" }] });
  assert.equal(paneer.after.items.find(item => item.id === "paneer").grams, 50);
  assert.match(paneer.notes[0], /estimated 50 g/);
  console.log("Shared tools: grounded log summary, reference lookup, sequential edits, and sample-only memory passed.");
}

async function checkHandoff() {
  const elements = new Map();
  class Element {
    constructor() { this.childNodes = []; this.nodes = new Map(); this.dataset = {}; this.value = ""; this.style = { setProperty() {} }; }
    get parentNode() { return this.parent; }
    append(...values) {
      for (const value of values) {
        if (value instanceof Element) { value.remove(); value.parent = this; }
        this.childNodes.push(value);
      }
    }
    replaceChildren(...values) { this.childNodes = []; this.append(...values); }
    remove() { if (this.parent) this.parent.childNodes = this.parent.childNodes.filter(node => node !== this); }
    replaceWith(node) {
      node.remove();
      this.parent.childNodes = this.parent.childNodes.map(child => child === this ? node : child);
      node.parent = this.parent;
      this.parent = null;
    }
    querySelector(key) { if (!this.nodes.has(key)) this.nodes.set(key, new Element()); return this.nodes.get(key); }
    querySelectorAll(key) { return key === "button" ? [new Element(), new Element()] : []; }
    addEventListener(name, run) { this[name] = run; }
    focus() {}
    scrollIntoView() {}
    setAttribute() {}
    showModal() { this.open = true; }
    close() { this.open = false; }
    pause() {}
  }
  const document = {
    createElement: () => new Element(),
    getElementById(id) { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); },
  };
  const App = {
    current: "zeno", views: {}, dishes: data.dishes, byId: Object.fromEntries(data.dishes.map(dish => [dish.id, dish])),
    meta: data.meta, fats: data.fats, Account: { cache: { doc: { zenoMemories: [{ name: "PRIVATE", value: "private fixture" }] } },
      onChange() {}, hasConsent: () => true, async getDoc() { return this.cache.doc; } },
  };
  const window = { App, addEventListener() {} };
  const storage = new Map();
  const context = vm.createContext({ App, window, document, setTimeout, clearTimeout, AbortController,
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) } });
  for (const file of ["utils", "nutrition", "safety", "targets", "zeno-agent"]) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "public", "js", file + ".js"), "utf8"), context);
  }
  let voice, continued, personalMessage;
  App.ZenoLive = {
    status: async () => ({ configured: true, demo: true, personal: true }),
    start(args) {
      voice = args;
      return { sendText: () => true, stop: () => args.state("closed", "Ended") };
    },
  };
  App.ZenoAgent.status = async () => ({ configured: true });
  App.ZenoAgent.run = async ({ previous, summary, message, ui, data: activeData, workspace }) => {
    if (workspace === "personal") {
      assert.equal(activeData, App.Account);
      personalMessage = message;
      return "What do you have on hand?";
    }
    assert.notEqual(activeData, App.Account);
    if (message === "Draft the usual lunch") {
      ui.draft({ items: activeData.doc.zenoUsuals[0].items.map(item => ({ ...item })), slot: "lunch" }, false);
    } else continued = { previous, summary, items: ui.current().items, memories: ui.memories() };
    return "Here’s your draft.";
  };
  const zenoSource = fs.readFileSync(path.join(__dirname, "..", "public", "js", "zeno.js"), "utf8");
  vm.runInContext(zenoSource, context);
  const $ = App.$;
  await App.views.zeno.show();
  assert.equal($("zenoConsent").open, true);
  assert.equal($("zenoVoiceStart").disabled, true);
  $("zenoVoiceStart").onclick();
  assert.equal(voice, undefined);
  $("zenoConsentDecline").onclick();
  await App.views.zeno.show();
  assert.equal($("zenoConsent").open, false);
  assert.equal($("zenoVoicePanel").hidden, true);
  $("zenoInput").value = "What to eat";
  await $("zenoComposer").submit({ preventDefault() {} });
  assert.equal(personalMessage, undefined);
  assert(!$("zenoConversation").childNodes.some(node => node.className === "zeno-card zeno-draft"));
  App.views.zeno.setAiConsent(null);
  await App.views.zeno.show();
  $("zenoConsentForm").submit({ preventDefault() {} });
  vm.runInContext(zenoSource, context);
  await App.views.zeno.show();
  assert.equal($("zenoConsent").open, false);
  assert.equal(App.views.zeno.hasAiConsent(), true);
  assert.equal($("zenoPersonalStart").hidden, false);
  assert.equal($("zenoVoiceStart").hidden, true);
  $("zenoInput").value = "What to eat";
  await $("zenoComposer").submit({ preventDefault() {} });
  assert.equal(personalMessage, "What to eat");
  assert($("zenoConversation").childNodes.at(-1).childNodes.includes("What do you have on hand?"));
  $("zenoWorkspace").value = "demo";
  $("zenoWorkspace").onchange();
  assert.equal($("zenoVoiceStart").disabled, false);
  assert.equal($("zenoVoiceStart").hidden, false);
  assert.equal($("zenoPersonalStart").hidden, true);
  $("zenoVoiceStart").onclick();
  assert.equal($("zenoCall").open, true);
  assert.equal($("zenoVoiceStatus").dataset.state, "connecting");
  voice.state("listening", "Listening");
  assert.equal($("zenoVoiceStatus").dataset.state, "listening");
  assert.equal(voice.voice, "Zubenelgenubi");
  assert.equal(voice.mode, "demo");
  assert.equal(voice.testerKey, "");
  voice.caption({ heard: "Did you add raita?", said: "I added it." });
  $("zenoVoiceEnd").onclick();
  assert($("zenoConversation").childNodes.at(-1).childNodes.some(node => node.textContent === "There is no open meal draft."));
  assert.equal($("zenoCall").open, false);
  $("zenoVoiceChoice").value = "Aoede";
  $("zenoVoiceChoice").onchange();
  assert.equal(App.store.get("thali.zenoVoice", ""), "Aoede");
  const type = async message => {
    $("zenoInput").value = message;
    await $("zenoComposer").submit({ preventDefault() {} });
  };
  await type("Draft the usual lunch");
  const card = () => $("zenoConversation").childNodes.find(node => node.className === "zeno-card zeno-draft");
  const original = card();
  $("zenoVoiceStart").onclick();
  assert.equal(voice.mode, "demo");
  assert.equal(voice.voice, "Aoede");
  voice.liveCaption("Three rotis now.");
  assert.equal($("zenoCallCaption").hidden, true);
  $("zenoCallCaptions").onclick();
  assert.equal($("zenoCallCaption").hidden, false);
  assert(voice.history().some(message => message.content === "Draft the usual lunch"));
  assert(!JSON.stringify(voice.history()).includes("PRIVATE"));
  const update = await voice.runTool("edit_plate", { source: "current", apply: true, changes: [{ op: "add", dish: "chapati", amount: 1, unit: "piece" }] }, new AbortController().signal);
  assert(update.ok);
  assert(update.pending);
  assert.match(update.message, /say Add it/i);
  assert.equal(card(), original);
  assert.equal($("zenoCallReview").hidden, false);
  assert.equal($("zenoCallReviewContent").childNodes[0].childNodes[0].textContent, "Proposed meal draft");
  const readVoiceDraft = () => voice.runTool("read_context", {}, new AbortController().signal);
  assert.equal((await readVoiceDraft()).draft.items.find(item => item.id === "chapati").grams, 76);
  await voice.caption({ heard: "Add it, please.", confirmationTarget: voice.confirmationTarget() });
  const replay = await voice.runTool("apply_draft_preview", { proposal_id: update.proposal_id }, new AbortController().signal);
  assert.equal(replay.applied, true);
  assert.equal(replay.save_confirmation_visible, true);
  assert.match(replay.message, /add anything else/);
  const automaticSaveCard = voice.confirmationTarget();
  assert.equal(automaticSaveCard.kind, "save");
  assert.equal($("zenoCallReviewContent").childNodes[0], automaticSaveCard.card);
  const secondReplay = await voice.runTool("apply_draft_preview", { proposal_id: update.proposal_id }, new AbortController().signal);
  assert.doesNotMatch(secondReplay.message, /add anything else/);
  assert.equal((await readVoiceDraft()).draft.items.find(item => item.id === "chapati").grams, 114);
  assert.equal(card(), original);
  $("zenoCallReviewContent").scrollHeight = 420;
  $("zenoCallReviewContent").clientHeight = 200;
  const pending = await voice.runTool("remember", { kind: "preference", name: "Less curd", value: "Leave curd off", scope: "mess lunches" }, new AbortController().signal);
  assert.equal(pending.pending, true);
  const confirmation = $("zenoCallReviewContent").childNodes[0];
  assert.equal(confirmation.childNodes[0].textContent, "Remember this?");
  assert.equal($("zenoCallReviewExpand").hidden, false);
  $("zenoCallReviewExpand").onclick();
  assert.equal($("zenoCallReview").dataset.expanded, "true");
  assert.equal($("zenoCallReviewExpand").textContent, "Show less");
  $("zenoCallReviewExpand").onclick();
  assert.equal($("zenoCallReview").dataset.expanded, "false");
  await confirmation.childNodes.find(node => node.textContent === "Confirm").onclick();
  const summary = await voice.runTool("note_conversation", { topic: "Mess lunches", decisions: ["Leave curd off"], openQuestion: "How many rotis?" }, new AbortController().signal);
  assert.equal(summary.ok, true);
  voice.caption({ heard: "Actually add a roti", said: "Three rotis now." });
  voice.caption({ said: "An unfinished reply from the previous call", partial: true });
  $("zenoVoiceEnd").onclick();
  await type("What changed?");
  assert.equal(continued.items.find(item => item.dishId === "chapati").grams, 114);
  assert(continued.previous.some(message => message.content === "Actually add a roti"));
  assert(!continued.previous.some(message => message.content.includes("unfinished reply")));
  assert.equal(continued.memories[0].scope, "mess lunches");
  assert.equal(continued.summary.openQuestion, "How many rotis?");
  $("zenoVoiceStart").onclick();
  assert.equal(voice.summary().topic, "Mess lunches");
  const tool = (name, args = {}) => voice.runTool(name, args, new AbortController().signal);
  await tool("edit_plate", {
    source: "empty", slot: "lunch", apply: true, changes: [{ op: "add", dish: "chicken_curry" }],
  });
  const previousPreview = voice.confirmationTarget();
  const replacement = await tool("edit_plate", { source: "current", apply: true, changes: [
    { op: "remove", dish: "chicken_curry" }, { op: "add", dish: "matar_paneer", amount: 1, unit: "katori" },
  ] });
  assert.equal(replacement.ok, true);
  assert.equal(replacement.pending, true);
  assert.equal((await tool("apply_draft_preview", { proposal_id: previousPreview.id })).ok, false);
  await voice.caption({ heard: "Add it", confirmationTarget: previousPreview });
  assert.equal((await tool("read_context")).proposedDraft.items[0].id, "matar_paneer");
  const actions = voice.confirmationTarget().card.childNodes.map(node => node.textContent);
  assert(actions.some(text => /Matar paneer/.test(text)));
  const messagesBeforeClarification = $("zenoConversation").childNodes.length;
  const invalidDrink = await tool("edit_plate", { source: "current", apply: true, changes: [{ op: "add", dish: "coffee", amount: 1, unit: "glass" }] });
  assert.equal(invalidDrink.ok, false);
  assert.equal($("zenoConversation").childNodes.length, messagesBeforeClarification);
  assert.equal((await tool("request_save")).ok, false);
  assert.equal((await tool("apply_draft_preview", { proposal_id: replacement.proposal_id })).applied, true);
  const inlineSave = voice.confirmationTarget();
  assert.equal(inlineSave.kind, "save");
  assert.equal((await tool("request_save")).pending, true);
  assert.equal(voice.confirmationTarget(), inlineSave);
  assert.equal((await tool("read_context")).draft.savedToLog, false);
  const save = voice.confirmationTarget();
  await voice.caption({ heard: "Confirm save", partial: true, confirmationTarget: save });
  assert.equal((await tool("read_context")).draft.savedToLog, false);
  await voice.caption({ heard: "Confirm save", confirmationTarget: save });
  assert.equal((await tool("read_context")).draft.savedToLog, false);
  assert.equal($("zenoCallReviewContent").childNodes[0], save.card);
  const confirmSave = save.card.childNodes.find(node => node.textContent === "Confirm save").onclick;
  await Promise.all([confirmSave(), confirmSave()]);
  await voice.caption({ heard: "Confirm save", confirmationTarget: save });
  assert.equal((await tool("read_context")).draft.savedToLog, true);
  const logged = await tool("find_meals", { from: App.today(), to: App.today(), slot: "lunch" });
  assert.equal(logged.meals.length, 1);
  assert.equal(logged.meals[0].items[0].id, "matar_paneer");
  assert.equal((await tool("request_save")).saved, true);
  const profile = await tool("read_profile", { fields: ["diet", "targets"] });
  assert.equal(profile.profile.diet, "vegetarian");
  assert.equal(Object.hasOwn(profile.profile, "weight"), false);
  assert(profile.targets.proteinGramsPerDay.high > 0);
  assert.equal((await tool("update_profile", { changes: { weight: -1 } })).ok, false);
  const proposal = await tool("update_profile", { changes: { diet: "vegan" } });
  assert.equal(proposal.pending, true);
  assert.equal((await tool("read_profile")).profile.diet, "vegetarian");
  const profileCard = $("zenoCallReviewContent").childNodes[0];
  await profileCard.childNodes.find(node => node.textContent === "Confirm profile update").onclick();
  assert.equal((await tool("read_profile")).profile.diet, "vegan");
  $("zenoVoiceEnd").onclick();
  $("zenoWorkspace").value = "personal";
  $("zenoWorkspace").onchange();
  assert.equal(card(), undefined);
  await $("zenoPersonalStart").onclick();
  assert.equal($("zenoConsent").open, false);
  assert.equal($("zenoCall").open, true);
  assert.equal(voice.mode, "personal");
  assert(!voice.history().some(message => message.content.includes("Actually add a roti")));
  $("zenoVoiceEnd").onclick();
  $("zenoManageData").onclick();
  $("zenoClearChat").onclick();
  assert.equal(App.Account.cache.doc.zenoMemories.length, 1);
  $("zenoWorkspace").value = "demo";
  $("zenoWorkspace").onchange();
  $("zenoManageData").onclick();
  await $("zenoClearMemory").onclick();
  assert.equal($("zenoClearStatus").textContent, "Sample data reset.");
  assert.equal(App.Account.cache.doc.zenoMemories.length, 1);
  App.views.zeno.setAiConsent(false);
  assert.equal($("zenoWorkspace").value, "personal");
  assert.equal($("zenoVoicePanel").hidden, true);
  console.log("UI handoff: text → voice tool → text preserved the draft, and sample mode never accessed the personal workspace.");
}

async function checkLive() {
  require("./dev-server").loadEnv();
  const request = { method: "POST", url: "/api/zeno-live?mode=demo&voice=Zubenelgenubi&today=2026-11-20", headers: { origin: "http://localhost:3000", host: "localhost:3000" }, socket: { remoteAddress: "127.0.0.1" }, resume() {} };
  const response = { setHeader() {}, end(body) { this.body = JSON.parse(body); } };
  await require("../api/zeno-live")(request, response);
  assert.equal(response.statusCode, 200, response.body.error);
  const { token, setup } = response.body;
  const socket = new WebSocket("wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained?access_token=" + encodeURIComponent(token));
  const { execute, current } = fixture();
  const prompts = [
    "What were my stats in the fictional log last calendar week, and how do they compare with the calendar week before?",
    "Mornings are usually rushed. Can you pull yesterday's lunch and add one roti for today? Keep the rest as it was.",
    "Actually, take the curd out of that same draft. Can you tell me what we ended up with?",
  ];
  const required = [["review_habits"], ["find_meals", "edit_plate"], ["edit_plate"]];
  const inputAudio = process.env.ZENO_TEST_RECORDING ? readPcm(process.env.ZENO_TEST_RECORDING) : null;
  let turn = 0, heardAudio = false, stream;
  let names = [];
  const send = message => socket.send(JSON.stringify(message));
  function next() {
    if (turn !== 2 || !inputAudio) return send({ realtimeInput: { text: prompts[turn] } });
    let offset = 0;
    stream = setInterval(() => {
      if (offset >= inputAudio.length) return clearInterval(stream);
      send({ realtimeInput: { audio: { mimeType: "audio/pcm;rate=16000", data: inputAudio.subarray(offset, offset + 2048).toString("base64") } } });
      offset += 2048;
    }, 64);
  }
  await new Promise((resolve, reject) => {
    let queue = Promise.resolve();
    const timer = setTimeout(() => finish(Error("Live multi-turn test timed out")), 60000);
    function finish(error) {
      clearTimeout(timer);
      clearInterval(stream);
      socket.onclose = socket.onerror = null;
      if (socket.readyState < 2) socket.close();
      if (error) reject(error);
      else resolve();
    }
    socket.onopen = () => send({ setup });
    socket.onerror = () => finish(Error("Live WebSocket failed"));
    socket.onclose = event => finish(Error("Live WebSocket closed early: " + event.code));
    socket.onmessage = ({ data: raw }) => {
      queue = queue.then(async () => {
        const message = JSON.parse(typeof raw === "string" ? raw : await raw.text());
        if (message.setupComplete) next();
        const calls = message.toolCall?.functionCalls;
        if (calls?.length) {
          const functionResponses = [];
          for (const call of calls) {
            const result = await execute(call.name, call.args || {});
            if (turn === 0 && call.name === "review_habits" && result.ok !== false) {
              assert.equal(result.from, "2026-11-09");
              assert.equal(result.to, "2026-11-15");
              assert.equal(result.previous?.to, "2026-11-08");
              assert.equal(result.cardShown, true);
            }
            if (process.env.ZENO_TEST_TRACE) console.log(call.name, JSON.stringify(call.args), JSON.stringify(result).slice(0, 400));
            if (result.ok !== false) names.push(call.name);
            functionResponses.push({ id: call.id, name: call.name, response: result });
          }
          send({ toolResponse: { functionResponses } });
        }
        const content = message.serverContent;
        if (content?.modelTurn?.parts?.some(part => part.inlineData?.mimeType?.startsWith("audio/pcm"))) heardAudio = true;
        if (content?.turnComplete && required[turn].every(name => names.includes(name)) && heardAudio) {
          console.log("Live turn", turn + 1, names.join(" → "), "and spoken audio", turn === 2 && inputAudio ? "from a spoken correction" : "");
          if (turn === 1) assert.equal(current().items.find(item => item.dishId === "chapati").grams, 114);
          if (turn === 2) {
            assert(!current().items.some(item => item.dishId === "curd"));
            return finish();
          }
          turn++;
          names = [];
          heardAudio = false;
          next();
        }
      }).catch(finish);
    };
  });
}

function readPcm(file) {
  const wave = fs.readFileSync(file);
  assert.equal(wave.toString("ascii", 8, 12), "WAVE");
  for (let offset = 12; offset + 8 <= wave.length;) {
    const size = wave.readUInt32LE(offset + 4);
    if (wave.toString("ascii", offset, offset + 4) === "data") {
      return Buffer.concat([Buffer.alloc(4800), wave.subarray(offset + 8, offset + 8 + size), Buffer.alloc(38400)]);
    }
    offset += 8 + size + (size % 2);
  }
  throw Error("Missing PCM audio");
}

(async () => {
  await checkRoutes();
  await checkTools();
  await checkHandoff();
  if (process.argv.includes("--live")) await checkLive();
})().catch(error => { console.error(error.message); process.exitCode = 1; });
