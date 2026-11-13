import * as THREE from '../vendor/three.module.min.js';
import { DICE, buildDie } from './dice.js';

const $ = (s) => document.querySelector(s);
const stage = $('#stage');
const resultEl = $('#result');
const historyEl = $('#history');
const rollBtn = $('#roll');
const motionBtn = $('#enable-motion');
const hintEl = $('#hint');
const picker = $('#picker');

// ---------- Scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
stage.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
camera.position.set(0, 2.2, 6.2);
camera.lookAt(0, 0, 0);

scene.add(new THREE.HemisphereLight(0xffffff, 0x445066, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.position.set(2.5, 6, 4);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.camera.left = sun.shadow.camera.bottom = -3;
sun.shadow.camera.right = sun.shadow.camera.top = 3;
sun.shadow.radius = 6;
scene.add(sun);

const floorY = -1.45;
const floor = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), new THREE.ShadowMaterial({ opacity: 0.28 }));
floor.rotation.x = -Math.PI / 2;
floor.position.y = floorY;
floor.receiveShadow = true;
scene.add(floor);

const holder = new THREE.Group();
scene.add(holder);

function resize() {
  const { clientWidth: w, clientHeight: h } = stage;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  // Keep the die comfortably in view on narrow screens.
  const minHorizontal = THREE.MathUtils.degToRad(30);
  camera.fov = Math.max(38, THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(minHorizontal / 2) / (w / h))));
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(stage);

// ---------- Orientation helpers ----------
const camN = camera.position.clone().normalize();
const camRight = new THREE.Vector3(0, 1, 0).cross(camN).normalize();
const camUp = new THREE.Vector3().crossVectors(camN, camRight).normalize();
const camBasis = new THREE.Matrix4().makeBasis(camRight, camUp, camN);
const tilt = new THREE.Quaternion()
  .setFromAxisAngle(camUp, -0.32)
  .multiply(new THREE.Quaternion().setFromAxisAngle(camRight, 0.2));

/** Quaternion that turns `face` toward the camera with its number upright. */
function faceQuaternion(face) {
  const faceBasis = new THREE.Matrix4().makeBasis(face.right, face.up, face.normal);
  const m = camBasis.clone().multiply(faceBasis.transpose());
  return tilt.clone().multiply(new THREE.Quaternion().setFromRotationMatrix(m));
}

function randomInt(n) {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0] % n;
}

// ---------- Die state ----------
let die = null;
let type = 'd20';
let state = 'idle'; // idle | shaking | settling
const angVel = new THREE.Vector3();
let intensity = 1;
let lastShake = 0;
let settle = null;
let spawnT = 1;
const history = [];

try { const saved = localStorage.getItem('dice-type'); if (saved && DICE[saved]) type = saved; } catch {}
const fromUrl = new URLSearchParams(location.search).get('die');
if (fromUrl && DICE[fromUrl]) type = fromUrl;

function setDie(t) {
  type = t;
  try { localStorage.setItem('dice-type', t); } catch {}
  if (die) {
    holder.remove(die.mesh);
    die.mesh.geometry.dispose();
    die.mesh.material.forEach((m) => { m.map.dispose(); m.dispose(); });
  }
  die = buildDie(t, renderer);
  holder.add(die.mesh);
  holder.quaternion.copy(faceQuaternion(die.faces[randomInt(die.faces.length)]));
  holder.position.set(0, 0, 0);
  state = 'idle';
  spawnT = 0;
  resultEl.textContent = '';
  resultEl.classList.remove('show');
  for (const b of picker.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.type === t));
}

function startShake(strength = 1) {
  if (state !== 'shaking') {
    state = 'shaking';
    resultEl.classList.remove('show');
    angVel.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar(14);
  }
  intensity = Math.min(Math.max(strength, 0.6), 1.6);
  lastShake = performance.now();
}

function startSettle() {
  const index = randomInt(die.faces.length);
  state = 'settling';
  settle = {
    t0: performance.now(),
    dur: 1500,
    from: holder.quaternion.clone(),
    vel: angVel.clone(),
    to: faceQuaternion(die.faces[index]),
    pos: holder.position.clone(),
    face: die.faces[index],
  };
}

