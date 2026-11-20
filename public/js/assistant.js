/* assistant.js: the AI nutrition assistant (#ask).

   It answers only from the person's own profile, log and targets, plus the app's own food
   suggestions. Every question passes App.Safety.classify first: red flags get a fixed
   referral and never reach the model. Every model reply passes App.Safety.guard.
   Chat is kept in memory only and is never saved. */
(function () {
  "use strict";
  const { $, esc, r0, r1 } = App;
  const T = App.Targets;
  const st = { msgs: [], ed: false, minor: false, busy: false, ctl: null };

  App.Assistant = { reset() { st.msgs = []; st.ed = false; st.minor = false; if (st.ctl) st.ctl.abort(); } };

  // ---------- the DATA block: everything the model may use ----------
  const f1 = (v) => (Math.round(v * 10) / 10).toString();
  function buildData(doc, meals, tg) {
    const p = doc.profile, out = [], today = App.today();
    const days = App.Tracker.byDate(meals);
    out.push(`PROFILE: age ${p.age}, ${p.sex}, ${p.height} cm, ${p.weight} kg, activity ${p.activity}, goal ${p.goal}, diet ${T.DIETS[p.diet]}, life stage ${p.stage || "none"}.`);
    if (tg.ok) {
      out.push(`BMI ${f1(tg.bmi)} (${tg.bmiClass.label}).`);
      out.push(`ENERGY TARGET (ICMR NIN 2020): ${r0(tg.energy.lo)} to ${r0(tg.energy.hi)} kcal a day, aim ${r0(tg.energy.target)}. BMR ${r0(tg.energy.bmr)} kcal.`);
      out.push("NUTRIENT TARGETS: " + Object.entries(tg.n).filter(([, t]) => t.kind !== "info").map(([, t]) => `${t.label} ${t.kind === "max" ? "up to " + f1(t.high) : f1(t.low) + " to " + f1(t.high)} ${t.unit}`).join("; ") + ".");
    } else out.push(`TARGETS: none. Reason: ${tg.msg}`);

    const block = (label, n) => {
      const dates = App.Tracker.periodDates(today, n), s = App.Tracker.summarize(dates, days);
      if (!s.full.length) return `${label}: no full days (a full day has 2 or more meals logged).`;
      const a = s.avg, parts = [`energy ${r0(a.kcal)} kcal`];
      if (tg.ok) parts[0] += ` (${T.energyStatus(tg.energy, a.kcal).label})`;
      const map = { protein: "protein", fibre: "fibre", iron: "iron", calcium: "calcium", zinc: "zinc", magnesium: "magnesium", folate: "folate", vitc: "vitc", addedFat: "added_fat", fat: "fat", addedSugar: "added_sugar" };
      Object.entries(map).forEach(([tk, lk]) => {
        const t = tg.ok ? tg.n[tk] : null;
        let line = `${t ? t.label : tk} ${f1(a[lk] || 0)}${t ? " " + t.unit : ""}`;
        if (t) line += ` (${App.MICRO.includes(lk) && s.coverage < 0.7 ? "not enough data" : T.status(t, a[lk] || 0).label})`;
        parts.push(line);
      });
      return `${label} (average of ${s.full.length} full days, ${s.partial.length} partial left out; ${r0(s.coverage * 100)}% of kcal had mineral data): ${parts.join("; ")}.`;
    };
    out.push(block("LAST 7 DAYS", 7)); out.push(block("LAST 30 DAYS", 30));

    const recent = App.Tracker.periodDates(today, 14).filter((d) => days[d]);
    out.push("DAILY TOTALS, last 14 days (date | meals | kcal | protein g | fibre g | iron mg | calcium mg | added oil and ghee g | added sugar g):");
    recent.forEach((d) => { const t = days[d].t; out.push(`${d} | ${days[d].meals.length}${days[d].full ? "" : " partial"} | ${r0(t.kcal || 0)} | ${f1(t.protein || 0)} | ${f1(t.fibre || 0)} | ${f1(t.iron || 0)} | ${r0(t.calcium || 0)} | ${f1(t.added_fat || 0)} | ${f1(t.added_sugar || 0)}`); });
    if (!recent.length) out.push("(nothing logged in the last 14 days)");

    out.push("MEALS, last 7 days:");
    meals.filter((m) => m.date >= App.addDays(today, -6)).forEach((m) => out.push(`${m.date} ${m.slot}: ${m.items.map((i) => `${i.label} ${i.grams} g${i.oil_g ? ` + ${f1(i.oil_g)} g ${i.oil_type}` : ""}`).join(", ")} (${r0(m.totals.kcal)} kcal)`));

    // Which logged dishes gave the most of each nutrient over 30 days (current food table).
    const from = App.addDays(today, -29), contrib = {};
    const KEYS = ["protein", "fibre", "iron", "calcium", "added_fat", "added_sugar"];
    meals.filter((m) => m.date >= from).forEach((m) => m.items.forEach((i) => {
      const d = App.byId[i.dishId]; if (!d) return;
      KEYS.forEach((k) => {
        let v = k === "added_fat" ? i.oil_g || 0 : k === "added_sugar" ? (d.per100g.added_sugar || 0) * i.grams / 100
          : k === "protein" || k === "fibre" ? d.per100g[k] * i.grams / 100 : d.micro ? (d.micro[k] || 0) * i.grams / 100 : 0;
        (contrib[k] = contrib[k] || {})[d.name] = (contrib[k][d.name] || 0) + v;
      });
    }));
    const tops = KEYS.map((k) => {
      const e = Object.entries(contrib[k] || {}), tot = e.reduce((s, [, v]) => s + v, 0);
      if (!tot) return null;
      return `${k}: ` + e.sort((a, b) => b[1] - a[1]).slice(0, 3).map(([n, v]) => `${n} ${r0(v / tot * 100)}%`).join(", ");
    }).filter(Boolean);
    if (tops.length) out.push("TOP SOURCES IN THE LOG, last 30 days: " + tops.join("; ") + ".");

    // The app's own food ideas for this diet type (same as the gap cards).
    if (tg.ok) {
      const S = App.Sources, ideas = ["protein", "fibre", "iron", "calcium", "zinc", "folate", "vitc"].map((k) => {
        const t = tg.n[k], top = S.topDishes(k, p.diet, t.high);
        return `${t.label}: ${S.foodsFor(S.SOURCES[k].foods, p.diet).join(", ")}${top.length ? "; table dishes " + top.map((x) => `${x.dish.name} (${f1(x.amount)} ${t.unit} per ${x.unit.name})`).join(", ") : ""}. Tip: ${S.SOURCES[k].tip}`;
      });
      out.push("APP FOOD SUGGESTIONS (already filtered for the diet type):\n" + ideas.join("\n"));
    }
    out.push("NOT COUNTED BY THE APP: vitamin B12, vitamin D, iodine, salt. Vitamin values are estimates.");
    return out.join("\n");
  }

  function modeRules(doc, tg, meals) {
    const r = [];
    const p = doc.profile;
    if (!tg.ok && tg.reason === "stage") r.push("This person is pregnant or breastfeeding. Only report what the log shows. Give no suggestions, targets or judgements. End with: For what to eat now, please ask your doctor or a dietitian.");
    if (st.ed) r.push("Food may feel hard for this person right now. Mention no numbers about calories, weight, BMI or targets. Give no plans or rules. Be gentle and encourage regular meals and talking to a doctor or someone they trust.");
    if (tg.ok) {
      const s = App.Tracker.summarize(App.Tracker.periodDates(App.today(), 7), App.Tracker.byDate(meals));
      if (s.full.length >= 3 && s.avg.kcal < tg.energy.bmr * 0.8) r.push("The logged average is well below BMR. Never suggest eating less. If asked about losing weight, say the log already shows low intake and suggest checking with a doctor or dietitian.");
    }
    if (p.age >= 65) r.push("This person is over 65: for any symptom or health change, send them to their doctor.");
    return r;
  }

  function prompt(data, rules, history, q) {
    return `You are the ThaliHeal assistant. You answer questions about ONE person's own food log and profile, using ONLY the DATA below.

RULES (follow every one):
1. Use only facts in DATA. No outside knowledge about nutrition, health, diseases or foods, except to name foods that appear in DATA. If DATA cannot answer, say so in one sentence and suggest what they could log or check in the app.
2. Never diagnose. Never say or suggest the person has, may have, or lacks any condition, disease or deficiency. Say "your logged intake is below your target", never "deficient" or "deficiency".
3. Never give doses for supplements or medicines. Never advise on a symptom, disease or medicine: set "refer" to true and say only that a doctor should look at it.
4. Never suggest eating below the energy target, skipping meals, fasting, or fast weight loss. Never comment on body shape or weight. No guilt or shame words.
5. Food ideas only from APP FOOD SUGGESTIONS or dishes already in the log, and only ones that fit the diet type.
6. When averages are low, mention that a log can miss food.
7. Warm, direct, plain English. Under 120 words. No headings, no tables. Do not use dashes as punctuation.
${rules.length ? "EXTRA RULES FOR THIS PERSON:\n" + rules.map((x) => "- " + x).join("\n") + "\n" : ""}
Reply with only JSON: {"reply":"your answer","basis":"a short phrase naming the parts of DATA you used","refer":false}

DATA (today is ${App.today()})
${data}

${history.length ? "CONVERSATION SO FAR\n" + history.map((m) => `${m.role === "user" ? "Person" : "Assistant"}: ${m.text}`).join("\n") + "\n" : ""}
QUESTION
${q}`;
  }

  // ---------- one turn ----------
  async function ask(q) {
    q = String(q || "").trim().slice(0, 500);
    if (!q || st.busy) return;
    st.msgs.push({ role: "user", text: q });
    const c = App.Safety.classify(q);
    if (c.sets === "ed") st.ed = true;
    if (c.sets === "minor") st.minor = true;
    if (c.kind !== "ok" && c.kind !== "diagnosis") {
      st.msgs.push({ role: "assistant", text: c.reply, kind: c.kind, fixed: true });
      render(); return;
    }
    st.busy = true; render();
    try {
      const doc = await App.Account.getDoc(), meals = await App.Account.meals(), tg = T.compute(doc.profile);
      const history = st.msgs.slice(0, -1).filter((m) => !m.fixed).slice(-6);
      st.ctl = new AbortController();
      const res = await App.claudeSample(prompt(buildData(doc, meals, tg), modeRules(doc, tg, meals), history, q), { modelTier: "default", purpose: "assistant", signal: st.ctl.signal });
      let out; try { out = App.parseJSON(res.text); } catch (e) { out = { reply: res.text, basis: "" }; }
      let g = out && out.refer ? { ok: false, why: "refer", text: "This one needs a doctor, not a food log. Please see one. I can still tell you what your log shows." } : App.Safety.guard(out && out.reply, { ed: st.ed });
      const text = c.kind !== "diagnosis" ? g.text
        : g.ok ? c.prefix + " " + g.text
        : "I can't tell whether you have any condition or deficiency: only a doctor and tests can. If you're worried, please see one. I can tell you what your log shows, for example your average iron this week.";
      st.msgs.push({ role: "assistant", text, basis: g.ok ? String(out.basis || "").slice(0, 120) : "", kind: g.ok ? "answer" : "guarded" });
    } catch (e) {
      st.msgs.push({ role: "assistant", text: e && e.code === "cancelled" ? "Stopped." : App.errText(e), kind: "error", fixed: true });
    } finally { st.busy = false; st.ctl = null; render(); }
  }

  // ---------- screen ----------
  const CHIPS = (diet) => ["How was my protein this week?", "Where does my iron come from?", "Which day had the most added oil?", `What can I add for fibre as a ${T.DIETS[diet].toLowerCase()}?`];
  const LABEL = { crisis: "Please reach out", emergency: "See a doctor now", ed: "Taking care", minor: "Adults only", child: "Your own log only", symptom: "See a doctor",
    pregnancy: "Ask your doctor", condition: "Ask your doctor", supplement: "Ask your doctor", guarded: "Safety check", error: "" };

  async function render() {
    const box = $("askPage");
    await App.Account.getDoc();
    const doc = App.Account.cache.doc;
    let gate = "";
    if (!App.aiEnabled) gate = `<div class="card soon-ask" style="display:grid;gap:10px"><span class="tag" style="justify-self:start">Coming soon</span>
      <b>The assistant is coming soon</b>
      <span class="small">It will answer questions about your own profile and log, such as how your protein looked this week. Until then, <b>My log</b> shows your day, week and month against your targets, and <b>Gaps</b> lists Indian foods that help.</span>
      <a class="btn btn-primary" href="#track" style="justify-self:start">Open my log</a></div>`;
    else if (!App.Account.hasConsent()) gate = `<div class="card" style="display:grid;gap:8px"><b>First, read how your data is used.</b><button class="btn btn-primary" id="goConsent">Read and agree</button></div>`;
    else if (!doc.profile) gate = `<div class="card" style="display:grid;gap:8px"><b>Set up your profile first.</b><span class="small muted">The assistant answers from your profile and log.</span><a class="btn btn-primary" href="#profile">Set up profile</a></div>`;
    else if (!App.Account.hasAssistantConsent()) gate = `<div class="card" style="display:grid;gap:10px"><b>Turn on the assistant?</b>
      <span class="small">When you ask a question, a summary of your profile and log is sent to ${App.hosting === "web" ? App.providerName() : "Claude"} so it can answer from your own data. Your questions are not saved. You can turn this off any time in Privacy.</span>
      <button class="btn btn-primary" id="asOn">I agree, turn it on</button></div>`;
    else if (!App.claudeSample) gate = `<div class="card notice">${App.hosting === "web" ? (App.net.offline || !navigator.onLine ? "You're offline. The assistant comes back when you're online." : "The assistant is not set up on this site yet.") : "The assistant works when this page is opened in Claude while signed in."}</div>`;
    if (gate) {
      box.innerHTML = gate;
      const gc = $("goConsent"); if (gc) gc.onclick = () => App.needConsent("ask");
      const on = $("asOn"); if (on) on.onclick = async () => { on.disabled = true; await App.Account.setAssistantConsent(true); render(); };
      return;
    }
    const diet = doc.profile.diet;
    box.innerHTML = `
      <div class="chat" id="chat" aria-live="polite">
        ${st.msgs.length ? st.msgs.map((m) => m.role === "user"
          ? `<div class="msg me">${esc(m.text)}</div>`
          : `<div class="msg bot ${esc(m.kind || "")}">${LABEL[m.kind] ? `<span class="spill ${m.kind === "answer" ? "good" : m.kind === "guarded" ? "info" : "bad"}">${esc(LABEL[m.kind])}</span>` : ""}<div>${esc(m.text)}</div>${m.basis ? `<div class="small muted">From: ${esc(m.basis)}</div>` : ""}${m.kind === "ed" ? `<button class="btn btn-small" data-hide>Hide calorie numbers in my log</button>` : ""}</div>`).join("")
          : `<div class="small muted">Ask about your own meals and targets. For example:</div>`}
        ${st.busy ? `<div class="msg bot"><div class="muted">Reading your log…</div></div>` : ""}
      </div>
      ${st.minor ? `<div class="card notice">The assistant is off for this visit. ThaliHeal is for adults 18 and over.</div>` : `
      <div class="chips">${CHIPS(diet).map((c) => `<button class="btn btn-small" data-chip="${esc(c)}">${esc(c)}</button>`).join("")}</div>
      <form class="ask-row" id="askForm"><input id="askIn" type="text" maxlength="500" placeholder="Ask about your log…" aria-label="Your question" ${st.busy ? "disabled" : ""} autocomplete="off"><button class="btn btn-primary" ${st.busy ? "disabled" : ""}>Ask</button></form>`}
      <div class="row">${st.busy ? `<button class="btn btn-small" id="askStop">Stop</button>` : ""}${st.msgs.length ? `<button class="btn btn-small btn-ghost" id="askClear">Clear chat</button>` : ""}</div>`;
    const f = $("askForm"); if (f) f.onsubmit = (e) => { e.preventDefault(); const v = $("askIn").value; $("askIn").value = ""; ask(v); };
    box.querySelectorAll("[data-chip]").forEach((b) => b.onclick = () => ask(b.dataset.chip));
    box.querySelectorAll("[data-hide]").forEach((b) => b.onclick = () => { App.store.set("thali.hideNumbers", true); b.replaceWith(Object.assign(document.createElement("span"), { className: "small muted", textContent: "Done. Change it any time in Settings." })); });
    const s = $("askStop"); if (s) s.onclick = () => st.ctl && st.ctl.abort();
    const cl = $("askClear"); if (cl) cl.onclick = () => { const keepEd = st.ed, keepMinor = st.minor; App.Assistant.reset(); st.ed = keepEd; st.minor = keepMinor; render(); };
    const chat = $("chat"); chat.scrollTop = chat.scrollHeight;
    if (!st.busy && $("askIn") && st.msgs.length) $("askIn").focus({ preventScroll: true });
  }

  App.views.ask = { show() { $("askPage").innerHTML = `<div class="card small muted">Loading…</div>`; render(); }, onClaude() { if (App.current === "ask") render(); } };
  App.Assistant.buildData = buildData;   // for checks
})();
