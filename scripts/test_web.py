import asyncio, subprocess, time
from playwright.async_api import async_playwright
URL = "http://localhost:8790/"
async def main():
    srv = subprocess.Popen(["node", "scripts/fake-dev.js"], stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    time.sleep(1.2)
    try:
        async with async_playwright() as p:
            b = await p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
            ctx = await b.new_context(viewport={"width": 390, "height": 844}, accept_downloads=True)
            pg = await ctx.new_page(); errs = []
            pg.on("pageerror", lambda e: errs.append(str(e))); pg.on("console", lambda m: m.type in ("error", "warning") and errs.append(m.text))
            r = await pg.goto(URL); await pg.wait_for_timeout(1200)
            print("CSP header:", (r.headers.get("content-security-policy") or "")[:40])
            print("hosting:", await pg.evaluate("App.hosting"), "| AI ready:", await pg.evaluate("!!App.claudeSample"))
            await pg.click('[data-plate="chole"]'); await pg.wait_for_timeout(1500)
            print("scan via /api/ai:", await pg.evaluate("document.querySelectorAll('#items .item').length"), "items |", await pg.inner_text("#status"))
            await pg.goto(URL + "#consent"); await pg.wait_for_timeout(400)
            notice = await pg.inner_text("#consentPage")
            print("notice mentions IP code:", "one way code made from your IP" in notice, "| no Claude account line:", "Claude account ID" not in notice)
            await pg.check("#cAdult"); await pg.check("#cStore"); await pg.check("#cAssist"); await pg.click("#cAgree"); await pg.wait_for_timeout(400)
            await pg.fill("#pAge", "30"); await pg.click('[data-seg="sex"] [data-v="male"]'); await pg.fill("#pHeight", "175"); await pg.fill("#pWeight", "70")
            await pg.click("#pSave"); await pg.wait_for_timeout(300)
            print("where:", await pg.inner_text("#profileWhere"))
            await pg.goto(URL + "#ask"); await pg.wait_for_timeout(500)
            await pg.fill("#askIn", "How was my protein this week?"); await pg.click("#askForm button"); await pg.wait_for_timeout(1200)
            print("assistant:", (await pg.evaluate("[...document.querySelectorAll('.msg.bot')].pop().innerText")).replace("\n", " | ")[:120])
            await pg.goto(URL + "#privacy"); await pg.wait_for_timeout(400)
            async with pg.expect_download() as dl:
                await pg.click("#dlBtn")
            d = await dl.value
            print("download:", d.suggested_filename)
            await pg.goto(URL + "#settings"); await pg.wait_for_timeout(300)
            await pg.click("#testSwitch"); await pg.wait_for_timeout(100)
            print("tester key box shown:", await pg.is_visible("#testerKey"))
            print("console errors or CSP warnings:", errs)
            await b.close()
    finally:
        srv.terminate()
asyncio.run(main())
