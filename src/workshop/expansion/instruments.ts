import * as THREE from 'three';
import type { Spec } from '../layout';
import { MM } from '../types';
import type { PortDef } from '../types';
import { dnSpec, flangeSpec, idOf } from '../specs';
import { mechanical } from './contract';
import type { AssemblyAsset, Vec3 } from './contract';

const x: Vec3 = [1, 0, 0];
const y: Vec3 = [0, 1, 0];
const z: Vec3 = [0, 0, 1];
const down: Vec3 = [0, -1, 0];
const origin: Vec3 = [0, 0, 0];
const vectorY = new THREE.Vector3(...y);

function odU(dn: number): number {
  return dnSpec(dn).od * MM;
}

function flangeDims(dn: number) {
  const spec = flangeSpec(dn);
  return { t: spec.t * MM, r: spec.d * MM / 2, k: spec.k * MM / 2, n: spec.n, hole: spec.hole * MM / 2 };
}

function finish(color: string, metalness = 0.35, extra: THREE.MeshStandardMaterialParameters = {}) {
  return new THREE.MeshStandardMaterial({ color, metalness, roughness: 0.38, ...extra });
}

function place(group: THREE.Group, geometry: THREE.BufferGeometry, mat: THREE.Material, at: Vec3, name: string) {
  const mesh = new THREE.Mesh(geometry, mat);
  mesh.name = name;
  mesh.position.set(...at);
  mesh.castShadow = mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
}

function cylinder(group: THREE.Group, name: string, mat: THREE.Material, center: Vec3,
  axis: Vec3, radius: number, length: number, options: { tip?: number; sides?: number; open?: boolean } = {}) {
  const mesh = place(group, new THREE.CylinderGeometry(options.tip ?? radius, radius, length,
    options.sides ?? 28, 1, options.open ?? false), mat, center, name);
  mesh.quaternion.setFromUnitVectors(vectorY, new THREE.Vector3(...axis));
  return mesh;
}

function box(group: THREE.Group, name: string, mat: THREE.Material, center: Vec3, size: Vec3) {
  return place(group, new THREE.BoxGeometry(...size), mat, center, name);
}

/* Shape holes are actual openings, so inspection from either end reveals the bore. */
function annulus(group: THREE.Group, name: string, mat: THREE.Material, center: Vec3,
  axis: Vec3, radius: number, bore: number, thickness: number, holes?: { k: number; n: number; hole: number }) {
  const contour = new THREE.Shape().absarc(0, 0, radius, 0, Math.PI * 2);
  contour.holes.push(new THREE.Path().absarc(0, 0, bore, 0, Math.PI * 2, true));
  if (holes) {
    for (let index = 0; index < holes.n; index++) {
      const angle = index * Math.PI * 2 / holes.n;
      contour.holes.push(new THREE.Path().absarc(
        Math.cos(angle) * holes.k, Math.sin(angle) * holes.k, holes.hole, 0, Math.PI * 2, true));
    }
  }
  const geometry = new THREE.ExtrudeGeometry(contour, { depth: thickness, bevelEnabled: false, curveSegments: 16 });
  geometry.translate(0, 0, -thickness / 2);
  const mesh = place(group, geometry, mat, center, name);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(...z), new THREE.Vector3(...axis));
  return mesh;
}

function flange(group: THREE.Group, mat: THREE.Material, dn: number, face: Vec3, dir: Vec3) {
  const dims = flangeDims(dn);
  const center = new THREE.Vector3(...face).addScaledVector(new THREE.Vector3(...dir), -dims.t / 2).toArray();
  annulus(group, '法兰密封面及螺栓孔', mat, center, dir, dims.r, idOf(dn) / 200, dims.t, dims);
}

function flanged(spec: Spec, id: string, label: string, pos: Vec3, dir: Vec3, flow: PortDef['flow']): PortDef {
  return { id, label, pos, dir, flow, dn: spec.dn, type: 'flange', standard: 'PN16', boltCount: flangeDims(spec.dn).n };
}

function processPort(spec: Spec, pos: Vec3 = origin, dir: Vec3 = down, label = '过程螺纹口'): PortDef {
  return { id: 'process', label, pos, dir, dn: spec.dn, type: 'thread',
    standard: 'G', threadSex: 'external', flow: 'both', blind: true };
}

