#!/usr/bin/env python3
"""Design reference for the Coach Home Screen icon: writes the SVG masters (icons/*.svg, including the favicon SVG that
build.py ships) and Chrome-rendered preview PNGs. The deployed PNGs are drawn in code by app/middleware.js with the
same geometry (tools/make_icons.mjs writes local copies), so no binary icon files need uploading.

Design (v4): a thick recovery-green (#16EC06) progress arc of 300 degrees with round caps, starting at 12 o'clock and
running clockwise, with a small bright dot on the leading tip. A soft green glow sits under the arc. Background is a
near-black vertical gradient (#1A1F24 top -> #07090B bottom) with a faint inner highlight at the top. No letters.
The arc's outer edge sits 20% in from every side, so iOS's corner mask never touches it.

Each variant is rendered once at 1024 px by headless Chrome (tools/render_svg.js) and downsampled with Lanczos to
every size. The 180 px apple-touch-icon is a plain 24-bit RGB PNG (opaque, no palette, no alpha, not interlaced), the safest format
for iOS. The 192/512 manifest icons use an opaque palette (256 / 64 colours) to stay small. Versioned names (c4-*) bust caches; build.py also writes unversioned
/apple-touch-icon.png and /apple-touch-icon-precomposed.png, which iOS probes directly.
"""
import math, os, subprocess
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "icons")
V = "c4"
GREEN = "#16EC06"


def svg(inset=0.20, stroke=0.135, sweep=300, glow=True, bg=True):
    S = 1024
    w = S * stroke
    r = S * (0.5 - inset) - w / 2
    cx = cy = S / 2
    a0 = math.radians(-90)
    a1 = math.radians(-90 + sweep)
    x0, y0 = cx + r * math.cos(a0), cy + r * math.sin(a0)
    x1, y1 = cx + r * math.cos(a1), cy + r * math.sin(a1)
    large = 1 if sweep > 180 else 0
    arc = f'M{x0:.1f} {y0:.1f}A{r:.1f} {r:.1f} 0 {large} 1 {x1:.1f} {y1:.1f}'
    defs = ('<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1A1F24"/><stop offset="1" stop-color="#07090B"/></linearGradient>'
            '<radialGradient id="h" cx="0.5" cy="0" r="0.75" fx="0.5" fy="0"><stop offset="0" stop-color="#fff" stop-opacity=".10"/><stop offset=".55" stop-color="#fff" stop-opacity=".025"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>'
            '<linearGradient id="a" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3DFF2E"/><stop offset="1" stop-color="#12D605"/></linearGradient>'
            '<filter id="f" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="34"/></filter></defs>')
    back = '<rect width="1024" height="1024" fill="url(#g)"/><rect width="1024" height="1024" fill="url(#h)"/>' if bg else ''
    glow_el = f'<path d="{arc}" fill="none" stroke="{GREEN}" stroke-opacity=".38" stroke-width="{w:.1f}" stroke-linecap="round" filter="url(#f)"/>' if glow else ''
    dot = f'<circle cx="{x1:.1f}" cy="{y1:.1f}" r="{w * 0.24:.1f}" fill="#F2FFEE"/>'
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">{defs}{back}{glow_el}'
            f'<path d="{arc}" fill="none" stroke="url(#a)" stroke-width="{w:.1f}" stroke-linecap="round"/>{dot}</svg>\n')


def main():
    os.makedirs(OUT, exist_ok=True)
    variants = {
        "icon.svg": svg(),                                       # Home Screen / manifest "any"
                "icon-favicon.svg": svg(inset=0.07, stroke=0.19, glow=False),   # tabs: bigger and bolder
        "icon-flat.svg": svg(glow=False),                        # 512 manifest icon: same mark without the glow, so a palette PNG stays clean
    }
    for n, s in variants.items():
        with open(os.path.join(OUT, n), "w") as f: f.write(s)
    masters = {n: os.path.join(OUT, n.replace(".svg", "-1024.png")) for n in variants}
    subprocess.run(["node", os.path.join(HERE, "tools", "render_svg.js")] + [f"{os.path.join(OUT, n)}:1024:{p}" for n, p in masters.items()], check=True)
    sizes = [("icon.svg", s, f"{V}-{s}.png") for s in (1024, 192, 180)] + [("icon-flat.svg", 512, f"{V}-512.png")]
    sizes += [("icon-favicon.svg", 32, f"{V}-32.png"), ("icon-favicon.svg", 16, f"{V}-16.png")]
    for src, size, name in sizes:
        im = Image.open(masters[src]).convert("RGB")
        if size != 1024: im = im.resize((size, size), Image.LANCZOS)
        p = os.path.join(OUT, name)
        if size in (512, 192):   # manifest (Android/Chrome) sizes: an opaque palette keeps them small
            im = im.quantize(colors=64 if size == 512 else 256, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
        im.save(p, optimize=True)
        print(f"{name:22s} {os.path.getsize(p):6d} B")
    Image.open(os.path.join(OUT, f"{V}-32.png")).save(os.path.join(OUT, "favicon.ico"), sizes=[(16, 16), (32, 32)])


if __name__ == "__main__":
    main()
