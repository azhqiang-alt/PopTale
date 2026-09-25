"""Paints a book's illustrations. The painter comes from story.json "painter" (default: Z-Image
Turbo through mflux, local on Apple Silicon); see "painters" below for how to add one.

Two steps, so a person chooses what goes into the book:

    # 1. candidates: a few seeds per piece, plus a contact sheet to compare them
    .venv/bin/python tools/gen_art.py lele-star lele star --count 4
    .venv/bin/python tools/gen_art.py lele-star --all --count 3
    .venv/bin/python tools/gen_art.py lele-star --todo --count 3   # only pieces not picked yet
    .venv/bin/python tools/gen_art.py lele-star star --painter openai --set quality=high

    # 2. pick: the chosen seed is cut out / shaped, written to art/<id>.webp, story.json updated
    .venv/bin/python tools/gen_art.py lele-star --pick lele=1042 star=2201

What to paint lives in story.json: "artStyle" (shared by every piece), and per art entry a
"prompt" and a "kind" ("sceneStyle" is added for scenes and the cover only; an entry may
carry its own "sceneStyle" to replace the book's):
  scene   back wall of a pop-up spread, 1024x800, cut to an arched card
  figure  a character or object, painted on white and cut out (rembg), cropped to its shape
  cover   the cover picture, 800x1120; the title is set on it in type (see --cover)

Painters (the PAINTERS table):
  zimage  Z-Image Turbo via mflux, offline. Settings: steps (9). ZIMAGE_MODEL points at a saved
          quantized model if there is one (see --save-model), otherwise the Hugging Face
          weights are quantized to 8 bits on load.
  openai  OpenAI image API (OPENAI_API_KEY). Settings: model (gpt-image-1), quality. Untested.

"painter" in story.json is {"provider": "zimage", ...settings}; --painter and --set override it.

Each candidate has a number: the seed, for painters that take one. It is kept in
tools/.cache/art/<book>/<id>/<number>.png, with <number>.json naming the painter and prompt.
Picking writes the number to the art entry's "seed" and the painter to its "painter".
Runs in the project .venv (mflux, rembg, pillow).
"""
import argparse
import base64
import io
import json
import os
import random
import sys
import urllib.request
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "tools/.cache/art"
LOCAL_MODEL = ROOT / "tools/.cache/models/z-image-turbo-q8"
SIZES = {"scene": (1024, 800), "figure": (1024, 1024), "cover": (800, 1120)}
SUFFIX = {
    "scene": "Wide background scene for a pop-up book page. Leave the lower middle open and uncluttered. "
             "No people, no animals, no text, no border.",
    "figure": "Single subject, full body, centered, facing the viewer, a sticker-like cut-out isolated on a plain "
              "pure white background with nothing behind it: no backdrop, no colored circle, no sky, no sparkles, "
              "no ground, no cast shadow, no text, no border, no other objects.",
    "cover": "Book cover illustration with a calm open area in the upper third for the title. No text, no letters.",
}
# LXGW WenKai (SIL OFL), fetched by tools/build_fonts.py; it is set into the covers we publish,
# so it must be a font whose licence allows that (not a system font)
FONTS = [str(ROOT / "tools/.cache/fonts/LXGWWenKai-Medium.ttf")]


def load_story(book):
    path = ROOT / "public/books" / book / "story.json"
    return path, json.loads(path.read_text(encoding="utf-8"))


# ---------- painters ----------
# A painter turns a prompt into a picture. To add one, write a class and decorate it with
# @painter. It needs:
#   name       the value of story.json "painter.provider" (and --painter) that selects it
#   seeded     True if the same seed paints the same picture again (else the seed is ignored)
#   __init__(cfg)  cfg: the painter settings; load nothing heavy here, --pick builds one too
#   key()      a string naming the model and the settings that change the picture
#   paint(prompt, width, height, seed) -> PIL image; another size is cropped to fit


PAINTERS = {}


def painter(cls):
    PAINTERS[cls.name] = cls
    return cls


