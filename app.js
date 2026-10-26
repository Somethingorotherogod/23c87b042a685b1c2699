// The Agent Café — live 3D view of agent states. Plain ES module, no build step.
// All remote strings are rendered with textContent only.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

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
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const BG_OPEN = new THREE.Color('#2B211B'), BG_CLOSED = new THREE.Color('#17120F');
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
controls.maxZoom = 3;
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

// warm evening light. All lights are created once; closing only lerps intensities (no shader recompiles).
const hemi = new THREE.HemisphereLight('#FFE3C4', '#3A2A20', 1.0);
scene.add(hemi);
const sun = new THREE.DirectionalLight('#FFC994', 1.35);
sun.position.set(-5, 16, 9);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -15, right: 15, top: 15, bottom: -15, near: 1, far: 50 });
sun.shadow.bias = -0.0006;
sun.shadow.normalBias = 0.03;
scene.add(sun);
const LIGHT_BASE = { hemi: 1.2, sun: 1.45, point: 11 };
const pointLights = [];

const cafe = new THREE.Group();
scene.add(cafe);

/* ------------------------------------------------------------------ shared geometry/materials */
const G = {
  box: new THREE.BoxGeometry(1, 1, 1),
  cyl: new THREE.CylinderGeometry(1, 1, 1, 20),
  sphere: new THREE.SphereGeometry(1, 20, 14),
  ico: new THREE.IcosahedronGeometry(1, 1),
  torso: new THREE.CapsuleGeometry(0.26, 0.3, 6, 14),
  limb: new THREE.CapsuleGeometry(0.075, 0.26, 4, 8),
  leg: new THREE.CapsuleGeometry(0.095, 0.26, 4, 8),
  head: new THREE.SphereGeometry(0.3, 22, 16),
  hemi: new THREE.SphereGeometry(0.315, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2),
  eye: new THREE.SphereGeometry(0.036, 10, 8),
  ring: new THREE.RingGeometry(0.42, 0.55, 36).rotateX(-Math.PI / 2),
  disc: new THREE.CircleGeometry(0.42, 36).rotateX(-Math.PI / 2),
  screen: new THREE.PlaneGeometry(0.36, 0.24).rotateY(Math.PI),
  sticker: new THREE.CircleGeometry(0.045, 16),
  tubBack: new THREE.CylinderGeometry(1, 1, 1, 18, 1, true, Math.PI / 2, Math.PI),
  cone: new THREE.ConeGeometry(1, 1, 16),
};
const matCache = new Map();
function mat(color, extra) {
  const key = color + (extra ? JSON.stringify(extra) : '');
  let m = matCache.get(key);
  if (!m) { m = new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0, ...extra }); matCache.set(key, m); }
  return m;
}
function mesh(geo, material, parent, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1, shadow = true) {
  const m = new THREE.Mesh(geo, typeof material === 'string' ? mat(material) : material);
  m.position.set(x, y, z); m.scale.set(sx, sy, sz);
  m.castShadow = shadow; m.receiveShadow = true;
  parent.add(m);
  return m;
}
const box = (c, p, x, y, z, w, h, d, s) => mesh(G.box, c, p, x, y, z, w, h, d, s);
const cyl = (c, p, x, y, z, r, h, s) => mesh(G.cyl, c, p, x, y, z, r, h, r, s);

// one greyscale wood-grain texture, tinted per material
const woodTex = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d'), r = rng(7);
  g.fillStyle = '#F2E6DA'; g.fillRect(0, 0, 256, 256);
  for (let p = 0; p < 4; p++) {
    g.fillStyle = `rgba(90,60,40,${0.04 + r() * 0.08})`; g.fillRect(0, p * 64, 256, 64);
    for (let i = 0; i < 14; i++) {
      g.strokeStyle = `rgba(70,45,30,${0.05 + r() * 0.12})`; g.lineWidth = 1 + r() * 2;
      const y = p * 64 + r() * 64; g.beginPath(); g.moveTo(0, y);
      g.bezierCurveTo(80, y + (r() - 0.5) * 8, 170, y + (r() - 0.5) * 8, 256, y + (r() - 0.5) * 4); g.stroke();
    }
    g.fillStyle = 'rgba(40,25,15,.35)'; g.fillRect(0, p * 64, 256, 2);
    g.fillStyle = 'rgba(40,25,15,.25)'; g.beginPath(); g.ellipse(40 + r() * 180, p * 64 + 20 + r() * 25, 7, 3, 0, 0, Math.PI * 2); g.fill();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
})();
function wood(tint) {
  const key = 'wood' + tint;
  let m = matCache.get(key);
  if (!m) { m = new THREE.MeshStandardMaterial({ map: woodTex, color: tint, roughness: 0.78 }); matCache.set(key, m); }
  return m;
}
const W = { light: '#B98552', mid: '#9A6A42', dark: '#7A4E33', deep: '#5E3B27', warm: '#A8743F' };

