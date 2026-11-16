'use strict';
// Sprite Stack Fighter — a small software renderer.
// Everything is drawn into one low-resolution Uint32 pixel buffer:
//   · jets are stacks of horizontal voxel slices, turned to any yaw / roll / pitch
//   · islands and clouds are stacks too (a height + material per ground pixel)
// One camera covers all three views:  scale = S / (1 + q·depth),  y = Cy − scale·(height + slope·depth).
// q = 0 is the flat sprite-stack view; raising q brings the camera in behind the jet and a horizon appears,
// so switching views is one continuous move.

// ───────────────────────────────────────────────────────────── constants
const N = 2048, NM = N - 1, NSH = 11;        // world size (wraps)
const NC = 1024, NCM = NC - 1, NCSH = 10;    // cloud map size (wraps)
const CK = 12, CLOUD_ALT = 78, ZTOP = CLOUD_ALT + CK;
const JET_SC = 0.55 / 3;                      // world units per jet voxel (a jet is ~18 units long)
const JS = JET_SC / 0.55;                      // size of things scaled to the jet, against the original tuning
const VIEW_DIST = 1700, FOG_START = 340, FOG_STEPS = 12, NSKY = 10, EPS = 1e-5;
const COCKPIT_LOOK = 64, COCKPIT_EYE = 5;
const TRAIL_N = 96;
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const P = {
  speed: 96, boost: 1.9, agility: 1.3, bank: 56, altitude: 112, ceiling: 280, clearance: 7,
  cameraFollow: 0.6, chaseDistance: 2.5 / JS, chaseAngle: 19, chaseSize: 0.23 * JS, transition: 1.2,
  clouds: 0.4, land: 0.33, seed: 7, afterburner: 0.9,
};

// ───────────────────────────────────────────────────────────── helpers
const c8 = v => (v < 0 ? 0 : v > 255 ? 255 : v | 0);
const pack = (r, g, b) => ((255 << 24) | (c8(b) << 16) | (c8(g) << 8) | c8(r)) >>> 0;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const wrapAngle = a => a - Math.PI * 2 * Math.round(a / (Math.PI * 2));
const ease = (dt, k) => 1 - Math.exp(-dt * k);
function mulberry32(seed) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hash8(o) {
  let h = Math.imul(o ^ (o >>> 13), 0x5bd1e995);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  return (h >>> 24) & 255;
}
const mixCol = (bg, fg, k) => {   // k 0..256
  const r = ((bg & 255) * (256 - k) + (fg & 255) * k) >> 8;
  const g = (((bg >> 8) & 255) * (256 - k) + ((fg >> 8) & 255) * k) >> 8;
  const b = (((bg >> 16) & 255) * (256 - k) + ((fg >> 16) & 255) * k) >> 8;
  return ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0;
};
// colour grading per time of day
function grade(c, tod, amount) {
  if (tod === 0 || amount <= 0) return c;
  let r, g, b;
  if (tod === 1) { r = 0.95 * c[0] + 0.1 * c[1] + 12; g = 0.72 * c[1] + 0.05 * c[0] + 4; b = 0.7 * c[2] + 0.08 * c[0] + 10; }
  else { r = 0.22 * c[0] + 2; g = 0.3 * c[1] + 6; b = 0.5 * c[2] + 22; }
  return [c[0] + (r - c[0]) * amount, c[1] + (g - c[1]) * amount, c[2] + (b - c[2]) * amount];
}
// tileable value noise, one octave added into `field`
function addOctave(field, n, cell, amp, rnd) {
  const Pn = n / cell, lat = new Float32Array(Pn * Pn);
  for (let i = 0; i < lat.length; i++) lat[i] = rnd();
  const x0 = new Int32Array(n), x1 = new Int32Array(n), tx = new Float32Array(n);
  for (let x = 0; x < n; x++) {
    const g = x / cell, i = Math.floor(g), f = g - i;
    x0[x] = i % Pn; x1[x] = (i + 1) % Pn; tx[x] = f * f * (3 - 2 * f);
  }
  for (let y = 0; y < n; y++) {
    const ra = x0[y] * Pn, rb = x1[y] * Pn, ty = tx[y], row = y * n;
    for (let x = 0; x < n; x++) {
      const a0 = lat[ra + x0[x]], b0 = lat[rb + x0[x]];
      const va = a0 + (lat[ra + x1[x]] - a0) * tx[x], vb = b0 + (lat[rb + x1[x]] - b0) * tx[x];
      field[row + x] += amp * (va + (vb - va) * ty);
    }
  }
}
function normalise(f) {
  let mn = Infinity, mx = -Infinity;
  for (let i = 0; i < f.length; i++) { const v = f[i]; if (v < mn) mn = v; if (v > mx) mx = v; }
  const k = 1 / (mx - mn || 1);
  for (let i = 0; i < f.length; i++) f[i] = (f[i] - mn) * k;
}

// ───────────────────────────────────────────────────────────── materials (palette taken from the concept art)
// water (animated; no walls)
const M_DEEP = 0, M_DEEP2 = 1, M_MID = 2, M_MID2 = 3, M_SHALLOW = 4, M_LAGOON = 5, M_SURF = 6, M_REEF = 7, M_REEF2 = 8, NWATER = 9;
// land: [top colour, wall colour]
const M_WET = 9, M_SAND = 10, M_SPECK = 11, M_GRASS = 12, M_GRASSD = 13, M_GRASSL = 14, M_GRASS2 = 15, M_GRASS3 = 16, M_CGRASS = 17, M_CGRASSD = 18;
const M_TREEL = 19, M_TREE = 20, M_TREED = 21, M_ROCK = 22, M_ROCKD = 23, M_ROCKL = 24, M_PEAK = 25, M_PEAKD = 26, M_FROND = 27, M_FRONDL = 28, M_TRUNK = 29;
const M_THATCH = 30, M_THATCHL = 31, M_WOOD = 32, M_WOODD = 33, M_FLOWR = 34, M_FLOWY = 35, M_BOULD = 36, M_BOULDL = 37;
const MATS = [
  [[18, 74, 164]], [[26, 90, 180]], [[30, 110, 198]], [[38, 126, 208]], [[44, 152, 222]], [[72, 198, 228]], [[120, 222, 232]], [[34, 144, 170]], [[74, 190, 182]],
  [[204, 182, 126], [174, 150, 102]], [[240, 222, 160], [204, 180, 122]], [[224, 200, 138], [196, 170, 114]],
  [[104, 186, 56], [58, 122, 44]], [[72, 150, 46], [50, 108, 42]], [[144, 212, 78], [62, 130, 46]], [[124, 198, 62], [60, 126, 44]], [[86, 170, 52], [54, 114, 42]],
  [[104, 186, 56], [126, 120, 112]], [[78, 156, 48], [98, 94, 100]],                       // cliff-top grass: rock walls
  [[126, 206, 78], [26, 84, 44]], [[58, 148, 58], [22, 74, 40]], [[30, 100, 48], [18, 62, 36]],
  [[150, 146, 140], [104, 98, 100]], [[120, 116, 116], [84, 80, 86]], [[186, 180, 168], [118, 112, 110]], [[228, 222, 204], [176, 172, 170]], [[188, 188, 190], [150, 150, 160]],
  [[66, 168, 58], [34, 104, 46]], [[152, 216, 86], [40, 116, 50]], [[150, 110, 66], [112, 78, 46]],
  [[214, 170, 82], [150, 104, 52]], [[240, 206, 110], [170, 122, 60]], [[150, 104, 62], [104, 70, 44]], [[116, 78, 46], [80, 54, 36]],
  [[228, 60, 70], [58, 122, 44]], [[250, 220, 80], [58, 122, 44]], [[140, 140, 146], [96, 96, 104]], [[192, 192, 194], [120, 120, 126]],
];
const MAT_TOP = MATS.map(m => m[0]), MAT_SIDE = MATS.map(m => m[1] || m[0]);
const NMAT = MAT_TOP.length;

// ───────────────────────────────────────────────────────────── jet models (voxel slices carved from the four-view art)
function decodeModel(m) {
  const { w, l, h } = m, bin = atob(m.rle), flat = new Uint8Array(w * l * h);
  for (let i = 0, o = 0; i < bin.length; i += 2) { const n = bin.charCodeAt(i); flat.fill(bin.charCodeAt(i + 1), o, o + n); o += n; }
  const pivK = Math.round(l * 0.56), pivY = m.zWing;
  // exposure per voxel: 1 seen from above · 2 from below · 4 from the side (so hidden faces are never drawn)
  const fbin = atob(m.flg), fflat = new Uint8Array(w * l * h);
  for (let i = 0, o = 0; i < fbin.length; i += 2) { const n = fbin.charCodeAt(i); fflat.fill(fbin.charCodeAt(i + 1), o, o + n); o += n; }
  const A = [], B = [], C = [], F = [], shadow = new Uint8Array(w * l);
  let first = h, count = 0;
  for (let z = 0; z < h; z++) {
    const a = [], b = [], c = [], f = [];
    for (let k = 0; k < l; k++) for (let x = 0; x < w; x++) {
      const v = flat[(z * l + k) * w + x];
      if (!v) continue;
      a.push(x - (w - 1) / 2); b.push(pivK - k); c.push(v); f.push(fflat[(z * l + k) * w + x]); shadow[k * w + x] = 1;
    }
    if (a.length && z < first) first = z;
    count += a.length;
    A.push(Float32Array.from(a)); B.push(Float32Array.from(b)); C.push(Uint8Array.from(c)); F.push(Uint8Array.from(f));
  }
  // engines: clusters of voxels at the very tail, near the centre line
  const xs = [];
  let zy = 0, zn = 0, lastK = 0;
  for (let k = l - 1; k >= 0 && !lastK; k--) for (let x = 0; x < w; x++) if (shadow[k * w + x] && Math.abs(x - w / 2) < w * 0.22) { lastK = k; break; }
  for (let z = 0; z < h; z++) for (let k = lastK - 3; k <= lastK; k++) for (let x = 0; x < w; x++) {
    if (flat[(z * l + k) * w + x] && Math.abs(x - w / 2) < w * 0.22) { xs.push(x); zy += z; zn++; }
  }
  const ux = [...new Set(xs)].sort((p, q) => p - q), engines = [];
  for (let i = 0, s = 0; i <= ux.length; i++) {
    if (i === ux.length || (i > 0 && ux[i] - ux[i - 1] > 2)) { engines.push({ a: (ux[s] + ux[i - 1]) / 2 - (w - 1) / 2, r: Math.max(1.5, (ux[i - 1] - ux[s] + 1) / 2 * 0.8) }); s = i; }
  }
  if (engines.length > 2 || !engines.length) engines.splice(0, engines.length, { a: 0, r: 3 });
  // wingtips: the furthest-out column of the planform
  let tipA = 0, tipK = pivK;
  for (let k = 0; k < l; k++) for (let x = 0; x < w / 2; x++) if (shadow[k * w + x]) { const a = (w - 1) / 2 - x; if (a > tipA) { tipA = a; tipK = k; } break; }
  // from above, for the status screen: 0 empty, 1 body
  return { w, l, h, A, B, C, F, shadow, first, count, pivK, pivY, engines, engineY: zn ? zy / zn : pivY, nozzleK: lastK + 0.5, tipA: tipA - 1, tipK: tipK + 2, flat };
}

function makeJet(model, x, y, z, yaw) {
  return {
    model, x, y, z, yaw, yawRate: 0, roll: 0, pitch: 0, stunt: -1, stuntDir: 1, vx: 0, vy: 0, g: 0, burn: 1, boost: 0,
    trail: [new Float32Array(TRAIL_N * 4), new Float32Array(TRAIL_N * 4)], trailHead: 0, trailLen: 0, lastTrailX: x, lastTrailY: y,
    sx: 0, sy: 0, sm: 0, sv: 0, vis: false, fade: 1, intro: 99,
  };
}

