// Self-check: flies the game headless for 45 simulated seconds with random input and asserts nothing breaks.
// usage: node tools/smoke.mjs      (run after node tools/build_jets.mjs if the jets changed)
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert';
const root = fileURLToPath(new URL('../', import.meta.url));
const src = ['parts/jets.js', 'parts/cockpit.js', 'src/engine.js'].map(f => readFileSync(root + f, 'utf8')).join('\n').replace("'use strict';", '');
const game = new Function('performance', src + '\nreturn createGame;')(performance)();
let seed = 12345;
const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
for (const [w, h] of [[640, 360], [426, 240], [704, 396]]) {
  game.resize(w, h);
  for (let i = 0; i < 900; i++) {
    if (i % 40 === 0) game.pointerMove(rnd() * w, rnd() * h);
    if (i % 97 === 0) game.setHolding(rnd() < 0.6);
    if (i % 211 === 0) game.toggleView();
    if (i % 131 === 0) game.fireMissile();
    if (i % 173 === 0) game.startRoll(rnd() < 0.5 ? -1 : 1);
    if (i % 301 === 0) game.setKeys(0, Math.round(rnd() * 2 - 1), rnd() < 0.4);
    if (i % 997 === 0) game.cycleTime();
    if (i % 600 === 300 && game.enemies[0]) game.killEnemy(game.enemies[0]);
    game.step(1 / 60);
    const px = game.render(), L = game.lead;
    assert(Number.isFinite(L.x) && Number.isFinite(L.y) && Number.isFinite(L.z) && Number.isFinite(L.yaw), 'jet state went non-finite at step ' + i);
    assert(L.z >= 2 && L.z <= game.P.ceiling + 2, 'altitude out of range: ' + L.z);
    assert(px.length === w * h * 4, 'frame size');
    if (i % 200 === 0) { let opaque = true; for (let o = 3; o < px.length; o += 4 * 997) if (px[o] !== 255) opaque = false; assert(opaque, 'a pixel was left unpainted at step ' + i); }
    for (const e of game.enemies) assert(Number.isFinite(e.x) && Number.isFinite(e.z), 'enemy state went non-finite');
  }
  console.log(`${w}x${h} ok — kills ${game.cb.kills}, hp ${game.cb.hp}, enemies ${game.enemies.length}`);
}
console.log('smoke test passed');
