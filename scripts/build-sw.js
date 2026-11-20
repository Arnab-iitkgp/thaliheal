// Writes public/sw.js: lists the app shell files and stamps a version from their contents,
// so every deploy that changes the app ships a new service worker. Vercel runs this as the build step.
//   node scripts/build-sw.js
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.join(__dirname, "..");
const PUB = path.join(ROOT, "public");
const ls = (dir, re) => fs.readdirSync(path.join(PUB, dir)).filter((f) => re.test(f)).sort().map((f) => `/${dir}/${f}`);

function shellFiles() {
  return [
    "/index.html", "/offline.html", "/manifest.webmanifest", "/funfact-popup.js",
    ...ls("css", /\.css$/), ...ls("js", /\.js$/), ...ls("data", /\.json$/), ...ls("fonts", /\.woff2$/),
    "/img/favicon.svg", "/img/logo-mark.svg", "/img/icons/icon-192.png", "/img/icons/icon-512.png", "/img/icons/maskable-192.png", "/img/icons/apple-touch-icon-180.png",
    ...ls("img/plates", /-round\.jpg$/),
    ...ls("img/samples", /\.jpg$/),   // the sample dish cards open offline too (about 1 MB)
  ];
}

function build() {
  const files = shellFiles();
  const hash = crypto.createHash("sha256");
  let bytes = 0;
  for (const f of files) {
    const buf = fs.readFileSync(path.join(PUB, f));
    bytes += buf.length; hash.update(f); hash.update(buf);
  }
  const tpl = fs.readFileSync(path.join(__dirname, "sw.template.js"), "utf8");
  hash.update(tpl);
  const version = hash.digest("hex").slice(0, 12);
  const out = tpl.replace("__VERSION__", version).replace("__SHELL__", JSON.stringify(files, null, 2));
  fs.writeFileSync(path.join(PUB, "sw.js"), out);
  return { version, count: files.length, bytes };
}

if (require.main === module) {
  const r = build();
  console.log(`sw.js built: version ${r.version}, ${r.count} shell files, ${(r.bytes / 1024).toFixed(0)} KB cached on install`);
}
module.exports = { build };
