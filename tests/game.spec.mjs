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
  const now = await page.evaluate(() => ({ stars, solids: solids.slice(0, station.firstSolid), mountains: mountains.map(m => ({ x: m.x, z: m.z, r: m.r, h: m.h })), lake }));
  // only the few countryside trees where the launch station and the construction site now stand are gone
  const kept = await page.evaluate(all => all.filter(s => {
    const x = (s.x0 + s.x1) / 2, z = (s.z0 + s.z1) / 2;
    return !inStationArea(x, z, 3) && !inSiteArea(x, z, 3);
  }), LAYOUT.solids);
  expect(LAYOUT.solids.length - kept.length).toBeLessThan(30);
  expect(now.solids).toEqual(kept);
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

// ---------- Boat (#4, #17) ----------

// In the page: where the water ends going from (x, z) in direction (dx, dz), and a short way either side of that edge.
// t > 0 is on the land side, t < 0 on the water side. From the island's middle outwards it finds the island's beach.
const SHORE_AT = `(x, z, dx, dz) => {
  const l = Math.hypot(dx, dz); dx /= l; dz /= l;
  const start = inWater(x, z, 0);
  let t = 0; while (inWater(x + dx * t, z + dz * t, 0) === start) t += .5;
  let a = t - .5, b = t; for (let i = 0; i < 30; i++) { const m = (a + b) / 2; if (inWater(x + dx * m, z + dz * m, 0) === start) a = m; else b = m; }
  const ex = x + dx * b, ez = z + dz * b, s = start ? 1 : -1; // s points from the water onto the land
  return { at: k => ({ x: ex + dx * k * s, z: ez + dz * k * s }), toWater: Math.atan2(-dx * s, -dz * s), toLand: Math.atan2(dx * s, dz * s) };
}`;
// the lake shore facing town, found from the island's middle going towards town
const TOWN_SHORE = `(${SHORE_AT})(island.x + (W / 2 - island.x) * (island.b + 1) / Math.hypot(W / 2 - island.x, W / 2 - island.z),
  island.z + (W / 2 - island.z) * (island.b + 1) / Math.hypot(W / 2 - island.x, W / 2 - island.z), W / 2 - island.x, W / 2 - island.z)`;

test('water: a lake four times as big, shaped round the mountains, with one big island in the middle', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(() => {
    const G = 2, x0 = Math.min(...lake.discs.map(d => d.x - d.r)), x1 = Math.max(...lake.discs.map(d => d.x + d.r));
    const z0 = Math.min(...lake.discs.map(d => d.z - d.r)), z1 = Math.max(...lake.discs.map(d => d.z + d.r));
    let water = 0, land = 0, cx = 0, cz = 0;
    for (let x = x0; x < x1; x += G) for (let z = z0; z < z1; z += G) {
      if (!inLake(x, z, 0)) continue;
      if (onIsland(x, z, 0)) land += G * G; else { water += G * G; cx += x; cz += z; }
    }
    const townWet = [];
    for (let x = -10; x <= W + 10; x += 2) for (let z = -10; z <= W + 10; z += 2) if (wet(x, z, 0)) townWet.push([x, z]);
    const ring = [], c = Math.cos(island.yaw), s = Math.sin(island.yaw);
    for (let k = 0; k < 64; k++) { // 30 m of open water all round the island
      const e = k / 64 * Math.PI * 2, lx = Math.cos(e) * (island.b + 30), lz = Math.sin(e) * (island.a + 30);
      ring.push(inWater(island.x + lx * c + lz * s, island.z - lx * s + lz * c, 0));
    }
    return {
      area: water / (120 * 86), fill: (water + land) / ((x1 - x0) * (z1 - z0)), townWet, ring: ring.every(Boolean),
      lakeToTown: Math.min(...lake.discs.map(d => townDist(d.x, d.z) - d.r - 5)),
      onMountain: lake.discs.some(d => mountains.some(m => Math.hypot(m.x - d.x, m.z - d.z) < m.r * 1.4 + d.r)),
      island: [island.a * 2, island.b * 2, onLand(island.x, island.z, SHORE), inWater(island.x, island.z)],
      middle: Math.hypot(cx / (water / G / G) - island.x, cz / (water / G / G) - island.z),
      treesInWater: solids.filter(k => k.top > 4 && wet((k.x0 + k.x1) / 2, (k.z0 + k.z1) / 2, 0) && !onIsland((k.x0 + k.x1) / 2, (k.z0 + k.z1) / 2, 0)).length,
    };
  });
  expect(r.area).toBeGreaterThanOrEqual(3.5 * .96); // 4 times the old 120 x 86, measured on a 2 m grid
  expect(r.area).toBeLessThanOrEqual(4.5);
  expect(r.fill).toBeLessThan(.85); // not a rectangle
  expect(r.lakeToTown).toBeGreaterThanOrEqual(20);
  expect(r.townWet).toEqual([]); // park ponds are not boat water
  expect(r.onMountain).toBe(false);
  expect(r.island).toEqual([80, 56, true, false]);
  expect(r.ring).toBe(true);
  expect(r.middle).toBeLessThan(25);
  expect(r.treesInWater).toBe(0);
});

test('the river is 18 m wide and loops round a mountain, out of the lake and back into it', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(() => {
    let len = 0;
    for (let i = 1; i < river.length; i++) len += Math.hypot(river[i].x - river[i - 1].x, river[i].z - river[i - 1].z);
    const inside = (m, poly) => { // is the mountain's middle inside the river's loop (closed across the lake)?
      let n = 0;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const a = poly[i], b = poly[j];
        if ((a.z > m.z) !== (b.z > m.z) && m.x < (b.x - a.x) * (m.z - a.z) / (b.z - a.z) + a.x) n++;
      }
      return n % 2 === 1;
    };
    const first = river[0], last = river[river.length - 1], mid = river.slice(2, -2);
    let crossing = 0;
    for (let i = 0; i < river.length; i++) for (let j = i + 4; j < river.length; j++)
      if (Math.hypot(river[i].x - river[j].x, river[i].z - river[j].z) < RIVERW + 5) crossing++;
    return {
      width: RIVERW, len, ends: [inLake(first.x, first.z, 0), inLake(last.x, last.z, 0)], apart: Math.hypot(first.x - last.x, first.z - last.z),
      round: mountains.filter(m => inside(m, river)).length, crossing,
      touchesLake: mid.some(p => inLake(p.x, p.z, RIVERW / 2)),
      riverToTown: Math.min(...river.map(p => townDist(p.x, p.z))),
      riverInMountain: river.some(p => mountains.some(m => Math.hypot(m.x - p.x, m.z - p.z) < m.r * 1.4)),
      river: inWater(river[10].x, river[10].z), riverBank: inWater(river[10].x + RIVERW / 2 + 2, river[10].z + RIVERW / 2 + 2),
    };
  });
  expect(r.width).toBe(18);
  expect(r.len).toBeGreaterThanOrEqual(250);
  expect(r.len).toBeLessThanOrEqual(800);
  expect(r.ends).toEqual([true, true]);
  expect(r.apart).toBeGreaterThan(60);
  expect(r.round).toBeGreaterThanOrEqual(1);
  expect(r).toMatchObject({ crossing: 0, touchesLake: false, riverInMountain: false, river: true, riverBank: false });
  expect(r.riverToTown).toBeGreaterThanOrEqual(34);
});

test('the island has trees well in from the beach, and rabbits and deer that run from the car', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(() => {
    const out = {};
    out.trees = [islandTrees.length, islandTrees.every(t => onIsland(t.x, t.z, -10) && hits(t.x, t.z))];
    out.animals = [animals.filter(k => !k.deer).length, animals.filter(k => k.deer).length,
      animals.every(k => onIsland(k.x, k.z, -4) && !solids.some(s => k.x > s.x0 && k.x < s.x1 && k.z > s.z0 && k.z < s.z1))];
    const k = animals.find(a => a.deer), home = { x: k.hx, z: k.hz }, out0 = Math.hypot(k.x - island.x, k.z - island.z) || 1;
    // the car comes from the beach side, so the deer runs off towards the middle of the island
    setMode('car'); Object.assign(car, { x: k.x + (k.x - island.x) / out0 * 6, z: k.z + (k.z - island.z) / out0 * 6, v: 0 });
    for (let i = 0; i < 60; i++) updateAnimals(1 / 60);
    out.scared = k.scared; out.fled = Math.hypot(k.x - car.x, k.z - car.z) - 6;
    for (let i = 0; i < 60 * 10; i++) updateAnimals(1 / 60);
    out.stayed = animals.every(a => onIsland(a.x, a.z, -4) && !islandTrees.some(t => Math.hypot(t.x - a.x, t.z - a.z) < 1.5));
    setMode('heli');
    for (let i = 0; i < 60 * 60; i++) { T += 1 / 60; updateAnimals(1 / 60); }
    out.calm = [k.scared, Math.hypot(k.x - home.x, k.z - home.z) < 6];
    setMode('car');
    return out;
  });
  expect(r.trees).toEqual([12, true]);
  expect(r.animals).toEqual([4, 3, true]);
  expect(r.scared).toBe(true);
  expect(r.fled).toBeGreaterThan(3);
  expect(r.stayed).toBe(true);
  expect(r.calm).toEqual([false, true]);
});

