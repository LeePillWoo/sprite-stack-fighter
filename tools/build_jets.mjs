// Carves a voxel sprite stack out of a four-view concept sheet (top / side / front / bottom):
//   voxel(x,k,z) = top[x,k] & side[k,z] & front[x,z]   (visual hull), coloured from the view that sees it.
// usage: node build_jets.mjs [length]   → ../parts/jets.js + preview PNGs in ../parts/
import { readPng, writePng } from './png.mjs';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const DESIGN = new URL('../design/', import.meta.url), PARTS = new URL('../parts/', import.meta.url);
const fp = u => fileURLToPath(u);

function extractViews(img) {
  const { w, h, data } = img, N = w * h;
  // background = flood from the border through pixels close to the backdrop colour
  const bg = new Uint8Array(N), q = [];
  const br = data[0], bgc = data[1], bb = data[2];
  const near = o => Math.abs(data[o * 4] - br) + Math.abs(data[o * 4 + 1] - bgc) + Math.abs(data[o * 4 + 2] - bb) < 46;
  const push = o => { if (!bg[o] && near(o)) { bg[o] = 1; q.push(o); } };
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
  while (q.length) {
    const o = q.pop(), x = o % w;
    if (x > 0) push(o - 1); if (x < w - 1) push(o + 1); if (o >= w) push(o - w); if (o < N - w) push(o + w);
  }
  // connected components of what is left
  const lab = new Int32Array(N), comps = [];
  for (let s = 0; s < N; s++) {
    if (bg[s] || lab[s]) continue;
    const id = comps.length + 1, c = { id, n: 0, x0: w, y0: h, x1: 0, y1: 0 };
    lab[s] = id;
    const st = [s];
    while (st.length) {
      const o = st.pop(), x = o % w, y = (o / w) | 0;
      c.n++;
      if (x < c.x0) c.x0 = x; if (x > c.x1) c.x1 = x; if (y < c.y0) c.y0 = y; if (y > c.y1) c.y1 = y;
      for (const n of [o - 1, o + 1, o - w, o + w, o - w - 1, o - w + 1, o + w - 1, o + w + 1]) {
        if (n >= 0 && n < N && !bg[n] && !lab[n] && Math.abs((n % w) - x) <= 1) { lab[n] = id; st.push(n); }
      }
    }
    comps.push(c);
  }
  // the four biggest are the views; smaller pieces (detached missiles) join the view whose box they fall in
  const big = [...comps].sort((a, b) => b.n - a.n).slice(0, 4);
  const views = big.map(c => ({ ...c, ids: new Set([c.id]) }));
  for (const c of comps) {
    // (caption boxes are solid rectangles: skip those)
    const solid = c.n / ((c.x1 - c.x0 + 1) * (c.y1 - c.y0 + 1));
    if (big.includes(c) || c.n < 12 || c.n > 3000 || (c.n > 1200 && solid > 0.8)) continue;
    const cx = (c.x0 + c.x1) / 2, cy = (c.y0 + c.y1) / 2;
    const v = views.find(v => cx > v.x0 - 4 && cx < v.x1 + 4 && cy > v.y0 - 4 && cy < v.y1 + 4);
    if (v) { v.ids.add(c.id); v.x0 = Math.min(v.x0, c.x0); v.x1 = Math.max(v.x1, c.x1); v.y0 = Math.min(v.y0, c.y0); v.y1 = Math.max(v.y1, c.y1); }
  }
  // name them by position: top = upper-left, side = upper-right, front = lower-left, bottom = lower-right
  const out = {};
  for (const v of views) {
    const up = (v.y0 + v.y1) / 2 < h / 2, left = (v.x0 + v.x1) / 2 < w / 2;
    out[up ? (left ? 'top' : 'side') : (left ? 'front' : 'bottom')] = v;
  }
  // dominant colour + coverage of a fractional box inside view v
  out.sample = (v, fx0, fy0, fx1, fy1) => {
    const vw = v.x1 - v.x0 + 1, vh = v.y1 - v.y0 + 1;
    const xa = Math.floor(v.x0 + fx0 * vw), xb = Math.max(xa + 1, Math.ceil(v.x0 + fx1 * vw));
    const ya = Math.floor(v.y0 + fy0 * vh), yb = Math.max(ya + 1, Math.ceil(v.y0 + fy1 * vh));
    let n = 0, tot = 0;
    const cols = [];
    for (let y = ya; y < yb; y++) for (let x = xa; x < xb; x++) {
      tot++;
      const o = y * w + x;
      if (x < 0 || y < 0 || x >= w || y >= h || !v.ids.has(lab[o])) continue;
      n++; cols.push([data[o * 4], data[o * 4 + 1], data[o * 4 + 2]]);
    }
    if (!n) return null;
    // medoid: the sampled colour closest to all the others keeps the pixel art crisp (no averaging mush)
    let best = cols[0], bd = 1e18;
    for (const a of cols) {
      let d = 0;
      for (const b of cols) d += Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
      if (d < bd) { bd = d; best = a; }
    }
    return { cov: n / tot, col: best };
  };
  return out;
}

