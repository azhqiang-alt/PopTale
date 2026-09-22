import * as THREE from "three";

/* Things on the table around the book, all built from primitives and canvas textures (no model
   files): a desk lamp that lights the pages, a jar of fireflies, letter blocks, a ball, a cup of
   crayons, a small stack of books and a wooden star. They sit outside the open spread
   (x -1.05..1.05, z -0.75..0.75) and behind or beside the book in every camera view. */

const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.65, ...extra });

function shadowed(mesh) {
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function blockFace(char, bg, fg) {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d");
  g.fillStyle = bg;
  g.fillRect(0, 0, 256, 256);
  g.strokeStyle = "rgba(255,255,255,0.85)";
  g.lineWidth = 14;
  g.strokeRect(18, 18, 220, 220);
  g.fillStyle = fg;
  g.font = '700 150px "Kaiti SC", "STKaiti", "KaiTi", "PingFang SC", serif';
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(char, 128, 138);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function block(chars, bg, fg, size = 0.2) {
  const faces = chars.map((ch) => std("#ffffff", { map: blockFace(ch, bg, fg), roughness: 0.55 }));
  // +x, -x, +y, -y, +z, -z
  const mats = [faces[0], faces[1], faces[2], faces[2], faces[0], faces[1]];
  const mesh = shadowed(new THREE.Mesh(new THREE.BoxGeometry(size, size, size), mats));
  mesh.position.y = size / 2;
  return mesh;
}

function stripes(colors) {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 128;
  const g = c.getContext("2d");
  colors.forEach((col, i) => { g.fillStyle = col; g.fillRect(0, (i * 128) / colors.length, 256, 128 / colors.length + 1); });
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function lamp() {
  const g = new THREE.Group();
  const brass = std("#c9a45a", { metalness: 0.6, roughness: 0.35 });
  const base = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.24, 0.07, 40), std("#6b4228", { roughness: 0.5 })));
  base.position.y = 0.035;
  const stem = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.72, 16), brass));
  stem.position.y = 0.43;
  const shade = new THREE.Mesh(
    new THREE.CylinderGeometry(0.13, 0.27, 0.26, 40, 1, true),
    new THREE.MeshStandardMaterial({ color: "#f6ecd6", roughness: 0.9, side: THREE.DoubleSide, emissive: "#ffcf87", emissiveIntensity: 0.18 }),
  );
  shade.position.y = 0.8;
  shade.castShadow = true;
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.055, 20, 14), new THREE.MeshBasicMaterial({ color: new THREE.Color("#ffe3a8").multiplyScalar(4) }));
  bulb.position.y = 0.72;
  const light = new THREE.PointLight("#ffc978", 3.2, 4.5, 1.5);
  light.position.y = 0.66;
  g.add(base, stem, shade, bulb, light);
  return g;
}

/** A glass jar with a few fireflies drifting inside; they glow through the bloom pass. */
function fireflyJar() {
  const g = new THREE.Group();
  const glass = new THREE.Mesh(
    new THREE.CylinderGeometry(0.11, 0.11, 0.3, 36, 1, true),
    // unlit, so the fireflies' own light does not flood it
    new THREE.MeshBasicMaterial({ color: "#cfe6f5", transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false }),
  );
  glass.position.y = 0.15;
  const lid = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.105, 0.105, 0.04, 36), std("#8a5a34", { roughness: 0.5 })));
  lid.position.y = 0.32;
  const bottom = new THREE.Mesh(new THREE.CircleGeometry(0.11, 36), new THREE.MeshBasicMaterial({ color: "#6f8f6a", transparent: true, opacity: 0.35 }));
  bottom.rotation.x = -Math.PI / 2;
  bottom.position.y = 0.002;
  g.add(glass, lid, bottom);
  const flies = [];
  const glowMat = new THREE.MeshBasicMaterial({ color: new THREE.Color("#d8ff7a").multiplyScalar(5) });
  for (let i = 0; i < 6; i++) {
    const fly = new THREE.Mesh(new THREE.SphereGeometry(0.014, 10, 8), glowMat);
    fly.userData = { a: Math.random() * 6.28, b: Math.random() * 6.28, s: 0.6 + Math.random() * 0.8 };
    flies.push(fly);
    g.add(fly);
  }
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.006, 8, 40), new THREE.MeshBasicMaterial({ color: "#e8f6ff", transparent: true, opacity: 0.45 }));
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 0.3;
  g.add(rim);
  const light = new THREE.PointLight("#c8ff70", 0.5, 1.0, 2);
  light.position.y = 0.18;
  g.add(light);
  g.userData.update = (t) => {
    for (const f of flies) {
      const { a, b, s } = f.userData;
      f.position.set(Math.sin(t * s + a) * 0.065, 0.15 + Math.sin(t * s * 0.7 + b) * 0.1, Math.cos(t * s * 0.9 + a) * 0.065);
      f.scale.setScalar(0.6 + 0.4 * Math.max(0, Math.sin(t * 2.3 * s + b)));
    }
    light.intensity = 0.4 + Math.sin(t * 1.7) * 0.12;
  };
  return g;
}

