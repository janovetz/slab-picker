// 3D "as installed" view: each area's stone, cut from the slab exactly where the layout puts it,
// sitting on walnut plywood drawer cabinets. three.js loads on first open (import map in index.html).
//
// World space is in inches: X runs along the wall, Y is up from the floor, Z comes out from the wall.
// A counter's piece-local (x, y) maps to world (X = x, Z = y), so the wall edge (y = 0) sits on Z = 0.
import { SLAB, INSTALL } from './data.js';

const EPS = 1e-6;
const T = SLAB.thickness;
const SEAM = 0.01;                  // keeps a drop's face just proud of the counter edge it covers
const WOOD_U = 64, WOOD_V = 32;     // inches covered by one tile of the walnut texture
const WALL_T = 4, WALL_RUN = 30;    // wall thickness, and how far walls run past the stone

let THREE, OrbitControls, RoomEnvironment;
let V = null;       // the viewer, created on first open
let api = null;     // callbacks into app.js, refreshed on every open
let dialogBound = false;

async function loadThree() {
  if (THREE) return;
  const [three, oc, re] = await Promise.all([
    import('three'),
    import('three/addons/controls/OrbitControls.js'),
    import('three/addons/environments/RoomEnvironment.js'),
  ]);
  THREE = three; OrbitControls = oc.OrbitControls; RoomEnvironment = re.RoomEnvironment;
}

const $d = sel => document.querySelector('#view3d ' + sel);

export async function open3D(appApi, areaId) {
  api = appApi;
  const dlg = document.getElementById('view3d');
  bindDialog(dlg);
  buildTabs(areaId);
  if (!dlg.open) dlg.showModal();
  if (!V) {
    setStatus('Loading 3D…');
    try {
      await loadThree();
      initViewer();
    } catch (err) {
      console.error(err);
      setStatus('Couldn’t start the 3D view. It needs WebGL and an internet connection the first time.');
      return;
    }
  }
  setStatus('');
  show(areaId);
}

function bindDialog(dlg) {
  if (dialogBound) return;
  dialogBound = true;
  $d('.v3-close').addEventListener('click', () => dlg.close());
  $d('.v3-save').addEventListener('click', () => V && saveImage());
  $d('.v3-reset').addEventListener('click', () => V && show(V.areaId));
  $d('.v3-tabs').addEventListener('click', e => {
    const b = e.target.closest('button[data-area]');
    if (b && V) show(b.dataset.area);
  });
}

function buildTabs(activeId) {
  $d('.v3-tabs').innerHTML = api.areas.map(a =>
    `<button data-area="${a.id}" role="tab" aria-selected="${a.id === activeId}"><i style="background:${a.color}"></i>${a.name}</button>`).join('');
}

function setStatus(msg) {
  const el = $d('.v3-status');
  el.textContent = msg;
  el.hidden = !msg;
}

// ============================================================ viewer
function initViewer() {
  const stage = $d('.v3-stage');
  const canvas = stage.querySelector('canvas');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const bg = 0xe4dfd5;
  scene.background = new THREE.Color(bg);
  scene.fog = new THREE.Fog(bg, 500, 1400);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.5;

  const sun = new THREE.DirectionalLight(0xfff2e2, 2.4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0003;
  sun.shadow.normalBias = 0.05;
  scene.add(sun, sun.target);

  const mats = makeMaterials(renderer);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000), mats.floor);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  const camera = new THREE.PerspectiveCamera(30, 1, 1, 4000);
  const controls = new OrbitControls(camera, canvas);
  controls.maxPolarAngle = Math.PI / 2 - 0.02;
  controls.screenSpacePanning = true;
  controls.zoomToCursor = true;
  controls.addEventListener('change', render);

  V = { renderer, scene, camera, controls, sun, stage, mats, group: null, areaId: null };
  new ResizeObserver(() => { resize(); render(); }).observe(stage);
}

function render() { if (V) V.renderer.render(V.scene, V.camera); }

