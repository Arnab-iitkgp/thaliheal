// Checks for js/ml-core.js (Food Map and healthier swaps). Run: node scripts/test_ml.js
const M = require("../public/js/ml-core.js");
const data = require("../public/data/dishes.json");
let fail = 0, n = 0;
const ok = (cond, what) => { n++; if (!cond) { fail++; console.log("FAIL", what); } };
const near = (a, b, eps) => Math.abs(a - b) <= (eps ?? 1e-6);

// ---------- maths on small known data ----------
// Two clear blobs: K-Means with k = 2 must split them, and do it the same way every run.
const blobs = [[0, 0], [0.2, 0.1], [0.1, 0.3], [-0.1, 0.1], [5, 5], [5.2, 4.9], [4.8, 5.1], [5.1, 5.3]];
const km = M.kmeans(blobs, 2);
ok(km.labels.slice(0, 4).every((l) => l === km.labels[0]) && km.labels.slice(4).every((l) => l === km.labels[4]) && km.labels[0] !== km.labels[4], "k-means splits two blobs");
ok(JSON.stringify(M.kmeans(blobs, 2).labels) === JSON.stringify(km.labels), "k-means is repeatable (seeded)");
ok(M.silhouette(blobs, km.labels, 2) > 0.9, "silhouette near 1 for well separated blobs");
ok(M.predict(km.centroids, [5, 5]) === km.labels[4], "predict puts a new point in the nearest cluster");
const scan = M.scanK(blobs, 4);
ok(scan.every((r, i) => i === 0 || r.inertia <= scan[i - 1].inertia + 1e-9), "inertia never rises as k grows");

// PCA: points on the line y = 2x have all their variation on the first component.
const line = [-2, -1, 0, 1, 2].map((t) => [t, 2 * t]);
const p = M.pca(line, 2);
ok(near(p.ratio[0], 1, 1e-6), "PCA: one direction explains a straight line");
ok(near(Math.abs(p.components[0][1] / p.components[0][0]), 2, 1e-4), "PCA: first component follows y = 2x");

// Scaling and cosine.
const sc = M.fitScaler([[1, 10], [3, 30]]);
ok(near(M.scale(sc, [2, 20])[0], 0) && near(M.scale(sc, [3, 30])[1], 1), "z-scores: mean 0, one SD = 1");
ok(near(M.cosine([1, 0], [1, 0]), 1) && near(M.cosine([1, 0], [0, 1]), 0) && near(M.cosine([1, 2], [-1, -2]), -1), "cosine similarity");

// ---------- the real food table ----------
const items = data.dishes.map((d) => {
  const nut = M.asEaten(d, data.fats, "home");
  return { key: d.id, name: d.name, role: M.roleOf(d), tags: M.tagsOf(d), nut, x: M.toFeatures(nut) };
});
const scaler = M.fitScaler(items.map((i) => i.x));
items.forEach((i) => (i.z = M.scale(scaler, i.x)));
const by = Object.fromEntries(items.map((i) => [i.key, i]));
ok(items.every((i) => i.x.length === 7 && i.x.every(Number.isFinite)), "every dish has 7 finite features");
ok(by.medu_vada.nut.fat > 10, "frying oil is counted (medu vada fat includes absorbed oil)");

const Z = items.map((i) => i.z), k5 = M.kmeans(Z, 5), names = M.nameClusters(k5.centroids);
ok(new Set(names).size === names.length, "cluster names are unique");
const groupOf = (id) => names[k5.labels[items.indexOf(by[id])]];
ok(groupOf("gulab_jamun") === groupOf("jalebi") && /Sweet/.test(groupOf("jalebi")), "sweets cluster together and are named Sweet");
ok(/Protein/.test(groupOf("chicken_tikka")), "chicken tikka is in a protein-rich group");
const pc = M.pca(Z, 2);
ok(pc.ratio[0] >= pc.ratio[1] && pc.ratio[0] + pc.ratio[1] > 0.5, "PCA keeps over half the variation in 2D");