def make_painter(story, name=None, overrides=()):
    cfg = dict(story.get("painter") or {})
    name = name or cfg.pop("provider", "zimage")
    cfg.pop("provider", None)
    cfg.update(overrides)
    if name not in PAINTERS:
        sys.exit(f"unknown painter {name!r} (known: {', '.join(sorted(PAINTERS))})")
    return PAINTERS[name](cfg)


@painter
class ZImage:
    name, seeded = "zimage", True

    def __init__(self, cfg):
        self.steps = int(cfg.get("steps", 9))
        self.model = None

    def key(self):
        return f"zimage:turbo:{self.steps}"

    def paint(self, prompt, width, height, seed):
        if self.model is None:
            # the model is big: import and load only when painting
            from mflux.models.common.config import ModelConfig
            from mflux.models.z_image import ZImageTurbo
            path = os.environ.get("ZIMAGE_MODEL") or (str(LOCAL_MODEL) if LOCAL_MODEL.exists() else None)
            print(f"loading Z-Image Turbo ({path or 'Tongyi-MAI/Z-Image-Turbo, 8-bit'})…", flush=True)
            self.model = ZImageTurbo(model_config=ModelConfig.z_image_turbo(), model_path=path, quantize=None if path else 8)
        image = self.model.generate_image(seed=seed, prompt=prompt, num_inference_steps=self.steps, width=width, height=height)
        return image.image if hasattr(image, "image") else image


@painter
class OpenAIImage:
    name, seeded = "openai", False
    SIZES = {"1024x1024": 1.0, "1536x1024": 1.5, "1024x1536": 1 / 1.5}

    def __init__(self, cfg):
        self.model, self.quality = cfg.get("model", "gpt-image-1"), cfg.get("quality", "medium")

    def key(self):
        return f"openai:{self.model}:{self.quality}"

    def paint(self, prompt, width, height, seed):
        api_key = os.environ.get("OPENAI_API_KEY") or sys.exit("OPENAI_API_KEY is not set")
        size = min(self.SIZES, key=lambda k: abs(self.SIZES[k] - width / height))
        body = json.dumps({"model": self.model, "prompt": prompt, "size": size, "quality": self.quality, "n": 1}).encode()
        req = urllib.request.Request("https://api.openai.com/v1/images/generations", data=body,
                                     headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=300) as res:
            data = json.loads(res.read())["data"][0]["b64_json"]
        return Image.open(io.BytesIO(base64.b64decode(data)))


def prompt_for(story, entry):
    kind = entry.get("kind", "figure")
    # the night palette would paint a dark backdrop behind a cut-out figure: scenes and cover only
    # an entry's own "sceneStyle" replaces the book's (a night page in a sunny book)
    palette = entry.get("sceneStyle", story.get("sceneStyle", "")) if kind in ("scene", "cover") else ""
    return " ".join(x for x in (entry["prompt"], story.get("artStyle", ""), palette, SUFFIX[kind]) if x)


def candidates(book, story, ids, count, painter):
    for art_id in ids:
        entry = story["art"][art_id]
        kind = entry.get("kind", "figure")
        w, h = entry.get("size") or SIZES[kind]
        out = CACHE / book / art_id
        out.mkdir(parents=True, exist_ok=True)
        text = prompt_for(story, entry)
        numbers = [random.randrange(1, 100000) for _ in range(count)]
        for number in numbers:
            image = painter.paint(text, w, h, number).convert("RGB")
            if image.size != (w, h):
                image = ImageOps.fit(image, (w, h), Image.LANCZOS)
            image.save(out / f"{number}.png")
            (out / f"{number}.json").write_text(json.dumps({"painter": painter.key(), "prompt": text}, ensure_ascii=False),
                                               encoding="utf-8")
            print(f"  {art_id}: {'seed' if painter.seeded else 'candidate'} {number}", flush=True)
        sheet(out, art_id)


