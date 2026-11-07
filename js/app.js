import { SLAB, AREAS } from './data.js';

// ============================================================ constants
const APP_ID = 'slab-happy';
const STORAGE_KEY = 'slab-happy:layout:v1';
const AUTHOR_KEY = 'slab-happy:author';
const PREFS_KEY = 'slab-happy:prefs';
const W = SLAB.width, H = SLAB.height;
const SLABS = Array.from({ length: SLAB.count }, (_, i) => i + 1); // 1-based
const RULER = 28;
const INK = '#1b1a17', PAPER = '#f6f3ec', ACCENT = '#ff5a1f', DANGER = '#ff2d3d';
const EPS = 1e-6;

const PIECES = [];
const PIECE = {};
for (const area of AREAS) {
  for (const p of area.pieces) {
    p.area = area;
    p.rects ??= [[0, 0, p.w, p.h]];
    p.poly ??= [[0, 0], [p.w, 0], [p.w, p.h], [0, p.h]];
    p.cutouts ??= [];
    p.edgeLabel = p.kind === 'counter' ? 'WALL' : 'TOP';
    PIECES.push(p);
    PIECE[p.id] = p;
  }
}

// ============================================================ state
const state = { author: '', notes: '', settings: { gap: 0.5, margin: 0.5 }, placements: {} };
const prefs = { dim: true };
let selected = null;
let hoverId = null;
let ghost = null;       // {slab, id, x, y, rot} while dragging from the cut list
let listDragId = null;
let issues = [];
let flagged = new Set();
const undoStack = [];
const redoStack = [];

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode etc. */ } },
};

function layoutData() {
  return { notes: state.notes, settings: { ...state.settings }, placements: structuredClone(state.placements) };
}
function snapshot() { return JSON.stringify(layoutData()); }
function restore(s) {
  const o = JSON.parse(s);
  state.notes = o.notes; state.settings = o.settings; state.placements = o.placements;
}
function pushUndo(snap = snapshot()) {
  undoStack.push(snap);
  if (undoStack.length > 200) undoStack.shift();
  redoStack.length = 0;
}
function mutate(fn) { pushUndo(); fn(); afterChange(); }
function undo() { if (!undoStack.length) return; redoStack.push(snapshot()); restore(undoStack.pop()); afterChange(); }
function redo() { if (!redoStack.length) return; undoStack.push(snapshot()); restore(redoStack.pop()); afterChange(); }

function save() {
  store.set(STORAGE_KEY, snapshot());
  store.set(PREFS_KEY, JSON.stringify(prefs));
}

function afterChange() {
  if (selected && !PIECE[selected]) selected = null;
  computeIssues();
  save();
  updateUI();
  requestRender();
}

