"""Site check in Chrome, on a phone and on a desktop, over https, at no cost (fake Claude, fake camera).
Part 1, scan off mode (AI_ENABLED=false, no key at all): /api/ai says scanning is off, Scan opens "coming soon",
adding dishes by hand, consent, profile and targets, saving to My log, CSV export from My log and Privacy, JSON
download, the assistant and test mode showing their off messages, sample dishes, fun facts, the desktop menu.
Part 2, AI on: no app code left, the live camera (open, shoot, stream stopped), a blocked camera, upload, drop, the scan,
the 25 sample dishes and a dish page, the top menu and two column scan screen on desktop, the fun fact popup timing
and quiet screens, test mode (photo kept after a reload, a run, CSV export with a BOM), and the http to https switch.
Needs Playwright for Python and Chrome. Run from the project folder: python3 scripts/test_site.py
Screenshots go to scripts/*.png (git ignored)."""
import asyncio, os, subprocess, sys, time
from playwright.async_api import async_playwright

PORT, HTTP_PORT, OFF_PORT = 8790, 8791, 8792
BASE = f"https://localhost:{PORT}"
OFF = f"https://localhost:{OFF_PORT}"
CHROME = os.environ.get("CHROME", "/usr/bin/google-chrome")
ARGS = ["--no-sandbox", "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream",
        "--host-resolver-rules=MAP thaliheal.test 127.0.0.1", "--disable-features=HttpsUpgrades,HttpsFirstBalancedModeAutoEnable"]
PHONE = dict(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True,
             user_agent="Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36")
DESK = dict(viewport={"width": 1440, "height": 900})
PHOTO = os.path.abspath("public/img/plates/chole.jpg")
results = []

async def wait_js(pg, expr, timeout=15000):
    """Polls a JS expression from outside the page, so the site's strict CSP (no eval) stays switched on."""
    end = time.time() + timeout / 1000
    while True:
        try:
            if await pg.evaluate(expr): return True
        except Exception:
            pass
        if time.time() > end: raise TimeoutError(f"timed out waiting for: {expr[:90]}")
        await asyncio.sleep(0.1)

def check(ok, what):
    results.append((bool(ok), what)); print(("PASS " if ok else "FAIL ") + what)

async def new_page(b, opts, errs, name, origin=BASE):
    ctx = await b.new_context(ignore_https_errors=True, accept_downloads=True, **opts)
    await ctx.grant_permissions(["camera"], origin=origin)
    pg = await ctx.new_page()
    pg.on("pageerror", lambda e: errs.append(f"{name} PAGEERROR {e}"))
    pg.on("console", lambda m: errs.append(f"{name} {m.text}") if m.type == "error" and "favicon" not in m.text and "SSL certificate" not in m.text else None)   # the service worker can't install on a self signed certificate
    return ctx, pg

async def ready(pg):
    await wait_js(pg, "window.App && App.current && App.dishes && App.dishes.length > 0", timeout=20000)
    await wait_js(pg, "App.claudeSample !== undefined && document.querySelector('#scanBtn')", timeout=20000)

async def download(pg, selector):
    async with pg.expect_download() as dl:
        await pg.click(selector)
    d = await dl.value
    return d.suggested_filename, open(await d.path(), "rb").read()

