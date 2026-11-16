// Pixel-art fighter cockpit + HUD, painted procedurally into a Uint32 framebuffer (pixel = 0xAABBGGRR).
//   buildCockpit(W, H)                  -> art   (once per resolution; pre-renders four depth layers + sprites)
//   drawCockpit(fb, W, H, art, live)    every frame, after the world is in fb (same W, H as the build)
// Sizes are "design pixels" of a 640x360 frame (u = H/360); horizontal positions are measured from the
// screen centre, so other aspect ratios stay centred. No canvas calls: typed-array writes only.
// Draw order, far to near: canopy hoop, HUD glass + symbology, instrument panel (+ screens, ball, dials),
// consoles + throttle, stick, frame behind the head. Each shifts by -head * CK_NEAR[layer].
// Roll: roll > 0 = right wing down, so the horizon turns counter-clockwise on screen:
//   screen = pivot + (x0*cos(r) + y0*sin(r), -x0*sin(r) + y0*cos(r)), pivot = (W/2, live.pivotY).
//   Flip CK_ROLL_SIGN if the game rolls the world the other way.
// inPlace: panel, consoles and stick rise from below; hoop and rear frame come down from above.

const CK_ROLL_SIGN = 1;
// how far each depth layer shifts per design pixel of head sway (nearer = more)
const CK_NEAR = { hoop: 0.3, glass: 0.5, panel: 0.72, deck: 1, lever: 1.12, stick: 1.32, rear: 1.65 };

const CK_rgb = (r, g, b) => ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0;
const CK_BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
// cockpit metal, dark -> light (slate blue steel)
const CK_B = [CK_rgb(9, 13, 21), CK_rgb(17, 25, 37), CK_rgb(25, 37, 52), CK_rgb(36, 53, 70), CK_rgb(51, 73, 92),
  CK_rgb(73, 99, 118), CK_rgb(105, 134, 150), CK_rgb(150, 180, 191), CK_rgb(208, 230, 234)];
// orange-red paint
const CK_A = [CK_rgb(104, 26, 34), CK_rgb(164, 44, 36), CK_rgb(222, 70, 40), CK_rgb(246, 108, 48), CK_rgb(255, 158, 78), CK_rgb(255, 214, 150)];
const CK_GL = [CK_rgb(18, 57, 78), CK_rgb(18, 104, 133), CK_rgb(32, 157, 184), CK_rgb(93, 213, 229), CK_rgb(192, 246, 250)];
const CK_CRT = [CK_rgb(3, 18, 14), CK_rgb(5, 36, 25), CK_rgb(10, 66, 42), CK_rgb(24, 138, 76), CK_rgb(72, 222, 126), CK_rgb(190, 255, 212)];
const CK_LAMP = [CK_rgb(112, 84, 24), CK_rgb(255, 204, 80), CK_rgb(255, 244, 190)];
const CK_SKY = [CK_rgb(48, 108, 200), CK_rgb(76, 146, 228), CK_rgb(130, 192, 246)];
const CK_EARTH = [CK_rgb(100, 58, 26), CK_rgb(138, 84, 38), CK_rgb(178, 118, 58)];
const CK_RED = CK_rgb(255, 72, 60), CK_REDD = CK_rgb(150, 30, 34), CK_YEL = CK_rgb(255, 228, 84);
const CK_WHITE = CK_rgb(255, 255, 255), CK_BLACK = CK_rgb(0, 0, 0), CK_GLINT = CK_rgb(232, 246, 255);
const CK_HUD = CK_rgb(118, 255, 158), CK_HUDSH = CK_rgb(10, 60, 46);

const CK_clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const CK_hash = n => { n = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b); n ^= n >>> 13; n = Math.imul(n, 0xc2b2ae35); return (n ^ (n >>> 16)) & 255; };
// blend b over a, k of 256
const CK_mix = (a, b, k) => (0xff000000 | ((((a & 0xff00ff) * (256 - k) + (b & 0xff00ff) * k) >>> 8) & 0xff00ff) | ((((a & 0xff00) * (256 - k) + (b & 0xff00) * k) >>> 8) & 0xff00)) >>> 0;
const CK_num = (v, n) => String(Math.max(0, Math.round(v || 0))).padStart(n, '0');
const CK_nice = v => { if (!(v > 0)) return 1; const p = Math.pow(10, Math.floor(Math.log10(v))), m = v / p; return (m >= 5 ? 5 : m >= 2 ? 2 : 1) * p; };

// fonts: one number per row, most significant bit = left pixel
const CK_F3 = { w: 3, h: 5, g: {
  '0': [7, 5, 5, 5, 7], '1': [2, 6, 2, 2, 7], '2': [7, 1, 7, 4, 7], '3': [7, 1, 7, 1, 7], '4': [5, 5, 7, 1, 1], '5': [7, 4, 7, 1, 7], '6': [7, 4, 7, 5, 7],
  '7': [7, 1, 1, 2, 2], '8': [7, 5, 7, 5, 7], '9': [7, 5, 7, 1, 7], A: [2, 5, 7, 5, 5], B: [6, 5, 6, 5, 6], C: [3, 4, 4, 4, 3], D: [6, 5, 5, 5, 6], E: [7, 4, 6, 4, 7],
  F: [7, 4, 6, 4, 4], G: [3, 4, 5, 5, 3], H: [5, 5, 7, 5, 5], I: [7, 2, 2, 2, 7], K: [5, 5, 6, 5, 5], L: [4, 4, 4, 4, 7], M: [5, 7, 7, 5, 5], N: [6, 5, 5, 5, 5],
  O: [2, 5, 5, 5, 2], P: [6, 5, 6, 4, 4], R: [6, 5, 6, 5, 5], S: [3, 4, 2, 1, 6], T: [7, 2, 2, 2, 2], U: [5, 5, 5, 5, 7], V: [5, 5, 5, 5, 2], W: [5, 5, 7, 7, 5],
  X: [5, 5, 2, 5, 5], Y: [5, 5, 2, 2, 2], '+': [0, 2, 7, 2, 0], '-': [0, 0, 7, 0, 0] } };
const CK_F5 = { w: 5, h: 7, g: {
  '0': [14, 17, 19, 21, 25, 17, 14], '1': [4, 12, 4, 4, 4, 4, 14], '2': [14, 17, 1, 2, 4, 8, 31], '3': [31, 2, 4, 2, 1, 17, 14], '4': [2, 6, 10, 18, 31, 2, 2],
  '5': [31, 16, 30, 1, 1, 17, 14], '6': [6, 8, 16, 30, 17, 17, 14], '7': [31, 1, 2, 4, 8, 8, 8], '8': [14, 17, 17, 14, 17, 17, 14], '9': [14, 17, 17, 15, 1, 2, 12],
  L: [16, 16, 16, 16, 16, 16, 31], O: [14, 17, 17, 17, 17, 17, 14], C: [14, 17, 16, 16, 16, 17, 14], K: [17, 18, 20, 24, 20, 18, 17] } };
const CK_tw = (font, n, sc) => n * (font.w + 1) * sc - sc;
// status-screen jet, nose up
const CK_JET = ['......#......', '......#......', '.....###.....', '.....###.....', '.....###.....', '....#####....', '...#######...', '..#########..',
  '.###########.', '#############', '##..#####..##', '....#####....', '...#######...', '..###.#.###..', '..##..#..##..'];
const CK_MP = [[3, 3], [9, 3], [1, 5], [11, 5]]; // missile rails on the glyph: column, first row

// a small drawing surface over a pixel buffer; (ox, oy) moves everything drawn on it
const CK_Sheet = class {
  constructor(buf, W, H, ox, oy) { this.buf = buf; this.W = W; this.H = H; this.ox = ox | 0; this.oy = oy | 0; this.mask = null; this.mx = 0; this.my = 0; this.mw = 0; this.mh = 0; }
  put(x, y, c) {
    x = Math.floor(x + 0.5) + this.ox; y = Math.floor(y + 0.5) + this.oy;
    if (x < 0 || y < 0 || x >= this.W || y >= this.H) return;
    if (this.mask) { const qx = x - this.mx, qy = y - this.my; if (qx < 0 || qy < 0 || qx >= this.mw || qy >= this.mh || !this.mask[qy * this.mw + qx]) return; }
    this.buf[y * this.W + x] = c;
  }
  get(x, y) { x += this.ox; y += this.oy; return x >= 0 && y >= 0 && x < this.W && y < this.H ? this.buf[y * this.W + x] : 0; }
  // filled box, right and bottom edges excluded
  box(x0, y0, x1, y1, c) {
    x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
    if (this.mask) { for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) this.put(x, y, c); return; }
    x0 += this.ox; x1 += this.ox; y0 += this.oy; y1 += this.oy;
    if (x0 < 0) x0 = 0; if (y0 < 0) y0 = 0; if (x1 > this.W) x1 = this.W; if (y1 > this.H) y1 = this.H;
    if (x0 >= x1) return;
    for (let y = y0; y < y1; y++) this.buf.fill(c, y * this.W + x0, y * this.W + x1);
  }
  frame(x0, y0, x1, y1, c) { this.box(x0, y0, x1, y0 + 1, c); this.box(x0, y1 - 1, x1, y1, c); this.box(x0, y0, x0 + 1, y1, c); this.box(x1 - 1, y0, x1, y1, c); }
  line(xa, ya, xb, yb, c, on, off) { // optional dash pattern
    const n = Math.max(1, Math.ceil(Math.max(Math.abs(xb - xa), Math.abs(yb - ya)))), per = on ? on + off : 0;
    for (let i = 0; i <= n; i++) if (!per || i % per < on) this.put(xa + (xb - xa) * i / n, ya + (yb - ya) * i / n, c);
  }
  disc(cx, cy, r, c) { const ri = Math.ceil(r); for (let dy = -ri; dy <= ri; dy++) for (let dx = -ri; dx <= ri; dx++) if (dx * dx + dy * dy <= r * r) this.put(cx + dx, cy + dy, c); }
  circle(cx, cy, r, c) { const n = Math.ceil(r * 9); for (let i = 0; i < n; i++) this.put(cx + Math.cos(i / n * 6.2832) * r, cy + Math.sin(i / n * 6.2832) * r, c); }
  text(x, y, str, c, font, sc) {
    x = Math.round(x); y = Math.round(y);
    for (let i = 0; i < str.length; i++) {
      const g = font.g[str[i]]; if (!g) continue;
      for (let r = 0; r < font.h; r++) for (let q = 0; q < font.w; q++) if (g[r] & (1 << (font.w - 1 - q))) {
        if (sc === 1) this.put(x + i * (font.w + 1) + q, y + r, c);
        else this.box(x + (i * (font.w + 1) + q) * sc, y + r * sc, x + (i * (font.w + 1) + q + 1) * sc, y + (r + 1) * sc, c);
      }
    }
  }
  // raised plate: lit top/left, dark bottom/right
  plate(x0, y0, x1, y1, face, lit, dark) { this.box(x0, y0, x1, y1, face); this.box(x0, y0, x1, y0 + 1, lit); this.box(x0, y0, x0 + 1, y1, lit); this.box(x0, y1 - 1, x1, y1, dark); this.box(x1 - 1, y0, x1, y1, dark); }
  // sunk well: shadow top/left, lit bottom/right
  well(x0, y0, x1, y1, face, lit, dark) { this.box(x0, y0, x1, y1, face); this.box(x0, y0, x1, y0 + 2, dark); this.box(x0, y0, x0 + 2, y1, dark); this.box(x0 + 1, y1 - 1, x1, y1, lit); this.box(x1 - 1, y0 + 1, x1, y1, lit); }
  // ring-headed bolt, 3x3
  bolt(x, y) { const B = CK_B; this.put(x + 1, y + 1, B[0]); this.put(x, y - 1, B[8]); this.put(x - 1, y, B[7]); this.put(x + 1, y, B[4]); this.put(x, y + 1, B[3]); this.put(x, y, B[1]); }
  // large ring bolt, 4x4
  bigbolt(x, y) {
    const B = CK_B; this.put(x + 1, y + 1, B[0]); this.put(x + 2, y, B[0]); this.put(x - 1, y - 2, B[7]); this.put(x, y - 2, B[8]);
    this.put(x - 2, y - 1, B[7]); this.put(x - 1, y - 1, B[2]); this.put(x, y - 1, B[1]); this.put(x + 1, y - 1, B[5]);
    this.put(x - 2, y, B[6]); this.put(x - 1, y, B[1]); this.put(x, y, B[0]); this.put(x + 1, y, B[4]); this.put(x - 1, y + 1, B[4]); this.put(x, y + 1, B[3]);
  }
  // small screw head, 2x2
  screw(x, y) { const B = CK_B; this.box(x, y, x + 2, y + 2, B[0]); this.put(x, y, B[7]); }
  // corner brackets of a square of half-size s
  brackets(x, y, s, len, c) {
    for (let sx = -1; sx <= 1; sx += 2) for (let sy = -1; sy <= 1; sy += 2) {
      this.line(x + sx * s, y + sy * s, x + sx * (s - len), y + sy * s, c); this.line(x + sx * s, y + sy * s, x + sx * s, y + sy * (s - len), c);
    }
  }
};