// Swaps: same role, healthier, never more fat, added sugar or energy, diet respected.
const swapsOf = (id, diet) => M.swaps(by[id], items, { diet });
for (const id of ["butter_naan", "samosa", "gulab_jamun", "paneer_butter_masala", "french_fries", "cola"]) {
  const t = by[id], s = swapsOf(id, "vegetarian");
  ok(s.length > 0, `${t.name} has a swap`);
  s.forEach((x) => {
    ok(x.item.role === t.role, `${t.name} → ${x.item.name}: same role`);
    ok(M.healthScore(x.item.z) > M.healthScore(t.z), `${t.name} → ${x.item.name}: healthier`);
    ok(M.notWorse(t.nut, x.item.nut), `${t.name} → ${x.item.name}: no more fat, added sugar or energy`);
    ok(!x.item.tags.meat && !x.item.tags.fish && !x.item.tags.egg, `${t.name} → ${x.item.name}: vegetarian`);
    ok(x.why.length > 0, `${t.name} → ${x.item.name}: has a reason`);
  });
}
ok(swapsOf("butter_naan", "vegetarian").some((x) => /roti/i.test(x.item.name)), "butter naan → a roti");
ok(swapsOf("cola", "vegetarian").some((x) => /Chaas/.test(x.item.name)), "cola → chaas");
ok(swapsOf("paneer_butter_masala", "vegan").every((x) => !x.item.tags.dairy && !x.item.tags.egg && !x.item.tags.meat), "vegan diet gets no dairy, egg or meat swaps");
ok(swapsOf("gulab_jamun", "jain").every((x) => !x.item.tags.jainAvoid), "jain diet gets no jain-avoid swaps");
ok(M.swapsFor(by.chapati, items, { diet: "vegetarian" }).status === "good", "chapati is already a good pick");
ok(M.swapsFor(by.chicken_biryani, items, { diet: "nonveg" }).status !== "swaps" || M.swapsFor(by.chicken_biryani, items, { diet: "nonveg" }).list.every((x) => x.sim >= 0.25), "no swap below 25% similarity");
ok(M.reasons(by.cola.nut, by.chaas.nut, true).every((r) => !/kcal|energy/.test(r)), "hidden calories: no energy numbers in reasons");

// ---------- reading the AI's estimate for a new dish ----------
const good = { food: true, name: "Paneer tikka masala", kcal: 180, protein: 9, carbs: 7, fat: 13, fibre: 1.5, sugar: 3, added_sugar: 0.5, group: "veg", diet: "veg", dairy: true };
const r = M.readEstimate(good);
ok(r.ok && r.role === "veg" && r.tags.dairy && !r.tags.meat && r.tags.unknownJain, "reads a good estimate");
ok(!M.readEstimate({ food: false }).ok && M.readEstimate({ food: false }).why === "not_food", "not a food is refused");
ok(!M.readEstimate({ ...good, kcal: 900, protein: 1, carbs: 1, fat: 1 }).ok, "energy that does not match the macros is refused");
ok(!M.readEstimate({ ...good, fat: -3 }).ok && !M.readEstimate({ ...good, protein: "lots" }).ok, "nonsense numbers are refused");
ok(!M.readEstimate({ error: "out_of_scope" }).ok, "an out of scope reply is refused");
ok(M.readEstimate({ ...good, group: "pizza" }).role === "snack", "an unknown group falls back to snack");

// Name matching fallback.
const nm = M.nameMatch("paneer butter masala gravy", data.dishes);
ok(nm && nm.dish.id === "paneer_butter_masala", "name match finds paneer butter masala");
ok(M.nameMatch("xyzzy", data.dishes) === null, "no name match for nonsense");

console.log(fail ? `${fail} of ${n} ML checks failed` : `all ${n} ML checks pass`);
process.exitCode = fail ? 1 : 0;