function createGame() {
  // ── palettes
  const models = { player: decodeModel(JET_MODELS.player), enemy: decodeModel(JET_MODELS.enemy) };
  const jetPal = new Uint32Array(256), jetPalLit = new Uint32Array(256), jetPalDim = new Uint32Array(256);
  const topLit = new Uint32Array(NMAT), topShade = new Uint32Array(NMAT), sideLit = new Uint32Array(NMAT), sideShade = new Uint32Array(NMAT);
  const cloudTop = new Uint32Array(CK), cloudSide = new Uint32Array(CK), flamePal = new Uint32Array(6), trailPal = new Uint32Array(3), skyPal = new Uint32Array(NSKY);
  const firePal = new Uint32Array(8), smokePal = new Uint32Array(4), whitePal = new Uint32Array(4);
  let outlineCol = 0, hazeCol = 0, cloudUnder = 0, sunCol = 0, sunGlow = 0, sparkA = 0, sparkB = 0, foamCol = 0, sunX = 0.5, sunY = 0.32;
  let tod = 0;   // 0 day · 1 sunset · 2 night

  function rebuildPalettes() {
    const ja = tod === 1 ? 0.5 : tod === 2 ? 0.22 : 0;
    for (let i = 0; i < JET_PAL.length / 3; i++) {
      const c = grade([JET_PAL[i * 3], JET_PAL[i * 3 + 1], JET_PAL[i * 3 + 2]], tod, ja);
      jetPal[i + 1] = pack(c[0], c[1], c[2]);
      jetPalLit[i + 1] = pack(c[0] * 1.12 + 10, c[1] * 1.12 + 10, c[2] * 1.1 + 8);
      jetPalDim[i + 1] = pack(c[0] * 0.74, c[1] * 0.76, c[2] * 0.86);
    }
    const oc = tod === 2 ? [44, 64, 118] : grade([16, 18, 30], tod, 0.3);
    outlineCol = pack(oc[0], oc[1], oc[2]);
    for (let m = 0; m < NMAT; m++) {
      const t = grade(MAT_TOP[m], tod, 1), s = grade(MAT_SIDE[m], tod, 1);
      topLit[m] = pack(t[0], t[1], t[2]); sideLit[m] = pack(s[0], s[1], s[2]);
      topShade[m] = pack(t[0] * 0.6, t[1] * 0.66, t[2] * 0.8); sideShade[m] = pack(s[0] * 0.6, s[1] * 0.66, s[2] * 0.8);
    }
    for (let k = 0; k < CK; k++) {
      const f = k / (CK - 1), ft = Math.min(1, k / 3), ca = tod === 2 ? 0.72 : 1;
      const t = grade([222 + 33 * ft, 234 + 21 * ft, 249 + 6 * ft], tod, ca), s = grade([178 + 62 * f, 198 + 48 * f, 232 + 20 * f], tod, ca);
      cloudTop[k] = pack(t[0], t[1], t[2]); cloudSide[k] = pack(s[0], s[1], s[2]);
    }
    const sa = tod === 1 ? [255, 170, 110] : tod === 2 ? [70, 110, 190] : [130, 200, 240];
    const sb = tod === 1 ? [255, 226, 170] : tod === 2 ? [170, 200, 240] : [240, 252, 255];
    const fm = tod === 1 ? [255, 226, 214] : tod === 2 ? [110, 140, 200] : [244, 253, 255];
    sparkA = pack(sa[0], sa[1], sa[2]); sparkB = pack(sb[0], sb[1], sb[2]); foamCol = pack(fm[0], fm[1], fm[2]);
    [[255, 252, 224], [255, 224, 120], [255, 164, 44], [246, 96, 20], [176, 48, 26], [96, 34, 40]].forEach((c, i) => { flamePal[i] = pack(c[0], c[1], c[2]); });
    [[255, 255, 236], [255, 240, 150], [255, 200, 70], [255, 146, 36], [232, 84, 24], [170, 50, 30], [96, 54, 52], [60, 56, 62]].forEach((c, i) => { firePal[i] = pack(c[0], c[1], c[2]); });
    [[52, 54, 62], [84, 86, 94], [120, 122, 130], [156, 158, 166]].forEach((c, i) => { smokePal[i] = pack(...grade(c, tod, 0.6)); });
    [[255, 255, 255], [236, 242, 250], [214, 226, 242], [190, 208, 232]].forEach((c, i) => { whitePal[i] = pack(...grade(c, tod, 0.7)); });
    [[255, 255, 255], [214, 232, 250], [170, 204, 240]].forEach((c, i) => { const g = grade(c, tod, 0.8); trailPal[i] = pack(g[0], g[1], g[2]); });
    const skyA = tod === 1 ? [255, 198, 132] : tod === 2 ? [36, 56, 110] : [200, 234, 252];
    const skyM = tod === 1 ? [238, 122, 130] : tod === 2 ? [18, 28, 70] : [116, 188, 244];
    const skyB = tod === 1 ? [84, 68, 150] : tod === 2 ? [7, 10, 34] : [48, 132, 226];
    for (let i = 0; i < NSKY; i++) {
      const f = i / (NSKY - 1), a = f < 0.5 ? skyA : skyM, b = f < 0.5 ? skyM : skyB, g = f < 0.5 ? f * 2 : f * 2 - 1;
      skyPal[i] = pack(a[0] + (b[0] - a[0]) * g, a[1] + (b[1] - a[1]) * g, a[2] + (b[2] - a[2]) * g);
    }
    const hz = tod === 1 ? [250, 182, 134] : tod === 2 ? [28, 44, 92] : [190, 226, 248];
    hazeCol = pack(hz[0], hz[1], hz[2]);
    const cu = grade([134, 158, 202], tod, tod === 2 ? 0.72 : 1);
    cloudUnder = pack(cu[0], cu[1], cu[2]);
    const sc2 = tod === 2 ? [232, 238, 255] : [255, 244, 200], sg = tod === 2 ? [70, 96, 160] : [255, 222, 150];
    sunCol = pack(sc2[0], sc2[1], sc2[2]); sunGlow = pack(sg[0], sg[1], sg[2]);
    if (tod === 1) { sunX = 0.95; sunY = 0.5; } else if (tod === 2) { sunX = 0.3; sunY = 0.42; } else { sunX = 0.5; sunY = 0.32; }
  }

  // ── the world: a height and a material per ground pixel
  const heightMap = new Uint8Array(N * N), matMap = new Uint8Array(N * N), cloudN = new Uint8Array(NC * NC), nz = new Uint8Array(256 * 256);
  const hmMap = new Uint16Array(N * N);   // both packed together, for the renderer's inner loop
  // coarse summaries that fit in the CPU's first cache: the tallest ground per 16×16 block, and the
  // lowest cloud rank per 8×8 block (255 = no cloud), so most pixels never touch the big maps for those
  const hMip = new Uint8Array(128 * 128), cMip = new Uint8Array(128 * 128);
  // The renderer reads both maps along slanted lines, so its copies are stored in 8×8 tiles
  // (index = tile << 6 | y & 7 << 3 | x & 7): a scan line then stays in a few cache lines instead of one per pixel.
  const cloudT = new Uint8Array(NC * NC);
  // Far away, one pixel (and one depth step) covers many ground cells, so the look-ups would land all over the
  // maps. Each map therefore has three smaller copies (half, quarter, eighth: the tallest cell of each 2×2),
  // and distant steps read those: neighbouring look-ups stay close in memory, and far detail shimmers less.
  const HM = [hmMap, new Uint16Array((N >> 1) ** 2), new Uint16Array((N >> 2) ** 2), new Uint16Array((N >> 3) ** 2)];
  const CT = [cloudT, new Uint8Array((NC >> 1) ** 2), new Uint8Array((NC >> 2) ** 2), new Uint8Array((NC >> 3) ** 2)];
  function buildMips(maps, tiles, key) {   // tiles = tiles per row at level 0 (a power of two)
    const tix = (x, y, l) => { const tm = (tiles >> l) - 1, ts = Math.log2(tiles) - l; return (((((y >> 3) & tm) << ts) | ((x >> 3) & tm)) << 6) | ((y & 7) << 3) | (x & 7); };
    for (let l = 1; l < 4; l++) {
      const n = (tiles * 8) >> l, src = maps[l - 1], dst = maps[l];
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        let best = 0;
        for (let c = 0; c < 4; c++) { const v = src[tix(x * 2 + (c & 1), y * 2 + (c >> 1), l - 1)]; if (c === 0 || (v & key) > (best & key)) best = v; }
        dst[tix(x, y, l)] = best;
      }
    }
  }
  let spawnX = N / 2, spawnY = N / 2;

  function buildWorld() {
    const rnd = mulberry32((P.seed | 0) * 7919 + 13);
    for (let i = 0; i < nz.length; i++) nz[i] = (rnd() * 256) | 0;
    const E = new Float32Array(N * N);
    addOctave(E, N, 512, 0.55, rnd); addOctave(E, N, 256, 1, rnd); addOctave(E, N, 128, 0.5, rnd);
    addOctave(E, N, 64, 0.25, rnd); addOctave(E, N, 32, 0.11, rnd); addOctave(E, N, 16, 0.05, rnd);
    normalise(E);
    // a second field: where it is high the coast is a cliff and the shallows hold a reef
    const Cf = new Float32Array(N * N);
    addOctave(Cf, N, 256, 1, rnd); addOctave(Cf, N, 64, 0.5, rnd); addOctave(Cf, N, 16, 0.2, rnd);
    normalise(Cf);
    // sea level from the wanted share of land
    const bins = new Uint32Array(1024);
    for (let o = 0; o < E.length; o++) bins[(E[o] * 1023) | 0]++;
    let acc = 0, sea = 1;
    const target = (1 - P.land) * E.length;
    for (let b = 0; b < 1024; b++) { acc += bins[b]; if (acc >= target) { sea = (b + 1) / 1023; break; } }
    const SAND = 0.013, span = Math.max(0.05, 1 - sea - SAND);
    for (let y = 0; y < N; y++) {
      const row = y << NSH, rowNW = ((y - 2) & NM) << NSH, rowSE = ((y + 2) & NM) << NSH;
      for (let x = 0; x < N; x++) {
        const o = row | x, e = E[o], hs = hash8(o), d = e - sea, cf = Cf[o];
        const cliff = clamp((cf - 0.56) * 26, 0, 1);            // 0 beach … 1 sheer cliff
        if (d < 0) {
          const dd = -d + (hs - 128) * 0.00004;
          let m = dd > 0.075 ? M_DEEP : dd > 0.036 ? M_MID : dd > 0.014 ? M_SHALLOW : dd > 0.0045 ? M_LAGOON : M_SURF;
          if (m <= M_MID) {       // long swells: lighter streaks lying across the open sea
            const w = Cf[(((y * 6 + x) & NM) << NSH) | ((x * 2 - y) & NM)];
            if (w > 0.56 || (w > 0.5 && ((x + y) & 1))) m++;
          } else if (m !== M_SURF && cf < 0.4) {  // reef patches in calm shallows
            const r = Cf[(((y * 5) & NM) << NSH) | ((x * 5) & NM)];
            if (r > 0.6) m = hs < 60 ? M_REEF2 : M_REEF;
          }
          matMap[o] = m; heightMap[o] = 0;
          continue;
        }
        const sand = SAND * (1 - cliff);
        if (d < sand) {
          matMap[o] = d < sand * 0.3 ? M_WET : hs < 30 ? M_SPECK : M_SAND; heightMap[o] = 0;
          continue;
        }
        const hr = (d - sand) / span;
        // terraces: 8 grass levels (2 px each), 4 rock levels and the peak (4 px each); cliffs lift the whole shore
        let lv = hr < 0.5 ? 1 + ((hr * 16) | 0) : hr < 0.78 ? 9 + (((hr - 0.5) / 0.07) | 0) : 13 + (((hr - 0.78) / 0.09) | 0);
        if (lv > 15) lv = 15;
        heightMap[o] = (lv <= 8 ? lv * 2 : 16 + (lv - 8) * 4) + ((cliff * 9 * Math.min(1, hr * 9 + 0.2)) | 0);   // (islets stay low)
        const g = E[rowNW | ((x - 2) & NM)] - E[rowSE | ((x + 2) & NM)];
        const lit = g < -0.006, shaded = g > 0.006;
        if (lv >= 13) matMap[o] = shaded ? M_PEAKD : M_PEAK;
        else if (lv >= 9) matMap[o] = lit ? M_ROCKL : shaded ? M_ROCKD : hs < 30 ? M_ROCKD : hs > 236 ? M_ROCKL : M_ROCK;
        else if (cliff > 0.3) matMap[o] = shaded || (hs & 3) === 0 ? M_CGRASSD : M_CGRASS;
        else {
          // meadows in patches of three greens, with the slopes lit and shaded
          const pt = Cf[(((y * 3) & NM) << NSH) | ((x * 3 + 700) & NM)], base = pt > 0.6 ? M_GRASS2 : pt < 0.4 ? M_GRASS3 : M_GRASS;
          matMap[o] = lit ? M_GRASSL : shaded ? M_GRASSD : hs < 20 ? M_GRASSD : hs > 240 ? M_GRASSL : hs === 100 ? M_FLOWR : hs === 101 ? M_FLOWY : base;
        }
      }
    }
    const at = (x, y) => ((y & NM) << NSH) | (x & NM);
    const raise = (x, y, h, m) => { const o = at(x, y); if (h > heightMap[o]) { heightMap[o] = h; matMap[o] = m; } };
    const isGrass = m => (m >= M_GRASS && m <= M_CGRASSD) || m === M_FLOWR || m === M_FLOWY;
    // forests: domes of leaves, lit from the upper left
    for (let gy = 0; gy < N; gy += 6) for (let gx = 0; gx < N; gx += 6) {
      const hs = hash8(gy * 977 + gx * 131 + 7), cx = gx + (hs & 3), cy = gy + ((hs >> 2) & 3), o = at(cx, cy), m = matMap[o];
      if (!isGrass(m)) continue;
      const h0 = heightMap[o];
      if (h0 > 22) continue;
      const f = E[at(N - 1 - cx + 911, cy + 613)], pr = (f - sea) * 30;
      if (pr <= 0 || pr * 255 < hash8(o + 99)) continue;
      const r = 3 + ((hs >> 4) & 1) + ((hs >> 5) & 1);
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > r + 0.3 || matMap[at(cx + dx, cy + dy)] < M_WET) continue;
        const nh = h0 + 2 + Math.round((1 - dist / (r + 0.5)) * (r + 2));
        raise(cx + dx, cy + dy, nh, dist > r - 0.7 ? M_TREED : dx + dy < -1 ? M_TREEL : dx + dy > 2 ? M_TREED : M_TREE);
      }
    }
    // palms on the beaches and low grass, boulders along the waterline
    for (let gy = 0; gy < N; gy += 9) for (let gx = 0; gx < N; gx += 9) {
      const hs = hash8(gy * 613 + gx * 271 + 3), cx = gx + (hs & 7), cy = gy + ((hs >> 3) & 7), o = at(cx, cy), m = matMap[o], h0 = heightMap[o];
      if ((m === M_SAND || m === M_SPECK || (isGrass(m) && h0 <= 6)) && hash8(o + 5) < 70) {
        const top = h0 + 5 + (hs & 3);
        raise(cx, cy, top, M_TRUNK);
        for (let a = 0; a < 7; a++) {
          const an = a * 0.9 + hs * 0.1, len = 4 + (hash8(o + a) & 1);
          for (let t = 1; t <= len; t++) raise(Math.round(cx + Math.cos(an) * t), Math.round(cy + Math.sin(an) * t), top + (t < 3 ? 1 : t < 4 ? 0 : -1), t === len || (a & 1) ? M_FROND : M_FRONDL);
        }
        raise(cx, cy, top + 1, M_FRONDL);
      } else if ((m === M_SURF || m === M_LAGOON || m === M_WET) && hash8(o + 11) < 26) {
        const r = 2 + (hs & 1);
        for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist <= r + 0.2) raise(cx + dx, cy + dy, 1 + Math.round((1 - dist / (r + 0.5)) * (r + 1)), dx + dy < 0 ? M_BOULDL : M_BOULD);
        }
      }
    }
    // fishing villages: a pier out over the water with a couple of thatched huts behind it
    for (let gy = 32; gy < N; gy += 160) for (let gx = 32; gx < N; gx += 160) {
      let found = -1;
      for (let t = 0; t < 40 && found < 0; t++) {
        const x = gx + (hash8(gx * 7 + gy * 13 + t) % 80), y = gy + (hash8(gx * 3 + gy * 5 + t + 50) % 80);
        if (matMap[at(x, y)] === M_SAND && Cf[at(x, y)] < 0.5) found = at(x, y);
      }
      if (found < 0) continue;
      const px = found & NM, py = found >> NSH;
      let dx = E[at(px - 6, py)] - E[at(px + 6, py)], dy = E[at(px, py - 6)] - E[at(px, py + 6)];   // downhill = out to sea
      const dl = Math.hypot(dx, dy) || 1;
      dx /= dl; dy /= dl;
      for (let t = -2; t < 34; t++) {
        const cx = px + dx * t, cy = py + dy * t;
        if (t > 6 && matMap[at(Math.round(cx), Math.round(cy))] < M_SHALLOW) break;
        for (let s = -1; s <= 1; s++) raise(Math.round(cx - dy * s), Math.round(cy + dx * s), 2, (t & 3) === 0 ? M_WOODD : M_WOOD);
        if ((t & 7) === 3) for (const s of [-2, 2]) raise(Math.round(cx - dy * s), Math.round(cy + dx * s), 3, M_WOODD);
      }
      for (let hN = 0; hN < 2; hN++) {
        const bx = Math.round(px - dx * (9 + hN * 3) - dy * (hN ? 9 : -8)), by = Math.round(py - dy * (9 + hN * 3) + dx * (hN ? 9 : -8));
        const base = heightMap[at(bx, by)];
        if (matMap[at(bx, by)] < M_WET) continue;
        for (let yy = -3; yy <= 3; yy++) for (let xx = -4; xx <= 4; xx++) {
          const edge = Math.max(Math.abs(xx) - 1, Math.abs(yy));           // a hipped roof
          raise(bx + xx, by + yy, base + 4 + (3 - Math.min(3, edge)), edge === 3 ? M_WOOD : (xx + yy) & 1 || xx + yy < 0 ? M_THATCHL : M_THATCH);
        }
      }
    }
    // a start over open water next to land
    let best = -1;
    for (let tries = 0; tries < 400; tries++) {
      const x = (rnd() * N) | 0, y = (rnd() * N) | 0;
      if (matMap[at(x, y)] > M_SHALLOW) continue;
      let near = 0;
      for (let a = 0; a < 8; a++) if (matMap[at(Math.round(x + Math.cos(a * 0.785) * 130), Math.round(y + Math.sin(a * 0.785) * 130))] >= NWATER) near++;
      if (near > best && near <= 5) { best = near; spawnX = x; spawnY = y; }
    }
    hMip.fill(0);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const o = (y << NSH) | x, b = ((y >> 4) << 7) | (x >> 4);
      hmMap[((((y >> 3) << 8) | (x >> 3)) << 6) | ((y & 7) << 3) | (x & 7)] = heightMap[o] | (matMap[o] << 8);
      if (heightMap[o] > hMip[b]) hMip[b] = heightMap[o];
    }
    // clouds: clusters of round puffs. Each cell holds (rank << 4) | thickness.
    cloudN.fill(0);
    for (let i = 0; i < 150; i++) {
      const rank = i & 15, cx = rnd() * NC, cy = rnd() * NC, sc = 0.8 + rnd() * rnd() * 1.5, ang = 0.35 + (rnd() - 0.5) * 1.3;
      const len = (14 + rnd() * 26) * sc, puffs = 4 + ((rnd() * 7) | 0);
      for (let q = 0; q < puffs; q++) {
        const t = (q / (puffs - 1)) * 2 - 1;
        const pxc = cx + Math.cos(ang) * t * len + (rnd() - 0.5) * 10 * sc, pyc = cy + Math.sin(ang) * t * len + (rnd() - 0.5) * 10 * sc;
        const r = (7 + rnd() * 10) * sc * (1 - 0.45 * Math.abs(t)), maxT = clamp(Math.round(r * 0.62), 2, CK), ri = Math.ceil(r);
        for (let dy = -ri; dy <= ri; dy++) for (let dx = -ri; dx <= ri; dx++) {
          const d2 = (dx * dx + dy * dy) / (r * r);
          if (d2 > 1) continue;
          const tk = Math.max(1, Math.round(Math.sqrt(1 - d2) * maxT));
          const oo = (((Math.round(pyc) + dy) & NCM) << NCSH) | ((Math.round(pxc) + dx) & NCM);
          if (tk > (cloudN[oo] & 15)) cloudN[oo] = (rank << 4) | tk;
        }
      }
    }
    buildMips(HM, 256, 255);
    cMip.fill(255);
    for (let y = 0; y < NC; y++) for (let x = 0; x < NC; x++) {
      const cv = cloudN[(y << NCSH) | x], b = ((y >> 3) << 7) | (x >> 3);
      cloudT[(b << 6) | ((y & 7) << 3) | (x & 7)] = cv;
      if (cv !== 0 && cv >> 4 < cMip[b]) cMip[b] = cv >> 4;
    }
    buildMips(CT, 128, 15);
  }

  // ── state
  let W = 0, H = 0, fb = new Uint32Array(0), bytes = new Uint8ClampedArray(0), jetMask = new Uint8Array(0);
  let colY = new Int32Array(0), cloudY = new Int32Array(0), zbuf = new Float32Array(0), backdrop = new Uint32Array(0);
  let sheetSide = 0, sheet = new Uint32Array(0), sheetMask = new Uint8Array(0), sheetColY = new Int32Array(0), sheetZ = new Float32Array(0), sheetBackdrop = new Uint32Array(0);
  let pivotY = 0, cockpit = null, colLo = 0, colHi = 0, rowLo = 0, rowHi = 0, frameH = 0;
  let time = 0, holding = false, pointerOn = false, pointerX = 0, pointerY = 0, boostKey = false, keyTurn = 0, keyClimb = 0, keyMode = false;
  let altGoal = P.altitude, climbV = 0, climbTilt = 0, floorS = 0, speedNow = P.speed, boost = 0;
  const cam = { x: 0, y: 0, yaw: 0, alt: P.altitude }, follow = { x: 0, y: 0, alt: P.altitude };
  let viewTarget = 0;
  // calm camera: for anyone the moving view makes queasy. The overhead camera stops turning with the jet, the chase
  // camera stops leaning and zooming, the cockpit stops swaying and banks far less, and hits no longer shake the frame.
  let calm = false;
  const wChase = [0, 0, 0], wCock = [0, 0, 0];
  let vC = 0, vK = 0, jetFade = 1, camSpin = 0, chaseYaw = 0, yawDiff = 0, vQ = 0, vTan = 1, vS = 1, vCx = 0, vCy = 0, vCos = 1, vSin = 0, vYaw = 0;
  let vRoll = 0, vSteerY = 0, vLean = 1, camFix = 0, camFloor = 0, headX = 0, headY = 0, headVX = 0, headVY = 0, topZoom = 1;
  let lead = null;
  const enemies = [], bullets = [], missiles = [], puffs = [], sparks = [], respawns = [];
  const prof = { world: 0, sky: 0, jets: 0, rest: 0, n: 0 };
  const cb = { hp: 100, kills: 0, msl: 4, mslT: 0, gunT: 0, lock: null, lockT: 0, dead: 0, inv: 2, hit: 0, shake: 0, gunSide: 1, firing: false };

  const groundAt = (x, y) => heightMap[(((y | 0) & NM) << NSH) | ((x | 0) & NM)];
  const matAt = (x, y) => matMap[(((y | 0) & NM) << NSH) | ((x | 0) & NM)];
  function groundAhead(j, speed) {
    const sn = Math.sin(j.yaw), cs = Math.cos(j.yaw);
    let top = 0;
    for (let i = 0; i <= 4; i++) {
      const d = speed * 0.16 * i;
      for (let side = -1; side <= 1; side++) { const h = groundAt(j.x + sn * d + cs * side * 9, j.y - cs * d + sn * side * 9); if (h > top) top = h; }
    }
    return top;
  }
  function spinOf(j) {
    if (j.stunt < 0) return 0;
    const t = j.stunt;
    return j.stuntDir * Math.PI * 2 * (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
  }
  const rollOf = j => j.roll + spinOf(j) + (j.spin || 0);
  // a jet's own axes in the world (x right, y down the map, z up)
  function axes(j) {
    const cs = Math.cos(j.yaw), sn = Math.sin(j.yaw), roll = rollOf(j), cr = Math.cos(roll), sr = Math.sin(roll);
    const rx = cs * cr, ry = sn * cr, rz = -sr, u2x = cs * sr, u2y = sn * sr, u2z = cr, cp = Math.cos(j.pitch), sp = Math.sin(j.pitch);
    return { rx, ry, rz, fx: sn * cp + u2x * sp, fy: -cs * cp + u2y * sp, fz: u2z * sp, ux: u2x * cp - sn * sp, uy: u2y * cp + cs * sp, uz: u2z * cp, cr };
  }
  // a point given in model voxels (across, along from the nose, slice) → world
  function modelPoint(j, ax, a, k, y, out) {
    const m = j.model, b = (m.pivK - k) * JET_SC, hy = (y - m.pivY) * JET_SC;
    a *= JET_SC;
    out[0] = j.x + a * ax.rx + b * ax.fx + hy * ax.ux; out[1] = j.y + a * ax.ry + b * ax.fy + hy * ax.uy; out[2] = j.z + a * ax.rz + b * ax.fz + hy * ax.uz;
    return out;
  }
  const tmp3 = [0, 0, 0];

  function resetFlight() {
    const yaw = 0.9;
    lead = makeJet(models.player, spawnX, spawnY, P.altitude, yaw);
    lead.intro = 0; lead.burn = 0;
    cam.x = follow.x = spawnX; cam.y = follow.y = spawnY; cam.yaw = -yaw * P.cameraFollow; cam.alt = follow.alt = P.altitude;
    chaseYaw = -yaw; yawDiff = wrapAngle(chaseYaw - cam.yaw); altGoal = P.altitude;
  }

  function resize(w, h) {
    W = w; H = h;
    const buf = new ArrayBuffer(W * H * 4);
    fb = new Uint32Array(buf); bytes = new Uint8ClampedArray(buf);
    jetMask = new Uint8Array(W * H); colY = new Int32Array(W); zbuf = new Float32Array(W * H); backdrop = new Uint32Array(W * H);
    pivotY = Math.round(H * 0.34);
    const tall = Math.max(pivotY, H - pivotY);
    sheetSide = (Math.ceil(Math.sqrt((W / 2) * (W / 2) + tall * tall)) + 2) * 2;
    sheet = new Uint32Array(sheetSide * sheetSide); sheetMask = new Uint8Array(sheetSide * sheetSide); sheetColY = new Int32Array(sheetSide);
    sheetZ = new Float32Array(sheetSide * sheetSide); sheetBackdrop = new Uint32Array(sheetSide * sheetSide);
    cloudY = new Int32Array(sheetSide);   // (long enough for the frame and the sheet)
    HF = [0, 1, 2].map(() => new Uint32Array(W * H)); HFZ = [0, 1, 2].map(() => new Float32Array(W * H));
    HS = [0, 1, 2].map(() => new Uint32Array(sheetSide * sheetSide)); HSZ = [0, 1, 2].map(() => new Float32Array(sheetSide * sheetSide));
    const nb = ((sheetSide >> 3) + 2) ** 2;
    mvX = new Int16Array(nb); mvY = new Int16Array(nb); mvD = new Float32Array(nb); mvX2 = new Int16Array(nb); mvY2 = new Int16Array(nb); mvD2 = new Float32Array(nb); hKind = 0;
    cockpit = null;
    updateView();
  }

  const cockpitIn = () => { const u = clamp((vK - 0.16) / 0.84, 0, 1); return u * u * u * (u * (u * 6 - 15) + 10); };

  function updateView() {
    const sc = JET_SC, top = 1 - vC - vK, shk = cb.shake > 0 && !calm ? cb.shake * 6 : 0, bz = calm ? 0 : boost;
    vCx = (W >> 1) + (Math.random() - 0.5) * shk;
    cam.x = follow.x; cam.y = follow.y; cam.alt = follow.alt;
    // overhead, the camera pulls back as the jet climbs: the islands shrink under it
    topZoom = clamp(1.36 - (follow.alt / P.ceiling) * 0.62, 0.72, 1.4) * (H / 360);
    if ((vC === 0 && vK === 0) || !lead) {
      vQ = 0; vTan = 1; vLean = 1; vS = topZoom; vCy = (H >> 1) + (Math.random() - 0.5) * shk; vSteerY = vCy; vRoll = 0; jetFade = 1; vYaw = cam.yaw;
    } else {
      // each view is a camera pose; the frame shows a blend of the three
      const m = lead.model, dist = P.chaseDistance * m.l * sc * (1 - 0.16 * bz), zoom = Math.max(1, (P.chaseSize * W) / (m.w * sc));
      const focalIn = W * 0.6 * (1 - 0.1 * bz), ahead = COCKPIT_LOOK * vK, sn = Math.sin(lead.yaw), cs = Math.cos(lead.yaw);
      cam.x += (lead.x + sn * ahead - follow.x) * vK; cam.y += (lead.y - cs * ahead - follow.y) * vK; cam.alt += (lead.z + COCKPIT_EYE * sc - follow.alt) * vK;
      vQ = vC / dist + vK / COCKPIT_LOOK;
      vS = Math.exp(top * Math.log(topZoom) + vC * Math.log(zoom) + vK * Math.log(focalIn / COCKPIT_LOOK));
      const angle = (45 * top + P.chaseAngle * vC) * (Math.PI / 180);
      vLean = Math.tan(angle) - (calm ? 0 : 0.5 * climbTilt * vC);
      const free = 1 - vK;
      vTan = Math.max(vLean + camFix * vQ * free, (camFloor - cam.alt) * vQ * free, (2 - cam.alt) * vQ);
      const focal = vS / vQ, cyChase = (H >> 1) + H * (0.16 - 0.03 * bz), cyIn = pivotY + focal * Math.tan(clamp(lead.pitch * 0.8, -0.6, 0.6));
      vCy = top * (H >> 1) + vC * cyChase + vK * cyIn + (Math.random() - 0.5) * shk;
      vSteerY = top * (H >> 1) + vC * (H * 0.45) + vK * H * 0.34;
      vRoll = calm ? lead.roll * vK * 0.35 : lead.roll * vK + spinOf(lead) * camSpin;
      const behind = cam.yaw + yawDiff;
      vYaw = cam.yaw + yawDiff * (vC + vK) + wrapAngle(-lead.yaw - behind) * vK;
      const f = clamp((vK - 0.12) / 0.4, 0, 1);
      jetFade = 1 - f * f * (3 - 2 * f);
    }
    vCos = Math.cos(vYaw); vSin = Math.sin(vYaw);
  }

  // ── projection
  let prX = 0, prY = 0, prM = 0, prV = 0;
  function project(x, y, z) {
    const dx = x - cam.x, dy = y - cam.y, depth = -(dx * vSin + dy * vCos), den = 1 + vQ * depth;
    if (den < 0.12) return false;
    prV = depth; prM = vS / den;
    prX = vCx + prM * (dx * vCos - dy * vSin);
    prY = vCy - prM * (z - cam.alt + vTan * depth);
    return true;
  }

  // ── effects
  // kind: 0 dark smoke · 1 white vapour · 2 fire (ages through the fire palette into smoke)
  let puffK = 1;   // explode() shrinks its puffs with this
  function puff(kind, x, y, z, vx, vy, vz, size, grow, life, strength, delay = 0) {
    if (puffs.length > 420) puffs.shift();
    vx *= puffK; vy *= puffK; vz *= puffK; size *= puffK; grow *= puffK;
    puffs.push({ kind, x, y, z, vx, vy, vz, size, grow, life, born: time + delay, strength, seed: (Math.random() * 16) | 0 });
  }
  function spark(x, y, z, vx, vy, vz, life, col, g) {
    if (sparks.length > 500) sparks.shift();
    sparks.push({ x, y, z, vx, vy, vz, life, born: time, col, g });
  }
  function explode(x, y, z, big) {
    puffK = 0.6;
    const rnd = Math.random;
    if (big) {
      // a white flash, a knot of fireballs, more thrown outwards a beat later, then dark smoke rolling up
      puff(2, x, y, z, 0, 0, 0, 13, 5, 0.2, 1);
      for (let i = 0; i < 6; i++) { const a = rnd() * 6.283, d = rnd() * 7; puff(2, x + Math.cos(a) * d, y + Math.sin(a) * d, z + (rnd() - 0.5) * 6, Math.cos(a) * 8, Math.sin(a) * 8, 5, 6 + rnd() * 3, 9, 0.5 + rnd() * 0.35, 1, rnd() * 0.07); }
      for (let i = 0; i < 9; i++) { const a = rnd() * 6.283, sp = 26 + rnd() * 44; puff(2, x, y, z, Math.cos(a) * sp, Math.sin(a) * sp, (rnd() - 0.3) * sp * 0.6 + 6, 3 + rnd() * 2.5, 7, 0.55 + rnd() * 0.6, 1, 0.03 + rnd() * 0.16); }
      for (let i = 0; i < 9; i++) { const a = rnd() * 6.283, sp = 8 + rnd() * 20; puff(0, x, y, z, Math.cos(a) * sp, Math.sin(a) * sp, 9 + rnd() * 12, 5 + rnd() * 4, 15, 1.4 + rnd() * 1.2, 0.85, 0.22 + rnd() * 0.3); }
    } else {
      for (let i = 0; i < 3; i++) { const a = rnd() * 6.283, sp = rnd() * 16; puff(2, x, y, z, Math.cos(a) * sp, Math.sin(a) * sp, 4, 2 + rnd() * 2, 3.5, 0.25 + rnd() * 0.25, 1); }
      puff(0, x, y, z, 0, 0, 6, 2.5, 6, 0.8, 0.6, 0.15);
    }
    for (let i = 0; i < (big ? 46 : 10); i++) {
      const a = Math.random() * 6.283, e = Math.random() * 1.4 - 0.4, sp = 40 + Math.random() * (big ? 150 : 70);
      spark(x, y, z, Math.cos(a) * sp, Math.sin(a) * sp, e * sp * 0.6, 0.4 + Math.random() * 0.9, i & 1 ? firePal[1] : firePal[3], 90);
    }
    if (big) cb.shake = Math.max(cb.shake, clamp(1 - Math.hypot(x - lead.x, y - lead.y) / 400, 0, 1) * 0.5);
    puffK = 1;
  }
  function splash(x, y, big) {
    for (let i = 0; i < (big ? 40 : 3); i++) {
      const a = Math.random() * 6.283, sp = Math.random() * (big ? 46 : 16);
      spark(x, y, 0.5, Math.cos(a) * sp, Math.sin(a) * sp, 16 + Math.random() * (big ? 80 : 26), 0.4 + Math.random() * 0.6, i & 1 ? whitePal[0] : whitePal[2], 110);
    }
    if (big) for (let i = 0; i < 8; i++) { const a = Math.random() * 6.283; puff(1, x + Math.cos(a) * 6, y + Math.sin(a) * 6, 2, Math.cos(a) * 10, Math.sin(a) * 10, 14, 4, 10, 0.9, 0.8); }
  }

  // ── combat
  const BUL_SPD = 600, BUL_LIFE = 0.85, HIT_R = 7, HIT_DZ = 9, LOCK_RANGE = 560, LOCK_CONE = 0.42, LOCK_TIME = 0.8;
  function spawnEnemy() {
    const a = Math.random() * 6.283, r = 520 + Math.random() * 220;
    const e = makeJet(models.enemy, lead.x + Math.cos(a) * r, lead.y + Math.sin(a) * r, clamp(lead.z + (Math.random() - 0.5) * 60, 30, 220), Math.random() * 6.283);
    Object.assign(e, { hp: 8, gunT: 1 + Math.random() * 2, burst: 0, bT: 0, dying: 0, spin: 0, smokeT: 0, mode: 'chase', modeT: 3 + Math.random() * 4, ofs: (Math.random() - 0.5) * 50, spd: 82 + Math.random() * 14, enemy: true });
    enemies.push(e);
  }
  function fireMissile() {
    if (cb.dead || cb.msl <= 0 || !cb.lock || cb.lockT < LOCK_TIME || lead.intro < 2) return;
    cb.msl--;
    const ax = axes(lead), side = cb.msl & 1 ? 1 : -1;
    modelPoint(lead, ax, side * lead.model.w * 0.3, lead.model.pivK, lead.model.pivY - 2, tmp3);
    missiles.push({ x: tmp3[0], y: tmp3[1], z: tmp3[2], yaw: lead.yaw, spd: speedNow + 60, tgt: cb.lock, life: 5, smokeT: 0 });
  }
  function hurtPlayer(n) {
    if (cb.dead || cb.inv > 0) return;
    cb.hp -= n; cb.hit = 1; cb.shake = Math.max(cb.shake, 0.35);
    if (cb.hp <= 0) { cb.hp = 0; cb.dead = 3; explode(lead.x, lead.y, lead.z, true); explode(lead.x + 6, lead.y - 4, lead.z + 3, true); }
  }
  function killEnemy(e) {
    if (e.dying) return;
    e.dying = 0.001; cb.kills++;
    explode(e.x, e.y, e.z, true);
    if (cb.lock === e) { cb.lock = null; cb.lockT = 0; }
  }
  function updateCombat(dt) {
    cb.hit = Math.max(0, cb.hit - dt * 3); cb.shake = Math.max(0, cb.shake - dt); cb.inv = Math.max(0, cb.inv - dt);
    if (cb.msl < 4 && (cb.mslT += dt) > 5) { cb.msl++; cb.mslT = 0; }
    const lax = axes(lead);
    cb.firing = false;
    if (cb.dead) {
      if ((cb.dead -= dt) <= 0) { cb.dead = 0; cb.hp = 100; cb.inv = 3; lead.intro = 0; lead.burn = 0; lead.trailLen = 0; }
    } else if (holding && lead.intro > 2) {
      cb.firing = true;
      if ((cb.gunT -= dt) <= 0) {   // twin guns in the wing roots; rounds lean towards the locked target's height
        cb.gunT = 0.066; cb.gunSide = -cb.gunSide;
        modelPoint(lead, lax, cb.gunSide * 6, lead.model.pivK - 26, lead.model.pivY + 1, tmp3);
        let vz = lax.fz * BUL_SPD;
        const t = cb.lock;
        if (t) { const d = Math.hypot(t.x - lead.x, t.y - lead.y); vz = clamp((t.z - tmp3[2]) / Math.max(0.08, d / BUL_SPD), -160, 160); }
        bullets.push({ x: tmp3[0], y: tmp3[1], z: tmp3[2], vx: lax.fx * BUL_SPD + lead.vx, vy: lax.fy * BUL_SPD + lead.vy, vz, life: BUL_LIFE, own: true });
        spark(tmp3[0], tmp3[1], tmp3[2], lead.vx, lead.vy, 0, 0.05, firePal[0], 0);
      }
    }
    for (let i = respawns.length - 1; i >= 0; i--) if ((respawns[i] -= dt) <= 0) { respawns.splice(i, 1); spawnEnemy(); }
    // lock-on: the nearest enemy inside the nose cone
    let best = null, bd = 1e9;
    const pfx = Math.sin(lead.yaw), pfy = -Math.cos(lead.yaw);
    for (const e of enemies) {
      if (e.dying) continue;
      const dx = e.x - lead.x, dy = e.y - lead.y, d = Math.hypot(dx, dy, e.z - lead.z);
      if (d < LOCK_RANGE && (dx * pfx + dy * pfy) / (Math.hypot(dx, dy) || 1) > Math.cos(LOCK_CONE) && d < bd) { bd = d; best = e; }
    }
    if (cb.dead) best = null;
    if (best !== cb.lock) { cb.lock = best; cb.lockT = 0; } else if (best) cb.lockT += dt;
    // enemies
    for (let i = enemies.length - 1; i >= 0; i--) {
      const e = enemies[i], dx = lead.x - e.x, dy = lead.y - e.y, dist = Math.hypot(dx, dy);
      if (e.dying) {   // it spirals down trailing smoke and blows up where it lands
        e.dying += dt; e.z -= (14 + e.dying * 30) * dt; e.spin += dt * 7; e.yaw += dt * 0.9; e.pitch = Math.max(-0.7, e.pitch - dt * 0.4);
        e.x += Math.sin(e.yaw) * e.spd * dt; e.y -= Math.cos(e.yaw) * e.spd * dt;
        if ((e.smokeT -= dt) < 0) { e.smokeT = 0.035; puff(0, e.x, e.y, e.z, 0, 0, 5, 3, 9, 1.6, 0.9); if (Math.random() < 0.5) puff(2, e.x, e.y, e.z, 0, 0, 4, 2, 3, 0.35, 1); }
        const g = groundAt(e.x, e.y);
        if (e.z <= g + 1) {
          if (matAt(e.x, e.y) < NWATER) splash(e.x, e.y, true);
          explode(e.x, e.y, g + 2, true);
          enemies.splice(i, 1); respawns.push(2.5);
        }
        continue;
      }
      if (dist > 1300) { enemies.splice(i, 1); spawnEnemy(); continue; }
      if ((e.modeT -= dt) < 0) {
        e.mode = e.mode === 'chase' && dist < 260 ? 'break' : 'chase';
        e.modeT = e.mode === 'chase' ? 5 + Math.random() * 4 : 1.6 + Math.random() * 1.6;
      }
      let tgt;
      if (cb.dead || e.mode === 'break') tgt = e.yaw + (e.ofs > 0 ? 1 : -1);
      else { const leadT = dist / 420; tgt = Math.atan2(dx + lead.vx * leadT, -(dy + lead.vy * leadT)); }   // aim ahead of the player
      const want = clamp(wrapAngle(tgt - e.yaw) * 2, -1.15, 1.15);
      e.yawRate += (want - e.yawRate) * ease(dt, 3);
      e.yaw = wrapAngle(e.yaw + e.yawRate * dt);
      e.roll += (clamp(e.yawRate / 1.15, -1, 1) * 0.95 - e.roll) * ease(dt, 4);
      const floor = groundAhead(e, e.spd) + 12, zGoal = Math.max(floor, clamp(lead.z + (dist > 240 ? e.ofs : 0), 14, P.ceiling));
      const dz = clamp((zGoal - e.z) * ease(dt, 2), -45 * dt, 45 * dt);
      e.z += dz; e.pitch += (clamp(dz / Math.max(dt, 1e-4) / e.spd, -0.5, 0.5) - e.pitch) * ease(dt, 4);
      e.vx = Math.sin(e.yaw) * e.spd; e.vy = -Math.cos(e.yaw) * e.spd;
      e.x += e.vx * dt; e.y += e.vy * dt;
      e.g += (clamp(Math.abs(e.yawRate) / 1.15, 0, 1) - e.g) * ease(dt, 2.5);
      if (e.hp <= 4 && (e.smokeT -= dt) < 0) { e.smokeT = 0.07; puff(0, e.x, e.y, e.z, 0, 0, 3, 2.4, 7, 1.1, 0.55); }
      // short bursts when the player sits in front of the nose, close in height
      const fx = Math.sin(e.yaw), fy = -Math.cos(e.yaw), aim = (dx * fx + dy * fy) / (dist || 1);
      if (!cb.dead && lead.intro > 2 && e.mode === 'chase' && dist < 330 && aim > 0.985 && Math.abs(e.z - lead.z) < HIT_DZ + 6) {
        if ((e.gunT -= dt) < 0) { e.burst = 6; e.gunT = 1.6 + Math.random() * 1.6; }
      }
      if (e.burst > 0 && (e.bT -= dt) < 0) {
        e.burst--; e.bT = 0.09;
        const s = BUL_SPD * 0.68;
        bullets.push({ x: e.x + fx * 30 * JS, y: e.y + fy * 30 * JS, z: e.z, vx: fx * s + e.vx, vy: fy * s + e.vy, vz: (lead.z - e.z) / Math.max(0.1, dist / s), life: BUL_LIFE, own: false });
      }
    }
    // rounds: a swept hit test so fast rounds do not tunnel through
    for (let i = bullets.length - 1; i >= 0; i--) {
      const b = bullets[i], nx = b.x + b.vx * dt, ny = b.y + b.vy * dt, nzz = b.z + b.vz * dt;
      b.life -= dt;
      let hit = false;
      const test = t => {
        if (Math.abs(t.z - (b.z + nzz) / 2) > HIT_DZ) return false;
        const ax = t.x - b.x, ay = t.y - b.y, sx = nx - b.x, sy = ny - b.y, u = clamp((ax * sx + ay * sy) / (sx * sx + sy * sy), 0, 1);
        return Math.hypot(ax - sx * u, ay - sy * u) < HIT_R;
      };
      if (b.own) {
        for (const e of enemies) if (!e.dying && test(e)) { hit = true; explode(nx, ny, nzz, false); if (--e.hp <= 0) killEnemy(e); break; }
      } else if (!cb.dead && test(lead)) { hit = true; hurtPlayer(3); explode(nx, ny, nzz, false); }
      b.x = nx; b.y = ny; b.z = nzz;
      const g = groundAt(nx, ny);
      if (!hit && nzz <= g) { hit = true; if (matAt(nx, ny) < NWATER) splash(nx, ny, false); else spark(nx, ny, g + 1, 0, 0, 20, 0.25, whitePal[1], 60); }
      if (hit || b.life <= 0) bullets.splice(i, 1);
    }
    // missiles: they steer for the target and leave a white trail
    for (let i = missiles.length - 1; i >= 0; i--) {
      const m = missiles[i], t = m.tgt;
      m.life -= dt; m.spd = Math.min(330, m.spd + 240 * dt);
      if (t && !t.dying) {
        const dx = t.x - m.x, dy = t.y - m.y;
        m.yaw = wrapAngle(m.yaw + clamp(wrapAngle(Math.atan2(dx, -dy) - m.yaw) * 6, -3.2, 3.2) * dt);
        m.z += clamp(t.z - m.z, -80 * dt, 80 * dt);
        if (Math.hypot(dx, dy, t.z - m.z) < 9) { t.hp = 0; killEnemy(t); m.life = 0; }
      }
      const fx = Math.sin(m.yaw), fy = -Math.cos(m.yaw);
      m.x += fx * m.spd * dt; m.y += fy * m.spd * dt;
      if ((m.smokeT -= dt) < 0) { m.smokeT = 0.022; puff(1, m.x - fx * 2, m.y - fy * 2, m.z, -fx * 20, -fy * 20, 1, 0.9, 1.8, 0.8, 0.85); }
      if (m.life <= 0) { if (!t || !t.dying) explode(m.x, m.y, m.z, false); missiles.splice(i, 1); }
    }
    for (let i = puffs.length - 1; i >= 0; i--) {
      const p = puffs[i];
      if (time - p.born > p.life) { puffs.splice(i, 1); continue; }
      if (time < p.born) continue;
      const k = Math.max(0, 1 - 2.2 * dt);
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; p.vx *= k; p.vy *= k; p.vz = p.vz * k + (p.kind === 2 ? 0 : 3 * dt);
    }
    for (let i = sparks.length - 1; i >= 0; i--) {
      const s = sparks[i];
      if (time - s.born > s.life) { sparks.splice(i, 1); continue; }
      s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt; s.vz -= s.g * dt;
      if (s.z < 0) { s.z = 0; s.vz = 0; }
    }
  }

  // ── simulation
  function addTrail(j, dt) {
    const ddx = j.x - j.lastTrailX, ddy = j.y - j.lastTrailY;
    if (ddx * ddx + ddy * ddy <= 9) return;
    j.lastTrailX = j.x; j.lastTrailY = j.y;
    const ax = axes(j), m = j.model;
    for (let w = 0; w < 2; w++) {
      modelPoint(j, ax, w === 0 ? -m.tipA : m.tipA, m.tipK, m.pivY, tmp3);
      const o = j.trailHead * 4;
      j.trail[w][o] = tmp3[0]; j.trail[w][o + 1] = tmp3[1]; j.trail[w][o + 2] = tmp3[2]; j.trail[w][o + 3] = time;
    }
    j.trailHead = (j.trailHead + 1) % TRAIL_N;
    if (j.trailLen < TRAIL_N) j.trailLen++;
  }

  function step(dtRaw) {
    const dt = clamp(dtRaw, 0, 0.05);
    time += dt;
    lead.intro += dt;
    const introDone = lead.intro > 1.9 && !cb.dead;
    lead.burn += ((introDone ? 1 : 0) - lead.burn) * ease(dt, 5);
    const pushing = introDone && boostKey;
    boost += ((pushing ? 1 : 0) - boost) * ease(dt, pushing ? 5 : 2.4);
    if (boost < 0.0005 && !pushing) boost = 0;
    lead.boost = boost;
    const speed = P.speed * (1 + (P.boost - 1) * boost) * (cb.dead ? 0.4 : 1);
    speedNow = speed;
    const maxRate = P.agility, clearance = P.clearance;
    const floorNow = groundAhead(lead, speed) + clearance;
    if (floorS === 0) floorS = floorNow;
    floorS += (floorNow - floorS) * ease(dt, floorNow > floorS ? 9 : 3);
    const altLo = floorS, altHi = Math.max(altLo, P.ceiling), climbMax = speed * 0.6, chase = vC + vK > 0.5;
    // where to turn; from behind or the seat the pointer also climbs and dives
    let want = 0, climb = keyClimb;
    if (!introDone) want = 0;
    else if (keyMode) want = keyTurn * maxRate;
    else if (pointerOn && (chase || project(lead.x, lead.y, lead.z))) {
      if (chase) {
        const t = clamp((pointerX - (W >> 1)) / (W * 0.26), -1, 1);
        if (Math.abs(t) > 0.06) want = t * maxRate;
        const raw = pointerY < vSteerY ? (vSteerY - pointerY) / Math.max(1, vSteerY) : -(pointerY - vSteerY) / Math.max(1, H - vSteerY);
        if (climb === 0) climb = Math.sign(raw) * Math.max(0, Math.abs(raw) - 0.16) / 0.84;
      } else {
        const vx = pointerX - prX, vy = pointerY - prY;
        if (vx * vx + vy * vy > 20 * 20) {
          const fx = vx * vCos + vy * vSin, fy = -vx * vSin + vy * vCos;
          want = clamp(wrapAngle(Math.atan2(fx, -fy) - lead.yaw) * 2.6, -maxRate, maxRate);
        }
      }
    }
    lead.yawRate += (want - lead.yawRate) * ease(dt, 2.6);
    lead.yaw += lead.yawRate * dt;
    lead.roll += (clamp(lead.yawRate / maxRate, -1, 1) * (P.bank * Math.PI) / 180 - lead.roll) * ease(dt, 5);
    lead.vx = Math.sin(lead.yaw) * speed; lead.vy = -Math.cos(lead.yaw) * speed;
    lead.x += lead.vx * dt; lead.y += lead.vy * dt;
    if (introDone) altGoal += climb * climbMax * dt;
    altGoal = clamp(altGoal, altLo, altHi);
    let dz = (altGoal - lead.z) * ease(dt, 3);
    dz = clamp(dz, -climbMax * dt, climbMax * dt);
    lead.z += dz;
    const hard = groundAt(lead.x, lead.y) + clearance * 0.7;
    if (lead.z < hard) lead.z += (hard - lead.z) * ease(dt, 22);
    climbV += (dz / Math.max(dt, 1e-4) - climbV) * ease(dt, 6);
    const climbing = Math.sign(climbV) * Math.max(0, Math.abs(climbV) - 3);
    climbTilt = clamp((climbing / Math.max(20, speed)) * 1.25, -0.5, 0.5);
    lead.pitch += (Math.abs(lead.yawRate / maxRate) * 0.1 + climbTilt - lead.pitch) * ease(dt, 4);
    // the pilot's head leans into a turn and sinks under thrust, on a soft spring
    const hxGoal = calm ? 0 : clamp(lead.yawRate / maxRate, -1, 1) * 6.4 + Math.sin(time * 0.53) * 0.3;
    const hyGoal = calm ? 0 : clamp(climbTilt / 0.5, -1, 1) * 3.4 + boost * 1.6 + Math.sin(time * 0.71 + 1) * 0.25;
    headVX += ((hxGoal - headX) * 64 - headVX * 11) * dt; headVY += ((hyGoal - headY) * 64 - headVY * 11) * dt;
    headX = clamp(headX + headVX * dt, -8, 8); headY = clamp(headY + headVY * dt, -5, 5);
    lead.g += (clamp(Math.abs(lead.yawRate) / maxRate + (lead.stunt >= 0 ? 0.7 : 0) + boost * 0.9 + Math.abs(climbTilt), 0, 1) - lead.g) * ease(dt, 2.5);
    if (lead.stunt >= 0) { lead.stunt += dt / 0.85; if (lead.stunt >= 1) lead.stunt = -1; }
    if (!cb.dead) addTrail(lead, dt);
    for (const e of enemies) if (!e.dying) addTrail(e, dt);
    // exhaust smoke off the end of the flames, and spray when skimming the sea
    if (introDone && boost > 0.3 && Math.random() < dt * 40) {
      const ax = axes(lead), m = lead.model, en = m.engines[(Math.random() * m.engines.length) | 0];
      modelPoint(lead, ax, en.a, m.nozzleK + 14, m.engineY, tmp3);
      puff(0, tmp3[0], tmp3[1], tmp3[2], -lead.vx * 0.3, -lead.vy * 0.3, 2, 1.6 * JS, 6 * JS, 0.8, 0.45);
    }
    if (!cb.dead && lead.z < 20 && matAt(lead.x, lead.y) < NWATER) {
      for (let i = 0, n = Math.round((20 - lead.z) * 0.5 * (speed / P.speed)); i < n; i++) {
        const side = Math.random() * 2 - 1, rx = Math.cos(lead.yaw), ry = Math.sin(lead.yaw);
        spark(lead.x + rx * side * 10 * JS - lead.vx * 0.12, lead.y + ry * side * 10 * JS - lead.vy * 0.12, 0.5, lead.vx * 0.2 + rx * side * 30, lead.vy * 0.2 + ry * side * 30, 14 + Math.random() * 30, 0.35 + Math.random() * 0.45, whitePal[i & 3], 80);
      }
    }
    updateCombat(dt);
    // the view weights glide to their goals (three soft stages each)
    const goC = viewTarget === 1 ? 1 : 0, goK = viewTarget === 2 ? 1 : 0, es = 1 - Math.exp((-dt * 7.6) / P.transition);
    let settled = true;
    for (let i = 0; i < 3; i++) {
      wChase[i] += ((i === 0 ? goC : wChase[i - 1]) - wChase[i]) * es; wCock[i] += ((i === 0 ? goK : wCock[i - 1]) - wCock[i]) * es;
      if (Math.abs(wChase[i] - goC) > 0.0004 || Math.abs(wCock[i] - goK) > 0.0004) settled = false;
    }
    if (settled) { wChase.fill(goC); wCock.fill(goK); }
    vC = wChase[2]; vK = wCock[2];
    // camera: ahead of the jet, turning part of the way with it
    const look = (calm ? 64 : 26 + 18 * boost) * (1 - vC - vK), tx = lead.x + Math.sin(lead.yaw) * look, ty = lead.y - Math.cos(lead.yaw) * look, kc = ease(dt, 3.5);
    follow.x += lead.vx * dt + (tx - (follow.x + lead.vx * dt)) * kc; follow.y += lead.vy * dt + (ty - (follow.y + lead.vy * dt)) * kc;
    // (calm: the overhead view settles with north up and stays there; the jet turns, the map does not)
    cam.yaw += ((calm ? Math.round(cam.yaw / 6.2832) * 6.2832 : -lead.yaw * P.cameraFollow) - cam.yaw) * ease(dt, 1.6);
    follow.alt += (lead.z - follow.alt) * ease(dt, 3);
    // the chase camera keeps clear of the hills behind the jet, and out of the cloud layer
    let fix = 0;
    camFloor = 0;
    if (vC > 0.3 && vQ > 1e-4) {
      const back = 1 / vQ, gx = cam.x + vSin * back, gy = cam.y + vCos * back;
      let top = 0;
      for (let iy = -1; iy <= 1; iy++) for (let ix = -1; ix <= 1; ix++) top = Math.max(top, groundAt(gx + ix * 9, gy + iy * 9));
      camFloor = top + 5;
      const nominal = follow.alt + vLean * back;
      let w2 = Math.max(nominal, camFloor);
      if (w2 > CLOUD_ALT - 3 && w2 < ZTOP + 3) w2 = lead.z < CLOUD_ALT - 8 ? Math.max(camFloor, CLOUD_ALT - 3) : ZTOP + 3;
      fix = w2 - nominal;
    }
    camFix += (fix - camFix) * ease(dt, 7);
    chaseYaw += (-lead.yaw - chaseYaw) * ease(dt, 3.4);
    const raw = chaseYaw - cam.yaw;
    if (vC === 0 && vK === 0) yawDiff = wrapAngle(raw); else yawDiff += wrapAngle(raw - yawDiff);
    updateView();
  }

  // ── drawing: the islands and clouds, from the nearest ground to the farthest. Every ground pixel is a
  // column of stacked layers: its top is drawn where the column ends and its wall where it starts,
  // and a pixel that is already taken stays taken (nearer things win).
  const sjx = new Float64Array(8), sjy = new Float64Array(8), srx = new Float64Array(8), sry = new Float64Array(8), sic = new Float64Array(8), sjm = [];
  const rowNow = new Int32Array(ZTOP + 2), rowPrev = new Int32Array(ZTOP + 2), shTile = new Uint8Array(128 * 128);

  // The frame is built by drawWorld(), one depth step at a time. Each step is a separate call to worldSpan():
  // a function that is *called* hundreds of times a frame gets V8's best compiler, whereas one long loop inside
  // a function called once a frame keeps being swapped in mid-loop and thrown away again (and runs ~8× slower).
  let F_c = 0, F_s = 0, F_S = 0, F_Cx = 0, F_bx = 0, F_by = 0, F_rank = 0, F_cwx = 0, F_cwy = 0, F_csx = 0, F_csy = 0;
  let F_above = true;
  let F_tW1 = 0, F_tW2 = 0, F_tF = 0, F_tR = 0, F_nSh = 0, F_reach = 0, F_hzR = 0, F_hzG = 0, F_hzB = 0;
  function mixHaze(col, keep, fog) {
    return ((255 << 24) | (((((col >> 16) & 255) * keep + F_hzB * fog) >> 8) << 16) | (((((col >> 8) & 255) * keep + F_hzG * fog) >> 8) << 8) | (((col & 255) * keep + F_hzR * fog) >> 8)) >>> 0;
  }

  // one column of cloud (kept out of worldSpan so that loop stays small and fast; most samples have no cloud)
  function cloudCol(px, cv, v, fog) {
    const _fb = fb, _zb = zbuf, Wd = W, rLo = rowLo, rHi = rowHi, _now = rowNow, _prev = rowPrev, _ct = cloudTop, _cs = cloudSide, _ccy = cloudY;
    const under = cloudUnder, rankMax = F_rank, fromAbove = F_above, keep = 256 - fog, yC0 = _now[CLOUD_ALT], yC1 = _prev[CLOUD_ALT];
    if (cv !== 0 && cv >> 4 < rankMax && fromAbove) {
      // seen from above, a column of the frame fills with cloud from the bottom up, like the ground does:
      // only the part of this stack that rises over what is already there is drawn
      const tk = cv & 15, zt = CLOUD_ALT + tk - 1, cc = _ccy[px];
      let y0 = _now[zt];
      if (y0 < cc) {
        if (y0 < rLo) y0 = rLo;
        let y1 = _prev[zt];
        if (y1 > cc) y1 = cc;
        if (y0 < y1) {
          let col = _ct[tk - 1];
          if (fog > 0) col = mixHaze(col, keep, fog);
          for (let y = y0, o = y0 * Wd + px; y < y1; y++, o += Wd) {
            if (_fb[o] !== 0 || (tk === 1 && ((px + y) & 1) === 0)) continue;   // the thinnest rim is a checker: a soft edge
            _fb[o] = col; _zb[o] = v;
          }
        }
        for (let k = tk - 2; k >= 0; k--) {
          let ya = _prev[CLOUD_ALT + k + 1], yb = _prev[CLOUD_ALT + k];
          if (ya >= cc) break;
          if (ya < rLo) ya = rLo;
          if (yb > cc) yb = cc;
          if (ya >= yb) continue;
          let col = _cs[k];
          if (fog > 0) col = mixHaze(col, keep, fog);
          for (let y = ya, o = ya * Wd + px; y < yb; y++, o += Wd) if (_fb[o] === 0) { _fb[o] = col; _zb[o] = v; }
        }
        _ccy[px] = y0;
      }
    } else if (cv !== 0 && cv >> 4 < rankMax) {
      const tk = cv & 15, zt = CLOUD_ALT + tk - 1;
      let y0 = _now[zt], y1 = _prev[zt];
      if (y0 < rLo) y0 = rLo;
      if (y1 > rHi) y1 = rHi;
      if (y0 < y1) {
        let col = _ct[tk - 1];
        if (fog > 0) col = mixHaze(col, keep, fog);
        for (let y = y0, o = y0 * Wd + px; y < y1; y++, o += Wd) {
          if (_fb[o] !== 0 || (tk === 1 && ((px + y) & 1) === 0)) continue;   // the thinnest rim is a checker: a soft edge
          _fb[o] = col; _zb[o] = v;
        }
      }
      if (yC1 < yC0) {   // its underside, seen from below
        const u0 = yC1 < rLo ? rLo : yC1, u1 = yC0 > rHi ? rHi : yC0, col = fog > 0 ? mixHaze(under, keep, fog) : under;
        for (let y = u0, o = u0 * Wd + px; y < u1; y++, o += Wd) {
          if (_fb[o] !== 0 || (tk === 1 && ((px + y) & 1) === 0)) continue;
          _fb[o] = col; _zb[o] = v;
        }
      }
      for (let k = tk - 2; k >= 0; k--) {
        let ya = _prev[CLOUD_ALT + k + 1], yb = _prev[CLOUD_ALT + k];
        if (ya < rLo) ya = rLo;
        if (yb > rHi) yb = rHi;
        if (ya >= yb) continue;
        let col = _cs[k];
        if (fog > 0) col = mixHaze(col, keep, fog);
        for (let y = ya, o = ya * Wd + px; y < yb; y++, o += Wd) if (_fb[o] === 0) { _fb[o] = col; _zb[o] = v; }
      }
    }
  }
  // is this ground pixel in a jet's shadow? (only called inside the tiles a shadow touches)
  function jetShade(gx, gy, h) {
    const sx = sunX, sy = sunY, reach = F_reach, isc = 1 / JET_SC;
    for (let j = 0, n = F_nSh; j < n; j++) {
      const dx = gx - sjx[j] + sx * h, dy = gy - sjy[j] + sy * h;
      if (dx > -reach && dx < reach && dy > -reach && dy < reach) {
        const mo = sjm[j], a = (dx * srx[j] + dy * sry[j]) * sic[j], b = (dx * sry[j] - dy * srx[j]) * isc;
        const i = Math.floor(a + mo.w / 2), k = Math.floor(mo.pivK - b + 0.5);
        if (i >= 0 && i < mo.w && k >= 0 && k < mo.l && mo.shadow[k * mo.w + i] === 1) return true;
      }
    }
    return false;
  }

  function worldSpan(v, den, fog, hNeed, cloudRow, lvl) {
    const _fb = fb, _zb = zbuf, Wd = W, rLo = rowLo, rHi = rowHi, cLo = colLo, cHi = colHi;
    const _hm = HM[lvl], _cn = CT[lvl], sh = lvl, sh3 = lvl + 3, tmH = (256 >> lvl) - 1, tsH = 8 - lvl, tmC = (128 >> lvl) - 1, tsC = 7 - lvl;
    const _nz = nz, _cy = colY, _now = rowNow, _prev = rowPrev, _sh = shTile, _hmip = hMip, _cm = cMip;
    const _tl = topLit, _ts = topShade, _sl = sideLit, _ss = sideShade, _ct = cloudTop, _cs = cloudSide;
    const foam = foamCol, spA = sparkA, spB = sparkB, under = cloudUnder, rankMax = F_rank, sx = sunX, sy = sunY;
    const cwx = F_cwx, cwy = F_cwy, csx = F_csx, csy = F_csy, tW1 = F_tW1, tW2 = F_tW2, tF = F_tF, tR = F_tR, nShadow = F_nSh, reach = F_reach, isc = 1 / JET_SC;
    const _ccy = cloudY, fromAbove = F_above;
    const inv = den / F_S, ax = F_c * inv, ay = -F_s * inv, keep = 256 - fog, fine = inv < 1.8, yC0 = _now[CLOUD_ALT], yC1 = _prev[CLOUD_ALT];
    let wx = F_bx - F_Cx * ax - v * F_s + ax * cLo, wy = F_by - F_Cx * ay - v * F_c + ay * cLo;

    for (let px = cLo; px < cHi; px++, wx += ax, wy += ay) {
      let cY = _cy[px];
      if (cY <= rLo) continue;   // this column of the frame is full
      // clouds: a stack of up to CK layers floating at CLOUD_ALT
      if (cloudRow) {
        const cyy = (wy + cwy) | 0, cxx = (wx + cwx) | 0, ct = (((cyy >> 3) & 127) << 7) | ((cxx >> 3) & 127);
        const cv = _cm[ct] < rankMax ? _cn[(((((cyy >> sh3) & tmC) << tsC) | ((cxx >> sh3) & tmC)) << 6) | (((cyy >> sh) & 7) << 3) | ((cxx >> sh) & 7)] : 0;
        if (cv !== 0 && cv >> 4 < rankMax) cloudCol(px, cv, v, fog);
      }
      // terrain: height in the low byte, material in the high one
      const gx = wx | 0, gy = wy | 0;
      if (hNeed > 0 && _hmip[(((gy >> 4) & 127) << 7) | ((gx >> 4) & 127)] < hNeed) continue;
      const hm = _hm[(((((gy >> sh3) & tmH) << tsH) | ((gx >> sh3) & tmH)) << 6) | (((gy >> sh) & 7) << 3) | ((gx >> sh) & 7)], h = hm & 255;
      const yT = _now[h];
      let yR = _prev[h];
      if (yT >= cY && yR >= cY) continue;
      const mat = hm >> 8;
      // shadows: clouds, then the jets
      let shade = false;
      const syy = gy + csy, sxx = gx + csx, st = (((syy >> 3) & 127) << 7) | ((sxx >> 3) & 127);
      if (_cm[st] < rankMax) {
        const sv = _cn[(((((syy >> sh3) & tmC) << tsC) | ((sxx >> sh3) & tmC)) << 6) | (((syy >> sh) & 7) << 3) | ((sxx >> sh) & 7)];
        if ((sv & 15) > 1 && sv >> 4 < rankMax) shade = true;
      }
      if (!shade && _sh[(((gy >> 5) & 127) << 7) | ((gx >> 5) & 127)] === 1) shade = jetShade(gx, gy, h);
      let top = shade ? _ts[mat] : _tl[mat], side = top;
      if (mat < NWATER) {
        if (mat === M_SURF) {
          if (((_nz[((gy & 255) << 8) | (gx & 255)] + tF) & 255) < 120) top = side = shade ? _ts[M_LAGOON] : foam;
        } else if (mat === M_LAGOON) {
          if (((_nz[((gy & 255) << 8) | (gx & 255)] + tR) & 255) < 9) top = side = shade ? _ts[M_LAGOON] : foam;   // ripples rolling in
        } else if (!shade && fine) {
          // glints: short dashes drifting two ways (a hash here, so calm water costs no memory look-up)
          const n1 = Math.imul(Math.imul((gx + tW1) >> 2, 73856093) ^ Math.imul(gy, 19349663), 0x9e3779b1) >>> 24;
          if (n1 > 242 && _nz[(((gy + 91) & 255) << 8) | (((gx + 1024 - tW2) >> 2) & 255)] > 128) top = side = n1 > 252 ? spB : spA;
        }
      } else side = shade ? _ss[mat] : _sl[mat];
      if (fog > 0) { top = mixHaze(top, keep, fog); side = mixHaze(side, keep, fog); }
      if (yR < cY) {   // the wall of this column, where it starts …
        if (yR < rLo) yR = rLo;
        for (let y = yR, o = yR * Wd + px; y < cY; y++, o += Wd) if (_fb[o] === 0) { _fb[o] = side; _zb[o] = v; }
        cY = yR;
      }
      if (yT < cY) {   // … and its top, up to where it ends
        const y0 = yT < rLo ? rLo : yT;
        for (let y = y0, o = y0 * Wd + px; y < cY; y++, o += Wd) if (_fb[o] === 0) { _fb[o] = top; _zb[o] = v; }
        cY = yT;
      }
      _cy[px] = cY;
    }
  }

  function drawWorld() {
    const _fb = fb, _zb = zbuf, Wd = W, rLo = rowLo, rHi = rowHi, cLo = colLo, cHi = colHi;
    if (rLo === 0 && rHi === H && cLo === 0 && cHi === Wd) { _fb.fill(0); _zb.fill(1e9); }
    else for (let y = rLo; y < rHi; y++) { _fb.fill(0, y * Wd + cLo, y * Wd + cHi); _zb.fill(1e9, y * Wd + cLo, y * Wd + cHi); }
    colY.fill(rHi); cloudY.fill(rHi);
    const q = vQ, S = vS, tn = vTan, Cy = vCy, A = cam.alt, sx = sunX, sy = sunY;
    F_above = q <= 0 || A + tn / q > ZTOP + 1;
    const bx = cam.x - Math.floor(cam.x / N) * N + N * 2, by = cam.y - Math.floor(cam.y / N) * N + N * 2;
    const rankMax = Math.round(P.clouds * 16), cloudsOn = rankMax > 0, cdx = (time * 7) % NC, cdy = (time * 3) % NC;
    F_c = vCos; F_s = vSin; F_S = S; F_Cx = vCx; F_bx = bx; F_by = by; F_rank = rankMax; F_cwx = NC - cdx; F_cwy = NC - cdy;
    F_csx = (sunX * CLOUD_ALT - cdx + NC) | 0; F_csy = (sunY * CLOUD_ALT - cdy + NC) | 0;
    F_tW1 = ((time * 6) | 0) & 1023; F_tW2 = ((time * 4) | 0) & 1023; F_tF = (time * 36) | 0; F_tR = (time * 9) | 0;
    F_hzR = hazeCol & 255; F_hzG = (hazeCol >> 8) & 255; F_hzB = (hazeCol >> 16) & 255;
    // jet shadows: each planform, pushed away from the jet by the sun as it climbs
    let nShadow = 0;
    const reach = 96 * 0.75 * JET_SC + 2;
    shTile.fill(0);
    const addShadow = j => {
      if (nShadow >= 8 || Math.abs(j.x - cam.x) > 900 || Math.abs(j.y - cam.y) > 900) return;
      const ax = axes(j), jx = bx + (j.x - cam.x) + sx * j.z, jy = by + (j.y - cam.y) + sy * j.z;
      sjx[nShadow] = jx; sjy[nShadow] = jy;
      srx[nShadow] = Math.cos(j.yaw); sry[nShadow] = Math.sin(j.yaw); sic[nShadow] = 1 / (Math.max(0.3, Math.abs(ax.cr)) * JET_SC); sjm[nShadow] = j.model;
      // mark the 32-unit tiles a shadow can fall in (stretched for the tallest ground): most pixels skip the test
      for (let ty = (jy - reach - 40) >> 5; ty <= (jy + reach) >> 5; ty++) for (let tx = (jx - reach - 40) >> 5; tx <= (jx + reach) >> 5; tx++) shTile[((ty & 127) << 7) | (tx & 127)] = 1;
      nShadow++;
    };
    if (!cb.dead && lead.intro > 0.3) addShadow(lead);
    for (const e of enemies) addShadow(e);
    F_nSh = nShadow; F_reach = reach;
    const _now = rowNow, _prev = rowPrev;
    // start where the tallest thing sits on the bottom row; stop when the sea leaves the top of the frame,
    // or at the view distance once there is a horizon
    const below = rHi - Cy, nearest = q > 0 ? -0.85 / q : -1e9, camHigh = q > 0 ? A + tn / q : 1e9, dn = S * tn + q * below;
    let v = camHigh > ZTOP + 1 && dn > 1e-6 ? Math.max(nearest, (S * (A - ZTOP) - below) / dn - 2) : nearest;
    const viewDist = VIEW_DIST + 3 * A, fogStart = FOG_START + 2 * A, above = Cy - rLo + 2;
    let vEnd = viewDist;
    if (S * tn > q * above) vEnd = Math.min(viewDist, (S * A + above) / (S * tn - q * above));
    let den = 1 + q * v, m = S / den, R = Cy - m * (tn * v - A) + EPS;
    for (let z = 0; z <= ZTOP; z++) _now[z] = Math.floor(R - m * z);
    const rowsK = S * (tn + q * A);
    for (let guard = 0; v < vEnd && guard < 4000; guard++) {
      // one step deeper: about one screen row of sea, never coarser than a few pixels across
      let dv = (den * den) / rowsK;
      const cap = (2.5 * den) / S;
      if (dv > cap) dv = cap;
      if (dv < 0.5) dv = 0.5;
      v += dv; den = 1 + q * v; m = S / den; R = Cy - m * (tn * v - A) + EPS;
      for (let z = 0; z <= ZTOP; z++) { _prev[z] = _now[z]; _now[z] = Math.floor(R - m * z); }
      // ground lower than this cannot reach up into the frame from here
      let hNeed = 0;
      while (hNeed < 70 && _now[hNeed] >= rHi) hNeed++;
      // distance haze: colours step towards the horizon colour, a few shades at a time
      let fog = 0;
      if (q > 0 && v > fogStart) fog = Math.min(256, ((Math.sqrt((v - fogStart) / (viewDist - fogStart)) * FOG_STEPS + 0.5) | 0) * (256 / FOG_STEPS)) | 0;
      // the cloud layer only matters on steps where some of it falls inside the frame
      // how much ground one pixel / one step covers here picks the map copy to read
      const foot = Math.max(den / S, dv * 0.6);
      worldSpan(v, den, fog, hNeed, cloudsOn && _now[ZTOP] < rHi && (_prev[CLOUD_ALT] > rLo || _now[CLOUD_ALT] > rLo), foot < 1.6 ? 0 : foot < 3.2 ? 1 : foot < 6.4 ? 2 : 3);
    }
  }

  // whatever the ground left empty: banded sky above the horizon, haze below it
  function drawSky() {
    if (vC === 0 && vK === 0) return;
    const _fb = fb, q = vQ, horizon = q > 1e-7 ? vCy - (vS * vTan) / q : -1e9, hz = horizon > H ? H : Math.floor(horizon), focal = q > 1e-7 ? vS / q : 1e9;
    if (hz > 0) {   // the sun (or moon), opposite the shadows
      const sl = Math.hypot(sunX, sunY) || 1, dx = -sunX / sl, dy = -sunY / sl, du = dx * vCos - dy * vSin, dv = -(dx * vSin + dy * vCos);
      if (dv > 0.2) {
        const rad = tod === 1 ? W * 0.05 : W * 0.024, cxs = vCx + (focal * du) / dv, cys = horizon - (focal * (tod === 1 ? 0.12 : tod === 2 ? 0.3 : 0.62)) / dv, reach = rad * 2.2;
        const xa = Math.max(colLo, Math.floor(cxs - reach)), xb = Math.min(colHi - 1, Math.ceil(cxs + reach)), ya = Math.max(rowLo, Math.floor(cys - reach)), yb = Math.min(Math.min(hz, rowHi) - 1, Math.ceil(cys + reach));
        for (let y = ya; y <= yb; y++) for (let x = xa; x <= xb; x++) {
          const o = y * W + x;
          if (_fb[o] !== 0) continue;
          const d = Math.hypot(x - cxs, y - cys) / rad;
          if (d < 1) _fb[o] = sunCol; else if (d < 2.2 && (2.2 - d) * 12 > BAYER[((y & 3) << 2) | (x & 3)]) _fb[o] = sunGlow;
        }
      }
    }
    const span = frameH * 0.8, starOff = ((vYaw * focal) | 0) & 4095;
    for (let y = rowLo; y < rowHi; y++) skyRow(y, y < hz ? ((hz - y) / span) * (NSKY - 1) : -1, starOff);
  }
  function skyRow(y, t, starOff) {
    const _fb = fb, x1 = colHi, stars = tod === 2, haze = hazeCol, sun = sunCol, pal = skyPal;
    let o = y * W + colLo;
    if (t < 0) { for (let x = colLo; x < x1; x++, o++) if (_fb[o] === 0) _fb[o] = haze; return; }
    const b0 = Math.min(NSKY - 1, t | 0), b1 = Math.min(NSKY - 1, b0 + 1), edge = (t - b0 - 0.5) * 32, by = (y & 3) << 2;   // each band dithers into the next
    for (let x = colLo; x < x1; x++, o++) {
      if (_fb[o] !== 0) continue;
      const b = edge > BAYER[by | (x & 3)] ? b1 : b0;
      _fb[o] = stars && b > 1 && hash8(((x + starOff) & 4095) * 73 + y * 9973) < 2 ? sun : pal[b];
    }
  }

  function drawTrail(j) {
    const LIFE = 2.6, _fb = fb, _zb = zbuf, g = j.g;
    for (let w = 0; w < 2; w++) {
      const tr = j.trail[w];
      let prevX = 0, prevY = 0, has = false;
      for (let n = 0; n < j.trailLen; n++) {
        const o = ((j.trailHead - 1 - n + TRAIL_N * 2) % TRAIL_N) * 4, age = (time - tr[o + 3]) / (LIFE * (0.3 + 0.7 * g));
        if (age >= 1) break;
        if (!project(tr[o], tr[o + 1], tr[o + 2])) { has = false; continue; }
        const sxp = prX, syp = prY;
        if (has) {
          const span = Math.max(Math.abs(sxp - prevX), Math.abs(syp - prevY));
          if (span < 700) {
            const steps = Math.max(1, Math.ceil(span)), alpha = age < 0.5 ? 1 : (1 - age) * 2, col = age < 0.25 ? trailPal[0] : age < 0.6 ? trailPal[1] : trailPal[2], thick = prM * JS > 1.3 ? 2 : 1;
            for (let k = 0; k < steps; k++) {
              const x0 = Math.round(prevX + ((sxp - prevX) * k) / steps), y0 = Math.round(prevY + ((syp - prevY) * k) / steps);
              for (let yy = y0; yy < y0 + thick; yy++) for (let xx = x0; xx < x0 + thick; xx++) {
                if (xx < colLo || yy < rowLo || xx >= colHi || yy >= rowHi || _zb[yy * W + xx] < prV - 1) continue;
                if (alpha * 16 > BAYER[((yy & 3) << 2) | (xx & 3)]) _fb[yy * W + xx] = col;
              }
            }
          }
        }
        prevX = sxp; prevY = syp; has = true;
      }
    }
  }

  // smoke and fire: hard-edged dithered discs, so they stay pixel art
  function drawPuffs(fire) {
    const _fb = fb, _zb = zbuf;
    for (const p of puffs) {
      if ((p.kind === 2) !== fire) continue;
      const age = time - p.born, u = age / p.life;
      if (age < 0 || !project(p.x, p.y, p.z)) continue;
      // three tones a ball: lit upper left, a body colour, a darker lower-right rim
      let col, col2, col3, alpha;
      if (p.kind === 2) { const f = Math.min(7, (u * 8.5) | 0); col = firePal[f]; col2 = firePal[Math.max(0, f - 1)]; col3 = firePal[Math.min(7, f + 1)]; alpha = u < 0.7 ? 1 : (1 - u) / 0.3; }
      else if (p.kind === 0) { const f = Math.min(3, (u * 4) | 0); col = smokePal[f]; col2 = smokePal[Math.min(3, f + 1)]; col3 = smokePal[Math.max(0, f - 1)]; alpha = p.strength * (1 - u) * (u < 0.08 ? u / 0.08 : 1); }
      else { const f = Math.min(3, (u * 4) | 0); col = whitePal[f]; col2 = whitePal[0]; col3 = whitePal[Math.min(3, f + 1)]; alpha = p.strength * (1 - u) * (1 - u); }
      // a puff is a solid ball with a ragged, dithered rim; as it thins it shrinks and then breaks up
      const rad = Math.min(p.kind === 1 ? 9 : 30, Math.max(0.8, (p.size + p.grow * (1 - Math.exp(-u * 3))) * prM)) * (0.45 + 0.55 * Math.min(1, alpha * 1.6));
      if (prX < colLo - rad || prX > colHi + rad || prY < rowLo - rad || prY > rowHi + rad) continue;
      const x0 = Math.max(colLo, Math.floor(prX - rad)), x1 = Math.min(colHi - 1, Math.ceil(prX + rad)), y0 = Math.max(rowLo, Math.floor(prY - rad)), y1 = Math.min(rowHi - 1, Math.ceil(prY + rad));
      const inv = 1 / (rad * rad), hx = prX - rad * 0.3, hy = prY - rad * 0.3, hinv = 1 / (rad * rad * 0.3), solid = alpha > 0.34 ? 0.62 : 0, thin = Math.min(1, alpha * 3);
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const d2 = ((x - prX) * (x - prX) + (y - prY) * (y - prY)) * inv;
        if (d2 > 1) continue;
        const at = y * W + x;
        if (_zb[at] < prV - 2) continue;
        if (d2 >= solid && (1 - d2) * 30 * thin <= BAYER[(((y + p.seed) & 3) << 2) | ((x + p.seed) & 3)]) continue;
        _fb[at] = ((x - hx) * (x - hx) + (y - hy) * (y - hy)) * hinv < 1 ? col2 : d2 > 0.5 && x - prX + y - prY > 0 ? col3 : col;
      }
    }
  }
  function drawSparks() {
    const _fb = fb, _zb = zbuf;
    for (const s of sparks) {
      if (s.g > 85 && s.g < 95) { line3(s.x - s.vx * 0.03, s.y - s.vy * 0.03, s.z - s.vz * 0.03, s.x, s.y, s.z, s.col, firePal[0]); continue; }   // burning debris leaves a streak
      if (!project(s.x, s.y, s.z)) continue;
      const x = prX | 0, y = prY | 0, sz = prM > 1.6 ? 2 : 1;
      for (let yy = y; yy < y + sz; yy++) for (let xx = x; xx < x + sz; xx++) {
        if (xx < colLo || yy < rowLo || xx >= colHi || yy >= rowHi || _zb[yy * W + xx] < prV - 2) continue;
        _fb[yy * W + xx] = s.col;
      }
    }
  }
  function line3(x0, y0, z0, x1, y1, z1, col, core) {
    if (!project(x0, y0, z0)) return;
    const ax = prX, ay = prY, av = prV, am = prM;
    if (!project(x1, y1, z1)) return;
    const span = Math.max(Math.abs(prX - ax), Math.abs(prY - ay));
    if (span > 500) return;
    const steps = Math.max(1, Math.ceil(span)), thick = am > 1.5 ? 2 : 1, _fb = fb, _zb = zbuf;
    for (let k = 0; k <= steps; k++) {
      const x = Math.round(ax + ((prX - ax) * k) / steps), y = Math.round(ay + ((prY - ay) * k) / steps);
      for (let yy = y; yy < y + thick; yy++) for (let xx = x; xx < x + thick; xx++) {
        if (xx < colLo || yy < rowLo || xx >= colHi || yy >= rowHi || _zb[yy * W + xx] < av - 2) continue;
        _fb[yy * W + xx] = k > steps * 0.55 ? core : col;
      }
    }
  }
  function drawShots() {
    const own = pack(255, 232, 110), ownC = pack(255, 255, 236), foe = pack(255, 84, 50), foeC = pack(255, 214, 170);
    for (const b of bullets) line3(b.x - b.vx * 0.028, b.y - b.vy * 0.028, b.z - b.vz * 0.028, b.x, b.y, b.z, b.own ? own : foe, b.own ? ownC : foeC);
    const body = pack(236, 238, 244), tip = pack(232, 60, 50);
    for (const m of missiles) {
      const fx = Math.sin(m.yaw), fy = -Math.cos(m.yaw);
      line3(m.x - fx * 3.5, m.y - fy * 3.5, m.z, m.x + fx * 2, m.y + fy * 2, m.z, body, tip);
      if (project(m.x - fx * 4, m.y - fy * 4, m.z)) {
        const x = prX | 0, y = prY | 0;
        for (let yy = y - 1; yy <= y + 1; yy++) for (let xx = x - 1; xx <= x + 1; xx++) if (xx >= colLo && yy >= rowLo && xx < colHi && yy < rowHi && zbuf[yy * W + xx] >= prV - 2) fb[yy * W + xx] = flamePal[xx === x && yy === y ? 0 : 2];
      }
    }
  }

  // ── a jet: its slices drawn from the one farthest from eye level to the nearest, several samples per voxel
  // (one slice per call, for the same reason as worldSpan: small hot functions compile best)
  let J_rU = 0, J_rV = 0, J_rW = 0, J_fU = 0, J_fV = 0, J_fW = 0, J_m0 = 1, J_nOff = 1, J_fading = false, J_palL = null, J_palR = null;
  let J_x0 = 0, J_y0 = 0, J_x1 = 0, J_y1 = 0;
  function jetSlice(A, B, C, F, need, bU, bV, bW, drop) {
    const _bg = backdrop, _fb = fb, _mk = jetMask, _zb = zbuf, Wd = W, rLo = rowLo, rHi = rowHi, cLo = colLo, cHi = colHi, Vx = vCx + 0.5, Vy = vCy + drop + 0.5;
    const q = vQ, S = vS, tn = vTan, rU = J_rU, rV = J_rV, rW = J_rW, fU = J_fU, fV = J_fV, fW = J_fW, im0 = 1 / J_m0, nOff = J_nOff, fading = J_fading, palL = J_palL, palR = J_palR, oX = offX, oY = offY;
    let x0 = J_x0, y0 = J_y0, x1 = J_x1, y1 = J_y1;
    for (let v = 0, cnt = C.length; v < cnt; v++) {
      if ((F[v] & need) === 0) continue;   // a face turned away from the eye
      const a = A[v], b = B[v], V = bV + a * rV + b * fV, den = 1 + q * V;
      if (den < 0.2) continue;
      const m = S / den, col = a < 0 ? palL[C[v]] : palR[C[v]], px = Vx + m * (bU + a * rU + b * fU), py = Vy - m * (bW + a * rW + b * fW + tn * V), k = m * im0;
      let x = 0, yy = 0;
      for (let o = 0; o < nOff; o++) {
        x = Math.floor(px + oX[o] * k); yy = Math.floor(py + oY[o] * k);
        if (x < cLo || yy < rLo || x >= cHi || yy >= rHi) continue;
        const at = yy * Wd + x;
        if (_zb[at] < V - 1) continue;   // a hill or a cloud is in front
        if (fading && _mk[at] === 0) _bg[at] = _fb[at];
        _fb[at] = col; _mk[at] = 1;
      }
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (yy < y0) y0 = yy;
      if (yy > y1) y1 = yy;
    }
    J_x0 = x0; J_y0 = y0; J_x1 = x1; J_y1 = y1;
  }
  const offX = new Float32Array(160), offY = new Float32Array(160), sliceOrder = new Int32Array(40), sliceKey = new Float64Array(40);
  function drawJet(j, isLead) {
    const mo = j.model, c = vCos, s = vSin, q = vQ, S = vS, tn = vTan, ax = axes(j), sc = JET_SC;
    const rU = (ax.rx * c - ax.ry * s) * sc, rV = -(ax.rx * s + ax.ry * c) * sc, rW = ax.rz * sc;
    const fU = (ax.fx * c - ax.fy * s) * sc, fV = -(ax.fx * s + ax.fy * c) * sc, fW = ax.fz * sc;
    const uU = (ax.ux * c - ax.uy * s) * sc, uV = -(ax.ux * s + ax.uy * c) * sc, uW = ax.uz * sc;
    const dx = j.x - cam.x, dy = j.y - cam.y, cU = dx * c - dy * s, cV = -(dx * s + dy * c), cW = j.z - cam.alt;
    j.vis = false;
    const fade = isLead ? jetFade : 1;
    const den0 = 1 + q * cV;
    if (den0 < 0.2) return;
    const m0 = S / den0, cx = vCx + m0 * cU, cy = vCy - m0 * (cW + tn * cV);
    j.sx = cx; j.sy = cy; j.sm = m0; j.sv = cV;
    const far = mo.l * sc * m0 + 40;
    if (cx < colLo - far || cy < rowLo - far || cx > colHi + far || cy > rowHi + far) return;
    j.vis = true;
    if (fade < 0.004) return;
    const fading = fade < 1, _bg = backdrop, _fb = fb, _mk = jetMask, _zb = zbuf;
    const prx = m0 * rU, pry = -m0 * (rW + tn * rV), pfx = m0 * fU, pfy = -m0 * (fW + tn * fV);
    // light: which way each half of the jet faces the sun
    const lx = -sunX, ly = -sunY, lz = 1.1, ll = Math.hypot(lx, ly, lz), litAt = tod === 2 ? 0.74 : 0.9, dimAt = tod === 2 ? 0.4 : 0.66;
    const lit = side => {
      const nx = ax.ux + side * 0.4 * ax.rx, ny = ax.uy + side * 0.4 * ax.ry, nz2 = ax.uz + side * 0.4 * ax.rz, b = (nx * lx + ny * ly + nz2 * lz) / (ll * Math.hypot(nx, ny, nz2));
      return b > litAt ? jetPalLit : b < dimAt ? jetPalDim : jetPal;
    };
    const palL = lit(-1), palR = lit(1);
    let x0 = W, y0 = H, x1 = -1, y1 = -1;
    J_rU = rU; J_rV = rV; J_rW = rW; J_fU = fU; J_fV = fV; J_fW = fW; J_m0 = m0; J_fading = fading; J_palL = palL; J_palR = palR;
    // enough samples per voxel that a turned slice has no pin-holes (under a pixel apart; the slices above and below cover the rest)
    const big = (sc * S) / Math.max(0.2, den0 - q * mo.l * 0.6 * sc), ns = clamp(Math.ceil(big * 1.15), 1, 6);
    // … and through the slice's thickness too, so the layers do not come apart when the stack is seen edge-on
    const pux = m0 * uU, puy = -m0 * (uW + tn * uV), nu = clamp(Math.ceil(Math.hypot(pux, puy) * 1.1), 1, 4);
    let nOff = 0;
    for (let u = 0; u < nu; u++) for (let i = 0; i < ns; i++) for (let k = 0; k < ns; k++) {
      const oi = (i + 0.5) / ns - 0.5, ok = (k + 0.5) / ns - 0.5, ou = (u + 0.5) / nu - 0.5;
      offX[nOff] = oi * prx + ok * pfx + ou * pux; offY[nOff++] = oi * pry + ok * pfy + ou * puy;
    }
    J_nOff = nOff;
    let eye;
    if (q < 1e-6) eye = tn * uW - uV >= 0 ? 1e9 : -1e9;
    else eye = (-cU * uU + (-1 / q - cV) * uV + (tn / q - cW) * uW) / (sc * sc);
    for (let y = 0; y < mo.h; y++) { sliceOrder[y] = y; sliceKey[y] = Math.abs(y - mo.pivY - eye); }
    for (let i = 1; i < mo.h; i++) {
      const y = sliceOrder[i], key = sliceKey[y];
      let k = i - 1;
      while (k >= 0 && sliceKey[sliceOrder[k]] < key) { sliceOrder[k + 1] = sliceOrder[k]; k--; }
      sliceOrder[k + 1] = y;
    }
    const it = j.intro, bst = j.boost || 0, burn = j.burn;
    const flameOn = burn > 0.02 && !j.dying;
    const flick = 0.82 + 0.18 * Math.sin(time * 47 + j.x) * Math.sin(time * 31);
    const flameLen = (0.07 + 0.17 * P.afterburner) * mo.l * burn * (1 + 1.6 * bst) * flick, flameWide = 1.15 * (1 + 0.22 * bst);
    const behind = vC + vK > 0.5, bend = clamp(j.yawRate / P.agility, -1, 1) * 0.36, arch = (isLead ? climbTilt : j.pitch) * 0.35;
    const dropOf = y => {   // the intro: slices fall in from the top one after another and land on the stack
      if (it >= 2) return 0;
      const tt = (it - (y - mo.first) * 0.045) / 0.36;
      if (tt <= 0) return NaN;
      return tt < 1 ? -(1 - tt * tt) * ((H >> 1) + 44) : 0;
    };
    // afterburner, sliced the same way so it stacks with the jet
    const flames = (y, bU, bV, bW, drop) => {
      for (const en of mo.engines) {
        const dyv = (y + 0.5 - mo.engineY) / (en.r * 1.25);
        if (dyv <= -1 || dyv >= 1 || flameLen <= 0.5) continue;
        const prof = Math.sqrt(1 - dyv * dyv);
        for (let t = 0; t < flameLen; t += 0.5) {
          const u = t / flameLen, rad = en.r * flameWide * Math.pow(1 - u, 0.75) * prof * (0.9 + 0.2 * Math.sin(t * 1.9 - time * 40 + en.a));
          if (rad < 0.2) continue;
          const b = mo.pivK - mo.nozzleK - t, curl = (t * t) / flameLen, swing = bend * curl, lift = arch * curl;
          for (let a = -rad; a <= rad; a += 0.5) {
            const aa = en.a + a + swing, V = bV + aa * rV + b * fV + lift * uV, den = 1 + q * V;
            if (den < 0.2) continue;
            const m = S / den, heat = u * 0.9 + (Math.abs(a) / (rad + 0.01)) * 0.55 + Math.abs(dyv) * 0.3 - 0.16 * bst;
            const col = flamePal[heat < 0.28 ? 0 : heat < 0.5 ? 1 : heat < 0.75 ? 2 : heat < 1.0 ? 3 : heat < 1.25 ? 4 : 5];
            const fx = Math.round(vCx + m * (bU + aa * rU + b * fU + lift * uU)), fy = Math.round(vCy - m * (bW + aa * rW + b * fW + lift * uW + tn * V) + drop), size = Math.max(1, Math.ceil(m * sc * 0.55));
            for (let yy = fy; yy < fy + size; yy++) for (let xx = fx; xx < fx + size; xx++) {
              if (xx < colLo || yy < rowLo || xx >= colHi || yy >= rowHi) continue;
              const at = yy * W + xx;
              if (_zb[at] < V - 1) continue;
              if (fading && _mk[at] === 0) _bg[at] = _fb[at];
              _fb[at] = col; _mk[at] = 2;
            }
            if (fx < x0) x0 = fx; if (fx + size > x1) x1 = fx + size; if (fy < y0) y0 = fy; if (fy + size > y1) y1 = fy + size;
          }
        }
      }
    };
    for (let n = 0; n < mo.h; n++) {
      const y = sliceOrder[n], cnt = mo.C[y].length;
      if (cnt === 0) continue;
      const drop = dropOf(y);
      if (drop !== drop) continue;
      const hgt = y - mo.pivY, bU = cU + hgt * uU, bV = cV + hgt * uV, bW = cW + hgt * uW;
      J_x0 = x0; J_y0 = y0; J_x1 = x1; J_y1 = y1;
      jetSlice(mo.A[y], mo.B[y], mo.C[y], mo.F[y], 4 | (eye > hgt ? 1 : 2), bU, bV, bW, drop);
      x0 = J_x0; y0 = J_y0; x1 = J_x1; y1 = J_y1;
      if (flameOn && !behind) flames(y, bU, bV, bW, drop);
    }
    if (flameOn && behind) for (let y = 0; y < mo.h; y++) {   // seen from behind, the flames sit in front of the whole tail
      const drop = dropOf(y);
      if (drop !== drop) continue;
      const hgt = y - mo.pivY;
      flames(y, cU + hgt * uU, cV + hgt * uV, cW + hgt * uW, drop);
    }
    // a dark 1 px outline around the whole stack, so it reads over any ground
    x0 = Math.max(colLo + 1, x0 - 4); y0 = Math.max(rowLo + 1, y0 - 4); x1 = Math.min(colHi - 2, x1 + 4); y1 = Math.min(rowHi - 2, y1 + 4);
    const flash = j.flash > 0;
    for (let yy = y0; yy <= y1; yy++) {
      let o = yy * W + x0;
      for (let x = x0; x <= x1; x++, o++) {
        if (fading) { if (_mk[o] !== 0) _fb[o] = mixCol(_bg[o], _fb[o], (fade * 256) | 0); }
        else if (_mk[o] === 0) { if (((_mk[o - 1] | _mk[o + 1] | _mk[o - W] | _mk[o + W]) & 1) === 1 && _zb[o] >= cV - 2) _fb[o] = outlineCol; }
        else if (flash && _mk[o] === 1 && ((x + yy) & 1)) _fb[o] = 0xffffffff;
      }
    }
    for (let yy = y0 - 1; yy <= y1 + 1; yy++) _mk.fill(0, yy * W + x0 - 1, yy * W + x1 + 2);
  }

  // ── motion smoothing. Hard pixels crawl and sparkle as the camera moves, because each frame samples the ground
  // at slightly different places. The fake: every pixel of the world is mixed with the colour the same piece of
  // ground had on the last frame (and, on "strong", the one before), so a pixel that would flip passes through
  // the in-between colour instead.
  // Each earlier frame is looked up where that ground *was* (worked out from its depth and the camera's move, once
  // per 8×8 block); where the depths disagree (something new came into view) the pixel is left alone.
  // The earlier frames are kept as they were drawn, never the mixed result: mixing mixed frames lets the half-pixel
  // rounding of every look-up pile up, and the whole picture then swims like jelly.
  // Jets, shots, smoke and the HUD are drawn afterwards and stay crisp.
  let smooth = 2, hKind = 0, hCount = 0, hSlot = 0;
  let HF = [], HFZ = [], HS = [], HSZ = [];
  const hCam = [0, 1, 2].map(() => ({ x: 0, y: 0, alt: 0, cos: 1, sin: 0, q: 0, S: 1, tan: 1, cx: 0, cy: 0, c0: 0, c1: 0, r0: 0, r1: 0 }));
  let mvX = new Int16Array(0), mvY = new Int16Array(0), mvD = new Float32Array(0), mvX2 = new Int16Array(0), mvY2 = new Int16Array(0), mvD2 = new Float32Array(0);
  let T_a = null, T_az = null, T_b = null, T_bz = null, T_ca = null, T_cb = null;
  // where each block of this frame was in an earlier frame p (and how much deeper it sat there)
  function blockMoves(p, MX, MY, MD) {
    const c = vCos, s = vSin, q = vQ, S = vS, tn = vTan, Cx = vCx, Cy = vCy, A = cam.alt, ox = cam.x - p.x, oy = cam.y - p.y, Wd = W, _zb = zbuf;
    let b = 0;
    for (let by = rowLo; by < rowHi; by += 8) for (let bx = colLo; bx < colHi; bx += 8, b++) {
      const px = Math.min(colHi - 1, bx + 4), py = Math.min(rowHi - 1, by + 4), v = _zb[py * Wd + px];
      MX[b] = -32768;
      if (v > 1e8) continue;   // sky
      const m = S / (1 + q * v), U = (px - Cx) / m, z = A + (Cy - py) / m - tn * v;
      const dx = U * c - v * s + ox, dy = -U * s - v * c + oy, dp = -(dx * p.sin + dy * p.cos), den = 1 + p.q * dp;
      if (den < 0.12) continue;
      const m2 = p.S / den, mx = Math.round(p.cx + m2 * (dx * p.cos - dy * p.sin) - px), my = Math.round(p.cy - m2 * (z - p.alt + p.tan * dp) - py);
      if (mx > 150 || mx < -150 || my > 150 || my < -150) continue;
      MX[b] = mx; MY[b] = my; MD[b] = dp - v;
    }
  }
  function smoothRow(y, b, two) {
    const _fb = fb, _zb = zbuf, Wd = W, x1 = colHi, A = T_a, AZ = T_az, B = T_b, BZ = T_bz, ca = T_ca, cb2 = T_cb;
    const ac0 = ca.c0, ac1 = ca.c1, bc0 = two ? cb2.c0 : 0, bc1 = two ? cb2.c1 : 0;
    for (let bx = colLo; bx < x1; bx += 8, b++) {
      const ax = mvX[b], bm = two ? mvX2[b] : -32768, say = y + mvY[b], sby = y + mvY2[b];
      const okA = ax !== -32768 && say >= ca.r0 && say < ca.r1, okB = bm !== -32768 && sby >= cb2.r0 && sby < cb2.r1;
      if (!okA && !okB) continue;
      const da = mvD[b], db = mvD2[b], xe = bx + 8 < x1 ? bx + 8 : x1;
      for (let x = bx, o = y * Wd + bx; x < xe; x++, o++) {
        const v = _zb[o], tol = 3 + (v < 0 ? -v : v) * 0.04, n = _fb[o];
        let ha = 0, hb = 0, gotA = false, gotB = false;
        if (okA) {
          const sx = x + ax;
          if (sx >= ac0 && sx < ac1) { const so = say * Wd + sx, d = AZ[so] - v - da; if (d <= tol && d >= -tol) { ha = A[so]; gotA = true; } }
        }
        if (okB) {
          const sx = x + bm;
          if (sx >= bc0 && sx < bc1) { const so = sby * Wd + sx, d = BZ[so] - v - db; if (d <= tol && d >= -tol) { hb = B[so]; gotB = true; } }
        }
        // (the mean of two colours, all channels at once.) This frame always counts for half, so the picture
        // stays exactly where it belongs; the earlier frames share the other half.
        if (gotA && gotB) ha = (ha & hb) + (((ha ^ hb) & 0xfefefefe) >>> 1); else if (gotB) ha = hb;
        if (gotA || gotB) _fb[o] = (ha & n) + (((ha ^ n) & 0xfefefefe) >>> 1);
      }
    }
  }
  function smoothWorld(kind) {
    const bufs = kind === 2 ? HS : HF, zs = kind === 2 ? HSZ : HFZ, Wd = W, _zb = zbuf;
    if (hKind !== kind) { hKind = kind; hCount = 0; }
    // keep this frame as drawn (and its depths, and the camera) …
    const slot = hSlot, h = bufs[slot], hz = zs[slot], p = hCam[slot];
    if (colLo === 0 && colHi === Wd) { const a = rowLo * Wd, e = rowHi * Wd; h.set(fb.subarray(a, e), a); hz.set(_zb.subarray(a, e), a); }
    else for (let y = rowLo; y < rowHi; y++) { const a = y * Wd + colLo, e = y * Wd + colHi; h.set(fb.subarray(a, e), a); hz.set(_zb.subarray(a, e), a); }
    p.x = cam.x; p.y = cam.y; p.alt = cam.alt; p.cos = vCos; p.sin = vSin; p.q = vQ; p.S = vS; p.tan = vTan; p.cx = vCx; p.cy = vCy;
    p.c0 = colLo; p.c1 = colHi; p.r0 = rowLo; p.r1 = rowHi;
    // … then mix the one or two before it into the picture
    if (hCount > 0) {
      const s1 = (slot + 2) % 3, s2 = (slot + 1) % 3, two = smooth === 2 && hCount > 1, bw = (colHi - colLo + 7) >> 3;
      T_a = bufs[s1]; T_az = zs[s1]; T_ca = hCam[s1]; T_b = bufs[s2]; T_bz = zs[s2]; T_cb = hCam[s2];
      blockMoves(T_ca, mvX, mvY, mvD);
      if (two) blockMoves(T_cb, mvX2, mvY2, mvD2);
      for (let y = rowLo; y < rowHi; y++) smoothRow(y, ((y - rowLo) >> 3) * bw, two);
    }
    hSlot = (slot + 1) % 3;
    if (hCount < 2) hCount++;
  }

  // ── cockpit: the world is drawn on a larger square sheet and then turned, so the horizon tilts with the bank
  function turnRow(o, n, sx, sy, c, s, lo, hi) {
    const _fb = fb, _sh = sheet, side = sheetSide;
    for (const end = o + n; o < end; o++, sx += c, sy += s) { const yy = sy | 0; _fb[o] = yy >= lo && yy < hi ? _sh[yy * side + (sx | 0)] : 0xff000000; }
  }
  function turnSheet(lo, hi, kap) {
    const c = Math.cos(vRoll) * kap, s = Math.sin(vRoll) * kap, half = sheetSide >> 1, cx = W >> 1;
    for (let y = 0; y < H; y++) {
      const dy = y - pivotY;
      turnRow(y * W, W, half - c * cx - s * dy + 0.5, half - s * cx + c * dy + 0.5, c, s, lo, hi);
    }
  }
  const radarLand = (right, ahead) => {
    const sn = Math.sin(lead.yaw), cs = Math.cos(lead.yaw), m = matAt(lead.x + right * cs + ahead * sn, lead.y + right * sn - ahead * cs);
    return m >= M_ROCK && m <= M_PEAKD ? 3 : m >= NWATER ? 2 : m >= M_SHALLOW ? 1 : 0;
  };

  // ── in-frame HUD for the overhead and chase views: lock box, off-screen arrows, gun pipper
  // 3 × 5 pixel glyphs, three bits a row from the top
  const GLYPH = {
    0: 0x7b6f, 1: 0x2c97, 2: 0x73e7, 3: 0x73cf, 4: 0x5bc9, 5: 0x79cf, 6: 0x79ef, 7: 0x7249, 8: 0x7bef, 9: 0x7bcf,
    A: 0x2bed, B: 0x6bae, C: 0x7927, D: 0x6b6e, E: 0x79e7, F: 0x79e4, G: 0x796f, H: 0x5bed, I: 0x7497, K: 0x5bad, L: 0x4927, M: 0x5fed,
    N: 0x6b6d, O: 0x7b6f, P: 0x7be4, R: 0x6bad, S: 0x79cf, T: 0x7492, U: 0x5b6f, V: 0x5b6a, W: 0x5bfd, X: 0x5aad, Y: 0x5a92,
  };
  function text(x, y, str, col, sc = 1) {
    for (const ch of str) {
      const g = GLYPH[ch];
      if (g) for (let r = 0; r < 5; r++) for (let b = 0; b < 3; b++) if (g & (1 << (14 - r * 3 - b))) rect(x + b * sc, y + r * sc, sc, sc, col);
      x += 4 * sc;
    }
  }
  function rect(x, y, w, h, col) {
    const x1 = Math.min(W, x + w), y1 = Math.min(H, y + h);
    for (let yy = Math.max(0, y); yy < y1; yy++) for (let xx = Math.max(0, x); xx < x1; xx++) fb[yy * W + xx] = col;
  }
  // a read-out box in the style of the concept art: dark glass, a bright rim with cut corners
  const HUD_BG = pack(8, 44, 40), HUD_RIM = pack(96, 232, 150), HUD_TX = pack(190, 255, 214), HUD_DIM = pack(40, 120, 84);
  function panel(x, y, w, h) {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) {
      if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
      const ex = Math.min(xx - x, x + w - 1 - xx), ey = Math.min(yy - y, y + h - 1 - yy);
      if (ex + ey < 2) continue;                                   // cut corners
      const o = yy * W + xx;
      fb[o] = ex === 0 || ey === 0 || ex + ey === 2 ? HUD_RIM : mixCol(fb[o], HUD_BG, ((xx + yy) & 1) ? 216 : 190);
    }
  }
  function drawPanels() {
    const u = H >= 330 ? 2 : 1, gw = 4 * u, ph = 5 * u + 6, pad = 4;
    const box = (x, y, label, value) => {
      const w = (label.length + value.length + 1) * gw + 8;
      panel(x, y, w, ph);
      text(x + pad, y + 3, label, HUD_RIM, u); text(x + pad + (label.length + 1) * gw, y + 3, value, HUD_TX, u);
      return w;
    };
    box(5, 5, 'SPD', String(Math.round(speedNow * 4.4)).padStart(4, '0'));
    box(5, 7 + ph, 'ALT', String(Math.round(lead.z * 10)).padStart(4, '0'));
    const kw = (4 + 1 + 3) * gw + 8;
    box(W - 5 - kw, 5, 'KILL', String(cb.kills).padStart(3, '0'));
    // hull and missiles, under the speed and height (the bottom corners stay clear for touch buttons)
    const by = 5 + (ph + 2) * 3, bw = 3 * gw + 8 + 4 * (3 * u + 2) + 6, bx = 5;
    panel(bx, by, bw, ph); text(bx + pad, by + 3, 'MSL', HUD_RIM, u);
    for (let i = 0; i < 4; i++) rect(bx + pad + 4 * gw + i * (3 * u + 2), by + 3, 3 * u, 5 * u, i < cb.msl ? pack(255, 214, 90) : HUD_DIM);
    panel(bx, by - ph - 2, bw, ph); text(bx + pad, by - ph + 1, 'HP', HUD_RIM, u);
    const hw = bw - pad * 2 - 3 * gw, fill = Math.round((hw * cb.hp) / 100), hc = cb.hp > 50 ? pack(110, 240, 130) : cb.hp > 25 ? pack(255, 200, 70) : pack(255, 80, 60);
    rect(bx + pad + 3 * gw, by - ph + 1, hw, 5 * u, HUD_DIM); rect(bx + pad + 3 * gw, by - ph + 1, fill, 5 * u, hc);
    // radar, top right under the kill count: the ground round the jet with the nose up, enemies as blips
    const R = 12 * u + 4, cx = W - 6 - R, cy = 8 + ph + R, sn = Math.sin(lead.yaw), cs = Math.cos(lead.yaw), range = 520;
    const sweep = (time * 2.4) % 6.283;
    for (let yy = -R; yy <= R; yy++) for (let xx = -R; xx <= R; xx++) {
      const d2 = xx * xx + yy * yy;
      if (d2 > R * R) continue;
      const o = (cy + yy) * W + cx + xx;
      if (d2 > (R - 1) * (R - 1)) { fb[o] = HUD_RIM; continue; }
      const right = (xx / R) * range, ahead = (-yy / R) * range, m = matAt(lead.x + right * cs + ahead * sn, lead.y + right * sn - ahead * cs);
      let col = m >= NWATER ? pack(30, 130, 80) : m >= M_SHALLOW ? pack(14, 76, 62) : HUD_BG;
      const d = Math.sqrt(d2), ring = Math.abs(d - R * 0.5) < 0.5 || xx === 0 || yy === 0;
      if (ring) col = mixCol(col, HUD_RIM, 90);
      const a = (Math.atan2(xx, -yy) - sweep + 12.566) % 6.283;
      if (a > 5.6) col = mixCol(col, HUD_RIM, ((a - 5.6) * 200) | 0);
      fb[o] = mixCol(fb[o], col, 226);
    }
    for (const e of enemies) {
      if (e.dying) continue;
      const ex = e.x - lead.x, ey = e.y - lead.y;
      let rx = ((ex * cs + ey * sn) / range) * R, ry = (-(ex * sn - ey * cs) / range) * R;
      const d = Math.hypot(rx, ry);
      if (d > R - 2) { rx *= (R - 2) / d; ry *= (R - 2) / d; }
      rect(Math.round(cx + rx) - 1, Math.round(cy + ry) - 1, u + 1, u + 1, e === cb.lock ? pack(255, 70, 60) : pack(255, 190, 70));
    }
    rect(cx - 1, cy - 2, 2, 1, HUD_TX); rect(cx - 2, cy - 1, 4, 2, HUD_TX);   // own ship
  }
  const hline = (x0, x1, y, col) => { if (y < 0 || y >= H) return; for (let x = Math.max(0, x0); x <= Math.min(W - 1, x1); x++) fb[y * W + x] = col; };
  const vline = (x, y0, y1, col) => { if (x < 0 || x >= W) return; for (let y = Math.max(0, y0); y <= Math.min(H - 1, y1); y++) fb[y * W + x] = col; };
  function bracket(x, y, r, col) {
    const L = Math.max(3, r >> 1);
    x |= 0; y |= 0;
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
      const cx = x + sx * r, cy = y + sy * r;
      hline(Math.min(cx, cx - sx * L), Math.max(cx, cx - sx * L), cy, col); vline(cx, Math.min(cy, cy - sy * L), Math.max(cy, cy - sy * L), col);
    }
  }
  function drawHud() {
    const red = pack(255, 60, 48), yel = pack(255, 226, 74), org = pack(255, 150, 40), dark = pack(40, 22, 10), grn = pack(120, 255, 164);
    const t = cb.lock;
    if (t && t.vis) {
      const locked = cb.lockT >= LOCK_TIME, r = Math.round(clamp(t.sm * 34, 9, 40) + (locked ? 0 : (1 - cb.lockT / LOCK_TIME) * 14));
      if (locked || ((time * 10) | 0) & 1) { bracket(t.sx, t.sy, r, locked ? red : yel); if (locked) text((t.sx | 0) - 8, (t.sy | 0) + r + 3, 'LOCK', red); }
    }
    for (const e of enemies) {   // arrows on the frame edge towards enemies that are out of view
      if (e.dying) continue;
      const on = e.vis && e.sx > 4 && e.sx < W - 4 && e.sy > 4 && e.sy < H - 4;
      if (on) continue;
      let dx = e.sx - vCx, dy = e.sy - vCy;
      if (e.sv < -1 / Math.max(vQ, 1e-6) * 0.8) { dx = -dx; dy = Math.abs(dy) + H; }   // behind the camera
      const k = Math.min((dx > 0 ? W - 8 - vCx : vCx - 8) / Math.abs(dx || 1e-9), (dy > 0 ? H - 8 - vCy : vCy - 8) / Math.abs(dy || 1e-9));
      const x = Math.round(vCx + dx * k), y = Math.round(vCy + dy * k);
      for (let yy = -3; yy <= 3; yy++) for (let xx = -3; xx <= 3; xx++) {
        const d = Math.abs(xx) + Math.abs(yy);
        if (d <= 3 && x + xx >= 0 && y + yy >= 0 && x + xx < W && y + yy < H) fb[(y + yy) * W + x + xx] = d === 3 ? dark : e === t ? red : org;
      }
    }
    if (vC > 0.6 && !cb.dead && lead.intro > 2) {   // gun pipper: where the rounds will be in half a second
      const ax = axes(lead);
      if (project(lead.x + ax.fx * 300, lead.y + ax.fy * 300, lead.z + ax.fz * 300)) {
        const x = prX | 0, y = prY | 0;
        hline(x - 6, x - 3, y, grn); hline(x + 3, x + 6, y, grn); vline(x, y - 6, y - 3, grn); vline(x, y + 3, y + 6, grn); if (x >= 0 && y >= 0 && x < W && y < H) fb[y * W + x] = grn;
      }
    }
  }
  // a hit flashes red round the edge of the frame (dithered, so it stays pixel art)
  function tintRow(y, k) {
    const _fb = fb, Wd = W, red = pack(255, 48, 36), e = Math.min(y, H - 1 - y), by = (y & 3) << 2;
    for (let x = 0, o = y * Wd; x < Wd; x++, o++) {
      const d = Math.min(e, x, Wd - 1 - x);
      if (d < 26 && (26 - d) * k > BAYER[by | (x & 3)] * 30) _fb[o] = mixCol(_fb[o], red, 130);
    }
  }
  function tintHit() {
    if (cb.hit <= 0.02) return;
    for (let y = 0; y < H; y++) tintRow(y, cb.hit * 14);
  }

  function render() {
    updateView();
    frameH = H;
    const rolled = vK > 0 || vRoll !== 0, w0 = W, h0 = H, f0 = fb, c0 = colY, m0 = jetMask, z0 = zbuf, b0 = backdrop, y0 = vCy, x0 = vCx, S0 = vS;
    // The sheet is turned (resampled) into the frame anyway, so inside the cockpit the world is drawn on it a
    // little smaller and enlarged by the turn: far fewer pixels to fill, behind full-resolution instruments.
    const kap = rolled ? 1 - 0.25 * cockpitIn() : 1;
    if (rolled) {
      W = sheetSide; H = sheetSide; fb = sheet; colY = sheetColY; jetMask = sheetMask; zbuf = sheetZ; backdrop = sheetBackdrop;
      const half = sheetSide >> 1, hw = (w0 / 2) * kap, up = pivotY * kap;
      vS = S0 * kap; vCx = half + (x0 - (w0 >> 1)) * kap; vCy = half + (y0 - pivotY) * kap; frameH = h0 * kap;
      const c = Math.abs(Math.cos(vRoll)), s = Math.abs(Math.sin(vRoll)), tall = Math.max(pivotY, h0 - pivotY) * kap;
      colLo = Math.max(0, half - Math.ceil(c * hw + s * tall) - 2); colHi = Math.min(sheetSide, half + Math.ceil(c * hw + s * tall) + 2);
      // (once the cockpit is in place its panel hides the bottom of the frame, so that part is not drawn)
      const seen = (h0 - pivotY - (vK > 0.999 ? h0 * 0.33 : 0)) * kap;
      rowLo = Math.max(0, half - Math.ceil(c * up + s * hw) - 2); rowHi = Math.min(sheetSide, half + Math.ceil(c * seen + s * hw) + 2);
    } else { colLo = 0; colHi = W; rowLo = 0; rowHi = H; }
    const t0 = performance.now();
    drawWorld();
    const t1 = performance.now();
    drawSky();
    if (smooth > 0) smoothWorld(rolled ? 2 : 1); else hKind = 0;
    if (!(jetFade < 0.5)) drawTrail(lead);
    for (const e of enemies) drawTrail(e);
    drawPuffs(false);
    const t2 = performance.now();
    // far jets first
    const order = enemies.map(e => ({ j: e, d: (e.x - cam.x) * vSin + (e.y - cam.y) * vCos }));
    if (!cb.dead) order.push({ j: lead, d: (lead.x - cam.x) * vSin + (lead.y - cam.y) * vCos });
    order.sort((a, b) => a.d - b.d);
    lead.flash = cb.inv > 0 && cb.hp < 100 ? 0 : 0;
    for (const e of order) if (e.j !== lead || !(cb.inv > 0 && lead.intro > 2 && ((time * 12) | 0) & 1)) drawJet(e.j, e.j === lead);
    const t3 = performance.now();
    drawShots();
    drawPuffs(true);
    drawSparks();
    if (rolled) {
      W = w0; H = h0; fb = f0; colY = c0; jetMask = m0; zbuf = z0; backdrop = b0; vCx = x0; vCy = y0; vS = S0;
      turnSheet(rowLo, rowHi, kap);
      // things placed on the sheet turn with it
      const half = sheetSide >> 1, rc = Math.cos(vRoll) / kap, rs = Math.sin(vRoll) / kap;
      for (const e of enemies) { const dx = e.sx - half, dy = e.sy - half; e.sx = (W >> 1) + rc * dx + rs * dy; e.sy = pivotY - rs * dx + rc * dy; e.sm /= kap; }
      colLo = 0; colHi = W; rowLo = 0; rowHi = H;
    }
    const inPlace = cockpitIn();
    if (inPlace < 0.5) { drawHud(); drawPanels(); }
    if (inPlace > 0) {
      if (!cockpit) cockpit = buildCockpit(W, H);
      const sn = Math.sin(lead.yaw), cs = Math.cos(lead.yaw), blips = [], targets = [];
      for (const e of enemies) {
        if (e.dying) continue;
        const ex = e.x - lead.x, ey = e.y - lead.y;
        blips.push(ex * cs + ey * sn, ex * sn - ey * cs);
        if (e !== cb.lock && e.vis && e.sv > -30) targets.push({ x: e.sx, y: e.sy, dist: Math.hypot(ex, ey) });
      }
      const t = cb.lock, sl = Math.hypot(sunX, sunY) || 1;
      drawCockpit(fb, W, H, cockpit, {
        time, inPlace, roll: vRoll, pitch: lead.pitch, heading: lead.yaw, speed: speedNow * 4.4, speedMax: P.speed * P.boost * 4.8, alt: lead.z * 100, altMax: P.ceiling * 100,
        climb: clamp(climbTilt / 0.5, -1, 1), turn: clamp(lead.yawRate / P.agility, -1, 1), boost, pivotY, horizonY: vCy, focal: vS / vQ,
        headX, headY: headY + (boost > 0.2 && !calm ? ((((time * 30) | 0) & 1) - 0.5) * 1.5 * boost : 0),
        hp: cb.hp / 100, missiles: cb.msl, kills: cb.kills, hit: cb.hit, firing: cb.firing,
        lock: t && t.vis ? { x: t.sx, y: t.sy, locked: cb.lockT >= LOCK_TIME, range: Math.hypot(t.x - lead.x, t.y - lead.y) } : null,
        targets, blips, land: radarLand, sunSide: (-sunX * cs - sunY * sn) / sl,
      });
    }
    tintHit();
    const t4 = performance.now(), pf = prof;
    pf.world += t1 - t0; pf.sky += t2 - t1; pf.jets += t3 - t2; pf.rest += t4 - t3; pf.n++;
    return bytes;
  }

  // ── boot
  rebuildPalettes();
  buildWorld();
  resetFlight();
  for (let i = 0; i < 4; i++) spawnEnemy();

  return {
    resize, step, render, fireMissile, models,
    pointerMove(x, y) { keyMode = false; pointerOn = true; pointerX = x; pointerY = y; },
    pointerLeave() { pointerOn = false; },
    setHolding(v) { holding = v; },
    setKeys(turn, climb, b) { keyTurn = turn; keyClimb = climb; boostKey = b; if (turn !== 0) keyMode = true; },
    nudgeAlt(d) { altGoal = clamp(altGoal + d, floorS, P.ceiling); },
    startRoll(dir) { if (lead.stunt < 0 && !cb.dead) { lead.stunt = 0; lead.stuntDir = dir || (lead.yawRate >= 0 ? 1 : -1); camSpin = vK > 0.5 ? 1 : 0; } },
    toggleView() { viewTarget = (viewTarget + 1) % 3; },
    setView(v, snap) { viewTarget = clamp(v | 0, 0, 2); if (snap) { wChase.fill(v === 1 ? 1 : 0); wCock.fill(v === 2 ? 1 : 0); vC = wChase[2]; vK = wCock[2]; } },
    toggleCalm() { calm = !calm; return calm; },
    cycleSmooth() { smooth = (smooth + 1) % 3; return smooth; },
    cycleTime() { tod = (tod + 1) % 3; rebuildPalettes(); cockpit = null; return tod; },
    get width() { return W; }, get height() { return H; }, get view() { return viewTarget; },
    get lead() { return lead; }, get cb() { return cb; }, get enemies() { return enemies; }, get speed() { return speedNow; },
    killEnemy, explode, P, prof, debug: { get cam() { return cam; }, set altGoal(v) { altGoal = v; }, get altGoal() { return altGoal; } },
  };
}
