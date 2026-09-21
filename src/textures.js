import * as THREE from "three";

/* Canvas-made textures: artwork (SVG/PNG) turned into paper cut-outs, and the procedural
   paper, wood, wall and page surfaces. */

const PAPER = "#fbf3e2";
const HEADING_FONT = '"Kaiti SC", "STKaiti", "KaiTi", "PingFang SC", serif';

export function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`image ${url}`));
    img.src = url;
  });
}

function canvas(w, h) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

function toTexture(c) {
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/** Artwork as a texture. `outline` (px) adds the white paper border of a cut-out figure.
    Keeps the alpha channel on tex.userData so taps on transparent corners fall through. */
export async function loadArt(url, { outline = 0, maxSize = 1024 } = {}) {
  const img = await loadImage(url);
  const iw = img.naturalWidth || 512, ih = img.naturalHeight || 512;
  const s = Math.min(1, maxSize / Math.max(iw, ih));
  const w = Math.round(iw * s), h = Math.round(ih * s);
  const pad = outline ? Math.ceil(outline) + 3 : 0;
  const c = canvas(w + pad * 2, h + pad * 2);
  const g = c.getContext("2d", { willReadFrequently: true });
  if (outline) {
    const border = canvas(c.width, c.height);
    const bg = border.getContext("2d");
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2;
      bg.drawImage(img, pad + Math.cos(a) * outline, pad + Math.sin(a) * outline, w, h);
    }
    bg.globalCompositeOperation = "source-in";
    bg.fillStyle = PAPER;
    bg.fillRect(0, 0, c.width, c.height);
    g.shadowColor = "rgba(40, 30, 60, 0.35)";
    g.shadowBlur = 4;
    g.drawImage(border, 0, 0);
    g.shadowColor = "transparent";
  }
  g.drawImage(img, pad, pad, w, h);
  const tex = toTexture(c);
  const data = g.getImageData(0, 0, c.width, c.height).data;
  const alpha = new Uint8Array(c.width * c.height);
  for (let i = 0; i < alpha.length; i++) alpha[i] = data[i * 4 + 3];
  tex.userData = { aspect: c.height / c.width, alpha, w: c.width, h: c.height };
  return tex;
}

/** Is the texture opaque at this uv? (used for picking) */
export function opaqueAt(tex, uv) {
  const d = tex.userData;
  if (!d || !d.alpha) return true;
  const x = Math.min(d.w - 1, Math.max(0, Math.floor(uv.x * d.w)));
  const y = Math.min(d.h - 1, Math.max(0, Math.floor((1 - uv.y) * d.h)));
  return d.alpha[y * d.w + x] > 40;
}

function grain(g, w, h, amount, seed = 1) {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const img = g.getImageData(0, 0, w, h);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (rnd() - 0.5) * amount;
    img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
}

function paperBase(w, h) {
  const c = canvas(w, h);
  const g = c.getContext("2d");
  g.fillStyle = PAPER;
  g.fillRect(0, 0, w, h);
  grain(g, w, h, 10, 7);
  return { c, g };
}

