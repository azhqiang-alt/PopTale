import * as THREE from "three";
import { easeInOut, lerp, tween } from "./anim.js";
import { edgesTexture } from "./textures.js";

/* The book on the table. Book space: the spine runs along z at x = 0; open, the left page is
   x -PAGE_W..0 and the right page 0..PAGE_W; the far (top) edge of the pages is at -z.
   Closed, the book lies on the right half with the cover facing up. */

export const PAGE_W = 1.0;
export const PAGE_H = 1.4;
const SHEET = 0.005;       // thickness of one leaf
const BOARD = 0.02;        // thickness of a cover board
const OVERHANG = 0.03;     // how far the boards reach past the pages
const SEGMENTS = 32;       // columns of the turning leaf
const CURL = 0.9;

const topPlane = () => {
  const g = new THREE.PlaneGeometry(PAGE_W, PAGE_H);
  g.rotateX(-Math.PI / 2);
  return g;
};

/** Size of the closed book, for the shelf copy that stands in for it. */
export function closedSize(sheets) {
  return { w: PAGE_W + OVERHANG, h: BOARD * 2 + sheets * SHEET, d: PAGE_H + OVERHANG * 2 };
}

export class Book3D {
  constructor({ coverTexture, sheets, clothColor = "#2b3a78", endpaper = "#f3c86b" }) {
    this.sheets = sheets;
    this.turned = 0;
    this.opened = false;
    this.group = new THREE.Group();
    const cloth = new THREE.MeshStandardMaterial({ color: clothColor, roughness: 0.75 });
    const inside = new THREE.MeshStandardMaterial({ color: endpaper, roughness: 0.9 });
    const edges = new THREE.MeshStandardMaterial({ map: edgesTexture(), roughness: 0.95 });
    const boardGeo = new THREE.BoxGeometry(PAGE_W + OVERHANG, BOARD, PAGE_H + OVERHANG * 2);
    boardGeo.translate((PAGE_W + OVERHANG) / 2, BOARD / 2, 0);

    // back board: stays on the right, under the pages
    this.backBoard = new THREE.Mesh(boardGeo, [cloth, cloth, inside, cloth, cloth, cloth]);
    this.backBoard.receiveShadow = this.backBoard.castShadow = true;
    this.group.add(this.backBoard);

    // front board: hinged at the spine, swings over to the left when the book opens
    this.frontPivot = new THREE.Group();
    this.frontBoard = new THREE.Mesh(boardGeo, [cloth, cloth, cloth, inside, cloth, cloth]);
    this.frontBoard.castShadow = this.frontBoard.receiveShadow = true;
    const coverGeo = new THREE.PlaneGeometry(PAGE_W + OVERHANG, PAGE_H + OVERHANG * 2);
    coverGeo.rotateX(-Math.PI / 2);
    this.cover = new THREE.Mesh(coverGeo, new THREE.MeshStandardMaterial({ map: coverTexture, roughness: 0.6 }));
    this.cover.position.set((PAGE_W + OVERHANG) / 2, BOARD + 0.0006, 0);
    this.frontPivot.add(this.frontBoard, this.cover);
    this.group.add(this.frontPivot);

    // the spine, seen while the book is closed
    this.spine = new THREE.Mesh(new THREE.BoxGeometry(BOARD, 1, PAGE_H + OVERHANG * 2), cloth);
    this.spine.castShadow = true;
    this.group.add(this.spine);

    // page blocks with their top pages
    const blockGeo = new THREE.BoxGeometry(PAGE_W, 1, PAGE_H);
    blockGeo.translate(0, 0.5, 0);
    const paper = new THREE.MeshStandardMaterial({ color: "#f5ecd8", roughness: 0.95 });
    this.rightBlock = new THREE.Mesh(blockGeo, [edges, paper, paper, paper, edges, edges]);
    this.leftBlock = new THREE.Mesh(blockGeo, [paper, edges, paper, paper, edges, edges]);
    this.rightBlock.position.x = PAGE_W / 2;
    this.leftBlock.position.x = -PAGE_W / 2;
    this.rightTop = new THREE.Mesh(topPlane(), new THREE.MeshStandardMaterial({ roughness: 0.95 }));
    this.leftTop = new THREE.Mesh(topPlane(), new THREE.MeshStandardMaterial({ roughness: 0.95 }));
    this.rightTop.position.x = PAGE_W / 2;
    this.leftTop.position.x = -PAGE_W / 2;
    for (const m of [this.rightBlock, this.leftBlock, this.rightTop, this.leftTop]) { m.receiveShadow = true; m.castShadow = m.geometry === blockGeo; }
    this.group.add(this.rightBlock, this.leftBlock, this.rightTop, this.leftTop);

    // where the pop-up scene stands: the middle of the right page
    this.rightAnchor = new THREE.Group();
    this.rightAnchor.position.x = PAGE_W / 2;
    this.group.add(this.rightAnchor);

    this.leaf = this.makeLeaf();
    this.group.add(this.leaf.front, this.leaf.back);
    this.setOpenProgress(0);
  }