test('the car drives into the lake as the boat, and out again as the car', async ({ page }) => {
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 400, height: 300 });
  const problems = await open(page);
  await page.keyboard.press('KeyX'); // start
  // on the beach, facing the water
  await page.evaluate(TOWN_SHORE => { const s = eval(TOWN_SHORE); Object.assign(car, s.at(4), { a: s.toWater, v: 0 }); }, TOWN_SHORE);
  await page.keyboard.down('ArrowUp');
  await page.waitForFunction(() => mode === 'boat', null, { timeout: 40_000 });
  expect(await page.evaluate(() => [inWater(boat.x, boat.z), fx.some(f => f.spray), document.getElementById('mode').textContent]))
    .toEqual([true, true, 'H = 🚁']);
  await page.keyboard.up('ArrowUp');
  // turn around and head for the beach
  await page.evaluate(TOWN_SHORE => Object.assign(boat, { a: eval(TOWN_SHORE).toLand, v: 0 }), TOWN_SHORE);
  await page.keyboard.down('ArrowUp');
  await page.waitForFunction(() => mode === 'car', null, { timeout: 40_000 });
  await page.keyboard.up('ArrowUp');
  expect(await page.evaluate(() => onLand(car.x, car.z, SHORE) && !onIsland(car.x, car.z, 0))).toBe(true);
  expect(await glError(page)).toBe(0);
  expect(problems).toEqual([]);
});

test('no flicker at the shore or the island, and the helicopter lands as the boat over water', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(([SHORE_AT, TOWN_SHORE]) => {
    const out = {}, shoreAt = eval(SHORE_AT);
    for (const [name, s] of [['lake', eval(TOWN_SHORE)], ['island', shoreAt(island.x, island.z, 1, .3)]]) {
      // standing still just inside the water, the car stays a car; just up the beach, the boat stays a boat
      setMode('car'); Object.assign(car, s.at(-1), { v: 0 }); driveCar(1 / 60); const carJustIn = mode;
      Object.assign(car, s.at(-2), { v: 0 }); driveCar(1 / 60); const carIn = mode;
      Object.assign(boat, s.at(1), { v: 0, hop: 0, vy: 0 }); driveBoat(1 / 60); const boatJustOut = mode;
      Object.assign(boat, s.at(2), { v: 0 }); driveBoat(1 / 60); const boatOut = mode;
      out[name] = [carJustIn, carIn, boatJustOut, boatOut];
    }
    // helicopter over the lake and over the river lands as the boat, over the beach and the island as the car on dry land
    const lakeMid = shoreAt(island.x, island.z, 1, .3).at(-15);
    setMode('heli'); Object.assign(heli, lakeMid); switchVehicle(); out.heliLake = mode;
    setMode('heli'); Object.assign(heli, { x: river[10].x, z: river[10].z }); switchVehicle(); out.heliRiver = mode;
    setMode('heli'); Object.assign(heli, eval(TOWN_SHORE).at(1)); switchVehicle(); out.heliBeach = [mode, onLand(car.x, car.z, SHORE)];
    setMode('heli'); Object.assign(heli, { x: island.x + 5, z: island.z }); switchVehicle(); out.heliIsland = [mode, onIsland(car.x, car.z, 0)];
    setMode('car');
    return out;
  }, [SHORE_AT, TOWN_SHORE]);
  expect(r).toEqual({ lake: ['car', 'boat', 'boat', 'car'], island: ['car', 'boat', 'boat', 'car'],
    heliLake: 'boat', heliRiver: 'boat', heliBeach: ['car', true], heliIsland: ['car', true] });
});

test('the speedboat tops out at 28, glides when you let go, and only it catches water stars', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(([SHORE_AT, TOWN_SHORE]) => {
    const mid = eval(SHORE_AT)(island.x, island.z, 1, .3).at(-15), out = {};
    setMode('boat'); Object.assign(boat, { ...mid, a: 0, v: 0, hop: 0, vy: 0 });
    keys.add('ArrowUp');
    for (let i = 0; i < 600; i++) { driveBoat(1 / 60); Object.assign(boat, mid); }
    keys.delete('ArrowUp');
    out.top = boat.v;
    for (let i = 0; i < 60; i++) { driveBoat(1 / 60); Object.assign(boat, mid); }
    out.afterGlide = boat.v; // the car keeps only 35% after a second, the boat 60%
    const w = stars.filter(s => s.water);
    out.water = [w.length, w.every(s => inWater(s.x, s.z, 4) && !ramps.some(r => Math.hypot(r.x - s.x, r.z - s.z) < r.r)),
      w.some(s => inLake(s.x, s.z, 0)), w.some(s => !inLake(s.x, s.z, 0))];
    // a water star under the car (on the beach) stays put, under the boat it is caught and comes back on the water
    const i = stars.indexOf(w[0]), before = score, beach = eval(TOWN_SHORE).at(4);
    setMode('car'); Object.assign(car, beach, { v: 0 }); Object.assign(stars[i], beach); update(1 / 60);
    out.carCatch = [mode, score - before];
    Object.assign(stars[i], mid);
    setMode('boat'); Object.assign(boat, mid); update(1 / 60);
    out.boatCatch = score - before;
    out.respawn = [stars[i].water, inWater(stars[i].x, stars[i].z, 4), Math.hypot(stars[i].x - boat.x, stars[i].z - boat.z) > 40];
    setMode('car');
    return out;
  }, [SHORE_AT, TOWN_SHORE]);
  expect(r.top).toBe(28);
  expect(r.afterGlide).toBeCloseTo(28 * 0.6, 0);
  expect(r).toMatchObject({ water: [10, true, true, true], carCatch: ['car', 0], boatCatch: 1, respawn: [true, true, true] });
});

test('ramps: 3 on the river, 3 small and 2 big in the lake; big ones throw higher and land with a ring of spray', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(() => {
    const out = {}, calls = [], realSplash = splash;
    splash = (...a) => { calls.push(a[3] === true); realSplash(...a); };
    const run = (ramp, v) => { // aim at the ramp from 12 away and keep the speed up, but stay just past it on open water
      setMode('boat');
      Object.assign(boat, { x: ramp.x - 12, z: ramp.z, a: Math.PI / 2, v, hop: 0, vy: 0, onRamp: false, big: false });
      let top = 0; calls.length = 0;
      for (let i = 0; i < 240; i++) {
        boat.v = v; driveBoat(1 / 60); top = Math.max(top, boat.hop);
        boat.x = Math.min(boat.x, ramp.x + ramp.r + 1);
      }
      return [top, calls.some(Boolean)];
    };
    const onRiver = ramps.filter(k => k.river), inLakeRamps = ramps.filter(k => !k.river);
    out.counts = [onRiver.length, inLakeRamps.filter(k => !k.big).length, inLakeRamps.filter(k => k.big).length];
    out.placed = [onRiver.every(k => riverDist(k.x, k.z) < 3 && !inLake(k.x, k.z, 0)), inLakeRamps.every(k => inWater(k.x, k.z, k.r + 8)),
      ramps.every(a => ramps.every(b => a === b || Math.hypot(a.x - b.x, a.z - b.z) >= 24))];
    const small = inLakeRamps.find(k => !k.big), big = inLakeRamps.find(k => k.big);
    [out.fast, out.smallRing] = run(small, 26); [out.big, out.bigRing] = run(big, 26);
    out.slow = run(small, 5)[0];
    out.landed = boat.hop;
    splash = realSplash;
    return out;
  });
  expect(r.counts).toEqual([3, 3, 2]);
  expect(r.placed).toEqual([true, true, true]);
  expect(r.fast).toBeGreaterThan(1.5);
  expect(r.big / r.fast).toBeGreaterThan(1.35);
  expect(r.big / r.fast).toBeLessThan(1.65);
  expect([r.smallRing, r.bigRing]).toEqual([false, true]);
  expect(r.slow).toBeGreaterThan(0);
  expect(r.slow).toBeLessThan(.3);
  expect(r.landed).toBe(0);
});

