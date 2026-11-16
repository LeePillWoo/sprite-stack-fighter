// smoke test: odd sizes, missing optional fields, extreme values must not throw or write outside the frame
import { readFileSync } from 'node:fs';
import assert from 'node:assert';
const { buildCockpit, drawCockpit } = new Function(readFileSync('F:/AI_Project_Pill/Project_fighter/parts/cockpit.js', 'utf8') + '\nreturn { buildCockpit, drawCockpit };')();
for (const [W, H] of [[640, 360], [512, 288], [426, 240], [840, 360], [480, 360], [960, 540], [321, 181]]) {
  const art = buildCockpit(W, H), fb = new Uint32Array(W * H + 64), guard = 0xff123456;
  const base = { time: 1, roll: 0, pitch: 0, heading: 0, horizonY: H * 0.34, pivotY: H * 0.34, focal: W * 0.75, speed: 300, speedMax: 600, alt: 5000, altMax: 30000, climb: 0, turn: 0, boost: 0 };
  const cases = [base, { ...base, inPlace: 0 }, { ...base, inPlace: 0.3, headX: 99, headY: -99 }, { ...base, roll: Math.PI / 2, pitch: 1.57, heading: -7, hit: 1, firing: true, boost: 1, turn: -1, climb: 1, hp: 0, missiles: 9, kills: 123456 },
    { ...base, lock: { x: -50, y: 9999, locked: true, range: 1e7 }, targets: [{ x: W + 40, y: -40, dist: 1 }], blips: [1e6, -1e6, 0, 0, 5], land: () => 3, speed: -5, alt: 1e9, speedMax: 0, altMax: 0, hit: 0.5, sunSide: 5, pivotY: -30, horizonY: 1e5, focal: 0 },
    { ...base, lock: { x: W / 2, y: H / 3, locked: false, range: 0 }, time: 1e6, roll: 1e3, headX: -99, headY: 99, sunSide: -1 }];
  for (const c of cases) for (let k = 0; k < 3; k++) { fb.fill(guard); drawCockpit(fb.subarray(0, W * H), W, H, art, c); for (let i = W * H; i < fb.length; i++) assert.equal(fb[i], guard); for (let i = 0; i < W * H; i++) if (fb[i] >>> 24 !== 255) assert.fail(`alpha ${W}x${H} at ${i}`); }
  console.log(W + 'x' + H, 'ok');
}
