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
  // only the few countryside trees where the launch station now stands are gone
  const kept = await page.evaluate(all => all.filter(s => !inStationArea((s.x0 + s.x1) / 2, (s.z0 + s.z1) / 2, 3)), LAYOUT.solids);
  expect(LAYOUT.solids.length - kept.length).toBeLessThan(15);
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

// ---------- Boat (#4) ----------

test('water: bigger lake with islands and ramps, a long winding river, nothing in town', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(() => {
    let len = 0;
    for (let i = 1; i < river.length; i++) len += Math.hypot(river[i].x - river[i - 1].x, river[i].z - river[i - 1].z);
    const townWet = [];
    for (let x = -10; x <= W + 10; x += 2) for (let z = -10; z <= W + 10; z += 2) if (wet(x, z, 0)) townWet.push([x, z]);
    const lakeToTown = Math.min(...[-1, 1].flatMap(sx => [-1, 1].map(sz => townDist(lake.x + sx * (LAKEW / 2 + 5), lake.z + sz * (LAKED / 2 + 5)))),
      townDist(lake.x, lake.z) - Math.hypot(LAKEW / 2 + 5, LAKED / 2 + 5));
    return {
      area: (LAKEW * LAKED) / (74 * 54), len, islands: islands.length, ramps: ramps.length,
      riverToTown: Math.min(...river.map(p => townDist(p.x, p.z))) - RIVERW / 2 - 2.5, lakeToTown, townWet,
      riverInMountain: river.some(p => mountains.some(m => Math.hypot(m.x - p.x, m.z - p.z) < m.r * 1.4)),
      lakeMiddle: inWater(lake.x + 25, lake.z - 30), river: inWater(river[20].x, river[20].z),
      islandsDry: islands.map(i => inWater(i.x, i.z) || !onLand(i.x, i.z, SHORE)),
      beach: inWater(lake.x + LAKEW / 2 + 3, lake.z), riverBank: inWater(river[20].x + RIVERW / 2 + 2, river[20].z + RIVERW / 2 + 2),
      treesInWater: solids.filter(s => s.top > 4 && wet((s.x0 + s.x1) / 2, (s.z0 + s.z1) / 2, 0) && !onIsland((s.x0 + s.x1) / 2, (s.z0 + s.z1) / 2, 0)).length,
    };
  });
  expect(r.area).toBeGreaterThan(2.3);
  expect(r.area).toBeLessThan(2.8);
  expect(r.len).toBeGreaterThanOrEqual(250);
  expect(r.len).toBeLessThanOrEqual(350);
  expect(r.islands).toBe(3);
  expect(r.ramps).toBeGreaterThanOrEqual(3);
  expect(r.ramps).toBeLessThanOrEqual(4);
  expect(r.riverToTown).toBeGreaterThanOrEqual(20);
  expect(r.lakeToTown).toBeGreaterThanOrEqual(20);
  expect(r.townWet).toEqual([]); // park ponds are not boat water
  expect(r.riverInMountain).toBe(false);
  expect(r).toMatchObject({ lakeMiddle: true, river: true, islandsDry: [false, false, false], beach: false, riverBank: false, treesInWater: 0 });
});

test('the car drives into the lake as the boat, and out again as the car', async ({ page }) => {
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 400, height: 300 });
  const problems = await open(page);
  await page.keyboard.press('KeyX'); // start
  // on the beach, facing the water
  await page.evaluate(() => Object.assign(car, { x: lake.x + LAKEW / 2 + 4, z: lake.z - 30, a: -Math.PI / 2, v: 0 }));
  await page.keyboard.down('ArrowUp');
  await page.waitForFunction(() => mode === 'boat', null, { timeout: 40_000 });
  expect(await page.evaluate(() => [boat.x < lake.x + LAKEW / 2, fx.some(f => f.spray), document.getElementById('mode').textContent]))
    .toEqual([true, true, 'H = 🚁']);
  await page.keyboard.up('ArrowUp');
  // turn around and head for the beach
  await page.evaluate(() => Object.assign(boat, { a: Math.PI / 2, v: 0 }));
  await page.keyboard.down('ArrowUp');
  await page.waitForFunction(() => mode === 'car', null, { timeout: 40_000 });
  await page.keyboard.up('ArrowUp');
  expect(await page.evaluate(() => onLand(car.x, car.z, SHORE) && car.x > lake.x + LAKEW / 2)).toBe(true);
  expect(await glError(page)).toBe(0);
  expect(problems).toEqual([]);
});

test('no flicker at the shore, and the helicopter lands as the boat over water', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(() => {
    const edge = lake.x + LAKEW / 2, z = lake.z - 30, out = {};
    // standing still just inside the water, the car stays a car; just up the beach, the boat stays a boat
    setMode('car'); Object.assign(car, { x: edge - 1, z, v: 0 }); driveCar(1 / 60); out.carJustIn = mode;
    Object.assign(car, { x: edge - 2, z, v: 0 }); driveCar(1 / 60); out.carIn = mode;
    Object.assign(boat, { x: edge + 1, z, v: 0, hop: 0, vy: 0 }); driveBoat(1 / 60); out.boatJustOut = mode;
    Object.assign(boat, { x: edge + 2, z, v: 0 }); driveBoat(1 / 60); out.boatOut = mode;
    // helicopter over the lake and over the river lands as the boat, over the beach as the car on dry land
    setMode('heli'); Object.assign(heli, { x: lake.x + 25, z: lake.z - 30 }); switchVehicle(); out.heliLake = [mode, boat.x, boat.z];
    setMode('heli'); Object.assign(heli, { x: river[20].x, z: river[20].z }); switchVehicle(); out.heliRiver = mode;
    setMode('heli'); Object.assign(heli, { x: edge + 1, z }); switchVehicle(); out.heliBeach = [mode, onLand(car.x, car.z, SHORE)];
    setMode('car');
    return out;
  });
  expect(r).toEqual({ carJustIn: 'car', carIn: 'boat', boatJustOut: 'boat', boatOut: 'car',
    heliLake: ['boat', expect.any(Number), expect.any(Number)], heliRiver: 'boat', heliBeach: ['car', true] });
});