function carve(file, L, squash) {
  const V = extractViews(readPng(fp(new URL(file, DESIGN))));
  const { top, side, front, bottom } = V;
  const W = Math.round(L * (top.x1 - top.x0 + 1) / (top.y1 - top.y0 + 1) / 2) * 2;
  const H = Math.round(L * (side.y1 - side.y0 + 1) / (side.x1 - side.x0 + 1) * squash);
  console.log(file, ['top', 'side', 'front', 'bottom'].map(n => `${n}:${V[n].x1 - V[n].x0 + 1}x${V[n].y1 - V[n].y0 + 1}`).join(' '), '->', W, L, H);
  const grid = (v, nx, ny, flipY) => {
    const g = [];
    for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
      const yy = flipY ? ny - 1 - y : y;
      g.push(V.sample(v, x / nx, yy / ny, (x + 1) / nx, (yy + 1) / ny));
    }
    return g;
  };
  const T = grid(top, W, L), B = grid(bottom, W, L), S = grid(side, L, H, true), F = grid(front, W, H, true);   // z up
  const on = (g, i) => g[i] && g[i].cov >= 0.45;
  // the jet is symmetric: mirror the masks so both wings match
  const tm = new Uint8Array(W * L), fm = new Uint8Array(W * H);
  for (let k = 0; k < L; k++) for (let x = 0; x < W; x++) tm[k * W + x] = on(T, k * W + x) || on(T, k * W + W - 1 - x) ? 1 : 0;
  for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) fm[z * W + x] = on(F, z * W + x) || on(F, z * W + W - 1 - x) ? 1 : 0;
  const vox = new Uint8Array(W * L * H), at = (x, k, z) => (z * L + k) * W + x;
  // wing level: the row of the front view that reaches furthest out
  let zWing = 0, reach = -1;
  for (let z = 0; z < H; z++) {
    let r = 0;
    for (let x = 0; x < W / 2; x++) if (fm[z * W + x]) { r = W / 2 - x; break; }
    if (r > reach) { reach = r; zWing = z; }
  }
  for (let k = 0; k < L; k++) for (let x = 0; x < W; x++) {
    if (!tm[k * W + x]) continue;
    let any = false;
    for (let z = 0; z < H; z++) if (on(S, z * L + k) && fm[z * W + x]) { vox[at(x, k, z)] = 1; any = true; }
    if (!any) vox[at(x, k, zWing)] = 1;      // the views disagree here: keep the planform, at wing level
  }
  // colours: seen from above -> top sheet, from below -> bottom sheet, otherwise the side sheet
  const colOf = (g, i) => (g[i] ? g[i].col : null);
  const rgb = new Uint8Array(W * L * H * 3);
  for (let z = 0; z < H; z++) for (let k = 0; k < L; k++) for (let x = 0; x < W; x++) {
    if (!vox[at(x, k, z)]) continue;
    const up = z === H - 1 || !vox[at(x, k, z + 1)], dn = z === 0 || !vox[at(x, k, z - 1)];
    const tc = colOf(T, k * W + x) || colOf(T, k * W + W - 1 - x), sc = colOf(S, z * L + k), bc = colOf(B, k * W + x) || colOf(B, k * W + W - 1 - x);
    const c = (up ? (tc || sc || bc) : dn ? (bc || sc || tc) : (sc || tc || bc)) || [120, 124, 132];
    rgb.set(c, at(x, k, z) * 3);
  }
  // keep the surface only, and note which way each voxel is exposed: 1 above · 2 below · 4 sideways
  const surf = new Uint8Array(vox.length), flg = new Uint8Array(vox.length);
  const e = (X, K, Z) => X < 0 || K < 0 || Z < 0 || X >= W || K >= L || Z >= H || !vox[at(X, K, Z)];
  for (let z = 0; z < H; z++) for (let k = 0; k < L; k++) for (let x = 0; x < W; x++) {
    if (!vox[at(x, k, z)]) continue;
    const f = (e(x, k, z + 1) ? 1 : 0) | (e(x, k, z - 1) ? 2 : 0) | (e(x - 1, k, z) || e(x + 1, k, z) || e(x, k - 1, z) || e(x, k + 1, z) ? 4 : 0);
    if (f) { surf[at(x, k, z)] = 1; flg[at(x, k, z)] = f; }
  }
  return { W, L, H, vox: surf, flg, rgb, zWing, at };
}

