// The Agent Café — live 3D view of agent states. Plain ES module, no build step.
// All remote strings are rendered with textContent only.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

/* ------------------------------------------------------------------ config */
const STATES = {
  thinking:    { label: 'Thinking',           color: '#A78BFA', word: 'thinking',      desc: 'Working out what to do next' },
  reading:     { label: 'Reading files',      color: '#60A5FA', word: 'reading',       desc: 'Looking through files to get the picture' },
  writing:     { label: 'Writing code',       color: '#34D399', word: 'writing',       desc: 'Making changes to code' },
  running:     { label: 'Running a command',  color: '#FBBF24', word: 'running',       desc: 'Running a command and watching what happens' },
  researching: { label: 'Researching',        color: '#22D3EE', word: 'researching',   desc: 'Looking things up' },
  delegating:  { label: 'Handing off work',   color: '#F472B6', word: 'collaborating', desc: 'Passing part of the job to a helper' },
  computer:    { label: 'Using the computer', color: '#FB923C', word: 'on computer',   desc: 'Clicking around apps on the computer' },
  waiting:     { label: 'Waiting for you',    color: '#F87171', word: 'waiting',       desc: 'Needs your OK in Claude to carry on' },
  idle:        { label: 'Idle',               color: '#9CA3AF', word: 'idle',          desc: 'Taking a break, nothing to do right now' },
};
const CLOSED = { label: 'Closed for the day', color: '#B08968', desc: 'Out of usage for now, hanging out in the common room' };
const STATE_KEYS = Object.keys(STATES);
const MAX_AGENTS = 24;
const ID_RE = /^[0-9a-f]{16}$/;
const DEMO_NAMES = ['Juniper', 'Maple', 'Clover', 'Pip', 'Biscuit', 'Hazel', 'Sprout', 'Wren', 'Mochi',
  'Olive', 'Pebble', 'Fern', 'Toffee', 'Basil', 'Nutmeg', 'Sorrel'];
const DOOR = new THREE.Vector3(3.6, 0, 8.9);
const CLOSED_MAX_AGE = 6 * 3600e3;
const TYPING_MS = 4000;

const reducedMQ = window.matchMedia('(prefers-reduced-motion: reduce)');
let reduced = reducedMQ.matches;
reducedMQ.addEventListener?.('change', (e) => { reduced = e.matches; });
// phones / small screens get smaller textures, a smaller shadow map and fewer leaves
const LOW = window.matchMedia('(pointer: coarse)').matches || Math.min(screen.width || 1e4, screen.height || 1e4) < 700;

