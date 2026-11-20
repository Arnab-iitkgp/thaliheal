/* tracker.js: the profile screen (#profile) and the meal log with trends (#track).
   Targets come from App.Targets (ICMR NIN 2020), food sources from App.Sources,
   storage from App.Account. */
(function () {
  "use strict";
  const { $, esc, r0, r1 } = App;
  const T = App.Targets;
  const num = (n) => Math.round(n).toLocaleString("en-IN");
  // "Hide calorie numbers" (Settings, or offered by the assistant): kcal figures are replaced by words.
  const hide = () => App.store.get("thali.hideNumbers", false) === true;
  const fmtV = (v, unit) => (unit === "g" || unit === "mg" && v < 20 ? r1(v) : num(v)) + " " + unit;

  // ===================================================== PROFILE =====================================================
  const BLANK = { age: "", sex: "", height: "", weight: "", waist: "", activity: "sedentary", goal: "maintain", diet: "vegetarian", stage: "none" };
  let draft = { ...BLANK };

  const seg = (name, opts, sel) => `<div class="seg" role="group" data-seg="${name}" style="grid-template-columns:repeat(${Object.keys(opts).length},1fr)">` +
    Object.entries(opts).map(([k, v]) => `<button type="button" data-v="${k}" aria-pressed="${k === sel}">${esc(v)}</button>`).join("") + `</div>`;

  function profileForm(doc) {
    return `
      <div class="card form" id="pForm">
        <div class="two">
          <label>Age (years)<input id="pAge" type="number" inputmode="numeric" min="18" max="100" value="${esc(draft.age)}"></label>
          <div><div class="flabel">Sex (for the equations)</div>${seg("sex", { female: "Female", male: "Male" }, draft.sex)}</div>
        </div>
        <div class="two">
          <label>Height (cm)<input id="pHeight" type="number" inputmode="decimal" min="120" max="220" value="${esc(draft.height)}"></label>
          <label>Weight (kg)<input id="pWeight" type="number" inputmode="decimal" min="30" max="250" step="0.1" value="${esc(draft.weight)}"></label>
        </div>
        <label>Waist (cm, optional)<input id="pWaist" type="number" inputmode="decimal" min="40" max="200" value="${esc(draft.waist)}"></label>
        <div><div class="flabel">Activity</div>
          <div class="choices" role="radiogroup">
            ${Object.entries(T.ACTIVITY).map(([k, a]) => `<button type="button" role="radio" data-act="${k}" aria-checked="${draft.activity === k}"><b>${a.label}</b><span>${a.desc}</span></button>`).join("")}
          </div>
        </div>
        <div><div class="flabel">Goal</div>${seg("goal", { lose: "Lose", maintain: "Maintain", gain: "Gain" }, draft.goal)}</div>
        <label>Diet type<select id="pDiet">${Object.entries(T.DIETS).map(([k, v]) => `<option value="${k}" ${draft.diet === k ? "selected" : ""}>${v}</option>`).join("")}</select></label>
        <label id="pStageWrap" ${draft.sex === "female" ? "" : "hidden"}>Life stage<select id="pStage">
          ${[["none", "None of these"], ["pregnant", "Pregnant"], ["breastfeeding", "Breastfeeding"], ["postmenopause", "After menopause"]].map(([k, v]) => `<option value="${k}" ${draft.stage === k ? "selected" : ""}>${v}</option>`).join("")}
        </select></label>
        <button class="btn btn-primary" id="pSave">${doc ? "Save changes" : "Save profile"}</button>
        <div class="status" id="pStatus" role="status" aria-live="polite"></div>
      </div>
      <div id="pPreview"></div>
      <div class="card profile-pref-card" id="profileSettingsCard">
        <div class="list-head">
          <h3>Preferences & Settings</h3>
          <a class="small" href="#settings">All settings →</a>
        </div>
        <div class="profile-pref-rows">
          <div class="profile-pref-row">
            <div>
              <b>Hide calorie numbers</b>
              <div class="small muted">Show calories as bands and words instead of figures for gentle tracking.</div>
            </div>
            <button class="switch accent" id="profileHideSwitch" role="switch" aria-checked="${App.store.get('thali.hideNumbers', false) === true}" aria-label="Hide calorie numbers"></button>
          </div>
          <div class="profile-pref-row">
            <div>
              <b>App installation</b>
              <div class="small muted" id="profileInstallStatus">${matchMedia('(display-mode: standalone)').matches || navigator.standalone === true ? 'Installed on home screen' : 'Run offline with fast one-tap home screen access'}</div>
            </div>
            <button class="btn btn-small" id="profileInstallBtn" type="button">${matchMedia('(display-mode: standalone)').matches || navigator.standalone === true ? 'Installed ✓' : 'Install app'}</button>
          </div>
          <div class="profile-pref-row">
            <div>
              <b>Privacy & Data Control</b>
              <div class="small muted">Your logs and targets are stored locally on this device.</div>
            </div>
            <a class="btn btn-small btn-ghost" href="#privacy">Manage data</a>
          </div>
        </div>
      </div>`;
  }

  function readForm() {
    const v = (id) => { const x = $(id); return x && x.value !== "" ? Number(x.value) : ""; };
    draft.age = v("pAge"); draft.height = v("pHeight"); draft.weight = v("pWeight"); draft.waist = v("pWaist");
    draft.diet = $("pDiet").value; draft.stage = draft.sex === "female" ? $("pStage").value : "none";
  }

  // The targets panel, shared by the profile preview and the log.
  function targetsHTML(t, p) {
    if (!t.ok) return `<div class="card notice">${esc(t.msg)}</div>`;
    const e = t.energy, rows = Object.values(t.n).filter((x) => x.kind !== "info" || x.label === "Vitamin A").map((x) => {
      const val = x.kind === "max" ? `up to ${fmtV(x.high, x.unit)}` : `${fmtV(x.low, x.unit)} to ${fmtV(x.high, x.unit)}`;
      return `<tr><td>${esc(x.label)}${x.kind === "info" ? ` <span class="muted">(shown only)</span>` : ""}</td><td>${val}</td></tr><tr class="src"><td colspan="2">${esc(x.src)}</td></tr>`;
    }).join("");
    return `
      <div class="card" style="display:grid;gap:10px">
        <div class="list-head"><h2>Your daily targets</h2><span class="tag ref">ICMR NIN 2020</span></div>
        ${hide() ? `<div class="small">Energy target set. Calorie numbers are hidden (Settings).</div>` : `<div class="big-target"><b>${num(e.lo)} to ${num(e.hi)}</b> kcal a day <span class="muted">· aim ${num(e.target)}</span></div>`}
        <div class="small">BMI ${r1(t.bmi)}: ${esc(t.bmiClass.label)}.</div>
        ${hide() ? "" : `<details class="how"><summary>How this is worked out</summary>
          <p>BMR ${num(e.bmr)} kcal: the FAO/WHO/UNU 2004 equation for your age, less ${p.sex === "male" ? "10" : "9"}%, as ICMR NIN 2020 does for Indian adults. Energy use = BMR × activity level ${t.pal} = ${num(e.tee)} kcal. ${esc(e.goalNote)} The band is ±10% because energy estimates for one person are rough.</p>
          <p>Mifflin St Jeor, for comparison: ${num(e.mifflinTee)} kcal a day (BMR ${num(e.mifflinBmr)}). Not used: the research recommends the ICMR factorial method as the default because Mifflin St Jeor overestimates BMR in Asian samples.</p>
        </details>`}
        <div class="table-wrap"><table class="tgt"><thead><tr><th>Nutrient</th><th>Daily target</th></tr></thead><tbody>${rows}</tbody></table></div>
        <p class="small muted">Ranges run from the EAR (what half of healthy people need) to the RDA (what covers nearly everyone). NIN advises intake between the two. Vitamin B12, vitamin D, iodine and salt are not counted.</p>
        ${t.notes.map((n) => `<div class="notice">${esc(n.text)}</div>`).join("")}
      </div>`;
  }

  function preview() {
    readForm();
    const p = draft, bad = T.problems(p), box = $("pPreview");
    if (p.age !== "" && p.age < 18) { box.innerHTML = `<div class="card notice">ThaliHeal is for adults 18 and over. Targets for anyone younger should come from a doctor or a dietitian.</div>`; return; }
    if (bad.length) { box.innerHTML = `<div class="card small muted">Fill in your details to see your targets.</div>`; return; }
    box.innerHTML = targetsHTML(T.compute(p), p);
  }

  async function saveProfile() {
    readForm();
    const st = $("pStatus"), say = (m, err) => { st.innerHTML = m; st.classList.toggle("err", !!err); };
    if (draft.age !== "" && draft.age < 18) return say("This version is for adults 18 and over, so the profile cannot be saved.", true);
    const bad = T.problems(draft); if (bad.length) return say(esc(bad.join(" ")), true);
    await App.Account.getDoc();
    if (!App.Account.hasConsent()) return say(`Please read and agree to how your data is used first. <a href="#consent">Read and agree</a>`, true);
    $("pSave").disabled = true;
    try {
      const p = { ...draft }; if (p.waist === "") delete p.waist;
      await App.Account.saveProfile(p);
      const pending = App.views.scan.pendingPlate && App.views.scan.pendingPlate();
      say(`Saved. <a href="#track">Open my log</a>${pending ? ` · <a href="${App.plateHash()}">Back to your plate</a>` : ""}`);
      $("pSave").textContent = "Save changes";
    } catch (e) { say("Could not save. Try again.", true); }
    finally { $("pSave").disabled = false; }
  }

  App.views.profile = {
    async show() {
      const box = $("profilePage");
      box.innerHTML = `<div class="card small muted">Loading your profile…</div>`;
      const doc = await App.Account.getDoc();
      if (!App.Account.hasConsent()) { App.needConsent("profile"); return; }
      draft = { ...BLANK, ...((doc && doc.profile) || {}) };
      $("profileWhere").textContent = App.Account.whereText();
      box.innerHTML = profileForm(doc);
      box.querySelectorAll("[data-seg]").forEach((g) => g.querySelectorAll("button").forEach((b) => b.onclick = () => {
        draft[g.dataset.seg] = b.dataset.v;
        g.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
        if (g.dataset.seg === "sex") $("pStageWrap").hidden = draft.sex !== "female";
        preview();
      }));
      box.querySelectorAll("[data-act]").forEach((b) => b.onclick = () => {
        draft.activity = b.dataset.act;
        box.querySelectorAll("[data-act]").forEach((x) => x.setAttribute("aria-checked", String(x === b)));
        preview();
      });
      ["pAge", "pHeight", "pWeight", "pWaist", "pDiet", "pStage"].forEach((id) => { const el = $(id); if (el) el.addEventListener(el.tagName === "SELECT" ? "change" : "input", preview); });
      $("pSave").onclick = saveProfile;
      const phs = $("profileHideSwitch");
      if (phs) {
        phs.onclick = () => {
          const next = App.store.get("thali.hideNumbers", false) !== true;
          App.store.set("thali.hideNumbers", next);
          phs.setAttribute("aria-checked", String(next));
          preview();
        };
      }
      const pib = $("profileInstallBtn");
      if (pib) {
        pib.onclick = async () => {
          if (App.pwa && App.pwa.prompt) {
            const p = App.pwa.prompt;
            App.pwa.prompt = null;
            p.prompt();
            await p.userChoice.catch(() => null);
          } else if (App.pwa && App.pwa.openGuide) {
            App.pwa.openGuide();
          }
        };
      }
      preview();
    },
  };

  // ===================================================== LOG AND TRENDS =====================================================
  const V = { tab: "day", date: null, metric: "kcal", sel: null };
  const DAYS = { week: 7, month: 30 };

  // Sum meals into days. A day counts toward averages once two or more meal slots are logged.
  function byDate(meals) {
    const m = {};
    meals.forEach((x) => {
      const d = (m[x.date] = m[x.date] || { date: x.date, meals: [], slots: new Set(), t: {} });
      d.meals.push(x); d.slots.add(x.slot);
      Object.entries(x.totals || {}).forEach(([k, v]) => { if (typeof v === "number") d.t[k] = (d.t[k] || 0) + v; });
    });
    Object.values(m).forEach((d) => { d.full = d.slots.size >= 2; });
    return m;
  }
  function periodDates(end, n) { const out = []; for (let i = n - 1; i >= 0; i--) out.push(App.addDays(end, -i)); return out; }
  function summarize(dates, days) {
    const full = dates.filter((d) => days[d] && days[d].full), partial = dates.filter((d) => days[d] && !days[d].full);
    const avg = {}; let kcal = 0, micro = 0;
    App.LOG_KEYS.forEach((k) => { avg[k] = full.length ? full.reduce((s, d) => s + (days[d].t[k] || 0), 0) / full.length : 0; });
    full.forEach((d) => { kcal += days[d].t.kcal || 0; micro += days[d].t.micro_kcal || 0; });
    return { full, partial, avg, coverage: kcal ? micro / kcal : 0 };
  }
  // Map target keys to the log keys they read.
  const KEYMAP = { addedFat: "added_fat", addedSugar: "added_sugar" };
  const logKey = (k) => KEYMAP[k] || k;
  const isMicro = (k) => App.MICRO.includes(k);

  const ICON = { good: "✓", warn: "≈", bad: "!", info: "i" };
  const pill = (s) => `<span class="spill ${s.cls}"><span aria-hidden="true">${ICON[s.cls] || ""}</span> ${esc(s.label)}</span>`;

  // A horizontal meter: the bar is intake, the marks are the low end and the target.
  function meter(v, t, cls) {
    const top = Math.max(t.high * 1.25, v, 1);
    const w = Math.min(100, v / top * 100), hi = t.high / top * 100, lo = t.low / top * 100;
    return `<div class="meter ${cls || ""}" aria-hidden="true"><i style="width:${w}%"></i>${t.kind !== "max" ? `<s style="left:${lo}%"></s>` : ""}<s class="hi" style="left:${hi}%"></s></div>`;
  }

  function sourcesHTML(key, t, diet, open) {
    const S = App.Sources, s = S.SOURCES[key]; if (!s) return "";
    const foods = S.foodsFor(s.foods, diet);
    const top = S.topDishes(key, diet, t.high);
    return `<details class="srcs" ${open ? "open" : ""}><summary>Indian food sources</summary>
      <div class="small"><b>Foods${diet !== "nonveg" ? ` for a ${esc(T.DIETS[diet].toLowerCase())} diet` : ""}:</b> ${esc(foods.join("; "))}.</div>
      ${top.length ? `<div class="small"><b>From the food table, per serving:</b> ${top.map((x) => `${esc(x.dish.name)}, 1 ${esc(x.unit.name)} (${x.unit.g} g): ${fmtV(x.amount, t.unit)}${diet === "vegan" && x.ghee ? " (cook with oil)" : ""}`).join("; ")}.</div>` : ""}
      <div class="small muted">${esc(s.tip)}${s.general ? " General guidance, pending dietitian review." : ""}</div>
    </details>`;
  }

  function notTrackedHTML(diet) {
    return `<details class="card how"><summary><b>Not counted by the app</b>: vitamin B12, vitamin D, iodine, salt</summary>
      ${App.Sources.NOT_TRACKED.map((x) => {
        const f = App.Sources.foodsFor(x.foods, diet);
        return `<p class="small"><b>${esc(x.label)}.</b> ${esc(x.why)}${f.length ? ` Sources: ${esc(f.join("; "))}.` : ""} <span class="muted">${esc(x.tip)}</span></p>`;
      }).join("")}
    </details>`;
  }

  const RED_FLAGS = `<div class="card small"><b>Logged intake is not a diagnosis.</b> Only a blood test shows a deficiency, and logs miss food. See a doctor, not the app, for persistent tiredness or breathlessness, tingling or numbness, very heavy periods, unexplained weight loss, or any symptom in pregnancy or over 65.</div>`;

  // ---------- chart: one bar per day with the target band ----------
  const METRICS = {
    kcal: { label: "Energy", unit: "kcal" }, protein: { label: "Protein", unit: "g", t: "protein" }, fibre: { label: "Fibre", unit: "g", t: "fibre" },
    iron: { label: "Iron", unit: "mg", t: "iron" }, calcium: { label: "Calcium", unit: "mg", t: "calcium" }, zinc: { label: "Zinc", unit: "mg", t: "zinc" },
    magnesium: { label: "Magnesium", unit: "mg", t: "magnesium" }, folate: { label: "Folate", unit: "µg", t: "folate" }, vitc: { label: "Vitamin C", unit: "mg", t: "vitc" },
    added_fat: { label: "Added oil and ghee", unit: "g", t: "addedFat" }, added_sugar: { label: "Added sugar", unit: "g", t: "addedSugar" },
  };
  function bandFor(metric, tg) {
    if (!tg || !tg.ok) return null;
    if (metric === "kcal") return { lo: tg.energy.lo, hi: tg.energy.hi, kind: "band" };
    const t = tg.n[METRICS[metric].t]; return t.kind === "max" ? { hi: t.high, kind: "max" } : { lo: t.low, hi: t.high, kind: "band" };
  }
  function topPath(x, y, w, h, r) {   // bar with rounded top corners, flat on the baseline
    r = Math.min(r, w / 2, h); const b = y + h;
    return `M${x},${b}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${b}Z`;
  }
  function chartHTML(dates, days, metric, tg) {
    const W = 340, H = 160, L = 40, R = 6, TOP = 10, B = 22, pw = W - L - R, ph = H - TOP - B;
    const vals = dates.map((d) => (days[d] ? days[d].t[metric] || 0 : null));
    const band = bandFor(metric, tg);
    const maxV = Math.max(1, ...vals.filter((v) => v != null), band ? band.hi * 1.15 : 0);
    const nice = (m) => { const p = Math.pow(10, Math.floor(Math.log10(m))); return Math.ceil(m / p * 2) / 2 * p; };
    const top = nice(maxV), y = (v) => TOP + ph - v / top * ph;
    const slot = pw / dates.length, bw = Math.max(3, Math.min(26, slot - 3));
    let g = "";
    [0, top / 2, top].forEach((v) => { g += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="grid"/><text x="${L - 6}" y="${y(v) + 4}" class="axis" text-anchor="end">${num(v)}</text>`; });
    if (band && band.kind === "band") g += `<rect x="${L}" width="${pw}" y="${y(band.hi)}" height="${Math.max(1, y(band.lo) - y(band.hi))}" class="band"/>`;
    if (band) g += `<line x1="${L}" x2="${W - R}" y1="${y(band.hi)}" y2="${y(band.hi)}" class="limit"/>`;
    dates.forEach((d, i) => {
      const v = vals[i], x = L + i * slot + (slot - bw) / 2, day = days[d];
      const lab = dates.length <= 7 ? App.fmtDate(d, { weekday: "narrow" }) : (i % 5 === 0 || i === dates.length - 1 ? App.fmtDate(d, { day: "numeric" }) : "");
      if (lab) g += `<text x="${x + bw / 2}" y="${H - 6}" class="axis" text-anchor="middle">${esc(lab)}</text>`;
      if (v != null && v > 0) g += `<path d="${topPath(x, y(v), bw, ph + TOP - y(v), 4)}" class="${day.full ? "barm" : "barm part"}"/>`;
      const desc = `${App.fmtDate(d)}: ${v ? fmtV(v, METRICS[metric].unit) : "nothing logged"}${day && !day.full ? " (partial day)" : ""}`;
      g += `<rect x="${L + i * slot}" y="${TOP}" width="${slot}" height="${ph}" class="hit" data-i="${i}" tabindex="0" role="img" aria-label="${esc(desc)}"><title>${esc(desc)}</title></rect>`;
    });
    return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="group" aria-label="${esc(METRICS[metric].label)} per day">${g}</svg>`;
  }
  function chartDetail(dates, days, metric, i) {
    const d = dates[i], day = days[d];
    if (!day) return `${App.fmtDate(d)}: nothing logged.`;
    const v = day.t[metric] || 0;
    if (metric === "kcal" && hide()) return `${App.fmtDate(d)}: ${day.meals.length} meal${day.meals.length === 1 ? "" : "s"} logged`;
    const rng = metric === "kcal" ? ` (${num(day.t.kcal_lo || 0)} to ${num(day.t.kcal_hi || 0)})` : "";
    return `${App.fmtDate(d)}: ${fmtV(v, METRICS[metric].unit)}${rng} · ${day.meals.length} meal${day.meals.length === 1 ? "" : "s"}${day.full ? "" : " · partial day, not in averages"}`;
  }

  // ---------- screens ----------
  function addRow(date) {
    return `<div class="card" style="display:grid;gap:8px">
      <div class="list-head"><b>Add a meal${date !== App.today() ? ` for ${esc(App.fmtDate(date))}` : ""}</b><span class="small muted">scan or add by hand</span></div>
      <div class="slots">${Object.entries(App.SLOTS).map(([k, v]) => `<button class="btn btn-small" data-add="${k}">${v}</button>`).join("")}</div>
    </div>`;
  }

  function dayHTML(days, tg) {
    const d = days[V.date], t = d ? d.t : {};
    const meals = d ? d.meals.slice().sort((a, b) => Object.keys(App.SLOTS).indexOf(a.slot) - Object.keys(App.SLOTS).indexOf(b.slot)) : [];
    let html = "";
    if (tg && tg.ok) {
      const e = tg.energy, kc = t.kcal || 0;
      html += `<div class="card" style="display:grid;gap:10px">
        <div class="list-head"><b>Logged so far</b>${hide() ? "" : `<span class="small muted">target ${num(e.lo)} to ${num(e.hi)} kcal</span>`}</div>
        ${hide() ? `<div class="small">Energy so far, against your target band:</div>` : `<div class="big-target"><b>${num(kc)}</b> kcal ${kc ? `<span class="muted">· range ${num(t.kcal_lo)} to ${num(t.kcal_hi)}</span>` : ""}</div>`}
        ${meter(kc, { kind: "band", low: e.lo, high: e.hi })}
        <div class="nlist">${["protein", "fibre", "iron", "calcium", "zinc", "folate", "vitc", "addedFat", "addedSugar"].map((k) => {
          const x = tg.n[k], v = t[logKey(k)] || 0;
          return `<div class="nrow"><div class="nname">${esc(x.label)}</div><div class="nval">${fmtV(v, x.unit)} <span class="muted">/ ${x.kind === "max" ? "max " : ""}${fmtV(x.high, x.unit)}</span></div>${meter(v, x, x.kind === "max" && v > x.high ? "over" : "")}</div>`;
        }).join("")}</div>
        <p class="small muted">One day says little. Gaps are flagged on the Week and Month views, from days with two or more meals logged.</p>
      </div>`;
    } else if (d) {
      html += `<div class="card"><div class="big-target"><b>${num(t.kcal || 0)}</b> kcal logged</div></div>`;
    }
    html += meals.length ? meals.map((m) => `
      <div class="card meal">
        <div class="list-head"><b>${esc(App.SLOTS[m.slot] || m.slot)}</b>${hide() ? "" : `<span class="small">${num(m.totals.kcal_lo)} to ${num(m.totals.kcal_hi)} kcal · best ${num(m.totals.kcal)}</span>`}</div>
        <div class="small muted">${m.items.map((it) => `${esc(it.label)} ${it.grams} g${it.oil_g ? ` + ${r1(it.oil_g)} g ${esc(it.oil_type)}` : ""}`).join(" · ")}</div>
        <div class="small muted">P ${r1(m.totals.protein)} g · C ${r1(m.totals.carbs)} g · F ${r1(m.totals.fat)} g · Fibre ${r1(m.totals.fibre)} g${m.totals.unknown ? ` · ${m.totals.unknown} item not in the table (no nutrients)` : ""} · ${m.source === "scan" ? "from a scan" : "added by hand"}</div>
        <button class="btn btn-small btn-ghost del" data-del="${esc(m.id)}">Delete</button>
      </div>`).join("") : `<div class="card empty">No meals logged for ${esc(App.fmtDate(V.date))}.</div>`;
    return html;
  }

  function periodHTML(days, tg, profile) {
    const n = DAYS[V.tab], dates = periodDates(V.date, n), s = summarize(dates, days);
    if (!METRICS[V.metric] || (hide() && V.metric === "kcal")) V.metric = hide() ? "protein" : "kcal";
    let html = `<div class="card" style="display:grid;gap:8px">
      <div class="list-head"><b>Trend</b>
        <select id="metric" aria-label="What to chart">${Object.entries(METRICS).filter(([k]) => !(hide() && k === "kcal")).map(([k, m]) => `<option value="${k}" ${k === V.metric ? "selected" : ""}>${m.label}</option>`).join("")}</select></div>
      ${chartHTML(dates, days, V.metric, tg)}
      <div class="small" id="chartDetail" aria-live="polite">Tap a bar for that day.</div>
      <div class="small muted">${tg && tg.ok ? (bandFor(V.metric, tg).kind === "max" ? "Line: your daily limit. " : "Shaded band: your target range. ") : ""}Lighter bars are partial days (one meal slot logged), left out of averages.</div>
      <details class="how"><summary>Show as table</summary><div class="table-wrap"><table><thead><tr><th>Day</th><th>${esc(METRICS[V.metric].label)}</th><th>Meals</th></tr></thead><tbody>
        ${dates.map((d) => `<tr><td>${esc(App.fmtDate(d))}</td><td>${days[d] ? fmtV(days[d].t[V.metric] || 0, METRICS[V.metric].unit) : "–"}</td><td>${days[d] ? days[d].meals.length + (days[d].full ? "" : " (partial)") : 0}</td></tr>`).join("")}
      </tbody></table></div></details>
    </div>`;

    if (!s.full.length) {
      return html + `<div class="card empty">No full days in this ${V.tab} yet. A day counts once two or more meals are logged.</div>` + notTrackedHTML(profile.diet);
    }
    if (!tg || !tg.ok) return html + `<div class="card notice">${esc(tg ? tg.msg : "")}</div>`;

    const e = tg.energy, a = s.avg, es = T.energyStatus(e, a.kcal);
    const lowData = s.coverage < 0.7;
    html += `<div class="card" style="display:grid;gap:12px">
      <div class="list-head"><h2>Gaps against your targets</h2><span class="small muted">${s.full.length} full day${s.full.length === 1 ? "" : "s"}${s.partial.length ? `, ${s.partial.length} partial left out` : ""}</span></div>
      <div class="nrow"><div class="nname">Energy</div><div class="nval">${hide() ? "Average against your target band" : `${num(a.kcal)} kcal a day <span class="muted">/ ${num(e.lo)} to ${num(e.hi)}</span>`}</div>${meter(a.kcal, { kind: "band", low: e.lo, high: e.hi })}<div>${pill(es)}</div></div>`;
    if (s.full.length >= 3 && a.kcal < e.bmr * 0.8)
      html += `<div class="notice">Your logged average is well below your BMR. If meals are missing from the log, add them. If you are eating this little on purpose, please talk to a doctor or a dietitian.</div>`;
    const order = ["protein", "fibre", "iron", "calcium", "zinc", "magnesium", "folate", "vitc", "vita", "addedFat", "fat", "addedSugar"];
    order.forEach((k) => {
      const t = tg.n[k], v = a[logKey(k)] || 0;
      let st = T.status(t, v);
      if (isMicro(k) && lowData && t.kind !== "info") st = { cls: "info", label: "Not enough data" };
      const gap = t.kind === "min" && (st.cls === "bad" || st.cls === "warn");
      const pct = t.kind !== "max" && t.high ? ` · ${r0(v / t.high * 100)}% of RDA` : "";
      html += `<div class="nrow">
        <div class="nname">${esc(t.label)}</div>
        <div class="nval">${fmtV(v, t.unit)} a day <span class="muted">/ ${t.kind === "max" ? "up to " + fmtV(t.high, t.unit) : fmtV(t.low, t.unit) + " to " + fmtV(t.high, t.unit)}${pct}</span></div>
        ${meter(v, t, t.kind === "max" && v > t.high ? "over" : "")}
        <div>${pill(st)}</div>
        ${gap ? sourcesHTML(k, t, profile.diet, st.cls === "bad") : ""}
        ${st.cls === "bad" && t.kind === "max" ? `<div class="small muted">${k === "addedSugar" ? "Swap sweets, sweetened chai and cold drinks for fruit, and cut sugar in chai step by step." : "Use a teaspoon to measure oil, and choose roasted, steamed or tandoori over fried."}</div>` : ""}
      </div>`;
    });
    html += `<p class="small muted">Micronutrient coverage: ${r0(s.coverage * 100)}% of logged kcal came from dishes with mineral and vitamin data${lowData ? ", too little to flag minerals and vitamins" : ""}. Vitamins are cut by 30% for cooking. Values are estimates from IFCT 2017 recipes.</p>
    </div>`;
    return html + notTrackedHTML(profile.diet) + RED_FLAGS;
  }

  async function renderTrack() {
    const box = $("trackPage");
    $("trackWhere").textContent = App.Account.whereText();
    $("trackErr").hidden = !App.Account.error; $("trackErr").textContent = App.Account.error;
    const doc = await App.Account.getDoc();
    if (!App.Account.hasConsent()) {
      box.innerHTML = `<div class="card" style="display:grid;gap:10px"><b>First, read how your data is used.</b><span class="small muted">A short notice on what the log stores and your choices.</span><button class="btn btn-primary" id="goConsent">Read and agree</button></div>`;
      $("goConsent").onclick = () => App.needConsent("profile");
      return;
    }
    if (!doc.profile) {
      box.innerHTML = `<div class="card" style="display:grid;gap:10px"><b>Set up your profile to start a log.</b><span class="small muted">Age, sex, height, weight, activity, goal and diet type give your daily targets from ICMR NIN 2020.</span><a class="btn btn-primary" href="#profile">Set up profile</a></div>`;
      return;
    }
    const meals = await App.Account.meals(), days = byDate(meals), tg = T.compute(doc.profile);
    if (!V.date) V.date = App.today();
    const label = V.tab === "day" ? App.fmtDate(V.date, { weekday: "long", day: "numeric", month: "short" })
      : `${App.fmtDate(App.addDays(V.date, -(DAYS[V.tab] - 1)), { day: "numeric", month: "short" })} to ${App.fmtDate(V.date, { day: "numeric", month: "short" })}`;
    const atToday = V.date >= App.today();
    box.innerHTML = `
      <div class="tabs ttabs" role="tablist">${["day", "week", "month"].map((t) => `<button role="tab" data-tt="${t}" aria-selected="${V.tab === t}">${t[0].toUpperCase() + t.slice(1)}</button>`).join("")}</div>
      <div class="datenav"><button class="icon-btn" id="dPrev" aria-label="Earlier">‹</button><b>${esc(label)}</b><button class="icon-btn" id="dNext" aria-label="Later" ${atToday ? "disabled" : ""}>›</button></div>
      ${V.tab === "day" ? addRow(V.date) : ""}
      ${V.tab === "day" ? dayHTML(days, tg) : periodHTML(days, tg, doc.profile)}
      ${V.tab === "day" ? "" : addRow(App.today())}
      <div class="card export-card"><div><b>Export</b><div class="small muted">Every meal you have logged, one row per dish, for Excel or Google Sheets.</div></div>
        <button class="btn btn-small" id="logCsv">Download my log (CSV)</button><div class="status" id="logCsvStatus" role="status" aria-live="polite"></div></div>`;
    $("logCsv").onclick = () => exportCSV($("logCsvStatus"));

    box.querySelectorAll("[data-tt]").forEach((b) => b.onclick = () => { V.tab = b.dataset.tt; renderTrack(); });
    const step = V.tab === "day" ? 1 : DAYS[V.tab];
    $("dPrev").onclick = () => { V.date = App.addDays(V.date, -step); renderTrack(); };
    $("dNext").onclick = () => { const nd = App.addDays(V.date, step); V.date = nd > App.today() ? App.today() : nd; renderTrack(); };
    box.querySelectorAll("[data-add]").forEach((b) => b.onclick = () => {
      App.views.scan.startLog({ date: V.tab === "day" ? V.date : App.today(), slot: b.dataset.add });
      location.hash = App.plateHash();   // with scanning off, the plate is built by hand
    });
    box.querySelectorAll("[data-del]").forEach((b) => b.onclick = async () => {
      if (b.dataset.armed !== "1") { b.dataset.armed = "1"; b.textContent = "Tap again to delete"; setTimeout(() => { if (b.isConnected) { b.dataset.armed = ""; b.textContent = "Delete"; } }, 4000); return; }
      b.disabled = true; await App.Account.deleteMeal(b.dataset.del);   // the change listener redraws
    });
    const ms = $("metric"); if (ms) ms.onchange = () => { V.metric = ms.value; renderTrack(); };
    if (V.tab !== "day") {
      const dates = periodDates(V.date, DAYS[V.tab]);
      box.querySelectorAll(".chart .hit").forEach((h) => {
        const showIt = () => { box.querySelectorAll(".chart .hit").forEach((x) => x.classList.toggle("on", x === h)); $("chartDetail").textContent = chartDetail(dates, days, V.metric, Number(h.dataset.i)); };
        h.addEventListener("click", showIt); h.addEventListener("focus", showIt); h.addEventListener("mouseenter", showIt);
      });
    }
  }

  // ---------- my log as CSV: one row per dish, with the meal it belongs to ----------
  const CSV_COLS = ["date", "meal", "logged_at", "source", "cooked_at", "dish", "dish_id", "grams", "grams_low", "grams_high",
    "kcal", "kcal_low", "kcal_high", "protein_g", "carbs_g", "fat_g", "fibre_g", "sugar_g", "added_fat", "added_fat_g", "confidence", "food_table_version"];
  const SLOT_ORDER = Object.keys(App.SLOTS);
  const cell = (v) => { v = v == null ? "" : String(v); return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; };
  const one = (x) => (Number.isFinite(x) ? Math.round(x * 10) / 10 : "");
  function logRows(meals) {
    const sorted = meals.slice().sort((a, b) => a.date.localeCompare(b.date) || SLOT_ORDER.indexOf(a.slot) - SLOT_ORDER.indexOf(b.slot) || (a.created || 0) - (b.created || 0));
    const rows = [];
    sorted.forEach((m) => (m.items || []).forEach((it) => {
      const known = !!App.byId[it.dishId];
      const c = known ? App.calcItem({ dishId: it.dishId, grams: it.grams, oil: { on: !!(it.oil_type && App.fats[it.oil_type]), type: it.oil_type || "oil", g: it.oil_g || 0 } }).total : null;
      const t = m.created ? new Date(m.created) : null;
      rows.push([m.date, App.SLOTS[m.slot] || m.slot, t ? `${App.dateStr(t)} ${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}` : "",
        m.source || "", m.ctx || "", it.label, it.dishId || "", it.grams, it.g_lo, it.g_hi, it.kcal, it.kcal_lo, it.kcal_hi,
        c ? one(c.protein) : "", c ? one(c.carbs) : "", c ? one(c.fat) : "", c ? one(c.fibre) : "", c ? one(c.sugar) : "",
        it.oil_type ? (App.fats[it.oil_type] || {}).name || it.oil_type : "", it.oil_type ? it.oil_g : "", it.conf || "", m.table_version || ""]);
    }));
    return rows;
  }
  async function exportCSV(st) {
    if (!st) return;
    st.classList.remove("err"); st.textContent = "Preparing…";
    try {
      const rows = logRows(await App.Account.meals());
      if (!rows.length) { st.textContent = "Nothing logged yet. Save a meal first, then export."; return; }
      const text = [CSV_COLS, ...rows].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
      const res = await App.saveFile(`thaliheal-my-log-${App.today()}.csv`, text, "text/csv");
      if (res) App.saveNote(st, res);
      else { st.textContent = "The file could not be saved here. Use Download my data (JSON) in Privacy instead."; st.classList.add("err"); }
    } catch (e) { st.textContent = "Could not prepare the export. Try again."; st.classList.add("err"); }
  }

  App.views.track = {
    init() { App.Account.onChange(() => { if (App.current === "track") renderTrack(); }); },
    show() { $("trackPage").innerHTML = `<div class="card small muted">Loading your log…</div>`; renderTrack(); },
  };
  App.Tracker = { byDate, summarize, periodDates, targetsHTML, exportCSV, logRows };
})();