// row runs of opaque pixels, so a layer can be laid without testing every pixel
const CK_runs = (buf, aw, ah) => {
  const idx = new Int32Array(ah + 1), xs = []; let y0 = ah, y1 = 0;
  for (let y = 0; y < ah; y++) {
    idx[y] = xs.length; const o = y * aw; let x = 0;
    for (;;) { while (x < aw && buf[o + x] === 0) x++; if (x >= aw) break; const s = x; while (x < aw && buf[o + x] !== 0) x++; xs.push(s, x); }
    if (xs.length > idx[y]) { if (y < y0) y0 = y; y1 = y + 1; }
  }
  idx[ah] = xs.length;
  return { buf, aw, ah, idx, xs: Int16Array.from(xs), y0, y1 };
};
// a depth layer: its runs, a copy with sunlight on it (the band is copied from there) and a copy under the red damage flash
const CK_layer = (buf, aw, ah, lk) => {
  const L = CK_runs(buf, aw, ah), col = CK_rgb(255, 236, 190);
  L.lit = lk ? new Uint32Array(buf.length) : null; L.red = new Uint32Array(buf.length);
  for (let i = 0; i < buf.length; i++) if (buf[i]) { if (lk) L.lit[i] = CK_mix(buf[i], col, lk); L.red[i] = CK_mix(buf[i], CK_RED, 104); }
  return L;
};

// lay a layer over the frame shifted by (dx, dy); optional slanted sun band (ragged edges, crossed by
// the hoop's shadow) and red hit flash (tk of 16: how many of each 4x4 block of pixels turn red)
const CK_lay = (fb, W, H, L, pad, dx, dy, light, tk) => {
  const src = tk >= 16 ? L.red : L.buf, red = L.red, lit = light && tk < 16 ? L.lit : null, aw = L.aw, idx = L.idx, xs = L.xs, sh = dx - pad;
  let ty0 = L.y0 - pad + dy, ty1 = L.y1 - pad + dy; if (ty0 < 0) ty0 = 0; if (ty1 > H) ty1 = H;
  for (let ty = ty0; ty < ty1; ty++) {
    const sy = ty - dy + pad, base = sy * aw - sh, drow = ty * W, by = (ty & 3) << 2;
    let xa = 0, xb = 0, s0 = 0, s1 = 0;
    if (lit) { const mid = light.x + (ty - light.y0) * light.slope; xa = Math.round(mid - light.half); xb = Math.round(mid + light.half); s0 = Math.round(mid - light.half * 0.2); s1 = Math.round(mid + light.half * 0.04); }
    for (let r = idx[sy], re = idx[sy + 1]; r < re; r += 2) {
      let a = xs[r] + sh, b = xs[r + 1] + sh; if (a < 0) a = 0; if (b > W) b = W; if (a >= b) continue;
      if (b - a > 48) fb.set(src.subarray(base + a, base + b), drow + a);
      else for (let o = drow + a, i = base + a, e = drow + b; o < e; o++, i++) fb[o] = src[i];
      if (lit && a < xb && b > xa) {
        for (let k = 0; k < 4; k++) { // ragged edges
          let x = xa + k; if (x >= a && x < b && CK_BAYER[by | (x & 3)] < k * 4 + 2) fb[drow + x] = lit[base + x];
          x = xb - 1 - k; if (x >= a && x < b && CK_BAYER[by | (x & 3)] < k * 4 + 2) fb[drow + x] = lit[base + x];
        }
        let la = Math.max(a, xa + 4), lb = Math.min(b, s0);
        for (let x = la; x < lb; x++) fb[drow + x] = lit[base + x];
        la = Math.max(a, s1); lb = Math.min(b, xb - 4);
        for (let x = la; x < lb; x++) fb[drow + x] = lit[base + x];
      }
      if (tk > 0 && tk < 16) for (let x = a; x < b; x++) if (CK_BAYER[by | (x & 3)] < tk) fb[drow + x] = red[base + x];
    }
  }
};

// blit an opaque rectangle (a screen) with clipping
const CK_blit = (fb, W, H, buf, w, h, x, y) => {
  const x0 = Math.max(0, -x), x1 = Math.min(w, W - x);
  for (let r = Math.max(0, -y), re = Math.min(h, H - y); r < re; r++) for (let q = x0, o = (y + r) * W + x + x0, i = r * w + x0; q < x1; q++) fb[o++] = buf[i++];
};
// the HUD combiner: a faint green tint as a checkerboard (solid inside two slanting reflections),
// then its polished edges and support arms
const CK_glass = (fb, W, H, g, x, y) => {
  const w = g.aw, TRB = (120 | (176 << 16)) * 38, TG = (240 << 8) * 38;
  for (let r = Math.max(0, -y), re = Math.min(g.ah, H - y); r < re; r++) {
    const ty = y + r, o = ty * W, a = Math.max(0, g.ia[r] + x), b = Math.min(W, g.ib[r] + x), s0 = x + w * 0.3 - r * 0.8;
    for (let X = a + ((a + ty + 1) & 1); X < b; X += 2) { const d = fb[o + X]; fb[o + X] = 0xff000000 | ((((d & 0xff00ff) * 218 + TRB) >>> 8) & 0xff00ff) | ((((d & 0xff00) * 218 + TG) >>> 8) & 0xff00); }
    for (let k = 0; k < 2; k++) {
      const sa = Math.max(a, Math.round(s0 + (k ? w * 0.13 : 0))), sb = Math.min(b, Math.round(s0 + (k ? w * 0.155 : w * 0.09)));
      for (let X = sa + ((sa + ty) & 1); X < sb; X += 2) { const d = fb[o + X]; fb[o + X] = 0xff000000 | ((((d & 0xff00ff) * 218 + TRB) >>> 8) & 0xff00ff) | ((((d & 0xff00) * 218 + TG) >>> 8) & 0xff00); }
    }
  }
  CK_sprite(fb, W, H, g, x, y);
};
// blit a sprite (CK_runs): alpha 255 = solid, anything else = tint by alpha
const CK_sprite = (fb, W, H, S, x, y) => {
  const buf = S.buf, w = S.aw, idx = S.idx, xs = S.xs;
  for (let r = Math.max(S.y0, -y), re = Math.min(S.y1, H - y); r < re; r++) {
    for (let k = idx[r], ke = idx[r + 1]; k < ke; k += 2) {
      const x0 = Math.max(xs[k], -x), x1 = Math.min(xs[k + 1], W - x);
      for (let q = x0, o = (y + r) * W + x + x0, i = r * w + x0; q < x1; q++, o++, i++) {
        const c = buf[i], al = c >>> 24;
        if (al === 255) fb[o] = c;
        else { const d = fb[o], k1 = 256 - al; fb[o] = 0xff000000 | ((((d & 0xff00ff) * k1 + (c & 0xff00ff) * al) >>> 8) & 0xff00ff) | ((((d & 0xff00) * k1 + (c & 0xff00) * al) >>> 8) & 0xff00); }
      }
    }
  }
};

