import * as THREE from 'three';
import { buildWorld, heightAt, compounds, EYE } from './world.js';
import { Enemy } from './enemy.js';
import { MISSIONS } from './missions.js';
import * as sfx from './audio.js';

const $ = (id) => document.getElementById(id);
const clamp = THREE.MathUtils.clamp;
const rand = (a, b) => a + Math.random() * (b - a);
const TAU = Math.PI * 2;

/* =====================================================================
   Sauvegarde
   ===================================================================== */
const SAVE_KEY = 'elite-sniper-save-v1';
let save = { unlocked: 0, best: {}, sens: 1.5 };
try {
  const s = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
  if (s) save = { ...save, ...s };
} catch (e) { /* ignore */ }
function persist() {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) { /* ignore */ }
}

/* =====================================================================
   Rendu / scène
   ===================================================================== */
const canvas = $('gl');
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: (window.devicePixelRatio || 1) < 2,
  powerPreference: 'high-performance',
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));

const FOG_COLOR = 0xb7cdd6;
const scene = new THREE.Scene();
scene.background = new THREE.Color(FOG_COLOR);
scene.fog = new THREE.Fog(FOG_COLOR, 120, 520);

const BASE_FOV = 70;
const camera = new THREE.PerspectiveCamera(BASE_FOV, 1, 0.2, 1100);
camera.rotation.order = 'YXZ';
camera.position.copy(EYE);
scene.add(camera);

const world = buildWorld(scene);
const colliders = world.colliders;
const trees = world.trees;

// Arme à la première personne (visible hors lunette)
const rifle = new THREE.Group();
{
  const dark = new THREE.MeshLambertMaterial({ color: 0x222426 });
  const wood = new THREE.MeshLambertMaterial({ color: 0x5a3d25 });
  const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 1.1), dark);
  barrel.position.set(0, 0, -0.55);
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.12, 0.5), wood);
  body.position.set(0, -0.04, -0.1);
  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.14, 0.3), wood);
  stock.position.set(0, -0.08, 0.2);
  const scopeTube = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.3, 10), dark);
  scopeTube.rotation.x = Math.PI / 2;
  scopeTube.position.set(0, 0.1, -0.15);
  rifle.add(barrel, body, stock, scopeTube);
  rifle.position.set(0.22, -0.22, -0.45);
  camera.add(rifle);
}

/* =====================================================================
   Constantes de jeu
   ===================================================================== */
const ZOOMS = [
  { fov: 20, label: '4x' },
  { fov: 10, label: '8x' },
  { fov: 6.7, label: '12x' },
];
const MUZZLE_V = 800; // m/s
const DECEL = 220; // traînée (m/s²)
const G = 9.81;
const WIND_GAIN = 6; // amplification du vent pour le gameplay
const ZERO_ANGLE = 0.000775; // réglage à 100 m
const MAG_SIZE = 5;

/* =====================================================================
   État
   ===================================================================== */
let state = 'menu'; // menu | playing | paused | ended
let missionIdx = 0;
let mission = MISSIONS[0];
let enemies = [];
const effects = [];

let yaw = 0, pitch = 0, recoil = 0, shake = 0, rifleKick = 0;
let menuYaw = 0;
let scoped = false;
let zoomIdx = 1;
let holdBreath = false;
let stamina = 1;
let exhausted = false;
let hp = 100;
let mag = MAG_SIZE;
let reserve = 0;
let cooldown = 0;
let boltPlayed = true;
let reloadTimer = 0;
let timeLeft = 0;
let score = 0;
let kills = 0;
let shots = 0;
let hits = 0;
let headshots = 0;
let targetsLeft = 0;
let tAbs = 0;
let timeScale = 1;
let slowT = 0;
let finishing = false;
let finishDelay = 0;
let dmgFlash = 0;
let hitMarkT = 0;
let rangeM = null;
let rangeTimer = 0;

const windBase = { angle: 0, speed: 0 };
const windNow = new THREE.Vector3();
let windSpeedNow = 0;

/* =====================================================================
   Utilitaires monde
   ===================================================================== */
function inCollider(x, z, pad) {
  for (let i = 0; i < colliders.length; i++) {
    const b = colliders[i];
    if (x > b.min.x - pad && x < b.max.x + pad && z > b.min.z - pad && z < b.max.z + pad) return true;
  }
  return false;
}

const _losRay = new THREE.Ray();
const _losA = new THREE.Vector3();
const _losB = new THREE.Vector3();
const _losDir = new THREE.Vector3();
function hasLOS(from, to) {
  _losDir.copy(to).sub(from);
  const len = _losDir.length();
  _losDir.divideScalar(len);
  _losRay.origin.copy(from);
  _losRay.direction.copy(_losDir);
  for (let i = 0; i < colliders.length; i++) {
    if (_losRay.intersectBox(colliders[i], _losA)) {
      if (_losA.distanceTo(from) < len) return false;
    }
  }
  for (let d = 4; d < len; d += 5) {
    _losB.copy(from).addScaledVector(_losDir, d);
    if (heightAt(_losB.x, _losB.z) > _losB.y + 0.1) return false;
  }
  return true;
}

/* =====================================================================
   Ennemis : environnement
   ===================================================================== */
