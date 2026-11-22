/* ml-core.js: the machine learning maths behind the Food Map and the healthier swaps.
   Pure functions, no screen code, so every step can be checked by hand or in Node
   (node scripts/test_ml.js). Nothing here changes how the rest of the app works.

   The pipeline, in the order it runs:
   1. Features. Each dish becomes 7 numbers per 100 g, as cooked at home with its usual
      oil or ghee: energy, protein, carbs, fat, fibre, sugar, added sugar.
   2. Scale. Each number goes on a log scale first (log of 1 + value), so a few extreme
      dishes, like the sugar in jalebi, do not stretch everything else. Then each feature
      becomes a z-score (how many standard deviations above or below the average dish),
      so energy in kcal does not drown out fibre in g.
   3. K-Means (unsupervised). Groups the dishes into k clusters. Starts with k-means++,
      runs 10 times from different starts and keeps the tightest result (lowest inertia).
      The elbow curve (inertia) and the silhouette score help choose k.
   4. PCA. Squashes the 7 numbers into 2 for the map, keeping as much of the spread as
      possible. K-Means still groups on all 7 numbers; PCA is only for drawing.
   5. KNN swaps. For one dish, find the nearest dishes by cosine similarity among dishes
      with the same role on the plate that fit the diet and score better on health. */