function buildCockpit(W, H) {
  const u = H / 360, cx = W >> 1, pad = Math.ceil(16 * u) + 4, aw = W + pad * 2, ah = H + pad * 2;
  const R = v => Math.round(v * u), M = (v, m) => Math.max(m, Math.round(v * u)), X = d => cx + Math.round(d * u);
  const B = CK_B, A = CK_A, fs = Math.max(1, Math.round(u));
  const bay = (x, y) => CK_BAYER[((y & 3) << 2) | (x & 3)];
  const sheet = () => new CK_Sheet(new Uint32Array(aw * ah), aw, ah, pad, pad);
  const rv = sheet(), cv = sheet(), pv = sheet(), kv = sheet();
  const sup = (dx, dy, ax, ay, P) => Math.pow(Math.abs(dx) / ax, P) + Math.pow(Math.abs(dy) / ay, P);
  // point on a superellipse at angle phi of its normalised coords (0 = right end, PI/2 = top), scaled by m
  const onPhi = (phi, ax, ay, P, oy, m) => {
    const c = Math.cos(phi), s = Math.sin(phi), k = Math.pow(Math.pow(Math.abs(c), P) + Math.pow(Math.abs(s), P), -1 / P) * m;
    return [Math.round(cx + c * k * ax), Math.round(oy - s * k * ay)];
  };
  const labels = [], label = (sh, x, y, str) => labels.push([sh, x, y, str]);
  const hazard = (sh, x0, y0, x1, y1, c0, c1) => { const q = M(3, 2); for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) sh.put(x, y, (((x + y) / q) | 0) & 1 ? c0 : c1); };
  // a raised key cap. kind: 0 grey, 1 orange, 2 amber, 3 dark
  const KEY = [[B[6], B[8], B[4]], [A[3], A[5], A[1]], [CK_LAMP[1], CK_LAMP[2], CK_LAMP[0]], [B[3], B[5], B[1]]];
  const key = (sh, k, kind) => {
    const c = KEY[kind];
    sh.box(k.x - 1, k.y - 1, k.x + k.w + 1, k.y + k.h + 1, B[1]); sh.box(k.x, k.y + 1, k.x + k.w + 1, k.y + k.h + 2, B[0]);
    sh.box(k.x, k.y, k.x + k.w, k.y + k.h, c[0]); sh.box(k.x, k.y, k.x + k.w, k.y + 1, c[1]); sh.box(k.x, k.y + k.h - 1, k.x + k.w, k.y + k.h, c[2]);
    return k;
  };
  // flecks of old paint and bare-metal chips, only on painted metal
  const weather = (sh, top, seed, count) => {
    for (let i = 0; i < count; i++) {
      const x = (CK_hash(i * 7 + seed) * 256 + CK_hash(i * 13 + seed * 3)) % W, y = top + (CK_hash(i * 29 + seed * 5) * 256 + CK_hash(i * 31 + seed)) % Math.max(1, H - top);
      const c = sh.get(x, y); if (c !== B[2] && c !== B[3] && c !== B[4]) continue;
      const k = CK_hash(i * 37 + seed * 11);
      if (k < 150) { sh.put(x, y, A[2 + (k & 1)]); if (k & 2) sh.put(x + 1, y, A[2]); if (k & 4) sh.put(x, y + 1, A[1]); if ((k & 24) === 24) sh.put(x + 1, y - 1, A[3]); }
      else if (k < 215) { sh.put(x, y, B[6]); sh.put(x, y + 1, B[0]); if (k & 1) sh.put(x + 1, y, B[7]); }
      else { const n = 2 + (k & 3); for (let j = 0; j < n; j++) { sh.put(x + j, y - j, B[1]); if (sh.get(x + j, y - j + 1) !== B[0]) sh.put(x + j, y - j + 1, B[5]); } } // a scratch
    }
  };

  // ── frame behind the head: quilted padding in the top corners (nearest layer)
  {
    const P = 2.5, oy = 300 * u, rx = 346 * u, ry = 334 * u, q = M(12, 6);
    for (let y = -pad; y < H + pad; y++) {
      const dy = oy - y; if (dy <= 0) break;
      for (let x = -pad; x < W + pad; x++) {
        const vv = sup(x - cx, dy, rx, ry, P); if (vv <= 1) continue;
        const f = (Math.pow(vv, 1 / P) - 1) * rx / u, n = CK_hash(x * 71 + y * 409); // design px beyond the opening
        let c;
        if (f < 1.1) c = B[6]; else if (f < 2.4) c = B[4]; else if (f < 3.6) c = B[0];
        else if (f < 11) c = f < 5.4 ? B[4] : f < 7.6 ? B[3] : f < 9.6 ? B[2] : B[1]; // the rolled edge
        else if (f < 12.4) c = B[0];
        else { const s1 = ((x + y) % q + q) % q, s2 = ((x - y) % q + q) % q; c = s1 === 0 || s2 === 0 ? B[0] : s1 === 1 ? B[2] : n > 247 ? B[2] : B[1]; }
        rv.put(x, y, c);
      }
    }
    for (let i = 1; i < 48; i++) { const p = onPhi(i / 48 * Math.PI, rx, ry, P, oy, 1 + 16.5 * u / rx); if (rv.get(p[0], p[1]) !== 0) rv.screw(p[0], p[1]); }
  }

  // ── canopy hoop: a round bar in bolted sections, every third one painted
  {
    const P = 2.7, oy = 274 * u, rx = 288 * u, ry = 256 * u, bar = Math.max(7, 16 * u), SEC = 15, sw = 1 / (57 * u);
    const ramp = [B[1], B[2], B[3], B[4], B[5], B[6], B[7]];
    for (let y = -pad; y < H + pad; y++) {
      const dy = oy - y; if (y > R(228) + pad) break;
      for (let x = -pad; x < W + pad; x++) {
        const dx = x - cx, vi = sup(dx, dy, rx, ry, P);
        if (vi <= 1) { // the bevelled edge of the glass catches the sky along parts of the hoop
          const fin = (1 - Math.pow(vi, 1 / P)) * rx / u; if (fin > 3.2 || vi < 0.9) continue;
          const ph = Math.atan2(dy / ry, Math.abs(dx) / rx) * 57.3 + (dx > 0 ? 9 : 0);
          if ((ph > 30 && ph < 44) || (ph > 49 && ph < 68) || (ph > 74 && ph < 80)) cv.put(x, y, fin < 1.2 ? CK_GL[4] : ((x + y) & 1) ? CK_GL[3] : fin < 2.2 ? CK_GL[4] : 0);
          continue;
        }
        if (sup(dx, dy, rx + bar, ry + bar, P) > 1) continue;
        const f = CK_clamp((Math.pow(vi, 1 / P) - 1) / ((rx + bar) / rx - 1), 0, 1), fp = f * bar; // across the bar: 0 at the glass
        const part = Math.atan2(dy / ry, dx / rx) / Math.PI * SEC, sec = Math.floor(part), al = part - sec, n = CK_hash(x * 131 + y * 977);
        // light from the upper left on a round bar
        let gx = Math.sign(dx) * Math.pow(Math.abs(dx) / rx, P - 1) / rx, gy = -Math.pow(dy / ry, P - 1) / ry;
        const gl = Math.hypot(gx, gy) || 1; gx /= gl; gy /= gl;
        const tt = f * 2 - 1, lv = CK_clamp((tt * (gx * -0.5 + gy * -0.72) + Math.sqrt(1 - tt * tt) * 0.5) * 0.5 + 0.5, 0, 0.999);
        let c;
        if (fp < 1 || fp > bar - 1) c = B[0];
        else if (fp < 2.3) c = B[1]; // rubber seal against the glass
        else if (al < sw || al > 1 - sw) c = B[0];
        else {
          const li = (lv * 7) | 0;
          c = ramp[al < sw * 2.4 ? Math.min(6, li + 1) : al > 1 - sw * 2.4 ? Math.max(0, li - 1) : li];
          if (sec % 3 === 1) { // paint, chipped at the seams and edges
            const edge = Math.min(al, 1 - al) * 9 + Math.min(fp - 2.3, bar - 1 - fp) / bar * 5;
            if (n > 64 - edge * 150) c = A[(lv * 6) | 0];
          } else if (n > 251 && f > 0.25 && f < 0.8) c = A[2];
        }
        cv.put(x, y, c);
      }
    }
    for (let i = 1; i < SEC; i++) for (let k = -1; k <= 1; k += 2) { const p = onPhi((i + k * 0.12) / SEC * Math.PI, rx, ry, P, oy, 1 + bar * 0.56 / rx); if (cv.get(p[0], p[1]) !== 0) { if (u >= 0.9) cv.bigbolt(p[0], p[1]); else cv.bolt(p[0], p[1]); } }
    for (let i = 0; i < SEC; i++) for (let k = 1; k < 4; k++) { const p = onPhi((i + 0.2 + k * 0.15) / SEC * Math.PI, rx, ry, P, oy, 1 + bar * 0.8 / rx); if (cv.get(p[0], p[1]) !== 0) { cv.put(p[0], p[1], B[8]); cv.put(p[0], p[1] + 1, B[0]); } }
    // lamp housing at the top with a blue glass lens
    {
      const ty = Math.round(oy - ry - bar), w = R(32), hh = R(22);
      for (let y = -pad; y < hh; y++) {
        const inset = Math.max(0, Math.round(y * 0.4));
        cv.box(cx - w + inset, ty + y, cx + w - inset, ty + y + 1, y < 1 ? B[6] : y > hh - 3 ? B[1] : y > hh - 5 ? B[2] : B[4]);
        cv.put(cx - w + inset, ty + y, B[0]); cv.put(cx + w - inset - 1, ty + y, B[0]); cv.put(cx - w + inset + 1, ty + y, B[6]);
      }
      cv.box(cx - w + Math.round(hh * 0.4), ty + hh, cx + w - Math.round(hh * 0.4), ty + hh + 1, B[0]);
      const g0 = ty + R(7), g1 = ty + R(15);
      cv.box(X(-19), g0 - 1, X(19), g1 + 1, B[0]);
      for (let y = g0; y < g1; y++) for (let x = X(-18); x < X(18); x++) { const d = (x - X(-18)) + (y - g0) * 2; cv.put(x, y, y === g0 ? CK_GL[4] : d % R(22) < R(5) ? CK_GL[3] : y > g1 - 3 ? CK_GL[1] : CK_GL[2]); }
      cv.bolt(X(-25), ty + R(10)); cv.bolt(X(25), ty + R(10));
    }
    // latches on either side
    for (let side = -1; side <= 1; side += 2) {
      const ly = R(150), hw = rx * Math.pow(1 - Math.pow((oy - ly) / ry, P), 1 / P), lx = Math.round(cx + side * (hw + bar * 0.45));
      cv.box(lx - R(6) - 1, ly - R(10) - 1, lx + R(6) + 1, ly + R(10) + 1, B[0]);
      cv.plate(lx - R(6), ly - R(10), lx + R(6), ly + R(10), A[3], A[5], A[1]);
      cv.box(lx - R(6) + 1, ly - R(10) + 1, lx + R(6) - 1, ly - R(7), A[4]); cv.box(lx - R(3), ly - R(3), lx + R(3), ly + R(4), B[1]); cv.box(lx - R(3), ly - R(3), lx + R(3), ly - R(3) + 1, B[0]);
      cv.bolt(lx, ly); cv.screw(lx - 1, ly - R(8)); cv.screw(lx - 1, ly + R(7));
    }
    // glints on the glass, inside the hoop and out towards the corners
    const GL = [-208, 98, -164, 54, 3, -193, 106, -175, 88, 2, -238, 54, -214, 30, 3, -247, 71, -231, 55, 2, -226, 60, -220, 54, 1];
    for (let side = -1; side <= 1; side += 2) for (let g = 0; g < GL.length; g += 5) {
      const n = Math.max(1, Math.round(Math.abs(GL[g + 2] - GL[g]) * u)), wide = Math.max(1, Math.round(GL[g + 4] * u));
      for (let i = 0; i <= n; i++) for (let k = 0; k < wide; k++) {
        const x = Math.round(cx + side * (GL[g] + (GL[g + 2] - GL[g]) * i / n) * u) + k * side, y = Math.round((GL[g + 1] + (GL[g + 3] - GL[g + 1]) * i / n) * u) + k;
        if (cv.get(x, y) !== 0) continue;
        if ((k === 0 && Math.min(i, n - i) >= 2) || ((x + y) & 1) === 0) cv.put(x, y, CK_GLINT);
      }
    }
  }

  // ── instrument panel: a hooded shelf (glareshield) over an upright face
  const topOf = a => a <= 70 ? 213 : a <= 88 ? 213 + (a - 70) / 18 * 11 : a <= 112 ? 224 : a <= 126 ? 224 - (a - 112) / 14 * 8 : a <= 252 ? 216 + (a - 126) * 0.02 : 218.5 + (a - 252) / 20 * 11;
  const G = Math.max(5, R(11));
  let panelTop = H;
  for (let x = -pad; x < W + pad; x++) {
    const a = Math.abs((x - cx) / u); if (a > 272) continue;
    const top = Math.round(topOf(a) * u); if (top < panelTop) panelTop = top;
    for (let y = top; y < R(318) + pad; y++) {
      const d = y - top, n = CK_hash(x * 53 + y * 311), v = y / u; let c;
      if (d < G) { // top of the shelf, running away to the glass
        const near = d / G, ray = a / (16 + near * 10);
        c = d === 0 ? B[7] : d === 1 ? B[5] : ray - Math.floor(ray) < 0.07 ? B[1] : near < 0.5 ? (n > 236 ? B[4] : B[3]) : B[2];
        if (d > 0 && d < G * 0.5 && CK_hash((x >> 3) * 7 + 5) > 205 && n > 110) c = d < 3 ? A[3] : A[2];
      } else if (d < G + 2) c = d === G ? B[6] : B[4]; // rolled lip of the hood
      else if (d < G + 4) c = B[0];
      else { // the face: in the hood's shadow at the top, darker again towards the floor
        const below = d - G - 4;
        c = below < R(4) ? B[0] : below < R(9) ? (bay(x, y) < 8 ? B[0] : B[1]) : v > 306 ? (bay(x, y) < 8 ? B[1] : B[2]) : v > 292 ? (bay(x, y) < 4 ? B[1] : B[2]) : n > 251 ? B[3] : B[2];
      }
      pv.put(x, y, c);
    }
  }
  // vent grilles in the shelf, seams in the face
  for (let side = -1; side <= 1; side += 2) {
    for (let i = 0; i < 6; i++) pv.box(X(side * (176 + i * 5)), R(220), X(side * (176 + i * 5)) + M(2, 1), R(226), B[0]);
    pv.box(X(side * 129), R(236), X(side * 129) + 1, R(318), B[0]); pv.box(X(side * 129) + 1, R(240), X(side * 129) + 2, R(318), B[3]);
    pv.box(X(side * 257), R(240), X(side * 257) + 1, R(318), B[0]);
    for (let j = 0; j < 4; j++) pv.box(X(side * 263) - R(4), R(252 + j * 6), X(side * 263) + R(4), R(252 + j * 6) + M(2, 1), B[0]);
  }

  // warning-lamp strip under the centre hood, hazard stripes at both ends
  const lamps = [];
  pv.well(X(-48), R(229), X(48), R(239), B[0], B[5], B[0]);
  hazard(pv, X(-46), R(231), X(-37), R(238), CK_LAMP[1], B[0]); hazard(pv, X(37), R(231), X(46), R(238), CK_LAMP[1], B[0]);
  for (let i = 0; i < 5; i++) { const r = { x: X(-34 + i * 14), y: R(231), w: M(12, 4), h: M(6, 3) }; lamps.push(r); pv.box(r.x, r.y, r.x + r.w, r.y + r.h, A[0]); pv.box(r.x, r.y + r.h - 1, r.x + r.w, r.y + r.h, B[1]); }

  // the two screens: thick bezels with soft keys all round
  const panelKeys = [];
  const screen = d0 => {
    const x0 = X(d0), x1 = X(d0 + 118), y0 = R(240), y1 = R(316), m = M(8, 4);
    pv.box(x0 + 2, y0 + 2, x1 + 3, y1 + 3, B[0]); // its shadow
    pv.plate(x0, y0, x1, y1, B[4], B[7], B[1]);
    pv.box(x0 + 1, y0 + 1, x1 - 1, y0 + 2, B[5]); pv.box(x0 + 1, y1 - 2, x1 - 1, y1 - 1, B[2]);
    pv.put(x0, y0, B[1]); pv.put(x1 - 1, y0, B[1]); pv.put(x0, y1 - 1, B[0]); pv.put(x1 - 1, y1 - 1, B[0]);
    const r = { x: x0 + m, y: y0 + m, w: x1 - x0 - m * 2, h: y1 - y0 - m * 2 };
    pv.well(r.x - 2, r.y - 2, r.x + r.w + 2, r.y + r.h + 2, B[1], B[6], B[0]);
    pv.box(r.x - 1, r.y - 1, r.x + r.w + 1, r.y + r.h + 1, B[0]); pv.box(r.x, r.y, r.x + r.w, r.y + r.h, CK_CRT[0]);
    const kw = M(7, 3), kh = M(3, 2), sk = M(4, 2), sl = M(5, 3);
    for (let i = 0; i < 5; i++) {
      const kx = r.x + Math.round((i + 0.5) * r.w / 5) - (kw >> 1);
      const kt = key(pv, { x: kx, y: y0 + ((m - kh) >> 1), w: kw, h: kh }, 0), kb = key(pv, { x: kx, y: y1 - m + ((m - kh) >> 1) + 1, w: kw, h: kh }, 0);
      if (i === 1) panelKeys.push(kb); if (i === 3) panelKeys.push(kt);
    }
    for (let j = 0; j < 4; j++) {
      const ky = r.y + Math.round((j + 0.5) * r.h / 4) - (sl >> 1);
      key(pv, { x: x0 + ((m - sk) >> 1), y: ky, w: sk, h: sl }, 0); const kr = key(pv, { x: x1 - m + ((m - sk) >> 1) + 1, y: ky, w: sk, h: sl }, 0);
      if (j === 2) panelKeys.push(kr);
    }
    return r;
  };
  const radar = screen(-252), status = screen(134);

  // centre plate: attitude ball and four dials, each in its own well
  pv.box(X(-124) + 2, R(241) + 2, X(124) + 3, R(316) + 3, B[0]);
  pv.plate(X(-124), R(241), X(124), R(316), B[3], B[6], B[0]);
  pv.box(X(-124) + 1, R(241) + 1, X(124) - 1, R(241) + 2, B[4]);
  for (let k = 0; k < 4; k++) pv.bolt(X(k & 1 ? 119 : -120), R(k & 2 ? 311 : 245));
  const ball = { x: cx, y: R(279), r: M(28, 10) };
  {
    const r = ball.r, rw = M(8, 4), ro = r + rw;
    for (let dy = -ro - 3; dy <= ro + 3; dy++) for (let dx = -ro - 3; dx <= ro + 3; dx++) {
      const d = Math.sqrt(dx * dx + dy * dy); if (d > ro + 3) continue;
      let c;
      if (d > ro + 1) { if (dx + dy < ro * 0.4) continue; c = B[0]; } // shadow of the raised ring
      else if (d > ro) c = B[0];
      else if (d > r + 1.5) { // turned bevel: bright where it faces the light, a groove half way
        const ls = (-dx - dy) / (d * 1.4142 + 0.001), mid = Math.abs(d - (r + 1.5 + ro) / 2) < 0.6;
        c = mid ? (ls > 0.2 ? B[5] : B[1]) : ls > 0.62 ? B[8] : ls > 0.25 ? B[7] : ls > -0.2 ? B[6] : ls > -0.6 ? B[4] : B[2];
      } else c = B[0];
      pv.put(ball.x + dx, ball.y + dy, c);
    }
    // bank marks on the ring, a brass pointer at the top, screws
    for (let k = -2; k <= 2; k++) { if (!k) continue; const an = k * 0.5236; pv.line(ball.x + Math.sin(an) * (r + 3), ball.y - Math.cos(an) * (r + 3), ball.x + Math.sin(an) * (ro - 2), ball.y - Math.cos(an) * (ro - 2), CK_WHITE); }
    for (let i = 0; i < M(4, 2); i++) pv.box(ball.x - i, ball.y - ro + 1 + (M(4, 2) - 1 - i), ball.x + i + 1, ball.y - ro + 2 + (M(4, 2) - 1 - i), i ? CK_LAMP[1] : CK_LAMP[2]);
    for (let k = 0; k < 4; k++) pv.screw(ball.x + (k & 1 ? 1 : -1) * Math.round(ro * 0.74) - 1, ball.y + (k & 2 ? 1 : -1) * Math.round(ro * 0.74) - 1);
    // shading of the sphere under its glass: 1 plain, 2 dark limb, 3 highlight
    const d2 = r * 2 + 1; ball.mask = new Uint8Array(d2 * d2);
    ball.asin = new Float32Array(r * 8 + 1); for (let i = 0; i <= r * 8; i++) ball.asin[i] = Math.asin(i / (r * 4) - 1);
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const d = Math.sqrt(dx * dx + dy * dy); if (d > r + 0.3) continue;
      const hl = Math.hypot(dx + r * 0.42, dy + r * 0.46), t = bay(dx + r, dy + r);
      ball.mask[(dy + r) * d2 + dx + r] = d > r - 1.2 ? 2 : d > r * 0.86 && t < (d / r - 0.86) * 110 + (dx + dy > 0 ? 6 : 0) ? 2 : hl < r * 0.13 || (hl < r * 0.26 && t < 6) ? 3 : 1;
    }
  }
  const dials = [], LABEL = ['SPD', 'ALT', 'VSI', 'TRN'];
  for (let k = 0; k < 4; k++) {
    const side = k & 1 ? 1 : -1, low = k >> 1, x = X(side * 86), y = R(low ? 299 : 256), r = M(12, 5), ro = r + M(3, 2), kind = low ? (side < 0 ? 2 : 3) : (side < 0 ? 0 : 1);
    for (let dy = -ro - 2; dy <= ro + 2; dy++) for (let dx = -ro - 2; dx <= ro + 2; dx++) {
      const d = Math.sqrt(dx * dx + dy * dy); if (d > ro + 2.4) continue;
      let c;
      if (d > ro + 0.6) { if (dx + dy < ro * 0.5) continue; c = B[0]; }
      else if (d > ro - 0.4) c = B[0];
      else if (d > r) { const ls = (-dx - dy) / (d * 1.4142 + 0.001); c = ls > 0.55 ? B[8] : ls > 0.1 ? B[6] : ls > -0.45 ? B[5] : B[2]; }
      else c = d > r - 1.2 || dx + dy < -r * 1.05 ? B[0] : B[1];
      pv.put(x + dx, y + dy, c);
    }
    const tick = (deg, len, c) => { const an = deg * 0.0174533; pv.line(x + Math.sin(an) * (r - 1.5), y - Math.cos(an) * (r - 1.5), x + Math.sin(an) * (r - 1.5 - len), y - Math.cos(an) * (r - 1.5 - len), c); };
    if (kind < 2) for (let i = 0; i <= 10; i++) tick(-135 + i * 27, i % 5 === 0 ? 3 : 2, i >= 8 ? A[3] : i % 5 === 0 ? CK_WHITE : B[7]);
    else if (kind === 2) for (let i = -3; i <= 3; i++) tick(-90 + i * 28, i ? 2 : 3, i ? B[7] : CK_WHITE);
    else for (let i = -2; i <= 2; i++) tick(i * 35, i ? 2 : 3, i ? B[7] : CK_WHITE);
    if (u >= 0.9) label(pv, side < 0 ? x + ro + R(4) : x - ro - R(4) - CK_tw(CK_F3, 3, fs), y - 2 * fs, LABEL[kind]);
    dials.push({ x, y, r, kind });
    // a pair of small keys between the upper and lower dial
    if (!low) for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) {
      const kk = key(pv, { x: x - R(8) + i * M(9, 4), y: R(273 + j * 5.5), w: M(7, 3), h: M(4, 2) }, (i + j) & 1 ? 1 : 0);
      if (i === j) panelKeys.push(kk);
    }
  }
  // boost column left of the ball, two round warning lamps right of it
  const boostBar = { x: X(-54), y: R(266), w: M(7, 3), seg: M(4, 2), n: 6 };
  pv.well(boostBar.x - 2, boostBar.y - 2, boostBar.x + boostBar.w + 2, boostBar.y + boostBar.n * boostBar.seg + 1, B[0], B[5], B[0]);
  const roundLamps = [{ x: X(50), y: R(272), r: M(3, 2) }, { x: X(50), y: R(287), r: M(3, 2) }];
  for (const l of roundLamps) { pv.disc(l.x, l.y, l.r + 2, B[0]); pv.disc(l.x - 1, l.y - 1, l.r + 1, B[6]); pv.disc(l.x, l.y, l.r + 1, B[1]); pv.disc(l.x, l.y, l.r, A[0]); }
  weather(pv, panelTop + G + R(8), 3, Math.round(W * H / 1500));

  // ── consoles and side walls: the layer nearest the seat
  const deckOf = a => a <= 258 ? 318 : a <= 272 ? 318 - (a - 258) / 14 * 92 : Math.max(150, 226 - (a - 272) * 0.5);
  for (let x = -pad; x < W + pad; x++) {
    const a = Math.abs((x - cx) / u), top = Math.round(deckOf(a) * u);
    for (let y = top; y < H + pad; y++) {
      const d = y - top, n = CK_hash(x * 59 + y * 211), v = y / u; let c;
      if (a > 272) { // side wall: ribbed panels running away to the nose, under a padded rail
        const s = (v - 160) / a * 9, rib = s - Math.floor(s) < 0.05;
        c = d === 0 ? B[7] : d < R(2) ? B[5] : d < R(5) ? B[3] : d < R(7) ? B[0] : rib ? B[0] : s - Math.floor(s) < 0.1 ? B[4] : Math.floor(s) & 1 ? (n > 249 ? B[4] : B[3]) : B[2];
        if (v > 340 && !rib && bay(x, y) < 8) c = B[1];
      } else if (a > 258) { const t = (a - 258) / 14; c = d === 0 ? B[7] : t < 0.2 ? B[6] : t < 0.45 ? B[4] : t < 0.78 ? B[2] : B[0]; } // corner post
      else c = d === 0 ? B[8] : d === 1 ? B[6] : d < R(4) ? B[5] : d < R(5) ? B[2] : v > 351 ? (bay(x, y) < 8 ? B[2] : B[3]) : n > 250 ? B[5] : n < 6 ? B[3] : B[4]; // the shelf
      kv.put(x, y, c);
    }
  }
  const deckKeys = [], KK = [1, 1, 0, 2, 2, 0, 0, 1, 3];
  for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) {
    const kl = key(kv, { x: X(-252 + i * 14), y: R(327 + j * 10), w: M(11, 5), h: M(7, 3) }, KK[i + j * 3]);
    const kr = key(kv, { x: X(214 + i * 14), y: R(327 + j * 10), w: M(11, 5), h: M(7, 3) }, KK[(i * 2 + j * 3 + 2) % 9]);
    if (KK[i + j * 3] === 2 && i === 0) deckKeys.push(kl); if (KK[(i * 2 + j * 3 + 2) % 9] === 1 && j === 1) deckKeys.push(kr);
  }
  // throttle quadrant
  kv.well(X(-208), R(323), X(-140), H + pad, B[1], B[6], B[0]);
  for (let i = 0; i < 3; i++) { const sx = X(-196 + i * 21); kv.box(sx, R(326), sx + M(3, 2), H + pad, B[0]); for (let y = R(328); y < H + pad; y += M(4, 2)) kv.put(sx + M(3, 2) + 1, y, B[6]); }
  const throttle = { x0: X(-203), x1: X(-145), yA: R(346), yB: R(328), h: M(9, 4) };
  // guarded master-arm switch in a hazard surround, two rotary knobs
  hazard(kv, X(-130), R(325), X(-102), R(347), CK_LAMP[1], B[0]);
  kv.box(X(-130) - 1, R(325) - 1, X(-102) + 1, R(325), B[0]); kv.box(X(-127), R(328), X(-105), R(344), B[1]); kv.box(X(-127), R(328), X(-105), R(329), B[0]);
  kv.box(X(-123) + 1, R(331) + 1, X(-109) + 2, R(343) + 1, B[0]); kv.plate(X(-123), R(331), X(-109), R(342), CK_RED, CK_rgb(255, 150, 130), CK_REDD);
  kv.box(X(-123), R(336), X(-109), R(336) + 1, CK_REDD); label(kv, X(-122), R(350), 'ARM');
  const knob = (x, y, r, hot) => {
    kv.disc(x + 1, y + 2, r + 1, B[0]); kv.disc(x, y, r + 1, B[1]); kv.disc(x, y, r, B[5]); kv.disc(x - 1, y - 1, r - 1, B[6]);
    kv.disc(x, y, Math.max(1, r - 2), hot ? A[3] : B[3]); if (hot) kv.disc(x - 1, y - 1, Math.max(1, r * 0.3), A[5]);
    kv.line(x, y, x - r * 0.6, y - r * 0.6, hot ? A[5] : CK_WHITE);
  };
  knob(X(-84), R(338), M(6, 3), 0); knob(X(-64), R(338), M(6, 3), 0); if (u >= 0.9) { label(kv, X(-90), R(350), 'COM'); label(kv, X(-70), R(350), 'NAV'); }
  // right side: toggles, a big knob, a keypad
  for (let i = 0; i < 4; i++) {
    const tx = X(134 + i * 12), up = i % 2 === 0, tw = M(3, 2);
    kv.box(tx - 1, R(338), tx + M(6, 4) + 1, R(346), B[0]); kv.box(tx, R(339), tx + M(6, 4), R(344), B[6]); kv.box(tx, R(339), tx + M(6, 4), R(339) + 1, B[8]);
    kv.box(tx + 2, up ? R(329) : R(342), tx + 2 + tw, up ? R(342) : R(354), B[0]); kv.box(tx + 1, up ? R(328) : R(341), tx + 1 + tw, up ? R(341) : R(353), B[7]);
    kv.box(tx + 1, up ? R(328) : R(350), tx + 1 + tw, up ? R(331) : R(353), CK_WHITE);
  }
  knob(X(196), R(340), M(9, 4), 1);
  for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) key(kv, { x: X(58 + i * 8), y: R(328 + j * 7), w: M(6, 3), h: M(5, 2) }, i === 2 && j === 0 ? 2 : 3);
  // the well the stick stands in
  for (let dy = -R(12); dy <= R(12); dy++) for (let dx = -R(40); dx <= R(40); dx++) {
    const d = (dx * dx) / (R(40) * R(40)) + (dy * dy) / (R(12) * R(12));
    if (d <= 1) kv.put(cx + dx, R(358) + dy, d > 0.84 ? (dy < 0 ? B[1] : B[7]) : d > 0.66 ? B[0] : B[1]);
  }
  // side walls: keys, a striped canopy handle, a hazard block where the hoop lands
  for (let side = -1; side <= 1; side += 2) {
    for (let j = 0; j < 4; j++) { const kk = key(kv, { x: X(side * 289) - (side < 0 ? M(9, 4) : 0), y: R(264 + j * 14), w: M(9, 4), h: M(6, 3) }, j === 1 ? 1 : j === 2 ? 2 : 0); if (j === 2) deckKeys.push(kk); }
    const hx0 = X(side * 308) - R(3), hx1 = X(side * 308) + R(3);
    kv.box(hx0 - 1, R(240) - 1, hx1 + 1, R(262) + 1, B[0]); hazard(kv, hx0, R(240), hx1, R(262), CK_RED, CK_WHITE); kv.box(hx0, R(240), hx1, R(240) + 1, CK_rgb(255, 170, 160));
    const zx = Math.min(X(side * 276), X(side * 292));
    kv.box(zx - 1, R(228) - 1, zx + R(16) + 1, R(235) + 1, B[0]); hazard(kv, zx, R(228), zx + R(16), R(235), CK_LAMP[1], B[0]);
  }
  weather(kv, R(190), 11, Math.round(W * H / 1700));
  for (const l of labels) { l[0].box(l[1] - 1, l[2] - 1, l[1] + CK_tw(CK_F3, l[3].length, fs) + 1, l[2] + 5 * fs + 1, l[0] === pv ? B[3] : B[4]); l[0].text(l[1], l[2], l[3], B[7], CK_F3, fs); }

  // ── HUD combiner: a chamfered pane of green-tinted glass on two arms. alpha = how strongly it tints.
  const gx0 = X(-138), gy0 = R(46), gw = X(138) - gx0, gh = R(229) - gy0;
  const gbuf = new Uint32Array(gw * gh), gmask = new Uint8Array(gw * gh), gsh = new CK_Sheet(gbuf, gw, gh, -gx0, -gy0);
  const EDGE = CK_rgb(214, 255, 232) & 0xffffff, gia = new Int16Array(gh).fill(gw), gib = new Int16Array(gh);
  for (let y = gy0; y < gy0 + gh; y++) for (let x = gx0; x < gx0 + gw; x++) {
    const a = Math.abs(x - cx) / u, v = y / u, e = Math.min(v - 46, 124 - a, (98 + (v - 46) - a) * 0.7071) * u; if (e < 0) continue;
    if (e < 3) gbuf[(y - gy0) * gw + x - gx0] = (((e < 1 ? 176 : e < 2 ? 84 : 40) << 24) | EDGE) >>> 0; // polished edge
    else { if (x - gx0 < gia[y - gy0]) gia[y - gy0] = x - gx0; gib[y - gy0] = x - gx0 + 1; } // tinted interior, see CK_glass
    if (e >= 2) gmask[(y - gy0) * gw + x - gx0] = 1;
  }
  for (let side = -1; side <= 1; side += 2) { // the arms: dark posts leaning out, clamps on the glass edge
    for (let y = R(134); y < gy0 + gh; y++) {
      const t = (y / u - 134) / 98, xc = cx + side * (131 - t * 4) * u, hw = (2.6 + t * 1.6) * u, xa = Math.round(xc - hw), xb = Math.round(xc + hw);
      for (let x = xa; x <= xb; x++) gsh.put(x, y, x === xa || x === xb ? B[0] : x === xa + 1 ? B[6] : x < xa + (xb - xa) * 0.55 ? B[4] : x < xb - 1 ? B[3] : B[1]);
    }
    const tx = Math.round(cx + side * 131 * u);
    gsh.box(tx - R(4) - 1, R(130) - 1, tx + R(4) + 1, R(138) + 1, B[0]); gsh.plate(tx - R(4), R(130), tx + R(4), R(138), B[5], B[8], B[2]); gsh.screw(tx - 1, R(133));
    for (const cy of [158, 198]) { const kx = Math.round(cx + side * (130 - (cy - 134) / 98 * 4) * u); gsh.box(kx - R(5) - 1, R(cy) - 1, kx + R(5) + 1, R(cy + 6) + 1, B[0]); gsh.plate(kx - R(5), R(cy), kx + R(5), R(cy + 6), B[5], B[7], B[2]); gsh.screw(kx - 1, R(cy + 2)); }
  }

  // ── the stick's grip, as a sprite
  const sw_ = M(28, 12) + 2, sh_ = M(24, 10) + 2, sbuf = new Uint32Array(sw_ * sh_), ss = new CK_Sheet(sbuf, sw_, sh_, 1, 1);
  {
    const w = sw_ - 2, h = sh_ - 2, x0 = R(4), x1 = w - R(4), y1 = h - R(4);
    ss.box(x0 - 1, 0, x1 + 1, y1 + 1, B[0]); ss.box(x0, 1, x1, y1, B[4]);
    ss.box(x0, 1, x1, 2, B[7]); ss.box(x0, 2, x0 + 1, y1, B[6]); ss.box(x1 - 1, 2, x1, y1, B[2]); ss.box(x0, y1 - 1, x1, y1, B[2]);
    for (const p of [[x0 - 1, 0], [x1, 0], [x0 - 1, y1], [x1, y1]]) ss.buf[(p[1] + 1) * sw_ + p[0] + 1] = 0; // rounded corners
    ss.put(x0, 1, B[0]); ss.put(x1 - 1, 1, B[0]); ss.put(x0, y1 - 1, B[0]); ss.put(x1 - 1, y1 - 1, B[0]);
    const hx = Math.round(w * 0.34), bx = Math.round(w * 0.68), cy = Math.round(y1 * 0.5), rr = M(4, 2);
    ss.disc(hx, cy, rr, B[0]); ss.disc(hx, cy, rr - 1, B[2]); ss.box(hx - rr + 1, cy, hx + rr, cy + 1, B[7]); ss.box(hx, cy - rr + 1, hx + 1, cy + rr, B[7]); ss.put(hx, cy, B[8]); // hat switch
    ss.disc(bx, cy, rr, B[0]); ss.disc(bx, cy, rr - 1, A[2]); ss.disc(bx - 1, cy - 1, Math.max(1, rr - 2.4), A[4]); ss.put(bx - 1, cy - 1, A[5]); // fire button
    ss.box(R(9) - 1, y1, w - R(9) + 1, h, B[0]); ss.box(R(9), y1, w - R(9), h, B[3]); ss.box(R(9), y1, R(9) + 1, h, B[5]); // neck
    ss.box(0, R(8), x0 - 1, R(15), B[0]); ss.box(0, R(8) + 1, x0 - 1, R(15) - 1, A[2]); ss.box(0, R(8) + 1, x0 - 1, R(8) + 2, A[4]); // trigger tab
  }

  // ── the screens' own buffers and per-pixel tables
  const mfd = r => { r.buf = new Uint32Array(r.w * r.h); r.view = new CK_Sheet(r.buf, r.w, r.h, 0, 0); return r; };
  mfd(radar); mfd(status);
  const glassFx = new Uint8Array(radar.w * radar.h); // 255/254 = rim shadow, else white reflection strength
  for (let y = 0; y < radar.h; y++) for (let x = 0; x < radar.w; x++) {
    const d = x + y * 0.9 - radar.w * 0.36;
    glassFx[y * radar.w + x] = y < 1 || x < 1 ? 255 : y < 2 || x < 2 ? 254 : (d > 0 && d < radar.w * 0.15) || (d > radar.w * 0.22 && d < radar.w * 0.26) ? 22 : 0;
  }
  {
    const r = radar, cs = Math.max(2, Math.round(2 * u));
    r.mx = r.w >> 1; r.my = r.h >> 1; r.rad = Math.floor(r.h * 0.47); r.zoom = 600 / r.rad; r.cs = cs;
    r.cols = Math.ceil(r.w / cs); r.rows = Math.ceil(r.h / cs); r.cells = new Uint8Array(r.cols * r.rows);
    r.map = new Uint8Array(r.w * r.h); r.ang = new Uint8Array(r.w * r.h); r.px = new Uint8Array(r.w * r.h);
    for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) {
      const i = y * r.w + x, dx = x - r.mx, dy = y - r.my, d = Math.sqrt(dx * dx + dy * dy) / r.rad;
      r.ang[i] = Math.round(Math.atan2(dx, -dy) / 6.28319 * 256) & 255; // clockwise from the nose
      const line = Math.abs(d - 1) < 0.5 / r.rad || Math.abs(d - 0.667) < 0.5 / r.rad || Math.abs(d - 0.333) < 0.5 / r.rad || (d < 1 && (dx === 0 || dy === 0) && ((dx + dy) & 1) === 0);
      r.px[i] = (d > 1 + 0.5 / r.rad ? 2 : line ? 1 : 0) | (((x + y) & 1) << 2);
    }
  }

  return {
    W, H, u, cx, pad, fs, panelTop, frame: 0,
    rear: CK_layer(rv.buf, aw, ah, 0), hoop: CK_layer(cv.buf, aw, ah, 22), panel: CK_layer(pv.buf, aw, ah, 46), deck: CK_layer(kv.buf, aw, ah, 46),
    glass: Object.assign(CK_runs(gbuf, gw, gh), { x: gx0, y: gy0, mask: gmask, ia: gia, ib: gib }), grip: CK_runs(sbuf, sw_, sh_),
    radar, status, glassFx, ball, dials, lamps, roundLamps, boostBar, panelKeys, deckKeys, throttle,
    gs: Math.max(1, Math.round(2 * u)), view: new CK_Sheet(null, W, H, 0, 0), light: { x: 0, slope: 0, half: 0, y0: 0 },
  };
}

