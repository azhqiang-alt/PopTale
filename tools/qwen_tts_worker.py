"""Batch speech synthesis with Qwen3-TTS through mlx-audio (Apple Silicon).

Runs inside the mlx-audio environment, not the project's: build_voice.py starts it with
the interpreter in MLX_AUDIO_PYTHON (default ~/.venvs/mlx-audio/bin/python) and a job file:

    { "model": "...", "voice": "vivian", "instruct": "...", "lang": "zh", "speed": 1.0,
      "items": [ { "text": "...", "out": "/path/clip.wav" }, ... ] }

The model is loaded once for the whole batch. Each clip is seeded from its text, so the
same sentence comes out the same on every run.
"""
import hashlib
import json
import sys
import wave

import mlx.core as mx
import numpy as np
from mlx_audio.tts.utils import load_model


def write_wav(path, audio, rate):
    pcm = (np.clip(audio, -1, 1) * 32767).astype(np.int16)
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(pcm.tobytes())


def main():
    job = json.load(open(sys.argv[1], encoding="utf-8"))
    model = load_model(job["model"])
    for i, item in enumerate(job["items"], 1):
        mx.random.seed(int(hashlib.sha1(item["text"].encode()).hexdigest()[:8], 16))
        chunks, rate = [], 24000
        for result in model.generate(text=item["text"], voice=job["voice"], instruct=job.get("instruct"),
                                     lang_code=job.get("lang", "zh"), speed=job.get("speed", 1.0),
                                     temperature=job.get("temperature", 0.7)):
            chunks.append(np.array(result.audio, dtype=np.float32))
            rate = result.sample_rate
        write_wav(item["out"], np.concatenate(chunks) if chunks else np.zeros(1, np.float32), rate)
        print(f"[{i}/{len(job['items'])}] {item['text']}", flush=True)


if __name__ == "__main__":
    main()