/* ------------------------------------------------------------------ helpers */
function hashStr(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const damp = (k, dt) => 1 - Math.exp(-k * dt);
function angleLerp(a, b, t) { let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI; if (d < -Math.PI) d += Math.PI * 2; return a + d * t; }
function fmtDur(ms) {
  const m = Math.floor(Math.max(0, ms) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h} h ${r} min` : `${h} h`;
}

/* ------------------------------------------------------------------ renderer */
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const ANISO = Math.min(8, renderer.capabilities.getMaxAnisotropy());

const scene = new THREE.Scene();
const BG_OPEN = new THREE.Color('#2A221D'), BG_CLOSED = new THREE.Color('#161210');
scene.background = BG_OPEN.clone();

const camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 200);
// landscape looks from the front (+z); portrait phones look from the side (+x) so the long axis runs down the screen
const CAM_DIR_WIDE = new THREE.Vector3(0.32, 1.45, 1).normalize();
const CAM_DIR_TALL = new THREE.Vector3(1, 2.1, 0.06).normalize();
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.enablePan = false;
controls.rotateSpeed = 0.6;
controls.minZoom = 0.7;
controls.maxZoom = 3.5;
function setOrbitLimits(dir) {
  const polar = Math.acos(dir.y), az = Math.atan2(dir.x, dir.z);
  controls.minPolarAngle = Math.max(0.15, polar - 0.4);
  controls.maxPolarAngle = polar + 0.45;
  controls.minAzimuthAngle = az - 0.7;
  controls.maxAzimuthAngle = az + 0.7;
}
let interacting = false, lastInteract = -1e9;
controls.addEventListener('start', () => { interacting = true; });
controls.addEventListener('end', () => { interacting = false; lastInteract = performance.now(); });

// soft daylight through a skylight + warm bulbs. All lights are created once; closing only lerps intensities.
const hemi = new THREE.HemisphereLight('#FFF3E4', '#5E5046', 1.0);
scene.add(hemi);
const sun = new THREE.DirectionalLight('#FFE6CC', 2.0);
sun.position.set(-6, 18, 9);
sun.castShadow = true;
sun.shadow.mapSize.set(LOW ? 2048 : 4096, LOW ? 2048 : 4096);
Object.assign(sun.shadow.camera, { left: -13.5, right: 13.5, top: 13.5, bottom: -13.5, near: 2, far: 45 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.025;
sun.shadow.radius = 3;
scene.add(sun);
// cool back light: gives characters and leaves a soft rim
const rimLight = new THREE.DirectionalLight('#CFE0FF', 0.55);
rimLight.position.set(7, 9, -14);
scene.add(rimLight);
const LIGHT_BASE = { hemi: 1.0, sun: 2.0, rim: 0.55, point: 5.5 };
const pointLights = [];
const glowSprites = [];

const cafe = new THREE.Group();
scene.add(cafe);

/* ------------------------------------------------------------------ procedural textures */
function canvasTex(w, h, draw, { color = true, wrap = true } = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d', { willReadFrequently: true }), w, h);
  const t = new THREE.CanvasTexture(c);
  if (color) t.colorSpace = THREE.SRGBColorSpace;
  if (wrap) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = ANISO;
  return t;
}
function grain(g, w, h, amt, seed, mono = true) {
  const r = rng(seed), im = g.getImageData(0, 0, w, h), d = im.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (r() - 0.5) * amt;
    d[i] += n; d[i + 1] += mono ? n : (r() - 0.5) * amt; d[i + 2] += mono ? n : (r() - 0.5) * amt;
  }
  g.putImageData(im, 0, 0);
}
function softBlobs(g, x0, y0, w, h, n, r, rmin, rmax, rgb, amin, amax) {
  for (let i = 0; i < n; i++) {
    const x = x0 + r() * w, y = y0 + r() * h, rad = rmin + r() * (rmax - rmin), a = amin + r() * (amax - amin);
    const gr = g.createRadialGradient(x, y, 0, x, y, rad);
    gr.addColorStop(0, `rgba(${rgb},${a})`); gr.addColorStop(1, `rgba(${rgb},0)`);
    g.fillStyle = gr; g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
}
const T1 = LOW ? 512 : 1024, T2 = LOW ? 1024 : 2048;

// reclaimed planks, light and neutral so one texture can be tinted per material
const woodTex = canvasTex(T1, T1, (g, w, h) => {
  const r = rng(7), rows = 6, ph = h / rows, k = w / 1024;
  for (let p = 0; p < rows; p++) {
    const l = 222 + (r() - 0.5) * 40;
    g.fillStyle = `rgb(${l | 0},${(l * 0.92) | 0},${(l * 0.84) | 0})`; g.fillRect(0, p * ph, w, ph);
    softBlobs(g, 0, p * ph, w, ph, 10, r, 40 * k, 160 * k, '90,60,35', 0.04, 0.12);
    for (let i = 0; i < 60; i++) {
      g.strokeStyle = `rgba(${70 + r() * 30},${42 + r() * 20},25,${0.04 + r() * 0.13})`; g.lineWidth = (0.5 + r() * 2.2) * k;
      const y = p * ph + r() * ph, amp = (r() - 0.5) * 9 * k, f = 0.002 + r() * 0.006, ph0 = r() * 6;
      g.beginPath(); g.moveTo(0, y);
      for (let x = 0; x <= w; x += 16 * k) g.lineTo(x, y + Math.sin(x * f / k + ph0) * amp);
      g.stroke();
    }
    if (r() < 0.7) {
      const kx = r() * w, ky = p * ph + ph * (0.3 + r() * 0.4);
      for (let q = 7; q > 0; q--) { g.strokeStyle = `rgba(70,40,22,${0.1 + 0.04 * (7 - q)})`; g.lineWidth = 1.4 * k; g.beginPath(); g.ellipse(kx, ky, q * 6 * k, q * 2.2 * k, 0, 0, Math.PI * 2); g.stroke(); }
      g.fillStyle = 'rgba(55,32,18,.55)'; g.beginPath(); g.ellipse(kx, ky, 7 * k, 3 * k, 0, 0, Math.PI * 2); g.fill();
    }
    g.fillStyle = 'rgba(38,22,12,.6)'; g.fillRect(0, p * ph, w, 3 * k);
    g.fillStyle = 'rgba(255,240,220,.18)'; g.fillRect(0, p * ph + 3 * k, w, 2 * k);
    const jx = r() * w; g.fillStyle = 'rgba(38,22,12,.5)'; g.fillRect(jx, p * ph, 3 * k, ph);
  }
  // fibre streaks along the grain
  const im = g.getImageData(0, 0, w, h), d = im.data;
  for (let y = 0; y < h; y++) {
    const rowN = (r() - 0.5) * 14;
    for (let x = 0; x < w; x++) { const i = (y * w + x) * 4, n = rowN + (r() - 0.5) * 10; d[i] += n; d[i + 1] += n * 0.9; d[i + 2] += n * 0.8; }
  }
  g.putImageData(im, 0, 0);
});
// rough natural stone for the walls (tinted per stone with instance colours)
const stoneTex = canvasTex(T1 / 2, T1 / 2, (g, w, h) => {
  const r = rng(19);
  g.fillStyle = '#C9C6C0'; g.fillRect(0, 0, w, h);
  softBlobs(g, 0, 0, w, h, 60, r, w * 0.03, w * 0.18, '70,66,60', 0.05, 0.2);
  softBlobs(g, 0, 0, w, h, 40, r, w * 0.02, w * 0.12, '255,252,245', 0.05, 0.22);
  softBlobs(g, 0, 0, w, h, 14, r, w * 0.01, w * 0.05, '120,135,80', 0.1, 0.3); // lichen
  for (let i = 0; i < 300; i++) { g.fillStyle = `rgba(40,36,32,${0.1 + r() * 0.3})`; g.fillRect(r() * w, r() * h, 1 + r() * 2, 1 + r() * 2); }
  grain(g, w, h, 34, 20);
});
// lime-washed plaster
const plasterTex = canvasTex(T1, T1, (g, w, h) => {
  const r = rng(29);
  g.fillStyle = '#EEE7DC'; g.fillRect(0, 0, w, h);
  softBlobs(g, 0, 0, w, h, 90, r, w * 0.03, w * 0.2, '170,150,125', 0.03, 0.1);
  softBlobs(g, 0, 0, w, h, 40, r, w * 0.04, w * 0.15, '255,255,255', 0.05, 0.15);
  grain(g, w, h, 16, 30);
});
// woven fabric (sofa, cushions, poufs)
const fabricTex = canvasTex(T1 / 2, T1 / 2, (g, w, h) => {
  const r = rng(39);
  g.fillStyle = '#D8D6D2'; g.fillRect(0, 0, w, h);
  for (let y = 0; y < h; y += 3) { g.fillStyle = `rgba(0,0,0,${0.04 + r() * 0.05})`; g.fillRect(0, y, w, 1); }
  for (let x = 0; x < w; x += 3) { g.fillStyle = `rgba(255,255,255,${0.03 + r() * 0.05})`; g.fillRect(x, 0, 1, h); }
  softBlobs(g, 0, 0, w, h, 20, r, w * 0.05, w * 0.2, '0,0,0', 0.02, 0.05);
  grain(g, w, h, 22, 40);
});
// woven jute rug with a border
const rugTex = canvasTex(T1, T1 / 2, (g, w, h) => {
  const r = rng(49);
  g.fillStyle = '#CDB89B'; g.fillRect(0, 0, w, h);
  for (let y = 0; y < h; y += 4) { g.fillStyle = `rgba(90,65,40,${0.08 + r() * 0.1})`; g.fillRect(0, y, w, 2); }
  for (let x = 0; x < w; x += 6) { g.fillStyle = `rgba(255,245,225,${0.04 + r() * 0.06})`; g.fillRect(x, 0, 2, h); }
  const b = w * 0.04;
  g.strokeStyle = 'rgba(92,70,52,.75)'; g.lineWidth = b * 0.5; g.strokeRect(b, b, w - 2 * b, h - 2 * b);
  g.strokeStyle = 'rgba(150,80,55,.55)'; g.lineWidth = b * 0.18; g.strokeRect(b * 1.8, b * 1.8, w - 3.6 * b, h - 3.6 * b);
  grain(g, w, h, 18, 50);
}, { wrap: false });
// a cluster of leaves on a transparent card (tinted per instance)
const leafTex = canvasTex(T1, T1, (g, w, h) => {
  const r = rng(59), k = w / 1024;
  for (let i = 0; i < 70; i++) {
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * w * 0.34;
    const x = w / 2 + Math.cos(a) * d, y = h / 2 + Math.sin(a) * d, L = (70 + r() * 70) * k, W2 = L * (0.32 + r() * 0.16), rot = a + (r() - 0.5) * 1.2;
    g.save(); g.translate(x, y); g.rotate(rot);
    const l = 130 + r() * 90;
    const gr = g.createLinearGradient(0, -W2, 0, W2);
    gr.addColorStop(0, `rgb(${(l * 0.62) | 0},${l | 0},${(l * 0.45) | 0})`);
    gr.addColorStop(1, `rgb(${(l * 0.42) | 0},${(l * 0.78) | 0},${(l * 0.36) | 0})`);
    g.fillStyle = gr;
    g.beginPath(); g.moveTo(-L / 2, 0);
    g.bezierCurveTo(-L / 4, -W2, L / 4, -W2, L / 2, 0); g.bezierCurveTo(L / 4, W2, -L / 4, W2, -L / 2, 0); g.fill();
    g.strokeStyle = 'rgba(235,255,210,.35)'; g.lineWidth = 2 * k; g.beginPath(); g.moveTo(-L / 2, 0); g.lineTo(L / 2.2, 0); g.stroke();
    g.strokeStyle = 'rgba(20,40,15,.25)'; g.lineWidth = 1.2 * k;
    for (let v = -0.3; v <= 0.3; v += 0.15) { g.beginPath(); g.moveTo(v * L, 0); g.lineTo(v * L + L * 0.12, -W2 * 0.6); g.moveTo(v * L, 0); g.lineTo(v * L + L * 0.12, W2 * 0.6); g.stroke(); }
    g.restore();
  }
}, { wrap: false });
// soft radial blob for contact shadows ("ambient occlusion" under furniture)
const blobTex = canvasTex(128, 128, (g, w) => {
  const gr = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
  gr.addColorStop(0, 'rgba(0,0,0,0.55)'); gr.addColorStop(0.55, 'rgba(0,0,0,0.25)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, w, w);
}, { wrap: false, color: false });
const glowTex = canvasTex(128, 128, (g, w) => {
  const gr = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
  gr.addColorStop(0, 'rgba(255,226,170,1)'); gr.addColorStop(0.2, 'rgba(255,196,120,.5)'); gr.addColorStop(1, 'rgba(255,170,90,0)');
  g.fillStyle = gr; g.fillRect(0, 0, w, w);
}, { wrap: false });

/* ------------------------------------------------------------------ shared geometry/materials */
const G = {
  box: new THREE.BoxGeometry(1, 1, 1),
  sphere: new THREE.SphereGeometry(1, 14, 10),
  ring: new THREE.RingGeometry(0.44, 0.55, 64).rotateX(-Math.PI / 2),
  disc: new THREE.CircleGeometry(0.44, 64).rotateX(-Math.PI / 2),
  screen: new THREE.PlaneGeometry(0.36, 0.22).rotateY(Math.PI),
  sticker: new THREE.CircleGeometry(0.04, 24),
};
const matCache = new Map();
function mat(color, extra) {
  const key = color + (extra ? JSON.stringify(extra) : '');
  let m = matCache.get(key);
  if (!m) { m = new THREE.MeshStandardMaterial({ color, roughness: 0.8, metalness: 0, ...extra }); matCache.set(key, m); }
  return m;
}
function texMat(key, map, color, opts = {}) {
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ map, color, bumpMap: map, bumpScale: opts.bump ?? 1.2, roughness: opts.rough ?? 0.75, metalness: 0, side: opts.side ?? THREE.FrontSide });
    matCache.set(key, m);
  }
  return m;
}
const wood = (tint, side) => texMat('wood' + tint + (side || ''), woodTex, tint, { rough: 0.7, side });
const fabric = (tint) => texMat('fab' + tint, fabricTex, tint, { rough: 0.95, bump: 0.6 });
const plaster = (tint) => texMat('pl' + tint, plasterTex, tint, { rough: 0.95, bump: 0.8 });
const stoneMat = (tint) => texMat('st' + tint, stoneTex, tint, { rough: 0.9, bump: 2 });

// box-projected UVs in real-world units: grain runs along the longest side of each face
function worldUV(geo, S, off) {
  geo.computeBoundingBox();
  const sz = new THREE.Vector3(); geo.boundingBox.getSize(sz);
  const P = geo.attributes.position, N = geo.attributes.normal, uv = geo.attributes.uv;
  if (!uv || !N) return geo;
  const s = [sz.x, sz.y, sz.z];
  for (let i = 0; i < P.count; i++) {
    const n = [Math.abs(N.getX(i)), Math.abs(N.getY(i)), Math.abs(N.getZ(i))];
    const ax = n[0] > n[1] && n[0] > n[2] ? 0 : (n[1] > n[2] ? 1 : 2);
    const o = [0, 1, 2].filter((q) => q !== ax);
    const [u, v] = s[o[0]] >= s[o[1]] ? o : [o[1], o[0]];
    const p = [P.getX(i), P.getY(i), P.getZ(i)];
    uv.setXY(i, p[u] / S + off, p[v] / S + off * 1.7);
  }
  uv.needsUpdate = true;
  return geo;
}
const geoCache = new Map();
let uvVariant = 0;
function cachedGeo(key, make) {
  const v = uvVariant++ % 4, k = key + '|' + v;
  let g = geoCache.get(k);
  if (!g) { g = worldUV(make(), 1.8, v * 0.29); geoCache.set(k, g); }
  return g;
}
function mesh(geo, material, parent, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1, shadow = true) {
  const m = new THREE.Mesh(geo, typeof material === 'string' ? mat(material) : material);
  m.position.set(x, y, z); m.scale.set(sx, sy, sz);
  m.castShadow = shadow; m.receiveShadow = true;
  parent.add(m);
  return m;
}
const box = (c, p, x, y, z, w, h, d, s) => mesh(cachedGeo(`b${w},${h},${d}`, () => new THREE.BoxGeometry(w, h, d)), c, p, x, y, z, 1, 1, 1, s);
const rbox = (c, p, x, y, z, w, h, d, rad = 0.03, s) => mesh(cachedGeo(`r${w},${h},${d},${rad}`, () => new RoundedBoxGeometry(w, h, d, 2, Math.min(rad, w / 2, h / 2, d / 2) - 1e-4)), c, p, x, y, z, 1, 1, 1, s);
const cyl = (c, p, x, y, z, r, h, s, r2 = r, seg = 40) => mesh(cachedGeo(`c${r},${r2},${h},${seg}`, () => new THREE.CylinderGeometry(r, r2, h, seg)), c, p, x, y, z, 1, 1, 1, s);
const torus = (c, p, x, y, z, R, t, s, arc = Math.PI * 2) => mesh(cachedGeo(`t${R},${t},${arc}`, () => new THREE.TorusGeometry(R, t, 8, 36, arc)), c, p, x, y, z, 1, 1, 1, s);
const lathe = (c, p, x, y, z, pts, s) => mesh(cachedGeo('l' + pts.join(','), () => new THREE.LatheGeometry(pts.map(([a, b]) => new THREE.Vector2(a, b)), 40)), c, p, x, y, z, 1, 1, 1, s);
const W = { light: '#C79A6A', mid: '#A87A4F', dark: '#86603F', deep: '#5E4130', warm: '#B98656', grey: '#9C8F82' };

// instancing: items {x,y,z, rx,ry,rz, sx,sy,sz, c(Color)}
function instanced(geo, items, material, opts = {}) {
  const m = new THREE.InstancedMesh(geo, material, items.length);
  const o = new THREE.Object3D();
  items.forEach((it, i) => {
    o.position.set(it.x, it.y, it.z); o.rotation.set(it.rx || 0, it.ry || 0, it.rz || 0);
    o.scale.set(it.sx, it.sy, it.sz); o.updateMatrix();
    m.setMatrixAt(i, o.matrix); m.setColorAt(i, it.c || new THREE.Color('#ffffff'));
  });
  m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true;
  m.castShadow = opts.shadow !== false; m.receiveShadow = opts.receive !== false; m.frustumCulled = false;
  if (opts.depth) m.customDepthMaterial = opts.depth;
  cafe.add(m);
  return m;
}
const srgb = (h, s, l) => new THREE.Color().setHSL(h, s, l, THREE.SRGBColorSpace);

// contact shadows: soft dark blobs under furniture
const blobs = [];
const blob = (x, z, rx, rz = rx, y = 0.006) => blobs.push({ x, y, z, rx: -Math.PI / 2, sx: rx * 2, sy: rz * 2, sz: 1 });

/* ------------------------------------------------------------------ floor + walls */
const FX = 10, FZ = 8; // floor spans x -10..10, z -8..8
mesh(new THREE.CircleGeometry(36, 64).rotateX(-Math.PI / 2), '#2F2621', cafe, 0, -0.56, 0, 1, 1, 1, false);
box(stoneMat('#7B756E'), cafe, 0, -0.29, 0, FX * 2 + 1.0, 0.54, FZ * 2 + 1.0);
// big grey flagstones of mixed sizes with grout, mottling and darker corners (baked occlusion)
{
  const PX = T2 / (FX * 2), w = T2, h = Math.round(PX * FZ * 2);
  const r = rng(11), cells = FX * 2, rowsN = FZ * 2, used = new Set(), slabs = [];
  for (let iz = 0; iz < rowsN; iz++) for (let ix = 0; ix < cells; ix++) {
    if (used.has(ix + ',' + iz)) continue;
    let sw = 1, sh = 1;
    const roll = r();
    if (roll < 0.28 && ix + 1 < cells && !used.has(ix + 1 + ',' + iz)) sw = 2;
    else if (roll < 0.48 && iz + 1 < rowsN) sh = 2;
    if (sw === 2 && r() < 0.35 && iz + 1 < rowsN && !used.has(ix + 1 + ',' + (iz + 1))) sh = 2;
    for (let a = 0; a < sw; a++) for (let b = 0; b < sh; b++) used.add(ix + a + ',' + (iz + b));
    slabs.push([ix, iz, sw, sh]);
  }
  const gout = Math.max(2, PX * 0.035);
  const floorTex = canvasTex(w, h, (g) => {
    g.fillStyle = '#5F5B56'; g.fillRect(0, 0, w, h);
    for (const [ix, iz, sw, sh] of slabs) {
      const x = ix * PX + gout / 2, y = iz * PX + gout / 2, ww = sw * PX - gout, hh = sh * PX - gout;
      const l = 128 + r() * 46, warm = r() * 7;
      g.fillStyle = `rgb(${(l + warm) | 0},${(l + warm * 0.4) | 0},${(l - 4) | 0})`; g.fillRect(x, y, ww, hh);
      g.save(); g.beginPath(); g.rect(x, y, ww, hh); g.clip();
      softBlobs(g, x, y, ww, hh, 9 * sw * sh, r, PX * 0.08, PX * 0.45, '60,58,55', 0.04, 0.14);
      softBlobs(g, x, y, ww, hh, 6 * sw * sh, r, PX * 0.06, PX * 0.35, '255,252,246', 0.04, 0.14);
      for (let i = 0; i < 40 * sw * sh; i++) { g.fillStyle = `rgba(40,38,36,${0.15 + r() * 0.3})`; g.fillRect(x + r() * ww, y + r() * hh, 1 + r() * 2.5, 1 + r() * 2.5); }
      if (r() < 0.25) { g.strokeStyle = 'rgba(60,58,55,.25)'; g.lineWidth = 1.2; g.beginPath(); let cx = x + r() * ww, cy = y + r() * hh; g.moveTo(cx, cy); for (let k = 0; k < 6; k++) { cx += (r() - 0.5) * PX * 0.25; cy += (r() - 0.5) * PX * 0.25; g.lineTo(cx, cy); } g.stroke(); }
      g.lineWidth = gout * 0.7; g.strokeStyle = 'rgba(40,36,32,.18)'; g.strokeRect(x, y, ww, hh);
      g.restore();
    }
    // darker towards the walls: a cheap ambient-occlusion feel
    const ao = PX * 0.7;
    for (const [x0, y0, x1, y1, rx, ry, rw, rh] of [[0, 0, 0, ao, 0, 0, w, ao], [0, h, 0, h - ao, 0, h - ao, w, ao], [0, 0, ao, 0, 0, 0, ao, h], [w, 0, w - ao, 0, w - ao, 0, ao, h]]) {
      const gr = g.createLinearGradient(x0, y0, x1, y1); gr.addColorStop(0, 'rgba(30,24,20,.5)'); gr.addColorStop(1, 'rgba(30,24,20,0)');
      g.fillStyle = gr; g.fillRect(rx, ry, rw, rh);
    }
    grain(g, w, h, 18, 12);
  }, { wrap: false });
  const floorBump = canvasTex(w / 2, h / 2, (g) => {
    g.fillStyle = '#202020'; g.fillRect(0, 0, w / 2, h / 2);
    for (const [ix, iz, sw, sh] of slabs) { g.fillStyle = `rgb(${200 + r() * 30 | 0},${200},${200})`; g.fillRect((ix * PX + gout) / 2, (iz * PX + gout) / 2, (sw * PX - gout * 2) / 2, (sh * PX - gout * 2) / 2); }
    softBlobs(g, 0, 0, w / 2, h / 2, 400, r, 4, 30, '0,0,0', 0.05, 0.2);
    grain(g, w / 2, h / 2, 40, 13);
  }, { wrap: false, color: false });
  const floorMat = new THREE.MeshStandardMaterial({ map: floorTex, bumpMap: floorBump, bumpScale: 3, roughness: 0.86, metalness: 0 });
  mesh(new THREE.PlaneGeometry(FX * 2, FZ * 2).rotateX(-Math.PI / 2), floorMat, cafe, 0, 0, 0, 1, 1, 1, false);
}
// rough stone walls: rounded, lumpy stones (one instanced mesh), each tinted a little differently
const stoneGeo = (() => {
  let g = new THREE.BoxGeometry(1, 1, 1, 3, 2, 2);
  g.deleteAttribute('normal'); g.deleteAttribute('uv');
  g = mergeVertices(g);
  const P = g.attributes.position, r = rng(3), v = new THREE.Vector3(), c = new THREE.Vector3();
  for (let i = 0; i < P.count; i++) {
    v.fromBufferAttribute(P, i);
    c.set(THREE.MathUtils.clamp(v.x, -0.32, 0.32), THREE.MathUtils.clamp(v.y, -0.3, 0.3), THREE.MathUtils.clamp(v.z, -0.3, 0.3));
    const d = v.clone().sub(c); const len = d.length() || 1;
    v.copy(c).addScaledVector(d, (0.19 + (r() - 0.5) * 0.05) / len);
    P.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  const uv = new Float32Array(P.count * 2);
  for (let i = 0; i < P.count; i++) { uv[i * 2] = P.getX(i) + P.getZ(i) + 0.5; uv[i * 2 + 1] = P.getY(i) + 0.5; }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
})();
const stones = [];
function stoneWall(x0, z0, x1, z1, h, seed) {
  const r = rng(seed), len = Math.hypot(x1 - x0, z1 - z0), ux = (x1 - x0) / len, uz = (z1 - z0) / len;
  const ry = Math.atan2(-uz, ux), rows = Math.max(1, Math.round(h / 0.26)), rh = h / rows;
  for (let row = 0; row < rows; row++) {
    let t = -(row % 2) * 0.22 * r();
    while (t < len - 0.05) {
      let L = 0.3 + r() * 0.36; if (t + L > len) L = len - t; if (t < 0) { L += t; t = 0; }
      const mid = t + L / 2, hh = rh * (0.92 + r() * 0.16), d = 0.42 + r() * 0.12, j = (r() - 0.5) * 0.07;
      const l = 0.42 + r() * 0.3;
      stones.push({ x: x0 + ux * mid - uz * j, y: row * rh + hh / 2, z: z0 + uz * mid + ux * j,
        ry: ry + (r() - 0.5) * 0.1, rx: (r() - 0.5) * 0.06, rz: (r() - 0.5) * 0.08, sx: L + 0.02, sy: hh, sz: d,
        c: srgb(0.08 + r() * 0.04, 0.04 + r() * 0.07, l) });
      t += L;
    }
  }
}
stoneWall(1.2, -8.25, 10.3, -8.25, 1.5, 21);   // back, behind the lounge
stoneWall(-10.25, -8.3, -10.25, 8.3, 1.05, 22); // left
stoneWall(10.25, -8.3, 10.25, 8.3, 1.05, 23);   // right
stoneWall(-10.3, 8.25, 2.5, 8.25, 0.62, 24);    // front (door gap at x 2.5..4.7)
stoneWall(4.7, 8.25, 10.3, 8.25, 0.62, 25);
instanced(stoneGeo, stones, stoneMat('#ffffff'));
// back wall behind the kitchen: lime-washed plaster with a wooden skirting and a top beam
box(plaster('#E4D8C8'), cafe, -4.4, 1.5, -8.3, 11.4, 3.0, 0.3);
box(wood(W.deep), cafe, -4.4, 0.12, -8.12, 11.4, 0.24, 0.06);
box(wood(W.dark), cafe, -4.4, 3.04, -8.2, 11.6, 0.18, 0.5);
for (const x of [-9.95, 1.15]) box(wood(W.dark), cafe, x, 1.5, -8.05, 0.24, 3.0, 0.24);

/* ------------------------------------------------------------------ kitchen strip (back counter) */
const slate = mat('#55575A', { roughness: 0.45 });
const steel = mat('#C3C8CD', { roughness: 0.32, metalness: 0.55 });
const ceramic = mat('#F7F2EA', { roughness: 0.35 });
const blackMetal = mat('#2C2E31', { roughness: 0.5, metalness: 0.35 });
rbox(wood(W.dark), cafe, -4.6, 0.46, -7.6, 10.4, 0.92, 0.9, 0.02);
for (let i = 0; i < 13; i++) { const x = -9.4 + i * 0.8; if (x > -3.8 && x < -2.6) continue; rbox(wood(i % 2 ? W.mid : W.warm), cafe, x + 0.4, 0.46, -7.13, 0.74, 0.76, 0.04, 0.015, false); cyl(blackMetal, cafe, x + 0.4, 0.74, -7.09, 0.012, 0.2, false, 0.012, 8).rotation.z = Math.PI / 2; }
rbox(slate, cafe, -4.6, 0.95, -7.6, 10.6, 0.07, 1.0, 0.02);
for (const y of [1.65, 2.3]) {
  rbox(wood(W.mid), cafe, -7.2, y, -8.0, 5.0, 0.07, 0.36, 0.015);
  for (const x of [-9.3, -5.1]) box(blackMetal, cafe, x, y - 0.1, -8.05, 0.03, 0.16, 0.25, false);
}
{
  const jarCols = ['#E8DCC6', '#B9D4C8', '#F0C987', '#D7B8A2', '#C9D7E2'], r = rng(5);
  for (let i = 0; i < 9; i++) {
    const rr = 0.1 + r() * 0.04, hh = 0.26 + r() * 0.12, x = -9.3 + i * 0.5;
    cyl(mat(jarCols[i % 5], { roughness: 0.3 }), cafe, x, 1.69 + hh / 2, -8.0, rr, hh, true, rr, 28);
    cyl(wood(W.light), cafe, x, 1.69 + hh + 0.025, -8.0, rr * 0.92, 0.05, false, rr * 0.92, 28);
  }
  for (let i = 0; i < 8; i++) { const x = -9.2 + i * 0.55; lathe(ceramic, cafe, x, 2.335, -8.0, [[0.001, 0], [0.06, 0], [0.085, 0.04], [0.09, 0.15], [0.082, 0.15], [0.075, 0.02], [0.001, 0.02]]); }
}
// espresso machine
const esp = new THREE.Group(); esp.position.set(-8.4, 0.985, -7.7); cafe.add(esp);
rbox(steel, esp, 0, 0.32, 0, 1.2, 0.64, 0.6, 0.08);
rbox(blackMetal, esp, 0, 0.67, 0, 1.24, 0.06, 0.64, 0.02);
rbox(mat('#9E3B30', { roughness: 0.35 }), esp, 0, 0.47, 0.3, 1.0, 0.2, 0.03, 0.01);
for (const x of [-0.42, 0.42]) { cyl(blackMetal, esp, x, 0.5, 0.33, 0.035, 0.02, false, 0.035, 20).rotation.x = Math.PI / 2; }
for (const x of [-0.3, 0.3]) {
  cyl(blackMetal, esp, x, 0.14, 0.36, 0.06, 0.1, true, 0.06, 24);
  cyl(blackMetal, esp, x, 0.14, 0.5, 0.015, 0.2, false, 0.015, 8).rotation.x = Math.PI / 2;
  lathe(ceramic, esp, x, -0.005, 0.38, [[0.001, 0], [0.045, 0], [0.06, 0.03], [0.062, 0.08], [0.055, 0.08], [0.05, 0.015], [0.001, 0.015]]);
}
for (let i = 0; i < 5; i++) lathe(ceramic, esp, -0.4 + i * 0.2, 0.7, 0.05, [[0.001, 0], [0.045, 0], [0.06, 0.03], [0.062, 0.08], [0.055, 0.08], [0.05, 0.015], [0.001, 0.015]]);
// grinder, cups, sink, cake stand, till
cyl(blackMetal, cafe, -7.1, 1.2, -7.75, 0.12, 0.42, true, 0.14, 32);
cyl(mat('#7C5A43', { roughness: 0.4, transparent: true, opacity: 0.85 }), cafe, -7.1, 1.55, -7.75, 0.15, 0.28, true, 0.08, 32);
for (let i = 0; i < 6; i++) lathe(ceramic, cafe, -6.4 + (i % 3) * 0.2, 0.985 + Math.floor(i / 3) * 0.1, -7.5, [[0.001, 0], [0.045, 0], [0.06, 0.03], [0.062, 0.09], [0.055, 0.09], [0.05, 0.015], [0.001, 0.015]]);
rbox(steel, cafe, -3.2, 0.99, -7.6, 1.0, 0.02, 0.6, 0.008, false);
rbox(mat('#3E4246', { roughness: 0.3 }), cafe, -3.2, 0.995, -7.6, 0.85, 0.012, 0.45, 0.004, false);
torus(steel, cafe, -3.2, 1.25, -7.85, 0.12, 0.018, false, Math.PI).rotation.y = Math.PI / 2;
const cake = new THREE.Group(); cake.position.set(-1.4, 0.985, -7.55); cafe.add(cake);
cyl(ceramic, cake, 0, 0.1, 0, 0.04, 0.2, false, 0.06, 20); cyl(ceramic, cake, 0, 0.21, 0, 0.34, 0.025, true, 0.32, 48);
cyl(mat('#E9A86A', { roughness: 0.7 }), cake, 0, 0.31, 0, 0.24, 0.17, true, 0.24, 48); cyl(mat('#F6E7D2', { roughness: 0.5 }), cake, 0, 0.405, 0, 0.245, 0.03, false, 0.245, 48);
for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; mesh(G.sphere, mat('#C2412F', { roughness: 0.4 }), cake, Math.cos(a) * 0.17, 0.435, Math.sin(a) * 0.17, 0.025, 0.025, 0.025, false); }
rbox(mat('#F6F1E8', { roughness: 0.4 }), cafe, 0.0, 1.07, -7.6, 0.5, 0.18, 0.4, 0.04);
rbox(mat('#30343A', { roughness: 0.3 }), cafe, 0.0, 1.2, -7.65, 0.36, 0.2, 0.03, 0.01).rotation.x = -0.3;

// chalkboard (live counts / closed sign)
const boardCanvas = document.createElement('canvas'); boardCanvas.width = 1024; boardCanvas.height = 560;
const boardTex = new THREE.CanvasTexture(boardCanvas); boardTex.colorSpace = THREE.SRGBColorSpace; boardTex.anisotropy = ANISO;
rbox(wood(W.deep), cafe, -2.6, 2.15, -8.12, 3.2, 1.8, 0.08, 0.03);
mesh(new THREE.PlaneGeometry(3.0, 1.62), new THREE.MeshBasicMaterial({ map: boardTex, toneMapped: false }), cafe, -2.6, 2.15, -8.07, 1, 1, 1, false);
let boardKey = '';
function drawBoard(counts, closed) {
  const key = JSON.stringify(counts) + closed;
  if (key === boardKey) return; boardKey = key;
  const g = boardCanvas.getContext('2d');
  const Wd = boardCanvas.width, H = boardCanvas.height;
  g.fillStyle = '#2B3833'; g.fillRect(0, 0, Wd, H);
  g.fillStyle = 'rgba(255,255,255,0.035)';
  for (let i = 0; i < 18; i++) { g.beginPath(); g.ellipse((i * 211) % Wd, (i * 137) % H, 120, 40, i, 0, Math.PI * 2); g.fill(); }
  g.textAlign = 'center'; g.textBaseline = 'middle';
  if (closed) {
    g.fillStyle = '#FFF6E6'; g.font = '700 110px Fredoka, ui-rounded, sans-serif';
    g.fillText('Closed', Wd / 2, 210);
    g.fillStyle = '#E8DCC8'; g.font = '500 56px Fredoka, ui-rounded, sans-serif';
    g.fillText('Out of usage for now', Wd / 2, 340);
    g.fillText('Back soon ☕', Wd / 2, 420);
    boardTex.needsUpdate = true; return;
  }
  g.fillStyle = '#FFF6E6'; g.font = '600 70px Fredoka, ui-rounded, sans-serif';
  g.fillText('Today at the café', Wd / 2, 74);
  g.strokeStyle = 'rgba(255,246,230,.5)'; g.lineWidth = 3; g.beginPath(); g.moveTo(260, 122); g.lineTo(Wd - 260, 122); g.stroke();
  const entries = STATE_KEYS.filter((k) => counts[k] > 0).map((k) => ({ k, text: `${counts[k]} ${STATES[k].word}` }));
  g.font = '500 50px Fredoka, ui-rounded, sans-serif';
  if (!entries.length) { g.fillStyle = '#E8DCC8'; g.fillText('All quiet right now', Wd / 2, 300); }
  const rows = [];
  for (let i = 0; i < entries.length; i += 2) rows.push(entries.slice(i, i + 2));
  const rowH = rows.length > 4 ? 76 : 86;
  const startY = 190 + Math.max(0, (4 - rows.length)) * rowH * 0.5;
  rows.forEach((row, ri) => {
    const sep = '  ·  ';
    const widths = row.map((e) => g.measureText(e.text).width + 34);
    const sepW = row.length > 1 ? g.measureText(sep).width : 0;
    let x = Wd / 2 - (widths.reduce((a, b) => a + b, 0) + sepW) / 2;
    const y = startY + ri * rowH;
    row.forEach((e, i) => {
      g.fillStyle = STATES[e.k].color; g.beginPath(); g.arc(x + 12, y, 11, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#FFF6E6'; g.textAlign = 'left'; g.fillText(e.text, x + 34, y);
      x += widths[i];
      if (i === 0 && row.length > 1) { g.fillStyle = 'rgba(255,246,230,.6)'; g.fillText(sep, x, y); x += sepW; }
    });
    g.textAlign = 'center';
  });
  boardTex.needsUpdate = true;
}

/* ------------------------------------------------------------------ L-shaped bar counter (reclaimed wood) */
const BAR_Z = -4.9, BAR_X0 = -8.9, BAR_X1 = -2.3, BAR_H = 1.05;
const brass = mat('#B8925A', { roughness: 0.3, metalness: 0.7 });
box(wood(W.dark), cafe, (BAR_X0 + BAR_X1) / 2, BAR_H / 2 - 0.05, BAR_Z, BAR_X1 - BAR_X0, BAR_H - 0.1, 0.74);
{
  const r = rng(81), tints = [W.mid, W.warm, W.dark, W.light, W.grey];
  for (let x = BAR_X0 - 0.35; x < BAR_X1 + 0.3;) {
    const pw = 0.16 + r() * 0.14, hh = BAR_H - 0.12 - r() * 0.05;
    rbox(wood(tints[Math.floor(r() * tints.length)]), cafe, x + pw / 2, hh / 2 + 0.02, BAR_Z + 0.39, pw - 0.012, hh, 0.05, 0.012, false);
    x += pw;
  }
  for (let z = -4.5; z < -3.0;) {
    const pw = 0.16 + r() * 0.14, hh = BAR_H - 0.12 - r() * 0.05;
    rbox(wood(tints[Math.floor(r() * tints.length)]), cafe, BAR_X0 + 0.39, hh / 2 + 0.02, z + pw / 2, 0.05, hh, pw - 0.012, 0.012, false);
    z += pw;
  }
}
rbox(wood(W.light), cafe, (BAR_X0 + BAR_X1) / 2, BAR_H - 0.04, BAR_Z, BAR_X1 - BAR_X0 + 0.2, 0.09, 1.0, 0.03);
box(wood(W.dark), cafe, BAR_X0, BAR_H / 2 - 0.05, -3.75, 0.74, BAR_H - 0.1, 1.5);
rbox(wood(W.light), cafe, BAR_X0, BAR_H - 0.04, -3.7, 1.0, 0.09, 1.7, 0.03);
cyl(brass, cafe, (BAR_X0 + BAR_X1) / 2 + 0.3, 0.24, BAR_Z + 0.58, 0.025, BAR_X1 - BAR_X0 - 0.4, true, 0.025, 16).rotation.z = Math.PI / 2;
blob((BAR_X0 + BAR_X1) / 2, BAR_Z + 0.2, 3.8, 0.75);
// pastry case + cups on the bar
const pastry = new THREE.Group(); pastry.position.set(-2.9, BAR_H, BAR_Z); cafe.add(pastry);
rbox(wood(W.deep), pastry, 0, 0.03, 0, 0.9, 0.06, 0.6, 0.02);
const glass = new THREE.MeshStandardMaterial({ color: '#DDEFF5', transparent: true, opacity: 0.22, roughness: 0.05, metalness: 0.1, depthWrite: false });
mesh(new RoundedBoxGeometry(0.9, 0.42, 0.6, 3, 0.04), glass, pastry, 0, 0.27, 0, 1, 1, 1, false);
const pastryCols = ['#D9934A', '#F2C3D0', '#B8733B', '#F2D896', '#C98348', '#EAB676'];
for (let i = 0; i < 6; i++) mesh(G.sphere, mat(pastryCols[i], { roughness: 0.65 }), pastry, -0.3 + (i % 3) * 0.3, 0.12, (i < 3 ? -0.12 : 0.12), 0.1, 0.055, 0.08);
for (const x of [-8.6, -8.35]) lathe(ceramic, cafe, x, BAR_H + 0.005, BAR_Z + 0.1, [[0.001, 0], [0.045, 0], [0.06, 0.03], [0.062, 0.1], [0.055, 0.1], [0.05, 0.015], [0.001, 0.015]]);

/* ------------------------------------------------------------------ furniture builders */
function tubChair(x, z, heading) {
  const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = heading; cafe.add(g);
  cyl(wood(W.warm), g, 0, 0.2, 0, 0.29, 0.4, true, 0.25, 48);
  cyl(fabric('#E7DED0'), g, 0, 0.43, 0, 0.27, 0.07, true, 0.29, 40);
  mesh(cachedGeo('tubback', () => new THREE.CylinderGeometry(0.33, 0.29, 0.42, 48, 1, true, Math.PI * 0.45, Math.PI * 1.1)), wood(W.dark, THREE.DoubleSide), g, 0, 0.6, 0);
  torus(wood(W.mid), g, 0, 0.81, 0, 0.33, 0.035, true, Math.PI * 1.1).rotation.set(Math.PI / 2, 0, Math.PI * 0.95);
  blob(x, z, 0.42);
  return g;
}
function stool(x, z, h, tint = W.warm) {
  const g = new THREE.Group(); g.position.set(x, 0, z); cafe.add(g);
  cyl(wood(tint), g, 0, h - 0.035, 0, 0.21, 0.07, true, 0.2, 40);
  torus(wood(tint), g, 0, h - 0.035, 0, 0.2, 0.035).rotation.x = Math.PI / 2;
  for (const [lx, lz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const l = cyl(wood(W.deep), g, lx * 0.12, (h - 0.06) / 2, lz * 0.12, 0.022, h - 0.04, false, 0.028, 12);
    l.rotation.set(lz * 0.08, 0, -lx * 0.08);
  }
  torus(h > 0.6 ? brass : wood(W.deep), g, 0, h * 0.36, 0, 0.15, 0.012, false).rotation.x = Math.PI / 2;
  blob(x, z, 0.32);
  return g;
}
function chair(x, z, heading) {
  const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = heading; cafe.add(g);
  rbox(wood(W.warm), g, 0, 0.42, -0.05, 0.48, 0.05, 0.46, 0.02);
  for (const sx of [-0.2, 0.2]) rbox(wood(W.deep), g, sx, 0.65, -0.26, 0.05, 0.5, 0.05, 0.015);
  for (const yy of [0.62, 0.78]) rbox(wood(W.mid), g, 0, yy, -0.27, 0.44, 0.09, 0.035, 0.015);
  for (const [lx, lz] of [[-0.2, 0.14], [0.2, 0.14]]) rbox(wood(W.deep), g, lx, 0.2, lz, 0.05, 0.4, 0.05, 0.015, false);
  for (const lx of [-0.2, 0.2]) rbox(wood(W.deep), g, lx, 0.2, -0.26, 0.05, 0.4, 0.05, 0.015, false);
  blob(x, z, 0.38);
  return g;
}
function roundTable(x, z) {
  const g = new THREE.Group(); g.position.set(x, 0, z); cafe.add(g);
  cyl(wood(W.light), g, 0, 0.74, 0, 0.62, 0.06, true, 0.6, 64);
  torus(wood(W.light), g, 0, 0.74, 0, 0.6, 0.03).rotation.x = Math.PI / 2;
  cyl(wood(W.deep), g, 0, 0.37, 0, 0.06, 0.7, true, 0.07, 24);
  for (const a of [0, Math.PI / 2]) rbox(wood(W.deep), g, 0, 0.03, 0, 0.62, 0.05, 0.08, 0.02).rotation.y = a;
  blob(x, z, 0.75);
  return g;
}
function legTable(x, z, w, d, h, tint = W.light, planks = 0) {
  const g = new THREE.Group(); g.position.set(x, 0, z); cafe.add(g);
  const r = rng(hashStr(`${x},${z}`)), along = d > w;
  const n = planks || Math.max(1, Math.round((along ? w : d) / 0.28));
  const span = along ? w : d, pw = span / n;
  const tints = [tint, tint, W.mid, W.warm, W.light];
  for (let i = 0; i < n; i++) {
    const off = -span / 2 + pw * (i + 0.5);
    const t = tints[Math.floor(r() * tints.length)];
    if (along) rbox(wood(t), g, off, h - 0.04, 0, pw - 0.012, 0.08, d, 0.015);
    else rbox(wood(t), g, 0, h - 0.04, off, w, 0.08, pw - 0.012, 0.015);
  }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) rbox(wood(W.deep), g, sx * (w / 2 - 0.12), (h - 0.08) / 2, sz * (d / 2 - 0.12), 0.09, h - 0.08, 0.09, 0.015);
  if (along) rbox(wood(W.deep), g, 0, h * 0.25, 0, 0.05, 0.06, d - 0.3, 0.01, false);
  blob(x, z, w / 2 + 0.25, d / 2 + 0.25);
  return g;
}
// pots: tapered terracotta / pale ceramic
function pot(x, y, z, s, kind = 0) {
  const col = ['#B76E4B', '#D9D2C6', '#5C5F62', '#C49A6C'][kind % 4];
  lathe(mat(col, { roughness: kind === 1 ? 0.5 : 0.85 }), cafe, x, y, z, [[0.001, 0], [0.16 * s, 0], [0.22 * s, 0.34 * s], [0.25 * s, 0.38 * s], [0.25 * s, 0.42 * s], [0.21 * s, 0.42 * s], [0.2 * s, 0.37 * s], [0.001, 0.37 * s]]);
  if (y < 0.05) blob(x, z, 0.32 * s);
}

/* ------------------------------------------------------------------ work seats (24) */
// seat: { pos, heading (direction the agent faces), y (seat lift), tableY, reach (laptop distance), owner }
const DESKS = [];
function addSeat(x, z, heading, tableY, reach, y = 0) {
  DESKS.push({ pos: new THREE.Vector3(x, 0, z), heading, y, tableY, reach, owner: null });
}
// bar stools in front of the L-bar, facing the counter
for (const x of [-7.6, -6.2, -4.8, -3.4]) { stool(x, -4.1, 0.78); addSeat(x, -4.1, Math.PI, BAR_H, 0.55, 0.3); }
// round tables, 3 tub chairs each
for (const [tx, tz] of [[-6.9, -1.4], [-3.3, -1.0], [-7.0, 2.8], [-3.2, 3.2]]) {
  roundTable(tx, tz);
  for (const a of [Math.PI / 3, Math.PI, Math.PI * 5 / 3]) {
    const x = tx + Math.sin(a) * 1.0, z = tz + Math.cos(a) * 1.0, h = Math.atan2(tx - x, tz - z);
    tubChair(x, z, h); addSeat(x, z, h, 0.77, 0.52);
  }
}
// rectangular table with 4 chairs
legTable(0.6, 0.6, 1.1, 2.3, 0.76, W.warm);
for (const sx of [-1, 1]) for (const z of [0.05, 1.15]) {
  const h = sx < 0 ? Math.PI / 2 : -Math.PI / 2; chair(0.6 + sx * 0.95, z, h); addSeat(0.6 + sx * 0.95, z, h, 0.76, 0.5);
}
// long communal table (right side): 4 stools on the left are work seats; bench on the right is the common room
const COMM_X = 6.7;
legTable(COMM_X, 0.1, 1.3, 5.6, 0.76, W.mid);
for (const z of [-1.9, -0.6, 0.7, 2.0]) { stool(COMM_X - 1.05, z, 0.46); addSeat(COMM_X - 1.05, z, Math.PI / 2, 0.76, 0.5); }
rbox(wood(W.dark), cafe, COMM_X + 1.05, 0.42, 0.1, 0.5, 0.08, 5.2, 0.02);
for (const z of [-2.2, 2.4]) rbox(wood(W.deep), cafe, COMM_X + 1.05, 0.2, z, 0.4, 0.4, 0.08, 0.015, false);
blob(COMM_X + 1.05, 0.1, 0.4, 2.8);
const DESK_ORDER = [...DESKS.keys()];

/* ------------------------------------------------------------------ common room: grey sofa corner */
const COMMON = [];   // spots everyone gathers at when closed (idle agents use them too)
const spot = (x, z, heading, stand = false) => ({ pos: new THREE.Vector3(x, 0, z), heading, stand });
{
  const sofa = fabric('#8F908D'), sofaDark = fabric('#7A7B79');
  // back run along the back wall, facing +z (base + seat cushions + back cushions)
  rbox(sofaDark, cafe, 7.2, 0.14, -7.3, 3.7, 0.28, 1.0, 0.06);
  for (let i = 0; i < 3; i++) rbox(sofa, cafe, 5.97 + i * 1.22, 0.36, -7.2, 1.2, 0.17, 0.82, 0.07);
  for (let i = 0; i < 3; i++) rbox(sofa, cafe, 5.97 + i * 1.22, 0.66, -7.66, 1.18, 0.5, 0.24, 0.09);
  // side run along the right wall, facing -x
  rbox(sofaDark, cafe, 9.6, 0.14, -5.6, 1.0, 0.28, 2.5, 0.06);
  for (let i = 0; i < 2; i++) rbox(sofa, cafe, 9.5, 0.36, -6.2 + i * 1.22, 0.82, 0.17, 1.2, 0.07);
  for (let i = 0; i < 2; i++) rbox(sofa, cafe, 9.95, 0.66, -6.2 + i * 1.22, 0.24, 0.5, 1.18, 0.09);
  rbox(sofaDark, cafe, 5.28, 0.36, -7.3, 0.22, 0.44, 1.0, 0.08);
  rbox(sofaDark, cafe, 9.6, 0.36, -4.27, 1.0, 0.44, 0.22, 0.08);
  blob(7.4, -7.0, 2.3, 0.8); blob(9.6, -5.6, 0.8, 1.7);
  const cush = ['#C9A66B', '#9DB08A', '#C77B5A', '#E6DCCB', '#7F9AA6'];
  [[6.0, -7.45, 0.2], [7.3, -7.45, -0.15], [8.6, -7.45, 0.1], [9.75, -6.3, 1.4], [9.75, -5.0, 1.7]].forEach(([x, z, r], i) => {
    const c = rbox(fabric(cush[i]), cafe, x, 0.66, z, 0.5, 0.42, 0.14, 0.06); c.rotation.y = r; c.rotation.x = -0.25;
  });
  // low coffee table + cups, side cabinet
  legTable(7.5, -5.7, 1.4, 0.8, 0.42, W.light, 3);
  for (const [x, z] of [[7.2, -5.6], [7.75, -5.85]]) lathe(ceramic, cafe, x, 0.42, z, [[0.001, 0], [0.045, 0], [0.06, 0.03], [0.062, 0.1], [0.055, 0.1], [0.05, 0.015], [0.001, 0.015]]);
  rbox(wood(W.dark), cafe, 4.4, 0.45, -7.75, 1.4, 0.9, 0.6, 0.03);
  for (const x of [4.08, 4.72]) { rbox(wood(W.mid), cafe, x, 0.45, -7.44, 0.6, 0.78, 0.03, 0.01, false); mesh(G.sphere, brass, cafe, x + (x < 4.4 ? 0.22 : -0.22), 0.55, -7.42, 0.025, 0.025, 0.025, false); }
  blob(4.4, -7.7, 0.9, 0.5);
  // a woven rug under the lounge
  mesh(new THREE.PlaneGeometry(4.4, 3.4).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: rugTex, roughness: 1, bumpMap: rugTex, bumpScale: 1.5 }), cafe, 7.6, 0.004, -5.9, 1, 1, 1, false);

  // seats for everyone on a break (all sitting): sofa, armchairs and poufs round the coffee table, the bench
  for (const x of [5.85, 6.75, 7.65, 8.55]) COMMON.push(spot(x, -7.1, 0));
  for (const z of [-6.0, -5.0]) COMMON.push(spot(9.4, z, -Math.PI / 2));
  for (const [x, z] of [[6.1, -4.3], [7.3, -4.05], [8.5, -4.35]]) {
    const h = Math.atan2(7.5 - x, -5.7 - z); tubChair(x, z, h); COMMON.push(spot(x, z, h));
  }
  for (const [x, z] of [[5.35, -5.3], [5.35, -6.3], [6.35, -3.15], [8.35, -3.2]]) {
    rbox(fabric(['#C9A66B', '#9DB08A', '#C77B5A', '#7F9AA6'][COMMON.length % 4]), cafe, x, 0.21, z, 0.56, 0.42, 0.56, 0.2);
    blob(x, z, 0.4);
    COMMON.push(spot(x, z, Math.atan2(7.5 - x, -5.7 - z)));
  }
  for (const z of [-2.3, -1.15, 0, 1.15, 2.3]) COMMON.push(spot(COMM_X + 1.05, z, -Math.PI / 2));  // bench
  const SEATED = COMMON.length;
  for (const z of [-1.9, -0.6, 0.7, 2.0]) COMMON.push(spot(COMM_X - 1.05, z, Math.PI / 2));  // communal stools (closed only)
  for (const z of [-2.4, -1.2, 0, 1.2, 2.4]) COMMON.push(spot(4.6, z, Math.PI / 2, true));
  for (const z of [-1.8, -0.6, 0.6, 1.8]) COMMON.push(spot(3.8, z, Math.PI / 2, true));
  for (const x of [5.8, 7.6]) COMMON.push(spot(x, 3.65, Math.PI, true));
}
const BARISTA_SPOTS = [spot(6.7, 3.75, Math.PI, true), spot(5.1, -3.5, 2.2, true)];
const IDLE_SPOTS = [...COMMON.slice(0, 18), ...COMMON.slice(22)];   // 18 seats, then standing room
function overflowSpot(i) {
  const a = i * 0.9, r = 2.6 + Math.floor(i / 7) * 0.7;
  const pos = new THREE.Vector3(4.2 + Math.cos(a) * 0.6, 0, 5.2 + Math.sin(a) * r * 0.4);
  return { pos, heading: Math.atan2(COMM_X - pos.x, 0 - pos.z), stand: true };
}

/* ------------------------------------------------------------------ bench, greenery, lights */
// wooden bench along the front wall, with a planter shelf at the end like the reference
rbox(wood(W.mid), cafe, -5.0, 0.44, 7.55, 4.2, 0.08, 0.55, 0.02);
for (const yy of [0.66, 0.86]) rbox(wood(W.warm), cafe, -5.0, yy, 7.86, 4.2, 0.14, 0.05, 0.015);
for (const x of [-6.9, -3.1]) rbox(wood(W.deep), cafe, x, 0.21, 7.55, 0.1, 0.42, 0.45, 0.015, false);
blob(-5.0, 7.6, 2.3, 0.45);
// planter boxes on the wall tops (greenery spills over the stone like in the reference)
for (const [x, z, w, d, y] of [[-10.25, -0.2, 0.5, 2.2, 1.05], [-10.25, 5.0, 0.5, 1.6, 1.05], [10.25, 2.4, 0.5, 2.0, 1.05], [-6.5, 8.25, 2.0, 0.5, 0.62], [7.2, 8.25, 2.2, 0.5, 0.62]]) {
  rbox(wood(W.dark), cafe, x, y + 0.12, z, w, 0.24, d, 0.02);
}

const leafCards = [], blobsGreen = [];
const LEAF_HUES = [[0.26, 0.42, 0.62], [0.24, 0.38, 0.55], [0.3, 0.32, 0.6], [0.21, 0.45, 0.66], [0.33, 0.28, 0.5], [0.18, 0.5, 0.7]];
const LEAF_N = LOW ? 0.6 : 1;
function leafColor(r) { const c = LEAF_HUES[Math.floor(r() * LEAF_HUES.length)]; return srgb(c[0] + (r() - 0.5) * 0.03, c[1], c[2] + (r() - 0.5) * 0.12); }
function bush(x, y, z, rad, n, seed, sq = 1) {
  const r = rng(seed);
  // a dark, smooth core gives volume; leaf cards give the detail
  for (let i = 0; i < Math.max(1, Math.round(n / 7)); i++) {
    const a = r() * Math.PI * 2, d = r() * rad * 0.35, s = rad * (0.55 + r() * 0.25);
    blobsGreen.push({ x: x + Math.cos(a) * d, y: y + (r() - 0.6) * rad * 0.3 * sq, z: z + Math.sin(a) * d, ry: r() * 6, sx: s, sy: s * 0.8 * sq, sz: s, c: srgb(0.27 + r() * 0.04, 0.35, 0.2 + r() * 0.06) });
  }
  const cards = Math.round(n * 3.2 * LEAF_N);
  for (let i = 0; i < cards; i++) {
    const u = r() * 2 - 1, th = r() * Math.PI * 2, rr = Math.sqrt(1 - u * u);
    const dx = rr * Math.cos(th), dy = Math.abs(u) * 0.8 + 0.1, dz = rr * Math.sin(th);
    const d = rad * (0.55 + r() * 0.5), s = rad * (0.7 + r() * 0.5);
    leafCards.push({ x: x + dx * d, y: y + (dy * d - rad * 0.25) * sq, z: z + dz * d, rx: -Math.PI / 2 + (r() - 0.5) * 1.6, ry: r() * 6.3, rz: (r() - 0.5) * 1.2, sx: s, sy: s, sz: s, c: leafColor(r) });
  }
}
// trailing ivy hanging down a wall or shelf edge
function trail(x, y, z, len, seed, dir = [0, 0]) {
  const r = rng(seed), steps = Math.round(len / 0.12);
  let px = x, pz = z;
  for (let i = 0; i < steps; i++) {
    px += dir[0] * 0.03 + (r() - 0.5) * 0.06; pz += dir[1] * 0.03 + (r() - 0.5) * 0.06;
    const s = 0.22 + r() * 0.16 - i * 0.004;
    leafCards.push({ x: px, y: y - i * 0.12, z: pz, rx: (r() - 0.5) * 1.4, ry: r() * 6.3, rz: (r() - 0.5) * 1.4, sx: s, sy: s, sz: s, c: leafColor(r) });
  }
}
function tree(x, z, h, rad, seed) {
  pot(x, 0, z, 1.5, 0);
  cyl(mat('#6B4A33', { roughness: 0.9 }), cafe, x, h / 2, z, 0.05, h, true, 0.09, 16);
  bush(x, h, z, rad, 26, seed);
  bush(x + rad * 0.35, h * 0.68, z - rad * 0.2, rad * 0.65, 10, seed + 1);
  bush(x - rad * 0.3, h * 0.55, z + rad * 0.25, rad * 0.55, 8, seed + 2);
}
function potPlant(x, z, s, seed, kind = 0) {
  pot(x, 0, z, s, kind);
  bush(x, 0.68 * s, z, 0.34 * s, 10, seed);
}
function succulent(x, y, z, seed) {
  lathe(ceramic, cafe, x, y, z, [[0.001, 0], [0.06, 0], [0.09, 0.12], [0.08, 0.13], [0.001, 0.12]]);
  const r = rng(seed);
  for (let i = 0; i < 9; i++) {
    const a = i * 2.4, tilt = 0.35 + (i % 3) * 0.25;
    leafCards.push({ x: x + Math.cos(a) * 0.03, y: y + 0.17, z: z + Math.sin(a) * 0.03, rx: -Math.PI / 2 + tilt, ry: a, rz: 0, sx: 0.16, sy: 0.16, sz: 0.16, c: srgb(0.36 + r() * 0.05, 0.3, 0.62) });
  }
}
// corners and walls overflowing with greenery
tree(-9.3, 7.3, 2.2, 1.3, 31); tree(9.3, 7.3, 2.4, 1.4, 33); tree(9.5, -1.4, 2.0, 1.0, 35); tree(-9.4, -6.2, 2.1, 1.0, 37);
bush(-9.9, 1.25, -0.2, 0.9, 16, 41); bush(-9.9, 1.25, 5.0, 0.9, 14, 43); bush(-10.0, 1.15, -3.4, 0.8, 10, 45);
bush(10.0, 1.25, 2.4, 0.85, 14, 47); bush(10.0, 1.15, 5.2, 0.7, 10, 49);
bush(2.2, 1.6, -8.3, 0.9, 16, 51); bush(3.4, 1.55, -8.2, 0.7, 10, 53); bush(5.5, 1.65, -8.4, 0.6, 9, 54);
bush(-6.5, 0.85, 8.3, 0.8, 12, 55); bush(-0.4, 0.75, 8.3, 0.7, 10, 56); bush(7.2, 0.85, 8.3, 0.9, 14, 57); bush(8.6, 0.75, 8.3, 0.6, 8, 58);
for (let i = 0; i < 7; i++) trail(-9.95, 1.2, -1.1 + i * 0.3, 0.7 + (i % 3) * 0.2, 100 + i, [1, 0]);
for (let i = 0; i < 5; i++) trail(-9.95, 1.2, 4.4 + i * 0.3, 0.6 + (i % 2) * 0.3, 110 + i, [1, 0]);
for (let i = 0; i < 6; i++) trail(9.95, 1.2, 1.6 + i * 0.32, 0.6 + (i % 3) * 0.2, 120 + i, [-1, 0]);
for (let i = 0; i < 7; i++) trail(-7.4 + i * 0.3, 0.8, 7.95, 0.5 + (i % 3) * 0.12, 130 + i, [0, -1]);
for (let i = 0; i < 7; i++) trail(6.2 + i * 0.32, 0.8, 7.95, 0.5 + (i % 2) * 0.15, 140 + i, [0, -1]);
for (let i = 0; i < 6; i++) trail(1.8 + i * 0.35, 1.55, -7.95, 0.9 + (i % 3) * 0.25, 150 + i, [0, 1]);
for (let i = 0; i < 5; i++) trail(-9.6 + i * 0.9, 2.36, -7.85, 0.5 + (i % 2) * 0.3, 160 + i, [0, 1]);
for (let i = 0; i < 4; i++) bush(-9.4 + i * 1.1, 2.42, -8.0, 0.22, 4, 170 + i);
potPlant(1.6, -7.5, 1.3, 61, 1); potPlant(-1.3, 7.3, 1.1, 63, 0); potPlant(2.0, 7.4, 0.9, 64, 2); potPlant(-9.4, -3.3, 1.0, 65, 0);
potPlant(5.0, -3.0, 0.9, 66, 3); potPlant(9.5, 3.8, 1.0, 67, 1); potPlant(-1.5, -3.6, 0.8, 68, 2);
for (const [z, s] of [[-2.4, 71], [0.1, 72], [2.6, 73]]) succulent(COMM_X + 0.3, 0.76, z, s);
succulent(-6.9, 0.77, -1.4, 74); succulent(-3.2, 0.77, 3.2, 75); succulent(0.6, 0.76, 1.6, 76);
succulent(-8.95, BAR_H, -3.3, 77); succulent(4.4, 0.9, -7.75, 78); succulent(-3.3, 0.77, -1.0, 79); succulent(-7.0, 0.77, 2.8, 80);
{
  const leafMat = new THREE.MeshStandardMaterial({ map: leafTex, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.75, metalness: 0 });
  const leafDepth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: leafTex, alphaTest: 0.45, side: THREE.DoubleSide });
  instanced(new THREE.PlaneGeometry(1, 1), leafCards, leafMat, { depth: leafDepth });
  instanced(new THREE.IcosahedronGeometry(1, 2), blobsGreen, new THREE.MeshStandardMaterial({ roughness: 0.95 }));
}

// pendant bulbs (+ a few warm point lights under them)
const bulbMat = new THREE.MeshBasicMaterial({ color: '#FFE4B8', toneMapped: false });
const cordMat = mat('#1E1A17');
function pendant(x, z, y = 2.45) {
  cyl(cordMat, cafe, x, y + 1.6, z, 0.008, 3.2, false, 0.008, 6);
  lathe(blackMetal, cafe, x, y + 0.06, z, [[0.001, 0.14], [0.03, 0.14], [0.035, 0.08], [0.11, 0.0], [0.115, 0.0], [0.04, 0.09], [0.035, 0.15], [0.001, 0.15]]);
  mesh(G.sphere, bulbMat, cafe, x, y, z, 0.06, 0.075, 0.06, false);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: '#FFFFFF', transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
  sp.position.set(x, y, z); sp.scale.setScalar(0.75); cafe.add(sp); glowSprites.push(sp);
}
for (const x of [-7.6, -6.2, -4.8, -3.4]) pendant(x, BAR_Z, 2.5);
for (const z of [-1.6, 0.2, 2.0]) pendant(COMM_X, z, 2.3);
for (const [x, z] of [[-6.9, -1.4], [-3.3, -1.0], [-7.0, 2.8], [-3.2, 3.2], [0.6, 0.6], [7.5, -5.7]]) pendant(x, z, 2.4);
for (const [x, z] of [[-6.9, -4.6], [-3.6, -4.6], [COMM_X, -1.0], [COMM_X, 1.6], [-5.0, 0.8], [-5.0, 3.0], [0.6, 0.6], [7.5, -5.7]]) {
  if (LOW && pointLights.length % 2) { pointLights.push(null); continue; } // phones: half the bulbs cast light
  const l = new THREE.PointLight('#FFC27E', LIGHT_BASE.point * (LOW ? 1.5 : 1), 6.5, 1.5); l.position.set(x, 2.1, z); cafe.add(l); pointLights.push(l);
}
for (let i = pointLights.length - 1; i >= 0; i--) if (!pointLights[i]) pointLights.splice(i, 1);
instanced(new THREE.PlaneGeometry(1, 1), blobs, new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false, color: '#000000', opacity: 0.85 }), { shadow: false, receive: false }).renderOrder = -1;

// static batching: every static mesh is merged per material into one draw call
(function bakeStatic() {
  cafe.updateMatrixWorld(true);
  const groups = new Map(), drop = [];
  cafe.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh) return;
    const k = o.material.uuid + (o.castShadow ? 's' : 'n');
    if (!groups.has(k)) groups.set(k, { material: o.material, cast: o.castShadow, geos: [] });
    const g = o.geometry.clone().applyMatrix4(o.matrixWorld);
    for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    if (!g.index) g.setIndex([...Array(g.attributes.position.count).keys()]);
    groups.get(k).geos.push(g); drop.push(o);
  });
  for (const { material, cast, geos } of groups.values()) {
    const merged = geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
    if (!merged) continue;
    const m = new THREE.Mesh(merged, material); m.castShadow = cast; m.receiveShadow = true;
    m.userData.baked = true; cafe.add(m);
  }
  for (const o of drop) o.parent.remove(o);
  for (const g of geoCache.values()) g.dispose();
  geoCache.clear();
  for (const c of [...cafe.children]) if (c.isGroup && !c.children.length) cafe.remove(c);
})();

/* ------------------------------------------------------------------ characters */
// Each body part (legs, torso, head, eyes, arms, props) is baked into one vertex-coloured mesh, so a whole
// character is ~10 draw calls. A shared fresnel rim and an inverted-hull outline give the stylised look.
const charMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.58, metalness: 0 });
charMat.onBeforeCompile = (sh) => {
  sh.fragmentShader = sh.fragmentShader.replace('#include <opaque_fragment>',
    `{ float rimF = pow(1.0 - saturate(dot(geometryNormal, geometryViewDir)), 2.6);
       outgoingLight += vec3(1.0, 0.88, 0.74) * rimF * 0.32; }
     #include <opaque_fragment>`);
};
const eyeMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.2, metalness: 0 });
const outlineMat = new THREE.MeshBasicMaterial({ color: '#2A1E17', side: THREE.BackSide });
outlineMat.onBeforeCompile = (sh) => {
  sh.vertexShader = sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed += normalize(normal) * 0.016;');
};
const CG = {
  head: new THREE.SphereGeometry(1, 28, 20),
  sph: new THREE.SphereGeometry(1, 16, 12),
  sphLo: new THREE.SphereGeometry(1, 8, 6),
  hemi: new THREE.SphereGeometry(1, 22, 8, 0, Math.PI * 2, 0, Math.PI / 2),
  cyl: new THREE.CylinderGeometry(1, 1, 1, 16),
  cylLo: new THREE.CylinderGeometry(1, 1, 1, 10),
  brim: new THREE.CylinderGeometry(1, 0.78, 1, 36),
  cone: new THREE.ConeGeometry(1, 1, 18),
  leg: new THREE.CapsuleGeometry(0.1, 0.26, 4, 14),
  arm: new THREE.CapsuleGeometry(0.07, 0.27, 4, 12),
  rbox: new RoundedBoxGeometry(1, 1, 1, 2, 0.2),
  torso: null,
};
// torso profile (y, radius) — narrow waist, rounded chest and shoulders
const TORSO = [[0, 0.17], [0.06, 0.21], [0.2, 0.218], [0.36, 0.245], [0.48, 0.262], [0.56, 0.245], [0.62, 0.18], [0.66, 0.08], [0.67, 0.001]];
const TORSO_Z = 0.8;
CG.torso = new THREE.LatheGeometry([new THREE.Vector2(0.001, 0), ...TORSO.map(([y, r]) => new THREE.Vector2(r, y))], 24);
function torsoR(y) {
  for (let i = 1; i < TORSO.length; i++) if (y <= TORSO[i][0]) { const [y0, r0] = TORSO[i - 1], [y1, r1] = TORSO[i]; return r0 + (r1 - r0) * (y - y0) / (y1 - y0); }
  return 0.001;
}
const frontZ = (y) => torsoR(y) * TORSO_Z;
const torusCache = new Map();
function torusG(R, t, arc = Math.PI * 2, rs = 6, ts = 24) {
  const k = [R, t, arc, rs, ts].join();
  if (!torusCache.has(k)) torusCache.set(k, new THREE.TorusGeometry(R, t, rs, ts, arc));
  return torusCache.get(k);
}
const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color();
class Parts {
  constructor() { this.geos = []; }
  add(geo, color, x = 0, y = 0, z = 0, sx = 1, sy = sx, sz = sx, rx = 0, ry = 0, rz = 0) {
    const g = geo.clone();
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
    if (!g.index) g.setIndex([...Array(g.attributes.position.count).keys()]);
    g.applyMatrix4(_m4.compose(_p.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), _s.set(sx, sy, sz)));
    _c.set(color);
    const n = g.attributes.position.count, col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { col[i * 3] = _c.r; col[i * 3 + 1] = _c.g; col[i * 3 + 2] = _c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.geos.push(g);
    return this;
  }
  build(parent, { outline = true, material = charMat, shadow = true } = {}) {
    if (!this.geos.length) return null;
    const geo = mergeGeometries(this.geos, false);
    this.geos.forEach((g) => g.dispose());
    const m = new THREE.Mesh(geo, material); m.castShadow = shadow; m.receiveShadow = true;
    parent.add(m);
    if (outline) { const o = new THREE.Mesh(geo, outlineMat); o.castShadow = false; parent.add(o); }
    return m;
  }
}
const shade = (hex, k) => '#' + new THREE.Color(hex).multiplyScalar(k).getHexString();

