/* Walk the authored teaching stairs through the public controls and sample the camera each frame. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { browserOptions, webglArgs } from './browser-options.mjs';

const browser = await chromium.launch({
  ...browserOptions,
  args: [...webglArgs, '--disable-renderer-backgrounding']
});
const page = await browser.newPage({ viewport: { width: 1000, height: 720 } });
page.setDefaultTimeout(60000);
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
const position = () => page.evaluate(() => window.__factoryDebug.debug().pos);
const eq = (a, b) => Math.abs(a - b) < 0.001;
const entry = page.getByRole('button', { name: '到投料楼梯口' });

async function move(control, axis, destination, direction, stopAtBarrier = false) {
  const pad = control === 'pad-back' ? page.locator('.walk-pad-btn.is-down') : null;
  if (pad) {
    const box = await pad.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  }
  // Register the sampler before sending input so slow software frames cannot hide the first step.
  await page.evaluate(() => {
    const samples = window.walkSamples = [];
    window.walkStartedAt = performance.now();
    function sample() {
      if (window.walkSamples !== samples) return;
      samples.push(window.__factoryDebug.debug().pos);
      requestAnimationFrame(sample);
    }
    requestAnimationFrame(sample);
  });
  try {
    if (pad) await page.mouse.down();
    else await page.keyboard.down(control);
    await page.waitForFunction(({ axis, destination, direction, stopAtBarrier }) => {
      const s = window.walkSamples, last = s.at(-1);
      if (!last) return false;
      if ((last[axis] - destination) * direction < 0) {
        // A frame cap limits displacement per frame. Distinguish a collision
        // with 30 stationary frames from a slow renderer still making progress.
        if (s.length >= 30 && s.slice(-30).every(p => Math.abs(p[axis] - last[axis]) < 0.0001)) {
          throw new Error('Held control did not advance for 30 consecutive frames');
        }
        return false;
      }
      if (!stopAtBarrier) return true;
      return s.length >= 6 && s.slice(-6).every(p => Math.abs(p[axis] - last[axis]) < 0.0001);
    }, { axis, destination, direction, stopAtBarrier }, { timeout: 180000 });
  } catch (error) {
    const timing = await page.evaluate(() => ({
      frames: window.walkSamples.length, milliseconds: Math.round(performance.now() - window.walkStartedAt),
      lastPositions: window.walkSamples.slice(-6)
    }));
    throw new Error(`Movement ${control} did not reach ${destination} on axis ${axis}: ${JSON.stringify(timing)}`, { cause: error });
  } finally {
    if (pad) await page.mouse.up();
    else await page.keyboard.up(control);
  }
  const trace = await page.evaluate(() => {
    const samples = window.walkSamples;
    delete window.walkSamples;
    return { samples, ms: Math.round(performance.now() - window.walkStartedAt) };
  });
  console.log(`  ${control} ${trace.samples.length} frames / ${trace.ms} ms, from ${trace.samples[0]} to ${trace.samples.at(-1)}`);
  return trace.samples;
}

try {
  await page.goto(new URL('#/', process.env.VERIFY_BASE ?? 'http://127.0.0.1:5173/').href);
  await page.waitForFunction(() => !!window.__factoryDebug);
  const before = await page.evaluate(() => window.__factoryDebug.view());
  await page.getByRole('button', { name: '行走模式', exact: true }).click();
  async function approach() {
    await entry.click();
    await page.waitForFunction(() => {
      const [x, y, z] = window.__factoryDebug.debug().pos;
      return Math.abs(x + 1) < 0.001 && Math.abs(y - 1.7) < 0.001 && Math.abs(z + 5.5) < 0.001;
    });
  }
  await approach();
  // Approach the north side from the floor. The wall of the raised stairs blocks access.
  await move('d', 2, -6.65, -1);
  await move('w', 0, -3.5, -1);
  const side = await move('a', 2, -6.62, 1, true);
  assert(side.every(p => eq(p[1], 1.7)) && side.at(-1)[2] < -6.15);
  console.log('PASS ground movement cannot enter the stair side');

  await approach();
  const up = await move('ArrowUp', 0, -4.2, -1);
  const floors = [...new Set(up.map(p => Number((p[1] - 1.7).toFixed(4))))];
  const levels = [0, 0.06, 0.2875, 0.575, 0.8625, 1.15, 1.4375, 1.725, 2.0125, 2.39];
  assert.deepEqual(floors, levels);
  console.log('PASS climbed all eight rendered treads and reached the platform', floors);
  const centerDown = await move('s', 0, -1.42, 1);
  assert.deepEqual([...new Set(centerDown.map(p => Number((p[1] - 1.7).toFixed(4))))], [...levels].reverse());
  console.log('PASS descended all eight treads along the center');
  await move('w', 0, -4.2, -1);
  const rail = await move('d', 2, -5.67, -1, true);
  assert(rail.every(p => eq(p[1], 4.09)) && rail.at(-1)[2] > -6.05);
  const end = await move('w', 0, -6.15, -1, true);
  assert(end.every(p => eq(p[1], 4.09)) && end.at(-1)[0] > -6.75);
  console.log('PASS platform permits walking and prevents leaving over the side and west edges');

  const down = await move('pad-back', 0, -1.42, 1);
  const descend = [...new Set(down.map(p => Number((p[1] - 1.7).toFixed(4))))];
  assert.deepEqual(descend, [...levels].reverse());
  assert(eq((await position())[1], 1.7));
  console.log('PASS on-screen direction pad descended every step and returned to ground');
  await page.keyboard.press('Escape');
  await entry.waitFor({ state: 'hidden' });
  const after = await page.evaluate(() => window.__factoryDebug.view());
  assert(before.pos.every((v, i) => eq(v, after.pos[i])));
  assert(before.target.every((v, i) => eq(v, after.target[i])));
  assert.deepEqual(errors, []);
  console.log('PASS Escape restored the original camera and target, no page errors');
} finally {
  await browser.close();
}
