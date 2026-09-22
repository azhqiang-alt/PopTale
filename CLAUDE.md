# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

萤火绘本 (Firefly Picture Books): a 3D pop-up picture-book reader for children, in Chinese. The books have narration, the word being read lights up, and tapping a word or an object in the scene makes it react. It is a static web app (Vite + three.js, no backend). Narration is generated offline by a Python script.

## Commands

Node is managed with nvm (`.nvmrc`), Python with pyenv (`.python-version`). There are three Python environments:
- **system python3** (stdlib only) runs `tools/build_voice.py`.
- **`.venv/`** in the project (mflux, rembg, pillow) runs `tools/gen_art.py`.
- **`~/.venvs/mlx-audio`** (the user's own environment, with the Qwen3-TTS weights in the HF cache) runs `tools/qwen_tts_worker.py`. `build_voice.py` starts the worker itself; do not install into this environment.

ffmpeg must be on PATH. The shell exports a SOCKS proxy, so the scripts drop the `*_proxy` variables when they run local models.

```bash
npm run dev          # Vite dev server (--host, so phones on the LAN can open it)
npm run build        # static build into dist/ (base "./", deployable under any path)

# narration (provider/voice/instruct come from story.json "narrator")
python3 tools/build_voice.py <book>                         # whole book -> public/books/<book>/voice/
python3 tools/build_voice.py <book> --sample 1 --voice serena   # audition: page 1 into tools/.cache/samples/

# illustrations (Z-Image Turbo via mflux; prompts in story.json "artStyle" + art[id].prompt/kind)
.venv/bin/python tools/gen_art.py <book> lele star --count 4   # candidates + sheet.png in tools/.cache/art/<book>/<id>/
.venv/bin/python tools/gen_art.py <book> --pick lele=1042      # cut out / shape, write art/<id>.webp, update story.json
.venv/bin/python tools/gen_art.py --save-model                 # once: keep an 8-bit copy in tools/.cache/models/

npm run art          # regenerate the placeholder SVG art (the fallback before real art exists)
```

There are no tests or linter yet. To check a change, run the app. A hidden or background tab pauses `requestAnimationFrame`, and with it every animation and tween. When you drive the app from browser automation, replace `requestAnimationFrame` with a `setTimeout` shim. Right after a navigation, the automation's first click can be lost; run a page script first.

## Architecture

**Books are data.** Each book lives in `public/books/<id>/`. `public/books/index.json` lists every book on the shelf; books with `status: "soon"` get a generated placeholder cover. A book folder contains:
- `story.json`: the art list, pages (`heading`, `text`, `hint`, `scene`) and the `end` page.
  - `scene` is `{ back, layers[] }`. Each layer is a paper card placed in right-page space: x -0.5..0.5, z -0.7 (far edge)..0.7, y up. Options are `float` (hovers and rises), `flat` (lies on the page), `tap` (the action to play), `sound` and `glow`.
- `voice/page-N.mp3` and `voice/timings.json`: generated. N is 1-based, and the last N is the end page.

**Text format (shared contract).** Page text is split into tokens on spaces; the spaces are not displayed. A token such as `{小星星:star/fall}` links to the scene object named `star` and plays the action `fall` on it. `src/tokens.js` and `tools/build_voice.py` must tokenize identically, because `timings.json` holds exactly one `{start, end}` entry per token. If the counts differ, the narrator falls back to estimated timings.

**Narration pipeline** (`tools/build_voice.py`):
1. Synthesize each sentence separately (for natural intonation), trim its silence, and join the sentences with fixed pauses. Sentence boundaries are therefore exact.
2. Inside a sentence, find the comma pauses in the energy envelope: pick the quiet gap closest to where each phrase should end by character count.
3. Inside a phrase, share the voiced time out by character count (Chinese has one syllable per character) and snap word boundaries onto pauses.

There is no speech recognizer. Clips are cached in `tools/.cache/voice/`, keyed by provider settings and text.

**Runtime flow** (`src/main.js`): `state.view` goes loading → shelf → picking → book.
- **Picking.** The shelf copy of the book (`shelf.js`) flies to the table while `loadBook` runs. Then the real `Book3D` replaces it. `state.pick` is bumped when a pick is abandoned, so a late load disposes itself.
- **Turning a page** (`goTo`): the current diorama pops out, `Book3D.turn()` bends one leaf along an arc, then `showPage` builds a new `Diorama`, shows the text card and schedules auto-read.
- **Narrator** (`narrator.js`): a Web Audio `AudioBufferSource` per page. `update()` runs every frame and compares the audio clock against the timings. It fires `onWord`, which highlights the span and plays the linked object's action. Tapping a word plays that word's slice of the page audio.
- **Sound** (`sound.js`): everything is synthesized, including the music-box music, the ambience and the effects. There are no audio files besides narration. `forAction()` maps scene actions to effect sounds.
- **Actions** are the `ACTIONS` table in `diorama.js`. A new action name must be added there, and optionally in `SoundKit.forAction`.

**Camera framing** (`stage.js`). Each named view (`shelf`, `closed`, `open`, `openNarrow`) has a centre, a half-size to keep in shot and a direction. `main.freeRect()` gives the screen area the HTML panels leave uncovered; in the book view it measures the text panel, whose height follows the page's text, and the left page lies under it. `Stage.pose()` fits the camera distance to that area, and `setViewOffset` shifts the image into it. If you change panel sizes in `style.css`, check `freeRect()` still matches. On top of the framed view, `Stage.closeUp()` drifts in on one object for a few seconds: the narrator does it for each linked word (at most every 1.4 s), and tapping an object does it too. `Stage.update()` blends that close-up and a small pointer parallax in every frame. Portrait and phone layout is decided by the same media query in both places: `(max-aspect-ratio: 1/1), (max-width: 760px)`.

**Book geometry** (`book3d.js`). The spine is at x=0 and the top of the page is at -z. Page surfaces are canvas textures from `textures.pageTexture`. The left page's spine is on the texture's right edge, so the turning leaf's back face uses a mirrored clone. The front cover is hinged at the spine and swings π to open.

**Art loading** (`textures.loadArt`). SVG and PNG files are drawn to a canvas, optionally with a white cut-paper outline. The alpha channel is kept on `texture.userData` so taps on transparent pixels fall through (`opaqueAt`).

## Direction

Planned: a set of preset books, then users uploading their own e-books and writing their own story collections. A book will then have to be produced from plain text by a pipeline: split into pages, link words to scene objects, write art prompts, paint and voice. Keep `story.json` the only contract between the tools and the reader. Keep the `tools/` scripts runnable without interaction, so a backend job can drive them later.

## Constraints

- Keep all content original. The project copies how StoryComet works, not its code, art, audio, stories or branding.
- Settings and progress live in `localStorage` (`store.js`), and every access is wrapped because storage can be unavailable.
