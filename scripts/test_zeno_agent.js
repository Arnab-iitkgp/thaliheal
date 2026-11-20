/* Exercise the same endpoint and browser tools used by Zeno. Add --live to use Groq. */
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { Readable } = require("node:stream");
const handler = require("../api/zeno-agent");
const { messagesFrom } = require("../lib/zeno-agent");
const data = require("../public/data/dishes.json");
const disk = new Map();
const calls = [];
const live = process.argv.includes("--live");

if (live) require("./dev-server").loadEnv();
else {
  process.env.AI_ENABLED = "true";
  process.env.GROQ_API_KEY = "fixture";
  process.env.VERCEL = process.env.VERCEL_ENV = "";
  process.env.NODE_ENV = "test";
  process.env.UPSTASH_REDIS_REST_URL = process.env.KV_REST_API_URL = "";
  let sequence = 0;
  global.fetch = async (_, options) => {
    const { messages } = JSON.parse(options.body);
    const user = messages.findLast(message => message.role === "user").content;
    const previous = messages.findLast(message => message.tool_calls)?.tool_calls[0].function.name;
    const latest = messages.at(-1);
    let result;
    if (!previous) {
      const steps = user.startsWith("Use yesterday") ? ["find_meals", "edit_plate", "remember"]
        : user.startsWith("What if") ? ["edit_plate"] : user.startsWith("Quick reminder") ? ["read_memory"] : ["plan_plate"];
      result = ["plan_turn", { steps }];
    } else if (user.startsWith("Use yesterday")) {
      if (previous === "plan_turn") result = ["find_meals", { from: "2026-11-19", to: "2026-11-19", slot: "lunch" }];
      else if (previous === "find_meals") result = ["edit_plate", { source: JSON.parse(latest.content).meals[0].ref, apply: true, changes: [
        { op: "remove", dish: "curd" }, { op: "add", dish: "chapati", amount: 1, unit: "piece" },
      ] }];
      else if (previous === "edit_plate") result = ["remember", { kind: "preference", name: "Curd at the mess", value: "Leave curd off", scope: "mess lunches" }];
    } else if (previous === "plan_turn" && user.startsWith("What if")) {
      result = ["edit_plate", { source: "current", apply: false, changes: [{ op: "add", dish: "chapati", amount: 1 }] }];
    } else if (previous === "plan_turn" && user.startsWith("Quick reminder")) {
      result = ["read_memory", { query: "mess" }];
    } else if (previous === "plan_turn" && user.startsWith("The mess has")) {
      result = ["plan_plate", { menu: [{ dish: "rajma", price: 35 }, { dish: "plain_rice", price: 25 }, { dish: "chapati", price: 10 }], budget: 50, focus: "protein" }];
    }
    const message = result ? {
      tool_calls: [{ id: "fixture_" + ++sequence, type: "function", function: { name: result[0], arguments: JSON.stringify(result[1]) } }],
    } : { content: previous === "read_memory" ? JSON.parse(latest.content).memories[0].value : "Here’s what I found." };
    return { ok: true, json: async () => ({ choices: [{ message }] }) };
  };
}

async function browserFetch(url, options) {
  const req = Readable.from([Buffer.from(options.body)]);
  Object.assign(req, { method: "POST", url, headers: { origin: "http://localhost:3001", host: "localhost:3001" } });
  Object.defineProperty(req, "socket", { value: { remoteAddress: "127.0.0.1" } });
  const res = { setHeader() {}, end(content) { this.body = JSON.parse(content); } };
  await handler(req, res);
  for (const call of res.body.calls || []) calls.push(call.function.name);
  if (res.statusCode !== 200 && live) console.log("Agent API response:", res.statusCode, res.body.error);
  return { ok: res.statusCode === 200, status: res.statusCode, json: async () => res.body };
}

