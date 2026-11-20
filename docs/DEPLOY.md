# Put ThaliHeal live on Vercel

Time needed: about 15 minutes the first time. You need two free accounts: **GitHub** (stores the code) and **Vercel** (runs the site). No API key, no database and no environment variables: the prototype goes live in **scan off mode**. You can turn AI on later in a few minutes (see "Turn AI on later" at the end).

What is already set up in the code, so you do not touch it:
- **Scan off mode is the default.** While `AI_ENABLED` is not `true`, photo scanning, the assistant and test mode show a friendly "coming soon" instead, and `/api/ai` answers "scanning is off" without needing any variable. Everything else works: the 25 sample dishes, adding dishes by hand, My log with trends and gaps, targets, profile, privacy and consent, CSV and JSON exports, and the fun fact popup.
- ThaliHeal is a mobile first website: one column on phones, a top menu and wider layouts on computers. It can also be added to a home screen (manifest, icons, a service worker for fast and offline opening). See Step 5.
- `vercel.json` tells Vercel to run one small build step (it writes the AI switch for the page and stamps a new version on the offline cache), that the site lives in `public/`, plain links like `/scan` open the right screen, unknown pages show a friendly 404, and the security headers (HTTPS only, the page may only load its own files).
- Every screen uses a `#` address (`/#track`, `/#profile`), so refreshing any screen keeps you on it.
- The site is https only: Vercel serves https, `vercel.json` sends HSTS and upgrades any http request, and the page itself switches an http address to https before loading.

---

## Step 1: Create the GitHub repository

1. Unzip `thaliheal.zip` into a folder, for example `Documents/thaliheal`.
2. Go to **github.com**, click **+** (top right), then **New repository**.
3. Name it `thaliheal`. Choose **Private**. Do **not** tick "Add a README", ".gitignore" or "licence": the project already has them.
4. Click **Create repository**. Keep the page open and copy the address that looks like `https://github.com/YOUR-NAME/thaliheal.git`.

## Step 2: Push the code to GitHub

**Option A, the terminal** (needs Git from git-scm.com). Open a terminal in the `thaliheal` folder and run:

```
git init
git add .
git status
```
Look at the list: you should see `api/`, `public/`, `lib/`, `vercel.json`, `.env.example` and so on, and **no** `.env` or `.env.local`. Then:

```
git commit -m "ThaliHeal first deploy"
git branch -M main
git remote add origin https://github.com/YOUR-NAME/thaliheal.git
git push -u origin main
```
The first push opens a GitHub sign in window. GitHub no longer accepts your account password in the terminal, so sign in through that window.

**Option B, no terminal:** install **GitHub Desktop**. File, Add local repository, pick the `thaliheal` folder, click "create a repository" when it offers, then **Publish repository** and keep "Keep this code private" ticked.

Check: refresh your repository page on GitHub. You should see the folders and `vercel.json`.

## Step 3: Connect the repository to Vercel and deploy

1. Go to **vercel.com** and sign up or log in **with GitHub**.
2. Click **Add New**, then **Project**.
3. Find `thaliheal` and click **Import**. If it is not listed, click "Adjust GitHub App Permissions" and give Vercel access to that repository.
4. On the setup screen:
   - **Framework Preset:** Other
   - **Root Directory:** leave it as it is
   - **Build and Output Settings:** leave them alone (`vercel.json` handles them)
   - **Environment Variables:** leave empty. Nothing is needed in scan off mode.
5. Click **Deploy** and wait about a minute. You get a live link, for example `https://thaliheal.vercel.app`.
6. Check: open `https://YOUR-ADDRESS/api/ai` in a browser. You should see `"enabled":false` and `"code":"scanning_off"` with a short message. That is scan off mode working, not an error.

You are live.

---

## Step 4: Test on your phone

**Open it**
1. On your phone, open your live address in **Chrome** (Android) or **Safari** (iPhone). Vercel gives every site HTTPS automatically: you will see the lock icon.
2. Optional, but it feels like a real app: add it to your home screen (Step 5).

**What to try, and what you should see**