// instancing: items {x,y,z, rx,ry,rz, sx,sy,sz, c(Color)}
function instanced(geo, items, opts = {}) {
  const m = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: opts.rough ?? 0.95, flatShading: !!opts.flat }), items.length);
  const o = new THREE.Object3D();
  items.forEach((it, i) => {
    o.position.set(it.x, it.y, it.z); o.rotation.set(it.rx || 0, it.ry || 0, it.rz || 0);
    o.scale.set(it.sx, it.sy, it.sz); o.updateMatrix();
    m.setMatrixAt(i, o.matrix); m.setColorAt(i, it.c);
  });
  m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true;
  m.castShadow = opts.shadow !== false; m.receiveShadow = true; m.frustumCulled = false;
  cafe.add(m);
  return m;
}
const srgb = (h, s, l) => new THREE.Color().setHSL(h, s, l, THREE.SRGBColorSpace);

/* ------------------------------------------------------------------ floor + walls */
const FX = 10, FZ = 8; // floor spans x -10..10, z -8..8
mesh(new THREE.CircleGeometry(34, 48).rotateX(-Math.PI / 2), '#3A2E26', cafe, 0, -0.5, 0, 1, 1, 1, false);
box('#5E5953', cafe, 0, -0.3, 0, FX * 2 + 0.9, 0.5, FZ * 2 + 0.9);
box('#4A4642', cafe, 0, -0.06, 0, FX * 2, 0.04, FZ * 2, false); // grout
{
  const r = rng(11), tiles = [];
  for (let ix = 0; ix < FX * 2; ix++) for (let iz = 0; iz < FZ * 2; iz++) {
    tiles.push({ x: -FX + ix + 0.5, y: -0.04, z: -FZ + iz + 0.5, sx: 0.96, sy: 0.08, sz: 0.96,
      c: srgb(0.08 + r() * 0.03, 0.03 + r() * 0.04, 0.5 + r() * 0.1) });
  }
  instanced(G.box, tiles, { shadow: false, rough: 0.9 });
}
// rough stone walls: many slightly varied grey boxes
const stones = [];
function stoneWall(x0, z0, x1, z1, h, seed) {
  const r = rng(seed), len = Math.hypot(x1 - x0, z1 - z0), ux = (x1 - x0) / len, uz = (z1 - z0) / len;
  const ry = Math.atan2(-uz, ux), rows = Math.max(1, Math.round(h / 0.3)), rh = h / rows;
  for (let row = 0; row < rows; row++) {
    let t = -(row % 2) * 0.22 * r();
    while (t < len - 0.05) {
      let L = 0.36 + r() * 0.32; if (t + L > len) L = len - t; if (t < 0) { L += t; t = 0; }
      const mid = t + L / 2, hh = rh * (0.86 + r() * 0.1), d = 0.4 + r() * 0.14, j = (r() - 0.5) * 0.06;
      stones.push({ x: x0 + ux * mid - uz * j, y: row * rh + hh / 2 + 0.01, z: z0 + uz * mid + ux * j,
        ry: ry + (r() - 0.5) * 0.08, rz: (r() - 0.5) * 0.05, sx: L - 0.035, sy: hh, sz: d,
        c: srgb(0.07 + r() * 0.04, 0.03 + r() * 0.05, 0.36 + r() * 0.22) });
      t += L;
    }
  }
}
stoneWall(1.2, -8.25, 10.3, -8.25, 1.5, 21);   // back, behind the lounge
stoneWall(-10.25, -8.3, -10.25, 8.3, 1.05, 22); // left
stoneWall(10.25, -8.3, 10.25, 8.3, 1.05, 23);   // right
stoneWall(-10.3, 8.25, 2.5, 8.25, 0.62, 24);    // front (door gap at x 2.5..4.7)
stoneWall(4.7, 8.25, 10.3, 8.25, 0.62, 25);
instanced(G.box, stones, { flat: true });
// back wall behind the kitchen: warm plaster with a wooden skirting
box('#CBB9A2', cafe, -4.4, 1.5, -8.3, 11.4, 3.0, 0.3);
box(wood(W.deep), cafe, -4.4, 0.12, -8.12, 11.4, 0.24, 0.06);

