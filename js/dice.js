import * as THREE from '../vendor/three.module.min.js';

const range = (n, f) => Array.from({ length: n }, (_, i) => f(i));

export const DICE = {
  d4: { label: 'D4', values: range(4, (i) => String(i + 1)), color: '#e85d75', scale: 1.25, geometry: () => new THREE.TetrahedronGeometry(1) },
  d6: { label: 'D6', values: range(6, (i) => String(i + 1)), color: '#f4f1ea', ink: '#1d2333', scale: 0.95, geometry: () => new THREE.BoxGeometry(1, 1, 1) },
  d8: { label: 'D8', values: range(8, (i) => String(i + 1)), color: '#4c9be8', scale: 1.15, geometry: () => new THREE.OctahedronGeometry(1) },
  d10: { label: 'D10', values: range(10, (i) => String(i + 1)), color: '#43b581', scale: 1.1, custom: trapezohedronFaces },
  d12: { label: 'D12', values: range(12, (i) => String(i + 1)), color: '#9b6bdf', scale: 1.1, geometry: () => new THREE.DodecahedronGeometry(1) },
  d20: { label: 'D20', values: range(20, (i) => String(i + 1)), color: '#f0a33a', scale: 1.15, geometry: () => new THREE.IcosahedronGeometry(1) },
  d100: { label: 'D%', values: range(10, (i) => (i === 0 ? '00' : String(i * 10))), color: '#2f3b52', ink: '#f6d38a', scale: 1.1, custom: trapezohedronFaces },
};

/** Group the triangles of a three.js polyhedron into flat polygon faces. */
function facesFromGeometry(geom) {
  const g = geom.index ? geom.toNonIndexed() : geom;
  const pos = g.attributes.position;
  const faces = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let i = 0; i < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i);
    b.fromBufferAttribute(pos, i + 1);
    c.fromBufferAttribute(pos, i + 2);
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).normalize();
    let face = faces.find((f) => f.normal.dot(n) > 0.999);
    if (!face) faces.push((face = { normal: n, verts: [] }));
    for (const v of [a, b, c]) {
      if (!face.verts.some((w) => w.distanceTo(v) < 1e-4)) face.verts.push(v.clone());
    }
  }
  for (const f of faces) {
    const centroid = f.verts.reduce((s, v) => s.add(v), new THREE.Vector3()).divideScalar(f.verts.length);
    const u = new THREE.Vector3().subVectors(f.verts[0], centroid).normalize();
    const w = new THREE.Vector3().crossVectors(f.normal, u);
    f.verts.sort((p, q) => {
      const dp = p.clone().sub(centroid), dq = q.clone().sub(centroid);
      return Math.atan2(dp.dot(w), dp.dot(u)) - Math.atan2(dq.dot(w), dq.dot(u));
    });
    // Number "up" direction: towards an edge midpoint for squares, towards a vertex otherwise.
    const target = f.verts.length === 4 ? f.verts[0].clone().add(f.verts[1]).multiplyScalar(0.5) : f.verts[0];
    f.up = target.clone().sub(centroid);
  }
  return faces;
}

/** Pentagonal trapezohedron (the d10 shape). Kite faces, apex listed first. */
function trapezohedronFaces() {
  const a = 0.105;
  const cos36 = Math.cos(Math.PI / 5);
  const h = (a * (1 + cos36)) / (1 - cos36);
  const top = new THREE.Vector3(0, h, 0), bottom = new THREE.Vector3(0, -h, 0);
  const ring = range(10, (k) => {
    const ang = (k * Math.PI) / 5;
    return new THREE.Vector3(Math.cos(ang), k % 2 === 0 ? a : -a, Math.sin(ang));
  });
  const faces = [];
  for (let i = 0; i < 5; i++) {
    const u0 = ring[2 * i], l = ring[2 * i + 1], u1 = ring[(2 * i + 2) % 10];
    faces.push({ verts: [top, u1, l, u0] });
    const l0 = ring[2 * i + 1], up = ring[(2 * i + 2) % 10], l1 = ring[(2 * i + 3) % 10];
    faces.push({ verts: [bottom, l0, up, l1] });
  }
  for (const f of faces) {
    const v = f.verts.map((p) => p.clone());
    const n = new THREE.Vector3().subVectors(v[1], v[0]).cross(new THREE.Vector3().subVectors(v[2], v[0])).normalize();
    const centroid = v.reduce((s, p) => s.add(p), new THREE.Vector3()).divideScalar(4);
    if (n.dot(centroid) < 0) { n.negate(); v.reverse(); v.unshift(v.pop()); }
    f.verts = v;
    f.normal = n;
    f.up = v[0].clone().sub(centroid);
  }
  // Normalise so the shape is about as big as the others.
  const max = Math.max(...faces.flatMap((f) => f.verts.map((p) => p.length())));
  for (const f of faces) f.verts = f.verts.map((p) => p.multiplyScalar(1 / max));
  return faces;
}

