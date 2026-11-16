// Runs the renderer headless in Node (same V8 as Chrome) to time each view.  usage: node tools/bench.mjs [w h]
// Reports the fastest and the median frame: the fastest is what an idle core manages.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const src = ['parts/jets.js', 'src/engine.js'].map(f => readFileSync(root + f, 'utf8')).join('\n');
const make = new Function('performance', src.replace("'use strict';", '') + '\nfunction buildCockpit(){return {};}\nfunction drawCockpit(){}\nreturn createGame;');
const game = make(performance)();
const w = +(process.argv[2] || 640), h = +(process.argv[3] || 360);
game.resize(w, h);
game.pointerMove(w * 0.7, h * 0.3);
for (const [name, v] of [['top', 0], ['chase', 1], ['cockpit', 2]]) {
  game.setView(v, true);
  for (let i = 0; i < 60; i++) { game.step(1 / 60); game.render(); }
  const ts = [];
  for (let i = 0; i < 300; i++) { game.step(1 / 60); const t = performance.now(); game.render(); ts.push(performance.now() - t); }
  ts.sort((a, b) => a - b);
  console.log(name.padEnd(8), 'min', ts[0].toFixed(2), 'p10', ts[30].toFixed(2), 'median', ts[150].toFixed(2), 'ms');
}
