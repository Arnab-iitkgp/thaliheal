"""Traces design/logo-source.png (the approved logo) into a clean vector mark: public/img/logo-mark.svg.
Gold shapes become one SVG path; colours are the ones sampled from the approved image."""
import potrace, numpy as np
from PIL import Image, ImageFilter

GOLD, GREEN = "#D99B31", "#024C36"
src = Image.open("design/logo-source.png").convert("RGB")
big = src.resize((src.width * 2, src.height * 2), Image.LANCZOS).filter(ImageFilter.GaussianBlur(1.2))
r = np.asarray(big)[:, :, 0].astype(int)
mask = r > 110                                     # background red channel is about 2, gold about 217
bm = potrace.Bitmap(~mask)   # potracer fills the dark (False) pixels, so pass the gold as False
plist = bm.trace(turdsize=60, turnpolicy=potrace.POTRACE_TURNPOLICY_MINORITY, alphamax=1.0, opticurve=True, opttolerance=0.25)

def f(v): return f"{v:.1f}".rstrip("0").rstrip(".")
parts, xs, ys = [], [], []
for curve in plist:
    sx, sy = curve.start_point.x, curve.start_point.y
    d = [f"M{f(sx)} {f(sy)}"]; xs.append(sx); ys.append(sy)
    for seg in curve.segments:
        if seg.is_corner:
            d.append(f"L{f(seg.c.x)} {f(seg.c.y)}L{f(seg.end_point.x)} {f(seg.end_point.y)}")
            xs += [seg.c.x, seg.end_point.x]; ys += [seg.c.y, seg.end_point.y]
        else:
            d.append(f"C{f(seg.c1.x)} {f(seg.c1.y)} {f(seg.c2.x)} {f(seg.c2.y)} {f(seg.end_point.x)} {f(seg.end_point.y)}")
            xs += [seg.end_point.x]; ys += [seg.end_point.y]
    parts.append("".join(d) + "Z")
x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
pad = 4
vb = f"{f(x0 - pad)} {f(y0 - pad)} {f(x1 - x0 + 2 * pad)} {f(y1 - y0 + 2 * pad)}"
path = "".join(parts)
svg = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vb}"><path fill="{GOLD}" fill-rule="evenodd" d="{path}"/></svg>\n'
open("public/img/logo-mark.svg", "w").write(svg)
print("curves", len(plist), "bbox", round(x0), round(y0), round(x1), round(y1), "aspect", round((x1 - x0) / (y1 - y0), 3), "bytes", len(svg))
