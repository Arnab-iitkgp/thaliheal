/* ml-data.js: the data side of the Food Map and the healthier swaps.

   Reads, never writes, the app's own data:
     App.dishes and App.fats   the food table (loaded by core.js)
     App.Account.meals()       the meal log, to count what this person ate
     App.Account.getDoc()      the profile, for the diet type
   Keeps its own data under one separate key, thali.ml.newDishes.v1: nutrient estimates for
   dishes that a scan found but the food table does not have. Only the dish name is ever sent
   to the AI, nothing about the person.

   New dishes join the model like this:
     1. A scanned dish has no table id (the scan prompt only names it).
     2. The AI is asked, once, for its nutrients per 100 g (same /api/ai route and limits
        as the assistant). The answer is checked for sensible numbers before it is used.
     3. If AI is off or cannot answer, the closest table dish by name is used instead and
        marked as a name match. If nothing matches, it waits until AI is available.
     4. The dish is placed with the same scaler and PCA as the table dishes, and K-Means
        re-runs with it included.

   An AI estimate also becomes a dish the rest of the app can count (id "ai_<name>", kept in
   App.byId only, never in App.dishes, so the scan prompt and the dish picker stay as they
   were). scan.js calls fillUnknown() after a scan, so the meal is saved with the estimated
   calories and nutrients, marked "AI estimate" in its confidence note. Name matches are
   used on the map only: a loose name match is not good enough for a meal's numbers. */