/** A page surface: `side` is "left" or "right" (the spine is on the inner edge). */
export function pageTexture({ side, number, heading, color = "#2b3a78" }) {
  const w = 720, h = 1008;
  const { c, g } = paperBase(w, h);
  // the gutter shadow along the spine
  const spineX = side === "left" ? w : 0;
  const grad = g.createLinearGradient(spineX, 0, side === "left" ? w - 90 : 90, 0);
  grad.addColorStop(0, "rgba(90, 70, 50, 0.28)");
  grad.addColorStop(1, "rgba(90, 70, 50, 0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, w, h);
  if (heading) {
    g.fillStyle = color;
    g.textAlign = "center";
    g.font = `700 64px ${HEADING_FONT}`;
    g.fillText(heading, w / 2, 170);
    g.strokeStyle = "rgba(43, 58, 120, 0.35)";
    g.lineWidth = 3;
    g.beginPath(); g.moveTo(w / 2 - 120, 215); g.lineTo(w / 2 + 120, 215); g.stroke();
    g.fillStyle = "#e3b04b";
    starShape(g, w / 2, 215, 12, 5);
  }
  if (number != null) {
    g.fillStyle = "rgba(60, 50, 80, 0.55)";
    g.font = `36px ${HEADING_FONT}`;
    g.textAlign = "center";
    g.fillText(String(number), side === "left" ? 70 : w - 70, h - 50);
  }
  return toTexture(c);
}

function starShape(g, cx, cy, R, r) {
  g.beginPath();
  for (let k = 0; k < 10; k++) {
    const a = -Math.PI / 2 + (k * Math.PI) / 5;
    const rad = k % 2 ? r : R;
    g.lineTo(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad);
  }
  g.closePath();
  g.fill();
}

export function solidTexture(color) {
  const { c, g } = paperBase(64, 64);
  g.fillStyle = color;
  g.fillRect(0, 0, 64, 64);
  grain(g, 64, 64, 12, 3);
  return toTexture(c);
}

/** The stacked page edges seen on the sides of the book block. */
export function edgesTexture() {
  const c = canvas(64, 256);
  const g = c.getContext("2d");
  g.fillStyle = "#efe4cc";
  g.fillRect(0, 0, 64, 256);
  for (let y = 0; y < 256; y += 4) {
    g.fillStyle = y % 8 ? "rgba(120, 100, 70, 0.12)" : "rgba(255, 255, 255, 0.5)";
    g.fillRect(0, y, 64, 1);
  }
  return toTexture(c);
}

export function woodTexture() {
  const w = 1024, h = 1024;
  const c = canvas(w, h);
  const g = c.getContext("2d");
  g.fillStyle = "#7a4e32";
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < 90; i++) {
    const y = Math.random() * h;
    g.strokeStyle = `rgba(${Math.random() < 0.5 ? "50, 28, 16" : "150, 100, 66"}, ${0.08 + Math.random() * 0.12})`;
    g.lineWidth = 1 + Math.random() * 5;
    g.beginPath();
    g.moveTo(0, y);
    for (let x = 0; x <= w; x += 64) g.lineTo(x, y + Math.sin(x / 140 + i) * 6);
    g.stroke();
  }
  for (let x = 0; x < w; x += 256) { g.fillStyle = "rgba(30, 16, 8, 0.35)"; g.fillRect(x, 0, 3, h); }
  grain(g, w, h, 14, 11);
  const tex = toTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 3);
  return tex;
}

export function wallTexture() {
  const w = 512, h = 512;
  const c = canvas(w, h);
  const g = c.getContext("2d");
  g.fillStyle = "#2e2a5c";
  g.fillRect(0, 0, w, h);
  g.fillStyle = "rgba(255, 230, 180, 0.06)";
  for (let y = 0; y < h; y += 64) for (let x = (y / 64) % 2 ? 32 : 0; x < w; x += 64) starShape(g, x + 16, y + 16, 7, 3);
  grain(g, w, h, 8, 5);
  const tex = toTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(6, 3);
  return tex;
}

/** Cover for a book that is not written yet: its colour, its title and a "coming soon" band. */
export function placeholderCover(title, color) {
  const w = 400, h = 560;
  const c = canvas(w, h);
  const g = c.getContext("2d");
  g.fillStyle = color;
  g.fillRect(0, 0, w, h);
  grain(g, w, h, 16, title.length);
  g.fillStyle = "rgba(255, 248, 234, 0.9)";
  g.fillRect(30, 90, w - 60, 150);
  g.fillStyle = color;
  g.textAlign = "center";
  g.font = `700 ${title.length > 6 ? 40 : 46}px ${HEADING_FONT}`;
  g.fillText(title, w / 2, 180);
  g.fillStyle = "rgba(255, 255, 255, 0.85)";
  g.font = `28px ${HEADING_FONT}`;
  g.fillText("敬请期待", w / 2, h - 70);
  return toTexture(c);
}

/** A soft round star for sparkles. */
export function sparkleTexture() {
  const c = canvas(64, 64);
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "rgba(255, 250, 220, 1)");
  grad.addColorStop(0.25, "rgba(255, 220, 120, 0.8)");
  grad.addColorStop(1, "rgba(255, 200, 80, 0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = "#fffbe8";
  starShape(g, 32, 32, 18, 5);
  return toTexture(c);
}
