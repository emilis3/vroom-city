// Lints the game's inline script and the test files with ESLint's recommended rules.
import { readFileSync, readdirSync } from 'node:fs';
import { Linter } from 'eslint';
import js from '@eslint/js';

const browser = Object.fromEntries(['window', 'document', 'addEventListener', 'innerWidth', 'innerHeight', 'devicePixelRatio',
  'performance', 'requestAnimationFrame', 'AudioContext', 'WebGLRenderingContext'].map(n => [n, 'readonly']));
const node = Object.fromEntries(['process', 'console'].map(n => [n, 'readonly']));
const linter = new Linter();
const config = (globals, sourceType) => [js.configs.recommended, { languageOptions: { ecmaVersion: 2024, sourceType, globals } }];

const html = readFileSync('vroom-city.html', 'utf8');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
const offset = html.slice(0, scripts[0].index).split('\n').length - 1;
const files = [{ name: 'vroom-city.html', code: scripts[0][1], lineOffset: offset, cfg: config(browser, 'script') }];
for (const f of readdirSync('tests').filter(f => f.endsWith('.mjs'))) {
  // test code runs inside the game page and uses the game's own globals, so undefined names are allowed there
  const cfg = [...config({ ...browser, ...node }, 'module'), { rules: { 'no-undef': 'off' } }];
  files.push({ name: `tests/${f}`, code: readFileSync(`tests/${f}`, 'utf8'), lineOffset: 0, cfg });
}
files.push({ name: 'playwright.config.mjs', code: readFileSync('playwright.config.mjs', 'utf8'), lineOffset: 0, cfg: config(node, 'module') });

let problems = 0;
for (const f of files) {
  for (const m of linter.verify(f.code, f.cfg, { filename: f.name.endsWith('.html') ? f.name + '.js' : f.name })) {
    problems++;
    console.log(`${f.name}:${m.line + f.lineOffset}:${m.column}  ${m.message}  (${m.ruleId ?? 'parse'})`);
  }
}
if (scripts.length !== 1) { problems++; console.log(`expected exactly one inline <script>, found ${scripts.length}`); }
console.log(problems ? `${problems} problem(s)` : `lint clean (${files.length} files)`);
process.exit(problems ? 1 : 0);