function finishRoll(face) {
  state = 'idle';
  resultEl.textContent = face.value;
  resultEl.classList.add('show');
  navigator.vibrate?.(25);
  history.unshift({ label: die.def.label, value: face.value });
  history.length = Math.min(history.length, 12);
  historyEl.innerHTML = history
    .map((h, i) => `<li class="${i === 0 ? 'latest' : ''}"><span>${h.label}</span>${h.value}</li>`)
    .join('');
}

// ---------- Animation ----------
const easeInOut = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const tmpQ = new THREE.Quaternion();
const axis = new THREE.Vector3();
let prev = performance.now();

function rotateBy(q, vel, dt) {
  const speed = vel.length();
  if (speed < 1e-6) return q;
  tmpQ.setFromAxisAngle(axis.copy(vel).divideScalar(speed), speed * dt);
  return q.premultiply(tmpQ);
}

function frame() {
  const now = performance.now();
  const dt = Math.min((now - prev) / 1000, 0.05);
  prev = now;

  if (spawnT < 1) {
    spawnT = Math.min(1, spawnT + dt * 3);
    const s = 1 - Math.pow(1 - spawnT, 3);
    holder.scale.setScalar(0.3 + 0.7 * s + Math.sin(spawnT * Math.PI) * 0.08);
  }

  if (state === 'shaking') {
    // Random tumbling: wobble the angular velocity, jitter the position.
    angVel.x += (Math.random() - 0.5) * 60 * dt;
    angVel.y += (Math.random() - 0.5) * 60 * dt;
    angVel.z += (Math.random() - 0.5) * 60 * dt;
    angVel.setLength(THREE.MathUtils.lerp(angVel.length(), 10 + 10 * intensity, 0.1));
    rotateBy(holder.quaternion, angVel, dt);
    const j = 0.18 * intensity;
    holder.position.lerp(new THREE.Vector3((Math.random() - 0.5) * j * 2, 0.35 + (Math.random() - 0.5) * j * 2, (Math.random() - 0.5) * j), 0.5);
    if (now - lastShake > 380) startSettle();
  } else if (state === 'settling') {
    const t = Math.min((now - settle.t0) / settle.dur, 1);
    // Free spin that slows down, blended toward the final resting orientation.
    const tau = 0.35;
    const elapsed = t * settle.dur / 1000;
    const angle = settle.vel.length() * tau * (1 - Math.exp(-elapsed / tau));
    const spun = settle.from.clone();
    if (settle.vel.length() > 0) spun.premultiply(tmpQ.setFromAxisAngle(axis.copy(settle.vel).normalize(), angle));
    holder.quaternion.copy(spun).slerp(settle.to, easeInOut(t));
    // Drop and bounce.
    const bounce = Math.abs(Math.cos(t * Math.PI * 3.2)) * Math.pow(1 - t, 2) * 0.6;
    holder.position.set(settle.pos.x * (1 - t), bounce, settle.pos.z * (1 - t));
    if (t >= 1) finishRoll(settle.face);
  } else {
    holder.position.y = THREE.MathUtils.lerp(holder.position.y, Math.sin(now / 900) * 0.05, 0.1);
  }

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

picker.innerHTML = Object.entries(DICE)
  .map(([k, d]) => `<button type="button" data-type="${k}" aria-pressed="false">${d.label}</button>`)
  .join('');
picker.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (b) setDie(b.dataset.type);
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

function listenMotion() {
  window.addEventListener('devicemotion', onMotion);
}

const touchDevice = matchMedia('(pointer: coarse)').matches;
if (touchDevice && typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
  motionBtn.hidden = false;
  motionBtn.addEventListener('click', async () => {
    try {
      if ((await DeviceMotionEvent.requestPermission()) === 'granted') {
        listenMotion();
        motionBtn.hidden = true;
      }
    } catch { /* user dismissed */ }
  });
} else if ('DeviceMotionEvent' in window) {
  listenMotion();
}

// ---------- Go ----------
setDie(type);
resize();
requestAnimationFrame(frame);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