function stem(group: THREE.Group, mat: THREE.Material, dn: number, open = true) {
  const radius = odU(dn) / 2;
  if (open) annulus(group, '压力引入口及过程外螺纹', mat, [0, 0.08, 0], y, radius, 0.032, 0.16);
  else cylinder(group, '过程安装外螺纹', mat, [0, 0.08, 0], y, radius, 0.16);
  for (let index = 0; index < 4; index++) {
    annulus(group, '螺纹轮廓（示意）', mat, [0, 0.025 + index * 0.035, 0], y, radius + 0.007, radius - 0.007, 0.012);
  }
  cylinder(group, '六角扳手位', mat, [0, 0.21, 0], y, radius * 1.38, 0.1, { sides: 6 });
}

function gauge(spec: Spec, mat: THREE.MeshStandardMaterial) {
  const group = new THREE.Group();
  const ink = finish('#263747', 0.05);
  stem(group, mat, spec.dn);
  cylinder(group, '下接头', mat, [0, 0.31, 0], y, 0.085, 0.12);
  cylinder(group, '弹簧管表壳', mat, [0, 0.79, 0], z, 0.46, 0.22);
  cylinder(group, '无读数示意盘', finish('#edf5ec', 0.05), [0, 0.79, 0.114], z, 0.397, 0.014);
  annulus(group, '表圈', mat, [0, 0.79, 0.13], z, 0.463, 0.402, 0.035);
  for (let index = 0; index < 25; index++) {
    const angle = -Math.PI * 0.25 + index * Math.PI / 16;
    const mark = box(group, '示意刻线', ink,
      [Math.cos(angle) * 0.35, 0.79 + Math.sin(angle) * 0.35, 0.127], [index % 4 ? 0.023 : 0.043, 0.007, 0.005]);
    mark.rotation.z = angle;
  }
  cylinder(group, '指针轴（未接入）', ink, [0, 0.79, 0.129], z, 0.032, 0.02);
  return group;
}

function transmitter(spec: Spec, mat: THREE.MeshStandardMaterial) {
  const group = new THREE.Group();
  const polymer = finish('#252e3b', 0.05);
  stem(group, mat, spec.dn);
  cylinder(group, '紧凑型传感器壳', mat, [0, 0.48, 0], y, 0.18, 0.48);
  cylinder(group, '传感器壳上盖', mat, [0, 0.74, 0], y, 0.19, 0.052);
  box(group, '角形电插头', polymer, [0, 0.88, 0], [0.32, 0.24, 0.32]);
  cylinder(group, '电缆入口', polymer, [0, 0.88, 0.195], z, 0.084, 0.085, { sides: 6 });
  annulus(group, '接线端面', mat, [0, 0.88, 0.246], z, 0.065, 0.04, 0.018);
  return group;
}

const wellTop = 0.31;
function thermowell(spec: Spec, mat: THREE.MeshStandardMaterial) {
  const group = new THREE.Group();
  const bore = 0.048;
  const neckRadius = odU(spec.dn) / 2;
  annulus(group, '内孔及仪表侧承口', mat, [0, 0.21, 0], y, neckRadius * 1.32, bore, 0.2);
  annulus(group, '过程螺纹段', mat, [0, 0.05, 0], y, neckRadius, bore, 0.12);
  for (let index = 0; index < 4; index++) {
    annulus(group, '螺纹轮廓（示意）', mat, [0, index * 0.032, 0], y, neckRadius + 0.008, neckRadius - 0.007, 0.011);
  }
  cylinder(group, '封底式锥形套管外壁', mat, [0, -0.45, 0], down, neckRadius * 0.83, 0.9,
    { tip: 0.063, open: true });
  cylinder(group, '干侧内孔', finish('#647582', 0.45, { side: THREE.BackSide }), [0, -0.44, 0], down, bore, 0.88, { open: true });
  cylinder(group, '封闭底部', mat, [0, -0.895, 0], y, 0.0635, 0.035);
  return group;
}

