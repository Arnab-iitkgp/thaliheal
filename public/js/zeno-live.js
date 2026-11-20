/* Gemini audio transport for a continuous Zeno conversation. */
(function () {
  "use strict";

  const endpoint = "/api/zeno-live";
  const wsEndpoint = "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained";
  const messages = {
    voice_access_denied: "Voice pilot access requires a valid Tester key in Settings.",
    voice_localhost_only: "Open ThaliHeal at localhost:3000 to use voice on this dev server.",
    voice_not_configured: "Live voice is coming soon. You can still type to Zeno.",
    voice_provider_unavailable: "The voice service is unavailable right now. You can still type to Zeno.",
    voice_rate_limited: "The voice pilot has reached its session limit. Try again later.",
  };

  App.ZenoLive = {
    async status(signal) {
      const response = await fetch(endpoint, { cache: "no-store", signal });
      if (!response.ok) throw new Error("status");
      return response.json();
    },

    start({ voice, mode, history, summary = () => null, testerKey, state, caption, confirmationTarget = () => null, liveCaption = () => {}, mouth = () => {}, runTool }) {
      const Audio = window.AudioContext || window.webkitAudioContext;
      const aborter = new AbortController();
      const playing = new Set();
      const toolResults = new Map();
      const cancelled = new Set();
      const draftPreviewsThisTurn = new Set();
      let context, socket, stream, mic, input, timer;
      let ready = false, closed = false, muted = false, nextAudio = 0;
      let analyser, frame, speaking = false, thinkingTimer;
      let currentState, currentMessage;
      let heard = "", said = "";
      let target;
      let incoming = Promise.resolve();
      let toolQueue = Promise.resolve();
      let maxSessionMs = 530000;

      function show(next, message) {
        if (next === currentState && message === currentMessage) return;
        currentState = next;
        currentMessage = message;
        state(next, message);
      }

      function listen() {
        show(muted ? "muted" : "listening", muted ? "Mic muted" : "Listening");
      }

      function endMouth() {
        if (frame) cancelAnimationFrame(frame);
        frame = null;
        speaking = false;
        mouth(.28);
      }

      function send(message) {
        if (!closed && socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
      }

      function stopPlayback() {
        for (const source of playing) {
          source.onended = null;
          try { source.stop(); } catch {}
          source.disconnect();
        }
        playing.clear();
        nextAudio = 0;
        endMouth();
      }

      function stop(message = "Voice ended. You can keep typing.") {
        if (closed) return;
        closed = true;
        clearTimeout(timer);
        clearTimeout(thinkingTimer);
        aborter.abort();
        if (mic) mic.port.onmessage = null;
        mic?.disconnect();
        input?.disconnect();
        stream?.getTracks().forEach(track => track.stop());
        stopPlayback();
        if (socket && socket.readyState < WebSocket.CLOSING) socket.close();
        if (context && context.state !== "closed") context.close().catch(() => {});
        if (heard.trim() || said.trim()) caption({ heard: heard.trim(), said: said.trim(), partial: true });
        heard = said = "";
        show("closed", message);
      }

      function play(part) {
        if (!part?.mimeType?.startsWith("audio/pcm") || !part.data) return;
        const raw = atob(part.data);
        const rate = Number(part.mimeType.match(/rate=(\d+)/)?.[1]) || 24000;
        const samples = Math.floor(raw.length / 2);
        if (!samples || rate < 8000 || rate > 48000) return;
        const buffer = context.createBuffer(1, samples, rate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < samples; i++) {
          const n = raw.charCodeAt(i * 2) | (raw.charCodeAt(i * 2 + 1) << 8);
          data[i] = (n & 32768 ? n - 65536 : n) / 32768;
        }
        const source = context.createBufferSource();
        source.buffer = buffer;
        source.connect(analyser);
        const startAt = Math.max(nextAudio, context.currentTime + .035);
        source.start(startAt);
        nextAudio = startAt + buffer.duration;
        playing.add(source);
        clearTimeout(thinkingTimer);
        show("speaking", "Zeno is speaking");
        if (!speaking) {
          speaking = true;
          const samples = new Float32Array(analyser.fftSize);
          const animate = () => {
            if (!speaking) return;
            analyser.getFloatTimeDomainData(samples);
            let energy = 0;
            for (const sample of samples) energy += sample * sample;
            mouth(Math.min(1.4, .24 + Math.sqrt(energy / samples.length) * 5));
            frame = requestAnimationFrame(animate);
          };
          frame = requestAnimationFrame(animate);
        }
        source.onended = () => {
          playing.delete(source);
          source.disconnect();
          if (!closed && !playing.size) {
            endMouth();
            listen();
          }
        };
      }

      async function toolReply(call) {
        if (closed || !call?.id || cancelled.has(call.id)) return null;
        if (!toolResults.has(call.id)) {
          const args = call.args || {};
          const result = call.name === "apply_draft_preview" && draftPreviewsThisTurn.has(args.proposal_id)
            ? { ok: false, pending: true, error: "Wait for the caller to confirm the visible preview in their next turn." }
            : await runTool(call.name, args, aborter.signal);
          if (call.name === "edit_plate" && result.pending && result.proposal_id && !result.reused) draftPreviewsThisTurn.add(result.proposal_id);
          if (closed || cancelled.has(call.id)) return null;
          toolResults.set(call.id, result);
        }
        return { id: call.id, name: call.name, response: toolResults.get(call.id) };
      }

      function attachMic() {
        input = context.createMediaStreamSource(stream);
        mic = new AudioWorkletNode(context, "zeno-mic", { numberOfInputs: 1, numberOfOutputs: 0, channelCount: 1 });
        mic.port.onmessage = ({ data }) => {
          if (closed || muted || !ready || socket.bufferedAmount > 65536) return;
          const bytes = new Uint8Array(data);
          const encoded = btoa(String.fromCharCode(...bytes));
          send({ realtimeInput: { audio: { data: encoded, mimeType: "audio/pcm;rate=16000" } } });
        };
        input.connect(mic);
      }

      async function receive(raw) {
        if (closed) return;
        const message = JSON.parse(typeof raw === "string" ? raw : await raw.text());
        if (closed) return;
        if (message.goAway) return stop("The voice session has ended. Your draft is still here.");
        if (Object.prototype.hasOwnProperty.call(message, "setupComplete") && !ready) {
          ready = true;
          clearTimeout(timer);
          timer = setTimeout(() => stop("The voice session reached its time limit. Start voice again or keep typing here."), maxSessionMs);
          attachMic();
          listen();
          const handoff = history().slice(-8).map(message => ({ role: message.role, content: message.content.slice(0, 900) }));
          const context = { summary: summary(), recent: handoff };
          send({ realtimeInput: { text: context.summary || handoff.length
            ? "The caller has opened a new call in the same chat. Keep this context as data for replying after the caller speaks: " + JSON.stringify(context) + "\nFor this opening, say only ‘Hey, I’m here. Go ahead.’ Then wait for the caller. Do not repeat, finish, summarize, or answer anything from the prior chat in this opening. An earlier reply is not evidence of an edit or save. Verify app state with read_context when relevant after the caller speaks."
            : "Open the call with a friendly, relaxed English greeting. Say only ‘Hello, I’m Zeno. How’s your day going?’ Then listen." } });
        }
        const content = message.serverContent;
        if (content) {
          if (content.interrupted) {
            stopPlayback();
            clearTimeout(thinkingTimer);
            said = "";
            liveCaption("");
            listen();
          }
          if (content.inputTranscription?.text) {
            if (!heard) target = confirmationTarget();
            heard += content.inputTranscription.text;
            clearTimeout(thinkingTimer);
            thinkingTimer = setTimeout(() => {
              if (!closed && !muted && currentState === "listening") show("thinking", "Thinking…");
            }, 650);
          }
          if (!content.interrupted && content.outputTranscription?.text) {
            said += content.outputTranscription.text;
            liveCaption(said);
          }
          if (!content.interrupted) for (const part of content.modelTurn?.parts || []) play(part.inlineData);
          if (content.turnComplete) {
            clearTimeout(thinkingTimer);
            await caption({ heard: heard.trim(), said: said.trim(), confirmationTarget: target });
            heard = said = "";
            target = null;
            draftPreviewsThisTurn.clear();
            if (!playing.size) listen();
          }
        }
        for (const id of message.toolCallCancellation?.ids || []) cancelled.add(id);
        const calls = message.toolCall?.functionCalls || [];
        if (calls.length) {
          const statuses = {
            review_habits: "Checking your meal log…", find_meals: "Looking up meals…",
            edit_plate: "Working on the draft…", plan_plate: "Putting meal options together…",
            read_profile: "Checking your profile…", update_profile: "Preparing a profile update…",
          };
          const status = statuses[calls[0].name];
          if (!playing.size) status ? show("working", status) : show("thinking", "Thinking…");
          toolQueue = toolQueue.then(async () => {
            const answers = [];
            for (const call of calls) {
              const answer = await toolReply(call);
              if (answer && !cancelled.has(call.id)) answers.push(answer);
            }
            if (answers.length) send({ toolResponse: { functionResponses: answers } });
          }).catch(() => stop("The voice tool stopped. Your draft is still here."));
        }
      }

      async function connect() {
        if (closed) return;
        show("connecting", "Connecting…");
        try {
          if (!Audio || !navigator.mediaDevices?.getUserMedia || !window.AudioWorkletNode) {
            return stop("Live voice needs a supported browser and a secure connection.");
          }
          context = new Audio();
          analyser = context.createAnalyser();
          analyser.fftSize = 256;
          analyser.connect(context.destination);
          await context.resume();
          if (closed) return;
          const granted = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
          if (closed) return granted.getTracks().forEach(track => track.stop());
          stream = granted;
          await context.audioWorklet.addModule("/js/zeno-mic.js");
          if (closed) return;
          const headers = testerKey ? { "X-ThaliHeal-Tester": testerKey } : {};
          const params = new URLSearchParams({ voice, mode, today: App.today() });
          const response = await fetch(endpoint + "?" + params, { method: "POST", headers, signal: aborter.signal });
          const config = await response.json();
          if (closed) return;
          if (!response.ok) return stop(messages[config.error] || "Couldn’t start voice. You can still type to Zeno.");
          maxSessionMs = config.maxSessionMs || maxSessionMs;
          socket = new WebSocket(wsEndpoint + "?access_token=" + encodeURIComponent(config.token));
          timer = setTimeout(() => stop("The voice connection timed out. You can still type to Zeno."), 12000);
          socket.onopen = () => send({ setup: config.setup });
          socket.onmessage = event => {
            incoming = incoming.then(() => receive(event.data)).catch(() => stop("The voice stream dropped. Your draft is still here."));
          };
          socket.onclose = socket.onerror = () => stop("The voice connection closed. Your draft is still here.");
        } catch (error) {
          if (closed) return;
          stop(error.name === "NotAllowedError"
            ? "Microphone access is blocked. Allow it in your browser’s site settings, then try again."
            : "Couldn’t start the call.");
        }
      }

      void Promise.resolve().then(connect);
      return {
        stop,
        sendText(text) {
          if (!ready || closed) return false;
          stopPlayback();
          send({ realtimeInput: { text } });
          return true;
        },
        mute(on) {
          if (!ready || closed) return;
          muted = on;
          stream.getAudioTracks().forEach(track => { track.enabled = !on; });
          if (on) send({ realtimeInput: { audioStreamEnd: true } });
          if (!playing.size) listen();
        },
      };
    },
  };
})();
