// Fixed window rate limits: per person per minute, per person per day, and one global
// daily cap for the whole app. Counters live in Upstash Redis so every serverless
// instance shares them. Without Redis (local dev only) they live in memory.
//
// A person is a one way hash of their IP address and RATE_LIMIT_SALT. The raw IP is never
// stored, and counters expire within a day.
"use strict";
const crypto = require("crypto");

const mem = new Map();   // local dev fallback: key -> { n, until }

function istDay(now) {
  // Daily limits reset at midnight India time.
  const d = new Date(now + 330 * 60000);
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}

function personId(ip, salt) {
  return crypto.createHash("sha256").update(salt + "|" + ip).digest("hex").slice(0, 32);
}

async function redisPipeline(cfg, commands) {
  const r = await fetch(cfg.redisUrl.replace(/\/$/, "") + "/pipeline", {
    method: "POST",
    headers: { Authorization: "Bearer " + cfg.redisToken, "Content-Type": "application/json" },
    body: JSON.stringify(commands),
  });
  if (!r.ok) throw new Error("redis " + r.status);
  const out = await r.json();
  return out.map((x) => (x && x.error ? null : x.result));
}

function memIncr(key, ttlSec, now) {
  const e = mem.get(key);
  if (!e || e.until < now) { mem.set(key, { n: 1, until: now + ttlSec * 1000 }); return 1; }
  e.n += 1; return e.n;
}

// Counts this request and says whether it may go ahead.
// Returns { ok, reason, retryAfter, remainingDay }.
async function check(cfg, ip, tester) {
  const now = Date.now();
  const who = personId(ip || "unknown", cfg.salt || "dev-salt");
  const minute = Math.floor(now / 60000), day = istDay(now);
  const limMin = tester ? cfg.testerPerMinute : cfg.perMinute;
  const limDay = tester ? cfg.testerPerDay : cfg.perDay;
  const prefix = cfg.namespace ? `thaliheal:rl:${cfg.namespace}` : "thaliheal:rl";
  const keys = { m: `${prefix}:m:${who}:${minute}`, d: `${prefix}:d:${who}:${day}`, g: `${prefix}:g:${day}` };

  let m, d, g;
  if (cfg.redisUrl && cfg.redisToken) {
    const res = await redisPipeline(cfg, [
      ["INCR", keys.m], ["EXPIRE", keys.m, "70"],
      ["INCR", keys.d], ["EXPIRE", keys.d, "90000"],
      ["INCR", keys.g], ["EXPIRE", keys.g, "90000"],
    ]);
    [m, , d, , g] = res.map(Number);
  } else {
    m = memIncr(keys.m, 70, now); d = memIncr(keys.d, 90000, now); g = memIncr(keys.g, 90000, now);
  }

  if (g > cfg.globalPerDay) return { ok: false, reason: "global", retryAfter: secondsToIstMidnight(now) };
  if (d > limDay) return { ok: false, reason: "day", retryAfter: secondsToIstMidnight(now) };
  if (m > limMin) return { ok: false, reason: "minute", retryAfter: 60 - Math.floor((now / 1000) % 60) };
  return { ok: true, remainingDay: Math.max(0, limDay - d) };
}

function secondsToIstMidnight(now) {
  const ist = now + 330 * 60000;
  return Math.ceil((86400000 - (ist % 86400000)) / 1000);
}

module.exports = { check, personId, resetMem: () => mem.clear() };
