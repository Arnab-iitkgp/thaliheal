# ThaliHeal prototype: project notes

Last updated 14 Nov 2026 (Vercel ready: API proxy, environment variables, rate and size limits).

## How to run it

- Hosted: open the ThaliHeal link inside Claude while signed in. Photo scanning and test runs call Claude through the page, so no API key is needed. The first scan asks you to allow the page to use Claude.
- Locally (layout and manual entry only, no scanning): from this folder run `python3 -m http.server 8000` and open `http://localhost:8000`. Scanning and test runs need the hosted version.
- Test mode: Settings, switch Test mode on, then Open test mode.
- Log: Home, Profile (fill in and agree), then scan or add a plate and tap Save this plate. Home, My log shows Day, Week and Month.
- Safety rules: `node scripts/test_safety.js` (48 adversarial cases).
- Browser checks: `python3 scripts/test_v5.py` (consent, assistant, red flags, privacy, delete), `python3 scripts/test_v4.py` (profile, log, trends, gaps, delete, signed out) and `python3 scripts/test_v3.py` (scan and test mode), both with a mocked Claude.

## Files

| File | What it is |
| --- | --- |
| `index.html` | Markup and styles for every screen |
| `js/core.js` | Shared code: data loading, nutrition maths, portion ranges, the model prompt, Claude access, dish picker, screen routing, fun fact control |
| `js/home.js` | Home (Scan me, My log, Profile, Sample dishes), sample dish pages, settings (incl. delete my data) |
| `js/targets.js` | Daily energy and nutrient targets from ICMR NIN 2020. Pure maths, runs in Node too |
| `js/sources.js` | Indian food sources per nutrient, diet filters, top dishes from the food table |
| `js/account.js` | Sign in (Claude account), consent, profile and meal storage, delete all |
| `js/tracker.js` | Profile screen and My log (day, week, month trends, gap flags) |
| `js/safety.js` | Red flag rules before the assistant and the reply guard after it. Pure, runs in Node |
| `js/assistant.js` | AI assistant screen: builds the data summary, calls Claude, applies the guard |
| `js/privacy.js` | Consent notice and privacy controls (download, assistant on or off, delete) |
| `js/scan.js` | Scan screen: photo, editable dishes with ranges and confidence, plate total |
| `js/test-mode.js` | Test mode: test set, uploads, two model runs, metrics, reports, CSV export |
| `data/dishes.json` | App food table v0.3.0: 140 dishes, per 100 g nutrients excluding added fat, added sugar, minerals and vitamins (`micro`), diet flags, household units, oil or ghee defaults, dish type |
| `data/sample_dishes.json` | The 25 dishes from the dishes PDF, values as printed, plus name match rules for test mode |
| `img/samples/` | Dish photos from the PDF, white borders trimmed (shown on the home screen and dish pages) |
| `img/test/` | Test copies of the same photos; the printed name label is cropped off photos 1 to 6 |
| `funfact-popup.js` | Fun fact popup module, used exactly as supplied |

## Screens

- `#home`: Scan me, then Sample dishes (25 cards).
- `#dish-s01` to `#dish-s25`: photo, serving and weight, kcal, protein, carbs, fat, fibre, an oil and ghee note. Marked as reference values from the dishes PDF. A dash means the PDF gives no value (sugar is never given, so it is not shown).
- `#scan`: photo, editable dish list, plate total. Every dish shows an 80% range for grams and kcal plus a High, Medium or Low confidence label.
- `#profile`: age, sex, height, weight, optional waist, activity, goal, diet type, life stage (women). Shows BMI with Asian Indian cut offs and the daily targets with their sources.
- `#track`: My log. Day (logged so far against targets, meals, delete), Week and Month (trend chart for any nutrient with the target band, averages, gap flags with Indian food sources).
- `#ask`: the AI assistant.
- `#consent`: the notice and consent screen (shown before the profile, log or assistant can be used).
- `#privacy`: consent status, assistant on or off, download my data, delete my data, grievance contact.
- `#settings`: account and data link, Hide calorie numbers, Test mode switch.
- `#test`: Test set, Run, Results tabs. Only reachable when the switch is on.

## Ranges and confidence

- The model gives a best guess and an 80% range for each portion (`grams_low`, `grams_high`).
- Calories come from the food table, never from the model. The kcal range covers the portion range plus oil uncertainty (0.6x to 1.5x of the estimated oil). Oil typed in by the user is taken as given.
- The confidence label combines the model's certainty about the dish with the data quality of the table row.