// ============================================================ inches
const FRAC = ['', '⅛', '¼', '⅜', '½', '⅝', '¾', '⅞'];
function fmtN(v) {
  const neg = v < -EPS; const e = Math.round(Math.abs(v) * 8);
  const whole = Math.floor(e / 8), f = e % 8;
  return (neg ? '−' : '') + ((whole || !f) ? String(whole) : '') + FRAC[f];
}
const fmt = v => fmtN(v) + '″';
function parseIn(str) {
  let s = String(str).trim().replace(/[″"]/g, '').replace(/−/g, '-');
  FRAC.forEach((ch, k) => { if (ch) s = s.split(ch).join(` ${k}/8`); });
  s = s.trim();
  let neg = false;
  if (s.startsWith('-')) { neg = true; s = s.slice(1).trim(); }
  const parts = s.split(/[\s-]+/).filter(Boolean);
  if (!parts.length) return NaN;
  let v = 0;
  for (const part of parts) {
    if (part.includes('/')) {
      const [a, b] = part.split('/').map(Number);
      if (!b || isNaN(a)) return NaN;
      v += a / b;
    } else {
      const n = Number(part);
      if (isNaN(n)) return NaN;
      v += n;
    }
  }
  return neg ? -v : v;
}
const q8 = v => Math.round(v * 8) / 8;
const round6 = v => Math.round(v * 1e6) / 1e6;

// ============================================================ geometry
function bboxSize(p, rot) { return rot % 180 === 0 ? [p.w, p.h] : [p.h, p.w]; }

/** Matrix mapping piece-local inches → slab inches. */
function localToSlab(p, pl) {
  const [tx, ty] = { 0: [0, 0], 90: [p.h, 0], 180: [p.w, p.h], 270: [0, p.w] }[pl.rot];
  return new DOMMatrix().translate(pl.x + tx, pl.y + ty).rotate(pl.rot);
}

function slabRects(p, pl) {
  const m = localToSlab(p, pl);
  return p.rects.map(([x, y, w, h]) => {
    const a = m.transformPoint({ x, y }), b = m.transformPoint({ x: x + w, y: y + h });
    return { x: round6(Math.min(a.x, b.x)), y: round6(Math.min(a.y, b.y)), w: round6(Math.abs(b.x - a.x)), h: round6(Math.abs(b.y - a.y)) };
  });
}

function bbox(p, pl) {
  const [w, h] = bboxSize(p, pl.rot);
  return { x: pl.x, y: pl.y, w, h };
}

function rectsConflict(a, b, gap) {
  return a.x < b.x + b.w + gap - EPS && b.x < a.x + a.w + gap - EPS &&
         a.y < b.y + b.h + gap - EPS && b.y < a.y + a.h + gap - EPS;
}

function placedOn(slab) {
  return Object.entries(state.placements).filter(([id, pl]) => pl.slab === slab && PIECE[id]);
}

function piecesConflict(idA, plA, idB, plB, gap) {
  const ra = slabRects(PIECE[idA], plA), rb = slabRects(PIECE[idB], plB);
  return ra.some(a => rb.some(b => rectsConflict(a, b, gap)));
}

function outOfBounds(id, pl, margin) {
  return slabRects(PIECE[id], pl).some(r =>
    r.x < margin - EPS || r.y < margin - EPS || r.x + r.w > W - margin + EPS || r.y + r.h > H - margin + EPS);
}

function computeIssues() {
  issues = []; flagged = new Set();
  const { gap, margin } = state.settings;
  for (const slab of SLABS) {
    const here = placedOn(slab);
    for (const [id, pl] of here) {
      if (outOfBounds(id, pl, 0)) {
        issues.push({ ids: [id], text: `${PIECE[id].name} runs off the edge of Slab ${slab}` });
        flagged.add(id);
      } else if (outOfBounds(id, pl, margin)) {
        issues.push({ ids: [id], text: `${PIECE[id].name} is within ${fmt(margin)} of the edge of Slab ${slab}` });
        flagged.add(id);
      }
    }
    for (let i = 0; i < here.length; i++) {
      for (let j = i + 1; j < here.length; j++) {
        const [a, pa] = here[i], [b, pb] = here[j];
        if (piecesConflict(a, pa, b, pb, 0)) {
          issues.push({ ids: [a, b], text: `${PIECE[a].name} overlaps ${PIECE[b].name} on Slab ${slab}` });
        } else if (piecesConflict(a, pa, b, pb, gap)) {
          issues.push({ ids: [a, b], text: `${PIECE[a].name} and ${PIECE[b].name} are closer than ${fmt(gap)} on Slab ${slab}` });
        } else continue;
        flagged.add(a); flagged.add(b);
      }
    }
  }
}

function snapPosition(id, slab, x, y, rot, noSnap, scale) {
  const p = PIECE[id];
  const [bw, bh] = bboxSize(p, rot);
  if (noSnap) return [q8(x), q8(y)];
  const { gap, margin } = state.settings;
  const th = 9 / scale;
  const xs = [0, margin, W - margin - bw, W - bw];
  const ys = [0, margin, H - margin - bh, H - bh];
  for (const [oid, opl] of placedOn(slab)) {
    if (oid === id) continue;
    for (const r of slabRects(PIECE[oid], opl)) {
      xs.push(r.x + r.w + gap, r.x - gap - bw, r.x, r.x + r.w - bw);
      ys.push(r.y + r.h + gap, r.y - gap - bh, r.y, r.y + r.h - bh);
    }
  }
  const best = (v, cands) => {
    let b = null, bd = th;
    for (const c of cands) { const d = Math.abs(c - v); if (d < bd) { bd = d; b = c; } }
    return b ?? q8(v);
  };
  return [round6(best(x, xs)), round6(best(y, ys))];
}

/** Find the first conflict-free spot (bottom-left style packing). */
function findSpot(id, slabs = SLABS, rots = null) {
  const p = PIECE[id];
  const { gap, margin } = state.settings;
  const cur = state.placements[id];
  rots ??= [...new Set([cur?.rot ?? 0, ((cur?.rot ?? 0) + 90) % 360])];
  for (const slab of slabs) {
    const others = placedOn(slab).filter(([oid]) => oid !== id);
    const otherRects = others.flatMap(([oid, opl]) => slabRects(PIECE[oid], opl));
    const xs = [...new Set([margin, ...otherRects.map(r => r.x + r.w + gap)])].sort((a, b) => a - b);
    const ys = [...new Set([margin, ...otherRects.map(r => r.y + r.h + gap)])].sort((a, b) => a - b);
    for (const rot of rots) {
      const [bw, bh] = bboxSize(p, rot);
      for (const y of ys) {
        if (y + bh > H - margin + EPS) continue;
        for (const x of xs) {
          if (x + bw > W - margin + EPS) continue;
          const pl = { slab, x: round6(x), y: round6(y), rot };
          const rs = slabRects(p, pl);
          if (!rs.some(a => otherRects.some(b => rectsConflict(a, b, gap)))) return pl;
        }
      }
    }
  }
  return null;
}

function autoPlace(id, slabs) {
  const spot = findSpot(id, slabs);
  if (!spot) { toast(`No free spot for ${PIECE[id].name}${slabs?.length === 1 ? ` on Slab ${slabs[0]}` : ''}.`); return false; }
  mutate(() => { state.placements[id] = spot; });
  select(id);
  return true;
}

function rotateSelected(dir) {
  const pl = state.placements[selected];
  if (!pl) return;
  mutate(() => {
    const p = PIECE[selected];
    const [bw, bh] = bboxSize(p, pl.rot);
    const cx = pl.x + bw / 2, cy = pl.y + bh / 2;
    pl.rot = (pl.rot + dir + 360) % 360;
    const [nw, nh] = bboxSize(p, pl.rot);
    pl.x = q8(cx - nw / 2); pl.y = q8(cy - nh / 2);
  });
}

function nudgeSelected(dx, dy) {
  const pl = state.placements[selected];
  if (!pl) return;
  mutate(() => { pl.x = round6(pl.x + dx); pl.y = round6(pl.y + dy); });
}

function unplace(id) {
  if (!state.placements[id]) return;
  mutate(() => { delete state.placements[id]; });
}

function select(id) {
  selected = id;
  updateUI();
  requestRender();
}

// ============================================================ drawing helpers
let img;
let scaledSlab = null;
function getScaledSlab(pxW) {
  pxW = Math.max(1, Math.round(pxW));
  if (scaledSlab?.width === pxW) return scaledSlab;
  const c = document.createElement('canvas');
  c.width = pxW; c.height = Math.round(pxW * H / W);
  const x = c.getContext('2d');
  x.imageSmoothingQuality = 'high';
  x.drawImage(img, 0, 0, c.width, c.height);
  return (scaledSlab = c);
}

let hatch = null;
function hatchPattern(ctx) {
  if (!hatch) {
    const c = document.createElement('canvas'); c.width = c.height = 10;
    const x = c.getContext('2d');
    x.fillStyle = '#efeae0'; x.fillRect(0, 0, 10, 10);
    x.strokeStyle = '#d6cfc1'; x.lineWidth = 1.5;
    x.beginPath(); x.moveTo(-2, 12); x.lineTo(12, -2); x.stroke();
    hatch = c;
  }
  return ctx.createPattern(hatch, 'repeat');
}

function pathPoly(ctx, pts) {
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
}

function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
}

function labelFont(s) { return Math.max(10, Math.min(24, s * 1.5)); }

function drawPill(ctx, cx, cy, lines, bg, fg, fs) {
  const fonts = lines.map((_, i) => i === 0 ? `600 ${fs}px "Familjen Grotesk"` : `400 ${fs * 0.85}px "DM Mono"`);
  const lh = lines.map((_, i) => (i === 0 ? fs : fs * 0.85) * 1.25);
  let w = 0;
  lines.forEach((t, i) => { ctx.font = fonts[i]; w = Math.max(w, ctx.measureText(t).width); });
  const pad = fs * 0.5, h = lh.reduce((a, b) => a + b, 0) + pad;
  const x = cx - w / 2 - pad, y = cy - h / 2;
  ctx.fillStyle = 'rgba(0,0,0,.35)';
  ctx.fillRect(x + 2, y + 2, w + pad * 2, h);
  ctx.fillStyle = bg;
  ctx.fillRect(x, y, w + pad * 2, h);
  ctx.fillStyle = fg;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  let ty = y + pad / 2;
  lines.forEach((t, i) => { ctx.font = fonts[i]; ctx.fillText(t, cx, ty + lh[i] / 2); ty += lh[i]; });
}

function drawRulers(ctx, s) {
  ctx.save();
  ctx.strokeStyle = INK; ctx.fillStyle = '#4a463f'; ctx.lineWidth = 1;
  const fs = Math.max(9, Math.min(16, s * 1.1));
  ctx.font = `400 ${fs}px "DM Mono"`;
  const step = s < 3.5 ? 6 : 1;
  ctx.beginPath();
  for (let i = 0; i <= W; i += step) {
    const len = i % 12 === 0 ? RULER * 0.36 : i % 6 === 0 ? RULER * 0.22 : RULER * 0.1;
    const x = Math.round(i * s) + 0.5;
    ctx.moveTo(x, -len); ctx.lineTo(x, 0);
  }
  for (let i = 0; i <= H; i += step) {
    const len = i % 12 === 0 ? RULER * 0.36 : i % 6 === 0 ? RULER * 0.22 : RULER * 0.1;
    const y = Math.round(i * s) + 0.5;
    ctx.moveTo(-len, y); ctx.lineTo(0, y);
  }
  ctx.stroke();
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  for (let i = 0; i <= W; i += 12) if (W - i > 5) ctx.fillText(i, i * s, -RULER * 0.48);
  ctx.fillText(W + '″', W * s - fs, -RULER * 0.48);
  ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  for (let i = 12; i <= H; i += 12) if (H - i > 4) ctx.fillText(i, -RULER * 0.42, i * s);
  ctx.fillText(H, -RULER * 0.42, H * s - fs * 0.4);
  ctx.restore();
}

function drawDim(ctx, x1, y1, x2, y2, text, fs) {
  const len = Math.hypot(x2 - x1, y2 - y1);
  if (len < 4) return;
  ctx.save();
  ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.55)';
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  ctx.lineWidth = 1; ctx.strokeStyle = '#fff'; ctx.setLineDash([4, 3]);
  ctx.stroke(); ctx.setLineDash([]);
  // end ticks
  const nx = (y2 - y1) / len * 5, ny = -(x2 - x1) / len * 5;
  ctx.beginPath();
  ctx.moveTo(x1 - nx, y1 - ny); ctx.lineTo(x1 + nx, y1 + ny);
  ctx.moveTo(x2 - nx, y2 - ny); ctx.lineTo(x2 + nx, y2 + ny);
  ctx.stroke();
  if (len > fs * 2) {
    ctx.font = `500 ${fs}px "DM Mono"`;
    const tw = ctx.measureText(text).width + 8;
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
    ctx.fillStyle = INK; ctx.fillRect(mx - tw / 2, my - fs * 0.7, tw, fs * 1.4);
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, mx, my + 0.5);
  }
  ctx.restore();
}