// one shared palette: near-identical colours merge until at most 250 remain
function quantise(models) {
  const count = new Map();
  for (const m of models) for (let i = 0; i < m.vox.length; i++) if (m.vox[i]) {
    const k = ((m.rgb[i * 3] >> 2) << 12) | ((m.rgb[i * 3 + 1] >> 2) << 6) | (m.rgb[i * 3 + 2] >> 2);
    count.set(k, (count.get(k) || 0) + 1);
  }
  const all = [...count.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => [((k >> 12) << 2) | 2, (((k >> 6) & 63) << 2) | 2, ((k & 63) << 2) | 2]);
  const keep = [];
  for (const c of all) if (keep.length < 250 && !keep.some(p => Math.abs(p[0] - c[0]) + Math.abs(p[1] - c[1]) + Math.abs(p[2] - c[2]) < 14)) keep.push(c);
  const nearest = c => {
    let b = 0, bd = 1e9;
    for (let i = 0; i < keep.length; i++) { const p = keep[i], d = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2; if (d < bd) { bd = d; b = i; } }
    return b + 1;
  };
  const cache = new Map();
  for (const m of models) {
    m.idx = new Uint8Array(m.vox.length);
    for (let i = 0; i < m.vox.length; i++) if (m.vox[i]) {
      const key = (m.rgb[i * 3] << 16) | (m.rgb[i * 3 + 1] << 8) | m.rgb[i * 3 + 2];
      if (!cache.has(key)) cache.set(key, nearest([m.rgb[i * 3], m.rgb[i * 3 + 1], m.rgb[i * 3 + 2]]));
      m.idx[i] = cache.get(key);
    }
  }
  return keep;
}

const rle = a => {
  const o = [];
  for (let i = 0; i < a.length;) { let n = 1; while (i + n < a.length && a[i + n] === a[i] && n < 255) n++; o.push(n, a[i]); i += n; }
  return Buffer.from(o).toString('base64');
};

// top view, side view, and a classic 1px-per-layer stack turned 30 degrees
function preview(m, pal, path) {
  const S = 3, pw = (m.W * 2 + m.L + 14) * S, ph = (m.L + m.H + 8) * S, px = new Uint8Array(pw * ph * 4).fill(255);
  for (let i = 0; i < pw * ph; i++) { px[i * 4] = 70; px[i * 4 + 1] = 150; px[i * 4 + 2] = 215; }
  const put = (x, y, c) => {
    for (let dy = 0; dy < S; dy++) for (let dx = 0; dx < S; dx++) {
      const X = x * S + dx, Y = y * S + dy;
      if (X >= 0 && Y >= 0 && X < pw && Y < ph) px.set(c, (Y * pw + X) * 4);
    }
  };
  const col = i => pal[m.idx[i] - 1];
  for (let z = 0; z < m.H; z++) for (let k = 0; k < m.L; k++) for (let x = 0; x < m.W; x++) { const i = m.at(x, k, z); if (m.vox[i]) put(2 + x, 2 + m.H + k, col(i)); }
  for (let x = 0; x < m.W; x++) for (let z = 0; z < m.H; z++) for (let k = 0; k < m.L; k++) { const i = m.at(x, k, z); if (m.vox[i]) put(m.W + 6 + k, 2 + m.H - z, col(i)); }
  const a = 0.5, ca = Math.cos(a), sa = Math.sin(a);
  for (let z = 0; z < m.H; z++) for (let k = 0; k < m.L; k++) for (let x = 0; x < m.W; x++) {
    const i = m.at(x, k, z);
    if (!m.vox[i]) continue;
    for (const [ox, ok] of [[0, 0], [0.5, 0], [0, 0.5], [0.5, 0.5]]) {
      const u = x + ox - m.W / 2, v = k + ok - m.L / 2;
      put(Math.round(m.W * 1.5 + m.L / 2 + 10 + u * ca - v * sa), Math.round(m.H + m.L / 2 + 2 + u * sa + v * ca - z), col(i));
    }
  }
  writePng(path, pw, ph, px);
}

const L = +(process.argv[2] || 96);
const models = { player: carve('player_jet_orthos.png', L, 0.8), enemy: carve('enemy_jet_orthos.png', L, 0.8) };
const pal = quantise(Object.values(models));
let js = '// generated by tools/build_jets.mjs from design/*_jet_orthos.png (do not edit)\nconst JET_PAL = ' + JSON.stringify(pal.flat()) + ';\nconst JET_MODELS = {\n';
for (const [name, m] of Object.entries(models)) {
  const n = m.vox.reduce((a, b) => a + b, 0);
  console.log(name, m.W, m.L, m.H, 'surface voxels', n, 'zWing', m.zWing);
  js += `  ${name}: { w: ${m.W}, l: ${m.L}, h: ${m.H}, zWing: ${m.zWing}, rle: '${rle(m.idx)}', flg: '${rle(m.flg)}' },\n`;
  preview(m, pal, fp(new URL(`jet_${name}_preview.png`, PARTS)));
}
js += '};\n';
writeFileSync(fp(new URL('jets.js', PARTS)), js);
console.log('palette', pal.length, 'jets.js', js.length, 'bytes');