## Test mode

- **Test set**: the 25 PDF photos with the PDF's weight and calories as true values, plus your own uploads. For an upload you give one or more dishes, each with a dish type (dal, sabzi, rice, roti, curry, fried snack, sweet, other), an optional exact dish from the food table, the true weight, the oil or ghee used if known, and photo conditions (angle, plate type, reference object, lighting, notes).
- **True calories for uploads**: computed from the food table (dish per 100 g at your weight, plus your oil at 9 kcal per g, or the table's home oil default if you leave oil blank). You can type your own number to override. Without an exact dish, enter calories yourself.
- **Runs**: pick two models (Claude Opus 5.5, Sonnet 5.5 or Haiku 5.5). Both get the same photos, the same prompt as normal scans (`PROMPT_VERSION` in `js/core.js`) and the same settings (no answer caching, platform default thinking). Each result saves the model requested, the model that actually answered and the tier. Results warn when the platform answered with a different model.
- **Matching**: model items go to the true dish with the same exact dish first, then the same dish type (closest weight). Leftover model items are recorded as extra items. A true dish with nothing assigned is recorded as missed.
- **Named correctly**: PDF dishes use the name groups in `sample_dishes.json` (every part of a composite plate must be found, by table dish, a word in the model's label or a dish type). Uploads use the exact dish if you gave one, otherwise the dish type.
- **Recorded per dish and per plate total**: model estimate, 80% range, true value, signed error, absolute error, signed and absolute percentage error, for grams and calories; whether the dish was named correctly; whether the true value fell inside the range.
- **Reports** (per model, overall, plate totals and by dish type): mean absolute percentage error, median absolute percentage error, mean absolute error, mean signed error (bias), named correctly, share inside the range. Portions under 30 g are flagged and left out of percentage errors.
- **Export**: detail CSV (one row per dish per model per photo, plus a plate total row) and summary CSV.
- **Storage**: test photos and results are kept in a private test area per person (`data/users/<id>/testmode` in the page's database, photos as page assets), apart from everything else. Signed out, they live only in the open tab. Nothing from test mode is ever used in the scan prompt or to tune anything.

## Caveats on the PDF test set

- The PDF values are printed estimates ("approximate estimates per stated serving"), not weighed or lab measured. Results on this set measure agreement with the PDF, not true accuracy.
- Photos 1 to 6 are very small (about 170 by 90 pixels after cropping the label). The photos look illustrative rather than real phone photos.
- Composite plates (for example Idli Vada Sambar, Roti Sabji Dal) have only a plate total, so they are scored as one dish.
- None of the 25 PDF dishes were added to the app food table, so the test scores the app as it really works.

## Fun fact popup

- Loaded once with a script tag and started once after page load (`window.__funFactStarted` guard). The module file is not edited or restyled.
- Hidden and held back on the scan screen, on the test mode screens and while the dish picker is open. One fact is shown on purpose while a photo is being analysed, unless the user has paused facts.
- To edit the list, use `funfacts.json` and start the module with `FunFact.init({ factsUrl: "funfacts.json" })`.
- Away alerts may show "Notifications blocked" on the hosted link, because browsers usually block notification permission in the frame the app runs in.

## Fun facts are not medical advice

The fun facts are general awareness lines, not medical or nutrition advice for any individual. Before public launch, every fact must be matched to a citable source, for example ICMR NIN 2020 (RDA and EAR), IFCT 2017, Dietary Guidelines for Indians 2024, NFHS 5, ICMR INDIAB or Swiggy annual reports. Facts that cannot be sourced should be removed or reworded. Check calorie facts against `data/dishes.json` so the popup and the app agree (for example, the dal fry fact says about 118 kcal per 100 g, while home style dal tadka in the table is about 88 kcal per 100 g including ghee).

## Data notes

- Indian dishes: per 100 g values calculated from IFCT 2017 ingredient values with standard recipes and cooked yields written for this prototype. Recipe quantities are estimates and need dietitian review. 25 home style sabzis were added on 14 Nov 2026 (tinda, turai, karela, parwal, arbi, kaddu, aloo methi, aloo palak, gobi, beans, gajar matar, aloo shimla mirch, aloo baingan, bharwa baingan, gavar, kathal, sem, lauki chana dal, aloo tamatar, matar mushroom, paneer bhurji, soya chunks, and generic green leafy, masaledar and dry sabzi).
- The Indian Nutrient Databank (INDB) is not included yet: it could not be downloaded in this session.
- Added oil, ghee and butter are separate items. `added_fat` gives grams of fat per 100 g of dish for home, restaurant and street cooking.
- Fast food items and soya chunks use typical published values and are marked as estimates.
- IFCT data needs written permission from ICMR NIN before commercial use.

## Login, profile and meal log

- **Login** is the viewer's Claude account (the page's `user` capability). No passwords are kept. The name shown comes from the Claude profile and is never stored.
- **Storage**: `data/users/<id>/tracker` holds `{profile, consent, updated}`; meals are in `data/users/<id>/tracker/meals/<meal id>`. This area is private to each person, not readable by the app owner, and separate from test mode (`.../testmode`). Outside Claude, or if the database fails, the profile and log fall back to this browser only and the screen says so.
- **Consent** now lives on its own screen (see below). Older consents without purposes are asked again.
- **A saved meal** keeps the items as edited (dish, grams and 80% range, oil, confidence) and totals fixed at save time, including the kcal range, so later food table changes do not rewrite history. Meals are saved from the scan screen (Save this plate). Add a meal on the log opens the same screen with the day and meal set, so scanning and adding by hand share one editor. The example plate cannot be saved.

## Targets (js/targets.js)

- **Energy method: ICMR NIN 2020 factorial, not Mifflin St Jeor.** The research (section 3) rates ICMR factorial "best default" and Mifflin St Jeor "use with caution" because it overestimates BMR in Asian samples. Mifflin is shown on the profile for comparison only.
- BMR = FAO/WHO/UNU 2004 equation for age band, less 10% for men and 9% for women (RDA 2020 short report). TEE = BMR x PAL (1.4 sedentary, 1.8 moderate, 2.3 heavy). Check: reference man 65 kg gives 2,105 / 2,707 / 3,459 kcal and reference woman 55 kg gives 1,658 / 2,132 / 2,724, against ICMR's 2,110 / 2,710 / 3,470 and 1,660 / 2,130 / 2,720.
- Goal: lose = 500 kcal below TEE when BMI is 23 or more, 300 below when lower; never below BMR or 1,200 kcal. Gain = 300 above. Target shown as a band of ±10%.
- Nutrients, adults (ICMR NIN 2020): protein EAR 0.66 and RDA 0.83 g/kg (weight capped at BMI 23, an app choice); iron 11 to 19 mg men, 15 to 29 mg women; calcium 800 to 1,000 mg (1,000 to 1,200 after menopause); zinc 14 to 17 mg men, 11 to 13.2 mg women; magnesium, folate, vitamin C and vitamin A use the RDA with the lower end at 80% (NIN brief note: EAR is about 80% of the RDA). Fibre 30 / 40 g men, 25 / 30 g women (sedentary / moderate; heavy uses moderate). Visible fat (added oil and ghee) 25 / 30 / 40 g men, 20 / 25 / 30 g women. Total fat at most 30% of energy and added sugar under 5% (DGI 2024).
- **To verify before launch** against the full RDA 2020 book: EAR values for magnesium, folate, vitamin C and vitamin A (80% rule used), the heavy activity fibre value, the 8:1 beta carotene to vitamin A factor, and the post menopause EAR.

## Safety rules built in

- 18 and over only: no targets and no saving for anyone younger.
- Pregnant or breastfeeding: no targets, a referral to a doctor or dietitian instead; logging still works.
- No weight loss target when BMI is under 18.5; calorie floor at BMR and 1,200 kcal.
- Gaps read "Logged intake below target", never "deficient". A red flags box sends symptoms to a doctor. If the logged average sits well below BMR over 3 or more full days, a gentle note suggests checking the log or talking to a doctor or dietitian.
- Over 65 and waist above the Asian Indian cut off (90 cm men, 80 cm women) add notes.

## Trends and gaps

- A day counts toward averages once two or more meal slots are logged; partial days are shown lighter and left out.
- Week = last 7 days, Month = last 30 days, ending on the chosen date. The chart can show energy or any tracked nutrient, with the target band (or limit line), tap for the day's figure, and a table view.
- Status per nutrient: below the lower end = gap, between = close, at or above the RDA = met; limits flag when above. Vitamin A is shown only, never flagged (weak data).
- Minerals and vitamins are only flagged when at least 70% of logged kcal came from dishes with that data (fast food rows have none).
- Each gap opens Indian food sources for the person's diet type (vegetarian, eggetarian, non vegetarian, vegan, Jain): a short list from the research (section 6), the top three dishes from the food table per serving, and an absorption tip. Fibre, magnesium and vitamin C lists are general guidance pending dietitian review.
- Not counted: vitamin B12, vitamin D, iodine and salt. The log lists diet filtered sources for each instead.

## Food table v0.3.0 additions

- `micro` per 100 g: iron, calcium, zinc, magnesium (mg), folate, vitamin A (µg), vitamin C (mg), from IFCT 2017 ingredient values. Vitamins in cooked dishes are multiplied by 0.7 (calculated vitamins run 32% to 45.5% high, Chiplonkar and Agte 2007). Added fat adds none. IFCT gives no retinol for milk, so dairy vitamin A is undercounted.
- `added_sugar` per 100 g from sugar, jaggery, ketchup and bread in the recipe; set by hand for fast food.
- `flags`: dairy, ghee_fat, egg, meat, fish, jain_avoid (roots, tubers, onion, mushroom), from the recipe; set by hand for fast food. Used to filter suggestions by diet.

## AI assistant (js/assistant.js)

- Answers only from a DATA block built in the page: profile, BMI, targets, 7 and 30 day averages with statuses, daily totals for 14 days, meals for 7 days, top sources of each nutrient in the log, the app's diet filtered food suggestions, and what is not counted. About 8 KB. Nothing else is sent.
- Needs consent purpose B (separate from the log), a profile and Claude. Chat lives in memory only and is never saved.
- The prompt forbids outside knowledge, diagnosis, doses, advice on symptoms, diseases or medicines, eating below target, skipping meals, fasting and body comments. The model replies in JSON with `reply`, `basis` (shown as "From: ...") and `refer`.
- Extra prompt rules by person: pregnant or breastfeeding (report the log only, no suggestions), food feels hard this session (no numbers or plans), logged average well below BMR (never suggest eating less), over 65 (any symptom goes to the doctor).

## Red flag rules (js/safety.js)

Every question is checked before the model. A match gets a fixed reply and the model is not called. First match wins:

| Order | Rule | Examples | Reply |
| --- | --- | --- | --- |
| 1 | Crisis | suicide, self harm, ending my life | Tele MANAS 14416 (free, 24x7), 112 if in danger, tell someone you trust |
| 2 | Emergency | chest pain, fainting, can't breathe, vomiting blood | Doctor now; 112 or nearest emergency |
| 3 | Eating disorder signals | purging, laxatives, diet pills, starving, 500 to 1,100 kcal a day plans, binge, fear of eating, fast weight loss | Supportive, no numbers or plans, doctor or someone trusted, Tele MANAS. Turns on no numbers mode for the session and offers Hide calorie numbers |
| 4 | Minor (self) | I'm 16, in class 11, a teenager | Adults only; talk to a parent and doctor; ask a parent to help delete data. Assistant locked for the visit |
| 5 | Pregnancy | pregnant, trimester, breastfeeding, trying to conceive, IVF | Doctor or dietitian; set life stage in Profile |
| 6 | Child | my son, my baby, feed my child | Own log only; paediatrician; under 5 any symptom to a doctor |
| 7 | Symptoms (research list) | tired all the time, breathless, dizzy, tingling, numbness, memory, blood in or black stool, heavy periods, weight loss without trying; thakan, chakkar, kamzori | Doctor, not diet tips; blood test; download the log to show them |
| 8 | Conditions and medicines | diabetes, sugar levels, thyroid, PCOS, kidney, liver, heart, BP, cholesterol, anaemia, allergy, on medicines | Doctor or registered dietitian; can still show the log |
| 9 | Supplements and doses | supplement, tablet, dose, 60K | Doctor or pharmacist; never above the label |
| then | Diagnosis questions | do I have, am I deficient, what's wrong with me | Goes to the model, but starts with a fixed "I can't tell whether you have any condition or deficiency" line |

After the model, `guard()` replaces any reply that suggests a condition or deficiency, gives a dose, suggests skipping meals or fasting, or (in no numbers mode) shows kcal, kg or BMI. Sentences that refuse to diagnose are allowed.

Known limits: keyword rules miss unusual phrasing and other languages (only a few Hinglish words are in). Test adversarially with real users and a clinician before launch, as the research recommends.

## Minors, pregnancy and eating disorder safeguards

- Minors: 18+ tick box on the consent screen; profile cannot be saved under 18; chat statements of being under 18 lock the assistant and point to deleting data.
- Pregnancy and breastfeeding: life stage switches off targets and gap flags, the assistant only reports the log, and chat mentions get a referral.
- Eating disorder signals: calorie floor at BMR and 1,200 kcal, no weight loss below BMI 18.5, low logged intake note, chat signals, no numbers mode, and Hide calorie numbers (Settings) for My log, Profile and Home. The scan screen still shows plate calories.

## Consent and DPDP (js/privacy.js)

- Built for the DPDP Act 2023 and DPDP Rules 2025, whose notice, consent and children's data duties apply from 13 May 2027.
- The notice stands on its own in plain English: what ThaliHeal is and is not, an itemised list of data, purposes A (log, required) and B (assistant, optional), where data is kept, rights, grievance contact and the Data Protection Board.
- Consent is per purpose with an 18+ tick box. The record keeps version, time, purposes and a short history (agreed, assistant on, assistant withdrawn). Changing the notice version asks everyone again.
- Rights: download everything as JSON (access), edit profile and delete meals (correction), turn the assistant off (withdrawal), Delete my data with an option to include test mode data (erasure).
- Data minimisation: chat, normal scan photos and names are not stored.
- **Before launch:** fill in the grievance contact (`GRIEVANCE` in js/privacy.js), offer the notice in Hindi and other Eighth Schedule languages, write a breach runbook (Board within 72 hours), add a nominee option, and get a legal review of the notice and disclaimers.

## Brand and look (14 Nov 2026)

- Name **ThaliHeal**, tagline **We Heal Your Plates!** "HealthKart" was asked for but is an existing Indian nutrition brand (Bright Lifecare: HealthKart, MuscleBlaze, HK Vitals), so it was not used. Run a trademark search on ThaliHeal before launch.
- Look: plates seen from above. Round photo crops with a brass (kansa) ring on tawa slate. Tokens: slate `#22282A`, curry leaf green `#1F5A44` (actions), brass `#B98A2E` (rings, wordmark, main button), haldi `#D99800`.
- Type: Bricolage Grotesque (display, wordmark) and Figtree (body), bundled in `fonts/` under the SIL Open Font License, because the page can only load its own files.
- Home: slate hero with the wordmark, tagline and a large chole thali plate that settles in once on load (skipped with reduced motion); a "Try a sample plate" strip that scans the tapped photo; the assistant card on slate.
- Small plate photos sit beside the titles of Profile, My log and Ask. The scan, consent, privacy and test screens stay plain on purpose.
- Photos in `img/plates/` were supplied by Atharva (four plates). They look like food blog photos and one carries a blog watermark: clear the rights or replace them before any public launch.

## Deployment (14 Nov 2026)

- The project is now a Vercel project: `public/` (the site), `api/ai.js` (Claude API proxy), `lib/`, `scripts/`, `docs/`. Paths in this file that say `js/...` or `data/...` are under `public/`.
- No key or secret is in front end code. The browser calls `/api/ai` with a prompt and at most one photo; the function holds `ANTHROPIC_API_KEY`, checks origin, size and rate limits, picks the model, and adds a fixed system prompt.
- `App.hosting` is "claude" inside Claude (artifact runtime) or "web" on Vercel. On the web: AI goes through `/api/ai`, profile and log stay in the browser, downloads are normal downloads, and the consent notice describes the server and the hashed IP used for limits. Consent version is now 2026-11-14.3, so people are asked again.
- The inline start script moved to `public/js/boot.js` so the site can forbid inline scripts (strict Content Security Policy in `vercel.json`).
- Variables, limits and steps: see `docs/DEPLOY.md`.
- Build config (14 Nov 2026): `vercel.json` sets framework Other, no build, output `public/`, rewrites for single word paths (`/scan`, `/dish-s05`) to `index.html` (core.js turns them into `#` routes), a styled `public/404.html`, HSTS and cache headers for images and fonts. Node 22 for the function.
- Phone: "Open camera" button (`capture="environment"`, phones only) beside the camera or gallery photo box; web app manifest and home screen icons. Checked on emulated Pixel 7 and iPhone 13 over HTTPS with `scripts/test_phone.py`.

## Installable app (PWA, 14 Nov 2026)

- `public/manifest.webmanifest`: id, name, short name, standalone display, portrait, theme and background `#22282A`, icons 48 to 512 (`img/icons/`), maskable 192 and 512, iOS 180 icon, shortcuts (Scan, My log, Ask) and install screenshots (`img/screens/`, made by `scripts/make_screens.py`).
- `public/sw.js` is generated by `scripts/build-sw.js` from `scripts/sw.template.js` (Vercel build step). It precaches the app shell (about 32 files, 960 KB) under a version taken from their contents, serves pages from the cached shell, keeps app images in a capped runtime cache, and never touches `/api/` or non GET requests. User photos are blobs and never cached.
- `public/offline.html` is shown for pages that need the network; inside the app a slate bar says you're offline. A failed request also counts as offline, because phones on Wi-Fi without internet still report online.
- Updates wait for the person: a brass bar offers Refresh, so a scan in progress is never wiped.
- Only on the web build. Inside Claude the service worker is not registered.
- Checked: Chrome installability errors none, Install prompt fires, Lighthouse 11 PWA score 100 locally (`scripts/test_pwa.py`).

## Android app (Capacitor 8, 14 Nov 2026): removed in 0.8.0
- The Capacitor shell, `android/`, `www/` and every native code path were removed on 16 Nov 2026. ThaliHeal is now one website. The 0.7.1 notes below mention the app for history only.

## 0.7.1 (15 Nov 2026): phone testing fixes
- Export in the Android app: files go to Documents/ThaliHeal (Android 11 and newer, no permission), else the share sheet; a Share button follows every save. New plugins `@capacitor/filesystem` 8.1.5 and `@capacitor/share` 8.0.3. No new Android permissions.
- Export on the web and PWA: the download link stays alive 60 s (Chrome on Android reads it late), Share where the phone can share files, and the status line says where the file went. CSVs start with a BOM so Excel shows non English letters.
- Test mode on the web and in the app keeps photos, runs and results in its own IndexedDB (`thaliheal-testmode`), apart from the meal log, so a run survives the camera, the picker or a restart. Delete my data removes it.
- Test mode: a picked photo is confirmed or rejected (HEIC) at once; runs stop on the daily limit, a dropped connection, a refused tester key or a server setup error; CSV names use the local date.
- Slow networks: 10 s limit on the status check (slow is not treated as offline), 100 s on scans and test calls, 75 s on assistant questions, "still working" lines at 45 s and 80 s. The offline bar rechecks the server every 15 s and clears itself.
- PWA: the 25 sample dish photos are precached, so sample cards open offline.
- Forms: long dish names no longer push the test form past the screen edge on phones.
- Away alerts on Chrome for Android: the popup's notifications go through the service worker (Chrome there refuses `new Notification()`); tapping one opens the app. `funfact-popup.js` itself is unchanged.
- Messages: "not on the allowed list" names the right origin per build; the Run tab no longer tells web users to open Claude.
- Tests: `scripts/test_fixes.py` (32 checks).

## Logo (15 Nov 2026)
- Approved logo: `design/logo-source.png`. Traced to a vector with `scripts/trace_logo.py` into `public/img/logo-mark.svg` (gold #D99B31; background green #024C36, both sampled from the approved image).
- `scripts/make_icons.py` rebuilds every icon from that vector: favicon (SVG and 32 px), PWA icons 48 to 512 (rounded), maskable 192 and 512, Apple touch icon, Android legacy, round and adaptive icons, splash screens, and the launcher background colour. `design/logo-icon.svg` is a square version for anything else (social profiles, store listings).
- Header mark uses the logo; the manifest background colour is the logo green, so the install splash matches. Install screenshots refreshed with `scripts/make_screens.py`.

## 0.8.0 (16 Nov 2026): one mobile first website, https only
- **No app build any more.** Removed: Capacitor and its plugins (camera, filesystem, share, app), `android/`, `www/`, `capacitor.config.json`, `mobile.config.json`, `js/config.js`, `scripts/build-mobile.js`, `scripts/android-apk.js`, the Android tests and `docs/ANDROID.md`. `package.json` now has no dependencies at all. `App.native` is gone; the API is always `/api/ai` on the same https origin.
- **Live camera in the browser** (`public/js/camera.js`): `getUserMedia` with the back camera first (`facingMode: environment`, up to 1920 x 1440), a gold circle to frame the plate, a shutter, a switch camera button when there are two or more cameras, and Escape or ✕ to close. The frame is captured at full size, then shrunk to a 1600 px JPEG like every other photo. The stream stops on capture, close, leaving the screen, hiding the tab or leaving the page. Clear messages for a blocked camera, no camera, a busy camera and a page that is not secure; on a phone the camera app opens as a fallback (`capture="environment"` input).
- **Upload**: the photo box takes JPEG, PNG or WebP from the gallery or files; on a computer a photo can also be dropped on the box or pasted with Ctrl+V.
- **https only**: `js/https.js` runs first in `<head>` and moves any http address to https (localhost stays as it is for development). Vercel serves https and `vercel.json` sends HSTS and `upgrade-insecure-requests`. The AI function refuses any page that is not https on Preview and Production, even if it is listed in `ALLOWED_ORIGINS`. Locally, `npm run dev` listens on 127.0.0.1 only; `npm run dev:https` makes a self signed certificate in `.cert/` with openssl and serves https on the network for phone tests.
- **Responsive**: phones keep the one column app layout. From 600 px the column widens; from 900 px there is a slate top menu (Home, Scan, My log, Ask, Profile, Settings; the current page in brass), a wide hero, five sample dishes per row, a two column scan screen (the photo stays in view on the left; the plate and Save to my log on the right) and the dish picker as a centred dialog.
- Kept as they were: the sample dishes section (all 25 from the dishes PDF), test mode with its own IndexedDB, CSV export as a browser download with a BOM (plus Share where the phone can share files), the fun fact popup (quiet on scan, coming soon, test, consent, ask, and while the camera or the dish picker is open), offline support and the update bar.
- Checks: `npm run test:site` (`scripts/test_site.py`), `npm run test:api`, `npm run test:safety`, `npm run test:pwa`.

## 0.9.0 (16 Nov 2026): scan off mode for the prototype
- **The switch:** `AI_ENABLED`. Only the exact value `true` (any case, spaces trimmed) turns AI on. Unset, `false` or anything else is scan off mode, and then no other variable is needed: not the API key, not Upstash, not `ALLOWED_ORIGINS` or the salt.
- **Server:** in scan off mode `/api/ai` answers GET and POST with HTTP 200 `{ enabled: false, configured: false, code: "scanning_off", message }` and the header `X-ThaliHeal-AI: off`, before reading the body, counting rate limits or calling Claude, from any page. With AI on, the status check adds `enabled: true` and everything works as in 0.8.0.
- **Page:** `scripts/build.js` (the Vercel build step, also run by `npm run dev`) writes `public/js/flags.js` from `AI_ENABLED`, loaded in `<head>`, so the page knows at once and marks `<html class="ai-off">`. The status check confirms it on start; if the two ever disagree the server wins and the screens follow.
- **With AI off:** Scan (hero button, top menu, the /scan link and app shortcut) opens `#soon`, "Photo scanning is coming soon", with Add dishes by hand (`#plate`, the scan screen without the camera and upload) and Browse sample dishes. The sample plate strip and the Ask card and menu link are hidden; `#ask` says the assistant is coming soon; Settings explains that test mode needs scanning, and `#test` goes back to Settings. My log's Add buttons open `#plate`. The AI assistant switch in Privacy is hidden.
- **New: CSV export of My log** (My log and Privacy): one row per dish with date, meal, time logged, source, where cooked, grams and kcal with ranges, protein, carbs, fat, fibre and sugar, added fat, confidence and food table version. UTF-8 with a BOM, so Excel opens it cleanly. Test mode CSV export is unchanged (AI on only).
- **Docs:** DEPLOY.md now goes live with no variables; "Turn AI on later" covers the key, Upstash, the four variables, redeploy and checks. `.env.example` starts with `AI_ENABLED=false`.
- Checks: `npm run test:api` (both modes), `npm run test:site` (phone and desktop, scan off mode and AI on), `npm run test:pwa`, `npm run test:safety`, `python3 scripts/test_web.py`.

