import * as THREE from '../vendor/three.module.min.js';
import { SETS, buildDie } from './dice.js';

const $ = (s) => document.querySelector(s);
const stage = $('#stage');
const resultEl = $('#result');
const historyEl = $('#history');
const rollBtn = $('#roll');
const motionBtn = $('#enable-motion');
const hintEl = $('#hint');
const picker = $('#picker');

// ---------- Scene ----------
const BG = 0x151a27;
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
stage.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(BG);
scene.fog = new THREE.Fog(BG, 9, 18);

const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
camera.position.set(0, 6.6, 5.4);
camera.lookAt(0, 0.2, 0.15);

scene.add(new THREE.HemisphereLight(0xffffff, 0x3a4560, 1.4));
const sun = new THREE.DirectionalLight(0xffffff, 2.4);
sun.position.set(2.5, 8, 3.5);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = sun.shadow.camera.bottom = -5;
sun.shadow.camera.right = sun.shadow.camera.top = 5;
sun.shadow.radius = 5;
scene.add(sun);

// The table the dice land on.
const table = new THREE.Mesh(
  new THREE.CircleGeometry(14, 64),
  new THREE.MeshStandardMaterial({ color: 0x24304a, roughness: 0.95, metalness: 0 }),
);
table.rotation.x = -Math.PI / 2;
table.receiveShadow = true;
scene.add(table);

function resize() {
  const { clientWidth: w, clientHeight: h } = stage;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  // Keep the dice comfortably in view on narrow screens.
  const minHorizontal = THREE.MathUtils.degToRad(34);
  camera.fov = Math.max(36, THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(minHorizontal / 2) / (w / h))));
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(stage);

// ---------- Helpers ----------
const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0), NEG_Z = new THREE.Vector3(0, 0, -1);

function randomInt(n) {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0] % n;
}
const rand = (a, b) => a + Math.random() * (b - a);

/**
 * Pick a random result for a die and work out how it lies on the table:
 * result face up with the number readable from the camera (or, for a D4, result vertex up).
 */
function restingPose(die, homeX) {
  let m, value;
  if (die.vertices) {
    const v = die.vertices[randomInt(die.vertices.length)];
    const a = v.pos.clone().normalize();
    const adjacent = die.faces.filter((f) => f.verts.some((p) => p.distanceTo(v.pos) < 1e-4));
    const f = adjacent[randomInt(adjacent.length)];
    const b = f.normal.clone().addScaledVector(a, -f.normal.dot(a)).normalize();
    const c = new THREE.Vector3().crossVectors(a, b);
    m = new THREE.Matrix4().makeBasis(c, a, b).transpose();
    value = v.value;
  } else {
    const f = die.faces[randomInt(die.faces.length)];
    m = new THREE.Matrix4().makeBasis(X, NEG_Z, Y)
      .multiply(new THREE.Matrix4().makeBasis(f.right, f.up, f.normal).transpose());
    value = f.value;
  }
  const quat = new THREE.Quaternion().setFromAxisAngle(Y, rand(-0.35, 0.35))
    .multiply(new THREE.Quaternion().setFromRotationMatrix(m));
  // Sit the lowest point exactly on the table.
  let minY = Infinity;
  const p = new THREE.Vector3();
  for (const f of die.faces) for (const v of f.verts) minY = Math.min(minY, p.copy(v).applyQuaternion(quat).y);
  const pos = new THREE.Vector3(homeX + rand(-0.25, 0.25), -minY, rand(-0.3, 0.3));
  return { value, quat, pos };
}

// ---------- Dice state ----------
let setKey = 'd20';
let dice = []; // { die, group, homeX, angVel, settle, radius }
let state = 'idle'; // idle | shaking | settling
let intensity = 1;
let lastShake = 0;
const history = [];

try { const saved = localStorage.getItem('dice-type'); if (saved && SETS[saved]) setKey = saved; } catch {}
const fromUrl = new URLSearchParams(location.search).get('die');
if (fromUrl && SETS[fromUrl]) setKey = fromUrl;

