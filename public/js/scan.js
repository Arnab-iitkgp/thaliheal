/* scan.js: the scan screen. Photo in, editable list of dishes out, with ranges and confidence. */
(function () {
  "use strict";
  const { $, esc, r0, r1 } = App;
  const S = { items: [], ctx: "home", demo: true, blob: null, ctl: null, scanned: false, log: null, savedSig: null };

  // ---------- render ----------
  function render() {
    $("demoTag").hidden = !S.demo;
    logCard();
    const box = $("items");
    if (!S.items.length) { box.innerHTML = `<div class="card empty">No dishes yet. ${App.aiEnabled ? "Scan a photo or add a dish." : "Add a dish to start."}</div>`; totals(); return; }
    box.innerHTML = S.items.map(cardHTML).join("");
    S.items.forEach(bindCard);
    totals();
  }

  function sliderMax(it) { const d = App.byId[it.dishId]; const ug = d ? d.units[it.unitIdx].g : 100; return Math.max(ug * 4, Math.ceil(it.grams * 2 / 10) * 10, 100); }
  function stepFor(unit) { return /piece|slice|scoop|can|cup|glass|leg|half|packet|portion|tablespoon|plate \(/.test(unit.name) ? 1 : 0.5; }

  function cardHTML(it) {
    const dish = App.byId[it.dishId];
    const c = App.conf(it);
    const unit = dish ? dish.units[it.unitIdx] : null;
    const unitSel = dish && dish.units.length > 1
      ? `<select data-k="unit" aria-label="Household measure">${dish.units.map((u, i) => `<option value="${i}" ${i === it.unitIdx ? "selected" : ""}>${esc(u.name)}</option>`).join("")}</select>`
      : `<span data-r="unitname">${unit ? esc(unit.name) : "g"}</span>`;
    let oilBlock = "";
    if (dish && dish.added_fat) {
      oilBlock = it.oil.on ? `
      <div class="oil">
        <div class="oil-top">
          <label for="oil-${it.uid}">Added fat</label>
          <select data-k="oiltype" aria-label="Fat type">${Object.keys(App.fats).map((k) => `<option value="${k}" ${k === it.oil.type ? "selected" : ""}>${esc(App.fats[k].name)}</option>`).join("")}</select>
          <span class="pill ${it.oil.manual ? "user" : "low"}">${it.oil.manual ? "Adjusted" : "Low · estimate"}</span>
        </div>
        <input type="range" id="oil-${it.uid}" data-k="oilg" min="0" max="${Math.max(20, Math.ceil(it.oil.g * 2.5))}" step="0.5" value="${it.oil.g}">
        <div class="oil-read" data-r="oil"></div>
      </div>` : `<button class="add-fat" data-k="addfat">＋ Add ${esc(App.fats[dish.added_fat.type].name.toLowerCase())}</button>`;
    }
    const name = dish ? dish.name : "Unknown: " + it.label;
    return `<article class="card item" data-uid="${it.uid}">
      <div class="item-top">
        <button class="dish-btn ${dish ? "" : "unknown"}" data-k="pick" aria-label="Change dish: ${esc(name)}">${esc(name)} <span class="edit">change</span></button>
        <span class="pill ${c.cls}" title="${esc(c.why)}">${c.label}</span>
        <button class="icon-btn" data-k="del" aria-label="Remove ${esc(name)}">✕</button>
      </div>
      <div class="why">${esc(c.why)}</div>
      ${dish ? `
      <div class="measure">
        <button class="stepper" data-k="minus" aria-label="Less">−</button>
        <div class="measure-read"><b data-r="count"></b> ${unitSel}<small data-r="grams"></small></div>
        <button class="stepper" data-k="plus" aria-label="More">＋</button>
      </div>
      <input type="range" data-k="grams" aria-label="Portion in grams" min="0" max="${sliderMax(it)}" step="${it.grams < 60 ? 1 : 5}" value="${r0(it.grams)}">
      <div class="nut" data-r="nut"></div>
      ${oilBlock}` : ""}
    </article>`;
  }

  function bindCard(it) {
    const el = document.querySelector(`[data-uid="${it.uid}"]`); if (!el) return;
    const dish = App.byId[it.dishId];
    el.querySelector('[data-k="pick"]').onclick = () => App.openPicker((d) => {
      it.dishId = d.id; it.label = d.name; it.unitIdx = 0; it.confirmed = true;
      it.oil = { type: d.added_fat ? d.added_fat.type : "oil", g: 0, manual: false, level: it.oil.level, on: false };
      if (!(it.grams > 0)) it.grams = d.units[0].g;
      App.resetOil(it); edited(); render();
    });
    el.querySelector('[data-k="del"]').onclick = () => { S.items = S.items.filter((x) => x !== it); edited(); render(); };
    if (!dish) return;
    const range = el.querySelector('[data-k="grams"]');
    range.oninput = () => { it.grams = Number(range.value); App.resetOil(it); update(it); };
    range.onchange = edited;
    const step = (dir) => {
      const u = dish.units[it.unitIdx], st = stepFor(u);
      const n = Math.max(0, Math.round(it.grams / u.g / st) * st + dir * st);
      it.grams = Math.round(n * u.g); App.resetOil(it);
      if (it.grams > Number(range.max)) range.max = sliderMax(it);
      range.value = it.grams; update(it); edited();
    };
    el.querySelector('[data-k="minus"]').onclick = () => step(-1);
    el.querySelector('[data-k="plus"]').onclick = () => step(1);
    const us = el.querySelector('[data-k="unit"]'); if (us) us.onchange = () => { it.unitIdx = Number(us.value); update(it); };
    const og = el.querySelector('[data-k="oilg"]');
    if (og) og.oninput = () => {
      it.oil.g = Number(og.value);
      if (!it.oil.manual) { it.oil.manual = true; const p = el.querySelector(".oil .pill"); p.className = "pill user"; p.textContent = "Adjusted"; }
      update(it);
    };
    const ot = el.querySelector('[data-k="oiltype"]'); if (ot) ot.onchange = () => { it.oil.type = ot.value; update(it); };
    const af = el.querySelector('[data-k="addfat"]'); if (af) af.onclick = () => { it.oil.on = true; it.oil.manual = true; it.oil.g = it.oil.g || 3; render(); };
    update(it);
  }

  // Refresh one card's numbers without rebuilding it (keeps the slider under the finger).
  function update(it) {
    const el = document.querySelector(`[data-uid="${it.uid}"]`); const dish = App.byId[it.dishId];
    if (!el || !dish) { totals(); return; }
    const u = dish.units[it.unitIdx], n = it.grams / u.g;
    el.querySelector('[data-r="count"]').textContent = App.fmtCount(n);
    const un = el.querySelector('[data-r="unitname"]'); if (un) un.textContent = App.plural(u.name, n);
    const rg = App.rangeItem(it), c = App.calcItem(it);
    el.querySelector('[data-r="grams"]').textContent = `${App.range(rg.g[0], rg.g[1], "g")} · best guess ${r0(it.grams)} g`;
    el.querySelector('[data-r="nut"]').innerHTML =
      `<span><b>${App.range(rg.kcal[0], rg.kcal[1])}</b> kcal</span><span>best ${r0(c.total.kcal)}</span>` +
      `<span>P ${r1(c.total.protein)} g</span><span>C ${r1(c.total.carbs)} g</span><span>F ${r1(c.total.fat)} g</span>` +
      `<span>Fibre ${r1(c.total.fibre)} g</span><span>Sugar ${r1(c.total.sugar)} g</span>`;
    const or = el.querySelector('[data-r="oil"]');
    if (or) {
      const tsp = it.oil.g / 4.5;
      or.textContent = `${r1(it.oil.g)} g (about ${App.fmtCount(tsp)} tsp) · ${r0(c.oil.kcal)} kcal · ${it.oil.manual ? "set by you" : "range 0.6x to 1.5x of this"}`;
      const og = el.querySelector('[data-k="oilg"]'); if (og && Number(og.value) !== it.oil.g) og.value = it.oil.g;
    }
    totals();
  }

  function totals() {
    const t = { kcal: 0, protein: 0, carbs: 0, fat: 0, fibre: 0, sugar: 0 }; let lo = 0, hi = 0, oilK = 0;
    const order = { low: 0, medium: 1, high: 2, user: 3 }; let worst = null;
    S.items.forEach((it) => {
      const c = App.calcItem(it), rg = App.rangeItem(it);
      App.NUTS.forEach((k) => t[k] += c.total[k]); lo += rg.kcal[0]; hi += rg.kcal[1]; oilK += c.oil.kcal;
      const cl = App.conf(it); if (!worst || order[cl.cls] < order[worst.cls]) worst = cl;
    });
    $("tKcal").innerHTML = S.items.length ? `${App.range(lo, hi)} <small>kcal · best ${r0(t.kcal)}</small>` : `0 <small>kcal</small>`;
    $("tConf").textContent = worst ? (worst.cls === "user" ? "set by you" : `${worst.label} confidence`) : "";
    ["P:protein", "C:carbs", "F:fat", "Fib:fibre", "S:sugar"].forEach((p) => { const [id, k] = p.split(":"); $("t" + id).textContent = r1(t[k]) + " g"; });
    $("tFatNote").textContent = oilK > 0 ? `incl. ${r0(oilK)} kcal added fat` : "";
    const e = t.protein * 4 + t.carbs * 4 + t.fat * 9 || 1;
    $("bP").style.width = (t.protein * 4 / e * 100) + "%"; $("bC").style.width = (t.carbs * 4 / e * 100) + "%"; $("bF").style.width = (t.fat * 9 / e * 100) + "%";
  }
  function edited() { if (S.demo) { S.demo = false; $("demoTag").hidden = true; } }
  function setStatus(msg, err) { $("status").textContent = msg; $("status").classList.toggle("err", !!err); }

  function setCtx(c) {
    S.ctx = c;
    document.querySelectorAll("#ctx button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.ctx === c)));
    S.items.forEach((it) => { it.ctx = c; App.resetOil(it); }); render();
  }

  // ---------- photo ----------
  function shrink(file) {
    return new Promise((res, rej) => {
      const img = new Image(), url = URL.createObjectURL(file);
      img.onload = () => {
        const s = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
        const cv = document.createElement("canvas"); cv.width = Math.round(img.naturalWidth * s); cv.height = Math.round(img.naturalHeight * s);
        cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height); URL.revokeObjectURL(url);
        cv.toBlob((b) => b ? res(b) : rej(new Error("encode")), "image/jpeg", 0.85);
      };
      img.onerror = () => { URL.revokeObjectURL(url); rej(new Error("decode")); };
      img.src = url;
    });
  }
  App.shrinkPhoto = shrink;   // test mode reuses it for uploaded test photos

  // ---------- scan ----------
  const ERR = {
    not_granted: "Scanning was not allowed. You can still add dishes by hand.",
    sampling_disabled: "Claude is not available for this account. You can still add dishes by hand.",
    rate_limited: "Too many scans for now. Wait a minute, then try again.",
    session_expired: "Please sign in to Claude again, then retry.",
    image_rejected: "That photo could not be used. Try a JPEG or PNG under 20 MB.",
    images_unavailable: "Photo scanning is not available in this view.",
    refused: "The photo could not be analysed. Try a different photo.",
    invalid_json: "The scan reply was unreadable. Tap Scan plate to try again.",
    empty_completion: "The scan came back empty. Try a clearer photo.",
    rate_limited_day: "You've reached today's scan limit. It resets at midnight. You can still add dishes by hand.",
    too_large: "That photo is too large to send. Try a smaller photo.",
    image_too_large: "That photo is too large to send. Try a smaller photo.",
    busy: "The scanner is busy right now. Try again in a minute.",
    not_configured: "Scanning is not set up on this site yet. You can still add dishes by hand.",
    network: "You seem to be offline. Try again when you're back online.",
    upstream_timeout: "The scan took too long. Try again.",
    timeout: "No answer after a long wait, which usually means a slow connection. Try again on Wi-Fi or with a stronger signal.",
    no_credit: "Scanning is paused: the app's AI credit has run out. You can still add dishes by hand.",
    key_rejected: "Scanning is paused: the server's AI key was refused. You can still add dishes by hand.",
    tester_only: "The tester key was not accepted. Check it in Settings, or clear it to scan normally.",
    cancelled: "Stopped.",
    scanning_off: "Photo scanning is coming soon. For now, add the dishes on your plate by hand with “Add a dish”.",
    origin_not_allowed: `This site is not on the server's allowed list yet. Add ${location.origin} to ALLOWED_ORIGINS on Vercel and redeploy.`,
  };
  App.errText = (e) => ERR[e && e.code] || "Something went wrong. Try again.";

  async function scan() {
    if (!App.claudeSample || !S.blob) return;
    S.ctl = new AbortController();
    $("scanBtn").disabled = true; $("stopBtn").hidden = false;
    setStatus("Looking at your plate… this can take 20 to 40 seconds.");
    // On a slow connection the upload alone can take half a minute: say so, and that Stop still works.
    const slow = [
      setTimeout(() => setStatus("Still working. A slow connection can add up to a minute. Tap Stop to cancel."), 45000),
      setTimeout(() => setStatus("Still waiting for the answer. The app gives up at 100 seconds."), 80000),
    ];
    App.Facts.quiet("view", false); App.Facts.showNow();   // the one place a fact shows on purpose
    try {
      const r = await App.askModel(S.blob, { signal: S.ctl.signal, modelTier: "default" });
      const m = App.itemsFromModel(r.out);
      S.items = m.items; S.ctx = m.ctx; S.demo = false; S.scanned = true;
      document.querySelectorAll("#ctx button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.ctx === S.ctx)));
      render();
      const n = S.items.length;
      setStatus(n ? `Found ${n} item${n === 1 ? "" : "s"}. Check each one and fix names or portions.${m.note ? " " + m.note : ""}` : `No food found in the photo.${m.note ? " " + m.note : ""}`);
    } catch (e) {
      if (e && e.code === "cancelled") setStatus("Scan stopped.");
      else {
        setStatus(App.errText(e), true);
        if (e && ["not_granted", "sampling_disabled", "images_unavailable", "not_declared", "capability_disabled"].includes(e.code)) noScan();
      }
    } finally {
      slow.forEach(clearTimeout);
      $("stopBtn").hidden = true; $("scanBtn").disabled = !App.claudeSample || !S.blob; S.ctl = null;
      if (App.current === "scan") App.Facts.quiet("view", true);
    }
  }
  // ---------- photos ----------
  // Any photo (live camera, file upload, drop, paste, sample) ends up here: shrunk to a 1600 px JPEG and previewed.
  async function usePhotoBlob(blob, label) {
    setStatus("");
    try {
      S.blob = await shrink(blob);   // phone photos of several MB come down well under the upload limit
      $("previewImg").src = URL.createObjectURL(S.blob);
      $("photoMeta").textContent = `${label ? label + ": " : ""}${Math.round(S.blob.size / 1024)} KB, ready to scan`;
      $("preview").hidden = false;
      $("scanBtn").disabled = !App.claudeSample;
      return true;
    } catch (err) { setStatus("That file could not be read as a photo. Try a JPEG or PNG.", true); return false; }
  }

  // Three ways in, all in the browser: the live camera (js/camera.js), a file from the gallery or computer,
  // and on desktop a photo dropped on the box or pasted with Ctrl+V.
  function photoInputs() {
    const pick = async (e) => {
      const f = e.target.files && e.target.files[0]; if (!f) return;
      try { await usePhotoBlob(f, "Uploaded photo"); }
      finally { e.target.value = ""; }   // lets the same photo be picked again
    };
    $("photo").onchange = pick;
    $("photoCam").onchange = async (e) => {   // fallback: the phone's own camera app, when the live camera can't open
      const f = e.target.files && e.target.files[0]; if (!f) return;
      try { await usePhotoBlob(f, "Camera photo"); } finally { e.target.value = ""; }
    };
    $("camBtn").onclick = () => App.Camera.open({
      onPhoto: (blob) => usePhotoBlob(blob, "Camera photo"),
      onFallback: (msg) => { setStatus(msg, true); if (App.Camera.phoneLike()) $("photoCam").click(); },
    });
    const drop = document.querySelector(".drop");
    const isImage = (f) => f && /^image\//.test(f.type);
    ["dragenter", "dragover"].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add("over"); }));
    ["dragleave", "dragend"].forEach((t) => drop.addEventListener(t, () => drop.classList.remove("over")));
    drop.addEventListener("drop", (e) => {
      e.preventDefault(); drop.classList.remove("over");
      const f = [...((e.dataTransfer && e.dataTransfer.files) || [])].find(isImage);
      if (f) usePhotoBlob(f, "Dropped photo"); else setStatus("That is not a photo. Drop a JPEG, PNG or WebP image.", true);
    });
    document.addEventListener("paste", (e) => {
      if (App.current !== "scan" || /^(INPUT|TEXTAREA)$/.test((e.target && e.target.tagName) || "")) return;
      const f = [...((e.clipboardData && e.clipboardData.files) || [])].find(isImage);
      if (f) { e.preventDefault(); usePhotoBlob(f, "Pasted photo"); }
    });
  }

  // ---------- save to my log ----------
  const sig = () => JSON.stringify([$("logDate").value, $("logSlot").value, S.items.map((it) => [it.dishId, it.grams, it.oil.on && it.oil.g])]);
  function logStatus(html, err) { const el = $("logStatus"); el.innerHTML = html; el.classList.toggle("err", !!err); }
  function logCard() {
    if (!$("logDate").value) $("logDate").value = (S.log && S.log.date) || App.today();
    $("logDate").max = App.today();
    $("logBanner").hidden = !S.log;
    if (S.log) $("logBanner").textContent = `Adding to ${App.SLOTS[S.log.slot]}, ${App.fmtDate(S.log.date)}. Scan a photo or add dishes, then save below.`;
  }
  async function saveToLog() {
    if (S.demo) return logStatus("This is the example plate. Scan your own plate or add dishes first.", true);
    if (!S.items.length) return logStatus("Add at least one dish first.", true);
    if (!$("logDate").value || $("logDate").value > App.today()) return logStatus("Pick today or an earlier date.", true);
    if (S.savedSig === sig()) return logStatus(`Already saved. <a href="#track">Open my log</a>`);
    await App.Account.getDoc();
    if (!App.Account.hasConsent()) return logStatus(`First read how your data is used and set up your profile; your plate stays here. <a href="#consent">Read and agree</a>`, true);
    if (!App.Account.cache.doc.profile) return logStatus(`Set up your profile first; your plate stays here. <a href="#profile">Set up profile</a>`, true);
    const meal = App.mealFromItems(S.items, { date: $("logDate").value, slot: $("logSlot").value, source: S.scanned ? "scan" : "manual", ctx: S.ctx });
    $("logSave").disabled = true;
    try {
      await App.Account.saveMeal(meal);
      S.savedSig = sig(); S.log = null; logCard();
      const unk = meal.totals.unknown ? ` ${meal.totals.unknown} item not in the food table was saved with no nutrients.` : "";
      logStatus(`Saved to ${App.SLOTS[meal.slot]}, ${App.fmtDate(meal.date)}: ${App.range(meal.totals.kcal_lo, meal.totals.kcal_hi)} kcal.${unk} <a href="#track">Open my log</a>`);
    } catch (e) { logStatus("Could not save. Try again.", true); }
    finally { $("logSave").disabled = false; }
  }

  function noScan() {
    if (App.hosting === "web") $("noScan").textContent = !(App.net.offline || !navigator.onLine)
      ? "Photo scanning is not set up on this site yet. You can still build a plate by hand with “Add a dish”."
      : "You're offline. Scanning comes back when you're online; you can still build a plate by hand with “Add a dish”.";
    $("noScan").hidden = false; $("scanBtn").hidden = true;
  }

  function demo() {
    S.items = [
      App.newItem("plain_rice", 180, { origin: "demo", aiConf: 0.92, spread: [0.85, 1.2] }),
      App.newItem("dal_tadka", 150, { origin: "demo", aiConf: 0.84, spread: [0.8, 1.25] }),
      App.newItem("chapati", 76, { origin: "demo", aiConf: 0.95, spread: [0.9, 1.1] }),
      App.newItem("bhindi_masala", 110, { origin: "demo", aiConf: 0.71, oil: "high", spread: [0.7, 1.35] }),
      App.newItem("salad", 60, { origin: "demo", aiConf: 0.62 }),
      App.newItem("pickle", 10, { origin: "demo", aiConf: 0.4 }),
    ];
    S.demo = true;
  }

  App.views.scan = {
    init() {
      demo();
      document.querySelectorAll("#ctx button").forEach((b) => b.onclick = () => setCtx(b.dataset.ctx));
      $("scanBtn").onclick = scan;
      $("stopBtn").onclick = () => S.ctl && S.ctl.abort();
      $("addBtn").onclick = () => App.openPicker((d) => { S.items.push(App.newItem(d.id, null, { origin: "manual", ctx: S.ctx })); edited(); render(); });
      $("clearBtn").onclick = () => { S.items = []; edited(); render(); setStatus(""); };
      App.Camera.init();
      photoInputs();
      $("logSlot").innerHTML = Object.entries(App.SLOTS).map(([k, v]) => `<option value="${k}">${v}</option>`).join("");
      $("logSlot").value = App.slotNow();
      $("logSave").onclick = saveToLog;
      $("dataMeta").textContent = `Food table v${App.meta.version || "?"}: ${App.dishes.length} dishes. ${App.meta.licence_note || ""}`;
    },
    show() { render(); },
    // Open the scan screen to log a meal for a given day and slot (from the log screen).
    startLog(o) {
      if (S.demo || S.savedSig === sig()) { S.items = []; S.demo = false; S.scanned = false; }   // start fresh unless an unsaved plate is waiting
      S.log = { date: o.date, slot: o.slot }; S.savedSig = null;
      $("logDate").value = o.date; $("logSlot").value = o.slot; logStatus("");
    },
    // Load one of the home screen sample photos and scan it straight away.
    async usePhoto(url, label) {
      let blob;
      try { blob = await (await fetch(url)).blob(); } catch (err) { return setStatus("That sample photo could not be loaded.", true); }
      if (!(await usePhotoBlob(blob, `${label}, sample`))) return;
      if (App.claudeSample) scan(); else noScan();
    },
    pendingPlate: () => !S.demo && S.items.length > 0 && S.savedSig !== sig(),
    onClaude(ok) {
      if (!App.aiEnabled) { $("noScan").hidden = true; return; }   // scan off mode: the page says "coming soon" itself
      if (ok) { $("noScan").hidden = true; $("scanBtn").hidden = false; $("scanBtn").disabled = !S.blob; }
      else noScan();
    },
  };
})();