const SKIN = ['#F7D9C4', '#EFC5A3', '#E0AA84', '#C68B63', '#A06A48', '#7A4C33', '#FBE5D6'];
const HAIR = ['#2A211E', '#4A3226', '#77492A', '#B8763E', '#E3C07A', '#A63D2B', '#232A38', '#CFC9C0', '#5C3E78', '#2E6B66'];
const TOPS = ['#E76F51', '#2A9D8F', '#264653', '#E9C46A', '#8D6CAB', '#F28482', '#457B9D', '#6A994E', '#D4A373', '#BC4749', '#3D5A80', '#F4A261', '#5E548E', '#E5989B', '#84A59D'];
const PANTS = ['#2E3440', '#3B4A6B', '#4A3F35', '#56634A', '#6B6F78', '#283044', '#8A6E52', '#C9B79C'];
const SHOES = ['#F4F1EA', '#2B2B2B', '#7A4A2C', '#C0392B', '#3D5A80', '#E9C46A'];
const IRIS = ['#3E2A1E', '#2F5D7C', '#3C6E47', '#6B4A2F', '#1E1E2A', '#5B6B7A'];

// role looks for the named team; everyone else gets a look from their id hash
const ROLE_LOOKS = [
  [/artist/i, { top: 'tee', stripes: '#2B3A55', topCol: '#F5F0E6', pants: '#3B4A6B', hair: 'bob', hat: 'beret', hatCol: '#C0392B', neck: 'scarf', neckCol: '#E9C46A', prop: 'palette' }],
  [/coder\s*1|web/i, { top: 'hoodie', topCol: '#264653', pants: '#2E3440', hair: 'short', phones: 'headphones', phonesCol: '#2A9D8F', glasses: 'square', glassCol: '#1E1E1E', shoes: '#F4F1EA' }],
  [/coder\s*2|\bapp\b/i, { top: 'hoodie', topCol: '#5E548E', pants: '#283044', hair: 'curly', phones: 'headphones', phonesCol: '#F4A261', shoes: '#C0392B' }],
  [/customer|service|support/i, { top: 'sweater', topCol: '#84A59D', pants: '#4A3F35', hair: 'ponytail', phones: 'headset', phonesCol: '#2B2B2B', neck: 'lanyard', neckCol: '#E76F51' }],
  [/mac/i, { top: 'turtleneck', topCol: '#1F2124', pants: '#3B4A6B', hair: 'buzz', glasses: 'round', glassCol: '#8C8C8C', shoes: '#F4F1EA' }],
  [/bug/i, { top: 'jacket', topCol: '#6A994E', inner: '#F2E8CF', pants: '#4A3F35', hair: 'short', hat: 'bucket', hatCol: '#C9A66B', glasses: 'round', glassCol: '#3A2A20', prop: 'magnifier' }],
  [/social/i, { top: 'jacket', topCol: '#4D7EA8', inner: '#F28482', pants: '#2E3440', hair: 'long', hat: 'capBack', hatCol: '#F28482', prop: 'phone', shoes: '#F4F1EA' }],
  [/content/i, { top: 'hoodie', topCol: '#F4A261', pants: '#56634A', hair: 'short', hat: 'beanie', hatCol: '#2A9D8F', neck: 'binoculars', prop: 'notebook', propCol: '#2A9D8F' }],
  [/rivals?\s*manager|manager/i, { top: 'blazer', topCol: '#283044', inner: '#F5F0E6', neck: 'tie', neckCol: '#BC4749', pants: '#283044', hair: 'short', glasses: 'square', glassCol: '#3A2A20', prop: 'notebook', propCol: '#7A4A2C', shoes: '#2B2B2B' }],
  [/ads/i, { top: 'jacket', topCol: '#6B705C', inner: '#E9C46A', pants: '#3B4A6B', hair: 'spiky', hat: 'cap', hatCol: '#E9C46A', neck: 'binoculars', prop: 'phone' }],
  [/feature/i, { top: 'sweater', topCol: '#E9C46A', pants: '#3B4A6B', hair: 'bun', glasses: 'round', glassCol: '#5C3E78', neck: 'scarf', neckCol: '#5E548E', prop: 'notebook', propCol: '#BC4749' }],
  [/trend/i, { top: 'hoodie', topCol: '#B79CED', pants: '#2E3440', hair: 'long', hat: 'bucket', hatCol: '#F5F0E6', glasses: 'square', glassCol: '#E76F51', prop: 'tablet' }],
];
function lookFor(id, name, r) {
  const pick = (a) => a[Math.floor(r() * a.length)];
  const base = {
    skin: pick(SKIN), hairCol: pick(HAIR), iris: pick(IRIS), topCol: pick(TOPS), pants: pick(PANTS), shoes: pick(SHOES),
    top: pick(['hoodie', 'hoodie', 'jacket', 'sweater', 'tee', 'turtleneck']), inner: pick(['#F5F0E6', '#E9C46A', '#2B2B2B', '#F28482']),
    hair: pick(['short', 'bob', 'bun', 'ponytail', 'curly', 'spiky', 'long', 'buzz']),
    hat: r() < 0.42 ? pick(['beanie', 'cap', 'capBack', 'beret', 'bucket']) : null, hatCol: pick(TOPS),
    glasses: r() < 0.3 ? pick(['round', 'square']) : null, glassCol: pick(['#1E1E1E', '#7A4A2C', '#8C8C8C', '#BC4749']),
    phones: r() < 0.18 ? 'headphones' : null, phonesCol: pick(TOPS),
    neck: r() < 0.2 ? 'scarf' : null, neckCol: pick(TOPS), stripes: r() < 0.15 ? pick(['#264653', '#BC4749']) : null, prop: null,
  };
  const role = ROLE_LOOKS.find(([re]) => re.test(name || ''));
  return role ? { ...base, ...role[1] } : base;
}