function probe(kind: 'RTD' | 'TC', mat: THREE.MeshStandardMaterial) {
  const group = new THREE.Group();
  const resistance = kind === 'RTD';
  const head = finish(resistance ? '#2a647c' : '#8a5531');
  cylinder(group, resistance ? '电阻测温探杆' : '矿物绝缘热电偶护套', mat, [0, -0.56, 0], y, resistance ? 0.038 : 0.029, 1.12);
  cylinder(group, resistance ? '铂电阻元件位置' : '焊合热电结位置', finish(resistance ? '#b6c9d3' : '#a96e37'),
    [0, -1.09, 0], y, resistance ? 0.039 : 0.030, 0.07);
  cylinder(group, '套管配合座', mat, [0, 0.046, 0], y, 0.092, 0.092, { sides: 6 });
  cylinder(group, '接线盒延长颈', mat, [0, 0.19, 0], y, 0.061, 0.21);
  if (resistance) {
    cylinder(group, '球顶式接线盒', head, [0, 0.41, 0], y, 0.20, 0.24);
    cylinder(group, '接线盒盖', mat, [0, 0.54, 0], y, 0.209, 0.062);
  } else {
    box(group, '方形接线盒（教学选型）', head, [0, 0.425, 0], [0.34, 0.25, 0.31]);
    box(group, '接线盒盖', mat, [0, 0.57, 0], [0.35, 0.05, 0.32]);
  }
  cylinder(group, '电缆密封接头', mat, [0.213, 0.42, 0], x, 0.061, 0.12, { sides: 6 });
  return group;
}

function magPorts(spec: Spec) {
  return [flanged(spec, 'in', '流向上游', [-1.32, 0, 0], [-1, 0, 0], 'in'),
    flanged(spec, 'out', '流向下游', [1.32, 0, 0], x, 'out')];
}
function magflow(spec: Spec, mat: THREE.MeshStandardMaterial) {
  const group = new THREE.Group();
  const bore = idOf(spec.dn) / 200;
  const liner = finish('#364757', 0.05);
  const casing = finish('#245f78');
  annulus(group, '测量管及可见衬里', liner, origin, x, bore + 0.036, bore, 2.64);
  annulus(group, '励磁线圈壳体', casing, origin, x, 0.52, bore + 0.035, 1.64);
  for (const side of [-1, 1]) {
    cylinder(group, '测量电极圆面（教学位置）', mat, [0, 0, side * bore], z, 0.033, 0.012);
  }
  box(group, '变送器颈座', mat, [0, 0.59, 0], [0.3, 0.23, 0.29]);
  box(group, '一体式变送器壳体', casing, [0, 0.87, 0], [0.76, 0.4, 0.43]);
  box(group, '未接入的显示窗', finish('#273b46', 0.02), [0, 0.865, 0.224], [0.51, 0.24, 0.021]);
  cylinder(group, '侧向电缆入口', mat, [0.406, 0.84, 0], x, 0.068, 0.085, { sides: 6 });
  for (const port of magPorts(spec)) flange(group, mat, spec.dn, port.pos, port.dir);
  return group;
}

function rotaPorts(spec: Spec) {
  return [flanged(spec, 'in', '下方入口', [0, -1.43, 0], down, 'in'),
    flanged(spec, 'out', '上方出口', [0, 1.43, 0], y, 'out')];
}
function rotameter(spec: Spec, mat: THREE.MeshStandardMaterial) {
  const group = new THREE.Group();
  const bore = idOf(spec.dn) / 200;
  const glass = finish('#83cbd1', 0.03, { transparent: true, opacity: 0.33, depthWrite: false, side: THREE.DoubleSide });
  cylinder(group, '透明锥管（上宽下窄）', glass, origin, y, 0.325, 2.18, { tip: 0.455, open: true });
  cylinder(group, '浮子（静态示意）', finish('#bf9a57'), [0, -0.27, 0], y, 0.17, 0.26, { tip: 0.088 });
  for (const side of [-1, 1]) {
    annulus(group, '端头接管', mat, [0, side * 1.2, 0], y, 0.458, bore, 0.27);
    box(group, '锥管保护柱', mat, [side * 0.49, 0, -0.14], [0.09, 2.44, 0.11]);
  }
  const scale = finish('#e0e9e9', 0.08);
  const ink = finish('#2b3e4d', 0.02);
  box(group, '无数值示意标尺', scale, [0.52, 0, 0.4], [0.14, 1.65, 0.027]);
  for (let index = 0; index < 17; index++) {
    box(group, '标尺刻线', ink, [0.51, (index - 8) * 0.09, 0.421], [index % 4 ? 0.05 : 0.09, 0.012, 0.008]);
  }
  for (const port of rotaPorts(spec)) flange(group, mat, spec.dn, port.pos, port.dir);
  return group;
}

