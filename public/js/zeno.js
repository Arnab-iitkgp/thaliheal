/* Zeno's on-device text chat and editable meal drafts. */
(function () {
  "use strict";

  const $ = App.$;
  const stage = $("zenoStage");
  const thread = $("zenoConversation");
  const input = $("zenoInput");
  const composer = $("zenoComposer");
  const usuals = $("zenoUsuals");
  const voicePanel = $("zenoVoicePanel");
  const voiceStatus = $("zenoVoiceStatus");
  const voiceStart = $("zenoVoiceStart");
  const personalStart = $("zenoPersonalStart");
  const consentDialog = $("zenoConsent");
  const clearDialog = $("zenoClearDialog");
  const voiceMute = $("zenoVoiceMute");
  const voiceChoice = $("zenoVoiceChoice");
  const workspaceSelect = $("zenoWorkspace");
  const voiceEnd = $("zenoVoiceEnd");
  const call = $("zenoCall");
  const portrait = $("zenoCallPortrait");
  const captionLine = $("zenoCallCaption");
  const captionsButton = $("zenoCallCaptions");
  const reviewOpen = $("zenoCallReviewOpen");
  const reviewClose = $("zenoCallReviewClose");
  const preview = $("zenoVoicePreviewAudio");
  const previewButton = $("zenoVoicePreview");
  const previews = { Zubenelgenubi: "/audio/zeno-zuben.mp3", Aoede: "/audio/zeno-aoede.mp3" };
  const aiConsentKey = "thali.zenoAiConsent.v1";
  const summaryKey = "thali.zenoSummaries.v1";
  const sampleMemoryKey = "thali.zenoSampleMemory.v1";
  const optionsMenu = $("zenoOptions");
  const conversations = $("zenoConversations");
  const guide = $("zenoGuide");
  const memoryDialog = $("zenoMemories");
  const memoryEditor = $("zenoMemoryEditor");
  const amounts = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, half: 0.5 };
  let draft = null;
  let busy = false;
  let motionTimer;
  let reactionTimer;
  let voiceSession = null;
  let pendingMeal;
  let voiceMuted = false;
  let captionsOn = false;
  let callHadInput = false;
  let callDraftChanged = false;
  let reviewCard, reviewMarker, activeReview;
  let voiceAvailability;
  let agentAvailability;
  let agentStatusRequest;
  let aiConsent = App.store.get(aiConsentKey, null);
  let agentController;
  let agentHistory = [];
  let conversationSummary = {};
  let savedConversationId = null;
  let editingMemory;
  let checkInVisit;
  let workspace = "personal";
  let sampleData;
  const workspaces = {};

  function activeData() { return workspace === "demo" ? sampleData : App.Account; }
  function memoryDoc() { return workspace === "demo" ? sampleData?.doc : App.Account.cache.doc; }
  function memories() { return memoryDoc()?.zenoMemories || []; }

  function sampleWorkspace() {
    return App.ZenoAgent.demoData({
      memories: App.store.get(sampleMemoryKey, []),
      saveMemories: records => localStorage.setItem(sampleMemoryKey, JSON.stringify(records)),
    });
  }

  function summaryText(value, limit) {
    return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, limit) : "";
  }

  function noteConversation(fields) {
    conversationSummary = { ...conversationSummary, ...fields };
    renderConversationControls();
  }

  function noteTopic({ topic, decisions, openQuestion }) {
    const updates = {};
    if (typeof topic === "string") updates.topic = summaryText(topic, 72);
    if (Array.isArray(decisions)) updates.decisions = decisions.slice(0, 3).map(value => summaryText(value, 105)).filter(Boolean);
    if (typeof openQuestion === "string") updates.openQuestion = summaryText(openQuestion, 125);
    if (Object.values(updates).flat().some(value => App.Safety.classify(value).kind !== "ok")) return false;
    noteConversation(updates);
    return true;
  }

  function savedSummaries() {
    return App.store.get(summaryKey, {})?.[workspace] || [];
  }

  function writeSummaries(entries) {
    const all = App.store.get(summaryKey, {}) || {};
    localStorage.setItem(summaryKey, JSON.stringify({ ...all, [workspace]: entries }));
    renderConversationControls();
  }

  function renderConversationControls() {
    $("zenoResume").hidden = !savedSummaries().length;
    const canSave = Boolean(conversationSummary.topic || draft || agentHistory.length);
    $("zenoSaveSummary").hidden = !canSave;
    $("zenoSaveSummary").textContent = savedConversationId ? "Update summary" : "Save summary";
  }

  function saveSummary() {
    const summary = summaryForSaving();
    const entries = savedSummaries();
    const id = savedConversationId || crypto.randomUUID();
    if (!entries.some(entry => entry.id === id) && entries.length >= 6) throw Error("Remove a saved summary before adding another.");
    writeSummaries([{ id, ...summary }, ...entries.filter(entry => entry.id !== id)]);
    savedConversationId = id;
    renderConversationControls();
  }

  function summaryForSaving() {
    const topic = conversationSummary.topic || (draft ? "Meal draft" : agentHistory.length ? "Food chat · " + App.fmtDate(App.today()) : "");
    return { ...conversationSummary, topic };
  }

  function describeSummary(container, summary) {
    const detail = value => {
      const line = document.createElement("p");
      line.className = "small";
      line.textContent = value;
      container.append(line);
    };
    if (summary.decisions?.length) detail(summary.decisions.join(" · "));
    if (summary.openQuestion) detail(summary.openQuestion);
    if (summary.review) detail(`Meal review · ${reviewDate(summary.review.from)} – ${reviewDate(summary.review.to)}`);
    if (summary.meals?.length) detail(summary.meals.map(meal => `${App.SLOTS[meal.slot]} · ${reviewDate(meal.date)}`).join(", "));
  }

  function showConversations(mode) {
    if (busy || voiceSession || conversations.open) return;
    const body = $("zenoConversationsBody"), status = $("zenoConversationsStatus");
    const explain = message => { status.textContent = message; };
    body.replaceChildren();
    explain("");
    const actions = document.createElement("div");
    actions.className = "zeno-actions";
    if (mode === "resume") {
      $("zenoConversationsTitle").textContent = "Resume a conversation";
      if (conversationSummary.topic || draft || agentHistory.length) {
        const warning = document.createElement("p");
        warning.textContent = "Resuming a topic replaces the current chat and any open draft.";
        body.append(warning);
      }
      savedSummaries().forEach(entry => {
        const card = document.createElement("section"), title = document.createElement("strong");
        card.className = "card";
        title.textContent = entry.topic;
        card.append(title);
        describeSummary(card, entry);
        const buttons = document.createElement("div");
        buttons.className = "zeno-actions";
        buttons.append(actionButton("Resume", () => {
          if (busy) return;
          clearCurrentChat();
          const { id, ...summary } = entry;
          savedConversationId = id;
          noteConversation(summary);
          reply(`Picking up “${summary.topic}”. ${summary.openQuestion || "Where would you like to go from here?"}`);
          conversations.close();
        }), actionButton("Remove summary", () => {
          try {
            writeSummaries(savedSummaries().filter(item => item.id !== entry.id));
            if (savedConversationId === entry.id) savedConversationId = null;
            card.remove();
            renderConversationControls();
            if (!savedSummaries().length) explain("No saved summaries.");
          } catch { explain("Couldn’t remove the summary. Try again."); }
        }));
        card.append(buttons);
        body.append(card);
      });
    } else {
      const starting = mode === "new";
      $("zenoConversationsTitle").textContent = starting ? "Start a new conversation" : "Save this summary";
      const intro = document.createElement("p");
      intro.textContent = starting ? "Starting fresh clears this chat and any open draft." : "Keep these notes in this browser so you can pick up the topic later.";
      body.append(intro);
      const summary = summaryForSaving();
      if (summary.topic) {
        const topic = document.createElement("strong");
        topic.textContent = summary.topic;
        body.append(topic);
        describeSummary(body, summary);
        actions.append(actionButton(starting ? "Save summary and start" : "Save summary", () => {
          try {
            saveSummary();
            if (starting) clearCurrentChat();
            else $("zenoClearStatus").textContent = "Summary saved in this browser.";
            conversations.close();
          } catch (error) { explain(error.message || "Couldn’t save the summary."); }
        }));
      }
      if (starting) actions.append(actionButton("Start fresh", () => { clearCurrentChat(); conversations.close(); }));
      body.append(actions);
    }
    conversations.showModal();
  }

  $("zenoNewConversation").onclick = () => showConversations("new");
  $("zenoResume").onclick = () => showConversations("resume");
  $("zenoSaveSummary").onclick = () => showConversations("save");
  $("zenoConversationsClose").onclick = () => conversations.close();
  $("zenoShowGuide").onclick = () => guide.showModal();
  $("zenoShowMemories").onclick = () => { if (!memoryDialog.open) memoryDialog.showModal(); };
  $("zenoMemoriesClose").onclick = () => memoryDialog.close();

  function closeOptionsAndFocus() {
    optionsMenu.open = false;
    optionsMenu.querySelector("summary").focus({ preventScroll: true });
  }

  optionsMenu.addEventListener("click", event => {
    if (event.target.closest("button, a")) closeOptionsAndFocus();
  }, true);
  optionsMenu.addEventListener("keydown", event => {
    if (event.key !== "Escape" || !optionsMenu.open) return;
    event.preventDefault();
    closeOptionsAndFocus();
  });
  window.addEventListener("click", event => {
    if (optionsMenu.open && !optionsMenu.contains(event.target)) optionsMenu.open = false;
  });

  function rememberLine(role, content) {
    if (content) {
      agentHistory = [...agentHistory, { role, content: content.slice(0, 900) }].slice(-8);
      renderConversationControls();
    }
  }

  function firstUserIndex() {
    const index = agentHistory.findIndex(message => message.role === "user");
    return index < 0 ? agentHistory.length : index;
  }

  function pose(state) {
    clearTimeout(motionTimer);
    stage.dataset.state = state;
    if (state !== "rest") motionTimer = setTimeout(() => pose("rest"), 1100);
  }

  function append(speaker, text) {
    const bubble = document.createElement("li");
    bubble.className = speaker === "You" ? "zeno-user" : "zeno-reply";
    const label = document.createElement("span");
    label.className = "sr-only";
    label.textContent = speaker + ": ";
    bubble.append(label, text);
    thread.append(bubble);
    return bubble;
  }

  function reply(text, state = "handoff") {
    append("Zeno", text);
    pose(state);
  }

  function sameWord(a, b) {
    const singular = word => App.norm(word).replace(/s$/, "");
    return singular(a) === singular(b);
  }

  function portion(raw) {
    const text = raw.trim();
    const match = text.match(/^(\d+(?:\.\d+)?|one|two|three|four|five|six|half|an?)\s+(.+)$/i);
    const count = match ? amounts[match[1].toLowerCase()] ?? Number(match[1]) : 1;
    const units = match?.[2].match(/^(katoris?|bowls?|cups?|grams?|g)\s+(?:of\s+)?(.+)$/i);
    const name = units?.[2] || match?.[2] || text;
    const fits = App.dishes.filter(d => [d.name, ...(d.aliases || [])].some(alias => sameWord(alias, name)));
    const dish = fits.length === 1 ? fits[0] : fits.length === 0 && sameWord(name, "rice") ? App.byId.plain_rice : null;
    if (!dish || count <= 0 || !Number.isFinite(count)) return null;
    const measure = units?.[1].toLowerCase().replace(/s$/, "");
    const gramsUnit = measure === "g" || measure === "gram";
    const unitIdx = measure && !gramsUnit ? dish.units.findIndex(u => sameWord(u.name, measure === "bowl" ? "katori" : measure)) : 0;
    if (unitIdx < 0) return null;
    const grams = gramsUnit ? count : count * dish.units[unitIdx].g;
    if (grams < 1 || grams > 3000) return null;
    const item = App.newItem(dish.id, grams, { origin: "manual", unit: dish.units[unitIdx].name });
    return { item, explicit: !!match };
  }

  function fromHistory(meal) {
    return meal.items.map(saved => {
      const item = App.newItem(saved.dishId, saved.grams, { origin: "manual", ctx: meal.ctx, label: saved.label });
      item.oil = { ...item.oil, on: saved.oil_g > 0, type: saved.oil_type || item.oil.type, g: saved.oil_g || 0, manual: true };
      return item;
    });
  }

  function getUsuals() {
    return memoryDoc()?.zenoUsuals || [];
  }

  function storedItem(item) {
    return { ...item, oil: { ...item.oil } };
  }

  function openDraft(items, slot, text, preview = false) {
    if (!conversationSummary.topic) noteConversation({ topic: "Meal draft" });
    if (draft) closeReviewCard(draft.card);
    if (text) reply(text);
    const card = document.createElement("li");
    card.className = "zeno-card zeno-draft";
    thread.append(card);
    draft = { card, items, slot: slot || App.slotNow(), id: null, dirty: true, name: "", preview };
    renderDraft();
    if (agentController) card.inert = true;
  }

  function feedback(text) {
    draft.card.querySelector(".zeno-feedback").textContent = text;
  }

  function portionsValid() {
    return [...draft.card.querySelectorAll("[data-grams]")].every(field => field.value && field.reportValidity());
  }

  function renderDraft() {
    const { card, items, slot, dirty, name, preview } = draft;
    const esc = App.esc;
    const totals = App.mealTotals(items);
    const numbersHidden = App.store.get("thali.hideNumbers", false);
    card.innerHTML = `<h2>${preview ? "Sample lunch" : "Meal draft"}</h2>
      ${preview ? '<p class="small muted">Fictional plate for voice practice.</p>' : ""}
      <label class="zeno-setting">Meal <select data-slot>${Object.entries(App.SLOTS).map(([key, label]) =>
        `<option value="${esc(key)}" ${key === slot ? "selected" : ""}>${esc(label)}</option>`).join("")}</select></label>
      ${items.map((item, i) => `<div class="zeno-dish">
        <label for="zenoGrams${i}">${esc(App.byId[item.dishId]?.name || item.label)} <small data-portion="${i}">${portionLabel(item)}</small></label>
        <input id="zenoGrams${i}" type="number" min="1" max="3000" step="any" value="${Number(item.grams.toFixed(2))}" data-grams="${i}">
        <button class="icon-btn" type="button" data-remove="${i}" aria-label="Remove ${esc(item.label)}">×</button>
      </div>`).join("")}
      <p class="small muted zeno-totals">${numbersHidden ? "" : `Estimated ${Math.round(totals.kcal)} kcal · `}${App.r1(totals.protein)} g protein</p>
      <div class="zeno-actions">
        <button class="btn btn-primary" type="button" data-save ${!dirty || !items.length ? "disabled" : ""}>${!dirty ? preview ? "Saved to Sample Log" : "Saved to My Log" : preview ? "Save to Sample Log" : draft.id ? "Update My Log" : "Save to My Log"}</button>
        <button class="btn" type="button" data-name ${preview ? "hidden" : ""} ${!items.length ? "disabled" : ""}>Remember as a usual</button>
      </div>
      <form class="zeno-composer zeno-memory-form" hidden>
        <label class="sr-only" for="zenoUsualName">Name this usual</label>
        <input id="zenoUsualName" maxlength="64" required placeholder="e.g. mess lunch" value="${esc(name)}">
        <button class="btn" type="submit">Remember</button>
      </form>
      <p class="zeno-feedback small" role="status"></p>`;

    card.querySelector("[data-slot]").onchange = event => {
      draft.slot = event.target.value;
      touchDraft();
    };
    card.querySelectorAll("[data-grams]").forEach(field => {
      field.addEventListener("change", () => {
        if (!field.reportValidity() || !field.value) return;
        const item = items[Number(field.dataset.grams)];
        item.grams = Number(field.value);
        App.resetOil(item);
        touchDraft();
      });
    });
    card.querySelectorAll("[data-remove]").forEach(button => {
      button.onclick = () => {
        items.splice(Number(button.dataset.remove), 1);
        draft.dirty = true;
        renderDraft();
      };
    });
    card.querySelector("[data-save]").onclick = () => {
      if (!busy && !(pendingMeal?.kind === "draft" && validMealProposal(pendingMeal))) requestSave(false);
    };
    card.querySelector("[data-name]").onclick = () => showMemoryForm(draft.name);
    card.querySelector(".zeno-memory-form").onsubmit = event => {
      event.preventDefault();
      const nameInput = $("zenoUsualName");
      transact(() => remember(nameInput.value.trim()), card);
    };
  }

  function touchDraft() {
    draft.dirty = true;
    draft.card.querySelectorAll("[data-portion]").forEach(label => {
      label.textContent = portionLabel(draft.items[Number(label.dataset.portion)]);
    });
    const totals = App.mealTotals(draft.items);
    const energy = App.store.get("thali.hideNumbers", false) ? "" : `Estimated ${Math.round(totals.kcal)} kcal · `;
    draft.card.querySelector(".zeno-totals").textContent = `${energy}${App.r1(totals.protein)} g protein`;
    const button = draft.card.querySelector("[data-save]");
    button.disabled = !draft.items.length;
    button.textContent = draft.preview ? "Save to Sample Log" : draft.id ? "Update My Log" : "Save to My Log";
    feedback("");
  }

  function portionLabel(item) {
    const unit = App.byId[item.dishId]?.units[item.unitIdx];
    return unit ? `${App.fmtCount(item.grams / unit.g)} ${App.esc(unit.name)} · edit grams` : "Grams";
  }

  function loadAgentAvailability() {
    if (agentAvailability) return Promise.resolve();
    agentStatusRequest ||= App.ZenoAgent.status().then(availability => {
      agentAvailability = availability;
      renderAiControls();
    }).catch(() => {}).finally(() => { agentStatusRequest = null; });
    return agentStatusRequest;
  }

  function renderAiControls() {
    const allowed = aiConsent === true;
    if (!allowed && workspace === "demo" && !busy) {
      workspaceSelect.value = "personal";
      workspaceSelect.onchange();
    }
    voiceStart.disabled = !allowed || !voiceAvailability?.demo;
    personalStart.disabled = !allowed || !voiceAvailability?.personal;
    voiceStart.hidden = voiceStart.disabled || workspace !== "demo";
    personalStart.hidden = personalStart.disabled || workspace !== "personal";
    const sampleWorkspace = $("zenoWorkspaceLabel");
    sampleWorkspace.hidden = !allowed || !(voiceAvailability?.demo || agentAvailability?.configured);
    voicePanel.hidden = voiceStart.hidden && personalStart.hidden;
  }

  function applyAiConsent(choice) {
    aiConsent = choice;
    if (choice !== true) {
      agentController?.abort();
      if (call.open) dismissCall();
    }
    renderAiControls();
  }

  function setAiConsent(choice) {
    App.store.set(aiConsentKey, choice);
    applyAiConsent(choice);
  }

  window.addEventListener("storage", event => {
    if (event.key === summaryKey || event.key === null) renderConversationControls();
    if (event.key !== aiConsentKey && event.key !== null) return;
    applyAiConsent(App.store.get(aiConsentKey, null));
    if (aiConsent !== null && consentDialog.open) consentDialog.close();
  });

  workspaceSelect.onchange = () => {
    const next = workspaceSelect.value;
    if (next === workspace) return;
    if (busy || !["personal", "demo"].includes(next) || (next === "demo" && aiConsent !== true)) {
      workspaceSelect.value = workspace;
      return;
    }
    voiceSession?.stop();
    discardMealProposal();
    workspaces[workspace] = { draft, history: agentHistory, summary: conversationSummary, summaryId: savedConversationId, input: input.value, nodes: [...thread.childNodes] };
    if (next === "demo") sampleData ||= sampleWorkspace();
    workspace = next;
    const to = workspaces[next];
    draft = to?.draft || null;
    agentHistory = to?.history || [];
    conversationSummary = to?.summary || {};
    savedConversationId = to?.summaryId || null;
    input.value = to?.input || "";
    thread.replaceChildren(...(to?.nodes || []));
    if (!to && next === "demo") append("Zeno", "There’s a week of sample meals ready. You can ask what stands out, tell me what gets in the way, or change a plate as we talk.");
    voiceStatus.textContent = "";
    renderUsuals();
    renderConversationControls();
    renderAiControls();
  };

  function voiceTools() {
    const mode = workspace;
    const ui = agentUi();
    const execute = App.ZenoAgent.toolSession({
      ...ui,
      proposeDraft: (...args) => proposeDraft(true, ...args),
      compare: (...args) => offerReview(ui.compare(...args), "Comparison ready", "Review"),
      options: (...args) => offerReview(ui.options(...args), "Meal options ready", "Review"),
      review: report => offerReview(ui.review(report), "Meal review ready", "View review"),
      requestSave: () => requestSave(true),
      confirmProfile: (...args) => confirmProfile(true, ...args),
    }, activeData());
    return async (name, args, signal) => {
      if (signal.aborted || busy || workspace !== mode || App.current !== "zeno") return { ok: false, error: "The conversation is busy or closed." };
      if (name !== "remember" && name !== "forget") {
        const before = draft;
        const result = await execute(name, args);
        if (!signal.aborted) showToolResult(name, result);
        if (!signal.aborted && name === "edit_plate" && result.ok && result.applied && draft &&
            (draft !== before || JSON.stringify(result.before.items) !== JSON.stringify(result.after.items))) {
          callDraftChanged = true;
          offerReview(draft.card, "Draft updated", "View draft");
          clearTimeout(reactionTimer);
          portrait.dataset.reacting = "";
          reactionTimer = setTimeout(() => { delete portrait.dataset.reacting; }, 700);
        }
        return result;
      }
      return confirmMemory(true, name, args, confirmedArgs => execute(name, confirmedArgs));
    };
  }

  function confirmMemory(inCall, name, args, execute) {
    const data = activeData();
    const followUp = name === "remember" && args.kind === "follow_up";
    const due = followUp ? App.ZenoAgent.followUpDate(args) : null;
    if (followUp && (!due || due < App.today())) return { ok: false, error: "Ask what date the caller wants for the check-in." };
    const confirmedArgs = followUp ? { ...args, due, due_weekday: undefined } : args;
    const date = due && App.fmtDate(due, { weekday: "long", day: "numeric", month: "short", year: "numeric" });
    const card = toolCard(name === "remember" ? "Remember this?" : "Forget this?");
    const reference = typeof args.ref === "string" ? args.ref : "";
    const target = memories().find(record => `memory:${record.id}` === reference) || getUsuals().find(usual => `usual:${usual.key}` === reference);
    const label = name === "remember" ? [args.name, args.value, args.scope].filter(value => typeof value === "string" && value.trim()).join(" · ") : target?.name || reference;
    if (label) cardLine(card, label.slice(0, 320));
    if (date) cardLine(card, date);
    const usualSnapshot = name === "remember" && args.kind === "usual" ? JSON.stringify(draft?.items) : null;
    card.append(actionButton("Confirm", () => transact(async () => {
      if (activeData() !== data) return cardLine(card, "Reopen the workspace for this memory change.");
      if (name === "remember" && args.kind === "usual" && usualSnapshot !== JSON.stringify(draft?.items)) {
        return cardLine(card, "The draft changed. Ask me to remember the updated plate.");
      }
      const result = await execute(confirmedArgs);
      if (!result.ok) return cardLine(card, result.error);
      closeReviewCard(card);
      renderUsuals();
    }, card)), actionButton("Dismiss", () => closeReviewCard(card)));
    if (inCall) offerReview(card, "Memory change to review", "Review");
    return { ok: true, pending: true, ...(due ? { due, date } : {}), message: "Tell the user to confirm the memory change in the app. It has not been saved." };
  }

  function offerReview(card, message, label) {
    reviewCard = card;
    $("zenoCallReceiptText").textContent = message;
    reviewOpen.textContent = label;
    $("zenoCallReceipt").hidden = false;
  }

  function restoreReview(focus) {
    if (!activeReview) return;
    if (activeReview.parentNode) reviewMarker.replaceWith(activeReview);
    else reviewMarker.remove();
    activeReview = reviewMarker = null;
    $("zenoCallReview").hidden = true;
    if (focus) (reviewCard?.parentNode ? reviewOpen : voiceEnd).focus();
  }

  function closeReviewCard(card) {
    if (pendingMeal?.card === card) pendingMeal = null;
    const isOpen = activeReview === card;
    if (isOpen) restoreReview(false);
    card.remove();
    if (reviewCard === card) {
      reviewCard = null;
      $("zenoCallReceipt").hidden = true;
    }
    if (isOpen) (reviewCard && !$("zenoCallReceipt").hidden ? reviewOpen : voiceEnd).focus();
  }

  function openCallReview(card, inline = false) {
    if (activeReview === card) return;
    if (!card?.parentNode) {
      $("zenoCallReceipt").hidden = true;
      return;
    }
    restoreReview(false);
    activeReview = card;
    reviewMarker = document.createElement("li");
    reviewMarker.hidden = true;
    activeReview.replaceWith(reviewMarker);
    $("zenoCallReviewContent").append(activeReview);
    const review = $("zenoCallReview");
    review.dataset.inline = String(inline);
    review.hidden = false;
    reviewClose.hidden = inline;
    if (inline) $("zenoCallReceipt").hidden = true;
    else reviewClose.focus();
  }
  reviewOpen.onclick = () => openCallReview(reviewCard);
  reviewClose.onclick = () => restoreReview(true);

  function dismissCall() {
    voiceSession?.stop();
    restoreReview(false);
    if (call.open) call.close();
    $("zenoAvatarHome").append($("zenoAvatar"));
    if (App.current === "zeno") (workspace === "demo" ? voiceStart : personalStart).focus({ preventScroll: true });
  }

  function voiceState(state, message) {
    voiceStatus.textContent = message;
    voiceStatus.dataset.state = state;
    const closed = state === "closed";
    voiceMute.disabled = state === "connecting" || closed;
    portrait.dataset.state = {
      connecting: "hello", speaking: "speak", listening: "listen", thinking: "ask", working: "working", muted: "muted",
    }[state] || "rest";
    if (closed) {
      clearTimeout(reactionTimer);
      delete portrait.dataset.reacting;
      voiceSession = null;
      restoreReview(false);
      $("zenoCallReceipt").hidden = true;
      $("zenoCallControls").hidden = true;
      $("zenoCallReturn").hidden = false;
      captionLine.hidden = true;
      $("zenoCallReturn").focus();
      if (callHadInput || callDraftChanged) {
        const activity = toolCard("Call activity");
        cardLine(activity, callDraftChanged ? "The call updated your meal draft." : "The call made no changes to your meal draft.");
        if (draft) {
          const current = draft.card;
          cardLine(activity, draft.items.map(item => App.byId[item.dishId]?.name || item.label).join(", ") || "Empty draft");
          cardLine(activity, draft.id && !draft.dirty ? draft.preview ? "Saved in Sample Log" : "Saved in My Log" : draft.preview ? "Sample draft · review before saving" : "Draft · review before saving");
          activity.append(actionButton("View draft", () => {
            if (!current.isConnected) return cardLine(activity, "That draft has been replaced.");
            current.scrollIntoView({ block: "nearest" });
          }));
        } else {
          cardLine(activity, "There is no open meal draft.");
        }
        callHadInput = callDraftChanged = false;
      }
      pose("rest");
    }
  }

  function startCall(mode) {
    if (aiConsent !== true || voiceSession || busy || !voiceAvailability?.[mode]) return;
    if (workspace !== mode) {
      workspaceSelect.value = mode;
      workspaceSelect.onchange();
    }
    preview.pause();
    callHadInput = callDraftChanged = false;
    captionsOn = voiceMuted = false;
    captionsButton.setAttribute("aria-pressed", "false");
    voiceMute.setAttribute("aria-pressed", "false");
    $("zenoMuteLabel").textContent = "Mute";
    $("zenoCallSample").hidden = workspace !== "demo";
    $("zenoCallControls").hidden = false;
    $("zenoCallReturn").hidden = true;
    $("zenoCallReceipt").hidden = true;
    reviewCard = null;
    captionLine.textContent = "";
    captionLine.hidden = true;
    portrait.append($("zenoAvatar"));
    voiceState("connecting", "Connecting…");
    call.showModal();
    voiceSession = App.ZenoLive.start({
      voice: voiceChoice.value,
      mode: workspace,
      history: () => agentHistory,
      summary: () => conversationSummary.topic ? conversationSummary : null,
      testerKey: voiceAvailability?.testerRequired ? App.store.get("thali.testerToken", "") : "",
      state: voiceState,
      mouth(level) { portrait.style.setProperty("--zeno-mouth", String(level)); },
      liveCaption(text) {
        const line = text.trim().replace(/\s+/g, " ");
        captionLine.textContent = line.length > 145 ? "…" + line.slice(-145).replace(/^\S*\s/, "") : line;
        captionLine.hidden = !captionsOn || !line;
      },
      confirmationTarget: () => pendingMeal,
      caption({ heard, said, partial, confirmationTarget }) {
        let confirmation;
        if (heard) {
          callHadInput = true;
          append("You", heard);
          rememberLine("user", heard);
          if (!partial) confirmation = confirmMealMessage(heard, confirmationTarget);
        }
        if (said) {
          const safe = App.Safety.guard(said, { ed: App.store.get("thali.hideNumbers", false) });
          append("Zeno", safe.text);
          if (!partial) rememberLine("assistant", safe.text);
        }
        return confirmation;
      },
      runTool: voiceTools(),
    });
    if (pendingMeal && validMealProposal(pendingMeal)) openCallReview(pendingMeal.card, true);
  }

  voiceStart.onclick = () => startCall("demo");
  personalStart.onclick = async () => {
    if (personalStart.disabled || busy || voiceSession) return;
    try {
      if (!(await consent()) || App.current !== "zeno") return;
      startCall("personal");
    } catch {
      $("zenoAgentStatus").textContent = "Couldn’t read your profile and meal settings.";
    }
  };
  function chooseAiConsent(choice) {
    setAiConsent(choice);
    consentDialog.close();
  }
  $("zenoConsentDecline").onclick = () => chooseAiConsent(false);
  consentDialog.addEventListener("cancel", event => {
    event.preventDefault();
    chooseAiConsent(false);
  });
  $("zenoConsentForm").addEventListener("submit", event => {
    event.preventDefault();
    chooseAiConsent(true);
  });
  voiceMute.onclick = () => {
    if (!voiceSession) return;
    voiceMuted = !voiceMuted;
    voiceSession.mute(voiceMuted);
    voiceMute.setAttribute("aria-pressed", String(voiceMuted));
    $("zenoMuteLabel").textContent = voiceMuted ? "Unmute" : "Mute";
  };
  captionsButton.onclick = () => {
    captionsOn = !captionsOn;
    captionsButton.setAttribute("aria-pressed", String(captionsOn));
    captionLine.hidden = !captionsOn || !captionLine.textContent;
  };
  voiceEnd.onclick = $("zenoCallReturn").onclick = dismissCall;
  call.addEventListener("cancel", event => { event.preventDefault(); dismissCall(); });
  window.addEventListener("pagehide", dismissCall);

  const savedVoice = App.store.get("thali.zenoVoice", "Zubenelgenubi");
  voiceChoice.value = Object.hasOwn(previews, savedVoice) ? savedVoice : "Zubenelgenubi";
  voiceChoice.onchange = () => {
    preview.pause();
    $("zenoVoicePreviewStatus").textContent = "";
    App.store.set("thali.zenoVoice", voiceChoice.value);
  };
  previewButton.onclick = async () => {
    if (!preview.paused) return preview.pause();
    $("zenoVoicePreviewStatus").textContent = "";
    preview.src = previews[voiceChoice.value];
    try { await preview.play(); }
    catch (error) { if (error.name !== "AbortError") $("zenoVoicePreviewStatus").textContent = "Couldn’t play this preview."; }
  };
  preview.onplay = () => { previewButton.textContent = "Stop preview"; };
  preview.onpause = preview.onended = () => { previewButton.textContent = "Play preview"; };
  window.addEventListener("hashchange", () => preview.pause());

  function showMemoryForm(name) {
    const form = draft.card.querySelector(".zeno-memory-form");
    form.hidden = false;
    $("zenoUsualName").value = name;
    $("zenoUsualName").focus();
  }

  async function consent() {
    await App.Account.getDoc();
    if (App.Account.hasConsent()) return true;
    App.needConsent("zeno");
    return false;
  }

  async function transact(action, card) {
    if (busy) return;
    busy = true;
    card.inert = true;
    try { await action(); }
    catch {
      if (draft?.card === card) feedback("Couldn’t save that. Your draft is still here. Try again.");
      else reply("Couldn’t update your usuals. Try again.", "ask");
    } finally {
      card.inert = false;
      busy = false;
    }
  }

  async function saveMeal() {
    if (!draft.dirty || !draft.items.length || !portionsValid()) {
      feedback("Enter a portion for each dish before saving.");
      return false;
    }
    if (!draft.preview && !await consent()) return false;
    const meal = App.mealFromItems(draft.items, { id: draft.id, date: draft.date || App.today(), slot: draft.slot, source: "manual", ctx: draft.items[0].ctx });
    draft.id = meal.id;
    draft.date = meal.date;
    await activeData().saveMeal(meal);
    draft.dirty = false;
    renderDraft();
    const title = draft.preview ? "Saved to Sample Log" : "Saved to My Log";
    feedback(title + ".");
    const saved = toolCard(title);
    cardLine(saved, App.fmtDate(meal.date) + " · " + App.SLOTS[meal.slot]);
    cardLine(saved, meal.items.map(item => item.label).join(", "));
    if (draft.preview) {
      const data = activeData();
      saved.append(actionButton("View Sample Log", () => transact(async () => {
        const execute = App.ZenoAgent.toolSession(agentUi(), data);
        const result = await execute("review_habits", { from: meal.date, to: meal.date, view: "meals" });
        if (!result.cardShown) cardLine(saved, result.error || "Couldn’t open Sample Log.");
        else if (voiceSession) offerReview(thread.lastElementChild, "Sample Log", "View meals");
        else thread.lastElementChild?.scrollIntoView({ block: "nearest" });
      }, saved)));
    } else {
      const link = document.createElement("a");
      link.className = "btn btn-small";
      link.href = "#track";
      link.textContent = "Open My Log";
      saved.append(link);
    }
    if (voiceSession) offerReview(saved, title, "View receipt");
    return true;
  }

  async function remember(name) {
    if (draft.preview) return;
    if (!App.norm(name) || !draft.items.length || !portionsValid()) {
      feedback("Enter a name and valid portions before remembering this plate.");
      return;
    }
    if (!await consent()) return;
    const key = App.norm(name);
    const other = getUsuals().filter(u => u.key !== key);
    if (other.length >= 30) {
      feedback("Remove a saved usual before adding another.");
      return;
    }
    await App.Account.saveZenoUsuals([...other, { key, name, slot: draft.slot, items: draft.items.map(storedItem) }]);
    draft.name = name;
    draft.card.querySelector(".zeno-memory-form").hidden = true;
    feedback(`Remembered “${name}”.`);
    renderUsuals();
  }

  function useUsual(usual) {
    openDraft(usual.items.map(storedItem), usual.slot, `I used your saved “${usual.name}”. Here’s today’s draft.`, workspace === "demo");
    draft.name = usual.name;
    pose("recall");
  }

  function renderUsuals() {
    usuals.replaceChildren();
    const saved = getUsuals();
    const records = memories();
    renderDueCheckIn();
    if (!saved.length && !records.length) {
      usuals.textContent = "Save a usual from a meal draft and it’ll show up here.";
      return;
    }
    saved.forEach(usual => {
      const row = document.createElement("div");
      row.className = "zeno-usual";
      row.innerHTML = `<span>${App.esc(usual.name)} <small>${usual.items.length} dish${usual.items.length === 1 ? "" : "es"}</small></span><button class="btn btn-small" type="button">Use or edit</button><button class="btn btn-small btn-ghost" type="button">Forget</button>`;
      const [use, forget] = row.querySelectorAll("button");
      use.onclick = () => {
        if (busy) return;
        useUsual(usual);
        memoryDialog.close();
        draft.card.scrollIntoView({ block: "nearest" });
      };
      forget.onclick = () => transact(async () => {
        await activeData().saveZenoUsuals(getUsuals().filter(u => u.key !== usual.key));
        renderUsuals();
        reply(`I forgot “${usual.name}”.`);
      }, row);
      usuals.append(row);
    });
    records.forEach(record => {
      const row = document.createElement("div");
      row.className = "zeno-usual";
      const note = document.createElement("span");
      note.textContent = `${record.name}: ${record.value}`;
      if (record.scope || record.due) {
        const context = document.createElement("small");
        const checkIn = record.status === "dismissed" ? "Dismissed" : record.status === "resumed" ? "Checked in" : "Follow up";
        context.textContent = [record.scope, record.due && `${checkIn} · ${reviewDate(record.due)}`].filter(Boolean).join(" · ");
        note.append(context);
      }
      row.append(note, actionButton("Edit", () => showMemoryEditor(record)), actionButton("Forget", () => transact(async () => {
        await activeData().saveZenoMemories(memories().filter(memory => memory.id !== record.id));
        renderUsuals();
      }, row)));
      usuals.append(row);
    });
  }

  async function updateMemory(record, changes, data) {
    await data.getDoc();
    if (data !== activeData() || !data.hasConsent()) throw Error("This memory is unavailable.");
    const records = memories();
    const current = records.find(item => item.id === record.id);
    if (JSON.stringify(current) !== JSON.stringify(record)) throw Error("This memory changed. Reopen it to see the latest version.");
    const key = App.ZenoAgent.memoryKey;
    if (changes.name && records.some(item => item.id !== record.id && item.kind === record.kind &&
        key(item.name) === key(changes.name) && key(item.scope) === key(changes.scope))) {
      throw Error("A memory with this name already exists in that scope.");
    }
    await data.saveZenoMemories(records.map(item => item.id === record.id ? { ...item, ...changes, savedAt: Date.now() } : item));
  }

  const memoryForm = $("zenoMemoryEditorForm");
  const memoryField = name => memoryForm.elements.namedItem(name);

  function showMemoryEditor(record, reschedule = false) {
    if (busy || voiceSession || memoryEditor.open) return;
    editingMemory = { record, data: activeData(), reschedule };
    $("zenoMemoryEditorTitle").textContent = reschedule ? "Reschedule check-in" : "Edit memory";
    $("zenoMemoryEditorStatus").textContent = "";
    $("zenoMemoryFields").hidden = reschedule;
    $("zenoMemoryDate").hidden = record.kind !== "follow_up";
    memoryField("title").value = record.name;
    memoryField("value").value = record.value;
    memoryField("scope").value = record.scope || "";
    const date = memoryField("due");
    date.required = record.kind === "follow_up";
    date.min = reschedule ? App.addDays(App.today(), 1) : "";
    date.value = reschedule ? date.min : record.due || "";
    memoryEditor.showModal();
  }

  $("zenoMemoryEditorClose").onclick = () => memoryEditor.close();
  memoryForm.addEventListener("submit", async event => {
    event.preventDefault();
    if (busy || !editingMemory) return;
    const { record, data, reschedule } = editingMemory;
    const date = memoryField("due").value;
    const name = memoryField("title").value.trim(), value = memoryField("value").value.trim(), scope = memoryField("scope").value.trim();
    const status = $("zenoMemoryEditorStatus");
    if (!App.ZenoAgent.memoryKey(name) || !value || [name, value, scope].some(text => App.Safety.classify(text).kind !== "ok")) {
      status.textContent = "Enter a name and an ordinary food preference or check-in.";
      return;
    }
    if (record.kind === "follow_up" && (!date || (reschedule && date <= App.today()) || (date !== record.due && date < App.today()))) {
      status.textContent = reschedule ? "Choose a date after today." : "Choose today or a date in the future.";
      return;
    }
    busy = memoryForm.inert = true;
    try {
      const changes = reschedule ? { due: date, status: null } : { name, value, scope };
      if (!reschedule && record.kind === "follow_up" && date !== record.due) Object.assign(changes, { due: date, status: null });
      await updateMemory(record, changes, data);
      memoryEditor.close();
      renderUsuals();
    } catch (error) { status.textContent = error.message || "Couldn’t save the memory."; }
    finally { busy = memoryForm.inert = false; }
  });

  function renderDueCheckIn() {
    const panel = $("zenoDueCheckIn");
    const today = App.today();
    const record = memories().filter(item => item.kind === "follow_up" && item.due && !item.status &&
        (item.due < today || (item.due === today && (!item.savedAt || item.savedAt < checkInVisit || App.dateStr(new Date(item.savedAt)) < today))))
      .sort((a, b) => a.due.localeCompare(b.due))[0];
    panel.replaceChildren();
    panel.hidden = !record;
    if (!record) return;
    const data = activeData();
    const title = document.createElement("strong"), detail = document.createElement("p"), buttons = document.createElement("div"), status = document.createElement("p");
    title.textContent = `Check in · ${record.name}`;
    detail.textContent = record.value;
    buttons.className = "zeno-actions";
    status.className = "small";
    status.setAttribute("role", "status");
    const handle = answer => async () => {
      if (busy || voiceSession) return;
      busy = panel.inert = true;
      try {
        if (answer === "resumed") {
          const execute = App.ZenoAgent.toolSession(agentUi(), data);
          const review = await execute("review_habits", { period: "this_week", view: "stats", compare_previous: true });
          if (!review.cardShown) throw Error(review.error || "Couldn’t open this week’s review.");
        }
        await updateMemory(record, { status: answer }, data);
        if (answer === "resumed") {
          noteConversation({ topic: record.name, decisions: [record.value], openQuestion: "How did it go?", meals: [] });
          const question = `Let’s check in on “${record.name}”. Here’s what you logged this week. How did it go?`;
          reply(question);
          rememberLine("assistant", question);
        }
        renderUsuals();
      } catch (error) { status.textContent = error.message || "Couldn’t update the check-in."; }
      finally { busy = panel.inert = false; }
    };
    buttons.append(actionButton("Check in", handle("resumed")), actionButton("Reschedule", () => showMemoryEditor(record, true)), actionButton("Dismiss", handle("dismissed")));
    panel.append(title, detail, buttons, status);
  }

  window.addEventListener("focus", () => { if (App.current === "zeno") renderDueCheckIn(); });

  function actionButton(text, run) {
    const button = document.createElement("button");
    button.className = "btn btn-small";
    button.type = "button";
    button.textContent = text;
    button.onclick = run;
    return button;
  }

  function toolCard(title, existing) {
    const card = existing || document.createElement("li");
    card.className = "zeno-tool-card zeno-draft";
    const heading = document.createElement("h2");
    heading.textContent = title;
    card.replaceChildren(heading);
    if (!existing) thread.append(card);
    return card;
  }

  function cardLine(card, text) {
    const line = document.createElement("p");
    line.textContent = text;
    card.append(line);
  }

  function draftSnapshot() {
    return draft && JSON.stringify([draft.items, draft.slot, draft.id, draft.dirty]);
  }

  function discardMealProposal() {
    if (pendingMeal) closeReviewCard(pendingMeal.card);
  }

  function validMealProposal(proposal) {
    return proposal === pendingMeal && proposal.mode === workspace && proposal.original === draft && proposal.snapshot === draftSnapshot();
  }

  async function confirmMealProposal(proposal) {
    if (!proposal || proposal !== pendingMeal || busy || App.current !== "zeno") return;
    await transact(async () => {
      if (!validMealProposal(proposal)) {
        discardMealProposal();
        reply("The draft changed. Ask me to show a fresh preview before confirming.", "ask");
        return;
      }
      // Consume this exact proposal before an asynchronous write can be retried.
      pendingMeal = null;
      closeReviewCard(proposal.card);
      if (proposal.kind === "save") {
        try { await saveMeal(); }
        catch { reply("I couldn’t save the meal. Open a new save preview to try again.", "ask"); }
      } else {
        draftFromTool(proposal.options, proposal.update);
        if (voiceSession) {
          callDraftChanged = true;
          offerReview(draft.card, "Draft updated", "View draft");
        } else reply("Added those changes to your draft.");
      }
    }, proposal.card);
  }

  function confirmMealMessage(message, proposal) {
    if (!proposal || proposal !== pendingMeal) return null;
    const command = message.trim().toLowerCase().replace(/[,.!।]+$/, "").trim()
      .replace(/^please[ ,]+|[ ,]+please$/g, "");
    if (proposal.kind === "save") return null;
    const accepted = ["add it", "add them", "apply it", "apply changes", "add to draft", "add kar do", "जोड़ दो", "ऐड कर दो"];
    return accepted.includes(command) ? confirmMealProposal(proposal) : null;
  }

  function showMealProposal(kind, card, options, update, inCall) {
    const proposal = { kind, card, options, update, mode: workspace, original: draft, snapshot: draftSnapshot() };
    pendingMeal = proposal;
    const label = kind === "save" ? "Confirm save" : "Add to draft";
    card.append(actionButton(label, () => confirmMealProposal(proposal)), actionButton("Dismiss", () => closeReviewCard(card)));
    if (inCall) openCallReview(card, true);
  }

  function proposeDraft(inCall, options, update, notes) {
    const replace = update && (pendingMeal?.kind === "draft" && validMealProposal(pendingMeal) ? pendingMeal.update : Boolean(draft));
    discardMealProposal();
    const card = toolCard("Proposed meal draft");
    cardLine(card, App.SLOTS[options.slot]);
    options.items.forEach(item => {
      const dish = App.byId[item.dishId];
      const unit = dish?.units[item.unitIdx];
      const count = unit ? `${App.fmtCount(item.grams / unit.g)} × ${unit.name} · ` : "";
      cardLine(card, `${dish?.name || item.label} · ${count}${App.r1(item.grams)} g`);
    });
    notes.forEach(note => cardLine(card, note));
    cardLine(card, "Say or type “Add it”, or choose Add to draft. You can also tell me what to change.");
    showMealProposal("draft", card, options, replace, inCall);
    const nextStep = inCall ? 'Say “Say add it and I’ll put it in your draft.” No tap is needed to apply a draft.'
      : 'Tell the user they can type “Add it” to apply the draft.';
    return { ok: true, pending: true, applied: false, message: `The draft preview is visible. ${nextStep} Nothing has been applied.` };
  }

  function requestSave(inCall) {
    const original = draft;
    if (pendingMeal?.kind === "save" && validMealProposal(pendingMeal)) {
      if (inCall) openCallReview(pendingMeal.card, true);
      return { ok: true, pending: true, message: "The save card is open. The user must tap Confirm save." };
    }
    discardMealProposal();
    const destination = original.preview ? "Sample Log" : "My Log";
    const card = toolCard("Confirm save to " + destination);
    cardLine(card, App.SLOTS[original.slot] + " · " + formatToolPlate(original.items));
    cardLine(card, "Tap Confirm save to log this meal.");
    showMealProposal("save", card, null, false, inCall);
    return { ok: true, pending: true, destination, message: "The save card is open. The user must tap Confirm save." };
  }

  function showToolResult(name, result) {
    if (name === "find_meals" && result.meals?.length) {
      noteConversation({ topic: conversationSummary.topic || "Meals from your log", meals: result.meals.slice(0, 3).map(({ date, slot, ref }) => ({ date, slot, ref })) });
    }
    if (name === "edit_plate" && result.ok && result.applied) {
      const before = new Map(result.before.items.map(item => [item.id, item]));
      const after = new Map(result.after.items.map(item => [item.id, item]));
      const changes = [];
      for (const [id, item] of before) if (!after.has(id)) changes.push("Removed " + item.name);
      for (const [id, item] of after) {
        const old = before.get(id);
        const portion = item.count ? item.count + " " + item.unit : App.r1(item.grams) + " g";
        if (!old) changes.push("Added " + item.name + " · " + portion);
        else if (old.grams !== item.grams) changes.push("Changed " + item.name + " to " + portion);
      }
      const card = toolCard(changes.length ? "Draft updated" : "Draft ready");
      changes.forEach(change => cardLine(card, change));
      result.notes.forEach(note => cardLine(card, note));
      cardLine(card, "Review the draft before saving.");
      const updated = draft?.card;
      if (updated) card.append(actionButton("View draft", () => {
        if (updated.isConnected) updated.scrollIntoView({ block: "nearest" });
      }));
    } else if (["request_save", "update_profile"].includes(name) && result.ok === false && !result.pending) {
      const title = { request_save: "Save unavailable", update_profile: "Profile change didn’t run" };
      cardLine(toolCard(title[name]), result.error);
    }
  }

  function confirmProfile(inCall, current, next, fields) {
    const data = activeData();
    const sample = workspace === "demo";
    const expected = JSON.stringify(current);
    const card = toolCard(sample ? "Confirm sample profile update" : "Confirm profile update");
    const labels = { diet: "Diet", goal: "Goal", activity: "Activity", age: "Age", sex: "Sex used for targets", height: "Height", weight: "Weight", waist: "Waist", stage: "Life stage" };
    const units = { age: " years", height: " cm", weight: " kg", waist: " cm" };
    const stages = { none: "None", pregnant: "Pregnant", breastfeeding: "Breastfeeding", postmenopause: "After menopause" };
    const display = (key, value) => {
      if (value == null || value === "") return "Unset";
      return ({
        diet: App.Targets.DIETS[value], goal: App.Targets.GOALS[value], activity: App.Targets.ACTIVITY[value]?.label,
        stage: stages[value], sex: value === "male" ? "Male" : "Female",
      })[key] || String(value) + (units[key] || "");
    };
    fields.forEach(key => cardLine(card, labels[key] + " · " + display(key, current[key]) + " → " + display(key, next[key])));
    card.append(actionButton("Confirm profile update", () => transact(async () => {
      try {
        const latest = await data.getDoc();
        if (!data.hasConsent() || activeData() !== data || JSON.stringify(latest?.profile) !== expected) {
          cardLine(card, "The profile changed since this review. Ask Zeno to prepare a new update.");
          return;
        }
        await data.saveProfile(next);
        const title = sample ? "Sample profile updated" : "Profile updated";
        const saved = toolCard(title);
        fields.forEach(key => cardLine(saved, labels[key] + " · " + display(key, next[key])));
        if (voiceSession) offerReview(saved, title, "View receipt");
        closeReviewCard(card);
      } catch {
        cardLine(card, "Couldn’t save the profile. Try confirming again.");
      }
    }, card)), actionButton("Dismiss", () => closeReviewCard(card)));
    if (inCall) offerReview(card, "Profile update needs confirmation", "Review");
    return { ok: true, pending: true, fields, message: "Ask the user to tap Confirm profile update." };
  }

  const reviewDate = date => App.fmtDate(date, { day: "numeric", month: "short", year: "numeric" });

  function mealActivityChart(summary, meals) {
    const counts = new Map();
    for (const meal of meals) counts.set(meal.date, (counts.get(meal.date) || 0) + 1);
    const scale = Math.max(1, ...counts.values());
    const chart = document.createElement("figure");
    chart.className = "zeno-week-chart";
    const heading = document.createElement("figcaption");
    heading.className = "sr-only";
    heading.textContent = "Meals logged by day";
    const bars = document.createElement("ul");
    bars.className = "zeno-week-bars";
    bars.setAttribute("role", "list");
    for (let index = 0; index < summary.daysInPeriod; index++) {
      const date = App.addDays(summary.from, index), count = counts.get(date) || 0;
      const column = document.createElement("li");
      column.dataset.empty = String(count === 0);
      const meaning = document.createElement("span");
      meaning.className = "sr-only";
      meaning.textContent = `${reviewDate(date)}, ${count} ${count === 1 ? "meal" : "meals"} logged`;
      const number = document.createElement("span"), track = document.createElement("span"), day = document.createElement("span");
      number.textContent = String(count);
      number.className = "zeno-week-bar-count";
      track.className = "zeno-week-bar-track";
      track.style.setProperty("--zeno-week-bar-height", (100 * count / scale) + "%");
      day.textContent = App.fmtDate(date, { weekday: "short" });
      day.className = "zeno-week-bar-day";
      [number, track, day].forEach(element => element.setAttribute("aria-hidden", "true"));
      column.append(meaning, number, track, day);
      bars.append(column);
    }
    chart.append(heading, bars);
    return chart;
  }

  function mealReview({ summary, meals, previous, previousMeals, view, slot }, shortcut = false) {
    noteConversation({ topic: conversationSummary.topic || "Meal review", review: { from: summary.from, to: summary.to } });
    const existing = shortcut ? thread.querySelector("[data-last-week-review]") : null;
    const expanded = new Set(Array.from(existing?.querySelectorAll("[data-period][open]") || [], details => details.dataset.period));
    const title = shortcut ? "Last week" : slot ? App.SLOTS[slot] + " review" : view === "meals" ? "Logged meals" : "Meal review";
    const card = toolCard(title, existing);
    if (shortcut) card.dataset.lastWeekReview = "";
    card.classList.add("zeno-week");
    const compact = view === "stats" && summary.daysInPeriod > 1 && summary.daysInPeriod <= 7;
    const range = ({ from, to }) => from === to ? reviewDate(from) : reviewDate(from) + " – " + reviewDate(to);
    const coverage = period => `${period.loggedDays} of ${period.daysInPeriod} days logged · ${period.loggedMeals} ${period.loggedMeals === 1 ? "meal" : "meals"}`;
    const dates = document.createElement("p");
    dates.className = "zeno-week-note";
    dates.textContent = range(summary);
    if (compact) {
      const header = document.createElement("header");
      header.className = "zeno-week-header";
      header.append(card.firstElementChild, dates);
      card.append(header);
    } else card.append(dates);
    cardLine(card, compact && !summary.loggedMeals ? "No meals logged for these dates." : coverage(summary));
    let breakdown = card;
    if (compact) {
      card.classList.add("zeno-week-compact");
      if (summary.loggedMeals) card.append(mealActivityChart(summary, meals));
      if (!summary.loggedMeals && !previous?.loggedMeals) return card;
      breakdown = document.createElement("details");
      breakdown.className = "zeno-week-breakdown";
      breakdown.dataset.period = "breakdown";
      breakdown.open = expanded.has("breakdown");
      const toggle = document.createElement("summary");
      toggle.textContent = "View weekly details";
      breakdown.append(toggle);
      card.append(breakdown);
    }
    if (previous) {
      const comparison = document.createElement("p");
      comparison.className = "zeno-week-note zeno-week-prior";
      comparison.textContent = `Previous period (${range(previous)}) · ${coverage(previous)}`;
      breakdown.append(comparison);
    }

    function mealDetails(entries, heading, period, open = false) {
      const details = document.createElement("details");
      details.dataset.period = period;
      details.open = open || expanded.has(period);
      const toggle = document.createElement("summary");
      toggle.textContent = heading;
      details.append(toggle);
      let date;
      for (const meal of entries) {
        if (meal.date !== date) {
          date = meal.date;
          const day = document.createElement("h3");
          day.textContent = reviewDate(date);
          details.append(day);
        }
        const entry = document.createElement("details");
        const header = document.createElement("summary");
        header.textContent = (App.SLOTS[meal.slot] || meal.slot) + " · " + meal.items.map(item => item.label || App.byId[item.dishId]?.name).join(", ");
        entry.append(header);
        meal.items.forEach(item => cardLine(entry, (item.label || App.byId[item.dishId]?.name) + " · " + App.r1(item.grams) + " g"));
        details.append(entry);
      }
      breakdown.append(details);
    }

    if (summary.loggedDays && view === "stats") {
      const heading = document.createElement("h3");
      heading.textContent = "Daily averages on logged days";
      breakdown.append(heading);
      const stats = document.createElement("dl");
      stats.className = "zeno-week-stats";
      const measure = { proteinGrams: "Protein", fibreGrams: "Fibre", carbsGrams: "Carbs", fatGrams: "Fat", kcal: "Energy" };
      for (const [key, value] of Object.entries(summary.averageLoggedPerLoggedDay)) {
        const item = document.createElement("div");
        const name = document.createElement("dt"), number = document.createElement("dd");
        const unit = key === "kcal" ? " kcal" : " g";
        name.textContent = measure[key];
        number.textContent = value + unit;
        item.append(name, number);
        const prior = previous?.averageLoggedPerLoggedDay?.[key];
        if (prior != null) {
          const comparison = document.createElement("dd");
          const delta = Number((value - prior).toFixed(1));
          comparison.textContent = prior + unit + " prior";
          if (delta) {
            const change = document.createElement("span");
            change.className = "zeno-week-stat-delta";
            change.textContent = (delta > 0 ? "+" : "") + delta + unit + " change";
            comparison.append(change);
          }
          item.append(comparison);
        }
        stats.append(item);
      }
      breakdown.append(stats);
      if (summary.recurringFoods.length) {
        cardLine(breakdown, "Most logged · " + summary.recurringFoods.slice(0, 3).map(food => food.name + " (" + food.loggedMeals + ")").join(" · "));
      }
      cardLine(breakdown, Object.entries(summary.loggedDaysBySlot).filter(([key, count]) => count && (!slot || key === slot))
        .map(([key, count]) => App.SLOTS[key] + " " + count + (count === 1 ? " day" : " days")).join(" · "));
    }
    if (meals.length) mealDetails(meals, "View logged meals", "current", view === "meals");
    else if (!compact) cardLine(breakdown, "No meals logged for these dates.");
    if (previousMeals.length) mealDetails(previousMeals, "View previous period’s meals", "previous");
    return card;
  }

  $("zenoLastWeek").onclick = async () => {
    if (busy || voiceSession) return;
    const button = $("zenoLastWeek");
    const status = $("zenoAgentStatus");
    status.textContent = "";
    button.disabled = busy = true;
    try {
      if (workspace === "personal" && !(await consent())) return;
      let card;
      const execute = App.ZenoAgent.toolSession({ ...agentUi(), review(report) { card = mealReview(report, true); } }, activeData());
      const result = await execute("review_habits", { period: "last_week", view: "stats", compare_previous: true });
      if (result.ok === false) status.textContent = result.error;
      card?.scrollIntoView({ block: "start" });
    } catch {
      status.textContent = "I couldn’t read the meal log. Try opening the review again.";
    } finally {
      button.disabled = busy = false;
    }
  };

  function draftFromTool(options, update) {
    if (update && draft) {
      draft.items = options.items;
      draft.slot = options.slot;
      draft.dirty = true;
      renderDraft();
      if (activeReview !== draft.card) thread.append(draft.card);
    } else openDraft(options.items, options.slot, "", workspace === "demo");
    if (options.title) feedback(`Based on ${options.title}.`);
    pose("handoff");
  }

  function formatToolPlate(items) {
    return items.length ? items.map(item => `${App.byId[item.dishId]?.name || item.label} (${App.r1(item.grams)} g)`).join(", ") : "Empty plate";
  }

  function comparison(before, options, replaceCurrent) {
    const card = toolCard("What if?");
    cardLine(card, "Current: " + formatToolPlate(before));
    cardLine(card, "Option: " + formatToolPlate(options.items));
    const a = App.mealTotals(before), b = App.mealTotals(options.items);
    const delta = (n, unit) => `${n > 0 ? "+" : ""}${App.r1(n)} ${unit}`;
    const difference = [delta(b.protein - a.protein, "g protein"), delta(b.fibre - a.fibre, "g fibre")];
    if (!App.store.get("thali.hideNumbers", false)) difference.unshift(delta(Math.round(b.kcal - a.kcal), "kcal"));
    cardLine(card, difference.join(" · "));
    const original = draft;
    const originalItems = original && JSON.stringify(original.items);
    card.append(actionButton("Use this plate", () => {
      if (busy) return;
      if (original !== draft || (original && originalItems !== JSON.stringify(draft.items))) {
        cardLine(card, "The draft changed. Ask for a fresh comparison before applying this option.");
        return;
      }
      draftFromTool(options, replaceCurrent && Boolean(draft));
      closeReviewCard(card);
    }));
    return card;
  }

  function planOptions(options) {
    const card = toolCard("Plate options");
    options.forEach((option, index) => {
      cardLine(card, `${index + 1}. ${formatToolPlate(option.items)}${option.price == null ? "" : ` · ₹${option.price}`}`);
      card.append(actionButton(`Use option ${index + 1}`, () => {
        if (!busy) {
          draftFromTool({ items: option.items.map(storedItem), slot: App.slotNow() }, false);
          if (activeReview === card) restoreReview(true);
        }
      }));
    });
    return card;
  }

  function receipt(title, undo) {
    const card = toolCard(title);
    card.append(actionButton("Undo", () => transact(async () => {
      await undo();
      card.remove();
      reply("Undone.");
      renderUsuals();
    }, card)));
    renderUsuals();
  }

  function agentUi() {
    return {
      current: () => draft,
      editBase: () => pendingMeal?.kind === "draft" && validMealProposal(pendingMeal) ? pendingMeal.options : draft,
      pendingDraft: () => pendingMeal?.kind === "draft" && validMealProposal(pendingMeal) ? pendingMeal.options : null,
      hasDraftProposal: () => pendingMeal?.kind === "draft" && validMealProposal(pendingMeal),
      proposeDraft: (...args) => proposeDraft(false, ...args),
      fromHistory,
      usuals: getUsuals,
      memories,
      noteTopic,
      confirmMemory: (name, args, execute) => confirmMemory(false, name, args, execute),
      draft: draftFromTool,
      compare: comparison,
      options: planOptions,
      review: mealReview,
      requestSave: () => requestSave(false),
      confirmProfile: (...args) => confirmProfile(false, ...args),
      toolResult: showToolResult,
      receipt,
    };
  }

  async function askAgent(message) {
    const safety = App.Safety.classify(message);
    if (safety.kind !== "ok") return reply(safety.reply || "I can help you check what you logged. A clinician can help with symptoms or a diagnosis.", "ask");
    agentController = new AbortController();
    const { signal } = agentController;
    const locked = draft?.card;
    if (locked) locked.inert = true;
    const status = $("zenoAgentStatus");
    status.textContent = "Thinking through your request";
    try {
      const result = await App.ZenoAgent.run({
        previous: agentHistory.slice(firstUserIndex()),
        summary: conversationSummary.topic ? conversationSummary : undefined,
        message,
        signal,
        status: text => { status.textContent = text; },
        tester: agentAvailability?.testerRequired ? App.store.get("thali.testerToken", "") : "",
        ui: agentUi(),
        data: activeData(),
        workspace,
      });
      if (signal.aborted) return;
      const plain = result?.replace(/\*\*([^*]+)\*\*/g, "$1");
      const safe = App.Safety.guard(plain || "I’m ready for the next step.", { ed: App.store.get("thali.hideNumbers", false) });
      reply(safe.text);
      rememberLine("user", message);
      rememberLine("assistant", safe.text);
    } finally {
      if (locked) locked.inert = false;
      if (draft?.card) draft.card.inert = false;
      status.textContent = "";
      agentController = null;
    }
  }

  async function onMessage(message) {
    const safety = App.Safety.classify(message);
    if (safety?.reply) return reply(safety.reply, "ask");

    const text = message.trim().replace(/[.!?]+$/, "");
    const rememberMatch = text.match(/^remember (?:this|that)(?: as (?:my )?(?:usual )?(.+))?$/i);
    if (rememberMatch) {
      if (!draft?.items.length || draft.preview) return reply("First tell me what’s on the plate you want me to remember.", "ask");
      showMemoryForm(rememberMatch[1] || draft.name);
      return;
    }

    const recall = text.match(/^(?:use )?(?:my |the )?usual(?:\s+(.+))?(?:$)/i);
    if (recall) {
      await App.Account.getDoc();
      const saved = getUsuals();
      const usual = recall[1] ? saved.find(u => u.key === App.norm(recall[1])) : saved.length === 1 ? saved[0] : null;
      return usual ? useUsual(usual) : reply(saved.length ? "Which usual? You can pick one under What Zeno remembers." : "Tell me what’s on your plate, then tap Remember as a usual.", "ask");
    }

    const previous = text.match(/^(?:(?:what did i (?:have|eat)(?: for)?|same)\s+)?(?:(breakfast|lunch|snack|dinner)\s+)?(?:as )?yesterday$/i) ||
      text.match(/^(?:what did i (?:have|eat)(?: for)?\s+)?yesterday(?:[’']s)?(?:\s+(breakfast|lunch|snack|dinner))?$/i);
    if (previous) {
      await App.Account.getDoc();
      if (!App.Account.hasConsent()) return reply("Read and agree to how ThaliHeal keeps your log before asking me to look it up.", "ask");
      const date = App.addDays(App.today(), -1);
      const meals = (await App.Account.meals()).filter(m => m.date === date && (!previous[1] || m.slot === previous[1].toLowerCase()));
      if (meals.length !== 1) return reply(meals.length ? "Which meal from yesterday? Try “yesterday’s lunch”." : "I couldn’t find that meal in your log for yesterday.", "ask");
      const meal = meals[0];
      openDraft(fromHistory(meal), meal.slot, "I found this in yesterday’s log. Here’s a copy for today.");
      return pose("recall");
    }

    const change = text.match(/^(?:actually[, ]+)?(add|remove|make (?:it )?)\s+(.+)$/i);
    const correction = change || text.match(/^(actually)[, ]+(.+)$/i);
    if (correction && draft?.items.length) {
      const action = correction[1].toLowerCase();
      const changeItem = portion(correction[2]);
      if (!changeItem || (!["add", "remove"].includes(action) && !changeItem.explicit)) {
        return reply("Which dish and portion? Try “actually, three rotis.”", "ask");
      }
      const idx = draft.items.findIndex(item => item.dishId === changeItem.item.dishId);
      if (action === "remove") {
        if (idx < 0) return reply("That dish isn’t on this plate.", "ask");
        if (!changeItem.explicit || draft.items[idx].grams <= changeItem.item.grams) draft.items.splice(idx, 1);
        else {
          draft.items[idx].grams -= changeItem.item.grams;
          App.resetOil(draft.items[idx]);
        }
      } else if (idx < 0) draft.items.push(changeItem.item);
      else {
        const item = draft.items[idx];
        const grams = action === "add" ? item.grams + changeItem.item.grams : changeItem.item.grams;
        if (grams > 3000) return reply("That portion is too large for one entry. Check the amount and try again.", "ask");
        item.grams = grams;
        App.resetOil(item);
      }
      draft.dirty = true;
      renderDraft();
      feedback("Draft updated. Check the portions before saving.");
      thread.append(draft.card);
      return pose("handoff");
    }

    const chunks = text.replace(/^(?:i had|i ate|log)\s+/i, "").split(/\s*,\s*(?:and\s+)?|\s+and\s+/i).map(part => part.trim()).filter(Boolean);
    const parsed = chunks.map(portion);
    const unknown = chunks.filter((_, i) => !parsed[i]);
    if (!chunks.length || unknown.length) return reply("Basic chat can make a draft from dishes you name. Try “I had one katori of rajma, rice, and two rotis.”", "ask");
    openDraft(parsed.map(p => p.item), null, parsed.every(p => p.explicit)
      ? "I put that in a draft for you. Give it a quick review."
      : "I used standard servings where you didn’t give an amount. Check the portions before saving.");
  }

  composer.addEventListener("submit", async (event) => {
    event.preventDefault();
    const message = input.value.trim();
    if (!message || busy) return;
    const confirmation = confirmMealMessage(message, pendingMeal);
    if (confirmation) {
      input.value = "";
      append("You", message);
      rememberLine("user", message);
      await confirmation;
      return;
    }
    if (voiceSession) {
      if (!voiceSession.sendText(message)) return;
      input.value = "";
      append("You", message);
      rememberLine("user", message);
      return;
    }
    busy = true;
    input.value = "";
    append("You", message).scrollIntoView({ block: "nearest" });
    pose("listen");
    try {
      if (aiConsent === true && !agentAvailability) await loadAgentAvailability();
      if (App.current !== "zeno") return;
      if (aiConsent === true && agentAvailability?.configured) await askAgent(message);
      else if (aiConsent === true && !agentAvailability) reply("I couldn’t connect to text chat. Please try again.", "ask");
      else if (workspace === "demo") reply("Sample chat is unavailable. You can still try a sample call when voice is available.", "ask");
      else {
        await onMessage(message);
        rememberLine("user", message);
      }
    } catch (error) {
      if (error?.name !== "AbortError") reply("I couldn’t finish that turn. Please try again.", "ask");
    }
    finally {
      busy = false;
      if (aiConsent !== true && workspace === "demo") renderAiControls();
      if (App.current === "zeno") thread.lastElementChild?.scrollIntoView({ block: "nearest" });
    }
  });

  function clearThread(forgetSummaries = false) {
    discardMealProposal();
    if (call.open) dismissCall();
    agentController?.abort();
    agentHistory = [];
    conversationSummary = {};
    savedConversationId = null;
    if (forgetSummaries) {
      App.store.set(summaryKey, {});
      App.store.set(sampleMemoryKey, []);
    }
    workspace = "personal";
    workspaceSelect.value = workspace;
    delete workspaces.personal;
    delete workspaces.demo;
    sampleData = null;
    draft = null;
    input.value = "";
    thread.replaceChildren();
    append("Zeno", "What’s on your mind about food today?");
    pose("rest");
    renderAiControls();
    renderConversationControls();
  }

  function clearCurrentChat() {
    discardMealProposal();
    delete workspaces[workspace];
    agentHistory = [];
    conversationSummary = {};
    savedConversationId = null;
    draft = null;
    input.value = "";
    thread.replaceChildren();
    if (workspace === "demo") append("Zeno", "Want to look at the sample meals or try making a new draft?");
    else append("Zeno", "What would you like to talk about?");
    renderUsuals();
    renderConversationControls();
  }

  $("zenoManageData").onclick = () => {
    if (busy || voiceSession || clearDialog.open) return;
    const sample = workspace === "demo";
    $("zenoClearNotice").textContent = sample
      ? "Clear the sample chat and draft, or also reset the sample profile, meals, memories and conversation summaries."
      : "Clear this chat and draft, or also delete Zeno’s saved usuals, preferences, follow-ups and conversation summaries.";
    $("zenoClearMemory").textContent = sample ? "Reset sample data" : "Clear chat and saved memory";
    clearDialog.showModal();
  };
  $("zenoClearCancel").onclick = () => clearDialog.close();
  $("zenoClearChat").onclick = () => {
    if (busy) return;
    clearCurrentChat();
    clearDialog.close();
    $("zenoClearStatus").textContent = "Chat and draft cleared.";
  };
  $("zenoClearMemory").onclick = async () => {
    if (busy) return;
    busy = true;
    try {
      if (workspace === "demo") {
        localStorage.setItem(sampleMemoryKey, "[]");
        sampleData = sampleWorkspace();
      }
      else await App.Account.clearZenoMemory();
      writeSummaries([]);
      clearCurrentChat();
      $("zenoClearStatus").textContent = workspace === "demo" ? "Sample data reset." : "Chat, draft, memories, and saved summaries cleared.";
    } catch {
      $("zenoClearStatus").textContent = "Couldn’t clear saved Zeno memory. Try again.";
    } finally {
      clearDialog.close();
      busy = false;
    }
  };

  clearThread();
  App.Account.onChange(renderUsuals);
  App.views.zeno = {
    async show() {
      checkInVisit ??= Date.now();
      pose("hello");
      renderAiControls();
      renderConversationControls();
      if (aiConsent === null && !consentDialog.open) consentDialog.showModal();
      void loadAgentAvailability();
      if (!voiceAvailability && App.ZenoLive) {
        void App.ZenoLive.status().then(availability => {
          voiceAvailability = availability;
          renderAiControls();
        }).catch(() => {});
      }
      try {
        await App.Account.getDoc();
        renderUsuals();
      } catch {
        usuals.textContent = "Couldn’t load your usuals. Try opening Zeno again.";
      }
    },
    hide() {
      checkInVisit = undefined;
      optionsMenu.open = false;
      if (call.open) dismissCall();
      if (consentDialog.open) consentDialog.close();
      if (clearDialog.open) clearDialog.close();
      if (conversations.open) conversations.close();
      if (guide.open) guide.close();
      if (memoryEditor.open) memoryEditor.close();
      if (memoryDialog.open) memoryDialog.close();
      agentController?.abort();
      pose("rest");
    },
    clearThread,
    hasAiConsent: () => aiConsent === true,
    exportSummaries: () => App.store.get(summaryKey, {})?.personal || [],
    setAiConsent,
  };
})();
