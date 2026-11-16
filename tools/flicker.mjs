// Measures shimmer: how much the picture changes from frame to frame while flying a steady turn,
// with motion smoothing off / light / strong.  usage: node tools/flicker.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const src = ['parts/jets.js', 'parts/cockpit.js', 'src/engine.js'].map(f => readFileSync(root + f, 'utf8')).join('\n').replace("'use strict';", '');
for (const mode of [0, 1, 2]) {
  const game = new Function('performance', src + '\nreturn createGame;')(performance)();
  game.resize(640, 360); game.pointerMove(470, 110); game.enemies.length = 0;
  for (let m = 0; m < [1, 2, 0][mode]; m++) game.cycleSmooth();   // the game starts on strong
  const out = [];
  for (const view of [0, 1]) {
    game.setView(view, true);
    for (let i = 0; i < 150; i++) { game.step(1 / 60); game.render(); }
    let flips = 0, change = 0, n = 0, a = null, b = null;
    for (let i = 0; i < 40; i++) {
      game.step(1 / 60);
      const c = Uint8Array.from(game.render());
      if (a && b) for (let o = 0; o < c.length; o += 4) {
        const d1 = Math.abs(c[o] - b[o]) + Math.abs(c[o + 1] - b[o + 1]) + Math.abs(c[o + 2] - b[o + 2]);
        const d2 = Math.abs(c[o] - a[o]) + Math.abs(c[o + 1] - a[o + 1]) + Math.abs(c[o + 2] - a[o + 2]);
        change += d1; n++;
        if (d1 > 40 && d2 < 12) flips++;      // changed this frame, back to what it was two frames ago
      }
      a = b; b = c;
    }
    out.push(`${view ? 'chase' : 'top  '}: mean change/frame ${(change / n).toFixed(1)}, pixels flipping back and forth ${(100 * flips / n).toFixed(2)}%`);
  }
  console.log(['off   ', 'light ', 'strong'][mode], '|', out.join(' | '));
}
