/* Procedural sound: a music-box lullaby, a night ambience (crickets and a soft breeze) and
   small tactile effects, all synthesized with Web Audio. No sound files, nothing to license. */

const SCALE = [0, 2, 4, 7, 9]; // major pentatonic
const CHORDS = [[0, 4, 7], [9, 12, 16], [5, 9, 12], [7, 11, 14]]; // I vi IV V
const hz = (midi) => 440 * Math.pow(2, (midi - 69) / 12);

export class SoundKit {
  constructor(context) {
    this.ctx = context;
    this.master = context.createGain();
    this.master.connect(context.destination);
    this.music = context.createGain();
    this.music.gain.value = 0.32;
    this.sfx = context.createGain();
    this.sfx.gain.value = 0.7;
    this.ambience = context.createGain();
    this.ambience.gain.value = 0;
    this.reverb = context.createConvolver();
    this.reverb.buffer = this.impulse(2.4);
    const wet = context.createGain();
    wet.gain.value = 0.3;
    for (const bus of [this.music, this.sfx]) { bus.connect(this.master); bus.connect(wet); }
    this.ambience.connect(this.master);
    wet.connect(this.reverb).connect(this.master);
    this.noise = this.noiseBuffer();
    this.musicTimer = null;
    this.ambienceTimer = null;
  }

  impulse(seconds) {
    const rate = this.ctx.sampleRate, len = Math.floor(rate * seconds);
    const buf = this.ctx.createBuffer(2, len, rate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    }
    return buf;
  }