async def off_phone(b, errs):
    ctx, pg = await new_page(b, PHONE, errs, "off-phone", OFF)
    await pg.goto(OFF + "/"); await ready(pg)
    api = await pg.evaluate("""(async () => {
      const g = await (await fetch('/api/ai')).json();
      const r = await fetch('/api/ai', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ purpose: 'scan', prompt: 'x', images: [] }) });
      return { g, status: r.status, p: await r.json() }; })()""")
    check(api["g"].get("enabled") is False and api["g"].get("code") == "scanning_off" and "off" in api["g"].get("message", ""), "off: /api/ai status says scanning is off, with a message")
    check(api["status"] == 200 and api["p"].get("code") == "scanning_off", "off: a scan request gets a clear scanning is off answer (200), not an error")
    check(await pg.evaluate("document.documentElement.classList.contains('ai-off') && THALIHEAL_FLAGS.ai === false && App.aiEnabled === false"), "off: the page knows at once (flags.js) that AI is off")
    check(not await pg.is_visible("#plateStrip") and not await pg.is_visible(".ask-card"), "off: sample plate strip and Ask card hidden on home")
    n = await pg.locator("#sampleGrid .dish-card").count()
    check(n == 25, f"off: sample dishes section shows all {n} dishes")
    await wait_js(pg, "document.querySelector('.ff-card.ff-in')", timeout=8000)
    check(True, "off: fun fact popup appears on the home screen")
    await pg.screenshot(path="scripts/site_off_phone_home.png")
    await pg.click(".hero .btn-brass")
    await wait_js(pg, "App.current === 'soon'")
    h1 = await pg.text_content('[data-view="soon"] h1')
    check("coming soon" in h1.lower() and await pg.is_visible("#soonManual"), f"off: Scan my plate opens: {h1}")
    await pg.screenshot(path="scripts/site_off_phone_soon.png")
    await pg.goto(OFF + "/scan"); await ready(pg); await wait_js(pg, "App.current === 'soon'")
    check(True, "off: the /scan link also lands on coming soon")
    await pg.goto(OFF + "/#dish-s05"); await ready(pg)
    await wait_js(pg, "App.current === 'dish' && document.querySelector('#dishPage').textContent.length > 50")
    check(True, "off: a sample dish page opens")
    # consent and profile, then targets
    await pg.goto(OFF + "/#consent"); await ready(pg)
    await pg.check("#cAdult"); await pg.check("#cStore"); await pg.click("#cAgree"); await pg.wait_for_timeout(500)
    await pg.goto(OFF + "/#profile"); await ready(pg); await wait_js(pg, "document.getElementById('pAge')")
    await pg.fill("#pAge", "30"); await pg.click('[data-seg="sex"] [data-v="male"]'); await pg.fill("#pHeight", "175"); await pg.fill("#pWeight", "70")
    await pg.click("#pSave"); await pg.wait_for_timeout(500)
    prof = await pg.text_content("#profilePage")
    check("kcal" in prof and "Protein" in prof, "off: profile saves and shows ICMR NIN 2020 targets")
    # add a plate by hand and save it
    await pg.goto(OFF + "/#soon"); await ready(pg); await pg.click("#soonManual")
    await wait_js(pg, "App.current === 'scan' && location.hash === '#plate'")
    check(not await pg.is_visible("#camBtn") and not await pg.is_visible(".photo-ways") and not await pg.is_visible("#scanBtn") and await pg.is_visible('.photo-head.ai-off-only'),
          "off: Add dishes by hand opens the plate without camera, upload or Scan, with a coming soon note")
    check(not await pg.is_visible("#noScan"), "off: no 'not set up' warning on the plate screen")
    await pg.click("#clearBtn"); await pg.click("#addBtn"); await pg.wait_for_selector("#sheet:not([hidden])")
    check(not await pg.is_visible(".ff-pill"), "off: fun fact buttons step aside while the dish picker is open")
    await pg.fill("#search", "dal tadka"); await pg.wait_for_timeout(200); await pg.locator("#picks .pick").first.click()
    await wait_js(pg, "document.querySelectorAll('#items .item').length === 1")
    dish = (await pg.text_content("#items .dish-btn")).replace("change", "").strip()
    await pg.click("#logSave"); await wait_js(pg, "document.getElementById('logStatus').textContent.includes('Saved')")
    check(True, f"off: a hand built plate ({dish}) saves to My log")
    await pg.goto(OFF + "/#track"); await ready(pg); await wait_js(pg, "document.getElementById('logCsv')")
    check(dish.split(" ")[0] in (await pg.text_content("#trackPage")), "off: My log shows the meal with today's totals")
    name, raw = await download(pg, "#logCsv")
    text = raw.decode("utf-8-sig"); rows = [r for r in text.split("\r\n") if r]
    check(raw[:3] == b"\xef\xbb\xbf" and name.startswith("thaliheal-my-log-") and rows[0].startswith("date,meal,logged_at") and dish in rows[1], f"off: My log CSV export: {name}, {len(rows) - 1} row(s), with a BOM")
    await pg.screenshot(path="scripts/site_off_phone_track.png")
    # privacy: CSV and JSON, assistant switch hidden
    await pg.goto(OFF + "/#privacy"); await ready(pg); await wait_js(pg, "document.getElementById('dlCsv')")
    n2, raw2 = await download(pg, "#dlCsv")
    n3, raw3 = await download(pg, "#dlBtn")
    check(n2.endswith(".csv") and raw2[:3] == b"\xef\xbb\xbf" and n3.endswith(".json") and b'"meals"' in raw3, f"off: Privacy downloads {n2} and {n3}")
    check(not await pg.is_visible("#asSwitch"), "off: the AI assistant consent switch is hidden in Privacy")
    # assistant and test mode
    await pg.goto(OFF + "/#ask"); await ready(pg); await pg.wait_for_timeout(300)
    check("coming soon" in (await pg.text_content("#askPage")).lower(), "off: the assistant shows a coming soon message")
    await pg.evaluate("localStorage.setItem('thali.testMode', 'true')")
    await pg.goto(OFF + "/#settings"); await ready(pg)
    check(await pg.is_visible("#testOffCard") and not await pg.is_visible("#testSwitch") and not await pg.is_visible("#openTest"), "off: Settings explains test mode needs scanning, with no switch")
    await pg.goto(OFF + "/#test"); await ready(pg); await wait_js(pg, "App.current === 'settings'")
    check(True, "off: test mode stays hidden (the #test link goes back to Settings)")
    await ctx.close()

