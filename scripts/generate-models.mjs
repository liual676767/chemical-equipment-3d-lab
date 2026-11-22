import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
const root = process.cwd(), cache = path.join(root, 'outputs/content-metadata.mjs');
fs.mkdirSync(path.dirname(cache), { recursive: true });
const bundled = await build({ entryPoints: ['src/data/devices.ts'], bundle: true, platform: 'node', format: 'esm', write: false });
fs.writeFileSync(cache, bundled.outputFiles[0].text);
const { DEVICES, JOINT_LABEL, ROLE_LABEL } = await import(pathToFileURL(cache).href);
const lines = [
  '# 模型资产台账', '',
  '> 由 scripts/generate-models.mjs 从 src/data/devices.ts 生成。所有模型为程序化教学示意，不是制造图纸。所有无图纸的尺寸、壁厚、孔距与公差均为演示参数，不能据此声称达到实物 90% 精度。', '',
  '几何实现位于 src/engine/ 的 builders、pumpModel、valveModels、exchangerModel 及后续设备模块。原有零件编号、设备名称和分类保持稳定。共享几何使用 industrial.ts / processGeometry.ts。', '',
  '资产为项目原创程序化几何，无第三方模型或贴图。几何布尔运算使用 three-csg-ts 3.2.0，MIT 许可，依赖版本记录在 package-lock.json。', '',
  '## 资产总表', '',
  '| 设备 | 分类 | 内容版本 | 零件数 | 拆装序列 |', '| --- | --- | --- | --- | --- |'
];
for (const d of DEVICES) lines.push('| ' + d.name + '（' + d.id + '） | ' + d.categoryLabel + ' | ' + d.contentVersion + ' | ' + d.parts.length + ' | ' + (d.assemblyOrder.length ? d.assemblyOrder.length + ' 件 / ' + d.assemblyOrder.length * 2 + ' 步' : '未开放，观察用') + ' |');
lines.push('', '坐标采用 Y 向上。数值为模型演示坐标；固定、焊接与仅展开的结构不作为可拆件。', '');
for (const d of DEVICES) {
  lines.push('## ' + d.name + '（' + d.id + ' · ' + d.contentVersion + '）', '', d.structureNote, '',
    '| 零件 id | 名称 | 分组 | 角色 | 连接 | 位置 | 爆炸方向 / 距离 |',
    '| --- | --- | --- | --- | --- | --- | --- |');
  for (const p of d.parts) lines.push('| ' + p.id + ' | ' + p.name + ' | ' + p.group + ' | ' + ROLE_LABEL[p.role] + ' | ' + JOINT_LABEL[p.joint] + ' | ' + JSON.stringify(p.pos) + ' | ' + JSON.stringify(p.explodeDir) + ' / ' + p.explodeDist + ' |');
  lines.push('');
  if (d.assemblyOrder.length) {
    lines.push('安装顺序：' + d.assemblyOrder.join(' → ') + '。拆卸顺序相反。', '', '| 零件 | 安装前置 | 拆卸前需先拆 |', '| --- | --- | --- |');
    for (const id of d.assemblyOrder) { const p = d.parts.find(p => p.id === id); lines.push('| ' + id + ' | ' + (p.prereq ?? []).join('、') + ' | ' + (p.removeAfter ?? []).join('、') + ' |'); }
  } else lines.push('拆装流程未开放；可通过剖视、透明和结构展开观察。');
  lines.push('');
}
lines.push('## 资产检查', '', '- 保持既有零件 id、设备名称、分类和学习入口。', '- 检查实际几何开孔、内壁、空腔、接口位置和装配关系。', '- 爆炸展开不等同真实可拆卸，固定结构须说明。', '- 修改内容版本后运行内容门禁、实际几何专项、整站回归、工坊回归和生产冒烟。', '- 实物尺寸、制造公差、专业评审和真机触屏体验另行验证，不用自动化通过率替代。', '');
fs.writeFileSync('docs/models.md', lines.join('\n'));
console.log('models.md: ' + DEVICES.length + ' devices / ' + DEVICES.reduce((s, d) => s + d.parts.length, 0) + ' parts');
