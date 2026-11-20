/* targets.js: daily energy and nutrient targets for one adult, from ICMR NIN 2020.
   Pure maths, no screen code, so it can be checked by hand or in Node.

   Energy method: the ICMR NIN 2020 factorial method, TEE = BMR x PAL.
   BMR uses the FAO/WHO/UNU 2004 equations reduced by 10% for men and 9% for women
   (RDA 2020 short report). PAL is 1.4 sedentary, 1.8 moderate, 2.3 heavy.
   Check: a 65 kg man aged 19 to 30 gives 2,105 / 2,707 / 3,459 kcal and a 55 kg woman
   1,658 / 2,132 / 2,724 kcal, matching the ICMR reference values (2,110 / 2,710 / 3,470
   and 1,660 / 2,130 / 2,720) within 0.5%.
   Mifflin St Jeor is shown only for comparison: the research found it overestimates BMR
   in Asian samples, so it is not the default. */
(function (root) {
  "use strict";

  const ACTIVITY = {
    sedentary: { pal: 1.4, label: "Sedentary", desc: "Desk work, little walking, no regular exercise" },
    moderate:  { pal: 1.8, label: "Moderate",  desc: "On your feet much of the day, or exercise most days" },
    heavy:     { pal: 2.3, label: "Heavy",     desc: "Hard physical work, or intense training every day" },
  };
  const GOALS = { lose: "Lose weight", maintain: "Maintain", gain: "Gain weight" };
  const DIETS = {
    vegetarian: "Vegetarian", eggetarian: "Eggetarian", nonveg: "Non vegetarian", vegan: "Vegan", jain: "Jain",
  };

  // FAO/WHO/UNU 2004 BMR equations, kcal per day, weight in kg.
  function bmrFAO(sex, age, w) {
    if (sex === "male") return age < 30 ? 15.057 * w + 692.2 : age < 60 ? 11.472 * w + 873.1 : 11.711 * w + 587.7;
    return age < 30 ? 14.818 * w + 486.6 : age < 60 ? 8.126 * w + 845.6 : 9.082 * w + 658.5;
  }
  const ICMR_BMR_FACTOR = { male: 0.90, female: 0.91 };
  const bmrICMR = (sex, age, w) => bmrFAO(sex, age, w) * ICMR_BMR_FACTOR[sex];
  const mifflin = (sex, age, w, h) => 10 * w + 6.25 * h - 5 * age + (sex === "male" ? 5 : -161);

  const bmi = (w, h) => w / Math.pow(h / 100, 2);
  // Asian Indian cut offs (consensus guideline used in the research): 23 overweight, 25 obese.
  function bmiClass(b) {
    if (b < 18.5) return { cls: "under", label: "Underweight" };
    if (b < 23) return { cls: "normal", label: "Normal" };
    if (b < 25) return { cls: "over", label: "Overweight (Asian Indian cut off)" };
    return { cls: "obese", label: "Obese (Asian Indian cut off)" };
  }

  // Check a profile. Returns a list of problems in plain words (empty when fine).
  function problems(p) {
    const out = [];
    if (!(p.age >= 18)) out.push("Age must be 18 or over.");
    if (p.age > 100) out.push("Age looks wrong.");
    if (!["male", "female"].includes(p.sex)) out.push("Choose the sex used for the equations.");
    if (!(p.height >= 120 && p.height <= 220)) out.push("Height should be between 120 and 220 cm.");
    if (!(p.weight >= 30 && p.weight <= 250)) out.push("Weight should be between 30 and 250 kg.");
    if (!ACTIVITY[p.activity]) out.push("Choose an activity level.");
    if (!GOALS[p.goal]) out.push("Choose a goal.");
    if (!DIETS[p.diet]) out.push("Choose a diet type.");
    return out;
  }

  /* Targets for a profile.
     Each nutrient: { label, unit, kind, low, high, src }
       kind "min":  low is the EAR (or 80% of RDA), high the RDA. Below low = gap, low to high = close.
       kind "max":  high is the upper limit; above it is flagged.
       kind "info": shown, never flagged (data too weak, or no ICMR value). */
  function compute(p) {
    const bad = problems(p);
    if (p.age > 0 && p.age < 18) return { ok: false, reason: "age", msg: "ThaliHeal targets are for adults 18 and over. Please ask a doctor or a dietitian about targets for anyone younger." };
    if (bad.length) return { ok: false, reason: "invalid", msg: bad.join(" ") };
    if (p.sex === "female" && (p.stage === "pregnant" || p.stage === "breastfeeding"))
      return { ok: false, reason: "stage", msg: "Needs change a lot in pregnancy and while breastfeeding, so the app does not set targets for this. Please get them from your doctor or a dietitian. You can still log meals." };

    const male = p.sex === "male", act = ACTIVITY[p.activity];
    const B = bmi(p.weight, p.height), bc = bmiClass(B);
    const bmr = bmrICMR(p.sex, p.age, p.weight);
    const tee = bmr * act.pal;
    const notes = [];

    // Goal. No weight loss when underweight; smaller deficit in the normal range; never below BMR or 1,200 kcal.
    let goal = p.goal, target = tee, goalNote = "Maintenance: your estimated daily energy use.";
    if (goal === "lose" && B < 18.5) {
      goal = "maintain";
      notes.push({ level: "warn", text: "Weight loss is not offered when BMI is under 18.5. Targets are set for maintenance. Please talk to a doctor if you want to change your weight." });
    }
    const floor = Math.max(bmr, 1200);
    if (goal === "lose") {
      const deficit = B >= 23 ? 500 : 300;
      target = Math.max(tee - deficit, floor);
      goalNote = `Weight loss: ${deficit} kcal below your energy use${target === floor && tee - deficit < floor ? ", held at the safe floor" : ""}. The app never sets a target below your BMR or 1,200 kcal.`;
    } else if (goal === "gain") {
      target = tee + 300;
      goalNote = "Weight gain: 300 kcal above your energy use. Pair it with protein and strength training.";
    }
    const energy = {
      bmr, tee, target, floor, goal, goalNote,
      lo: goal === "lose" ? Math.max(target * 0.9, floor) : target * 0.9,
      hi: target * 1.1,
      mifflinBmr: mifflin(p.sex, p.age, p.weight, p.height),
    };
    energy.mifflinTee = energy.mifflinBmr * act.pal;

    // Protein per kg. Above a BMI of 23 the weight used is capped at the weight for BMI 23 (app choice).
    const capW = 23 * Math.pow(p.height / 100, 2);
    const pw = B > 23 ? capW : p.weight;
    const fibre = male ? (p.activity === "sedentary" ? 30 : 40) : (p.activity === "sedentary" ? 25 : 30);
    const visibleFat = male ? { sedentary: 25, moderate: 30, heavy: 40 }[p.activity] : { sedentary: 20, moderate: 25, heavy: 30 }[p.activity];
    const postMeno = !male && p.stage === "postmenopause";
    const SRC_RDA80 = "ICMR NIN 2020 RDA. Lower end is 80% of the RDA (NIN: the EAR is about 80% of the RDA).";
    const n = {
      protein:   { label: "Protein", unit: "g", kind: "min", low: 0.66 * pw, high: 0.83 * pw,
                   src: `ICMR NIN 2020: EAR 0.66 and RDA 0.83 g per kg${B > 23 ? `, using ${Math.round(pw)} kg (weight at BMI 23)` : ""}.` },
      fibre:     { label: "Fibre", unit: "g", kind: "min", low: fibre * 0.8, high: fibre,
                   src: `ICMR NIN 2020: ${fibre} g for ${male ? "men" : "women"} with ${p.activity === "heavy" ? "moderate (no heavy value given)" : p.activity} activity. Lower end 80% (app choice).` },
      iron:      { label: "Iron", unit: "mg", kind: "min", low: male ? 11 : 15, high: male ? 19 : 29, src: "ICMR NIN 2020: EAR and RDA." },
      calcium:   { label: "Calcium", unit: "mg", kind: "min", low: postMeno ? 1000 : 800, high: postMeno ? 1200 : 1000,
                   src: postMeno ? "ICMR NIN 2020: RDA 1,200 mg after menopause; lower end set 200 mg below, as for other groups." : "ICMR NIN 2020: EAR 800, RDA 1,000 mg." },
      zinc:      { label: "Zinc", unit: "mg", kind: "min", low: male ? 14 : 11, high: male ? 17 : 13.2, src: "ICMR NIN 2020: EAR and RDA." },
      magnesium: { label: "Magnesium", unit: "mg", kind: "min", low: (male ? 440 : 370) * 0.8, high: male ? 440 : 370, src: SRC_RDA80 },
      folate:    { label: "Folate", unit: "µg", kind: "min", low: (male ? 300 : 220) * 0.8, high: male ? 300 : 220, src: SRC_RDA80 },
      vitc:      { label: "Vitamin C", unit: "mg", kind: "min", low: (male ? 80 : 65) * 0.8, high: male ? 80 : 65, src: SRC_RDA80 },
      vita:      { label: "Vitamin A", unit: "µg", kind: "info", low: (male ? 1000 : 840) * 0.8, high: male ? 1000 : 840,
                   src: SRC_RDA80 + " Shown only: the food table undercounts vitamin A from milk and the 8:1 carotene factor is an assumption, so it is not flagged." },
      addedFat:  { label: "Added oil and ghee", unit: "g", kind: "max", low: 0, high: visibleFat, src: `ICMR NIN 2020 visible fat: ${visibleFat} g a day for ${male ? "men" : "women"} with ${p.activity} activity.` },
      fat:       { label: "Total fat", unit: "g", kind: "max", low: 0, high: target * 0.30 / 9, src: "DGI 2024: total fat at most 30% of energy." },
      addedSugar:{ label: "Added sugar", unit: "g", kind: "max", low: 0, high: target * 0.05 / 4, src: "DGI 2024: added sugar under 5% of energy. Counted from sugar, jaggery and sweet foods in the table." },
      carbs:     { label: "Carbohydrate", unit: "g", kind: "info", low: 0, high: 0, src: "No ICMR target used here. Shown as a share of energy." },
    };
    if (p.age >= 65) notes.push({ level: "info", text: "Over 65: please check any diet change or symptom with your doctor." });
    if (p.waist > 0 && p.waist >= (male ? 90 : 80)) notes.push({ level: "info", text: `Waist ${p.waist} cm is at or above the Asian Indian cut off of ${male ? 90 : 80} cm for abdominal obesity.` });

    return { ok: true, bmi: B, bmiClass: bmiClass(B), pal: act.pal, energy, n, notes };
  }

  // Status of an average intake against one target.
  function status(t, v) {
    if (t.kind === "info") return { cls: "info", label: "Shown only" };
    if (t.kind === "max") return v > t.high ? { cls: "bad", label: "Above limit" } : { cls: "good", label: "Within limit" };
    if (v < t.low) return { cls: "bad", label: "Logged intake below target" };
    if (v < t.high) return { cls: "warn", label: "Close to target" };
    return { cls: "good", label: "Target met" };
  }
  function energyStatus(e, v) {
    if (v < e.lo) return { cls: "warn", label: "Below your energy target" };
    if (v > e.hi) return { cls: "warn", label: "Above your energy target" };
    return { cls: "good", label: "Within your energy target" };
  }

  const api = { ACTIVITY, GOALS, DIETS, bmrFAO, bmrICMR, mifflin, bmi, bmiClass, problems, compute, status, energyStatus };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root.App) root.App.Targets = api;
})(typeof window !== "undefined" ? window : globalThis);