async def off_desktop(b, errs):
    ctx, pg = await new_page(b, DESK, errs, "off-desktop", OFF)
    await pg.goto(OFF + "/"); await ready(pg)
    check(not await pg.is_visible('[data-nav="ask"]') and await pg.is_visible('[data-nav="scan"]'), "off desktop: menu has Scan, and no Ask")
    cols = await pg.evaluate("getComputedStyle(document.querySelector('.track-cards')).gridTemplateColumns.split(' ').length")
    check(cols == 2, "off desktop: home cards close the gap left by Ask")
    await pg.click('[data-nav="scan"]'); await wait_js(pg, "App.current === 'soon'")
    check(await pg.get_attribute('[data-nav="scan"]', "aria-current") == "page", "off desktop: Scan opens coming soon, marked in the menu")
    await pg.wait_for_timeout(400); await pg.screenshot(path="scripts/site_off_desktop_soon.png")
    await ctx.close()

async def phone(b, errs):
    ctx, pg = await new_page(b, PHONE, errs, "phone")
    await pg.goto(BASE + "/"); await ready(pg)
    check(await pg.evaluate("!('Capacitor' in window) && !('native' in App) && App.apiUrl === '/api/ai'"), "no app code left: no Capacitor, no App.native, API on the same origin")
    check(await pg.evaluate("location.protocol") == "https:", "phone: served over https")
    check(not await pg.is_visible(".sitebar"), "phone: top menu hidden, the home screen leads")
    n = await pg.locator("#sampleGrid .dish-card").count()
    check(n == 25, f"sample dishes section shows all {n} dishes")
    await pg.wait_for_timeout(600); await pg.screenshot(path="scripts/site_phone_home.png")
    # fun fact popup: first one about 2 s after load, on the home screen
    await wait_js(pg, "document.querySelector('.ff-card.ff-in')", timeout=8000)
    check(True, "fun fact popup appears on the home screen within a few seconds")
    await pg.locator("#sampleGrid .dish-card").first.click()
    await wait_js(pg, "App.current === 'dish' && document.querySelector('#dishPage').textContent.length > 50")
    check(True, "a sample dish page opens")

    # scan screen and the live camera
    await pg.goto(BASE + "/#scan"); await ready(pg)
    await pg.wait_for_timeout(300)
    check(await pg.evaluate("!document.querySelector('.ff-card.ff-in')"), "fun facts stay quiet on the scan screen")
    await pg.click("#camBtn")
    await wait_js(pg, "!document.getElementById('camSheet').hidden && document.getElementById('camVideo').videoWidth > 0 && !document.getElementById('camShot').disabled", timeout=10000)
    vw = await pg.evaluate("document.getElementById('camVideo').videoWidth")
    check(vw > 0, f"live camera opens in the page (frame {vw} px wide)")
    check(await pg.evaluate("getComputedStyle(document.querySelector('.cam')).position === 'fixed' && document.body.classList.contains('cam-open')"), "camera view covers the screen")
    await pg.screenshot(path="scripts/site_phone_camera.png")
    await pg.click("#camShot")
    await wait_js(pg, "!document.getElementById('preview').hidden", timeout=8000)
    meta = await pg.text_content("#photoMeta")
    check("Camera photo" in meta, f"shutter makes a photo: {meta}")
    check(await pg.evaluate("document.getElementById('camSheet').hidden && document.getElementById('camVideo').srcObject === null"), "camera closes and the stream stops after the shot")
    await pg.click("#scanBtn")
    await wait_js(pg, "!document.getElementById('scanBtn').disabled && !/Looking|Still/.test(document.getElementById('status').textContent)", timeout=30000)
    st = await pg.text_content("#status")
    names = await pg.evaluate("[...document.querySelectorAll('#items .dish-btn')].map(b => b.textContent)")
    check("Found 2 items" in st and len(names) == 2, f"scan through /api/ai lists the dishes: {st[:40]}")
    await pg.screenshot(path="scripts/site_phone_scan.png", full_page=False)

    # upload
    await pg.set_input_files("#photo", PHOTO)
    await wait_js(pg, "document.getElementById('photoMeta').textContent.includes('Uploaded photo')")
    kb = await pg.evaluate("parseInt(document.getElementById('photoMeta').textContent.match(/(\\d+) KB/)[1])")
    check(0 < kb < 1800, f"upload works and the photo is shrunk to {kb} KB")

    # camera escape key and reopening
    await pg.click("#camBtn"); await wait_js(pg, "!document.getElementById('camSheet').hidden")
    await pg.keyboard.press("Escape")
    check(await pg.evaluate("document.getElementById('camSheet').hidden"), "Escape closes the camera")
    await ctx.close()

    # a blocked camera: clear message, and the phone's own camera app as the fallback
    ctx, pg = await new_page(b, PHONE, errs, "phone-blocked")
    await pg.add_init_script("navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('denied', 'NotAllowedError')); window.__camInput = 0; document.addEventListener('click', e => { if (e.target && e.target.id === 'photoCam') window.__camInput++; }, true);")
    await pg.goto(BASE + "/#scan"); await ready(pg)
    await pg.click("#camBtn"); await pg.wait_for_timeout(500)
    st = await pg.text_content("#status")
    check("blocked" in st and await pg.evaluate("document.getElementById('camSheet').hidden"), f"blocked camera explained: {st[:70]}...")
    check(await pg.evaluate("window.__camInput") == 1, "blocked camera falls back to the phone camera app input")
    await ctx.close()

