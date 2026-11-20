/* picker.js: dish search and picker bottom sheet modal.
   Part of the ThaliHeal modular frontend. */
window.App = window.App || {};

(function () {
  "use strict";

  let pickCb = null,
    pickFilter = null;

  App.openPicker = function (cb, filter) {
    pickCb = cb;
    pickFilter = filter || null;
    App.$("search").value = "";
    App.listPicks("");
    App.$("sheet").hidden = false;
    App.$("sheetBg").hidden = false;
    document.body.classList.add("sheet-open");
    setTimeout(() => App.$("search").focus(), 50);
  };

  App.closePicker = function () {
    App.$("sheet").hidden = true;
    App.$("sheetBg").hidden = true;
    document.body.classList.remove("sheet-open");
    pickCb = null;
  };

  App.listPicks = function (q) {
    const nq = App.norm(q);
    const hits = App.dishes.filter(
      (d) => (!pickFilter || pickFilter(d)) && (!nq || nq.split(" ").every((t) => d._search.includes(t)))
    );
    const cats = {};
    hits.forEach((d) => (cats[d.category] = cats[d.category] || []).push(d));
    App.$("picks").innerHTML = hits.length
      ? Object.keys(cats)
          .map(
            (c) =>
              `<div class="cat">${App.esc(c)}</div>` +
              cats[c]
                .map((d) => {
                  const u = d.units[0];
                  const k =
                    (d.per100g.kcal * u.g) / 100 +
                    (d.added_fat ? (d.added_fat.home * u.g / 100) * App.fats[d.added_fat.type].per_g.kcal : 0);
                  return `<button class="pick" data-id="${d.id}">${App.esc(d.name)}<span>${App.r0(k)} kcal / ${App.esc(u.name)}</span></button>`;
                })
                .join("")
          )
          .join("")
      : `<div class="empty">No match. Try another name, for example “dal” or “tinda”.</div>`;

    App.$("picks").querySelectorAll(".pick").forEach(
      (b) =>
        (b.onclick = () => {
          const d = App.byId[b.dataset.id];
          const cb = pickCb;
          App.closePicker();
          cb && cb(d);
        })
    );
  };

  App.initPicker = function () {
    const search = App.$("search");
    if (search) search.oninput = (e) => App.listPicks(e.target.value);
    const closeBtn = App.$("sheetClose");
    if (closeBtn) closeBtn.onclick = App.closePicker;
    const bg = App.$("sheetBg");
    if (bg) bg.onclick = App.closePicker;
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && App.$("sheet") && !App.$("sheet").hidden) App.closePicker();
    });
  };
})();

