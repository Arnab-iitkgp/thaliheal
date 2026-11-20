// Local stand in for Vercel, no installs needed: serves public/ with the same headers as
// vercel.json and runs api/ai.js. Reads .env.local (or .env) for the variables.
//   npm run dev          http://localhost:3000, this computer only (browsers treat localhost as secure,
//                        so the live camera works here)
//   npm run dev:https    https on your Wi-Fi too, to try the camera on your phone. Makes a self signed
//                        certificate in .cert/ the first time (needs openssl, which macOS, Linux and Git for Windows have).
// ThaliHeal is https only: nothing is served over plain http beyond this computer.
// `vercel dev` does the same with the real Vercel tooling, if you prefer.
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const PUBLIC = path.join(ROOT, "public");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".json": "application/json", ".css": "text/css", ".svg": "image/svg+xml",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".woff2": "font/woff2", ".txt": "text/plain", ".md": "text/plain", ".webmanifest": "application/manifest+json" };

function loadEnv() {
  for (const f of [".env.local", ".env"]) {
    const p = path.join(ROOT, f);
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
    }
  }
}

// vercel.json sources like "/:view(home|scan)" or "/(img|fonts)/(.*)" as regular expressions.
const toRe = (src) => new RegExp("^" + src.replace(/:(\w+)\(([^)]+)\)/g, "($2)") + "$");

// Same order as Vercel: a real file wins, then rewrites, then the function, else 404.html.
// Pass { key, cert } to serve over HTTPS (phones need HTTPS for a real camera test on your network).
function start(port, tls) {
  require("./build").build();   // same as Vercel's build step: flags.js from AI_ENABLED, then sw.js
  const vercel = JSON.parse(fs.readFileSync(path.join(ROOT, "vercel.json"), "utf8"));
  const headerRules = vercel.headers.map((h) => ({ re: toRe(h.source), headers: h.headers }));
  const rewrites = (vercel.rewrites || []).map((r) => ({ re: toRe(r.source), to: r.destination }));
  const handler = require(path.join(ROOT, "api", "ai.js"));
  const serveFile = (res, file, status) => {
    res.statusCode = status || 200;
    res.setHeader("Content-Type", TYPES[path.extname(file)] || "application/octet-stream");
    fs.createReadStream(file).pipe(res);
  };
  const app = (req, res) => {
    const url = new URL(req.url, "http://localhost");
    // HSTS is for the live site only: on localhost it would stick to the address and break plain local runs.
    headerRules.forEach((h) => { if (h.re.test(url.pathname)) h.headers.forEach((x) => { if (x.key !== "Strict-Transport-Security") res.setHeader(x.key, x.value); }); });
    if (url.pathname === "/api/ai") {
      if (process.env.NODE_ENV !== "test") {
        loadEnv();
        // Clear cached modules for hot reloading
        Object.keys(require.cache).forEach((k) => {
          if (k.includes("api\\ai.js") || k.includes("api/ai.js") || k.includes("\\lib\\") || k.includes("/lib/")) {
            delete require.cache[k];
          }
        });
      }
      return require(path.join(ROOT, "api", "ai.js"))(req, res);
    }
    let file = path.normalize(path.join(PUBLIC, decodeURIComponent(url.pathname)));
    if (!file.startsWith(PUBLIC)) { res.statusCode = 403; return res.end(); }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
    if (fs.existsSync(file)) return serveFile(res, file);
    const rw = rewrites.find((r) => r.re.test(url.pathname));
    if (rw) return serveFile(res, path.join(PUBLIC, rw.to));
    return serveFile(res, path.join(PUBLIC, "404.html"), 404);
  };
  const server = tls ? require("https").createServer(tls, app) : http.createServer(app);
  // Plain http listens on this computer only; https may listen on the network.
  const host = tls ? (tls.host || "0.0.0.0") : "127.0.0.1";
  return new Promise((resolve) => server.listen(port, host, () => resolve(server)));
}

// This computer's addresses on the local network, for opening the site on a phone.
function lanAddresses() {
  return Object.values(require("os").networkInterfaces()).flat().filter((a) => a && a.family === "IPv4" && !a.internal).map((a) => a.address);
}

function findOpenSSL() {
  const candidates = [
    "openssl",
    "C:\\Program Files\\Git\\usr\\bin\\openssl.exe",
    "C:\\Program Files (x86)\\Git\\usr\\bin\\openssl.exe",
    "C:\\Program Files\\OpenSSL-Win64\\bin\\openssl.exe",
  ];
  for (const cmd of candidates) {
    if (cmd !== "openssl" && !fs.existsSync(cmd)) continue;
    try {
      const r = require("child_process").spawnSync(cmd, ["version"], { stdio: "ignore" });
      if (!r.error && r.status === 0) return cmd;
    } catch (e) {}
  }
  return "openssl";
}

// A self signed certificate for localhost and this computer's network addresses, made once with openssl.
function localCert() {
  const dir = path.join(ROOT, ".cert"), key = path.join(dir, "key.pem"), cert = path.join(dir, "cert.pem");
  const ips = lanAddresses();
  const san = ["DNS:localhost", "IP:127.0.0.1", ...ips.map((ip) => "IP:" + ip)].join(",");
  const stamp = path.join(dir, "san.txt");
  if (!(fs.existsSync(key) && fs.existsSync(cert) && fs.existsSync(stamp) && fs.readFileSync(stamp, "utf8") === san)) {
    fs.mkdirSync(dir, { recursive: true });
    const opensslCmd = findOpenSSL();
    const r = require("child_process").spawnSync(opensslCmd, ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-sha256", "-days", "365",
      "-keyout", key, "-out", cert, "-subj", "/CN=ThaliHeal local", "-addext", "subjectAltName=" + san], { stdio: "pipe" });
    if (r.error || r.status !== 0) {
      console.error("Could not make a local certificate: openssl is missing or failed. On Windows, run this from Git Bash, or use npm run dev and test the camera on this computer.");
      process.exit(1);
    }
    fs.writeFileSync(stamp, san);
  }
  return { key: fs.readFileSync(key), cert: fs.readFileSync(cert) };
}

if (require.main === module) {
  loadEnv();
  const https = process.argv.includes("--https");
  const port = Number(process.env.PORT) || (https ? 3443 : 3000);
  const { load, missing } = require("../lib/config");
  const cfg = load();
  const gaps = missing(cfg);
  const keyNote = !cfg.aiEnabled
    ? "Scan off mode (AI_ENABLED is not true): scanning, the assistant and test mode show coming soon; nothing else is needed."
    : (gaps.length ? `AI on (${cfg.provider}). Missing: ${gaps.join(", ")} in .env.local` : `AI on with ${cfg.provider.toUpperCase()} (${cfg.models.default}).`);
  start(port, https ? localCert() : null).then(() => {
    if (!https) return console.log(`ThaliHeal is running at http://localhost:${port}\n${keyNote}`);
    console.log(`ThaliHeal is running over https:\n  this computer: https://localhost:${port}`);
    lanAddresses().forEach((ip) => console.log(`  your phone (same Wi-Fi): https://${ip}:${port}`));
    console.log("The certificate is self signed, so the browser warns once: choose Advanced, then Proceed.\n" + keyNote);
  });
}
module.exports = { start, loadEnv, lanAddresses, localCert };