function setDice(key) {
  setKey = key;
  try { localStorage.setItem('dice-type', key); } catch {}
  for (const d of dice) {
    scene.remove(d.group);
    d.die.mesh.geometry.dispose();
    d.die.mesh.material.forEach((m) => { m.map.dispose(); m.dispose(); });
  }
  const types = SETS[key].dice;
  const spacing = 2.2;
  dice = types.map((type, i) => {
    const die = buildDie(type, renderer);
    const group = new THREE.Group();
    group.add(die.mesh);
    scene.add(group);
    const homeX = (i - (types.length - 1) / 2) * spacing;
    const pose = restingPose(die, homeX);
    group.position.copy(pose.pos);
    group.quaternion.copy(pose.quat);
    const radius = Math.max(...die.faces.flatMap((f) => f.verts.map((v) => v.length())));
    return { die, group, homeX, radius, angVel: new THREE.Vector3(), settle: null, spawnT: 0 };
  });
  state = 'idle';
  resultEl.classList.remove('show');
  for (const b of picker.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.type === key));
}

function startShake(strength = 1) {
  if (state !== 'shaking') {
    state = 'shaking';
    resultEl.classList.remove('show');
    for (const d of dice) {
      d.angVel.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize().multiplyScalar(14);
      d.settle = null;
    }
  }
  intensity = THREE.MathUtils.clamp(strength, 0.6, 1.6);
  lastShake = performance.now();
}

function startSettle() {
  state = 'settling';
  const now = performance.now();
  dice.forEach((d, i) => {
    const pose = restingPose(d.die, d.homeX);
    d.settle = {
      t0: now,
      dur: 1300 + i * 180 + rand(0, 150),
      fromQ: d.group.quaternion.clone(),
      fromP: d.group.position.clone(),
      vel: d.angVel.clone(),
      ...pose,
      done: false,
    };
  });
}

function finishRoll() {
  state = 'idle';
  const set = SETS[setKey];
  const values = dice.map((d) => d.settle.value);
  const total = set.total ? set.total(values) : values.join(' + ');
  const detail = set.detail ? set.detail(values) : '';
  resultEl.innerHTML = `<span class="total">${total}</span>${detail ? `<span class="detail">${detail}</span>` : ''}`;
  resultEl.classList.add('show');
  navigator.vibrate?.(25);
  history.unshift({ label: set.label, value: total });
  history.length = Math.min(history.length, 12);
  historyEl.innerHTML = history
    .map((h, i) => `<li class="${i === 0 ? 'latest' : ''}"><span>${h.label}</span>${h.value}</li>`)
    .join('');
}

// ---------- Animation ----------
const easeInOut = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const easeOut = (x) => 1 - Math.pow(1 - x, 3);
const tmpQ = new THREE.Quaternion();
const axis = new THREE.Vector3();
const target = new THREE.Vector3();
let prev = performance.now();

