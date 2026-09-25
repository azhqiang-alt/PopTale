"""Checks a book's story.json against what the reader expects, before any art or voice is made.

    python3 tools/check_book.py whale-cloud          # one book
    python3 tools/check_book.py --all                # every book in public/books/index.json

Per page it checks: the text tokenizes (same rule as src/tokens.js); every {word:object/action}
link names an object on that page ("sky" is the back card) and a known action; every layer's art
id exists in "art"; and art files that should already exist are there (a missing file is only a
warning while the piece has a prompt and no picked seed, since gen_art.py will paint it).
If the book has narration, voice/timings.json must have one entry per token on every page:
after the text changes, the narration is stale until build_voice.py runs again.
Exits 1 if anything is wrong. Standard library only.
"""
import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BOOKS = ROOT / "public/books"
LINK = re.compile(r"^([^{]*)\{([^}:]+)(?::([^}]+))?\}(.*)$")


def known_actions():
    source = (ROOT / "src/diorama.js").read_text(encoding="utf-8")
    block = source[source.index("export const ACTIONS"):]
    block = block[:block.index("\n};")]
    return set(re.findall(r"^\s+(\w+): \{ dur:", block, re.M))


def check(book_id, actions):
    errors, warnings = [], []
    path = BOOKS / book_id / "story.json"
    story = json.loads(path.read_text(encoding="utf-8"))
    art = story.get("art", {})
    for art_id, entry in art.items():
        file = entry.get("file")
        if not file:
            errors.append(f"art {art_id}: no file")
        elif not (BOOKS / book_id / file).exists():
            (warnings if entry.get("prompt") and "seed" not in entry else errors).append(f"art {art_id}: {file} missing")
    pages = [(p.get("id", f"page {i + 1}"), p) for i, p in enumerate(story.get("pages", []))] + [("end", story.get("end", {}))]
    for pid, page in pages:
        scene = page.get("scene", {})
        if scene.get("back") and scene["back"] not in art:
            errors.append(f"{pid}: back {scene['back']} is not in art")
        names = {"sky"} if scene.get("back") else set()
        for layer in scene.get("layers", []):
            if layer.get("art") not in art:
                errors.append(f"{pid}: layer {layer.get('name')} uses unknown art {layer.get('art')}")
            if layer.get("name") in names:
                errors.append(f"{pid}: two objects named {layer['name']}")
            names.add(layer.get("name"))
            if layer.get("tap") and layer["tap"] not in actions:
                errors.append(f"{pid}: layer {layer['name']} taps unknown action {layer['tap']}")
            if not (-0.5 <= layer.get("x", 0) <= 0.5 and -0.7 <= layer.get("z", 0) <= 0.7):
                warnings.append(f"{pid}: layer {layer['name']} sits off the page")
        tokens = page.get("text", "").split()
        if not tokens:
            errors.append(f"{pid}: no text")
        for raw in tokens:
            if "{" in raw or "}" in raw:
                m = LINK.match(raw)
                if not m:
                    # a link with a space inside it spans two tokens; tokens.js would not read it
                    errors.append(f"{pid}: broken link token {raw!r}")
                    continue
                target, _, action = (m.group(3) or "").partition("/")
                if target and target not in names:
                    errors.append(f"{pid}: {m.group(2)} links to {target}, which is not on this page")
                if action and action not in actions:
                    errors.append(f"{pid}: {m.group(2)} plays unknown action {action}")
    check_voice(book_id, pages, errors, warnings)
    return errors, warnings


def check_voice(book_id, pages, errors, warnings):
    voice = BOOKS / book_id / "voice"
    timings_path = voice / "timings.json"
    if not timings_path.exists():
        warnings.append("no narration yet (voice/timings.json): run tools/build_voice.py")
        return
    timings = json.loads(timings_path.read_text(encoding="utf-8"))
    for n, (pid, page) in enumerate(pages, 1):
        count = len(page.get("text", "").split())
        got = timings.get(f"page-{n}")
        if got is None or not (voice / f"page-{n}.mp3").exists():
            errors.append(f"{pid}: no narration (voice/page-{n}.mp3): run tools/build_voice.py")
        elif len(got) != count:
            errors.append(f"{pid}: narration has {len(got)} words, the text {count}: the text changed, run tools/build_voice.py")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("book", nargs="?")
    ap.add_argument("--all", action="store_true")
    args = ap.parse_args()
    if args.all:
        index = json.loads((BOOKS / "index.json").read_text(encoding="utf-8"))
        ids = [b["id"] for b in index["books"] if (BOOKS / b["id"] / "story.json").exists()]
    elif args.book:
        ids = [args.book]
    else:
        ap.error("name a book or use --all")
    actions = known_actions()
    failed = False
    for book_id in ids:
        errors, warnings = check(book_id, actions)
        print(f"{book_id}: {len(errors)} errors, {len(warnings)} warnings")
        for e in errors:
            print(f"  error: {e}")
        for w in warnings:
            print(f"  warning: {w}")
        failed |= bool(errors)
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