function resize() {
  const w = Math.max(1, V.stage.clientWidth), h = Math.max(1, V.stage.clientHeight);
  V.renderer.setSize(w, h, false);
  V.camera.aspect = w / h;
  V.camera.updateProjectionMatrix();
}

function show(areaId) {
  const area = api.areas.find(a => a.id === areaId) ?? api.areas[0];
  V.areaId = area.id;
  for (const b of document.querySelectorAll('#view3d .v3-tabs button')) b.setAttribute('aria-selected', b.dataset.area === area.id);
  if (V.group) {
    V.scene.remove(V.group);
    V.group.traverse(o => o.geometry?.dispose());
  }
  const built = buildArea(area);
  V.group = built.group;
  V.scene.add(built.group);
  resize();
  frame(built.focus);
  const slabs = [...new Set(area.pieces.map(p => api.installed(p).slab).filter(Boolean))].sort();
  $d('.v3-note').innerHTML = built.missing.length
    ? `<b>Not placed yet:</b> ${built.missing.join(', ')}. Shown in plain gray.`
    : `Cut from slab${slabs.length > 1 ? 's' : ''} ${slabs.join(' + ')}`;
  render();
}

/** Point the camera (and the sun's shadow box) at the stone and cabinets, from front-left and a bit above. */
function frame(focus) {
  const c = focus.getCenter(new THREE.Vector3());
  const r = focus.getSize(new THREE.Vector3()).length() / 2;
  const cam = V.camera;
  const vfov = THREE.MathUtils.degToRad(cam.fov);
  const fit = Math.min(vfov, 2 * Math.atan(Math.tan(vfov / 2) * cam.aspect));
  const dist = (r / Math.sin(fit / 2)) * 0.95;
  cam.position.copy(c).addScaledVector(new THREE.Vector3(-0.42, 0.36, 1).normalize(), dist);
  cam.near = Math.max(0.5, dist / 60);
  cam.far = dist * 30;
  cam.updateProjectionMatrix();
  V.controls.target.copy(c);
  V.controls.minDistance = r * 0.25;
  V.controls.maxDistance = dist * 3;
  V.controls.update();

  V.sun.position.set(c.x - 140, c.y + 160, c.z + 110);
  V.sun.target.position.copy(c);
  const sc = V.sun.shadow.camera, R = r * 1.6 + 30;
  Object.assign(sc, { left: -R, right: R, top: R, bottom: -R, near: 1, far: 800 });
  sc.updateProjectionMatrix();
}

// ============================================================ materials
function makeMaterials(renderer) {
  const aniso = renderer.capabilities.getMaxAnisotropy();
  const stoneTex = new THREE.Texture(api.img);
  stoneTex.colorSpace = THREE.SRGBColorSpace;
  stoneTex.anisotropy = aniso;
  stoneTex.needsUpdate = true;

  const woodTex = new THREE.CanvasTexture(walnutCanvas());
  woodTex.colorSpace = THREE.SRGBColorSpace;
  woodTex.wrapS = woodTex.wrapT = THREE.RepeatWrapping;
  woodTex.anisotropy = aniso;

  return {
    stone: new THREE.MeshPhysicalMaterial({ map: stoneTex, roughness: 0.14, clearcoat: 0.3, clearcoatRoughness: 0.08 }),
    blank: new THREE.MeshStandardMaterial({ color: 0x9c978f, roughness: 0.6 }),
    walnut: new THREE.MeshStandardMaterial({ map: woodTex, roughness: 0.52 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x15120f, roughness: 0.9 }),
    wall: new THREE.MeshStandardMaterial({ color: 0xf2eee7, roughness: 0.95 }),
    floor: new THREE.MeshStandardMaterial({ color: 0xc7bfb1, roughness: 0.9 }),
    ceramic: new THREE.MeshPhysicalMaterial({ color: 0xf7f5f1, roughness: 0.12, clearcoat: 1, side: THREE.DoubleSide }),
    steelIn: new THREE.MeshStandardMaterial({ color: 0xd2d4d6, metalness: 1, roughness: 0.32, side: THREE.BackSide }),
    drain: new THREE.MeshStandardMaterial({ color: 0x9a9c9f, metalness: 1, roughness: 0.4 }),
  };
}

