import * as THREE from "three";
import { clamp, easeInOut, easeOutBack, tween } from "./anim.js";
import { opaqueAt } from "./textures.js";

/* The pop-up spread on the right-hand page. story.json describes it as data:
     "scene": { "back": "<art id>", "layers": [{ name, art, label, x, y, z, width, float, flat, tap, sound, glow }] }
   Each piece is a paper card that folds up from the page (or rises, if it floats) and plays
   named actions: when tapped, and when the narrator reads a word linked to it.
   Page space: x -0.5..0.5 (spine at -0.5), z -0.7 (top edge) .. 0.7, y up. */

const BACK_WIDTH = 1.0;
const BACK_Z = -0.6;
const POP_TIME = 0.55;

/** Named motions. Each adds to an offset record for p going 0..1 over `dur` seconds. */
export const ACTIONS = {
  bounce: { dur: 0.5, fn: (p, o) => { const k = Math.sin(p * Math.PI * 3) * (1 - p) * 0.12; o.sx += k; o.sy -= k; } },
  hop: { dur: 0.6, fn: (p, o) => { o.y += Math.sin(p * Math.PI) * 0.08; o.sy += Math.sin(p * Math.PI * 2) * 0.06; } },
  jump: { dur: 0.9, fn: (p, o) => { o.y += Math.sin(p * Math.PI) * 0.2; o.rz += Math.sin(p * Math.PI * 2) * 0.12; } },
  wiggle: { dur: 0.7, fn: (p, o) => { o.rz += Math.sin(p * Math.PI * 6) * (1 - p) * 0.18; } },
  glow: { dur: 1.4, fn: (p, o) => { const k = Math.sin(p * Math.PI); o.glow += k * 1.1; o.sx += k * 0.06; o.sy += k * 0.06; } },
  twinkle: { dur: 1.2, fn: (p, o) => { const k = Math.abs(Math.sin(p * Math.PI * 3)) * (1 - p * 0.5); o.glow += k; o.sx += k * 0.15; o.sy += k * 0.15; o.rz += Math.sin(p * Math.PI * 2) * 0.15; } },
  fall: { dur: 1.3, fn: (p, o) => { o.y += (1 - bounceOut(p)) * 0.45; o.x += (1 - p) * 0.15; o.rz += (1 - easeInOut(p)) * Math.PI * 2; } },
  rise: { dur: 1.8, fn: (p, o) => { const k = Math.sin(p * Math.PI); o.y += k * 0.45; o.rz += easeInOut(p) * Math.PI * 2; o.glow += k; } },
  spin: { dur: 0.9, fn: (p, o) => { o.ry += easeInOut(p) * Math.PI * 2; } },
  blink: { dur: 0.3, fn: (p, o) => { o.sy -= Math.sin(p * Math.PI) * 0.22; } },
  hoot: { dur: 0.8, fn: (p, o) => { o.rz += Math.sin(p * Math.PI * 4) * (1 - p) * 0.12; o.sy += Math.sin(p * Math.PI * 2) * 0.05; } },
  look: { dur: 1.2, fn: (p, o) => { o.ry += Math.sin(p * Math.PI) * 0.6; } },
  yawn: { dur: 1.6, fn: (p, o) => { const k = Math.sin(p * Math.PI); o.sy += k * 0.08; o.sx -= k * 0.04; o.rz += k * 0.05; } },
  sleep: { dur: 3, fn: (p, o) => { const k = Math.sin(p * Math.PI); o.rz += k * 0.2; o.sy -= k * 0.05; } },
};

function bounceOut(t) {
  const n = 7.5625, d = 2.75;
  if (t < 1 / d) return n * t * t;
  if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75;
  if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375;
  return n * (t -= 2.625 / d) * t + 0.984375;
}