async def desktop(b, errs):
    ctx, pg = await new_page(b, DESK, errs, "desktop")
    await pg.goto(BASE + "/"); await ready(pg)
    check(await pg.is_visible(".sitebar"), "desktop: top menu shown")
    check(await pg.get_attribute('[data-nav="home"]', "aria-current") == "page", "desktop: menu marks the current page")
    cols = await pg.evaluate("getComputedStyle(document.getElementById('sampleGrid')).gridTemplateColumns.split(' ').length")
    check(cols == 5, f"desktop: sample dishes in {cols} columns")
    await pg.wait_for_timeout(500); await pg.screenshot(path="scripts/site_desktop_home.png")
    await pg.click('[data-nav="scan"]'); await wait_js(pg, "App.current === 'scan'")
    check(await pg.get_attribute('[data-nav="scan"]', "aria-current") == "page", "desktop: menu follows to Scan")
    box = await pg.evaluate("(() => { const a = document.querySelector('.scan').getBoundingClientRect(), b = document.querySelector('.plate-col').getBoundingClientRect(); return [a.right, b.left, Math.abs(a.top - b.top)]; })()")
    check(box[1] > box[0] and box[2] < 4, "desktop: scan screen has the photo on the left and the plate on the right")
    check(await pg.is_visible(".drop-desk") and not await pg.is_visible(".drop-touch"), "desktop: photo box offers drop and paste")
    # drop a file on the photo box
    data = open(PHOTO, "rb").read()
    await pg.evaluate("""async (bytes) => {
      const f = new File([new Uint8Array(bytes)], 'plate.jpg', { type: 'image/jpeg' }), dt = new DataTransfer(); dt.items.add(f);
      const d = document.querySelector('.drop'); d.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
      d.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); }""", list(data))
    await wait_js(pg, "document.getElementById('photoMeta').textContent.includes('Dropped photo')")
    check(True, "desktop: a dropped photo is ready to scan")
    await pg.click("#camBtn")
    await wait_js(pg, "document.getElementById('camVideo').videoWidth > 0", timeout=10000)
    check(True, "desktop: webcam view opens")
    await pg.screenshot(path="scripts/site_desktop_camera.png")
    await pg.click("#camClose")
    await pg.click("#addBtn"); await pg.wait_for_selector("#sheet:not([hidden])")
    sb = await pg.evaluate("(() => { const r = document.getElementById('sheet').getBoundingClientRect(); return [r.left, innerWidth - r.right, r.top]; })()")
    check(abs(sb[0] - sb[1]) < 3 and sb[2] > 20, "desktop: dish picker is a centred dialog")
    await pg.keyboard.press("Escape")
    await pg.wait_for_timeout(400); await pg.screenshot(path="scripts/site_desktop_scan.png")

    # test mode: a photo kept after reload, a run, CSV export
    await pg.goto(BASE + "/#settings"); await ready(pg)
    if await pg.get_attribute("#testSwitch", "aria-checked") != "true": await pg.click("#testSwitch")
    await pg.goto(BASE + "/#test"); await ready(pg)
    await pg.wait_for_selector("#tPhoto")
    await pg.set_input_files("#tPhoto", PHOTO)
    await wait_js(pg, "document.getElementById('tFormStatus').textContent.includes('Photo ready')")
    await pg.fill('[data-f="grams"]', "320")
    await pg.click('#tForm button[type="submit"]'); await pg.wait_for_timeout(800)
    before = await pg.locator("#upList .tphoto").count()
    await pg.reload(); await ready(pg); await pg.wait_for_timeout(800)
    after = await pg.locator("#upList .tphoto").count()
    check(before >= 1 and after == before, f"test mode: uploaded test photo kept after a reload ({after})")
    await pg.click('[data-tab="run"]'); await pg.wait_for_selector("#tStart:not([disabled])", timeout=10000)
    await pg.uncheck("#tUsePdf"); await pg.click("#tStart")
    await wait_js(pg, "/Run finished|stopped|limit/.test(document.getElementById('tRunStatus').textContent)", timeout=60000)
    rs = await pg.text_content("#tRunStatus")
    check("Run finished" in rs, f"test mode: a run completes: {rs[:50]}")
    await pg.click('[data-tab="results"]'); await pg.wait_for_selector("#tCsv1", timeout=10000)
    async with pg.expect_download() as dl:
        await pg.click("#tCsv1")
    d = await dl.value; path = await d.path(); raw = open(path, "rb").read()
    check(d.suggested_filename.startswith("thali-test-") and d.suggested_filename.endswith("-detail.csv"), f"CSV export downloads {d.suggested_filename}")
    lines = raw.count(b"\n")
    check(raw[:3] == b"\xef\xbb\xbf" and lines >= 2, f"CSV starts with a BOM and has {lines} lines" + ("" if lines >= 2 else f": {raw[:200]!r}"))
    note = await pg.evaluate("(document.getElementById('tCsvStatus') || {}).textContent || document.getElementById('tCsvBox').textContent")
    check("Downloaded" in note, f"CSV export says where the file went: {note[:70]}")
    await ctx.close()