/** Seamlessly tiling walnut veneer, grain running left–right. Procedural, so there's no asset to license. */
function walnutCanvas() {
  const TW = 1024, TH = 512;
  const hash = (x, y) => {
    let n = Math.imul(x, 374761393) + Math.imul(y, 668265263) + 0x5bd1e995;
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  };
  const vnoise = (x, y, px, py) => {
    const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const x0 = ((xi % px) + px) % px, x1 = (x0 + 1) % px, y0 = ((yi % py) + py) % py, y1 = (y0 + 1) % py;
    const a = hash(x0, y0), b = hash(x1, y0), c = hash(x0, y1), d = hash(x1, y1);
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  };
  const fbm = (u, v, fx, fy, oct) => {
    let s = 0, amp = 0.5, norm = 0;
    for (let k = 0; k < oct; k++) { s += amp * vnoise(u * fx, v * fy, fx, fy); norm += amp; amp *= 0.5; fx *= 2; fy *= 2; }
    return s / norm;
  };
  const light = [124, 88, 63], mid = [68, 45, 32], tint = [58, 46, 41];
  const c = document.createElement('canvas');
  c.width = TW; c.height = TH;
  const ctx = c.getContext('2d');
  const im = ctx.createImageData(TW, TH), px = im.data;
  for (let j = 0; j < TH; j++) {
    const v = j / TH;
    for (let i = 0; i < TW; i++) {
      const u = i / TW;
      const warp = fbm(u, v, 2, 1, 3) - 0.5;                  // the grain drifts gently
      const fine = fbm(u, v, 6, 3, 2) - 0.5;
      const g = v * 40 + warp * 1.3 + fine * 0.5;               // integer line count, so it tiles
      const band = 0.5 + 0.5 * Math.sin(2 * Math.PI * g);
      const fade = fbm(u, v, 8, 4, 2);                          // grain lines come and go
      const line = band ** 10 * (0.3 + 0.7 * fade), soft = band ** 1.5;
      const streak = fbm(u, v, 1, 12, 4);                       // long light/dark streaks (sliced veneer)
      const n = vnoise(u * 90, v * 420, 90, 420);               // pores: short streaks along the grain
      const pore = Math.min(1, Math.max(0, (n - 0.8) / 0.18));
      const t = Math.min(1, Math.max(0, (streak - 0.5) * 1.35 + 0.5 + soft * 0.12));
      const shade = 1 - 0.24 * line - 0.16 * pore;
      const o = (j * TW + i) * 4;
      for (let k = 0; k < 3; k++) {
        const base = light[k] + (mid[k] - light[k]) * t;
        px[o + k] = (base * 0.85 + tint[k] * 0.15) * shade;
      }
      px[o + 3] = 255;
    }
  }
  ctx.putImageData(im, 0, 0);
  return c;
}

// ============================================================ geometry helpers
/** Matrix for plan-view shapes: local (x, y) → world (X = x, Z = y), extruded downward from `top`. */
const planM = top => new THREE.Matrix4().set(1, 0, 0, 0, 0, 0, -1, top, 0, 1, 0, 0, 0, 0, 0, 1);
/** Matrix for wall-mounted shapes: local (x, y-down) → world (X = x, Y = bottom + h − y), front face at Z = T. */
const wallM = (bottom, h) => new THREE.Matrix4().set(1, 0, 0, 0, 0, -1, 0, bottom + h, 0, 0, -1, T, 0, 0, 0, 1);

function holePath(c, grow = 0) {
  const p = new THREE.Path();
  if (c.shape === 'circle') p.absarc(c.cx, c.cy, c.r + grow, 0, Math.PI * 2, false);
  else {
    const x0 = c.x - grow, y0 = c.y - grow, x1 = c.x + c.w + grow, y1 = c.y + c.h + grow;
    p.moveTo(x0, y0); p.lineTo(x1, y0); p.lineTo(x1, y1); p.lineTo(x0, y1); p.lineTo(x0, y0);
  }
  return p;
}

