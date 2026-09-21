"""Builds a book's narration: one mp3 per page plus voice/timings.json (start/end per token).

Each page is split into phrases at punctuation. Every phrase is synthesized on its own, its
leading and trailing silence trimmed, and the phrases are joined with fixed pauses. The phrase
boundaries are therefore exact; inside a phrase the time is shared out by character count
(Chinese is syllable-timed, one character per syllable), which lands the highlight on the
right word without a speech recognizer.

    python3 tools/build_voice.py lele-star                  # macOS `say` voice from story.json
    python3 tools/build_voice.py lele-star --provider openai  # needs OPENAI_API_KEY

Needs ffmpeg. Output: public/books/<id>/voice/page-N.mp3, title.mp3, timings.json.
Page N is 1-based; the last page is the end card.
"""
import argparse
import array
import hashlib
import json
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
RATE = 44100
LINK = re.compile(r"^([^{]*)\{([^}:]+)(?::([^}]+))?\}(.*)$")
PUNCT = re.compile(r"[，。！？：；、,.!?:;“”\"'‘’（）()…—\s]")
STOP = re.compile(r"[。！？!?.]")
PHRASE_END = re.compile(r"[，。！？：；、,.!?:;]")
LEAD, TAIL = 0.25, 0.6
PAUSE = {"short": 0.28, "stop": 0.55}


def tokens(text):
    """Same split as src/tokens.js: whitespace-separated, {word:target/action} braces removed."""
    out = []
    for raw in text.split():
        m = LINK.match(raw)
        out.append(m.group(1) + m.group(2) + m.group(4) if m else raw)
    return out


def weight(token):
    return max(0.0, float(len(PUNCT.sub("", token))))


def phrases(toks):
    """Group token indices into phrases that end at punctuation."""
    groups, cur = [], []
    for i, t in enumerate(toks):
        cur.append(i)
        if PHRASE_END.search(t.rstrip("”\"’'")[-1:] or "") or i == len(toks) - 1:
            groups.append(cur)
            cur = []
    return [g for g in groups if sum(weight(toks[i]) for i in g) > 0] or [list(range(len(toks)))]


def run(cmd):
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)


def to_pcm(src, trim=True):
    """Decode any audio file to mono float samples at RATE, optionally trimming silence at both ends."""
    flt = "silenceremove=start_periods=1:start_threshold=-48dB,areverse,silenceremove=start_periods=1:start_threshold=-48dB,areverse" if trim else "anull"
    raw = subprocess.run(["ffmpeg", "-loglevel", "error", "-i", str(src), "-af", flt, "-ac", "1", "-ar", str(RATE), "-f", "f32le", "-"],
                         check=True, capture_output=True).stdout
    samples = array.array("f")
    samples.frombytes(raw)
    return samples


class Say:
    def __init__(self, voice, rate):
        self.voice, self.rate = voice, rate

    def key(self):
        return f"say:{self.voice}:{self.rate}"

    def synth(self, text, out):
        run(["say", "-v", self.voice, "-r", str(self.rate), "-o", str(Path(out).with_suffix(".aiff")), text])
        return Path(out).with_suffix(".aiff")


