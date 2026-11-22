import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';
import { browserOptions } from './browser-options.mjs';

const out = 'outputs/verify-p1/comparison';
const position = [3.7, 2.55, 4.8];
const target = [-0.35, 1.04, 0];
await mkdir(out, { recursive: true });
const browser = await chromium.launch({
  ...browserOptions, headless: true, args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader']
});
try {
  const facts = {};
  for (const [label, url] of [
    ['before', process.env.PUMP_BASELINE ?? 'http://127.0.0.1:48119/'],
    ['after', process.env.VERIFY_BASE ?? 'http://127.0.0.1:48118/']
  ]) {
    const page = await browser.newPage({viewport: {width: 1440, height: 900}, deviceScaleFactor: 1});
    try {
      await page.goto(url + '#/device/pump');
      await page.waitForFunction(() => window.__chem3d?.device.id === 'pump');
      await page.getByRole('button', {name: '剖视', exact: true}).click();
      await page.evaluate(({position,target}) => {
        const scene = window.__chem3d.scene;
        scene.setQuality('high');
        scene.camera.position.fromArray(position);
        scene.controls.target.fromArray(target);
        scene.controls.update();
        scene.camera.updateMatrixWorld(true);
      }, {position,target});
      await page.waitForTimeout(900);
      facts[label] = await page.evaluate(() => {
        const s = window.__chem3d.scene;
        return {
          position: s.camera.position.toArray(), target: s.controls.target.toArray(),
          mode:s.mode, near:s.camera.near, canvas:[s.renderer.domElement.clientWidth,s.renderer.domElement.clientHeight]
        };
      });
      await page.screenshot({path: out + '/' + label + '-section.png'});
    } finally {
      await page.close();
    }
  }
  assert.deepEqual(facts.before, facts.after);
  await writeFile(out + '/report.json', JSON.stringify(facts, null, 2));
  console.log('PASS: same viewport, quality, camera and section mode before and after');
} finally {
  await browser.close();
}
