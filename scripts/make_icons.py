"""Builds every icon from the traced logo (public/img/logo-mark.svg, made by scripts/trace_logo.py):
web favicons and PWA icons (any + maskable), the Apple touch icon and the header mark. Rendered with headless Chrome.
Run from the project folder: python3 scripts/make_icons.py"""
import asyncio, re, os
from playwright.async_api import async_playwright

GREEN, GOLD = "#024C36", "#D99B31"
mark = open("public/img/logo-mark.svg").read()
vb = [float(v) for v in re.search(r'viewBox="([^"]+)"', mark).group(1).split()]
path = re.search(r'<path[^>]*/>', mark).group(0)

def icon_svg(size, mark_w, shape="square", bg=GREEN):
    """An SVG of size x size: background shape (square, rounded, circle or none) with the mark centred, mark_w wide."""
    s = mark_w / vb[2]; w, h = vb[2] * s, vb[3] * s
    tx, ty = (size - w) / 2 - vb[0] * s, (size - h) / 2 - vb[1] * s
    back = {"square": f'<rect width="{size}" height="{size}" fill="{bg}"/>',
            "rounded": f'<rect width="{size}" height="{size}" rx="{size * 0.22:.2f}" fill="{bg}"/>',
            "circle": f'<circle cx="{size / 2}" cy="{size / 2}" r="{size / 2}" fill="{bg}"/>',
            "none": ""}[shape]
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}" viewBox="0 0 {size} {size}">{back}'
            f'<g transform="translate({tx:.2f} {ty:.2f}) scale({s:.5f})">{path}</g></svg>')

JOBS = []
# web: "any" icons are rounded squares; maskable and Apple icons fill the square (the system cuts the shape)
for n in (48, 72, 96, 128, 144, 152, 192, 256, 384, 512): JOBS.append((f"public/img/icons/icon-{n}.png", icon_svg(n, n * 0.70, "rounded")))
JOBS.append(("public/img/icons/favicon-32.png", icon_svg(32, 32 * 0.80, "rounded")))
for n in (192, 512): JOBS.append((f"public/img/icons/maskable-{n}.png", icon_svg(n, n * 0.52, "square")))   # inside the 80% safe circle
JOBS.append(("public/img/icons/apple-touch-icon-180.png", icon_svg(180, 180 * 0.64, "square")))

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
        pg = await b.new_page()
        for out, svg in JOBS:
            w, h = (int(float(x)) for x in re.search(r'width="([\d.]+)" height="([\d.]+)"', svg).groups())
            await pg.set_viewport_size({"width": w, "height": h})
            await pg.set_content(f'<html><body style="margin:0;background:transparent">{svg}</body></html>')
            await pg.screenshot(path=out, omit_background=True, clip={"x": 0, "y": 0, "width": w, "height": h})
        await b.close()
    # vector files: favicon (rounded icon), a square icon for anywhere else
    open("public/img/favicon.svg", "w").write(icon_svg(64, 64 * 0.74, "rounded") + "\n")
    open("design/logo-icon.svg", "w").write(icon_svg(1024, 1024 * 0.64, "square") + "\n")
    os.makedirs("design", exist_ok=True)
    open(f"{RES}/values/ic_launcher_background.xml", "w").write(
        f'<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">{GREEN}</color>\n</resources>\n')
    print(f"{len(JOBS)} PNGs, favicon.svg, design/logo-icon.svg, launcher background {GREEN}")

asyncio.run(main())
