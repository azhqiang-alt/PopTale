import * as THREE from "three";
import { easeInOut, lerp, tween } from "./anim.js";
import { closedSize } from "./book3d.js";
import { edgesTexture } from "./textures.js";

/* The bookshelf on the wall: every book in books/index.json stands face out on a ledge. Picking
   one flies its copy down to the table, where the real Book3D takes its place. */

export const SHELF_Z = -2.4;
export const SHELF_Y = 1.0;
const SCALE = 0.42;
const GAP = 0.56;
const ROW_H = 0.9;

export class Shelf {
  /** `columns` books per ledge; more books start a new ledge below. */
  constructor({ books, covers, columns = 5, sheets = 8 }) {
    this.group = new THREE.Group();
    this.items = [];
    this.columns = columns;
    const size = closedSize(sheets);
    const rows = Math.ceil(books.length / columns);
    const width = Math.min(columns, books.length) * GAP + 0.4;
    const ledgeY = (row) => SHELF_Y + (rows - 1 - row) * ROW_H;
    const wood = new THREE.MeshStandardMaterial({ color: "#8a5a3c", roughness: 0.8 });
    for (let row = 0; row < rows; row++) {
      const y = ledgeY(row);
      const plank = new THREE.Mesh(new THREE.BoxGeometry(width, 0.05, 0.36), wood);
      plank.position.set(0, y - 0.025, SHELF_Z + 0.1);
      plank.castShadow = plank.receiveShadow = true;
      const lip = new THREE.Mesh(new THREE.BoxGeometry(width, 0.05, 0.02), wood);
      lip.position.set(0, y + 0.02, SHELF_Z + 0.27);
      lip.castShadow = true;
      this.group.add(plank, lip);
      for (const side of [-1, 1]) {
        const bracket = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.2, 0.3), wood);
        bracket.position.set(side * (width / 2 - 0.2), y - 0.13, SHELF_Z + 0.08);
        this.group.add(bracket);
      }
    }
    // what the camera keeps in shot on the shelf view
    this.view = { center: [0, SHELF_Y + ((rows - 1) * ROW_H) / 2 + 0.3, SHELF_Z], half: [width / 2 + 0.05, (rows * ROW_H) / 2 + 0.05] };

    const geometry = new THREE.BoxGeometry(size.w, size.h, size.d);
    const edges = new THREE.MeshStandardMaterial({ map: edgesTexture(), roughness: 0.95 });
    books.forEach((book, i) => {
      const row = Math.floor(i / columns), col = i % columns;
      const inRow = Math.min(columns, books.length - row * columns);
      const cloth = new THREE.MeshStandardMaterial({ color: book.color || "#555", roughness: 0.75 });
      const cover = new THREE.MeshStandardMaterial({ map: covers[book.id], roughness: 0.6 });
      // box faces: +x -x +y -y +z -z; the cover is +y, the spine -x
      const mesh = new THREE.Mesh(geometry, [edges, cloth, cover, cloth, edges, edges]);
      mesh.castShadow = true;
      mesh.userData.id = book.id;
      const home = {
        position: new THREE.Vector3((col - (inRow - 1) / 2) * GAP, ledgeY(row) + (size.d * SCALE) / 2, SHELF_Z + 0.12),
        rotation: new THREE.Euler(Math.PI / 2 - 0.08, 0, 0),
        scale: SCALE,
      };
      applyPose(mesh, home);
      this.group.add(mesh);
      this.items.push({ id: book.id, book, mesh, home, hover: 0, hoverTarget: 0, wobble: 0 });
    });
  }

  dispose() {
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
      for (const m of mats) m.dispose();
    });
    this.group.removeFromParent();
  }

  pick(raycaster) {
    const hit = raycaster.intersectObjects(this.items.filter((it) => it.mesh.visible).map((it) => it.mesh), false)[0];
    return hit ? this.items.find((it) => it.mesh === hit.object) : null;
  }

  setHover(item) {
    for (const it of this.items) it.hoverTarget = it === item ? 1 : 0;
  }

  wobble(item) {
    item.wobble = 1;
  }

  /** Fly a book's copy from where it is to `pose` (position, rotation, scale). */
  flyTo(item, pose, duration = 1.2) {
    item.flying = true;
    const from = { position: item.mesh.position.clone(), quaternion: item.mesh.quaternion.clone(), scale: item.mesh.scale.x };
    const toQ = new THREE.Quaternion().setFromEuler(pose.rotation);
    const lift = new THREE.Vector3(0, 0.5, 0);
    return tween(duration, (p) => {
      const e = easeInOut(p);
      item.mesh.position.lerpVectors(from.position, pose.position, e).addScaledVector(lift, Math.sin(p * Math.PI));
      item.mesh.quaternion.slerpQuaternions(from.quaternion, toQ, e);
      item.mesh.scale.setScalar(lerp(from.scale, pose.scale, e));
    }).then(() => { item.flying = false; });
  }

  flyHome(item, duration = 1.0) {
    item.mesh.visible = true;
    return this.flyTo(item, item.home, duration);
  }

  update(dt, t) {
    for (const it of this.items) {
      if (it.flying || !it.mesh.visible) continue;
      it.hover += (it.hoverTarget - it.hover) * Math.min(1, dt * 8);
      it.wobble = Math.max(0, it.wobble - dt * 1.5);
      applyPose(it.mesh, it.home);
      it.mesh.position.z += it.hover * 0.12;
      it.mesh.position.y += it.hover * 0.03;
      it.mesh.rotation.x -= it.hover * 0.1;
      it.mesh.rotation.z = Math.sin(t * 30) * 0.06 * it.wobble;
    }
  }
}

function applyPose(mesh, pose) {
  mesh.position.copy(pose.position);
  mesh.rotation.copy(pose.rotation);
  mesh.scale.setScalar(pose.scale);
}
