import * as THREE from "three";
import { easeInOut, lerp, tween } from "./anim.js";
import { wallTexture, woodTexture } from "./textures.js";
import { SHELF_Y, SHELF_Z } from "./shelf.js";
import { buildProps } from "./props.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";

/* Renderer, room, lights and the camera. The camera frames a named view so that its subject
   fills the part of the screen the HTML panels leave free (see `free` in frame()). */

const FOV = 38;

/** What each view looks at: a centre, the half-size to keep in shot, and the direction of the camera from it. */
const VIEWS = {
  shelf: { center: [0, SHELF_Y + 0.3, SHELF_Z], half: [1.55, 0.55], dir: [0, 0.12, 1] },
  closed: { center: [0.52, 0.05, 0.05], half: [0.75, 0.85], dir: [0, 1.1, 0.95] },
  // the right page with its pop-up fills the free rect; the left page runs under the text panel
  open: { center: [0.47, 0.32, -0.2], half: [0.5, 0.58], dir: [0, 0.8, 1] },
  // phones: the same, with the text panel below the book
  openNarrow: { center: [0.46, 0.3, -0.1], half: [0.58, 0.72], dir: [0, 0.85, 1] },
};

export class Stage {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color("#1a1838");
    this.scene.fog = new THREE.Fog("#1a1838", 5, 11);
    this.camera = new THREE.PerspectiveCamera(FOV, 1, 0.05, 40);
    this.target = new THREE.Vector3();
    this.shift = { x: 0, y: 0 };
    // on top of the framed view: a close-up that comes and goes, and a little pointer parallax
    this.close = null; // { position, target, until }
    this.closeMix = 0;
    this.lean = new THREE.Vector2();
    this.pointer = new THREE.Vector2();