class Card {
  constructor(texture, { width, flat = false, glow = false, float = false }) {
    this.group = new THREE.Group(); // placed on the page, folds or rises when popping
    this.inner = new THREE.Group(); // carries the motions
    this.group.add(this.inner);
    this.width = width;
    this.height = width * (texture.userData.aspect || 1);
    const geometry = new THREE.PlaneGeometry(width, this.height);
    if (!flat) geometry.translate(0, this.height / 2, 0); // pivot on the bottom edge
    this.material = new THREE.MeshStandardMaterial({
      map: texture, emissiveMap: texture, emissive: 0xffffff, emissiveIntensity: glow ? 0.5 : 0,
      transparent: true, alphaTest: 0.03, side: THREE.DoubleSide, roughness: 0.9,
    });
    this.baseGlow = glow ? 0.5 : 0;
    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.customDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: texture, alphaTest: 0.5 });
    if (flat) { this.mesh.rotation.x = -Math.PI / 2; this.mesh.position.y = 0.003; }
    this.inner.add(this.mesh);
    this.flat = flat;
    this.float = float;
    this.motions = [];
    this.hover = 0;
    this.hoverTarget = 0;
    this.seed = Math.random() * 10;
  }

  play(name) {
    const action = ACTIONS[name] || ACTIONS.bounce;
    this.motions.push({ t: 0, ...action });
  }

  center() {
    return this.inner.localToWorld(new THREE.Vector3(0, this.flat ? 0.02 : this.height * 0.55, 0));
  }

  update(dt, t) {
    const o = { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, sx: 0, sy: 0, glow: 0 };
    if (this.float) { o.y += Math.sin(t * 1.2 + this.seed) * 0.015; o.rz += Math.sin(t * 0.8 + this.seed) * 0.04; }
    else if (!this.flat) o.sy += Math.sin(t * 2 + this.seed) * 0.006;
    this.motions = this.motions.filter((m) => {
      m.t += dt;
      const p = Math.min(1, m.t / m.dur);
      m.fn(p, o);
      return p < 1;
    });
    this.hover += (this.hoverTarget - this.hover) * Math.min(1, dt * 10);
    o.z += this.hover * 0.03;
    o.glow += this.hover * 0.25;
    this.inner.position.set(o.x, o.y, o.z);
    this.inner.rotation.set(o.rx, o.ry, o.rz);
    this.inner.scale.set(1 + o.sx, 1 + o.sy, 1);
    this.material.emissiveIntensity = this.baseGlow + o.glow * 0.6;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.mesh.customDepthMaterial.dispose();
  }
}

export class Diorama {
  constructor({ spec, art, sound, sparkles }) {
    this.group = new THREE.Group();
    this.sound = sound;
    this.sparkles = sparkles;
    this.objects = {};
    this.items = [];
    const back = art[spec.back];
    if (back) {
      const card = new Card(back, { width: BACK_WIDTH });
      card.group.position.set(0, 0, BACK_Z);
      this.addItem(card, { name: "sky", label: "天空", tap: "glow" }, "hinge", 0);
    }
    (spec.layers || []).forEach((layer, i) => {
      const texture = art[layer.art];
      if (!texture) { console.warn(`missing art ${layer.art}`); return; }
      const float = !!layer.float || (layer.y || 0) > 0.001;
      const card = new Card(texture, { width: layer.width || 0.3, flat: !!layer.flat, glow: !!layer.glow, float });
      card.group.position.set(layer.x || 0, layer.y || 0, layer.z || 0);
      this.addItem(card, layer, layer.flat || float ? "rise" : "hinge", 0.18 + i * 0.12);
    });
    this.total = POP_TIME + Math.max(0, ...this.items.map((it) => it.delay));
    this.setProgress(0);
  }

  addItem(card, meta, pop, delay) {
    const item = { card, pop, delay, name: meta.name, label: meta.label || meta.name, tap: meta.tap || "bounce", sound: meta.sound || null };
    this.items.push(item);
    // several layers may share a name (none do today); the first one answers to it
    if (meta.name && !this.objects[meta.name]) this.objects[meta.name] = item;
    card.mesh.userData.item = item;
    this.group.add(card.group);
  }

  /** 0 = folded flat into the page, 1 = standing. */
  setProgress(p) {
    for (const it of this.items) {
      const local = clamp((p * this.total - it.delay) / POP_TIME);
      const e = easeOutBack(local);
      if (it.pop === "hinge") {
        it.card.group.rotation.x = -(1 - e) * (Math.PI / 2 - 0.02);
        it.card.group.scale.setScalar(1);
      } else {
        it.card.group.scale.setScalar(Math.max(0.001, e));
      }
      it.card.group.visible = local > 0.001;
    }
  }

  popIn() {
    return tween(this.total * 1.25, (p) => this.setProgress(p));
  }

  popOut() {
    return tween(0.35, (p) => this.setProgress(1 - easeInOut(p)));
  }

  /** Play an action on a named object, with its sound and, for the bright ones, sparkles. */
  act(name, action, { silent = false } = {}) {
    const item = this.objects[name];
    if (!item) return false;
    const a = action || item.tap;
    item.card.play(a);
    if (!silent) this.sound.forAction(item.sound && !action ? item.sound : a);
    if (["glow", "twinkle", "rise", "fall"].includes(a)) this.sparkles.burst(item.card.center(), { count: 12 });
    return true;
  }

  tap(item) {
    this.act(item.name, null);
  }

  setHover(item) {
    for (const it of this.items) it.card.hoverTarget = it === item && it.name !== "sky" ? 1 : 0;
  }

  /** The object under the ray, skipping transparent parts of the artwork. */
  pick(raycaster) {
    const hits = raycaster.intersectObjects(this.items.map((it) => it.card.mesh), false);
    for (const hit of hits) {
      if (hit.uv && !opaqueAt(hit.object.material.map, hit.uv)) continue;
      return hit.object.userData.item;
    }
    return null;
  }

  update(dt, t) {
    for (const it of this.items) it.card.update(dt, t);
  }

  dispose() {
    for (const it of this.items) it.card.dispose();
    this.group.removeFromParent();
  }
}