| Try this | You should see |
| --- | --- |
| Open the home screen | The slate hero with the chole thali plate, then My log, Profile and the 25 sample dishes |
| Tap **Scan my plate** (or Scan in the top menu on a computer) | "Photo scanning is coming soon", with **Add dishes by hand** and **Browse sample dishes** |
| Tap **Add dishes by hand**, then **＋ Add a dish** | The food table picker; the dish lands on your plate with a portion you can change |
| Tap a sample dish card | Its page with reference values from your dishes PDF |
| Read and agree to the notice, fill the profile | Your ICMR NIN 2020 targets |
| Add a dish, then **Save this plate** | "Saved to Lunch..." and the meal in **My log**, with trends and gaps |
| My log, **Download my log (CSV)** | A CSV file in Downloads that opens in Excel or Google Sheets |
| Open Ask (the assistant) | "The assistant is coming soon" |
| Settings | Test mode explains it needs scanning; there is no switch to turn it on |
| Wait a few seconds on the home screen | A "Did you know?" fun fact pops up, then one every 20 seconds |
| Pull down to refresh on any screen | You stay on the same screen |

## Step 5: Add it to your home screen (optional) and check it

ThaliHeal is a website, so nobody has to install anything. It can still sit on a home screen like an app. What that gives you:
- **Install option in Chrome:** Chrome shows an **Install app** button in the site's top bar, and **Install app** or **Add to Home screen** in the ⋮ menu. Chrome waits until you have used the page for a little while (about 30 seconds) before it offers the button.
- **Fast opening:** after the first visit, the page, scripts, data, fonts and home photos open from the phone itself.
- **Offline:** with no connection, the app still opens, and your log, profile and targets work. A slate bar says you're offline, and any other page shows a friendly "You're offline" screen.
- **Never stored on the phone by the app's cache:** AI answers (anything under `/api/`) and your plate photos.
- **Updates:** after each deploy, the app shows "A new version of ThaliHeal is ready. Refresh" instead of changing under you mid scan.

**Install it**
- Chrome on a phone: open your live link, use it for half a minute, then tap **Install app** (top bar or ⋮ menu). Long press the icon for shortcuts: Scan, My log, Ask.
- Chrome or Edge on a computer: the install icon at the right of the address bar.
- iPhone, Safari: **Share**, then **Add to Home Screen**. (iPhones have no install prompt, so there is no Install button there.)

**Check it on your computer (Chrome)**
1. Open your live link in desktop Chrome, press **F12** (or right click, Inspect) and open the **Application** tab.
2. **Manifest:** shows the name, colours, icons (including the maskable one) and screenshots. The **Installability** section should list no errors.
3. **Service workers:** `sw.js` should be "activated and is running".
4. **Cache storage:** you should see `thaliheal-shell-...` (about 32 files) and, after browsing sample dishes, `thaliheal-media-v1`. Nothing from `/api`.
5. Offline test: in the **Network** tab set throttling to **Offline**, then reload. The app still opens with the offline bar.

**Check it with Lighthouse**
Lighthouse no longer has a PWA section in Chrome's own Lighthouse tab (Google removed it in 2024, because Chrome's install checks now live in the Application tab above). Two ways:
- **The old PWA checklist, from the command line** (needs Node.js installed):
  ```
  npx lighthouse@11 https://YOUR-ADDRESS --only-categories=pwa --form-factor=mobile --view
  ```
  It opens a report. You want everything green: "Web app manifest and service worker meet the installability requirements", "Configured for a custom splash screen", "Sets a theme color", "Manifest has a maskable icon", plus the HTTPS checks. On my local run it scored 100.
- **Speed and quality:** in Chrome DevTools open the **Lighthouse** tab, choose **Mobile**, tick Performance, Accessibility and Best Practices, and click **Analyze page load**.

**Check it on the phone itself (optional)**
Connect the Android phone to your computer by USB with USB debugging on, open `chrome://inspect` in desktop Chrome, and click **inspect** under your site: you get the same Application tab for the phone.

## If something is off