function levelPorts(spec: Spec) {
  return [flanged(spec, 'lower', '下接液相', [-0.94, -1.07, 0], [-1, 0, 0], 'both'),
    flanged(spec, 'upper', '上接气相', [-0.94, 1.07, 0], [-1, 0, 0], 'both')];
}
function sightGlass(spec: Spec, mat: THREE.MeshStandardMaterial) {
  const group = new THREE.Group();
  const rim = finish('#364450');
  const glass = finish('#71aeb2', 0.1, { roughness: 0.2 });
  box(group, '液位腔背板', mat, [0, 0, -0.18], [0.58, 2.44, 0.19]);
  box(group, '反射视镜（静态）', glass, [0, 0, 0.044], [0.26, 1.93, 0.095]);
  for (const side of [-1, 1]) {
    box(group, '视镜压盖边框', rim, [side * 0.238, 0, 0.09], [0.18, 2.44, 0.18]);
    box(group, '视镜压盖端梁', rim, [0, side * 1.107, 0.09], [0.36, 0.223, 0.18]);
    annulus(group, '上下过程连通管', mat, [-0.507, side * 1.07, 0], x, odU(spec.dn) / 2,
      idOf(spec.dn) / 200, 0.733);
    for (let index = -3; index <= 3; index++) {
      cylinder(group, '压盖螺栓', mat, [side * 0.25, index * 0.32, 0.19], z, 0.049, 0.047, { sides: 6 });
    }
  }
  for (const port of levelPorts(spec)) flange(group, mat, spec.dn, port.pos, port.dir);
  return group;
}

function floatSwitch(spec: Spec, mat: THREE.MeshStandardMaterial) {
  const group = new THREE.Group();
  stem(group, mat, spec.dn, false);
  cylinder(group, '下伸导杆', mat, [0, -0.54, 0], y, 0.047, 1.1);
  cylinder(group, '止动环', mat, [0, -1.08, 0], y, 0.082, 0.063);
  annulus(group, '环形磁浮子', mat, [0, -0.72, 0], y, 0.213, 0.061, 0.27);
  annulus(group, '浮子上沿', mat, [0, -0.568, 0], y, 0.181, 0.061, 0.034);
  annulus(group, '浮子下沿', mat, [0, -0.872, 0], y, 0.181, 0.061, 0.034);
  cylinder(group, '开关引线接头', finish('#293840'), [0, 0.33, 0], y, 0.105, 0.14);
  const path = new THREE.CubicBezierCurve3(new THREE.Vector3(0, 0.4, 0), new THREE.Vector3(0, 0.65, 0),
    new THREE.Vector3(0.15, 0.85, 0), new THREE.Vector3(0.34, 0.91, 0));
  place(group, new THREE.TubeGeometry(path, 16, 0.026, 8, false), finish('#263546', 0.02), origin, '开关量引线');
  return group;
}

const halfPlate = 0.029;
function orificePorts(spec: Spec) {
  return [flanged(spec, 'in', '上游夹合面', [-halfPlate, 0, 0], [-1, 0, 0], 'in'),
    flanged(spec, 'out', '下游夹合面', [halfPlate, 0, 0], x, 'out')];
}
function orifice(spec: Spec, mat: THREE.MeshStandardMaterial) {
  const group = new THREE.Group();
  const dims = flangeDims(spec.dn);
  const radius = dims.k - dims.hole - 0.018;
  const bore = idOf(spec.dn) / 200;
  const plate = new THREE.Shape();
  // Handled plate with a central orifice. Handle emerges between adjacent bolt positions.
  const angle = Math.PI / 4;
  const shoulder = 0.15;
  plate.absarc(0, 0, radius, angle + shoulder, angle - shoulder + Math.PI * 2);
  plate.lineTo(Math.cos(angle - 0.08) * (dims.r + 0.37), Math.sin(angle - 0.08) * (dims.r + 0.37));
  plate.lineTo(Math.cos(angle + 0.08) * (dims.r + 0.37), Math.sin(angle + 0.08) * (dims.r + 0.37));
  plate.closePath();
  plate.holes.push(new THREE.Path().absarc(0, 0, bore * 0.55, 0, Math.PI * 2, true));
  const geo = new THREE.ExtrudeGeometry(plate, { depth: halfPlate * 2, bevelEnabled: false, curveSegments: 22 });
  geo.translate(0, 0, -halfPlate);
  geo.rotateY(Math.PI / 2);
  place(group, geo, mat, origin, '带柄同心孔板及实际中心孔');
  return group;
}

