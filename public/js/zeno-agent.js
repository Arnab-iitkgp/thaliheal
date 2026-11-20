/* Model turns and user-scoped ThaliHeal tools for Zeno. */
(function () {
  "use strict";

  const endpoint = "/api/zeno-agent";
  const invalid = message => ({ ok: false, error: message });
  const validDate = date => typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date;
  const tidy = value => typeof value === "string" ? value.trim().slice(0, 180) : "";
  const keywords = value => tidy(value).normalize("NFKC").toLowerCase().match(/[\p{L}\p{M}\p{N}]{3,}/gu) || [];
  const memoryKey = value => tidy(value).normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, " ").trim();
  const weekdays = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  function followUpDate({ due, due_weekday }) {
    if (due_weekday == null) return validDate(due) ? due : null;
    const day = weekdays.indexOf(due_weekday);
    if (day === -1) return null;
    const today = App.today();
    return App.addDays(today, (day - new Date(today).getUTCDay() + 7) % 7);
  }
  const copy = items => items.map(item => ({ ...item, oil: { ...item.oil } }));
  const label = item => App.byId[item.dishId]?.name || item.label;
  const profileDefaults = ["diet", "goal", "activity"];
  const profileNumbers = ["age", "height", "weight", "waist"];
  const profileChoices = () => ({
    diet: Object.keys(App.Targets.DIETS), goal: Object.keys(App.Targets.GOALS), activity: Object.keys(App.Targets.ACTIVITY),
    sex: ["male", "female"], stage: ["none", "pregnant", "breastfeeding", "postmenopause"],
  });

  function findFoods(query) {
    const key = memoryKey(query);
    const singular = value => memoryKey(value).replace(/s$/, "");
    if (!key) return [];
    if (key === "rice" && App.byId.plain_rice) return [App.byId.plain_rice];
    const scores = App.dishes.map(dish => {
      const names = [dish.id, dish.name, ...(dish.aliases || [])].map(singular);
      const q = singular(key);
      return { dish, score: names.includes(q) ? 2 : names.some(n => n.includes(q)) ? 1 : 0 };
    }).filter(entry => entry.score).sort((a, b) => b.score - a.score);
    const exact = scores.filter(entry => entry.score === 2);
    return (exact.length ? exact : scores).slice(0, 6).map(entry => entry.dish);
  }

  function foodSummary(dish) {
    return { id: dish.id, name: dish.name, units: dish.units, vegetarian: dish.veg };
  }

  function plate(items) {
    const totals = App.mealTotals(items);
    return {
      items: items.map(item => {
        const unit = App.byId[item.dishId]?.units[item.unitIdx];
        return { id: item.dishId, name: label(item), grams: item.grams, unit: unit?.name, count: unit ? App.fmtCount(item.grams / unit.g) : undefined };
      }),
      protein: App.r1(totals.protein), fibre: App.r1(totals.fibre),
      ...(App.store.get("thali.hideNumbers", false) ? {} : { kcal: Math.round(totals.kcal) }),
    };
  }

  function summarizeMeals(meals, from, to, fromHistory) {
    const days = new Map();
    const foods = new Map();
    const logged = { protein: 0, fibre: 0, carbs: 0, fat: 0, kcal: 0 };
    if (App.store.get("thali.hideNumbers", false)) delete logged.kcal;
    for (const meal of meals) {
      if (!days.has(meal.date)) days.set(meal.date, new Set());
      days.get(meal.date).add(meal.slot);
      for (const name of new Set(meal.items.map(label))) foods.set(name, (foods.get(name) || 0) + 1);
      const totals = meal.totals || App.mealTotals(fromHistory(meal));
      for (const key of Object.keys(logged)) logged[key] += Number(totals[key]) || 0;
    }
    const nutrients = divisor => Object.fromEntries(Object.entries(logged).map(([key, total]) => [
      key === "kcal" ? key : key + "Grams",
      key === "kcal" ? Math.round(total / divisor) : Number((total / divisor).toFixed(1)),
    ]));
    return {
      from, to, daysInPeriod: (Date.parse(to) - Date.parse(from)) / 86400000 + 1,
      loggedDays: days.size, loggedMeals: meals.length,
      totalLogged: days.size ? nutrients(1) : null,
      averageLoggedPerLoggedDay: days.size ? nutrients(days.size) : null,
      daysWithAtLeastTwoSlots: [...days.values()].filter(day => day.size >= 2).length,
      loggedDaysBySlot: Object.fromEntries(Object.keys(App.SLOTS).map(slot => [slot, [...days.values()].filter(day => day.has(slot)).length])),
      recurringFoods: [...foods].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([name, count]) => ({ name, loggedMeals: count })),
      evidence: [...days].slice(-7).map(([date, loggedSlots]) => ({ date, loggedSlots })),
    };
  }

  function lookupDish(value) {
    const key = tidy(value);
    if (Object.hasOwn(App.byId, key)) return App.byId[key];
    const matches = findFoods(key);
    return matches.length === 1 ? matches[0] : null;
  }

  function applyEdits(original, changes) {
    const items = copy(original);
    const notes = [];
    for (const change of changes) {
      const dish = lookupDish(change?.dish);
      if (!dish) return invalid("Dish is missing or ambiguous. Use find_food to choose a catalog ID.");
      const idx = items.findIndex(item => item.dishId === dish.id || label(item) === dish.name);
      const unit = tidy(change.unit).toLowerCase();
      const measure = ["bowl", "bowls"].includes(unit) ? "katori" : ["packet", "packets"].includes(unit) ? "packet cooked" : unit;
      const choice = !unit ? dish.units[0] : dish.units.find(({ name }) => {
        const label = name.toLowerCase();
        return measure === label || measure === label + (label.endsWith("ss") ? "es" : "s");
      });
      const whole = change.op === "remove" && change.amount == null;
      const byWeight = ["g", "gram", "grams"].includes(unit);
      if (!whole && !choice && !byWeight) return invalid(`Which portion of ${dish.name}? Use ${dish.units.map(item => item.name).concat("grams").join(" or ")}.`);
      const grams = whole ? 0 : (change.amount ?? 1) * (byWeight ? 1 : choice?.g);
      if (dish.id === "chapati" && byWeight && grams < 5 && !whole) return invalid("For one roti use 1 piece, not 1 gram.");
      if (!["add", "set", "remove"].includes(change.op) || (change.amount != null && typeof change.amount !== "number") ||
          (!whole && (!Number.isFinite(grams) || grams < 1 || grams > 3000))) return invalid("Ask how much the user had before changing the draft.");
      if (change.op === "remove") {
        if (idx < 0) notes.push(`${dish.name} was already off this plate.`);
        else {
          if (whole || grams >= items[idx].grams) items.splice(idx, 1);
          else {
            items[idx].grams -= grams;
            App.resetOil(items[idx]);
          }
        }
        continue;
      }
      const updated = change.op === "add" && idx >= 0 ? items[idx].grams + grams : grams;
      if (updated > 3000) return invalid("That portion is too large to enter as one dish.");
      if (change.amount == null && !unit) notes.push(`Used an estimated ${grams} g portion of ${dish.name}.`);
      if (idx < 0) items.push(App.newItem(dish.id, updated, { origin: "manual", unit: choice?.name }));
      else {
        items[idx].grams = updated;
        if (choice) items[idx].unitIdx = dish.units.indexOf(choice);
        App.resetOil(items[idx]);
      }
    }
    return { ok: true, items, notes };
  }

  function planPlate(args) {
    if (!Array.isArray(args.menu) || !args.menu.length || args.menu.length > 8) return invalid("Give me one to eight available dishes.");
    const menu = args.menu.map(item => ({ dish: lookupDish(item?.dish), price: item?.price }));
    if (menu.some(item => !item.dish)) return invalid("Some menu dishes need a catalog match first.");
    const exclude = Array.isArray(args.exclude) ? args.exclude.map(value => lookupDish(value)?.id || App.norm(value)) : [];
    const candidates = menu.filter(item => (!args.vegetarian || item.dish.veg) &&
      !exclude.includes(item.dish.id) && !exclude.includes(App.norm(item.dish.name)));
    const budget = args.budget;
    if (budget != null && (!Number.isFinite(budget) || budget < 0)) return invalid("Enter a valid budget.");
    if (budget != null && candidates.some(item => !Number.isFinite(item.price) || item.price < 0)) return invalid("Ask for the missing menu prices before using a budget.");
    const options = [];
    const seen = new Set();
    for (let bits = 1; bits < (1 << candidates.length); bits++) {
      const selected = candidates.filter((_, i) => bits & (1 << i));
      const ids = selected.map(item => item.dish.id).sort();
      const key = ids.join(",");
      if (selected.length > 3 || new Set(ids).size !== ids.length || seen.has(key)) continue;
      const price = selected.reduce((sum, item) => sum + (item.price || 0), 0);
      if (budget != null && price > budget) continue;
      seen.add(key);
      const items = selected.map(item => App.newItem(item.dish.id, null, { origin: "manual" }));
      const totals = App.mealTotals(items);
      const score = args.focus === "protein" ? totals.protein : args.focus === "fibre" ? totals.fibre : new Set(selected.map(item => item.dish.type)).size;
      options.push({ items, score, price: budget != null ? App.r1(price) : null });
    }
    return options.sort((a, b) => b.score - a.score || (a.price ?? 0) - (b.price ?? 0)).slice(0, 3);
  }

  function makeTools(ui, data = App.Account) {
    const sources = new Map();
    const scoped = value => tidy(value).slice(0, 64);
    function undoRecord(read, save, field, id, previous, expected) {
      return async () => {
        const records = read();
        const current = records.find(record => record[field] === id);
        if (JSON.stringify(current) !== JSON.stringify(expected)) throw Error("Memory has changed");
        const restored = records.filter(record => record[field] !== id);
        if (previous) restored.push(previous);
        await save(restored);
      };
    }
    return {
      find_food: ({ query }) => ({ dishes: findFoods(tidy(query)).map(foodSummary) }),
      async find_meals({ from, to, slot }) {
        if (!validDate(from) || !validDate(to) || from > to || App.addDays(from, 30) < to || (slot && !Object.hasOwn(App.SLOTS, slot))) return invalid("Use an inclusive range of at most 31 days and a valid meal slot.");
        await data.getDoc();
        if (!data.hasConsent()) return invalid("Meal log access requires ThaliHeal data consent.");
        const meals = (await data.meals()).filter(meal => meal.date >= from && meal.date <= to && (!slot || meal.slot === slot));
        return { matches: meals.length, meals: meals.slice(0, 5).map(meal => {
          const ref = "meal:" + meal.id;
          const items = ui.fromHistory(meal);
          sources.set(ref, { items, slot: meal.slot, title: `${meal.slot} on ${meal.date}` });
          return { ref, date: meal.date, slot: meal.slot, ...plate(items) };
        }) };
      },
      async review_habits({ from, to, period, compare_previous, view, slot }) {
        if (period) {
          if (!["last_week", "this_week"].includes(period) || from || to) return invalid("Choose one calendar week or provide explicit dates.");
          const today = App.today();
          const monday = App.addDays(today, -((new Date(today).getUTCDay() + 6) % 7));
          from = period === "last_week" ? App.addDays(monday, -7) : monday;
          to = period === "last_week" ? App.addDays(monday, -1) : today;
        }
        if (!validDate(from) || !validDate(to) || from > to || App.addDays(from, 30) < to) return invalid("Use an inclusive range of at most 31 days.");
        if (slot && !Object.hasOwn(App.SLOTS, slot)) return invalid("Choose a valid meal slot.");
        await data.getDoc();
        if (!data.hasConsent()) return invalid("Meal log access requires ThaliHeal data consent.");
        const all = (await data.meals()).filter(meal => !slot || meal.slot === slot);
        const inRange = (start, end) => all.filter(meal => meal.date >= start && meal.date <= end)
          .sort((a, b) => a.date.localeCompare(b.date) || (a.created || 0) - (b.created || 0));
        const summarize = (entries, start, end) => summarizeMeals(entries, start, end, ui.fromHistory);
        const meals = inRange(from, to);
        const summary = summarize(meals, from, to);
        const offset = period === "this_week" ? 7 : summary.daysInPeriod;
        const priorFrom = App.addDays(from, -offset), priorTo = App.addDays(to, -offset);
        const previousMeals = compare_previous ? inRange(priorFrom, priorTo) : [];
        const previous = compare_previous ? summarize(previousMeals, priorFrom, priorTo) : null;
        const cardShown = Boolean(view && ui.review);
        if (cardShown) ui.review({ summary, meals, previous, previousMeals, view, slot });
        const mealPreview = view === "meals" ? meals.slice(-7).map(meal => ({
          date: meal.date, slot: meal.slot, dishes: meal.items.slice(0, 5).map(item => label(item).slice(0, 45)),
        })) : undefined;
        return {
          ...summary, slot, ...(previous ? { previous } : {}), meals: mealPreview, cardShown,
          note: "Only confirmed log entries are counted. Missing entries do not show whether a meal was eaten. Nutrient estimates cover logged food only. The meal list is a preview.",
        };
      },
      async read_context() {
        const doc = await data.getDoc();
        const current = ui.current();
        const proposal = ui.pendingDraft?.();
        const profile = data.hasConsent() && doc?.profile;
        return { draft: current ? {
          slot: current.slot, destination: current.preview ? "Sample Log" : "My Log",
          savedToLog: Boolean(current.id && !current.dirty), ...plate(current.items),
        } : null, proposedDraft: proposal ? { slot: proposal.slot, ...plate(proposal.items) } : null, diet: profile?.diet || null };
      },
      note_conversation: args => ui.noteTopic?.(args) ? { ok: true } : invalid("Use a short, food-related summary."),
      async read_profile({ fields = profileDefaults }) {
        if (!Array.isArray(fields) || !fields.length || fields.some(key => ![
          ...Object.keys(profileChoices()), ...profileNumbers, "targets",
        ].includes(key))) return invalid("Choose valid profile fields.");
        const doc = await data.getDoc();
        if (!data.hasConsent()) return invalid("Profile access requires ThaliHeal data consent.");
        const profile = doc?.profile;
        if (!profile) return { ok: true, profile: null };
        const selected = Object.fromEntries(fields.filter(key => key !== "targets" && Object.hasOwn(profile, key))
          .map(key => [key, profile[key]]));
        if (!fields.includes("targets")) return { ok: true, profile: selected };
        const targets = App.Targets.compute(profile);
        const range = ({ low, high }) => ({ low: Number(low.toFixed(1)), high: Number(high.toFixed(1)) });
        return { ok: true, profile: selected, targets: targets.ok ? {
          proteinGramsPerDay: range(targets.n.protein),
          fibreGramsPerDay: range(targets.n.fibre),
          ...(App.store.get("thali.hideNumbers", false) ? {} : {
            energyKcalPerDay: { low: Math.round(targets.energy.lo), high: Math.round(targets.energy.hi) },
          }),
        } : null };
      },
      async update_profile({ changes }) {
        if (!changes || typeof changes !== "object" || Array.isArray(changes)) return invalid("Choose a profile field and its new value.");
        const entries = Object.entries(changes);
        const choices = profileChoices();
        if (!entries.length || entries.some(([key, value]) => profileNumbers.includes(key)
          ? !Number.isFinite(value) || value <= 0
          : !Object.hasOwn(choices, key) || !choices[key].includes(value))) return invalid("Use valid profile values and metric units.");
        const doc = await data.getDoc();
        if (!data.hasConsent()) return invalid("Profile updates require ThaliHeal data consent.");
        if (!doc?.profile) return invalid("Set up a profile in ThaliHeal first.");
        const next = { ...doc.profile, ...changes };
        if (next.sex !== "female" && next.stage) next.stage = "none";
        if (changes.stage && changes.stage !== next.stage) return invalid("This life stage is unavailable for the saved profile.");
        const problems = App.Targets.problems(next);
        if (problems.length) return invalid(problems.join(" "));
        const updated = Object.keys(next).filter(key => next[key] !== doc.profile[key]);
        if (!updated.length) return { ok: true, pending: false, message: "The profile already has those values." };
        return ui.confirmProfile(doc.profile, next, updated);
      },
      async read_memory({ query }) {
        await data.getDoc();
        if (!data.hasConsent()) return { memories: [] };
        const words = [...new Set(keywords(query))];
        const score = value => {
          const terms = keywords(value);
          return words.filter(word => terms.some(term => term.includes(word) || word.includes(term))).length;
        };
        const ranked = (entries, relevance, count) => entries.map((entry, index) => ({ entry, index, weight: relevance(entry) }))
          .filter(item => !words.length || item.weight).sort((a, b) => b.weight - a.weight || (b.entry.savedAt || 0) - (a.entry.savedAt || 0) || b.index - a.index)
          .slice(0, count).map(item => item.entry);
        const usuals = ranked(ui.usuals(), usual => score(usual.name), 5).map(usual => {
          const ref = "usual:" + usual.key;
          sources.set(ref, { items: usual.items, slot: usual.slot, title: usual.name });
          return { ref, kind: "usual", name: usual.name, slot: usual.slot, ...plate(usual.items) };
        });
        const records = ui.memories().filter(record => words.length || record.kind !== "follow_up" || !record.status);
        const memories = ranked(records, record => score(record.name) * 3 + score(record.scope) * 2 + score(record.value), 6);
        memories.forEach(record => sources.set("memory:" + record.id, { record }));
        usuals.forEach(usual => { const source = sources.get(usual.ref); source.usual = true; });
        return { memories: memories.map(({ id, kind, name, value, scope, due, status }) => ({ ref: "memory:" + id, kind, name, value, scope, due, status })).concat(usuals) };
      },
      edit_plate({ source, changes, apply, slot }) {
        const base = source === "empty" ? { items: [] } : source === "current" ? (ui.editBase?.() || ui.current()) : sources.get(source);
        if (!base?.items || !Array.isArray(changes) || changes.length > 12 || typeof apply !== "boolean" || (slot && !Object.hasOwn(App.SLOTS, slot))) return invalid("A valid draft, meal or usual reference and valid changes are required.");
        const edited = applyEdits(base.items, changes);
        if (!edited.ok) return edited;
        const before = plate(base.items);
        const after = plate(edited.items);
        const options = { items: edited.items, slot: slot || base.slot || App.slotNow(), title: base.title };
        if (apply && ui.proposeDraft) return { ...ui.proposeDraft(options, source === "current", edited.notes), after, notes: edited.notes };
        if (apply) ui.draft(options, source === "current");
        else ui.compare(base.items, options, source === "current");
        return { ok: true, applied: apply, source: base.title || source, before, after, notes: edited.notes };
      },
      request_save() {
        if (ui.hasDraftProposal?.()) return invalid("Apply the proposed meal changes before asking to save.");
        const draft = ui.current();
        if (!draft?.items.length) return invalid("Open a meal draft before saving.");
        if (!draft.dirty && draft.id) return { ok: true, saved: true, destination: draft.preview ? "Sample Log" : "My Log" };
        return ui.requestSave();
      },
      async remember(args) {
        const name = scoped(args.name), value = tidy(args.value), scope = scoped(args.scope);
        if (!name || !["usual", "preference", "follow_up"].includes(args.kind)) return invalid("Memory needs a name and a supported kind.");
        const due = args.kind === "follow_up" ? followUpDate(args) : null;
        if (args.kind === "follow_up" && (!due || due < App.today())) return invalid("Ask the user for a date to follow up.");
        if (args.kind !== "usual" && !value) return invalid("Ask what to remember.");
        if ([name, value, scope].some(text => App.Safety.classify(text).kind !== "ok")) return invalid("Store only ordinary food preferences and check-ins.");
        await data.getDoc();
        if (!data.hasConsent()) return invalid("Ask the user to accept the data notice first.");
        const key = args.kind === "usual" ? App.norm(name) || memoryKey(name) : memoryKey(name);
        if (!key) return invalid("Ask for a short name.");
        if (args.kind === "usual") {
          const draft = ui.current();
          if (!draft?.items.length) return invalid("Open the plate to remember first.");
          const before = ui.usuals();
          const after = before.filter(u => u.key !== key);
          if (after.length >= 30) return invalid("Forget an old usual before adding more.");
          const record = { key, name, slot: draft.slot, items: copy(draft.items) };
          await data.saveZenoUsuals([...after, record]);
          ui.receipt(`Remembered “${name}”.`, undoRecord(ui.usuals, records => data.saveZenoUsuals(records), "key", key, before.find(u => u.key === key), record));
        } else {
          const before = ui.memories();
          const baseId = `${args.kind}:${memoryKey(scope)}:${key}`;
          const match = before.find(record => record.kind === args.kind && memoryKey(record.name) === key && memoryKey(record.scope) === memoryKey(scope));
          const id = match?.id || (before.some(record => record.id === baseId) ? crypto.randomUUID() : baseId);
          const after = before.filter(m => m.id !== id);
          if (after.length >= 50) return invalid("Forget an old memory before adding more.");
          const record = { id, kind: args.kind, name, value, scope, due, savedAt: Date.now() };
          await data.saveZenoMemories([...after, record]);
          ui.receipt(`Remembered “${name}”.`, undoRecord(ui.memories, records => data.saveZenoMemories(records), "id", id, before.find(m => m.id === id), record));
        }
        return { ok: true, name, scope, due };
      },
      async forget({ ref }) {
        const match = sources.get(ref);
        if (match?.record) {
          const before = ui.memories();
          if (JSON.stringify(before.find(record => record.id === match.record.id)) !== JSON.stringify(match.record)) return invalid("The memory changed. Find it again before forgetting it.");
          await data.saveZenoMemories(before.filter(record => record.id !== match.record.id));
          ui.receipt(`Forgot “${match.record.name}”.`, undoRecord(ui.memories, records => data.saveZenoMemories(records), "id", match.record.id, match.record));
        } else if (match?.usual) {
          const before = ui.usuals();
          await data.saveZenoUsuals(before.filter(u => "usual:" + u.key !== ref));
          const previous = before.find(usual => "usual:" + usual.key === ref);
          if (previous) ui.receipt(`Forgot “${match.title}”.`, undoRecord(ui.usuals, records => data.saveZenoUsuals(records), "key", previous.key, previous));
        } else return invalid("Find the exact memory first.");
        sources.delete(ref);
        return { ok: true };
      },
      plan_plate(args) {
        const options = planPlate(args);
        if (!Array.isArray(options)) return options;
        if (!options.length) return invalid("No plates fit those choices and constraints.");
        ui.options(options);
        return { ok: true, options: options.map((option, index) => ({ choice: index + 1, price: option.price, ...plate(option.items) })) };
      },
    };
  }

  App.ZenoAgent = {
    memoryKey,
    followUpDate,
    demoData({ memories = [], saveMemories } = {}) {
      const doc = {
        profile: { diet: "vegetarian", goal: "maintain", activity: "moderate", age: 24, sex: "female", height: 164, weight: 60, stage: "none" },
        zenoMemories: memories,
        zenoUsuals: [{
          key: "mess lunch", name: "Mess lunch", slot: "lunch",
          items: [["rajma", 150], ["plain_rice", 150], ["chapati", 76], ["curd", 100]].map(([id, grams]) => App.newItem(id, grams, { origin: "manual" })),
        }],
      };
      const date = App.today();
      const meals = [
        { ago: 6, slot: "breakfast", ids: ["poha"] },
        { ago: 6, slot: "lunch", ids: ["rajma", "plain_rice", "chapati"] },
        { ago: 4, slot: "lunch", ids: ["dal_tadka", "plain_rice"] },
        { ago: 4, slot: "dinner", ids: ["chapati", "rajma"] },
        { ago: 2, slot: "snack", ids: ["curd"] },
        { ago: 1, slot: "lunch", usual: true },
      ].map(({ ago, slot, ids, usual }) => App.mealFromItems(usual ? doc.zenoUsuals[0].items
        : ids.filter(id => Object.hasOwn(App.byId, id)).map(id => App.newItem(id, null, { origin: "manual" })),
      { date: App.addDays(date, -ago), slot, source: "manual", ctx: ago === 1 ? "restaurant" : "home" }));
      return {
        async getDoc() { return doc; },
        hasConsent: () => true,
        async saveProfile(profile) { doc.profile = profile; },
        async meals() { return meals; },
        async saveMeal(meal) {
          const index = meals.findIndex(entry => entry.id === meal.id);
          if (index === -1) meals.push(meal);
          else meals[index] = meal;
        },
        async saveZenoUsuals(items) { doc.zenoUsuals = items; },
        async saveZenoMemories(items) { saveMemories?.(items); doc.zenoMemories = items; },
        doc,
      };
    },
    toolSession(ui, data) {
      const tools = makeTools(ui, data);
      return async (name, args) => {
        if (!Object.hasOwn(tools, name) || !args || typeof args !== "object" || Array.isArray(args)) return invalid("Unsupported tool call.");
        try {
          const result = await tools[name](args);
          return JSON.stringify(result).length > 4400 ? invalid("Use a narrower date range or a specific name.") : result;
        } catch { return invalid("That action could not be completed."); }
      };
    },
    async status() {
      const response = await fetch(endpoint, { cache: "no-store" });
      if (!response.ok) throw Error("agent status");
      return response.json();
    },
    async run({ previous, summary, message, ui, data, signal, tester, status, workspace }) {
      const messages = [...previous, { role: "user", content: message }];
      const tools = makeTools(ui, data);
      const results = new Map();
      const completed = new Set();
      const memoryConfirmations = new Set();
      let draftReceipt;
      let planned;
      let retry = false;
      let waited = false;
      for (let step = 0; step < 9; step++) {
        const headers = { "Content-Type": "application/json" };
        if (tester) headers["X-ThaliHeal-Tester"] = tester;
        const payload = { method: "POST", headers, body: JSON.stringify({ today: App.today(), workspace, summary, messages }), signal };
        let response = await fetch(endpoint, payload);
        let data = await response.json();
        if (response.status === 429 && !waited && data.error === "agent_provider_rate_limited" && data.retryAfter > 0 && data.retryAfter <= 60) {
          waited = true;
          status?.("Zeno is waiting for the text service.");
          await new Promise((resolve, reject) => {
            const cancel = () => { clearTimeout(timer); reject(signal.reason); };
            const timer = setTimeout(() => { signal.removeEventListener("abort", cancel); resolve(); }, (data.retryAfter + 1) * 1000);
            if (signal.aborted) cancel();
            else signal.addEventListener("abort", cancel, { once: true });
          });
          response = await fetch(endpoint, payload);
          data = await response.json();
        }
        if (!response.ok) throw Error("agent unavailable");
        const { text, calls } = data;
        if (signal.aborted) throw signal.reason;
        if (!calls?.length) {
          const missing = (planned || []).filter(name => !completed.has(name));
          const pending = missing.filter(name => ["remember", "forget", "edit_plate", "review_habits", "read_context", "read_profile", "update_profile", "request_save"].includes(name));
          if (pending.length && !retry) {
            retry = true;
            messages.push({ role: "assistant", content: text || "" }, { role: "user", content: `App progress: these parts of the request have not succeeded: ${pending.join(", ")}. Use tools if the needed information is available. Otherwise ask what is missing. Do not say they succeeded.` });
            continue;
          }
          if (draftReceipt && pending.length === 1 && pending[0] === "request_save") return draftReceipt;
          if (pending.length && !/[?]\s*$/.test(text || "")) return "I couldn’t complete every part of that request. Tell me what you’d like me to finish.";
          const confirmation = [...memoryConfirmations].join(" ");
          if (confirmation && planned?.every(name => ["remember", "forget", "read_memory"].includes(name))) return confirmation;
          return text?.trim() || confirmation;
        }
        if (!Array.isArray(calls) || calls.length > 4) throw Error("invalid agent turn");
        messages.push({ role: "assistant", content: null, tool_calls: calls });
        for (const call of calls) {
          if (signal.aborted) throw signal.reason;
          let output = results.get(call.id);
          if (!output) {
            try {
              const fn = call.function;
              const descriptions = {
                find_meals: "Looking up meals", review_habits: "Reviewing your meal log", find_food: "Checking the dish catalog", read_memory: "Checking saved memories",
                read_profile: "Checking your profile", update_profile: "Preparing a profile update",
                edit_plate: "Working on the plate", remember: "Saving a memory", forget: "Updating what I remember", plan_plate: "Comparing menu options",
              };
              status?.(descriptions[fn.name] || "Thinking through your request");
              const args = JSON.parse(fn.arguments);
              if (fn.name === "plan_turn" && !planned && Array.isArray(args?.steps)) {
                planned = [...new Set(args.steps.filter(name => name !== "note_conversation" && Object.hasOwn(tools, name)))];
                output = { ok: true, steps: planned };
              } else if (["remember", "forget", "request_save", "update_profile"].includes(fn.name) && !planned?.includes(fn.name)) {
                output = invalid("The user did not request this action in this turn.");
              } else {
                if (!Object.hasOwn(tools, fn.name) || !args || typeof args !== "object" || Array.isArray(args)) output = invalid("Unsupported tool call.");
                else if (["remember", "forget"].includes(fn.name) && ui.confirmMemory) output = ui.confirmMemory(fn.name, args, confirmed => tools[fn.name](confirmed || args));
                else output = await tools[fn.name](args);
                if (fn.name === "edit_plate" && output.ok && output.applied) {
                  draftReceipt = ["Your draft is ready to review.", ...output.notes].join(" ");
                }
                if (output.pending && ["remember", "forget"].includes(fn.name)) {
                  memoryConfirmations.add(output.date ? `Confirm the check-in for ${output.date} in the app.` : "Confirm the memory change in the app.");
                }
                if (output.ok !== false) completed.add(fn.name);
                ui.toolResult?.(fn.name, output);
              }
            } catch { output = invalid("That action could not be completed."); }
            output = JSON.stringify(output);
            if (output.length > 4400) output = JSON.stringify(invalid("Too much data. Ask for a narrower date or a specific name."));
            results.set(call.id, output);
          }
          messages.push({ role: "tool", tool_call_id: call.id, content: output });
        }
      }
      // Completed actions are already visible as cards, even when a turn reaches the step limit.
      return [...memoryConfirmations].join(" ") || "I reached the end of this turn. Review the cards above or tell me the next step.";
    },
  };
})();