  noiseBuffer() {
    const buf = this.ctx.createBuffer(1, this.ctx.sampleRate * 2, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  setMuted(muted) {
    this.master.gain.setTargetAtTime(muted ? 0 : 1, this.ctx.currentTime, 0.08);
  }

  /** Lower the music while the narrator speaks. */
  duck(on) {
    this.music.gain.setTargetAtTime(on ? 0.12 : 0.32, this.ctx.currentTime, 0.4);
  }

  /* ---------- music box ---------- */

  tone(freq, when, { dur = 1.6, vol = 0.18, type = "sine", out = this.music } = {}) {
    const o = this.ctx.createOscillator(), o2 = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    o2.type = "sine";
    o2.frequency.value = freq * 4.02; // the bright tine partial of a music box
    const g2 = this.ctx.createGain();
    g2.gain.value = 0.12;
    o.connect(g);
    o2.connect(g2).connect(g);
    g.connect(out);
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(vol, when + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    o.start(when); o2.start(when);
    o.stop(when + dur + 0.05); o2.stop(when + dur + 0.05);
  }

  startMusic() {
    if (this.musicTimer) return;
    const beat = 0.42;
    let step = 0, next = this.ctx.currentTime + 0.2;
    const schedule = () => {
      while (next < this.ctx.currentTime + 1.0) {
        const chord = CHORDS[Math.floor(step / 8) % CHORDS.length];
        const base = 72;
        const i = step % 8;
        if (i === 0) this.tone(hz(48 + chord[0]), next, { dur: 3.2, vol: 0.09 });
        const pattern = [0, 1, 2, 1, 0, 2, 1, 2];
        const note = base + chord[pattern[i]];
        if (i !== 7 || Math.random() < 0.5) this.tone(hz(note), next, { dur: 1.8, vol: i === 0 ? 0.14 : 0.1 });
        if (i === 4 && Math.random() < 0.6) this.tone(hz(base + 12 + SCALE[Math.floor(Math.random() * 5)]), next + beat / 2, { dur: 1.4, vol: 0.06 });
        next += beat;
        step++;
      }
    };
    schedule();
    this.musicTimer = setInterval(schedule, 250);
  }

  stopMusic() {
    clearInterval(this.musicTimer);
    this.musicTimer = null;
  }

  /* ---------- night ambience ---------- */

  startAmbience(volume = 0.35) {
    if (this.ambienceTimer) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const lp = this.ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 420;
    const breeze = this.ctx.createGain();
    breeze.gain.value = 0.05;
    src.connect(lp).connect(breeze).connect(this.ambience);
    src.start();
    this.breeze = src;
    this.ambience.gain.setTargetAtTime(volume, this.ctx.currentTime, 1.2);
    const chirp = () => {
      const t = this.ctx.currentTime + Math.random() * 0.3;
      const f = 4200 + Math.random() * 600;
      for (let k = 0; k < 3; k++) this.tone(f, t + k * 0.07, { dur: 0.05, vol: 0.012, out: this.ambience });
    };
    this.ambienceTimer = setInterval(() => { if (Math.random() < 0.55) chirp(); }, 900);
  }

  stopAmbience() {
    clearInterval(this.ambienceTimer);
    this.ambienceTimer = null;
    this.ambience.gain.setTargetAtTime(0, this.ctx.currentTime, 0.4);
    const src = this.breeze;
    this.breeze = null;
    if (src) setTimeout(() => { try { src.stop(); } catch { /* already stopped */ } }, 1500);
  }

  /* ---------- effects ---------- */

  noiseBurst({ dur = 0.3, from = 800, to = 2400, q = 1, vol = 0.3, type = "bandpass" } = {}) {
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(from, t);
    f.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + dur * 0.25);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.sfx);
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
  }

  sweep(from, to, dur, { type = "sine", vol = 0.25 } = {}) {
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(from, t);
    o.frequency.exponentialRampToValueAtTime(to, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.sfx);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  pageTurn() { this.noiseBurst({ dur: 0.45, from: 600, to: 3200, q: 0.7, vol: 0.22 }); }
  whoosh(up = true) { this.noiseBurst({ dur: 0.6, from: up ? 300 : 2400, to: up ? 2400 : 300, q: 1.4, vol: 0.18 }); }
  click() { this.sweep(1800, 900, 0.05, { type: "triangle", vol: 0.12 }); }
  pop(pitch = 1) { this.sweep(500 * pitch, 1100 * pitch, 0.09, { vol: 0.22 }); }
  boing() { this.sweep(260, 520, 0.28, { type: "triangle", vol: 0.2 }); }
  chime(n = 0, vol = 0.18) { this.tone(hz(79 + SCALE[n % 5]), this.ctx.currentTime, { dur: 1.2, vol, out: this.sfx }); }

  sparkle() {
    const t = this.ctx.currentTime;
    for (let k = 0; k < 5; k++) this.tone(hz(84 + SCALE[(k * 2) % 5] + (k > 2 ? 12 : 0)), t + k * 0.06, { dur: 0.9, vol: 0.07, out: this.sfx });
  }

  hoot() {
    const t = this.ctx.currentTime;
    for (const [at, f] of [[0, 392], [0.34, 370]]) {
      const o = this.ctx.createOscillator(), g = this.ctx.createGain(), lfo = this.ctx.createOscillator(), lg = this.ctx.createGain();
      o.frequency.value = f;
      lfo.frequency.value = 6;
      lg.gain.value = 6;
      lfo.connect(lg).connect(o.frequency);
      g.gain.setValueAtTime(0.0001, t + at);
      g.gain.exponentialRampToValueAtTime(0.22, t + at + 0.06);
      g.gain.exponentialRampToValueAtTime(0.0001, t + at + 0.3);
      o.connect(g).connect(this.sfx);
      o.start(t + at); lfo.start(t + at);
      o.stop(t + at + 0.35); lfo.stop(t + at + 0.35);
    }
  }

  ribbit() {
    const t = this.ctx.currentTime;
    for (const at of [0, 0.16]) {
      const o = this.ctx.createOscillator(), g = this.ctx.createGain(), f = this.ctx.createBiquadFilter();
      o.type = "square";
      o.frequency.setValueAtTime(140, t + at);
      o.frequency.linearRampToValueAtTime(90, t + at + 0.12);
      f.type = "lowpass";
      f.frequency.value = 900;
      g.gain.setValueAtTime(0.0001, t + at);
      g.gain.exponentialRampToValueAtTime(0.16, t + at + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + at + 0.13);
      o.connect(f).connect(g).connect(this.sfx);
      o.start(t + at);
      o.stop(t + at + 0.15);
    }
  }

  /** The sound that goes with a scene action (see ACTIONS in diorama.js). */
  forAction(action) {
    const map = {
      bounce: () => this.pop(1), hop: () => this.boing(), jump: () => this.boing(), wiggle: () => this.pop(1.3),
      glow: () => this.sparkle(), twinkle: () => this.sparkle(), fall: () => this.whoosh(false), rise: () => this.whoosh(true),
      hoot: () => this.hoot(), ribbit: () => this.ribbit(), blink: () => this.click(), spin: () => this.whoosh(true),
    };
    if (map[action]) map[action]();
  }
}
