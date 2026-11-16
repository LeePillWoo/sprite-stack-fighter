// Inlines the parts into one self-contained fighter.html.  usage: node tools/build.mjs
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
// until the cockpit module exists, a stub keeps the game running
const STUB = 'function buildCockpit(){return {};}\nfunction drawCockpit(){}\n';
const html = readFileSync(root + 'src/shell.html', 'utf8').replace(/\/\*@include (.+?)\*\//g, (_, f) =>
  existsSync(root + f) ? readFileSync(root + f, 'utf8') : (console.log('missing', f, '- using stub'), STUB));
writeFileSync(root + 'fighter.html', html);
console.log('fighter.html', (html.length / 1024).toFixed(0), 'KB');
