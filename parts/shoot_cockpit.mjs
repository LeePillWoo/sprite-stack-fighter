// usage: STEPS='[{"eval":"...","shot":"name","clip":[x,y,w,h,scale]}]' node shoot_cockpit.mjs [query]
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
const dir = 'F:/AI_Project_Pill/Project_fighter/parts', out = dir + '/shots'; mkdirSync(out, { recursive: true });
const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const url = 'file:///' + dir + '/cockpit_test.html' + (process.argv[2] ? '?' + process.argv[2] : '');
const proc = spawn(chrome, ['--remote-debugging-port=9341', `--user-data-dir=${dir}/tmp/prof`, '--window-size=1300,800', '--no-first-run',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--headless=new', url], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let ws;
for (let i = 0; i < 40 && !ws; i++) {
  try { const pg = (await (await fetch('http://127.0.0.1:9341/json')).json()).find(t => t.type === 'page'); if (pg) ws = new WebSocket(pg.webSocketDebuggerUrl); } catch { }
  if (!ws) await sleep(250);
}
await new Promise(r => ws.onopen = r);
let id = 0; const pending = {}, logs = [];
ws.onmessage = e => {
  const m = JSON.parse(e.data); if (m.id && pending[m.id]) { pending[m.id](m); delete pending[m.id]; }
  if (m.method === 'Runtime.exceptionThrown') logs.push(JSON.stringify(m.params.exceptionDetails).slice(0, 800));
  if (m.method === 'Runtime.consoleAPICalled') logs.push(m.params.args.map(a => a.value).join(' '));
};
const send = (method, params = {}) => new Promise(r => { const i = ++id; pending[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async e => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result?.result?.value;
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
for (let i = 0; i < 40 && !(await ev('window.frames > 5')); i++) await sleep(250);
console.log('buildMs', await ev('window.buildMs'));
for (const s of JSON.parse(process.env.STEPS || '[{"shot":"default"}]')) {
  if (s.eval) await ev(s.eval);
  await sleep(s.wait || 400);
  if (s.shot) {
    const c = s.clip || [0, 0, 1280, 720, 1];
    const r = await send('Page.captureScreenshot', { format: 'png', clip: { x: c[0], y: c[1], width: c[2], height: c[3], scale: c[4] || 1 } });
    writeFileSync(`${out}/${s.shot}.png`, Buffer.from(r.result.data, 'base64'));
  }
  console.log(s.shot || '', 'msPerFrame', await ev('window.msPerFrame'));
}
if (logs.length) console.log(logs.join('\n'));
ws.close(); proc.kill();
