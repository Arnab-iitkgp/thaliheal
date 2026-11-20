/* Zeno's scripted motion preview. State changes are kept independent of audio availability. */
(function () {
  "use strict";

  const stage = document.getElementById("zenoStage");
  const status = document.getElementById("zenoStatus");
  const conversation = document.getElementById("zenoConversation");
  const draft = document.getElementById("zenoDraft");
  const start = document.getElementById("zenoStart");
  const correct = document.getElementById("zenoCorrect");
  const stop = document.getElementById("zenoStop");
  const review = document.getElementById("zenoReview");
  const reviewNote = document.getElementById("zenoReviewNote");
  const rotis = document.getElementById("zenoRotis");
  const sound = document.getElementById("zenoSound");
  const speech = "SpeechSynthesisUtterance" in window ? window.speechSynthesis : null;
  let timer;
  let utterance;

  function setState(state, label) {
    stage.dataset.state = state;
    status.textContent = label;
  }

  function next(delay, action) {
    clearTimeout(timer);
    timer = setTimeout(action, delay);
  }

  function stopVoice() {
    if (utterance) {
      utterance.onstart = utterance.onend = utterance.onerror = null;
      utterance = null;
      speech.cancel();
    }
    delete stage.dataset.audio;
  }

  function line(speaker, message) {
    const bubble = document.createElement("li");
    bubble.className = speaker === "You" ? "zeno-user" : "zeno-reply";
    const label = document.createElement("span");
    label.className = "sr-only";
    label.textContent = speaker + ": ";
    bubble.append(label, message);
    conversation.append(bubble);
    conversation.hidden = false;
  }

  function speak(message, delay, done) {
    stopVoice();
    line("Zeno", message);
    stage.dataset.audio = "playing";
    if (speech && sound.checked) {
      utterance = new SpeechSynthesisUtterance(message);
      utterance.lang = "en-IN";
      utterance.rate = 0.95;
      utterance.onend = utterance.onerror = () => {
        utterance = null;
        delete stage.dataset.audio;
      };
      speech.speak(utterance);
    }
    next(delay, () => {
      stopVoice();
      done();
    });
  }

  function reset() {
    clearTimeout(timer);
    stopVoice();
    conversation.replaceChildren();
    conversation.hidden = draft.hidden = correct.hidden = stop.hidden = reviewNote.hidden = true;
    start.hidden = false;
    start.textContent = "Start preview";
    rotis.value = "3";
    setState("rest", "Voice preview");
  }

  start.addEventListener("click", () => {
    reset();
    start.hidden = true;
    stop.hidden = false;
    stop.focus({ preventScroll: true });
    setState("listen", "Listening");
    next(650, () => {
      line("You", "Same mess lunch as yesterday.");
      setState("recall", "Found your usual lunch");
      next(700, () => {
        setState("ask", "Checking your usual");
        correct.hidden = false;
        speak("Rajma, rice, and two rotis, same as yesterday?", 4100, () => {
          setState("listen", "Waiting for your correction");
        });
      });
    });
  });

  correct.addEventListener("click", () => {
    clearTimeout(timer);
    stopVoice();
    correct.hidden = true;
    stop.focus({ preventScroll: true });
    setState("listen", "Listening");
    line("You", "Actually, add a roti.");
    next(700, () => {
      setState("speak", "Zeno is replying");
      speak("Three rotis. I've updated your draft.", 2800, () => {
        setState("handoff", "Draft ready to review");
        draft.hidden = false;
        stop.hidden = true;
        start.hidden = false;
        start.textContent = "Replay preview";
        review.focus();
      });
    });
  });

  stop.addEventListener("click", () => {
    reset();
    start.focus();
  });
  sound.addEventListener("change", () => {
    if (!sound.checked) stopVoice();
  });
  review.addEventListener("click", () => {
    if (!rotis.reportValidity()) return;
    const count = Number(rotis.value);
    reviewNote.textContent = count + (count === 1 ? " roti" : " rotis") + " confirmed for this preview. Nothing was saved to your log.";
    reviewNote.hidden = false;
  });
  rotis.addEventListener("input", () => { reviewNote.hidden = true; });

  if (!speech) document.getElementById("zenoSoundLabel").hidden = true;
  window.addEventListener("pagehide", reset);
  App.views.zeno = { show() {}, hide: reset };
})();