test('the speedboat tops out at 28, glides when you let go, and only it catches water stars', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(() => {
    const mid = { x: lake.x + 25, z: lake.z - 30 }, out = {};
    setMode('boat'); Object.assign(boat, { ...mid, a: 0, v: 0, hop: 0, vy: 0 });
    keys.add('ArrowUp');
    for (let i = 0; i < 600; i++) { driveBoat(1 / 60); Object.assign(boat, mid); }
    keys.delete('ArrowUp');
    out.top = boat.v;
    for (let i = 0; i < 60; i++) { driveBoat(1 / 60); Object.assign(boat, mid); }
    out.afterGlide = boat.v; // the car keeps only 35% after a second, the boat 60%
    const w = stars.filter(s => s.water);
    out.water = [w.length, w.every(s => inWater(s.x, s.z, 4) && !ramps.some(r => Math.hypot(r.x - s.x, r.z - s.z) < r.r))];
    // a water star under the car (on the beach) stays put, under the boat it is caught and comes back on the water
    const i = stars.indexOf(w[0]), before = score, beach = { x: lake.x + LAKEW / 2 + 4, z: lake.z - 30 };
    setMode('car'); Object.assign(car, beach, { v: 0 }); Object.assign(stars[i], beach); update(1 / 60);
    out.carCatch = [mode, score - before];
    Object.assign(stars[i], mid);
    setMode('boat'); Object.assign(boat, mid); update(1 / 60);
    out.boatCatch = score - before;
    out.respawn = [stars[i].water, inWater(stars[i].x, stars[i].z, 4), Math.hypot(stars[i].x - boat.x, stars[i].z - boat.z) > 40];
    setMode('car');
    return out;
  });
  expect(r.top).toBe(28);
  expect(r.afterGlide).toBeCloseTo(28 * 0.6, 0);
  expect(r).toMatchObject({ water: [6, true], carCatch: ['car', 0], boatCatch: 1, respawn: [true, true, true] });
});

test('wave ramps make a fast boat hop and a slow one bump; ducks scatter and come back', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(() => {
    const ramp = ramps[0], out = {};
    const run = v => { // aim at the ramp from 12 away and keep the speed up
      setMode('boat');
      Object.assign(boat, { x: ramp.x - 12, z: ramp.z, a: Math.PI / 2, v, hop: 0, vy: 0, onRamp: false });
      let top = 0;
      for (let i = 0; i < 240; i++) { boat.v = v; driveBoat(1 / 60); top = Math.max(top, boat.hop); }
      return top;
    };
    out.fast = run(26); out.slow = run(5);
    out.landed = boat.hop;
    const d = ducks[0], start = { x: d.x, z: d.z };
    setMode('boat'); Object.assign(boat, { x: d.x + 6, z: d.z, v: 0 });
    for (let i = 0; i < 60; i++) updateDucks(1 / 60);
    out.scared = d.scared; out.fled = Math.hypot(d.x - boat.x, d.z - boat.z) - 6;
    out.inLake = ducks.every(k => inLake(k.x, k.z, 0) && inWater(k.x, k.z, 1));
    setMode('car');
    for (let i = 0; i < 60 * 60; i++) updateDucks(1 / 60);
    out.home = Math.hypot(d.x - start.x, d.z - start.z);
    return out;
  });
  expect(r.fast).toBeGreaterThan(1.5);
  expect(r.slow).toBeGreaterThan(0);
  expect(r.slow).toBeLessThan(.3);
  expect(r.landed).toBe(0);
  expect(r.scared).toBe(true);
  expect(r.fled).toBeGreaterThan(3);
  expect(r.inLake).toBe(true);
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

test('at the station H boards the rocket; the helicopter lands on the H pad as the car', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(() => {
    const badge = () => document.getElementById('mode').textContent, help = () => document.getElementById('help').textContent, out = {};
    setMode('car'); Object.assign(car, { x: 3 * P, z: P / 2 }); refreshHud(); out.town = badge();
    const [x, z] = station.world(0, -PADH + 5); Object.assign(car, { x, z }); refreshHud();
    out.pad = [badge(), help()];
    switchVehicle(); out.board = [mode, scene, rocket.count > 3, badge(), help()];
    switchVehicle(); out.cancel = [mode, inStation(car.x, car.z)]; // still on the pad: H gives the car back
    setMode('heli'); Object.assign(heli, { x: station.hx, z: station.hz, y: 20 }); switchVehicle();
    out.heli = [mode, inStation(car.x, car.z), badge()];
    setMode('heli'); Object.assign(heli, { x: 3 * P, z: P / 2 }); switchVehicle(); out.elsewhere = badge();
    return out;
  });
  expect(r).toEqual({
    town: 'H = 🚁',
    pad: ['H = 🚀', 'Arrows or WASD = drive · Space = beep beep! · H = rocket · M = sound'],
    board: ['rocket', 'earth', true, 'H = 🚗', 'Hold W, Space or ↑ = blast off · S or ↓ = go down · H = car · M = sound'],
    cancel: ['car', true], heli: ['car', true, 'H = 🚀'], elsewhere: 'H = 🚁',
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
  await Promise.all([page.waitForEvent('load'), page.keyboard.press('KeyX')]);
  await page.waitForFunction(() => T > 0.3);
  expect(await page.evaluate(() => gl.isContextLost())).toBe(false);
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
