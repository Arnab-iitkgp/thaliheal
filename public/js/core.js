/* core.js: application bootstrap, data loading, hosting detection, PWA, and network state.
   Part of the ThaliHeal modular frontend. */
window.App = window.App || {};

(function () {
  "use strict";

  // Global State Containers
  App.dishes = [];
  App.byId = {};
  App.fats = {};
  App.meta = {};
  App.types = [];
  App.samples = [];
  App.samplesById = {};
  App.sampleMeta = {};
  App.claudeSample = null;
  App.aiProvider = "gemini";
  App.aiModels = {};

  App.providerName = function () {
    const p = (this.aiProvider || "gemini").toLowerCase();
    if (p === "gemini") return "Google Gemini";
    if (p === "groq") return "Groq";
    if (p === "openai") return "OpenAI";
    return "Anthropic Claude";
  };

  // ---------- Data Loading ----------
  App.loadData = async function () {
    const [d, s] = await Promise.all([
      fetch("data/dishes.json").then((r) => {
        if (!r.ok) throw new Error("dishes");
        return r.json();
      }),
      fetch("data/sample_dishes.json").then((r) => {
        if (!r.ok) throw new Error("samples");
        return r.json();
      }),
    ]);
    App.dishes = d.dishes;
    App.fats = d.fats;
    App.meta = d.meta || {};
    App.types = App.meta.types || [];
    App.dishes.forEach((x) => {
      App.byId[x.id] = x;
      x._search = App.norm([x.name, ...(x.aliases || [])].join(" "));
    });
    App.samples = s.dishes;
    App.sampleMeta = s.meta || {};
    App.samples.forEach((x) => {
      App.samplesById[x.id] = x;
    });
  };

  // ---------- Environment & Hosting ----------
  // "claude": opened inside Claude artifact runtime.
  // "web": deployed as a standalone web application.
  App.hosting = window.claude && typeof window.claude.use === "function" ? "claude" : "web";

  // Android Chrome Notification polyfill via service worker
  if (App.hosting === "web" && /Android/i.test(navigator.userAgent) && "Notification" in window && "serviceWorker" in navigator) {
    const N = window.Notification;
    const ViaWorker = function (title, opts) {
      navigator.serviceWorker.ready
        .then((reg) =>
          reg.showNotification(
            title,
            Object.assign({ icon: "/img/icons/icon-192.png", badge: "/img/icons/icon-96.png" }, opts)
          )
        )
        .catch(() => {});
    };
    ViaWorker.requestPermission = (...a) => N.requestPermission(...a);
    Object.defineProperty(ViaWorker, "permission", { get: () => N.permission });
    window.Notification = ViaWorker;
  }

  // The AI proxy lives on the same site
  App.apiUrl = "/api/ai";

  // Scan off mode / feature flag handling
  App.aiEnabled = App.hosting === "claude" || (window.THALIHEAL_FLAGS || {}).ai === true;
  document.documentElement.classList.toggle("ai-off", !App.aiEnabled);

  App.setAI = function (on) {
    on = !!on;
    const changed = on !== App.aiEnabled;
    App.aiEnabled = on;
    document.documentElement.classList.toggle("ai-off", !on);
    if (changed && App.current) App.route();
  };

  // ---------- Connection & Network State ----------
  App.net = {
    offline: false,
    timer: null,
    retry: null,
    set(off) {
      if (this.offline !== off) {
        this.offline = off;
        const bar = document.getElementById("offlineBar");
        if (bar) bar.hidden = !off || App.hosting !== "web";
      }
      if (off && !this.timer && App.hosting === "web") {
        this.timer = setInterval(() => (this.retry ? this.retry() : this.ping()), 15000);
      }
      if (!off && this.timer) {
        clearInterval(this.timer);
        this.timer = null;
      }
    },
    async ping() {
      try {
        await App.fetchFor(App.apiUrl, { headers: { Accept: "application/json" }, cache: "no-store" }, 8000);
        this.set(false);
      } catch (e) {}
    },
  };

  // ---------- Progressive Web App (PWA) ----------
  App.pwa = {
    prompt: null,
    updating: false,
    init() {
      if (App.hosting !== "web") return;
      window.addEventListener("offline", () => App.net.set(true));
      window.addEventListener("online", () => (App.net.retry ? App.net.retry() : App.net.set(false)));
      if (!navigator.onLine) App.net.set(true);

      const installed = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
      window.addEventListener("beforeinstallprompt", (e) => {
        e.preventDefault();
        App.pwa.prompt = e;
        const b = document.getElementById("installBtn");
        if (b && !installed) b.hidden = false;
      });
      window.addEventListener("appinstalled", () => {
        App.pwa.prompt = null;
        const b = document.getElementById("installBtn");
        if (b) b.hidden = true;
      });
      const ib = document.getElementById("installBtn");
      if (ib) {
        ib.onclick = async () => {
          const p = App.pwa.prompt;
          if (!p) return;
          App.pwa.prompt = null;
          ib.hidden = true;
          p.prompt();
          await p.userChoice.catch(() => null);
        };
      }
      if (installed) {
        const h = document.getElementById("installHelp");
        if (h) h.textContent = "ThaliHeal is installed on this device.";
      }

      const secure = location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1";
      if (!("serviceWorker" in navigator) || !secure) return;
      const offerUpdate = (worker) => {
        const bar = document.getElementById("updateBar");
        if (!bar) return;
        bar.hidden = false;
        document.getElementById("updateBtn").onclick = () => {
          App.pwa.updating = true;
          worker.postMessage("skip-waiting");
        };
      };

      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (App.pwa.updating) {
          App.pwa.updating = false;
          location.reload();
        }
      });
      navigator.serviceWorker
        .register("/sw.js", { scope: "/" })
        .then((reg) => {
          if (reg.waiting && navigator.serviceWorker.controller) offerUpdate(reg.waiting);
          reg.addEventListener("updatefound", () => {
            const w = reg.installing;
            w &&
              w.addEventListener("statechange", () => {
                if (w.state === "installed" && navigator.serviceWorker.controller) offerUpdate(w);
              });
          });
        })
        .catch(() => {});
    },
  };

  // ---------- Fun Facts Controller ----------
  App.Facts = (() => {
    const quiet = new Set();
    const ready = () => !!(window.FunFact && window.__funFactStarted);
    const paused = () => {
      const b = document.querySelector(".ff-pill button");
      return !!b && b.textContent === "Resume facts";
    };
    function start() {
      if (window.__funFactStarted || !window.FunFact) return;
      window.__funFactStarted = true;
      window.FunFact.init();
      const card = document.querySelector(".ff-card");
      if (card) {
        new MutationObserver(() => {
          if (quiet.size && card.classList.contains("ff-in")) window.FunFact.hide();
        }).observe(card, { attributes: true, attributeFilter: ["class"] });
      }
    }
    return {
      start,
      quiet(reason, on) {
        on ? quiet.add(reason) : quiet.delete(reason);
        if (on && ready()) window.FunFact.hide();
      },
      showNow() {
        if (ready() && !quiet.size && !paused()) window.FunFact.next();
      },
    };
  })();

  // ---------- Application Lifecycle Bootstrap ----------
  App.start = async function () {
    if (App.initPicker) App.initPicker();
    App.Account.init(); // background auth init
    try {
      await App.loadData();
    } catch (e) {
      document.body.insertAdjacentHTML(
        "afterbegin",
        `<div class="wrap"><div class="card notice">The food tables did not load. Reload the page to try again.</div></div>`
      );
      return;
    }
    Object.values(App.views).forEach((v) => v.init && v.init());
    App.pwa.init();
    window.addEventListener("hashchange", App.route);

    if (App.hosting === "web") {
      const p = location.pathname.replace(/^\/+|\/+$/g, "");
      if (p && p !== "index.html" && !p.includes("/") && !location.hash) {
        history.replaceState(null, "", "/#" + p);
      }
    }
    App.route();
    if (document.readyState === "complete") App.Facts.start();
    else window.addEventListener("load", App.Facts.start, { once: true });

    // AI model probe: inside Claude artifact or through backend proxy /api/ai
    try {
      const s = App.hosting === "claude" ? await window.claude.use("sample") : null;
      const lim = s ? await s.limits().catch(() => null) : null;
      App.claudeSample = s && lim && lim.images ? s : null;
    } catch (e) {
      App.claudeSample = null;
    }
    if (!App.claudeSample && App.hosting === "web") {
      App.claudeSample = await App.serverSample();
    }
    Object.values(App.views).forEach((v) => v.onClaude && v.onClaude(!!App.claudeSample));
  };
})();
