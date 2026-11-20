"""Make display and test copies of the 25 PDF dish photos.
Display: original, with near-white borders trimmed.
Test: same, plus the printed name label cropped off photos 1 to 6 so the model cannot read the answer."""
import sys
from PIL import Image, ImageChops
src, out = sys.argv[1], sys.argv[2]
def trim_white(im, thresh=244):
    bg = Image.new("RGB", im.size, (255, 255, 255))
    diff = ImageChops.difference(im, bg).convert("L").point(lambda p: 255 if p > 255 - thresh else 0)
    box = diff.getbbox()
    return im.crop(box) if box else im
for i in range(25):
    im = Image.open(f"{src}/im-{i:03d}.jpg").convert("RGB")
    im = trim_white(im)
    sid = f"s{i+1:02d}"
    im.save(f"{out}/samples/{sid}.jpg", quality=92)
    t = im.crop((0, 34, im.width, im.height)) if i < 6 else im
    t.save(f"{out}/test/{sid}.jpg", quality=92)
    print(sid, im.size, t.size)