(function () {
  "use strict";
  const STORE_KEY = "thali.ml.newDishes.v1";
  const MAX_AI_PER_VISIT = 12;     // a cap per page load, to protect the daily AI limit
  const MAX_TRIES = 3;
  const SKIP = new Set(["", "unknown", "unknown dish", "dish", "food", "item", "other"]);

  const M = () => App.MLCore;
  let base = null;                 // table dishes with scaler and PCA, built once
  const clusterCache = {};
  let scanCache = null;
  let aiUsed = 0;
  const working = {};              // keys being estimated right now
  const listeners = [];

  const keyOfLabel = (label) => "n:" + App.norm(label);
  const titleCase = (s) => String(s || "").replace(/\s+/g, " ").trim().replace(/\b[a-z]/g, (c) => c.toUpperCase());
  const hideKcal = () => App.store.get("thali.hideNumbers", false) === true;

  function emit() {
    scanCache = null;
    Object.keys(clusterCache).forEach((k) => delete clusterCache[k]);
    listeners.forEach((fn) => { try { fn(); } catch (e) { console.error(e); } });
  }

  // ---------- the food table as model input ----------
  function buildBase() {
    if (base) return base;
    if (!App.dishes || !App.dishes.length || !M()) return null;
    const items = App.dishes.map((d) => {
      const nut = M().asEaten(d, App.fats, "home");
      return { key: "t:" + d.id, id: d.id, name: d.name, category: d.category, role: M().roleOf(d), tags: M().tagsOf(d), nut, x: M().toFeatures(nut), source: "table" };
    });
    const scaler = M().fitScaler(items.map((i) => i.x));
    items.forEach((i) => (i.z = M().scale(scaler, i.x)));
    const pca = M().pca(items.map((i) => i.z), 2);
    items.forEach((i) => (i.xy = M().project(pca, i.z)));
    base = { items, scaler, pca, byKey: Object.fromEntries(items.map((i) => [i.key, i])) };
    return base;
  }

  // ---------- new dishes (own storage) ----------
  const store = () => App.store.get(STORE_KEY, {}) || {};
  const saveStore = (s) => App.store.set(STORE_KEY, s);

  function itemFromEntry(e) {
    const b = buildBase();
    if (!b || !e || !e.nut || (e.status !== "ai" && e.status !== "name")) return null;
    const x = M().toFeatures(e.nut), z = M().scale(b.scaler, x);
    return {
      key: e.key, id: null, name: e.name || titleCase(e.label), label: e.label, category: M().ROLES[e.role] || "",
      role: e.role, tags: e.tags, nut: e.nut, x, z, xy: M().project(b.pca, z),
      source: e.status, matchedName: e.matchedName || null,
    };
  }

  // A label that is really a table dish (same name or alias) needs no AI.
  function tableIdForLabel(label) {
    const n = App.norm(label);
    const d = App.dishes.find((x) => App.norm(x.name) === n || (x.aliases || []).some((a) => App.norm(a) === n));
    return d ? d.id : null;
  }

  function aiReady() {
    return !!(App.aiEnabled && typeof App.claudeSample === "function" && navigator.onLine !== false);
  }

  async function askAI(label) {
    const safe = String(label).replace(/["\\\r\n]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
    const prompt = `Question about my own food log. One item in my log is not in the app's food table: "${safe}".
Using typical Indian home recipes (or the usual label values, if it is a packaged food), estimate its nutrition per 100 g as eaten, including the usual cooking oil or ghee.
If "${safe}" is not a food or drink, reply {"food":false}.
Reply with only JSON in this exact shape (numbers per 100 g: kcal in kcal, the rest in grams):
{"food":true,"name":"short dish name","kcal":0,"protein":0,"carbs":0,"fat":0,"fibre":0,"sugar":0,"added_sugar":0,"group":"one of bread, rice, dal, veg, nonveg, snack, sweet, drink, side","diet":"one of veg, egg, nonveg","dairy":false}`;
    const res = await App.claudeSample(prompt, { purpose: "assistant", modelTier: "quick" });
    return App.parseJSON(String((res && res.text) || ""));
  }

  // Works out one new dish and saves the result. Returns the stored entry.
  async function estimate(label) {
    const key = keyOfLabel(label);
    if (working[key]) return working[key];
    const run = (async () => {
      const s = store();
      const prev = s[key] || { key, label, tries: 0 };
      const entry = { ...prev, key, label, at: Date.now() };
      let done = false;
      if (aiReady() && aiUsed < MAX_AI_PER_VISIT) {
        aiUsed++;
        entry.tries = (prev.tries || 0) + 1;
        try {
          const r = M().readEstimate(await askAI(label));
          if (r.ok) {
            Object.assign(entry, { status: "ai", nut: r.nut, role: r.role, tags: r.tags, name: r.name ? titleCase(r.name) : titleCase(label), why: null });
            done = true;
          } else if (r.why === "not_food") {
            Object.assign(entry, { status: "not_food", why: r.why });
            done = true;
          } else entry.why = r.why;
        } catch (e) {
          entry.why = (e && e.code) || "ai_error";
        }
      }
      if (!done) {
        const m = M().nameMatch(label, App.dishes);
        if (m) {
          const d = m.dish;
          Object.assign(entry, { status: "name", nut: M().asEaten(d, App.fats, "home"), role: M().roleOf(d), tags: M().tagsOf(d), name: titleCase(label), matchedId: d.id, matchedName: d.name });
        } else if (entry.status !== "ai" && entry.status !== "name") {
          entry.status = "failed";
        }
      }
      const s2 = store();
      s2[key] = entry;
      saveStore(s2);
      return entry;
    })();
    working[key] = run;
    emit();
    try { return await run; } finally { delete working[key]; emit(); }
  }

  // ---------- AI estimates as dishes the app can count ----------
  // App.norm() keeps only a-z, 0-9 and spaces, so the id <-> key mapping is exact.
  const AI_PREFIX = "ai_";
  const aiIdOfKey = (key) => AI_PREFIX + key.slice(2).replace(/ /g, "_");
  const isAiId = (id) => typeof id === "string" && id.startsWith(AI_PREFIX);
  const keyOfAiId = (id) => "n:" + id.slice(AI_PREFIX.length).replace(/_/g, " ");
  // Role -> the table's own category and type, for the dish card's badge and type label.
  const ROLE_TO = {
    bread: ["Breads", "roti"], rice: ["Rice", "rice"], dal: ["Dals", "dal"], veg: ["Vegetables", "sabzi"],
    nonveg: ["Non veg", "curry"], snack: ["Snacks", "fried snack"], sweet: ["Sweets", "sweet"],
    drink: ["Drinks", "other"], side: ["Accompaniments", "other"],
  };

  // A dish object in the food table's own shape. The estimate is "as eaten, with oil",
  // so it has no separate added fat (the oil control stays off, as for a table dish without oil).
  function dishFromEntry(e) {
    if (!e || e.status !== "ai" || !e.nut || !M()) return null;
    const [category, type] = ROLE_TO[e.role] || ROLE_TO.snack;
    const t = e.tags || {};
    const per100g = {};
    M().KEYS.forEach((k) => (per100g[k] = Number(e.nut[k]) || 0));
    return {
      id: aiIdOfKey(e.key), name: e.name || titleCase(e.label), category, type,
      veg: !t.meat && !t.fish && !t.egg, aliases: [e.label],
      units: [{ name: "serving", g: 100 }],
      per100g, micro: null, added_fat: null,
      flags: { meat: !!t.meat, egg: !!t.egg, dairy: !!t.dairy },
      source: "AI estimate per 100 g as eaten", quality: "estimate", ai: true,
    };
  }
  function register(e) {
    const d = dishFromEntry(e);
    if (!d || !App.byId) return null;
    const cur = App.byId[d.id];
    if (cur && !cur.ai) return cur;            // never replace a real table dish
    App.byId[d.id] = d;
    return d;
  }
  function registerAll() {
    Object.values(store()).forEach((e) => { try { register(e); } catch (err) {} });
  }
  // Saved meals can name an AI dish, so they must be known before any view reads the log.
  if (typeof App.loadData === "function") {
    const loadTable = App.loadData;
    App.loadData = async function () {
      const r = await loadTable.apply(this, arguments);
      try { registerAll(); } catch (e) { console.error(e); }
      return r;
    };
  }

  // After a scan: give each dish without a table id the AI estimate, asking the AI if needed.
  // canApply() is checked before any item is changed. Returns how many items were filled.
  async function fillUnknown(items, canApply) {
    const labels = [...new Set((items || []).filter((it) => !it.dishId && !SKIP.has(App.norm(it.label || ""))).map((it) => it.label))];
    if (!labels.length) return 0;
    const entries = await Promise.all(labels.map(async (label) => {
      let e = store()[keyOfLabel(label)];
      const retry = !e || (e.status !== "ai" && e.status !== "not_food" && (e.tries || 0) < MAX_TRIES && aiReady());
      if (retry) { try { e = await estimate(label); } catch (err) { e = null; } }
      return e;
    }));
    if (!canApply()) return 0;
    let n = 0;
    labels.forEach((label, i) => {
      const dish = register(entries[i]);
      if (!dish) return;
      items.forEach((it) => {
        if (it.dishId || it.label !== label) return;
        it.dishId = dish.id;
        it.unitIdx = 0;
        if (!(it.grams > 0)) it.grams = dish.units[0].g;
        App.resetOil(it);
        n++;
      });
    });
    return n;
  }

  // The map key of one saved meal item.
  function keyOfMealItem(it) {
    if (!it) return null;
    if (isAiId(it.dishId)) return keyOfAiId(it.dishId);
    if (it.dishId) return "t:" + it.dishId;
    if (SKIP.has(App.norm(it.label || ""))) return null;
    const tid = tableIdForLabel(it.label);
    return tid ? "t:" + tid : keyOfLabel(it.label);
  }

  // ---------- reading the meal log ----------
  async function mealsSafe() {
    try { return (await App.Account.meals()) || []; } catch (e) { return []; }
  }
  // How often each dish was logged in the last 120 days (the window My log keeps loaded).
  async function eaten() {
    const meals = await mealsSafe();
    const counts = {}, last = {}, labels = {};
    meals.forEach((m) => (m.items || []).forEach((it) => {
      const key = keyOfMealItem(it);
      if (!key) return;
      if (!it.dishId && key.startsWith("n:")) labels[key] = it.label;
      counts[key] = (counts[key] || 0) + 1;
      if (!last[key] || m.date > last[key]) last[key] = m.date;
    }));
    return { counts, last, labels, meals: meals.length };
  }

  // Dishes in the log with no table id and no stored result yet (or a failed one to retry).
  async function pendingLabels() {
    const e = await eaten(), s = store();
    return Object.keys(e.labels)
      .filter((k) => k.startsWith("n:"))
      .filter((k) => !s[k] || (s[k].status === "failed" && (s[k].tries || 0) < MAX_TRIES && aiReady()))
      .map((k) => e.labels[k]);
  }
  // Estimates waiting dishes one at a time.
  let syncing = null;
  function syncNewDishes(max) {
    if (syncing) return syncing;
    syncing = (async () => {
      const labels = (await pendingLabels()).slice(0, max || 3);
      for (const l of labels) await estimate(l);
    })().finally(() => { syncing = null; });
    return syncing;
  }

  // ---------- the model over table dishes plus this person's new dishes ----------
  // New dishes join only while they are in the log, so deleting a meal takes its dish off the map.
  async function items() {
    const b = buildBase();
    if (!b) return [];
    const e = await eaten(), s = store();
    const extra = Object.values(s).filter((x) => e.counts[x.key]).map(itemFromEntry).filter(Boolean);
    return b.items.concat(extra);
  }
  const sigOf = (list) => list.filter((i) => i.source !== "table").map((i) => i.key).sort().join(",");

  // K-Means for k clusters. Clusters are numbered left to right on the map so colours stay put.
  function cluster(list, k) {
    const ck = k + "|" + sigOf(list);
    if (clusterCache[ck]) return clusterCache[ck];
    const b = buildBase();
    const Z = list.map((i) => i.z);
    const r = M().kmeans(Z, k);
    const cxy = r.centroids.map((c) => M().project(b.pca, c));
    const order = cxy.map((p, i) => ({ i, x: p[0], y: p[1] })).sort((a, b2) => a.x - b2.x || a.y - b2.y).map((o) => o.i);
    const remap = {};
    order.forEach((old, nw) => (remap[old] = nw));
    const centroids = order.map((i) => r.centroids[i]);
    const names = M().nameClusters(centroids);
    const labelOf = {};
    list.forEach((it, i) => (labelOf[it.key] = remap[r.labels[i]]));
    const sizes = new Array(k).fill(0);
    Object.values(labelOf).forEach((c) => sizes[c]++);
    // Average nutrients per cluster, in real units, for the detail panel.
    const avg = centroids.map(() => Object.fromEntries(M().KEYS.map((key) => [key, 0])));
    list.forEach((it) => M().KEYS.forEach((key) => (avg[labelOf[it.key]][key] += it.nut[key] / sizes[labelOf[it.key]])));
    const labels = list.map((it) => labelOf[it.key]);
    const res = {
      k, names, sizes, avg, labelOf, centroids, inertia: r.inertia,
      centroidXY: order.map((i) => cxy[i]),
      silhouette: k > 1 ? M().silhouette(Z, labels, k) : null,
    };
    clusterCache[ck] = res;
    return res;
  }
  // Elbow (inertia) and silhouette for k = 1..8, and the best k between 3 and 6 by silhouette.
  function scan(list) {
    const sig = sigOf(list);
    if (scanCache && scanCache.sig === sig) return scanCache;
    const rows = M().scanK(list.map((i) => i.z), 8);
    let best = 5, bestS = -Infinity;
    rows.forEach((r) => { if (r.k >= 3 && r.k <= 6 && r.silhouette > bestS) { bestS = r.silhouette; best = r.k; } });
    scanCache = { sig, rows, best };
    return scanCache;
  }

  async function diet() {
    try { const d = await App.Account.getDoc(); return (d && d.profile && d.profile.diet) || null; } catch (e) { return null; }
  }
  function swapsFor(item, list, dietType) {
    return M().swapsFor(item, list, { diet: dietType, hideKcal: hideKcal() });
  }

  // "Delete all my data" in Privacy empties the app's log and profile; this follows it.
  function watchDeleteAll() {
    if (!App.Account || !App.Account.onChange) return;
    App.Account.onChange(() => {
      const c = App.Account.cache || {};
      if (c.doc === null && Array.isArray(c.meals) && c.meals.length === 0 && Object.keys(store()).length) {
        try { localStorage.removeItem(STORE_KEY); } catch (e) {}
      }
      emit();
    });
  }

  App.MLData = {
    STORE_KEY,
    init() { buildBase(); watchDeleteAll(); },
    base: buildBase, items, eaten, cluster, scan, diet, swapsFor,
    estimate, syncNewDishes, pendingLabels, aiReady, hideKcal,
    newDishes: () => Object.values(store()),
    isWorking: (key) => !!working[key],
    keyOfLabel, tableIdForLabel, keyOfMealItem, isAiId, fillUnknown, dishFromEntry,
    onChange(fn) { listeners.push(fn); },
  };
})();
