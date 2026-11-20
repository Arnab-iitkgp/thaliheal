/* safety.js: rules that run before and after the AI assistant. Pure functions, testable in Node.

   Before: classify() reads the question. Red flags never reach the model; the app answers
   with a fixed referral instead (research section 6: "the app must refer to a doctor, not
   give dietary advice"). Order matters: the first match wins.
   After: guard() checks every model reply and swaps it for a safe line if it diagnoses,
   gives a dose, suggests skipping meals, or shows calorie numbers in a sensitive session.

   Emergency 112 and Tele MANAS 14416 (free, 24x7, national mental health helpline). */
(function (root) {
  "use strict";
  const TELE = "Tele MANAS on 14416 (free, 24x7, many languages)";

  // Each rule: kind, patterns (any match), fixed reply. Lower case text is tested.
  const RULES = [
    { kind: "crisis",
      re: [/suicid/, /kill (my ?self|myself)/, /\bend(ing)? (it all|my life)\b/, /want to die/, /don'?t want to (live|be alive)/, /no reason to live/, /self[ -]?harm/, /hurt(ing)? myself/, /cut(ting)? myself/],
      reply: `I'm really sorry you're going through this. Please talk to someone now: call ${TELE}, or 112 if you are in danger. If you can, tell someone you trust what you're feeling. You don't have to handle this alone.` },
    { kind: "emergency",
      re: [/chest pain/, /pain in (my )?chest/, /\bfaint(ed|ing)?\b/, /passed out/, /black(ed)? out/, /unconscious/, /can'?t breathe/, /cannot breathe/, /(difficulty|trouble) breathing/, /vomit(ing)? blood/, /blood in (my )?vomit/, /seizure/],
      reply: "This needs a doctor now, not a food app. If it is sudden or severe, call 112 or go to the nearest emergency department." },
    { kind: "ed",
      re: [/make (my ?self|myself) (sick|throw up|vomit)/, /throw(ing)? up after (eating|meals?|food)/, /vomit(ing)? after (eating|meals?|food)/, /\bpurg/, /laxative/, /diet pills?/, /fat burner/,
           /\bstarv/, /stop eating/, /not eating (anything|at all|for)/, /skip(ping)? (all |most |my )?meals? to (lose|get thin|slim)/, /eat (nothing|almost nothing)/,
           /only eat (\d|one meal|once)/, /\b(500|600|700|800|900|1000|1100) ?(kcal|cal|calories)( a| per)? ?day/, /(kcal|calorie) (diet|target) (of|under|below) (500|600|700|800|900|1000|1100)\b/,
           /fast(ing)? for (days|\d+ days|a week)/, /\bbinge/, /out of control (eating|with food)/, /hate my body/, /i('m| am) (so )?(fat|disgusting|gross)/, /feel (so )?(fat|disgusting)/,
           /burn off (everything|what i ate|all)/, /exercise (to|so i can) (burn|cancel|undo)/, /punish (my ?self|myself)/, /(scared|afraid|fear) (of|to) eat/, /guilty (after|about) eating/,
           /lose \d+ ?(kg|kgs|kilos?) in (a|one|1|2|two|3|three) (day|days|week|weeks|month)/, /lose weight (fast|quickly|in a week)/],
      reply: `It sounds like food may feel hard right now, and that matters. I won't give calorie targets or diet plans here. Eating regular meals helps, and talking to a doctor, or someone you trust, can make a real difference. ${TELE} can also listen.`,
      sets: "ed" },
    { kind: "minor",
      re: [/\b(i am|i'm|im|i’m|my age is|age)\s*(a\s+)?(1[0-7]|[5-9])\b(?!\s*(kg|kgs|kilos|cm|ft|feet|foot|%|percent|inch|inches|days?|hours?|meals?|rotis?|g\b))/,
           /\bi('m|’m|m| am) (a )?(teen|teenager|minor|school ?(boy|girl|student))/, /\bi('m|’m|m| am) in (class|std|standard|grade) ?(\d|1[0-2])\b/],
      reply: "ThaliHeal is for adults 18 and over, so I can't give advice here. Please talk to a parent and your doctor about food and growth. If you're under 18, ask a parent to help you delete your data in Privacy.",
      sets: "minor" },
    { kind: "pregnancy",
      re: [/pregnan/, /trimester/, /expecting (a |our )?baby/, /breast ?feed/, /lactat/, /nursing (my|a|the) baby/, /trying to conceive/, /\bttc\b/, /\bivf\b/],
      reply: "During pregnancy, breastfeeding or while trying to conceive, food advice should come from your doctor or a dietitian. You can set your life stage in Profile: targets then switch off, and I'll only report what your log shows." },
    { kind: "child",
      re: [/\bmy (\d+ ?(year|yr)s? ?old )?(son|daughter|child|children|kid|kids|baby|toddler|infant|nephew|niece|younger (brother|sister))\b/, /\b(for|feed(ing)?) (a|my|the|our) (child|kid|baby|toddler|infant)\b/],
      reply: "I can only answer about your own log. For a child's food and growth, please ask a paediatrician. Children under 5 should see a doctor for any symptom." },
    { kind: "symptom",
      re: [/tired all the time/, /always tired/, /constantly tired/, /\bfatigue/, /exhausted/, /no energy all/, /breathless/, /short(ness)? of breath/, /\bdizz/, /\bnumb/, /tingl/, /pins and needles/,
           /memory (loss|problem|issue)/, /\bforget(ful|ting things)/, /blood in (my )?(stool|poop|potty|motion)/, /black (stool|poop|potty|motion)/, /heavy (period|bleeding)/,
           /(losing|lost) weight without/, /unexplained weight loss/, /weight loss without trying/, /palpitation/, /jaundice/, /\bswelling\b/, /\bpale\b/,
           /\bthakan\b/, /\bchakkar\b/, /\bkamzori\b/, /saans? phool/],
      reply: "Symptoms like these need a doctor, not diet tips: please see one soon. A blood test can check things a food log cannot. You can download your log in Privacy to show them what you've been eating." },
    { kind: "condition",
      re: [/diabet/, /sugar (patient|level|levels)/, /blood sugar/, /\binsulin/, /metformin/, /thyroid/, /\bpcos\b/, /\bpcod\b/, /kidney/, /\bckd\b/, /dialysis/, /\bliver\b/, /fatty liver/,
           /\bheart\b/, /cardiac/, /\bbp\b/, /blood pressure/, /hypertension/, /cholesterol/, /statin/, /cancer/, /chemo/, /\bgout\b/, /uric acid/, /\bibs\b/, /celiac|coeliac/, /allerg/,
           /\b(my|on|taking) (medicine|medicines|medication|meds|tablets|pills)\b/, /anaemia|anemia|anaemic|anemic/],
      reply: "With a health condition, or while taking medicines, diet changes should come from your doctor or a registered dietitian. I can't adjust advice for a condition. I can still tell you what your log shows, and you can download it in Privacy to share with them." },
    { kind: "supplement",
      re: [/supplement/, /multivitamin/, /capsule/, /\btablet/, /\bpills?\b/, /injection/, /sachet/, /\bdose|dosage/, /\b60k\b|60,?000 ?iu/, /how (much|many) (mg|mcg|iu)\b/],
      reply: "I can't suggest supplement or medicine doses. Please ask your doctor or pharmacist, and never take more than the label says. I can show what your food log says about a nutrient." },
  ];

  // Questions that ask for a diagnosis go to the model, but start with this fixed line.
  const DIAGNOSIS = [/\bdo i have\b/, /\bhave i got\b/, /\bam i (deficient|healthy|unhealthy|malnourished|low in|lacking)/, /\bdiagnos/, /\bdeficien/, /\bis (my|this) .{0,30}(normal|a disease|a problem|dangerous)\b/, /\bwhat('s| is) wrong with me\b/];
  const DIAG_LINE = "I can't tell whether you have any condition or deficiency: only a doctor and tests can. Here is what your log shows.";

  function classify(text) {
    const t = " " + String(text || "").toLowerCase().replace(/\s+/g, " ") + " ";
    for (const r of RULES) if (r.re.some((x) => x.test(t))) return { kind: r.kind, reply: r.reply, sets: r.sets || null };
    if (DIAGNOSIS.some((x) => x.test(t))) return { kind: "diagnosis", prefix: DIAG_LINE };
    return { kind: "ok" };
  }

  // ---------- after the model ----------
  const SAFE = "I can't answer that safely from your log. For symptoms, conditions or medicines, please see a doctor. I can tell you what your log shows, for example your average protein or iron this week.";
  const OUT = [
    { why: "diagnosis", re: [/\byou (may|might|could|probably|likely|seem to|appear to) (have|be suffering|be deficient|be anaemic|be anemic)/i,
        /\byou (have|are suffering from|suffer from) (a |an )?(\w+ ){0,2}(condition|disease|disorder|deficiency|anaemia|anemia|diabetes|syndrome)/i,
        /\byou('re| are) (anaemic|anemic|deficient|diabetic|prediabetic|malnourished)\b/i, /\bdeficien(t|cy)\b/i, /\bdiagnos(is|ed|e)\b/i] },
    { why: "dose", re: [/\b\d+(\.\d+)?\s?(mg|mcg|µg|ug|iu)\b[^.]{0,40}\b(supplement|tablet|capsule|pill|dose|sachet|injection)/i, /\b(supplement|tablet|capsule|pill|dose|sachet|injection)[^.]{0,40}\b\d+(\.\d+)?\s?(mg|mcg|µg|ug|iu)\b/i] },
    { why: "restriction", re: [/\bskip(ping)? (a |your |the )?(meal|meals|breakfast|lunch|dinner)\b/i, /intermittent fasting/i, /\bfast(ing)? for \d/i, /\beat less than\b/i] },
  ];
  const NUMBERS = /\b\d[\d,]*\s?(kcal|calories|cal)\b|\b\d+(\.\d+)?\s?(kg|kgs|kilos)\b|\bbmi\b/i;

  function guard(reply, flags) {
    flags = flags || {};
    const text = String(reply || "").trim();
    if (!text) return { ok: false, why: "empty", text: SAFE };
    // Sentences that refuse to diagnose are fine; drop them before checking.
    const scan = text.replace(/[^.]*\b(can'?t|cannot|can not|unable to|not able to|won'?t)\s+(tell|say|diagnose|know)[^.]*\.?/gi, " ").replace(/not a diagnosis/gi, " ");
    for (const o of OUT) if (o.re.some((x) => x.test(scan))) return { ok: false, why: o.why, text: SAFE };
    if (flags.ed && NUMBERS.test(text)) return { ok: false, why: "numbers", text: "I'd rather not focus on numbers right now. Regular meals that you enjoy matter more than any figure, and a doctor or someone you trust can help if food feels hard." };
    return { ok: true, text };
  }

  const api = { classify, guard, RULES, DIAG_LINE, SAFE, TELE };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root.App) root.App.Safety = api;
})(typeof window !== "undefined" ? window : globalThis);
