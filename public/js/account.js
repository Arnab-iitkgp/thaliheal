/* account.js: sign in, profile and meal log storage.

   Login is the viewer's Claude account (the page's "user" capability). The app keeps no
   passwords. Each person's data lives in their own private area of the app database,
   data/users/<id>/tracker, which no one else can read (not even the app owner).
   It is separate from test mode (data/users/<id>/testmode).

   Layout:
     data/users/<id>/tracker              { profile, consent, updated }
     data/users/<id>/tracker/meals/<mid>  one saved meal (see App.mealFromItems)

   Outside Claude, or if the database fails, everything falls back to this browser only. */
(function () {
  "use strict";
  const LOCAL_KEY = "thali.tracker.v1";
  // Bump when the notice text changes: everyone is asked again (older consents lack purposes).
  const CONSENT_VERSION = "2026-11-14.3";

  const use = (n) => (window.claude && typeof window.claude.use === "function" ? window.claude.use(n).catch(() => null) : Promise.resolve(null));
  const snapData = (s) => { if (!s) return null; const ex = typeof s.exists === "function" ? s.exists() : s.exists; if (ex === false) return null; return typeof s.data === "function" ? s.data() || null : s; };

  const A = {
    mode: "local",            // "db" (signed in, private area) or "local" (this browser only)
    uid: null, name: "", ready: null, error: "",
    cache: { doc: null, meals: null },
    listeners: [],

    init() {
      if (this.ready) return this.ready;
      this.ready = (async () => {
        const [db, user] = await Promise.all([use("db"), use("user")]);
        const uid = user && user.id ? await user.id().catch(() => null) : null;
        if (db && uid) {
          this.uid = uid; this.mode = "db";
          this.root = db.doc(`data/users/${uid}/tracker`);
          try { const ps = user.profiles ? await user.profiles([uid]) : null; this.name = (ps && ps[uid] && ps[uid].name) || ""; } catch (e) { this.name = ""; }
        }
      })();
      return this.ready;
    },
    onChange(fn) { this.listeners.push(fn); },
    changed() { this.listeners.forEach((fn) => { try { fn(); } catch (e) {} }); },

    // ----- local fallback -----
    local() { return App.store.get(LOCAL_KEY, { doc: null, meals: [] }); },
    saveLocal(v) { App.store.set(LOCAL_KEY, v); },

    // Run fn against the database; on failure, switch to this browser and say so once.
    async safe(fn, fallback) {
      if (this.mode !== "db") return fallback();
      try { return await fn(); }
      catch (e) {
        this.mode = "local";
        this.error = `Saving to your private area failed (${(e && e.code) || "error"}). From now on your log is kept in this browser only.`;
        this.changed();
        return fallback();
      }
    },

    // ----- profile and consent -----
    async getDoc() {
      await this.init();
      if (this.cache.doc) return this.cache.doc;
      const d = await this.safe(async () => snapData(await this.root.get()), () => this.local().doc);
      this.cache.doc = d || null;
      return this.cache.doc;
    },
    async writeDoc(doc) {
      doc.updated = Date.now();
      await this.safe(() => this.root.set(doc), () => { const l = this.local(); l.doc = doc; this.saveLocal(l); });
      this.cache.doc = doc; this.changed();
      return doc;
    },
    async saveProfile(profile) {
      const prev = (await this.getDoc()) || {};
      if (!this.hasConsent()) throw { code: "no_consent" };
      return this.writeDoc({ ...prev, profile });
    },

    // Consent, per purpose, with a short history so each change can be shown later.
    //   store:     keep the profile and meal log (needed for the log)
    //   assistant: the AI assistant may read a summary of them when asked (optional)
    CONSENT_VERSION,
    hasConsent() { const c = this.cache.doc && this.cache.doc.consent; return !!(c && c.purposes && c.purposes.store && c.version === CONSENT_VERSION); },
    hasAssistantConsent() { return this.hasConsent() && !!this.cache.doc.consent.purposes.assistant; },
    async giveConsent(o) {
      const prev = (await this.getDoc()) || {};
      const hist = ((prev.consent && prev.consent.history) || []).slice(-20);
      hist.push({ at: Date.now(), action: "agreed", version: CONSENT_VERSION, store: true, assistant: !!o.assistant });
      const consent = { version: CONSENT_VERSION, at: Date.now(), adult: true, purposes: { store: true, assistant: !!o.assistant }, history: hist };
      return this.writeDoc({ ...prev, consent });
    },
    async setAssistantConsent(on) {
      const doc = await this.getDoc(); if (!this.hasConsent()) throw { code: "no_consent" };
      const c = doc.consent;
      c.purposes.assistant = !!on;
      c.history = (c.history || []).slice(-20).concat([{ at: Date.now(), action: on ? "assistant on" : "assistant withdrawn" }]);
      return this.writeDoc({ ...doc, consent: c });
    },

    // Everything the app holds about this person, for the right to access.
    async exportAll() {
      const doc = await this.getDoc(), meals = await this.meals();
      return {
        exported_at: new Date().toISOString(), app: "ThaliHeal prototype", storage: this.mode === "db" ? "your private area of the app database" : "this browser",
        consent: doc ? doc.consent || null : null, profile: doc ? doc.profile || null : null, meals,
        not_stored: ["assistant questions and answers", "plate photos from normal scans", "your name"],
      };
    },

    // ----- meals -----
    // Loads the last 120 days once, then keeps the list in memory.
    async meals() {
      await this.init();
      if (this.cache.meals) return this.cache.meals;
      const from = App.addDays(App.today(), -120);
      const list = await this.safe(async () => {
        const col = this.root.collection("meals");
        let snap;
        try { snap = await col.where("date", ">=", from).get(); } catch (e) { snap = await col.get(); }
        return snap.docs.map((d) => d.data());
      }, () => this.local().meals.slice());
      this.cache.meals = list.filter((m) => m && m.date >= from).sort((a, b) => (a.date + a.created < b.date + b.created ? -1 : 1));
      return this.cache.meals;
    },
    async saveMeal(m) {
      const list = await this.meals();
      await this.safe(() => this.root.collection("meals").doc(m.id).set(m), () => { const l = this.local(); l.meals.push(m); this.saveLocal(l); });
      list.push(m); this.changed();
    },
    async deleteMeal(id) {
      const list = await this.meals();
      await this.safe(() => this.root.collection("meals").doc(id).delete(), () => { const l = this.local(); l.meals = l.meals.filter((x) => x.id !== id); this.saveLocal(l); });
      this.cache.meals = list.filter((x) => x.id !== id); this.changed();
    },

    // Delete profile, consent and every meal, everywhere this app kept them.
    // With includeTest, test mode photos and results go too.
    async deleteAll(o) {
      await this.init();
      if (o && o.includeTest && App.TestData) await App.TestData.deleteAll();
      if (this.mode === "db") {
        try {
          const snap = await this.root.collection("meals").get();
          for (const d of snap.docs) await this.root.collection("meals").doc(d.data().id || d.id).delete();
          await this.root.delete();
        } catch (e) { throw { code: (e && e.code) || "delete_failed" }; }
      }
      try { localStorage.removeItem(LOCAL_KEY); } catch (e) {}
      this.cache = { doc: null, meals: [] }; this.changed();
    },

    // One line for the screen: who is signed in and where data lives.
    whereText() {
      if (this.mode === "db") return `Signed in with your Claude account${this.name ? " as " + this.name : ""}. Your profile and meal log are stored in your private area of this app: only you can read them.`;
      if (App.hosting === "web") return "Your profile and meal log are kept in this browser on this device only. Clearing your browser data deletes them.";
      return "Not signed in. Your profile and meal log are kept in this browser only. Open this page in Claude while signed in to keep them with your account.";
    },
  };
  App.Account = A;
})();