test('a fast boat leaves a foam trail that fades, never more than 40 patches', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(SHORE_AT => {
    const mid = eval(SHORE_AT)(island.x, island.z, 1, .3).at(-15), out = {}, foam = () => fx.filter(f => f.foam).length;
    setMode('boat'); fx.length = 0;
    const go = (v, secs) => { for (let i = 0; i < secs * 60; i++) { Object.assign(boat, mid, { v, hop: 0, vy: 0, a: 0 }); updateFx(1 / 60); } };
    go(8, 2); out.slow = foam();
    go(26, 1); out.fast = foam();
    go(26, 10); out.most = foam();
    go(0, 2.1); out.after = foam();
    setMode('car');
    return out;
  }, SHORE_AT);
  expect(r.slow).toBe(0);
  expect(r.fast).toBeGreaterThanOrEqual(8);
  expect(r.most).toBeLessThanOrEqual(40);
  expect(r.after).toBe(0);
});

test('ducks paddle on the lake and the river, scatter and come back', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(() => {
    const out = {};
    out.count = [ducks.length, ducks.some(d => inLake(d.x, d.z, 0)), ducks.some(d => !inLake(d.x, d.z, 0))];
    const d = ducks.find(k => inLake(k.x, k.z, -10)), start = { x: d.x, z: d.z };
    setMode('boat'); Object.assign(boat, { x: d.x + 6, z: d.z, v: 0 });
    for (let i = 0; i < 60; i++) updateDucks(1 / 60);
    out.scared = d.scared; out.fled = Math.hypot(d.x - boat.x, d.z - boat.z) - 6;
    out.inWater = ducks.every(k => inWater(k.x, k.z, 1));
    setMode('car');
    for (let i = 0; i < 60 * 60; i++) updateDucks(1 / 60);
    out.home = Math.hypot(d.x - start.x, d.z - start.z);
    return out;
  });
  expect(r.count).toEqual([10, true, true]);
  expect(r.scared).toBe(true);
  expect(r.fled).toBeGreaterThan(3);
  expect(r.inWater).toBe(true);
  expect(r.home).toBeLessThan(1.5);
});

// ---------- Space (#5) ----------

// runs the game for `secs` of game time, 60 steps a second
const STEP = `(secs, stop) => { for (let i = 0; i < secs * 60; i++) { update(1 / 60); if (stop && stop()) return i / 60; } return secs; }`;

test('launch station: at the edge of town away from the lake, clear of water, mountains and trees', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(() => {
    const clear = [];
    for (let lx = -48; lx <= 20; lx += 2) for (let lz = -PADH - station.road; lz <= 20; lz += 2) {
      const [x, z] = station.world(lx, lz);
      if (wet(x, z, 5) || mountains.some(m => Math.hypot(m.x - x, m.z - z) < m.r * 1.4)) clear.push([lx, lz]);
    }
    const [roadEndX, roadEndZ] = station.world(0, -PADH - station.road + 1);
    const road = [];
    for (let t = 0; t <= 1; t += .05) { // the car can drive from the town road onto the pad
      const [x, z] = station.world(0, -PADH - station.road + 2 + t * (station.road + PADH - 8));
      if (hits(x, z)) road.push(t);
    }
    return {
      padFromTown: townDist(station.x, station.z), roadEnd: townDist(roadEndX, roadEndZ), clear, road,
      trees: solids.slice(0, station.firstSolid).filter(s => inStationArea((s.x0 + s.x1) / 2, (s.z0 + s.z1) / 2)).length,
      awayFromLake: Math.hypot(station.x - lake.x, station.z - lake.z) > Math.hypot(W / 2 - lake.x, W / 2 - lake.z),
      onPad: inStation(station.x + 10, station.z - 10), onH: inStation(station.hx, station.hz), offPad: inStation(station.x, station.z - PADH - 3),
    };
  });
  expect(r.padFromTown).toBeGreaterThan(30);
  expect(r.padFromTown).toBeLessThan(60);
  expect(r.roadEnd).toBeLessThan(8);
  expect(r).toMatchObject({ clear: [], road: [], trees: 0, awayFromLake: true, onPad: true, onH: true, offPad: false });
});

test('at the station H boards the rocket, from the car or the helicopter on the H pad', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(() => {
    const badge = () => document.getElementById('mode').textContent, help = () => document.getElementById('help').textContent, out = {};
    setMode('car'); Object.assign(car, { x: 3 * P, z: P / 2 }); refreshHud(); out.town = badge();
    const [x, z] = station.world(0, -PADH + 5); Object.assign(car, { x, z }); refreshHud();
    out.pad = [badge(), help()];
    switchVehicle(); out.board = [mode, scene, rocket.count > 3, badge(), help()];
    switchVehicle(); out.cancel = [mode, inStation(car.x, car.z)]; // still on the pad: H gives the car back
    setMode('heli'); Object.assign(heli, { x: station.hx, z: station.hz, y: 20 }); refreshHud();
    out.heliPad = [badge(), help()];
    switchVehicle(); out.heli = [mode, rocket.count > 3, badge()];
    switchVehicle(); out.heliBack = [mode, inStation(car.x, car.z)];
    setMode('heli'); Object.assign(heli, { x: 3 * P, z: P / 2 }); switchVehicle(); out.elsewhere = badge();
    return out;
  });
  expect(r).toEqual({
    town: 'H = 🚁',
    pad: ['H = 🚀', 'Arrows or WASD = drive · Space = beep beep! · H = rocket · M = sound'],
    board: ['rocket', 'earth', true, 'H = 🚗', 'Hold W, Space or ↑ = blast off · S or ↓ = go down · H = car · M = sound'],
    cancel: ['car', true],
    heliPad: ['H = 🚀', 'Arrows = fly · W or Space = go up · S or Shift = go down · H = rocket · M = sound'],
    heli: ['rocket', true, 'H = 🚗'], heliBack: ['car', true], elsewhere: 'H = 🚁',
  });
});

test('countdown, then holding up reaches space in about 15 s; letting go hovers', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(STEP => {
    const step = eval(STEP), out = {};
    setMode('car'); Object.assign(car, { x: station.x, z: station.z - PADH + 5 }); switchVehicle();
    keys.add('KeyW');
    step(3); out.countdown = [rocket.y, rocket.count > 0]; // holding up waits for the countdown
    step(.5); out.lift = rocket.count;
    out.toSpace = step(30, () => scene === 'space');
    out.space = [scene, Math.round(rocket.y), document.getElementById('mode').textContent];
    // back on the pad, climb halfway and let go: it hovers
    reenter(); Object.assign(rocket, { y: 0, vy: 0 }); step(7, () => rocket.y > 300);
    keys.clear(); step(3); const y = rocket.y; step(3);
    out.hover = [Math.abs(rocket.vy) < .5, rocket.y >= y - .5, rocket.y > 250];
    out.inFlightH = (switchVehicle(), mode);
    return out;
  }, STEP);
  expect(r.countdown).toEqual([0, true]);
  expect(r.lift).toBe(0);
  expect(r.toSpace).toBeGreaterThan(12);
  expect(r.toSpace).toBeLessThan(18);
  expect(r.space).toEqual(['space', 340, '🚀']);
  expect(r.hover).toEqual([true, true, true]);
  expect(r.inFlightH).toBe('rocket');
});

test('space: stars only the rocket can catch, soft bumps, the edge, and the Moon', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(STEP => {
    const step = eval(STEP), out = {}, dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
    setMode('rocket'); enterSpace();
    out.stars = [spaceStars.length, spaceStars.every(s => Math.hypot(s.x, s.y, s.z) < SB && [...planets, MOON].every(b => dist(s, b) > b.r + 30))];
    const before = score; Object.assign(spaceStars[0], { x: rocket.x, y: rocket.y, z: rocket.z }); step(1 / 60);
    out.catch = [score - before, dist(spaceStars[0], rocket) > 150];
    const pl = planets[0]; Object.assign(rocket, { x: pl.x + pl.r, y: pl.y, z: pl.z }); step(1 / 60);
    out.planet = dist(rocket, pl) >= pl.r + 9.9;
    Object.assign(rocket, { x: SB + 50, y: 0, z: 0, a: Math.PI / 2 }); keys.add('ArrowUp'); step(2); keys.clear();
    out.edge = Math.hypot(rocket.x, rocket.y, rocket.z) <= SB;
    Object.assign(rocket, { x: MOON.x, y: MOON.y + MOON.r + 15, z: MOON.z }); step(1 / 60);
    out.moon = [scene, mode];
    out.landed = step(30, () => mode === 'buggy') < 30;
    out.buggy = [scene, document.getElementById('mode').textContent, tracks.length];
    return out;
  }, STEP);
  expect(r).toEqual({ stars: [6, true], catch: [1, true], planet: true, edge: true, moon: ['moon', 'rocket'], landed: true,
    buggy: ['moon', 'H = 🚀', 0] });
});

