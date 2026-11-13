import * as THREE from '../vendor/three.module.min.js';
import * as CANNON from '../vendor/cannon-es.js';
import { SETS, THEMES, buildDie } from './dice.js';
import { unlockAudio, setSoundEnabled, playHit, playQuack } from './sound.js';

const $ = (s) => document.querySelector(s);
const stage = $('#stage');
const resultEl = $('#result');
const historyEl = $('#history');
const rollBtn = $('#roll');
const motionBtn = $('#enable-motion');
const hintEl = $('#hint');
const picker = $('#picker');
const soundBtn = $('#sound-btn');
const themeBtn = $('#theme-btn');

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
};

// ---------- Scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
stage.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color();
scene.fog = new THREE.Fog(0x000000, 9, 18);

const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
camera.position.set(0, 6.6, 5.4);
const lookAt = new THREE.Vector3(0, 0.2, 0.15);
camera.lookAt(lookAt);

scene.add(new THREE.HemisphereLight(0xffffff, 0x3a4560, 1.4));
const sun = new THREE.DirectionalLight(0xffffff, 2.4);
sun.position.set(2.5, 8, 3.5);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = sun.shadow.camera.bottom = -5;
sun.shadow.camera.right = sun.shadow.camera.top = 5;
sun.shadow.radius = 5;
scene.add(sun);

const table = new THREE.Mesh(
  new THREE.CircleGeometry(14, 64),
  new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0 }),
);
table.rotation.x = -Math.PI / 2;
table.receiveShadow = true;
scene.add(table);

// ---------- Physics ----------
const GRAVITY = -32; // dice are ~1 unit across; stronger gravity keeps the motion snappy
const world = new CANNON.World({ gravity: new CANNON.Vec3(0, GRAVITY, 0) });
world.allowSleep = true;
world.broadphase = new CANNON.NaiveBroadphase();
world.solver.iterations = 14;

const diceMat = new CANNON.Material('dice');
const tableMat = new CANNON.Material('table');
const wallMat = new CANNON.Material('wall');
world.addContactMaterial(new CANNON.ContactMaterial(diceMat, tableMat, { friction: 0.35, restitution: 0.35 }));
world.addContactMaterial(new CANNON.ContactMaterial(diceMat, diceMat, { friction: 0.2, restitution: 0.45 }));
world.addContactMaterial(new CANNON.ContactMaterial(diceMat, wallMat, { friction: 0.1, restitution: 0.6 }));

const floorBody = new CANNON.Body({ mass: 0, material: tableMat, shape: new CANNON.Plane() });
floorBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
world.addBody(floorBody);

// Invisible walls at the edges of what the camera sees, so dice never roll out of view.
const walls = [
  [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1],
].map(([x, y, z]) => {
  const b = new CANNON.Body({ mass: 0, material: wallMat, shape: new CANNON.Plane() });
  // A cannon Plane faces +z; turn it to face inward along (x, z).
  b.quaternion.setFromVectors(new CANNON.Vec3(0, 0, 1), new CANNON.Vec3(x, y, z));
  world.addBody(b);
  return { body: b, dir: new THREE.Vector3(x, y, z) };
});
let bounds = { x: 2.2, zNear: 2, zFar: -2 };

function groundPoint(ndcX, ndcY) {
  const ray = new THREE.Raycaster();
  ray.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);
  const p = new THREE.Vector3();
  return ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), p) ? p : null;
}

function resize() {
  const { clientWidth: w, clientHeight: h } = stage;
  if (!w || !h) return;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  const minHorizontal = THREE.MathUtils.degToRad(36);
  camera.fov = Math.max(36, THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(minHorizontal / 2) / (w / h))));
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  // Fit the walls to the visible part of the table (with a margin for the dice size).
  const near = groundPoint(0.92, -0.92), far = groundPoint(0, 0.75), nearMid = groundPoint(0, -0.92);
  bounds = {
    x: Math.max(1.6, Math.abs(near?.x ?? 2.2) - 0.15),
    zNear: (nearMid?.z ?? 2.5) - 0.3,
    zFar: Math.max(-4, (far?.z ?? -2.5) + 0.3),
  };
  walls[0].body.position.set(-bounds.x, 0, 0);
  walls[1].body.position.set(bounds.x, 0, 0);
  walls[2].body.position.set(0, 0, bounds.zFar);
  walls[3].body.position.set(0, 0, bounds.zNear);
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