const _enemyEye = new THREE.Vector3();
const env = {
  eye: EYE,
  pickTarget(e) {
    for (let i = 0; i < 10; i++) {
      const a = Math.random() * TAU;
      const r = 3 + Math.random() * 10;
      const x = e.home.x + Math.cos(a) * r;
      const z = e.home.z + Math.sin(a) * r;
      if (!inCollider(x, z, 0.8)) return { x, z };
    }
    return { x: e.home.x, z: e.home.z };
  },
  canSee(e) {
    _enemyEye.set(e.pos.x, e.pos.y + 1.5, e.pos.z);
    return hasLOS(_enemyEye, EYE);
  },
  shoot(e) {
    enemyShoot(e);
  },
};

function angleFromForward(x, z) {
  return Math.atan2(x, -z);
}

function pickSpawn(m, officer) {
  const arc = THREE.MathUtils.degToRad(m.arc);
  let fallback = null;
  for (let tries = 0; tries < 120; tries++) {
    let x, z;
    const cand = compounds.filter((c) => {
      const d = Math.hypot(c.x, c.z);
      return d >= m.minD - 25 && d <= m.maxD + 25 && Math.abs(angleFromForward(c.x, c.z)) <= arc + 0.3;
    });
    if ((officer || Math.random() < 0.65) && cand.length) {
      const c = cand[Math.floor(Math.random() * cand.length)];
      const a = Math.random() * TAU;
      const r = 4 + Math.random() * 12;
      x = c.x + Math.cos(a) * r;
      z = c.z + Math.sin(a) * r;
    } else {
      const th = rand(-arc, arc);
      const d = rand(m.minD, m.maxD);
      x = Math.sin(th) * d;
      z = -Math.cos(th) * d;
    }
    if (Math.abs(x) > 420 || Math.abs(z) > 420) continue;
    if (Math.hypot(x, z) < 40) continue;
    if (inCollider(x, z, 1.2)) continue;
    if (trees.some((t) => (t.x - x) * (t.x - x) + (t.z - z) * (t.z - z) < 9)) continue;
    if (enemies.some((e) => Math.hypot(e.pos.x - x, e.pos.z - z) < 5)) continue;
    fallback = { x, z };
    const d = Math.hypot(x, z);
    if (d >= m.minD && d <= m.maxD + 20) return fallback;
  }
  return fallback || { x: 0, z: -m.minD };
}

/* =====================================================================
   Effets visuels
   ===================================================================== */
const puffGeo = new THREE.SphereGeometry(0.1, 5, 4);
const PUFF_MAT = {
  dust: new THREE.MeshBasicMaterial({ color: 0x9b8b6a }),
  blood: new THREE.MeshBasicMaterial({ color: 0x8a0f0f }),
  flash: new THREE.MeshBasicMaterial({ color: 0xffe08a }),
};

function spawnBurst(point, kind, n) {
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(puffGeo, PUFF_MAT[kind]);
    m.position.copy(point);
    scene.add(m);
    effects.push({
      type: 'puff',
      mesh: m,
      vel: new THREE.Vector3(rand(-2, 2), rand(1, 4), rand(-2, 2)),
      life: 0.7,
      max: 0.7,
    });
  }
}

function spawnFlash(e) {
  const m = new THREE.Mesh(puffGeo, PUFF_MAT.flash);
  m.position.set(e.pos.x + Math.sin(e.heading) * 0.9, e.pos.y + 1.3, e.pos.z + Math.cos(e.heading) * 0.9);
  const s = 1.5 + e.dist * 0.04;
  m.scale.setScalar(s);
  scene.add(m);
  effects.push({ type: 'flash', mesh: m, vel: new THREE.Vector3(), life: 0.09, max: 0.09 });
}

function spawnTracer(path) {
  if (path.length < 2) return;
  const geo = new THREE.BufferGeometry().setFromPoints(path);
  const mat = new THREE.LineBasicMaterial({ color: 0xffe9b0, transparent: true, opacity: 0.7, fog: false });
  const line = new THREE.Line(geo, mat);
  line.frustumCulled = false;
  scene.add(line);
  effects.push({ type: 'tracer', mesh: line, life: 0.35, max: 0.35 });
}

function updateEffects(dt) {
  for (let i = effects.length - 1; i >= 0; i--) {
    const f = effects[i];
    f.life -= dt;
    if (f.life <= 0) {
      scene.remove(f.mesh);
      if (f.type === 'tracer') {
        f.mesh.geometry.dispose();
        f.mesh.material.dispose();
      }
      effects.splice(i, 1);
      continue;
    }
    if (f.type === 'puff') {
      f.vel.y -= 9.8 * dt;
      f.mesh.position.addScaledVector(f.vel, dt);
      f.mesh.scale.setScalar(Math.max(0.05, f.life / f.max));
    } else if (f.type === 'tracer') {
      f.mesh.material.opacity = 0.7 * (f.life / f.max);
    }
  }
}

function clearEffects() {
  for (const f of effects) {
    scene.remove(f.mesh);
    if (f.type === 'tracer') {
      f.mesh.geometry.dispose();
      f.mesh.material.dispose();
    }
  }
  effects.length = 0;
}

/* =====================================================================
   Balistique
   ===================================================================== */
const _ray = new THREE.Ray();
const _a = new THREE.Vector3();
const _seg = new THREE.Vector3();
const _cur = new THREE.Vector3();
const _mid = new THREE.Vector3();

