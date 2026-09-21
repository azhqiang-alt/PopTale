"""Writes the placeholder illustrations for the sample book as SVG.

These are stand-ins drawn with simple shapes so the reader can be built and tested before
real artwork exists. Replace any file in public/books/lele-star/art/ with a real painting of
the same name (PNG/WebP work too; update the path in story.json).

    python3 tools/placeholder_art.py
"""
import math
import random
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "public/books/lele-star/art"
INK = "#3d3150"
FONT = "PingFang SC, Hiragino Sans GB, STHeiti, Microsoft YaHei, sans-serif"


def svg(w, h, body, defs=""):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}">'
            f"<defs>{defs}</defs>{body}</svg>\n")


def stars(n, x0, y0, x1, y1, seed, color="#fff6d8"):
    rnd = random.Random(seed)
    out = []
    for _ in range(n):
        x, y, r = rnd.uniform(x0, x1), rnd.uniform(y0, y1), rnd.choice([1.6, 2.2, 3, 4.2])
        out.append(f'<circle cx="{x:.0f}" cy="{y:.0f}" r="{r}" fill="{color}" opacity="{rnd.uniform(.55, 1):.2f}"/>')
    return "".join(out)


def star_path(cx, cy, R, r):
    pts = []
    for k in range(10):
        a = math.radians(-90 + k * 36)
        rad = R if k % 2 == 0 else r
        pts.append(f"{cx + rad * math.cos(a):.1f},{cy + rad * math.sin(a):.1f}")
    return "M" + " L".join(pts) + " Z"


SKY = ('<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">'
       '<stop offset="0" stop-color="#16204a"/><stop offset=".6" stop-color="#2f3a7c"/>'
       '<stop offset="1" stop-color="#5a4f99"/></linearGradient>'
       '<radialGradient id="moonglow"><stop offset="0" stop-color="#fff4c2" stop-opacity=".55"/>'
       '<stop offset="1" stop-color="#fff4c2" stop-opacity="0"/></radialGradient>')


def moon(cx, cy, r):
    return (f'<circle cx="{cx}" cy="{cy}" r="{r * 2.4}" fill="url(#moonglow)"/>'
            f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="#fff1b8"/>'
            f'<circle cx="{cx + r * .45}" cy="{cy - r * .25}" r="{r * .9}" fill="#2a3574"/>')


def back_card(body, defs=""):
    # a rounded, arch-topped card: the back wall of each pop-up spread
    clip = '<clipPath id="card"><path d="M0 800 V120 Q0 0 120 0 H904 Q1024 0 1024 120 V800 Z"/></clipPath>'
    return svg(1024, 800, f'<g clip-path="url(#card)">{body}</g>', SKY + clip + defs)