/** Extrude an outline (with holes) by `depth`; uvAt(x, y, z) is evaluated in the shape's own coords. */
function plate(outline, holes, depth, uvAt, M) {
  const shape = new THREE.Shape(outline.map(([x, y]) => new THREE.Vector2(x, y)));
  shape.holes.push(...holes);
  const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 40 });
  if (uvAt) {
    const pos = geo.attributes.position, uv = geo.attributes.uv;
    for (let i = 0; i < pos.count; i++) uv.setXY(i, ...uvAt(pos.getX(i), pos.getY(i), pos.getZ(i)));
    uv.needsUpdate = true;
  }
  return geo.applyMatrix4(M);
}

function box(x0, x1, y0, y1, z0, z1) {
  return new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0).translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
}

/** Planar walnut UVs in world inches: grain runs along X on fronts and tops, along Z on the ends. */
function woodUV(geo, ox = 0, oy = 0) {
  const p = geo.attributes.position, n = geo.attributes.normal, uv = geo.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
    const X = p.getX(i), Y = p.getY(i), Z = p.getZ(i);
    const [u, v] = az >= ax && az >= ay ? [X, Y] : ax >= ay ? [Z, Y] : [X, Z];
    uv.setXY(i, (u + ox) / WOOD_U, (v + oy) / WOOD_V);
  }
  uv.needsUpdate = true;
  return geo;
}

function inside(x, y, poly) {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

// ============================================================ building an area
function buildArea(area) {
  const ins = { ...INSTALL, ...area.install };
  const cab = { ...INSTALL.cabinet, ...area.install?.cabinet };
  const group = new THREE.Group();
  const focus = new THREE.Box3();
  const missing = [];
  const add = (geo, mat, { inFocus = true, cast = true } = {}) => {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = cast; m.receiveShadow = true;
    group.add(m);
    if (inFocus) { geo.computeBoundingBox(); focus.union(geo.boundingBox); }
    return m;
  };

  const counter = area.pieces.find(p => p.kind === 'counter');
  const Hc = ins.counterHeight;
  let counterGeom = null, xMax = 0;

  for (const p of area.pieces) {
    const g = api.installed(p);
    if (!g.placed) missing.push(p.name);
    const mat = g.placed ? V.mats.stone : V.mats.blank;
    const uvAt = g.placed ? (x, y) => {
      const q = g.toSlab.transformPoint({ x, y });
      return [q.x / SLAB.width, 1 - q.y / SLAB.height];
    } : null;
    xMax = Math.max(xMax, p.w);

    if (p.kind === 'counter') {
      counterGeom = g;
      buildCounter(p, g, Hc, cab, mat, uvAt, add);
    } else {
      // backsplash on the counter, or a panel hung on the wall
      add(plate(g.poly, [], T, uvAt, wallM(counter ? Hc : ins.panelBottom, p.h)), mat);
    }
  }

  // walls behind the stone, following a stepped wall edge where there is one
  const edge = counterGeom?.edge ?? [[0, 0], [xMax, 0]];
  const poly = counterGeom?.poly ?? [[0, 0], [xMax, 0], [xMax, 1], [0, 1]];
  const segs = edge.slice(1).map((b, i) => [edge[i], b]);
  let prevN = null;
  segs.forEach(([a, b], i) => {
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L < EPS) return;
    const ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L;
    let nx = uy, ny = -ux;
    if (inside((a[0] + b[0]) / 2 + nx * 0.5, (a[1] + b[1]) / 2 + ny * 0.5, poly)) { nx = -nx; ny = -ny; }
    const e0 = i === 0 ? WALL_RUN : 0, e1 = i === segs.length - 1 ? WALL_RUN : 0;
    if (prevN) {   // fill the outside of the corner where two wall runs meet
      const [px, py] = prevN, q = [a[0] + (px + nx) * WALL_T, a[1] + (py + ny) * WALL_T];
      const x0 = Math.min(a[0], q[0]), x1 = Math.max(a[0], q[0]), y0 = Math.min(a[1], q[1]), y1 = Math.max(a[1], q[1]);
      add(plate([[x0, y0], [x1, y0], [x1, y1], [x0, y1]], [], ins.wallHeight, null, planM(ins.wallHeight)), V.mats.wall, { inFocus: false });
    }
    prevN = [nx, ny];
    const s0 = [a[0] - ux * e0, a[1] - uy * e0], s1 = [b[0] + ux * e1, b[1] + uy * e1];
    const outline = [s0, s1, [s1[0] + nx * WALL_T, s1[1] + ny * WALL_T], [s0[0] + nx * WALL_T, s0[1] + ny * WALL_T]];
    add(plate(outline, [], ins.wallHeight, null, planM(ins.wallHeight)), V.mats.wall, { inFocus: false });
  });

  return { group, focus, missing };
}