function bulletPos(out, origin, dir, t) {
  const s = MUZZLE_V * t - 0.5 * DECEL * t * t;
  const lag = (0.5 * DECEL * t * t) / MUZZLE_V;
  out.set(
    origin.x + dir.x * s + windNow.x * lag * WIND_GAIN,
    origin.y + dir.y * s - 0.5 * G * t * t,
    origin.z + dir.z * s + windNow.z * lag * WIND_GAIN
  );
  return out;
}

function traceBullet(origin, dir) {
  const path = [origin.clone()];
  const prev = origin.clone();
  const STEP = 0.004;
  const MAXT = 2.4;
  let n = 0;
  for (let t = STEP; t <= MAXT; t += STEP, n++) {
    bulletPos(_cur, origin, dir, t);
    _seg.copy(_cur).sub(prev);
    const len = _seg.length();
    if (len < 1e-6) break;
    _seg.divideScalar(len);
    _ray.origin.copy(prev);
    _ray.direction.copy(_seg);

    let best = null;
    for (const e of enemies) {
      const h = e.hitTest(_ray, len);
      if (h && (!best || h.dist < best.dist)) best = { dist: h.dist, head: h.head, type: 'enemy', enemy: e };
    }
    for (let i = 0; i < colliders.length; i++) {
      if (_ray.intersectBox(colliders[i], _a)) {
        const d = _a.distanceTo(prev);
        if (d <= len && (!best || d < best.dist)) best = { dist: d, type: 'obstacle' };
      }
    }
    if (_cur.y < heightAt(_cur.x, _cur.z)) {
      let lo = 0, hi = 1;
      for (let k = 0; k < 8; k++) {
        const mid = (lo + hi) / 2;
        _mid.copy(prev).lerp(_cur, mid);
        if (_mid.y < heightAt(_mid.x, _mid.z)) hi = mid;
        else lo = mid;
      }
      const d = hi * len;
      if (!best || d < best.dist) best = { dist: d, type: 'terrain' };
    }
    if (best) {
      const point = prev.clone().addScaledVector(_seg, best.dist);
      path.push(point);
      best.point = point;
      best.time = t;
      best.path = path;
      return best;
    }
    if (n % 6 === 0) path.push(_cur.clone());
    prev.copy(_cur);
    if (Math.abs(_cur.x) > 700 || Math.abs(_cur.z) > 700 || _cur.y < -80) break;
  }
  return { type: 'none', path };
}

/* =====================================================================
   Tir
   ===================================================================== */
const _aim = new THREE.Vector3();
function fire() {
  if (state !== 'playing' || finishing) return;
  if (cooldown > 0 || reloadTimer > 0) return;
  if (mag <= 0) {
    sfx.playEmpty();
    if (reserve > 0) startReload();
    return;
  }
  mag--;
  shots++;
  cooldown = 1.15;
  boltPlayed = false;
  sfx.playShot();

  camera.updateMatrixWorld(true);
  camera.getWorldDirection(_aim);
  if (!scoped) {
    _aim.x += rand(-0.03, 0.03);
    _aim.y += rand(-0.03, 0.03);
    _aim.z += rand(-0.03, 0.03);
  }
  _aim.y += ZERO_ANGLE;
  _aim.normalize();
  const res = traceBullet(camera.position.clone(), _aim.clone());

  recoil += scoped ? 0.014 : 0.03;
  rifleKick = 1;

  // piste lumineuse (décalée sous l'arme pour être visible)
  const tracerPath = res.path.map((p, i) => (i === 0 ? p.clone().add(new THREE.Vector3(0.2, -0.25, 0)) : p));
  spawnTracer(tracerPath);

  if (res.type === 'enemy') {
    hits++;
    spawnBurst(res.point, 'blood', 10);
    damageEnemy(res.enemy, res.head);
  } else if (res.type === 'terrain' || res.type === 'obstacle') {
    spawnBurst(res.point, 'dust', 8);
  }
  alertAfterShot(res.point || null);
  if (mag <= 0 && reserve > 0) {
    // rechargement auto après le cycle de culasse
    setTimeout(() => { if (state === 'playing') startReload(); }, 900);
  }
  updateAmmoHud();
}

function alertAfterShot(impact) {
  for (const e of enemies) {
    if (e.dead || e.state === 'alert') continue;
    const dp = Math.hypot(e.pos.x, e.pos.z);
    let chance = 0;
    if (impact) {
      const d = Math.hypot(e.pos.x - impact.x, e.pos.z - impact.z);
      if (d < 50) chance = 1;
      else if (d < 120) chance = 0.5;
    }
    if (dp < 90) chance = Math.max(chance, 0.35);
    if (Math.random() < chance) e.alert();
  }
}

function startReload() {
  if (reloadTimer > 0 || mag >= MAG_SIZE || reserve <= 0 || state !== 'playing') return;
  reloadTimer = 2.2;
  sfx.playReload();
  popup('Rechargement…', 'info');
}