def sheet(folder, art_id):
    """All candidates of one piece side by side, labelled with their seeds."""
    files = sorted(folder.glob("[0-9]*.png"), key=lambda p: p.stat().st_mtime)
    if not files:
        return
    thumbs = []
    for f in files:
        im = Image.open(f).convert("RGB")
        im.thumbnail((360, 360))
        thumbs.append((f.stem, im))
    cols = min(4, len(thumbs))
    rows = (len(thumbs) + cols - 1) // cols
    cw, ch = 370, max(t.height for _, t in thumbs) + 36
    board = Image.new("RGB", (cols * cw + 10, rows * ch + 10), "#2a2640")
    draw = ImageDraw.Draw(board)
    font = ImageFont.truetype(FONTS[0], 22) if Path(FONTS[0]).exists() else None
    for i, (seed, im) in enumerate(thumbs):
        x, y = 10 + (i % cols) * cw, 10 + (i // cols) * ch
        board.paste(im, (x, y))
        draw.text((x, y + im.height + 6), f"{art_id} = {seed}", fill="#ffe7a0", font=font)
    board.save(folder / "sheet.png")
    print(f"  sheet: {folder / 'sheet.png'}")


def cut_out(im):
    """White-background painting -> transparent cut-out, cropped to the subject.

    rembg alone punches holes in white subjects on white (a white bunny's belly). The art has
    an ink outline, so the background is also found as the near-white area connected to the
    image border; the subject is whatever is not that background, or what rembg keeps, with
    enclosed holes filled."""
    import numpy as np
    from rembg import new_session, remove
    from scipy import ndimage
    global _session
    if "_session" not in globals():
        _session = new_session("isnet-general-use")
    rgb = np.asarray(im.convert("RGB")).astype(np.int16)
    ai = np.asarray(remove(im, session=_session, only_mask=True, post_process_mask=True)) > 128
    whiteish = (rgb.min(axis=2) > 232) & (rgb.max(axis=2) - rgb.min(axis=2) < 20)
    labels, _ = ndimage.label(whiteish)
    edge = np.unique(np.concatenate([labels[0], labels[-1], labels[:, 0], labels[:, -1]]))
    background = np.isin(labels, edge[edge > 0])
    mask = ndimage.binary_fill_holes((~background) | ai)
    mask = ndimage.binary_opening(mask, iterations=2)  # drop specks of paper texture
    keep, n = ndimage.label(mask)
    if n > 1:  # keep the subject: the largest piece, plus pieces nearly as big (two mushrooms)
        sizes = ndimage.sum(mask, keep, range(1, n + 1))
        mask = np.isin(keep, [i + 1 for i, s in enumerate(sizes) if s >= sizes.max() * 0.08])
    alpha = Image.fromarray((mask * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.8))
    cut = im.convert("RGBA")
    cut.putalpha(alpha)
    box = alpha.point(lambda a: 255 if a > 24 else 0).getbbox()
    if box:
        pad = 12
        cut = cut.crop((max(0, box[0] - pad), max(0, box[1] - pad), min(cut.width, box[2] + pad), min(cut.height, box[3] + pad)))
    return cut


def arch(im, radius=120):
    """The back card's shape: rounded top corners, square bottom (it stands on the page)."""
    im = im.convert("RGBA")
    mask = Image.new("L", im.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, im.width, im.height + radius), radius=radius, fill=255)
    im.putalpha(mask)
    return im