test('the moon buggy bounces over crater rims, leaves tracks, and H flies home to the pad', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(STEP => {
    const step = eval(STEP), out = {};
    setMode('rocket'); landOnMoon(); step(30, () => mode === 'buggy');
    const c = craters.find(k => Math.hypot(k.x, k.z) > 30);
    Object.assign(buggy, { x: c.x - (c.r + 10) * Math.sign(c.x || 1), z: c.z, a: Math.sign(c.x || 1) * Math.PI / 2, v: 14, y: 0, vy: 0, g: 0 });
    buggy.g = moonGround(buggy.x, buggy.z); buggy.y = buggy.g;
    keys.add('ArrowUp');
    let top = 0; for (let i = 0; i < 120; i++) { step(1 / 60); top = Math.max(top, buggy.y - moonGround(buggy.x, buggy.z)); }
    out.bounce = top;
    keys.add('ArrowLeft'); step(20); keys.clear(); // round and round
    out.tracks = [tracks.length > 20, tracks.length <= 300, Math.hypot(buggy.x, buggy.z) < MOONR - 3];
    switchVehicle(); out.back = [mode, scene];
    keys.add('KeyW'); out.leave = step(20, () => scene === 'space') < 20; keys.clear();
    out.space = [scene, tracks.length];
    Object.assign(rocket, { x: 0, y: ER + GAP - 50, z: 0 }); step(1 / 60);
    out.reentry = [scene, rocket.x === station.x && rocket.z === station.z, rocket.y > 700];
    keys.add('KeyS'); out.landTime = step(40, () => rocket.y === 0); keys.clear();
    out.pad = [landed(), document.getElementById('mode').textContent];
    switchVehicle(); out.car = [mode, inStation(car.x, car.z)];
    return out;
  }, STEP);
  expect(r.bounce).toBeGreaterThan(1);
  expect(r.tracks).toEqual([true, true, true]);
  expect(r.back).toEqual(['rocket', 'moon']);
  expect(r.leave).toBe(true);
  expect(r.space).toEqual(['space', 0]);
  expect(r.reentry).toEqual(['earth', true, true]);
  expect(r.landTime).toBeLessThan(40);
  expect(r.pad).toEqual([true, 'H = 🚗']);
  expect(r.car).toEqual(['car', true]);
});

// ---------- Moon stars and jump ramps (#16) ----------

test('moon: 3 striped ramps and 8 + 3 stars, laid out the same every time and clear of craters, rocket and edge', async ({ page }) => {
  test.setTimeout(150_000); // loads the game twice
  await open(page);
  const layout = () => page.evaluate(() => ({ ramps: moonRamps, stars: moonStars }));
  const r = await layout();
  expect(r.ramps).toHaveLength(3);
  expect(r.stars.filter(s => s.ramp < 0)).toHaveLength(8);
  expect(r.stars.filter(s => s.ramp >= 0).map(s => s.ramp)).toEqual([0, 1, 2]);
  const bad = await page.evaluate(() => {
    const out = [];
    for (const r of moonRamps) {
      for (const u of [-RAMP_L / 2 - 8, -RAMP_L / 2, 0, RAMP_L / 2, RAMP_L / 2 + 2]) {
        const q = rampPoint(r, u);
        if (Math.hypot(q.x, q.z) > MOONR - 15) out.push('edge');
        if (Math.hypot(q.x, q.z) < 20) out.push('rocket');
        if (craters.some(c => Math.hypot(c.x - q.x, c.z - q.z) < c.r + 4)) out.push('crater');
      }
      if (moonRamps.some(o => o !== r && Math.hypot(o.x - r.x, o.z - r.z) < 40)) out.push('ramps');
    }
    for (const s of moonStars.filter(s => s.ramp < 0)) {
      if (Math.hypot(s.x, s.z) < 12 || Math.hypot(s.x, s.z) > MOONR - 20) out.push('star spot');
      if (craters.some(c => Math.hypot(c.x - s.x, c.z - s.z) < c.r + 4)) out.push('star crater');
      if (moonRamps.some(r => { const l = rampLocal(r, s.x, s.z); return Math.abs(l.u) < RAMP_L / 2 + 4 && Math.abs(l.v) < RAMP_W / 2 + 4; })) out.push('star ramp');
    }
    return out;
  });
  expect(bad).toEqual([]);
  await page.reload();
  await page.waitForFunction(() => T > 0.3);
  expect(await layout()).toEqual(r);
});

test('moon: the buggy catches ground stars and ramp stars, and each comes back', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(STEP => {
    const step = eval(STEP), out = {};
    setMode('rocket'); landOnMoon(); step(30, () => mode === 'buggy');
    const ground = moonStars.findIndex(s => s.ramp < 0), before = score, old = moonStars[ground];
    Object.assign(buggy, { x: old.x, z: old.z, v: 0 }); buggy.g = buggy.y = moonGround(old.x, old.z); step(1 / 60);
    out.ground = [score - before, moonStars[ground] !== old, moonStars.filter(s => s.ramp < 0).length];
    const ri = moonStars.findIndex(s => s.ramp === 1), oldR = moonStars[ri], b2 = score;
    Object.assign(buggy, { x: oldR.x, z: oldR.z, y: oldR.y - 1.5, vy: 0, v: 0 }); step(1 / 60);
    step(.5); // still right there: the caught star waits, so no more points
    out.ramp = [score - b2, moonStars[ri].ramp, moonStars[ri].x === oldR.x && moonStars[ri].z === oldR.z, moonStars[ri].wait];
    const far = moonStars.findIndex(s => s.ramp < 0), b3 = score; // the rocket can't catch them, and a buggy far below can't either
    Object.assign(buggy, { x: moonStars[far].x, z: moonStars[far].z, y: 8, vy: 0, v: 0, g: 0 }); step(1 / 60);
    out.high = score - b3;
    return out;
  }, STEP);
  expect(r.ground).toEqual([1, true, 8]);
  expect(r.ramp).toEqual([1, 1, true, true]);
  expect(r.high).toBe(0);
});

test('moon: a fast run up a ramp reaches its star and lands with dust, a slow run does not', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(STEP => {
    const step = eval(STEP);
    setMode('rocket'); landOnMoon(); step(30, () => mode === 'buggy');
    const run = speed => {
      const ramp = moonRamps[0], st = rampPoint(ramp, -RAMP_L / 2 - 14), star = moonStars.find(q => q.ramp === 0);
      Object.assign(buggy, { x: st.x, z: st.z, a: ramp.a, v: speed, vy: 0, up: 0, peak: 0 });
      buggy.g = buggy.y = moonGround(st.x, st.z); keys.clear(); fx.length = 0;
      let top = 0, dust = 0, caught = 0, now = star;
      for (let i = 0; i < 60 * 9; i++) {
        if (buggy.y < buggy.g + .05) buggy.v = speed; // hold the speed while on the ground
        update(1 / 60); top = Math.max(top, buggy.y); dust = Math.max(dust, fx.filter(f => f.dust).length);
        const q = moonStars.find(k => k.ramp === 0); if (q !== now) { caught++; now = q; }
      }
      return { top, dust, caught, waiting: now.wait };
    };
    const rim = Math.max(...craters.map(c => moonGround(c.x + c.r, c.z)));
    return { fast: run(14), slow: run(3), rim, ramp: RAMP_H };
  }, STEP);
  expect(r.fast.caught).toBe(1); // flying through the star counts once, then it waits for the buggy to drive clear
  expect(r.fast.waiting).toBe(false); // and it is back once the buggy has gone
  expect(r.fast.top).toBeGreaterThan(r.ramp + 2); // clearly above the ramp, far above a crater rim
  expect(r.fast.top).toBeGreaterThan(r.rim * 5);
  expect(r.fast.dust).toBeGreaterThanOrEqual(8); // the landing puff
  expect(r.slow.caught).toBe(0);
  expect(r.slow.top).toBeLessThan(r.ramp + 1); // only up the slope, no flight
});

test('moon: the sides and high end of a ramp are walls, so backwards and sideways runs give no big jump', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(STEP => {
    const step = eval(STEP), out = {};
    setMode('rocket'); landOnMoon(); step(30, () => mode === 'buggy');
    const ramp = moonRamps[0];
    const go = (u, v, heading) => { // start beside the ramp and drive at it
      const st = rampPoint(ramp, u, v);
      Object.assign(buggy, { x: st.x, z: st.z, a: ramp.a + heading, v: 12, vy: 0, up: 0, peak: 0 });
      buggy.g = buggy.y = moonGround(st.x, st.z); fx.length = 0;
      let top = 0;
      for (let i = 0; i < 180; i++) {
        if (buggy.y < buggy.g + .05) buggy.v = 12;
        update(1 / 60); top = Math.max(top, buggy.y);
      }
      return top;
    };
    out.back = go(RAMP_L / 2 + 8, 0, Math.PI);          // down the high end, from behind
    out.side = go(0, RAMP_W / 2 + 8, -Math.PI / 2);     // across from the right
    out.side2 = go(0, -RAMP_W / 2 - 8, Math.PI / 2);    // across from the left
    out.front = go(-RAMP_L / 2 - 10, 0, 0);              // the right way up
    return out;
  }, STEP);
  expect(r.back).toBeLessThan(1);
  expect(r.side).toBeLessThan(1);
  expect(r.side2).toBeLessThan(1);
  expect(r.front).toBeGreaterThan(5);
});

