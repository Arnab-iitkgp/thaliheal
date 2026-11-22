/* ml-swaps.js: the "Try next time" card on the scan screen.

   How it hooks in without touching scan.js: scan.js shows its own post-save strip
   (#postSaveActions) when a plate is saved and hides it again when the plate changes.
   This file only watches that strip. While it is showing, the card lists a healthier swap
   for each dish of the meal just saved (K-nearest neighbours, see ml-core.js); when the
   strip hides, so does the card. Dishes that the food table does not have are sent to
   ml-data.js, which estimates their nutrients once and adds them to the Food Map.
   Any error here only hides the card; scanning and saving carry on as before. */
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const esc = (s) => App.esc(s);
  const D = () => App.MLData;
  const M = () => App.MLCore;
  const RECENT_MS = 10 * 60 * 1000;   // only a meal saved in the last 10 minutes

  let shownMeal = null, seq = 0;

  function hideCard() {
    const box = $("mlSwaps");
    if (box) { box.hidden = true; box.innerHTML = ""; }
    shownMeal = null;
  }

  // The meal that was just saved: the newest one in the log.
  async function latestMeal() {
    const meals = await App.Account.meals();
    let best = null;
    (meals || []).forEach((m) => { if (!best || (m.created || 0) > (best.created || 0)) best = m; });
    return best && Date.now() - (best.created || 0) < RECENT_MS ? best : null;
  }

  async function render() {
    const my = ++seq;
    const box = $("mlSwaps"), strip = $("postSaveActions");
    if (!box || !strip || strip.hidden || App.current !== "scan") { hideCard(); return; }
    const meal = await latestMeal();
    if (my !== seq) return;
    if (!meal || !(meal.items || []).length) { hideCard(); return; }
    shownMeal = meal;
    const [list, diet] = await Promise.all([D().items(), D().diet()]);
    if (my !== seq) return;
    const byKey = Object.fromEntries(list.map((i) => [i.key, i]));
    const seen = new Set(), rows = [], toEstimate = [];
    let firstKey = null;

    meal.items.forEach((mi) => {
      const key = D().keyOfMealItem(mi);
      if (!key || seen.has(key)) return;
      seen.add(key);
      const it = byKey[key];
      if (!it) {
        // A dish the table does not have, with no estimate yet.
        // ml-data.js asks the AI if it can, else matches the name to a table dish.
        const entry = D().newDishes().find((e) => e.key === key);
        if (entry && entry.status === "not_food") return;
        const working = D().isWorking(key);
        if (!entry && !working) toEstimate.push(mi.label);
        const note = !entry || working
          ? "New dish · working out its nutrients…"
          : D().aiReady() ? "New dish · its nutrients could not be estimated yet, so no swap" : "New dish · not in the food table and nothing similar by name; AI is off, so no swap";
        rows.push(`<li class="ml-sw-row"><span class="ml-sw-from">${esc(mi.label)}</span><span class="ml-sw-note">${note}</span></li>`);
        return;
      }
      if (!firstKey) firstKey = key;
      const res = D().swapsFor(it, list, diet);
      const star = it.source !== "table" ? " ★" : "";
      if (res.status === "swaps") {
        const s = res.list[0];
        rows.push(`<li class="ml-sw-row"><span class="ml-sw-from">${esc(it.name)}${star}</span><span class="ml-sw-arrow" aria-hidden="true">→</span>` +
          `<button type="button" class="ml-sw-to" data-mlkey="${esc(s.item.key)}">${esc(s.item.name)}</button>` +
          `<span class="ml-sw-note">${esc(s.why.join(", "))} · ${Math.round(s.sim * 100)}% similar</span></li>`);
      } else if (res.status === "no_close") {
        const s = res.list[0];
        rows.push(`<li class="ml-sw-row"><span class="ml-sw-from">${esc(it.name)}${star}</span><span class="ml-sw-note">No close match. Healthier but different: ` +
          `<button type="button" class="ml-sw-to is-inline" data-mlkey="${esc(s.item.key)}">${esc(s.item.name)}</button> (${esc(s.why.join(", "))})</span></li>`);
      } else {
        rows.push(`<li class="ml-sw-row"><span class="ml-sw-from">${esc(it.name)}${star}</span><span class="ml-sw-note ml-good">✓ already a good pick in its group</span></li>`);
      }
    });

    if (!rows.length) { hideCard(); return; }
    box.innerHTML = `<div class="ml-sw-head"><div><h3>Healthier swaps for next time</h3><span class="small muted">Nearest similar dishes that are healthier, per 100 g${diet ? ", for your diet" : ""}</span></div><span class="tag ml-tag">ML · KNN</span></div>` +
      `<ul class="ml-sw-list">${rows.join("")}</ul>` +
      `<button type="button" class="btn btn-small ml-sw-map" data-mlkey="${esc(firstKey || "")}">See it on the Food Map</button>`;
    box.hidden = false;

    // Estimate new dishes in the background; ml-data.js tells us when each one is done.
    toEstimate.forEach((label) => D().estimate(label).catch(() => {}));
  }

  function init() {
    const strip = $("postSaveActions"), box = $("mlSwaps");
    if (!strip || !box || !window.MutationObserver) return;
    new MutationObserver(() => render().catch(hideCard)).observe(strip, { attributes: true, attributeFilter: ["hidden"] });
    D().onChange(() => { if (shownMeal && !strip.hidden && App.current === "scan") render().catch(hideCard); });
    box.addEventListener("click", (e) => {
      const b = e.target.closest("[data-mlkey]");
      if (!b) return;
      if (App.MLFoodMap && b.dataset.mlkey) App.MLFoodMap.focus(b.dataset.mlkey);
      location.hash = "#foodmap";
    });
  }

  App.MLSwaps = { init, render };
})();
