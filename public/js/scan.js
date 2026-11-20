/* scan.js: the scan screen. Photo in, editable list of dishes out, with ranges, confidence and instant meal log updates. */
(function () {
  "use strict";
  const { $, esc, r0, r1 } = App;

  // =========================================================================
  // 1. STATE & CONSTANTS
  // =========================================================================
  const S = {
    items: [],
    ctx: "home",
    demo: true,
    blob: null,
    ctl: null,
    scanned: false,
    log: null,
    savedSig: null,
    lastSavedMealId: null,
    isSaving: false,
    isReviewMode: false,
    photoLabel: null,
    photoUrl: null,
    userSelectedSlot: null
  };

  const DISH_PHOTOS = {
    veg_biryani: "img/samples/s01.jpg",
    veg_pulao: "img/samples/s01.jpg",
    masala_dosa: "img/samples/s02.jpg",
    plain_dosa: "img/samples/s02.jpg",
    idli: "img/samples/s03.jpg",
    medu_vada: "img/samples/s03.jpg",
    sambar: "img/samples/s03.jpg",
    chole: "img/samples/s04.jpg",
    bhatura: "img/samples/s04.jpg",
    puri: "img/samples/s04.jpg",
    chapati: "img/samples/s05.jpg",
    tandoori_roti: "img/samples/s05.jpg",
    plain_paratha: "img/samples/s05.jpg",
    veg_momos: "img/samples/s06.jpg",
    chicken_biryani: "img/samples/s07.jpg",
    butter_chicken: "img/samples/s08.jpg",
    butter_naan: "img/samples/s08.jpg",
    chicken_curry: "img/samples/s10.jpg",
    plain_rice: "img/samples/s10.jpg",
    jeera_rice: "img/samples/s10.jpg",
    mutton_curry: "img/samples/s11.jpg",
    fish_curry: "img/samples/s12.jpg",
    prawn_curry: "img/samples/s13.jpg",
    dum_aloo: "img/samples/s14.jpg",
    aloo_tamatar: "img/samples/s14.jpg",
    aloo_matar: "img/samples/s14.jpg",
    jeera_aloo: "img/samples/s14.jpg",
    paneer_bhurji: "img/samples/s20.jpg",
    kadai_paneer: "img/samples/s20.jpg",
    shahi_paneer: "img/samples/s20.jpg",
    palak_paneer: "img/samples/s20.jpg",
    matar_paneer: "img/samples/s20.jpg",
    boiled_egg: "img/samples/s21.jpg",
    egg_bhurji: "img/plates/egg-round.jpg",
    egg_curry: "img/plates/egg-round.jpg",
    chicken_tikka: "img/samples/s22.jpg",
    tandoori_chicken: "img/samples/s22.jpg",
    salad: "img/samples/s23.jpg",
    kachumber_salad: "img/samples/s23.jpg",
    green_salad: "img/samples/s23.jpg",
    fish_fry: "img/samples/s25.jpg",
    dal_tadka: "img/plates/chole-round.jpg",
    dal_makhani: "img/plates/chole-round.jpg",
    dal_fry: "img/plates/chole-round.jpg",
    dahi_puri: "img/plates/chaat-round.jpg",
    pani_puri: "img/plates/chaat-round.jpg",
    sev_puri: "img/plates/chaat-round.jpg",
    samosa: "img/plates/chaat-round.jpg",
    noodles: "img/plates/chinese-round.jpg",
    fried_rice: "img/plates/chinese-round.jpg"
  };

  const ICONS = {
    dal: `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 11a8 8 0 0 0 16 0H4z"/><path d="M7 8c.5-1 1.5-2 3-2s2 1 2 2"/><path d="M12 7c.5-1 1.5-2 3-2s2 1 2 2"/><line x1="2" y1="11" x2="22" y2="11"/><circle cx="9" cy="15" r="1" fill="currentColor"/><circle cx="15" cy="15" r="1" fill="currentColor"/></svg>`,
    roti: `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><circle cx="9" cy="9" r="1" fill="currentColor"/><circle cx="15" cy="11" r="1.2" fill="currentColor"/><circle cx="11" cy="15" r="1" fill="currentColor"/></svg>`,
    rice: `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 11c0 5 3.6 9 8 9s8-4 8-9H4z"/><path d="M4 11c1-3 4-5 8-5s7 2 8 5"/><line x1="12" y1="3" x2="12" y2="6"/><line x1="9" y1="4" x2="10" y2="6"/><line x1="15" y1="4" x2="14" y2="6"/></svg>`,
    sabzi: `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21a9 9 0 0 0 9-9c0-4-3-8-9-9-6 1-9 5-9 9a9 9 0 0 0 9 9z"/><path d="M12 3v18"/><path d="M12 12c-2.5-1-4-3-4-5"/><path d="M12 15c2.5-1 4-3 4-5"/></svg>`,
    curry: `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 0 0 18 0H3z"/><path d="M6 12V8a3 3 0 0 1 3-3h6a3 3 0 0 1 3 3v4"/><circle cx="10" cy="15" r="1.5" fill="currentColor"/><circle cx="14" cy="16" r="1.5" fill="currentColor"/></svg>`,
    snack: `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3 9 16a1 1 0 0 1-.9 1.4H3.9A1 1 0 0 1 3 19L12 3z"/><path d="M12 10v4"/><circle cx="12" cy="17" r="1" fill="currentColor"/></svg>`,
    sweet: `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="5" width="14" height="14" rx="3" transform="rotate(45 12 12)"/><circle cx="12" cy="12" r="2.5" fill="currentColor"/></svg>`,
    dairy: `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8h12v11a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V8z"/><path d="M5 5h14v3H5z"/><path d="M10 2h4v3h-4z"/></svg>`,
    egg: `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3C8 3 5 8 5 14a7 7 0 0 0 14 0c0-6-3-11-7-11z"/><path d="M9 14a3 3 0 0 0 6 0"/></svg>`,
    protein: `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M8 12c2-2 6-2 8 0"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/></svg>`,
    plate: `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/></svg>`
  };

  // =========================================================================
  // 2. DISH MEDIA & CATEGORY BADGES
  // =========================================================================
  function dishMediaHTML(dish) {
    if (!dish) return `<div class="dish-cat-badge badge-other" aria-hidden="true">${ICONS.plate}</div>`;
    const photo = DISH_PHOTOS[dish.id];
    if (photo) return `<img class="dish-thumb-img" src="${esc(photo)}" alt="" loading="lazy">`;
    const t = dish.type;
    const f = dish.flags || {};
    const hasFlag = (k) => (Array.isArray(f) ? f.includes(k) : !!f[k]);
    if (hasFlag("egg")) return `<div class="dish-cat-badge badge-egg" aria-hidden="true">${ICONS.egg}</div>`;
    if (hasFlag("meat") || hasFlag("fish")) return `<div class="dish-cat-badge badge-protein" aria-hidden="true">${ICONS.protein}</div>`;
    if (hasFlag("dairy") && (t === "other" || dish.name.toLowerCase().includes("milk") || dish.name.toLowerCase().includes("curd") || dish.name.toLowerCase().includes("chaas") || dish.name.toLowerCase().includes("lassi"))) {
      return `<div class="dish-cat-badge badge-dairy" aria-hidden="true">${ICONS.dairy}</div>`;
    }
    if (t === "dal") return `<div class="dish-cat-badge badge-dal" aria-hidden="true">${ICONS.dal}</div>`;
    if (t === "roti") return `<div class="dish-cat-badge badge-roti" aria-hidden="true">${ICONS.roti}</div>`;
    if (t === "rice") return `<div class="dish-cat-badge badge-rice" aria-hidden="true">${ICONS.rice}</div>`;
    if (t === "sabzi") return `<div class="dish-cat-badge badge-sabzi" aria-hidden="true">${ICONS.sabzi}</div>`;
    if (t === "curry") return `<div class="dish-cat-badge badge-curry" aria-hidden="true">${ICONS.curry}</div>`;
    if (t === "fried snack") return `<div class="dish-cat-badge badge-snack" aria-hidden="true">${ICONS.snack}</div>`;
    if (t === "sweet") return `<div class="dish-cat-badge badge-sweet" aria-hidden="true">${ICONS.sweet}</div>`;
    return `<div class="dish-cat-badge badge-other" aria-hidden="true">${ICONS.plate}</div>`;
  }

  function dishTypeLabel(dish) {
    if (!dish) return "Custom Dish";
    const labels = {
      dal: "Dal & Pulses",
      roti: "Roti & Breads",
      rice: "Rice & Grains",
      sabzi: "Vegetable Sabzi",
      curry: "Curry & Gravy",
      "fried snack": "Street Snack",
      sweet: "Indian Sweet",
      other: "Indian Plate Dish"
    };
    return labels[dish.type] || "Indian Dish";
  }

  // =========================================================================
  // 3. SIGNATURE & CHANGE TRACKING
  // =========================================================================
  function getSelectedDate() {
    return ($("quickDateInput") && $("quickDateInput").value) || ($("logDate") && $("logDate").value) || (S.log && S.log.date) || App.today();
  }

  function getSelectedSlot() {
    return S.userSelectedSlot || (S.log && S.log.slot) || ($("logSlot") && $("logSlot").value) || App.slotNow();
  }

  function sig() {
    const curDate = getSelectedDate();
    const curSlot = getSelectedSlot();
    const items = S.items.map((it) => [it.dishId, it.grams, it.oil && it.oil.on ? it.oil.g : 0, it.oil ? it.oil.type : "", it.unitIdx]);
    return JSON.stringify([curDate, curSlot, S.ctx, items]);
  }

  function onPlateChanged() {
    if (S.demo) {
      S.demo = false;
      if ($("demoTag")) $("demoTag").hidden = true;
    }
    updateTotals();
    updateSaveButton();
    updateReviewMode();
  }

  // =========================================================================
  // 4. TOTALS, RINGS & CLINICAL MICRONUTRIENTS
  // =========================================================================
  function updateTotals() {
    const t = { kcal: 0, protein: 0, carbs: 0, fat: 0, fibre: 0, sugar: 0 };
    let lo = 0, hi = 0, oilK = 0;
    const order = { low: 0, medium: 1, high: 2, user: 3 };
    let worst = null;

    S.items.forEach((it) => {
      const c = App.calcItem(it), rg = App.rangeItem(it);
      App.NUTS.forEach((k) => (t[k] += c.total[k]));
      lo += rg.kcal[0];
      hi += rg.kcal[1];
      oilK += c.oil.kcal;
      const cl = App.conf(it);
      if (!worst || order[cl.cls] < order[worst.cls]) worst = cl;
    });

    if ($("tKcal")) {
      $("tKcal").innerHTML = S.items.length
        ? `${App.range(lo, hi)} <small>kcal · best ${r0(t.kcal)}</small>`
        : `0 <small>kcal</small>`;
    }
    if ($("tConf")) {
      $("tConf").textContent = worst ? (worst.cls === "user" ? "set by you" : `${worst.label} confidence`) : "";
    }
    ["P:protein", "C:carbs", "F:fat", "Fib:fibre", "S:sugar"].forEach((p) => {
      const [id, k] = p.split(":");
      if ($("t" + id)) $("t" + id).textContent = r1(t[k]) + " g";
    });
    if ($("tFatNote")) {
      $("tFatNote").textContent = oilK > 0 ? `· incl. ${r0(oilK)} kcal fat` : "";
    }

    const e = t.protein * 4 + t.carbs * 4 + t.fat * 9 || 1;
    if ($("bP")) $("bP").style.width = (t.protein * 4 / e * 100) + "%";
    if ($("bC")) $("bC").style.width = (t.carbs * 4 / e * 100) + "%";
    if ($("bF")) $("bF").style.width = (t.fat * 9 / e * 100) + "%";

    updateScanMacroRings(t);
    updateIcmrProgress();
  }

  function updateScanMacroRings(t) {
    let targetKcal = 650, targetProtein = 20, targetCarbs = 80, targetFat = 22;
    const profile = App.Account && App.Account.cache && App.Account.cache.doc && App.Account.cache.doc.profile;
    if (profile && App.Targets) {
      const tgt = App.Targets.compute(profile);
      if (tgt && tgt.ok) {
        targetKcal = Math.round(tgt.energy.target / 3);
        targetProtein = Math.round(tgt.n.protein.high / 3);
        targetFat = Math.round(tgt.n.fat.high / 3);
        targetCarbs = Math.round(tgt.energy.target * 0.55 / 4 / 3);
      }
    }

    if ($("ringTextVal")) $("ringTextVal").textContent = r0(t.kcal);
    if ($("ringValKcal")) $("ringValKcal").innerHTML = `${r0(t.kcal)} <small>kcal</small>`;
    if ($("ringPctKcal")) $("ringPctKcal").textContent = `${Math.round(t.kcal / targetKcal * 100)}%`;

    if ($("ringValProtein")) $("ringValProtein").innerHTML = `${r1(t.protein)} <small>g</small>`;
    if ($("ringPctProtein")) $("ringPctProtein").textContent = `${Math.round(t.protein / targetProtein * 100)}%`;

    if ($("ringValCarbs")) $("ringValCarbs").innerHTML = `${r1(t.carbs)} <small>g</small>`;
    if ($("ringPctCarbs")) $("ringPctCarbs").textContent = `${Math.round(t.carbs / targetCarbs * 100)}%`;

    if ($("ringValFat")) $("ringValFat").innerHTML = `${r1(t.fat)} <small>g</small>`;
    if ($("ringPctFat")) $("ringPctFat").textContent = `${Math.round(t.fat / targetFat * 100)}%`;

    const offKcal = Math.max(0, 414.7 * (1 - Math.min(1, t.kcal / targetKcal)));
    const offProt = Math.max(0, 320.4 * (1 - Math.min(1, t.protein / targetProtein)));
    const offCarb = Math.max(0, 226.2 * (1 - Math.min(1, t.carbs / targetCarbs)));

    if ($("ringKcal")) $("ringKcal").style.strokeDashoffset = offKcal;
    if ($("ringProtein")) $("ringProtein").style.strokeDashoffset = offProt;
    if ($("ringCarbs")) $("ringCarbs").style.strokeDashoffset = offCarb;

    if ($("macroMealTargetLabel")) {
      $("macroMealTargetLabel").textContent = `Meal Budget ~${targetKcal} kcal · 1/3 daily ICMR allowance`;
    }
  }

  function updateIcmrProgress() {
    const grid = $("icmrGrid");
    if (!grid) return;
    if (!S.items.length) {
      grid.innerHTML = `<div class="empty muted" style="padding:10px 0;font-size:0.85rem">Add dishes to see ICMR-NIN 2020 RDA micronutrient progress.</div>`;
      return;
    }

    const mealTotals = App.mealTotals(S.items);
    let rda = {
      iron:    { sym: "Fe", name: "Iron", unit: "mg", rda: 19.0 },
      calcium: { sym: "Ca", name: "Calcium", unit: "mg", rda: 1000 },
      folate:  { sym: "B9", name: "Folate", unit: "µg", rda: 300 },
      zinc:    { sym: "Zn", name: "Zinc", unit: "mg", rda: 17.0 },
      vitc:    { sym: "Vit C", name: "Vitamin C", unit: "mg", rda: 80.0 },
      fibre:   { sym: "Fib", name: "Dietary Fibre", unit: "g", rda: 30.0 }
    };

    const profile = App.Account && App.Account.cache && App.Account.cache.doc && App.Account.cache.doc.profile;
    if (profile && App.Targets) {
      const tgt = App.Targets.compute(profile);
      if (tgt && tgt.ok && tgt.n) {
        if (tgt.n.iron) rda.iron.rda = tgt.n.iron.high;
        if (tgt.n.calcium) rda.calcium.rda = tgt.n.calcium.high;
        if (tgt.n.folate) rda.folate.rda = tgt.n.folate.high;
        if (tgt.n.zinc) rda.zinc.rda = tgt.n.zinc.high;
        if (tgt.n.vitc) rda.vitc.rda = tgt.n.vitc.high;
        if (tgt.n.fibre) rda.fibre.rda = tgt.n.fibre.high;
      }
    }

    const nutrients = [
      { key: "iron", ...rda.iron },
      { key: "calcium", ...rda.calcium },
      { key: "folate", ...rda.folate },
      { key: "zinc", ...rda.zinc },
      { key: "vitc", ...rda.vitc },
      { key: "fibre", ...rda.fibre }
    ];

    grid.innerHTML = nutrients.map((nut) => {
      const val = mealTotals[nut.key] || 0;
      const target = nut.rda;
      const pct = Math.round(val / target * 100);
      const cappedPct = Math.min(100, pct);
      const fillCls = pct >= 50 ? "good" : pct >= 25 ? "warn" : "slate";
      const valFmt = val < 10 ? val.toFixed(1) : Math.round(val);
      const tgtFmt = target < 10 ? target.toFixed(1) : Math.round(target);
      return `<div class="icmr-row">
        <div class="icmr-row-header">
          <div class="icmr-row-label">
            <span class="icmr-sym">${nut.sym}</span>
            <span class="icmr-name">${nut.name}</span>
          </div>
          <div class="icmr-row-data">
            <b>${valFmt}</b> / ${tgtFmt} ${nut.unit}
            <span class="icmr-pct-badge ${fillCls}">${pct}% RDA</span>
          </div>
        </div>
        <div class="icmr-track">
          <div class="icmr-fill ${fillCls}" style="width:${cappedPct}%"></div>
        </div>
      </div>`;
    }).join("");
  }

  // =========================================================================
  // 5. DISH CARDS & LIVE SLIDER BINDINGS
  // =========================================================================
  function sliderMax(it) {
    const d = App.byId[it.dishId];
    const ug = d ? d.units[it.unitIdx].g : 100;
    return Math.max(ug * 4, Math.ceil(it.grams * 2 / 10) * 10, 100);
  }

  function stepFor(unit) {
    return /piece|slice|scoop|can|cup|glass|leg|half|packet|portion|tablespoon|plate \(/.test(unit.name) ? 1 : 0.5;
  }

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
      </div>` : `<button type="button" class="add-fat" data-k="addfat">＋ Add ${esc(App.fats[dish.added_fat.type].name.toLowerCase())}</button>`;
    }

    const name = dish ? dish.name : "Unknown: " + it.label;
    const media = dishMediaHTML(dish);
    const catLabel = dishTypeLabel(dish);

    return `<article class="card item dish-card-v2" data-uid="${it.uid}">
      <div class="dish-item-header">
        <div class="dish-thumb-box">${media}</div>
        <div class="dish-title-group">
          <div class="dish-name-row">
            <button class="dish-btn ${dish ? "" : "unknown"}" data-k="pick" type="button" aria-label="Change dish: ${esc(name)}">${esc(name)}</button>
          </div>
          <div class="dish-cat-meta">
            <span class="dish-type-tag">${esc(catLabel)}</span>
            <button class="dish-change-link" data-k="pick" type="button">Change</button>
          </div>
        </div>
        <div class="dish-actions">
          <span class="pill ${c.cls}" title="${esc(c.why)}">${c.label}</span>
          <button class="icon-btn dish-del-btn" data-k="del" type="button" aria-label="Remove ${esc(name)}">✕</button>
        </div>
      </div>
      <div class="why">${esc(c.why)}</div>
      ${dish ? `
      <div class="dish-portion-ctrl">
        <div class="portion-stepper-row">
          <button class="stepper-btn" data-k="minus" type="button" aria-label="Decrease portion">−</button>
          <div class="portion-display">
            <div class="portion-unit-row"><b data-r="count"></b> ${unitSel}</div>
            <small class="portion-grams-read" data-r="grams"></small>
          </div>
          <button class="stepper-btn" data-k="plus" type="button" aria-label="Increase portion">＋</button>
        </div>
        <div class="portion-slider-wrap">
          <input type="range" class="portion-slider" data-k="grams" aria-label="Portion in grams" min="0" max="${sliderMax(it)}" step="${it.grams < 60 ? 1 : 5}" value="${r0(it.grams)}">
        </div>
      </div>
      <div class="dish-macros-strip" data-r="nut"></div>
      ${oilBlock}` : ""}
    </article>`;
  }

  function bindCard(it) {
    const el = document.querySelector(`[data-uid="${it.uid}"]`);
    if (!el) return;
    const dish = App.byId[it.dishId];

    el.querySelectorAll('[data-k="pick"]').forEach((btn) => {
      btn.onclick = () => App.openPicker((d) => {
        it.dishId = d.id;
        it.label = d.name;
        it.unitIdx = 0;
        it.confirmed = true;
        it.oil = { type: d.added_fat ? d.added_fat.type : "oil", g: 0, manual: false, level: it.oil.level, on: false };
        if (!(it.grams > 0)) it.grams = d.units[0].g;
        App.resetOil(it);
        renderPlate();
        onPlateChanged();
      });
    });

    el.querySelector('[data-k="del"]').onclick = () => {
      S.items = S.items.filter((x) => x !== it);
      renderPlate();
      onPlateChanged();
    };

    if (!dish) return;

    const range = el.querySelector('[data-k="grams"]');
    if (range) {
      range.oninput = () => {
        it.grams = Number(range.value);
        App.resetOil(it);
        updateCardUI(it);
        onPlateChanged();
      };
    }

    const step = (dir) => {
      const u = dish.units[it.unitIdx], st = stepFor(u);
      const n = Math.max(0, Math.round(it.grams / u.g / st) * st + dir * st);
      it.grams = Math.round(n * u.g);
      App.resetOil(it);
      if (range) {
        if (it.grams > Number(range.max)) range.max = sliderMax(it);
        range.value = it.grams;
      }
      updateCardUI(it);
      onPlateChanged();
    };

    el.querySelector('[data-k="minus"]').onclick = () => step(-1);
    el.querySelector('[data-k="plus"]').onclick = () => step(1);

    const us = el.querySelector('[data-k="unit"]');
    if (us) {
      us.onchange = () => {
        it.unitIdx = Number(us.value);
        updateCardUI(it);
        onPlateChanged();
      };
    }

    const og = el.querySelector('[data-k="oilg"]');
    if (og) {
      og.oninput = () => {
        it.oil.g = Number(og.value);
        if (!it.oil.manual) {
          it.oil.manual = true;
          const p = el.querySelector(".oil .pill");
          if (p) { p.className = "pill user"; p.textContent = "Adjusted"; }
        }
        updateCardUI(it);
        onPlateChanged();
      };
    }

    const ot = el.querySelector('[data-k="oiltype"]');
    if (ot) {
      ot.onchange = () => {
        it.oil.type = ot.value;
        updateCardUI(it);
        onPlateChanged();
      };
    }

    const af = el.querySelector('[data-k="addfat"]');
    if (af) {
      af.onclick = () => {
        it.oil.on = true;
        it.oil.manual = true;
        it.oil.g = it.oil.g || 3;
        renderPlate();
        onPlateChanged();
      };
    }

    updateCardUI(it);
  }

  function updateCardUI(it) {
    const el = document.querySelector(`[data-uid="${it.uid}"]`);
    const dish = App.byId[it.dishId];
    if (!el || !dish) return;

    const u = dish.units[it.unitIdx], n = it.grams / u.g;
    const countEl = el.querySelector('[data-r="count"]');
    if (countEl) countEl.textContent = App.fmtCount(n);

    const un = el.querySelector('[data-r="unitname"]');
    if (un) un.textContent = App.plural(u.name, n);

    const rg = App.rangeItem(it), c = App.calcItem(it);
    const gramsEl = el.querySelector('[data-r="grams"]');
    if (gramsEl) gramsEl.textContent = `${App.range(rg.g[0], rg.g[1], "g")} · best guess ${r0(it.grams)} g`;

    const nutEl = el.querySelector('[data-r="nut"]');
    if (nutEl) {
      nutEl.innerHTML =
        `<div class="dish-macro-pill"><span class="lbl">Energy</span><b>${r0(c.total.kcal)} kcal</b><small>${App.range(rg.kcal[0], rg.kcal[1])}</small></div>` +
        `<div class="dish-macro-pill"><span class="lbl">Protein</span><b>${r1(c.total.protein)} g</b></div>` +
        `<div class="dish-macro-pill"><span class="lbl">Carbs</span><b>${r1(c.total.carbs)} g</b></div>` +
        `<div class="dish-macro-pill"><span class="lbl">Fat</span><b>${r1(c.total.fat)} g</b></div>` +
        `<div class="dish-macro-pill"><span class="lbl">Fibre</span><b>${r1(c.total.fibre)} g</b></div>`;
    }

    const or = el.querySelector('[data-r="oil"]');
    if (or) {
      const tsp = it.oil.g / 4.5;
      or.textContent = `${r1(it.oil.g)} g (about ${App.fmtCount(tsp)} tsp) · ${r0(c.oil.kcal)} kcal · ${it.oil.manual ? "set by you" : "range 0.6x to 1.5x of this"}`;
      const og = el.querySelector('[data-k="oilg"]');
      if (og && Number(og.value) !== it.oil.g) og.value = it.oil.g;
    }
  }

  function renderPlate() {
    $("demoTag").hidden = !S.demo;
    const box = $("items");
    if (!S.items.length) {
      box.innerHTML = `<div class="card empty">No dishes yet. ${App.aiEnabled ? "Scan a photo or add a dish." : "Add a dish to start."}</div>`;
      updateTotals();
      updateSaveButton();
      updateReviewMode();
      return;
    }
    box.innerHTML = S.items.map(cardHTML).join("");
    S.items.forEach(bindCard);
    updateTotals();
    updateSaveButton();
    updateReviewMode();
  }

  // =========================================================================
  // 6. SAVE CONTROLLER & BUTTON STATE MACHINE
  // =========================================================================
  function updateSaveButton() {
    const curSig = sig();
    const isSaved = S.savedSig !== null && S.savedSig === curSig;
    $("postSaveActions").hidden = !isSaved || S.isSaving;
    const slot = getSelectedSlot();
    const slotName = App.SLOTS[slot] || "Meal";

    const quickBtn = $("quickSaveBtn");
    const logBtn = $("logSave");

    let quickText = `Save to ${slotName}`;
    let logText = "Save this plate";

    if (isSaved) {
      quickText = `✓ Saved to ${slotName}`;
      logText = "Plate saved ✓";
    } else if (S.lastSavedMealId) {
      quickText = `Update ${slotName}`;
      logText = `Update ${slotName}`;
    }

    if (quickBtn && !S.isSaving) {
      quickBtn.textContent = quickText;
      quickBtn.classList.toggle("saved-state", isSaved);
    }
    if (logBtn && !S.isSaving) {
      logBtn.textContent = logText;
    }

    document.querySelectorAll(".slot-pill").forEach((b) => {
      const isAct = b.dataset.slot === slot;
      b.classList.toggle("active", isAct);
      b.setAttribute("aria-pressed", String(isAct));
    });

    if ($("quickDateInput") && $("logDate")) {
      const curDate = getSelectedDate();
      $("quickDateInput").value = curDate;
      $("quickDateInput").max = App.today();
      $("logDate").value = curDate;
      $("logDate").max = App.today();
    }
  }

  function logStatus(html, err) {
    const el = $("logStatus");
    if (el) { el.innerHTML = html; el.classList.toggle("err", !!err); }
  }

  function showToast(html, isErr) {
    let t = document.getElementById("thaliToast");
    if (!t) {
      t = document.createElement("div");
      t.id = "thaliToast";
      t.className = "thali-toast";
      document.body.appendChild(t);
    }
    t.innerHTML = html;
    t.classList.toggle("err", !!isErr);
    t.classList.add("show");
    clearTimeout(t._timer);
    t._timer = setTimeout(() => {
      t.classList.remove("show");
    }, 3500);
  }

  function openPrivacySheet() {
    const bg = $("privacySheetBg");
    const sheet = $("privacySheet");
    if (!bg || !sheet) return;
    bg.hidden = false;
    sheet.hidden = false;

    const psAdult = $("psAdult");
    const psStore = $("psStore");
    const agreeBtn = $("privacyAgreeSaveBtn");
    const closeBtn = $("privacySheetClose");

    const checkState = () => {
      if (agreeBtn && psAdult && psStore) {
        agreeBtn.disabled = !(psAdult.checked && psStore.checked);
      }
    };
    if (psAdult) psAdult.onchange = checkState;
    if (psStore) psStore.onchange = checkState;
    checkState();

    const hideSheet = () => {
      bg.hidden = true;
      sheet.hidden = true;
    };
    if (closeBtn) closeBtn.onclick = hideSheet;
    if (bg) bg.onclick = hideSheet;

    if (agreeBtn) {
      agreeBtn.onclick = async () => {
        try {
          agreeBtn.disabled = true;
          agreeBtn.textContent = "Recording consent…";
          await App.Account.giveConsent({ assistant: false });
          hideSheet();
          const curDate = getSelectedDate();
          if (!App.Account.cache.doc || !App.Account.cache.doc.profile) {
            openQuickProfileSheet(curDate);
          } else {
            await executeSaveMeal(curDate);
          }
        } catch (err) {
          agreeBtn.disabled = false;
          agreeBtn.textContent = "Agree & Continue";
          showToast("Could not record consent. Try again.", true);
        }
      };
    }
  }

  function openQuickProfileSheet(curDate) {
    const bg = $("quickProfileSheetBg");
    const sheet = $("quickProfileSheet");
    if (!bg || !sheet) {
      executeSaveMeal(curDate);
      return;
    }
    bg.hidden = false;
    sheet.hidden = false;

    let selectedSex = "female";
    let selectedAct = "moderate";

    const sexBtns = document.querySelectorAll("#qpSexSeg button");
    sexBtns.forEach((b) => {
      b.onclick = () => {
        selectedSex = b.dataset.sex;
        sexBtns.forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      };
    });

    const actBtns = document.querySelectorAll("#qpActivitySeg button");
    actBtns.forEach((b) => {
      b.onclick = () => {
        selectedAct = b.dataset.act;
        actBtns.forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      };
    });

    const hide = () => {
      bg.hidden = true;
      sheet.hidden = true;
    };

    const closeBtn = $("qpSheetClose");
    if (closeBtn) closeBtn.onclick = hide;
    if (bg) bg.onclick = hide;

    const skipBtn = $("qpSkipBtn");
    if (skipBtn) {
      skipBtn.onclick = () => {
        hide();
        executeSaveMeal(curDate);
      };
    }

    const saveBtn = $("qpSaveBtn");
    const statusEl = $("qpStatus");
    if (saveBtn) {
      saveBtn.onclick = async () => {
        const age = Number($("qpAge").value);
        const height = Number($("qpHeight").value);
        const weight = Number($("qpWeight").value);
        const goal = $("qpGoal").value;
        const diet = $("qpDiet").value;

        if (!age || age < 18 || age > 100) {
          if (statusEl) { statusEl.textContent = "Please enter an age between 18 and 100."; statusEl.classList.add("err"); }
          return;
        }
        if (!height || height < 120 || height > 220) {
          if (statusEl) { statusEl.textContent = "Please enter a valid height (120-220 cm)."; statusEl.classList.add("err"); }
          return;
        }
        if (!weight || weight < 30 || weight > 250) {
          if (statusEl) { statusEl.textContent = "Please enter a valid weight (30-250 kg)."; statusEl.classList.add("err"); }
          return;
        }

        try {
          saveBtn.disabled = true;
          saveBtn.textContent = "Saving profile…";
          const profile = {
            age,
            sex: selectedSex,
            height,
            weight,
            waist: "",
            activity: selectedAct,
            goal,
            diet,
            stage: "none"
          };
          await App.Account.saveProfile(profile);
          hide();
          await executeSaveMeal(curDate);
        } catch (e) {
          saveBtn.disabled = false;
          saveBtn.textContent = "Save Profile & Meal";
          if (statusEl) { statusEl.textContent = "Could not save profile. Try again."; statusEl.classList.add("err"); }
        }
      };
    }
  }

  async function executeSaveMeal(curDate) {
    if ($("quickSaveBtn")) {
      $("quickSaveBtn").disabled = true;
      $("quickSaveBtn").textContent = "Saving…";
    }
    if ($("logSave")) $("logSave").disabled = true;

    try {
      S.isSaving = true;
      const savedSig = sig();
      const isUpdate = !!S.lastSavedMealId;
      const slot = getSelectedSlot();
      const meal = App.mealFromItems(S.items, { id: S.lastSavedMealId, date: curDate, slot: slot, source: S.scanned ? "scan" : "manual", ctx: S.ctx });
      await App.Account.saveMeal(meal);

      S.lastSavedMealId = meal.id;
      S.savedSig = savedSig;
      S.log = null;
      S.isSaving = false;

      const slotName = App.SLOTS[meal.slot] || "Log";
      const unk = meal.totals.unknown ? ` (${meal.totals.unknown} dish unlisted)` : "";
      const actionText = isUpdate ? "Updated" : "Saved to";

      showToast(`✓ ${actionText} ${slotName}! <a href="#track">View in Log →</a>`);
      logStatus(`${actionText} ${slotName}, ${App.fmtDate(meal.date)}: ${App.range(meal.totals.kcal_lo, meal.totals.kcal_hi)} kcal.${unk} <a href="#track">Open my log</a>`);

      updateSaveButton();
      const actions = $("postSaveActions");
      if (App.current === "scan" && !actions.hidden) actions.scrollIntoView({ block: "nearest" });
    } catch (e) {
      console.error("Save to log error:", e);
      S.isSaving = false;
      showToast("Could not save meal. Try again.", true);
      logStatus("Could not save. Try again.", true);
      updateSaveButton();
    } finally {
      if ($("logSave")) $("logSave").disabled = false;
      if ($("quickSaveBtn")) $("quickSaveBtn").disabled = false;
    }
  }

  async function saveToLog() {
    if (S.demo) {
      S.demo = false;
      if ($("demoTag")) $("demoTag").hidden = true;
    }
    if (!S.items.length) {
      showToast("Add at least one dish first", true);
      return logStatus("Add at least one dish first.", true);
    }
    const curDate = getSelectedDate();
    if (!curDate || curDate > App.today()) {
      showToast("Pick today or an earlier date", true);
      return logStatus("Pick today or an earlier date.", true);
    }
    if (S.savedSig === sig()) {
      showToast(`Already saved! <a href="#track">Open My Log →</a>`);
      return logStatus(`Already saved. <a href="#track">Open my log</a>`);
    }

    await App.Account.getDoc();
    if (!App.Account.hasConsent()) {
      openPrivacySheet();
      return;
    }

    if (!App.Account.cache.doc || !App.Account.cache.doc.profile) {
      openQuickProfileSheet(curDate);
      return;
    }

    await executeSaveMeal(curDate);
  }

  // =========================================================================
  // 7. COOKING CONTEXT & REVIEW MODE
  // =========================================================================
  function setCtx(c) {
    S.ctx = c;
    document.querySelectorAll("[data-ctx]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.ctx === c)));
    document.querySelectorAll("#ctxReview button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.ctx === c)));
    S.items.forEach((it) => { it.ctx = c; App.resetOil(it); });
    renderPlate();
    onPlateChanged();
  }

  function updateReviewMode() {
    const scanView = document.querySelector('[data-view="scan"]');
    const bar = $("scannedMediaBar");
    const isReview = !!(S.isReviewMode && S.items.length);
    if (scanView) scanView.classList.toggle("is-review-mode", isReview);
    if (bar) {
      bar.hidden = !isReview;
      if (isReview) {
        if ($("scannedThumbImg")) $("scannedThumbImg").src = S.photoUrl || (S.blob ? URL.createObjectURL(S.blob) : "img/plates/chole-round.jpg");
        if ($("scannedTitle")) $("scannedTitle").textContent = S.photoLabel || "Plate Photo";
        if ($("scannedSubtitle")) $("scannedSubtitle").textContent = `${S.items.length} dish${S.items.length === 1 ? "" : "es"} detected · Tap portions to adjust`;
        if ($("scannedBadge")) $("scannedBadge").textContent = S.demo ? "Sample" : "Scanned";
      }
    }
  }

  // =========================================================================
  // 8. CAMERA, UPLOAD & SCAN AI
  // =========================================================================
  function shrink(file) {
    return new Promise((res, rej) => {
      const img = new Image(), url = URL.createObjectURL(file);
      img.onload = () => {
        const s = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
        const cv = document.createElement("canvas");
        cv.width = Math.round(img.naturalWidth * s);
        cv.height = Math.round(img.naturalHeight * s);
        cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
        URL.revokeObjectURL(url);
        cv.toBlob((b) => (b ? res(b) : rej(new Error("encode"))), "image/jpeg", 0.85);
      };
      img.onerror = () => { URL.revokeObjectURL(url); rej(new Error("decode")); };
      img.src = url;
    });
  }
  App.shrinkPhoto = shrink;

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
    upstream_error: "AI service encountered an issue. Tap Scan plate to retry.",
    server_error: "Server encountered an error. Tap Scan plate to retry.",
    timeout: "No answer after a long wait, which usually means a slow connection. Try again on Wi-Fi or with a stronger signal.",
    no_credit: "Scanning is paused: the app's AI credit has run out. You can still add dishes by hand.",
    key_rejected: "Scanning is paused: the server's AI key was refused. You can still add dishes by hand.",
    tester_only: "The tester key was not accepted. Check it in Settings, or clear it to scan normally.",
    cancelled: "Stopped.",
    scanning_off: "Photo scanning is coming soon. For now, add the dishes on your plate by hand with “Add a dish”.",
    origin_not_allowed: `This site is not on the server's allowed list yet. Add ${location.origin} to ALLOWED_ORIGINS on Vercel and redeploy.`
  };
  App.errText = (e) => ERR[e && e.code] || (e && (e.message || e.error)) || "Something went wrong. Try again.";

  function setStatus(msg, err) {
    const el = $("status");
    if (el) {
      el.textContent = msg;
      el.classList.toggle("err", !!err);
    }
  }

  function noScan() {
    if (App.hosting === "web") {
      $("noScan").textContent = !(App.net.offline || !navigator.onLine)
        ? "Photo scanning is not set up on this site yet. You can still build a plate by hand with “Add a dish”."
        : "You're offline. Scanning comes back when you're online; you can still build a plate by hand with “Add a dish”.";
    }
    $("noScan").hidden = false;
    $("scanBtn").hidden = true;
  }

  async function scan() {
    if (!App.claudeSample && App.hosting === "web") {
      try {
        App.claudeSample = await App.serverSample();
        if (App.claudeSample) {
          $("noScan").hidden = true;
          $("scanBtn").hidden = false;
        }
      } catch (err) {}
    }
    if (!App.claudeSample || !S.blob) {
      if (!App.claudeSample) noScan();
      return;
    }
    S.ctl = new AbortController();
    $("scanBtn").disabled = true;
    $("stopBtn").hidden = false;
    setStatus("Looking at your plate… this can take 20 to 40 seconds.");

    const slow = [
      setTimeout(() => setStatus("Still working. A slow connection can add up to a minute. Tap Stop to cancel."), 45000),
      setTimeout(() => setStatus("Still waiting for the answer. The app gives up at 100 seconds."), 80000)
    ];

    try {
      const r = await App.askModel(S.blob, { signal: S.ctl.signal, modelTier: "default" });
      const m = App.itemsFromModel(r.out);
      S.items = m.items;
      S.ctx = m.ctx;
      S.demo = false;
      S.scanned = true;
      S.isReviewMode = true;
      S.lastSavedMealId = null;
      S.savedSig = null;
      if (!S.log) S.userSelectedSlot = null;

      document.querySelectorAll("#ctx button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.ctx === S.ctx)));
      document.querySelectorAll("#ctxReview button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.ctx === S.ctx)));

      renderPlate();
      const n = S.items.length;
      setStatus(n ? `Found ${n} item${n === 1 ? "" : "s"}. Check each one and fix names or portions.${m.note ? " " + m.note : ""}` : `No food found in the photo.${m.note ? " " + m.note : ""}`);
    } catch (e) {
      console.error("Scan failed with details:", e);
      if (e && e.code === "cancelled") setStatus("Scan stopped.");
      else {
        setStatus(App.errText(e), true);
        if (e && ["not_granted", "sampling_disabled", "images_unavailable", "not_declared", "capability_disabled"].includes(e.code)) noScan();
      }
    } finally {
      slow.forEach(clearTimeout);
      $("stopBtn").hidden = true;
      $("scanBtn").disabled = !App.claudeSample || !S.blob;
      S.ctl = null;
    }
  }

  async function usePhotoBlob(blob, label) {
    setStatus("");
    try {
      S.blob = await shrink(blob);
      S.photoLabel = label || "Plate photo";
      S.photoUrl = URL.createObjectURL(S.blob);
      $("previewImg").src = S.photoUrl;
      $("photoMeta").textContent = `${label ? label + ": " : ""}${Math.round(S.blob.size / 1024)} KB, ready to scan`;
      $("preview").hidden = false;
      $("scanBtn").disabled = !App.claudeSample;
      return true;
    } catch (err) {
      setStatus("That file could not be read as a photo. Try a JPEG or PNG.", true);
      return false;
    }
  }

  function photoInputs() {
    const pick = async (e) => {
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      try { await usePhotoBlob(f, "Uploaded photo"); }
      finally { e.target.value = ""; }
    };
    $("photo").onchange = pick;
    $("photoCam").onchange = async (e) => {
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      try { await usePhotoBlob(f, "Camera photo"); }
      finally { e.target.value = ""; }
    };
    $("camBtn").onclick = () => App.Camera.open({
      onPhoto: (blob) => usePhotoBlob(blob, "Camera photo"),
      onFallback: (msg) => { setStatus(msg, true); if (App.Camera.phoneLike()) $("photoCam").click(); }
    });

    const drop = document.querySelector(".drop");
    const isImage = (f) => f && /^image\//.test(f.type);
    ["dragenter", "dragover"].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add("over"); }));
    ["dragleave", "dragend"].forEach((t) => drop.addEventListener(t, () => drop.classList.remove("over")));
    drop.addEventListener("drop", (e) => {
      e.preventDefault();
      drop.classList.remove("over");
      const f = [...((e.dataTransfer && e.dataTransfer.files) || [])].find(isImage);
      if (f) usePhotoBlob(f, "Dropped photo");
      else setStatus("That is not a photo. Drop a JPEG, PNG or WebP image.", true);
    });
    document.addEventListener("paste", (e) => {
      if (App.current !== "scan" || /^(INPUT|TEXTAREA)$/.test((e.target && e.target.tagName) || "")) return;
      const f = [...((e.clipboardData && e.clipboardData.files) || [])].find(isImage);
      if (f) { e.preventDefault(); usePhotoBlob(f, "Pasted photo"); }
    });
  }

  function demo() {
    S.items = [
      App.newItem("plain_rice", 180, { origin: "demo", aiConf: 0.92, spread: [0.85, 1.2] }),
      App.newItem("dal_tadka", 150, { origin: "demo", aiConf: 0.84, spread: [0.8, 1.25] }),
      App.newItem("chapati", 76, { origin: "demo", aiConf: 0.95, spread: [0.9, 1.1] }),
      App.newItem("bhindi_masala", 110, { origin: "demo", aiConf: 0.71, oil: "high", spread: [0.7, 1.35] }),
      App.newItem("salad", 60, { origin: "demo", aiConf: 0.62 }),
      App.newItem("pickle", 10, { origin: "demo", aiConf: 0.4 })
    ];
    S.demo = true;
    S.lastSavedMealId = null;
    S.savedSig = null;
  }

  function addDishFlow() {
    App.openPicker((d) => {
      S.items.push(App.newItem(d.id, null, { origin: "manual", ctx: S.ctx }));
      renderPlate();
      onPlateChanged();
    });
  }

  // =========================================================================
  // 9. PUBLIC VIEW INTERFACE
  // =========================================================================
  App.views.scan = {
    init() {
      demo();
      document.querySelectorAll("[data-ctx]").forEach((b) => (b.onclick = () => setCtx(b.dataset.ctx)));
      document.querySelectorAll("[data-view='scan'] [data-plate]").forEach((b) => {
        b.onclick = () => {
          if (!App.aiEnabled) { location.hash = "#soon"; return; }
          App.views.scan.usePhoto(`img/plates/${b.dataset.plate}.jpg`, b.dataset.label);
        };
      });

      $("scanBtn").onclick = scan;
      $("stopBtn").onclick = () => S.ctl && S.ctl.abort();

      // Add Dish triggers
      $("addBtn").onclick = addDishFlow;

      // Post-save action strip
      if ($("psaScanAgain")) {
        $("psaScanAgain").onclick = () => {
          S.items = [];
          S.lastSavedMealId = null;
          S.savedSig = null;
          S.isReviewMode = false;
          renderPlate();
          onPlateChanged();
          setStatus("");
        };
      }
      if ($("psaAddMore")) $("psaAddMore").onclick = addDishFlow;

      $("clearBtn").onclick = () => {
        S.items = [];
        S.lastSavedMealId = null;
        S.savedSig = null;
        renderPlate();
        onPlateChanged();
        setStatus("");
      };

      App.Camera.init();
      photoInputs();

      $("logSlot").innerHTML = Object.entries(App.SLOTS).map(([k, v]) => `<option value="${k}">${v}</option>`).join("");
      $("logSlot").value = App.slotNow();

      document.querySelectorAll(".slot-pill").forEach((b) => {
        b.onclick = () => {
          const slot = b.dataset.slot;
          S.userSelectedSlot = slot;
          if ($("logSlot")) $("logSlot").value = slot;
          if (S.log) S.log.slot = slot;
          onPlateChanged();
        };
      });

      if ($("logSlot")) {
        $("logSlot").onchange = () => {
          S.userSelectedSlot = $("logSlot").value;
          if (S.log) S.log.slot = $("logSlot").value;
          onPlateChanged();
        };
      }

      if ($("quickDateInput")) {
        $("quickDateInput").onchange = (e) => {
          if ($("logDate")) $("logDate").value = e.target.value;
          if (S.log) S.log.date = e.target.value;
          onPlateChanged();
        };
      }

      if ($("logDate")) {
        $("logDate").onchange = (e) => {
          if ($("quickDateInput")) $("quickDateInput").value = e.target.value;
          if (S.log) S.log.date = e.target.value;
          onPlateChanged();
        };
      }

      $("logSave").onclick = saveToLog;
      if ($("quickSaveBtn")) $("quickSaveBtn").onclick = saveToLog;

      if ($("retakeBtn")) {
        $("retakeBtn").onclick = () => {
          S.isReviewMode = false;
          updateReviewMode();
          const cap = $("scanCaptureCard");
          if (cap) cap.scrollIntoView({ behavior: "smooth" });
        };
      }

      if ($("demoTag")) {
        $("demoTag").style.cursor = "pointer";
        $("demoTag").onclick = () => {
          S.isReviewMode = !S.isReviewMode;
          updateReviewMode();
        };
      }

      updateSaveButton();
      $("dataMeta").textContent = `Food table v${App.meta.version || "?"}: ${App.dishes.length} dishes. ${App.meta.licence_note || ""}`;
    },

    show() {
      if (!S.log && !S.userSelectedSlot && $("logSlot")) {
        $("logSlot").value = App.slotNow();
      }
      renderPlate();
    },

    startLog(o) {
      if (S.demo || S.savedSig === sig()) {
        S.items = [];
        S.demo = false;
        S.scanned = false;
      }
      S.log = { date: o.date, slot: o.slot };
      S.userSelectedSlot = o.slot;
      S.savedSig = null;
      S.lastSavedMealId = null;
      if ($("logDate")) $("logDate").value = o.date;
      if ($("logSlot")) $("logSlot").value = o.slot;
      logStatus("");
      updateSaveButton();
    },

    async usePhoto(url, label) {
      let blob;
      try {
        blob = await (await fetch(url)).blob();
      } catch (err) {
        return setStatus("That sample photo could not be loaded.", true);
      }
      S.photoLabel = label;
      S.photoUrl = url;
      if (!(await usePhotoBlob(blob, `${label}, sample`))) return;
      if (!App.claudeSample && App.hosting === "web") {
        try {
          App.claudeSample = await App.serverSample();
          if (App.claudeSample) {
            $("noScan").hidden = true;
            $("scanBtn").hidden = false;
          }
        } catch (err) {}
      }
      if (App.claudeSample) scan();
      else noScan();
    },

    pendingPlate: () => !S.demo && S.items.length > 0 && S.savedSig !== sig(),

    onClaude(ok) {
      if (!App.aiEnabled) {
        $("noScan").hidden = true;
        return;
      }
      if (ok) {
        $("noScan").hidden = true;
        $("scanBtn").hidden = false;
        $("scanBtn").disabled = !S.blob;
      } else {
        noScan();
      }
    }
  };
})();
