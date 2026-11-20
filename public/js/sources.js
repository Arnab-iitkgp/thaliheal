/* sources.js: Indian food sources for each nutrient gap, filtered by diet type.

   Iron, calcium, zinc, folate and protein lists and tips follow the research doc,
   section 6 (chatbot knowledge base). Fibre, magnesium and vitamin C lists are general
   guidance and should get a dietitian review before launch.
   Each food carries tags for what it contains: dairy, egg, meat, fish, jain_avoid. */
(function () {
  "use strict";
  const F = (name, ...tags) => ({ name, tags });

  const SOURCES = {
    protein: {
      foods: [F("Dal, chana, rajma, moong"), F("Soya chunks and tofu"), F("Peanuts and roasted chana"), F("Paneer, curd and milk", "dairy"), F("Eggs", "egg"), F("Chicken", "meat"), F("Fish", "fish")],
      tip: "Put a cereal and a pulse in each meal (dal chawal, rajma roti). Users on cereal heavy plates may need nearer 1 g per kg.",
    },
    fibre: {
      foods: [F("Whole wheat atta roti in place of maida"), F("Millets: bajra, jowar, ragi"), F("Whole dals, chana, rajma"), F("A katori of sabzi and a salad with each meal"), F("Fruit such as guava, apple or pear, with the skin")],
      tip: "Add fibre slowly and drink enough water.", general: true,
    },
    iron: {
      foods: [F("Green leafy vegetables: palak, methi, chaulai, bathua"), F("Rajma and chana"), F("Ragi"), F("Jaggery (small amounts)"), F("Meat", "meat"), F("Fish", "fish")],
      tip: "Pair with vitamin C (lemon, amla, guava). Keep tea and coffee an hour away from meals.",
    },
    calcium: {
      foods: [F("Ragi"), F("Til (sesame) and til chikki"), F("Green leafy vegetables"), F("Milk, curd and paneer", "dairy"), F("Small fish eaten with bones", "fish")],
      tip: "Spread calcium across the day. Vitamin D is needed to absorb it.",
    },
    zinc: {
      foods: [F("Pulses: dal, chana, rajma"), F("Nuts and seeds: peanuts, pumpkin seeds, til"), F("Whole grains: atta, bajra, jowar"), F("Meat", "meat")],
      tip: "Soaking, sprouting and fermenting (sprouts, idli, dosa, dhokla) cut phytates and help absorption.",
    },
    magnesium: {
      foods: [F("Nuts and seeds"), F("Whole grains and millets"), F("Dals and chana"), F("Green leafy vegetables")],
      tip: "Whole grains keep far more magnesium than refined flour and polished rice.", general: true,
    },
    folate: {
      foods: [F("Green leafy vegetables"), F("Dals"), F("Chickpeas (chana)"), F("Oranges")],
      tip: "Folate is lost with long boiling: cook greens briefly and keep the cooking water in the dish.",
    },
    vitc: {
      foods: [F("Amla"), F("Guava"), F("Lemon on dal or sabzi"), F("Orange and mosambi"), F("Raw tomato, capsicum and cucumber salad")],
      tip: "Cooking destroys vitamin C, so add raw fruit or salad to a meal. It also helps iron absorption.", general: true,
    },
  };

  // Not counted by the app: no Indian composition data (IFCT) or added at the table.
  const NOT_TRACKED = [
    { key: "b12", label: "Vitamin B12", why: "IFCT has no B12 values, so the app cannot count it. Vegetarian and vegan diets are the main risk.",
      foods: [F("Fortified foods"), F("Milk, curd and paneer", "dairy"), F("Eggs", "egg"), F("Fish", "fish"), F("Meat", "meat")],
      tip: "Absorption falls with age and with long term metformin or antacid use. Only a blood test shows low B12." },
    { key: "vitd", label: "Vitamin D", why: "Not counted. Low vitamin D is common in India despite the sun.",
      foods: [F("Sunlight on arms and face"), F("Fortified milk", "dairy"), F("Fortified oil"), F("Egg yolk", "egg"), F("Fatty fish", "fish"), F("Mushrooms", "jain_avoid")],
      tip: "Fat soluble, so it absorbs better with a meal that has some fat." },
    { key: "iodine", label: "Iodine", why: "Not counted. Comes mainly from iodised salt.",
      foods: [F("Iodised salt"), F("Milk and curd", "dairy"), F("Seafood", "fish")],
      tip: "If you cut salt, keep using iodised salt." },
    { key: "salt", label: "Salt", why: "Not counted, because added salt cannot be seen. DGI 2024 limit: 5 g of salt a day (about 1 teaspoon).",
      foods: [], tip: "Pickles, papad, namkeen and packaged snacks are the big hidden sources." },
  ];

  // Which foods a diet allows, from a food's tags or a dish's flags.
  const ALLOW = {
    nonveg: () => true,
    eggetarian: (f) => !f.meat && !f.fish,
    vegetarian: (f) => !f.egg && !f.meat && !f.fish,
    vegan: (f) => !f.dairy && !f.egg && !f.meat && !f.fish,
    jain: (f) => !f.egg && !f.meat && !f.fish && !f.jain_avoid,
  };
  const allowed = (flags, diet) => (ALLOW[diet] || ALLOW.vegetarian)(flags || {});
  const tagFlags = (tags) => Object.fromEntries(tags.map((t) => [t, true]));
  const foodsFor = (list, diet) => list.filter((x) => allowed(tagFlags(x.tags), diet)).map((x) => x.name);

  // Top dishes in the app's food table for one nutrient, per standard serving.
  // Ranked by amount per 100 kcal, keeping dishes where one serving gives at least 10% of the RDA.
  const SKIP_CATS = ["Sweets", "Fast food", "Drinks"];
  function topDishes(key, diet, rda, n = 3) {
    const valOf = (d) => (key === "protein" || key === "fibre" ? d.per100g[key] : d.micro ? d.micro[key] : null);
    const out = [];
    App.dishes.forEach((d) => {
      const v = valOf(d);
      if (v == null || SKIP_CATS.includes(d.category) || !allowed(d.flags, diet)) return;
      const u = d.units[0];
      const amount = v * u.g / 100;
      const fat = d.added_fat ? d.added_fat.home * u.g / 100 * App.fats[d.added_fat.type].per_g.kcal : 0;
      const kcal = d.per100g.kcal * u.g / 100 + fat;
      if (amount < rda * 0.1 || kcal <= 0) return;
      out.push({ dish: d, unit: u, amount, kcal, score: amount / kcal * 100, ghee: !!(d.flags && d.flags.ghee_fat) });
    });
    return out.sort((a, b) => b.score - a.score).slice(0, n);
  }

  App.Sources = { SOURCES, NOT_TRACKED, allowed, foodsFor, topDishes };
})();