/* ------------------------------------------------------------------ kitchen strip (back counter) */
box(wood(W.dark), cafe, -4.6, 0.46, -7.6, 10.4, 0.92, 0.9);
box('#6F6A64', cafe, -4.6, 0.95, -7.6, 10.6, 0.06, 1.0);            // stone top
for (const y of [1.65, 2.3]) box(wood(W.mid), cafe, -7.2, y, -8.0, 5.0, 0.07, 0.36); // shelves
{
  const jarCols = ['#E8DCC6', '#B9D4C8', '#F0C987', '#D7B8A2', '#C9D7E2'], r = rng(5);
  for (let i = 0; i < 9; i++) cyl(jarCols[i % 5], cafe, -9.3 + i * 0.5, 1.82, -8.0, 0.1 + r() * 0.04, 0.28 + r() * 0.12);
  for (let i = 0; i < 8; i++) cyl('#FBF6EE', cafe, -9.2 + i * 0.55, 2.42, -8.0, 0.09, 0.16);
}
// espresso machine
const esp = new THREE.Group(); esp.position.set(-8.4, 0.98, -7.7); cafe.add(esp);
box('#B7BCC2', esp, 0, 0.32, 0, 1.2, 0.64, 0.6);
box('#2F3337', esp, 0, 0.66, 0, 1.22, 0.06, 0.62);
box('#8E2F2A', esp, 0, 0.45, 0.31, 1.0, 0.18, 0.02);
for (const x of [-0.3, 0.3]) { cyl('#2F3337', esp, x, 0.12, 0.36, 0.06, 0.1); cyl('#FFFDF7', esp, x, 0.04, 0.38, 0.055, 0.08); }
// grinder, cups, sink, cake stand
cyl('#2F3337', cafe, -7.1, 1.18, -7.75, 0.14, 0.4); mesh(G.cone, '#3B3F44', cafe, -7.1, 1.5, -7.75, 0.16, 0.24, 0.16);
for (let i = 0; i < 6; i++) cyl('#FFFDF7', cafe, -6.4 + (i % 3) * 0.2, 1.04 + Math.floor(i / 3) * 0.1, -7.5, 0.08, 0.09);
box('#3F4448', cafe, -3.2, 0.985, -7.6, 1.0, 0.02, 0.6, false);
const cake = new THREE.Group(); cake.position.set(-1.4, 0.98, -7.55); cafe.add(cake);
cyl('#FBF6EE', cake, 0, 0.02, 0, 0.32, 0.03); cyl('#E9A86A', cake, 0, 0.12, 0, 0.24, 0.16); cyl('#F6E7D2', cake, 0, 0.22, 0, 0.24, 0.04);
box('#FBF6EE', cafe, 0.0, 1.06, -7.6, 0.5, 0.16, 0.4); // till

