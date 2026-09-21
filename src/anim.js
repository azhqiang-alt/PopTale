import * as THREE from "three";
import { sparkleTexture } from "./textures.js";

/* Frame-driven tweens (advanced by the render loop, so they pause with it) and sparkles. */

export const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const easeOut = (t) => 1 - Math.pow(1 - t, 3);
export const easeOutBack = (t) => { const c = 1.7; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };

const tweens = new Set();

/** Run fn(p) for p from 0 to 1 over `duration` seconds; resolves when done. */
export function tween(duration, fn) {
  return new Promise((resolve) => {
    tweens.add({ t: 0, duration, fn, resolve });
    fn(0);
  });
}

export function updateTweens(dt) {
  for (const tw of tweens) {
    tw.t += dt;
    const p = Math.min(1, tw.t / tw.duration);
    tw.fn(p);
    if (p >= 1) { tweens.delete(tw); tw.resolve(); }
  }
}

export class Sparkles {
  constructor(scene) {
    this.scene = scene;
    this.texture = sparkleTexture();
    this.items = [];
  }

  burst(position, { count = 10, spread = 0.12, size = 0.05, color = 0xffe7a0 } = {}) {
    for (let i = 0; i < count; i++) {
      const material = new THREE.SpriteMaterial({ map: this.texture, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
      const sprite = new THREE.Sprite(material);
      sprite.position.copy(position);
      const s = size * (0.6 + Math.random() * 0.8);
      sprite.scale.setScalar(s);
      const dir = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.8 + 0.2, Math.random() - 0.5).normalize();
      this.items.push({ sprite, vel: dir.multiplyScalar(spread * (1 + Math.random() * 2)), life: 0, max: 0.7 + Math.random() * 0.6, s });
      this.scene.add(sprite);
    }
  }

  update(dt) {
    this.items = this.items.filter((p) => {
      p.life += dt;
      const k = p.life / p.max;
      if (k >= 1) { this.scene.remove(p.sprite); p.sprite.material.dispose(); return false; }
      p.sprite.position.addScaledVector(p.vel, dt);
      p.vel.multiplyScalar(0.96);
      p.vel.y -= dt * 0.05;
      p.sprite.material.opacity = 1 - k * k;
      p.sprite.scale.setScalar(p.s * (1 + Math.sin(k * Math.PI) * 0.4));
      p.sprite.material.rotation += dt * 2;
      return true;
    });
  }
}
