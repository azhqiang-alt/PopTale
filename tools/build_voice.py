"""Builds a book's narration: one mp3 per page plus voice/timings.json (start/end per token).

Each sentence is synthesized on its own (natural intonation) and its outer silence trimmed;
sentences are joined with fixed pauses, so sentence boundaries are exact. Inside a sentence,
the pauses at commas are found in the audio (the quiet gaps nearest to where the phrases
should end), and inside a phrase the time is shared out by character count: Chinese is
syllable-timed, one character per syllable. No speech recognizer is needed.

    python3 tools/build_voice.py lele-star                    # provider from story.json narrator
    python3 tools/build_voice.py lele-star --provider say     # macOS system voice
    python3 tools/build_voice.py lele-star --voice serena     # try another voice
    python3 tools/build_voice.py lele-star --set speed=0.9    # any other provider setting
    python3 tools/build_voice.py lele-star --sample 1         # only page 1, to audition a voice

Providers (the PROVIDERS table; see "providers" below for how to add one):
  qwen    Qwen3-TTS through mlx-audio, run by tools/qwen_tts_worker.py in the mlx-audio
          environment (MLX_AUDIO_PYTHON, default ~/.venvs/mlx-audio/bin/python). Offline.
  say     macOS `say`.
  openai  OpenAI speech API (OPENAI_API_KEY). Untested.

Settings come from story.json "narrator": its shared fields (voice, instruct, speed...), then
the provider's own block, which wins (e.g. "say": {"voice": "Tingting", "rate": 150}), then
--voice/--speed/--rate/--set on the command line.

Needs ffmpeg. Output: public/books/<id>/voice/page-N.mp3, title.mp3, timings.json.
Page N is 1-based; the last page is the end card. Clips are cached in tools/.cache/voice.
"""
import argparse
import array
import hashlib
import json
import math
import os
import re
import subprocess
import sys
import tempfile
import urllib.request
import wave
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "tools/.cache/voice"
SAMPLES = ROOT / "tools/.cache/samples"
RATE = 44100
LINK = re.compile(r"^([^{]*)\{([^}:]+)(?::([^}]+))?\}(.*)$")
PUNCT = re.compile(r"[，。！？：；、,.!?:;“”\"'‘’（）()…—\s]")
CLOSERS = "”\"’'）)"
STOP = re.compile(r"[。！？!?.…]$")
PHRASE_END = re.compile(r"[，。！？：；、,.!?:;…]$")
LEAD, TAIL, SENTENCE_GAP = 0.3, 0.7, 0.45
HOP = 0.01  # analysis frame, seconds
QWEN_MODEL = "mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-6bit"


def tokens(text):
    """Same split as src/tokens.js: whitespace-separated, {word:target/action} braces removed."""
    out = []
    for raw in text.split():
        m = LINK.match(raw)
        out.append(m.group(1) + m.group(2) + m.group(4) if m else raw)
    return out


def weight(token):
    return float(len(PUNCT.sub("", token)))


def group(indices, toks, pattern):
    """Split token indices after tokens ending with `pattern` punctuation."""
    groups, cur = [], []
    for i in indices:
        cur.append(i)
        if pattern.search(toks[i].rstrip(CLOSERS)):
            groups.append(cur)
            cur = []
    if cur:
        groups.append(cur)
    return groups


def run(cmd, **kw):
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, **kw)


TRIM = "silenceremove=start_periods=1:start_threshold=-45dB"


def pcm(src, af=None):
    """Any audio file -> mono float samples at RATE, through an optional ffmpeg filter."""
    raw = subprocess.run(["ffmpeg", "-loglevel", "error", "-i", str(src), *(["-af", af] if af else []),
                          "-ac", "1", "-ar", str(RATE), "-f", "f32le", "-"], check=True, capture_output=True).stdout
    samples = array.array("f")
    samples.frombytes(raw)
    return samples


def decode(src):
    """The clip with the silence at both ends trimmed."""
    return pcm(src, f"{TRIM},areverse,{TRIM},areverse")


