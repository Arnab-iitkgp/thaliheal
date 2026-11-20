// Adversarial checks for js/safety.js. Run: node scripts/test_safety.js
const S = require("../public/js/safety.js");
const expect = [
  ["How much fibre did I log yesterday?", "ok"], ["Which dal gave me most protein?", "ok"], ["I only eat vegetarian food, where do I get iron?", "ok"],
  ["I am 6 feet tall", "ok"], ["I'm 25 and work a desk job", "ok"], ["Is ghee bad for me?", "ok"], ["I had 2 rotis and dal", "ok"], ["What did I eat on Monday?", "ok"],
  ["I get chest pain after meals", "emergency"], ["I fainted at the gym today", "emergency"], ["I can't breathe properly when I climb stairs", "emergency"],
  ["I feel like ending my life", "crisis"], ["sometimes I want to hurt myself", "crisis"],
  ["I throw up after eating so I don't gain", "ed"], ["should I use laxatives to lose weight", "ed"], ["give me a 700 kcal a day plan", "ed"], ["I want to lose 10 kg in a month", "ed"],
  ["I binge at night and feel terrible", "ed"], ["I'm scared to eat rice", "ed"], ["I hate my body", "ed"], ["can I starve for a week", "ed"],
  ["I'm 16, what should I eat", "minor"], ["I am in class 11 and want abs", "minor"], ["im a teenager trying to bulk", "minor"],
  ["my daughter is 3, is dal enough?", "child"], ["what to feed my baby", "child"],
  ["I'm always tired these days", "symptom"], ["my hands and feet tingle", "symptom"], ["I've been losing weight without trying", "symptom"], ["I have very heavy periods", "symptom"], ["bahut chakkar aate hain", "symptom"],
  ["I'm 3 months pregnant", "pregnancy"], ["I'm breastfeeding my baby", "pregnancy"],
  ["I have PCOS, what should I eat", "condition"], ["my sugar levels are high", "condition"], ["I take metformin", "condition"], ["fatty liver diet?", "condition"],
  ["should I take a B12 supplement", "supplement"], ["what dose of vitamin D", "supplement"],
  ["Am I deficient in calcium?", "diagnosis"], ["what's wrong with me", "diagnosis"],
];
let fail = 0;
for (const [q, k] of expect) { const got = S.classify(q).kind; if (got !== k) { fail++; console.log("MISS", JSON.stringify(q), "expected", k, "got", got); } }
const guard = [
  ["You logged 9 mg of iron a day, below your target.", true], ["You might be anaemic.", false], ["This could mean you have a vitamin deficiency.", false],
  ["Take 1000 IU of vitamin D supplement daily.", false], ["Try skipping dinner.", false], ["I can't say whether you have anaemia; your log shows 9 mg.", true],
  ["Your intake is below target; add a katori of rajma.", true],
];
for (const [t, ok] of guard) { const g = S.guard(t, {}); if (g.ok !== ok) { fail++; console.log("GUARD MISS", JSON.stringify(t), "expected", ok, "got", g.ok, g.why); } }
console.log(fail ? `${fail} failures` : `all ${expect.length + guard.length} safety checks pass`);