function drawPiece(ctx, p, pl, s, f) {
  const m = localToSlab(p, pl);
  const T = (x, y) => { const q = m.transformPoint({ x, y }); return [q.x * s, q.y * s]; };
  const poly = p.poly.map(([x, y]) => T(x, y));
  const color = f.flagged ? DANGER : p.area.color;
  const k = Math.max(1, s / 9); // thicker lines on high-res exports
  ctx.save();

  if (f.ghost) {
    ctx.beginPath(); pathPoly(ctx, poly);
    ctx.fillStyle = hexA(p.area.color, 0.25); ctx.fill();
    ctx.setLineDash([6, 4]); ctx.lineWidth = 2; ctx.strokeStyle = p.area.color; ctx.stroke();
    ctx.restore();
    return;
  }

  if (f.selected || f.hover) {
    ctx.beginPath(); pathPoly(ctx, poly);
    ctx.fillStyle = hexA(p.area.color, f.selected ? 0.13 : 0.07); ctx.fill();
  }

  // cutouts (sinks)
  for (const c of p.cutouts) {
    ctx.beginPath();
    if (c.shape === 'circle') {
      const [cx, cy] = T(c.cx, c.cy);
      ctx.arc(cx, cy, c.r * s, 0, Math.PI * 2);
    } else {
      const a = T(c.x, c.y), b = T(c.x + c.w, c.y + c.h);
      ctx.rect(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]));
    }
    ctx.fillStyle = 'rgba(14,13,12,.62)'; ctx.fill();
    ctx.setLineDash([4, 3]); ctx.lineWidth = 1.25; ctx.strokeStyle = color; ctx.stroke(); ctx.setLineDash([]);
  }

  // outline: dark halo, then crayon color
  ctx.beginPath(); pathPoly(ctx, poly);
  ctx.lineJoin = 'miter';
  ctx.strokeStyle = 'rgba(10,9,8,.7)'; ctx.lineWidth = (f.selected ? 5.5 : 4) * k; ctx.stroke();
  ctx.strokeStyle = color; ctx.lineWidth = (f.selected ? 2.75 : 1.75) * k;
  if (f.flagged) ctx.setLineDash([7 * k, 4 * k]);
  ctx.stroke(); ctx.setLineDash([]);

  // reference edge (wall / top) — a band just inside local y = 0
  const band = Math.max(3, Math.min(8, s * 0.45));
  const inset = band / 2 / s;
  const a = T(0, inset), b = T(p.w, inset);
  ctx.beginPath(); ctx.moveTo(...a); ctx.lineTo(...b);
  ctx.lineCap = 'butt'; ctx.strokeStyle = color; ctx.lineWidth = band; ctx.stroke();
  const efs = Math.max(8, Math.min(18, s * 0.95));
  let ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
  if (ang > Math.PI / 2 + 0.01 || ang < -Math.PI / 2 - 0.01) ang += Math.PI;
  const [tx, ty] = T(p.w / 2, (band + efs * 0.9) / s);
  ctx.save();
  ctx.translate(tx, ty); ctx.rotate(ang);
  ctx.font = `500 ${efs}px "DM Mono"`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.strokeText(p.edgeLabel, 0, 0);
  ctx.fillStyle = color; ctx.fillText(p.edgeLabel, 0, 0);
  ctx.restore();

  // label near the center of the main rectangle, dodging sink cutouts
  const [lux, luy] = labelSpot(p);
  const [lx, ly] = T(lux, luy);
  const lines = [(f.flagged ? '⚠ ' : '') + p.name, `${fmtN(p.w)} × ${fmtN(p.h)}`];
  if (f.coords) lines.push(`@ ${fmt(pl.x)}, ${fmt(pl.y)}${pl.rot ? ` · ${pl.rot}°` : ''}`);
  drawPill(ctx, lx, ly, lines, p.area.color, INK, labelFont(s));
  ctx.restore();
}

function labelSpot(p) {
  const [rx, ry, rw, rh] = p.rects[0];
  const cy = ry + rh / 2;
  const inCut = x => p.cutouts.some(c => c.shape === 'circle'
    ? Math.abs(x - c.cx) < c.r + 4 && Math.abs(cy - c.cy) < c.r + 2
    : x > c.x - 4 && x < c.x + c.w + 4 && cy > c.y - 2 && cy < c.y + c.h + 2);
  for (const f of [0.5, 0.25, 0.75, 0.18, 0.82]) if (!inCut(rx + rw * f)) return [rx + rw * f, cy];
  return [rx + rw / 2, cy];
}

/** Draw one slab with its pieces. Origin (ox, oy) is the slab's top-left corner. */
function drawSlab(ctx, slab, o) {
  const s = o.scale;
  const SW = W * s, SH = H * s;
  ctx.save();
  ctx.translate(o.ox, o.oy);
  if (o.rulers) drawRulers(ctx, s);
  ctx.drawImage(o.src, 0, 0, SW, SH);

  const here = placedOn(slab);
  if (o.dim && here.length) {
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, SW, SH); ctx.clip();
    ctx.beginPath();
    ctx.moveTo(0, 0); ctx.lineTo(0, SH); ctx.lineTo(SW, SH); ctx.lineTo(SW, 0); ctx.closePath(); // CCW
    for (const [id, pl] of here) {
      const p = PIECE[id], m = localToSlab(p, pl);
      pathPoly(ctx, p.poly.map(([x, y]) => { const q = m.transformPoint({ x, y }); return [q.x * s, q.y * s]; })); // CW → hole
    }
    ctx.fillStyle = 'rgba(16,15,13,.5)';
    ctx.fill('nonzero');
    ctx.restore();
  }

  // edge-margin guide
  const mg = state.settings.margin;
  if (mg > 0) {
    ctx.save();
    ctx.setLineDash([3, 5]); ctx.strokeStyle = 'rgba(255,255,255,.4)'; ctx.lineWidth = 1;
    ctx.strokeRect(mg * s, mg * s, (W - 2 * mg) * s, (H - 2 * mg) * s);
    ctx.restore();
  }
  ctx.strokeStyle = INK; ctx.lineWidth = 1.5; ctx.strokeRect(0, 0, SW, SH);

  const order = here.slice().sort(([a], [b]) => (a === o.selectedId) - (b === o.selectedId));
  for (const [id, pl] of order) {
    drawPiece(ctx, PIECE[id], pl, s, {
      selected: id === o.selectedId, hover: id === o.hoverId, flagged: flagged.has(id), coords: o.coords,
    });
  }
  if (o.ghost && o.ghost.slab === slab) drawPiece(ctx, PIECE[o.ghost.id], o.ghost, s, { ghost: true });

  const spl = o.selectedId && state.placements[o.selectedId];
  if (o.offsets && spl && spl.slab === slab) {
    const bb = bbox(PIECE[o.selectedId], spl);
    const fs = Math.max(10, Math.min(16, s * 1.2));
    const cy = (bb.y + bb.h / 2) * s, cx = (bb.x + bb.w / 2) * s;
    drawDim(ctx, 0, cy, bb.x * s, cy, fmt(bb.x), fs);
    drawDim(ctx, (bb.x + bb.w) * s, cy, SW, cy, fmt(W - bb.x - bb.w), fs);
    drawDim(ctx, cx, 0, cx, bb.y * s, fmt(bb.y), fs);
    drawDim(ctx, cx, (bb.y + bb.h) * s, cx, SH, fmt(H - bb.y - bb.h), fs);
  }
  ctx.restore();
}