function makeCharacter(id, opts = {}) {
  const r = rng(hashStr(id));
  const L = lookFor(id, opts.name, r);
  if (opts.shirt) { L.top = 'apron'; L.topCol = opts.shirt; L.apron = opts.apron; L.hat = null; L.glasses = null; L.phones = null; L.neck = null; L.prop = null; L.stripes = null; }
  if (opts.hair) L.hair = opts.hair;
  const skin = L.skin, hairC = L.hairCol, top = L.topCol;
  const sleeve = L.top === 'apron' ? L.topCol : top;

  const root = new THREE.Group();
  const body = new THREE.Group(); root.add(body);
  const hips = new THREE.Group(); hips.position.y = 0.56; body.add(hips);
  const legs = [-1, 1].map((s) => {
    const g = new THREE.Group(); g.position.set(s * 0.115, 0, 0); hips.add(g);
    new Parts()
      .add(CG.leg, L.pants, 0, -0.2, 0)
      .add(CG.sph, L.shoes, 0, -0.445, 0.045, 0.1, 0.075, 0.155)
      .add(CG.sph, shade(L.shoes, 0.55), 0, -0.49, 0.045, 0.105, 0.025, 0.16)
      .build(g);
    return g;
  });
  const upper = new THREE.Group(); hips.add(upper);
  const U = new Parts();
  U.add(CG.torso, top, 0, 0, 0, 1, 1, TORSO_Z);
  U.add(CG.sph, L.pants, 0, 0.02, 0, 0.215, 0.13, 0.17);
  for (const s of [-1, 1]) U.add(CG.sph, sleeve, s * 0.245, 0.52, 0, 0.1, 0.1, 0.1);
  U.add(CG.cyl, skin, 0, 0.7, 0, 0.07, 0.12, 0.07);
  const fz = (y) => frontZ(y);
  if (L.top === 'hoodie') {
    U.add(torusG(0.14, 0.06), top, 0, 0.64, -0.05, 1.15, 1, 1, Math.PI / 2 - 0.55);
    U.add(CG.rbox, shade(top, 0.86), 0, 0.17, fz(0.17) + 0.003, 0.26, 0.12, 0.03);
    for (const s of [-1, 1]) { U.add(CG.cylLo, '#F5F0E6', s * 0.04, 0.53, fz(0.53) + 0.012, 0.008, 0.14, 0.008); U.add(CG.sphLo, '#F5F0E6', s * 0.04, 0.455, fz(0.46) + 0.014, 0.013); }
    U.add(torusG(0.205, 0.03), shade(top, 0.85), 0, 0.02, 0, 1, 1, TORSO_Z, Math.PI / 2);
  } else if (L.top === 'jacket' || L.top === 'blazer') {
    U.add(CG.rbox, L.inner, 0, 0.36, fz(0.36) - 0.014, 0.19, 0.48, 0.05);
    for (const s of [-1, 1]) {
      U.add(CG.rbox, shade(top, 0.82), s * 0.09, 0.5, fz(0.5) - 0.002, 0.07, 0.2, 0.03, 0, 0, s * 0.42);
      U.add(CG.rbox, shade(top, 0.9), s * 0.1, 0.27, fz(0.27) - 0.004, 0.05, 0.38, 0.03);
    }
    for (const y of [0.2, 0.32]) U.add(CG.sphLo, shade(top, 0.6), 0.1, y, fz(y) + 0.008, 0.014);
    if (L.top === 'blazer') U.add(torusG(0.11, 0.022), L.inner, 0, 0.64, 0, 1, 1, 0.9, Math.PI / 2);
  } else if (L.top === 'turtleneck') {
    U.add(CG.cyl, top, 0, 0.7, 0, 0.1, 0.12, 0.1);
    U.add(torusG(0.1, 0.03), shade(top, 1.4), 0, 0.76, 0, 1, 1, 1, Math.PI / 2);
  } else if (L.top === 'sweater') {
    U.add(torusG(0.09, 0.026), shade(top, 0.8), 0, 0.655, 0, 1, 1, 1, Math.PI / 2);
    U.add(torusG(0.205, 0.03), shade(top, 0.8), 0, 0.03, 0, 1, 1, TORSO_Z, Math.PI / 2);
    for (let i = 0; i < 2; i++) U.add(torusG(1, 0.04, Math.PI * 2, 6, 40), shade(top, 0.92), 0, 0.3 + i * 0.08, 0, torsoR(0.3 + i * 0.08) + 0.004, torsoR(0.3 + i * 0.08) + 0.004, (torsoR(0.3 + i * 0.08) + 0.004) * TORSO_Z, Math.PI / 2);
  } else if (L.top === 'tee') {
    U.add(torusG(0.08, 0.015), shade(top, 0.8), 0, 0.66, 0, 1, 1, 1, Math.PI / 2);
  } else if (L.top === 'apron') {
    U.add(CG.rbox, L.apron, 0, 0.26, fz(0.26) + 0.005, 0.36, 0.48, 0.03);
    U.add(CG.rbox, L.apron, 0, 0.5, fz(0.5) - 0.002, 0.24, 0.12, 0.03);
    U.add(torusG(0.205, 0.016), L.apron, 0, 0.12, 0, 1.06, 1.06, TORSO_Z * 1.06, Math.PI / 2);
    U.add(CG.rbox, shade(L.apron, 0.8), 0, 0.2, fz(0.2) + 0.022, 0.2, 0.1, 0.01);
  }
  if (L.stripes) for (let i = 0; i < 5; i++) { const y = 0.12 + i * 0.09, R = torsoR(y) + 0.003; U.add(torusG(1, 0.035, Math.PI * 2, 6, 48), L.stripes, 0, y, 0, R, R, R * TORSO_Z, Math.PI / 2); }
  if (L.neck === 'scarf') {
    U.add(torusG(0.105, 0.05), L.neckCol, 0, 0.64, 0.01, 1, 1, 1, Math.PI / 2 - 0.15);
    U.add(CG.rbox, L.neckCol, 0.06, 0.48, fz(0.48) + 0.03, 0.08, 0.24, 0.035, -0.1, 0, 0.12);
    U.add(CG.rbox, shade(L.neckCol, 0.8), 0.07, 0.36, fz(0.36) + 0.04, 0.085, 0.03, 0.037, -0.1, 0, 0.12);
  } else if (L.neck === 'tie') {
    U.add(CG.rbox, L.neckCol, 0, 0.4, fz(0.4) + 0.006, 0.05, 0.3, 0.018);
    U.add(CG.sphLo, shade(L.neckCol, 0.85), 0, 0.57, fz(0.57) + 0.004, 0.028, 0.024, 0.018);
  } else if (L.neck === 'lanyard') {
    for (const s of [-1, 1]) U.add(CG.cylLo, L.neckCol, s * 0.05, 0.52, fz(0.52) + 0.006, 0.008, 0.22, 0.008, 0.2, 0, -s * 0.35);
    U.add(CG.rbox, '#F5F0E6', 0, 0.36, fz(0.36) + 0.01, 0.08, 0.1, 0.012);
    U.add(CG.rbox, L.neckCol, 0, 0.39, fz(0.39) + 0.016, 0.06, 0.02, 0.004);
  } else if (L.neck === 'binoculars') {
    for (const s of [-1, 1]) {
      U.add(CG.cyl, '#2B2B2B', s * 0.045, 0.38, fz(0.38) + 0.05, 0.035, 0.1, 0.035, Math.PI / 2);
      U.add(CG.cyl, '#7FB8E6', s * 0.045, 0.38, fz(0.38) + 0.101, 0.026, 0.004, 0.026, Math.PI / 2);
      U.add(CG.cylLo, '#7A4A2C', s * 0.1, 0.52, fz(0.52) + 0.006, 0.008, 0.28, 0.008, 0.15, 0, -s * 0.5);
    }
    U.add(CG.rbox, '#3A3A3A', 0, 0.38, fz(0.38) + 0.05, 0.04, 0.04, 0.06);
  }
  U.build(upper);

  const head = new THREE.Group(); head.position.y = 0.9; head.scale.setScalar(1.08); upper.add(head);
  const HR = [0.29, 0.275, 0.27];
  const zs = (x, y) => HR[2] * Math.sqrt(Math.max(0, 1 - (x / HR[0]) ** 2 - (y / HR[1]) ** 2));
  const Hd = new Parts();
  Hd.add(CG.head, skin, 0, 0, 0, HR[0], HR[1], HR[2]);
  for (const s of [-1, 1]) {
    Hd.add(CG.sph, skin, s * 0.282, -0.02, 0, 0.045, 0.065, 0.04);
    Hd.add(CG.sphLo, '#F29E8E', s * 0.16, -0.08, zs(s * 0.16, -0.08) - 0.006, 0.045, 0.026, 0.012);
    Hd.add(CG.rbox, shade(hairC, 0.85), s * 0.1, 0.105, zs(s * 0.1, 0.105) + 0.002, 0.075, 0.018, 0.016, -0.25, 0, -s * 0.12);
  }
  Hd.add(CG.sph, shade(skin, 0.94), 0, -0.05, zs(0, -0.05) + 0.004, 0.028, 0.024, 0.022);
  Hd.add(torusG(0.034, 0.009, Math.PI, 8, 20), '#6B2E2A', 0, -0.105, zs(0, -0.12) - 0.004, 1, 1, 1, -0.2, 0, Math.PI);
  // hair
  const hatOn = !!L.hat;
  const hs = L.hair;
  if (hs !== 'buzz' || !hatOn) Hd.add(CG.hemi, hairC, 0, 0.0, -0.005, 0.302, hs === 'buzz' ? 0.29 : 0.31, 0.295, -0.22);
  Hd.add(CG.sph, hairC, 0, -0.03, -0.05, 0.288, 0.23, 0.262);
  if (!hatOn && hs !== 'buzz') {
    Hd.add(CG.sph, hairC, 0.04, 0.19, 0.17, 0.2, 0.08, 0.1, -0.55, 0, -0.15);
    Hd.add(CG.sph, hairC, -0.13, 0.17, 0.17, 0.12, 0.07, 0.09, -0.5, 0, 0.3);
  }
  if (hs === 'bob' || hs === 'long') {
    for (const s of [-1, 1]) Hd.add(CG.sph, hairC, s * 0.25, -0.07, -0.03, 0.09, 0.2, 0.17);
    Hd.add(CG.sph, hairC, 0, -0.09, -0.08, 0.3, 0.24, 0.24);
    if (hs === 'long') Hd.add(CG.sph, hairC, 0, -0.3, -0.13, 0.25, 0.26, 0.12, 0.25);
  } else if (hs === 'bun') {
    Hd.add(CG.sph, hairC, 0, 0.27, -0.12, 0.12); Hd.add(torusG(0.07, 0.02), shade(top, 0.9), 0, 0.21, -0.1, 1, 1, 1, Math.PI / 2 - 0.5);
  } else if (hs === 'ponytail') {
    Hd.add(CG.sph, L.neckCol || '#E76F51', 0, 0.11, -0.285, 0.035);
    Hd.add(CG.sph, hairC, 0, -0.08, -0.33, 0.08, 0.2, 0.08, 0.3);
  } else if (hs === 'curly' && !hatOn) {
    const rr = rng(hashStr(id) + 9);
    for (let i = 0; i < 22; i++) {
      const th = rr() * Math.PI * 2, ph = rr() * 1.25; const x = Math.sin(ph) * Math.cos(th), y = Math.cos(ph), z = Math.sin(ph) * Math.sin(th);
      if (z > 0.55 && y < 0.75) continue;
      Hd.add(CG.sphLo, shade(hairC, 0.9 + rr() * 0.2), x * 0.29, y * 0.29 + 0.01, z * 0.28 - 0.02, 0.085);
    }
  } else if (hs === 'spiky' && !hatOn) {
    for (let i = 0; i < 7; i++) { const a = -0.9 + i * 0.3; Hd.add(CG.cone, hairC, Math.sin(a) * 0.15, 0.3, 0.04 - Math.abs(a) * 0.05, 0.07, 0.16, 0.07, -0.3, 0, -a * 0.6); }
  }
  // hats
  const hc = L.hatCol;
  if (L.hat === 'beanie') {
    Hd.add(CG.hemi, hc, 0, 0.03, 0, 0.312, 0.34, 0.31);
    Hd.add(torusG(0.3, 0.05), shade(hc, 0.88), 0, 0.06, 0, 1.02, 1, 0.98, Math.PI / 2);
    Hd.add(CG.sph, '#F5F0E6', 0, 0.38, 0, 0.075);
  } else if (L.hat === 'cap' || L.hat === 'capBack') {
    const b = L.hat === 'cap' ? 1 : -1;
    Hd.add(CG.hemi, hc, 0, 0.04, 0, 0.306, 0.28, 0.306);
    Hd.add(CG.cyl, shade(hc, 0.85), 0, 0.075, b * 0.29, 0.19, 0.022, 0.15, b * 0.12);
    Hd.add(CG.sphLo, shade(hc, 0.8), 0, 0.32, 0, 0.03);
  } else if (L.hat === 'beret') {
    Hd.add(CG.sph, hc, 0.04, 0.22, -0.02, 0.28, 0.085, 0.27, 0, 0, -0.26);
    Hd.add(CG.cylLo, shade(hc, 0.8), 0.1, 0.34, -0.02, 0.015, 0.05, 0.015, 0, 0, -0.28);
  } else if (L.hat === 'bucket') {
    Hd.add(CG.hemi, hc, 0, 0.06, 0, 0.29, 0.29, 0.29);
    Hd.add(CG.brim, shade(hc, 0.92), 0, 0.07, 0, 0.37, 0.05, 0.37);
    Hd.add(torusG(0.285, 0.018), shade(hc, 0.7), 0, 0.12, 0, 1, 1, 1, Math.PI / 2);
  }
  if (L.phones === 'headphones' || L.phones === 'headset') {
    const pc = L.phonesCol;
    Hd.add(torusG(0.32, 0.024, Math.PI, 10, 40), '#2B2B2B', 0, 0.02, -0.02, 1, 1.02, 1);
    const sides = L.phones === 'headset' ? [1] : [-1, 1];
    for (const s of sides) { Hd.add(CG.cyl, pc, s * 0.305, -0.01, -0.01, 0.09, 0.07, 0.09, 0, 0, Math.PI / 2); Hd.add(CG.cyl, '#2B2B2B', s * 0.345, -0.01, -0.01, 0.065, 0.02, 0.065, 0, 0, Math.PI / 2); }
    if (L.phones === 'headset') { Hd.add(CG.cylLo, '#2B2B2B', 0.24, -0.11, 0.17, 0.008, 0.24, 0.008, Math.PI / 2, 0, 0.5); Hd.add(CG.sphLo, '#2B2B2B', 0.17, -0.14, 0.27, 0.025); }
  }
  if (L.glasses) {
    const gc = L.glassCol, sq = L.glasses === 'square';
    for (const s of [-1, 1]) {
      Hd.add(torusG(0.06, 0.011, Math.PI * 2, 6, sq ? 4 : 28), gc, s * 0.1, 0.01, zs(s * 0.1, 0.01) + 0.035, sq ? 1.15 : 1, sq ? 0.85 : 1, 1, 0, 0, sq ? Math.PI / 4 : 0);
      Hd.add(CG.cylLo, gc, s * 0.27, 0.02, 0.13, 0.009, 0.24, 0.009, Math.PI / 2 - 0.05);
    }
    Hd.add(CG.cylLo, gc, 0, 0.025, zs(0, 0.02) + 0.03, 0.008, 0.07, 0.008, 0, 0, Math.PI / 2);
  }
  Hd.build(head);
  // eyes: white, iris, pupil and a catch-light — blinking squashes this group
  const eyes = new THREE.Group(); head.add(eyes);
  const E = new Parts();
  for (const s of [-1, 1]) {
    const x = s * 0.1, y = 0.01, z = zs(x, y);
    E.add(CG.sph, '#FFFFFF', x, y, z - 0.008, 0.056, 0.068, 0.026);
    E.add(CG.sph, L.iris, x, y - 0.006, z + 0.009, 0.04, 0.05, 0.016);
    E.add(CG.sphLo, '#0E0B0A', x, y - 0.006, z + 0.019, 0.023, 0.03, 0.01);
    E.add(CG.sphLo, '#FFFFFF', x + 0.016, y + 0.018, z + 0.027, 0.013, 0.013, 0.006);
  }
  E.build(eyes, { outline: false, material: eyeMat, shadow: false });
  const anchor = new THREE.Object3D(); anchor.position.y = 0.58; head.add(anchor);

  const arms = [1, -1].map((s) => { // [left(+x), right(-x)]
    const g = new THREE.Group(); g.position.set(s * 0.3, 0.52, 0); upper.add(g);
    const A = new Parts();
    if (L.top === 'tee') { A.add(CG.cyl, sleeve, 0, -0.08, 0, 0.085, 0.16, 0.085); A.add(CG.arm, skin, 0, -0.2, 0, 0.92); }
    else { A.add(CG.arm, sleeve, 0, -0.2, 0); A.add(torusG(0.068, 0.02), shade(sleeve, 0.85), 0, -0.37, 0, 1, 1, 1, Math.PI / 2); }
    A.add(CG.sph, skin, 0, -0.43, 0.005, 0.07, 0.075, 0.068);
    A.build(g);
    return g;
  });
  const cup = new THREE.Group(); cup.position.set(0, -0.45, 0.07); arms[1].add(cup);
  new Parts()
    .add(CG.cyl, '#FBF7F0', 0, 0, 0, 0.06, 0.13, 0.06)
    .add(CG.cyl, '#5A3420', 0, 0.064, 0, 0.052, 0.004, 0.052)
    .add(torusG(0.03, 0.01), '#FBF7F0', 0.065, 0, 0, 1, 1, 1)
    .build(cup, { outline: false, shadow: false });
  const prop = new THREE.Group(); prop.position.set(0, -0.47, 0.07); arms[0].add(prop);
  const P = new Parts();
  if (L.prop === 'palette') {
    P.add(CG.cyl, '#C9A273', 0.02, 0, 0.02, 0.14, 0.014, 0.11);
    ['#E63946', '#F4D35E', '#2A9D8F', '#457B9D', '#F5F0E6'].forEach((c, i) => P.add(CG.sphLo, c, -0.06 + i * 0.035, 0.012, 0.05 - (i % 2) * 0.04, 0.02, 0.01, 0.02));
    P.add(CG.cylLo, '#7A4A2C', 0.1, 0.04, -0.02, 0.008, 0.2, 0.008, 0.4, 0, -0.9);
  } else if (L.prop === 'magnifier') {
    P.add(CG.cyl, '#5E4130', 0, 0.03, 0, 0.016, 0.12, 0.016);
    P.add(torusG(0.06, 0.013, Math.PI * 2, 10, 32), '#C9A15A', 0, 0.15, 0, 1, 1, 1);
    P.add(CG.cyl, '#BFE3F2', 0, 0.15, 0, 0.055, 0.006, 0.055, Math.PI / 2);
  } else if (L.prop === 'phone') {
    P.add(CG.rbox, '#1E1E22', 0, 0.04, 0, 0.075, 0.14, 0.014, -0.7);
    P.add(CG.rbox, '#8FD3F5', 0, 0.044, 0.006, 0.064, 0.12, 0.006, -0.7);
  } else if (L.prop === 'notebook') {
    P.add(CG.rbox, L.propCol || '#2A9D8F', 0, 0.04, 0, 0.15, 0.19, 0.026, -0.5);
    P.add(CG.rbox, '#FBF7F0', 0.008, 0.04, 0.002, 0.14, 0.18, 0.024, -0.5);
    P.add(CG.cylLo, '#E9C46A', -0.05, 0.08, 0.05, 0.006, 0.14, 0.006, -0.5, 0, 0.6);
  } else if (L.prop === 'tablet') {
    P.add(CG.rbox, '#2B2B2B', 0, 0.04, 0, 0.22, 0.15, 0.012, -0.6);
    P.add(CG.rbox, '#F5F0E6', 0, 0.043, 0.006, 0.2, 0.13, 0.004, -0.6);
    ['#2A9D8F', '#E9C46A', '#E76F51', '#8D6CAB'].forEach((c, i) => P.add(CG.rbox, c, -0.06 + i * 0.04, 0.02 + i * 0.012, 0.004 + (0.02 + i * 0.012) * 0.0, 0.025, 0.03 + i * 0.022, 0.006, -0.6));
  }
  P.build(prop, { outline: false });
  return { root, body, hips, legs, upper, head, eyes, arms, cup, prop, anchor, blinkAt: 1 + r() * 4, seed: r() * 100 };
}

