/* privacy.js: the consent screen (#consent) and privacy controls (#privacy).

   Built for the DPDP Act 2023 and DPDP Rules 2025: a notice that stands on its own, in plain
   language, with an itemised list of the data, the purpose of each use, and how to withdraw
   consent, use your rights and complain to the Data Protection Board. Consent is asked per
   purpose; the AI assistant is a separate, optional purpose. 18 and over only.
   Prototype: the grievance contact must be filled in before launch. */
(function () {
  "use strict";
  const { $, esc } = App;
  const GRIEVANCE = "[grievance contact to be added before launch]";

  const WEB = App.hosting === "web";
  const NOTICE = `
    <div class="card notice-text">
      <h2>What ThaliHeal is</h2>
      <p>A tool to log Indian meals and compare them with ICMR NIN 2020 targets for healthy adults. It is not a medical service: it does not diagnose, treat or replace a doctor or dietitian. It is for adults 18 and over.</p>

      <h2>What we collect</h2>
      <ul>
        <li><b>Profile:</b> age, sex, height, weight, waist (optional), activity, goal, diet type, and for women a life stage (pregnant, breastfeeding, after menopause).</li>
        <li><b>Meal log:</b> date, meal, dishes, portions, oil or ghee, and the nutrient totals worked out by the app.</li>
        <li><b>Plate photos:</b> sent to ${WEB ? App.providerName() + " through ThaliHeal's server" : "Claude"} to name the dishes and estimate portions. Not stored by the app${WEB ? " or its server" : ""} (test mode photos you add yourself are kept until you delete them).</li>
        <li><b>Zeno:</b> If you agree to use Zeno AI, text messages, recent chat and relevant details Zeno looks up can go to Groq. Sample text can also use Google Gemini. When you start a call, microphone audio, recent chat and relevant details Zeno looks up can go to Google Gemini. Conversation summaries you choose to save stay in this browser and can provide context when you resume. You can change AI consent in Privacy.</li>
        <li><b>Assistant questions:</b> sent to ${WEB ? App.providerName() + " through ThaliHeal's server" : "Claude"} with a summary of your profile and log, only if you turn the assistant on. Not saved by the app${WEB ? " or its server" : ""}.</li>
        ${WEB ? `<li><b>A one way code made from your IP address</b>, kept for up to a day, to limit how many AI requests one person can make. Your IP address itself is not stored.</li>`
              : `<li><b>Your Claude account ID</b>, to keep your data private to you. Your name is shown on screen, never stored.</li>`}
      </ul>

      <h2>Why, and what it enables</h2>
      <ul>
        <li><b>A. Your log (needed to use the log):</b> store your profile and meals to work out your daily targets, trends and gaps.</li>
        <li><b>B. The AI assistant (optional):</b> when you ask a question, send a summary of your profile and log to ${WEB ? App.providerName() + ", through ThaliHeal's server," : "Claude"} so it can answer from your own data.</li>
      </ul>
      <p>ThaliHeal does not sell your data, show ads, or use it for marketing.</p>

      <h2>Where it is kept</h2>
      ${WEB ? `<p>In this browser on this device only. The server never stores your profile or log; it only passes an assistant question on when you ask one. Clearing your browser data, or Delete my data, removes everything.</p>`
            : `<p>In your private area of the app database, tied to your Claude account. Only you can read it, not even the app owner. It stays until you delete it. If you use the app outside Claude, it stays in that browser only.</p>`}

      <h2>Your rights</h2>
      <ul>
        <li><b>See and download</b> everything the app holds about you (Privacy, Download my data).</li>
        <li><b>Correct</b> your profile any time, and delete single meals in My log.</li>
        <li><b>Withdraw consent</b> in Privacy by turning off the assistant or Zeno AI, or by deleting your data.</li>
        <li><b>Erase</b> your profile, consent record and log in one step.</li>
        <li><b>Complain:</b> contact ${esc(GRIEVANCE)}. If that does not resolve it, you can complain to the Data Protection Board of India.</li>
      </ul>
      <p class="small muted">Notice version ${esc(App.Account.CONSENT_VERSION)}.</p>
    </div>`;

  // ===================================================== CONSENT =====================================================
  App.views.consent = {
    async show() {
      const box = $("consentPage");
      await App.Account.getDoc();
      const done = App.Account.hasConsent();
      const c = done ? App.Account.cache.doc.consent : null;
      box.innerHTML = NOTICE + (done ? `
        <div class="card" style="display:grid;gap:8px">
          <b>You agreed on ${esc(new Date(c.at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }))}.</b>
          <span class="small muted">Assistant: ${c.purposes.assistant ? "on" : "off"}. Change this, download or delete your data in Privacy.</span>
          <a class="btn" href="#privacy">Open privacy controls</a>
        </div>` : `
        <div class="card form" id="cForm">
          <label class="consent"><input type="checkbox" id="cAdult"><span>I am 18 or older.</span></label>
          <label class="consent"><input type="checkbox" id="cStore"><span><b>A.</b> I agree that ThaliHeal stores my profile and meal log to work out my targets, trends and gaps.</span></label>
          <label class="consent"><input type="checkbox" id="cAssist"><span><b>B. Optional.</b> I agree that, when I ask the assistant a question, a summary of my profile and log is sent to ${WEB ? App.providerName() : "Claude"} to answer it.</span></label>
          <button class="btn btn-primary" id="cAgree" disabled>Agree and continue</button>
          <a class="btn btn-ghost" href="#home">Not now</a>
          <div class="status" id="cStatus" role="status" aria-live="polite"></div>
        </div>`);
      if (done) return;
      const paint = () => { $("cAgree").disabled = !($("cAdult").checked && $("cStore").checked); };
      ["cAdult", "cStore", "cAssist"].forEach((id) => $(id).addEventListener("change", paint));
      $("cAgree").onclick = async () => {
        $("cAgree").disabled = true;
        try {
          await App.Account.giveConsent({ assistant: $("cAssist").checked });
          const next = App.afterConsent || "profile"; App.afterConsent = null;
          location.hash = "#" + next;
        } catch (e) { $("cStatus").textContent = "Could not save your choice. Try again."; $("cStatus").classList.add("err"); paint(); }
      };
    },
  };
  // Send someone to the consent screen, then back to where they were going.
  App.needConsent = (next) => { App.afterConsent = next; location.hash = "#consent"; };

  // ===================================================== PRIVACY CONTROLS =====================================================
  async function download() {
    const st = $("dlStatus");
    st.textContent = "Preparing…";
    const data = JSON.stringify(await App.Account.exportAll(), null, 1);
    const name = `thaliheal-my-data-${App.today()}.json`;
    const res = await App.saveFile(name, data, "application/json");
    if (res) { App.saveNote(st, res); return; }
    st.textContent = "Copy your data from the box below.";
    $("dlBox").hidden = false; $("dlBox").value = data;
  }

  App.views.privacy = {
    async show() {
      const box = $("privacyPage");
      await App.Account.getDoc();
      const ok = App.Account.hasConsent(), c = ok ? App.Account.cache.doc.consent : null;
      box.innerHTML = `
        <div class="card small muted">${esc(App.Account.whereText())}</div>
        <div class="card" style="display:grid;gap:10px">
          <b>Your consent</b>
          ${ok ? `<span class="small">Log (purpose A): agreed on ${esc(new Date(c.at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }))}.</span>
          <div class="switch-row ai-only"><div><b>AI assistant (purpose B)</b><div class="small muted">Sends a summary of your profile and log to ${App.providerName()} when you ask a question. Turning it off withdraws this consent.</div></div>
            <button class="switch accent" id="asSwitch" role="switch" aria-checked="${c.purposes.assistant}" aria-label="AI assistant"></button></div>`
          : `<span class="small">You have not agreed to anything yet. <a href="#consent">Read the notice</a>.</span>`}
          <div class="switch-row"><div><b>Zeno AI</b><div class="small muted">Allow AI chat and calls with Zeno.</div></div>
            <button class="switch accent" id="zenoAiSwitch" role="switch" aria-checked="${App.views.zeno.hasAiConsent()}" aria-label="Zeno AI"></button></div>
          <a class="small" href="#consent">Read the full notice</a>
        </div>
        <div class="card" style="display:grid;gap:8px">
          <b>See and download your data</b>
          <span class="small muted">Everything (profile, consent record and every logged meal) as a JSON file, or your meal log as a CSV for Excel or Google Sheets.</span>
          <div class="row" style="gap:8px"><button class="btn btn-small" id="dlBtn">Download my data (JSON)</button><button class="btn btn-small" id="dlCsv">Download my log (CSV)</button></div>
          <div class="status" id="dlStatus" role="status" aria-live="polite"></div>
          <textarea class="csv" id="dlBox" hidden readonly aria-label="Your data"></textarea>
        </div>
        <div class="card" style="display:grid;gap:8px">
          <b>Correct your data</b>
          <span class="small muted">Edit your profile any time. Delete single meals from My log.</span>
          <div class="row"><a class="btn btn-small" href="#profile">Edit profile</a><a class="btn btn-small" href="#track">My log</a></div>
        </div>
        <div class="card" style="display:grid;gap:8px">
          <b>Delete my data</b>
          <span class="small muted">Removes your profile, consent record and every logged meal from the app right away. This withdraws all consent.</span>
          <label class="consent"><input type="checkbox" id="delTest"><span>Also delete my test mode photos and results.</span></label>
          <button class="btn btn-small danger" id="delBtn" style="justify-self:start">Delete my data</button>
          <div class="status" id="delStatus" role="status" aria-live="polite"></div>
        </div>
        <div class="card small"><b>Questions or complaints:</b> ${esc(GRIEVANCE)}. If that does not resolve it, you can complain to the Data Protection Board of India.</div>`;

      if (ok) $("asSwitch").onclick = async () => {
        const b = $("asSwitch"), on = b.getAttribute("aria-checked") !== "true";
        b.disabled = true;
        try { await App.Account.setAssistantConsent(on); b.setAttribute("aria-checked", String(on)); if (!on && App.Assistant) App.Assistant.reset(); }
        finally { b.disabled = false; }
      };
      $("zenoAiSwitch").onclick = () => {
        if (App.views.zeno.hasAiConsent()) {
          App.views.zeno.setAiConsent(false);
          $("zenoAiSwitch").setAttribute("aria-checked", "false");
        } else {
          App.views.zeno.setAiConsent(null);
          location.hash = "#zeno";
        }
      };
      $("dlBtn").onclick = download;
      $("dlCsv").onclick = () => App.Tracker.exportCSV($("dlStatus"));
      $("delBtn").onclick = async () => {
        const b = $("delBtn"), st = $("delStatus");
        if (b.dataset.armed !== "1") {
          b.dataset.armed = "1"; b.textContent = "Tap again to delete everything"; st.textContent = "This cannot be undone.";
          setTimeout(() => { if (b.isConnected && b.dataset.armed === "1") { b.dataset.armed = ""; b.textContent = "Delete my data"; st.textContent = ""; } }, 6000);
          return;
        }
        b.dataset.armed = ""; b.disabled = true; st.textContent = "Deleting…";
        try {
          await App.Account.deleteAll({ includeTest: $("delTest").checked });
          if (App.Assistant) App.Assistant.reset();
          await App.views.privacy.show();   // redraw without consent
          $("delStatus").textContent = "Deleted. Your profile, consent record and log are gone.";
        } catch (e) { st.textContent = "Could not delete everything. Try again."; b.disabled = false; }
      };
    },
  };
})();