/** Stack an area's pieces as installed: backsplash/panels above the counter. */
function areaStack(area) {
  const order = [...area.pieces].sort((a, b) => (a.kind === 'counter') - (b.kind === 'counter'));
  let y = 0, w = 0;
  const items = order.map(p => { const it = { p, x: 0, y }; y += p.h; w = Math.max(w, p.w); return it; });
  return { items, w, h: y };
}

function drawArea(ctx, area, x0, y0, s, o = {}) {
  const st = areaStack(area);
  const base = ctx.getTransform();
  const boxes = [];
  for (const it of st.items) {
    const p = it.p, px = x0 + it.x * s, py = y0 + it.y * s;
    const pl = state.placements[p.id];
    const poly = p.poly.map(([x, y]) => [px + x * s, py + y * s]);
    boxes.push({ id: p.id, x: px, y: py, w: p.w * s, h: p.h * s });

    ctx.save();
    ctx.beginPath(); pathPoly(ctx, poly);
    if (pl) {
      ctx.clip();
      const inv = localToSlab(p, pl).inverse();
      ctx.setTransform(base.multiply(new DOMMatrix().translate(px, py).scale(s).multiply(inv)));
      ctx.drawImage(img, 0, 0, W, H);
      ctx.setTransform(base);
    } else {
      ctx.fillStyle = hatchPattern(ctx); ctx.fill();
    }
    ctx.restore();

    for (const c of p.cutouts) {
      ctx.beginPath();
      if (c.shape === 'circle') ctx.arc(px + c.cx * s, py + c.cy * s, c.r * s, 0, Math.PI * 2);
      else ctx.rect(px + c.x * s, py + c.y * s, c.w * s, c.h * s);
      ctx.fillStyle = '#2a2724'; ctx.fill();
      ctx.lineWidth = 1; ctx.strokeStyle = '#6f6a61'; ctx.stroke();
    }

    // reference edge band
    ctx.fillStyle = p.area.color;
    ctx.fillRect(px, py, p.w * s, Math.max(2, s * 0.35));

    ctx.beginPath(); pathPoly(ctx, poly);
    ctx.lineWidth = 1.25; ctx.strokeStyle = INK;
    if (!pl) ctx.setLineDash([5, 4]);
    ctx.stroke(); ctx.setLineDash([]);
    if (o.selectedId === p.id) {
      ctx.lineWidth = 3; ctx.strokeStyle = ACCENT; ctx.stroke();
    }

    const fs = o.fs ?? 11;
    const [lux, luy] = labelSpot(p);
    const cx = px + lux * s, cy = py + luy * s;
    if (!pl) {
      ctx.font = `500 ${fs}px "DM Mono"`; ctx.fillStyle = '#857f74';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(`${p.kind === 'splash' ? 'backsplash' : p.kind} · not placed`, cx, cy);
    } else if (o.tags) {
      const t = `S${pl.slab}${pl.rot ? ` · ${pl.rot}°` : ''}${flagged.has(p.id) ? ' · ⚠' : ''}`;
      ctx.font = `500 ${fs}px "DM Mono"`;
      const tw = ctx.measureText(t).width + fs;
      ctx.fillStyle = flagged.has(p.id) ? DANGER : INK;
      const tx = px + p.w * s - tw - 4, ty = py + p.h * s - fs * 1.6 - 4;
      ctx.fillRect(tx, ty, tw, fs * 1.6);
      ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(t, tx + tw / 2, ty + fs * 0.8 + 0.5);
    }
  }
  return { ...st, boxes };
}

// ============================================================ slab views
let DPR = Math.min(window.devicePixelRatio || 1, 2);
const views = [];

class SlabView {
  constructor(slab) {
    this.slab = slab;
    const card = document.createElement('article');
    card.className = 'slab-card';
    card.innerHTML = `
      <div class="slab-head">
        <div class="tb"><span class="tb-label">Sheet</span><span class="slab-title">Slab ${slab} <small>/ ${SLAB.count}</small></span></div>
        <div class="tb"><span class="tb-label">Pieces</span><span class="tb-value" data-k="pieces">0</span></div>
        <div class="tb"><span class="tb-label">Used</span><span class="tb-value" data-k="used">0%</span><div class="util-bar"><i></i></div></div>
        <div class="tb grow"></div>
        <button data-export="${slab}" title="Download this slab as a JPEG">⤓ JPEG</button>
      </div>
      <div class="canvas-wrap"><canvas></canvas></div>`;
    this.card = card;
    this.wrap = card.querySelector('.canvas-wrap');
    this.canvas = card.querySelector('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.bind();
  }

  layout() {
    const w = this.wrap.clientWidth;
    if (!w) return;
    this.cssW = w;
    this.scale = (w - RULER - 4) / W;
    this.cssH = Math.ceil(RULER + H * this.scale + 4);
    this.canvas.style.height = this.cssH + 'px';
    this.canvas.width = Math.round(w * DPR);
    this.canvas.height = Math.round(this.cssH * DPR);
  }

  draw() {
    if (!this.scale) return;
    const ctx = this.ctx;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.clearRect(0, 0, this.cssW, this.cssH);
    drawSlab(ctx, this.slab, {
      scale: this.scale, ox: RULER, oy: RULER, src: getScaledSlab(W * this.scale * DPR),
      rulers: true, dim: prefs.dim, selectedId: selected, hoverId, ghost, offsets: true,
    });
  }

  toSlab(clientX, clientY) {
    const r = this.canvas.getBoundingClientRect();
    return { x: (clientX - r.left - RULER) / this.scale, y: (clientY - r.top - RULER) / this.scale };
  }

  contains(clientX, clientY) {
    const r = this.canvas.getBoundingClientRect();
    return clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom;
  }

  hitTest(pt) {
    const here = placedOn(this.slab).sort(([a], [b]) => (b === selected) - (a === selected));
    for (const [id, pl] of here) {
      if (slabRects(PIECE[id], pl).some(r => pt.x >= r.x && pt.x <= r.x + r.w && pt.y >= r.y && pt.y <= r.y + r.h)) return id;
    }
    return null;
  }

  bind() {
    const c = this.canvas;
    let drag = null;

    c.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      const pt = this.toSlab(e.clientX, e.clientY);
      const id = this.hitTest(pt);
      select(id);
      if (!id) return;
      const pl = state.placements[id];
      drag = { id, dx: pt.x - pl.x, dy: pt.y - pl.y, before: snapshot(), moved: false, sx: e.clientX, sy: e.clientY };
      c.setPointerCapture(e.pointerId);
      c.style.cursor = 'grabbing';
      e.preventDefault();
    });