def lead_trimmed(src):
    """Seconds of silence decode() cuts from the start (to shift a provider's word times)."""
    return (len(pcm(src)) - len(pcm(src, TRIM))) / RATE


def offline_env():
    """The local model needs no network; drop proxies (a SOCKS proxy breaks httpx imports)."""
    env = {k: v for k, v in os.environ.items() if not k.lower().endswith("_proxy")}
    env["HF_HUB_OFFLINE"] = "1"
    return env


# ---------- providers ----------
# A provider turns sentences into audio files. To add one, write a class and decorate it with
# @provider. It needs:
#   name               the value of narrator "provider" (and --provider) that selects it
#   ext                the type of audio file it writes
#   __init__(cfg)      cfg: its settings from story.json (see provider_config)
#   key()              a string naming everything that changes the sound; clips are cached under it
#   synth_many(items)  write one audio file per (text, path)
# If the service reports when each word is said, also set marks = True and have synth_many
# return, for each item, a list of {"text", "start", "end"} (seconds into the file it wrote).
# The marks may be characters or words; their texts must spell the sentence (punctuation and
# spaces aside). Those times are then used instead of the estimate from the audio.

PROVIDERS = {}


def provider(cls):
    PROVIDERS[cls.name] = cls
    return cls


def provider_config(narrator, name, overrides):
    """The narrator's shared fields, then the provider's own block, then command-line overrides."""
    cfg = {k: v for k, v in narrator.items() if k != "provider" and not isinstance(v, dict)}
    cfg.update(narrator.get(name) or {})
    cfg.update({k: v for k, v in overrides.items() if v is not None})
    return cfg


@provider
class Say:
    name, ext, marks = "say", ".aiff", False

    def __init__(self, cfg):
        self.voice, self.rate = cfg.get("voice", "Tingting"), int(cfg.get("rate", 150))

    def key(self):
        return f"say:{self.voice}:{self.rate}"

    def synth_many(self, items):
        for text, out in items:
            run(["say", "-v", self.voice, "-r", str(self.rate), "-o", str(out), text])


@provider
class Qwen:
    name, ext, marks = "qwen", ".wav", False

    def __init__(self, cfg):
        self.voice, self.instruct = cfg.get("voice", "vivian"), cfg.get("instruct")
        self.speed, self.model = float(cfg.get("speed", 1.0)), cfg.get("model", QWEN_MODEL)
        self.python = os.environ.get("MLX_AUDIO_PYTHON", str(Path.home() / ".venvs/mlx-audio/bin/python"))

    def key(self):
        return f"qwen:{self.model}:{self.voice}:{self.speed}:{self.instruct}"

    def synth_many(self, items):
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8") as f:
            json.dump({"model": self.model, "voice": self.voice, "instruct": self.instruct, "lang": "zh", "speed": self.speed,
                       "items": [{"text": t, "out": str(o)} for t, o in items]}, f, ensure_ascii=False)
        try:
            subprocess.run([self.python, str(ROOT / "tools/qwen_tts_worker.py"), f.name], check=True, env=offline_env())
        finally:
            os.unlink(f.name)