| What you see | Why, and the fix |
| --- | --- |
| Scan says "coming soon" | Expected in scan off mode. To turn scanning on, see "Turn AI on later" |
| `/api/ai` shows `"enabled":true` but you never set it | `AI_ENABLED` is set to `true` in Vercel. Delete it (or set `false`) and redeploy |
| Your log is empty on another phone | Expected for now: on the web, each phone keeps its own log (there is no login yet) |
| The CSV opens with odd letters in old Excel | Use Data, From Text/CSV and pick UTF-8. The file already starts with the mark Excel looks for |
| No Install app option in Chrome | Use the page for about 30 seconds first. If it still does not appear, check DevTools, Application, Manifest, Installability for the reason. It is also hidden once the app is installed |
| Old version keeps showing after a deploy | Tap **Refresh** on the "new version" bar, or close every ThaliHeal tab and open it again |

With AI on, also see the table at the end of "Turn AI on later".

## Updating the site later

Change files on your computer, then:
```
git add .
git commit -m "What you changed"
git push
```
Vercel redeploys on its own within a minute. Pushes to other branches get their own preview link (covered by the `thaliheal-*.vercel.app` pattern).

## Turn AI on later

Do this when you are ready for real photo scanning, the assistant and test mode. About 15 minutes.

1. **Claude API key.** Go to **console.anthropic.com**, add a payment method and some credit under Billing, and set a **monthly spend limit** (your safety net: Anthropic stops at that amount whatever happens). Open **API keys**, create one named `thaliheal` and copy it. Never paste it into any file in the project.
2. **Rate limit database (free).** In your Vercel project open **Storage**, choose **Upstash** (Redis) from the Marketplace, the free plan, a region close to India (Mumbai, if offered), and connect it to the `thaliheal` project for all environments. It adds `KV_REST_API_URL` and `KV_REST_API_TOKEN` for you.
3. **Variables.** In **Settings, Environment Variables**, add:

| Name | Value |
| --- | --- |
| `AI_ENABLED` | `true` |
| `ANTHROPIC_API_KEY` | the key from point 1 |
| `ALLOWED_ORIGINS` | your live address plus the preview pattern, for example `https://thaliheal-abcd.vercel.app,https://thaliheal-*.vercel.app` (https, no slash at the end, commas, no spaces) |
| `RATE_LIMIT_SALT` | any long random text, at least 24 characters (`node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"`) |

4. **Redeploy.** Variables only reach new deployments: **Deployments**, the latest one, **⋯**, **Redeploy**. The build switches the page to AI on.
5. **Check.** `https://YOUR-ADDRESS/api/ai` should show `"enabled":true` and `"configured":true`. If `configured` is `false`, open **Logs**: it names the missing variable. On the site, Scan now opens the camera, Ask works after you turn the assistant on, and Settings shows the Test mode switch. Then check your first few scans in the Anthropic Console, **Usage**, and set `GLOBAL_DAILY_LIMIT` so that limit × cost per scan is a daily amount you are comfortable with.

**To turn it off again:** set `AI_ENABLED` to `false` (or delete it) and redeploy. The other variables can stay.

**With AI on, what to try**

| Try this | You should see |
| --- | --- |
| Scan my plate, then **Open camera** | The live camera fills the screen, back camera first. The first time, the browser asks to use the camera: tap **Allow** |
| Fit the plate inside the gold circle, tap the shutter, then **Scan plate** | "Photo ready, about 300 to 500 KB", then your dishes after 20 to 40 seconds |
| Tap **Upload a photo** instead | Your gallery or files (on a computer you can also drop or paste a photo) |
| Block the camera in the site settings, then tap **Open camera** | A message saying how to allow it again; the phone's own camera app opens as a fallback |
| Tap scan more than 6 times inside a minute | A polite message to wait a minute (your rate limit working) |