// Poses. Each returns a full pose; poses are blended by per-pose weights for smooth transitions.
const BASE = { rise: 0, lean: 0, turn: 0, aLx: -1.1, aLz: 0, aRx: -1.1, aRz: 0, hX: 0, hZ: 0, cup: 0, prop: 0, bob: 0, swing: 0, back: 0, breathe: 1 };
const POSE_KEYS = Object.keys(BASE);
const POSES = {
  writing: (t) => ({ ...BASE, lean: 0.12, hX: 0.15, aLx: -1.1 + Math.sin(t * 22) * 0.13, aRx: -1.1 + Math.cos(t * 22) * 0.13 }),
  running: (t) => ({ ...BASE, lean: 0.08, hX: 0.1, aLx: -1.1 + Math.sin(t * 14) * 0.1, aRx: -1.1 + Math.cos(t * 14) * 0.1 }),
  reading: (t) => ({ ...BASE, lean: 0.3, hX: 0.25, aLx: -1.0, aRx: -1.0 + Math.max(0, Math.sin(t * 2)) * 0.08 }),
  thinking: (t) => ({ ...BASE, lean: 0.05, hX: -0.12, hZ: 0.15 + Math.sin(t * 0.8) * 0.05, aLx: -0.9, aRx: -2.4, aRz: 0.55 }),
  researching: (t) => { const s = Math.max(0, Math.sin(t * 1.1)) ** 3; return { ...BASE, lean: 0.06, aLx: -1.1 + Math.sin(t * 4) * 0.06, aRx: -1.0 - s * 1.35, aRz: s * 0.45, hX: -0.15 * s, cup: 1 }; },
  computer: (t) => ({ ...BASE, lean: 0.1, hX: 0.12, aLx: -0.5, aRx: -1.05, aRz: Math.sin(t * 2.5) * 0.22 }),
  waiting: (t) => ({ ...BASE, rise: 1, back: 1, aRx: -2.9, aRz: Math.sin(t * 8) * 0.4, aLx: -0.35, prop: 1, hX: -0.15, bob: Math.abs(Math.sin(t * 5)) * 0.06 }),
  visit: (t) => ({ ...BASE, rise: 1, lean: 0.05, turn: 0, aLx: -0.55, prop: 1, aRx: -1.4 + Math.sin(t * 3) * 0.25, aRz: -0.35, hZ: Math.sin(t * 1.5) * 0.08 }),
  lounge: (t) => { const s = Math.max(0, Math.sin(t * 0.7 + 1)) ** 3; return { ...BASE, lean: -0.22, aLx: -0.75, prop: 1, aRx: -1.0 - s * 1.35, aRz: s * 0.45, hX: -0.1 - 0.1 * s, hZ: Math.sin(t * 0.9) * 0.06, cup: 1 }; },
  idleDesk: (t) => ({ ...BASE, lean: -0.3, aLx: -0.7, prop: 1, aRx: -0.5, hX: -0.15, bob: Math.sin(t * 1.6) * 0.01 }),
  walk: (t) => ({ ...BASE, rise: 1, lean: 0.05, aLx: Math.sin(t * 10) * 0.5, aRx: -Math.sin(t * 10) * 0.5, swing: Math.sin(t * 10) * 0.55, bob: Math.abs(Math.sin(t * 10)) * 0.04, breathe: 0 }),
  barista: (t) => ({ ...BASE, rise: 1, lean: 0.12, hX: 0.25, aLx: -1.25 + Math.sin(t * 3.1) * 0.2, aRx: -1.15 + Math.cos(t * 2.3) * 0.25, aRz: -0.15, aLz: 0.1 }),
};
const POSE_NAMES = Object.keys(POSES);

