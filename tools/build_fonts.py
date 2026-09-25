"""Builds the web font: LXGW WenKai (SIL OFL 1.1) cut into WOFF2 slices by unicode-range, so a
page downloads only the slices holding its characters.

    .venv/bin/python tools/build_fonts.py      # run again after adding a book or UI text

Slice 0 holds every character the books and the UI use today, so the preset books need one
file per weight. The remaining GB2312 characters (6763 hanzi, the everyday set) follow in
slices of SLICE characters, for new text; rarer characters fall back to the system font.
The full fonts are downloaded once into tools/.cache/fonts (they are 25 MB each).

Output: public/fonts/wenkai-<weight>-<n>.woff2, public/fonts/wenkai.css, public/fonts/OFL.txt.
The reserved font name "LXGW" is kept, as the licence allows for web font subsets.
Runs in the project .venv (fonttools, brotli).
"""
import re
import sys
import urllib.request
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "tools/.cache/fonts"
OUT = ROOT / "public/fonts"
VERSION = "v1.522"
BASE = f"https://github.com/lxgw/LxgwWenKai/releases/download/{VERSION}"
WEIGHTS = {"Regular": 400, "Medium": 700}  # Medium stands in for bold: headings, titles
FAMILY = "LXGW WenKai"
SLICE = 600


def fetch(name, url):
    path = CACHE / name
    if not path.exists():
        CACHE.mkdir(parents=True, exist_ok=True)
        print(f"downloading {name}…", flush=True)
        urllib.request.urlretrieve(url, path)
    return path


def used_chars():
    """Every character in the books, the page and the source (UI strings live in the JS)."""
    files = [ROOT / "index.html", *ROOT.glob("src/*.js"), *ROOT.glob("public/books/**/*.json")]
    chars = set()
    for f in files:
        chars.update(f.read_text(encoding="utf-8"))
    chars.update(chr(c) for c in range(0x20, 0x7F))
    chars.update("，。！？：；、“”‘’（）《》…—·～")
    return {c for c in chars if c.isprintable()}


def gb2312():
    out = []
    for hi in range(0xB0, 0xF8):
        for lo in range(0xA1, 0xFF):
            try:
                out.append(bytes([hi, lo]).decode("gb2312"))
            except UnicodeDecodeError:
                pass
    return out


def ranges(codes):
    """unicode-range text for a set of code points, merging runs."""
    codes, parts, i = sorted(codes), [], 0
    while i < len(codes):
        j = i
        while j + 1 < len(codes) and codes[j + 1] == codes[j] + 1:
            j += 1
        parts.append(f"U+{codes[i]:X}" if i == j else f"U+{codes[i]:X}-{codes[j]:X}")
        i = j + 1
    return ", ".join(parts)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    fetch("OFL.txt", "https://raw.githubusercontent.com/lxgw/LxgwWenKai/main/OFL.txt")
    (OUT / "OFL.txt").write_bytes((CACHE / "OFL.txt").read_bytes())
    fonts = {w: fetch(f"LXGWWenKai-{w}.ttf", f"{BASE}/LXGWWenKai-{w}.ttf") for w in WEIGHTS}

    cmap = set(TTFont(fonts["Regular"], lazy=True).getBestCmap())
    first = sorted(ord(c) for c in used_chars() if ord(c) in cmap)
    rest = [ord(c) for c in gb2312() if ord(c) in cmap and ord(c) not in set(first)]
    slices = [first] + [rest[i:i + SLICE] for i in range(0, len(rest), SLICE)]

    for old in OUT.glob("wenkai-*.woff2"):
        old.unlink()
    css = [f"/* {FAMILY} {VERSION}, SIL Open Font License 1.1 (OFL.txt). Built by tools/build_fonts.py. */"]
    total = 0
    for weight, value in WEIGHTS.items():
        for n, codes in enumerate(slices):
            name = f"wenkai-{value}-{n}.woff2"
            opts = subset.Options()
            opts.flavor, opts.layout_features, opts.name_IDs = "woff2", ["*"], ["*"]
            font = subset.load_font(str(fonts[weight]), opts)
            sub = subset.Subsetter(opts)
            sub.populate(unicodes=codes)
            sub.subset(font)
            subset.save_font(font, str(OUT / name), opts)
            size = (OUT / name).stat().st_size
            total += size
            css.append(f"@font-face {{ font-family: \"{FAMILY}\"; font-weight: {value}; font-display: swap; "
                       f"src: url(\"{name}\") format(\"woff2\"); unicode-range: {ranges(codes)}; }}")
        print(f"{weight}: {len(slices)} slices, first {(OUT / f'wenkai-{value}-0.woff2').stat().st_size // 1024} KB "
              f"({len(first)} characters)")
    (OUT / "wenkai.css").write_text("\n".join(css) + "\n", encoding="utf-8")
    print(f"wrote {OUT} ({total / 1e6:.1f} MB in all)")


if __name__ == "__main__":
    sys.exit(main())
