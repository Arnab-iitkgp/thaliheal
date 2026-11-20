/* https.js: ThaliHeal only runs on https. Loaded first, in <head>, so a plain http address switches over
   before anything else loads. localhost and 127.0.0.1 stay as they are for local development
   (browsers treat them as secure, so the camera works there too). The server also sends HSTS. */
(function () {
  var local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  if (location.protocol === "http:" && !local) location.replace("https://" + location.host + location.pathname + location.search + location.hash);
})();