def title_cover(im, title, subtitle):
    """Set the title in type on a soft paper band (image models misdraw Chinese titles)."""
    im = im.convert("RGBA")
    w, h = im.size
    font_path = next((f for f in FONTS if Path(f).exists()), None) or sys.exit("no cover font: run tools/build_fonts.py first")
    big, small = ImageFont.truetype(font_path, 88), ImageFont.truetype(font_path, 36)
    band = Image.new("RGBA", im.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(band)
    d.rounded_rectangle((50, 110, w - 50, 360), radius=40, fill=(255, 248, 234, 225))
    band = band.filter(ImageFilter.GaussianBlur(0.6))
    im = Image.alpha_composite(im, band)
    d = ImageDraw.Draw(im)
    d.text((w / 2, 225), title, font=big, fill="#2b3a78", anchor="mm")
    d.text((w / 2, 310), subtitle, font=small, fill="#8a6a4a", anchor="mm")
    return im


def pick(book, story_path, story, choices):
    art_dir = ROOT / "public/books" / book / "art"
    for choice in choices:
        art_id, seed = choice.split("=")
        entry = story["art"][art_id]
        kind = entry.get("kind", "figure")
        src = CACHE / book / art_id / f"{seed}.png"
        if not src.exists():
            sys.exit(f"no candidate {src}")
        im = Image.open(src).convert("RGB")
        if kind == "figure":
            im = cut_out(im)
            im.thumbnail((900, 900))
        elif kind == "scene":
            im = arch(im)
        elif kind == "cover":
            im = title_cover(im, story["title"], entry.get("subtitle", "萤火绘本"))
        name = f"{art_id}.webp"
        im.save(art_dir / name, "WEBP", quality=88, method=6)
        entry["file"] = f"art/{name}"
        entry["seed"] = int(seed)
        meta = src.with_suffix(".json")
        if meta.exists():
            entry["painter"] = json.loads(meta.read_text(encoding="utf-8"))["painter"]
        if kind == "figure":
            entry["outline"] = entry.get("outline", 6) or 6
        if kind == "cover":
            story["cover"] = f"art/{name}"
        print(f"  {art_id} <- seed {seed}: art/{name} ({im.width}x{im.height})")
    story_path.write_text(json.dumps(story, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    if any(c.split("=")[0] == "cover" for c in choices):
        index_path = ROOT / "public/books/index.json"
        index = json.loads(index_path.read_text(encoding="utf-8"))
        for b in index["books"]:
            if b["id"] == book:
                b["cover"] = f"books/{book}/{story['cover']}"
        index_path.write_text(json.dumps(index, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def save_model():
    from mflux.models.common.config import ModelConfig
    from mflux.models.z_image import ZImageTurbo
    m = ZImageTurbo(model_config=ModelConfig.z_image_turbo(), quantize=8)
    LOCAL_MODEL.parent.mkdir(parents=True, exist_ok=True)
    m.save_model(str(LOCAL_MODEL))
    print(f"saved {LOCAL_MODEL}")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("book", nargs="?")
    ap.add_argument("ids", nargs="*", help="art ids to paint")
    ap.add_argument("--all", action="store_true", help="paint every art entry that has a prompt")
    ap.add_argument("--todo", action="store_true", help="paint the entries with a prompt that have no picked seed yet")
    ap.add_argument("--count", type=int, default=3, help="candidates per piece")
    ap.add_argument("--painter", choices=sorted(PAINTERS), help="override story.json painter.provider")
    ap.add_argument("--steps", type=int, help="inference steps for zimage (default 9)")
    ap.add_argument("--set", nargs="+", default=[], metavar="KEY=VALUE", help="override any painter setting")
    ap.add_argument("--pick", nargs="+", metavar="ID=SEED", help="put the chosen candidates into the book")
    ap.add_argument("--save-model", action="store_true", help="quantize the model to 8 bits once and keep it locally")
    args = ap.parse_args()
    if args.save_model:
        save_model()
        return
    if not args.book:
        ap.error("book is required")
    story_path, story = load_story(args.book)
    if args.pick:
        pick(args.book, story_path, story, args.pick)
        return
    if args.all or args.todo:
        ids = [k for k, v in story["art"].items() if v.get("prompt") and (args.all or "seed" not in v)]
    else:
        ids = args.ids
    if not ids:
        ap.error("name art ids or use --all")
    overrides = dict(kv.split("=", 1) for kv in args.set)
    if args.steps:
        overrides["steps"] = args.steps
    candidates(args.book, story, ids, args.count, make_painter(story, args.painter, overrides))


if __name__ == "__main__":
    main()
