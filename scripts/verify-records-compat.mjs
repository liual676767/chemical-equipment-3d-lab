/**
 * 学习记录兼容性：旧 schema 迁移、收藏/成绩保留、手动任务与自测成绩随导出/导入恢复。
 * 运行：VERIFY_BASE=http://127.0.0.1:5173/ node scripts/verify-records-compat.mjs
 */
import { chromium } from 'playwright-core';
import { browserOptions } from './browser-options.mjs';
import fs from 'node:fs';
import path from 'node:path';
const BASE=process.env.VERIFY_BASE ?? 'http://127.0.0.1:5173/';
const OUT='outputs/verify-records'; fs.mkdirSync(OUT,{recursive:true});
const wait=(ms)=>new Promise(r=>setTimeout(r,ms));
const browser=await chromium.launch({...browserOptions,headless:true,args:['--enable-unsafe-swiftshader','--use-angle=swiftshader','--disable-gpu-sandbox','--disable-background-timer-throttling','--disable-renderer-backgrounding']});
const ctx=await browser.newContext({viewport:{width:1440,height:900},acceptDownloads:true});
const page=await ctx.newPage(); const errors=[];
page.on('pageerror',e=>errors.push(e.message)); page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
const check=(n,ok,d='')=>console.log((ok?'PASS  ':'FAIL  ')+n+(d?'  — '+d:''));
const now=Date.now();
await page.goto(BASE+'#/device/pump',{timeout:90000,waitUntil:'domcontentloaded'});
await page.waitForFunction(()=>window.__chem3d?.device?.id==='pump'); await wait(1000);
/* 旧数据（schema 1）迁移：收藏/成绩保留，旧练习进度丢弃 */
await page.evaluate((now)=>{
  localStorage.setItem('chem3d-lab:v1', JSON.stringify({schema:1,devices:{pump:{favorite:true,lastVisited:now,completions:3,best:{elapsed:100,errors:0,hints:0,assisted:false,date:now,mode:'guided'},practice:{mode:'guided',installed:[],stepIndex:1,errors:0,hints:0,assisted:false,elapsed:10,totalRemovals:0,completed:false,errorSteps:[],history:[],rotSteps:{}}}},feedback:[]}));
},now);
await page.reload({timeout:90000,waitUntil:'domcontentloaded'}); await page.waitForFunction(()=>window.__chem3d?.device?.id==='pump'); await wait(1200);
let data=await page.evaluate(()=>JSON.parse(localStorage.getItem('chem3d-lab:v1')));
check('旧 schema 迁移后收藏保留', data.devices.pump.favorite===true);
check('旧 schema 迁移后成绩保留', data.devices.pump.completions===3 && data.devices.pump.best?.elapsed===100);
check('旧 schema 无版本练习进度被丢弃', !data.devices.pump.practice);
/* 写入自测成绩 + 手动任务，导出 */
await page.evaluate((now)=>{
  const d=JSON.parse(localStorage.getItem('chem3d-lab:v1'));
  d.devices.pump.tasks={'p-find-impeller':true};
  d.devices.pump.taskVersion='2026-11-20.1';
  d.devices.pump.checks={'p-route-impeller':{done:true,attempts:2,date:now}};
  d.devices.pump.checkVersion='2026-11-20.1';
  localStorage.setItem('chem3d-lab:v1',JSON.stringify(d));
},now);
await page.reload({timeout:90000,waitUntil:'domcontentloaded'}); await page.waitForFunction(()=>window.__chem3d?.device?.id==='pump'); await wait(1200);
check('自测成绩显示为已通过', await page.locator('.task-exercise .badge-ok',{hasText:'已通过'}).count()===1);
check('收藏按钮保持选中', (await page.locator('.wb-top-actions button[title*="收藏"]').getAttribute('aria-pressed'))==='true');
// 打开学习记录并导出
await page.locator('.tool-menu-btn').click(); await wait(200);
await page.locator('.tool-menu-item',{hasText:'学习记录'}).click(); await wait(400);
const dlPromise=page.waitForEvent('download',{timeout:15000});
check('记录管理区分手动与自测', (await page.locator('.modal-body').innerText()).includes('观察任务 手动 1/5') && (await page.locator('.modal-body').innerText()).includes('自测 1/1'));
await page.locator('.modal-actions button',{hasText:'导出记录'}).click();
const dl=await dlPromise; const file=path.join(OUT,'records.json'); await dl.saveAs(file);
const exported=JSON.parse(fs.readFileSync(file,'utf8'));
check('导出文件含 app/schema 与自测成绩', exported.app==='chem3d-lab' && exported.schema===2 && exported.devices.pump.checks?.['p-route-impeller']?.done===true);
check('导出文件含手动任务与收藏/成绩', exported.devices.pump.tasks?.['p-find-impeller']===true && exported.devices.pump.favorite===true && exported.devices.pump.completions===3);
await page.locator('.modal-head button').click(); await wait(200);
/* 清空后导入，核对恢复 */
await page.evaluate(()=>localStorage.removeItem('chem3d-lab:v1'));
await page.reload({timeout:90000,waitUntil:'domcontentloaded'}); await page.waitForFunction(()=>window.__chem3d?.device?.id==='pump'); await wait(1200);
await page.locator('.tool-menu-btn').click(); await wait(200);
await page.locator('.tool-menu-item',{hasText:'学习记录'}).click(); await wait(400);
await page.locator('.records-import input[type=file]').setInputFiles(file); await wait(700);
check('导入成功提示', (await page.locator('.modal-body').innerText()).includes('导入成功'));
await page.locator('.modal-head button').click(); await wait(200);
await page.reload({timeout:90000,waitUntil:'domcontentloaded'}); await page.waitForFunction(()=>window.__chem3d?.device?.id==='pump'); await wait(1200);
data=await page.evaluate(()=>JSON.parse(localStorage.getItem('chem3d-lab:v1')));
check('导入后自测/手动/收藏/成绩恢复', data.devices.pump.checks?.['p-route-impeller']?.done===true && data.devices.pump.tasks?.['p-find-impeller']===true && data.devices.pump.favorite===true && data.devices.pump.completions===3);
check('导入后自测任务显示已通过', await page.locator('.task-exercise .badge-ok',{hasText:'已通过'}).count()===1);
check('无控制台错误', errors.length===0, errors.join(' | '));
await browser.close();
