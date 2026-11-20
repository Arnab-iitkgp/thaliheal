/* router.js: client-side hash routing, quiet views management, and screen navigation.
   Part of the ThaliHeal modular frontend. */
window.App = window.App || {};

(function () {
  "use strict";

  App.views = App.views || {};
  App.current = null;

  // Routes: #home, #scan, #plate, #soon, #dish-s01, #profile, #track, #ask, #consent, #privacy, #settings, #test
  // #plate is the scan screen for adding dishes by hand. With AI off, #scan opens #soon ("coming soon") instead,
  // and #test goes back to Settings.
  // Also quiet on the consent notice and the assistant, so nothing pops over legal text or a conversation.
  const QUIET_VIEWS = ["scan", "soon", "test", "consent", "ask"];

  App.testModeOn = () => App.store.get("thali.testMode", false) === true;
  App.plateHash = () => (App.aiEnabled ? "#scan" : "#plate");

  App.route = function () {
    let h = (location.hash || "").replace(/^#/, "") || "home";
    let view = h,
      param = null;
    if (h.startsWith("dish-")) {
      view = "dish";
      param = h.slice(5);
    }
    if (h === "plate") {
      view = "scan";
      param = "manual";
    }
    if (view === "scan" && !App.aiEnabled && param !== "manual") {
      location.replace("#soon");
      return;
    }
    // Test mode is only reachable once the settings switch is on, and only with AI on; unknown routes go home.
    if (view === "test" && (!App.testModeOn() || !App.aiEnabled)) {
      location.replace("#settings");
      return;
    }
    if (!App.views[view]) {
      location.replace("#home");
      return;
    }
    if (App.current && App.current !== view && App.views[App.current].hide) {
      App.views[App.current].hide();
    }
    document.querySelectorAll("[data-view]").forEach((s) => {
      s.hidden = s.dataset.view !== view;
    });
    document.body.classList.toggle("has-total", view === "scan");
    if (App.Facts && App.Facts.quiet) App.Facts.quiet("view", QUIET_VIEWS.includes(view));
    App.current = view;
    const navView =
      view === "dish"
        ? "home"
        : view === "soon"
        ? "scan"
        : ["consent", "privacy", "test"].includes(view)
        ? "settings"
        : view;
    document.querySelectorAll("[data-nav]").forEach((a) => {
      if (a.dataset.nav === navView) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    });
    App.views[view].show(param);
    window.scrollTo(0, 0);
  };
})();
