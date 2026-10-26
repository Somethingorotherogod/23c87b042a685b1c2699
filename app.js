// The Agent Café — live 3D view of agent states. Plain ES module, no build step.
// All remote strings are rendered with textContent only.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

/* ------------------------------------------------------------------ config */
const STATES = {
  thinking:    { label: 'Thinking',           color: '#A78BFA', word: 'thinking' },
  reading:     { label: 'Reading files',      color: '#60A5FA', word: 'reading' },
  writing:     { label: 'Writing code',       color: '#34D399', word: 'writing' },
  running:     { label: 'Running a command',  color: '#FBBF24', word: 'running' },
  researching: { label: 'Researching',        color: '#22D3EE', word: 'researching' },
  delegating:  { label: 'Handing off work',   color: '#F472B6', word: 'collaborating' },
  computer:    { label: 'Using the computer', color: '#FB923C', word: 'on computer' },
  waiting:     { label: 'Waiting for you',    color: '#F87171', word: 'waiting' },
  idle:        { label: 'Idle',               color: '#9CA3AF', word: 'idle' },
};
const STATE_KEYS = Object.keys(STATES);
const MAX_AGENTS = 24;
const ID_RE = /^[0-9a-f]{16}$/;
const DEMO_NAMES = ['Juniper', 'Maple', 'Clover', 'Pip', 'Biscuit', 'Hazel', 'Sprout', 'Wren', 'Mochi',
  'Olive', 'Pebble', 'Fern', 'Toffee', 'Basil', 'Nutmeg', 'Sorrel'];
const DOOR = new THREE.Vector3(10.2, 0, 2.1);

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

/* ------------------------------------------------------------------ renderer */
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color('#F5E9DA');

const camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 200);
const CAM_DIR = new THREE.Vector3(1, 0.95, 1).normalize();
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.enablePan = false;
controls.rotateSpeed = 0.6;
controls.minZoom = 0.7;
controls.maxZoom = 3;
controls.minPolarAngle = 0.55;
controls.maxPolarAngle = 1.2;
controls.minAzimuthAngle = Math.PI / 4 - 0.75;
controls.maxAzimuthAngle = Math.PI / 4 + 0.75;
let interacting = false, lastInteract = -1e9;
controls.addEventListener('start', () => { interacting = true; });
controls.addEventListener('end', () => { interacting = false; lastInteract = performance.now(); });

scene.add(new THREE.HemisphereLight('#FFF4E6', '#D9C3A5', 1.25));
const sun = new THREE.DirectionalLight('#FFF1DC', 1.7);
sun.position.set(8, 16, 7);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
Object.assign(sun.shadow.camera, { left: -14, right: 14, top: 14, bottom: -14, near: 1, far: 50 });
sun.shadow.bias = -0.0005;
sun.shadow.normalBias = 0.02;
scene.add(sun);

const cafe = new THREE.Group();
scene.add(cafe);