(function (root) {
  "use strict";

  // better: which way is healthier for a swap (null: neither). w: weight in the health score.
  const FEATURES = [
    { key: "kcal", label: "Energy", unit: "kcal", better: "lower", w: 0.5 },
    { key: "protein", label: "Protein", unit: "g", better: "higher", w: 1 },
    { key: "carbs", label: "Carbs", unit: "g", better: null, w: 0 },
    { key: "fat", label: "Fat", unit: "g", better: "lower", w: 1 },
    { key: "fibre", label: "Fibre", unit: "g", better: "higher", w: 1 },
    { key: "sugar", label: "Sugar", unit: "g", better: null, w: 0 },
    { key: "added_sugar", label: "Added sugar", unit: "g", better: "lower", w: 1 },
  ];
  const KEYS = FEATURES.map((f) => f.key);

  // ---------- 1. Features ----------
  // Nutrients per 100 g as cooked at home: the table's base values plus the dish's usual
  // added oil or ghee (the same rule the app uses for a plate cooked at home).
  function asEaten(dish, fats, ctx) {
    const out = {};
    const af = dish.added_fat;
    const fatG = af ? (af[ctx || "home"] ?? af.home ?? 0) : 0;
    const per = af && fats && fats[af.type] ? fats[af.type].per_g : null;
    KEYS.forEach((k) => {
      const base = Number(dish.per100g && dish.per100g[k]) || 0;
      out[k] = base + (per && fatG ? (per[k] || 0) * fatG : 0);
    });
    return out;
  }
  const toVector = (nut) => KEYS.map((k) => Number(nut[k]) || 0);
  // The model's input: the same 7 numbers on a log scale.
  const toFeatures = (nut) => toVector(nut).map((v) => Math.log1p(Math.max(0, v)));

  // ---------- 2. Standardise (z-scores) ----------
  function fitScaler(X) {
    const d = X[0].length, n = X.length;
    const mean = new Array(d).fill(0), std = new Array(d).fill(0);
    X.forEach((x) => x.forEach((v, j) => (mean[j] += v / n)));
    X.forEach((x) => x.forEach((v, j) => (std[j] += ((v - mean[j]) ** 2) / n)));
    for (let j = 0; j < d; j++) std[j] = Math.sqrt(std[j]) || 1;
    return { mean, std };
  }
  const scale = (s, x) => x.map((v, j) => (v - s.mean[j]) / s.std[j]);

  // ---------- small vector helpers ----------
  const dist2 = (a, b) => { let s = 0; for (let j = 0; j < a.length; j++) s += (a[j] - b[j]) ** 2; return s; };
  const dot = (a, b) => { let s = 0; for (let j = 0; j < a.length; j++) s += a[j] * b[j]; return s; };
  const norm = (a) => Math.sqrt(dot(a, a));
  function cosine(a, b) {
    const na = norm(a), nb = norm(b);
    return na && nb ? dot(a, b) / (na * nb) : 0;
  }
  // Seeded random numbers (mulberry32), so the same data always gives the same clusters.
  function rng(seed) {
    let t = seed >>> 0;
    return function () {
      t = (t + 0x6d2b79f5) >>> 0;
      let r = Math.imul(t ^ (t >>> 15), 1 | t);
      r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---------- 3. K-Means ----------
  // k-means++: the first centre at random, each next one picked with probability
  // proportional to its squared distance from the nearest centre already chosen.
  function initPlusPlus(Z, k, rand) {
    const C = [Z[Math.floor(rand() * Z.length)].slice()];
    const d = Z.map((z) => dist2(z, C[0]));
    while (C.length < k) {
      const total = d.reduce((a, b) => a + b, 0);
      let r = rand() * total, i = 0;
      if (total === 0) i = Math.floor(rand() * Z.length);
      else { while (i < Z.length - 1 && (r -= d[i]) > 0) i++; }
      C.push(Z[i].slice());
      Z.forEach((z, j) => (d[j] = Math.min(d[j], dist2(z, C[C.length - 1]))));
    }
    return C;
  }
  function predict(centroids, z) {
    let best = 0, bd = Infinity;
    centroids.forEach((c, i) => { const v = dist2(c, z); if (v < bd) { bd = v; best = i; } });
    return best;
  }
  function kmeansOnce(Z, k, rand, maxIter) {
    let C = initPlusPlus(Z, k, rand);
    let labels = new Array(Z.length).fill(-1), iter = 0;
    for (; iter < maxIter; iter++) {
      let moved = false;
      // Assignment step: each dish joins its nearest centre.
      Z.forEach((z, i) => { const c = predict(C, z); if (c !== labels[i]) { labels[i] = c; moved = true; } });
      if (!moved && iter > 0) break;
      // Update step: each centre moves to the average of its dishes.
      const sum = C.map(() => new Array(Z[0].length).fill(0)), cnt = new Array(k).fill(0);
      Z.forEach((z, i) => { cnt[labels[i]]++; z.forEach((v, j) => (sum[labels[i]][j] += v)); });
      C = C.map((c, ci) => (cnt[ci] ? sum[ci].map((v) => v / cnt[ci]) : c));
    }
    const inertia = Z.reduce((s, z, i) => s + dist2(z, C[labels[i]]), 0);
    return { centroids: C, labels, inertia, iterations: iter + 1 };
  }
  function kmeans(Z, k, o) {
    o = o || {};
    k = Math.max(1, Math.min(k, Z.length));
    const rand = rng(o.seed ?? 42), restarts = o.restarts ?? 10, maxIter = o.maxIter ?? 100;
    let best = null;
    for (let r = 0; r < restarts; r++) {
      const res = kmeansOnce(Z, k, rand, maxIter);
      if (!best || res.inertia < best.inertia - 1e-9) best = res;
    }
    best.k = k;
    return best;
  }
  // Silhouette: for each dish, (b - a) / max(a, b), where a is the average distance to its
  // own cluster and b to the nearest other cluster. Near 1: well grouped. Near 0: on a border.
  function silhouette(Z, labels, k) {
    if (k < 2) return 0;
    const n = Z.length, D = Z.map((a) => Z.map((b) => Math.sqrt(dist2(a, b))));
    let total = 0;
    for (let i = 0; i < n; i++) {
      const sums = new Array(k).fill(0), cnt = new Array(k).fill(0);
      for (let j = 0; j < n; j++) if (j !== i) { sums[labels[j]] += D[i][j]; cnt[labels[j]]++; }
      if (!cnt[labels[i]]) continue;   // a cluster of one scores 0
      const a = sums[labels[i]] / cnt[labels[i]];
      let b = Infinity;
      for (let c = 0; c < k; c++) if (c !== labels[i] && cnt[c]) b = Math.min(b, sums[c] / cnt[c]);
      if (b === Infinity) continue;
      total += (b - a) / Math.max(a, b);
    }
    return total / n;
  }
  // Elbow and silhouette for k = 1..kMax.
  function scanK(Z, kMax, o) {
    const out = [];
    for (let k = 1; k <= kMax; k++) {
      const r = kmeans(Z, k, o);
      out.push({ k, inertia: r.inertia, silhouette: k > 1 ? silhouette(Z, r.labels, k) : null });
    }
    return out;
  }

  // ---------- 4. PCA ----------
  // Covariance of the standardised data, then its top eigenvectors by power iteration
  // with deflation. Each component's sign is fixed so its largest loading is positive.
  function pca(Z, nComp) {
    nComp = nComp || 2;
    const d = Z[0].length, n = Z.length;
    const mean = new Array(d).fill(0);
    Z.forEach((z) => z.forEach((v, j) => (mean[j] += v / n)));
    const C = Array.from({ length: d }, () => new Array(d).fill(0));
    Z.forEach((z) => { for (let a = 0; a < d; a++) for (let b = 0; b < d; b++) C[a][b] += ((z[a] - mean[a]) * (z[b] - mean[b])) / (n - 1); });
    const totalVar = C.reduce((s, row, i) => s + row[i], 0);
    const comps = [], vars = [];
    const M = C.map((r) => r.slice());
    for (let c = 0; c < nComp; c++) {
      let v = new Array(d).fill(0).map((_, j) => 1 / Math.sqrt(d) + j * 1e-3);
      let lambda = 0;
      for (let it = 0; it < 1000; it++) {
        const w = M.map((row) => dot(row, v));
        const nw = norm(w);
        if (!nw) break;
        const next = w.map((x) => x / nw);
        const diff = Math.sqrt(dist2(next, v));
        v = next; lambda = nw;
        if (diff < 1e-12) break;
      }
      let big = 0;
      v.forEach((x, j) => { if (Math.abs(x) > Math.abs(v[big])) big = j; });
      if (v[big] < 0) v = v.map((x) => -x);
      comps.push(v); vars.push(lambda);
      for (let a = 0; a < d; a++) for (let b = 0; b < d; b++) M[a][b] -= lambda * v[a] * v[b];
    }
    return { mean, components: comps, variance: vars, ratio: vars.map((x) => (totalVar ? x / totalVar : 0)) };
  }
  const project = (p, z) => p.components.map((c) => dot(c, z.map((v, j) => v - p.mean[j])));

  // ---------- naming clusters from their centres ----------
  // A cluster is named from its centre (z-scores against the average dish):
  //   energy 1 SD or more below average: "Light, low energy"
  //   else its highest feature, if 0.5 SD or more above average: e.g. "Protein-rich"
  //   else, if every feature is within 0.6 SD of average: "Balanced"
  //   else its lowest feature: e.g. "Light, low fat"
  // If that name is taken, the next most distinctive feature is added.
  const TRAIT = { kcal: "Energy-dense", protein: "Protein-rich", carbs: "Carb-heavy", fat: "High-fat", fibre: "Fibre-rich", sugar: "Sweet", added_sugar: "Sweet" };
  const TRAIT_LOW = { kcal: "low energy", protein: "low protein", carbs: "low carb", fat: "low fat", fibre: "low fibre", sugar: "low sugar", added_sugar: "low sugar" };
  const traitWord = (o) => (o.z > 0 ? TRAIT[o.k].toLowerCase() : TRAIT_LOW[o.k]);
  function nameClusters(centroids) {
    const used = {};
    return centroids.map((c) => {
      const f = KEYS.map((k, j) => ({ k, z: c[j] }));
      const byPos = f.slice().sort((a, b) => b.z - a.z), byAbs = f.slice().sort((a, b) => Math.abs(b.z) - Math.abs(a.z));
      const kcal = f[0];
      let name, main;
      if (kcal.z <= -1) { main = kcal; name = "Light, low energy"; }
      else if (byPos[0].z >= 0.5) { main = byPos[0]; name = TRAIT[main.k]; }
      else if (Math.abs(byAbs[0].z) < 0.6) { main = null; name = "Balanced"; }
      else { main = f.slice().sort((a, b) => a.z - b.z)[0]; name = `Light, ${TRAIT_LOW[main.k]}`; }
      if (used[name]) {
        const lower = name.toLowerCase();
        const next = byAbs.find((o) => o !== main && Math.abs(o.z) >= 0.3 && !lower.includes(traitWord(o)));
        if (next) name = `${name}, ${traitWord(next)}`;
      }
      let unique = name, n = 2;
      while (used[unique]) unique = `${name} (${n++})`;
      used[unique] = true;
      return unique;
    });
  }
  // Plain words for a PCA axis from its loadings, e.g. "more energy, fat and protein".
  function axisWords(component) {
    const lab = (k) => FEATURES.find((f) => f.key === k).label.toLowerCase();
    const l = KEYS.map((k, j) => ({ k, v: component[j] })).filter((x) => !(x.k === "sugar" && component[KEYS.indexOf("added_sugar")] * x.v > 0));
    const pos = l.filter((x) => x.v >= 0.3).sort((a, b) => b.v - a.v).slice(0, 3).map((x) => lab(x.k));
    const neg = l.filter((x) => x.v <= -0.3).sort((a, b) => a.v - b.v).slice(0, 2).map((x) => lab(x.k));
    const list = (a) => (a.length > 1 ? a.slice(0, -1).join(", ") + " and " + a[a.length - 1] : a[0]);
    return [pos.length ? "more " + list(pos) : "", neg.length ? "less " + list(neg) : ""].filter(Boolean).join(", ");
  }

  // ---------- 5. Swaps: health score, diet and KNN ----------
  // Health score: more protein and fibre is better; more fat, added sugar and energy is
  // worse. Each is measured in standard deviations from the average dish.
  function healthScore(z) {
    return FEATURES.reduce((s, f, j) => s + (f.better === "higher" ? f.w : f.better === "lower" ? -f.w : 0) * z[j], 0);
  }

  // The dish's role on the plate: swaps stay inside the same role (a bread for a bread).
  function roleOf(dish) {
    const c = dish.category, t = dish.type;
    if (c === "Breads" || t === "roti") return "bread";
    if (t === "rice") return "rice";
    if (c === "Dals" || t === "dal") return "dal";
    if (c === "Vegetables") return "veg";
    if (c === "Non veg") return "nonveg";
    if (c === "Sweets" || t === "sweet") return "sweet";
    if (c === "Drinks") return "drink";
    if (c === "Accompaniments" || c === "Fruit") return "side";
    return "snack";   // Snacks, South Indian, Fast food, Indo Chinese
  }
  const ROLES = { bread: "Breads", rice: "Rice", dal: "Dals", veg: "Vegetable dishes", nonveg: "Meat, fish and egg", snack: "Snacks and tiffin", sweet: "Sweets", drink: "Drinks", side: "Sides and fruit" };

  // What the dish contains, for diet filters.
  function tagsOf(dish) {
    const f = dish.flags || {};
    return { meat: !!f.meat, fish: !!f.fish, egg: !!f.egg, dairy: !!f.dairy, jainAvoid: !!f.jain_avoid, unknownJain: false };
  }
  // diet: the profile's diet type. Without a profile, a vegetarian dish only gets vegetarian swaps.
  function dietAllows(diet, tags, targetTags) {
    if (diet === "nonveg") return true;
    if (diet === "eggetarian") return !tags.meat && !tags.fish;
    if (diet === "vegan") return !tags.meat && !tags.fish && !tags.egg && !tags.dairy;
    if (diet === "jain") return !tags.meat && !tags.fish && !tags.egg && !tags.jainAvoid && !tags.unknownJain;
    if (diet === "vegetarian") return !tags.meat && !tags.fish && !tags.egg;
    if (targetTags && !targetTags.meat && !targetTags.fish && !targetTags.egg) return !tags.meat && !tags.fish && !tags.egg;
    return true;
  }

  // Why a swap is better, in plain words, from the per 100 g values.
  // hideKcal: the person chose to hide calorie numbers, so energy becomes the word "lighter".
  const MIN_DIFF = { kcal: 15, protein: 1, fat: 1, fibre: 0.5, added_sugar: 1 };
  function reasons(from, to, hideKcal) {
    const out = [];
    if (hideKcal && from.kcal - to.kcal >= MIN_DIFF.kcal) out.push({ key: "kcal", text: "lighter", weight: 0.5 });
    FEATURES.forEach((f) => {
      if (!f.better || (hideKcal && f.key === "kcal")) return;
      const a = from[f.key], b = to[f.key], diff = b - a;
      if (Math.abs(diff) < MIN_DIFF[f.key]) return;
      const good = f.better === "higher" ? diff > 0 : diff < 0;
      if (!good) return;
      const pct = a > 0 ? Math.round((Math.abs(diff) / a) * 100) : null;
      const sign = diff > 0 ? "+" : "−";
      const text = pct !== null && pct <= 300
        ? `${sign}${pct}% ${f.label.toLowerCase()}`
        : `${sign}${Math.round(Math.abs(diff) * 10) / 10}${f.unit === "kcal" ? " kcal" : " g"} ${f.label.toLowerCase()}`;
      out.push({ key: f.key, text, weight: f.w * Math.abs(diff) / (MIN_DIFF[f.key] || 1) });
    });
    return out.sort((x, y) => y.weight - x.weight).slice(0, 2).map((r) => r.text);
  }

  // A swap may never add fat, added sugar or energy: at most 10% more, or the smallest
  // difference that counts, whichever is larger.
  function notWorse(from, to) {
    return FEATURES.every((f) => f.better !== "lower" || to[f.key] <= Math.max(from[f.key] * 1.1, from[f.key] + MIN_DIFF[f.key]));
  }

  // KNN: the k nearest healthier dishes by cosine similarity.
  //   target, pool items: { key, name, role, tags, z, nut }
  function swaps(target, pool, o) {
    o = o || {};
    const k = o.k || 3, minGain = o.minGain ?? 0.35, minSim = o.minSim ?? 0.25;
    const h0 = healthScore(target.z);
    return pool
      .filter((c) => c.key !== target.key && c.role === target.role && dietAllows(o.diet, c.tags, target.tags) && notWorse(target.nut, c.nut))
      .map((c) => ({ item: c, sim: cosine(target.z, c.z), gain: healthScore(c.z) - h0 }))
      .filter((c) => c.gain >= minGain && c.sim >= minSim)
      .map((c) => ({ ...c, why: reasons(target.nut, c.item.nut, o.hideKcal) }))
      .filter((c) => c.why.length)
      .sort((a, b) => b.sim - a.sim)
      .slice(0, k);
  }
  // Swaps plus what to say when there are none:
  //   "swaps": close, healthier dishes found
  //   "no_close": healthier dishes exist in the same role but none is similar; the lightest are given
  //   "good": nothing in the same role is clearly healthier
  function swapsFor(target, pool, o) {
    o = o || {};
    const list = swaps(target, pool, o);
    if (list.length) return { status: "swaps", list };
    const other = swaps(target, pool, { ...o, minSim: -1, k: 50 }).sort((a, b) => b.gain - a.gain).slice(0, 2);
    return other.length ? { status: "no_close", list: other } : { status: "good", list: [] };
  }

  // ---------- reading the AI's nutrient estimate for a new dish ----------
  const LIMITS = { kcal: [0, 900], protein: [0, 100], carbs: [0, 100], fat: [0, 100], fibre: [0, 60], sugar: [0, 100], added_sugar: [0, 100] };
  const ROLE_KEYS = Object.keys(ROLES);
  // Returns { ok: true, nut, role, tags, name } or { ok: false, why }.
  function readEstimate(obj) {
    if (!obj || typeof obj !== "object") return { ok: false, why: "no_json" };
    if (obj.food === false) return { ok: false, why: "not_food" };
    if (obj.error) return { ok: false, why: String(obj.error) };
    const nut = {};
    for (const k of KEYS) {
      const v = Number(obj[k]);
      if (!Number.isFinite(v) || v < LIMITS[k][0] || v > LIMITS[k][1]) return { ok: false, why: "bad_" + k };
      nut[k] = Math.round(v * 10) / 10;
    }
    if (nut.added_sugar > nut.sugar) nut.sugar = nut.added_sugar;
    if (nut.protein + nut.carbs + nut.fat + nut.fibre > 105) return { ok: false, why: "too_much" };
    // Energy should roughly match 4 kcal per g of protein and carbs, 9 per g of fat.
    const calc = 4 * nut.protein + 4 * nut.carbs + 9 * nut.fat + 2 * nut.fibre;
    if (Math.abs(calc - nut.kcal) > 0.35 * Math.max(calc, nut.kcal) + 30) return { ok: false, why: "energy_mismatch" };
    const role = ROLE_KEYS.includes(obj.group) ? obj.group : "snack";
    const diet = ["veg", "egg", "nonveg"].includes(obj.diet) ? obj.diet : "nonveg";
    const tags = { meat: diet === "nonveg", fish: false, egg: diet === "egg", dairy: obj.dairy === true, jainAvoid: false, unknownJain: true };
    const name = typeof obj.name === "string" && obj.name.trim() ? obj.name.trim().slice(0, 60) : null;
    return { ok: true, nut, role, tags, name };
  }

  // ---------- name matching (the fallback when the AI cannot help) ----------
  const STOP = new Set(["and", "with", "the", "of", "in", "a", "dish", "curry", "masala", "sabzi", "fry", "plain"]);
  const tokens = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w.length > 1 && !STOP.has(w));
  // Best table dish by word overlap (Jaccard) between the label and the dish's name and aliases.
  function nameMatch(label, dishes) {
    const a = new Set(tokens(label));
    if (!a.size) return null;
    let best = null;
    dishes.forEach((d) => {
      [d.name, ...(d.aliases || [])].forEach((n) => {
        const b = new Set(tokens(n));
        if (!b.size) return;
        let inter = 0;
        a.forEach((w) => { if (b.has(w)) inter++; });
        const score = inter / (a.size + b.size - inter);
        if (!best || score > best.score) best = { dish: d, score };
      });
    });
    return best && best.score >= 0.34 ? best : null;
  }

  const api = {
    FEATURES, KEYS, ROLES, asEaten, toVector, toFeatures, fitScaler, scale, dist2, cosine, rng,
    kmeans, predict, silhouette, scanK, pca, project, nameClusters, axisWords,
    healthScore, roleOf, tagsOf, dietAllows, notWorse, reasons, swaps, swapsFor, readEstimate, tokens, nameMatch,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root.App) root.App.MLCore = api;
})(typeof window !== "undefined" ? window : globalThis);