    this.buildRoom();
    this.buildLights();
    // bloom picks out only what is brighter than lit paper: bulbs, fireflies, glowing cut-outs, sparkles
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.55, 0.5, 1.0);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.time = 0;
    this.view = "shelf";
    this.free = null;
    this.resize();
  }

  buildRoom() {
    const table = new THREE.Mesh(new THREE.PlaneGeometry(9, 5), new THREE.MeshStandardMaterial({ map: woodTexture(), roughness: 0.7 }));
    table.rotation.x = -Math.PI / 2;
    table.position.set(0, 0, 0.3);
    table.receiveShadow = true;
    const edge = new THREE.Mesh(new THREE.BoxGeometry(9, 0.08, 0.08), new THREE.MeshStandardMaterial({ color: "#5c3a24", roughness: 0.7 }));
    edge.position.set(0, -0.04, 2.8);
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(14, 7), new THREE.MeshStandardMaterial({ map: wallTexture(), roughness: 1 }));
    wall.position.set(0, 2.5, SHELF_Z - 0.05);
    wall.receiveShadow = true;
    this.props = buildProps();
    this.scene.add(table, edge, wall, this.props);
  }

  buildLights() {
    this.scene.add(new THREE.HemisphereLight("#b9b4ff", "#4a3020", 0.9));
    const lamp = new THREE.DirectionalLight("#ffe2b0", 2.4);
    lamp.position.set(-2.2, 4.5, 2.6);
    lamp.target.position.set(0, 0.5, -0.6);
    lamp.castShadow = true;
    lamp.shadow.mapSize.set(2048, 2048);
    const s = lamp.shadow.camera;
    s.left = -3.2; s.right = 3.2; s.top = 3.2; s.bottom = -2.4; s.near = 1; s.far = 12;
    lamp.shadow.bias = -0.0004;
    lamp.shadow.normalBias = 0.01;
    lamp.shadow.radius = 4;
    this.scene.add(lamp, lamp.target);
    const fill = new THREE.PointLight("#ffbf70", 1.6, 5, 1.6);
    fill.position.set(1.6, 1.4, 1.2);
    this.scene.add(fill);
  }

  /** Replace what a view keeps in shot (the shelf's size depends on how its books are laid out). */
  setView(name, view) {
    VIEWS[name] = { ...VIEWS[name], ...view };
  }

  /** Where the camera sits for a view, fitted to the free part of the screen. */
  pose(name) {
    const v = VIEWS[name];
    const W = this.width, H = this.height;
    const f = this.free || { x: 0, y: 0, w: W, h: H };
    const tanV = Math.tan(THREE.MathUtils.degToRad(FOV / 2)) * (f.h / H);
    const aspect = f.w / f.h;
    const dist = Math.max(v.half[1] / tanV, v.half[0] / (tanV * aspect)) + 0.3;
    const center = new THREE.Vector3(...v.center);
    const position = center.clone().addScaledVector(new THREE.Vector3(...v.dir).normalize(), dist);
    return { position, target: center, shift: { x: f.x + f.w / 2 - W / 2, y: f.y + f.h / 2 - H / 2 } };
  }

  /** Move to a view (animated unless duration is 0). `free` is the screen rect left for the scene. */
  frame(name, { free = this.free, duration = 1.2 } = {}) {
    this.view = name;
    this.close = null;
    this.free = free;
    const to = this.pose(name);
    if (!duration) { this.apply(to.position, to.target, to.shift); return Promise.resolve(); }
    const from = { position: this.position.clone(), target: this.target.clone(), shift: { ...this.shift } };
    return tween(duration, (p) => {
      const e = easeInOut(p);
      this.apply(
        from.position.clone().lerp(to.position, e),
        from.target.clone().lerp(to.target, e),
        { x: lerp(from.shift.x, to.shift.x, e), y: lerp(from.shift.y, to.shift.y, e) },
      );
    });
  }

  apply(position, target, shift) {
    this.position = position.clone();
    this.target.copy(target);
    this.shift = shift;
    // shift the picture so the subject sits in the middle of the free rect
    this.camera.setViewOffset(this.width, this.height, -shift.x, -shift.y, this.width, this.height);
    this.place();
  }

  /** Drift in on a point for a while (a spoken or tapped object), then back to the framed view. */
  closeUp(point, { radius = 0.2, hold = 3, wide = 1 } = {}) {
    // come from the viewer's side of the point, about 30 degrees above it, so faces stay readable
    const flat = this.position.clone().sub(point).setY(0);
    if (flat.lengthSq() < 1e-6) flat.set(0, 0, 1);
    flat.normalize();
    const full = this.position.distanceTo(this.target);
    // a narrow free rect (phones) sees less across, so stand further back there
    const narrow = this.free && this.free.w < this.free.h ? 1.3 : 1;
    const dist = THREE.MathUtils.clamp(radius * 5 * wide * narrow, 1.0 * narrow, full * 0.85);
    const position = point.clone().addScaledVector(flat, dist * Math.cos(0.52)).add(new THREE.Vector3(0, dist * Math.sin(0.52), 0));
    this.close = { position, target: point.clone(), until: performance.now() + hold * 1000 };
  }

  clearCloseUp() {
    this.close = null;
  }

  /** Where the pointer is, in -1..1 (the camera leans a little towards it). */
  setPointer(x, y) {
    this.pointer.set(x, y);
  }

  update(dt) {
    this.time += dt;
    this.props.userData.update(this.time);
    if (this.close && performance.now() > this.close.until) this.close = null;
    // ease in slowly, like a cut in a film, and back out a little faster
    const goal = this.close ? 1 : 0;
    this.closeMix += (goal - this.closeMix) * (1 - Math.exp(-dt * (this.close ? 1.4 : 1.9)));
    this.lean.lerp(this.pointer, 1 - Math.exp(-dt * 2));
    if (this.close) this.lastClose = this.close;
    this.place();
  }

  place() {
    const e = easeInOut(Math.min(1, Math.max(0, this.closeMix)));
    const c = this.lastClose;
    const position = c && e > 1e-4 ? this.position.clone().lerp(c.position, e) : this.position.clone();
    const target = c && e > 1e-4 ? this.target.clone().lerp(c.target, e) : this.target.clone();
    if (this.view.startsWith("open")) position.add(new THREE.Vector3(this.lean.x * 0.07, this.lean.y * 0.035, 0));
    this.camera.position.copy(position);
    this.camera.lookAt(target);
  }

  resize() {
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.renderer.setSize(this.width, this.height, false);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(this.width, this.height);
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
    const to = this.pose(this.view);
    this.apply(to.position, to.target, to.shift);
  }

  raycaster(clientX, clientY) {
    const ndc = new THREE.Vector2((clientX / this.width) * 2 - 1, -(clientY / this.height) * 2 + 1);
    const r = new THREE.Raycaster();
    r.setFromCamera(ndc, this.camera);
    return r;
  }

  render() {
    this.composer.render();
  }
}
