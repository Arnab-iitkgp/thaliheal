/* test-mode.js: accuracy testing, kept apart from normal use.
   Test set (PDF reference photos + your own uploads with true values), side by side
   runs of two models with the same prompt, error metrics, reports and CSV export.
   Nothing here is ever fed back into the scan prompt. */
(function () {
  "use strict";
  const { $, esc, r0, r1 } = App;

  const MODELS = [
    { id: "claude-opus-5-5", label: "Claude Opus 5.5", tier: "complex" },
    { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5", tier: "default" },
    { id: "claude-haiku-5-5", label: "Claude Haiku 5.5", tier: "quick" },
  ];
  const TYPES = ["dal", "sabzi", "rice", "roti", "curry", "fried snack", "sweet", "other"];
  const ANGLES = ["Top down", "Angled (about 45°)", "Side view", "Not sure"];
  const PLATES = ["Steel thali", "Ceramic plate", "Bowl only", "Banana leaf", "Takeaway box", "Other"];
  const REFS = ["None", "Coin", "Card", "Spoon or fork", "Hand", "Other"];
  const LIGHTS = ["Daylight", "Indoor light", "Dim", "Not sure"];
  const TINY_G = 30;   // portions under this are left out of percentage errors
  const newId = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const opt = (list, sel) => list.map((x) => `<option ${x === sel ? "selected" : ""}>${esc(x)}</option>`).join("");

  // ================= storage: a private test area, separate from everything else =================
  // Inside Claude: the private database ("db"). On the website: its own IndexedDB in this browser on this
  // device ("device"), apart from the meal log, so a run survives the camera, the file picker or a restart.
  // "memory" is the last resort (no IndexedDB, or saving failed).
  const IDB = {
    name: "thaliheal-testmode", db: null,
    open() {
      if (this.db) return this.db;
      this.db = new Promise((res, rej) => {
        if (!window.indexedDB) return rej({ code: "no_indexeddb" });
        const r = indexedDB.open(this.name, 1);
        r.onupgradeneeded = () => {
          const d = r.result;
          d.createObjectStore("photos", { keyPath: "id" });
          d.createObjectStore("blobs");
          d.createObjectStore("runs", { keyPath: "id" });
          d.createObjectStore("results", { keyPath: "key" }).createIndex("run", "run_id");
        };
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error || { code: "indexeddb" });
        r.onblocked = () => rej({ code: "indexeddb_blocked" });
      });
      this.db.catch(() => { this.db = null; });
      return this.db;
    },
    // One transaction: fn(stores) queues requests and returns them; resolves with their results once committed.
    async tx(names, mode, fn) {
      const d = await this.open();
      return new Promise((res, rej) => {
        const t = d.transaction(names, mode);
        const st = {}; names.forEach((n) => { st[n] = t.objectStore(n); });
        const reqs = fn(st) || [];
        t.oncomplete = () => res(reqs.map((q) => q.result));
        t.onerror = () => rej(t.error || { code: "indexeddb" });
        t.onabort = () => rej(t.error || { code: "indexeddb_abort" });
      });
    },
    async drop() {
      if (this.db) { const d = await this.db.catch(() => null); if (d) d.close(); this.db = null; }
      if (!window.indexedDB) return;
      await new Promise((res) => { const r = indexedDB.deleteDatabase(this.name); r.onsuccess = r.onerror = r.onblocked = () => res(); });
    },
  };
  const resultKey = (runId, r) => `${runId}__${r.photo_id}__${r.slot}`;

  const Store = {
    mode: "memory", root: null, assets: null, downloads: null, ready: null,
    mem: { photos: [], runs: [], results: {} }, blobs: {},
    init() {
      if (this.ready) return this.ready;
      this.ready = (async () => {
        const use = (n) => (window.claude && window.claude.use ? window.claude.use(n).catch(() => null) : Promise.resolve(null));
        const [db, user, assets, downloads] = await Promise.all([use("db"), use("user"), use("assets"), use("downloads")]);
        const uid = user && user.id ? await user.id().catch(() => null) : null;
        if (db && uid) { this.root = db.doc(`data/users/${uid}/testmode`); this.mode = "db"; }
        else if (App.hosting === "web") { try { await IDB.open(); this.mode = "device"; } catch (e) { this.mode = "memory"; } }
        this.assets = assets; this.downloads = downloads;
      })();
      return this.ready;
    },
    // fn: Claude database; local: this device's IndexedDB; fallback: memory.
    async safe(fn, local, fallback) {
      const was = this.mode;
      if (was === "memory") return fallback();
      try { return await (was === "db" ? fn() : local()); }
      catch (e) {
        this.mode = "memory";
        note(`${was === "db" ? "Saving to your private test area" : "Saving test data on this device"} failed (${e && (e.code || e.name) || "error"}). Results now live only until you close the app, so export the CSV before leaving.`);
        return fallback();
      }
    },
    listPhotos() {
      return this.safe(async () => (await this.root.collection("photos").get()).docs.map((d) => d.data()),
        async () => {
          const [photos, keys, blobs] = await IDB.tx(["photos", "blobs"], "readonly", (st) => [st.photos.getAll(), st.blobs.getAllKeys(), st.blobs.getAll()]);
          keys.forEach((k, i) => { this.blobs[k] = blobs[i]; });
          return photos.sort((a, b) => String(a.created).localeCompare(String(b.created)));
        },
        () => this.mem.photos.slice());
    },
    savePhoto(p) {
      return this.safe(() => this.root.collection("photos").doc(p.id).set(p),
        () => IDB.tx(["photos", "blobs"], "readwrite", (st) => { const q = [st.photos.put(p)]; if (this.blobs[p.id]) q.push(st.blobs.put(this.blobs[p.id], p.id)); return q; }),
        () => { this.mem.photos.push(p); });
    },
    deletePhoto(p) {
      if (p.asset_id && this.assets) this.assets.delete(p.asset_id).catch(() => {});
      return this.safe(() => this.root.collection("photos").doc(p.id).delete(),
        () => IDB.tx(["photos", "blobs"], "readwrite", (st) => [st.photos.delete(p.id), st.blobs.delete(p.id)]).then(() => { delete this.blobs[p.id]; }),
        () => { this.mem.photos = this.mem.photos.filter((x) => x.id !== p.id); });
    },
    listRuns() {
      return this.safe(async () => (await this.root.collection("runs").orderBy("created", "desc").limit(50).get()).docs.map((d) => d.data()),
        async () => (await IDB.tx(["runs"], "readonly", (st) => [st.runs.getAll()]))[0].sort((a, b) => String(b.created).localeCompare(String(a.created))).slice(0, 50),
        () => this.mem.runs.slice().reverse());
    },
    saveRun(run) {
      return this.safe(() => this.root.collection("runs").doc(run.id).set(run),
        () => IDB.tx(["runs"], "readwrite", (st) => [st.runs.put(JSON.parse(JSON.stringify(run)))]),
        () => { if (!this.mem.runs.includes(run)) this.mem.runs.push(run); });
    },
    listResults(runId) {
      return this.safe(async () => (await this.root.collection("runs").doc(runId).collection("results").get()).docs.map((d) => d.data()),
        async () => (await IDB.tx(["results"], "readonly", (st) => [st.results.index("run").getAll(runId)]))[0],
        () => this.mem.results[runId] || []);
    },
    saveResult(runId, r) {
      return this.safe(() => this.root.collection("runs").doc(runId).collection("results").doc(`${r.photo_id}__${r.slot}`).set(r),
        () => IDB.tx(["results"], "readwrite", (st) => [st.results.put(JSON.parse(JSON.stringify(Object.assign({ key: resultKey(runId, r), run_id: runId }, r))))]),
        () => { const list = (this.mem.results[runId] = this.mem.results[runId] || []); const i = list.findIndex((x) => x.photo_id === r.photo_id && x.slot === r.slot); if (i >= 0) list[i] = r; else list.push(r); });
    },
    // Remove every test photo (and its uploaded file), run and result for this person.
    async deleteAll() {
      await this.init();
      if (this.mode === "db") {
        for (const p of await this.listPhotos()) await this.deletePhoto(p);
        for (const run of await this.listRuns()) {
          for (const r of await this.listResults(run.id)) await this.safe(() => this.root.collection("runs").doc(run.id).collection("results").doc(`${r.photo_id}__${r.slot}`).delete(), () => {}, () => {});
          await this.safe(() => this.root.collection("runs").doc(run.id).delete(), () => {}, () => {});
        }
        await this.safe(() => this.root.delete(), () => {}, () => {});
      }
      await IDB.drop();   // the device copy, whichever mode is in use now
      if (this.mode === "device") { this.ready = null; this.mode = "memory"; }
      this.mem = { photos: [], runs: [], results: {} }; this.blobs = {};
    },
    async imageBlob(photo) {
      if (this.blobs[photo.id]) return this.blobs[photo.id];
      const url = photo.source === "pdf" ? photo.test_photo : (photo.image_url || "/_blob/" + photo.asset_id);
      const res = await fetch(url); if (!res.ok) throw { code: "image_missing", message: "Photo could not be loaded" };
      return res.blob();
    },
  };
  function note(msg) { const n = $("tStoreNote"); n.textContent = msg; n.hidden = !msg; }

  // ================= the test set =================
  // PDF photos: one true item per photo (the whole dish or plate), values as printed in the PDF.
  function pdfPhotos() {
    return App.samples.map((s) => ({
      id: "pdf_" + s.id, source: "pdf", name: s.name, image: s.test_photo, test_photo: s.test_photo,
      conditions: { angle: "Not recorded (PDF image)", plate: "Not recorded", reference: "None", lighting: "Not recorded", notes: s.id <= "s06" ? "Name label cropped off" : "" },
      items: [{ name: s.name, type: s.dish_type, dish_id: null, grams: s.weight_g, oil_g: null, kcal_override: s.kcal, kcal_source: "PDF", groups: s.match_groups }],
    }));
  }
  let uploads = [];
  const allPhotos = () => pdfPhotos().concat(uploads);

  // True calories for one item: PDF value, your number, or computed from the food table.
  function trueKcal(item) {
    if (item.kcal_override != null && item.kcal_override !== "") return { kcal: Number(item.kcal_override), source: item.kcal_source || "entered by you" };
    const d = App.byId[item.dish_id];
    if (!d || !(item.grams > 0)) return { kcal: null, source: "missing: pick an exact dish or enter kcal" };
    const base = d.per100g.kcal * item.grams / 100;
    if (item.oil_g != null && item.oil_g !== "") return { kcal: base + Number(item.oil_g) * 9, source: "food table + your oil" };
    const fat = d.added_fat ? d.added_fat.home * item.grams / 100 * App.fats[d.added_fat.type].per_g.kcal : 0;
    return { kcal: base + fat, source: d.added_fat ? "food table + table oil (home)" : "food table" };
  }

  // ================= evaluation =================
  function estItems(parsed) {
    return App.itemsFromModel(parsed).items.map((it) => {
      const c = App.calcItem(it), rg = App.rangeItem(it);
      return { dish_id: it.dishId, label: it.label, type: App.dishType(it.dishId), g: it.grams, gLo: rg.g[0], gHi: rg.g[1], kcal: c.total.kcal, kLo: rg.kcal[0], kHi: rg.kcal[1] };
    });
  }

  // Give each model item to a true item: same exact dish first, then same dish type (closest weight).
  function assign(truth, est) {
    const groups = truth.map((t) => ({ truth: t, est: [] }));
    if (truth.length === 1) { groups[0].est = est.slice(); return { groups, extras: [] }; }
    const left = est.slice();
    groups.forEach((g) => { if (!g.truth.dish_id) return; for (let i = left.length - 1; i >= 0; i--) if (left[i].dish_id === g.truth.dish_id) g.est.push(left.splice(i, 1)[0]); });
    for (let i = left.length - 1; i >= 0; i--) {
      const e = left[i];
      const cands = groups.filter((g) => g.truth.type === e.type);
      if (!cands.length) continue;
      cands.sort((a, b) => Math.abs(sum(a.est, "g") + e.g - a.truth.grams) - Math.abs(sum(b.est, "g") + e.g - b.truth.grams));
      cands[0].est.push(left.splice(i, 1)[0]);
    }
    return { groups, extras: left };
  }
  const sum = (arr, k) => arr.reduce((s, x) => s + (x[k] || 0), 0);

  // Was the dish named correctly? PDF dishes: every name group must be found. Uploads: exact dish, else dish type.
  function named(truth, est) {
    if (!est.length) return { ok: false, method: "nothing found", found: "0" };
    if (truth.groups) {
      const hit = truth.groups.filter((g) => est.some((e) =>
        (g.ids || []).includes(e.dish_id) || (g.words || []).some((w) => App.norm(e.label).includes(App.norm(w))) || (g.type && e.type === g.type)));
      return { ok: hit.length === truth.groups.length, method: "PDF name groups", found: `${hit.length}/${truth.groups.length}` };
    }
    if (truth.dish_id) return { ok: est.some((e) => e.dish_id === truth.dish_id), method: "exact dish", found: "" };
    return { ok: est.some((e) => e.type === truth.type), method: "dish type", found: "" };
  }

  function errs(est, tru) {
    if (tru == null || est == null) return { err: null, abs: null, pct: null, apct: null };
    const err = est - tru;
    return { err, abs: Math.abs(err), pct: tru > 0 ? err / tru * 100 : null, apct: tru > 0 ? Math.abs(err) / tru * 100 : null };
  }
  const inRange = (lo, hi, tru) => (tru == null ? null : tru >= lo - 0.5 && tru <= hi + 0.5);

  function row(base, level, truthName, type, est, tru, nm, noteTxt) {
    const g = errs(est.g, tru.g), k = errs(tru.kcal == null ? null : est.kcal, tru.kcal);
    return Object.assign({}, base, {
      level, truth_item: truthName, dish_type: type,
      model_items: est.labels, model_dish_ids: est.ids,
      est_g: est.g, est_g_low: est.gLo, est_g_high: est.gHi, true_g: tru.g,
      err_g: g.err, abs_err_g: g.abs, pct_err_g: g.pct, abs_pct_err_g: g.apct, g_in_range: tru.g == null ? null : inRange(est.gLo, est.gHi, tru.g),
      est_kcal: est.kcal, est_kcal_low: est.kLo, est_kcal_high: est.kHi, true_kcal: tru.kcal, true_kcal_source: tru.kSource,
      err_kcal: k.err, abs_err_kcal: k.abs, pct_err_kcal: k.pct, abs_pct_err_kcal: k.apct, kcal_in_range: inRange(est.kLo, est.kHi, tru.kcal),
      named_correctly: nm ? nm.ok : null, naming_method: nm ? nm.method : "", components_found: nm ? nm.found : "",
      tiny_portion: tru.g != null && tru.g < TINY_G, note: noteTxt || "",
    });
  }
  const pack = (list) => ({ g: sum(list, "g"), gLo: sum(list, "gLo"), gHi: sum(list, "gHi"), kcal: sum(list, "kcal"), kLo: sum(list, "kLo"), kHi: sum(list, "kHi"),
    labels: list.map((e) => e.label).join("; "), ids: list.map((e) => e.dish_id || "none").join("; ") });

  // All rows (one per true dish, extras, one plate total) for one photo and one model result.
  function evaluate(run, photo, res) {
    const m = run.models.find((x) => x.slot === res.slot) || {};
    const c = photo.conditions || {};
    const base = {
      run_id: run.id, run_date: run.created, prompt_version: run.prompt_version, photo_id: photo.id, photo_name: photo.name, photo_source: photo.source,
      model_slot: res.slot, model_requested: m.id, model_applied: res.model_applied || "", model_tier: res.tier_applied || "",
      model_honoured: res.model_applied === m.id, angle: c.angle || "", plate_type: c.plate || "", reference_object: c.reference || "", lighting: c.lighting || "",
    };
    if (!res.ok) return [row(base, "plate", "(scan failed)", "", pack([]), { g: null, kcal: null }, null, "error: " + res.error)];
    const est = estItems(res.parsed);
    const truth = photo.items.map((t) => { const k = trueKcal(t); return Object.assign({}, t, { kcal: k.kcal, kSource: k.source }); });
    const { groups, extras } = assign(truth, est);
    const rows = groups.map((gr) => row(base, "dish", gr.truth.name, gr.truth.type, pack(gr.est),
      { g: gr.truth.grams, kcal: gr.truth.kcal, kSource: gr.truth.kSource }, named(gr.truth, gr.est), gr.est.length ? "" : "missed by model"));
    extras.forEach((e) => rows.push(row(base, "dish", "(none)", e.type, pack([e]), { g: null, kcal: null, kSource: "" }, null, "extra item, no true value")));
    const tk = truth.every((t) => t.kcal != null) ? truth.reduce((s, t) => s + t.kcal, 0) : null;
    rows.push(row(base, "plate", "Plate total", "", pack(est), { g: truth.reduce((s, t) => s + t.grams, 0), kcal: tk, kSource: tk == null ? "incomplete" : "sum of items" }, null, ""));
    return rows;
  }

  // ================= metrics =================
  const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
  const median = (a) => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const pctOf = (a) => (a.length ? a.filter(Boolean).length / a.length * 100 : null);

  function summarize(rows) {
    const scored = rows.filter((r) => r.true_g != null);
    const big = scored.filter((r) => !r.tiny_portion);
    const nums = (list, k) => list.map((r) => r[k]).filter((v) => v != null);
    return {
      n: scored.length, tiny: scored.length - big.length,
      g_mape: mean(nums(big, "abs_pct_err_g")), g_mdape: median(nums(big, "abs_pct_err_g")), g_mae: mean(nums(scored, "abs_err_g")), g_bias: mean(nums(scored, "err_g")),
      k_mape: mean(nums(big, "abs_pct_err_kcal")), k_mdape: median(nums(big, "abs_pct_err_kcal")), k_mae: mean(nums(scored, "abs_err_kcal")), k_bias: mean(nums(scored, "err_kcal")),
      named: pctOf(nums(scored, "named_correctly")), g_cover: pctOf(nums(scored, "g_in_range")), k_cover: pctOf(nums(scored, "kcal_in_range")),
    };
  }
  const METRICS = [
    ["n", "Items scored", "", 0], ["tiny", `Tiny portions (<${TINY_G} g, left out of %)`, "", 0],
    ["named", "Named correctly", "%", 1], ["g_mape", "Grams: mean abs % error", "%", -1], ["g_mdape", "Grams: median abs % error", "%", -1],
    ["g_mae", "Grams: mean abs error", "g", -1], ["g_bias", "Grams: bias (mean signed error)", "g", -2], ["g_cover", "Grams: true value inside range", "%", 1],
    ["k_mape", "Calories: mean abs % error", "%", -1], ["k_mdape", "Calories: median abs % error", "%", -1],
    ["k_mae", "Calories: mean abs error", "kcal", -1], ["k_bias", "Calories: bias (mean signed error)", "kcal", -2], ["k_cover", "Calories: true value inside range", "%", 1],
  ];
  // Bias rows (dir -2) get a sign so over and under estimates are easy to read.
  const fmt = (v, unit, signed) => {
    if (v == null) return "–";
    const n = (signed && v > 0 ? "+" : "") + r0(v);
    return unit === "%" ? n + "%" : unit ? `${n} ${unit}` : n;
  };

  // ================= CSV =================
  const DETAIL_COLS = ["run_id", "run_date", "prompt_version", "photo_id", "photo_name", "photo_source", "level", "truth_item", "dish_type",
    "model_slot", "model_requested", "model_applied", "model_tier", "model_honoured", "angle", "plate_type", "reference_object", "lighting",
    "model_items", "model_dish_ids", "est_g", "est_g_low", "est_g_high", "true_g", "err_g", "abs_err_g", "pct_err_g", "abs_pct_err_g", "g_in_range",
    "est_kcal", "est_kcal_low", "est_kcal_high", "true_kcal", "true_kcal_source", "err_kcal", "abs_err_kcal", "pct_err_kcal", "abs_pct_err_kcal", "kcal_in_range",
    "named_correctly", "naming_method", "components_found", "tiny_portion", "note"];
  const cell = (v) => {
    if (v == null) return "";
    if (typeof v === "number") v = Math.round(v * 10) / 10;
    const s = String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const toCSV = (cols, rows) => [cols.join(",")].concat(rows.map((r) => cols.map((c) => cell(r[c])).join(","))).join("\n");

  function summaryRows(run, rows) {
    const out = [];
    run.models.forEach((m) => {
      const mine = rows.filter((r) => r.model_slot === m.slot);
      const applied = [...new Set(mine.map((r) => r.model_applied || "(not reported)"))].join("; ");
      const add = (level, group, list) => out.push(Object.assign({ run_id: run.id, model_slot: m.slot, model_requested: m.id, model_applied: applied, prompt_version: run.prompt_version, level, group }, summarize(list)));
      add("dish", "all", mine.filter((r) => r.level === "dish"));
      add("plate", "all", mine.filter((r) => r.level === "plate"));
      TYPES.forEach((t) => { const l = mine.filter((r) => r.level === "dish" && r.dish_type === t && r.true_g != null); if (l.length) add("dish", t, l); });
    });
    return out;
  }
  const SUMMARY_COLS = ["run_id", "model_slot", "model_requested", "model_applied", "prompt_version", "level", "group", "n", "tiny",
    "named", "g_mape", "g_mdape", "g_mae", "g_bias", "g_cover", "k_mape", "k_mdape", "k_mae", "k_bias", "k_cover"];

  async function saveCSV(filename, text, box) {
    const st = $("tCsvStatus"); st.textContent = "Saving…";
    const res = await App.saveFile(filename, text, "text/csv");
    if (res) { App.saveNote(st, res); return; }
    st.textContent = "";
    box.hidden = false; box.querySelector("textarea").value = text;   // fallback: copy from the box
  }

  // ================= UI: tabs =================
  let tab = "set";
  function showTab(t) {
    tab = t;
    document.querySelectorAll("[data-tab]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === t)));
    document.querySelectorAll("[data-tabpanel]").forEach((p) => { p.hidden = p.dataset.tabpanel !== t; });
    if (t === "set") renderSet(); if (t === "run") renderRun(); if (t === "results") renderResults();
  }

  // ================= UI: test set =================
  function photoRow(p, del) {
    const tg = p.items.reduce((s, i) => s + (Number(i.grams) || 0), 0);
    const ks = p.items.map(trueKcal); const tk = ks.every((k) => k.kcal != null) ? ks.reduce((s, k) => s + k.kcal, 0) : null;
    const img = p.source === "pdf" ? p.image : (Store.blobs[p.id] ? URL.createObjectURL(Store.blobs[p.id]) : (p.image_url || "/_blob/" + p.asset_id));
    return `<div class="tphoto">
      <img src="${esc(img)}" alt="">
      <div><b>${esc(p.name)}</b>
        <div class="meta">${p.items.map((i) => esc(i.type)).join(" + ")} · true ${r0(tg)} g · ${tk == null ? "kcal missing" : r0(tk) + " kcal"}${p.source === "pdf" ? " (PDF)" : ""}</div>
        <div class="meta">${esc([p.conditions.angle, p.conditions.plate, "ref: " + p.conditions.reference].filter(Boolean).join(" · "))}</div></div>
      ${del ? `<button class="icon-btn" data-del="${p.id}" aria-label="Delete ${esc(p.name)}">✕</button>` : "<span></span>"}
    </div>`;
  }

  function renderSet() {
    const pdf = pdfPhotos();
    $("tSet").innerHTML = `
      <div style="display:grid;gap:12px">
        <div class="card small">
          <b>Where test data lives.</b> ${Store.mode === "db" ? "Your private test area, separate from everything else in the app." : Store.mode === "device" ? "On this device only, in a test area kept apart from your meal log. Deleting your data, or clearing the app's storage, removes it." : "Only until you close the app (this browser cannot store it). Export CSVs before leaving."}
          Test photos and results are never used to change the scan prompt.
        </div>
        <details class="card"><summary><b>PDF reference set</b> · ${pdf.length} photos</summary>
          <p class="small muted">True values are the PDF's printed estimates (not weighed). Name labels were cropped off photos 1 to 6, which are also very small. Composite plates are scored as one dish.</p>
          <div class="tset">${pdf.map((p) => photoRow(p, false)).join("")}</div>
        </details>
        <div class="card" style="display:grid;gap:10px">
          <div class="list-head"><h2>Your test photos</h2><span class="small muted">${uploads.length}</span></div>
          <div class="tset" id="upList">${uploads.length ? uploads.map((p) => photoRow(p, true)).join("") : `<div class="empty small">None yet. Add a weighed plate below.</div>`}</div>
        </div>
        <div class="card" id="upForm"></div>
      </div>`;
    $("upList").querySelectorAll("[data-del]").forEach((b) => b.onclick = async () => {
      const p = uploads.find((x) => x.id === b.dataset.del); if (!p) return;
      b.disabled = true; await Store.deletePhoto(p); uploads = uploads.filter((x) => x !== p); renderSet();
    });
    renderForm();
  }

  // Upload form: photo, one or more true items, photo conditions.
  let draft = null;
  function blankItem() { return { type: "sabzi", dish_id: "", name: "", grams: "", oil_g: "", kcal_override: "" }; }
  function renderForm() {
    if (!draft) draft = { blob: null, items: [blankItem()], conditions: { angle: ANGLES[0], plate: PLATES[0], reference: REFS[0], lighting: LIGHTS[0], notes: "" } };
    const f = $("upForm");
    f.innerHTML = `
      <form class="form" id="tForm">
        <h2>Add a test photo</h2>
        <label>Plate photo<input type="file" id="tPhoto" accept="image/*" required></label>
        <div id="tItems" style="display:grid;gap:10px"></div>
        <button type="button" class="btn btn-small" id="tAddItem">＋ Another dish on this plate</button>
        <div class="two">
          <label>Camera angle<select data-c="angle">${opt(ANGLES, draft.conditions.angle)}</select></label>
          <label>Plate type<select data-c="plate">${opt(PLATES, draft.conditions.plate)}</select></label>
          <label>Reference object in frame<select data-c="reference">${opt(REFS, draft.conditions.reference)}</select></label>
          <label>Lighting<select data-c="lighting">${opt(LIGHTS, draft.conditions.lighting)}</select></label>
        </div>
        <label>Notes<input data-c="notes" value="${esc(draft.conditions.notes)}" placeholder="Optional"></label>
        <button class="btn btn-primary" type="submit">Save test photo</button>
        <div class="status" id="tFormStatus"></div>
      </form>`;
    renderItems();
    $("tPhoto").onchange = async (e) => {
      const st = $("tFormStatus"), file = e.target.files && e.target.files[0];
      draft.blob = null; st.classList.remove("err");
      if (!file) { st.textContent = ""; return; }
      st.textContent = "Reading the photo…";
      draft.blob = await App.shrinkPhoto(file).catch(() => null);
      if (draft.blob) { st.textContent = `Photo ready: ${Math.round(draft.blob.size / 1024)} KB.`; return; }
      st.textContent = "That file could not be read as a photo. Use a JPEG or PNG; HEIC photos (a camera setting on some phones) don't open here.";
      st.classList.add("err"); e.target.value = "";
    };
    $("tAddItem").onclick = () => { draft.items.push(blankItem()); renderItems(); };
    f.querySelectorAll("[data-c]").forEach((el) => el.oninput = el.onchange = () => { draft.conditions[el.dataset.c] = el.value; });
    $("tForm").onsubmit = saveDraft;
  }
  function renderItems() {
    $("tItems").innerHTML = draft.items.map((it, i) => {
      const dishes = App.dishes.filter((d) => d.type === it.type);
      return `<div class="titem" data-i="${i}">
        <div class="two">
          <label>Dish type<select data-f="type">${opt(TYPES, it.type)}</select></label>
          <label>Exact dish<select data-f="dish_id"><option value="">Not sure</option>${dishes.map((d) => `<option value="${d.id}" ${d.id === it.dish_id ? "selected" : ""}>${esc(d.name)}</option>`).join("")}</select></label>
          <label>True weight (g)<input data-f="grams" type="number" min="1" step="1" inputmode="numeric" value="${esc(it.grams)}" required></label>
          <label>Oil or ghee used (g)<input data-f="oil_g" type="number" min="0" step="0.5" inputmode="decimal" value="${esc(it.oil_g)}" placeholder="If known"></label>
        </div>
        <label>Name (optional)<input data-f="name" value="${esc(it.name)}" placeholder="${esc(App.byId[it.dish_id] ? App.byId[it.dish_id].name : "e.g. tinde ki sabzi")}"></label>
        <div class="computed" data-k>${computedLine(it)}</div>
        <label>True calories (override, kcal)<input data-f="kcal_override" type="number" min="0" step="1" value="${esc(it.kcal_override)}" placeholder="Leave blank to use the computed value"></label>
        ${draft.items.length > 1 ? `<button type="button" class="btn btn-small btn-ghost" data-rm>Remove this dish</button>` : ""}
      </div>`;
    }).join("");
    $("tItems").querySelectorAll(".titem").forEach((box) => {
      const it = draft.items[Number(box.dataset.i)];
      box.querySelectorAll("[data-f]").forEach((el) => {
        if (el.tagName === "SELECT") {
          // Type or exact dish changed: rebuild this list so the dish options follow the type.
          el.onchange = () => { it[el.dataset.f] = el.value; if (el.dataset.f === "type") it.dish_id = ""; renderItems(); };
        } else {
          // Numbers and names: update in place, only refresh the computed calories line.
          el.oninput = () => { it[el.dataset.f] = el.value; box.querySelector("[data-k]").innerHTML = computedLine(it); };
        }
      });
      const rm = box.querySelector("[data-rm]"); if (rm) rm.onclick = () => { draft.items.splice(Number(box.dataset.i), 1); renderItems(); };
    });
  }
  function computedLine(it) {
    if (it.kcal_override !== "" && it.kcal_override != null) return `Using your calories: <b>${esc(it.kcal_override)} kcal</b>.`;
    const k = trueKcal(Object.assign({}, it, { grams: Number(it.grams), oil_g: it.oil_g === "" ? null : it.oil_g, kcal_override: null }));
    return k.kcal != null ? `Computed true calories: <b>${r0(k.kcal)} kcal</b> (${esc(k.source)}). Type a number below to override.` : "Pick an exact dish and weight to compute calories, or enter them below.";
  }
  async function saveDraft(e) {
    e.preventDefault();
    const st = $("tFormStatus");
    // pick up values typed but not yet committed with change
    $("tItems").querySelectorAll(".titem").forEach((box) => { const it = draft.items[Number(box.dataset.i)]; box.querySelectorAll("[data-f]").forEach((el) => { it[el.dataset.f] = el.value; }); });
    if (!draft.blob) { st.textContent = "Add a photo first."; st.classList.add("err"); return; }
    if (draft.items.some((i) => !(Number(i.grams) > 0))) { st.textContent = "Every dish needs a true weight in grams."; st.classList.add("err"); return; }
    st.classList.remove("err"); st.textContent = "Saving…";
    const id = newId("up_");
    const photo = {
      id, source: "upload", created: new Date().toISOString(),
      name: draft.items.map((i) => i.name || (App.byId[i.dish_id] ? App.byId[i.dish_id].name : i.type)).join(" + "),
      conditions: Object.assign({}, draft.conditions),
      items: draft.items.map((i) => ({ name: i.name || (App.byId[i.dish_id] ? App.byId[i.dish_id].name : i.type), type: i.type, dish_id: i.dish_id || null,
        grams: Number(i.grams), oil_g: i.oil_g === "" ? null : Number(i.oil_g), kcal_override: i.kcal_override === "" ? null : Number(i.kcal_override), kcal_source: i.kcal_override === "" ? null : "entered by you" })),
    };
    try {
      if (Store.assets) { const a = await Store.assets.upload(draft.blob); photo.asset_id = a.id; photo.image_url = a.url; }
      else Store.blobs[id] = draft.blob;   // saved with the photo record (device) or kept for this session (memory)
      await Store.savePhoto(photo);
      uploads.push(photo); draft = null; renderSet();
    } catch (err) { st.textContent = "Could not save the photo. Try again."; st.classList.add("err"); }
  }

  // ================= UI: run =================
  let running = null;   // { ctl, run }
  function getActiveModels() {
    const p = (App.aiProvider || "gemini").toLowerCase();
    if (p === "gemini") {
      return [
        { id: App.aiModels?.default || "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash Lite (500/day)", tier: "default" },
        { id: App.aiModels?.quick || "gemini-3.1-flash-lite", label: "Gemini 3.1 Flash Lite (500/day)", tier: "quick" },
        { id: App.aiModels?.complex || "gemini-3.8-flash", label: "Gemini 3.8 Flash (20/day)", tier: "complex" },
        { id: "gemini-3.6-flash", label: "Gemini 3.6 Flash (20/day)", tier: "complex" },
        { id: "gemini-3-flash", label: "Gemini 3 Flash (20/day)", tier: "complex" },
        { id: "gemini-1.5-flash", label: "Gemini 1.5 Flash (Fallback)", tier: "quick" },
      ];
    }
    if (p === "groq") {
      return [
        { id: App.aiModels?.complex || "llama-3.2-90b-vision-preview", label: "Llama 3.2 90B Vision", tier: "complex" },
        { id: App.aiModels?.default || "llama-3.2-11b-vision-preview", label: "Llama 3.2 11B Vision", tier: "default" },
        { id: "llama-3.2-11b-vision-preview", label: "Llama 3.2 11B Vision (Fast)", tier: "quick" },
      ];
    }
    return MODELS;
  }

  function renderRun() {
    const list = getActiveModels();
    const defA = list[0]?.id || "default";
    const defB = list[1]?.id || "quick";
    const m = App.store.get("thali.testModels", [defA, defB]);
    const sel = (slot, v) => `<select id="tModel${slot}">${list.map((x) => `<option value="${x.id}" ${x.id === v ? "selected" : ""}>${esc(x.label)}</option>`).join("")}</select>`;
    $("tRun").innerHTML = `
      <div class="card form">
        <h2>Run both models</h2>
        <p class="small muted">Both models get the same photos, the same prompt (${esc(App.PROMPT_VERSION)}) and the same settings: no answer caching, platform default thinking. Each result saves the model that actually answered.</p>
        <div class="two"><label>Model A${sel("A", m[0])}</label><label>Model B${sel("B", m[1])}</label></div>
        <label class="row" style="font-weight:500"><input type="checkbox" id="tUsePdf" checked> PDF reference photos (${App.samples.length})</label>
        <label class="row" style="font-weight:500"><input type="checkbox" id="tUseUp" ${uploads.length ? "checked" : "disabled"}> Your test photos (${uploads.length})</label>
        ${App.claudeSample ? "" : `<div class="notice">${App.hosting === "claude" ? "Runs need Claude: open this page in Claude while signed in." : "Runs need the AI server, which says scanning is not set up yet. Check the variables on Vercel, then open Test mode again."}</div>`}
        <div class="row"><button class="btn btn-primary" id="tStart" ${App.claudeSample && !running ? "" : "disabled"}>Start run</button><button class="btn" id="tStop" ${running ? "" : "hidden"}>Stop</button></div>
        <div class="status" id="tRunStatus"></div>
        <div class="prog" id="tProg"></div>
      </div>`;
    $("tStart").onclick = startRun;
    $("tStop").onclick = () => running && running.ctl.abort();
  }

  async function startRun() {
    const a = $("tModelA").value, b = $("tModelB").value;
    const st = $("tRunStatus");
    if (a === b) { st.textContent = "Pick two different models."; st.classList.add("err"); return; }
    st.classList.remove("err");
    App.store.set("thali.testModels", [a, b]);
    const photos = [].concat($("tUsePdf").checked ? pdfPhotos() : [], $("tUseUp").checked ? uploads : []);
    if (!photos.length) { st.textContent = "Choose at least one photo set."; return; }
    const pick = (id, slot) => { const x = MODELS.find((mm) => mm.id === id); return { slot, id: x.id, label: x.label, tier: x.tier }; };
    const run = { id: newId("run_"), created: new Date().toISOString(), prompt_version: App.PROMPT_VERSION,
      settings: { cache: false, effort: "platform default", tier_fallback: "model's own tier" }, models: [pick(a, "A"), pick(b, "B")],
      photo_ids: photos.map((p) => p.id), status: "running" };
    await Store.saveRun(run);
    running = { ctl: new AbortController(), run };
    $("tStart").disabled = true; $("tStop").hidden = false;
    const prog = $("tProg"); prog.innerHTML = "";
    let stopReason = "";
    for (let i = 0; i < photos.length && !stopReason; i++) {
      const p = photos[i];
      st.textContent = `Photo ${i + 1} of ${photos.length}: ${p.name}`;
      const line = document.createElement("div"); line.innerHTML = `<span>${esc(p.name)}</span><span>A … · B …</span>`; prog.prepend(line);
      let blob;
      try { blob = await Store.imageBlob(p); } catch (e) { line.lastChild.textContent = "photo missing"; continue; }
      const outcomes = await Promise.all(run.models.map(async (m) => {
        const res = { run_id: run.id, photo_id: p.id, slot: m.slot, model_requested: m.id, started: new Date().toISOString() };
        try {
          const r = await App.askModel(blob, { model: m.id, modelTier: m.tier, cache: false, signal: running.ctl.signal });
          Object.assign(res, { ok: true, parsed: r.out, raw_text: r.text.slice(0, 20000), ms: r.ms, model_applied: r.modelApplied, tier_applied: r.modelTierApplied });
        } catch (e) {
          Object.assign(res, { ok: false, error: (e && e.code) || "error", raw_text: e && e.text ? String(e.text).slice(0, 20000) : "" });
        }
        if (res.error !== "cancelled") await Store.saveResult(run.id, res);
        return res;
      }));
      line.lastChild.innerHTML = outcomes.map((o) => `${o.slot} ${o.ok ? `<span class="${o.model_applied === o.model_requested ? "ok" : "warnc"}">${o.model_applied === o.model_requested ? "ok" : "answered by " + esc(o.model_applied || o.tier_applied || "another model")}</span>` : `<span class="bad">${esc(o.error)}</span>`}`).join(" · ");
      const codes = outcomes.map((o) => o.error);
      if (codes.includes("cancelled")) stopReason = "Run stopped. Results so far are saved.";
      else if (codes.includes("rate_limited")) stopReason = (App.hosting === "claude" ? "Claude usage limit reached." : "The server's per minute limit was reached.") + " Results so far are saved; start a new run later for the rest.";
      else if (codes.includes("rate_limited_day")) stopReason = "Today's scan limit is used up. Results so far are saved. Add your tester key in Settings to test without the daily limit.";
      else if (codes.includes("network")) stopReason = "The connection dropped, so the run stopped. Results so far are saved; start a new run when you're back online.";
      else if (codes.some((c) => ["not_granted", "sampling_disabled", "session_expired", "not_configured", "origin_not_allowed", "tester_only", "no_credit", "key_rejected", "scanning_off"].includes(c))) stopReason = App.errText({ code: codes.find((c) => ["not_granted", "sampling_disabled", "session_expired", "not_configured", "origin_not_allowed", "tester_only", "no_credit", "key_rejected"].includes(c)) });
    }
    run.status = stopReason ? "stopped" : "done"; run.finished = new Date().toISOString();
    await Store.saveRun(run);
    running = null;
    st.textContent = stopReason || "Run finished. Open Results to see the comparison.";
    $("tStart").disabled = !App.claudeSample; $("tStop").hidden = true;
  }

  // ================= UI: results =================
  async function renderResults() {
    const box = $("tResults");
    box.innerHTML = `<div class="card empty">Loading results…</div>`;
    const runs = await Store.listRuns();
    if (!runs.length) { box.innerHTML = `<div class="card empty">No runs yet. Start one in the Run tab.</div>`; return; }
    const chosen = App.store.get("thali.testRun", runs[0].id);
    const run = runs.find((r) => r.id === chosen) || runs[0];
    const results = await Store.listResults(run.id);
    const photos = {}; allPhotos().forEach((p) => photos[p.id] = p);
    const rows = [];
    results.forEach((res) => { const p = photos[res.photo_id]; if (p) rows.push(...evaluate(run, p, res)); });
    const dishRows = (slot) => rows.filter((r) => r.model_slot === slot && r.level === "dish");
    const plateRows = (slot) => rows.filter((r) => r.model_slot === slot && r.level === "plate" && r.true_g != null);
    const A = run.models[0], B = run.models[1];
    const sA = summarize(dishRows("A")), sB = summarize(dishRows("B")), pA = summarize(plateRows("A")), pB = summarize(plateRows("B"));
    const applied = (slot) => [...new Set(results.filter((r) => r.slot === slot && r.ok).map((r) => r.model_applied || "not reported (tier " + (r.tier_applied || "?") + ")"))].join(", ") || "–";
    const fails = results.filter((r) => !r.ok).length;

    // better = lower absolute error, higher share for "named" and "inside range"
    const cmpRow = ([k, label, unit, dir], a, b) => {
      let ca = "", cb = "";
      if (a[k] != null && b[k] != null && dir !== 0 && a[k] !== b[k]) {
        const aBetter = dir === 1 ? a[k] > b[k] : dir === -2 ? Math.abs(a[k]) < Math.abs(b[k]) : a[k] < b[k];
        ca = aBetter ? "better" : ""; cb = aBetter ? "" : "better";
      }
      return `<tr><td>${esc(label)}</td><td class="${ca}">${fmt(a[k], unit, dir === -2)}</td><td class="${cb}">${fmt(b[k], unit, dir === -2)}</td></tr>`;
    };
    const byType = (slot) => TYPES.map((t) => { const l = dishRows(slot).filter((r) => r.dish_type === t && r.true_g != null); return l.length ? [t, summarize(l)] : null; }).filter(Boolean);
    const typeTable = (m) => `
      <h3>${esc(m.label)} by dish type</h3>
      <div class="table-wrap"><table>
        <thead><tr><th>Type</th><th>n</th><th>g MAPE</th><th>g median APE</th><th>g MAE</th><th>g bias</th><th>kcal MAPE</th><th>kcal median APE</th><th>kcal bias</th><th>Named</th></tr></thead>
        <tbody>${byType(m.slot).map(([t, s]) => `<tr><td>${esc(t)}</td><td>${s.n}</td><td>${fmt(s.g_mape, "%")}</td><td>${fmt(s.g_mdape, "%")}</td><td>${fmt(s.g_mae, "g")}</td><td>${fmt(s.g_bias, "g", true)}</td><td>${fmt(s.k_mape, "%")}</td><td>${fmt(s.k_mdape, "%")}</td><td>${fmt(s.k_bias, "kcal", true)}</td><td>${fmt(s.named, "%")}</td></tr>`).join("") || `<tr><td colspan="10">No scored dishes</td></tr>`}</tbody>
      </table></div>`;
    const detail = rows.filter((r) => r.level === "dish" || r.true_g != null).map((r) => `<tr>
        <td>${esc(r.photo_name)}${r.level === "plate" ? " · plate" : r.truth_item !== r.photo_name ? " · " + esc(r.truth_item) : ""}</td><td>${esc(r.model_slot)}</td>
        <td>${r.est_g_low != null ? `${r0(r.est_g_low)}–${r0(r.est_g_high)}` : "–"}</td><td>${r.true_g ?? "–"}</td><td>${r.pct_err_g == null ? "–" : r0(r.pct_err_g) + "%"}${r.tiny_portion ? " (tiny)" : ""}</td>
        <td>${r.est_kcal_low != null ? `${r0(r.est_kcal_low)}–${r0(r.est_kcal_high)}` : "–"}</td><td>${r.true_kcal == null ? "–" : r0(r.true_kcal)}</td><td>${r.pct_err_kcal == null ? "–" : r0(r.pct_err_kcal) + "%"}</td>
        <td>${r.named_correctly == null ? "–" : r.named_correctly ? "yes" : "no"}${r.components_found ? " " + esc(r.components_found) : ""}</td><td>${esc(r.note)}</td></tr>`).join("");

    box.innerHTML = `
      <div style="display:grid;gap:14px">
        <div class="card form">
          <label>Run<select id="tRunPick">${runs.map((r) => `<option value="${r.id}" ${r.id === run.id ? "selected" : ""}>${esc(new Date(r.created).toLocaleString())} · ${esc(r.models.map((m) => m.label).join(" vs "))} · ${esc(r.status)}</option>`).join("")}</select></label>
          <div class="small muted">Prompt ${esc(run.prompt_version)} · ${results.length} results · ${fails} failed.
            Model A asked for ${esc(A.id)}, answered by ${esc(applied("A"))}. Model B asked for ${esc(B.id)}, answered by ${esc(applied("B"))}.
            PDF photos are scored against the PDF's printed estimates.</div>
        </div>
        ${results.some((r) => r.ok && r.model_applied !== r.model_requested) ? `<div class="notice">Some answers did not come from the model that was asked for (the platform used another model or tier). Treat this comparison with care; the CSV shows which model answered each photo.</div>` : ""}
        <h2>Model comparison (each dish)</h2>
        <div class="table-wrap"><table>
          <thead><tr><th>Measure</th><th>A · ${esc(A.label)}</th><th>B · ${esc(B.label)}</th></tr></thead>
          <tbody>${METRICS.map((m) => cmpRow(m, sA, sB)).join("")}</tbody>
        </table></div>
        <h2>Plate totals</h2>
        <div class="table-wrap"><table>
          <thead><tr><th>Measure</th><th>A · ${esc(A.label)}</th><th>B · ${esc(B.label)}</th></tr></thead>
          <tbody>${METRICS.filter((m) => m[0] !== "named").map((m) => cmpRow(m, pA, pB)).join("")}</tbody>
        </table></div>
        ${typeTable(A)}${typeTable(B)}
        <h2>Every photo</h2>
        <div class="table-wrap"><table>
          <thead><tr><th>Photo</th><th>Model</th><th>Est g (80% range)</th><th>True g</th><th>g error</th><th>Est kcal (range)</th><th>True kcal</th><th>kcal error</th><th>Named</th><th>Note</th></tr></thead>
          <tbody>${detail || `<tr><td colspan="10">No results</td></tr>`}</tbody>
        </table></div>
        <div class="row"><button class="btn" id="tCsv1">Export detail CSV</button><button class="btn" id="tCsv2">Export summary CSV</button></div>
        <div class="status" id="tCsvStatus" role="status" aria-live="polite"></div>
        <div class="card" id="tCsvBox" hidden><p class="small muted">Downloads are not available here. Copy the CSV below.</p><textarea class="csv" readonly></textarea><button class="btn btn-small" id="tCopy">Copy</button></div>
        <p class="small muted">MAPE = mean absolute percentage error. Bias = mean signed error (positive means the model overestimates). Percentages leave out true portions under ${TINY_G} g. Ranges are the model's 80% ranges, with calories from the food table.</p>
      </div>`;
    $("tRunPick").onchange = (e) => { App.store.set("thali.testRun", e.target.value); renderResults(); };
    const stamp = App.dateStr(new Date(run.created));   // the local date, not UTC
    $("tCsv1").onclick = () => saveCSV(`thali-test-${stamp}-detail.csv`, toCSV(DETAIL_COLS, rows), $("tCsvBox"));
    $("tCsv2").onclick = () => saveCSV(`thali-test-${stamp}-summary.csv`, toCSV(SUMMARY_COLS, summaryRows(run, rows)), $("tCsvBox"));
    $("tCopy").onclick = async () => {
      const t = $("tCsvBox").querySelector("textarea"); let ok = false;
      try { await navigator.clipboard.writeText(t.value); ok = true; }
      catch (e) { t.focus(); t.select(); try { ok = document.execCommand("copy"); } catch (e2) {} }
      $("tCsvStatus").textContent = ok ? "Copied. Paste it into a spreadsheet or a note." : "Press and hold the text in the box, then Select all and Copy.";
    };
  }

  // ================= screen =================
  App.views.test = {
    init() { document.querySelectorAll("[data-tab]").forEach((b) => b.onclick = () => showTab(b.dataset.tab)); },
    async show() {
      $("tSet").innerHTML = `<div class="card empty">Loading test data…</div>`;
      await Store.init();
      uploads = await Store.listPhotos();
      showTab(tab);
    },
  };

  // Exposed for checking the maths by hand.
  App.testMath = { evaluate, summarize, assign, named, trueKcal, toCSV, DETAIL_COLS, pdfPhotos };
  App.TestData = { deleteAll: () => Store.deleteAll() };
})();
