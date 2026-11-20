/* camera.js: the live camera for scanning, in the browser (phone back camera or laptop webcam).
   Needs a secure page (https, or localhost while developing): browsers only allow the camera there.
   The stream stays on this device. Only the one frame you capture becomes a photo, and only a scan sends it. */
(function () {
  "use strict";
  const { $ } = App;
  let stream = null, devices = [], devIdx = -1, opts = null, busy = false;

  const phoneLike = () => matchMedia("(pointer: coarse)").matches;
  const say = (msg, err) => { const el = $("camMsg"); el.textContent = msg || ""; el.classList.toggle("err", !!err); };

  // A plain sentence for each way the camera can fail, with what to do next.
  function why(e) {
    const n = e && e.name;
    if (n === "NotAllowedError" || n === "SecurityError")
      return "Camera access is blocked for this site. Allow it in the browser's site settings (the icon left of the address), or upload a photo instead.";
    if (n === "NotFoundError" || n === "OverconstrainedError") return "No camera was found on this device. Upload a photo instead.";
    if (n === "NotReadableError" || n === "AbortError") return "The camera is busy in another app or tab. Close it there and try again, or upload a photo.";
    return "The camera could not start. Upload a photo instead.";
  }

  async function start(deviceId) {
    stop();
    const video = deviceId
      ? { deviceId: { exact: deviceId }, width: { ideal: 1920 }, height: { ideal: 1440 } }
      : { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1440 } };
    stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
    const v = $("camVideo");
    v.srcObject = stream;
    await v.play().catch(() => {});
    const track = stream.getVideoTracks()[0], set = track && track.getSettings ? track.getSettings() : {};
    // Labels and the full list only appear after permission is given, so ask now.
    devices = (await navigator.mediaDevices.enumerateDevices().catch(() => [])).filter((d) => d.kind === "videoinput");
    devIdx = Math.max(0, devices.findIndex((d) => d.deviceId === set.deviceId));
    $("camSwitch").hidden = devices.length < 2;
    $("camVideo").classList.toggle("mirror", set.facingMode === "user" || (!set.facingMode && !phoneLike()));
    $("camShot").disabled = false;
    say(phoneLike() ? "Hold the phone flat above the plate, with the whole plate inside the circle." : "Hold the plate under the camera, seen from above if you can.");
  }

  function stop() {
    if (stream) stream.getTracks().forEach((t) => t.stop());
    stream = null;
    const v = $("camVideo"); if (v) v.srcObject = null;
  }

  function close() {
    stop(); busy = false;
    $("camSheet").hidden = true; document.body.classList.remove("cam-open");
    const back = opts && opts.returnFocus; opts = null;
    if (back && back.focus) back.focus();
  }

  async function open(o) {
    if (busy) return; busy = true;
    opts = Object.assign({ returnFocus: document.activeElement }, o);
    if (!window.isSecureContext) {
      busy = false;
      return opts.onFallback && opts.onFallback("The camera only works on a secure (https) page. Open ThaliHeal at its https address, or upload a photo.");
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      busy = false;
      return opts.onFallback && opts.onFallback(phoneLike() ? "This browser has no live camera view, so your phone's camera app opens instead." : "This browser has no camera access. Upload a photo instead.");
    }
    $("camSheet").hidden = false; document.body.classList.add("cam-open");
    $("camShot").disabled = true; $("camSwitch").hidden = true;
    say("Starting the camera… allow it if the browser asks.");
    $("camClose").focus();
    try { await start(); }
    catch (e) {
      const msg = why(e), fb = opts && opts.onFallback;
      close();
      if (fb) fb(msg);
    }
  }

  // Grabs the current frame at the camera's full size as a JPEG.
  function shoot() {
    const v = $("camVideo");
    if (!stream || !v.videoWidth) return;
    const cv = document.createElement("canvas"); cv.width = v.videoWidth; cv.height = v.videoHeight;
    cv.getContext("2d").drawImage(v, 0, 0, cv.width, cv.height);
    $("camShot").disabled = true;
    $("camSheet").classList.add("flash"); setTimeout(() => $("camSheet").classList.remove("flash"), 180);
    cv.toBlob((b) => {
      const cb = opts && opts.onPhoto;
      close();
      if (b && cb) cb(b);
    }, "image/jpeg", 0.92);
  }

  async function switchCam() {
    if (devices.length < 2) return;
    devIdx = (devIdx + 1) % devices.length;
    $("camShot").disabled = true; say("Switching camera…");
    try { await start(devices[devIdx].deviceId); } catch (e) { say(why(e), true); }
  }

  function init() {
    $("camClose").onclick = close;
    $("camShot").onclick = shoot;
    $("camSwitch").onclick = switchCam;
    $("camSheet").addEventListener("keydown", (e) => {
      if (e.key === "Escape") { e.preventDefault(); close(); }
      if (e.key === "Tab") {   // keep focus inside the camera view
        const f = [...$("camSheet").querySelectorAll("button:not([hidden]):not([disabled])")];
        if (!f.length) return;
        const i = f.indexOf(document.activeElement);
        if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
      }
    });
    // Never leave the camera running in the background.
    window.addEventListener("hashchange", () => { if (stream || !$("camSheet").hidden) close(); });
    window.addEventListener("pagehide", stop);
    document.addEventListener("visibilitychange", () => { if (document.hidden && stream) close(); });
  }

  App.Camera = { open, close, phoneLike, init };
})();