// chalkboard (live counts / closed sign)
const boardCanvas = document.createElement('canvas'); boardCanvas.width = 1024; boardCanvas.height = 560;
const boardTex = new THREE.CanvasTexture(boardCanvas); boardTex.colorSpace = THREE.SRGBColorSpace; boardTex.anisotropy = 4;
box(wood(W.deep), cafe, -2.6, 2.15, -8.12, 3.2, 1.8, 0.08);
mesh(new THREE.PlaneGeometry(3.0, 1.62), new THREE.MeshBasicMaterial({ map: boardTex }), cafe, -2.6, 2.15, -8.07, 1, 1, 1, false);
let boardKey = '';
function drawBoard(counts, closed) {
  const key = JSON.stringify(counts) + closed;
  if (key === boardKey) return; boardKey = key;
  const g = boardCanvas.getContext('2d');
  const Wd = boardCanvas.width, H = boardCanvas.height;
  g.fillStyle = '#2F3D37'; g.fillRect(0, 0, Wd, H);
  g.fillStyle = 'rgba(255,255,255,0.04)';
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

/* ------------------------------------------------------------------ L-shaped bar counter */
const BAR_Z = -4.9, BAR_X0 = -8.9, BAR_X1 = -2.3, BAR_H = 1.05;
box(wood(W.mid), cafe, (BAR_X0 + BAR_X1) / 2, BAR_H / 2 - 0.03, BAR_Z, BAR_X1 - BAR_X0, BAR_H - 0.06, 0.8);
box(wood(W.light), cafe, (BAR_X0 + BAR_X1) / 2, BAR_H - 0.03, BAR_Z, BAR_X1 - BAR_X0 + 0.15, 0.06, 0.95);
box(wood(W.mid), cafe, BAR_X0, BAR_H / 2 - 0.03, -3.75, 0.8, BAR_H - 0.06, 1.5);
box(wood(W.light), cafe, BAR_X0, BAR_H - 0.03, -3.75, 0.95, 0.06, 1.6);
// pastry case + cups on the bar
const pastry = new THREE.Group(); pastry.position.set(-2.9, BAR_H, BAR_Z); cafe.add(pastry);
box(wood(W.deep), pastry, 0, 0.03, 0, 0.9, 0.06, 0.6);
const glass = new THREE.MeshStandardMaterial({ color: '#CFE8F0', transparent: true, opacity: 0.25, roughness: 0.1, depthWrite: false });
mesh(G.box, glass, pastry, 0, 0.26, 0, 0.9, 0.42, 0.6, false);
const pastryCols = ['#E7A35A', '#F2C3D0', '#C98348', '#F6E1A6'];
for (let i = 0; i < 4; i++) mesh(G.sphere, pastryCols[i], pastry, -0.3 + i * 0.2, 0.13, (i % 2) * 0.16 - 0.08, 0.09, 0.06, 0.09);
for (const x of [-8.6, -8.35]) cyl('#FFFDF7', cafe, x, BAR_H + 0.06, BAR_Z + 0.1, 0.07, 0.11);

/* ------------------------------------------------------------------ furniture builders */
function tubChair(x, z, heading) {
  const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = heading; cafe.add(g);
  cyl(wood(W.warm), g, 0, 0.22, 0, 0.3, 0.44);
  mesh(G.tubBack, mat(W.dark, { side: THREE.DoubleSide, roughness: 0.8 }), g, 0, 0.62, 0, 0.32, 0.36, 0.32);
  return g;
}
function stool(x, z, h, tint = W.warm) {
  const g = new THREE.Group(); g.position.set(x, 0, z); cafe.add(g);
  cyl(wood(tint), g, 0, h - 0.03, 0, 0.21, 0.07);
  for (const [lx, lz] of [[-0.12, -0.12], [0.12, -0.12], [-0.12, 0.12], [0.12, 0.12]]) box(wood(W.deep), g, lx, (h - 0.06) / 2, lz, 0.045, h - 0.06, 0.045, false);
  if (h > 0.6) box(wood(W.deep), g, 0, 0.28, 0, 0.3, 0.03, 0.3, false);
  return g;
}
function chair(x, z, heading) {
  const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = heading; cafe.add(g);
  box(wood(W.warm), g, 0, 0.42, -0.05, 0.48, 0.06, 0.46);
  box(wood(W.mid), g, 0, 0.72, -0.27, 0.48, 0.48, 0.05);
  for (const [lx, lz] of [[-0.2, -0.24], [0.2, -0.24], [-0.2, 0.14], [0.2, 0.14]]) box(wood(W.deep), g, lx, 0.2, lz, 0.05, 0.4, 0.05, false);
  return g;
}
function roundTable(x, z) {
  const g = new THREE.Group(); g.position.set(x, 0, z); cafe.add(g);
  cyl(wood(W.light), g, 0, 0.74, 0, 0.62, 0.06);
  cyl(wood(W.deep), g, 0, 0.37, 0, 0.06, 0.7);
  cyl(wood(W.deep), g, 0, 0.03, 0, 0.3, 0.06);
  return g;
}
function legTable(x, z, w, d, h, tint = W.light) {
  const g = new THREE.Group(); g.position.set(x, 0, z); cafe.add(g);
  box(wood(tint), g, 0, h - 0.035, 0, w, 0.07, d);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(wood(W.deep), g, sx * (w / 2 - 0.1), (h - 0.07) / 2, sz * (d / 2 - 0.1), 0.08, h - 0.07, 0.08);
  return g;
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
box(wood(W.dark), cafe, COMM_X + 1.05, 0.42, 0.1, 0.5, 0.07, 5.2);
for (const z of [-2.2, 2.4]) box(wood(W.deep), cafe, COMM_X + 1.05, 0.2, z, 0.4, 0.4, 0.08, false);
const DESK_ORDER = [...DESKS.keys()];

/* ------------------------------------------------------------------ common room: grey sofa corner */
const COMMON = [];   // spots everyone gathers at when closed (idle agents use them too)
const spot = (x, z, heading, stand = false) => ({ pos: new THREE.Vector3(x, 0, z), heading, stand });
{
  const sofa = mat('#8B8D90'), sofaDark = mat('#76787C');
  // back run along the back wall, facing +z
  box(sofa, cafe, 7.2, 0.22, -7.25, 3.6, 0.44, 0.95);
  box(sofaDark, cafe, 7.2, 0.68, -7.68, 3.6, 0.6, 0.26);
  // side run along the right wall, facing -x
  box(sofa, cafe, 9.55, 0.22, -5.6, 0.95, 0.44, 2.4);
  box(sofaDark, cafe, 9.95, 0.68, -5.95, 0.26, 0.6, 3.6);
  box(sofaDark, cafe, 5.3, 0.38, -7.25, 0.22, 0.4, 0.95);
  box(sofaDark, cafe, 9.55, 0.38, -4.35, 0.95, 0.4, 0.22);
  const cush = ['#C9A66B', '#9DB08A', '#C77B5A', '#E6DCCB', '#7F9AA6'];
  [[6.0, -7.45, 0.2], [7.3, -7.45, -0.15], [8.6, -7.45, 0.1], [9.75, -6.3, 1.4], [9.75, -5.0, 1.7]].forEach(([x, z, r], i) => {
    const c = box(cush[i], cafe, x, 0.62, z, 0.55, 0.42, 0.16); c.rotation.y = r; c.rotation.x = -0.25;
  });
  // low coffee table + cups, side cabinet
  legTable(7.5, -5.7, 1.4, 0.8, 0.42, W.light);
  for (const [x, z] of [[7.2, -5.6], [7.75, -5.85]]) cyl('#FFFDF7', cafe, x, 0.48, z, 0.07, 0.1);
  box(wood(W.dark), cafe, 4.4, 0.45, -7.75, 1.4, 0.9, 0.6);
  for (const x of [4.08, 4.72]) box(wood(W.mid), cafe, x, 0.45, -7.44, 0.58, 0.78, 0.02, false);
  // a rug under the lounge
  mesh(new THREE.PlaneGeometry(4.4, 3.4).rotateX(-Math.PI / 2), mat('#9C7F66'), cafe, 7.6, 0.012, -5.9, 1, 1, 1, false);

  // seats for everyone on a break (all sitting): sofa, armchairs and poufs round the coffee table, the bench
  for (const x of [5.85, 6.75, 7.65, 8.55]) COMMON.push(spot(x, -7.1, 0));
  for (const z of [-6.0, -5.0]) COMMON.push(spot(9.4, z, -Math.PI / 2));
  for (const [x, z] of [[6.1, -4.3], [7.3, -4.05], [8.5, -4.35]]) {
    const h = Math.atan2(7.5 - x, -5.7 - z); tubChair(x, z, h); COMMON.push(spot(x, z, h));
  }
  for (const [x, z] of [[5.35, -5.3], [5.35, -6.3], [6.35, -3.15], [8.35, -3.2]]) {
    cyl(['#C9A66B', '#9DB08A', '#C77B5A', '#7F9AA6'][COMMON.length % 4], cafe, x, 0.21, z, 0.3, 0.42);
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
// wooden bench along the front wall
box(wood(W.mid), cafe, -5.0, 0.44, 7.55, 4.2, 0.08, 0.55);
box(wood(W.mid), cafe, -5.0, 0.75, 7.88, 4.2, 0.5, 0.07);
for (const x of [-6.9, -3.1]) box(wood(W.deep), cafe, x, 0.21, 7.55, 0.1, 0.42, 0.45, false);

const leaves = [];
const GREENS = [[0.27, 0.42, 0.3], [0.25, 0.38, 0.36], [0.3, 0.35, 0.26], [0.22, 0.4, 0.42], [0.33, 0.3, 0.22]];
function bush(x, y, z, rad, n, seed, sq = 1) {
  const r = rng(seed);
  for (let i = 0; i < n; i++) {
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * rad, s = rad * (0.32 + r() * 0.3);
    const gcol = GREENS[Math.floor(r() * GREENS.length)];
    leaves.push({ x: x + Math.cos(a) * d, y: y + (r() - 0.3) * rad * 0.7 * sq, z: z + Math.sin(a) * d, ry: r() * 6, rx: r(),
      sx: s, sy: s * (0.8 + r() * 0.3), sz: s, c: srgb(gcol[0] + (r() - 0.5) * 0.03, gcol[1], gcol[2] + (r() - 0.5) * 0.06) });
  }
}
function tree(x, z, h, rad, seed) {
  cyl('#6B4A33', cafe, x, h / 2, z, 0.1, h);
  bush(x, h, z, rad, 22, seed);
  bush(x, h * 0.55, z, rad * 0.7, 10, seed + 1);
}
function potPlant(x, z, s, seed, top = 0) {
  cyl('#B4714A', cafe, x, top + 0.2 * s, z, 0.22 * s, 0.4 * s);
  cyl('#4A3528', cafe, x, top + 0.4 * s, z, 0.2 * s, 0.02, false);
  bush(x, top + 0.7 * s, z, 0.38 * s, 9, seed);
}
function succulent(x, y, z, seed) {
  cyl('#D8CBB8', cafe, x, y + 0.07, z, 0.09, 0.14);
  bush(x, y + 0.17, z, 0.08, 6, seed, 0.5);
}
// corners and walls overflowing with greenery
tree(-9.3, 7.3, 2.2, 1.3, 31); tree(9.3, 7.3, 2.4, 1.4, 33); tree(9.5, -1.4, 2.0, 1.0, 35); tree(-9.4, -6.2, 2.1, 1.0, 37);
bush(-9.9, 1.1, 0.6, 0.9, 14, 41); bush(-9.9, 1.1, 4.8, 0.9, 12, 43); bush(-10.0, 1.0, -3.4, 0.8, 10, 45);
bush(10.0, 1.1, 2.2, 0.8, 12, 47); bush(10.0, 1.1, 5.2, 0.7, 10, 49);
bush(2.2, 1.55, -8.3, 0.9, 14, 51); bush(3.4, 1.5, -8.2, 0.7, 10, 53); bush(5.5, 1.6, -8.4, 0.6, 9, 54);
bush(-0.4, 0.7, 8.3, 0.7, 10, 55); bush(6.6, 0.7, 8.3, 0.8, 12, 57); bush(8.0, 0.75, 8.3, 0.6, 8, 58);
potPlant(1.6, -7.5, 1.3, 61); potPlant(-1.3, 7.3, 1.1, 63); potPlant(2.0, 7.4, 0.9, 64); potPlant(-9.4, -3.3, 1.0, 65);
potPlant(5.0, -3.0, 0.9, 66); potPlant(9.5, 3.8, 1.0, 67); potPlant(-1.5, -3.6, 0.8, 68);
for (const [z, s] of [[-2.4, 71], [0.1, 72], [2.6, 73]]) succulent(COMM_X + 0.3, 0.76, z, s);
succulent(-6.9, 0.77, -1.4, 74); succulent(-3.2, 0.77, 3.2, 75); succulent(0.6, 0.76, 1.6, 76);
succulent(-8.95, BAR_H, -3.3, 77); succulent(4.4, 0.9, -7.75, 78);
instanced(G.ico, leaves, { flat: true, rough: 0.9 });

// pendant bulbs (+ a few warm point lights under them)
const bulbMat = new THREE.MeshBasicMaterial({ color: '#FFD9A0' });
const cordMat = mat('#2A211B');
function pendant(x, z, y = 2.45) {
  mesh(G.cyl, cordMat, cafe, x, y + 1.6, z, 0.012, 3.2, 0.012, false);
  mesh(G.cyl, mat('#3B3F44'), cafe, x, y + 0.13, z, 0.05, 0.08, 0.05, false);
  mesh(G.sphere, bulbMat, cafe, x, y, z, 0.1, 0.12, 0.1, false);
}
for (const x of [-7.6, -6.2, -4.8, -3.4]) pendant(x, BAR_Z, 2.5);
for (const z of [-1.6, 0.2, 2.0]) pendant(COMM_X, z, 2.3);
for (const [x, z] of [[-6.9, -1.4], [-3.3, -1.0], [-7.0, 2.8], [-3.2, 3.2], [0.6, 0.6], [7.5, -5.7]]) pendant(x, z, 2.4);
for (const [x, z] of [[-6.9, -4.6], [-3.6, -4.6], [COMM_X, -1.0], [COMM_X, 1.6], [-5.0, 0.8], [-5.0, 3.0], [0.6, 0.6], [7.5, -5.7]]) {
  const l = new THREE.PointLight('#FFB870', LIGHT_BASE.point, 7.5, 1.6); l.position.set(x, 2.2, z); cafe.add(l); pointLights.push(l);
}

/* ------------------------------------------------------------------ characters */
const HOODIES = ['#F28C8C', '#7FB8E6', '#8FD3B6', '#F6C177', '#B79CED', '#F49AC2', '#6CC4C9', '#E8A87C', '#A3C985', '#F3D36B', '#9AA7F0', '#E07A5F'];
const SKIN = ['#F9DCC4', '#F1C6A5', '#E0AC8A', '#C68A65', '#9C6644', '#FFE3D3'];
const HAIR = ['#3B2F2F', '#6B4F3A', '#C58B4E', '#E9C46A', '#2E2A3A', '#B5523B', '#8E8EA0'];
const PANTS = ['#4F5D75', '#5C4B51', '#3E5641', '#6B705C', '#33415C'];

function makeCharacter(id, opts = {}) {
  const r = rng(hashStr(id));
  const pick = (a) => a[Math.floor(r() * a.length)];
  const hoodie = opts.shirt || pick(HOODIES), skin = pick(SKIN), hair = pick(HAIR), pants = pick(PANTS);
  let hatType = Math.floor(r() * 4); const hatCol = pick(HOODIES.filter((c) => c !== hoodie));
  if (opts.hair !== undefined) hatType = opts.hair;

  const root = new THREE.Group();
  const body = new THREE.Group(); root.add(body);
  const hips = new THREE.Group(); hips.position.y = 0.56; body.add(hips);
  const legs = [-1, 1].map((s) => {
    const g = new THREE.Group(); g.position.set(s * 0.13, 0, 0); hips.add(g);
    mesh(G.leg, pants, g, 0, -0.22, 0);
    mesh(G.sphere, '#5A4636', g, 0, -0.46, 0.04, 0.1, 0.07, 0.13);
    return g;
  });
  const upper = new THREE.Group(); hips.add(upper);
  mesh(G.torso, hoodie, upper, 0, 0.3, 0, 1, 1, 0.88);
  if (opts.apron) {
    box(opts.apron, upper, 0, 0.2, 0.2, 0.44, 0.62, 0.06);
    box(opts.apron, upper, 0, 0.55, 0.19, 0.3, 0.06, 0.05, false);
  }
  mesh(new THREE.TorusGeometry(0.17, 0.05, 6, 16).rotateX(Math.PI / 2), hoodie, upper, 0, 0.63, 0, 1, 1, 1, false);
  const head = new THREE.Group(); head.position.y = 0.84; upper.add(head);
  mesh(G.head, skin, head);
  const eyes = new THREE.Group(); head.add(eyes);
  for (const s of [-1, 1]) {
    mesh(G.eye, '#2B2220', eyes, s * 0.1, 0.02, 0.27, 1, 1.25, 1, false);
    mesh(G.sphere, '#F4A6A0', head, s * 0.17, -0.07, 0.235, 0.05, 0.03, 0.02, false);
  }
  mesh(new THREE.TorusGeometry(0.045, 0.012, 4, 10, Math.PI).rotateZ(Math.PI), '#7A3E2E', head, 0, -0.07, 0.29, 1, 1, 1, false);
  if (hatType === 0) { // beanie
    mesh(G.hemi, hatCol, head, 0, 0.03, 0, 1, 1.05, 1);
    mesh(new THREE.TorusGeometry(0.3, 0.045, 6, 20).rotateX(Math.PI / 2), hatCol, head, 0, 0.05, 0, 1, 1, 1, false);
    mesh(G.sphere, '#FFFDF7', head, 0, 0.36, 0, 0.08, 0.08, 0.08);
  } else if (hatType === 1) { // hair
    const h = mesh(G.hemi, hair, head, 0, 0.0, -0.02, 1.02, 1.05, 1.02); h.rotation.x = -0.35;
  } else if (hatType === 2) { // cap
    mesh(G.hemi, hatCol, head, 0, 0.04, 0, 1, 0.9, 1);
    mesh(G.cyl, hatCol, head, 0, 0.06, 0.26, 0.2, 0.025, 0.16);
  } else { // bun
    const h = mesh(G.hemi, hair, head, 0, 0.0, -0.02, 1.02, 1.05, 1.02); h.rotation.x = -0.3;
    mesh(G.sphere, hair, head, 0, 0.33, -0.12, 0.13, 0.13, 0.13);
  }
  const anchor = new THREE.Object3D(); anchor.position.y = 0.62; head.add(anchor);
  const arms = [1, -1].map((s) => { // [left(+x), right(-x)]
    const g = new THREE.Group(); g.position.set(s * 0.31, 0.5, 0); upper.add(g);
    mesh(G.limb, hoodie, g, 0, -0.2, 0);
    mesh(G.sphere, skin, g, 0, -0.42, 0, 0.085, 0.085, 0.085);
    return g;
  });
  const cup = new THREE.Group(); cup.position.set(0, -0.45, 0.06); arms[1].add(cup);
  cyl('#FFFDF7', cup, 0, 0, 0, 0.065, 0.13, false);
  cyl('#6B3E26', cup, 0, 0.066, 0, 0.055, 0.004, false);
  return { root, body, hips, legs, upper, head, eyes, arms, cup, anchor, blinkAt: 1 + r() * 4, seed: r() * 100 };
}

// Poses. Each returns a full pose; poses are blended by per-pose weights for smooth transitions.
const BASE = { rise: 0, lean: 0, turn: 0, aLx: -1.1, aLz: 0, aRx: -1.1, aRz: 0, hX: 0, hZ: 0, cup: 0, bob: 0, swing: 0, back: 0 };
const POSE_KEYS = Object.keys(BASE);
const POSES = {
  writing: (t) => ({ ...BASE, lean: 0.12, hX: 0.15, aLx: -1.1 + Math.sin(t * 22) * 0.13, aRx: -1.1 + Math.cos(t * 22) * 0.13 }),
  running: (t) => ({ ...BASE, lean: 0.08, hX: 0.1, aLx: -1.1 + Math.sin(t * 14) * 0.1, aRx: -1.1 + Math.cos(t * 14) * 0.1 }),
  reading: (t) => ({ ...BASE, lean: 0.3, hX: 0.25, aLx: -1.0, aRx: -1.0 + Math.max(0, Math.sin(t * 2)) * 0.08 }),
  thinking: (t) => ({ ...BASE, lean: 0.05, hX: -0.12, hZ: 0.15 + Math.sin(t * 0.8) * 0.05, aLx: -0.9, aRx: -2.4, aRz: 0.55 }),
  researching: (t) => { const s = Math.max(0, Math.sin(t * 1.1)) ** 3; return { ...BASE, lean: 0.06, aLx: -1.1 + Math.sin(t * 4) * 0.06, aRx: -1.0 - s * 1.35, aRz: s * 0.45, hX: -0.15 * s, cup: 1 }; },
  computer: (t) => ({ ...BASE, lean: 0.1, hX: 0.12, aLx: -0.5, aRx: -1.05, aRz: Math.sin(t * 2.5) * 0.22 }),
  waiting: (t) => ({ ...BASE, rise: 1, back: 1, aRx: -2.9, aRz: Math.sin(t * 8) * 0.4, aLx: 0.05, hX: -0.15, bob: Math.abs(Math.sin(t * 5)) * 0.06 }),
  visit: (t) => ({ ...BASE, rise: 1, lean: 0.05, turn: 0, aLx: -0.3, aRx: -1.4 + Math.sin(t * 3) * 0.25, aRz: -0.35, hZ: Math.sin(t * 1.5) * 0.08 }),
  lounge: (t) => { const s = Math.max(0, Math.sin(t * 0.7 + 1)) ** 3; return { ...BASE, lean: -0.22, aLx: -0.5, aRx: -1.0 - s * 1.35, aRz: s * 0.45, hX: -0.1 - 0.1 * s, hZ: Math.sin(t * 0.9) * 0.06, cup: 1 }; },
  idleDesk: (t) => ({ ...BASE, lean: -0.3, aLx: -0.5, aRx: -0.5, hX: -0.15, bob: Math.sin(t * 1.6) * 0.01 }),
  walk: (t) => ({ ...BASE, rise: 1, lean: 0.05, aLx: Math.sin(t * 10) * 0.5, aRx: -Math.sin(t * 10) * 0.5, swing: Math.sin(t * 10) * 0.55, bob: Math.abs(Math.sin(t * 10)) * 0.04 }),
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
  return P;
}
function applyPose(c, P, pos, y, heading, scale, dt) {
  c.root.position.set(pos.x, y, pos.z);
  c.root.rotation.y = heading;
  c.root.scale.setScalar(Math.max(0.01, scale));
  c.body.position.set(0, P.bob, -0.3 * P.back);
  const legX = -1.5 * (1 - P.rise);
  c.legs[0].rotation.x = legX + P.swing; c.legs[1].rotation.x = legX - P.swing;
  c.upper.rotation.set(P.lean, P.turn, 0);
  c.head.rotation.set(P.hX, 0, P.hZ);
  c.arms[0].rotation.set(P.aLx, 0, -P.aLz);
  c.arms[1].rotation.set(P.aRx, 0, P.aRz);
  c.cup.scale.setScalar(Math.max(0.001, P.cup));
  c.cup.rotation.x = -P.aRx;
  c.blinkAt -= dt;
  c.eyes.scale.y = c.blinkAt < 0 ? 0.15 : 1;
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
  { id: 'barista-one', shirt: '#F3EDE4', apron: '#3F5E4A', hair: 3, start: 0 },
  { id: 'barista-two', shirt: '#E9E1D2', apron: '#7A4A2C', hair: 1, start: 3 },
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
  const ch = makeCharacter(id);
  cafe.add(ch.root);
  const hit = new THREE.Mesh(G.box, hitMat); hit.visible = false;
  hit.position.y = 0.8; hit.scale.set(0.85, 1.75, 0.85); hit.userData.id = id;
  ch.root.add(hit); hitBoxes.push(hit);
  // per-agent kit at the seat: laptop (glowing screen), floor ring
  const color = new THREE.Color(STATES[state].color);
  const glowMat = new THREE.MeshBasicMaterial({ color: color.clone() });
  const ringMat = new THREE.MeshBasicMaterial({ color: color.clone(), transparent: true, opacity: 0.6, depthWrite: false });
  const discMat = new THREE.MeshBasicMaterial({ color: color.clone(), transparent: true, opacity: 0.16, depthWrite: false });
  const kit = new THREE.Group(); kit.position.copy(desk.pos); kit.rotation.y = desk.heading; cafe.add(kit);
  mesh(G.ring, ringMat, kit, 0, 0.012, 0, 1.1, 1, 1.1, false);
  mesh(G.disc, discMat, kit, 0, 0.011, 0, 1.1, 1, 1.1, false);
  const laptop = new THREE.Group(); laptop.position.set(0, desk.tableY + 0.002, desk.reach); kit.add(laptop);
  box('#C9CCD3', laptop, 0, 0.012, 0, 0.42, 0.024, 0.28);
  box('#8D929C', laptop, 0, 0.026, -0.03, 0.36, 0.004, 0.14, false);
  const lid = new THREE.Group(); lid.position.set(0, 0.024, 0.14); lid.rotation.x = 0.22; laptop.add(lid);
  box('#C9CCD3', lid, 0, 0.15, 0, 0.42, 0.3, 0.02);
  mesh(G.screen, glowMat, lid, 0, 0.15, -0.012, 1, 1, 1, false);
  mesh(G.sticker, glowMat, lid, 0, 0.16, 0.012, 1, 1, 1, false);
  const mouse = mesh(G.sphere, '#E9E2D6', kit, -0.36, desk.tableY + 0.02, desk.reach - 0.06, 0.05, 0.03, 0.07);

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
  const f = ((await res.json()).files || {})['cafe-state.json'];
  return f && typeof f.content === 'string' ? JSON.parse(f.content) : null;
}
async function readRaw() {
  const res = await fetch(`https://gist.githubusercontent.com/${GIST_OWNER}/${GIST_ID}/raw/cafe-state.json?t=${Date.now()}`, { cache: 'no-store' });
  if (res.status === 404) return null;   // no sessions yet
  if (!res.ok) throw new Error('bad status');
  return res.json();
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
  for (const l of pointLights) l.intensity = LIGHT_BASE.point * (1 - 0.45 * closedK);
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