@provider
class OpenAI:
    name, ext, marks = "openai", ".wav", False

    def __init__(self, cfg):
        self.voice, self.instruct = cfg.get("voice", "nova"), cfg.get("instruct")
        self.model = cfg.get("model", "gpt-4o-mini-tts")
        self.api_key = os.environ.get("OPENAI_API_KEY") or sys.exit("OPENAI_API_KEY is not set")

    def key(self):
        return f"openai:{self.model}:{self.voice}:{self.instruct}"

    def synth_many(self, items):
        for text, out in items:
            body = json.dumps({"model": self.model, "voice": self.voice, "input": text,
                               "instructions": self.instruct, "response_format": "wav"}).encode()
            req = urllib.request.Request("https://api.openai.com/v1/audio/speech", data=body,
                                         headers={"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=120) as res:
                Path(out).write_bytes(res.read())


class Clips:
    """Trimmed audio per sentence, cached on disk by provider settings and text, with the
    provider's word marks beside it when it gives them."""

    def __init__(self, provider, tmp):
        self.provider, self.tmp = provider, Path(tmp)
        CACHE.mkdir(parents=True, exist_ok=True)

    def path(self, text, ext=".f32"):
        return CACHE / (hashlib.sha1(f"{self.provider.key()}|{text}".encode()).hexdigest()[:20] + ext)

    def prefetch(self, texts):
        missing = sorted({t for t in texts if PUNCT.sub("", t) and not self.path(t).exists()})
        if not missing:
            return
        print(f"synthesizing {len(missing)} sentences…", flush=True)
        items = [(t, self.tmp / f"clip{i}{self.provider.ext}") for i, t in enumerate(missing)]
        marks = self.provider.synth_many(items) if self.provider.marks else None
        for k, (text, out) in enumerate(items):
            if marks and marks[k]:
                lead = lead_trimmed(out)
                shifted = [{"text": m["text"], "start": m["start"] - lead, "end": m["end"] - lead} for m in marks[k]]
                self.path(text, ".marks.json").write_text(json.dumps(shifted, ensure_ascii=False), encoding="utf-8")
            self.path(text).write_bytes(decode(out).tobytes())

    def get(self, text):
        samples = array.array("f")
        samples.frombytes(self.path(text).read_bytes())
        return samples

    def marks(self, text):
        path = self.path(text, ".marks.json")
        return json.loads(path.read_text(encoding="utf-8")) if path.exists() else None


# ---------- alignment inside a sentence ----------


def envelope(clip):
    n = int(RATE * HOP)
    return [math.sqrt(sum(s * s for s in clip[i:i + n]) / n) for i in range(0, len(clip) - n + 1, n)]


def quiet_gaps(env, min_len=0.05):
    """Runs of low energy inside the clip, in time order: ([(start, end) seconds], threshold)."""
    if len(env) < 10:
        return [], 0.0
    ordered = sorted(env)
    floor, peak = ordered[len(env) // 10], ordered[int(len(env) * 0.98)]
    thr = floor + (peak - floor) * 0.12
    gaps, start = [], None
    for f, v in enumerate(env):
        if v < thr and start is None:
            start = f
        elif v >= thr and start is not None:
            if start > 0 and (f - start) * HOP >= min_len:
                gaps.append((start * HOP, f * HOP))
            start = None
    return gaps, thr


def phrase_spans(env, weights, dur):
    """Where each phrase of a sentence is spoken: pick, in order, the quiet gap that is long and
    close to where the phrase should end by character count. Falls back to proportional spans."""
    n = len(weights)
    total = sum(weights) or 1.0
    expected, acc = [], 0.0
    for w in weights[:-1]:
        acc += w
        expected.append(acc / total * dur)
    gaps, _ = quiet_gaps(env)
    chosen, last = [], 0.0
    for k, exp in enumerate(expected):
        room = n - 2 - k  # boundaries still to place after this one
        cands = [g for j, g in enumerate(gaps) if g[0] > last + 0.12 and len(gaps) - j - 1 >= room]
        if not cands:
            chosen = None
            break
        best = max(cands, key=lambda g: (g[1] - g[0]) - 0.3 * abs((g[0] + g[1]) / 2 - exp))
        chosen.append(best)
        last = best[1]
    if chosen is None:
        cuts = [(e, e) for e in expected]
    else:
        cuts = chosen
    edges = [0.0] + [c for g in cuts for c in g] + [dur]
    return [(edges[2 * i], edges[2 * i + 1]) for i in range(n)]


def voiced_segments(env, thr, start, end, min_gap=0.12):
    """The stretches of sound in [start, end], split at pauses of at least min_gap."""
    a, b = int(start / HOP), min(len(env), max(int(start / HOP) + 1, int(end / HOP)))
    segs, seg_start, quiet = [], None, 0
    for f in range(a, b):
        if env[f] >= thr:
            if seg_start is None:
                seg_start = f
            elif quiet * HOP >= min_gap:
                segs.append((seg_start * HOP, (f - quiet) * HOP))
                seg_start = f
            quiet = 0
        elif seg_start is not None:
            quiet += 1
    if seg_start is not None:
        segs.append((seg_start * HOP, (b - quiet) * HOP))
    return segs or [(start, end)]


def spread_voiced(segs, weights, snap=0.08):
    """Share the voiced time among tokens by weight. A token boundary that lands within `snap`
    seconds of a pause is moved onto it, so words start after a pause, not in its middle."""
    total_voiced = sum(e - s for s, e in segs)
    total = sum(weights) or 1.0
    edges = [0.0]
    for w in weights:
        edges.append(edges[-1] + total_voiced * w / total)

    def at(v, prefer_next):
        acc = 0.0
        for k, (s, e) in enumerate(segs):
            length = e - s
            if v <= acc + length + 1e-9:
                inside = v - acc
                if prefer_next and length - inside < snap and k + 1 < len(segs):
                    return segs[k + 1][0]
                if not prefer_next and inside < snap and k > 0:
                    return segs[k - 1][1]
                return s + inside
            acc += length
        return segs[-1][1]

    return [(at(edges[i], True), max(at(edges[i], True), at(edges[i + 1], False))) for i in range(len(weights))]


def align_sentence(clip, toks, idxs):
    """{token index: (start, end)} within the clip."""
    dur = len(clip) / RATE
    env = envelope(clip)
    _, thr = quiet_gaps(env)
    phrases = group(idxs, toks, PHRASE_END)
    spans = phrase_spans(env, [max(0.5, sum(weight(toks[i]) for i in p)) for p in phrases], dur)
    out = {}
    for phrase, (s, e) in zip(phrases, spans):
        segs = voiced_segments(env, thr, s, e)
        for i, span in zip(phrase, spread_voiced(segs, [weight(toks[i]) for i in phrase])):
            out[i] = span
    return out


def spans_from_marks(marks, toks, idxs, dur):
    """{token index: (start, end)} from the provider's own word times, or None when the marks
    do not spell the sentence. A mark covering several characters is shared out evenly."""
    chars = []
    for m in marks:
        spoken = PUNCT.sub("", m["text"])
        step = (m["end"] - m["start"]) / max(1, len(spoken))
        chars += [(m["start"] + k * step, m["start"] + (k + 1) * step) for k in range(len(spoken))]
    text = "".join(PUNCT.sub("", toks[i]) for i in idxs)
    if "".join(PUNCT.sub("", m["text"]) for m in marks).lower() != text.lower():
        return None
    clamp = lambda t: round(min(max(t, 0.0), dur), 3)
    out, c, last = {}, 0, 0.0
    for i in idxs:
        n = len(PUNCT.sub("", toks[i]))
        if n:
            last = clamp(chars[c + n - 1][1])
            out[i] = (clamp(chars[c][0]), last)
            c += n
        else:
            out[i] = (last, last)
    return out


# ---------- pages ----------


def sentences(toks):
    return group(range(len(toks)), toks, STOP)


def sentence_text(toks, idxs):
    return "".join(toks[i] for i in idxs)


def build_page(clips, toks):
    """Returns (samples, timings) for one page."""
    audio = array.array("f", bytes(4 * int(LEAD * RATE)))
    timings = [None] * len(toks)
    groups = sentences(toks)
    for si, idxs in enumerate(groups):
        text = sentence_text(toks, idxs)
        offset = len(audio) / RATE
        if not PUNCT.sub("", text):
            for i in idxs:
                timings[i] = {"start": round(offset, 3), "end": round(offset, 3)}
            continue
        clip = clips.get(text)
        marks = clips.marks(text)
        spans = marks and spans_from_marks(marks, toks, idxs, len(clip) / RATE)
        if marks and not spans:
            print(f"  note: the provider's word marks do not match {text!r}; estimating from the audio")
        for i, (s, e) in (spans or align_sentence(clip, toks, idxs)).items():
            timings[i] = {"start": round(offset + s, 3), "end": round(offset + e, 3)}
        audio.extend(clip)
        if si < len(groups) - 1:
            audio.extend(array.array("f", bytes(4 * int(SENTENCE_GAP * RATE))))
    audio.extend(array.array("f", bytes(4 * int(TAIL * RATE))))
    return audio, timings


def write_mp3(samples, out, tmp):
    wav = Path(tmp) / "page.wav"
    with wave.open(str(wav), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(array.array("h", (max(-32767, min(32767, int(s * 32767))) for s in samples)).tobytes())
    run(["ffmpeg", "-loglevel", "error", "-y", "-i", str(wav), "-af", "loudnorm=I=-18:TP=-2", "-ar", str(RATE),
         "-ac", "1", "-codec:a", "libmp3lame", "-b:a", "96k", str(out)])


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("book")
    ap.add_argument("--provider", choices=sorted(PROVIDERS))
    ap.add_argument("--voice", help="override the voice in story.json")
    ap.add_argument("--rate", type=int, help="words per minute for `say`")
    ap.add_argument("--speed", type=float, help="speed for qwen (1.0 = normal)")
    ap.add_argument("--set", nargs="+", default=[], metavar="KEY=VALUE", help="override any provider setting")
    ap.add_argument("--sample", type=int, help="only build page N into tools/.cache/samples (does not touch the book)")
    args = ap.parse_args()

    base = ROOT / "public/books" / args.book
    story = json.loads((base / "story.json").read_text(encoding="utf-8"))
    n = story.get("narrator", {})
    name = args.provider or n.get("provider", "say")
    if name not in PROVIDERS:
        sys.exit(f"unknown narrator provider {name!r} (known: {', '.join(sorted(PROVIDERS))})")
    overrides = {"voice": args.voice, "rate": args.rate, "speed": args.speed}
    overrides.update(kv.split("=", 1) for kv in args.set)
    provider = PROVIDERS[name](provider_config(n, name, overrides))
    pages = [tokens(p["text"]) for p in story["pages"]] + [tokens(story["end"]["text"])]

    with tempfile.TemporaryDirectory() as tmp:
        clips = Clips(provider, tmp)
        if args.sample:
            toks = pages[args.sample - 1]
            clips.prefetch([sentence_text(toks, s) for s in sentences(toks)])
            samples, _ = build_page(clips, toks)
            SAMPLES.mkdir(parents=True, exist_ok=True)
            out = SAMPLES / f"{provider.name}-{getattr(provider, 'voice', '')}-page-{args.sample}.mp3"
            write_mp3(samples, out, tmp)
            print(out)
            return
        clips.prefetch([sentence_text(t, s) for t in pages for s in sentences(t)] + [story["title"]])
        out_dir = base / "voice"
        out_dir.mkdir(exist_ok=True)
        all_timings = {}
        for i, toks in enumerate(pages, 1):
            samples, timings = build_page(clips, toks)
            write_mp3(samples, out_dir / f"page-{i}.mp3", tmp)
            all_timings[f"page-{i}"] = timings
            seconds = len(samples) / RATE
            print(f"page-{i}: {len(toks)} tokens, {seconds:.1f}s")
            # a model voice sometimes rambles or stalls; normal reading is about 0.3-0.6 s a character
            per_char = seconds / max(1.0, sum(weight(t) for t in toks))
            if per_char > 0.8:
                print(f"  warning: page-{i} runs {per_char:.2f}s a character; listen to it (the instruct may slow the voice too much)")
        title, _ = build_page(clips, [story["title"]])
        write_mp3(title, out_dir / "title.mp3", tmp)
    (out_dir / "timings.json").write_text(json.dumps(all_timings, ensure_ascii=False), encoding="utf-8")
    print(f"wrote {out_dir}")


if __name__ == "__main__":
    main()