test('with the keyboard: blast off, space, the Moon and the buggy all draw without errors', async ({ page }) => {
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 400, height: 300 });
  const problems = await open(page);
  await page.keyboard.press('KeyX'); // start
  await page.evaluate(() => { const [x, z] = station.world(0, -PADH + 5); Object.assign(car, { x, z }); });
  await page.keyboard.press('KeyH');
  await page.waitForFunction(() => mode === 'rocket' && rocket.count > 0, null, { timeout: 40_000 });
  // CI's software renderer can be very slow, and game time only moves 0.05 s a frame: skip the rest of the countdown
  await page.evaluate(() => { rocket.count = .01; });
  await page.keyboard.down('Space');
  await page.waitForFunction(() => rocket.y > 5 && rocket.thrust > .5, null, { timeout: 40_000 });
  await page.evaluate(() => { rocket.y = 780; });
  await page.waitForFunction(() => scene === 'space', null, { timeout: 40_000 });
  await page.keyboard.up('Space');
  const shot = await page.locator('canvas').screenshot();
  expect(shot.length).toBeGreaterThan(5_000);
  await page.evaluate(() => { landOnMoon(); rocket.y = 2; }); // just above the ground, to keep it quick
  await page.waitForFunction(() => mode === 'buggy', null, { timeout: 60_000 });
  await page.keyboard.down('ArrowUp');
  await page.waitForFunction(() => tracks.length > 2, null, { timeout: 40_000 });
  await page.keyboard.up('ArrowUp');
  await page.keyboard.press('KeyH');
  await page.waitForFunction(() => mode === 'rocket', null, { timeout: 10_000 });
  expect(await glError(page)).toBe(0);
  expect(problems).toEqual([]);
});

test('if the graphics card gives up mid-game, a kind message shows and a key press starts again', async ({ page }) => {
  await open(page);
  await page.keyboard.press('KeyX');
  const lose = await page.evaluateHandle(() => gl.getExtension('WEBGL_lose_context'));
  await lose.evaluate(l => l.loseContext());
  await expect(page.locator('#start')).toBeVisible();
  await expect(page.locator('#start')).toContainText('graphics took a little break');
  await expect(page.locator('#start small')).toContainText('Graphics dropped out: car earth');
  await Promise.all([page.waitForEvent('load'), page.keyboard.press('KeyX')]);
  await page.waitForFunction(() => T > 0.3);
  // after a drop the game starts in its lighter mode
  expect(await page.evaluate(() => ({ lost: gl.isContextLost(), shadows: quality.shadows, dpr: quality.maxDpr })))
    .toEqual({ lost: false, shadows: false, dpr: 1 });
});

test('drop-out note: easy mode, which drop-out, and seconds after liftoff only in a flying rocket', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(() => {
    const d = { mode: 'rocket', scene: 'earth', height: 6.6, w: 1536, h: 864, fps: 59.7, easy: true, n: 3, lift: 4.8,
      gpu: 'ANGLE (Intel)', time: '2026-10-19T12:55' };
    return [dropNote(d), dropNote({ ...d, lift: null }), dropNote({ ...d, mode: 'car', easy: false, n: 1 })];
  });
  expect(r).toEqual([
    'Graphics dropped out: rocket earth height 7, 1536×864, 60 fps, easy mode on, drop-out 3, 4 s after liftoff, ANGLE (Intel) (2026-10-19T12:55)',
    'Graphics dropped out: rocket earth height 7, 1536×864, 60 fps, easy mode on, drop-out 3, ANGLE (Intel) (2026-10-19T12:55)',
    'Graphics dropped out: car earth height 7, 1536×864, 60 fps, easy mode off, drop-out 1, ANGLE (Intel) (2026-10-19T12:55)',
  ]);
  expect(await page.evaluate(() => [liftoffFx(false), liftoffFx(true)])).toEqual([
    { most: 50, rate: 50, size: 1, glow: 1 }, { most: 12, rate: 12, size: 2 / 3, glow: .5 }]);
});

// boards the rocket, skips the countdown and holds Space until it's a little way up, with smoke rolling out
const liftOff = page => page.evaluate(() => {
  boardRocket(); rocket.count = 0; keys.add('Space');
  for (let i = 0; i < 600 && !(rocket.y > 3 && fx.some(f => f.dust)); i++) update(1 / 60);
});

test('liftoff smoke and flame are unchanged on a computer that never dropped out', async ({ page }) => {
  await page.setViewportSize({ width: 400, height: 300 });
  await open(page);
  await liftOff(page);
  const r = await page.evaluate(() => ({ easy, liftoff, size: fx.find(f => f.dust).size, lift: rocket.lift !== null }));
  expect(r).toEqual({ easy: false, liftoff: { most: 50, rate: 50, size: 1, glow: 1 }, size: 1, lift: true });
});

test('after a drop-out, liftoff has less smoke and a smaller glow, and a new drop-out says so', async ({ page }) => {
  await page.setViewportSize({ width: 400, height: 300 });
  await open(page, () => { localStorage.setItem('vroomDrop', 'earlier'); localStorage.setItem('vroomDrops', '2'); });
  await liftOff(page);
  // lots of frames with full thrust, kept low where the smoke rolls out: never more than 12 puffs at once
  const r = await page.evaluate(() => {
    let most = 0;
    for (let i = 0; i < 300; i++) { update(1 / 60); rocket.y = 5; most = Math.max(most, fx.filter(f => f.dust).length); }
    return { easy, most, size: fx.find(f => f.dust).size };
  });
  expect(r).toEqual({ easy: true, most: 12, size: 2 / 3 });
  const lose = await page.evaluateHandle(() => gl.getExtension('WEBGL_lose_context'));
  await lose.evaluate(l => l.loseContext());
  await expect(page.locator('#start small')).toContainText(/Graphics dropped out: rocket earth height \d+, .* easy mode on, drop-out 3, \d+ s after liftoff, /);
  expect(await page.evaluate(() => localStorage.getItem('vroomDrops'))).toBe('3');
});

test('when the browser has paused 3D graphics, the start screen says what to do', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => { HTMLCanvasElement.prototype.getContext = () => null; });
  await page.goto(GAME);
  await expect(page.locator('#start')).toContainText('paused 3D graphics');
  expect(errors).toEqual(['WebGL is not available']);
});

test('high in the climb the shadow pass is skipped', async ({ page }) => {
  await open(page);
  await page.keyboard.press('KeyX');
  await page.evaluate(() => { const [x, z] = station.world(0, -PADH + 5); Object.assign(car, { x, z }); switchVehicle(); rocket.count = 0; });
  const fbBinds = y => page.evaluate(y => {
    rocket.y = y; let n = 0; const o = gl.bindFramebuffer.bind(gl);
    gl.bindFramebuffer = (t, f) => { if (f) n++; o(t, f); };
    draw(); gl.bindFramebuffer = o; return n;
  }, y);
  expect(await fbBinds(0)).toBe(1);
  expect(await fbBinds(200)).toBe(0);
});

test('climbing, the near plane moves out so far-off streets keep a steady depth', async ({ page }) => {
  await open(page);
  await page.keyboard.press('KeyX');
  await page.evaluate(() => { const [x, z] = station.world(0, -PADH + 5); Object.assign(car, { x, z }); switchVehicle(); rocket.count = 0; });
  const near = y => page.evaluate(y => { rocket.y = y; snapCam = true; draw(); return nearPlane(); }, y);
  expect(await near(0)).toBeLessThan(1);
  expect(await near(300)).toBeGreaterThan(20);
});

// ---------- Sounds (#7) ----------

test('sound logic: rising star chimes, tyre squeal and rotor spin-up', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(() => ({
    steps: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(chimeStep),
    squeal: [squealLevel(5, 1), squealLevel(22, 1), squealLevel(-22, -1), squealLevel(22, .5), squealLevel(15, .875)],
    spinUp: [spinRotor(0, true, .75), spinRotor(0, true, 1.5), spinRotor(.9, true, 1)],
    spinDown: [spinRotor(1, false, .5), spinRotor(1, false, 1), spinRotor(.2, false, 1)],
  }));
  expect(r.steps).toEqual([0, 1, 2, 3, -1, 0, 1, 2, 3, -1]);
  expect(r.squeal.slice(0, 4)).toEqual([0, 1, 1, 0]);
  expect(r.squeal[4]).toBeCloseTo(.25);
  expect(r.spinUp).toEqual([.5, 1, 1]);
  expect(r.spinDown).toEqual([.5, 0, 0]);
});