// scanlines, rim shadow and the slanting reflection of a screen's glass
const CK_crt = (r, fx) => {
  const buf = r.buf, w = r.w;
  for (let i = 0, n = w * r.h; i < n; i++) {
    let c = buf[i]; const f = fx[i];
    if (((i / w) | 0) & 1) c = CK_mix(c, CK_CRT[0], 70);
    if (f) c = f === 255 ? CK_mix(c, CK_BLACK, 130) : f === 254 ? CK_mix(c, CK_BLACK, 60) : CK_mix(c, CK_WHITE, f);
    buf[i] = c;
  }
};

// left screen: ground-mapping radar, nose up
const CK_radar = (art, live, t, fr) => {
  const r = art.radar, w = r.w, h = r.h, buf = r.buf, C = CK_CRT, cells = r.cells, cols = r.cols, cs = r.cs, z = r.zoom, f = art.fs, v = r.view;
  const land = live.land;
  // ponytail: land() is sampled on a coarse grid, a quarter of its rows per repaint (the screen repaints every
  // other frame), so the whole map takes 8 frames to refresh; sample every row each repaint if land() is cheap
  if (land) for (let j = fr ? fr & 3 : 0; j < r.rows; j += fr ? 4 : 1) {
    const ahead = (r.my - (j + 0.5) * cs) * z;
    for (let i = 0; i < cols; i++) cells[j * cols + i] = land(((i + 0.5) * cs - r.mx) * z, ahead) | 0;
  }
  // blow the cells up to pixels, rounding the corners off (EPX)
  const map = r.map, rows = r.rows, hc = cs >> 1;
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const o = j * cols + i, P = cells[o], U = j ? cells[o - cols] : P, D = j < rows - 1 ? cells[o + cols] : P, Lf = i ? cells[o - 1] : P, Rt = i < cols - 1 ? cells[o + 1] : P;
    const e0 = Lf === U && Lf !== D && U !== Rt ? U : P, e1 = U === Rt && U !== Lf && Rt !== D ? Rt : P, e2 = D === Lf && D !== Rt && Lf !== U ? Lf : P, e3 = Rt === D && Rt !== U && D !== Lf ? D : P;
    for (let y = j * cs, ye = Math.min(h, y + cs); y < ye; y++) for (let x = i * cs, xe = Math.min(w, x + cs); x < xe; x++) map[y * w + x] = y - j * cs < hc ? (x - i * cs < hc ? e0 : e1) : (x - i * cs < hc ? e2 : e3);
  }
  const sw = (((t * 0.3) % 1) * 256) | 0, ang = r.ang, px = r.px;
  for (let i = 0, n = w * h; i < n; i++) {
    const m = map[i], k = px[i] & 3;
    let tone = m >= 3 ? 4 : m === 2 ? 3 : m === 1 ? (px[i] & 4 ? 2 : 1) : 1;
    if (k === 2) tone = tone > 2 ? 2 : tone > 1 ? 1 : 0; // beyond range
    else {
      if (k === 1) tone = tone < 3 ? 2 + (m === 1 ? 1 : 0) : tone + 1;
      const da = (sw - ang[i]) & 255;
      if (da < 2) tone = 5; else if (da < 30 && tone < 5) tone += da < 10 && tone < 4 ? 2 : 1;
    }
    buf[i] = C[tone];
  }
  // enemies: the one nearest the lock range is the locked one
  const bl = live.blips, lk = live.lock; let best = -1;
  if (bl && lk && lk.locked) { let bd = 1e9; for (let i = 0; i + 1 < bl.length; i += 2) { const d = Math.abs(Math.hypot(bl[i], bl[i + 1]) - lk.range); if (d < bd) { bd = d; best = i; } } }
  if (bl) for (let i = 0; i + 1 < bl.length; i += 2) {
    const bx = r.mx + Math.round(bl[i] / z), by = r.my - Math.round(bl[i + 1] / z), s = Math.max(1, f);
    if (bx < 2 || by < 2 || bx >= w - 2 || by >= h - 2) continue;
    if (i === best) { v.box(bx - s, by - s, bx + s + 1, by + s + 1, CK_RED); if (((t * 6) | 0) & 1) v.brackets(bx, by, s + 2 * f, f, CK_RED); }
    else { v.box(bx - s, by, bx + s + 1, by + 1, C[5]); v.box(bx, by - s, bx + 1, by + s + 1, C[5]); }
  }
  // own ship, labels
  v.box(r.mx, r.my - 2 * f, r.mx + f, r.my + 2 * f, C[5]); v.box(r.mx - 2 * f, r.my, r.mx + 3 * f, r.my + f, C[5]); v.box(r.mx - f, r.my + 2 * f, r.mx + 2 * f, r.my + 3 * f, C[5]);
  v.box(f, f, 15 * f, 8 * f, C[0]); v.text(2 * f, 2 * f, 'RDR', C[4], CK_F3, f);
  v.box(f, h - 8 * f, 15 * f, h - f, C[0]); v.text(2 * f, h - 7 * f, 'GND', C[3], CK_F3, f);
  v.box(w - 15 * f, h - 8 * f, w - f, h - f, C[0]); v.text(w - 13 * f, h - 7 * f, '600', C[4], CK_F3, f);
  for (let i = 0; i < 3; i++) v.box(w - 14 * f, 2 * f + i * 3 * f, w - (i === 1 ? 6 : 2) * f, 4 * f + i * 3 * f, C[i === ((t * 2) | 0) % 3 ? 4 : 2]);
  CK_crt(r, art.glassFx);
};