function makeLabelTexture(text, { color, ink, fontPx }, renderer) {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = ink;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `700 ${fontPx}px "Segoe UI", Roboto, Helvetica, Arial, sans-serif`;
  ctx.fillText(text, size / 2, size / 2 + fontPx * 0.04);
  if (text === '6' || text === '9') {
    const w = ctx.measureText(text).width;
    ctx.fillRect(size / 2 - w / 2, size / 2 + fontPx * 0.42, w, Math.max(3, fontPx * 0.07));
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return tex;
}

function isDark(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return 0.299 * r + 0.587 * g + 0.114 * b < 150;
}

/** Assign values so that opposite faces sum to N+1 (like real dice) where possible. */
function assignValues(faces, values) {
  const n = faces.length;
  const pairs = [];
  const used = new Set();
  faces.forEach((f, i) => {
    if (used.has(i)) return;
    const j = faces.findIndex((g, k) => !used.has(k) && k !== i && g.normal.dot(f.normal) < -0.999);
    if (j < 0) return;
    used.add(i); used.add(j);
    pairs.push([i, j]);
  });
  if (pairs.length * 2 !== n) {
    faces.forEach((f, i) => (f.value = values[i]));
    return;
  }
  pairs.forEach(([i, j], k) => {
    faces[i].value = values[k];
    faces[j].value = values[n - 1 - k];
  });
}

export function buildDie(type, renderer) {
  const def = DICE[type];
  const faces = def.custom ? def.custom() : facesFromGeometry(def.geometry());
  assignValues(faces, def.values);

  // Normalise size.
  const max = Math.max(...faces.flatMap((f) => f.verts.map((p) => p.length())));
  for (const f of faces) {
    f.verts = f.verts.map((p) => p.clone().multiplyScalar(def.scale / max));
    f.centroid = f.verts.reduce((s, p) => s.add(p), new THREE.Vector3()).divideScalar(f.verts.length);
    f.up.normalize();
    f.right = new THREE.Vector3().crossVectors(f.up, f.normal).normalize();
    f.up = new THREE.Vector3().crossVectors(f.normal, f.right).normalize();
    f.radius = Math.max(...f.verts.map((p) => p.distanceTo(f.centroid)));
    // Inradius-ish: distance from centroid to the closest edge.
    f.inradius = Math.min(...f.verts.map((p, i) => {
      const q = f.verts[(i + 1) % f.verts.length];
      const e = q.clone().sub(p);
      const t = THREE.MathUtils.clamp(f.centroid.clone().sub(p).dot(e) / e.lengthSq(), 0, 1);
      return p.clone().addScaledVector(e, t).distanceTo(f.centroid);
    }));
  }

  const R = Math.max(...faces.map((f) => f.radius));
  const positions = [], normals = [], uvs = [];
  const geom = new THREE.BufferGeometry();
  const ink = def.ink || (isDark(def.color) ? '#ffffff' : '#1d2333');
  const materials = [];
  const longest = Math.max(...def.values.map((v) => v.length));

  faces.forEach((f, fi) => {
    const start = positions.length / 3;
    const uv = (p) => {
      const d = p.clone().sub(f.centroid);
      return [0.5 + d.dot(f.right) / (2 * R), 0.5 + d.dot(f.up) / (2 * R)];
    };
    for (let k = 1; k < f.verts.length - 1; k++) {
      for (const p of [f.verts[0], f.verts[k], f.verts[k + 1]]) {
        positions.push(p.x, p.y, p.z);
        normals.push(f.normal.x, f.normal.y, f.normal.z);
        uvs.push(...uv(p));
      }
    }
    geom.addGroup(start, positions.length / 3 - start, fi);
    const pxPerUnit = 256 / (2 * R);
    const fontPx = Math.min(f.inradius * 1.35, (f.inradius * 1.9) / (0.62 * longest)) * pxPerUnit;
    materials.push(new THREE.MeshStandardMaterial({
      map: makeLabelTexture(f.value, { color: def.color, ink, fontPx }, renderer),
      roughness: 0.38,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
      metalness: 0.05,
    }));
  });

  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geom.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geom.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));

  const mesh = new THREE.Mesh(geom, materials);
  mesh.castShadow = true;
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(geom, 5),
    new THREE.LineBasicMaterial({ color: isDark(def.color) ? 0x000000 : 0x5a4a3a, transparent: true, opacity: 0.35 }),
  );
  mesh.add(edges);

  return { mesh, faces, def };
}