test('each set of five stars climbs the chime up to the fanfare, and the horn never stacks', async ({ page }) => {
  const problems = await open(page);
  await page.keyboard.press('KeyX'); // start, which also starts the sound
  const r = await page.evaluate(() => {
    const heard = [];
    const realChime = chime, realFanfare = fanfare, realTone = tone;
    chime = step => { heard.push(step); realChime(step); };
    fanfare = () => { heard.push('fanfare'); realFanfare(); };
    for (let i = 0; i < 10; i++) cheer(car.x, 2, car.z);
    chime = realChime; fanfare = realFanfare;
    let notes = 0;
    tone = (...a) => { notes++; realTone(...a); };
    lastHorn = -9; horn(); const one = notes;
    for (let i = 0; i < 5; i++) horn(); // mashing Space in the same moment
    tone = realTone;
    return { heard, one, all: notes };
  });
  expect(r.heard).toEqual([0, 1, 2, 3, 'fanfare', 0, 1, 2, 3, 'fanfare']);
  expect(r.one).toBeGreaterThan(0);
  expect(r.all).toBe(r.one);
  expect(problems).toEqual([]);
});

test('M mutes everything through the master volume and shows the muted speaker; a reload starts with sound', async ({ page }) => {
  const problems = await open(page);
  const icon = page.locator('#muted');
  await expect(icon).toBeHidden();
  await page.keyboard.press('KeyX');
  expect(await page.evaluate(() => [ac instanceof AudioContext, limiter instanceof DynamicsCompressorNode, master instanceof GainNode, muted]))
    .toEqual([true, true, true, false]);
  await page.keyboard.press('KeyM');
  await expect(icon).toBeVisible();
  expect(await page.evaluate(() => muted)).toBe(true);
  // the master volume fades to silence (only measurable while the browser lets audio run)
  if (await page.evaluate(() => ac.state === 'running')) await page.waitForFunction(() => master.gain.value < .05, null, { timeout: 10_000 });
  await page.keyboard.press('KeyM');
  await expect(icon).toBeHidden();
  expect(await page.evaluate(() => muted)).toBe(false);
  await page.keyboard.press('KeyM');
  await page.reload();
  await page.waitForFunction(() => T > 0.3);
  await expect(icon).toBeHidden();
  expect(await page.evaluate(() => muted)).toBe(false);
  expect(problems).toEqual([]);
});

test('switching vehicles quickly spins the rotor up and down without errors', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 400, height: 300 });
  const problems = await open(page);
  await page.keyboard.press('KeyX');
  for (let i = 0; i < 6; i++) await page.keyboard.press('KeyH');
  expect(await page.evaluate(() => mode)).toBe('car');
  await page.keyboard.press('KeyH');
  await page.waitForFunction(() => mode === 'heli' && rotorSpin > .2, null, { timeout: 40_000 });
  await page.keyboard.press('KeyH');
  const landed = await page.evaluate(() => rotorSpin);
  await page.waitForFunction(was => mode === 'car' && rotorSpin < was, landed, { timeout: 40_000 });
  expect(await page.evaluate(() => [rotorSpin >= 0, rotorSpin <= 1])).toEqual([true, true]);
  expect(problems).toEqual([]);
});

// ---------- Construction site (#9) ----------

test('construction site: out in the countryside, clear of water, mountains and the station, with a track from a town road', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(() => {
    const bad = [], track = [];
    for (let lx = -YW - 6; lx <= YW + 6; lx += 2) for (let lz = -YD - TRACK; lz <= YD + 6; lz += 2) {
      const [x, z] = site.world(lx, lz);
      if (wet(x, z, 5) || mountains.some(m => Math.hypot(m.x - x, m.z - z) < m.r * 1.4) || inStationArea(x, z, 5)) bad.push([lx, lz]);
    }
    for (let t = -YD - TRACK + 2; t <= -YD + 3; t += 2) { const [x, z] = site.world(0, t); if (hits(x, z)) track.push(t); } // the car can drive the whole track and through the gate
    const [sx, sz] = site.world(0, -YD - TRACK);
    return {
      bad, track, trackStart: townDist(sx, sz), fromTown: townDist(site.x, site.z),
      fence: [hits(...site.world(YW / 2, -YD)), hits(...site.world(YW, 0)), hits(...site.world(-YW, 5)), hits(...site.world(5, YD))],
      trees: solids.slice(0, station.firstSolid).filter(s => inSiteArea((s.x0 + s.x1) / 2, (s.z0 + s.z1) / 2)).length,
      stars: stars.filter(s => inSiteArea(s.x, s.z)).length,
    };
  });
  expect(r).toMatchObject({ bad: [], track: [], fence: [true, true, true, true], trees: 0, stars: 0 });
  expect(r.trackStart).toBeLessThan(8);
  expect(r.fromTown).toBeGreaterThan(55);
  expect(r.fromTown).toBeLessThan(130);
});

test('dirt piles: dirt lands on a pile or starts one, twelve at most, the big pile never runs low and fills up again', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(() => {
    const out = {};
    piles.splice(0);
    const [x, z] = site.world(0, 0);
    addDirt(x, z); addDirt(x + .5, z);
    out.joined = [piles.length, piles[0].amount];
    addDirt(x + 15, z); out.apart = piles.length;
    for (let i = 0; i < 30; i++) addDirt(x - 28 + (i % 6) * 9, z + (i % 5) * 9 - 18);
    out.most = piles.length;
    const before = piles.reduce((n, p) => n + p.amount, 0); addDirt(x, z + 3); out.kept = piles.reduce((n, p) => n + p.amount, 0) - before; // none lost
    piles.splice(0); addDirt(site.x + 500, site.z + 500); out.inside = inYard(piles[0].x, piles[0].z);
    piles.splice(0); addDirt(x, z); takeDirt(piles[0]); out.gone = piles.length;
    piles.splice(0); addPile(0, 0, 40, true); const big = piles[0];
    for (let i = 0; i < 60; i++) takeDirt(big);
    out.low = big.amount;
    for (let i = 0; i < 310; i++) updateSite(1 / 60); // 5 s
    out.refilled = big.amount;
    big.amount = 39; for (let i = 0; i < 620; i++) updateSite(1 / 60);
    out.full = big.amount;
    return out;
  });
  expect(r).toEqual({ joined: [1, 2], apart: 2, most: 12, kept: 1, inside: true, gone: 0, low: 5, refilled: 6, full: 40 });
});

test('H climbs into the machine next to the car and back out; the badge and help line follow', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(() => {
    const badge = () => document.getElementById('mode').textContent, help = () => document.getElementById('help').textContent, out = {};
    piles.splice(0); blocks.splice(0); // nothing in the way of the car
    for (const m of machines) {
      let spot = null;
      for (let k = 0; k < 16 && !spot; k++) { // a free spot where this machine, not a neighbour, is the nearest
        const x = m.x + Math.cos(k * .4) * (m.r + 2.6), z = m.z + Math.sin(k * .4) * (m.r + 2.6);
        setMode('car'); Object.assign(car, { x, z });
        if (!hits(x, z) && nearMachine() === m) spot = { x, z };
      }
      setMode('car'); Object.assign(car, spot, { v: 0 }); refreshHud();
      out[m.kind] = [badge(), help()];
      switchVehicle(); out[m.kind + 'In'] = [mode, badge(), help()];
      switchVehicle(); out[m.kind + 'Out'] = [mode, hits(car.x, car.z), Math.hypot(car.x - m.x, car.z - m.z) < 14, inYard(car.x, car.z)];
    }
    const [gx, gz] = site.world(0, -30); setMode('car'); Object.assign(car, { x: gx, z: gz }); refreshHud(); out.gate = badge();
    setMode('heli'); Object.assign(heli, { x: digger.x, y: 20, z: digger.z }); switchVehicle(); out.heliLands = [mode, hits(car.x, car.z)];
    return out;
  });
  const car = 'Arrows or WASD = drive · Space = beep beep! · H = climb in · M = sound';
  const back = ['car', false, true, true];
  expect(r).toEqual({
    digger: ['H = 🚜', car], diggerIn: ['digger', 'H = 🚗', 'Arrows or WASD = drive · Space = scoop or dump · H = car · M = sound'], diggerOut: back,
    truck: ['H = 🚚', car], truckIn: ['truck', 'H = 🚗', 'Arrows or WASD = drive · Space = tip the load · H = car · M = sound'], truckOut: back,
    dozer: ['H = 🚜', car], dozerIn: ['dozer', 'H = 🚗', 'Arrows or WASD = drive · Space = blade up or down · H = car · M = sound'], dozerOut: back,
    crane: ['H = 🏗️', car], craneIn: ['crane', 'H = 🚗', 'Arrows = swing the arm and move the hook · Space = grab or let go · H = car · M = sound'], craneOut: back,
    gate: 'H = 🚁', heliLands: ['car', false],
  });
});

