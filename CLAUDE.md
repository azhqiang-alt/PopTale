# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

萤火绘本 (Firefly Picture Books): a 3D pop-up picture-book reader for children, in Chinese. The books have narration, the word being read lights up, and tapping a word or an object in the scene makes it react. It is a static web app (Vite + three.js, no backend). Narration is generated offline by a Python script.

## Commands

Node is managed with nvm (`.nvmrc`), Python with pyenv (`.python-version`). The Python tools use only the standard library, and they need `ffmpeg` on PATH.

```bash
npm run dev          # Vite dev server (--host, so phones on the LAN can open it)
npm run build        # static build into dist/ (base "./", deployable under any path)
npm run voice -- <book-id>                    # build narration with macOS `say` (voice from story.json)
npm run voice -- <book-id> --provider openai  # same via OpenAI TTS (needs OPENAI_API_KEY; untested)
npm run art          # regenerate the placeholder SVG art for lele-star
```

There are no tests or linter yet. To check a change, run the app. A hidden or background tab pauses `requestAnimationFrame`, and with it every animation and tween. When you drive the app from browser automation, replace `requestAnimationFrame` with a `setTimeout` shim.

## Architecture

**Books are data.** Each book lives in `public/books/<id>/`. `public/books/index.json` lists every book on the shelf; books with `status: "soon"` get a generated placeholder cover. A book folder contains:
- `story.json`: the art list, pages (`heading`, `text`, `hint`, `scene`) and the `end` page.
  - `scene` is `{ back, layers[] }`. Each layer is a paper card placed in right-page space: x -0.5..0.5, z -0.7 (far edge)..0.7, y up. Options are `float` (hovers and rises), `flat` (lies on the page), `tap` (the action to play), `sound` and `glow`.
- `voice/page-N.mp3` and `voice/timings.json`: generated. N is 1-based, and the last N is the end page.

**Text format (shared contract).** Page text is split into tokens on spaces; the spaces are not displayed. A token such as `{小星星:star/fall}` links to the scene object named `star` and plays the action `fall` on it. `src/tokens.js` and `tools/build_voice.py` must tokenize identically, because `timings.json` holds exactly one `{start, end}` entry per token. If the counts differ, the narrator falls back to estimated timings.

**Narration pipeline** (`tools/build_voice.py`):
1. Split the page into phrases at punctuation.
2. Synthesize each phrase separately and trim its silence.
3. Join the phrases with fixed pauses.

Phrase boundaries are therefore exact. Within a phrase, time is shared out by character count, since Chinese has one syllable per character. There is no speech recognizer. Synthesized phrases are cached in `tools/.cache/`.

**Runtime flow** (`src/main.js`): `state.view` goes loading → shelf → picking → book.
- **Picking.** The shelf copy of the book (`shelf.js`) flies to the table while `loadBook` runs. Then the real `Book3D` replaces it. `state.pick` is bumped when a pick is abandoned, so a late load disposes itself.
- **Turning a page** (`goTo`): the current diorama pops out, `Book3D.turn()` bends one leaf along an arc, then `showPage` builds a new `Diorama`, shows the text card and schedules auto-read.
- **Narrator** (`narrator.js`): a Web Audio `AudioBufferSource` per page. `update()` runs every frame and compares the audio clock against the timings. It fires `onWord`, which highlights the span and plays the linked object's action. Tapping a word plays that word's slice of the page audio.
- **Sound** (`sound.js`): everything is synthesized, including the music-box music, the ambience and the effects. There are no audio files besides narration. `forAction()` maps scene actions to effect sounds.
- **Actions** are the `ACTIONS` table in `diorama.js`. A new action name must be added there, and optionally in `SoundKit.forAction`.

**Camera framing** (`stage.js`). Each named view (`shelf`, `closed`, `open`, `openNarrow`) has a centre, a half-size to keep in shot and a direction. `main.freeRect()` gives the screen area the HTML panels leave uncovered. `Stage.pose()` fits the camera distance to that area, and `setViewOffset` shifts the image into it. If you change panel sizes in `style.css`, update `freeRect()` to match. Portrait and phone layout is decided by the same media query in both places: `(max-aspect-ratio: 1/1), (max-width: 760px)`.

**Book geometry** (`book3d.js`). The spine is at x=0 and the top of the page is at -z. Page surfaces are canvas textures from `textures.pageTexture`. The left page's spine is on the texture's right edge, so the turning leaf's back face uses a mirrored clone. The front cover is hinged at the spine and swings π to open.

**Art loading** (`textures.loadArt`). SVG and PNG files are drawn to a canvas, optionally with a white cut-paper outline. The alpha channel is kept on `texture.userData` so taps on transparent pixels fall through (`opaqueAt`).

## Constraints

- Keep all content original. The project copies how StoryComet works, not its code, art, audio, stories or branding.
- Settings and progress live in `localStorage` (`store.js`), and every access is wrapped because storage can be unavailable.
