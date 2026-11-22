/* ml-foodmap.js: the Food Map screen (#foodmap).

   An interactive map of every dish: K-Means groups on 7 nutrients, drawn in 2D with PCA.
   - Colour and shape show the group; group names sit at each group's centre.
   - Dishes in the person's log are bigger and ringed; new dishes from scans are stars.
   - Scroll or pinch to zoom, drag to move, tap a dish for its group and healthier swaps.
   - The k slider re-runs K-Means; "How it works" shows the elbow and silhouette charts.
   It only reads the app's data (through ml-data.js) and changes nothing outside this screen. */
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const esc = (s) => App.esc(s);
  const D = () => App.MLData;
  const M = () => App.MLCore;

  const R = 5.5;              // marker radius in px (11 px across)
  const LABEL_ZOOM = 2.2;     // from this zoom, every dish shows its name
  const SHAPE_NAMES = ["circle", "square", "triangle", "diamond", "down triangle", "hexagon", "cross", "pentagon"];

  const V = {
    k: null, show: "all", focus: null, sel: null, swaps: null,
    zoom: { s: 1, tx: 0, ty: 0 }, list: [], byKey: {}, eaten: { counts: {}, labels: {} }, diet: null,
    model: null, scan: null, geom: null, nodes: {}, pos: {}, built: false, pendingFocus: null, raf: 0,
  };

  // ---------- marker shapes (one per group, so colour is never the only cue) ----------
  function poly(n, rad, rot) {
    const p = [];
    for (let i = 0; i < n; i++) { const a = rot + (i * 2 * Math.PI) / n; p.push(`${(Math.cos(a) * rad).toFixed(2)} ${(Math.sin(a) * rad).toFixed(2)}`); }
    return "M" + p.join("L") + "Z";
  }
  function shapePath(i, r) {
    switch (i % 8) {
      case 0: return `M${r} 0A${r} ${r} 0 1 0 ${-r} 0A${r} ${r} 0 1 0 ${r} 0Z`;
      case 1: { const s = r * 0.88; return `M${-s} ${-s}H${s}V${s}H${-s}Z`; }
      case 2: return poly(3, r * 1.3, -Math.PI / 2);
      case 3: return poly(4, r * 1.25, -Math.PI / 2);
      case 4: return poly(3, r * 1.3, Math.PI / 2);
      case 5: return poly(6, r * 1.08, 0);
      case 6: { const a = r * 1.15, b = r * 0.42; return `M${-b} ${-a}H${b}V${-b}H${a}V${b}H${b}V${a}H${-b}V${b}H${-a}V${-b}H${-b}Z`; }
      default: return poly(5, r * 1.15, -Math.PI / 2);
    }
  }
  function starPath(r) {
    const p = [];
    for (let i = 0; i < 10; i++) { const rad = i % 2 ? r * 0.62 : r * 1.55, a = -Math.PI / 2 + (i * Math.PI) / 5; p.push(`${(Math.cos(a) * rad).toFixed(2)} ${(Math.sin(a) * rad).toFixed(2)}`); }
    return "M" + p.join("L") + "Z";
  }
  const keySvg = (c, star) => `<svg class="ml-key" viewBox="-9 -9 18 18" width="15" height="15" aria-hidden="true"><path class="ml-fill-${c}" d="${star ? starPath(4.2) : shapePath(c, 5.2)}"/></svg>`;

  // ---------- data ----------
  async function load() {
    const [list, eaten, diet] = await Promise.all([D().items(), D().eaten(), D().diet()]);
    V.list = list; V.eaten = eaten; V.diet = diet;
    V.byKey = Object.fromEntries(list.map((i) => [i.key, i]));
    V.scan = D().scan(list);
    if (!V.k) V.k = V.scan.best;
    V.model = D().cluster(list, V.k);
    if (V.sel && !V.byKey[V.sel]) V.sel = null;
    V.swaps = V.sel ? D().swapsFor(V.byKey[V.sel], V.list, V.diet) : null;
    if (V.focus !== null && V.focus >= V.k) V.focus = null;
  }
  const count = (key) => V.eaten.counts[key] || 0;
  const anyEaten = () => V.list.some((i) => count(i.key));
  const hide = () => D().hideKcal();
  const fmt = (key, v) => (key === "kcal" ? `${App.r0(v)} kcal` : `${App.r1(v)} g`);

  // ---------- page skeleton (built once) ----------
  function build() {
    const box = $("foodMapPage");
    box.innerHTML = `
      <div class="topbar"><a class="back" href="#home">‹ Home</a><span class="tag ml-tag">ML · K-Means · PCA · KNN</span></div>
      <div class="page-head"><div><h1>Food Map</h1><p class="sub">Every dish in the food table, grouped by K-Means on 7 nutrients per 100 g as cooked at home. Dishes you have logged are bigger and ringed.</p></div></div>
      <div class="card ml-controls">
        <label class="ml-k"><span>Groups (k) <b id="mlKVal"></b></span><input type="range" id="mlK" min="2" max="8" step="1" aria-describedby="mlKHint"></label>
        <span class="small muted" id="mlKHint"></span>
        <div class="seg ml-seg" role="group" aria-label="Which dishes to show" id="mlShow">
          <button type="button" data-v="all" aria-pressed="true">All dishes</button>
          <button type="button" data-v="mine" aria-pressed="false">Only what I ate</button>
        </div>
        <form class="ml-find" id="mlFindForm" role="search">
          <input id="mlFind" list="mlDishList" placeholder="Find a dish" aria-label="Find a dish on the map" autocomplete="off">
          <datalist id="mlDishList"></datalist>
          <button class="btn btn-small" type="submit">Find</button>
        </form>
      </div>
      <div class="ml-layout">
        <div class="card ml-mapcard">
          <div class="ml-maptools">
            <span class="small muted">Scroll or pinch to zoom · drag to move · tap a dish</span>
            <span class="ml-zoombtns">
              <button type="button" class="btn btn-small btn-ghost" data-zoom="in" aria-label="Zoom in">＋</button>
              <button type="button" class="btn btn-small btn-ghost" data-zoom="out" aria-label="Zoom out">－</button>
              <button type="button" class="btn btn-small btn-ghost" data-zoom="reset">Reset</button>
            </span>
          </div>
          <div class="ml-mapwrap">
            <svg id="mlMap" class="ml-map" role="img" aria-label="Food map: dishes plotted by their nutrients and coloured by group"></svg>
            <div class="ml-tip" id="mlTip" role="status" hidden></div>
          </div>
          <div class="ml-legend" id="mlLegend"></div>
          <p class="small muted ml-stats" id="mlStats"></p>
        </div>
        <div class="ml-side">
          <div class="card ml-detail" id="mlDetail" aria-live="polite"></div>
          <div class="card ml-new" id="mlNew"></div>
        </div>
      </div>
      <details class="card ml-how" id="mlHow"><summary><b>How it works</b> <span class="small muted">the ML behind this map, step by step</span></summary><div id="mlHowBody"></div></details>
      <details class="card ml-groups"><summary><b>All groups as a list</b> <span class="small muted">every dish, group by group</span></summary><div id="mlGroups"></div></details>`;

    $("mlK").addEventListener("input", (e) => setK(Number(e.target.value)));
    $("mlShow").querySelectorAll("button").forEach((b) => (b.onclick = () => {
      if (b.disabled) return;
      V.show = b.dataset.v;
      $("mlShow").querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      paintState(); place();
    }));
    $("mlFindForm").addEventListener("submit", (e) => {
      e.preventDefault();
      const q = App.norm($("mlFind").value);
      if (!q) return;
      const hit = V.list.find((i) => App.norm(i.name) === q) || V.list.find((i) => App.norm(i.name).includes(q));
      if (hit) select(hit.key, true);
      else $("mlFind").setCustomValidity("No dish by that name"), $("mlFind").reportValidity(), setTimeout(() => $("mlFind").setCustomValidity(""), 1500);
    });
    document.querySelectorAll("[data-zoom]").forEach((b) => (b.onclick = () => {
      const G = V.geom; if (!G) return;
      const mid = [(G.pad.l + G.w - G.pad.r) / 2, (G.pad.t + G.h - G.pad.b) / 2];
      if (b.dataset.zoom === "reset") { V.zoom = { s: 1, tx: 0, ty: 0 }; schedule(); }
      else zoomAt(mid, V.zoom.s * (b.dataset.zoom === "in" ? 1.6 : 1 / 1.6));
    }));
    bindMap($("mlMap"));
    $("foodMapPage").addEventListener("click", (e) => {
      const t = e.target.closest("[data-sel]");
      if (t) { e.preventDefault(); select(t.dataset.sel, true); return; }
      const f = e.target.closest("[data-focus]");
      if (f) { const c = Number(f.dataset.focus); V.focus = V.focus === c ? null : c; paintState(); place(); renderLegend(); return; }
      const est = e.target.closest("[data-estimate]");
      if (est) { est.disabled = true; est.textContent = "Working…"; D().estimate(est.dataset.estimate).catch(() => {}); }
    });
    if (window.ResizeObserver) {
      let t = 0;
      new ResizeObserver(() => { clearTimeout(t); t = setTimeout(() => { if (App.current === "foodmap") { drawMap(); paintState(); place(); } }, 120); }).observe($("mlMap"));
    }
    V.built = true;
  }

  // ---------- render everything ----------
  function renderAll() {
    $("mlK").value = V.k;
    $("mlKVal").textContent = V.k;
    $("mlKHint").textContent = `Silhouette suggests k = ${V.scan.best}.`;
    const mine = $("mlShow").querySelector('[data-v="mine"]');
    mine.disabled = !anyEaten();
    mine.title = mine.disabled ? "Log a meal first" : "";
    if (mine.disabled && V.show === "mine") { V.show = "all"; $("mlShow").querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.v === "all"))); }
    $("mlDishList").innerHTML = V.list.map((i) => `<option value="${esc(i.name)}"></option>`).join("");
    drawMap(); paintState(); place();
    renderLegend(); renderDetail(); renderNew(); renderHow(); renderGroups(); renderStats();
  }
  function setK(k) {
    V.k = k; V.focus = null;
    V.model = D().cluster(V.list, k);
    $("mlKVal").textContent = k;
    drawMap(); paintState(); place();
    renderLegend(); renderDetail(); renderHow(); renderGroups(); renderStats();
  }

  // ---------- the map ----------
  function geom() {
    const svg = $("mlMap");
    const w = Math.max(280, Math.round(svg.clientWidth || 600)), h = Math.max(300, Math.round(svg.clientHeight || 420));
    const pad = { l: 30, r: 12, t: 12, b: 30 };
    const xs = V.list.map((i) => i.xy[0]), ys = V.list.map((i) => i.xy[1]);
    let x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const mx = (x1 - x0) * 0.05 || 1, my = (y1 - y0) * 0.06 || 1;
    x0 -= mx; x1 += mx; y0 -= my; y1 += my;
    return {
      w, h, pad,
      bx: (x) => pad.l + ((x - x0) / (x1 - x0)) * (w - pad.l - pad.r),
      by: (y) => pad.t + ((y1 - y) / (y1 - y0)) * (h - pad.t - pad.b),
    };
  }
  function drawMap() {
    const svg = $("mlMap");
    if (!svg || !V.model) return;
    const G = (V.geom = geom());
    const { w, h, pad } = G, m = V.model, p = D().base().pca;
    svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
    let dots = "";
    V.list.forEach((it) => {
      const c = m.labelOf[it.key], n = count(it.key), isNew = it.source !== "table";
      const r = n ? R + Math.min(4, 1.6 * Math.sqrt(n)) : R;
      dots += `<g class="ml-pt${n ? " is-eaten" : ""}${isNew ? " is-new" : ""}" data-key="${esc(it.key)}">` +
        `<circle class="ml-hit" r="${Math.max(12, r + 5).toFixed(1)}"/>` +
        (n ? `<circle class="ml-ring" r="${(r + (isNew ? 5 : 3.2)).toFixed(1)}"/>` : "") +
        `<path class="ml-mark ml-fill-${c}" d="${isNew ? starPath(r) : shapePath(c, r)}"/></g>`;
    });
    const ax = `PC1 (${Math.round(p.ratio[0] * 100)}%) → ${M().axisWords(p.components[0])}`;
    const ay = `PC2 (${Math.round(p.ratio[1] * 100)}%) → ${M().axisWords(p.components[1])}`;
    svg.innerHTML =
      `<defs><clipPath id="mlClip"><rect x="${pad.l}" y="${pad.t}" width="${w - pad.l - pad.r}" height="${h - pad.t - pad.b}"/></clipPath></defs>` +
      `<rect class="ml-plot" x="${pad.l}" y="${pad.t}" width="${w - pad.l - pad.r}" height="${h - pad.t - pad.b}" rx="10"/>` +
      `<g clip-path="url(#mlClip)"><line class="ml-zero" id="mlZeroX"/><line class="ml-zero" id="mlZeroY"/></g>` +
      `<text class="ml-axis" x="${pad.l + 4}" y="${h - 10}">${esc(ax)}</text>` +
      `<text class="ml-axis" transform="translate(${pad.l - 10} ${h - pad.b - 4}) rotate(-90)">${esc(ay)}</text>` +
      `<g clip-path="url(#mlClip)"><g id="mlLinks"></g><g id="mlDots">${dots}</g><g id="mlCents"></g><g id="mlLabels"></g></g>`;
    V.nodes = {};
    svg.querySelectorAll(".ml-pt").forEach((g) => (V.nodes[g.dataset.key] = g));
    clamp();
  }

  // State classes: focus a group, highlight the selected dish and its swaps, fade the rest.
  function paintState() {
    if (!V.model) return;
    const swapKeys = new Set(V.swaps && V.swaps.status === "swaps" ? V.swaps.list.map((s) => s.item.key) : []);
    const eatenAny = anyEaten(), m = V.model;
    V.list.forEach((it) => {
      const g = V.nodes[it.key];
      if (!g) return;
      const c = m.labelOf[it.key], n = count(it.key), isSel = it.key === V.sel, isSwap = swapKeys.has(it.key);
      const off = V.show === "mine" && !n && !isSel && !isSwap;
      const grey = !off && V.focus !== null && c !== V.focus && !isSel && !isSwap;
      const dim = !off && !grey && V.sel && !isSel && !isSwap;
      const faint = !off && !grey && !dim && eatenAny && !n && V.focus === null;
      g.classList.toggle("is-off", off);
      g.classList.toggle("is-grey", grey);
      g.classList.toggle("is-dim", dim);
      g.classList.toggle("is-faint", faint);
      g.classList.toggle("is-sel", isSel);
      g.classList.toggle("is-swap", isSwap);
    });
    // Draw eaten, swaps and the selected dish on top.
    const layer = $("mlDots");
    if (layer) {
      V.list.filter((it) => count(it.key)).forEach((it) => V.nodes[it.key] && layer.appendChild(V.nodes[it.key]));
      swapKeys.forEach((k) => V.nodes[k] && layer.appendChild(V.nodes[k]));
      if (V.sel && V.nodes[V.sel]) layer.appendChild(V.nodes[V.sel]);
    }
  }

  function schedule() {
    if (V.raf) return;
    V.raf = requestAnimationFrame(() => { V.raf = 0; place(); });
  }
  function clamp() {
    const G = V.geom, z = V.zoom;
    if (!G) return;
    const L = G.pad.l, Rt = G.w - G.pad.r, T = G.pad.t, B = G.h - G.pad.b;
    z.tx = Math.min(L * (1 - z.s), Math.max(Rt * (1 - z.s), z.tx));
    z.ty = Math.min(T * (1 - z.s), Math.max(B * (1 - z.s), z.ty));
  }
  function zoomAt(p, s, from) {
    const z = V.zoom, f = from || { s: z.s, tx: z.tx, ty: z.ty };
    s = Math.max(1, Math.min(16, s));
    const bx = (p[0] - f.tx) / f.s, by = (p[1] - f.ty) / f.s;
    z.s = s; z.tx = p[0] - bx * s; z.ty = p[1] - by * s;
    clamp(); schedule();
  }
  function centerOn(key, s) {
    const G = V.geom, it = V.byKey[key];
    if (!G || !it) return;
    const z = V.zoom;
    z.s = Math.max(z.s, s || 1);
    const cx = (G.pad.l + G.w - G.pad.r) / 2, cy = (G.pad.t + G.h - G.pad.b) / 2;
    z.tx = cx - G.bx(it.xy[0]) * z.s; z.ty = cy - G.by(it.xy[1]) * z.s;
    clamp(); schedule();
  }

  // Positions every mark for the current zoom, then places labels without overlaps.
  function place() {
    const G = V.geom, z = V.zoom, m = V.model;
    if (!G || !m) return;
    const sx = (x) => G.bx(x) * z.s + z.tx, sy = (y) => G.by(y) * z.s + z.ty;
    const inside = (x, y) => x >= G.pad.l && x <= G.w - G.pad.r && y >= G.pad.t && y <= G.h - G.pad.b;
    V.pos = {};
    V.list.forEach((it) => {
      const x = sx(it.xy[0]), y = sy(it.xy[1]);
      V.pos[it.key] = [x, y];
      const g = V.nodes[it.key];
      if (g) g.setAttribute("transform", `translate(${x.toFixed(1)} ${y.toFixed(1)})`);
    });
    // The average dish (PCA origin) as two faint guide lines.
    const zx = sx(0), zy = sy(0), lx = $("mlZeroX"), ly = $("mlZeroY");
    if (lx) { lx.setAttribute("x1", zx); lx.setAttribute("x2", zx); lx.setAttribute("y1", G.pad.t); lx.setAttribute("y2", G.h - G.pad.b); }
    if (ly) { ly.setAttribute("y1", zy); ly.setAttribute("y2", zy); ly.setAttribute("x1", G.pad.l); ly.setAttribute("x2", G.w - G.pad.r); }

    // Lines from the selected dish to its swaps.
    let links = "";
    if (V.sel && V.swaps && V.swaps.status === "swaps" && V.pos[V.sel]) {
      const [x1, y1] = V.pos[V.sel];
      V.swaps.list.forEach((s) => { const p = V.pos[s.item.key]; if (p) links += `<line class="ml-link" x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${p[0].toFixed(1)}" y2="${p[1].toFixed(1)}"/>`; });
    }
    $("mlLinks").innerHTML = links;

    // Labels: group names first, then the selected dish, its swaps, new dishes, eaten dishes,
    // and (when zoomed in) everything else. A label that would overlap another is skipped.
    const boxes = [];
    const hits = (b) => boxes.some((o) => b.x < o.x + o.w && b.x + b.w > o.x && b.y < o.y + o.h && b.y + b.h > o.y);
    // Each group name sits on its group's centre, kept inside the plot and nudged up or
    // down (never on top of another group's name) when two centres are close.
    let cents = "";
    m.centroidXY.forEach((p, c) => {
      const cx = sx(p[0]), cy = sy(p[1]);
      if (!inside(cx, cy)) return;
      const name = m.names[c], wd = 22 + name.length * 7.4;
      const left = Math.min(Math.max(cx - wd / 2, G.pad.l + 2), G.w - G.pad.r - wd - 2);
      const spot = [0, 24, -24, 48, -48, 72, -72].map((dy) => cy + dy)
        .find((y) => y - 11 >= G.pad.t && y + 11 <= G.h - G.pad.b && !hits({ x: left, y: y - 11, w: wd, h: 22 }));
      if (spot === undefined) return;
      boxes.push({ x: left, y: spot - 11, w: wd, h: 22 });
      const faint = V.focus !== null && V.focus !== c;
      cents += `<g class="ml-cent${faint ? " is-faint" : ""}" transform="translate(${left.toFixed(1)} ${spot.toFixed(1)})"><rect class="ml-cent-bg" x="0" y="-11" width="${wd.toFixed(1)}" height="22" rx="11"/><path class="ml-fill-${c}" transform="translate(11 0)" d="${shapePath(c, 4.2)}"/><text x="20" y="4.5">${esc(name)}</text></g>`;
    });
    $("mlCents").innerHTML = cents;

    const swapKeys = new Set(V.swaps && V.swaps.status === "swaps" ? V.swaps.list.map((s) => s.item.key) : []);
    const cand = [];
    V.list.forEach((it) => {
      const g = V.nodes[it.key], p = V.pos[it.key];
      if (!g || !p || !inside(p[0], p[1]) || g.classList.contains("is-off")) return;
      const n = count(it.key), isNew = it.source !== "table";
      let pri = -1;
      if (it.key === V.sel) pri = 1000;
      else if (swapKeys.has(it.key)) pri = 900;
      else if (g.classList.contains("is-grey") || g.classList.contains("is-dim")) pri = z.s >= LABEL_ZOOM * 1.6 ? 1 : -1;
      else if (isNew && n) pri = 700;
      else if (n) pri = 500 + n;
      else if (z.s >= LABEL_ZOOM) pri = 10;
      if (pri >= 0) cand.push({ it, pri, n, p });
    });
    cand.sort((a, b) => b.pri - a.pri);
    let labels = "";
    cand.forEach(({ it, n, p, pri }) => {
      let text = it.name.length > 26 && pri < 900 ? it.name.slice(0, 25) + "…" : it.name;
      if (n > 1) text += ` ×${n}`;
      const wd = text.length * 6.4 + 4, ht = 15, off = 9 + (n ? 4 : 0);
      const opts = [
        { x: p[0] + off, y: p[1] - ht / 2, anchor: "start", tx: p[0] + off, ty: p[1] + 4 },
        { x: p[0] - off - wd, y: p[1] - ht / 2, anchor: "end", tx: p[0] - off, ty: p[1] + 4 },
        { x: p[0] - wd / 2, y: p[1] - off - ht, anchor: "middle", tx: p[0], ty: p[1] - off - 3 },
        { x: p[0] - wd / 2, y: p[1] + off, anchor: "middle", tx: p[0], ty: p[1] + off + 11 },
      ];
      const ok = opts.find((o) => o.x >= G.pad.l && o.x + wd <= G.w - G.pad.r && o.y >= G.pad.t && o.y + ht <= G.h - G.pad.b && !hits({ x: o.x, y: o.y, w: wd, h: ht }));
      if (!ok) return;
      boxes.push({ x: ok.x, y: ok.y, w: wd, h: ht });
      const cls = pri >= 900 ? " is-strong" : n ? " is-mine" : "";
      labels += `<text class="ml-lbl${cls}" x="${ok.tx.toFixed(1)}" y="${ok.ty.toFixed(1)}" text-anchor="${ok.anchor}">${esc(text)}</text>`;
    });
    $("mlLabels").innerHTML = labels;
  }

  // ---------- pointer, wheel and keyboard ----------
  function bindMap(svg) {
    const pts = new Map();
    let start = null, moved = false, pinch = null, downKey = null;
    const toView = (e) => {
      const r = svg.getBoundingClientRect(), G = V.geom || { w: r.width, h: r.height };
      return [((e.clientX - r.left) * G.w) / r.width, ((e.clientY - r.top) * G.h) / r.height];
    };
    svg.addEventListener("pointerdown", (e) => {
      if (e.button > 0) return;
      const pt = e.target.closest && e.target.closest(".ml-pt");
      downKey = pts.size ? null : pt ? pt.dataset.key : "";
      try { svg.setPointerCapture(e.pointerId); } catch (err) {}
      pts.set(e.pointerId, toView(e));
      moved = pts.size > 1 ? true : false;
      start = { p: toView(e), tx: V.zoom.tx, ty: V.zoom.ty };
      if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]) || 1, mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], s: V.zoom.s, tx: V.zoom.tx, ty: V.zoom.ty };
      }
    });
    svg.addEventListener("pointermove", (e) => {
      if (!pts.has(e.pointerId)) { hover(e); return; }
      pts.set(e.pointerId, toView(e));
      if (pts.size >= 2 && pinch) {
        const [a, b] = [...pts.values()];
        zoomAt(pinch.mid, (pinch.s * Math.hypot(a[0] - b[0], a[1] - b[1])) / pinch.d, pinch);
        moved = true;
        return;
      }
      if (!start) return;
      const p = toView(e), dx = p[0] - start.p[0], dy = p[1] - start.p[1];
      if (!moved && Math.abs(dx) + Math.abs(dy) > 6) moved = true;
      if (moved) { hideTip(); V.zoom.tx = start.tx + dx; V.zoom.ty = start.ty + dy; clamp(); schedule(); }
    });
    const end = (e) => {
      if (!pts.has(e.pointerId)) return;
      pts.delete(e.pointerId);
      if (pts.size < 2) pinch = null;
      if (!pts.size) {
        if (!moved && e.type === "pointerup" && downKey !== null) select(downKey || null, false);
        start = null;
      } else {
        const p = [...pts.values()][0];
        start = { p, tx: V.zoom.tx, ty: V.zoom.ty };
      }
    };
    svg.addEventListener("pointerup", end);
    svg.addEventListener("pointercancel", end);
    svg.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse") hideTip(); });
    svg.addEventListener("wheel", (e) => { e.preventDefault(); zoomAt(toView(e), V.zoom.s * Math.exp(-e.deltaY * 0.0018)); }, { passive: false });
    svg.addEventListener("dblclick", (e) => { e.preventDefault(); zoomAt(toView(e), V.zoom.s * 2); });
  }

  // ---------- hover readout ----------
  function tipHTML(it) {
    const c = V.model.labelOf[it.key], n = count(it.key);
    const keys = hide() ? ["protein", "fat", "fibre"] : ["kcal", "protein", "fat", "fibre"];
    const vals = keys.map((k) => `<span><b>${fmt(k, it.nut[k])}</b> ${k === "kcal" ? "" : M().FEATURES.find((f) => f.key === k).label.toLowerCase()}</span>`).join("");
    return `<b class="ml-tip-name">${esc(it.name)}</b>` +
      `<span class="ml-tip-grp">${keySvg(c, it.source !== "table")}${esc(V.model.names[c])}</span>` +
      `<span class="ml-tip-vals">${vals}</span><span class="ml-tip-note">per 100 g${n ? ` · logged ${n} time${n === 1 ? "" : "s"}` : ""}${it.source === "ai" ? " · AI estimate" : it.source === "name" ? " · matched by name" : ""}</span>`;
  }
  function hover(e) {
    const pt = e.target.closest && e.target.closest(".ml-pt");
    if (!pt || pt.classList.contains("is-off")) { hideTip(); return; }
    const it = V.byKey[pt.dataset.key];
    if (!it) return;
    const tip = $("mlTip"), svg = $("mlMap"), r = svg.getBoundingClientRect(), p = V.pos[it.key];
    tip.innerHTML = tipHTML(it);
    tip.hidden = false;
    const px = (p[0] * r.width) / V.geom.w, py = (p[1] * r.height) / V.geom.h;
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    let left = px + 14, top = py - th - 10;
    if (left + tw > r.width - 4) left = px - tw - 14;
    if (top < 4) top = py + 14;
    tip.style.left = Math.max(4, left) + "px";
    tip.style.top = Math.max(4, top) + "px";
  }
  function hideTip() { const t = $("mlTip"); if (t) t.hidden = true; }

  // ---------- selecting a dish ----------
  function select(key, zoomTo) {
    V.sel = key && V.byKey[key] ? key : null;
    V.swaps = V.sel ? D().swapsFor(V.byKey[V.sel], V.list, V.diet) : null;
    if (V.sel && V.show === "mine" && !count(V.sel)) {
      V.show = "all";
      $("mlShow").querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.v === "all")));
    }
    paintState();
    if (V.sel && zoomTo) centerOn(V.sel, 2.4); else place();
    renderDetail();
    if (zoomTo && V.sel) $("mlMap").scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  // ---------- legend, stats, detail ----------
  function renderLegend() {
    const m = V.model;
    const groups = m.names.map((name, c) =>
      `<button type="button" class="ml-leg${V.focus === c ? " is-on" : ""}${V.focus !== null && V.focus !== c ? " is-off" : ""}" data-focus="${c}" aria-pressed="${V.focus === c}">${keySvg(c)}<span>${esc(name)}</span><small>${m.sizes[c]}</small></button>`
    ).join("");
    const hasNew = V.list.some((i) => i.source !== "table");
    $("mlLegend").innerHTML = `<div class="ml-leg-groups" role="group" aria-label="Groups: tap one to highlight it">${groups}</div>` +
      `<div class="ml-leg-keys small muted"><span><svg class="ml-key" viewBox="-9 -9 18 18" width="15" height="15" aria-hidden="true"><circle r="4" class="ml-key-dot"/><circle r="7" class="ml-key-ring"/></svg>ringed and bigger: in your log</span>` +
      `${hasNew ? `<span><svg class="ml-key" viewBox="-9 -9 18 18" width="15" height="15" aria-hidden="true"><path class="ml-key-dot" d="${starPath(4.2)}"/></svg>star: your new dish, nutrients estimated</span>` : ""}` +
      `<span>Tap a group to highlight it</span></div>`;
  }
  function renderStats() {
    const p = D().base().pca, nNew = V.list.filter((i) => i.source !== "table").length;
    const sil = V.model.silhouette;
    $("mlStats").textContent = `${V.list.length - nNew} table dishes${nNew ? ` + ${nNew} of your new dishes` : ""} · k = ${V.k} · silhouette ${sil === null ? "n/a" : sil.toFixed(2)} · the map keeps ${Math.round((p.ratio[0] + p.ratio[1]) * 100)}% of the variation (PCA)`;
  }

  function swapRow(s, status) {
    const it = s.item, c = V.model.labelOf[it.key];
    return `<li><button type="button" class="ml-swap" data-sel="${esc(it.key)}">${keySvg(c, it.source !== "table")}<b>${esc(it.name)}</b>` +
      `<span class="ml-why">${esc(s.why.join(", "))}</span>` +
      `<small>${status === "swaps" ? `${Math.round(s.sim * 100)}% similar` : "not very similar"}${count(it.key) ? " · in your log" : ""}</small></button></li>`;
  }
  function swapsHTML(it) {
    const sw = V.swaps;
    if (!sw) return "";
    const role = (M().ROLES[it.role] || "its group").toLowerCase();
    if (sw.status === "swaps") return `<h4>Healthier swaps <span class="small muted">nearest neighbours (KNN, cosine)</span></h4><ul class="ml-swaps-list">${sw.list.map((s) => swapRow(s, "swaps")).join("")}</ul>`;
    if (sw.status === "no_close") return `<h4>Healthier swaps</h4><p class="small muted">No close match among ${esc(role)}. These are healthier but quite different:</p><ul class="ml-swaps-list">${sw.list.map((s) => swapRow(s, "no_close")).join("")}</ul>`;
    return `<h4>Healthier swaps</h4><p class="small ml-good">✓ Already a good pick: nothing among ${esc(role)} in the food table is clearly healthier${V.diet ? " for your diet" : ""}.</p>`;
  }
  // The two features that set this dish furthest from the average dish.
  function whyGroup(it) {
    return M().FEATURES.map((f, j) => ({ f, z: it.z[j] }))
      .filter((x) => !(hide() && x.f.key === "kcal") && Math.abs(x.z) >= 0.5)
      .sort((a, b) => Math.abs(b.z) - Math.abs(a.z)).slice(0, 2)
      .map((x) => `${x.z > 0 ? "high" : "low"} ${x.f.label.toLowerCase()}`).join(" and ");
  }
  function renderDetail() {
    const box = $("mlDetail");
    if (!box || !V.model) return;
    const m = V.model;
    if (!V.sel) {
      const mine = V.list.filter((i) => count(i.key)).sort((a, b) => count(b.key) - count(a.key));
      if (!mine.length) {
        box.innerHTML = `<h3>Tap any dish</h3><p class="small muted">See its group, why it is there, and healthier swaps found by K-nearest neighbours.</p><p class="small muted">Dishes you log, by scan or by hand, light up here and on the map.</p>`;
        return;
      }
      const total = mine.reduce((s, i) => s + count(i.key), 0), by = new Array(V.k).fill(0);
      mine.forEach((i) => (by[m.labelOf[i.key]] += count(i.key)));
      const rows = by.map((n, c) => ({ n, c })).filter((x) => x.n).sort((a, b) => b.n - a.n)
        .map((x) => `<li><span class="ml-share-name">${keySvg(x.c)}${esc(m.names[x.c])}</span><span class="ml-share-bar" aria-hidden="true"><i class="ml-bg-${x.c}" style="width:${Math.round((x.n / total) * 100)}%"></i></span><b>${Math.round((x.n / total) * 100)}%</b></li>`).join("");
      box.innerHTML = `<h3>Your food by group</h3><p class="small muted">${total} dish${total === 1 ? "" : "es"} logged in the last 120 days.</p><ul class="ml-share">${rows}</ul>` +
        `<h4>Most logged</h4><div class="ml-chips">${mine.slice(0, 6).map((i) => `<button type="button" class="ml-chip" data-sel="${esc(i.key)}">${keySvg(m.labelOf[i.key], i.source !== "table")}${esc(i.name)} <small>×${count(i.key)}</small></button>`).join("")}</div>`;
      return;
    }
    const it = V.byKey[V.sel], c = m.labelOf[it.key], n = count(it.key), avg = m.avg[c];
    const feats = M().FEATURES.filter((f) => !(hide() && f.key === "kcal"));
    const src = it.source === "ai"
      ? `<p class="notice small">★ New dish from your scans. Its nutrients were estimated by AI from the name "${esc(it.label)}", so treat them as rough.</p>`
      : it.source === "name"
      ? `<p class="notice small">★ New dish from your scans. AI was not available, so it uses the values of the closest table dish by name: ${esc(it.matchedName || "")}.</p>`
      : "";
    const why = whyGroup(it);
    box.innerHTML = `<div class="ml-detail-head"><h3>${esc(it.name)}</h3><button type="button" class="btn btn-small btn-ghost" data-sel="" aria-label="Clear selection">✕</button></div>` +
      `<div class="ml-chips"><span class="ml-chip is-static">${keySvg(c, it.source !== "table")}${esc(m.names[c])}</span><span class="ml-chip is-static">${esc(M().ROLES[it.role] || "")}</span></div>` +
      `<p class="small muted">${n ? `In your log ${n} time${n === 1 ? "" : "s"} (last ${esc(App.fmtDate ? App.fmtDate(V.eaten.last[it.key]) : V.eaten.last[it.key])}).` : "Not in your log yet."}${why ? ` In this group for its ${esc(why)}.` : ""}</p>` + src +
      `<table class="ml-table"><caption class="small muted">Per 100 g, cooked at home</caption><thead><tr><th scope="col">Nutrient</th><th scope="col">This dish</th><th scope="col">Group average</th></tr></thead><tbody>` +
      feats.map((f) => `<tr><th scope="row">${f.label}</th><td>${fmt(f.key, it.nut[f.key])}</td><td>${fmt(f.key, avg[f.key])}</td></tr>`).join("") +
      `</tbody></table>` + swapsHTML(it);
  }

  // ---------- new dishes from scans ----------
  async function renderNew() {
    const box = $("mlNew");
    if (!box) return;
    const entries = D().newDishes(), pending = await D().pendingLabels().catch(() => []);
    const inLog = (e) => count(e.key) > 0;
    const shown = entries.filter(inLog);
    const ai = D().aiReady();
    const rows = shown.map((e) => {
      const it = V.byKey[e.key];
      let status;
      if (D().isWorking(e.key)) status = `<span class="small muted">Working out its nutrients…</span>`;
      else if (e.status === "ai") status = `<span class="small muted">AI estimate · ${it ? `in ${esc(V.model.names[V.model.labelOf[e.key]])}` : ""}</span>`;
      else if (e.status === "name") status = `<span class="small muted">Matched by name to ${esc(e.matchedName)}</span>${ai ? ` <button type="button" class="btn btn-small btn-ghost" data-estimate="${esc(e.label)}">Ask AI instead</button>` : ""}`;
      else if (e.status === "not_food") status = `<span class="small muted">Not a food, so not on the map</span>`;
      else status = `<span class="small muted">${ai ? "Could not estimate yet" : "Needs AI to estimate"}</span>${ai ? ` <button type="button" class="btn btn-small btn-ghost" data-estimate="${esc(e.label)}">Try again</button>` : ""}`;
      return `<li>${it ? `<button type="button" class="ml-linkbtn" data-sel="${esc(e.key)}">${keySvg(V.model.labelOf[e.key], true)}${esc(e.name || e.label)}</button>` : `<b>${esc(e.name || e.label)}</b>`} ${status}</li>`;
    });
    pending.filter((l) => !shown.some((e) => e.key === D().keyOfLabel(l))).forEach((l) => {
      const working = D().isWorking(D().keyOfLabel(l));
      rows.push(`<li><b>${esc(l)}</b> <span class="small muted">${working ? "Working out its nutrients…" : ai ? "Waiting" : "Needs AI to estimate"}</span>${ai && !working ? ` <button type="button" class="btn btn-small btn-ghost" data-estimate="${esc(l)}">Estimate now</button>` : ""}</li>`);
    });
    box.innerHTML = `<h3>Your new dishes</h3>` + (rows.length
      ? `<p class="small muted">Dishes from your scans that are not in the food table. Each gets its nutrients once, then joins the map as a star and K-Means re-groups with it.</p><ul class="ml-newlist">${rows.join("")}</ul>`
      : `<p class="small muted">When a scan finds a dish that is not in the food table, it shows up here and joins the map as a star once its nutrients are estimated.</p>`) +
      (!ai ? `<p class="small muted">AI is off on this site, so new dishes use the closest table dish by name.</p>` : "");
  }

  // ---------- how it works (with the elbow and silhouette charts) ----------
  function lineChart(rows, key, cur, best, title) {
    const pts = rows.filter((r) => r[key] !== null);
    const W = 300, H = 150, pl = 40, pr = 12, pt = 14, pb = 26;
    const vs = pts.map((r) => r[key]), lo = Math.min(...vs), hi = Math.max(...vs);
    const y0 = key === "silhouette" ? Math.min(0, lo) : 0, y1 = hi * 1.08 || 1;
    const x = (k) => pl + ((k - 1) / 7) * (W - pl - pr), y = (v) => pt + (1 - (v - y0) / (y1 - y0)) * (H - pt - pb);
    const line = pts.map((r, i) => `${i ? "L" : "M"}${x(r.k).toFixed(1)} ${y(r[key]).toFixed(1)}`).join("");
    const dec = key === "silhouette" ? 2 : 0;
    const marks = pts.map((r) => `<g class="ml-cpt${r.k === cur ? " is-cur" : ""}"><circle cx="${x(r.k).toFixed(1)}" cy="${y(r[key]).toFixed(1)}" r="${r.k === cur ? 5 : 3.5}"/><title>k = ${r.k}: ${title} ${r[key].toFixed(dec)}</title></g>`).join("");
    const curR = pts.find((r) => r.k === cur);
    const ticks = [1, 2, 3, 4, 5, 6, 7, 8].map((k) => `<text x="${x(k)}" y="${H - 8}" text-anchor="middle">${k}</text>`).join("");
    return `<svg class="ml-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)} for k from 1 to 8">` +
      `<line class="ml-cax" x1="${pl}" x2="${W - pr}" y1="${H - pb}" y2="${H - pb}"/>` +
      `<text x="${pl - 6}" y="${y(y1 / 1.08) + 4}" text-anchor="end">${hi.toFixed(dec)}</text><text x="${pl - 6}" y="${H - pb}" text-anchor="end">${y0.toFixed(dec)}</text>` +
      ticks + `<text x="${W - pr}" y="${H - 8 - 12}" text-anchor="end" class="ml-cunit">k</text>` +
      `<path class="ml-cline" d="${line}"/>${marks}` +
      (curR ? `<text class="ml-cval" x="${cur >= 6 ? x(cur) - 8 : x(cur) + 8}" y="${y(curR[key]) - 9}" text-anchor="${cur >= 6 ? "end" : "start"}">${curR[key].toFixed(dec)}${best === cur ? " · best" : ""}</text>` : "") +
      (best && best !== cur ? `<text class="ml-cbest" x="${x(best)}" y="${pt}" text-anchor="middle">best</text>` : "") + `</svg>`;
  }
  function renderHow() {
    const body = $("mlHowBody");
    if (!body || !V.scan) return;
    const p = D().base().pca, rows = V.scan.rows, nNew = V.list.filter((i) => i.source !== "table").length;
    body.innerHTML = `<ol class="ml-steps">
        <li><b>Features.</b> Each dish becomes 7 numbers per 100 g, as cooked at home with its usual oil or ghee: energy, protein, carbs, fat, fibre, sugar and added sugar. They come from the app's food table (${V.list.length - nNew} dishes${nNew ? `, plus ${nNew} new dish${nNew === 1 ? "" : "es"} from your scans` : ""}).</li>
        <li><b>Scaling.</b> Each number goes on a log scale (log of 1 + value) so a few extreme dishes, like the sugar in jalebi, do not stretch everything. Then each becomes a z-score: standard deviations from the average dish.</li>
        <li><b>K-Means clustering</b> (unsupervised). Starts with k-means++, repeats from 10 different starts and keeps the tightest result. Each group is named from its centre, for example "Protein-rich" when protein is well above average. To pick k, the elbow chart shows how tight the groups are (inertia, lower is tighter) and the silhouette shows how well separated they are (higher is better).</li>
        <li><b>PCA</b> squashes the 7 numbers into 2 for drawing. Across: PC1, ${Math.round(p.ratio[0] * 100)}% of the variation, ${esc(M().axisWords(p.components[0]))}. Up: PC2, ${Math.round(p.ratio[1] * 100)}%, ${esc(M().axisWords(p.components[1]))}. The groups are found on all 7 numbers, so a few dots can sit inside another group's area on the flat map.</li>
        <li><b>KNN swaps.</b> For a dish, the nearest dishes by cosine similarity, among dishes with the same role on the plate (a bread for a bread) that fit your diet type. A swap must score better on health (more protein and fibre, less fat, added sugar and energy) and is never higher in fat, added sugar or energy.</li>
        <li><b>New dishes.</b> When a scan finds a dish the table does not have, the AI is asked once for its nutrients, which are checked (sensible ranges, energy close to 4 kcal per g of protein and carbs and 9 per g of fat). The dish is placed with the same scaling and PCA, and K-Means re-runs with it included.</li>
      </ol>
      <div class="ml-charts">
        <figure><figcaption><b>Elbow</b> <span class="small muted">inertia, lower is tighter</span></figcaption>${lineChart(rows, "inertia", V.k, null, "Inertia")}</figure>
        <figure><figcaption><b>Silhouette</b> <span class="small muted">higher is better separated</span></figcaption>${lineChart(rows, "silhouette", V.k, V.scan.best, "Silhouette")}</figure>
      </div>
      <table class="ml-table ml-ktable"><caption class="small muted">The same numbers as a table</caption><thead><tr><th scope="col">k</th><th scope="col">Inertia</th><th scope="col">Silhouette</th></tr></thead><tbody>${rows.map((r) => `<tr${r.k === V.k ? ' class="is-cur"' : ""}><th scope="row">${r.k}</th><td>${r.inertia.toFixed(1)}</td><td>${r.silhouette === null ? "–" : r.silhouette.toFixed(3)}</td></tr>`).join("")}</tbody></table>`;
  }

  // ---------- every group as a list (the table view of the map) ----------
  function renderGroups() {
    const box = $("mlGroups"), m = V.model;
    if (!box || !m) return;
    box.innerHTML = m.names.map((name, c) => {
      const members = V.list.filter((i) => m.labelOf[i.key] === c).sort((a, b) => count(b.key) - count(a.key) || a.name.localeCompare(b.name));
      return `<section class="ml-group"><h4>${keySvg(c)}${esc(name)} <small class="muted">${members.length} dishes · ${SHAPE_NAMES[c % 8]}</small></h4><p class="small">${members.map((i) => `<button type="button" class="ml-linkbtn${count(i.key) ? " is-mine" : ""}" data-sel="${esc(i.key)}">${esc(i.name)}${i.source !== "table" ? " ★" : ""}</button>`).join(", ")}</p></section>`;
    }).join("");
  }

  // ---------- the view ----------
  // New dishes waiting for nutrients: estimated once the app has checked whether AI is
  // available (App.start calls onClaude after that check), so a dish is not matched by name
  // a moment before AI comes online.
  let probed = false;
  function syncPending() {
    if (!probed) return;
    D().pendingLabels().then((l) => { if (l.length) D().syncNewDishes(3); }).catch(() => {});
  }
  let refreshT = 0;
  function refresh() {
    clearTimeout(refreshT);
    refreshT = setTimeout(async () => {
      if (App.current !== "foodmap" || !V.built) return;
      try { await load(); renderAll(); } catch (e) { console.error("Food map refresh failed", e); }
    }, 150);
  }

  App.views.foodmap = {
    init() {
      try { D().init(); D().onChange(refresh); } catch (e) { console.error(e); }
      try { if (App.MLSwaps) App.MLSwaps.init(); } catch (e) { console.error(e); }
    },
    async show() {
      const box = $("foodMapPage");
      if (!V.built) build();
      try {
        await load();
        renderAll();
        if (V.pendingFocus) { const k = V.pendingFocus; V.pendingFocus = null; requestAnimationFrame(() => select(k, true)); }
        syncPending();
      } catch (e) {
        console.error("Food map failed", e);
        box.insertAdjacentHTML("afterbegin", `<div class="card notice">The food map could not load. Reload the page to try again.</div>`);
      }
    },
    hide() { hideTip(); },
    onClaude() {
      probed = true;
      if (App.current === "foodmap") { refresh(); syncPending(); }
    },
  };
  // Open the map on one dish (used by the swaps card after a scan).
  App.MLFoodMap = { focus(key) { V.pendingFocus = key; } };
})();