test('digger: scoops from the big pile, fills the truck, spills on the ground; a full truck spills beside it', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(STEP => {
    const step = eval(STEP), out = {};
    machines.splice(machines.indexOf(dozer), 1); piles.splice(1); // the bulldozer would flatten the new piles while we look
    setMode('car'); Object.assign(car, { x: digger.x, z: digger.z }); boardMachine(digger);
    const big = piles[0], loose = () => piles.filter(p => !p.refill).reduce((n, p) => n + p.amount, 0); // the big pile also fills up by itself
    Object.assign(digger, { a: site.a, load: 0, act: null }); truck.load = 0;
    machineAction(digger); step(.5); out.pose = diggerPose(digger).join() !== [.9, -2, -.9].join(); // the arm moves
    step(1.7); out.scoop = [digger.load, big.amount];
    digger.a = site.a + Math.PI / 2; // towards the truck waiting at the loading spot
    machineAction(digger); step(2); out.loaded = [digger.load, truck.load];
    digger.a = site.a + Math.PI; digger.load = 1; const n = piles.length; // towards the gate, nothing there
    machineAction(digger); step(2); out.ground = [digger.load, piles.length - n, loose()];
    digger.a = site.a + Math.PI / 2; digger.load = 1; truck.load = 4; const m2 = piles.length, total = loose();
    machineAction(digger); step(2); out.full = [truck.load, loose() - total, piles.length - m2 >= 0];
    digger.a = site.a; piles.splice(1); digger.load = 0; // no pile in front of the arm: digging air
    Object.assign(digger, { x: site.world(0, 15)[0], z: site.world(0, 15)[1] });
    machineAction(digger); step(2.2);
    out.air = digger.load; piles.splice(1);
    machineAction(digger); machineAction(digger); out.once = digger.act && digger.act.kind; // a second press while busy changes nothing
    return out;
  }, STEP);
  expect(r).toEqual({ pose: true, scoop: [1, 39], loaded: [0, 1], ground: [0, 1, 1], full: [4, 1, true], air: 0, once: 'scoop' });
});

test('dump truck: tips the load out behind as a pile and the bed comes back down; empty it tips nothing', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(STEP => {
    const step = eval(STEP), out = {};
    piles.splice(0); setMode('car'); Object.assign(car, { x: truck.x, z: truck.z }); boardMachine(truck);
    const [x, z] = site.world(0, 14); Object.assign(truck, { x, z, a: site.a, load: 4, act: null, v: 0 });
    const [bx, bz] = [x - Math.sin(truck.a) * 6.6, z - Math.cos(truck.a) * 6.6];
    machineAction(truck); step(1.3); out.up = bedAngle(truck) > .7;
    step(1.5); out.tipped = [truck.load, piles.length, piles[0] && Math.round(piles[0].amount), piles[0] && Math.hypot(piles[0].x - bx, piles[0].z - bz) < 1];
    out.down = [bedAngle(truck), truck.act];
    machineAction(truck); step(3); out.empty = [truck.load, piles.length];
    return out;
  }, STEP);
  expect(r).toEqual({ up: true, tipped: [0, 1, 4, true], down: [0, null], empty: [0, 1] });
});

test('bulldozer: blade down pushes a pile along and flattens it; blade up drives over it', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(STEP => {
    const step = eval(STEP), out = {};
    piles.splice(0); setMode('car'); Object.assign(car, { x: dozer.x, z: dozer.z }); boardMachine(dozer);
    const [x, z] = site.world(-5, -5); Object.assign(dozer, { x, z, a: site.a, v: 0, blade: 0, bladeT: 0 });
    const ahead = d => [x + Math.sin(site.a) * d, z + Math.cos(site.a) * d];
    addDirt(...ahead(6), 20); const big = piles[0], y0 = pileH(big);
    keys.add('ArrowUp'); step(1.5); out.bladeUp = [big.spread, Math.round(Math.hypot(big.x - ahead(6)[0], big.z - ahead(6)[1]))]; // driven over, not pushed
    keys.clear(); step(2); Object.assign(dozer, { x, z, v: 0 });
    machineAction(dozer); step(1); out.bladeDown = dozer.blade > .6; // Space lowers it
    Object.assign(big, { x: ahead(6)[0], z: ahead(6)[1], spread: 1 });
    keys.add('ArrowUp'); step(3); keys.clear();
    out.pushed = [big.spread > 1.5, pileH(big) < y0, Math.hypot(big.x - ahead(6)[0], big.z - ahead(6)[1]) > 3, piles.length];
    machineAction(dozer); step(1); out.bladeUpAgain = dozer.blade < .4;
    piles.splice(0); addDirt(...ahead(8), 3); Object.assign(dozer, { x, z, a: site.a, v: 0, bladeT: 1, blade: 1 }); keys.add('ArrowUp');
    out.small = step(8, () => piles.length === 0) < 8; keys.clear(); // a small pile ends up flat and gone
    return out;
  }, STEP);
  expect(r).toEqual({ bladeUp: [1, 0], bladeDown: true, pushed: [true, true, true, 1], bladeUpAgain: true, small: true });
});

test('crane: swings, picks up a block, stacks blocks, never onto a machine, a full stack puts the block beside it', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(STEP => {
    const step = eval(STEP), out = {};
    setMode('car'); Object.assign(car, { x: crane.x, z: crane.z - 9 }); boardMachine(crane);
    const aim = (x, z) => { crane.a = Math.atan2(x - crane.x, z - crane.z); crane.reach = Math.hypot(x - crane.x, z - crane.z); };
    const b0 = blocks[0], b1 = blocks[1], [sx, sz] = STACK;
    aim(b0.x, b0.z); machineAction(crane); step(1); out.lowering = crane.hy < HOOKUP;
    step(2); out.held = [crane.held === b0, b0.held, Math.abs(b0.y - (crane.hy - 3.2)) < .01, crane.hy];
    aim(sx, sz); step(.1); out.carried = Math.hypot(b0.x - sx, b0.z - sz) < .1;
    machineAction(crane); step(3); out.stacked = [crane.held, b0.held, Math.round(b0.y)];
    aim(b1.x, b1.z); machineAction(crane); step(3); aim(sx, sz); machineAction(crane); step(3);
    out.second = [Math.round(b1.y), Math.hypot(b1.x - b0.x, b1.z - b0.z) < .1];
    // over a machine the block stays in the hook
    aim(b0.x + 1, b0.z); blocks[2].x = 0; // (leave the others alone)
    const b2 = blocks[2]; Object.assign(b2, { x: dozer.x, z: dozer.z + 0 }); // park a block on the dozer's spot to grab, then try to put it down on the truck
    Object.assign(b2, { x: blocks[3].x + 6, z: blocks[3].z, y: 0 }); aim(b2.x, b2.z); machineAction(crane); step(3);
    aim(truck.x, truck.z); machineAction(crane); step(3); out.refused = [crane.held === b2, b2.held];
    aim(sx + 8, sz); machineAction(crane); step(3); out.freed = [crane.held, Math.round(b2.y)];
    // a stack eight high: the next block goes down beside it
    blocks.forEach((b, i) => Object.assign(b, { held: false, x: sx + 20, z: sz + 5 * (i % 2), y: 0 })); crane.held = null;
    for (let i = 0; i < 8; i++) Object.assign(blocks[i], { x: sx, z: sz, y: i * 2 });
    Object.assign(blocks[8], { held: true }); crane.held = blocks[8]; aim(sx, sz); crane.hy = HOOKUP;
    machineAction(crane); step(3);
    out.beside = [crane.held, Math.hypot(blocks[8].x - sx, blocks[8].z - sz) > 2, blocks[8].y, Math.max(...blocks.map(b => b.y))];
    // arrows swing the arm and move the hook, within its range
    crane.act = null; const a0 = crane.a, r0 = crane.reach;
    keys.add('ArrowLeft'); keys.add('ArrowUp'); step(1); keys.clear(); out.moved = [crane.a > a0, crane.reach > r0];
    keys.add('ArrowDown'); step(10); keys.clear(); out.min = crane.reach;
    keys.add('ArrowUp'); step(10); keys.clear(); out.max = crane.reach;
    return out;
  }, STEP);
  expect(r).toMatchObject({
    lowering: true, held: [true, true, true, 20], carried: true, stacked: [null, false, 0], second: [2, true],
    refused: [true, true], freed: [null, 0], beside: [null, true, 0, 14], moved: [true, true], min: 5, max: 24,
  });
});