// right screen: own-ship status
const CK_status = (art, live, t) => {
  const s = art.status, v = s.view, w = s.w, h = s.h, f = art.fs, C = CK_CRT, u = art.u, gq = Math.max(4, Math.round(8 * u));
  s.buf.fill(C[0]);
  for (let y = gq >> 1; y < h; y += gq) for (let x = 1; x < w; x += 2) s.buf[y * w + x] = C[1];
  for (let x = gq >> 1; x < w; x += gq) for (let y = 1; y < h; y += 2) s.buf[y * w + x] = C[1];
  const hp = CK_clamp(live.hp === undefined ? 1 : live.hp, 0, 1), blink = ((t * 6) | 0) & 1, hc = hp > 0.5 ? C[4] : hp > 0.25 ? CK_LAMP[1] : blink ? CK_RED : CK_REDD;
  v.text(2 * f, 2 * f, CK_num(live.alt, 5), C[5], CK_F3, f); v.text(2 * f, h - 7 * f, CK_num(live.speed, 3), C[5], CK_F3, f);
  // the jet, with missiles on its rails
  const gs = art.gs, jx = Math.round(w * 0.28) - ((13 * gs) >> 1), jy = ((h - 15 * gs) >> 1) + f, dmg = hp < 0.3 && blink, ms = live.missiles | 0;
  for (let r = 0; r < 15; r++) for (let q = 0; q < 13; q++) if (CK_JET[r].charCodeAt(q) === 35) {
    const lit = q === 6 || (q < 6 && CK_JET[r].charCodeAt(q - 1) !== 35);
    v.box(jx + q * gs, jy + r * gs, jx + (q + 1) * gs, jy + (r + 1) * gs, dmg ? (lit ? CK_RED : CK_REDD) : q === 6 && r > 1 && r < 5 ? C[5] : lit ? C[4] : C[3]);
  }
  for (let i = 0; i < 4; i++) v.box(jx + CK_MP[i][0] * gs, jy + CK_MP[i][1] * gs, jx + (CK_MP[i][0] + 1) * gs, jy + (CK_MP[i][1] + 3) * gs, i < ms ? C[5] : C[2]);
  // right column: HP bar, missile pips, kills
  const x0 = Math.round(w * 0.56), lp = ((h - 4 * f) / 3) | 0, bh = Math.max(5 * f, Math.min(lp - 4 * f, Math.round(9 * u)));
  for (let i = 0; i < 3; i++) {
    const ly = 2 * f + i * lp + ((lp - bh) >> 1), ty = ly + ((bh - 5 * f) >> 1), bx = x0 + 14 * f;
    v.text(x0, ty, i === 0 ? 'HP' : i === 1 ? 'MSL' : 'KIL', C[3], CK_F3, f);
    if (i === 0) { const sw = Math.max(2, ((w - 2 * f - bx + 1) / 8) | 0), lit = Math.ceil(hp * 8 - 1e-6); for (let j = 0; j < 8; j++) v.box(bx + j * sw, ly, bx + j * sw + sw - 1, ly + bh, j < lit ? hc : C[1]); }
    else if (i === 1) { const pw = Math.max(3, Math.round(5 * u)), st = pw + Math.max(1, Math.round(2 * u)); for (let j = 0; j < 4; j++) { if (j < ms) { v.box(bx + j * st, ly, bx + j * st + pw, ly + bh, C[5]); v.box(bx + j * st, ly + bh - f, bx + j * st + pw, ly + bh, C[3]); } else v.frame(bx + j * st, ly, bx + j * st + pw, ly + bh, C[2]); } }
    else v.text(bx, ty, CK_num(live.kills, 2), C[5], CK_F3, f);
  }
  CK_crt(s, art.glassFx);
};