const measurement = { category: 'instr', course: 'measurement' } as const;
const passage = [['in', 'out']] as const;
const noSignal = '就地观察，无电信号接口，未接入测量';
const temperaturePort = () => [mechanical('well', '套管配合面', origin, down, 'temperature-probe', 'insert')];
export const instrumentAssets: AssemblyAsset[] = [
  {
    ...measurement, code: 'P051', id: 'instr-pressure', name: '就地压力表', spec: { dn: 15 }, ports: spec => [processPort(spec)],
    description: '弹簧管随压力变形，传动机构带动指针转动。表盘用于识别外形和下部取压接头。',
    sources: [{ title: 'WIKA 232.50 型弹簧管压力表资料', url: 'https://www.wika.com/media/Data-sheets/Pressure/Pressure-gauges/ds_23x.50_en_us.pdf', basis: '圆表壳、弹簧管原理和下接式构型' }],
    mounting: '采用下接式构型，过程口朝下、表盘面朝向可读方向。教学螺纹仅用于工坊配对。', signal: noSignal, build: gauge,
  },
  {
    ...measurement, code: 'P052', id: 'instr-pressure-transmitter', name: '压力变送器', spec: { dn: 15 }, ports: spec => [processPort(spec)],
    description: '紧凑壳体包含压力敏感元件和信号调理。单个过程口接入取压点，电信号从上端插头引出。',
    sources: [{ title: 'WIKA A-10 型压力变送器', url: 'https://www.wika.com/en-us/a_10.WIKA', basis: '单过程口、圆柱传感器与可选角形插头' }],
    mounting: '用六角扳手位旋合取压座，保留上部插头和电缆空间。', signal: '角形电插头，可选电流或电压输出，未接入测量。', build: transmitter,
  },
  {
    ...measurement, code: 'P053', id: 'instr-thermowell', name: '温度计保护套管', spec: { dn: 15 },
    ports: spec => [processPort(spec, [0, 0.11, 0], down, '过程侧螺纹安装面'),
      mechanical('probe', '干侧探头插装口', [0, wellTop, 0], y, 'temperature-probe', 'receive')],
    description: '套管干侧有轴向盲孔，末端封闭以隔开介质和可拔出的测温探头。',
    sources: [{ title: 'WIKA TW15 型锥形螺纹保护套管资料', url: 'https://www.wika.com/media/Data-sheets/Temperature/Thermowells/ds_tw9515_en_co.pdf', basis: '过程侧螺纹、干侧插装和封闭探入尖端' }],
    mounting: '尖端伸入过程，过程螺纹肩对接取样座，干侧可装热电阻或热电偶。', signal: '无信号，套管用于介质隔离。', build: thermowell,
  },
  {
    ...measurement, code: 'P054', id: 'instr-temp', name: '热电阻测温组件', spec: { dn: 15 }, ports: temperaturePort,
    description: '铂电阻的电阻值随温度变化。模型采用圆形接线盒和头部引线，探杆端示意铂电阻位置。',
    sources: [{ title: 'WIKA TR10-B 型热电阻', url: 'https://www.wika.com/en-us/tr10_b.WIKA', basis: '可与独立保护套管配合的接线盒及测温芯' }],
    mounting: '对准干侧承口轴向插入保护套管，并留出拔出探头的空间。', signal: '接线盒引出电阻回路，未接入测量。', build: (_spec, mat) => probe('RTD', mat),
  },
  {
    ...measurement, code: 'P055', id: 'instr-magflow', name: '电磁流量计', spec: { dn: 50 }, ports: magPorts, passages: passage,
    description: '导电液体流经磁场时，在测量电极间产生感应电压。可从法兰端观察衬里和电极。',
    sources: [{ title: 'Endress+Hauser Proline Promag W 400', url: 'https://www.endress.com/en/field-instruments-overview/flow-measurement-product-overview/electromagnetic-flowmeter-promag-w400-5w4c', basis: '有内衬和测量电极的法兰传感器及一体式变送器安装' }],
    mounting: '水平示例采用满管安装，测量电极位于管道两侧，按流向接入。实际直管段和接地要求查对应安装手册。',
    signal: '信号经变送器和侧向电缆入口引出，未接入测量。', build: magflow,
  },
  {
    ...measurement, code: 'P056', id: 'instr-rotameter', name: '转子流量计', spec: { dn: 50 }, ports: rotaPorts, passages: passage,
    description: '流体自下而上托起浮子，升高时环隙增大。透明锥管显示浮子和环隙，示意标尺无数值。',
    sources: [{ title: 'ABB VA Master FGM1190 玻璃管浮子流量计资料', url: 'https://library.e.abb.com/public/32a03bbc802c477393bbfaf4a4e777fc/DS_FGM1190_EN_H.pdf', basis: 'FGM1190-98 的透明锥管、浮子、上下直列及可选 PN16 法兰构型' }],
    mounting: '这个直列教学构型竖装，下口进、上口出。', signal: noSignal, build: rotameter,
  },
  {
    ...measurement, code: 'P057', id: 'instr-level', name: '液位计视镜组件', spec: { dn: 25 }, ports: levelPorts,
    description: '通过侧装液位腔的视镜观察容器液位，压盖和螺栓夹持视镜。',
    sources: [{ title: 'KLINGER KRP25 反射式液位计', url: 'https://www.klinger-international.com/en/news/krp25-reflex-level-gauge-boiler-applications/', basis: '反射视镜及外置液位观察构型' }],
    mounting: '保持视镜竖直，下口接容器液相、上口接气相，保留视镜侧及压盖检修空间。', signal: noSignal, build: sightGlass,
  },
  {
    ...measurement, code: 'P058', id: 'instr-float-switch', name: '浮球液位开关', spec: { dn: 15 },
    ports: spec => [processPort(spec, [0, 0.16, 0], down, '顶部过程螺纹安装面')],
    description: '环形磁浮子随液位沿导杆移动，在设定位置触发导杆内的开关。底部止动环限制浮子脱出。',
    sources: [{ title: 'WIKA RLS-1000 浮球开关数据表', url: 'https://www.wika.com/media/Data-sheets/Level/Float-switches/ds_lm5003_en_co.pdf', basis: '导杆、磁浮子、螺纹安装和开关触点' }],
    mounting: '采用罐顶竖装构型，导杆和浮子在容器内，安装前检查浮子通过空间和行程。', signal: '引线输出开关量，未接入测量。', build: floatSwitch,
  },
  {
    ...measurement, code: 'P059', id: 'instr-thermocouple', name: '热电偶测温组件', spec: { dn: 15 }, ports: temperaturePort,
    description: '两种不同导体形成测量结，测量端与参考端的温差产生热电势。模型采用细矿物绝缘探杆和方形接线盒示意。',
    sources: [{ title: 'WIKA TC10-B 型热电偶', url: 'https://www.wika.com/en-en/tc10_b.WIKA', basis: '独立保护套管可配的矿物绝缘测温芯；方形接线盒为教学选型' }],
    mounting: '探杆对准干侧接口插入保护套管，接线盒引出热电偶回路。', signal: '热电偶回路需要参考端补偿，未接入测量。', build: (_spec, mat) => probe('TC', mat),
  },
  {
    ...measurement, code: 'P060', id: 'instr-orifice', name: '节流孔板', spec: { dn: 50 }, ports: orificePorts, passages: passage,
    description: '带柄同心孔板在管道内形成节流，压差由管路取压点和独立差压仪表测量。',
    sources: [{ title: 'Emerson Rosemount 1495 带柄孔板二维图', url: 'https://www.emerson.com/is/content/emerson/en/measurement-instrumentation/engineering/products/unaudited/documents/dl-rmt-1495-73838.pdf', basis: '有手柄的同心圆孔板轮廓和两侧夹合形式' }],
    mounting: '夹在同径法兰之间，中心孔与管孔同轴。需要测压时应另设上下游取压点。', signal: '孔板无电信号，未接入测量。', build: orifice,
  },
];