    c.addEventListener('pointermove', e => {
      if (!drag) {
        const id = this.hitTest(this.toSlab(e.clientX, e.clientY));
        if (id !== hoverId) { hoverId = id; requestRender(); }
        c.style.cursor = id ? 'grab' : 'default';
        return;
      }
      if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 3) return;
      drag.moved = true;
      const pl = state.placements[drag.id];
      const view = views.find(v => v.contains(e.clientX, e.clientY)) || views[pl.slab - 1];
      const pt = view.toSlab(e.clientX, e.clientY);
      const [x, y] = snapPosition(drag.id, view.slab, pt.x - drag.dx, pt.y - drag.dy, pl.rot, e.altKey, view.scale);
      pl.slab = view.slab; pl.x = x; pl.y = y;
      computeIssues();
      requestRender();
      updateInspectorLive();
      document.getElementById('cutlist').classList.toggle('drop-out', overCutlist(e));
    });

    const end = e => {
      if (!drag) return;
      const d = drag; drag = null;
      c.style.cursor = 'grab';
      document.getElementById('cutlist').classList.remove('drop-out');
      if (!d.moved) return;
      if (e.type === 'pointerup' && overCutlist(e)) {
        pushUndo(d.before);
        delete state.placements[d.id];
        afterChange();
        toast(`${PIECE[d.id].name} returned to the cut list.`);
        return;
      }
      pushUndo(d.before);
      afterChange();
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    c.addEventListener('pointerleave', () => { if (!drag && hoverId) { hoverId = null; requestRender(); } });
    c.addEventListener('dblclick', e => {
      const id = this.hitTest(this.toSlab(e.clientX, e.clientY));
      if (id) { select(id); rotateSelected(90); }
    });

    // drop from the cut list (HTML5 drag & drop)
    c.addEventListener('dragover', e => {
      if (!listDragId) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const p = PIECE[listDragId];
      const rot = state.placements[listDragId]?.rot ?? 0;
      const [bw, bh] = bboxSize(p, rot);
      const pt = this.toSlab(e.clientX, e.clientY);
      const [x, y] = snapPosition(listDragId, this.slab, pt.x - bw / 2, pt.y - bh / 2, rot, e.altKey, this.scale);
      ghost = { slab: this.slab, id: listDragId, x, y, rot };
      this.wrap.classList.add('drop-hot');
      requestRender();
    });
    c.addEventListener('dragleave', () => { this.wrap.classList.remove('drop-hot'); ghost = null; requestRender(); });
    c.addEventListener('drop', e => {
      e.preventDefault();
      this.wrap.classList.remove('drop-hot');
      if (!ghost) return;
      const g = ghost; ghost = null;
      mutate(() => { state.placements[g.id] = { slab: g.slab, x: g.x, y: g.y, rot: g.rot }; });
      select(g.id);
    });
  }
}

function overCutlist(e) {
  const r = document.querySelector('.rail-left .panel').getBoundingClientRect();
  return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
}

// ============================================================ previews
const previewEls = {};
function buildPreviews() {
  const root = document.getElementById('previews');
  root.innerHTML = '';
  for (const area of AREAS) {
    const el = document.createElement('div');
    el.className = 'preview';
    el.innerHTML = `<div class="preview-head"><span class="swatch" style="background:${area.color};height:14px"></span><b>${area.name}</b><span class="tags"></span></div><canvas></canvas>`;
    const canvas = el.querySelector('canvas');
    const pv = { area, el, canvas, ctx: canvas.getContext('2d'), boxes: [] };
    canvas.addEventListener('click', e => {
      const r = canvas.getBoundingClientRect();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      const hit = pv.boxes.find(b => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h);
      const id = hit?.id ?? area.pieces[0].id;
      select(id);
      const pl = state.placements[id];
      if (pl) views[pl.slab - 1].card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
    previewEls[area.id] = pv;
    root.appendChild(el);
  }
}

function layoutPreviews() {
  for (const pv of Object.values(previewEls)) {
    const st = areaStack(pv.area);
    const avail = pv.el.clientWidth || 280;
    const s = Math.min(avail / st.w, 230 / st.h, 5);
    pv.s = s;
    pv.cssW = Math.ceil(st.w * s) + 2; pv.cssH = Math.ceil(st.h * s) + 2;
    pv.canvas.style.width = pv.cssW + 'px'; pv.canvas.style.height = pv.cssH + 'px';
    pv.canvas.width = Math.round(pv.cssW * DPR); pv.canvas.height = Math.round(pv.cssH * DPR);
  }
}

function drawPreviews() {
  for (const pv of Object.values(previewEls)) {
    if (!pv.s) continue;
    const ctx = pv.ctx;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.clearRect(0, 0, pv.cssW, pv.cssH);
    const r = drawArea(ctx, pv.area, 1, 1, pv.s, { selectedId: selected, tags: true, fs: 10 });
    pv.boxes = r.boxes;
  }
}

// ============================================================ render loop
let renderQueued = false;
function requestRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    views.forEach(v => v.draw());
    drawPreviews();
  });
}

function relayout() {
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  views.forEach(v => v.layout());
  layoutPreviews();
  requestRender();
}

// ============================================================ DOM UI
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function updateUI() {
  renderCutlist();
  renderIssues();
  renderInspector();
  renderSlabStats();
  renderPreviewTags();
  $('undo').disabled = !undoStack.length;
  $('redo').disabled = !redoStack.length;
  const notes = $('notes');
  if (document.activeElement !== notes) notes.value = state.notes;
  for (const k of ['gap', 'margin']) {
    const el = $('set-' + k);
    if (document.activeElement !== el) el.value = fmt(state.settings[k]);
  }
  $('set-dim').checked = prefs.dim;
}

function renderCutlist() {
  const root = $('cutlist');
  const placed = PIECES.filter(p => state.placements[p.id]).length;
  $('placed-count').textContent = `${placed} / ${PIECES.length} placed`;
  root.innerHTML = AREAS.map(area => `
    <div class="area-group">
      <div class="area-group-name">${esc(area.name)}</div>
      ${area.pieces.map(p => {
        const pl = state.placements[p.id];
        const status = pl
          ? `<span class="chip ${flagged.has(p.id) ? 'warn' : ''}">S${pl.slab}${pl.rot ? ' ↻' : ''}</span>`
          : `<button class="auto" data-auto="${p.id}" title="Put it in the first free spot">Auto</button>`;
        return `<div class="piece-row ${pl ? '' : 'unplaced'} ${p.id === selected ? 'selected' : ''}" draggable="true" data-id="${p.id}">
          <span class="swatch" style="background:${area.color}"></span>
          <div><div class="piece-name">${esc(p.name.replace(area.name + ' ', '').replace(/^./, c => c.toUpperCase()))}</div>
          <div class="piece-dims">${fmt(p.w)} × ${fmt(p.h)}${p.cutouts.length ? ` · ${p.cutouts.length} cutout${p.cutouts.length > 1 ? 's' : ''}` : ''}</div></div>
          ${status}
        </div>`;
      }).join('')}
    </div>`).join('');
}

function renderIssues() {
  const ul = $('issues');
  const unplaced = PIECES.filter(p => !state.placements[p.id]).length;
  let html = issues.map((it, i) => `<li data-issue="${i}">⚠ ${esc(it.text)}</li>`).join('');
  if (unplaced) html += `<li class="info">${unplaced} piece${unplaced > 1 ? 's' : ''} not placed yet.</li>`;
  if (!issues.length && !unplaced) html = `<li class="good">Everything fits. No overlaps or edge problems.</li>`;
  else if (!issues.length) html = `<li class="good">No overlaps or edge problems.</li>` + html;
  ul.innerHTML = html;
}

function renderSlabStats() {
  for (const v of views) {
    const here = placedOn(v.slab);
    const used = here.reduce((sum, [id]) => sum + PIECE[id].rects.reduce((a, r) => a + r[2] * r[3], 0), 0);
    const pct = Math.round(used / (W * H) * 100);
    v.card.querySelector('[data-k=pieces]').textContent = here.length;
    v.card.querySelector('[data-k=used]').textContent = `${pct}% · ${(used / 144).toFixed(1)} ft²`;
    v.card.querySelector('.util-bar i').style.width = Math.min(100, pct) + '%';
  }
}

