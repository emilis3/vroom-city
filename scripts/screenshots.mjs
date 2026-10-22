// Captures the README screenshots and the link preview image: node scripts/screenshots.mjs
// Dev-only, like the tests: headless Chromium with software WebGL.
import { chromium } from '@playwright/test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const GAME = pathToFileURL(fileURLToPath(new URL('../vroom-city.html', import.meta.url))).href;
const OUT = fileURLToPath(new URL('../docs/screenshots/', import.meta.url));

// each shot puts the player somewhere, then lets the game run a moment so the camera settles
const SHOTS = {
  town: () => { Object.assign(car, { v: 10 }); },
  boat: () => {
    // open water in the lake, heading towards town
    let x = 0, z = 0;
    for (const d of lake.discs) for (let r = d.r * .3; r < d.r; r += 4) for (let a = 0; a < 6.3; a += .3) {
      const px = d.x + Math.cos(a) * r, pz = d.z + Math.sin(a) * r;
      if (inWater(px, pz, 14) && Math.hypot(px - W / 2, pz - W / 2) < Math.hypot(x - W / 2, z - W / 2)) { x = px; z = pz; }
    }
    setMode('boat'); Object.assign(boat, { x, z, a: Math.atan2(W / 2 - x, W / 2 - z), v: 12, hop: 0, vy: 0 });
  },
  helicopter: () => {
    const m = mountains[0];
    setMode('heli'); Object.assign(heli, { x: m.x + m.r * 2.2, y: 28, z: m.z, a: Math.atan2(m.x - heli.x, 0) || -Math.PI / 2, v: 6 });
  },
  moon: () => { setMode('rocket'); landOnMoon(); rocket.y = 0; buggyOut(); Object.assign(buggy, { x: 34, z: 8, a: Math.atan2(-34, -8), v: 3 }); }, // looking back at the rocket
};

const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });

await page.goto(GAME);
await page.waitForFunction(() => T > 1);
await page.screenshot({ path: OUT + 'preview.png' }); // the title screen over the town
await page.setViewportSize({ width: 960, height: 540 });
await page.keyboard.press('KeyX'); // start
for (const [name, place] of Object.entries(SHOTS)) {
  await page.evaluate(`(${place})(); snapCam = true;`);
  const t = await page.evaluate(() => T);
  await page.waitForFunction(t => T > t + 1.5, t, { timeout: 60_000 });
  await page.screenshot({ path: `${OUT}${name}.png` });
  console.log(name);
}
await browser.close();
