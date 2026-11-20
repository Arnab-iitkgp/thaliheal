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
    openGuide() {
      const bg = document.getElementById("installSheetBg");
      const sheet = document.getElementById("installSheet");
      const body = document.getElementById("installSheetBody");
      const close = document.getElementById("installSheetClose");
      if (!sheet || !body) return;

      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
      const isAndroid = /Android/.test(navigator.userAgent);

      let content = "";
      if (isIOS) {
        content = `
          <p class="install-guide-lead">Install ThaliHeal to your iPhone or iPad home screen for instant full-screen access and offline meal logging.</p>
          <div class="install-steps">
            <div class="install-step">
              <span class="install-step-num">1</span>
              <div class="install-step-text">Tap the <b>Share button</b> <svg class="inline-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg> in Safari's bottom toolbar.</div>
            </div>
            <div class="install-step">
              <span class="install-step-num">2</span>
              <div class="install-step-text">Scroll down the share sheet and tap <b>"Add to Home Screen"</b> <svg class="inline-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="4"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>.</div>
            </div>
            <div class="install-step">
              <span class="install-step-num">3</span>
              <div class="install-step-text">Tap <b>Add</b> in the top right. ThaliHeal will now launch right from your home screen!</div>
            </div>
          </div>`;
      } else if (isAndroid) {
        content = `
          <p class="install-guide-lead">Install ThaliHeal on your Android device for instant camera access and offline nutrition logging.</p>
          <div class="install-steps">
            <div class="install-step">
              <span class="install-step-num">1</span>
              <div class="install-step-text">Tap the <b>three dots menu (⋮)</b> in the top right corner of Chrome.</div>
            </div>
            <div class="install-step">
              <span class="install-step-num">2</span>
              <div class="install-step-text">Select <b>"Install app"</b> or <b>"Add to Home screen"</b>.</div>
            </div>
            <div class="install-step">
              <span class="install-step-num">3</span>
              <div class="install-step-text">Tap <b>Install</b> to confirm. ThaliHeal runs standalone just like a native app.</div>
            </div>
          </div>`;
      } else {
        content = `
          <p class="install-guide-lead">Install ThaliHeal on your computer for easy docking and rapid meal tracking.</p>
          <div class="install-steps">
            <div class="install-step">
              <span class="install-step-num">1</span>
              <div class="install-step-text">Look for the <b>Install icon</b> <svg class="inline-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> on the right side of the address bar.</div>
            </div>
            <div class="install-step">
              <span class="install-step-num">2</span>
              <div class="install-step-text">Click <b>Install</b> to run ThaliHeal in its own lightweight window without browser tabs.</div>
            </div>
          </div>`;
      }

      body.innerHTML = content;
      if (bg) bg.hidden = false;
      sheet.hidden = false;

      const hide = () => {
        if (bg) bg.hidden = true;
        sheet.hidden = true;
      };
      if (close) close.onclick = hide;
      if (bg) bg.onclick = hide;
    },
    init() {
      if (App.hosting !== "web") return;
      window.addEventListener("offline", () => App.net.set(true));
      window.addEventListener("online", () => (App.net.retry ? App.net.retry() : App.net.set(false)));
      if (!navigator.onLine) App.net.set(true);

      const installed = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
      const ib = document.getElementById("installBtn");
      if (ib) {
        ib.hidden = installed;
        ib.onclick = async () => {
          const p = App.pwa.prompt;
          if (p) {
            App.pwa.prompt = null;
            p.prompt();
            const choice = await p.userChoice.catch(() => null);
            if (choice && choice.outcome === "accepted") {
              ib.hidden = true;
            }
          } else {
            App.pwa.openGuide();
          }
        };
      }

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

  // Fun Facts disabled
  App.Facts = { start() {}, quiet() {}, showNow() {} };

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
