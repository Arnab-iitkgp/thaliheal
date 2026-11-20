/* home.js: home screen (Scan me + Sample dishes), sample dish pages and settings. */
(function () {
  "use strict";
  const { $, esc, r0, r1 } = App;

  // ---------- home ----------
  App.views.home = {
    init() {
      $("sampleNote").textContent = `${App.samples.length} dishes with reference values from your dishes PDF. Tap one for details.`;
      $("sampleGrid").innerHTML = App.samples.map((d) => `
        <a class="dish-card" href="#dish-${d.id}">
          <img src="${esc(d.photo)}" alt="${esc(d.name)}" loading="lazy">
          <b>${esc(d.name)}</b>
          <span>${d.kcal != null ? d.kcal + " kcal" : "kcal not given"} · ${d.weight_g != null ? d.weight_g + " g" : "weight not given"}</span>
        </a>`).join("");
    },
    show() {
      $("homeTestChip").hidden = !App.testModeOn() || !App.aiEnabled;
      document.querySelectorAll("[data-plate]").forEach((b) => b.onclick = () => {
        if (!App.aiEnabled) { location.hash = "#soon"; return; }
        location.hash = "#scan";
        App.views.scan.usePhoto(`img/plates/${b.dataset.plate}.jpg`, b.dataset.label);
      });
      // Today's logged energy against the target, once the profile is set.
      (async () => {
        const doc = await App.Account.getDoc();
        if (!doc || !doc.profile) { $("homeLogLine").textContent = "Daily, weekly and monthly trends"; $("homeProfileLine").textContent = "Set up for your ICMR NIN 2020 targets"; return; }
        const t = App.Targets.compute(doc.profile);
        const hide = App.store.get("thali.hideNumbers", false) === true;
        $("homeProfileLine").textContent = !t.ok ? "Targets off for your profile" : hide ? "Your daily targets" : `Aim ${Math.round(t.energy.lo).toLocaleString("en-IN")} to ${Math.round(t.energy.hi).toLocaleString("en-IN")} kcal a day`;
        const today = App.today(), meals = (await App.Account.meals()).filter((m) => m.date === today);
        const k = meals.reduce((a, m) => a + (m.totals.kcal || 0), 0);
        const nm = `${meals.length} meal${meals.length === 1 ? "" : "s"}`;
        $("homeLogLine").textContent = !meals.length ? "Nothing logged today" : hide ? `Today: ${nm} logged` : `Today: ${Math.round(k).toLocaleString("en-IN")} kcal in ${nm}`;
      })().catch(() => {});
    },
  };

  // ---------- sample dish page ----------
  const v = (x, unit) => (x == null || x === "" ? `<span class="muted">not given</span>` : `${esc(x)}${unit ? " " + unit : ""}`);
  App.views.dish = {
    show(id) {
      const d = App.samplesById[id];
      if (!d) { $("dishPage").innerHTML = `<div class="card empty">That dish was not found. <a href="#home">Back to home</a></div>`; return; }
      // Oil note: plain arithmetic on the PDF value, 1 teaspoon of oil or ghee is about 5 g, 45 kcal and 5 g fat.
      const oilNote = d.kcal != null
        ? `Oil and ghee move these numbers a lot. Each teaspoon (about 5 g) adds about 45 kcal and 5 g fat. Cooked with 1 teaspoon less to 1 tablespoon (3 teaspoons) more than the recipe, this serving would be about <b>${r0(d.kcal - 45)} to ${r0(d.kcal + 135)} kcal</b>, with fat about ${r1(Math.max(0, d.fat - 5))} to ${r1(d.fat + 15)} g.`
        : `Oil and ghee move these numbers a lot. Each teaspoon (about 5 g) adds about 45 kcal and 5 g fat.`;
      $("dishPage").innerHTML = `
        <div style="display:grid;gap:14px">
          <img class="hero-img" src="${esc(d.photo)}" alt="${esc(d.name)}">
          <div>
            <h1>${esc(d.name)}</h1>
            <p class="sub">${esc(d.diet)} · ${esc(d.section)}</p>
          </div>
          <span class="tag ref" style="justify-self:start">Reference values from your dishes PDF</span>
          <div class="card" style="display:grid;gap:12px">
            <dl class="kv">
              <dt>Serving</dt><dd>${v(d.serving)}</dd>
              <dt>Weight</dt><dd>${d.weight_g != null ? `${d.weight_note ? esc(d.weight_note) + " " : ""}${d.weight_g} g` : v(null)}</dd>
            </dl>
            <div class="facts">
              <div><b>${d.kcal ?? "–"}</b><span>kcal</span></div>
              <div><b>${d.protein != null ? d.protein + " g" : "–"}</b><span>Protein</span></div>
              <div><b>${d.carbs != null ? d.carbs + " g" : "–"}</b><span>Carbs</span></div>
              <div><b>${d.fat != null ? d.fat + " g" : "–"}</b><span>Fat</span></div>
              <div><b>${d.fibre != null ? d.fibre + " g" : "–"}</b><span>Fibre</span></div>
            </div>
          </div>
          <div class="card small">${oilNote}</div>
          <p class="small muted">Source: ${esc(App.sampleMeta.source || "your dishes PDF")}. ${esc(App.sampleMeta.note || "")} A dash means the PDF gives no value.</p>
        </div>`;
    },
  };

  // ---------- settings ----------
  function paintSwitch() {
    const on = App.testModeOn();
    $("testSwitch").setAttribute("aria-checked", String(on));
    $("openTest").hidden = !on;
    $("testerCard").hidden = !(on && App.hosting === "web");
    $("hideSwitch").setAttribute("aria-checked", String(App.store.get("thali.hideNumbers", false) === true));
  }
  // ---------- "Photo scanning coming soon" (scan off mode) ----------
  App.views.soon = {
    init() {
      $("soonSamples").onclick = (e) => {
        e.preventDefault(); location.hash = "#home";
        setTimeout(() => { const h = $("samplesHead"); if (h) h.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }); }, 60);
      };
    },
    show() {
      // If scanning is on after all, this screen has nothing to say: go to the real one.
      if (App.aiEnabled) { location.replace("#scan"); return; }
      $("soonDishes").textContent = App.dishes.length;
      $("soonSampleCount").textContent = App.samples.length;
    },
  };

  App.views.settings = {
    init() {
      $("testSwitch").onclick = () => { App.store.set("thali.testMode", !App.testModeOn()); paintSwitch(); };
      $("testerKey").value = App.store.get("thali.testerToken", "");
      $("testerKey").onchange = () => App.store.set("thali.testerToken", $("testerKey").value.trim());
      $("hideSwitch").onclick = () => { App.store.set("thali.hideNumbers", App.store.get("thali.hideNumbers", false) !== true); paintSwitch(); };
    },
    show() {
      paintSwitch();
      App.Account.init().then(() => { $("accountWhere").textContent = App.Account.whereText(); });
      $("settingsInfo").innerHTML = `Food table v${esc(App.meta.version || "?")}: ${App.dishes.length} dishes. Prompt: ${esc(App.PROMPT_VERSION)}. Test data is stored apart from everything else and is never used to change the scan prompt.`;
    },
  };
})();
