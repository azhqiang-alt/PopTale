import { spokenWeight } from "./tokens.js";

/* Narration: plays each page's recorded voice through Web Audio and reports the word being
   spoken, using the audio clock so the highlight never drifts from the voice.

   Per book:  voice/page-N.mp3 (N is 1-based, the last one is the end card)
              voice/timings.json  { "page-N": [{start, end}, ...] } one entry per token
   When a page has no recording, the browser's own zh-CN voice reads it and the highlight
   follows an estimate of its pace. */

export class Narrator {
  constructor(context) {
    this.ctx = context;
    this.gain = context.createGain();
    this.gain.connect(context.destination);
    this.cache = new Map();
    this.current = null;
    this.paused = false;
    this.wordIndex = -1;
    this.callbacks = {};
  }

  /** Switch to a book; `pages` is the token list of every page, end card last. */
  setBook(base, pages) {
    this.stop();
    this.base = base;
    this.pages = pages;
    this.cache.clear();
    this.timings = fetch(`${base}/voice/timings.json`).then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
  }

  /** Fetch, decode and time one page. Cached; call ahead to have the next page ready. */
  prepare(page) {
    if (this.cache.has(page)) return this.cache.get(page);
    const tokens = this.pages[page] || [];
    const task = (async () => {
      try {
        const res = await fetch(`${this.base}/voice/page-${page + 1}.mp3`);
        if (!res.ok) throw new Error(`voice ${res.status}`);
        const buffer = await this.ctx.decodeAudioData(await res.arrayBuffer());
        const all = await this.timings;
        const listed = all[`page-${page + 1}`];
        const timings = listed && listed.length === tokens.length ? listed : estimate(tokens, 0.25, buffer.duration - 0.5);
        return { buffer, timings, tokens, duration: buffer.duration };
      } catch (error) {
        console.warn(`page ${page + 1}: no recording, using the browser voice`, error);
        return { buffer: null, timings: estimate(tokens, 0, tokens.reduce((s, t) => s + spokenWeight(t.text), 0) * 0.3), tokens, duration: 0 };
      }
    })();
    this.cache.set(page, task);
    return task;
  }

  async play(page, callbacks = {}) {
    this.stop();
    this.callbacks = callbacks;
    const prepared = await this.prepare(page);
    if (this.callbacks !== callbacks) return; // another play or a stop came first
    this.current = { page, ...prepared, offset: 0 };
    if (prepared.buffer) this.startSource(0);
    else this.startBrowser();
  }

  startSource(offset) {
    const cur = this.current;
    if (this.ctx.state === "suspended") this.ctx.resume();
    const source = this.ctx.createBufferSource();
    source.buffer = cur.buffer;
    source.connect(this.gain);
    source.onended = () => {
      if (this.current === cur && cur.source === source && !this.paused) this.finish(true);
    };
    cur.source = source;
    cur.offset = offset;
    cur.startedAt = this.ctx.currentTime;
    source.start(0, offset);
    this.paused = false;
  }

  startBrowser() {
    const cur = this.current;
    cur.startedAt = performance.now() / 1000;
    if (!("speechSynthesis" in window)) { this.finish(false); return; }
    const u = new SpeechSynthesisUtterance(cur.tokens.map((t) => t.text).join(""));
    u.lang = "zh-CN";
    u.rate = 0.85;
    const voice = speechSynthesis.getVoices().find((v) => v.lang === "zh-CN");
    if (voice) u.voice = voice;
    u.onend = () => { if (this.current === cur) this.finish(true); };
    u.onerror = () => { if (this.current === cur) this.finish(false); };
    cur.utterance = u;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  }

  finish(complete) {
    const cb = this.callbacks;
    this.current = null;
    this.wordIndex = -1;
    if (cb.onEnd) cb.onEnd(complete);
  }

  position() {
    const cur = this.current;
    if (!cur) return 0;
    if (this.paused) return cur.offset;
    if (cur.utterance) return cur.offset + performance.now() / 1000 - cur.startedAt;
    return cur.offset + this.ctx.currentTime - cur.startedAt;
  }

  /** Call every frame: fires onWord when the spoken word changes. */
  update() {
    const cur = this.current;
    if (!cur || this.paused) return;
    const t = this.position();
    let i = this.wordIndex;
    while (i + 1 < cur.timings.length && cur.timings[i + 1].start <= t + 0.03) i++;
    if (i !== this.wordIndex) {
      this.wordIndex = i;
      if (this.callbacks.onWord) this.callbacks.onWord(i);
    }
  }

  pause() {
    const cur = this.current;
    if (!cur || this.paused) return;
    cur.offset = this.position();
    this.paused = true;
    if (cur.utterance) speechSynthesis.pause();
    else try { cur.source.stop(); } catch { /* already stopped */ }
  }

  resume() {
    const cur = this.current;
    if (!cur || !this.paused) return;
    if (cur.utterance) {
      cur.startedAt = performance.now() / 1000;
      this.paused = false;
      speechSynthesis.resume();
    } else this.startSource(cur.offset);
  }

  stop() {
    const cur = this.current;
    this.current = null;
    this.callbacks = {};
    this.paused = false;
    this.wordIndex = -1;
    if (!cur) return;
    if (cur.utterance) speechSynthesis.cancel();
    else try { cur.source.stop(); } catch { /* already stopped */ }
  }

  get playing() {
    return !!this.current && !this.paused;
  }

  /** Say one word on its own: its slice of the page recording, with short fades against clicks. */
  async speakWord(page, index) {
    const prepared = await this.prepare(page);
    const t = prepared.timings[index];
    if (!prepared.buffer || !t || t.end <= t.start) {
      speakText(prepared.tokens[index]?.word);
      return;
    }
    const start = Math.max(0, t.start - 0.04);
    const length = Math.min(prepared.duration - start, t.end - start + 0.08);
    if (this.ctx.state === "suspended") this.ctx.resume();
    const source = this.ctx.createBufferSource();
    const g = this.ctx.createGain();
    source.buffer = prepared.buffer;
    source.connect(g).connect(this.gain);
    const now = this.ctx.currentTime;
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(1, now + 0.012);
    g.gain.setValueAtTime(1, now + length - 0.03);
    g.gain.linearRampToValueAtTime(0, now + length);
    source.start(now, start, length);
  }

  /** Play a short clip (a book's spoken title); false when it is missing. */
  async playClip(url) {
    try {
      const res = await fetch(url);
      if (!res.ok) return false;
      const buffer = await this.ctx.decodeAudioData(await res.arrayBuffer());
      const source = this.ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(this.gain);
      source.start();
      return true;
    } catch {
      return false;
    }
  }

  setVolume(v) {
    this.gain.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }
}

/** Spread the tokens over [from, to] by spoken length, with a small pause after punctuation. */
function estimate(tokens, from, to) {
  const weights = tokens.map((t) => spokenWeight(t.text) + (/[，。！？：；]/.test(t.text) ? 1.2 : 0));
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  const span = Math.max(0.1, to - from);
  let t = from;
  return weights.map((w) => {
    const d = (w / total) * span;
    const out = { start: t, end: t + d };
    t += d;
    return out;
  });
}

function speakText(text) {
  if (!text || !("speechSynthesis" in window)) return;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "zh-CN";
  u.rate = 0.8;
  speechSynthesis.cancel();
  speechSynthesis.speak(u);
}
