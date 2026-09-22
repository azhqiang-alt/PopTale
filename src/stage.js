import * as THREE from "three";
import { easeInOut, lerp, tween } from "./anim.js";
import { wallTexture, woodTexture } from "./textures.js";
import { SHELF_Y, SHELF_Z } from "./shelf.js";

/* Renderer, room, lights and the camera. The camera frames a named view so that its subject
   fills the part of the screen the HTML panels leave free (see `free` in frame()). */

const FOV = 38;

/** What each view looks at: a centre, the half-size to keep in shot, and the direction of the camera from it. */
const VIEWS = {
  shelf: { center: [0, SHELF_Y + 0.3, SHELF_Z], half: [1.55, 0.55], dir: [0, 0.12, 1] },
  closed: { center: [0.52, 0.05, 0.05], half: [0.75, 0.85], dir: [0, 1.1, 0.95] },
  // the right page with its pop-up fills the free rect; the left page runs under the text panel
  open: { center: [0.5, 0.3, -0.1], half: [0.54, 0.66], dir: [0, 0.8, 1] },
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

    this.buildRoom();
    this.buildLights();
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
    this.scene.add(table, edge, wall);
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
    this.free = free;
    const to = this.pose(name);
    if (!duration) { this.apply(to.position, to.target, to.shift); return Promise.resolve(); }
    const from = { position: this.camera.position.clone(), target: this.target.clone(), shift: { ...this.shift } };
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
    this.camera.position.copy(position);
    this.target.copy(target);
    this.camera.lookAt(target);
    this.shift = shift;
    // shift the picture so the subject sits in the middle of the free rect
    this.camera.setViewOffset(this.width, this.height, -shift.x, -shift.y, this.width, this.height);
  }

  resize() {
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.renderer.setSize(this.width, this.height, false);
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
    this.renderer.render(this.scene, this.camera);
  }
}
