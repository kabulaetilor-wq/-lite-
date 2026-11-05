import * as THREE from 'three';

export const WORLD_SIZE = 1000;

function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function rawHeight(x, z) {
  let h = 0;
  h += Math.sin(x * 0.008 + 1.3) * Math.cos(z * 0.0065 - 0.4) * 14;
  h += Math.sin(x * 0.021 + z * 0.017) * 5;
  h += Math.cos(x * 0.043 - z * 0.037 + 2.0) * 2.2;
  h += Math.sin(x * 0.09 + 0.7) * Math.sin(z * 0.08) * 0.9;
  return h;
}

const COMPOUND_POS = [
  [-70, -100], [120, -130], [-190, -60], [230, 40], [-60, 200],
  [60, -250], [-150, -250], [260, -230], [-300, -130], [180, 280],
];

export const compounds = COMPOUND_POS.map(([x, z], i) => ({
  x, z, r: 24, y: rawHeight(x, z), tpl: i % 3,
}));

const TOWER_Y = rawHeight(0, 0);

function smooth(a, b, v) {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

export function heightAt(x, z) {
  let h = rawHeight(x, z);
  const dt = Math.hypot(x, z);
  if (dt < 24) h = TOWER_Y + (h - TOWER_Y) * smooth(8, 24, dt);
  for (let i = 0; i < compounds.length; i++) {
    const c = compounds[i];
    const d = Math.hypot(x - c.x, z - c.z);
    if (d < c.r + 14) h = c.y + (h - c.y) * smooth(c.r - 6, c.r + 14, d);
  }
  return h;
}

// Position des yeux du tireur (sur la tour)
export const EYE = new THREE.Vector3(0, TOWER_Y + 10.6, 0);

// [dx, dz, largeur, profondeur, hauteur]
const TEMPLATES = [
  [[-8, -6, 9, 7, 4], [7, 4, 7, 9, 3.5], [0, 12, 5, 5, 3]],
  [[-6, 0, 12, 8, 4.5], [9, -7, 6, 6, 3]],
  [[0, 0, 8, 8, 5], [-10, 8, 6, 5, 3], [10, 9, 5, 6, 3]],
];
const WALL_COLORS = [0xb9a98a, 0x9c8f74, 0xa7a08c, 0x8f8a7a];

export function buildWorld(scene) {
  const rng = mulberry32(1337);
  const colliders = [];
  const trees = [];

  // ---------- Lumières ----------
  scene.add(new THREE.HemisphereLight(0xbcd6ff, 0x4a5a3a, 1.6));
  const sunDir = new THREE.Vector3(0.5, 0.55, -0.65).normalize();
  const sun = new THREE.DirectionalLight(0xfff1d0, 2.2);
  sun.position.copy(sunDir).multiplyScalar(500);
  scene.add(sun);

  // ---------- Ciel ----------
  {
    const geo = new THREE.SphereGeometry(900, 24, 16);
    const pos = geo.attributes.position;
    const col = new Float32Array(pos.count * 3);
    const horizon = new THREE.Color(0xb7cdd6);
    const top = new THREE.Color(0x3f78c4);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const t = Math.min(1, Math.max(0, pos.getY(i) / 900));
      c.copy(horizon).lerp(top, Math.pow(t, 0.55));
      col[i * 3] = c.r;
      col[i * 3 + 1] = c.g;
      col[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const sky = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false })
    );
    scene.add(sky);
    const sunMesh = new THREE.Mesh(
      new THREE.SphereGeometry(22, 12, 8),
      new THREE.MeshBasicMaterial({ color: 0xfff3c4, fog: false })
    );
    sunMesh.position.copy(sunDir).multiplyScalar(820);
    scene.add(sunMesh);
  }

  // ---------- Terrain ----------
  {
    const seg = 250;
    const geo = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, seg, seg);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const col = new Float32Array(pos.count * 3);
    const grass = new THREE.Color(0x4a6b2a);
    const grass2 = new THREE.Color(0x5d7d33);
    const rock = new THREE.Color(0x7a746a);
    const dirt = new THREE.Color(0x8a7556);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const h = heightAt(x, z);
      pos.setY(i, h);
      const n = Math.sin(x * 0.17) * Math.sin(z * 0.19) * 0.5 + 0.5;
      c.copy(grass).lerp(grass2, n);
      const hh = Math.min(1, Math.max(0, (h - 8) / 14));
      c.lerp(rock, hh * 0.8);
      let dd = Math.hypot(x, z) < 26 ? 1 - smooth(8, 26, Math.hypot(x, z)) : 0;
      for (let k = 0; k < compounds.length; k++) {
        const cp = compounds[k];
        const d = Math.hypot(x - cp.x, z - cp.z);
        dd = Math.max(dd, 1 - smooth(14, 34, d));
      }
      c.lerp(dirt, dd * 0.9);
      col[i * 3] = c.r;
      col[i * 3 + 1] = c.g;
      col[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.computeVertexNormals();
    scene.add(new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true })));
  }

  // ---------- Tour du tireur ----------
  {
    const wood = new THREE.MeshLambertMaterial({ color: 0x5a4430 });
    const g = new THREE.Group();
    const legGeo = new THREE.CylinderGeometry(0.2, 0.25, 9, 6);
    for (const sx of [-1.8, 1.8]) {
      for (const sz of [-1.8, 1.8]) {
        const leg = new THREE.Mesh(legGeo, wood);
        leg.position.set(sx, TOWER_Y + 4.5, sz);
        g.add(leg);
      }
    }
    const plat = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.3, 4.4), wood);
    plat.position.set(0, TOWER_Y + 9, 0);
    g.add(plat);
    const railMat = new THREE.MeshLambertMaterial({ color: 0x6b5238 });
    for (const [x, z, w, d] of [[0, -2.1, 4.4, 0.12], [0, 2.1, 4.4, 0.12], [-2.1, 0, 0.12, 4.4], [2.1, 0, 0.12, 4.4]]) {
      const r = new THREE.Mesh(new THREE.BoxGeometry(w, 0.12, d), railMat);
      r.position.set(x, TOWER_Y + 10.0, z);
      g.add(r);
    }
    scene.add(g);
  }

  // ---------- Compounds (bâtiments) ----------
  const roofMat = new THREE.MeshLambertMaterial({ color: 0x5a4a3a });
  const winMat = new THREE.MeshLambertMaterial({ color: 0x1d2428 });
  const crateMat = new THREE.MeshLambertMaterial({ color: 0x7a5a32 });
  compounds.forEach((cp, ci) => {
    TEMPLATES[cp.tpl].forEach(([dx, dz, w, d, h], bi) => {
      const x = cp.x + dx;
      const z = cp.z + dz;
      const wallMat = new THREE.MeshLambertMaterial({ color: WALL_COLORS[(ci + bi) % WALL_COLORS.length] });
      const wall = new THREE.Mesh(new THREE.BoxGeometry(w, h + 3, d), wallMat);
      wall.position.set(x, cp.y + (h - 3) / 2, z);
      scene.add(wall);
      const roof = new THREE.Mesh(new THREE.BoxGeometry(w + 0.6, 0.4, d + 0.6), roofMat);
      roof.position.set(x, cp.y + h + 0.2, z);
      scene.add(roof);
      // fenêtres
      for (const side of [-1, 1]) {
        for (let k = 0; k < 2; k++) {
          const wx = x + (k === 0 ? -w * 0.25 : w * 0.25);
          const win = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.0, 0.1), winMat);
          win.position.set(wx, cp.y + h * 0.55, z + side * (d / 2 + 0.03));
          scene.add(win);
        }
      }
      colliders.push(
        new THREE.Box3(
          new THREE.Vector3(x - w / 2, cp.y - 3, z - d / 2),
          new THREE.Vector3(x + w / 2, cp.y + h + 0.4, z + d / 2)
        )
      );
    });
    // caisses (couvertures)
    for (let k = 0; k < 3; k++) {
      const a = rng() * Math.PI * 2;
      const r = 14 + rng() * 6;
      const x = cp.x + Math.cos(a) * r;
      const z = cp.z + Math.sin(a) * r;
      const y = heightAt(x, z);
      const crate = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.2, 1.2), crateMat);
      crate.position.set(x, y + 0.6, z);
      scene.add(crate);
      colliders.push(new THREE.Box3(new THREE.Vector3(x - 0.6, y, z - 0.6), new THREE.Vector3(x + 0.6, y + 1.2, z + 0.6)));
    }
  });

  // ---------- Rochers ----------
  {
    const rockMat = new THREE.MeshLambertMaterial({ color: 0x8a867c, flatShading: true });
    const rockGeo = new THREE.IcosahedronGeometry(1, 0);
    let placed = 0;
    let guard = 0;
    while (placed < 70 && guard++ < 600) {
      const x = (rng() - 0.5) * 880;
      const z = (rng() - 0.5) * 880;
      if (Math.hypot(x, z) < 30) continue;
      if (compounds.some((c) => Math.hypot(x - c.x, z - c.z) < c.r + 2)) continue;
      const sx = 1 + rng() * 2.2;
      const sy = 0.8 + rng() * 1.4;
      const sz = 1 + rng() * 2.2;
      const m = new THREE.Mesh(rockGeo, rockMat);
      m.position.set(x, heightAt(x, z) + sy * 0.3, z);
      m.scale.set(sx, sy, sz);
      m.rotation.y = rng() * 6.28;
      scene.add(m);
      m.updateMatrixWorld(true);
      // boîte un peu réduite pour ne pas bloquer de façon injuste
      const box = new THREE.Box3().setFromObject(m);
      box.expandByScalar(-0.25);
      colliders.push(box);
      placed++;
    }
  }

  // ---------- Arbres (instanciés) ----------
  {
    const positions = [];
    let guard = 0;
    while (positions.length < 650 && guard++ < 2500) {
      const x = (rng() - 0.5) * 940;
      const z = (rng() - 0.5) * 940;
      if (Math.hypot(x, z) < 30) continue;
      if (compounds.some((c) => Math.hypot(x - c.x, z - c.z) < c.r + 4)) continue;
      positions.push({ x, z, s: 0.8 + rng() * 0.9, hue: rng() });
      trees.push({ x, z });
    }
    const trunkGeo = new THREE.CylinderGeometry(0.22, 0.32, 3, 6);
    const leafGeo = new THREE.ConeGeometry(1.9, 6, 7);
    const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshLambertMaterial({ color: 0x5b4126 }), positions.length);
    const leaves = new THREE.InstancedMesh(leafGeo, new THREE.MeshLambertMaterial({ color: 0xffffff }), positions.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const sc = new THREE.Vector3();
    const p = new THREE.Vector3();
    const color = new THREE.Color();
    positions.forEach((t, i) => {
      const y = heightAt(t.x, t.z);
      sc.set(t.s, t.s, t.s);
      p.set(t.x, y + 1.5 * t.s, t.z);
      m.compose(p, q, sc);
      trunks.setMatrixAt(i, m);
      p.set(t.x, y + 5 * t.s, t.z);
      m.compose(p, q, sc);
      leaves.setMatrixAt(i, m);
      color.setHSL(0.27 + t.hue * 0.06, 0.45, 0.2 + t.hue * 0.08);
      leaves.setColorAt(i, color);
    });
    trunks.frustumCulled = false;
    leaves.frustumCulled = false;
    scene.add(trunks);
    scene.add(leaves);
  }

  return { colliders, trees };
}