function renderPreviewTags() {
  for (const pv of Object.values(previewEls)) {
    pv.el.classList.toggle('selected', pv.area.pieces.some(p => p.id === selected));
    const slabs = [...new Set(pv.area.pieces.map(p => state.placements[p.id]?.slab).filter(Boolean))];
    pv.el.querySelector('.tags').innerHTML = slabs.map(s => `<span class="chip">Slab ${s}</span>`).join('');
  }
}

function renderInspector() {
  const el = $('inspector');
  const p = PIECE[selected];
  if (!p) {
    el.innerHTML = `<h2>Selected piece</h2>
      <p class="insp-empty">Click a piece on a slab or in the cut list.</p>
      <div class="keys">
        <kbd>drag</kbd><span>Move (snaps to edges &amp; gaps; hold <kbd>⌥</kbd> to free-move)</span>
        <kbd>R</kbd><span>Rotate 90° (<kbd>⇧R</kbd> back), or double-click</span>
        <kbd>← ↑ → ↓</kbd><span>Nudge ⅛″ (<kbd>⇧</kbd> 1″)</span>
        <kbd>⌫</kbd><span>Back to the cut list</span>
        <kbd>⌘C</kbd><span>Copy layout JSON</span>
        <kbd>⌘V</kbd><span>Load pasted layout JSON</span>
        <kbd>⌘Z</kbd><span>Undo</span>
      </div>`;
    return;
  }
  const pl = state.placements[p.id];
  el.innerHTML = `<h2>Selected piece</h2>
    <div class="insp-head"><span class="swatch" style="background:${p.area.color}"></span>
      <div><div class="insp-name">${esc(p.name)}</div><div class="insp-sub">${fmt(p.w)} × ${fmt(p.h)} · ${p.kind === 'splash' ? 'backsplash' : p.kind}</div></div></div>
    <div class="field"><span>Slab</span><div class="seg">
      ${SLABS.map(s => `<button data-slab="${s}" class="${pl?.slab === s ? 'on' : ''}">${s}</button>`).join('')}
    </div></div>
    ${pl ? `
    <div class="field"><span>From edge</span><div class="xy">
      <label>L <input data-xy="x" value="${fmt(pl.x)}"></label>
      <label>T <input data-xy="y" value="${fmt(pl.y)}"></label>
    </div></div>
    <div class="field"><span>Rotation</span><div class="rot">
      <button data-rot="-90" title="Rotate counter-clockwise (⇧R)">⟲</button><output>${pl.rot}°</output><button data-rot="90" title="Rotate clockwise (R)">⟳</button>
    </div></div>
    <div class="insp-actions"><button data-act="auto">Find free spot</button><button data-act="remove" class="danger">Remove</button></div>`
    : `<div class="insp-actions"><button data-act="auto">Auto-place</button></div>`}`;
}

function updateInspectorLive() {
  const pl = state.placements[selected];
  if (!pl) return;
  const el = $('inspector');
  for (const k of ['x', 'y']) {
    const inp = el.querySelector(`[data-xy=${k}]`);
    if (inp && document.activeElement !== inp) inp.value = fmt(pl[k]);
  }
  el.querySelectorAll('[data-slab]').forEach(b => b.classList.toggle('on', +b.dataset.slab === pl.slab));
}

function bindUI() {
  // cut list
  const list = $('cutlist');
  list.addEventListener('click', e => {
    const auto = e.target.closest('[data-auto]');
    if (auto) { autoPlace(auto.dataset.auto); return; }
    const row = e.target.closest('.piece-row');
    if (!row) return;
    select(row.dataset.id);
    const pl = state.placements[row.dataset.id];
    if (pl) views[pl.slab - 1].card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });
  list.addEventListener('dblclick', e => {
    const row = e.target.closest('.piece-row');
    if (row && !state.placements[row.dataset.id]) autoPlace(row.dataset.id);
  });
  list.addEventListener('dragstart', e => {
    const row = e.target.closest('.piece-row');
    if (!row) return;
    listDragId = row.dataset.id;
    e.dataTransfer.setData('text/plain', listDragId);
    e.dataTransfer.effectAllowed = 'move';
    row.classList.add('dragging');
  });
  list.addEventListener('dragend', e => {
    e.target.closest('.piece-row')?.classList.remove('dragging');
    listDragId = null; ghost = null;
    views.forEach(v => v.wrap.classList.remove('drop-hot'));
    requestRender();
  });

  // issues
  $('issues').addEventListener('click', e => {
    const li = e.target.closest('[data-issue]');
    if (!li) return;
    const id = issues[+li.dataset.issue]?.ids[0];
    if (id) { select(id); views[state.placements[id].slab - 1].card.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
  });

  // inspector
  const insp = $('inspector');
  insp.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b || !selected) return;
    if (b.dataset.slab) {
      const slab = +b.dataset.slab;
      const pl = state.placements[selected];
      if (pl?.slab === slab) return;
      autoPlace(selected, [slab]);
    } else if (b.dataset.rot) rotateSelected(+b.dataset.rot);
    else if (b.dataset.act === 'auto') autoPlace(selected);
    else if (b.dataset.act === 'remove') unplace(selected);
  });
  insp.addEventListener('change', e => {
    const k = e.target.dataset.xy;
    const pl = state.placements[selected];
    if (!k || !pl) return;
    const v = parseIn(e.target.value);
    if (isNaN(v)) { e.target.value = fmt(pl[k]); return; }
    mutate(() => { pl[k] = round6(v); });
  });
  insp.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.dataset.xy) e.target.blur(); });

  // settings
  for (const k of ['gap', 'margin']) {
    $('set-' + k).addEventListener('change', e => {
      const v = parseIn(e.target.value);
      if (isNaN(v) || v < 0 || v > 6) { e.target.value = fmt(state.settings[k]); return; }
      mutate(() => { state.settings[k] = round6(v); });
    });
  }
  $('set-dim').addEventListener('change', e => { prefs.dim = e.target.checked; save(); requestRender(); });

  // notes: one undo step per editing session
  let notesBefore = null;
  $('notes').addEventListener('focus', () => { notesBefore = snapshot(); });
  $('notes').addEventListener('input', e => { state.notes = e.target.value; save(); });
  $('notes').addEventListener('blur', () => {
    if (notesBefore && JSON.parse(notesBefore).notes !== state.notes) { pushUndo(notesBefore); updateUI(); }
    notesBefore = null;
  });

  // author
  const author = $('author');
  author.value = state.author;
  author.addEventListener('input', () => { state.author = author.value.trim(); store.set(AUTHOR_KEY, state.author); });

  // top bar
  $('undo').addEventListener('click', undo);
  $('redo').addEventListener('click', redo);
  $('copy-json').addEventListener('click', copyJSON);
  $('paste-json').addEventListener('click', openPasteDialog);
  $('copy-link').addEventListener('click', copyLink);
  $('export').addEventListener('click', exportSheet);
  $('reset').addEventListener('click', () => {
    if (!Object.keys(state.placements).length) return;
    if (!confirm('Clear all placements? (You can undo this.)')) return;
    mutate(() => { state.placements = {}; });
    select(null);
  });
  $('slabs').addEventListener('click', e => {
    const b = e.target.closest('[data-export]');
    if (b) exportSlab(+b.dataset.export);
  });

  // paste dialog
  $('paste-load').addEventListener('click', e => {
    const err = importLayout($('paste-text').value, 'paste');
    if (err) {
      e.preventDefault();
      $('paste-error').textContent = err;
      $('paste-error').hidden = false;
    }
  });

  // keyboard
  document.addEventListener('keydown', e => {
    const t = e.target;
    if (t.closest?.('input, textarea, dialog')) return;
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
    if (mod) return;
    if (e.key === 'Escape') { select(null); return; }
    if (!selected) return;
    const step = e.shiftKey ? 1 : 0.125;
    switch (e.key) {
      case 'r': case 'R': rotateSelected(e.shiftKey ? -90 : 90); break;
      case 'ArrowLeft': nudgeSelected(-step, 0); break;
      case 'ArrowRight': nudgeSelected(step, 0); break;
      case 'ArrowUp': nudgeSelected(0, -step); break;
      case 'ArrowDown': nudgeSelected(0, step); break;
      case 'Delete': case 'Backspace': unplace(selected); break;
      default: return;
    }
    e.preventDefault();
  });

  // ⌘C with nothing selected → layout JSON;  ⌘V anywhere outside a field → import
  document.addEventListener('copy', e => {
    if (e.target.closest?.('input, textarea') || String(window.getSelection())) return;
    e.preventDefault();
    e.clipboardData.setData('text/plain', layoutJSON());
    toast('Layout JSON copied. Paste it into a text or email.');
  });
  document.addEventListener('paste', e => {
    if (e.target.closest?.('input, textarea')) return;
    const text = e.clipboardData.getData('text/plain');
    if (!text) return;
    e.preventDefault();
    const err = importLayout(text, 'paste');
    if (err) toast(err);
  });

  new ResizeObserver(relayout).observe($('slabs'));
  new ResizeObserver(() => { layoutPreviews(); requestRender(); }).observe($('previews'));
}

