"""PWA check (no cost, fake Claude): service worker, app shell cache, nothing from /api cached,
Chrome installability, the Install button, offline behaviour and the update flow."""
import asyncio, subprocess, time, json, re
from playwright.async_api import async_playwright
BASE = "http://localhost:8790"

async def caches(pg):
    return await pg.evaluate("""async () => { const out = {}; for (const k of await caches.keys()) { const c = await caches.open(k); out[k] = (await c.keys()).map(r => new URL(r.url).pathname); } return out; }""")

async def main():
    srv = subprocess.Popen(["node", "scripts/fake-dev.js"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL); time.sleep(1.2)
    try:
        async with async_playwright() as p:
            import tempfile
            # A normal (non incognito) profile, as on a phone: Chrome refuses to install from incognito.
            ctx = await p.chromium.launch_persistent_context(tempfile.mkdtemp(), executable_path="/usr/bin/google-chrome", headless=True,
                args=["--no-sandbox", "--bypass-app-banner-engagement-checks"], viewport={"width": 412, "height": 915}, device_scale_factor=2.6)
            b = ctx
            pg = ctx.pages[0] if ctx.pages else await ctx.new_page(); errs = []
            pg.on("pageerror", lambda e: errs.append(str(e))); pg.on("console", lambda m: m.type in ("error", "warning") and errs.append(m.text))
            await pg.goto(BASE + "/"); await pg.wait_for_timeout(2500)
            await pg.reload(); await pg.wait_for_timeout(1500)
            print("service worker controls the page:", await pg.evaluate("!!navigator.serviceWorker.controller"))

            cdp = await ctx.new_cdp_session(pg)
            inst = await cdp.send("Page.getInstallabilityErrors")
            man = await cdp.send("Page.getAppManifest")
            print("Chrome installability errors:", inst.get("installabilityErrors"), "| manifest errors:", man.get("errors"))
            print("Install button shown (Chrome offered install):", await pg.is_visible("#installBtn"))

            c = await caches(pg)
            shell = [k for k in c if k.startswith("thaliheal-shell-")]
            print("shell cache:", shell, len(c[shell[0]]), "files")

            # a real scan through /api/ai, then make sure nothing from /api or any photo landed in a cache
            await pg.goto(BASE + "/#scan"); await pg.wait_for_timeout(500)
            await pg.set_input_files("#photoCam", "/tmp/phone-photo.jpg"); await pg.wait_for_timeout(1200)
            await pg.click("#scanBtn"); await pg.wait_for_timeout(1800)
            print("scan online:", await pg.evaluate("document.querySelectorAll('#items .item').length"), "items")
            c = await caches(pg); allpaths = [x for v in c.values() for x in v]
            print("anything from /api cached:", [x for x in allpaths if x.startswith("/api")], "| blob or upload cached:", [x for x in allpaths if "blob" in x or "phone-photo" in x])

            # offline
            await ctx.set_offline(True)
            await pg.goto(BASE + "/"); await pg.wait_for_timeout(1200)
            print("offline: app opens:", await pg.evaluate("App.current"), "| offline bar:", await pg.is_visible("#offlineBar"))
            await pg.goto(BASE + "/track"); await pg.wait_for_timeout(800)
            print("offline: /track opens:", await pg.evaluate("App.current"))
            await pg.goto(BASE + "/#scan"); await pg.wait_for_timeout(600)
            await pg.set_input_files("#photoCam", "/tmp/phone-photo.jpg"); await pg.wait_for_timeout(1000)
            if await pg.is_visible("#scanBtn"): await pg.click("#scanBtn"); await pg.wait_for_timeout(800)
            print("offline: scan message:", await pg.inner_text("#status") or await pg.inner_text("#noScan"))
            await pg.goto(BASE + "/some/unknown/page"); await pg.wait_for_timeout(600)
            print("offline: unknown page shows:", await pg.title())
            await pg.screenshot(path="scripts/pwa_offline_page.png")
            await ctx.set_offline(False)
            await pg.goto(BASE + "/#scan"); await pg.wait_for_timeout(1200)
            print("back online: offline bar hidden:", not await pg.is_visible("#offlineBar"), "| AI ready:", await pg.evaluate("!!App.claudeSample"))

            # update flow: change a shell file, rebuild, the page offers Refresh, Refresh loads the new version
            old = shell[0]
            with open("public/js/boot.js", "a") as f: f.write("// update test\n")
            subprocess.run(["node", "scripts/build-sw.js"], check=True, capture_output=True)
            await pg.evaluate("navigator.serviceWorker.getRegistration().then(r => r.update())"); await pg.wait_for_timeout(2500)
            print("update bar offered:", await pg.is_visible("#updateBar"))
            await pg.click("#updateBtn"); await pg.wait_for_timeout(2500)
            c = await caches(pg); new = [k for k in c if k.startswith("thaliheal-shell-")]
            print("after Refresh: shell cache", old, "->", new)
            print("console errors or warnings (offline request failures are expected):", [e for e in errs if "INTERNET_DISCONNECTED" not in e])
            await b.close()
    finally:
        srv.terminate()
        s = open("public/js/boot.js").read().replace("// update test\n", ""); open("public/js/boot.js", "w").write(s)
        subprocess.run(["node", "scripts/build-sw.js"], capture_output=True)
asyncio.run(main())
