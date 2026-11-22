import { chromium } from 'playwright-core';
import { browserOptions } from '../browser-options.mjs';
const browser = await chromium.launch({ ...browserOptions, headless: true, args: ['--enable-unsafe-swiftshader','--use-angle=swiftshader','--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows','--disable-features=CalculateNativeWinOcclusion'] });
for (const vp of [{w:1440,h:900,m:false},{w:390,h:844,m:true}]) {
  const page = await browser.newPage({ viewport: { width: vp.w, height: vp.h }, isMobile: vp.m, hasTouch: vp.m });
  await page.goto('http://127.0.0.1:5190/#/device/pump');
  await page.waitForFunction(() => window.__chem3d?.device?.id === 'pump');
  await new Promise(r=>setTimeout(r,1500));
  const m = await page.evaluate(async () => {
    const s = window.__chem3d.scene; let tris=0, bytes=0, meshes=0;
    for (const [,p] of s.parts) p.group.traverse(o=>{ if(!o.isMesh) return; meshes++; const g=o.geometry; const pos=g.attributes.position; if(pos) bytes+=pos.count*3*4; if(g.index){tris+=g.index.count/3; bytes+=g.index.count*4;} else if(pos) tris+=pos.count/3; });
    const fps = await new Promise(res=>{ let n=0; const t0=performance.now(); const tick=()=>{ n++; if(performance.now()-t0<1600) requestAnimationFrame(tick); else res(Math.round(n*1000/(performance.now()-t0))); }; requestAnimationFrame(tick); });
    return { parts: s.parts.size, meshes, triangles: Math.round(tris), drawCalls: s.renderer.info.render.calls, geometryMB: +(bytes/1048576).toFixed(2), fps, loadMs: Math.round(performance.getEntriesByType('navigation')[0]?.domContentLoadedEventEnd ?? 0) };
  });
  console.log(vp.m?'mobile':'desktop', JSON.stringify(m));
  await page.close();
}
await browser.close();