/* ------------------------------------------------------------------ shared geometry/materials */
const G = {
  box: new THREE.BoxGeometry(1, 1, 1),
  cyl: new THREE.CylinderGeometry(1, 1, 1, 20),
  sphere: new THREE.SphereGeometry(1, 20, 14),
  ico: new THREE.IcosahedronGeometry(1, 0),
  torso: new THREE.CapsuleGeometry(0.26, 0.3, 6, 14),
  limb: new THREE.CapsuleGeometry(0.075, 0.26, 4, 8),
  leg: new THREE.CapsuleGeometry(0.095, 0.26, 4, 8),
  head: new THREE.SphereGeometry(0.3, 22, 16),
  hemi: new THREE.SphereGeometry(0.315, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2),
  eye: new THREE.SphereGeometry(0.036, 10, 8),
  ring: new THREE.RingGeometry(0.42, 0.58, 36).rotateX(-Math.PI / 2),
  disc: new THREE.CircleGeometry(0.42, 36).rotateX(-Math.PI / 2),
  screen: new THREE.PlaneGeometry(0.36, 0.24).rotateY(Math.PI),
  sticker: new THREE.CircleGeometry(0.045, 16),
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

/* ------------------------------------------------------------------ static café */
function plankTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d');
  const cols = ['#D9A877', '#D29E6C', '#DDAF80', '#CF9B69'];
  for (let i = 0; i < 8; i++) {
    g.fillStyle = cols[i % 4]; g.fillRect(0, i * 32, 256, 32);
    g.fillStyle = 'rgba(120,70,30,.25)'; g.fillRect(0, i * 32, 256, 2);
    g.fillRect(((i * 97) % 256), i * 32, 2, 32);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(5, 4);
  return t;
}
// ground + raised floor
mesh(new THREE.CircleGeometry(30, 48).rotateX(-Math.PI / 2), '#EADFC4', cafe, 0, -0.45, 0, 1, 1, 1, false);
box('#C98F5E', cafe, 0.5, -0.22, 0, 20, 0.44, 14);
const floor = mesh(new THREE.PlaneGeometry(19.6, 13.6).rotateX(-Math.PI / 2),
  new THREE.MeshStandardMaterial({ map: plankTexture(), roughness: 0.9 }), cafe, 0.5, 0.001, 0, 1, 1, 1, false);
floor.receiveShadow = true;
box('#E7C9A6', cafe, 10.9, -0.22, 2.1, 1.4, 0.44, 1.8); // door step

// walls
box('#F3DCC4', cafe, 0.5, 1.7, -7.1, 20, 3.4, 0.25);
box('#E2B98F', cafe, 0.5, 0.45, -6.95, 20, 0.9, 0.06);
box('#F3DCC4', cafe, -9.6, 0.45, 0, 0.25, 0.9, 14);
box('#F3DCC4', cafe, -9.6, 3.1, 0, 0.25, 0.6, 14);
for (const z of [-7, -3.5, 0, 3.5, 7]) box('#E8CBAA', cafe, -9.6, 1.7, z, 0.3, 3.4, 0.3);
const glass = new THREE.MeshStandardMaterial({ color: '#CFE8F0', transparent: true, opacity: 0.22, roughness: 0.1, depthWrite: false });
mesh(G.box, glass, cafe, -9.6, 1.85, 0, 0.04, 1.9, 14, false);
// right glass front with door gap
for (const z of [-7, -4.5, -2, 1.2, 3.0, 5, 7]) box('#E8CBAA', cafe, 10.4, 1.4, z, 0.2, 2.8, 0.2);
box('#E8CBAA', cafe, 10.4, 2.9, 0, 0.25, 0.25, 14);
mesh(G.box, glass, cafe, 10.4, 1.4, -2.9, 0.04, 2.7, 8.2, false);
mesh(G.box, glass, cafe, 10.4, 1.4, 5.0, 0.04, 2.7, 4, false);
box('#E07A5F', cafe, 10.9, 3.0, 2.1, 1.0, 0.12, 2.2); // awning

// counter
box('#B7794A', cafe, -4.6, 0.52, -5.6, 8, 1.04, 0.9);
box('#8A5634', cafe, -4.6, 1.08, -5.6, 8.2, 0.08, 1.05);
// espresso machine
const esp = new THREE.Group(); esp.position.set(-7.4, 1.12, -5.75); cafe.add(esp);
box('#5FA8A0', esp, 0, 0.35, 0, 1.0, 0.7, 0.6);
box('#E9E2D6', esp, 0, 0.74, 0, 1.05, 0.08, 0.65);
for (const x of [-0.25, 0.25]) { cyl('#B9B2A8', esp, x, 0.12, 0.33, 0.07, 0.14); cyl('#FFFFFF', esp, x, -0.02, 0.4, 0.06, 0.1); }
// cups + pastry case
for (let i = 0; i < 4; i++) cyl('#FFFDF7', cafe, -6.2 + i * 0.22, 1.18, -5.3, 0.07, 0.12);
const pastry = new THREE.Group(); pastry.position.set(-2.2, 1.12, -5.6); cafe.add(pastry);
box('#8A5634', pastry, 0, 0.03, 0, 1.6, 0.06, 0.75);
mesh(G.box, glass, pastry, 0, 0.32, 0, 1.6, 0.55, 0.75, false);
const pastryCols = ['#E7A35A', '#F2C3D0', '#C98348', '#F6E1A6', '#B5651D', '#F4B6C2'];
for (let i = 0; i < 6; i++) mesh(G.sphere, pastryCols[i], pastry, -0.6 + i * 0.24, 0.15, (i % 2) * 0.2 - 0.1, 0.1, 0.07, 0.1);

// chalkboard (live counts)
const boardCanvas = document.createElement('canvas'); boardCanvas.width = 1024; boardCanvas.height = 560;
const boardTex = new THREE.CanvasTexture(boardCanvas); boardTex.colorSpace = THREE.SRGBColorSpace; boardTex.anisotropy = 4;
box('#7A4A2C', cafe, -4.6, 2.45, -6.95, 4.25, 2.0, 0.08);
mesh(new THREE.PlaneGeometry(4.0, 1.75), new THREE.MeshBasicMaterial({ map: boardTex }), cafe, -4.6, 2.45, -6.9, 1, 1, 1, false);
let boardKey = '';
function drawBoard(counts) {
  const key = JSON.stringify(counts);
  if (key === boardKey) return; boardKey = key;
  const g = boardCanvas.getContext('2d');
  const W = boardCanvas.width, H = boardCanvas.height;
  g.fillStyle = '#2F3D37'; g.fillRect(0, 0, W, H);
  g.fillStyle = 'rgba(255,255,255,0.04)';
  for (let i = 0; i < 18; i++) { g.beginPath(); g.ellipse((i * 211) % W, (i * 137) % H, 120, 40, i, 0, Math.PI * 2); g.fill(); }
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = '#FFF6E6'; g.font = '600 70px Fredoka, ui-rounded, sans-serif';
  g.fillText('Today at the café', W / 2, 74);
  g.strokeStyle = 'rgba(255,246,230,.5)'; g.lineWidth = 3; g.beginPath(); g.moveTo(260, 122); g.lineTo(W - 260, 122); g.stroke();
  const entries = STATE_KEYS.filter((k) => counts[k] > 0).map((k) => ({ k, text: `${counts[k]} ${STATES[k].word}` }));
  g.font = '500 50px Fredoka, ui-rounded, sans-serif';
  if (!entries.length) { g.fillStyle = '#E8DCC8'; g.fillText('All quiet right now', W / 2, 300); }
  const rows = [];
  for (let i = 0; i < entries.length; i += 2) rows.push(entries.slice(i, i + 2));
  const rowH = rows.length > 4 ? 76 : 86;
  const startY = 190 + Math.max(0, (4 - rows.length)) * rowH * 0.5;
  rows.forEach((row, ri) => {
    const sep = '  ·  ';
    const widths = row.map((e) => g.measureText(e.text).width + 34);
    const sepW = row.length > 1 ? g.measureText(sep).width : 0;
    let x = W / 2 - (widths.reduce((a, b) => a + b, 0) + sepW) / 2;
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

// shelves + plants
box('#A86F45', cafe, 4.5, 2.3, -6.85, 3.0, 0.08, 0.4);
for (let i = 0; i < 6; i++) cyl(['#F2C3D0', '#A3C985', '#F6E1A6', '#9AC8E6'][i % 4], cafe, 3.3 + i * 0.48, 2.5, -6.85, 0.12, 0.3);
function plant(x, z, s = 1) {
  cyl('#C9875A', cafe, x, 0.25 * s, z, 0.28 * s, 0.5 * s);
  mesh(G.ico, '#7FB069', cafe, x, 0.85 * s, z, 0.48 * s, 0.6 * s, 0.48 * s);
  mesh(G.ico, '#94C47D', cafe, x + 0.15 * s, 1.2 * s, z - 0.1 * s, 0.32 * s, 0.4 * s, 0.32 * s);
}
plant(-9.0, -6.5, 1.2); plant(9.8, -6.5, 1.2); plant(-9.0, 6.4); plant(9.8, 6.4); plant(9.8, 0.4, 0.8);

// pendant lamps
const bulbMat = new THREE.MeshBasicMaterial({ color: '#FFE7B0' });
const shadeGeo = new THREE.ConeGeometry(0.35, 0.3, 18, 1, true);
for (const [x, z] of [[-6.4, 0], [-2, 0], [2.4, 0], [-6.4, 4.4], [-2, 4.4], [2.4, 4.4], [6.6, -4.3]]) {
  mesh(G.cyl, '#5A4636', cafe, x, 4.2, z, 0.012, 1.6, 0.012, false);
  const sh = mesh(shadeGeo, mat('#E9A23B', { side: THREE.DoubleSide }), cafe, x, 3.3, z, 1, 1, 1, false);
  sh.castShadow = false;
  mesh(G.sphere, bulbMat, cafe, x, 3.15, z, 0.1, 0.1, 0.1, false);
}
for (const [x, z] of [[-4.2, 1.5], [1.5, 2.5], [6.6, -4.3]]) {
  const l = new THREE.PointLight('#FFC98A', 9, 9, 1.6); l.position.set(x, 3.0, z); cafe.add(l);
}

/* ------------------------------------------------------------------ desks (24 own tables) */
const DESKS = [];
{
  const xs = [-7.6, -5.3, -3.0, -0.7, 1.6, 3.9];
  const zs = [-2.3, 0.2, 2.7, 5.2];
  for (const z of zs) for (const x of xs) {
    const t = new THREE.Group(); t.position.set(x, 0, z); cafe.add(t);
    box('#E9D3B6', t, 0, 0.73, 0, 0.95, 0.06, 0.8);
    cyl('#6E4A33', t, 0, 0.36, 0, 0.05, 0.7);
    cyl('#6E4A33', t, 0, 0.02, 0, 0.28, 0.04);
    // chair on the -z side, facing +z
    const c = new THREE.Group(); c.position.set(x, 0, z - 0.72); cafe.add(c);
    box('#C97B4A', c, 0, 0.42, -0.05, 0.5, 0.07, 0.46);
    box('#C97B4A', c, 0, 0.72, -0.27, 0.5, 0.5, 0.06);
    for (const [lx, lz] of [[-0.2, -0.24], [0.2, -0.24], [-0.2, 0.15], [0.2, 0.15]]) box('#8A5634', c, lx, 0.2, lz, 0.05, 0.4, 0.05, false);
    DESKS.push({ chair: new THREE.Vector3(x, 0, z - 0.72), table: new THREE.Vector3(x, 0, z), heading: 0, owner: null });
  }
}
const DESK_ORDER = [...DESKS.keys()];

/* ------------------------------------------------------------------ lounge (social area) */
const LOUNGE = [];
{
  const cx = 7.6, cz = -4.4;
  const L = new THREE.Group(); L.position.set(cx, 0, cz); cafe.add(L);
  mesh(new THREE.CircleGeometry(2.3, 40).rotateX(-Math.PI / 2), '#E7B7A3', L, 0, 0.01, 0, 1, 1, 1, false);
  cyl('#8A5634', L, 0, 0.35, 0, 0.55, 0.06);
  cyl('#6E4A33', L, 0, 0.17, 0, 0.08, 0.32);
  cyl('#FFFDF7', L, 0.15, 0.43, 0.1, 0.07, 0.1);
  // sofa (back), 3 seats facing +z
  box('#7FA7C9', L, 0, 0.25, -1.45, 2.6, 0.5, 0.8);
  box('#6E95B8', L, 0, 0.7, -1.78, 2.6, 0.7, 0.22);
  box('#6E95B8', L, -1.37, 0.45, -1.45, 0.22, 0.5, 0.8);
  box('#6E95B8', L, 1.37, 0.45, -1.45, 0.22, 0.5, 0.8);
  for (const x of [-0.8, 0, 0.8]) LOUNGE.push({ pos: new THREE.Vector3(cx + x, 0, cz - 1.4), heading: 0 });
  // armchairs left/right
  for (const s of [-1, 1]) {
    box('#E39B7B', L, s * 1.7, 0.25, 0, 0.8, 0.5, 0.85);
    box('#D58867', L, s * 2.0, 0.65, 0, 0.2, 0.6, 0.85);
    LOUNGE.push({ pos: new THREE.Vector3(cx + s * 1.65, 0, cz), heading: s > 0 ? -Math.PI / 2 : Math.PI / 2 });
  }
  // poufs in front
  for (const x of [-0.75, 0.75]) {
    cyl('#F3C969', L, x, 0.2, 1.3, 0.32, 0.4);
    LOUNGE.push({ pos: new THREE.Vector3(cx + x, 0, cz + 1.3), heading: Math.PI });
  }
  for (const p of LOUNGE) p.owner = null;
}
function extraLoungeSpot(i) { // overflow: stand around the lounge
  const a = (i * 0.9) + 0.3, cx = 7.6, cz = -4.4;
  const pos = new THREE.Vector3(cx + Math.cos(a) * 2.6, 0, cz + 0.6 + Math.abs(Math.sin(a)) * 2.2);
  return { pos, heading: Math.atan2(cx - pos.x, cz - pos.z), stand: true };
}

/* ------------------------------------------------------------------ characters */
const HOODIES = ['#F28C8C', '#7FB8E6', '#8FD3B6', '#F6C177', '#B79CED', '#F49AC2', '#6CC4C9', '#E8A87C', '#A3C985', '#F3D36B', '#9AA7F0', '#E07A5F'];
const SKIN = ['#F9DCC4', '#F1C6A5', '#E0AC8A', '#C68A65', '#9C6644', '#FFE3D3'];
const HAIR = ['#3B2F2F', '#6B4F3A', '#C58B4E', '#E9C46A', '#2E2A3A', '#B5523B', '#8E8EA0'];
const PANTS = ['#4F5D75', '#5C4B51', '#3E5641', '#6B705C', '#33415C'];

function makeCharacter(id) {
  const r = rng(hashStr(id));
  const pick = (a) => a[Math.floor(r() * a.length)];
  const hoodie = pick(HOODIES), skin = pick(SKIN), hair = pick(HAIR), pants = pick(PANTS);
  const hatType = Math.floor(r() * 4), hatCol = pick(HOODIES.filter((c) => c !== hoodie));

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
};
const POSE_NAMES = Object.keys(POSES);

/* ------------------------------------------------------------------ labels */
const labelsEl = document.getElementById('labels');
function makeLabel() {
  const el = document.createElement('div'); el.className = 'tag';
  const bubble = document.createElement('div'); bubble.className = 'bubble';
  const name = document.createElement('div'); name.className = 'name';
  const dot = document.createElement('i'); const nameText = document.createElement('span');
  name.append(dot, nameText);
  const state = document.createElement('div'); state.className = 'state';
  el.append(bubble, name, state);
  labelsEl.appendChild(el);
  return { el, bubble, dot, nameText, state, bubbleKind: null, stateText: '' };
}

/* ------------------------------------------------------------------ agents */
const agents = new Map(); // id -> agent
const WORKING = new Set(['thinking', 'reading', 'writing', 'running', 'researching', 'computer']);

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
  // per-agent kit at the desk: laptop (glowing screen), floor ring
  const color = new THREE.Color(STATES[state].color);
  const glowMat = new THREE.MeshBasicMaterial({ color: color.clone() });
  const ringMat = new THREE.MeshBasicMaterial({ color: color.clone(), transparent: true, opacity: 0.6, depthWrite: false });
  const discMat = new THREE.MeshBasicMaterial({ color: color.clone(), transparent: true, opacity: 0.16, depthWrite: false });
  const kit = new THREE.Group(); kit.position.copy(desk.chair); cafe.add(kit);
  mesh(G.ring, ringMat, kit, 0, 0.012, 0.25, 1.2, 1, 1.2, false);
  mesh(G.disc, discMat, kit, 0, 0.011, 0.25, 1.2, 1, 1.2, false);
  const laptop = new THREE.Group(); laptop.position.set(0, 0.765, 0.56); kit.add(laptop);
  box('#C9CCD3', laptop, 0, 0.012, 0, 0.42, 0.024, 0.28);
  box('#8D929C', laptop, 0, 0.026, -0.03, 0.36, 0.004, 0.14, false);
  const lid = new THREE.Group(); lid.position.set(0, 0.024, 0.14); lid.rotation.x = 0.22; laptop.add(lid);
  box('#C9CCD3', lid, 0, 0.15, 0, 0.42, 0.3, 0.02);
  mesh(G.screen, glowMat, lid, 0, 0.15, -0.012, 1, 1, 1, false);
  mesh(G.sticker, glowMat, lid, 0, 0.16, 0.012, 1, 1, 1, false);
  const mouse = mesh(G.sphere, '#E9E2D6', kit, -0.38, 0.79, 0.5, 0.05, 0.03, 0.07);

  const a = {
    id, name: cleanName(name), state, since: Number(since) || Date.now(),
    ch, desk, kit, laptop, mouse, glowMat, ringMat, discMat, color, targetColor: new THREE.Color(),
    label: makeLabel(),
    pos: DOOR.clone(), heading: -Math.PI / 2, scale: reduced ? 1 : 0.01,
    leaving: false, spot: null, visit: null, moving: true,
    weights: Object.fromEntries(POSE_NAMES.map((p) => [p, p === 'walk' ? 1 : 0])),
    pose: { ...BASE }, tOff: ch.seed,
  };
  if (reduced) a.pos.copy(desk.chair);
  agents.set(id, a);
  updateLabelText(a, true);
  return a;
}

function setAgentState(a, name, state, since) {
  a.name = cleanName(name);
  if (a.state !== state) { a.state = state; a.since = Number(since) || Date.now(); }
  else if (since) a.since = Number(since) || a.since;
  if (a.leaving) { a.leaving = false; }
  updateLabelText(a, true);
}

function removeAgentNow(a) {
  cafe.remove(a.ch.root); cafe.remove(a.kit);
  a.glowMat.dispose(); a.ringMat.dispose(); a.discMat.dispose();
  a.label.el.remove();
  a.desk.owner = null;
  if (a.spot && a.spot.owner === a.id) a.spot.owner = null;
  agents.delete(a.id);
}

function updateLabelText(a, force) {
  const L = a.label, info = STATES[a.state];
  if (force || L.nameText.textContent !== a.name) L.nameText.textContent = a.name;
  const mins = Math.floor((Date.now() - a.since) / 60000);
  const label = a.state === 'delegating' && a.visit ? 'Collaborating' : info.label;
  const text = mins >= 1 ? `${label} · ${mins < 60 ? mins + 'm' : Math.floor(mins / 60) + 'h'}` : label;
  if (force || text !== L.stateText) { L.stateText = text; L.state.textContent = text; }
  L.state.style.backgroundColor = info.color;
  L.dot.style.backgroundColor = info.color;
}

// Decide where an agent should be right now.
function loungeSpotFor(a) {
  if (a.spot && a.spot.owner === a.id) return a.spot;
  const free = LOUNGE.find((s) => !s.owner);
  if (free) { free.owner = a.id; a.spot = free; return free; }
  let n = 0; for (const b of agents.values()) if (b.state === 'idle' && b !== a) n++;
  a.spot = extraLoungeSpot(n + (hashStr(a.id) % 5)); a.spot.owner = a.id;
  return a.spot;
}
function releaseSpot(a) { if (a.spot) { if (a.spot.owner === a.id) a.spot.owner = null; a.spot = null; } }

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

const tmpV = new THREE.Vector3(), tmpV2 = new THREE.Vector3();
function targetFor(a) {
  // returns {pos, heading, mode}
  if (a.leaving) return { pos: DOOR, heading: -Math.PI / 2, mode: 'leave' };
  if (a.state === 'idle') {
    const s = loungeSpotFor(a);
    return { pos: s.pos, heading: s.heading, mode: s.stand ? 'visit' : 'lounge' };
  }
  releaseSpot(a);
  if (a.state === 'delegating') {
    const t = pickVisit(a);
    if (t) {
      const visitors = [...agents.values()].filter((b) => b.visit === t.id && b.state === 'delegating' && !b.leaving);
      const idx = Math.max(0, visitors.indexOf(a));
      const side = idx % 2 === 0 ? 1 : -1;
      const p = tmpV.copy(t.desk.chair).add(tmpV2.set(side * (0.8 + Math.floor(idx / 2) * 0.55), 0, 0.15));
      const tp = t.ch.root.position;
      return { pos: p, heading: Math.atan2(tp.x - p.x, tp.z - p.z), mode: 'visit' };
    }
  } else a.visit = null;
  return { pos: a.desk.chair, heading: a.desk.heading, mode: 'desk' };
}

function poseNameFor(a, mode) {
  if (a.moving) return 'walk';
  if (mode === 'lounge') return 'lounge';
  if (mode === 'visit' || mode === 'leave') return 'visit';
  if (a.state === 'idle' || a.state === 'delegating') return 'idleDesk';
  return a.state;
}

const GREY = new THREE.Color('#3A3F47');
function updateAgent(a, dt, time, moveDt = dt) {
  const tgt = targetFor(a);
  const toX = tgt.pos.x - a.pos.x, toZ = tgt.pos.z - a.pos.z;
  const dist = Math.hypot(toX, toZ);
  if (reduced && !a.leaving && dist > 0.01) { a.pos.set(tgt.pos.x, 0, tgt.pos.z); }
  const speed = 4.2;
  a.moving = dist > 0.05;
  if (a.moving) {
    const step = Math.min(dist, speed * moveDt);
    a.pos.x += (toX / dist) * step; a.pos.z += (toZ / dist) * step;
    a.heading = angleLerp(a.heading, Math.atan2(toX, toZ), damp(12, dt));
  } else {
    a.pos.x = tgt.pos.x; a.pos.z = tgt.pos.z;
    a.heading = angleLerp(a.heading, tgt.heading, damp(8, dt));
  }
  // leaving: shrink at the door
  if (a.leaving && dist < 0.2) a.scale -= dt * 3;
  else a.scale += (1 - a.scale) * damp(reduced ? 30 : 6, dt);
  if (a.leaving && (a.scale <= 0.02 || reduced)) { removeAgentNow(a); return; }

  // pose blending
  const pname = poseNameFor(a, tgt.mode);
  const k = damp(reduced ? 12 : 6, dt);
  const tt = (time + a.tOff) * (reduced ? 0.35 : 1);
  const P = a.pose; for (const key of POSE_KEYS) P[key] = 0;
  let sum = 0;
  for (const n of POSE_NAMES) {
    const w = (a.weights[n] += ((n === pname ? 1 : 0) - a.weights[n]) * k);
    if (w < 0.002) continue;
    const p = POSES[n](tt); sum += w;
    for (const key of POSE_KEYS) P[key] += p[key] * w;
  }
  if (sum > 0) for (const key of POSE_KEYS) P[key] /= sum;

  const c = a.ch;
  c.root.position.copy(a.pos);
  c.root.rotation.y = a.heading;
  c.root.scale.setScalar(Math.max(0.01, a.scale));
  c.body.position.set(0, P.bob, -0.3 * P.back);
  const legX = -1.5 * (1 - P.rise);
  c.legs[0].rotation.x = legX + P.swing; c.legs[1].rotation.x = legX - P.swing;
  c.upper.rotation.set(P.lean, P.turn, 0);
  c.head.rotation.set(P.hX, 0, P.hZ);
  c.arms[0].rotation.set(P.aLx, 0, -P.aLz);
  c.arms[1].rotation.set(P.aRx, 0, P.aRz);
  c.cup.scale.setScalar(Math.max(0.001, P.cup));
  c.cup.rotation.x = -P.aRx;
  // blink
  c.blinkAt -= dt;
  c.eyes.scale.y = c.blinkAt < 0 ? 0.15 : 1;
  if (c.blinkAt < -0.12) c.blinkAt = 2 + Math.random() * 4;

  // kit colours: screen glows in state colour when at desk, dim when away
  a.targetColor.set(STATES[a.state].color);
  const ck = damp(5, dt);
  a.ringMat.color.lerp(a.targetColor, ck); a.discMat.color.lerp(a.targetColor, ck);
  const atDesk = tgt.mode === 'desk' && !a.moving;
  const screenTarget = atDesk ? a.targetColor : tmpColor.copy(a.targetColor).lerp(GREY, 0.75);
  a.glowMat.color.lerp(screenTarget, ck);
  if (a.state === 'running' && atDesk && !reduced) a.glowMat.color.multiplyScalar(0.8 + Math.random() * 0.25);
  a.ringMat.opacity = 0.6 * Math.min(1, a.scale);
  a.mouse.visible = a.state === 'computer';
  a.kit.scale.setScalar(a.leaving ? Math.max(0.001, a.scale) : 1);
  a.mode = tgt.mode;
}
const tmpColor = new THREE.Color();

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
  for (const a of agents.values()) if (!seen.has(a.id) && !a.leaving) { a.leaving = true; releaseSpot(a); a.visit = null; }
}

/* ------------------------------------------------------------------ HUD */
const connEl = document.getElementById('conn');
const connText = document.getElementById('conn-text');
const legendEl = document.getElementById('legend');
let legendKey = '';
function setConn(mode) {
  connEl.dataset.mode = mode;
  connText.textContent = { live: 'Live', reconnecting: 'Reconnecting…', demo: 'Demo', connecting: 'Connecting…' }[mode];
  document.body.classList.toggle('is-demo', mode === 'demo');
}
function updateHud() {
  const counts = {}; let total = 0;
  for (const a of agents.values()) if (!a.leaving) { counts[a.state] = (counts[a.state] || 0) + 1; total++; }
  drawBoard(counts);
  const key = total + JSON.stringify(counts);
  if (key === legendKey) return; legendKey = key;
  legendEl.replaceChildren();
  const tot = document.createElement('span'); tot.className = 'total';
  tot.textContent = total === 1 ? '1 agent' : `${total} agents`;
  legendEl.appendChild(tot);
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

/* ------------------------------------------------------------------ data: secret gist + demo */
// The link carries a secret gist id after the "#" (never sent to any server). Each agent is one file in that
// gist ("agent-<id>.json": {id, name, state, since, seen}), written by the hook on the Mac.
// Without an id in the link, the café runs a demo.
const GIST_ID = (location.hash.slice(1).match(/^[0-9a-f]{20,40}$/) || [null])[0];
const IDLE_AFTER = 5 * 60e3, GONE_AFTER = 30 * 60e3, POLL_MS = 15000;
let mode = 'connecting', everLive = false, etag = null, failures = 0, files = [], pauseUntil = 0;

function showAgents() {
  const now = Date.now(), list = [];
  for (const f of files) {
    const seen = Number(f.seen) || Number(f.since) || 0;
    const age = now - seen;
    if (!(age < GONE_AFTER)) continue;          // quiet for 30 min: gone (e.g. a session that crashed)
    if (age > IDLE_AFTER) list.push({ id: f.id, name: f.name, state: 'idle', since: seen + IDLE_AFTER });
    else list.push({ id: f.id, name: f.name, state: f.state, since: Number(f.since) || seen });
  }
  everLive = true;
  if (mode !== 'live') { stopDemo(); mode = 'live'; setConn('live'); }
  applySnapshot(list);
}

async function pollGist() {
  if (Date.now() < pauseUntil) return;
  try {
    const headers = { Accept: 'application/vnd.github+json' };
    if (etag) headers['If-None-Match'] = etag;   // unchanged answers (304) don't use up GitHub's limit
    const res = await fetch(`https://api.github.com/gists/${GIST_ID}`, { headers, cache: 'no-store' });
    if (res.status === 304) { failures = 0; showAgents(); return; }
    if (res.status === 403 || res.status === 429) {   // rate limited: wait for the reset
      const reset = Number(res.headers.get('X-RateLimit-Reset')) * 1000;
      pauseUntil = reset > Date.now() ? reset : Date.now() + 60e3;
      throw new Error('rate limited');
    }
    if (!res.ok) throw new Error('bad status');
    etag = res.headers.get('ETag');
    const data = await res.json();
    files = Object.entries(data.files || {})
      .filter(([name]) => /^agent-[0-9a-f]{16}\.json$/.test(name))
      .map(([, f]) => { try { return JSON.parse(f.content); } catch { return null; } })
      .filter((f) => f && typeof f === 'object');
    failures = 0;
    showAgents();
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
  let demo = names.slice(0, 6).map((name, i) => ({ id: randId(), name, state: ['writing', 'idle', 'thinking', 'delegating', 'idle', 'waiting'][i], since: Date.now() }));
  let nameIdx = 6;
  const push = () => applySnapshot(demo);
  push();
  demoTimers.push(setInterval(() => {
    const n = 1 + Math.floor(Math.random() * 2);
    for (let i = 0; i < n; i++) { const a = demo[Math.floor(Math.random() * demo.length)]; a.state = pickState(); a.since = Date.now(); }
    push();
  }, 3200));
  demoTimers.push(setInterval(() => {
    if (Math.random() < 0.5 && demo.length > 4) demo.splice(Math.floor(Math.random() * demo.length), 1);
    else if (demo.length < 8) demo.push({ id: randId(), name: names[nameIdx++ % names.length], state: pickState(), since: Date.now() });
    push();
  }, 14000));
}
function stopDemo() {
  if (mode !== 'demo') return;
  demoTimers.forEach(clearInterval); demoTimers = [];
  document.body.classList.remove('is-demo');
}

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
  const bx = portrait ? [-9.8, 10.8] : [-9.8, 11.4];
  const bz = portrait ? [-7.2, 6.4] : [-7.2, 7.2];
  const center = new THREE.Vector3((bx[0] + bx[1]) / 2, 0.8, (bz[0] + bz[1]) / 2);
  controls.target.copy(center);
  camera.position.copy(center).addScaledVector(CAM_DIR, 60);
  camera.lookAt(center); camera.updateMatrixWorld(true);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const x of bx) for (const y of [0, 3.4]) for (const z of bz) {
    const v = new THREE.Vector3(x, y, z).applyMatrix4(camera.matrixWorldInverse);
    minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x); minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y);
  }
  const topPx = portrait ? topEl.getBoundingClientRect().bottom + 18 : 40;
  const botPx = portrait ? viewH - bottomEl.getBoundingClientRect().top + 6 : 30;
  const side = portrait ? 4 : 30;
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

/* ------------------------------------------------------------------ loop */
const clock = new THREE.Clock();
const proj = new THREE.Vector3();
let hudTimer = 0, textTimer = 0, sway = 1;
function frame() {
  const rawDt = Math.min(clock.getDelta(), 3);
  const dt = Math.min(rawDt, 0.1);
  const time = clock.elapsedTime;

  const idleFor = performance.now() - lastInteract;
  const swayTarget = interacting || idleFor < 4000 || reduced ? 0 : 1;
  sway += (swayTarget - sway) * damp(1.5, dt);
  cafe.rotation.y = Math.sin(time * 0.12) * 0.05 * sway;
  controls.update();

  for (const a of [...agents.values()]) updateAgent(a, dt, time, rawDt);

  hudTimer -= dt; if (hudTimer <= 0) { hudTimer = 0.25; updateHud(); }
  textTimer -= dt; if (textTimer <= 0) { textTimer = 5; for (const a of agents.values()) updateLabelText(a, false); }

  scene.updateMatrixWorld();
  // chat bubbles: idle agents in the lounge take turns; visitors alternate with their host
  const loungers = [...agents.values()].filter((a) => a.mode === 'lounge' && !a.moving).sort((x, y) => (x.id < y.id ? -1 : 1));
  const speaker = loungers.length > 1 ? loungers[Math.floor(time / 2.2) % loungers.length] : null;
  for (const a of agents.values()) {
    let kind = '';
    if (a.state === 'waiting' && !a.leaving) kind = 'wait';
    else if (a.state === 'thinking') kind = 'think';
    else if (a === speaker) kind = 'chat';
    else if (a.mode === 'visit' && a.state === 'delegating' && !a.moving && Math.floor(time / 1.8) % 2 === 0) kind = 'chat';
    const L = a.label;
    if (kind !== L.bubbleKind) {
      L.bubbleKind = kind; L.el.dataset.bubble = kind;
      L.bubble.textContent = kind === 'wait' ? '!' : kind ? '…' : '';
    }
    a.ch.anchor.getWorldPosition(proj).project(camera);
    const x = (proj.x * 0.5 + 0.5) * viewW, y = (-proj.y * 0.5 + 0.5) * viewH;
    L.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
    L.el.style.zIndex = String(Math.round((1 - proj.z) * 1000));
    L.el.style.opacity = a.leaving ? '0' : String(Math.min(1, a.scale * 1.5));
  }

  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
updateHud();
requestAnimationFrame(frame);