// ============================================================ share / import / export
function layoutObject() {
  const placements = {};
  for (const p of PIECES) {
    const pl = state.placements[p.id];
    if (pl) placements[p.id] = { slab: pl.slab, x: Math.round(pl.x * 16) / 16, y: Math.round(pl.y * 16) / 16, rot: pl.rot };
  }
  return {
    app: APP_ID, version: 1,
    author: state.author || 'anonymous',
    savedAt: new Date().toISOString(),
    settings: { ...state.settings },
    notes: state.notes,
    placements,
  };
}
const layoutJSON = () => JSON.stringify(layoutObject(), null, 2);

async function copyText(text, okMsg) {
  try {
    await navigator.clipboard.writeText(text);
    toast(okMsg);
  } catch {
    openPasteDialog(text, true);
  }
}

function copyJSON() { copyText(layoutJSON(), 'Layout JSON copied. Paste it into a text or email.'); }

function b64urlEncode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = ''; bytes.forEach(b => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(s) {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0)));
}

function copyLink() {
  const url = `${location.origin}${location.pathname}#layout=${b64urlEncode(JSON.stringify(layoutObject()))}`;
  copyText(url, 'Link copied. Opening it loads this exact layout.');
}

function openPasteDialog(prefill = '', isCopy = false) {
  const d = $('paste-dialog');
  $('paste-text').value = typeof prefill === 'string' ? prefill : '';
  $('paste-error').hidden = true;
  d.querySelector('h2').textContent = isCopy ? 'Copy this' : 'Load a layout';
  d.querySelector('.hint').textContent = isCopy
    ? 'Your browser blocked clipboard access. Select all and copy it manually.'
    : 'Paste the JSON someone sent you. Your current layout stays one Undo away.';
  $('paste-load').hidden = isCopy;
  d.showModal();
  if (isCopy) $('paste-text').select(); else $('paste-text').focus();
}

function sanitizePlacements(raw) {
  const placements = {};
  let skipped = 0;
  for (const [id, pl] of Object.entries(raw || {})) {
    const slab = Number(pl?.slab), x = Number(pl?.x), y = Number(pl?.y), rot = ((Number(pl?.rot) % 360) + 360) % 360;
    if (!PIECE[id] || !SLABS.includes(slab) || !isFinite(x) || !isFinite(y) || rot % 90) { skipped++; continue; }
    placements[id] = { slab, x: round6(x), y: round6(y), rot };
  }
  return { placements, skipped };
}

/** Returns an error string, or null on success. */
function importLayout(text, source) {
  let o;
  try { o = JSON.parse(text.trim()); } catch { return 'That doesn’t look like layout JSON.'; }
  if (!o || typeof o !== 'object' || ![APP_ID, 'slab-picker'].includes(o.app) || typeof o.placements !== 'object') {
    return 'That JSON isn’t a Slab Happy layout.';
  }
  const { placements, skipped } = sanitizePlacements(o.placements);
  const num = (v, d) => (isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : d);
  mutate(() => {
    state.placements = placements;
    if (o.settings) state.settings = { gap: num(o.settings.gap, 0.5), margin: num(o.settings.margin, 0.5) };
    state.notes = typeof o.notes === 'string' ? o.notes : '';
  });
  select(null);
  const who = typeof o.author === 'string' && o.author ? o.author : 'someone';
  const when = o.savedAt ? new Date(o.savedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
  toast(`Loaded ${who}’s layout${when ? ` (${when})` : ''}${skipped ? `, skipped ${skipped} unknown piece${skipped > 1 ? 's' : ''}` : ''}. ⌘Z brings yours back.`, 6000);
  return null;
}

function stamp() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}
function slug(s) { return (s || 'anon').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'anon'; }

function download(canvas, name) {
  canvas.toBlob(blob => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }, 'image/jpeg', 0.9);
}

function wrapText(ctx, text, maxW) {
  const out = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/)) {
      const test = line ? line + ' ' + word : word;
      if (ctx.measureText(test).width > maxW && line) { out.push(line); line = word; } else line = test;
    }
    out.push(line);
  }
  return out;
}

function drawSheetFrame(ctx, w, h) {
  ctx.fillStyle = PAPER; ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = INK; ctx.lineWidth = 3; ctx.strokeRect(20, 20, w - 40, h - 40);
  ctx.lineWidth = 1; ctx.strokeRect(28, 28, w - 56, h - 56);
}