// the head-up display's symbology. sh = 1 draws the dark drop shadow pass.
const CK_hud = (v, art, live, t, gx, gy, cr, sr, sh) => {
  const u = art.u, f = art.fs, cx = art.cx, H = art.H, py = Math.round(live.pivotY), R = q => Math.round(q * u);
  const G = sh ? CK_HUDSH : CK_HUD, F3 = CK_F3, F5 = CK_F5, FB = u < 0.9 ? F3 : F5, g = art.glass;
  v.ox = v.oy = sh ? f : 0;
  v.mask = g.mask; v.mx = g.x + gx; v.my = g.y + gy; v.mw = g.aw; v.mh = g.ah;

  // pitch ladder every 10 degrees, turned with the horizon
  const hz = live.horizonY - py, fo = live.focal || H;
  for (let k = -8; k <= 8; k++) {
    const off = hz - fo * Math.tan(k * 0.174533); if (Math.abs(off) > R(130)) continue;
    const lx = cx + off * sr, ly = py + off * cr;
    for (let side = -1; side <= 1; side += 2) {
      const a0 = k ? R(15) : R(22), a1 = k ? R(42) : R(64), xa = lx + side * a0 * cr, ya = ly - side * a0 * sr, xb = lx + side * a1 * cr, yb = ly - side * a1 * sr;
      if (k < 0) v.line(xa, ya, xb, yb, G, R(4), R(3)); else v.line(xa, ya, xb, yb, G);
      if (!k) continue;
      const tk = R(4) * (k > 0 ? 1 : -1); v.line(xb, yb, xb + tk * sr, yb + tk * cr, G); // end ticks point at the horizon
      const s = (k > 0 ? '+' : '-') + Math.abs(k) * 10, tw = CK_tw(F3, 3, f), lr = a1 + R(4) + tw / 2;
      v.text(lx + side * lr * cr - tw / 2, ly - side * lr * sr - 2 * f, s, G, F3, f);
    }
  }

  // gun reticle on the boresight
  const hot = live.firing && !sh && ((t * 24) | 0) & 1, GR = hot ? CK_WHITE : G, rr = R(8);
  v.circle(cx, py, rr, GR); v.box(cx, py, cx + f, py + f, GR);
  for (let k = 0; k < 4; k++) { const dx = k === 0 ? 1 : k === 1 ? -1 : 0, dy = k === 2 ? 1 : k === 3 ? -1 : 0; v.line(cx + dx * (rr + R(3)), py + dy * (rr + R(3)), cx + dx * (rr + R(live.firing ? 10 : 7)), py + dy * (rr + R(live.firing ? 10 : 7)), GR); }

  // heading tape along the top
  const ty = py - R(54), half = R(52), ppd = 1.6 * u, hd = (((live.heading || 0) * 57.29578) % 360 + 360) % 360;
  const lw = CK_tw(FB, 2, f), lstep = ppd * 10 >= lw + 3 * f ? 10 : ppd * 20 >= lw + 3 * f ? 20 : 30; // labels are tens of degrees, aviation style
  v.box(cx - half, ty, cx + half + 1, ty + 1, G);
  for (let d = Math.ceil((hd - half / ppd) / 5) * 5; d <= hd + half / ppd; d += 5) {
    const x = Math.round(cx + (d - hd) * ppd), big = d % 10 === 0;
    v.box(x, ty - (big ? R(5) : R(3)), x + 1, ty, G);
    if (d % lstep === 0 && Math.abs(x - cx) < half - R(4)) v.text(x - (lw >> 1), ty - R(5) - 2 * f - FB.h * f, CK_num((((d % 360) + 360) % 360) / 10, 2), G, FB, f);
  }
  for (let i = 0; i < R(4); i++) v.box(cx - i, ty + 2 + i, cx + i + 1, ty + 3 + i, G);

  // speed (left) and altitude (right) scales: moving ticks, boxed readout
  for (let side = -1; side <= 1; side += 2) {
    const x = cx + side * R(72), val = Math.max(0, side < 0 ? live.speed || 0 : live.alt || 0), top = py - R(38), bot = py + R(38);
    const tu = CK_nice((side < 0 ? live.speedMax : live.altMax) / 50), ppu = 6 * u / tu, ld = Math.pow(10, Math.floor(Math.log10(tu)));
    v.box(x, top, x + 1, bot + 1, G);
    for (let k = Math.max(0, Math.ceil((val - R(38) / ppu) / tu)), k1 = Math.floor((val + R(38) / ppu) / tu); k <= k1; k++) {
      const yy = Math.round(py - (k * tu - val) * ppu), big = k % 5 === 0, len = big ? R(6) : R(3);
      if (Math.abs(yy - py) < R(7)) continue; // room for the pointer
      v.box(side < 0 ? x - len : x + 1, yy, side < 0 ? x : x + 1 + len, yy + 1, G);
      if (big) { const s = String(Math.round(k * tu / ld)); v.text(side < 0 ? x + 3 * f : x - 2 * f - CK_tw(F3, s.length, f), yy - 2 * f, s, G, F3, f); }
    }
    const s = CK_num(val, side < 0 ? 3 : 5), bw = CK_tw(FB, s.length, f) + 4 * f, bh = FB.h * f + 4 * f, lim = R(124) - 3 * f, by = py - (bh >> 1);
    const bx = side < 0 ? Math.max(x - R(8) - bw, cx - lim) : Math.min(x + R(8) + 1, cx + lim - bw); // kept inside the glass
    if (!sh) v.box(bx, by, bx + bw, by + bh, CK_HUDSH);
    v.frame(bx, by, bx + bw, by + bh, G); if (!sh) v.text(bx + 2 * f, by + 2 * f, s, CK_WHITE, FB, f);
    for (let i = 0; i < R(5); i++) v.box(x - side * (R(7) - i), py - i, x - side * (R(7) - i) + 1, py + i + 1, G); // pointer
    v.text(side < 0 ? bx : bx + bw - CK_tw(F3, 3, f), by - 7 * f, side < 0 ? 'SPD' : 'ALT', G, F3, f);
  }

  // afterburner bars, missiles and kills along the bottom
  const bx = cx - R(112), by = py + R(58), nb = Math.round(CK_clamp(live.boost || 0, 0, 1) * 6), sw = Math.max(3, R(4));
  v.text(bx, by, 'AB', G, F3, f);
  for (let i = 0; i < 6; i++) { if (i < nb) v.box(bx + 9 * f + i * (sw + 1), by, bx + 9 * f + i * (sw + 1) + sw, by + 5 * f, i > 3 && !sh ? CK_YEL : G); else v.box(bx + 9 * f + i * (sw + 1), by + 4 * f, bx + 9 * f + i * (sw + 1) + sw, by + 5 * f, G); }
  v.text(cx + R(84), py + R(52), 'MSL ' + (live.missiles | 0), G, F3, f);
  v.text(cx + R(84), py + R(52) + 7 * f, 'KIL ' + CK_num(live.kills, 2), G, F3, f);

  // target carets and the lock box are drawn anywhere above the panel, not only inside the glass
  v.mask = null;
  const lk = live.lock, tg = live.targets, s6 = R(6);
  if (tg) for (let i = 0; i < tg.length; i++) {
    const T = tg[i]; if (lk && Math.abs(T.x - lk.x) < 4 * u && Math.abs(T.y - lk.y) < 4 * u) continue;
    v.line(T.x - s6, T.y, T.x, T.y - s6, G); v.line(T.x, T.y - s6, T.x + s6, T.y, G); v.line(T.x + s6, T.y, T.x, T.y + s6, G); v.line(T.x, T.y + s6, T.x - s6, T.y, G);
  }
  if (lk) {
    if (lk.locked) {
      const c = sh ? G : CK_RED, s = R(11), tw = CK_tw(F5, 4, f), rs = CK_num(lk.range, 1);
      v.brackets(lk.x, lk.y, s, R(5), c); v.brackets(lk.x, lk.y, s - 1, R(5) - 1, c);
      v.line(lk.x - R(3), lk.y, lk.x + R(3), lk.y, c); v.line(lk.x, lk.y - R(3), lk.x, lk.y + R(3), c);
      v.text(lk.x - tw / 2, lk.y + s + 3 * f, 'LOCK', c, F5, f); v.text(lk.x - CK_tw(F3, rs.length, f) / 2, lk.y + s + 12 * f, rs, c, F3, f);
    } else if (((t * 9) | 0) & 1) { // acquiring: a blinking box that closes on the target
      const c = sh ? G : CK_YEL, s = R(25 - 14 * ((t * 1.5) % 1)), rs = CK_num(lk.range, 1);
      v.brackets(lk.x, lk.y, s, R(6), c); v.text(lk.x - CK_tw(F3, rs.length, f) / 2, lk.y + s + 3 * f, rs, c, F3, f);
    }
  }
  v.ox = v.oy = 0;
};

