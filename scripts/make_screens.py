"""Makes the install screenshots listed in manifest.webmanifest (uses the fake dev server, no cost)."""
import asyncio, subprocess, time
from playwright.async_api import async_playwright
from PIL import Image
OUT = "public/img/screens/"
async def main():
    srv = subprocess.Popen(["node", "scripts/fake-dev.js"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL); time.sleep(1.2)
    try:
        async with async_playwright() as p:
            b = await p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
            hide = "localStorage.setItem('funfact.paused','1');"
            ctx = await b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
            pg = await ctx.new_page()
            await pg.goto("http://localhost:8790/"); await pg.wait_for_timeout(1500)
            await pg.add_style_tag(content="[class*=funfact],[id*=funfact],[class*=ff-],[id*=ff-]{display:none !important}")
            await pg.screenshot(path="/tmp/home.png")
            await pg.click('[data-plate="egg"]'); await pg.wait_for_timeout(1800)
            await pg.add_style_tag(content="[class*=funfact],[id*=funfact],[class*=ff-],[id*=ff-]{display:none !important}")
            await pg.evaluate("document.querySelector('#items').scrollIntoView({block:'start'}); window.scrollBy(0,-90)"); await pg.wait_for_timeout(300)
            await pg.screenshot(path="/tmp/scan.png")
            ctx2 = await b.new_context(viewport={"width": 1280, "height": 800})
            pg2 = await ctx2.new_page(); await pg2.goto("http://localhost:8790/"); await pg2.wait_for_timeout(1500)
            await pg2.add_style_tag(content="[class*=funfact],[id*=funfact],[class*=ff-],[id*=ff-]{display:none !important}")
            await pg2.screenshot(path="/tmp/wide.png")
            await b.close()
    finally:
        srv.terminate()
    for src, dst, size in [("/tmp/home.png", "home-phone.jpg", (780, 1688)), ("/tmp/scan.png", "scan-phone.jpg", (780, 1688)), ("/tmp/wide.png", "home-wide.jpg", (1280, 800))]:
        im = Image.open(src).convert("RGB")
        assert im.size == size, (src, im.size)
        im.save(OUT + dst, quality=82, optimize=True, progressive=True)
asyncio.run(main())
