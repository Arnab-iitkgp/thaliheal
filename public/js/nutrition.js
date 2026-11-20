/* nutrition.js: ICMR-NIN 2020 calculation engine and plate data model.
   Handles dish matching, portion ranges, added fat estimation, and meal totals.
   Part of the ThaliHeal modular frontend. */
window.App = window.App || {};

(function () {
  "use strict";

  App.OIL_LEVEL = { low: 0.7, normal: 1, high: 1.3 };
  App.NUTS = ["kcal", "protein", "carbs", "fat", "fibre", "sugar"];
  App.MICRO = ["iron", "calcium", "zinc", "magnesium", "folate", "vitc", "vita"];
  App.LOG_KEYS = ["kcal", "protein", "carbs", "fat", "fibre", "sugar", "added_sugar", "added_fat", ...App.MICRO];

  // Closest table dish for a free text label, or null.
  App.matchDish = function (label) {
    const q = App.norm(label);
    if (!q) return null;
    let best = null, bestScore = 0;
    for (const d of App.dishes) {
      for (const n of [d.name, ...(d.aliases || [])].map(App.norm)) {
        let sc = 0;
        if (n === q) sc = 3;
        else if (q.includes(n) || n.includes(q)) sc = 2;
        else {
          const qt = q.split(" "), nt = n.split(" ");
          const hit = qt.filter((t) => t.length > 2 && nt.includes(t)).length;
          if (hit) sc = hit / Math.max(qt.length, nt.length) * 1.5;
        }
        if (sc > bestScore) {
          bestScore = sc;
          best = d;
        }
      }
    }
    return bestScore >= 0.75 ? best : null;
  };

  // ---------- Plate Items ----------
  // An item is one dish on the plate. grams is the best guess; spread holds the
  // portion range as ratios of grams (lo <= 1 <= hi) so it follows the slider.
  let uid = 1;
  const DEFAULT_SPREAD = {
    high: [0.85, 1.15],
    medium: [0.75, 1.3],
    low: [0.6, 1.5],
    user: [0.85, 1.15],
  };

  App.newItem = function (dishId, grams, opts = {}) {
    const dish = dishId ? App.byId[dishId] : null;
    const unitIdx = dish && opts.unit ? Math.max(0, dish.units.findIndex((u) => u.name === opts.unit)) : 0;
    const it = {
      uid: uid++,
      dishId: dish ? dish.id : null,
      label: opts.label || (dish ? dish.name : "Unknown dish"),
      grams: grams != null ? grams : (dish ? dish.units[0].g : 100),
      unitIdx,
      aiConf: opts.aiConf ?? null,
      origin: opts.origin || "manual",
      confirmed: opts.origin === "manual",
      spread: opts.spread || null,
      ctx: opts.ctx || "home",
      oil: {
        type: dish && dish.added_fat ? dish.added_fat.type : "oil",
        g: 0,
        manual: false,
        level: App.OIL_LEVEL[opts.oil] || 1,
        on: false,
      },
    };
    if (!it.spread) it.spread = DEFAULT_SPREAD[App.conf(it).cls] || DEFAULT_SPREAD.medium;
    App.resetOil(it);
    return it;
  };

  App.fatPer100 = (dish, ctx) => (dish && dish.added_fat ? (dish.added_fat[ctx] ?? dish.added_fat.home) : 0);

  // Default oil or ghee for this item, unless the user has set it by hand.
  App.resetOil = function (it) {
    const dish = App.byId[it.dishId];
    if (!dish || !dish.added_fat) {
      it.oil.on = false;
      it.oil.g = 0;
      return;
    }
    if (it.oil.manual) return;
    const g = (App.fatPer100(dish, it.ctx) * it.grams / 100) * it.oil.level;
    it.oil.g = Math.round(g * 2) / 2;
    it.oil.on = g > 0.05 || it.oil.on;
  };

  // Nutrients for an item at its best guess: base dish (no added fat) + added fat.
  App.calcItem = function (it) {
    const out = { base: {}, oil: {}, total: {} };
    const dish = App.byId[it.dishId];
    App.NUTS.forEach((k) => {
      out.base[k] = dish ? (dish.per100g[k] * it.grams) / 100 : 0;
      out.oil[k] = 0;
    });
    if (dish && it.oil.on) {
      const per = App.fats[it.oil.type].per_g;
      App.NUTS.forEach((k) => {
        out.oil[k] = per[k] * it.oil.g;
      });
    }
    App.NUTS.forEach((k) => {
      out.total[k] = out.base[k] + out.oil[k];
    });
    return out;
  };

  // 80% range for grams and kcal. Oil set by the AI or the table is uncertain
  // (0.6x to 1.5x); oil the user typed in is taken as given.
  App.rangeItem = function (it) {
    const dish = App.byId[it.dishId];
    const gLo = it.grams * it.spread[0], gHi = it.grams * it.spread[1];
    if (!dish) return { g: [gLo, gHi], kcal: [0, 0] };
    const per = dish.per100g.kcal / 100;
    const oilK = it.oil.on ? App.fats[it.oil.type].per_g.kcal : 0;
    const oilLo = it.oil.manual ? it.oil.g : it.oil.g * it.spread[0] * 0.6;
    const oilHi = it.oil.manual ? it.oil.g : it.oil.g * it.spread[1] * 1.5;
    return { g: [gLo, gHi], kcal: [per * gLo + oilK * oilLo, per * gHi + oilK * oilHi] };
  };

  // Confidence label: AI certainty about the dish, lowered for estimated data rows.
  App.conf = function (it) {
    if (!it.dishId) return { cls: "low", label: "Low", why: "Not in the food table. Tap the name to pick a dish." };
    const dish = App.byId[it.dishId];
    const dq = dish.quality === "estimate" ? "typical values (estimate)" : "IFCT recipe calculation";
    if (it.confirmed) {
      return {
        cls: "user",
        label: it.origin === "manual" ? "Added by you" : "Confirmed",
        why: `Dish chosen by you · data: ${dq}`,
      };
    }
    let s = it.aiConf == null ? 0.6 : it.aiConf;
    if (dish.quality === "estimate") s -= 0.1;
    const pct = it.aiConf == null ? "" : `AI ${Math.round(it.aiConf * 100)}% sure of dish · `;
    const lvl = s >= 0.75 ? ["high", "High"] : s >= 0.5 ? ["medium", "Medium"] : ["low", "Low"];
    return { cls: lvl[0], label: lvl[1], why: `${pct}data: ${dq}` };
  };

  App.dishType = (dishId) => (App.byId[dishId] ? App.byId[dishId].type : "other");

  // Totals for a list of plate items at their best guess, plus the kcal range.
  App.mealTotals = function (items) {
    const t = { kcal_lo: 0, kcal_hi: 0, micro_kcal: 0, unknown: 0 };
    App.LOG_KEYS.forEach((k) => (t[k] = 0));
    items.forEach((it) => {
      const dish = App.byId[it.dishId];
      if (!dish) {
        t.unknown++;
        return;
      }
      const c = App.calcItem(it), rg = App.rangeItem(it), f = it.grams / 100;
      App.NUTS.forEach((k) => (t[k] += c.total[k]));
      t.added_sugar += (dish.per100g.added_sugar || 0) * f;
      t.added_fat += it.oil.on ? it.oil.g * (App.fats[it.oil.type].per_g.fat || 1) : 0;
      t.kcal_lo += rg.kcal[0];
      t.kcal_hi += rg.kcal[1];
      if (dish.micro) {
        App.MICRO.forEach((k) => (t[k] += (dish.micro[k] || 0) * f));
        t.micro_kcal += c.total.kcal;
      }
    });
    App.LOG_KEYS.concat(["kcal_lo", "kcal_hi", "micro_kcal"]).forEach((k) => (t[k] = Math.round(t[k] * 100) / 100));
    return t;
  };

  // What gets saved for one meal: the items as edited, and totals fixed at save time.
  App.mealFromItems = function (items, o) {
    return {
      id: (o && o.id) || ("m" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)),
      date: o.date,
      slot: o.slot,
      source: o.source || "manual",
      ctx: o.ctx || "home",
      created: Date.now(),
      table_version: App.meta.version || "",
      items: items.map((it) => {
        const rg = App.rangeItem(it), c = App.calcItem(it);
        return {
          dishId: it.dishId,
          label: it.dishId ? App.byId[it.dishId].name : it.label,
          grams: Math.round(it.grams),
          g_lo: Math.round(rg.g[0]),
          g_hi: Math.round(rg.g[1]),
          kcal: Math.round(c.total.kcal),
          kcal_lo: Math.round(rg.kcal[0]),
          kcal_hi: Math.round(rg.kcal[1]),
          oil_type: it.oil.on ? it.oil.type : null,
          oil_g: it.oil.on ? it.oil.g : 0,
          conf: App.conf(it).label,
        };
      }),
      totals: App.mealTotals(items),
    };
  };
})();

