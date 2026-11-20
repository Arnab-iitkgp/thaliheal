/* utils.js: pure helper utilities, storage, fetch wrapper, and date helpers.
   Part of the ThaliHeal modular frontend. */
window.App = window.App || {};

(function () {
  "use strict";

  // ---------- DOM & Formatting Helpers ----------
  App.$ = (id) => document.getElementById(id);
  App.r0 = (n) => Math.round(n);
  App.r1 = (n) => (Math.round(n * 10) / 10).toFixed(1).replace(/\.0$/, "");
  App.clamp = (n, a, b) => Math.min(b, Math.max(a, n));
  App.esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  App.norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  App.fmtCount = (n) => { const q = Math.round(n * 4) / 4; return q % 1 === 0 ? String(q) : q.toFixed(2).replace(/0$/, ""); };
  App.plural = (unit, n) => (n <= 1.001 || /\(|s$/.test(unit)) ? unit : unit + "s";
  App.range = (lo, hi, unit) => `${App.r0(lo)} to ${App.r0(hi)}${unit ? " " + unit : ""}`;

  // ---------- Local Storage Abstraction ----------
  App.store = {
    get(k, d) {
      try {
        const v = localStorage.getItem(k);
        return v === null ? d : JSON.parse(v);
      } catch (e) {
        return d;
      }
    },
    set(k, v) {
      try {
        localStorage.setItem(k, JSON.stringify(v));
      } catch (e) {}
    },
  };

  // ---------- Safe JSON response reader ----------
  App.readJSON = (fallback) => (r) =>
    r.json().catch((e) => {
      if (e && e.name === "AbortError") throw e;
      return fallback;
    });

  // ---------- Fetch with Timeout and Abort Signal ----------
  App.fetchFor = async function (url, opts = {}, ms = 30000, read) {
    const ctl = new AbortController();
    let late = false;
    const timer = setTimeout(() => { late = true; ctl.abort(); }, ms);
    const outer = opts.signal;
    const stop = () => ctl.abort();
    if (outer) {
      if (outer.aborted) ctl.abort();
      else outer.addEventListener("abort", stop, { once: true });
    }
    try {
      const r = await fetch(url, Object.assign({}, opts, { signal: ctl.signal }));
      return read ? { r, body: await read(r) } : r;
    } catch (e) {
      if (e && (e.name === "AbortError" || ctl.signal.aborted)) {
        throw { code: late ? "timeout" : "cancelled" };
      }
      throw e;
    } finally {
      clearTimeout(timer);
      if (outer) outer.removeEventListener("abort", stop);
    }
  };

  // ---------- File Saving (CSV / JSON exports) ----------
  function saveWeb(filename, text, type) {
    try {
      const blob = new Blob([text], { type });
      const url = URL.createObjectURL(blob);
      const a = Object.assign(document.createElement("a"), { href: url, download: filename });
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000); // Chrome Android delay
      let share = null;
      try {
        const file = new File([blob], filename, { type });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          share = () => navigator.share({ files: [file], title: filename }).catch(() => {});
        }
      } catch (e) {}
      return { msg: `Downloaded ${filename}. Look in your Downloads folder.`, share };
    } catch (e) {
      return false;
    }
  }

  App.saveFile = async function (filename, text, type) {
    type = type || "text/plain";
    if (type === "text/csv" && text.charCodeAt(0) !== 0xfeff) text = "\ufeff" + text; // BOM for Excel
    if (App.hosting === "claude") {
      const dl = await window.claude.use("downloads").catch(() => null);
      if (dl) {
        try {
          await dl.save({ filename, data: text });
          return { msg: "Saved." };
        } catch (e) {
          return e && e.code === "declined" ? { msg: "Not saved." } : false;
        }
      }
      return false;
    }
    return saveWeb(filename, text, type);
  };

  App.saveNote = function (el, res) {
    if (!el) return;
    el.classList.remove("err");
    el.textContent = (res && res.msg) || "Saved.";
    if (res && res.share) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "btn btn-small share-btn";
      b.textContent = "Share";
      b.onclick = res.share;
      el.append(" ", b);
    }
  };

  // ---------- Dates (local calendar days as YYYY-MM-DD) ----------
  const pad = (n) => String(n).padStart(2, "0");
  App.dateStr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  App.today = () => App.dateStr(new Date());
  App.parseDate = (s) => {
    const [y, m, d] = s.split("-").map(Number);
    return new Date(y, m - 1, d);
  };
  App.addDays = (s, n) => {
    const d = App.parseDate(s);
    d.setDate(d.getDate() + n);
    return App.dateStr(d);
  };
  App.fmtDate = (s, o) =>
    App.parseDate(s).toLocaleDateString("en-IN", o || { weekday: "short", day: "numeric", month: "short" });
  App.SLOTS = { breakfast: "Breakfast", lunch: "Lunch", snack: "Snack", dinner: "Dinner" };
  App.slotNow = () => {
    let h = new Date().getHours();
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      // In UTC, unspecified, or Indian timezones, resolve against Indian Standard Time (Asia/Kolkata)
      if (!tz || tz === "UTC" || tz === "Etc/UTC" || /calcutta|kolkata/i.test(tz)) {
        const istStr = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Kolkata", hour: "numeric", hour12: false }).format(new Date());
        const istH = parseInt(istStr, 10);
        if (!isNaN(istH)) h = istH;
      }
    } catch (e) {}
    return h < 11 ? "breakfast" : h < 16 ? "lunch" : h < 19 ? "snack" : "dinner";
  };
})();