function damageEnemy(e, head) {
  const dist = Math.hypot(e.pos.x, e.pos.z);
  e.hp -= head ? 999 : 100;
  if (e.hp <= 0) {
    e.die();
    kills++;
    targetsLeft--;
    if (head) headshots++;
    const base = e.kind === 'officer' ? 500 : 150;
    const headBonus = head ? (e.kind === 'officer' ? 200 : 100) : 0;
    const distBonus = Math.floor(dist / 10) * 5;
    const total = base + headBonus + distBonus;
    score += total;
    popup(`+${total}  ${head ? 'TÊTE · ' : ''}${Math.round(dist)} m`, 'good');
    sfx.playHit(true);
    showHitMark(true);
    // les voisins entendent / voient
    for (const o of enemies) {
      if (o === e || o.dead || o.state === 'alert') continue;
      if (Math.hypot(o.pos.x - e.pos.x, o.pos.z - e.pos.z) < 60 && Math.random() < 0.7) o.alert();
    }
    if (head && dist > 60) slowT = 1.0;
    if (targetsLeft <= 0) {
      finishing = true;
      finishDelay = 1.6;
    }
  } else {
    e.alert();
    popup('Touché !', 'info');
    sfx.playHit(false);
    showHitMark(false);
  }
  updateObjective();
}

function enemyShoot(e) {
  if (finishing) return;
  const d = Math.hypot(e.pos.x, e.pos.z);
  sfx.playEnemyShot(d);
  spawnFlash(e);
  const p = clamp(0.5 - d / 420, 0.08, 0.45);
  if (Math.random() < p) damagePlayer(rand(9, 18), e);
  else sfx.playWhiz();
}

function damagePlayer(amount, e) {
  hp = Math.max(0, hp - amount);
  dmgFlash = 1;
  shake = 1;
  sfx.playHurt();
  // direction du tir
  const f = { x: -Math.sin(yaw), z: -Math.cos(yaw) };
  const r = { x: Math.cos(yaw), z: -Math.sin(yaw) };
  const ex = e.pos.x - EYE.x;
  const ez = e.pos.z - EYE.z;
  const ang = Math.atan2(ex * r.x + ez * r.z, ex * f.x + ez * f.z);
  const dd = $('dmgdir');
  dd.style.transform = `rotate(${ang}rad)`;
  dd.style.opacity = '1';
  setTimeout(() => { dd.style.opacity = '0'; }, 900);
  if (hp <= 0) endMission(false, 'Vous avez été touché.');
}

/* =====================================================================
   Mesure de distance (télémètre)
   ===================================================================== */
const _rfDir = new THREE.Vector3();
const _rfPt = new THREE.Vector3();
function measureRange() {
  camera.updateMatrixWorld(true);
  camera.getWorldDirection(_rfDir);
  _ray.origin.copy(camera.position);
  _ray.direction.copy(_rfDir);
  let best = Infinity;
  for (let d = 2; d < 800; d += d < 100 ? 2 : 4) {
    _rfPt.copy(camera.position).addScaledVector(_rfDir, d);
    if (_rfPt.y < heightAt(_rfPt.x, _rfPt.z)) { best = d; break; }
  }
  for (let i = 0; i < colliders.length; i++) {
    if (_ray.intersectBox(colliders[i], _a)) {
      const d = _a.distanceTo(camera.position);
      if (d < best) best = d;
    }
  }
  for (const e of enemies) {
    const h = e.hitTest(_ray, 900);
    if (h && h.dist < best) best = h.dist;
  }
  rangeM = best < 800 ? best : null;
}

/* =====================================================================
   HUD / interface
   ===================================================================== */
const hud = $('hud');
const controls = $('controls');
const scopeCv = $('scope');
const sctx = scopeCv.getContext('2d');
const radarCv = $('radar');
const rctx = radarCv.getContext('2d');

function popup(text, cls) {
  const d = document.createElement('div');
  d.className = 'pop ' + (cls || 'info');
  d.textContent = text;
  const box = $('popups');
  box.appendChild(d);
  while (box.children.length > 3) box.removeChild(box.firstChild);
  setTimeout(() => d.remove(), 1800);
}

function showHitMark(kill) {
  const h = $('hitmark');
  h.className = kill ? 'kill' : '';
  h.style.opacity = '1';
  hitMarkT = 0.25;
}

function showBanner(html) {
  const b = $('banner');
  b.innerHTML = html;
  b.style.opacity = '1';
  setTimeout(() => { b.style.opacity = '0'; }, 3800);
}

function fmtTime(t) {
  t = Math.max(0, Math.ceil(t));
  const m = Math.floor(t / 60);
  const s = t % 60;
  return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
}

function updateObjective() {
  const total = mission.soldiers + mission.officers;
  $('objv').textContent = `${total - targetsLeft}/${total}`;
  $('scorev').textContent = String(score);
}

function updateAmmoHud() {
  $('ammo').textContent = `${mag} / ${reserve}` + (reloadTimer > 0 ? '  ↻' : '');
}