function blendPose(o, pname, dt, time) {
  const k = damp(reduced ? 12 : 6, dt);
  const tt = (time + o.tOff) * (reduced ? 0.35 : 1);
  const P = o.pose; for (const key of POSE_KEYS) P[key] = 0;
  let sum = 0;
  for (const n of POSE_NAMES) {
    const w = (o.weights[n] += ((n === pname ? 1 : 0) - o.weights[n]) * k);
    if (w < 0.002) continue;
    const p = POSES[n](tt); sum += w;
    for (const key of POSE_KEYS) P[key] += p[key] * w;
  }
  if (sum > 0) for (const key of POSE_KEYS) P[key] /= sum;
  P.t = tt;
  return P;
}
function applyPose(c, P, pos, y, heading, scale, dt) {
  c.root.position.set(pos.x, y, pos.z);
  c.root.rotation.y = heading;
  c.root.scale.setScalar(Math.max(0.01, scale));
  c.body.position.set(0, P.bob, -0.3 * P.back);
  const legX = -1.5 * (1 - P.rise);
  c.legs[0].rotation.x = legX + P.swing; c.legs[1].rotation.x = legX - P.swing;
  // idle breathing: a slow chest swell and a tiny shoulder rise
  const br = reduced ? 0 : Math.sin(P.t * 1.9) * P.breathe;
  c.upper.rotation.set(P.lean + br * 0.012, P.turn, 0);
  c.upper.scale.set(1 + br * 0.012, 1 + br * 0.008, 1 + br * 0.018);
  c.head.rotation.set(P.hX - 0.24 - br * 0.015, 0, P.hZ); // chin up a little so faces read from the high camera
  c.arms[0].rotation.set(P.aLx, 0, -P.aLz - br * 0.02);
  c.arms[1].rotation.set(P.aRx, 0, P.aRz + br * 0.02);
  c.cup.scale.setScalar(Math.max(0.001, P.cup));
  c.cup.rotation.x = -P.aRx;
  c.prop.scale.setScalar(Math.max(0.001, P.prop));
  c.prop.rotation.x = -P.aLx * 0.85;
  c.blinkAt -= dt;
  c.eyes.scale.y = c.blinkAt < 0 ? 0.12 : 1;
  if (c.blinkAt < -0.12) c.blinkAt = 2 + Math.random() * 4;
}
// walk pos toward target; returns distance remaining
function stepToward(o, tx, tz, dt, moveDt, speed) {
  const toX = tx - o.pos.x, toZ = tz - o.pos.z, dist = Math.hypot(toX, toZ);
  o.moving = dist > 0.05;
  if (o.moving) {
    const step = Math.min(dist, speed * moveDt);
    o.pos.x += (toX / dist) * step; o.pos.z += (toZ / dist) * step;
    o.heading = angleLerp(o.heading, Math.atan2(toX, toZ), damp(12, dt));
  } else { o.pos.x = tx; o.pos.z = tz; }
  return dist;
}

/* ------------------------------------------------------------------ baristas (not agents, no labels) */
const BAR_POINTS = [
  { x: -8.4, z: -6.7, h: Math.PI }, { x: -7.1, z: -6.7, h: Math.PI }, { x: -6.2, z: -6.7, h: Math.PI },
  { x: -3.2, z: -6.7, h: Math.PI }, { x: -0.1, z: -6.7, h: Math.PI }, { x: -6.0, z: -5.7, h: 0 }, { x: -3.9, z: -5.7, h: 0 },
];
const GATE = new THREE.Vector3(-1.4, 0, -6.0), OUTSIDE = new THREE.Vector3(-1.4, 0, -3.7);
const baristas = [
  { id: 'barista-one', shirt: '#F3EDE4', apron: '#3F5E4A', hair: 'bun', start: 0 },
  { id: 'barista-two', shirt: '#E9E1D2', apron: '#7A4A2C', hair: 'short', start: 3 },
].map((b, i) => {
  const ch = makeCharacter(b.id, { shirt: b.shirt, apron: b.apron, hair: b.hair });
  cafe.add(ch.root);
  const p = BAR_POINTS[b.start];
  return { ch, pos: new THREE.Vector3(p.x, 0, p.z), heading: p.h, wp: b.start, dwell: 1 + i * 2, route: [], moving: false,
    weights: Object.fromEntries(POSE_NAMES.map((n) => [n, n === 'barista' ? 1 : 0])), pose: { ...BASE }, tOff: ch.seed, inside: true, idx: i };
});