def bg_bedroom():
    b = ['<rect width="1024" height="800" fill="#3a3372"/>']
    rnd = random.Random(3)
    for y in range(40, 800, 90):
        for x in range(30 + (y // 90 % 2) * 45, 1024, 90):
            b.append(f'<circle cx="{x}" cy="{y}" r="5" fill="#4a4388"/>')
    # window
    b.append('<path d="M292 560 V250 Q292 110 512 110 Q732 110 732 250 V560 Z" fill="#f2d6a2"/>')
    b.append('<path d="M312 545 V255 Q312 132 512 132 Q712 132 712 255 V545 Z" fill="url(#sky)"/>')
    b.append(stars(28, 330, 150, 700, 520, 7))
    b.append(moon(610, 230, 42))
    b.append('<rect x="505" y="130" width="14" height="420" fill="#f2d6a2"/><rect x="312" y="360" width="400" height="14" fill="#f2d6a2"/>')
    # curtains and sill
    b.append('<path d="M230 90 Q300 330 250 600 L180 600 Q205 330 150 90 Z" fill="#e58aa0"/>')
    b.append('<path d="M794 90 Q724 330 774 600 L844 600 Q819 330 874 90 Z" fill="#e58aa0"/>')
    b.append('<rect x="120" y="70" width="784" height="26" rx="13" fill="#b77a52"/>')
    b.append('<rect x="262" y="556" width="500" height="30" rx="8" fill="#d9a877"/>')
    b.append('<rect y="660" width="1024" height="140" fill="#6b4a5e"/>')
    return back_card("".join(b))


def bg_garden():
    b = ['<rect width="1024" height="800" fill="url(#sky)"/>', stars(40, 20, 20, 1000, 420, 11), moon(820, 150, 50),
         '<path d="M0 520 Q200 420 420 500 T820 470 T1024 490 V800 H0 Z" fill="#2c5a58"/>',
         '<path d="M0 600 Q260 540 520 590 T1024 580 V800 H0 Z" fill="#3b7a5e"/>']
    for x in range(20, 1024, 64):
        b.append(f'<path d="M{x} 640 V540 L{x + 20} 515 L{x + 40} 540 V640 Z" fill="#c9a577" stroke="{INK}" stroke-width="4"/>')
    b.append('<rect y="570" width="1024" height="16" fill="#b8905f"/><rect y="610" width="1024" height="16" fill="#b8905f"/>')
    rnd = random.Random(5)
    for _ in range(14):
        x, y = rnd.uniform(0, 1024), rnd.uniform(660, 780)
        c = rnd.choice(["#f28fb0", "#ffd36b", "#a9a2f2", "#ffffff"])
        b.append(f'<circle cx="{x:.0f}" cy="{y:.0f}" r="34" fill="#2f6b4f"/><circle cx="{x:.0f}" cy="{y - 12:.0f}" r="9" fill="{c}"/>')
    return back_card("".join(b))


def bg_forest():
    b = ['<rect width="1024" height="800" fill="#172a3a"/>', stars(18, 20, 10, 1000, 200, 13),
         '<rect y="160" width="1024" height="640" fill="#1d3a45" opacity=".8"/>']
    rnd = random.Random(21)
    for layer, (col, top) in enumerate([("#23475a", 120), ("#1b3947", 200), ("#142c38", 260)]):
        for _ in range(7):
            x = rnd.uniform(-40, 1024)
            w = rnd.uniform(26, 44) + layer * 8
            b.append(f'<rect x="{x:.0f}" y="{top}" width="{w:.0f}" height="800" fill="{col}"/>')
            b.append(f'<circle cx="{x + w / 2:.0f}" cy="{top:.0f}" r="{w * 2.6:.0f}" fill="{col}"/>')
    for _ in range(12):
        x, y = rnd.uniform(40, 980), rnd.uniform(300, 640)
        b.append(f'<circle cx="{x:.0f}" cy="{y:.0f}" r="10" fill="#e8f79a" opacity=".25"/><circle cx="{x:.0f}" cy="{y:.0f}" r="3.5" fill="#f4ffb8"/>')
    b.append('<path d="M380 800 Q470 620 512 560 Q560 620 660 800 Z" fill="#35505a"/>')
    b.append('<rect y="700" width="1024" height="100" fill="#10232c"/>')
    return back_card("".join(b))


def bg_pond():
    b = ['<rect width="1024" height="800" fill="url(#sky)"/>', stars(36, 20, 20, 1000, 380, 17), moon(260, 170, 46),
         '<path d="M0 430 Q300 380 520 420 T1024 410 V800 H0 Z" fill="#2c5a58"/>',
         '<ellipse cx="512" cy="620" rx="560" ry="200" fill="#284f86"/>',
         '<ellipse cx="512" cy="620" rx="500" ry="165" fill="#3464a0"/>']
    for i, y in enumerate(range(520, 760, 34)):
        b.append(f'<rect x="{220 + i * 13}" y="{y}" width="{90 - i * 8}" height="7" rx="3.5" fill="#fff1b8" opacity=".5"/>')
    rnd = random.Random(8)
    for x in list(range(10, 180, 26)) + list(range(860, 1024, 26)):
        h = rnd.uniform(160, 260)
        b.append(f'<path d="M{x} 800 Q{x + 6} {800 - h / 2:.0f} {x + rnd.uniform(-20, 20):.0f} {800 - h:.0f}" stroke="#4f8a4a" stroke-width="9" fill="none" stroke-linecap="round"/>')
        b.append(f'<ellipse cx="{x + 4}" cy="{800 - h * .78:.0f}" rx="9" ry="26" fill="#8a5a3a"/>')
    return back_card("".join(b))


def bg_hill():
    b = ['<rect width="1024" height="800" fill="url(#sky)"/>', stars(70, 10, 10, 1014, 520, 29), moon(170, 140, 54)]
    for x, y in [(700, 120), (760, 90), (830, 140), (890, 110), (940, 170)]:
        b.append(f'<circle cx="{x}" cy="{y}" r="6" fill="#fff6d8"/>')
    b.append('<polyline points="700,120 760,90 830,140 890,110 940,170" fill="none" stroke="#fff6d8" stroke-width="2" opacity=".5"/>')
    b.append('<path d="M-20 800 Q240 470 560 520 Q820 560 1044 640 V800 Z" fill="#3a7a5a"/>')
    b.append('<path d="M-20 800 Q300 600 640 660 Q860 700 1044 720 V800 Z" fill="#2f6a4c"/>')
    b.append('<rect x="596" y="430" width="14" height="80" fill="#6b4a3a"/><circle cx="603" cy="420" r="48" fill="#24543f"/>')
    return back_card("".join(b))


def lele():
    s = f'stroke="{INK}" stroke-width="7" stroke-linejoin="round"'
    body = f'''
<g {s}>
<path d="M148 200 C112 100 124 24 164 24 C204 24 198 116 186 200 Z" fill="#fbf6ee"/>
<path d="M252 200 C288 100 276 24 236 24 C196 24 202 116 214 200 Z" fill="#fbf6ee"/>
<ellipse cx="200" cy="400" rx="112" ry="100" fill="#fbf6ee"/>
<ellipse cx="148" cy="494" rx="46" ry="20" fill="#fbf6ee"/>
<ellipse cx="252" cy="494" rx="46" ry="20" fill="#fbf6ee"/>
<ellipse cx="102" cy="400" rx="26" ry="40" fill="#fbf6ee" transform="rotate(20 102 400)"/>
<ellipse cx="298" cy="400" rx="26" ry="40" fill="#fbf6ee" transform="rotate(-20 298 400)"/>
<circle cx="200" cy="246" r="96" fill="#fbf6ee"/>
<path d="M118 320 Q200 358 282 320 L288 348 Q200 390 112 348 Z" fill="#e8546a"/>
<path d="M238 342 L272 424 L236 420 L220 350 Z" fill="#e8546a"/>
</g>
<path d="M160 180 C144 104 150 54 166 52 C182 52 180 116 176 180 Z" fill="#f6b3c4"/>
<path d="M240 180 C256 104 250 54 234 52 C218 52 220 116 224 180 Z" fill="#f6b3c4"/>
<ellipse cx="164" cy="246" rx="12" ry="16" fill="#2d2438"/><ellipse cx="236" cy="246" rx="12" ry="16" fill="#2d2438"/>
<circle cx="168" cy="240" r="4.5" fill="#fff"/><circle cx="240" cy="240" r="4.5" fill="#fff"/>
<ellipse cx="140" cy="282" rx="18" ry="10" fill="#f6a3b8" opacity=".7"/><ellipse cx="260" cy="282" rx="18" ry="10" fill="#f6a3b8" opacity=".7"/>
<path d="M192 272 L208 272 L200 282 Z" fill="#e87a90"/>
<path d="M186 290 Q200 302 214 290" stroke="{INK}" stroke-width="5" fill="none" stroke-linecap="round"/>'''
    return svg(400, 520, body)


def star():
    p = star_path(150, 160, 112, 52)
    body = f'''
<path d="{p}" fill="#f0a82a" stroke="#f0a82a" stroke-width="30" stroke-linejoin="round"/>
<path d="{p}" fill="#ffd84a" stroke="#ffd84a" stroke-width="14" stroke-linejoin="round"/>
<path d="M118 150 Q126 140 134 150" stroke="{INK}" stroke-width="6" fill="none" stroke-linecap="round"/>
<path d="M166 150 Q174 140 182 150" stroke="{INK}" stroke-width="6" fill="none" stroke-linecap="round"/>
<path d="M136 176 Q150 190 164 176" stroke="{INK}" stroke-width="6" fill="none" stroke-linecap="round"/>
<ellipse cx="110" cy="172" rx="11" ry="7" fill="#ff9a7a" opacity=".7"/><ellipse cx="190" cy="172" rx="11" ry="7" fill="#ff9a7a" opacity=".7"/>'''
    return svg(300, 300, body)


def lantern():
    body = f'''
<g stroke="{INK}" stroke-width="6" stroke-linejoin="round">
<path d="M130 10 V60" fill="none"/><path d="M60 14 Q130 -10 200 14" fill="none" stroke-width="8"/>
<rect x="92" y="56" width="76" height="26" rx="8" fill="#d9a441"/>
<ellipse cx="130" cy="190" rx="110" ry="112" fill="#e8413f"/>
<rect x="92" y="296" width="76" height="24" rx="8" fill="#d9a441"/>
<path d="M130 320 V350" fill="none"/>
</g>
<ellipse cx="130" cy="190" rx="70" ry="90" fill="#ff8a5a" opacity=".6"/>
<ellipse cx="130" cy="190" rx="34" ry="54" fill="#ffd27a" opacity=".8"/>
<path d="M130 82 Q60 190 130 300 M130 82 Q200 190 130 300" stroke="#b72b30" stroke-width="5" fill="none"/>
<path d="M118 350 L130 358 L142 350 L140 400 L120 400 Z" fill="#f0c04a"/>'''
    return svg(260, 410, body)


def fireflies():
    rnd = random.Random(4)
    parts = []
    for _ in range(9):
        x, y = rnd.uniform(40, 360), rnd.uniform(40, 260)
        parts.append(f'<circle cx="{x:.0f}" cy="{y:.0f}" r="30" fill="url(#ff)"/>'
                     f'<ellipse cx="{x - 6:.0f}" cy="{y - 7:.0f}" rx="7" ry="4" fill="#cfe3ff" opacity=".8"/>'
                     f'<circle cx="{x:.0f}" cy="{y:.0f}" r="7" fill="#f6ff9a"/>')
    defs = ('<radialGradient id="ff"><stop offset="0" stop-color="#eaff7a" stop-opacity=".95"/>'
            '<stop offset=".35" stop-color="#d4ff5a" stop-opacity=".55"/><stop offset="1" stop-color="#d4ff5a" stop-opacity="0"/></radialGradient>')
    return svg(400, 300, "".join(parts), defs)


def owl():
    body = f'''
<g stroke="{INK}" stroke-width="7" stroke-linejoin="round">
<path d="M40 320 H270" stroke="#6b4a3a" stroke-width="18" stroke-linecap="round"/>
<path d="M70 90 L60 20 L120 70 Z" fill="#8a5a3a"/><path d="M230 90 L240 20 L180 70 Z" fill="#8a5a3a"/>
<ellipse cx="150" cy="190" rx="100" ry="128" fill="#9a6a45"/>
<ellipse cx="150" cy="232" rx="62" ry="78" fill="#e8cfa4"/>
<path d="M52 170 Q20 240 70 300 Q80 230 90 190 Z" fill="#7a5236"/>
<path d="M248 170 Q280 240 230 300 Q220 230 210 190 Z" fill="#7a5236"/>
<circle cx="108" cy="136" r="40" fill="#fff" /><circle cx="192" cy="136" r="40" fill="#fff"/>
</g>
<circle cx="108" cy="136" r="30" fill="#f2a93b"/><circle cx="192" cy="136" r="30" fill="#f2a93b"/>
<circle cx="108" cy="138" r="17" fill="#2d2438"/><circle cx="192" cy="138" r="17" fill="#2d2438"/>
<circle cx="114" cy="131" r="6" fill="#fff"/><circle cx="198" cy="131" r="6" fill="#fff"/>
<path d="M140 172 L160 172 L150 196 Z" fill="#f2a93b" stroke="{INK}" stroke-width="4" stroke-linejoin="round"/>
<path d="M120 230 q10 10 20 0 M160 230 q10 10 20 0 M140 260 q10 10 20 0" stroke="#b98d5a" stroke-width="5" fill="none"/>
<path d="M120 320 v14 M135 320 v14 M165 320 v14 M180 320 v14" stroke="#e39a2a" stroke-width="8" stroke-linecap="round"/>'''
    return svg(300, 350, body)


def tree():
    body = f'''
<g stroke="{INK}" stroke-width="7" stroke-linejoin="round">
<path d="M180 600 Q195 420 190 300 L240 300 Q236 420 260 600 Z" fill="#6b4a3a"/>
<path d="M205 380 Q140 350 110 360" fill="none" stroke="#6b4a3a" stroke-width="20" stroke-linecap="round"/>
<circle cx="130" cy="210" r="100" fill="#2f6b4f"/><circle cx="300" cy="200" r="104" fill="#2f6b4f"/>
<circle cx="215" cy="120" r="112" fill="#3b7d5c"/><circle cx="215" cy="260" r="96" fill="#35744f"/>
</g>
<circle cx="170" cy="100" r="16" fill="#5aa07a" opacity=".6"/><circle cx="290" cy="170" r="12" fill="#5aa07a" opacity=".6"/>'''
    return svg(430, 610, body)


def mushroom():
    def one(x, y, s, cap):
        return (f'<g stroke="{INK}" stroke-width="6" stroke-linejoin="round" transform="translate({x} {y}) scale({s})">'
                f'<path d="M-24 0 Q-30 -60 -18 -90 H18 Q30 -60 24 0 Z" fill="#f4ecd8"/>'
                f'<path d="M-80 -86 Q0 -190 80 -86 Z" fill="{cap}"/></g>'
                f'<g transform="translate({x} {y}) scale({s})"><circle cx="-30" cy="-112" r="9" fill="#ffffff" opacity=".85"/>'
                f'<circle cx="18" cy="-126" r="11" fill="#ffffff" opacity=".85"/><circle cx="44" cy="-100" r="7" fill="#ffffff" opacity=".85"/></g>')
    return svg(300, 260, one(110, 250, 1.1, "#4fd0d8") + one(225, 250, 0.75, "#8f7cf0"))


def flower():
    parts = [f'<g stroke="#3f7d4c" stroke-width="10" stroke-linecap="round" fill="none">'
             '<path d="M180 300 Q170 200 90 120"/><path d="M180 300 Q185 190 180 80"/><path d="M180 300 Q200 200 280 130"/></g>',
             f'<path d="M180 250 Q120 230 110 190 Q160 190 180 250 Z" fill="#5aa05a" stroke="{INK}" stroke-width="5"/>',
             f'<path d="M182 230 Q240 210 256 170 Q205 170 182 230 Z" fill="#5aa05a" stroke="{INK}" stroke-width="5"/>']
    for (cx, cy, col) in [(90, 110, "#f28fb0"), (180, 72, "#ffd36b"), (280, 122, "#a9a2f2")]:
        for k in range(6):
            a = math.radians(k * 60)
            parts.append(f'<circle cx="{cx + 30 * math.cos(a):.0f}" cy="{cy + 30 * math.sin(a):.0f}" r="24" fill="{col}" stroke="{INK}" stroke-width="5"/>')
        parts.append(f'<circle cx="{cx}" cy="{cy}" r="18" fill="#fff3b0" stroke="{INK}" stroke-width="5"/>')
    return svg(370, 310, "".join(parts))


def lily():
    body = f'''
<path d="M200 150 L370 110 A180 130 0 1 1 330 60 Z" fill="#4f9a55" stroke="{INK}" stroke-width="7" stroke-linejoin="round"/>
<path d="M200 150 L90 80 M200 150 L60 170 M200 150 L150 260 M200 150 L270 250 M200 150 L360 190" stroke="#6fbf6a" stroke-width="6"/>
<g transform="translate(300 200)" stroke="{INK}" stroke-width="5" stroke-linejoin="round">
<path d="M0 0 Q-30 -30 -6 -62 Q10 -30 0 0 Z" fill="#f7a8c4"/><path d="M0 0 Q30 -30 6 -62 Q-10 -30 0 0 Z" fill="#f7a8c4"/>
<path d="M0 0 Q-44 -10 -46 -40 Q-16 -30 0 0 Z" fill="#f28fb0"/><path d="M0 0 Q44 -10 46 -40 Q16 -30 0 0 Z" fill="#f28fb0"/></g>'''
    return svg(400, 300, body)


def frog():
    body = f'''
<g stroke="{INK}" stroke-width="7" stroke-linejoin="round">
<ellipse cx="150" cy="180" rx="110" ry="70" fill="#6fbf5a"/>
<circle cx="100" cy="92" r="38" fill="#6fbf5a"/><circle cx="200" cy="92" r="38" fill="#6fbf5a"/>
<ellipse cx="60" cy="240" rx="42" ry="16" fill="#5aa84a"/><ellipse cx="240" cy="240" rx="42" ry="16" fill="#5aa84a"/>
<circle cx="100" cy="90" r="20" fill="#fff"/><circle cx="200" cy="90" r="20" fill="#fff"/>
</g>
<circle cx="104" cy="92" r="11" fill="#2d2438"/><circle cx="196" cy="92" r="11" fill="#2d2438"/>
<path d="M92 170 Q150 214 208 170" stroke="{INK}" stroke-width="7" fill="none" stroke-linecap="round"/>
<ellipse cx="150" cy="200" rx="60" ry="30" fill="#c9ec9a" opacity=".7"/>
<ellipse cx="78" cy="160" rx="14" ry="8" fill="#f6a3b8" opacity=".7"/><ellipse cx="222" cy="160" rx="14" ry="8" fill="#f6a3b8" opacity=".7"/>'''
    return svg(300, 270, body)


def bed():
    dots = "".join(f'<path d="{star_path(x, y, 12, 5)}" fill="#ffd84a"/>' for x, y in [(170, 200), (250, 240), (330, 190), (380, 250), (210, 270)])
    body = f'''
<g stroke="{INK}" stroke-width="8" stroke-linejoin="round">
<rect x="20" y="40" width="46" height="290" rx="16" fill="#c98a5a"/>
<rect x="400" y="120" width="42" height="210" rx="16" fill="#c98a5a"/>
<rect x="40" y="220" width="390" height="70" rx="10" fill="#e0a877"/>
<ellipse cx="120" cy="180" rx="62" ry="36" fill="#fbf6ee"/>
<path d="M130 160 Q260 120 420 170 L420 250 Q260 270 130 250 Z" fill="#6f8ee8"/>
</g>{dots}'''
    return svg(460, 340, body)


def cover():
    body = f'''
<rect width="800" height="1120" fill="url(#sky)"/>
{stars(80, 20, 20, 780, 700, 41)}
{moon(620, 200, 70)}
<path d="M-20 1120 Q200 780 520 830 Q700 860 820 900 V1120 Z" fill="#3a7a5a"/>
<path d="M-20 1120 Q300 920 820 1000 V1120 Z" fill="#2f6a4c"/>
<g transform="translate(250 600) scale(.9)">
<path d="{star_path(150, 160, 112, 52)}" fill="#ffd84a" stroke="#f0a82a" stroke-width="16" stroke-linejoin="round"/>
<circle cx="150" cy="160" r="170" fill="#fff4c2" opacity=".18"/></g>
<rect x="60" y="120" width="680" height="260" rx="40" fill="#fff8ea" opacity=".92"/>
<text x="400" y="250" text-anchor="middle" font-family="{FONT}" font-size="92" font-weight="700" fill="#2b3a78">乐乐送星星回家</text>
<text x="400" y="330" text-anchor="middle" font-family="{FONT}" font-size="40" fill="#8a6a4a">萤火绘本 · 第一册</text>'''
    return svg(800, 1120, body, SKY)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    files = {
        "bg-bedroom": bg_bedroom(), "bg-garden": bg_garden(), "bg-forest": bg_forest(), "bg-pond": bg_pond(),
        "bg-hill": bg_hill(), "lele": lele(), "star": star(), "lantern": lantern(), "fireflies": fireflies(),
        "owl": owl(), "tree": tree(), "mushroom": mushroom(), "flower": flower(), "lily": lily(),
        "frog": frog(), "bed": bed(), "cover": cover(),
    }
    for name, text in files.items():
        (OUT / f"{name}.svg").write_text(text, encoding="utf-8")
    print(f"wrote {len(files)} SVGs to {OUT}")


if __name__ == "__main__":
    main()