let lastHud = { timer: '', dist: '', wind: '', hp: -1, br: -1 };
function updateHud() {
  const tm = fmtTime(timeLeft);
  if (tm !== lastHud.timer) { $('timer').textContent = tm; lastHud.timer = tm; }
  const ds = rangeM ? `${Math.round(rangeM)} m` : '--- m';
  if (ds !== lastHud.dist) { $('dist').textContent = ds; lastHud.dist = ds; }
  const ws = windSpeedNow.toFixed(1);
  if (ws !== lastHud.wind) { $('windv').textContent = ws; lastHud.wind = ws; }
  // flèche du vent relative à la vue
  const w = { x: windNow.x, z: windNow.z };
  const f = { x: -Math.sin(yaw), z: -Math.cos(yaw) };
  const r = { x: Math.cos(yaw), z: -Math.sin(yaw) };
  const ang = Math.atan2(w.x * r.x + w.z * r.z, w.x * f.x + w.z * f.z);
  $('windarrow').style.transform = `rotate(${ang}rad)`;
  $('hpfill').style.transform = `scaleX(${hp / 100})`;
  $('brfill').style.transform = `scaleX(${stamina})`;
  $('zoomlabel').textContent = scoped ? ZOOMS[zoomIdx].label : '1x';
  $('crosshair').style.display = scoped ? 'none' : 'block';
  $('dmg').style.opacity = String(Math.min(1, dmgFlash + (hp < 30 ? 0.35 : 0)));
}

function drawRadar() {
  const W = radarCv.width;
  const c = W / 2;
  const R = c - 4;
  const range = 300;
  rctx.clearRect(0, 0, W, W);
  rctx.fillStyle = 'rgba(8,14,6,.55)';
  rctx.beginPath();
  rctx.arc(c, c, R, 0, TAU);
  rctx.fill();
  rctx.strokeStyle = 'rgba(255,255,255,.25)';
  rctx.lineWidth = 1;
  for (const k of [1 / 3, 2 / 3, 1]) {
    rctx.beginPath();
    rctx.arc(c, c, R * k, 0, TAU);
    rctx.stroke();
  }
  // cône de vision
  const fovRad = THREE.MathUtils.degToRad(camera.fov * camera.aspect);
  rctx.fillStyle = 'rgba(255,255,255,.14)';
  rctx.beginPath();
  rctx.moveTo(c, c);
  rctx.arc(c, c, R, -Math.PI / 2 - fovRad / 2, -Math.PI / 2 + fovRad / 2);
  rctx.closePath();
  rctx.fill();
  const f = { x: -Math.sin(yaw), z: -Math.cos(yaw) };
  const r = { x: Math.cos(yaw), z: -Math.sin(yaw) };
  for (const e of enemies) {
    if (e.dead) continue;
    const dx = e.pos.x - EYE.x;
    const dz = e.pos.z - EYE.z;
    let rx = dx * r.x + dz * r.z;
    let rf = dx * f.x + dz * f.z;
    const d = Math.hypot(rx, rf);
    if (d > range) { rx = (rx / d) * range; rf = (rf / d) * range; }
    const px = c + (rx / range) * R;
    const py = c - (rf / range) * R;
    const blink = e.state === 'alert' && Math.floor(tAbs * 4) % 2 === 0;
    rctx.fillStyle = e.kind === 'officer' ? '#ffd54a' : blink ? '#ffffff' : '#ff3b30';
    rctx.beginPath();
    rctx.arc(px, py, e.kind === 'officer' ? 7 : 5, 0, TAU);
    rctx.fill();
  }
  rctx.fillStyle = '#7bdc6a';
  rctx.beginPath();
  rctx.arc(c, c, 4, 0, TAU);
  rctx.fill();
}

// Distance de chute (rad) à une portée donnée, par rapport au réglage 100 m
function dropAngle(R) {
  const disc = MUZZLE_V * MUZZLE_V - 2 * DECEL * R;
  if (disc <= 0) return 0;
  const t = (MUZZLE_V - Math.sqrt(disc)) / DECEL;
  return Math.atan((0.5 * G * t * t) / R) - ZERO_ANGLE;
}

function drawScope() {
  const w = scopeCv.width;
  const h = scopeCv.height;
  sctx.clearRect(0, 0, w, h);
  const cx = w / 2;
  const cy = h / 2;
  const R = Math.min(w, h) * 0.47;
  sctx.fillStyle = '#000';
  sctx.beginPath();
  sctx.rect(0, 0, w, h);
  sctx.arc(cx, cy, R, 0, TAU, true);
  sctx.fill('evenodd');
  // bord adouci
  const g = sctx.createRadialGradient(cx, cy, R * 0.86, cx, cy, R);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,.6)');
  sctx.fillStyle = g;
  sctx.beginPath();
  sctx.arc(cx, cy, R, 0, TAU);
  sctx.fill();

  sctx.strokeStyle = 'rgba(0,0,0,.92)';
  sctx.fillStyle = 'rgba(0,0,0,.92)';
  const gap = 7;
  sctx.lineWidth = 1.2;
  sctx.beginPath();
  sctx.moveTo(cx - R, cy); sctx.lineTo(cx - gap, cy);
  sctx.moveTo(cx + gap, cy); sctx.lineTo(cx + R, cy);
  sctx.moveTo(cx, cy - R); sctx.lineTo(cx, cy - gap);
  sctx.moveTo(cx, cy + gap); sctx.lineTo(cx, cy + R);
  sctx.stroke();
  // gros montants
  sctx.lineWidth = 5;
  sctx.beginPath();
  sctx.moveTo(cx - R, cy); sctx.lineTo(cx - R * 0.45, cy);
  sctx.moveTo(cx + R * 0.45, cy); sctx.lineTo(cx + R, cy);
  sctx.moveTo(cx, cy + R * 0.45); sctx.lineTo(cx, cy + R);
  sctx.stroke();

  // repères de chute (200/300/400/500 m)
  const tanHalf = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
  const pxPerRad = h / 2 / tanHalf;
  let lastPy = 0;
  sctx.lineWidth = 1.5;
  sctx.font = `${Math.max(10, Math.round(h * 0.022))}px sans-serif`;
  sctx.textBaseline = 'middle';
  for (const range of [200, 300, 400, 500]) {
    const py = Math.tan(dropAngle(range)) * pxPerRad;
    if (py - lastPy < 5 || py > R * 0.44) continue;
    lastPy = py;
    const half = 10 + (range === 300 || range === 500 ? 0 : 5);
    sctx.beginPath();
    sctx.moveTo(cx - half, cy + py);
    sctx.lineTo(cx + half, cy + py);
    sctx.stroke();
    if (py > 14) sctx.fillText(String(range / 100), cx + half + 4, cy + py);
  }
}

