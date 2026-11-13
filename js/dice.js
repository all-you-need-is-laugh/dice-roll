import * as THREE from '../vendor/three.module.min.js';

const range = (n, f) => Array.from({ length: n }, (_, i) => f(i));

export const DICE = {
  d4: { label: 'D4', values: range(4, (i) => String(i + 1)), color: '#e85d75', scale: 1.3, vertexLabels: true, geometry: () => new THREE.TetrahedronGeometry(1) },
  d6: { label: 'D6', values: range(6, (i) => String(i + 1)), color: '#f4f1ea', ink: '#1d2333', scale: 0.95, geometry: () => new THREE.BoxGeometry(1, 1, 1) },
  d8: { label: 'D8', values: range(8, (i) => String(i + 1)), color: '#4c9be8', scale: 1.15, geometry: () => new THREE.OctahedronGeometry(1) },
  d10: { label: 'D10', values: range(10, (i) => String(i + 1)), color: '#43b581', scale: 1.1, custom: trapezohedronFaces },
  d12: { label: 'D12', values: range(12, (i) => String(i + 1)), color: '#9b6bdf', scale: 1.1, geometry: () => new THREE.DodecahedronGeometry(1) },
  d20: { label: 'D20', values: range(20, (i) => String(i + 1)), color: '#f0a33a', scale: 1.15, geometry: () => new THREE.IcosahedronGeometry(1) },
  d100: { label: 'Tens', values: range(10, (i) => (i === 0 ? '00' : String(i * 10))), color: '#2f3b52', ink: '#f6d38a', scale: 1.1, custom: trapezohedronFaces },
  d10ones: { label: 'Ones', values: range(10, (i) => String(i)), color: '#f6d38a', ink: '#2f3b52', scale: 1.1, custom: trapezohedronFaces },
};

/** Visual themes: scene colours plus optional per-die colour overrides. */
export const THEMES = {
  classic: { label: 'Classic', bg: 0x151a27, table: 0x24304a, pageBg: '#151a27', accent: '#f0a33a' },
  ducks: {
    label: 'Ducks',
    bg: 0x0d4a68,
    table: 0x2e8bb8,
    pageBg: '#0d4a68',
    accent: '#ffd43b',
    duck: true,
    quack: true,
    colors: (type) => (type === 'd10ones'
      ? { color: '#ff9f1c', ink: '#ffffff', duckInk: '#c25e00' }
      : { color: '#ffd43b', ink: '#d9480f', duckInk: '#e0a800' }),
  },
};

/** What the picker offers: each entry is the set of dice thrown together. */
export const SETS = {
  d4: { label: 'D4', dice: ['d4'] },
  d6: { label: 'D6', dice: ['d6'] },
  d8: { label: 'D8', dice: ['d8'] },
  d10: { label: 'D10', dice: ['d10'] },
  d12: { label: 'D12', dice: ['d12'] },
  d20: { label: 'D20', dice: ['d20'] },
  d100: {
    label: 'D%',
    dice: ['d100', 'd10ones'],
    // 00 + 0 counts as 100.
    total: ([tens, ones]) => Number(tens) + Number(ones) || 100,
    detail: ([tens, ones]) => `${tens} + ${ones}`,
  },
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

/** A small rubber-duck silhouette centred on (0, 0), roughly `s` wide. */
function drawDuck(ctx, s, body) {
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.ellipse(-0.05 * s, 0.14 * s, 0.42 * s, 0.24 * s, 0, 0, Math.PI * 2); // body
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-0.38 * s, 0.05 * s); // tail
  ctx.lineTo(-0.55 * s, -0.16 * s);
  ctx.lineTo(-0.2 * s, -0.02 * s);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(0.2 * s, -0.2 * s, 0.19 * s, 0, Math.PI * 2); // head
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(0.42 * s, -0.16 * s, 0.13 * s, 0.06 * s, 0.15, 0, Math.PI * 2); // beak
  ctx.fill();
}

function makeLabelTexture(labels, color, ink, renderer, duck) {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, size, size);
  if (duck) {
    ctx.save();
    ctx.translate(duck.x, duck.y);
    ctx.globalAlpha = 0.55;
    drawDuck(ctx, duck.size, duck.ink);
    ctx.restore();
  }
  ctx.fillStyle = ink;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const { text, x, y, rot, fontPx } of labels) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.font = `700 ${fontPx}px "Segoe UI", Roboto, Helvetica, Arial, sans-serif`;
    ctx.fillText(text, 0, fontPx * 0.04);
    if (text === '6' || text === '9') {
      const w = ctx.measureText(text).width;
      ctx.fillRect(-w / 2, fontPx * 0.42, w, Math.max(3, fontPx * 0.07));
    }
    ctx.restore();
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

export function buildDie(type, renderer, theme = THEMES.classic) {
  const def = DICE[type];
  const colors = theme.colors?.(type) ?? { color: def.color, ink: def.ink };
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

  let vertices = null;
  if (def.vertexLabels) {
    vertices = [];
    for (const p of faces.flatMap((f) => f.verts)) {
      if (!vertices.some((v) => v.pos.distanceTo(p) < 1e-4)) vertices.push({ pos: p.clone() });
    }
    vertices.forEach((v, i) => (v.value = def.values[i]));
  }

  const R = Math.max(...faces.map((f) => f.radius));
  const positions = [], normals = [], uvs = [];
  const geom = new THREE.BufferGeometry();
  const ink = colors.ink || (isDark(colors.color) ? '#ffffff' : '#1d2333');
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
    let labels;
    if (vertices) {
      // D4 style: each corner carries the value of that vertex, its top pointing at the vertex.
      labels = f.verts.map((p) => {
        const d = p.clone().sub(f.centroid);
        const x = d.dot(f.right), y = d.dot(f.up);
        return {
          text: vertices.find((v) => v.pos.distanceTo(p) < 1e-4).value,
          x: 128 + x * 0.47 * pxPerUnit,
          y: 128 - y * 0.47 * pxPerUnit,
          rot: Math.atan2(x, y),
          fontPx: f.inradius * 0.72 * pxPerUnit,
        };
      });
    } else {
      const fontPx = Math.min(f.inradius * 1.35, (f.inradius * 1.9) / (0.62 * longest)) * pxPerUnit;
      labels = [{ text: f.value, x: 128, y: 128, rot: 0, fontPx }];
    }
    materials.push(new THREE.MeshStandardMaterial({
      map: makeLabelTexture(labels, colors.color, ink, renderer, theme.duck && {
        x: 128,
        y: 128 + (vertices ? 0 : f.inradius * 0.08 * pxPerUnit),
        size: f.inradius * (vertices ? 0.9 : 1.75) * pxPerUnit,
        ink: colors.duckInk,
      }),
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
    new THREE.LineBasicMaterial({ color: isDark(colors.color) ? 0x000000 : 0x5a4a3a, transparent: true, opacity: 0.35 }),
  );
  mesh.add(edges);

  return { mesh, faces, vertices, def };
}