/** Readable resting orientation used when dice first appear (before any roll). */
function displayPose(die) {
  let m;
  if (die.vertices) {
    const v = die.vertices[randomInt(die.vertices.length)];
    const a = v.pos.clone().normalize();
    const f = die.faces.find((face) => face.verts.some((p) => p.distanceTo(v.pos) < 1e-4));
    const b = f.normal.clone().addScaledVector(a, -f.normal.dot(a)).normalize();
    m = new THREE.Matrix4().makeBasis(new THREE.Vector3().crossVectors(a, b), a, b).transpose();
  } else {
    const f = die.faces[randomInt(die.faces.length)];
    m = new THREE.Matrix4().makeBasis(X, NEG_Z, Y)
      .multiply(new THREE.Matrix4().makeBasis(f.right, f.up, f.normal).transpose());
  }
  const quat = new THREE.Quaternion().setFromAxisAngle(Y, rand(-0.3, 0.3))
    .multiply(new THREE.Quaternion().setFromRotationMatrix(m));
  let minY = Infinity;
  const p = new THREE.Vector3();
  for (const f of die.faces) for (const v of f.verts) minY = Math.min(minY, p.copy(v).applyQuaternion(quat).y);
  return { quat, y: -minY };
}

/** Which value is on top: the face pointing most upward, or for a D4 the highest vertex. */
function readTop(d) {
  const q = d.group.quaternion;
  const v = new THREE.Vector3();
  if (d.die.vertices) {
    let best = null, bestY = -Infinity;
    for (const vert of d.die.vertices) {
      const y = v.copy(vert.pos).normalize().applyQuaternion(q).y;
      if (y > bestY) { bestY = y; best = vert; }
    }
    return { value: best.value, flat: bestY > 0.97 };
  }
  let best = null, bestY = -Infinity;
  for (const f of d.die.faces) {
    const y = v.copy(f.normal).applyQuaternion(q).y;
    if (y > bestY) { bestY = y; best = f; }
  }
  return { value: best.value, flat: bestY > 0.97 };
}

function makeBody(die) {
  const verts = [];
  const index = (p) => {
    let i = verts.findIndex((q) => q.distanceTo(p) < 1e-4);
    if (i < 0) { verts.push(p); i = verts.length - 1; }
    return i;
  };
  const faces = die.faces.map((f) => f.verts.map(index));
  const shape = new CANNON.ConvexPolyhedron({
    vertices: verts.map((p) => new CANNON.Vec3(p.x, p.y, p.z)),
    faces,
  });
  const body = new CANNON.Body({
    mass: 1,
    material: diceMat,
    shape,
    linearDamping: 0.12,
    angularDamping: 0.12,
    allowSleep: true,
    sleepSpeedLimit: 0.12,
    sleepTimeLimit: 0.25,
  });
  return body;
}

// ---------- State ----------
let setKey = SETS[store.get('dice-type')] ? store.get('dice-type') : 'd20';
const fromUrl = new URLSearchParams(location.search).get('die');
if (fromUrl && SETS[fromUrl]) setKey = fromUrl;
let themeKey = THEMES[store.get('dice-theme')] ? store.get('dice-theme') : 'classic';
let soundOn = store.get('dice-sound') !== 'off';
setSoundEnabled(soundOn);

let dice = []; // { die, group, body, homeX, radius, spawnT, lastSound }
let state = 'idle'; // idle | shaking | rolling
let intensity = 1;
let lastShake = 0;
let rollStart = 0;
let nudges = 0;
const history = [];

function applyTheme() {
  const t = THEMES[themeKey];
  scene.background.set(t.bg);
  scene.fog.color.set(t.bg);
  table.material.color.set(t.table);
  document.documentElement.dataset.theme = themeKey;
  document.querySelector('meta[name="theme-color"]').setAttribute('content', t.pageBg);
  themeBtn.setAttribute('aria-pressed', String(themeKey === 'ducks'));
}