class OpenAI:
    def __init__(self, voice, instructions):
        self.voice, self.instructions = voice, instructions
        self.api_key = os.environ.get("OPENAI_API_KEY")
        if not self.api_key:
            sys.exit("OPENAI_API_KEY is not set")

    def key(self):
        return f"openai:{self.voice}:{self.instructions}"

    def synth(self, text, out):
        body = json.dumps({"model": "gpt-4o-mini-tts", "voice": self.voice, "input": text,
                           "instructions": self.instructions, "response_format": "wav"}).encode()
        req = urllib.request.Request("https://api.openai.com/v1/audio/speech", data=body,
                                     headers={"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=120) as res:
            Path(out).write_bytes(res.read())
        return Path(out)


def phrase_audio(provider, text, tmp):
    """Trimmed samples for one phrase, cached by provider settings and text."""
    CACHE.mkdir(parents=True, exist_ok=True)
    digest = hashlib.sha1(f"{provider.key()}|{text}".encode()).hexdigest()[:16]
    cached = CACHE / f"{digest}.f32"
    if cached.exists():
        samples = array.array("f")
        samples.frombytes(cached.read_bytes())
        return samples
    src = Path(tmp) / f"{digest}.wav"
    samples = to_pcm(provider.synth(text, src))
    cached.write_bytes(samples.tobytes())
    return samples


def build_page(provider, toks, tmp):
    """Returns (samples, timings) for one page."""
    audio = array.array("f", [0.0] * int(LEAD * RATE))
    timings = [None] * len(toks)
    groups = phrases(toks)
    for gi, group in enumerate(groups):
        text = "".join(toks[i] for i in group)
        spoken = PUNCT.sub("", text)
        clip = phrase_audio(provider, text, tmp) if spoken else array.array("f")
        start = len(audio) / RATE
        dur = len(clip) / RATE
        total = sum(weight(toks[i]) for i in group) or 1.0
        t = start
        for i in group:
            d = dur * weight(toks[i]) / total
            timings[i] = {"start": round(t, 3), "end": round(t + d, 3)}
            t += d
        audio.extend(clip)
        last = toks[group[-1]]
        if gi < len(groups) - 1:
            gap = PAUSE["stop"] if STOP.search(last) else PAUSE["short"]
            audio.extend([0.0] * int(gap * RATE))
    audio.extend([0.0] * int(TAIL * RATE))
    # tokens that belong to no spoken phrase (stray punctuation) sit at the end of the one before
    for i, tm in enumerate(timings):
        if tm is None:
            prev = timings[i - 1] if i else {"start": 0.0, "end": 0.0}
            timings[i] = {"start": prev["end"], "end": prev["end"]}
    return audio, timings


def write_mp3(samples, out, tmp):
    wav = Path(tmp) / "page.wav"
    with wave.open(str(wav), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        pcm = array.array("h", (max(-32767, min(32767, int(s * 32767))) for s in samples))
        w.writeframes(pcm.tobytes())
    run(["ffmpeg", "-loglevel", "error", "-y", "-i", str(wav), "-af", "loudnorm=I=-18:TP=-2", "-ar", str(RATE),
         "-ac", "1", "-codec:a", "libmp3lame", "-b:a", "96k", str(out)])


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("book")
    ap.add_argument("--provider", choices=["say", "openai"], default="say")
    ap.add_argument("--voice", help="override the voice in story.json")
    ap.add_argument("--rate", type=int, help="words per minute for `say` (story.json narrator.rate)")
    args = ap.parse_args()

    base = ROOT / "public/books" / args.book
    story = json.loads((base / "story.json").read_text(encoding="utf-8"))
    n = story.get("narrator", {})
    if args.provider == "say":
        provider = Say(args.voice or n.get("voice", "Tingting"), args.rate or n.get("rate", 150))
    else:
        provider = OpenAI(args.voice or n.get("openaiVoice", "nova"),
                          n.get("instructions", "用温柔、缓慢、充满好奇的语气，给小朋友讲睡前故事。"))

    texts = [p["text"] for p in story["pages"]] + [story["end"]["text"]]
    out_dir = base / "voice"
    out_dir.mkdir(exist_ok=True)
    all_timings = {}
    with tempfile.TemporaryDirectory() as tmp:
        for i, text in enumerate(texts, 1):
            toks = tokens(text)
            samples, timings = build_page(provider, toks, tmp)
            write_mp3(samples, out_dir / f"page-{i}.mp3", tmp)
            all_timings[f"page-{i}"] = timings
            print(f"page-{i}: {len(toks)} tokens, {len(samples) / RATE:.1f}s")
        title, _ = build_page(provider, [story["title"]], tmp)
        write_mp3(title, out_dir / "title.mp3", tmp)
    (out_dir / "timings.json").write_text(json.dumps(all_timings, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"wrote {out_dir}")


if __name__ == "__main__":
    main()