async def https_switch(b, errs):
    ctx = await b.new_context(); pg = await ctx.new_page(); seen = []
    pg.on("request", lambda r: seen.append(r.url))
    try: await pg.goto(f"http://thaliheal.test:{HTTP_PORT}/#scan", timeout=8000)
    except Exception: pass
    await pg.wait_for_timeout(1200)
    check(any(u.startswith(f"https://thaliheal.test:{HTTP_PORT}/") for u in seen), "an http address switches to https before the app loads")
    seen.clear(); await pg.goto(f"http://localhost:{HTTP_PORT}/"); await pg.wait_for_timeout(800)
    check(not any(u.startswith("https://") for u in seen) and pg.url.startswith("http://localhost"), "http://localhost stays as it is for development")
    await ctx.close()

async def run_parts(parts, errs):
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=CHROME, args=ARGS)
        for part in parts:
            try: await part(b, errs)
            except Exception as e: check(False, f"{part.__name__} stopped: {" | ".join(str(e).splitlines()[:6])[:600]}")
        await b.close()

async def main():
    clean = {k: v for k, v in os.environ.items() if not k.startswith(("AI_", "ANTHROPIC", "UPSTASH", "KV_", "ALLOWED", "RATE_", "GLOBAL", "TESTER"))}
    errs = []
    # Part 1: scan off mode, with no AI variable at all. One server at a time: each start rewrites public/js/flags.js.
    print("== scan off mode ==")
    off = subprocess.Popen(["node", "scripts/fake-dev.js", "https"], env=dict(clean, AI_ENABLED="false", PORT=str(OFF_PORT)), stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
    time.sleep(1.5)
    try: await run_parts((off_phone, off_desktop), errs)
    finally: off.terminate(); off.wait()
    # Part 2: AI on
    print("== AI on ==")
    env = dict(clean, AI_ENABLED="true", RATE_LIMIT_PER_MINUTE="1000", RATE_LIMIT_PER_DAY="5000", GLOBAL_DAILY_LIMIT="5000")
    srv = subprocess.Popen(["node", "scripts/fake-dev.js", "https"], env=dict(env, PORT=str(PORT)), stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
    plain = subprocess.Popen(["node", "scripts/fake-dev.js"], env=dict(env, PORT=str(HTTP_PORT)), stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
    time.sleep(1.5)
    try: await run_parts((phone, desktop, https_switch), errs)
    finally:
        srv.terminate(); plain.terminate(); srv.wait(); plain.wait()
        subprocess.run(["node", "scripts/build.js"], env=clean, capture_output=True)   # leave flags.js at the default: scan off
    check(not errs, "no page errors" + ("" if not errs else ": " + " | ".join(errs[:4])))
    bad = [w for ok, w in results if not ok]
    print(f"\n{len(results) - len(bad)} of {len(results)} checks pass")
    sys.exit(1 if bad else 0)

asyncio.run(main())