/* =====================================================================
   Redimensionnement
   ===================================================================== */
function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  scopeCv.width = w;
  scopeCv.height = h;
}
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 200));
resize();

/* =====================================================================
   Contrôles
   ===================================================================== */
function look(dx, dy) {
  const fovRad = THREE.MathUtils.degToRad(camera.fov);
  const k = (fovRad / window.innerHeight) * save.sens;
  yaw -= dx * k;
  pitch -= dy * k;
  pitch = clamp(pitch, -0.55, 0.55);
}

function toggleScope() {
  if (state !== 'playing') return;
  scoped = !scoped;
  if (!scoped) holdBreath = false;
}

function cycleZoom() {
  if (state !== 'playing') return;
  if (!scoped) { scoped = true; return; }
  zoomIdx = (zoomIdx + 1) % ZOOMS.length;
}

const touch = $('touch');
let lookId = null;
let lastX = 0;
let lastY = 0;

touch.addEventListener('pointerdown', (e) => {
  if (state !== 'playing') return;
  if (e.pointerType === 'mouse') {
    if (document.pointerLockElement !== touch) {
      if (touch.requestPointerLock) touch.requestPointerLock();
    } else if (e.button === 0) fire();
    else if (e.button === 2) toggleScope();
    return;
  }
  if (lookId === null) {
    lookId = e.pointerId;
    lastX = e.clientX;
    lastY = e.clientY;
    try { touch.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
  }
});
touch.addEventListener('pointermove', (e) => {
  if (e.pointerId !== lookId) return;
  look(e.clientX - lastX, e.clientY - lastY);
  lastX = e.clientX;
  lastY = e.clientY;
});
const endLook = (e) => { if (e.pointerId === lookId) lookId = null; };
touch.addEventListener('pointerup', endLook);
touch.addEventListener('pointercancel', endLook);
touch.addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('mousemove', (e) => {
  if (document.pointerLockElement === touch && state === 'playing') look(e.movementX, e.movementY);
});
document.addEventListener('wheel', (e) => {
  if (state === 'playing' && scoped) {
    zoomIdx = clamp(zoomIdx + (e.deltaY < 0 ? 1 : -1), 0, ZOOMS.length - 1);
  }
}, { passive: true });

function bindBtn(el, onDown, onUp) {
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    el.classList.add('down');
    try { el.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    onDown && onDown();
  });
  const up = (e) => {
    e.preventDefault();
    el.classList.remove('down');
    onUp && onUp();
  };
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
}
bindBtn($('bFire'), fire);
bindBtn($('bScope'), toggleScope);
bindBtn($('bZoom'), cycleZoom);
bindBtn($('bBreath'), () => { if (scoped) holdBreath = true; }, () => { holdBreath = false; });
bindBtn($('bReload'), startReload);
bindBtn($('bPause'), pauseGame);

window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  const k = e.key.toLowerCase();
  if (state === 'playing') {
    if (k === ' ' || k === 'f') { fire(); e.preventDefault(); }
    else if (k === 'r') startReload();
    else if (k === 'x') toggleScope();
    else if (k === 'z') cycleZoom();
    else if (k === 'shift') { if (scoped) holdBreath = true; }
    else if (k === 'escape' || k === 'p') pauseGame();
  } else if (state === 'paused' && (k === 'escape' || k === 'p')) resumeGame();
});
window.addEventListener('keyup', (e) => {
  if (e.key === 'Shift') holdBreath = false;
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && state === 'playing') pauseGame();
});
document.addEventListener('pointerlockchange', () => {
  if (!document.pointerLockElement && state === 'playing' && !finishing) { /* souris libérée */ }
});

$('sens').value = String(save.sens);
$('sens').addEventListener('input', (e) => {
  save.sens = parseFloat(e.target.value);
  persist();
});

/* =====================================================================
   Menus / flux de mission
   ===================================================================== */
function buildMenu() {
  const box = $('missions');
  box.innerHTML = '';
  MISSIONS.forEach((m, i) => {
    const locked = i > save.unlocked;
    const b = document.createElement('button');
    b.className = 'mcard' + (locked ? ' locked' : '');
    const best = save.best[m.id];
    b.innerHTML =
      `<span class="mn">${m.id}</span>` +
      `<span class="mt"><b>${m.name}</b><small>${m.soldiers + m.officers} cibles · ${m.minD}-${m.maxD} m · vent ${m.wind} m/s</small></span>` +
      `<span class="mb">${locked ? '🔒' : best ? '★ ' + best : ''}</span>`;
    if (!locked) {
      b.addEventListener('click', () => {
        sfx.initAudio();
        startMission(i);
      });
    }
    box.appendChild(b);
  });
}

