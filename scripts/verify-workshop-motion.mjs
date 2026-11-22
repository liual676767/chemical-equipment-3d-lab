import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { mkdir, writeFile } from 'node:fs/promises';
import { browserOptions } from './browser-options.mjs';

const base = process.env.VERIFY_BASE ?? 'http://127.0.0.1:48118/';
const out = process.env.P2_MOTION_OUTPUT ?? 'outputs/verify-workshop-motion';
const pointerOnly = process.env.P2_POINTER_ONLY === '1';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({
  ...browserOptions, headless: true, args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader']
});
try {
  const report = {};
  const purposes = pointerOnly ? ['near'] : ['near', 'blocked', 'detach', 'group', 'touchCancel', 'outside'];
  for (const purpose of purposes) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, hasTouch: purpose === 'touchCancel' });
    try {
      await page.goto(base + '#/workshop');
      await page.waitForFunction(() => typeof window.__ws === 'object');
      await page.evaluate(purpose => {
        const w = window.__ws;
        const spec = { dn: 100, length: 500 };
        w.addInstanceAt('pipe', [0,0,0], spec);
        w.addInstanceAt('pipe', [-8,0,0], spec);
        if (purpose === 'detach' || purpose === 'group') {
          const [fixed, moving] = w.state.instances;
          if (!w.makeConnection({uid: fixed.uid,port:'p1'},{uid:moving.uid,port:'p2'}).ok) throw new Error('Detach fixture must start connected');
        }
        w.engine.fitAll();
        if (purpose !== 'blocked') {
          w.engine.camera.position.x = -Math.abs(w.engine.camera.position.x) - 9;
          w.engine.controls.update();
          w.engine.camera.updateMatrixWorld(true);
        }
      }, purpose);
      await page.waitForTimeout(900);
      await page.getByRole('button', { name: '移动', exact: true }).click();
      await page.waitForTimeout(550);
      const coords = await page.evaluate(delta => {
        const w = window.__ws;
        const e = w.engine;
        const moving = w.state.instances[1];
        const box = e.boxes().get(moving.uid);
        const center = box.getCenter(box.min.clone());
        const rect = e.renderer.domElement.getBoundingClientRect();
        const project = point => {
          const projected = point.clone().project(e.camera);
          return [rect.x + (projected.x + 1)*rect.width/2, rect.y + (1 - projected.y)*rect.height/2];
        };
        for (const dx of [0,0.8,-0.8,1.6,-1.6]) {
          const test = center.clone();
          test.x += dx;
          const begin = project(test);
          const hit = e.pickUid({clientX:begin[0],clientY:begin[1]});
          if (hit?.uid !== moving.uid) continue;
          const target = hit.point.clone();
          target.x += delta;
          return {begin, end:project(target)};
        }
        return null;
      }, purpose === 'blocked' ? 16 : (purpose === 'detach' || purpose === 'group') ? -2 : 3);
      assert.ok(coords, 'Could not locate a visible point on the moving pipe');
      if (purpose === 'touchCancel') {
        const cdp = await page.context().newCDPSession(page);
        const touch = (type, pair) => cdp.send('Input.dispatchTouchEvent', { type,
          touchPoints: pair ? [{ x: pair[0], y: pair[1], id: 1 }] : [] });
        await touch('touchStart', coords.begin);
        await touch('touchMove', coords.end);
        await touch('touchCancel');
      } else {
        if (purpose === 'blocked') {
          const cdp = await page.context().newCDPSession(page);
          await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 });
        }
        if (purpose === 'detach') await page.keyboard.down('Alt');
        await page.mouse.move(...coords.begin);
        await page.mouse.down();
        await page.mouse.move(...coords.end, { steps: purpose === 'blocked' ? 1 : 18 });
        if (purpose === 'near') {
          assert.equal(await page.evaluate(() => window.__ws.state.connections.length), 0, 'Preview must not commit');
          await page.getByText('接口已对准，松手连接。', {exact:true}).waitFor();
          await page.screenshot({ path: out + '/preview.png' });
          await page.evaluate(([clientX, clientY]) => {
            const canvas = window.__ws.engine.renderer.domElement;
            canvas.dispatchEvent(new PointerEvent('pointerup', {
              pointerId: 99, pointerType: 'touch', isPrimary: false, clientX, clientY, bubbles: true
            }));
          }, coords.end);
          if (pointerOnly) await page.screenshot({ path: out + '/after-secondary-release.png' });
          assert.equal(await page.evaluate(() => window.__ws.state.connections.length), 0, 'A second pointer cannot commit the first pointer’s preview');
          report.secondaryPointerIgnored = true;
        }
        if (purpose === 'outside') await page.mouse.move(-10, coords.end[1]);
        await page.mouse.up();
        if (purpose === 'detach') await page.keyboard.up('Alt');
      }
      await page.waitForTimeout(450);
      report[purpose] = await page.evaluate(() => ({
        position: window.__ws.state.instances[1].pos,
        fixedPosition: window.__ws.state.instances[0].pos,
        connections: window.__ws.state.connections.length
      }));
      await page.screenshot({ path: out + '/' + purpose + '.png' });
      if (purpose === 'near') {
        await page.getByRole('button', { name: '撤销', exact: true }).click();
        const read = () => page.evaluate(() => ({
          position: window.__ws.state.instances[1].pos,
          fixedPosition: window.__ws.state.instances[0].pos,
          connections: window.__ws.state.connections.length
        }));
        const undo = await read();
        assert.equal(undo.connections, 0);
        assert.equal(undo.position[0], -8);
        await page.getByRole('button', { name: '重做', exact: true }).click();
        assert.deepEqual(await read(), report.near);
        report.undoRedo = true;
      }
    } finally {
      await page.close();
    }
  }
  await writeFile(out + '/report.json', JSON.stringify(report, null, 2));
  if (pointerOnly) {
    assert.equal(report.near.connections, 1);
    console.log('PASS: secondary release leaves preview, primary release commits exactly once');
  } else {
    const expected = {
      nearConnects: report.near.connections === 1 && Math.abs(report.near.position[0] + 5) < 1e-6,
      blockedDoesNotCross: report.blocked.position[0] <= -5 + 1e-6 && report.blocked.connections === 0,
      detachableAxisWorks: report.detach.position[0] < -5.5 && report.detach.connections === 0,
      canceledTouchRestoresPose: report.touchCancel.position[0] === -8 && report.touchCancel.connections === 0,
      outsideReleaseRestoresPose: report.outside.position[0] === -8 && report.outside.connections === 0,
      undoRedo: report.undoRedo === true,
      secondaryPointerIgnored: report.secondaryPointerIgnored === true,
      connectedGroupMovesTogether: report.group.position[0] === -7 && report.group.fixedPosition[0] === -2 && report.group.connections === 1
    };
    console.log(JSON.stringify({ ...report, expected }, null, 2));
    assert.ok(Object.values(expected).every(Boolean), JSON.stringify(expected));
  }
} finally {
  await browser.close();
}