function ball() {
  const tex = stripes(["#e8574a", "#fbf3e2", "#3f6fb5", "#fbf3e2", "#e8574a"]);
  const r = 0.12;
  const mesh = shadowed(new THREE.Mesh(new THREE.SphereGeometry(r, 36, 24), std("#ffffff", { map: tex, roughness: 0.35 })));
  mesh.position.y = r;
  mesh.rotation.set(1.25, 0.3, 0.2);
  return mesh;
}

function crayonCup() {
  const g = new THREE.Group();
  const cup = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.075, 0.18, 32), std("#ffffff", { map: stripes(["#f6efe2", "#8fb8de", "#f6efe2"]), roughness: 0.4 })));
  cup.position.y = 0.09;
  g.add(cup);
  ["#e04b3c", "#f2b134", "#4c9a52", "#3f6fb5", "#8e5bb5"].forEach((color, i) => {
    const a = (i / 5) * Math.PI * 2;
    const crayon = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.2, 12), std(color, { roughness: 0.5 }));
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.014, 0.035, 12), std(color, { roughness: 0.5 }));
    tip.position.y = 0.117;
    crayon.add(body, tip);
    crayon.position.set(Math.cos(a) * 0.035, 0.19 + (i % 2) * 0.02, Math.sin(a) * 0.035);
    crayon.rotation.set(Math.sin(a) * 0.18, 0, -Math.cos(a) * 0.18);
    crayon.traverse((m) => { if (m.isMesh) m.castShadow = true; });
    g.add(crayon);
  });
  return g;
}

function bookStack() {
  const g = new THREE.Group();
  const specs = [["#3f6fb5", 0.5, 0.36, 0.07], ["#e8a13c", 0.46, 0.33, 0.06], ["#b5475a", 0.42, 0.3, 0.05]];
  let y = 0;
  specs.forEach(([color, w, d, h], i) => {
    const b = shadowed(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), [std(color), std("#f3ead6"), std(color), std(color), std("#f3ead6"), std("#f3ead6")]));
    b.position.set(0, y + h / 2, 0);
    b.rotation.y = (i - 1) * 0.12;
    y += h;
    g.add(b);
  });
  return g;
}

function woodenStar() {
  const shape = new THREE.Shape();
  for (let k = 0; k < 10; k++) {
    const a = Math.PI / 2 + (k * Math.PI) / 5;
    const r = k % 2 ? 0.055 : 0.13;
    if (k === 0) shape.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else shape.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.04, bevelEnabled: true, bevelSize: 0.012, bevelThickness: 0.012, bevelSegments: 3 });
  const star = shadowed(new THREE.Mesh(geo, std("#f2c14e", { roughness: 0.45, emissive: "#6b4a00", emissiveIntensity: 0.25 })));
  const stand = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.04, 28), std("#8a5a34")));
  stand.position.y = 0.02;
  star.position.set(0, 0.17, -0.02);
  const g = new THREE.Group();
  g.add(stand, star);
  return g;
}

export function buildProps() {
  const group = new THREE.Group();
  const place = (obj, x, z, ry = 0) => { obj.position.set(x, 0, z); obj.rotation.y += ry; group.add(obj); return obj; };

  place(lamp(), -1.45, -1.15);
  const jar = place(fireflyJar(), 1.42, -0.95);
  place(woodenStar(), 0.55, -1.25, -0.25);

  const blocks = new THREE.Group();
  const b1 = block(["萤", "火", "书"], "#e8574a", "#ffffff");
  const b2 = block(["星", "月", "云"], "#4c9a52", "#ffffff");
  const b3 = block(["乐", "兔", "灯"], "#3f6fb5", "#ffffff", 0.18);
  b1.position.x = -0.11; b1.rotation.y = 0.2;
  b2.position.x = 0.12; b2.position.z = 0.03; b2.rotation.y = -0.35;
  b3.position.set(0.0, 0.2 + 0.09, 0.01); b3.rotation.y = 0.55;
  blocks.add(b1, b2, b3);
  place(blocks, 1.36, -0.3, -0.3);

  place(ball(), 1.3, 0.45);
  place(crayonCup(), -1.45, 0.55);
  place(bookStack(), -1.6, -0.25, 0.35);

  group.userData.update = (t) => jar.userData.update(t);
  return group;
}