function updateBarista(b, dt, time, moveDt, closed) {
  if (closed && b.inside) { b.inside = false; b.route = [GATE.clone(), OUTSIDE.clone(), BARISTA_SPOTS[b.idx].pos.clone()]; }
  if (!closed && !b.inside) {
    b.inside = true; const p = BAR_POINTS[b.wp];
    b.route = [OUTSIDE.clone(), GATE.clone(), new THREE.Vector3(p.x, 0, p.z)];
  }
  let face = BAR_POINTS[b.wp].h;
  if (b.route.length) {
    const t = b.route[0];
    if (reduced) { b.pos.copy(t); b.route.shift(); }
    else if (stepToward(b, t.x, t.z, dt, moveDt, 3.0) < 0.06) b.route.shift();
    b.moving = b.route.length > 0;
  } else if (b.inside) {
    b.dwell -= dt;
    if (b.dwell <= 0) {
      const other = baristas[1 - b.idx];
      let n = b.wp; for (let k = 0; k < 6 && (n === b.wp || n === other.wp); k++) n = Math.floor(Math.random() * BAR_POINTS.length);
      b.wp = n; const p = BAR_POINTS[n]; b.route = [new THREE.Vector3(p.x, 0, p.z)]; b.dwell = 3 + Math.random() * 4;
    }
    b.moving = false;
  } else { face = BARISTA_SPOTS[b.idx].heading; b.moving = false; }
  if (!b.moving) b.heading = angleLerp(b.heading, face, damp(8, dt));
  const P = blendPose(b, b.moving ? 'walk' : (b.inside ? 'barista' : 'visit'), dt, time);
  applyPose(b.ch, P, b.pos, 0, b.heading, 1, dt);
}

/* ------------------------------------------------------------------ labels */
const labelsEl = document.getElementById('labels');
function makeLabel() {
  const el = document.createElement('div'); el.className = 'tag';
  const bubble = document.createElement('div'); bubble.className = 'bubble';
  const bang = document.createElement('span'); bang.className = 'bang'; bang.textContent = '!';
  const btxt = document.createElement('span'); btxt.className = 'btxt'; btxt.textContent = 'Needs your OK';
  const dots = document.createElement('span'); dots.className = 'dots';
  dots.append(document.createElement('i'), document.createElement('i'), document.createElement('i'));
  bubble.append(bang, btxt, dots);
  const name = document.createElement('div'); name.className = 'name';
  const dot = document.createElement('i'); const nameText = document.createElement('span');
  name.append(dot, nameText);
  const state = document.createElement('div'); state.className = 'state';
  el.append(bubble, name, state);
  labelsEl.appendChild(el);
  return { el, bubble, dot, nameText, state, bubbleKind: null, stateText: '', color: '' };
}

/* ------------------------------------------------------------------ agents */
const agents = new Map(); // id -> agent
const hitBoxes = [];
const hitMat = new THREE.MeshBasicMaterial({ color: '#ffffff' });
const LAPTOP = { alu: mat('#C9CDD3', { roughness: 0.35, metalness: 0.45 }), keys: mat('#3A3D42', { roughness: 0.6 }), mouse: mat('#EDE8E0', { roughness: 0.4 }) };
const WORKING = new Set(['thinking', 'reading', 'writing', 'running', 'researching', 'computer', 'delegating']);
let closedNow = false, closedSince = 0;

function cleanName(n) {
  const s = Array.from(String(n ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim()).slice(0, 16).join('');
  return s || 'Agent';
}
function claimDesk(id) {
  const n = DESK_ORDER.length, start = hashStr(id) % n;
  for (let i = 0; i < n; i++) { const d = DESKS[DESK_ORDER[(start + i) % n]]; if (!d.owner) { d.owner = id; return d; } }
  return null;
}

function addAgent(id, name, state, since) {
  const desk = claimDesk(id);
  if (!desk) return null;
  const ch = makeCharacter(id, { name });
  cafe.add(ch.root);
  const hit = new THREE.Mesh(G.box, hitMat); hit.visible = false;
  hit.position.y = 0.8; hit.scale.set(0.85, 1.75, 0.85); hit.userData.id = id;
  ch.root.add(hit); hitBoxes.push(hit);
  // per-agent kit at the seat: laptop (glowing screen), floor ring
  const color = new THREE.Color(STATES[state].color);
  const glowMat = new THREE.MeshBasicMaterial({ color: color.clone(), toneMapped: false });
  const ringMat = new THREE.MeshBasicMaterial({ color: color.clone(), transparent: true, opacity: 0.6, depthWrite: false, toneMapped: false });
  const discMat = new THREE.MeshBasicMaterial({ color: color.clone(), transparent: true, opacity: 0.16, depthWrite: false, toneMapped: false });
  const kit = new THREE.Group(); kit.position.copy(desk.pos); kit.rotation.y = desk.heading; cafe.add(kit);
  mesh(G.ring, ringMat, kit, 0, 0.022, 0, 1.1, 1, 1.1, false).renderOrder = 1;
  mesh(G.disc, discMat, kit, 0, 0.02, 0, 1.1, 1, 1.1, false).renderOrder = 1;
  const laptop = new THREE.Group(); laptop.position.set(0, desk.tableY + 0.002, desk.reach); kit.add(laptop);
  rbox(LAPTOP.alu, laptop, 0, 0.011, 0, 0.42, 0.022, 0.28, 0.01);
  rbox(LAPTOP.keys, laptop, 0, 0.0225, -0.03, 0.36, 0.003, 0.13, 0.001, false);
  rbox(LAPTOP.keys, laptop, 0, 0.0225, 0.085, 0.13, 0.002, 0.07, 0.001, false);
  const lid = new THREE.Group(); lid.position.set(0, 0.022, 0.14); lid.rotation.x = 0.22; laptop.add(lid);
  rbox(LAPTOP.alu, lid, 0, 0.15, 0, 0.42, 0.3, 0.014, 0.01);
  mesh(G.screen, glowMat, lid, 0, 0.155, -0.0075, 1, 1, 1, false);
  mesh(G.sticker, glowMat, lid, 0, 0.16, 0.0075, 1, 1, 1, false).rotation.y = 0;
  const mouse = mesh(G.sphere, LAPTOP.mouse, kit, -0.36, desk.tableY + 0.02, desk.reach - 0.06, 0.05, 0.03, 0.07);

  const a = {
    id, name: cleanName(name), state, since: Number(since) || Date.now(),
    ch, hit, desk, kit, laptop, mouse, glowMat, ringMat, discMat, color, targetColor: new THREE.Color(),
    label: makeLabel(),
    pos: DOOR.clone(), y: 0, heading: Math.PI, scale: reduced ? 1 : 0.01,
    leaving: false, visit: null, moving: true, spotKind: null, spotIdx: 0, typingUntil: 0, mode: 'desk', screen: { x: 0, y: 0 },
    weights: Object.fromEntries(POSE_NAMES.map((p) => [p, p === 'walk' ? 1 : 0])),
    pose: { ...BASE }, tOff: ch.seed,
  };
  if (reduced) a.pos.copy(desk.pos);
  agents.set(id, a);
  updateLabelText(a, true);
  return a;
}

function setAgentState(a, name, state, since) {
  a.name = cleanName(name);
  if (a.state !== state) {
    if (a.state === 'waiting' && WORKING.has(state)) a.typingUntil = performance.now() + TYPING_MS; // approved in Claude
    a.state = state; a.since = Number(since) || Date.now();
  } else if (since) a.since = Number(since) || a.since;
  if (a.leaving) { a.leaving = false; }
  updateLabelText(a, true);
}

function removeAgentNow(a) {
  cafe.remove(a.ch.root); cafe.remove(a.kit);
  const hi = hitBoxes.indexOf(a.hit); if (hi >= 0) hitBoxes.splice(hi, 1);
  a.glowMat.dispose(); a.ringMat.dispose(); a.discMat.dispose();
  a.label.el.remove();
  a.desk.owner = null;
  agents.delete(a.id);
  if (selectedId === a.id) closePop();
  if (hoverId === a.id) hideTip();
}

function stateView(a) {
  if (closedNow) return { label: CLOSED.label, color: CLOSED.color, desc: CLOSED.desc, since: closedSince };
  const info = STATES[a.state];
  const label = a.state === 'delegating' && a.visit ? 'Collaborating' : info.label;
  return { label, color: info.color, desc: info.desc, since: a.since };
}
function updateLabelText(a, force) {
  const L = a.label, v = stateView(a);
  if (force || L.nameText.textContent !== a.name) L.nameText.textContent = a.name;
  const mins = Math.floor((Date.now() - v.since) / 60000);
  const text = mins >= 1 && !closedNow ? `${v.label} · ${mins < 60 ? mins + 'm' : Math.floor(mins / 60) + 'h'}` : v.label;
  if (force || text !== L.stateText) { L.stateText = text; L.state.textContent = text; }
  if (L.color !== v.color) { L.color = v.color; L.state.style.backgroundColor = v.color; L.dot.style.backgroundColor = v.color; }
}

function pickVisit(a) {
  if (a.visit) { const t = agents.get(a.visit); if (t && !t.leaving && t.state !== 'delegating') return t; }
  const others = [...agents.values()].filter((b) => b !== a && !b.leaving && b.state !== 'delegating');
  if (!others.length) { a.visit = null; return null; }
  const working = others.filter((b) => WORKING.has(b.state) || b.state === 'waiting');
  const pool = working.length ? working : others;
  const t = pool[Math.floor(Math.random() * pool.length)];
  a.visit = t.id;
  return t;
}

const byId = (x, y) => (x.id < y.id ? -1 : 1);
// sticky spot assignment: an agent keeps its spot while it stays in the group; newcomers take the lowest free one
function assignSpots(list, kind) {
  const inList = new Set(list), used = new Set();
  for (const a of agents.values()) {
    if (a.spotKind === kind && !inList.has(a)) a.spotKind = null;
    else if (a.spotKind === kind) used.add(a.spotIdx);
  }
  let next = 0;
  for (const a of list) {
    if (a.spotKind === kind) continue;
    while (used.has(next)) next++;
    a.spotKind = kind; a.spotIdx = next; used.add(next);
  }
}
const tmpV = new THREE.Vector3();
function targetFor(a) {
  // returns {pos, heading, mode, y}
  if (a.leaving) return { pos: DOOR, heading: 0, mode: 'leave', y: 0 };
  if (closedNow) {
    const i = a.spotIdx;
    const s = COMMON[i] || overflowSpot(i - COMMON.length);
    return { pos: s.pos, heading: s.heading, mode: s.stand ? 'visit' : 'lounge', y: 0 };
  }
  if (a.state === 'idle') {
    const i = a.spotIdx;
    const s = IDLE_SPOTS[i] || overflowSpot(i - IDLE_SPOTS.length);
    return { pos: s.pos, heading: s.heading, mode: s.stand ? 'visit' : 'lounge', y: 0 };
  }
  if (a.state === 'delegating') {
    const t = pickVisit(a);
    if (t) {
      const visitors = [...agents.values()].filter((b) => b.visit === t.id && b.state === 'delegating' && !b.leaving);
      const idx = Math.max(0, visitors.indexOf(a));
      const side = idx % 2 === 0 ? 1 : -1, off = side * (0.8 + Math.floor(idx / 2) * 0.55);
      const h = t.mode === 'desk' ? t.desk.heading : t.heading, base = t.mode === 'desk' ? t.desk.pos : t.pos;
      const p = tmpV.set(base.x + Math.cos(h) * off + Math.sin(h) * 0.15, 0, base.z - Math.sin(h) * off + Math.cos(h) * 0.15);
      return { pos: p, heading: Math.atan2(base.x - p.x, base.z - p.z), mode: 'visit', y: 0 };
    }
  } else a.visit = null;
  return { pos: a.desk.pos, heading: a.desk.heading, mode: 'desk', y: a.desk.y };
}

function poseNameFor(a, mode) {
  if (a.moving) return 'walk';
  if (mode === 'lounge') return 'lounge';
  if (mode === 'visit' || mode === 'leave') return 'visit';
  if (a.state === 'idle' || a.state === 'delegating') return 'idleDesk';
  return a.state;
}

const GREY = new THREE.Color('#3A3F47');
const tmpColor = new THREE.Color();
function updateAgent(a, dt, time, moveDt = dt) {
  const tgt = targetFor(a);
  if (reduced && !a.leaving) { a.pos.set(tgt.pos.x, 0, tgt.pos.z); }
  const dist = stepToward(a, tgt.pos.x, tgt.pos.z, dt, moveDt, 4.2);
  if (!a.moving) a.heading = angleLerp(a.heading, tgt.heading, damp(8, dt));
  // seat lift (bar stools); always back on the floor while walking
  const yT = a.moving || dist > 0.3 ? 0 : tgt.y;
  a.y += (yT - a.y) * damp(reduced ? 40 : 10, dt);
  // leaving: shrink at the door
  if (a.leaving && dist < 0.2) a.scale -= dt * 3;
  else a.scale += (1 - a.scale) * damp(reduced ? 30 : 6, dt);
  if (a.leaving && (a.scale <= 0.02 || reduced)) { removeAgentNow(a); return; }

  const P = blendPose(a, poseNameFor(a, tgt.mode), dt, time);
  applyPose(a.ch, P, a.pos, a.y, a.heading, a.scale, dt);

  // kit colours: screen glows in state colour when at the seat, dim when away
  a.targetColor.set(closedNow ? CLOSED.color : STATES[a.state].color);
  const ck = damp(5, dt);
  a.ringMat.color.lerp(a.targetColor, ck); a.discMat.color.lerp(a.targetColor, ck);
  const atDesk = tgt.mode === 'desk' && !a.moving;
  const screenTarget = atDesk ? a.targetColor : tmpColor.copy(a.targetColor).lerp(GREY, 0.75);
  a.glowMat.color.lerp(screenTarget, ck);
  if (a.state === 'running' && atDesk && !reduced) a.glowMat.color.multiplyScalar(0.8 + Math.random() * 0.25);
  a.ringMat.opacity = (closedNow ? 0.25 : 0.6) * Math.min(1, a.scale);
  a.discMat.opacity = closedNow ? 0.06 : 0.16;
  a.mouse.visible = a.state === 'computer' && !closedNow;
  a.kit.scale.setScalar(a.leaving ? Math.max(0.001, a.scale) : 1);
  a.mode = tgt.mode;
}

/* ------------------------------------------------------------------ snapshot apply */
function applySnapshot(list) {
  const seen = new Set();
  for (const raw of list) {
    if (seen.size >= MAX_AGENTS) break;
    if (!raw || typeof raw !== 'object') continue;
    const id = String(raw.id ?? '');
    const state = raw.state;
    if (!ID_RE.test(id) || !Object.prototype.hasOwnProperty.call(STATES, state) || seen.has(id)) continue;
    seen.add(id);
    const a = agents.get(id);
    if (a) setAgentState(a, raw.name, state, raw.since);
    else addAgent(id, raw.name, state, raw.since);
  }
  for (const a of agents.values()) if (!seen.has(a.id) && !a.leaving) {
    a.leaving = true; a.visit = null;
    if (selectedId === a.id) closePop();
  }
}

/* ------------------------------------------------------------------ HUD */
const connEl = document.getElementById('conn');
const connText = document.getElementById('conn-text');
const legendEl = document.getElementById('legend');
const demoBtn = document.getElementById('demo-close');
let legendKey = '';
function setConn(mode) {
  connEl.dataset.mode = mode;
  connText.textContent = { live: 'Live', reconnecting: 'Reconnecting…', demo: 'Demo', connecting: 'Connecting…' }[mode];
  const was = document.body.classList.contains('is-demo');
  document.body.classList.toggle('is-demo', mode === 'demo');
  if (was !== (mode === 'demo')) requestAnimationFrame(() => fit()); // fit() is defined further down
}
function updateHud() {
  const counts = {}; let total = 0;
  for (const a of agents.values()) if (!a.leaving) { counts[a.state] = (counts[a.state] || 0) + 1; total++; }
  drawBoard(counts, closedNow);
  const key = total + JSON.stringify(counts) + closedNow;
  if (key === legendKey) return; legendKey = key;
  legendEl.replaceChildren();
  const tot = document.createElement('span'); tot.className = 'total';
  tot.textContent = total === 1 ? '1 agent' : `${total} agents`;
  legendEl.appendChild(tot);
  if (closedNow) {
    const chip = document.createElement('span'); chip.className = 'chip';
    const dot = document.createElement('i'); dot.style.backgroundColor = CLOSED.color;
    const t = document.createElement('span'); t.textContent = 'Café closed';
    chip.append(dot, t); legendEl.appendChild(chip);
    return;
  }
  for (const k of STATE_KEYS) {
    if (!counts[k]) continue;
    const chip = document.createElement('span'); chip.className = 'chip';
    const dot = document.createElement('i'); dot.style.backgroundColor = STATES[k].color;
    const b = document.createElement('b'); b.textContent = String(counts[k]);
    const t = document.createElement('span'); t.textContent = k === 'delegating' ? 'Collaborating' : STATES[k].label;
    chip.append(dot, t, b);
    legendEl.appendChild(chip);
  }
}

/* ------------------------------------------------------------------ hover tooltip + click popup */
const tipEl = document.getElementById('tip');
const tipName = document.getElementById('tip-name');
const tipState = document.getElementById('tip-state');
const popEl = document.getElementById('pop');
const popName = document.getElementById('pop-name');
const popDot = document.getElementById('pop-dot');
const popState = document.getElementById('pop-state');
const popTime = document.getElementById('pop-time');
const popDesc = document.getElementById('pop-desc');
const popHint = document.getElementById('pop-hint');
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
let hoverPt = null, hoverId = null, selectedId = null, popKey = '';

function pickAgent(cx, cy) {
  const r = canvas.getBoundingClientRect();
  ndc.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  for (const h of raycaster.intersectObjects(hitBoxes, false)) {
    const a = agents.get(h.object.userData.id);
    if (a && !a.leaving) return a;
  }
  return null;
}
function hideTip() { hoverId = null; tipEl.hidden = true; canvas.style.cursor = ''; }
function updateHover() {
  if (!hoverPt || interacting) { if (hoverId || !tipEl.hidden) hideTip(); return; }
  const a = pickAgent(hoverPt.x, hoverPt.y);
  if (!a) { if (hoverId || !tipEl.hidden) hideTip(); return; }
  hoverId = a.id; canvas.style.cursor = 'pointer';
  const v = stateView(a);
  const nm = a.name, st = `${v.label} · ${fmtDur(Date.now() - v.since)}`;
  if (tipName.textContent !== nm) tipName.textContent = nm;
  if (tipState.textContent !== st) tipState.textContent = st;
  tipEl.hidden = false;
  const w = tipEl.offsetWidth, h = tipEl.offsetHeight;
  let x = hoverPt.x + 14, y = hoverPt.y + 16;
  if (x + w > viewW - 6) x = hoverPt.x - w - 10;
  if (y + h > viewH - 6) y = hoverPt.y - h - 10;
  tipEl.style.transform = `translate(${Math.max(6, x).toFixed(0)}px, ${Math.max(6, y).toFixed(0)}px)`;
}
function openPop(a) { selectedId = a.id; popKey = ''; fillPop(a); popEl.hidden = false; }
function closePop() { selectedId = null; popEl.hidden = true; }
function fillPop(a) {
  const v = stateView(a);
  const key = a.name + v.label + v.color + fmtDur(Date.now() - v.since) + a.state + closedNow;
  if (key === popKey) return; popKey = key;
  popName.textContent = a.name;
  popDot.style.backgroundColor = v.color;
  popState.textContent = v.label;
  popTime.textContent = v.since && Date.now() - v.since >= 60000 ? `for ${fmtDur(Date.now() - v.since)}` : 'just started';
  popDesc.textContent = v.desc;
  const hint = !closedNow && a.state === 'waiting' ? 'Open Claude to allow' : '';
  popHint.textContent = hint; popHint.hidden = !hint;
}
function placePop(a) {
  const w = popEl.offsetWidth, h = popEl.offsetHeight;
  const lh = a.label.el.offsetHeight || 40;
  let x = a.screen.x - w / 2, y = a.screen.y - lh - 10 - h;
  x = Math.min(Math.max(8, x), viewW - w - 8);
  y = Math.min(Math.max(8, y), viewH - h - 8);
  popEl.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
}
let down = null;
canvas.addEventListener('pointerdown', (e) => { down = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now() }; });
canvas.addEventListener('pointerup', (e) => {
  if (!down || down.id !== e.pointerId) return;
  const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y), quick = performance.now() - down.t < 500;
  down = null;
  if (moved > 6 || !quick) return;
  const a = pickAgent(e.clientX, e.clientY);
  if (!a || a.id === selectedId) closePop(); else openPop(a);
});
canvas.addEventListener('pointermove', (e) => {
  if (e.pointerType === 'mouse' && e.buttons === 0) hoverPt = { x: e.clientX, y: e.clientY };
  else { hoverPt = null; }
});
canvas.addEventListener('pointerleave', () => { hoverPt = null; hideTip(); });
window.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePop(); });