  makeLeaf() {
    const cols = SEGMENTS + 1;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(cols * 2 * 3);
    const uvs = new Float32Array(cols * 2 * 2);
    const index = [];
    for (let i = 0; i < cols; i++) {
      uvs.set([i / SEGMENTS, 1], i * 2);                 // far edge
      uvs.set([i / SEGMENTS, 0], (i + cols) * 2);        // near edge
      if (i < SEGMENTS) { const a = i, b = i + 1, c = i + cols, d = i + 1 + cols; index.push(a, c, b, b, c, d); }
    }
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
    geometry.setIndex(index);
    const front = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ side: THREE.FrontSide, roughness: 0.95 }));
    const back = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ side: THREE.BackSide, roughness: 0.95 }));
    front.castShadow = true;
    front.visible = back.visible = false;
    return { geometry, positions, cols, front, back };
  }

  rightHeight() { return Math.max(0.002, (this.sheets - this.turned) * SHEET); }
  leftHeight() { return Math.max(0.002, this.turned * SHEET); }

  /** Heights of the page blocks for the current number of turned leaves. */
  layout() {
    const hR = this.rightHeight(), hL = this.leftHeight();
    this.rightBlock.scale.y = hR;
    this.rightBlock.position.y = BOARD;
    this.rightTop.position.y = BOARD + hR + 0.0005;
    this.leftBlock.scale.y = hL;
    this.leftBlock.position.y = BOARD;
    this.leftTop.position.y = BOARD + hL + 0.0005;
    this.rightAnchor.position.y = BOARD + hR;
  }

  /** 0 closed, 1 open flat. */
  setOpenProgress(p) {
    this.openProgress = p;
    const total = this.sheets * SHEET;
    const e = easeInOut(p);
    this.frontPivot.rotation.z = e * Math.PI;
    this.frontPivot.position.y = lerp(BOARD + total, BOARD, e);
    this.spine.scale.y = BOARD * 2 + total;
    this.spine.position.set(-BOARD / 2, (BOARD * 2 + total) / 2, 0);
    this.spine.visible = p < 0.6;
    this.leftBlock.visible = this.leftTop.visible = p > 0.5;
    this.layout();
  }

  open() {
    return tween(1.4, (p) => this.setOpenProgress(p)).then(() => { this.opened = true; });
  }

  close() {
    this.opened = false;
    return tween(1.0, (p) => this.setOpenProgress(1 - p));
  }

  setPages(left, right) {
    if (left) { this.leftTop.material.map = left; this.leftTop.material.needsUpdate = true; }
    if (right) { this.rightTop.material.map = right; this.rightTop.material.needsUpdate = true; }
  }

  /** Turn one leaf. dir 1: right to left. `front` is the leaf's face while it lies on the right,
      `back` its face on the left; `reveal` goes onto the page it uncovers, `land` onto the page
      it comes to rest on. */
  async turn(dir, { front, back, reveal, land }) {
    const leaf = this.leaf;
    const backMap = back.clone();
    backMap.needsUpdate = true;
    backMap.wrapS = THREE.RepeatWrapping;
    backMap.repeat.x = -1;   // seen from underneath, the texture would read mirrored
    leaf.front.material.map = front;
    leaf.back.material.map = backMap;
    leaf.front.material.needsUpdate = leaf.back.material.needsUpdate = true;
    if (dir > 0) this.setPages(null, reveal); else this.setPages(reveal, null);
    const yRight = BOARD + this.rightHeight() + 0.002, yLeft = BOARD + this.leftHeight() + 0.002;
    leaf.front.visible = leaf.back.visible = true;
    await tween(0.95, (p) => {
      const theta = (dir > 0 ? easeInOut(p) : 1 - easeInOut(p)) * Math.PI;
      this.bendLeaf(theta, dir, lerp(yRight, yLeft, theta / Math.PI));
    });
    leaf.front.visible = leaf.back.visible = false;
    this.turned += dir;
    this.layout();
    if (dir > 0) this.setPages(land, null); else this.setPages(null, land);
    backMap.dispose();
  }

  /** Lay the leaf out along an arc: angle theta at the spine, the free edge lagging behind. */
  bendLeaf(theta, dir, baseY) {
    const { positions, cols, geometry } = this.leaf;
    const ds = PAGE_W / SEGMENTS;
    let x = 0, y = 0;
    for (let i = 0; i < cols; i++) {
      positions.set([x, baseY + y, -PAGE_H / 2], i * 3);
      positions.set([x, baseY + y, PAGE_H / 2], (i + cols) * 3);
      const s = (i + 0.5) / SEGMENTS;
      const a = theta - dir * CURL * Math.sin(theta) * Math.pow(s, 1.3);
      x += Math.cos(a) * ds;
      y += Math.sin(a) * ds;
    }
    geometry.attributes.position.needsUpdate = true;
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
  }

  dispose() {
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
      for (const m of mats) m.dispose();
    });
    this.group.removeFromParent();
  }
}