function headerLines() {
  const who = state.author || 'anonymous';
  const when = new Date().toLocaleString([], { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const placed = PIECES.filter(p => state.placements[p.id]).length;
  return { who, when, placed };
}

async function exportSheet() {
  await document.fonts.ready;
  const S = 13, R = 34, PAD = 64;
  const SW = W * S, SH = H * S;
  const { who, when, placed } = headerLines();

  // measure header
  const tmp = document.createElement('canvas').getContext('2d');
  tmp.font = '400 22px "Familjen Grotesk"';
  const noteLines = state.notes.trim() ? wrapText(tmp, state.notes.trim(), SW - 40).slice(0, 6) : [];
  const issueLines = issues.map(i => '⚠ ' + i.text).slice(0, 8);
  const headerH = 150 + noteLines.length * 30 + (noteLines.length ? 16 : 0);

  const slabBlock = 56 + R + SH;
  const slabGap = 56;
  const leftH = SLAB.count * slabBlock + (SLAB.count - 1) * slabGap;
  const rightW = 760;
  const stacks = AREAS.map(areaStack);
  const labelH = 44, areaGap = 36;
  const sumH = stacks.reduce((a, s) => a + s.h, 0);
  const maxW = Math.max(...stacks.map(s => s.w));
  const issuesH = issueLines.length ? 60 + issueLines.length * 30 : 0;
  const ps = Math.min(rightW / maxW, (leftH - issuesH - AREAS.length * (labelH + areaGap)) / sumH, 9);

  const width = PAD * 2 + R + SW + 80 + rightW;
  const height = PAD * 2 + headerH + leftH;
  const c = document.createElement('canvas');
  c.width = width; c.height = height;
  const ctx = c.getContext('2d');
  drawSheetFrame(ctx, width, height);

  // header
  let y = PAD + 8;
  ctx.fillStyle = INK; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  ctx.font = '800 64px "Big Shoulders Display"';
  ctx.fillText('SLAB HAPPY · LAYOUT', PAD, y);
  ctx.font = '500 26px "Familjen Grotesk"';
  ctx.fillText(`by ${who}  ·  ${when}`, PAD, y + 76);
  ctx.font = '400 20px "DM Mono"'; ctx.fillStyle = '#4a463f';
  ctx.fillText(`${placed}/${PIECES.length} pieces placed · min gap ${fmt(state.settings.gap)} · edge margin ${fmt(state.settings.margin)} · ${issues.length ? issues.length + ' warning' + (issues.length > 1 ? 's' : '') : 'no warnings'}`, PAD, y + 112);
  ctx.font = '400 22px "Familjen Grotesk"'; ctx.fillStyle = INK;
  noteLines.forEach((ln, i) => ctx.fillText(ln, PAD, y + 150 + i * 30));
  // legend at top right
  const lx = width - PAD - rightW;
  ctx.font = '400 19px "Familjen Grotesk"'; ctx.fillStyle = '#4a463f';
  ctx.fillText('Thick colored edge = wall side (counters) / top (backsplashes, panels).', lx, y + 80);
  ctx.fillText('Dark dashed shapes = sink cutouts. Positions are from slab top-left.', lx, y + 108);

  // slabs
  const top = PAD + headerH;
  ctx.textBaseline = 'alphabetic';
  for (const slab of SLABS) {
    const by = top + (slab - 1) * (slabBlock + slabGap);
    ctx.fillStyle = INK; ctx.font = '800 40px "Big Shoulders Display"'; ctx.textAlign = 'left';
    ctx.fillText(`SLAB ${slab}`, PAD, by + 38);
    const here = placedOn(slab);
    ctx.font = '400 19px "DM Mono"'; ctx.fillStyle = '#4a463f';
    ctx.fillText(here.length ? here.map(([id]) => PIECE[id].name).join(' · ') : 'unused', PAD + 140, by + 36);
    drawSlab(ctx, slab, { scale: S, ox: PAD + R, oy: by + 56 + R, src: img, rulers: true, dim: prefs.dim, coords: true });
  }

  // areas column
  const ax = width - PAD - rightW;
  let ay = top;
  if (issueLines.length) {
    ctx.fillStyle = '#fbecea'; ctx.fillRect(ax, ay, rightW, issuesH - 20);
    ctx.fillStyle = DANGER; ctx.fillRect(ax, ay, 6, issuesH - 20);
    ctx.fillStyle = INK; ctx.font = '800 26px "Big Shoulders Display"'; ctx.textAlign = 'left';
    ctx.fillText('WARNINGS', ax + 20, ay + 36);
    ctx.font = '400 18px "Familjen Grotesk"';
    issueLines.forEach((t, i) => ctx.fillText(t, ax + 20, ay + 68 + i * 30));
    ay += issuesH;
  }
  ctx.fillStyle = INK; ctx.font = '800 32px "Big Shoulders Display"'; ctx.textAlign = 'left';
  ctx.fillText('AREAS AS INSTALLED', ax, ay + 28);
  ay += 48;
  for (const area of AREAS) {
    ctx.fillStyle = area.color; ctx.fillRect(ax, ay + 6, 14, 24);
    ctx.strokeStyle = INK; ctx.lineWidth = 1; ctx.strokeRect(ax, ay + 6, 14, 24);
    ctx.fillStyle = INK; ctx.font = '700 24px "Familjen Grotesk"'; ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
    ctx.fillText(area.name, ax + 24, ay + 28);
    const tags = area.pieces.map(p => {
      const pl = state.placements[p.id];
      const nm = p.kind === 'splash' ? 'splash' : p.kind === 'counter' && area.pieces.length > 1 ? 'counter' : '';
      return `${nm ? nm + ' ' : ''}${pl ? 'S' + pl.slab : '—'}`;
    }).join(' · ');
    ctx.font = '400 18px "DM Mono"'; ctx.fillStyle = '#4a463f'; ctx.textAlign = 'right';
    ctx.fillText(tags, ax + rightW, ay + 27); ctx.textAlign = 'left';
    ay += labelH;
    const st = drawArea(ctx, area, ax, ay, ps, { tags: true, fs: 16 });
    ay += st.h * ps + areaGap;
  }

  download(c, `slab-layout-${slug(state.author)}-${stamp()}.jpg`);
  toast('Exported the layout sheet.');
}

async function exportSlab(slab) {
  await document.fonts.ready;
  const S = 24, R = 44, PAD = 60;
  const { who, when } = headerLines();
  const width = PAD * 2 + R + W * S, height = PAD * 2 + 110 + R + H * S;
  const c = document.createElement('canvas');
  c.width = width; c.height = height;
  const ctx = c.getContext('2d');
  drawSheetFrame(ctx, width, height);
  ctx.fillStyle = INK; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  ctx.font = '800 60px "Big Shoulders Display"';
  ctx.fillText(`SLAB ${slab} / ${SLAB.count}`, PAD, PAD + 56);
  ctx.font = '500 26px "Familjen Grotesk"';
  ctx.fillText(`Slab Happy · by ${who} · ${when}`, PAD + 330, PAD + 50);
  drawSlab(ctx, slab, { scale: S, ox: PAD + R, oy: PAD + 110 + R, src: img, rulers: true, dim: prefs.dim, coords: true });
  download(c, `slab-${slab}-${slug(state.author)}-${stamp()}.jpg`);
  toast(`Exported Slab ${slab}.`);
}

// ============================================================ toast
let toastTimer;
function toast(msg, ms = 3500) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

// ============================================================ boot
function loadSaved() {
  state.author = store.get(AUTHOR_KEY) || '';
  try { Object.assign(prefs, JSON.parse(store.get(PREFS_KEY) || '{}')); } catch { /* ignore */ }
  const saved = store.get(STORAGE_KEY);
  if (saved) {
    try {
      const o = JSON.parse(saved);
      if (o && typeof o.placements === 'object') {
        state.placements = sanitizePlacements(o.placements).placements;
        if (o.settings) state.settings = { ...state.settings, ...o.settings };
        if (typeof o.notes === 'string') state.notes = o.notes;
      }
    } catch { /* ignore corrupt save */ }
  }
}

async function boot() {
  loadSaved();
  img = new Image();
  img.src = SLAB.image;
  await Promise.all([
    img.decode(),
    document.fonts.load('600 12px "Familjen Grotesk"'),
    document.fonts.load('400 12px "DM Mono"'),
    document.fonts.load('800 20px "Big Shoulders Display"'),
  ]).catch(() => {});

  const root = $('slabs');
  for (const slab of SLABS) {
    const v = new SlabView(slab);
    views.push(v);
    root.appendChild(v.card);
  }
  const legend = document.createElement('div');
  legend.className = 'legend';
  legend.innerHTML = `<span><i></i>Thick edge = wall side (counters) / top (backsplashes, panels)</span><span><i class="cut"></i>Sink cutout</span><span>Distances shown are from the slab edges</span>`;
  root.appendChild(legend);

  buildPreviews();
  bindUI();
  computeIssues();
  updateUI();
  relayout();

  // shared link?
  const m = location.hash.match(/layout=([A-Za-z0-9_-]+)/);
  if (m) {
    let err;
    try { err = importLayout(b64urlDecode(m[1]), 'link'); } catch { err = 'That link’s layout couldn’t be read.'; }
    if (err) toast(err);
    history.replaceState(null, '', location.pathname + location.search);
  }
}

boot();