/* ------------------------------------------------------------------ data: secret gist + demo */
// The link carries a secret gist id after the "#" (never sent to any server). Each agent is one file in that
// gist ("agent-<id>.json": {id, name, state, since, seen}), written by the hook on the Mac. An optional
// "cafe.json" ({closed, since}) closes the café. Without an id in the link, the café runs a demo.
const GIST_ID = (location.hash.slice(1).match(/^[0-9a-f]{20,40}$/) || [null])[0];
const IDLE_AFTER = 5 * 60e3, GONE_AFTER = 30 * 60e3, POLL_MS = 75000;
let team = [], teamSince = Date.now();
let mode = 'connecting', everLive = false, etag = null, failures = 0, files = [], pauseUntil = 0;
let cafeInfo = null;               // { closed, since } from cafe.json (kept across 304 answers)
let demoClosed = false, demoClosedSince = 0;

function parseCafe(f) {
  if (!f || typeof f.content !== 'string') return null;
  try {
    const c = JSON.parse(f.content);
    if (c && typeof c === 'object' && typeof c.closed === 'boolean' && Number.isFinite(c.since)) return { closed: c.closed, since: c.since };
  } catch { /* ignore */ }
  return null;
}
function computeClosed() {
  if (!GIST_ID || mode === 'demo') return { on: demoClosed, since: demoClosedSince };
  const c = cafeInfo, now = Date.now();
  const on = !!(c && c.closed && now - c.since < CLOSED_MAX_AGE && c.since < now + 10 * 60e3);
  return { on, since: on ? Math.min(c.since, now) : 0 };
}

function showAgents() {
  const now = Date.now(), list = [];
  for (const f of files) {
    const seen = Number(f.seen) || Number(f.since) || 0;
    const age = now - seen;
    if (!(age < GONE_AFTER)) continue;          // quiet for 30 min: gone (e.g. a session that crashed)
    if (age > IDLE_AFTER) list.push({ id: f.id, name: f.name, state: 'idle', since: seen + IDLE_AFTER });
    else list.push({ id: f.id, name: f.name, state: f.state, since: Number(f.since) || seen });
  }
  // The named team (e.g. Artist, Bug Finder) always has a place: anyone not busy is on a coffee break.
  for (const t of team) if (!list.some((a) => a.id === t.id)) list.push({ id: t.id, name: t.name, state: 'idle', since: teamSince });
  everLive = true;
  if (mode !== 'live') { stopDemo(); mode = 'live'; setConn('live'); }
  applySnapshot(list);
}

// Reads cafe-state.json (written by the hook on the Mac). GitHub's API is freshest (about a minute behind) but
// allows each viewer 60 reads an hour, so it's read every 75 s; while that limit is used up, the gist's raw
// address (no limit, up to ~5 min behind) is used instead. The gist owner is this github.io site's owner.
const GIST_OWNER = (location.hostname.match(/^([a-z0-9-]+)\.github\.io$/i) || [, 'somethingorotherogod'])[1].toLowerCase();
// The cloud team's status (cafe-cloud.json, copied in by a GitHub Action) joins the Mac's: newest news wins per agent.
function mergeCloud(data, cloud) {
  const list = (data && Array.isArray(data.agents) ? data.agents : []).filter((f) => f && typeof f === 'object');
  for (const c of (cloud && Array.isArray(cloud.agents) ? cloud.agents : [])) {
    if (!c || typeof c !== 'object') continue;
    const i = list.findIndex((f) => f.id === c.id);
    if (i < 0) list.push(c); else if ((Number(c.seen) || 0) > (Number(list[i].seen) || 0)) list[i] = c;
  }
  return { ...(data || {}), agents: list };
}
function useState(data) {
  files = (data && Array.isArray(data.agents) ? data.agents : []).filter((f) => f && typeof f === 'object');
  team = (data && Array.isArray(data.team) ? data.team : []).filter((t) => t && typeof t === 'object').slice(0, 16);
  cafeInfo = data && typeof data.closed === 'boolean' && Number.isFinite(data.closedSince)
    ? { closed: data.closed, since: data.closedSince } : null;
  failures = 0;
  showAgents();
}
async function readApi() {
  const res = await fetch(`https://api.github.com/gists/${GIST_ID}`, { headers: { Accept: 'application/vnd.github+json' }, cache: 'no-store' });
  if (res.status === 403 || res.status === 429) {
    const reset = Number(res.headers.get('X-RateLimit-Reset')) * 1000;
    pauseUntil = reset > Date.now() ? reset : Date.now() + 10 * 60e3;
    return undefined;
  }
  if (!res.ok) throw new Error('bad status');
  const gf = (await res.json()).files || {};
  const read = (n) => { const f = gf[n]; try { return f && typeof f.content === 'string' ? JSON.parse(f.content) : null; } catch { return null; } };
  return mergeCloud(read('cafe-state.json'), read('cafe-cloud.json'));
}
async function readRaw() {
  const get = async (name) => {
    const res = await fetch(`https://gist.githubusercontent.com/${GIST_OWNER}/${GIST_ID}/raw/${name}?t=${Date.now()}`, { cache: 'no-store' });
    if (res.status === 404) return null;   // not written yet
    if (!res.ok) throw new Error('bad status');
    return res.json();
  };
  const [state, cloud] = await Promise.all([get('cafe-state.json'), get('cafe-cloud.json').catch(() => null)]);
  return mergeCloud(state, cloud);
}
async function pollGist() {
  try {
    let data;
    if (Date.now() >= pauseUntil) data = await readApi();
    if (data === undefined) data = await readRaw();
    useState(data);
  } catch {
    failures++;
    if (everLive) { if (mode === 'live') { mode = 'reconnecting'; setConn('reconnecting'); } }
    else if (failures >= 2) startDemo();
  }
}

let demoTimers = [];
function startDemo() {
  if (mode === 'demo' || everLive) return;
  mode = 'demo'; setConn('demo');
  const randId = () => Array.from({ length: 16 }, () => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('');
  const names = [...DEMO_NAMES].sort(() => Math.random() - 0.5);
  const weighted = ['writing', 'writing', 'reading', 'thinking', 'running', 'researching', 'delegating', 'computer', 'waiting', 'idle', 'idle'];
  const pickState = () => weighted[Math.floor(Math.random() * weighted.length)];
  const demo = names.slice(0, 8).map((name, i) => ({ id: randId(), name,
    state: ['writing', 'idle', 'thinking', 'delegating', 'reading', 'waiting', 'running', 'computer'][i], since: Date.now() - i * 95e3 }));
  let nameIdx = 8;
  const push = () => applySnapshot(demo);
  push();
  demoTimers.push(setInterval(() => {
    // anyone waiting for a while gets "approved" and carries on (shows the typing bubble)
    for (const d of demo) if (d.state === 'waiting' && Date.now() - d.since > 9000) { d.state = 'writing'; d.since = Date.now(); }
    const n = 1 + Math.floor(Math.random() * 2);
    for (let i = 0; i < n; i++) {
      const a = demo[Math.floor(Math.random() * demo.length)];
      if (a.state === 'waiting') continue;
      a.state = pickState(); a.since = Date.now();
    }
    push();
  }, 3200));
  demoTimers.push(setInterval(() => {
    if (Math.random() < 0.5 && demo.length > 6) demo.splice(Math.floor(Math.random() * demo.length), 1);
    else if (demo.length < 10) demo.push({ id: randId(), name: names[nameIdx++ % names.length], state: pickState(), since: Date.now() });
    push();
  }, 14000));
}
function stopDemo() {
  if (mode !== 'demo') return;
  demoTimers.forEach(clearInterval); demoTimers = [];
  document.body.classList.remove('is-demo');
}
demoBtn.addEventListener('click', () => {
  demoClosed = !demoClosed; demoClosedSince = Date.now();
});

if (GIST_ID) {
  pollGist();
  setInterval(pollGist, POLL_MS);
  setInterval(() => { if (everLive) showAgents(); }, 30e3); // keep idle/gone timing fresh between changes
} else {
  startDemo();
}

/* ------------------------------------------------------------------ camera framing */
const bottomEl = document.getElementById('bottom');
const topEl = document.querySelector('.top');
let viewW = 1, viewH = 1;
function fit() {
  viewW = canvas.clientWidth || window.innerWidth; viewH = canvas.clientHeight || window.innerHeight;
  renderer.setSize(viewW, viewH, false);
  const portrait = viewW / viewH < 0.9;
  document.body.classList.toggle('compact', viewW < 520);
  const bx = [-10.4, 10.4], bz = [-8.5, 8.5];
  const dir = portrait ? CAM_DIR_TALL : CAM_DIR_WIDE;
  setOrbitLimits(dir);
  const center = new THREE.Vector3((bx[0] + bx[1]) / 2, 0.8, (bz[0] + bz[1]) / 2);
  controls.target.copy(center);
  camera.position.copy(center).addScaledVector(dir, 60);
  camera.lookAt(center); camera.updateMatrixWorld(true);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const x of bx) for (const y of [0, 2.6]) for (const z of bz) {
    const v = new THREE.Vector3(x, y, z).applyMatrix4(camera.matrixWorldInverse);
    minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x); minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y);
  }
  const topPx = portrait ? topEl.getBoundingClientRect().bottom + 14 : 40;
  const botPx = portrait ? viewH - bottomEl.getBoundingClientRect().top + 6 : 30;
  const side = portrait ? 2 : 30;
  const s = Math.max((maxX - minX) / Math.max(50, viewW - 2 * side), (maxY - minY) / Math.max(50, viewH - topPx - botPx));
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2 + ((topPx - botPx) / 2) * s;
  camera.left = cx - (viewW * s) / 2; camera.right = cx + (viewW * s) / 2;
  camera.top = cy + (viewH * s) / 2; camera.bottom = cy - (viewH * s) / 2;
  camera.zoom = 1;
  camera.updateProjectionMatrix();
  controls.update();
}
window.addEventListener('resize', fit);
fit();
document.fonts?.ready.then(() => { boardKey = ''; updateHud(); fit(); });

/* ------------------------------------------------------------------ closed state */
let closedK = 0;
function setClosed(on, since) {
  const changed = on !== closedNow;
  closedNow = on; closedSince = since;
  if (!changed) return;
  document.body.classList.toggle('is-closed', on);
  demoBtn.textContent = on ? 'Open café (demo)' : 'Close café (demo)';
  demoBtn.setAttribute('aria-pressed', String(on));
  for (const a of agents.values()) { a.visit = null; updateLabelText(a, true); }
  legendKey = ''; updateHud();
  popKey = '';
}

/* ------------------------------------------------------------------ loop */
const clock = new THREE.Clock();
const proj = new THREE.Vector3();
let hudTimer = 0, textTimer = 0, sway = 1;
function frame() {
  const rawDt = Math.min(clock.getDelta(), 3);
  const dt = Math.min(rawDt, 0.1);
  const time = clock.elapsedTime;

  const cs = computeClosed();
  setClosed(cs.on, cs.since);
  closedK += ((closedNow ? 1 : 0) - closedK) * damp(reduced ? 20 : 1.8, dt);
  hemi.intensity = LIGHT_BASE.hemi * (1 - 0.55 * closedK);
  sun.intensity = LIGHT_BASE.sun * (1 - 0.6 * closedK);
  rimLight.intensity = LIGHT_BASE.rim * (1 - 0.3 * closedK);
  for (const g of glowSprites) g.material.opacity = 0.85 * (1 - 0.35 * closedK);
  for (const l of pointLights) l.intensity = LIGHT_BASE.point * (LOW ? 1.5 : 1) * (1 - 0.45 * closedK);
  scene.background.copy(BG_OPEN).lerp(BG_CLOSED, closedK);

  const idleFor = performance.now() - lastInteract;
  const swayTarget = interacting || idleFor < 4000 || reduced ? 0 : 1;
  sway += (swayTarget - sway) * damp(1.5, dt);
  cafe.rotation.y = Math.sin(time * 0.12) * 0.035 * sway;
  controls.update();

  const present = [...agents.values()].filter((a) => !a.leaving).sort(byId);
  if (closedNow) { assignSpots([], 'idle'); assignSpots(present, 'closed'); }
  else { assignSpots([], 'closed'); assignSpots(present.filter((a) => a.state === 'idle'), 'idle'); }
  for (const a of [...agents.values()]) updateAgent(a, dt, time, rawDt);
  for (const b of baristas) updateBarista(b, dt, time, rawDt, closedNow);

  hudTimer -= dt; if (hudTimer <= 0) { hudTimer = 0.25; updateHud(); }
  textTimer -= dt; if (textTimer <= 0) { textTimer = 5; for (const a of agents.values()) updateLabelText(a, false); }

  scene.updateMatrixWorld();
  // chat bubbles: the common room takes turns; visitors alternate with their host
  const talkers = [...agents.values()].filter((a) => (a.mode === 'lounge' || (closedNow && a.mode === 'visit')) && !a.moving && !a.leaving).sort(byId);
  const speaker = talkers.length > 1 ? talkers[Math.floor(time / 2.2) % talkers.length] : null;
  const speaker2 = closedNow && talkers.length > 5 ? talkers[(Math.floor(time / 2.2) + Math.floor(talkers.length / 2)) % talkers.length] : null;
  const nowMs = performance.now();
  for (const a of agents.values()) {
    let kind = '';
    if (a.leaving) kind = '';
    else if (closedNow) kind = a === speaker || a === speaker2 ? 'chat' : '';
    else if (a.state === 'waiting') kind = 'wait';
    else if (a.state === 'thinking' || a.typingUntil > nowMs) kind = 'dots';
    else if (a === speaker) kind = 'chat';
    else if (a.mode === 'visit' && a.state === 'delegating' && !a.moving && Math.floor(time / 1.8) % 2 === 0) kind = 'chat';
    const L = a.label;
    if (kind !== L.bubbleKind) { L.bubbleKind = kind; L.el.dataset.bubble = kind; }
    a.ch.anchor.getWorldPosition(proj).project(camera);
    const x = (proj.x * 0.5 + 0.5) * viewW, y = (-proj.y * 0.5 + 0.5) * viewH;
    a.screen.x = x; a.screen.y = y;
    L.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
    L.el.style.zIndex = String(Math.round((1 - proj.z) * 1000));
    L.el.style.opacity = a.leaving ? '0' : String(Math.min(1, a.scale * 1.5));
  }

  if (selectedId) {
    const a = agents.get(selectedId);
    if (!a || a.leaving) closePop(); else { fillPop(a); placePop(a); }
  }
  updateHover();

  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
updateHud();
requestAnimationFrame(frame);