function frame() {
  const now = performance.now();
  const dt = Math.min((now - prev) / 1000, 0.05);
  prev = now;

  for (const d of dice) {
    if (d.spawnT < 1) {
      d.spawnT = Math.min(1, d.spawnT + dt * 3);
      d.group.scale.setScalar(0.3 + 0.7 * easeOut(d.spawnT) + Math.sin(d.spawnT * Math.PI) * 0.08);
    }

    if (state === 'shaking') {
      // Tumble in the air above the table, as if rattling in a cupped hand.
      d.angVel.x += rand(-30, 30) * dt;
      d.angVel.y += rand(-30, 30) * dt;
      d.angVel.z += rand(-30, 30) * dt;
      d.angVel.setLength(THREE.MathUtils.lerp(d.angVel.length(), 10 + 10 * intensity, 0.1));
      const speed = d.angVel.length();
      d.group.quaternion.premultiply(tmpQ.setFromAxisAngle(axis.copy(d.angVel).divideScalar(speed), speed * dt));
      const j = 0.2 * intensity;
      target.set(d.homeX * 0.75 + rand(-j, j), 1.6 + rand(-j, j), 0.3 + rand(-j, j));
      d.group.position.lerp(target, 0.35);
    } else if (state === 'settling' && !d.settle.done) {
      const s = d.settle;
      const t = Math.min((now - s.t0) / s.dur, 1);
      // Free spin that slows down, blended toward the resting orientation.
      const elapsed = (t * s.dur) / 1000;
      const speed = s.vel.length();
      const angle = speed * 0.35 * (1 - Math.exp(-elapsed / 0.35));
      d.group.quaternion.copy(s.fromQ);
      if (speed > 0) d.group.quaternion.premultiply(tmpQ.setFromAxisAngle(axis.copy(s.vel).divideScalar(speed), angle));
      const k = easeInOut(t);
      d.group.quaternion.slerp(s.quat, k);
      // Fall onto the table, bounce a few times, slide into place.
      const bounce = Math.abs(Math.cos(t * Math.PI * 2.6)) * Math.pow(1 - t, 2.2);
      const clearance = (d.radius - s.pos.y) * (1 - k); // keep corners above the table while still tilted
      const h = easeOut(t);
      d.group.position.set(
        THREE.MathUtils.lerp(s.fromP.x, s.pos.x, h),
        s.pos.y + clearance + (s.fromP.y - s.pos.y) * bounce,
        THREE.MathUtils.lerp(s.fromP.z, s.pos.z, h),
      );
      if (t >= 1) {
        d.group.quaternion.copy(s.quat);
        d.group.position.copy(s.pos);
        s.done = true;
      }
    }
  }

  if (state === 'shaking' && now - lastShake > 380) startSettle();
  if (state === 'settling' && dice.every((d) => d.settle.done)) finishRoll();

  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

// ---------- Input ----------
function roll() {
  startShake(1);
  lastShake = performance.now() + 450; // tumble a little before settling
}
rollBtn.addEventListener('click', roll);
stage.addEventListener('click', roll);
document.addEventListener('keydown', (e) => {
  if ((e.code === 'Space' || e.code === 'Enter') && e.target === document.body) { e.preventDefault(); roll(); }
});

picker.innerHTML = Object.entries(SETS)
  .map(([k, s]) => `<button type="button" data-type="${k}" aria-pressed="false">${s.label}</button>`)
  .join('');
picker.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (b) setDice(b.dataset.type);
});

// Shake detection.
const gravity = new THREE.Vector3();
let gravityInit = false;
function onMotion(e) {
  let mag = null;
  const a = e.acceleration;
  if (a && a.x != null) {
    mag = Math.hypot(a.x, a.y, a.z);
  } else if (e.accelerationIncludingGravity?.x != null) {
    const g = e.accelerationIncludingGravity;
    if (!gravityInit) { gravity.set(g.x, g.y, g.z); gravityInit = true; }
    gravity.lerp(new THREE.Vector3(g.x, g.y, g.z), 0.1);
    mag = Math.hypot(g.x - gravity.x, g.y - gravity.y, g.z - gravity.z);
  }
  if (mag == null) return;
  hintEl.hidden = false;
  if (mag > 11) startShake(mag / 18);
}

const touchDevice = matchMedia('(pointer: coarse)').matches;
if (touchDevice && typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
  motionBtn.hidden = false;
  motionBtn.addEventListener('click', async () => {
    try {
      if ((await DeviceMotionEvent.requestPermission()) === 'granted') {
        window.addEventListener('devicemotion', onMotion);
        motionBtn.hidden = true;
      }
    } catch { /* user dismissed */ }
  });
} else if ('DeviceMotionEvent' in window) {
  window.addEventListener('devicemotion', onMotion);
}

// ---------- Go ----------
setDice(setKey);
resize();
requestAnimationFrame(frame);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