function setDice(key) {
  setKey = key;
  store.set('dice-type', key);
  for (const d of dice) {
    scene.remove(d.group);
    world.removeBody(d.body);
    d.die.mesh.geometry.dispose();
    d.die.mesh.material.forEach((m) => { m.map.dispose(); m.dispose(); });
  }
  const types = SETS[key].dice;
  const spacing = 2.2;
  dice = types.map((type, i) => {
    const die = buildDie(type, renderer, THEMES[themeKey]);
    const group = new THREE.Group();
    group.add(die.mesh);
    scene.add(group);
    const homeX = (i - (types.length - 1) / 2) * spacing;
    const pose = displayPose(die);
    group.quaternion.copy(pose.quat);
    group.position.set(homeX + rand(-0.2, 0.2), pose.y, rand(-0.2, 0.2));
    const body = makeBody(die);
    body.position.set(group.position.x, group.position.y, group.position.z);
    body.quaternion.set(pose.quat.x, pose.quat.y, pose.quat.z, pose.quat.w);
    world.addBody(body);
    body.sleep();
    const radius = Math.max(...die.faces.flatMap((f) => f.verts.map((v) => v.length())));
    const d = { die, group, body, homeX, radius, spawnT: 0, lastSound: 0 };
    body.addEventListener('collide', (e) => onCollide(d, e));
    return d;
  });
  state = 'idle';
  resultEl.classList.remove('show');
  for (const b of picker.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.type === key));
}

function onCollide(d, e) {
  const now = performance.now();
  if (now - d.lastSound < 45) return;
  const v = Math.abs(e.contact.getImpactVelocityAlongNormal());
  if (v < 0.8) return;
  d.lastSound = now;
  const otherIsDie = dice.some((o) => o.body === e.body);
  // Small dice sound higher; die-on-die is a sharper click.
  const pitch = (1.25 - d.radius * 0.25) * (otherIsDie ? 1.5 : 1);
  playHit(Math.min(1, v / 9), pitch);
}

function startShake(strength = 1) {
  if (state !== 'shaking') {
    state = 'shaking';
    resultEl.classList.remove('show');
    for (const d of dice) {
      d.body.wakeUp();
      d.body.velocity.set(rand(-1, 1), 6, rand(-1, 1));
      d.body.angularVelocity.set(rand(-15, 15), rand(-15, 15), rand(-15, 15));
    }
  }
  intensity = THREE.MathUtils.clamp(strength, 0.6, 1.6);
  lastShake = performance.now();
}

function release() {
  state = 'rolling';
  rollStart = performance.now();
  nudges = 0;
  for (const d of dice) {
    const b = d.body;
    // Throw toward the middle of the table with plenty of spin.
    b.velocity.set(rand(-2.5, 2.5) - b.position.x * 0.8, rand(-6, -3), rand(-1.5, 1.5) - (b.position.z - 0.2) * 0.8);
    b.angularVelocity.set(rand(-20, 20), rand(-20, 20), rand(-20, 20));
  }
}

function finishRoll() {
  state = 'idle';
  const set = SETS[setKey];
  const values = dice.map((d) => readTop(d).value);
  const total = set.total ? set.total(values) : values.join(' + ');
  const detail = set.detail ? set.detail(values) : '';
  resultEl.innerHTML = `<span class="total">${total}</span>${detail ? `<span class="detail">${detail}</span>` : ''}`;
  resultEl.classList.add('show');
  navigator.vibrate?.(25);
  if (THEMES[themeKey].quack) playQuack();
  history.unshift({ label: set.label, value: total });
  history.length = Math.min(history.length, 12);
  historyEl.innerHTML = history
    .map((h, i) => `<li class="${i === 0 ? 'latest' : ''}"><span>${h.label}</span>${h.value}</li>`)
    .join('');
}