function drawCockpit(fb, W, H, art, live) {
  const a = CK_clamp(live.inPlace === undefined ? 1 : live.inPlace, 0, 1); if (a <= 0) return;
  const u = art.u, cx = art.cx, pad = art.pad, t = live.time || 0, B = CK_B, A = CK_A, N = CK_NEAR, away = 1 - a;
  const R = q => Math.round(q * u);
  const hx = (live.headX || 0) * u, hy = (live.headY || 0) * u;
  const offX = n => -CK_clamp(Math.round(hx * n), -pad, pad), offY = (n, slide) => Math.round(slide) - CK_clamp(Math.round(hy * n), -pad, pad);
  const low = away * H * 0.66; // the panel and consoles rise from below, the canopy comes down from above
  const pxo = offX(N.panel), pyo = offY(N.panel, low), dxo = offX(N.deck), dyo = offY(N.deck, low * 1.3), gxo = offX(N.glass), gyo = offY(N.glass, low);
  const tk = Math.round(CK_clamp(live.hit || 0, 0, 1) * 16);
  const rr = (live.roll || 0) * CK_ROLL_SIGN, cr = Math.cos(rr), sr = Math.sin(rr);
  const boost = CK_clamp(live.boost || 0, 0, 1), hp = CK_clamp(live.hp === undefined ? 1 : live.hp, 0, 1), lk = live.lock;

  // sunlight: a slanted band across the cockpit, opposite the side the sun is on
  const sun = CK_clamp(live.sunSide || 0, -1, 1), L = art.light;
  L.x = cx - sun * R(200); L.slope = CK_clamp(Math.tan(rr) * 0.9 - sun * 0.6, -2.4, 2.4); L.half = R(80); L.y0 = art.panelTop;

  CK_lay(fb, W, H, art.hoop, pad, offX(N.hoop), offY(N.hoop, -away * H * 0.85), L, tk);

  // HUD: the glass, then the symbology (shadow pass first)
  const g = art.glass, v = art.view; v.buf = fb;
  CK_glass(fb, W, H, g, g.x + gxo, g.y + gyo);
  if (a > 0.7) { CK_hud(v, art, live, t, gxo, gyo, cr, sr, 1); CK_hud(v, art, live, t, gxo, gyo, cr, sr, 0); }

  CK_lay(fb, W, H, art.panel, pad, pxo, pyo, L, tk);
  v.ox = pxo; v.oy = pyo;

  // warning lamps: power, armed, lock, damage, afterburner
  const alarm = (live.hit || 0) > 0.3, blink = ((t * 5) | 0) & 1;
  for (let i = 0; i < art.lamps.length; i++) {
    const r = art.lamps[i];
    const on = alarm || (i === 0 ? true : i === 1 ? (live.missiles | 0) > 0 : i === 2 ? (lk ? lk.locked || blink : false) : i === 3 ? hp < 0.35 && blink : boost > 0.25);
    if (!on) continue;
    const red = i === 3 || alarm, amber = i === 2;
    v.box(r.x, r.y, r.x + r.w, r.y + r.h, red ? CK_RED : amber ? CK_LAMP[1] : A[4]); v.box(r.x, r.y, r.x + r.w, r.y + 1, red ? CK_rgb(255, 170, 160) : amber ? CK_LAMP[2] : A[5]);
    v.box(r.x, r.y + r.h - 1, r.x + r.w, r.y + r.h, red ? CK_REDD : amber ? CK_LAMP[0] : A[2]);
  }
  for (let i = 0; i < art.panelKeys.length; i++) {
    const r = art.panelKeys[i]; if (CK_hash(i * 53 + ((t * (0.6 + i * 0.21)) | 0)) > 140) continue;
    v.box(r.x, r.y, r.x + r.w, r.y + r.h, i & 1 ? CK_LAMP[1] : CK_CRT[4]); v.box(r.x, r.y, r.x + r.w, r.y + 1, i & 1 ? CK_LAMP[2] : CK_CRT[5]);
  }
  { // boost column and the two round lamps beside the ball
    const b = art.boostBar, n = Math.round(boost * b.n);
    for (let i = 0; i < b.n; i++) { const y = b.y + (b.n - 1 - i) * b.seg; v.box(b.x, y, b.x + b.w, y + b.seg - 1, i < n ? (i > 3 ? A[4] : CK_CRT[4]) : CK_CRT[1]); }
    const l0 = art.roundLamps[0], l1 = art.roundLamps[1];
    if (hp < 0.35 ? blink : alarm) { v.disc(l0.x, l0.y, l0.r, CK_RED); v.put(l0.x - 1, l0.y - 1, CK_WHITE); }
    if (lk && (lk.locked || blink)) { v.disc(l1.x, l1.y, l1.r, lk.locked ? CK_RED : CK_LAMP[1]); v.put(l1.x - 1, l1.y - 1, CK_WHITE); }
  }

  // the two screens
  // the two screens repaint on alternate frames (both on the first)
  const fr = art.frame++;
  if (!(fr & 1)) CK_radar(art, live, t, fr >> 1);
  if (fr & 1 || !fr) CK_status(art, live, t);
  CK_blit(fb, W, H, art.radar.buf, art.radar.w, art.radar.h, art.radar.x + pxo, art.radar.y + pyo);
  CK_blit(fb, W, H, art.status.buf, art.status.w, art.status.h, art.status.x + pxo, art.status.y + pyo);

  { // attitude ball: a sky/earth sphere turned by roll and pitch
    const b = art.ball, r = b.r, mask = b.mask, d2 = r * 2 + 1, p = CK_clamp(live.pitch || 0, -1.5, 1.5), S = CK_SKY, E = CK_EARTH, as = b.asin, bx = b.x + pxo, by = b.y + pyo;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const m = mask[(dy + r) * d2 + dx + r]; if (!m || by + dy < 0 || by + dy >= H || bx + dx < 0 || bx + dx >= W) continue;
      const hh = dx * cr - dy * sr, vv = dx * sr + dy * cr;
      const lat = (as[CK_clamp(Math.round((vv + r) * 4), 0, r * 8)] - p) * 5.7296, q = Math.round(lat), ah = hh < 0 ? -hh : hh; // tens of degrees below the horizon
      let c;
      if (Math.abs(lat - q) < (q ? 0.13 : 0.16) && (q === 0 || ah < (q % 3 === 0 ? r * 0.44 : r * 0.24))) c = q === 0 ? CK_WHITE : q < 0 ? CK_rgb(214, 234, 255) : CK_rgb(255, 232, 196);
      else if (lat < 0) c = lat < -3 ? S[0] : lat < -0.9 ? S[1] : S[2];
      else c = lat > 3 ? E[0] : lat > 0.9 ? E[1] : E[2];
      if (m === 2) c = CK_mix(c, B[0], 128); else if (m === 3) c = CK_mix(c, CK_WHITE, 96);
      fb[(by + dy) * W + bx + dx] = c;
    }
    // the fixed aircraft mark
    const wl = Math.round(r * 0.52), wg = Math.round(r * 0.2), th = Math.max(1, art.fs);
    for (let s = -1; s <= 1; s += 2) { const x0 = b.x + (s < 0 ? -wl : wg + 1), x1 = b.x + (s < 0 ? -wg : wl + 1); v.box(x0, b.y + th, x1, b.y + th + 1, B[0]); v.box(x0, b.y, x1, b.y + th, CK_LAMP[1]); v.box(s < 0 ? x1 - 1 : x0, b.y, s < 0 ? x1 : x0 + 1, b.y + th + R(2), CK_LAMP[1]); }
    v.box(b.x - th + 1, b.y, b.x + th, b.y + th, CK_LAMP[2]);
  }
  // dial needles
  for (let i = 0; i < art.dials.length; i++) {
    const d = art.dials[i], k = d.kind;
    const deg = k === 0 ? -135 + 270 * CK_clamp((live.speed || 0) / (live.speedMax || 1), 0, 1) : k === 1 ? -135 + 270 * CK_clamp((live.alt || 0) / (live.altMax || 1), 0, 1)
      : k === 2 ? -90 + 84 * CK_clamp(live.climb || 0, -1, 1) : 70 * CK_clamp(live.turn || 0, -1, 1);
    const an = deg * 0.0174533, sx = Math.sin(an), sy = -Math.cos(an);
    v.line(d.x - sx * d.r * 0.25, d.y - sy * d.r * 0.25, d.x + sx * (d.r - 3), d.y + sy * (d.r - 3), A[4]);
    v.put(d.x + sx * (d.r - 2.5), d.y + sy * (d.r - 2.5), CK_WHITE); v.put(d.x, d.y, B[8]); v.put(d.x + 1, d.y + 1, B[0]);
  }

  // consoles
  CK_lay(fb, W, H, art.deck, pad, dxo, dyo, L, tk);
  v.ox = dxo; v.oy = dyo;
  for (let i = 0; i < art.deckKeys.length; i++) {
    const r = art.deckKeys[i]; if (CK_hash(i * 91 + ((t * (0.8 + i * 0.3)) | 0)) > 120) continue;
    v.box(r.x, r.y, r.x + r.w, r.y + r.h - 1, CK_LAMP[2]);
  }
  { // throttle lever: slides forward (up the quadrant) with boost
    const th = art.throttle, y = Math.round(th.yA + (th.yB - th.yA) * boost), hot = boost > 0.6;
    v.ox = offX(N.lever); v.oy = offY(N.lever, low * 1.3);
    for (let s = 0; s < 2; s++) { const sx = s ? th.x1 - R(14) : th.x0 + R(9); v.box(sx - 1, y + 2, sx + R(5) + 1, H + pad, B[0]); v.box(sx, y + 2, sx + R(5), H + pad, B[5]); v.box(sx, y + 2, sx + 1, H + pad, B[7]); }
    v.box(th.x0 + 2, y + 2, th.x1 + 2, y + th.h + 2, B[0]); v.box(th.x0 - 1, y - 1, th.x1 + 1, y + th.h + 1, B[0]);
    v.plate(th.x0, y, th.x1, y + th.h, hot ? A[4] : A[3], A[5], A[1]); v.box(th.x0 + 1, y + 1, th.x1 - 1, y + 2, hot ? A[5] : A[4]); v.box(th.x0 + 1, y + th.h - 2, th.x1 - 1, y + th.h - 1, A[2]);
    for (let x = th.x0 + R(6); x < th.x1 - R(4); x += Math.max(3, R(5))) v.box(x, y + 2, x + 1, y + th.h - 2, A[1]); // grip ribs
  }
  { // control stick: a ribbed boot from the floor up to the grip, leaning with turn and climb
    const G = art.grip, turn = CK_clamp(live.turn || 0, -1, 1), climb = CK_clamp(live.climb || 0, -1, 1), sxo = offX(N.stick), syo = offY(N.stick, low * 1.5);
    const tx = cx + Math.round(turn * 11 * u) + sxo, tyy = R(330) + Math.round(climb * 4 * u) + syo, bx = cx + sxo, byy = R(372) + syo, per = Math.max(3, R(5));
    for (let y = Math.max(0, tyy); y < H; y++) {
      const q = (y - tyy) / (byy - tyy), xc = tx + (bx - tx) * q, ph = (y - tyy) % per, hw = (6.5 + q * 9) * u - (ph === per - 1 ? 1.5 : ph === 0 ? 0.5 : 0);
      const xa = Math.round(xc - hw), xb = Math.round(xc + hw), o = y * W;
      for (let x = Math.max(0, xa); x <= xb && x < W; x++) {
        const e = (x - xa) / (xb - xa + 1);
        fb[o + x] = x === xa || x === xb || ph === per - 1 ? B[0] : ph === 0 ? (e < 0.55 ? B[6] : B[4]) : e < 0.12 ? B[5] : e < 0.5 ? (ph === 1 ? B[4] : B[3]) : e < 0.8 ? B[2] : B[1];
      }
    }
    CK_sprite(fb, W, H, G, tx - (G.aw >> 1), tyy - G.ah + 1);
  }

  CK_lay(fb, W, H, art.rear, pad, offX(N.rear), offY(N.rear, -away * H), null, tk);
}
