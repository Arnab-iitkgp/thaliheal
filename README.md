# ThaliHeal

We Heal Your Plates! Photograph an Indian meal, check every dish and portion, log it, and compare your days with ICMR NIN 2020 targets.

ThaliHeal is a mobile first website. It works in a phone browser and on a computer, and it runs on https only.

**Scan off mode is the default.** Unless `AI_ENABLED=true`, the site needs no API key, no database and no variables. Scan, the assistant and test mode show "coming soon"; the sample dishes, adding dishes by hand, My log, targets, profile, privacy, consent, CSV export and the fun facts all work.

## Run it on your computer

You need Node.js 20 or newer. There is nothing to install with npm.

```
npm run dev                       # open http://localhost:3000 (scan off mode, nothing to set up)
```

To try AI locally: `cp .env.example .env.local`, set `AI_ENABLED=true` and your `ANTHROPIC_API_KEY` in `.env.local`, and run `npm run dev` again.

To try Zeno’s live conversation, set `GEMINI_API_KEY` in `.env.local`, restart the dev server, and open **Zeno → Talk to Zeno → Sample meals** on localhost. Start voice once and keep talking or typing in that conversation. Zeno can review the fictional log, compare options and edit a draft. Sample data stays in its own workspace. Voice sends microphone audio to Google Gemini. Hosted testers also need the settings marked **Zeno Live** in [.env.example](.env.example). Enable voice with real meals only after setting up a separate Gemini project whose data terms permit personal data.

For the Zeno text agent, set `AI_ENABLED=true` and `GROQ_API_KEY` in `.env.local`, then accept the AI prompt when you first open Zeno. Both **My meals** and **Sample meals** support AI text on localhost and the exact HTTPS phone preview origin in `ZENO_LIVE_DEMO_ORIGIN`. Hosted testing requires `ZENO_AGENT_ENABLED=true` and the tester configuration. Sample text can use Gemini Flash-Lite for planning and Groq for replies. Personal text uses Groq. The agent can look up meals, update drafts, remember preferences, and compare or plan plates. Save confirmed meals from the draft card.

To try the live camera on your phone over Wi-Fi, run `npm run dev:https` and open the `https://192.168...:3443` address it prints on your phone. The certificate is self signed, so the browser warns once: choose Advanced, then Proceed. On the computer itself, `http://localhost` already counts as secure, so the camera works there with `npm run dev`.

## Project structure

```
thaliheal/
├── public/                  the website (static files, no keys)
│   ├── index.html           every screen, styles included
│   ├── js/
│   │   ├── https.js         moves any http address to https before anything loads
│   │   ├── flags.js         the AI switch for the page (written by the build from AI_ENABLED)
│   │   ├── core.js          data, maths, routing, saving files, offline, the AI client
│   │   ├── camera.js        live camera in the browser (getUserMedia)
│   │   ├── scan.js          scan screen: camera, upload, drop, paste, results, save to log
│   │   ├── home.js          home, sample dishes, dish pages, "coming soon", settings
│   │   ├── test-mode.js     accuracy test: test set, runs, results, CSV export
│   │   ├── tracker.js       my log: day, week and month, gaps, CSV export
│   │   ├── targets.js       ICMR NIN 2020 targets from the profile
│   │   ├── sources.js       Indian foods that fill each gap
│   │   ├── account.js       profile and meal log storage, consent
│   │   ├── assistant.js     ask about my log
│   │   ├── safety.js        red flag rules for the assistant
│   │   ├── privacy.js       notice, download and delete my data
│   │   └── boot.js          starts the app
│   ├── funfact-popup.js     the fun fact popup
│   ├── data/                food table and the 25 sample dishes
│   ├── img/                 logo, icons, plate photos, sample and test photos
│   ├── fonts/               Bricolage Grotesque and Figtree (OFL)
│   ├── manifest.webmanifest, sw.js, offline.html, 404.html
├── api/ai.js                calls the Claude API with your key when AI is on; says "scanning is off" when it is not
├── lib/                     settings and rate limiting for that function
├── scripts/                 build (flags and service worker), local server, data builds, checks
├── docs/
│   ├── DEPLOY.md            step by step: GitHub, Vercel, testing on your phone, and turning AI on later
│   └── NOTES.md             how the app works (data, targets, safety, consent) and what changed
├── design/                  logo source files
├── vercel.json              hosting, rewrites and security headers (HSTS, CSP)
├── .env.example             every server variable, with notes
└── package.json             scripts only, no dependencies
```

## Checks

```
npm run test:api       # the AI function in scan off mode and with AI on, with a fake Claude (no cost)
npm run test:safety    # the assistant's red flag rules
npm run test:site      # phone and desktop in Chrome, both modes (needs Playwright)
npm run test:pwa       # service worker, offline, install (needs Playwright)
```

Going live: follow `docs/DEPLOY.md`.