function showOnly(name) {
  $('menu').classList.toggle('hidden', name !== 'menu');
  $('pause').classList.toggle('hidden', name !== 'pause');
  $('end').classList.toggle('hidden', name !== 'end');
  const playing = name === 'game';
  hud.classList.toggle('hidden', !playing && name !== 'pause' && name !== 'end');
  controls.classList.toggle('hidden', !playing);
  if (name === 'menu') hud.classList.add('hidden');
}

function showMenu() {
  state = 'menu';
  scoped = false;
  holdBreath = false;
  scopeCv.style.display = 'none';
  rifle.visible = false;
  clearEnemies();
  clearEffects();
  if (document.exitPointerLock) document.exitPointerLock();
  buildMenu();
  showOnly('menu');
}

function clearEnemies() {
  for (const e of enemies) scene.remove(e.mesh);
  enemies = [];
}

function startMission(idx) {
  missionIdx = idx;
  mission = MISSIONS[idx];
  clearEnemies();
  clearEffects();

  // vent
  windBase.angle = Math.random() * TAU;
  windBase.speed = mission.wind * (0.75 + Math.random() * 0.5);

  hp = 100;
  mag = MAG_SIZE;
  reserve = Math.max(0, mission.ammo - MAG_SIZE);
  cooldown = 0.5;
  reloadTimer = 0;
  boltPlayed = true;
  stamina = 1;
  exhausted = false;
  holdBreath = false;
  scoped = false;
  zoomIdx = 1;
  yaw = 0;
  pitch = 0;
  recoil = 0;
  shake = 0;
  rifleKick = 0;
  timeLeft = mission.time;
  score = 0;
  kills = 0;
  shots = 0;
  hits = 0;
  headshots = 0;
  tAbs = 0;
  timeScale = 1;
  slowT = 0;
  finishing = false;
  finishDelay = 0;
  dmgFlash = 0;
  rangeM = null;
  camera.fov = BASE_FOV;
  camera.updateProjectionMatrix();

  // ennemis
  for (let i = 0; i < mission.officers; i++) {
    const p = pickSpawn(mission, true);
    const e = new Enemy(p.x, p.z, 'officer', env);
    enemies.push(e);
    scene.add(e.mesh);
  }
  for (let i = 0; i < mission.soldiers; i++) {
    const p = pickSpawn(mission, false);
    const e = new Enemy(p.x, p.z, 'soldier', env);
    enemies.push(e);
    scene.add(e.mesh);
  }
  targetsLeft = enemies.length;

  state = 'playing';
  rifle.visible = true;
  scopeCv.style.display = 'none';
  showOnly('game');
  updateObjective();
  updateAmmoHud();
  const windTxt = mission.wind === 0 ? 'Aucun vent' : `Vent ~${mission.wind} m/s`;
  const off = mission.officers ? ` dont ${mission.officers} officier (jaune)` : '';
  showBanner(`<b>Mission ${mission.id} — ${mission.name}</b>Éliminez ${enemies.length} cibles${off}. ${windTxt}.`);
}

function pauseGame() {
  if (state !== 'playing') return;
  state = 'paused';
  holdBreath = false;
  if (document.exitPointerLock) document.exitPointerLock();
  $('pause').classList.remove('hidden');
}

function resumeGame() {
  if (state !== 'paused') return;
  state = 'playing';
  $('pause').classList.add('hidden');
}

function endMission(win, reason) {
  if (state !== 'playing') return;
  state = 'ended';
  holdBreath = false;
  scoped = false;
  scopeCv.style.display = 'none';
  if (document.exitPointerLock) document.exitPointerLock();

  const acc = shots ? hits / shots : 0;
  let bonus = 0;
  if (win) {
    bonus = Math.floor(timeLeft) * 2 + Math.round(acc * 500) + Math.round(hp) * 2;
    score += bonus;
    if (save.unlocked < Math.min(missionIdx + 1, MISSIONS.length - 1)) save.unlocked = missionIdx + 1;
    if (!save.best[mission.id] || score > save.best[mission.id]) save.best[mission.id] = score;
    persist();
  }
  const t = $('endtitle');
  t.textContent = win ? 'Mission réussie' : 'Mission échouée';
  t.className = win ? 'win' : 'lose';
  $('endreason').textContent = reason;
  $('endstats').innerHTML =
    `<span>Cibles</span><b>${kills}/${mission.soldiers + mission.officers}</b>` +
    `<span>Tirs / touches</span><b>${shots} / ${hits}</b>` +
    `<span>Têtes</span><b>${headshots}</b>` +
    `<span>Bonus</span><b>${bonus}</b>` +
    `<span>Score</span><b>${score}</b>`;
  $('btnNext').classList.toggle('hidden', !(win && missionIdx + 1 < MISSIONS.length));
  showOnly('end');
}

$('btnResume').addEventListener('click', resumeGame);
$('btnPauseMenu').addEventListener('click', showMenu);
$('btnEndMenu').addEventListener('click', showMenu);
$('btnRetry').addEventListener('click', () => startMission(missionIdx));
$('btnNext').addEventListener('click', () => startMission(missionIdx + 1));

