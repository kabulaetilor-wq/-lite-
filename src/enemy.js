import * as THREE from 'three';
import { heightAt } from './world.js';

const MAT = {};
function mat(c) {
  if (!MAT[c]) MAT[c] = new THREE.MeshLambertMaterial({ color: c });
  return MAT[c];
}

const GEO = {
  torso: new THREE.BoxGeometry(0.5, 0.62, 0.3),
  head: new THREE.SphereGeometry(0.14, 10, 8),
  cap: new THREE.SphereGeometry(0.155, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2),
  arm: new THREE.BoxGeometry(0.12, 0.55, 0.12),
  rifle: new THREE.BoxGeometry(0.06, 0.07, 0.85),
  leg: new THREE.BoxGeometry(0.2, 0.86, 0.24),
  shadow: new THREE.CircleGeometry(0.5, 12),
};

// Sprite "!" quand l'ennemi est alerté
let alertTex = null;
function getAlertTexture() {
  if (alertTex) return alertTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#ff2a2a';
  g.strokeStyle = '#000';
  g.lineWidth = 6;
  g.font = 'bold 60px sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.strokeText('!', 32, 34);
  g.fillText('!', 32, 34);
  alertTex = new THREE.CanvasTexture(c);
  return alertTex;
}

function lerpAngle(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

const _sph = new THREE.Sphere();
const _box = new THREE.Box3();
const _hit = new THREE.Vector3();

export class Enemy {
  constructor(x, z, kind, env) {
    this.kind = kind; // 'soldier' | 'officer'
    this.env = env;
    this.hp = kind === 'officer' ? 150 : 100;
    this.home = { x, z };
    this.pos = new THREE.Vector3(x, heightAt(x, z), z);
    this.state = 'patrol';
    this.dead = false;
    this.deathT = 0;
    this.remove = false;
    this.target = null;
    this.wait = Math.random() * 3;
    this.phase = Math.random() * 6.28;
    this.speed = 1.1 + Math.random() * 0.5;
    this.shootTimer = 0;
    this.heading = Math.random() * Math.PI * 2;
    this.dist = Math.hypot(x, z);
    this.buildMesh();
  }

  buildMesh() {
    const officer = this.kind === 'officer';
    const uniform = officer ? 0x2b2b2b : 0x55663a;
    const capColor = officer ? 0x8b1a1a : 0x3b4a2a;
    const mesh = new THREE.Group();
    const body = new THREE.Group();
    mesh.add(body);

    const torso = new THREE.Mesh(GEO.torso, mat(uniform));
    torso.position.y = 1.17;
    body.add(torso);
    const head = new THREE.Mesh(GEO.head, mat(0xd2a679));
    head.position.y = 1.62;
    body.add(head);
    const cap = new THREE.Mesh(GEO.cap, mat(capColor));
    cap.position.y = 1.64;
    body.add(cap);
    for (const sx of [-1, 1]) {
      const arm = new THREE.Mesh(GEO.arm, mat(uniform));
      arm.position.set(sx * 0.31, 1.25, 0.14);
      arm.rotation.x = -1.0;
      body.add(arm);
    }
    const rifle = new THREE.Mesh(GEO.rifle, mat(0x1b1b1b));
    rifle.position.set(0.12, 1.22, 0.45);
    body.add(rifle);

    this.legL = new THREE.Group();
    this.legR = new THREE.Group();
    this.legL.position.set(-0.13, 0.86, 0);
    this.legR.position.set(0.13, 0.86, 0);
    const legMesh1 = new THREE.Mesh(GEO.leg, mat(0x3d4a2c));
    const legMesh2 = new THREE.Mesh(GEO.leg, mat(0x3d4a2c));
    legMesh1.position.y = -0.43;
    legMesh2.position.y = -0.43;
    this.legL.add(legMesh1);
    this.legR.add(legMesh2);
    body.add(this.legL, this.legR);

    const shadow = new THREE.Mesh(
      GEO.shadow,
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false })
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.06;
    mesh.add(shadow);

    const sm = new THREE.SpriteMaterial({ map: getAlertTexture(), transparent: true, fog: false });
    this.sprite = new THREE.Sprite(sm);
    this.sprite.position.y = 2.5;
    this.sprite.visible = false;
    mesh.add(this.sprite);

    if (officer) mesh.scale.setScalar(1.05);
    this.body = body;
    this.mesh = mesh;
    mesh.position.copy(this.pos);
    mesh.rotation.y = this.heading;
  }

  alert() {
    if (this.dead || this.state === 'alert') return;
    this.state = 'alert';
    this.shootTimer = 1.0 + Math.random() * 1.0;
    this.sprite.visible = true;
  }

  die() {
    this.dead = true;
    this.deathT = 0;
    this.sprite.visible = false;
  }

  // Test d'intersection d'un segment de balle ; retourne {dist, head} ou null
  hitTest(ray, maxDist) {
    if (this.dead) return null;
    const p = this.pos;
    let best = null;
    _sph.center.set(p.x, p.y + 1.66, p.z);
    _sph.radius = 0.19;
    let headD = Infinity;
    if (ray.intersectSphere(_sph, _hit)) {
      const d = _hit.distanceTo(ray.origin);
      if (d <= maxDist) headD = d;
    }
    _box.min.set(p.x - 0.3, p.y, p.z - 0.25);
    _box.max.set(p.x + 0.3, p.y + 1.5, p.z + 0.25);
    let bodyD = Infinity;
    if (ray.intersectBox(_box, _hit)) {
      const d = _hit.distanceTo(ray.origin);
      if (d <= maxDist) bodyD = d;
    }
    if (headD < Infinity && headD <= bodyD + 0.4) best = { dist: headD, head: true };
    else if (bodyD < Infinity) best = { dist: bodyD, head: false };
    return best;
  }

  update(dt) {
    const p = this.pos;
    if (this.dead) {
      this.deathT += dt;
      const k = Math.min(1, this.deathT / 0.55);
      this.body.rotation.x = -k * (Math.PI / 2);
      this.body.position.y = k * 0.18;
      if (this.deathT > 12) this.remove = true;
      return;
    }
    this.dist = Math.hypot(p.x, p.z);
    let swing = 0;

    if (this.state === 'patrol') {
      if (this.wait > 0) {
        this.wait -= dt;
      } else {
        if (!this.target) this.target = this.env.pickTarget(this);
        const dx = this.target.x - p.x;
        const dz = this.target.z - p.z;
        const d = Math.hypot(dx, dz);
        if (d < 0.4) {
          this.target = null;
          this.wait = 1 + Math.random() * 4;
        } else {
          this.heading = lerpAngle(this.heading, Math.atan2(dx, dz), Math.min(1, dt * 4));
          p.x += Math.sin(this.heading) * this.speed * dt;
          p.z += Math.cos(this.heading) * this.speed * dt;
          this.phase += dt * this.speed * 4.2;
          swing = Math.sin(this.phase) * 0.6;
        }
      }
    } else {
      const eye = this.env.eye;
      this.heading = lerpAngle(this.heading, Math.atan2(eye.x - p.x, eye.z - p.z), Math.min(1, dt * 6));
      this.shootTimer -= dt;
      if (this.shootTimer <= 0) {
        if (this.env.canSee(this)) {
          this.env.shoot(this);
          this.shootTimer = 2.2 + Math.random() * 1.6;
        } else {
          this.shootTimer = 0.8;
        }
      }
      // le "!" grossit avec la distance pour rester visible
      this.sprite.scale.setScalar(0.8 + this.dist * 0.012);
    }

    this.legL.rotation.x = swing;
    this.legR.rotation.x = -swing;
    p.y = heightAt(p.x, p.z);
    this.mesh.position.copy(p);
    this.mesh.rotation.y = this.heading;
  }
}