function boot() {
  const App = { views: {}, dishes: data.dishes, byId: Object.fromEntries(data.dishes.map(dish => [dish.id, dish])), meta: data.meta, fats: data.fats };
  const localStorage = { getItem: key => disk.get(key) ?? null, setItem: (key, value) => disk.set(key, value) };
  const env = vm.createContext({ App, window: { App }, localStorage, fetch: browserFetch, AbortController, setTimeout, clearTimeout });
  for (const file of ["utils", "nutrition", "safety", "account", "zeno-agent"]) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "public", "js", file + ".js"), "utf8"), env);
  }
  App.today = () => "2026-11-20";
  let draft, options, comparison, receipt, proposal;
  const ui = {
    current: () => draft,
    fromHistory: meal => meal.items.map(item => App.newItem(item.dishId, item.grams, { origin: "manual" })),
    usuals: () => App.Account.cache.doc?.zenoUsuals || [],
    memories: () => App.Account.cache.doc?.zenoMemories || [],
    draft(next) { draft = next; },
    compare(...args) { comparison = args; },
    options(next) { options = next; },
    receipt(text, undo) { receipt = { text, undo }; },
    noteTopic() { return true; },
    confirmMemory(name, args, confirm) {
      proposal = { name, args, confirm };
      return { ok: true, pending: true };
    },
  };
  const ask = message => App.ZenoAgent.run({ message, previous: [], ui, signal: new AbortController().signal });
  return { App, ask, current: () => draft, options: () => options, comparison: () => comparison, receipt: () => receipt, proposal: () => proposal };
}

(async () => {
  let app = boot();
  await app.App.Account.giveConsent({ assistant: false });
  const foods = [["rajma", 150], ["curd", 100], ["chapati", 76]].map(([id, grams]) => app.App.newItem(id, grams, { origin: "manual" }));
  await app.App.Account.saveMeal(app.App.mealFromItems(foods, { date: "2026-11-19", slot: "lunch", ctx: "home" }));
  const result = await app.ask("Use yesterday’s lunch as today’s draft, take the curd out and put an extra roti in. Tell me what changed. Going forward, leave the curd off my mess lunches.");
  if (live) console.log(calls.join(" → "), result);
  assert(calls.includes("find_meals") && calls.includes("edit_plate") && calls.includes("remember"), calls.join(", "));
  assert(app.current(), "edited draft");
  assert(!app.current().items.some(item => item.dishId === "curd"));
  assert.equal(app.current().items.find(item => item.dishId === "chapati").grams, 114);
  assert.equal((await app.App.Account.meals()).length, 1, "needs user confirmation to save");
  assert.equal(app.proposal()?.name, "remember");
  assert.equal((await app.App.Account.exportAll()).zeno_memories.length, 0, "memory proposal does not write before confirmation");
  assert.equal((await app.proposal().confirm()).ok, true);
  assert(app.receipt(), "memory receipt");
  await app.ask("What if I add one more roti to the draft? Just compare, keep the current plate.");
  assert(app.comparison(), "comparison card");
  assert.equal(app.current().items.find(item => item.dishId === "chapati").grams, 114);
  app = boot();
  await app.App.Account.getDoc();
  assert.match(JSON.stringify((await app.App.Account.exportAll()).zeno_memories), /curd/i);
  assert.match(await app.ask("Quick reminder, what was that thing I asked you to keep in mind at the mess?"), /curd/i);
  await app.ask("The mess has rajma for Rs 35, plain rice for Rs 25 and roti for Rs 10. Can you build an option for Rs 50 or less with the most protein?");
  assert(app.options()?.length, "budget planning card");
  assert(app.options().every(option => Number(option.price) <= 50));
  await app.App.Account.saveProfile({ diet: "vegetarian" });
  await app.App.Account.clearZenoMemory();
  app = boot();
  const data = await app.App.Account.exportAll();
  assert.equal(data.zeno_memories.length, 0);
  assert.equal(data.zeno_usuals.length, 0);
  assert.equal(data.profile.diet, "vegetarian");
  assert.equal(data.meals.length, 1);
  const [system] = messagesFrom({ today: "2026-11-20", messages: [{ role: "user", content: "Let's continue" }], summary: {
    topic: "Lunch from home", openQuestion: "How did packing lunch go?", transcript: "RAW_TRANSCRIPT_FIXTURE",
  } });
  assert.match(system.content, /App conversation summary.*Lunch from home.*How did packing lunch go/);
  assert.match(system.content, /friday 2026-11-20, saturday 2026-11-21, sunday 2026-11-22/);
  assert.doesNotMatch(system.content, /RAW_TRANSCRIPT_FIXTURE/);
  assert.equal(app.App.ZenoAgent.followUpDate({ due_weekday: "sunday", due: "2026-11-24" }), "2026-11-22");
  console.log("Passed the Zeno tool chain, what-if, reload recall, confirmation boundary, and menu budget.");
})().catch(error => { console.error(error.message); process.exitCode = 1; });