function checkSettled(now) {
  const resting = dice.every((d) => d.body.sleepState === CANNON.Body.SLEEPING);
  const timedOut = now - rollStart > 7000;
  if (!resting && !timedOut) return;
  // A die leaning on another die or a wall: give it a little shove and keep rolling.
  const cocked = dice.filter((d) => !readTop(d).flat);
  if (cocked.length && nudges < 4 && !timedOut) {
    nudges++;
    for (const d of cocked) {
      d.body.wakeUp();
      d.body.velocity.set(rand(-1, 1) - d.body.position.x * 0.5, 3, rand(-1, 1));
      d.body.angularVelocity.set(rand(-6, 6), rand(-6, 6), rand(-6, 6));
    }
    return;
  }
  finishRoll();
}

// ---------- Animation ----------
const easeOut = (x) => 1 - Math.pow(1 - x, 3);
const spring = new CANNON.Vec3();
let prev = performance.now();

function frame() {
  const now = performance.now();
  const dt = Math.min((now - prev) / 1000, 0.05);
  prev = now;

  if (state === 'shaking') {
    // Hold the dice in the air like a cupped hand: a spring toward a hover point plus random jolts.
    dice.forEach((d, i) => {
      const b = d.body;
      const tx = (i - (dice.length - 1) / 2) * 0.9;
      spring.set(
        (tx - b.position.x) * 60 - b.velocity.x * 6,
        (2.6 - b.position.y) * 60 - b.velocity.y * 6 - GRAVITY,
        (0.3 - b.position.z) * 60 - b.velocity.z * 6,
      );
      b.applyForce(spring);
      const j = 0.8 * intensity;
      b.applyImpulse(new CANNON.Vec3(rand(-j, j), rand(-j, j), rand(-j, j)));
      const w = b.angularVelocity;
      w.x += rand(-4, 4); w.y += rand(-4, 4); w.z += rand(-4, 4);
      const s = w.length(), max = 14 + 10 * intensity;
      if (s > max) w.scale(max / s, w);
    });
    if (now - lastShake > 380) release();
  }

  world.step(1 / 120, dt, 10);

  for (const d of dice) {
    d.group.position.set(d.body.position.x, d.body.position.y, d.body.position.z);
    d.group.quaternion.set(d.body.quaternion.x, d.body.quaternion.y, d.body.quaternion.z, d.body.quaternion.w);
    if (d.spawnT < 1) {
      d.spawnT = Math.min(1, d.spawnT + dt * 3);
      d.group.scale.setScalar(0.3 + 0.7 * easeOut(d.spawnT) + Math.sin(d.spawnT * Math.PI) * 0.08);
    }
  }

  if (state === 'rolling') checkSettled(now);

  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

// ---------- Input ----------
function roll() {
  unlockAudio();
  startShake(1);
  lastShake = performance.now() + 350; // rattle a moment before the throw
}
rollBtn.addEventListener('click', roll);
stage.addEventListener('click', roll);
document.addEventListener('keydown', (e) => {
  if ((e.code === 'Space' || e.code === 'Enter') && e.target === document.body) { e.preventDefault(); roll(); }
});
// Any touch unlocks audio, so shake-to-roll can make sound too.
for (const ev of ['pointerdown', 'touchend', 'click']) document.addEventListener(ev, unlockAudio, { passive: true });

picker.innerHTML = Object.entries(SETS)
  .map(([k, s]) => `<button type="button" data-type="${k}" aria-pressed="false">${s.label}</button>`)
  .join('');
picker.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (b) setDice(b.dataset.type);
});

function renderSoundBtn() {
  soundBtn.textContent = soundOn ? '🔊' : '🔇';
  soundBtn.setAttribute('aria-label', soundOn ? 'Mute sound' : 'Turn sound on');
}
soundBtn.addEventListener('click', () => {
  soundOn = !soundOn;
  store.set('dice-sound', soundOn ? 'on' : 'off');
  setSoundEnabled(soundOn);
  unlockAudio();
  renderSoundBtn();
});
themeBtn.addEventListener('click', () => {
  themeKey = themeKey === 'ducks' ? 'classic' : 'ducks';
  store.set('dice-theme', themeKey);
  applyTheme();
  setDice(setKey);
  unlockAudio();
  if (themeKey === 'ducks') playQuack();
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
    unlockAudio();
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
renderSoundBtn();
applyTheme();
resize();
setDice(setKey);
requestAnimationFrame(frame);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