/* =====================================================================
   Boucle principale
   ===================================================================== */
let last = performance.now();
let radarTimer = 0;

function update(real) {
  if (state === 'menu') {
    menuYaw += real * 0.05;
    camera.fov = BASE_FOV;
    camera.rotation.set(-0.08, menuYaw, 0);
    updateEffects(real);
    return;
  }
  if (state === 'paused') return;
  if (state === 'ended') {
    updateEffects(real);
    for (const e of enemies) if (e.dead) e.update(real);
    return;
  }

  // ralenti cinématique
  if (slowT > 0) {
    slowT -= real;
    timeScale += (0.25 - timeScale) * Math.min(1, real * 10);
  } else {
    timeScale += (1 - timeScale) * Math.min(1, real * 4);
  }
  const dt = real * timeScale;
  tAbs += dt;

  if (!finishing) {
    timeLeft -= real;
    if (timeLeft <= 0) {
      endMission(false, 'Temps écoulé.');
      return;
    }
  } else {
    finishDelay -= real;
    if (finishDelay <= 0) {
      endMission(true, 'Toutes les cibles sont neutralisées.');
      return;
    }
  }

  // vent (rafales)
  const gust = 1 + 0.3 * Math.sin(tAbs * 0.35) + 0.15 * Math.sin(tAbs * 0.9 + 2);
  windSpeedNow = windBase.speed * gust;
  windNow.set(Math.sin(windBase.angle) * windSpeedNow, 0, Math.cos(windBase.angle) * windSpeedNow);

  // souffle
  if (holdBreath && scoped && !exhausted) {
    stamina -= dt / 5;
    if (stamina <= 0) {
      stamina = 0;
      exhausted = true;
      holdBreath = false;
    }
  } else {
    stamina = Math.min(1, stamina + dt / 6);
    if (exhausted && stamina >= 0.35) exhausted = false;
  }

  // temporisations de l'arme
  if (cooldown > 0) {
    cooldown -= dt;
    if (!boltPlayed && cooldown < 0.7) {
      boltPlayed = true;
      sfx.playBolt();
    }
  }
  if (reloadTimer > 0) {
    reloadTimer -= dt;
    if (reloadTimer <= 0) {
      reloadTimer = 0;
      const n = Math.min(MAG_SIZE - mag, reserve);
      mag += n;
      reserve -= n;
      updateAmmoHud();
    }
  }

  // balancement / recul
  const holding = holdBreath && scoped && !exhausted;
  let amp = scoped ? 0.0028 : 0.0007;
  if (holding) amp *= 0.12;
  else if (exhausted) amp *= 1.8;
  if (hp < 40) amp *= 1.4;
  const swayX = (Math.sin(tAbs * 1.1) + Math.sin(tAbs * 2.3 + 1) * 0.4) * amp;
  const swayY = (Math.cos(tAbs * 0.9) + Math.sin(tAbs * 1.9 + 2) * 0.4) * amp;
  recoil *= Math.exp(-5 * real);
  shake = Math.max(0, shake - real * 2.2);
  rifleKick = Math.max(0, rifleKick - real * 4);
  dmgFlash = Math.max(0, dmgFlash - real * 1.6);
  if (hitMarkT > 0) {
    hitMarkT -= real;
    if (hitMarkT <= 0) $('hitmark').style.opacity = '0';
  }
  const sx = (Math.random() - 0.5) * 0.02 * shake;
  const sy = (Math.random() - 0.5) * 0.02 * shake;
  camera.rotation.set(pitch + recoil + swayY + sy, yaw + swayX + sx, 0);

  // zoom
  const fovTarget = scoped ? ZOOMS[zoomIdx].fov : BASE_FOV;
  if (Math.abs(camera.fov - fovTarget) > 0.01) {
    camera.fov += (fovTarget - camera.fov) * Math.min(1, real * 12);
    camera.updateProjectionMatrix();
  }
  const showScope = scoped && camera.fov < 32;
  scopeCv.style.display = showScope ? 'block' : 'none';
  rifle.visible = !scoped;
  rifle.position.z = -0.45 + rifleKick * 0.08;

  // ennemis
  for (let i = enemies.length - 1; i >= 0; i--) {
    const e = enemies[i];
    e.update(dt);
    if (e.remove) {
      scene.remove(e.mesh);
      enemies.splice(i, 1);
    }
  }
  updateEffects(dt);

  // télémètre
  rangeTimer -= real;
  if (rangeTimer <= 0) {
    rangeTimer = 0.1;
    measureRange();
  }

  // plus de munitions ?
  if (!finishing && mag <= 0 && reserve <= 0 && cooldown <= 0 && targetsLeft > 0) {
    endMission(false, 'Munitions épuisées.');
    return;
  }
  radarTimer -= real;
  if (radarTimer <= 0) {
    radarTimer = 0.066;
    drawRadar();
  }
  updateHud();
  updateAmmoHud();
}

function frame(now) {
  requestAnimationFrame(frame);
  const real = Math.min(0.05, (now - last) / 1000);
  last = now;
  update(real);
  renderer.render(scene, camera);
  if (state === 'playing' && scopeCv.style.display === 'block') drawScope();
}

showMenu();
requestAnimationFrame(frame);