function buildCounter(p, g, Hc, cab, mat, uvAt, add) {
  const { mats } = V;
  add(plate(g.poly, g.cutouts.map(c => holePath(c)), T, uvAt, planM(Hc)), mat);

  // Mitered drops: a stone strip hanging from the edge, its face carrying the strip of slab that was
  // cut right against that edge, so the veins run over the corner. Where two drops meet they're mitered too.
  const sideOf = r => (r[0] < -EPS ? 'left' : r[0] >= p.w - EPS ? 'right' : 'front');
  const ds = g.drops.map(d => ({ ...d, side: sideOf(d.rect) }));
  const has = s => ds.some(d => d.side === s);
  for (const d of ds) {
    const [rx, ry, rw, rh] = d.rect;
    let outline, uvf;
    if (d.side === 'front') {
      const cl = has('left') && Math.abs(rx) < EPS ? T : 0;
      const cr = has('right') && Math.abs(rx + rw - p.w) < EPS ? T : 0;
      outline = [[rx, p.h + SEAM], [rx + rw, p.h + SEAM], [rx + rw - cr, p.h - T], [rx + cl, p.h - T]];
      uvf = (x, y, z) => uvAt(x, p.h + z + SEAM);
    } else {
      const cf = has('front') && Math.abs(ry + rh - p.h) < EPS ? T : 0;
      const [xo, xi] = d.side === 'left' ? [-SEAM, T] : [p.w + SEAM, p.w - T];
      outline = [[xo, ry], [xi, ry], [xi, ry + rh - cf], [xo, ry + rh]];
      uvf = d.side === 'left' ? (x, y, z) => uvAt(-(z + SEAM), y) : (x, y, z) => uvAt(p.w + z + SEAM, y);
    }
    add(plate(outline, [], d.d - SEAM, uvAt && uvf, planM(Hc - SEAM)), mat);
  }

  // Cabinets: walnut plywood boxes under the stone, back to the wall, a toe kick, and drawer banks on the front.
  const ov = cab.overhang, fT = cab.frontThickness, rv = cab.reveal, toe = cab.toeKick;
  const inL = ov + (has('left') ? T : 0), inR = ov + (has('right') ? T : 0), inF = ov + (has('front') ? T : 0);
  const top = Hc - T;
  for (const [x, y, w, h] of g.rects) {
    const x0 = Math.max(x, inL), x1 = Math.min(x + w, p.w - inR);
    const y1 = Math.min(y + h, p.h - inF);
    const atFront = y + h > p.h - EPS;
    const zc = atFront ? y1 - fT : y1;      // carcass face, behind the drawer fronts
    if (x1 - x0 < 1 || zc - y < 1) continue;

    // carcass, open where a sink drops in
    const sinks = g.cutouts.filter(c => {
      const [cx, cy] = c.shape === 'circle' ? [c.cx, c.cy] : [c.x + c.w / 2, c.y + c.h / 2];
      return cx > x0 && cx < x1 && cy > y && cy < zc;
    });
    const carcass = plate([[x0, y], [x1, y], [x1, zc], [x0, zc]], sinks.map(c => holePath(c, 0.3)), top - toe.h, null, planM(top));
    add(woodUV(carcass, 17, 9), mats.walnut);
    add(box(x0, x1, 0, toe.h, y, atFront ? y1 - toe.d : zc), mats.dark);

    if (atFront) {
      add(box(x0, x1, toe.h, top, zc, zc + 0.02), mats.dark, { cast: false });   // shadow line behind the reveals
      const cols = Math.max(1, Math.ceil((x1 - x0) / cab.maxDrawerWidth));
      const colW = (x1 - x0 - rv * (cols - 1)) / cols;
      const sum = cab.drawers.reduce((a, b) => a + b, 0);
      const avail = top - rv - toe.h - rv * (cab.drawers.length - 1);
      let yTop = top - rv;
      for (const r of cab.drawers) {
        const hh = (avail * r) / sum;
        for (let c = 0; c < cols; c++) {
          const cx0 = x0 + c * (colW + rv);
          add(woodUV(box(cx0, cx0 + colW, yTop - hh, yTop, y1 - fT, y1)), mats.walnut);   // shared UVs: grain-matched bank
        }
        yTop -= hh + rv;
      }
    }
  }

  // sinks under the cutouts
  for (const c of g.cutouts) {
    if (c.shape === 'circle') {
      const depth = 6;
      const bowl = new THREE.SphereGeometry(c.r + 0.02, 48, 16, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
      bowl.scale(1, depth / c.r, 1).translate(c.cx, top, c.cy);
      add(bowl, mats.ceramic, { inFocus: false, cast: false });
      add(new THREE.CircleGeometry(0.8, 24).rotateX(-Math.PI / 2).translate(c.cx, top - depth + 0.06, c.cy), mats.drain, { inFocus: false, cast: false });
    } else {
      const depth = 8;
      add(box(c.x, c.x + c.w, top - depth, top, c.y, c.y + c.h), mats.steelIn, { inFocus: false, cast: false });
      add(new THREE.CircleGeometry(1, 24).rotateX(-Math.PI / 2).translate(c.x + c.w / 2, top - depth + 0.03, c.y + c.h / 2), mats.drain, { inFocus: false, cast: false });
    }
  }
}

// ============================================================ export
async function saveImage() {
  await document.fonts.ready;
  const area = api.areas.find(a => a.id === V.areaId);
  const { name, who, when } = api.header();
  const r = V.renderer, w = V.stage.clientWidth, h = V.stage.clientHeight;
  const oldPR = r.getPixelRatio();
  r.setPixelRatio(Math.min(4, Math.max(1, 2400 / w)));
  r.setSize(w, h, false);
  render();
  const gl = r.domElement, GW = gl.width, GH = gl.height;
  const band = Math.round(Math.max(80, GW * 0.05));
  const c = document.createElement('canvas');
  c.width = GW; c.height = GH + band;
  const ctx = c.getContext('2d');
  ctx.drawImage(gl, 0, 0);
  r.setPixelRatio(oldPR);
  r.setSize(w, h, false);
  render();

  ctx.fillStyle = '#1b1a17'; ctx.fillRect(0, GH, GW, band);
  ctx.fillStyle = area.color; ctx.fillRect(0, GH, GW, Math.max(4, band * 0.06));
  const pad = band * 0.4;
  ctx.textBaseline = 'middle'; ctx.textAlign = 'left'; ctx.fillStyle = '#f6f3ec';
  ctx.font = `800 ${Math.round(band * 0.46)}px "Big Shoulders Display"`;
  const title = `${area.name.toUpperCase()} — AS INSTALLED`;
  ctx.fillText(title, pad, GH + band * 0.53);
  const tw = ctx.measureText(title).width;
  ctx.font = `400 ${Math.round(band * 0.21)}px "DM Mono"`; ctx.fillStyle = '#a9a397';
  const mx = pad * 2 + tw;
  ctx.fillText(`“${name}” by ${who} · ${when}`, mx, GH + band * 0.38);
  ctx.fillText(`${$d('.v3-note').textContent} · 3 cm stone on walnut plywood · Slab Happy`, mx, GH + band * 0.7);
  api.download(c, `slab-happy-${api.slug(name)}-${area.id}-3d-${api.stamp()}.jpg`);
}
