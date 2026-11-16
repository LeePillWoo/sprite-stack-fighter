// Measures picture wobble caused by motion smoothing: flies two identical games (smoothing off / on) through a
// steady turn and, for every 16×16 block, finds how far the smoothed picture sits from the true one.
// A steady picture reports ~0 px; "jelly" shows up as blocks displaced by a pixel or more, differently each frame.
// usage: node tools/wobble.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const src = ['parts/jets.js', 'parts/cockpit.js', 'src/engine.js'].map(f => readFileSync(root + f, 'utf8')).join('\n').replace("'use strict';", '');
const W = 640, H = 360;
const make = cycles => {
  const g = new Function('performance', src + '\nreturn createGame;')(performance)();
  g.resize(W, H); g.pointerMove(470, 110); g.enemies.length = 0;
  for (let i = 0; i < cycles; i++) g.cycleSmooth();
  return g;
};
const lum = px => { const l = new Float32Array(W * H); for (let i = 0; i < W * H; i++) l[i] = px[i * 4] * 0.3 + px[i * 4 + 1] * 0.59 + px[i * 4 + 2] * 0.11; return l; };
for (const [name, cycles] of [['light', 2], ['strong', 0]]) {   // the game starts on strong; one more step is off
  const raw = make(1), sm = make(cycles), out = [];
  for (const view of [0, 1]) {
    raw.setView(view, true); sm.setView(view, true);
    for (let i = 0; i < 120; i++) { raw.step(1 / 60); raw.render(); sm.step(1 / 60); sm.render(); }
    let moved = 0, dist = 0, n = 0, jump = 0, prev = null;
    for (let f = 0; f < 12; f++) {
      raw.step(1 / 60); sm.step(1 / 60);
      const a = lum(raw.render()), b = lum(sm.render()), cur = [];
      for (let by = 64; by < H - 64; by += 16) for (let bx = 64; bx < W - 64; bx += 16) {
        let best = 1e18, sx = 0, sy = 0, flat = 0;
        for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
          let sad = 0;
          for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) sad += Math.abs(a[(by + y) * W + bx + x] - b[(by + y + dy) * W + bx + x + dx]);
          sad += (Math.abs(dx) + Math.abs(dy)) * 4;   // prefer no shift when it makes no difference
          if (sad < best) { best = sad; sx = dx; sy = dy; }
        }
        for (let y = 0; y < 16; y++) for (let x = 1; x < 16; x++) flat += Math.abs(a[(by + y) * W + bx + x] - a[(by + y) * W + bx + x - 1]);
        if (flat < 400) { cur.push(null); continue; }   // featureless block (open sea): nothing to measure
        cur.push([sx, sy]); n++; dist += Math.hypot(sx, sy); if (sx || sy) moved++;
      }
      if (prev) for (let i = 0; i < cur.length; i++) if (cur[i] && prev[i] && (cur[i][0] !== prev[i][0] || cur[i][1] !== prev[i][1])) jump++;
      prev = cur;
    }
    out.push(`${view ? 'chase' : 'top  '}: blocks off by ≥1px ${(100 * moved / n).toFixed(1)}%, mean offset ${(dist / n).toFixed(2)}px, blocks whose offset changed frame to frame ${(100 * jump / n).toFixed(1)}%`);
  }
  console.log(name.padEnd(6), '|', out.join(' | '));
}