| If you see | Why, and the fix |
| --- | --- |
| "Scanning is not set up on this site yet" | `/api/ai` says `configured:false`. A required variable is missing. Logs name it; add it and redeploy |
| A scan fails, and Logs show a 403 | `ALLOWED_ORIGINS` does not match the address in your phone's address bar exactly. Fix it (https, no ending slash) and redeploy |
| A scan fails, and Logs show 502 or "claude error 401" | The API key is wrong, or your Anthropic account has no credit |
| "You've reached today's scan limit" | Working as designed. Raise `RATE_LIMIT_PER_DAY` if needed and redeploy |
| Camera blocked | Phone Settings, your browser, Camera, Allow. On iPhone also check Screen Time limits |

## All variables, for reference

**In scan off mode: none.** Leave `AI_ENABLED` unset (or `false`) and the site runs with no variables at all.

**With AI on** (Vercel, your project, **Settings, Environment Variables**; tick Production and Preview; redeploy after any change; for your own computer put the same names in `.env.local`, copied from `.env.example`):

| Variable | What it is |
| --- | --- |
| `AI_ENABLED` | `true` turns AI on. Anything else, or nothing, keeps scan off mode |
| `ANTHROPIC_API_KEY` | Your Claude API key |
| `ALLOWED_ORIGINS` | Your site's https addresses; requests from anywhere else, and from any http page, are refused |
| `KV_REST_API_URL` and `KV_REST_API_TOKEN` | Added for you by the Upstash connection. `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` also work if you set Upstash up yourself |
| `RATE_LIMIT_SALT` | Random text used to scramble IP addresses before counting |

With AI on, the live and preview sites refuse to call Claude until all of these are set, so the site can never call Claude without limits.

Optional, with defaults: `RATE_LIMIT_PER_MINUTE` (6), `RATE_LIMIT_PER_DAY` (60), `GLOBAL_DAILY_LIMIT` (500 a day for the whole site), `MAX_BODY_BYTES` (2,500,000), `MAX_IMAGE_BYTES` (1,800,000), `MAX_IMAGES` (1), `MAX_PROMPT_CHARS` (40,000), `MAX_OUTPUT_TOKENS` (2,000), `AI_MODEL_QUICK` / `AI_MODEL_DEFAULT` / `AI_MODEL_COMPLEX` (claude-haiku-5-5 / claude-sonnet-5-5 / claude-opus-5-5), `TESTER_TOKEN` (your own key for test mode; type the same value under Settings, Tester key), `TESTER_PER_MINUTE` (30), `TESTER_PER_DAY` (400).

## How the bill is protected

In scan off mode nothing can cost money: `/api/ai` answers before it reads a request, and never calls Claude or the rate limit store. With AI on: Origin check, per person limits per minute and per day, one global daily cap, size checks before and while reading, one photo per request, capped prompt and reply length, the model chosen by the server (the most expensive one only with your tester key), and a fixed instruction that refuses anything that is not a ThaliHeal task. Your Anthropic spend limit sits behind all of it.

## Checks you can run on your computer

`npm run test:api` (the AI function in both modes, with a fake Claude and fake Redis, costs nothing), `npm run test:safety` (48 red flag cases), and with Playwright installed: `npm run test:site` (phone and desktop over https, in scan off mode and with AI on: coming soon screens, adding dishes by hand, profile, targets, My log, CSV export, privacy, consent, sample dishes, fun facts, and with AI on the live camera, upload, drop, a blocked camera, the scan and test mode), `npm run test:pwa` (service worker, installability, offline, update flow, nothing from the API cached) and `python3 scripts/test_web.py`.

`npm run build` writes `public/js/flags.js` (the AI switch the page reads first) and regenerates `public/sw.js`. Vercel runs it on every deploy. Edit `scripts/sw.template.js`, never `public/sw.js`.

## Before a public launch

- **Accounts:** on the web there is no login yet. Each phone keeps its own profile and log, and clearing browser data deletes them. For accounts across devices, add an auth and database service such as Supabase next.
- **Grievance contact:** fill in `GRIEVANCE` in `public/js/privacy.js`, and get the notice and disclaimers reviewed.
- **Photos and name:** clear the rights to the four plate photos, and run a trademark search on ThaliHeal.
- **Vercel plan:** the free Hobby plan is meant for personal projects. Check Vercel's plan terms before a commercial launch.
