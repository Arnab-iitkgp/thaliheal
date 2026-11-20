/* Fun fact popup.
   Add this file to the app and call FunFact.init() once the page has loaded.
   The 100 facts are built in below. Pass {factsUrl:"funfacts.json"} to load a list instead. */
(function () {
  "use strict";

  var DEFAULTS = {
    factsUrl: null,             // leave null to use the built in list, or give a JSON file URL
    intervalMs: 20000,          // gap between popups while the tab is open
    visibleMs: 8000,            // how long each popup stays on screen
    awayNotifyEveryMs: 180000,  // gap between browser notifications while the tab is hidden
    heading: "Did you know?"
  };

  var FACTS = [
  "Indians get 62% of their daily calories from carbs. Rice and roti are running the show!",
  "Protein contributes just 12% of the average Indian's daily calories.",
  "Animal protein supplies barely 1% of India's total calories.",
  "Dairy contributes only 2% of calories, despite India's love affair with milk.",
  "Replace 5% of carb calories with protein, and diabetes risk drops.",
  "India's biggest carb eaters face 30% higher diabetes risk.",
  "Millet flour can spike blood sugar almost as much as white rice!",
  "Switching rice for millets won't help much if total carbs remain unchanged.",
  "Karnataka, Gujarat and Maharashtra are India's major millet-staple states.",
  "Pulses, not cereals, are linked to lower diabetes risk.",
  "21 Indian states and UTs exceed recommended sugar intake limits.",
  "India consumes roughly 15% of the world's sugar. That's a seriously sweet statistic!",
  "Low yoghurt intake has been linked to 13% of South Asian diabetes cases.",
  "India has approximately 101 million adults living with diabetes.",
  "In Asian BMI guidelines, 23 already counts as overweight!",
  "Two people, same BMI, different body fat. South Asians typically carry more!",
  "India's thin-fat body type may begin programming before birth.",
  "Indians often develop diabetes younger and at lower BMI than Caucasians.",
  "Indians consume approximately 11 grams of salt daily. That's a salty habit!",
  "That's 2.2 times the WHO's recommended daily salt limit!",
  "Tripura leads India's salt consumption table at approximately 13 grams daily.",
  "Your pickle, papad and namkeen may be saltier villains than expected!",
  "Regular iodised salt is approximately 40% sodium.",
  "ICMR is testing low-sodium salt alternatives in Punjab and Telangana.",
  "Unhealthy diets contribute to an estimated 56.4% of India's disease burden.",
  "ICMR released 17 dietary guidelines after a 13-year gap.",
  "34% of Indian children aged 5–9 have high triglycerides!",
  "ICMR warns that prolonged protein powder use may harm bones and kidneys.",
  "ICMR recommends keeping added sugar below 5% of daily energy.",
  "Rural Indians now spend less than half their household budget on food.",
  "Urban households spend just 39% of their budgets on food.",
  "Milk now costs Indian households more than cereals and pulses combined.",
  "Vegetables have overtaken cereals in Indian household food spending.",
  "Cereals' share of rural spending plunged from 22.2% to 4.9%.",
  "India's milk production has grown nearly 15-fold since the 1950s!",
  "Daily milk availability jumped from 124 grams to 485 grams per person.",
  "Punjab has almost three times the national average milk availability.",
  "India is simultaneously the world's largest producer and consumer of pulses.",
  "Nearly 27% of the world's pulses are consumed in India.",
  "Four out of every ten mangoes worldwide come from India!",
  "India produces more bananas than any other country.",
  "India's annual meat availability averages just 7.5 kilograms per person.",
  "Indians have access to approximately 106 eggs per person annually.",
  "Roughly 80% of India's tea never leaves India!",
  "Milk tea with sugar remains India's favourite way to drink tea.",
  "Animal products now provide 25% of Indian protein, up from 19%.",
  "India ordered 93 million biryanis on Swiggy in 2025. Biryani supremacy!",
  "That's 194 biryanis every minute. Someone's always ordering one!",
  "Biryani has topped Swiggy's most-ordered dishes for ten consecutive years.",
  "Chicken biryani alone attracted 57.7 million Swiggy orders in 2025!",
  "For every 5.5 chicken biryanis, India ordered one veg biryani in 2023.",
  "One Hyderabad foodie ordered 1,633 biryanis in a single year. Respect!",
  "India–Pakistan World Cup fever pushed biryani orders to 250 per minute!",
  "Gulab jamun beat rosogolla during Durga Puja, clocking 7.7 million orders!",
  "Swiggy's 2021 samosa orders equalled New Zealand's entire population!",
  "Chicken rolls were India's most-ordered Swiggy snack in 2024.",
  "Dinner generated 29% more delivery orders than lunch in 2024. Hunger peaks later!",
  "One vada pav packs approximately 197 calories. Mumbai's favourite isn't calorie-free!",
  "Burning one vada pav takes roughly an hour of brisk walking.",
  "A humble samosa can hide anywhere between 200 and 350 calories!",
  "Jalebi delivers 380–490 calories per 100 grams. Sweet, but not light!",
  "Four pieces of kaju katli can deliver 391 calories. Diwali math!",
  "A tiny 30-gram rasgulla can contain approximately 100 calories.",
  "Mysore pak packs approximately 357 calories per 100 grams. Pure indulgence!",
  "Frying papad adds roughly 70% more calories than grilling it.",
  "Wheat, bajra and millets all contain approximately 350 calories per 100 grams.",
  "Jaggery and white sugar are practically calorie twins!",
  "Dal fry contains approximately 118 calories per 100 grams.",
  "Cabbage sabzi has 71 calories; palak paneer has 189.",
  "Two samosas, curry, naan and dessert can cross 1,800 calories!",
  "Just one teaspoon of ghee contains approximately 45 calories.",
  "One plain idli typically contains only 40–60 calories. Breakfast wins!",
  "A cup of sweet milk chai can add 80–120 calories.",
  "One plain phulka typically contains approximately 80–100 calories.",
  "Ekadashi falls on the 11th lunar day, twice every month.",
  "That's approximately 24 Ekadashi fasting days every year!",
  "Sama rice, a Navratri fasting favourite, is actually a millet.",
  "Kuttu sounds like wheat, but it's gluten-free buckwheat!",
  "Sabudana is practically starch on a plate, with negligible protein.",
  "Sabudana's glycemic index ranges from 67–75. That's considered high!",
  "Kuttu and rajgira generally have lower glycemic indexes than sabudana.",
  "Deep-fried kuttu puris can turn fasting into a calorie feast!",
  "Many Navratri fasts exclude wheat, rice, lentils and meat.",
  "Sendha namak is permitted in many fasts, unlike regular table salt.",
  "Nirjala Ekadashi means fasting without even drinking water!",
  "Ayurveda has a name for therapeutic fasting: Langhana.",
  "The 2016 Nobel Prize honoured autophagy, the body's cellular recycling process.",
  "Intermittent fasting produces modest results, without clearly beating calorie restriction.",
  "ICMR is funding an Indian trial investigating intermittent fasting for weight loss.",
  "Only 39% of Indian adults identify as vegetarian. Surprised?",
  "Just 44% of Hindus identify as vegetarian.",
  "Eight in ten Indians restrict meat consumption in some way.",
  "Approximately 92% of Jains follow vegetarian diets.",
  "Two-thirds of Jains avoid root vegetables altogether!",
  "Idli fermentation can increase B vitamins and potentially trace vitamin B12.",
  "Black pepper may boost turmeric's curcumin absorption by up to 2,000%!",
  "Coconut oil and chilled rice may reduce absorbed calories in laboratory studies.",
  "One Indian review found inadequate B12 intake among 65% of vegetarians.",
  "Even Telangana reported 44% B12 deficiency among pregnant women in one study.",
  "A trial found daily milk improved vitamin B12 levels in young vegetarians."
];

  var cfg, facts = [], bag = [], lastIndex = -1;
  var card, textEl, btnOn, btnNote, hideTimer = null, hovering = false;
  var lastShown = 0, lastNotify = 0;
  var state = { on: true, notifyAway: false };

  function readFlag(key, fallback) {
    try { var v = localStorage.getItem(key); return v === null ? fallback : v === "1"; }
    catch (e) { return fallback; }
  }
  function saveFlag(key, val) {
    try { localStorage.setItem(key, val ? "1" : "0"); } catch (e) {}
  }
  function el(tag, cls) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    return n;
  }
  function canNotify() { return "Notification" in window; }

  function normalise(list) {
    return list
      .map(function (f) { return typeof f === "string" ? f : f && f.text; })
      .filter(Boolean);
  }

  function loadFacts() {
    if (!cfg.factsUrl) return Promise.resolve(FACTS);
    return fetch(cfg.factsUrl)
      .then(function (r) { if (!r.ok) throw new Error("bad response"); return r.json(); })
      .then(function (data) {
        var list = normalise(Array.isArray(data) ? data : (data.facts || []));
        return list.length ? list : FACTS;
      })
      .catch(function () { return FACTS; });
  }

  // Shuffled bag so every fact shows once before any repeats.
  function refill() {
    bag = facts.map(function (_, i) { return i; });
    for (var i = bag.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = bag[i]; bag[i] = bag[j]; bag[j] = t;
    }
    var last = bag.length - 1;
    if (bag.length > 1 && bag[last] === lastIndex) {
      var s = bag[0]; bag[0] = bag[last]; bag[last] = s;
    }
  }
  function nextFact() {
    if (!bag.length) refill();
    lastIndex = bag.pop();
    return facts[lastIndex];
  }

  function scheduleHide(ms) {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(hide, ms);
  }
  function show() {
    textEl.textContent = nextFact();
    card.classList.add("ff-in");
    lastShown = Date.now();
    if (!hovering) scheduleHide(cfg.visibleMs);
  }
  function hide() {
    card.classList.remove("ff-in");
    clearTimeout(hideTimer);
  }

  function sync() {
    btnOn.textContent = state.on ? "Pause facts" : "Resume facts";
    if (!canNotify()) { btnNote.style.display = "none"; return; }
    var blocked = Notification.permission === "denied";
    btnNote.disabled = blocked;
    btnNote.textContent = blocked ? "Notifications blocked"
      : state.notifyAway ? "Away alerts: on" : "Away alerts: off";
  }

  function toggleNotify() {
    if (!canNotify()) return;
    if (state.notifyAway) {
      state.notifyAway = false; saveFlag("ff_notify", false); sync(); return;
    }
    if (Notification.permission === "granted") {
      state.notifyAway = true; saveFlag("ff_notify", true); sync(); return;
    }
    // Permission has to be asked for from a click, so it lives behind this button.
    Notification.requestPermission().then(function (p) {
      state.notifyAway = p === "granted";
      saveFlag("ff_notify", state.notifyAway);
      sync();
    });
  }

  function buildUI() {
    var css = document.createElement("style");
    css.textContent = [
      ".ff-card{position:fixed;right:16px;bottom:64px;max-width:340px;padding:14px 36px 14px 16px;border-radius:14px;background:#fff;color:#1b1f23;border:1px solid rgba(0,0,0,.08);box-shadow:0 8px 30px rgba(0,0,0,.18);font:14px/1.45 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;z-index:2147483000;opacity:0;transform:translateY(12px);pointer-events:none;transition:opacity .3s,transform .3s}",
      ".ff-card.ff-in{opacity:1;transform:none;pointer-events:auto}",
      ".ff-head{font-weight:600;font-size:12px;letter-spacing:.04em;text-transform:uppercase;color:#0f8b6d;margin-bottom:4px}",
      ".ff-close{position:absolute;top:6px;right:8px;border:0;background:none;font-size:20px;line-height:1;cursor:pointer;color:inherit;opacity:.5}",
      ".ff-close:hover{opacity:1}",
      ".ff-pill{position:fixed;right:16px;bottom:16px;display:flex;gap:6px;z-index:2147483000;font:12px system-ui,-apple-system,'Segoe UI',Roboto,sans-serif}",
      ".ff-pill button{border:1px solid rgba(0,0,0,.12);background:#fff;color:#1b1f23;border-radius:999px;padding:6px 10px;cursor:pointer;font:inherit}",
      ".ff-pill button:disabled{opacity:.5;cursor:default}",
      "@media (max-width:520px){.ff-card{left:16px;right:16px;max-width:none}.ff-pill{left:16px;justify-content:flex-end}}",
      "@media (prefers-color-scheme:dark){.ff-card,.ff-pill button{background:#1e2327;color:#eef1f3;border-color:rgba(255,255,255,.14)}}",
      "@media (prefers-reduced-motion:reduce){.ff-card{transition:none;transform:none}}"
    ].join("");
    document.head.appendChild(css);

    card = el("div", "ff-card");
    card.setAttribute("role", "status");
    card.setAttribute("aria-live", "polite");
    var head = el("div", "ff-head");
    head.textContent = cfg.heading;
    textEl = el("div", "ff-text");
    var close = el("button", "ff-close");
    close.type = "button";
    close.setAttribute("aria-label", "Dismiss fun fact");
    close.textContent = "\u00d7";
    close.addEventListener("click", hide);
    card.appendChild(head);
    card.appendChild(textEl);
    card.appendChild(close);

    // Hovering keeps the card on screen so it can be read in peace.
    card.addEventListener("mouseenter", function () { hovering = true; clearTimeout(hideTimer); });
    card.addEventListener("mouseleave", function () {
      hovering = false;
      if (card.classList.contains("ff-in")) scheduleHide(2500);
    });

    var pill = el("div", "ff-pill");
    btnOn = el("button"); btnOn.type = "button";
    btnOn.addEventListener("click", function () {
      state.on = !state.on;
      saveFlag("ff_on", state.on);
      if (!state.on) hide();
      sync();
    });
    btnNote = el("button"); btnNote.type = "button";
    btnNote.addEventListener("click", toggleNotify);
    pill.appendChild(btnOn);
    pill.appendChild(btnNote);

    document.body.appendChild(card);
    document.body.appendChild(pill);
  }

  function tick() {
    if (!state.on) return;
    var now = Date.now();
    if (document.hidden) {
      if (state.notifyAway && canNotify() && Notification.permission === "granted" &&
          now - lastNotify >= cfg.awayNotifyEveryMs) {
        lastNotify = now;
        lastShown = now;
        try { new Notification(cfg.heading, { body: nextFact(), tag: "funfact" }); } catch (e) {}
      }
      return;
    }
    if (!hovering && now - lastShown >= cfg.intervalMs) show();
  }

  function init(options) {
    cfg = Object.assign({}, DEFAULTS, options || {});
    state.on = readFlag("ff_on", true);
    state.notifyAway = readFlag("ff_notify", false) && canNotify() && Notification.permission === "granted";
    buildUI();
    sync();
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) lastNotify = Date.now();
    });
    loadFacts().then(function (list) {
      facts = list;
      lastShown = Date.now() - cfg.intervalMs + 2000; // first popup about 2 seconds in
      setInterval(tick, 1000);
    });
  }

  window.FunFact = { init: init, next: show, hide: hide };
})();