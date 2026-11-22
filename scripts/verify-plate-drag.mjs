import { chromium } from 'playwright-core';
import { browserOptions, webglArgs } from './browser-options.mjs';
const browser=await chromium.launch({...browserOptions,headless:true,args:webglArgs});
try {
 const page=await browser.newPage({viewport:{width:1280,height:800}}); await page.goto(`${process.env.VERIFY_BASE || 'http://127.0.0.1:5175'}/#/device/plate-exchanger`); await page.waitForFunction(()=>window.__chem3d?.scene);
 const result=await page.evaluate(async()=>{
  const s=window.__chem3d.scene; s.setMode('practice');
  const run=(mode,id,eventType)=>{
    s.startPractice(mode); const p=s.parts.get(id); p.state='tray'; p.group.position.copy(p.trayPos);
    s.pick=()=>id;
    const canvas=s.renderer.domElement;
    const rect=canvas.getBoundingClientRect();
    const capture=canvas.setPointerCapture;
    // This helper checks exercise state separately from the trusted pointer test.
    canvas.setPointerCapture=()=>{};
    const ev=(type,x,y,buttons=1)=>({type,button:0,buttons,pointerId:1,clientX:rect.left+x,clientY:rect.top+y});
    try {
      s.onPointerDown(ev('pointerdown',100,100)); const initial=p.group.position.clone();
      s.onPointerMove(ev('pointermove',150,140)); const stationary=p.group.position.distanceTo(initial)<1e-9;
      s.onPointerUp(ev(eventType,150,140,0));
      return {stationary,state:p.state,positionUnchanged:p.group.position.distanceTo(initial)<1e-9,dragCleared:s.dragPart===null,controls:s.controls.enabled};
    } finally { canvas.setPointerCapture=capture; }
  };
  const canceled=run('free','bolts','pointerleave');
  const canceledPointer=run('free','gaskets','pointercancel');
  const guideLeave=run('free','guideBars','pointerleave');
  const guideCancel=run('free','guideBars','pointercancel');
  const installed=run('free','bolts','pointerup');
  const settledAt = performance.now() + 10000;
  while (s.tweens.length && performance.now() < settledAt) await new Promise(requestAnimationFrame);
  if (s.tweens.length) throw Error('The installation animation did not settle before undo');
  s.undo();
  const undo=s.parts.get('bolts').state==='tray';
  const guided=run('guided','bolts','pointerup');
  s.restart(); const reset=s.getPracticeState().installed.includes('bolts');
  return {guideLeave,guideCancel,canceled,canceledPointer,installed,guided,reset,undo};
 });
 let details=result;
 const check=(s,v)=>{if(!v)throw Error(s+' '+JSON.stringify(details));console.log('PASS '+s)};
 check('自由练习移出画布取消且不移动',result.canceled.stationary&&result.canceled.positionUnchanged&&result.canceled.state==='tray'&&result.canceled.dragCleared&&result.canceled.controls);
 check('指针取消保留零件',result.canceledPointer.stationary&&result.canceledPointer.state==='tray'&&result.canceledPointer.dragCleared);
 check('自由练习松开触发自动安装',result.installed.stationary&&result.installed.state==='installed');
 check('引导练习仍执行顺序检查',result.guided.stationary&&result.guided.state==='tray');
 check('撤销恢复零件区状态',result.undo);
 check('重启恢复装配',result.reset);
 check('Guide bars return to tray on leave or cancel',[result.guideLeave,result.guideCancel].every(r=>r.state==='tray' && r.positionUnchanged && r.controls));
 const rapid=await page.evaluate(async()=>{
  const s=window.__chem3d.scene;
  const wait=async()=>{
    const deadline=performance.now()+10000;
    while(s.tweens.length && performance.now()<deadline) await new Promise(requestAnimationFrame);
    if(s.tweens.length) throw Error('Motion did not settle');
  };
  s.startPractice('guided');
  const first=s.steps[0]; s.select(first.partId); s.removeSelected();
  const afterRemove=s.stepIndex; const next=s.steps[s.stepIndex];
  s.select(next.partId); s.removeSelected(); s.undo();
  const blocked=s.stepIndex===afterRemove && s.parts.get(first.partId).state==='tray';
  s.restart(); await wait();
  const reset=s.stepIndex===0 && s.parts.get(first.partId).state==='installed' && s.parts.get(first.partId).group.position.distanceTo(s.parts.get(first.partId).group.position.clone().fromArray(s.parts.get(first.partId).def.pos))<0.001;
  s.select(first.partId); s.removeSelected(); await wait(); s.undo(); await wait();
  const settled=s.stepIndex===0 && s.parts.get(first.partId).state==='installed';
  s.startPractice('free'); s.select(first.partId); s.removeSelected(); s.installSelected();
  const freeInverse=s.parts.get(first.partId).state;
  const bolt=s.parts.get('bolts');
  const shafts=[]; bolt.group.traverse(node=>{if(node.userData.kind==='shaft') shafts.push(node)});
  const pose=offset=>shafts.length>0 && shafts.every(node=>Math.abs(node.position.x-node.userData.baseX-offset)<1e-6);
  s.attemptInstall(bolt,null);
  const directBlocked=bolt.state==='tray';
  s.setMode('observe');
  const observe=s.tweens.length===0 && pose(0) && bolt.group.position.distanceTo(bolt.group.position.clone().fromArray(bolt.def.pos))<1e-6;
  s.setMode('practice');
  const resumed=pose(1.2) && bolt.group.position.distanceTo(bolt.trayPos)<1e-6;
  s.dragPart=bolt; s.dragging=true; s.controls.enabled=false;
  s.restart();
  const clean=pose(0) && !s.dragPart && !s.dragging && s.controls.enabled;
  s.select('bolts'); s.removeSelected(); await wait();
  s.select('movablePlate'); s.removeSelected(); await wait();
  const multiple=s.removableParts().filter(p=>p.state==='tray').length>=2;
  s.restoreAll();
  const restored=multiple && pose(0) && s.tweens.length===0 && s.removableParts().every(p=>p.state==='installed' && p.group.position.distanceTo(p.group.position.clone().fromArray(p.def.pos))<1e-6);
  s.undo();
  const sealed=s.completed && s.history.length===0 && s.tweens.length===0;
  s.restart(); s.select('bolts'); s.removeSelected(); await wait(); s.installSelected(); await wait();
  const partial=!s.completed;
  for (const step of s.steps) {
    s.select(step.partId);
    if(step.action==='remove') s.removeSelected();
    else {
      const part=s.parts.get(step.partId);
      while(part.rotStep!==0) s.rotateSelected();
      s.installSelected();
    }
    await wait();
  }
  const full=s.completed && !s.assisted;
  return {sealed,partial,full,blocked,reset,settled,freeInverse,directBlocked,observe,resumed,clean,restored};
 });
 details=rapid;
 check('引导动画期间阻止连续操作和撤销',rapid.blocked);
 check('动画中重启后保持初始位置',rapid.reset);
 check('动画完成后可以撤销',rapid.settled);
 check('Free mode blocks inverse and direct install while moving',rapid.freeInverse==='tray'&&rapid.directBlocked);
 check('Leaving practice resets displayed parts; returning restores tray and shaft pose',rapid.observe&&rapid.resumed);
 check('Restart clears drag and resets bolt shafts',rapid.clean);
 check('Restore all snaps multiple tray parts to installed positions',rapid.restored);
 check('Assisted restore closes prior undo history',rapid.sealed);
 check('Free completion requires full disassembly followed by reassembly',rapid.partial && rapid.full);
 await page.reload();
 await page.waitForFunction(()=>window.__chem3d?.scene);
 const button=name=>page.getByRole('button',{name,exact:true}).first();
 await button('拆装练习').click();
 await button('自由练习').click();
 await page.evaluate(async()=>{
   const s=window.__chem3d.scene;
   s.startPractice('free'); s.select('bolts'); s.removeSelected();
 });
 const settled=()=>page.waitForFunction(()=>!window.__chem3d.scene.tweens.length);
 await settled();
 await page.evaluate(()=>window.__chem3d.scene.installSelected()); await settled();
 await page.evaluate(()=>window.__chem3d.scene.undo()); await settled();
 check('Undo install preserves removal count',await page.evaluate(()=>window.__chem3d.scene.totalRemovals===1));
 await page.evaluate(()=>window.__chem3d.scene.undo()); await settled();
 check('Undo remove reverses removal count',await page.evaluate(()=>window.__chem3d.scene.totalRemovals===0));
 await page.evaluate(()=>window.__chem3d.scene.removeSelected()); await settled();
 await button('引导学习').click(); await button('自由练习').click();
 check('Unfinished mode resumes',await page.evaluate(()=>window.__chem3d.scene.parts.get('bolts').state==='tray'));
 await page.evaluate(()=>window.__chem3d.scene.restoreAll());
 await button('返回观察').click(); await button('拆装练习').click();
 await button('引导学习').click(); await button('自由练习').click();
 check('Finished mode starts fresh',await page.evaluate(()=>{const s=window.__chem3d.scene;return !s.completed && s.pMode==='free' && !s.totalRemovals && s.parts.get('bolts').state==='installed'}));
} finally {await browser.close()}