test('machines on their own: the digger loads the truck, the truck tips, the dozer flattens it, the crane builds a tower', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(STEP => {
    const step = eval(STEP), out = {};
    const [gx, gz] = site.world(0, -40); setMode('car'); Object.assign(car, { x: gx, z: gz }); // the car stays out of the way
    out.loaded = step(120, () => truck.phase === 'go');
    out.leaves = step(60, () => truck.phase === 'back');
    step(8); out.tipped = piles.some(p => !p.refill && p.amount >= 3);
    out.flat = step(120, () => !piles.some(p => !p.refill)); // the dozer pushes every small pile flat and gone
    out.big = piles.find(p => p.refill).amount;
    out.tower = step(400, () => crane.dir === 'clear');
    out.stacked = blocks.filter(b => b.y > 0).length;
    out.dozerMoved = Math.hypot(dozer.x - dozer.home.x, dozer.z - dozer.home.z) > 1 || dozer.leg === 1;
    out.inside = machines.every(m => inYard(m.x, m.z, 2));
    return out;
  }, STEP);
  expect(r.loaded).toBeLessThan(120);
  expect(r.leaves).toBeLessThan(60);
  expect(r.tipped).toBe(true);
  expect(r.flat).toBeLessThan(120);
  expect(r.big).toBeGreaterThan(4);
  expect(r.tower).toBeLessThan(400);
  expect(r.stacked).toBeGreaterThanOrEqual(7);
  expect(r.inside).toBe(true);
});

test('machines on their own stop for the car and wait; they stay inside the yard; going back to a job from anywhere', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(STEP => {
    const step = eval(STEP), out = {};
    piles.splice(1); setMode('car');
    // the truck is on its way to the tipping spot with the car parked in front of it
    Object.assign(truck, { phase: 'go', load: 4, v: 0 });
    const [px, pz] = site.world(-10, 3); Object.assign(truck, { x: px, z: pz, a: Math.atan2(TIPSPOT[0] - px, TIPSPOT[1] - pz) });
    Object.assign(car, { x: px + Math.sin(truck.a) * 8, z: pz + Math.cos(truck.a) * 8, v: 0 });
    step(6); out.waits = [Math.hypot(truck.x - car.x, truck.z - car.z) > 4, truck.blocked > 0, Math.abs(truck.v) < 1];
    Object.assign(car, { x: site.world(0, -40)[0], z: site.world(0, -40)[1] });
    step(12); out.goes = Math.hypot(truck.x - px, truck.z - pz) > 8 || truck.phase === 'back';
    // a digger left far off with a full bucket drives back towards its spot, and goes to work as soon as the big pile is in reach
    Object.assign(digger, { x: site.world(10, 20)[0], z: site.world(10, 20)[1], load: 1, act: null });
    const far = Math.hypot(digger.x - digger.home.x, digger.z - digger.home.z);
    out.home = step(60, () => digger.act) < 60 && Math.hypot(digger.x - digger.home.x, digger.z - digger.home.z) < far - 10;
    // driving a machine into the fence stops at the fence
    boardMachine(crane); leaveMachine(); boardMachine(dozer);
    Object.assign(dozer, { x: site.world(0, 0)[0], z: site.world(0, 0)[1], a: site.a + Math.PI / 2, v: 0 });
    keys.add('ArrowUp'); step(12); keys.clear();
    out.fence = [inYard(dozer.x, dozer.z, 3), inYard(dozer.x, dozer.z, 6) === false];
    return out;
  }, STEP);
  expect(r).toMatchObject({ waits: [true, true, true], goes: true, home: true, fence: [true, true] });
});

test('a crane on its own waits while the car is under the hook; the digger goes round the truck after a pushed-away big pile; no climbing in through the fence', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(STEP => {
    const step = eval(STEP), out = {};
    const [gx, gz] = site.world(0, -40); setMode('car'); Object.assign(car, { x: gx, z: gz });
    // the crane carries a block to the tower spot, but the car is parked there
    machines.splice(0, machines.length, crane);
    const [sx, sz] = STACK, b = blocks[0];
    Object.assign(car, { x: sx, z: sz, v: 0 });
    Object.assign(b, { held: true }); crane.held = b; crane.dir = 'build'; crane.act = null;
    step(8); out.waits = [crane.held === b, b.held];
    Object.assign(car, { x: gx, z: gz }); step(8); out.puts = [crane.held, b.held];
    // the big pile pushed far from the digger's spot: the digger drives over and starts scooping
    machines.push(digger, truck); piles.splice(1);
    const big = piles[0], [bx, bz] = site.world(15, -15); Object.assign(big, { x: bx, z: bz });
    Object.assign(digger, { x: digger.home.x, z: digger.home.z, load: 0, act: null });
    const far = Math.hypot(digger.x - bx, digger.z - bz);
    out.follows = step(60, () => digger.act) < 60 && Math.hypot(digger.x - bx, digger.z - bz) < far - 10;
    // a machine just inside the fence, the car just outside it: no climbing in through the fence
    machines.push(dozer); Object.assign(dozer, { x: site.world(0, YD - 3)[0], z: site.world(0, YD - 3)[1] });
    Object.assign(car, { x: site.world(0, YD + 2.5)[0], z: site.world(0, YD + 2.5)[1] });
    out.outside = nearMachine();
    Object.assign(car, { x: site.world(0, YD - 7.5)[0], z: site.world(0, YD - 7.5)[1] });
    out.inside = nearMachine() === dozer;
    return out;
  }, STEP);
  expect(r).toEqual({ waits: [true, true], puts: [null, false], follows: true, outside: null, inside: true });
});

test('machines catch no stars, and the drive-around still works with sound', async ({ page }) => {
  const problems = await open(page);
  await page.keyboard.press('KeyX'); // start, which also starts the sound
  const r = await page.evaluate(STEP => {
    const step = eval(STEP), out = {};
    setMode('car'); Object.assign(car, { x: dozer.x + 6, z: dozer.z }); boardMachine(dozer);
    Object.assign(stars[0], { x: dozer.x, z: dozer.z, y: 2.2, sky: false });
    const s0 = score; step(1); out.score = score - s0;
    // backing up beeps, and the machine you are in is heard loudest
    const heard = [], realTone = tone;
    tone = (f, ...a) => { heard.push(f); realTone(f, ...a); };
    Object.assign(dozer, { v: -3, beepT: 0 }); keys.add('ArrowDown'); step(1); keys.clear();
    tone = realTone;
    out.beeps = heard.filter(f => f === 1100).length;
    setMode('car'); Object.assign(car, { x: digger.x, z: digger.z });
    out.loud = [siteVol(digger) > 0, siteVol(crane) > 0];
    Object.assign(car, { x: site.world(0, -90)[0], z: site.world(0, -90)[1] });
    out.far = machines.map(siteVol);
    out.hum = siteGain instanceof GainNode;
    return out;
  }, STEP);
  expect(r.score).toBe(0);
  expect(r.beeps).toBeGreaterThan(0);
  expect(r.loud[0]).toBe(true);
  expect(r.far).toEqual([0, 0, 0, 0]);
  expect(r.hum).toBe(true);
  expect(problems).toEqual([]);
});

test('with the keyboard: climb into each machine, work it, and everything draws without errors', async ({ page }) => {
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 400, height: 300 });
  const problems = await open(page);
  await page.keyboard.press('KeyX'); // start
  await page.evaluate(() => { const [x, z] = site.world(-12, 0); Object.assign(car, { x, z, a: site.a }); });
  for (const kind of ['digger', 'truck', 'dozer', 'crane']) {
    await page.evaluate(k => {
      const m = machines.find(o => o.kind === k), edge = (o, x, z) => Math.hypot(o.x - x, o.z - z) - o.r;
      setMode('car');
      for (let i = 0; i < 40; i++) { // beside this machine, nearer to it than to any other
        const x = m.x + Math.cos(i * .3) * (m.r + 2.8), z = m.z + Math.sin(i * .3) * (m.r + 2.8);
        if (!hits(x, z) && machines.every(o => o === m || edge(o, x, z) > edge(m, x, z))) { Object.assign(car, { x, z }); break; }
      }
    }, kind);
    await page.keyboard.press('KeyH');
    await page.waitForFunction(k => mode === k, kind, { timeout: 40_000 });
    const blade = await page.evaluate(() => dozer.bladeT); // the bulldozer may already have its blade down, pushing a pile
    await page.keyboard.down('ArrowUp'); await page.keyboard.down('ArrowLeft'); await page.keyboard.press('Space');
    await page.waitForFunction(([k, b]) => { const m = machines.find(o => o.kind === k); return k === 'dozer' ? m.bladeT !== b : !!m.act; }, [kind, blade], { timeout: 40_000 });
    await page.keyboard.up('ArrowLeft'); await page.keyboard.up('ArrowUp');
    const shot = await page.locator('canvas').screenshot();
    expect(shot.length).toBeGreaterThan(5_000);
    await page.keyboard.press('KeyH');
    await page.waitForFunction(() => mode === 'car', null, { timeout: 40_000 });
  }
  expect(await glError(page)).toBe(0);
  expect(problems).toEqual([]);
});
