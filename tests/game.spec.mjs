// Browser checks for vroom-city.html, run in headless Chromium with software WebGL.
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const GAME = pathToFileURL(fileURLToPath(new URL('../vroom-city.html', import.meta.url))).href;
const LAYOUT = JSON.parse(readFileSync(new URL('./fixtures/layout.json', import.meta.url), 'utf8'));

// Opens the game, collecting page errors, console errors and any request that isn't the file itself.
async function open(page, init) {
  const problems = [];
  page.on('pageerror', e => problems.push(`page error: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error') problems.push(`console error: ${m.text()}`); });
  page.on('request', r => { if (r.url() !== GAME) problems.push(`network request: ${r.url()}`); });
  if (init) await page.addInitScript(init);
  await page.goto(GAME);
  await page.waitForFunction(() => T > 0.3);
  return problems;
}
const glError = page => page.evaluate(() => gl.getError());

test('loads, draws frames and needs nothing from the network', async ({ page }) => {
  const problems = await open(page);
  expect(await page.evaluate(() => ({ shadows: quality.shadows, lost: gl.isContextLost() })))
    .toEqual({ shadows: true, lost: false });
  expect(await glError(page)).toBe(0);
  // the picture isn't blank: sky at the top, darker road and buildings lower down
  const shot = await page.locator('canvas').screenshot();
  expect(shot.length).toBeGreaterThan(20_000);
  expect(problems).toEqual([]);
});

test('town, collisions and stars are exactly where they were before', async ({ page }) => {
  await open(page);
  const now = await page.evaluate(() => ({ stars, solids, mountains: mountains.map(m => ({ x: m.x, z: m.z, r: m.r, h: m.h })), lake }));
  expect(now.solids).toEqual(LAYOUT.solids);
  expect(now.mountains).toEqual(LAYOUT.mountains);
  expect(now.lake).toEqual(LAYOUT.lake);
  expect(now.stars).toEqual(LAYOUT.stars);
});

test('without depth-texture support it runs without real shadows', async ({ page }) => {
  const problems = await open(page, () => {
    const get = WebGLRenderingContext.prototype.getExtension;
    WebGLRenderingContext.prototype.getExtension = function (name) { return name === 'WEBGL_depth_texture' ? null : get.call(this, name); };
  });
  expect(await page.evaluate(() => quality.shadows)).toBe(false);
  await page.keyboard.press('KeyX');
  await page.keyboard.down('ArrowUp');
  await page.waitForTimeout(500);
  await page.keyboard.press('KeyH');
  await page.waitForTimeout(500);
  expect(await glError(page)).toBe(0);
  expect(problems).toEqual([]);
});

test('safety net: choppy frames turn shadows off and lower sharpness, once and silently', async ({ page }) => {
  // pretend every frame takes 200 ms (a small window keeps the software renderer quick)
  await page.setViewportSize({ width: 400, height: 300 });
  const problems = await open(page, () => {
    const raf = window.requestAnimationFrame.bind(window);
    let t = 0;
    window.requestAnimationFrame = cb => raf(() => { t += 200; cb(t); });
  });
  await page.evaluate(() => { window.devicePixelRatio = 2; resize(); });
  expect(await page.evaluate(() => cv.width)).toBe(800);
  await page.waitForFunction(() => !quality.shadows, null, { timeout: 30_000, polling: 250 });
  expect(await page.evaluate(() => ({ q: quality, w: cv.width, msgs: document.body.innerText.includes('slow') })))
    .toEqual({ q: { shadows: false, maxDpr: 1 }, w: 400, msgs: false });
  expect(await glError(page)).toBe(0);
  expect(problems).toEqual([]);
});

test('safety net logic', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(() => {
    const run = (frames, w = makePerfWatch()) => frames.map(ms => w(ms)).filter(Boolean).length;
    const fast = run(Array(1000).fill(16));
    const slow = run(Array(1000).fill(40));
    const justUnder = run(Array(1000).fill(24));
    // slow only while loading (first 2 s), then smooth
    const loading = run([...Array(50).fill(40), ...Array(500).fill(16)]);
    // long pauses (tab hidden) are ignored and restart the count
    const paused = run(Array(400).fill(0).map((_, i) => i % 50 === 49 ? 5000 : 30));
    const w = makePerfWatch(), fired = [];
    for (let i = 0; i < 300; i++) if (w(40)) fired.push(i);
    return { fast, slow, justUnder, loading, paused, firstAt: fired[0], count: fired.length };
  });
  // 2 s warm-up (50 frames of 40 ms) + 3 s of slow frames (75 frames) = fires on frame 125
  expect(r).toEqual({ fast: 0, slow: 1, justUnder: 0, loading: 0, paused: 0, firstAt: 124, count: 1 });
});

test('shapes have outward-facing unit normals', async ({ page }) => {
  await open(page);
  const bad = await page.evaluate(() => {
    const shapes = { BOX, GABLE, ICO1, ICO2, CYL6, CONE8, DISC, WHEEL, LENS, BOOM, ROD, STAR,
      bevel: bevelShape(2.2, .85, 4.4, .25), frustum: frustumShape(.4) };
    const out = [];
    for (const [name, shape] of Object.entries(shapes)) {
      const v = [];
      mesh(shape, 10, 20, 30, 2, 3, 4, .7, [1, 1, 1], 0, v);
      if (v.length === 0) out.push(`${name}: empty`);
      for (let i = 0; i < v.length; i += 30) {
        const p = [0, 1, 2].map(k => v.slice(i + k * 10, i + k * 10 + 3)), n = v.slice(i + 3, i + 6);
        const c = [0, 1, 2].map(a => (p[0][a] + p[1][a] + p[2][a]) / 3 - [10, 20, 30][a]);
        const geo = cross(sub(p[1], p[0]), sub(p[2], p[0])); // counter-clockwise seen from outside
        if (Math.abs(Math.hypot(...n) - 1) > 1e-6 || dot(n, c) <= 0 || dot(geo, n) <= 0) { out.push(name); break; }
      }
    }
    return out;
  });
  expect(bad).toEqual([]);
});

test('driving, flying and collecting a star still work, with the new effects', async ({ page }) => {
  // the game moves a little each frame, and software rendering is slow on CI: a small window keeps frames coming
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 400, height: 300 });
  const problems = await open(page);
  await page.keyboard.press('KeyX'); // start
  const before = await page.evaluate(() => ({ x: car.x, z: car.z, spin: car.spin }));
  await page.keyboard.down('ArrowUp');
  await page.waitForFunction(() => car.v > 13, null, { timeout: 40_000 });
  await page.keyboard.down('ArrowLeft');
  await page.waitForFunction(() => fx.some(f => f.dust), null, { timeout: 40_000 }); // dust on a hard turn
  await page.keyboard.up('ArrowLeft');
  await page.keyboard.up('ArrowUp');
  const after = await page.evaluate(() => ({ x: car.x, z: car.z, spin: car.spin }));
  expect(Math.hypot(after.x - before.x, after.z - before.z)).toBeGreaterThan(5);
  expect(after.spin).toBeGreaterThan(before.spin); // wheels rolled forward

  // put a road star on the car: score goes up and sparkles fly
  await page.evaluate(() => Object.assign(stars[0], { x: car.x, z: car.z, y: 2.2, sky: false }));
  await page.waitForFunction(() => score === 1, null, { timeout: 30_000 });
  expect(await page.evaluate(() => fx.filter(f => !f.dust).length)).toBeGreaterThan(0);

  // helicopter: takes off and blows dust near the ground
  await page.keyboard.press('KeyH');
  await page.waitForFunction(() => mode === 'heli' && fx.some(f => f.dust && f.y < heli.y), null, { timeout: 30_000 });
  await page.waitForFunction(() => heli.y > 5, null, { timeout: 30_000 });
  expect(await glError(page)).toBe(0);
  expect(problems).toEqual([]);
});
