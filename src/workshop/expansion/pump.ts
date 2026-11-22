import * as THREE from 'three';
import { pumpModelPart, sealSleeveProfile } from '../../engine/pumpModel';
import { annularPrisms, convexPrism, radialSection } from '../collisionSweep';
import { boltSetX, box, cachedGeo, cylX, flangeHolesX, metal } from '../../engine/industrial';
import { mechanical, type AssemblyAsset, type Vec3 } from './contract';

const ksb = 'https://www.ksb.com/en-eg/lc/products/pump/dry-installed-pump/etanorm-etanorm-myflow-etanorm-pro/e04b';
const goulds = 'https://www.gouldspumps.com/ittgp/medialibrary/goulds/website/Products/CV-3196-i-FRAME/InstallationOperationMaintenance_iframeCV3196_en_us.pdf?ext=.pdf';
const faces = 'https://www.johncrane.com/en/resources/blog/diagnosing-the-cause-of-a-mechanical-seal-leak-full-contact-ring';

const steel = () => metal(0xbac6d0, { rough: 0.34, metal: 0.75 });
const dark = () => metal(0x45505b);
const axisY = 0.795;
const axisPoint = (x: number): Vec3 => [x, axisY, 0];
const positiveX: Vec3 = [1, 0, 0];
const up: Vec3 = [0, 1, 0];

// All profiles are teaching coordinates on one shaft line. The original
// casing, impeller, sleeve, chamber and base establish the proportions.
function ring(inner: number, outer: number, left: number, right: number, material: THREE.Material, keyed = false, couplingBolts = false) {
  const geometry = cachedGeo(`wp-ring:${inner}:${outer}:${left}:${right}:${keyed}:${couplingBolts}`, () => {
    const shape = new THREE.Shape();
    shape.absarc(0, 0, outer, 0, Math.PI * 2, false);
    const bore = new THREE.Path();
    if (keyed) {
      const halfKey = 0.01, start = Math.acos(halfKey / inner);
      bore.absarc(0, 0, inner, start, Math.PI - start, true);
      bore.lineTo(-halfKey, inner + 0.009);
      bore.lineTo(halfKey, inner + 0.009);
      bore.closePath();
    } else {
      bore.absarc(0, 0, inner, 0, Math.PI * 2, true);
    }
    shape.holes.push(bore);
    if (couplingBolts) {
      for (let i = 0; i < 4; i++) {
        const angle = i * Math.PI / 2;
        const hole = new THREE.Path();
        hole.absarc(0.135 * Math.cos(angle), 0.135 * Math.sin(angle), 0.014, 0, Math.PI * 2, true);
        shape.holes.push(hole);
      }
    }
    const geo = new THREE.ExtrudeGeometry(shape, { depth: right - left, bevelEnabled: false, curveSegments: 24 });
    return geo.rotateY(Math.PI / 2).translate(left, 0, 0);
  });
  return new THREE.Mesh(geometry, material);
}

function cover() {
  const g = new THREE.Group(), paint = metal(0x8fa6bc);
  g.add(flangeHolesX(0.58, 0.05, 0.022, 8, 0.5, paint, -0.115, 0.10));
  g.add(ring(0.092, 0.47, -0.09, 0.04, paint), ring(0.092, 0.17, 0.04, 0.085, paint));
  // Heads are marked on the cover back. The separately fastened shanks are not part of this cover body.
  for (let i = 0; i < 8; i++) {
    const angle = i * Math.PI / 4;
    g.add(cylX(0.027, 0.024, dark(), -0.078, 0.5*Math.cos(angle), 0.5*Math.sin(angle), 6));
  }
  return g;
}

function impeller() {
  const g = pumpModelPart('impeller', 0xc9973f);
  // Retain the closed shrouds, suction eye and original swept blades.
  // Replace the hub's round tube with the matching keyway.
  const originalNut = g.children.find(child => child instanceof THREE.Mesh && child.geometry instanceof THREE.CylinderGeometry && child.position.x === -0.125);
  if (originalNut) g.remove(originalNut);
  g.remove(g.children[0], g.children[1], g.children[2]);
  const bronze = metal(0xc9973f);
  g.add(ring(0.16, 0.4, -0.105, -0.085, bronze), ring(0.085, 0.4, 0.083, 0.107, bronze));
  for (const child of g.children) {
    if (!(child instanceof THREE.Mesh)) continue;
    if (child.geometry instanceof THREE.TorusGeometry) {
      child.userData.workshopBore = 0.15;
      child.userData.workshopOuterRadius = 0.18;
    }
    if (child.geometry.type === 'BufferGeometry') {
      child.userData.workshopBore = 0.12;
      child.userData.workshopOuterRadius = 0.385;
    }
  }
  g.add(cylX(0.075, 0.022, dark(), -0.131, 0, 0, 6));
  g.add(ring(0.062, 0.09, -0.12, 0.12, metal(0xc9973f), true));
  return g;
}

// The bearing shoulder is at X=0.274. Both views use these same sections.
const shaftSpans = [
  [-1.12, -0.88, 0.061], [-0.88, -0.30, 0.0645],
  [-0.30, 0.274, 0.078], [0.274, 0.73, 0.065], [0.73, 0.86, 0.05]
];
const shaftKeys = [
  { length: 0.12, height: 0.012, width: 0.018, x: -1, y: 0.062 },
  { length: 0.08, height: 0.012, width: 0.018, x: 0.8, y: 0.051 }
];
const shaftSides = 32;

function shaft() {
  const g = new THREE.Group(), m = steel(), keyMaterial = dark();
  for (const [start, end, radius] of shaftSpans) {
    g.add(cylX(radius, end - start, m, (start + end) / 2, 0, 0, shaftSides));
  }
  for (const { length, height, width, x, y } of shaftKeys) {
    g.add(box(length, height, width, keyMaterial, x, y, 0));
  }
  return g;
}

function shaftVolumes() {
  const spans = shaftSpans.map(([start, end, radius]) => convexPrism(start, end, radialSection(radius, shaftSides)));
  for (const { length, height, width, x, y } of shaftKeys) {
    const bottom = y - height / 2, top = y + height / 2, half = width / 2;
    spans.push(convexPrism(x - length / 2, x + length / 2, [
      [bottom, -half], [top, -half], [top, half], [bottom, half]
    ]));
  }
  return spans;
}

function sleeveVolumes() {
  const { outside, wall, length } = sealSleeveProfile;
  return annularPrisms(-length / 2, length / 2, outside - wall, outside, 40);
}

function bearingStand() {
  const g = pumpModelPart('bearing', 0x8498a8);
  const paint = metal(0x8498a8);
  // The workshop has one central bearing and an open approach from the pump side.
  // The far cover and the stop shoulder stay fixed.
  for (const child of [...g.children]) {
    if (child instanceof THREE.Group && Math.abs(child.position.x) < 0.16) g.remove(child);
    if (child instanceof THREE.Mesh && Math.abs(Math.abs(child.position.x) - 0.29) < 1e-6) {
      g.remove(child);
      const bore = child.position.x < 0 ? 0.141 : 0.085;
      g.add(ring(bore, 0.19, child.position.x - 0.02, child.position.x + 0.02, paint));
    }
  }
  g.add(ring(0.141, 0.17, -0.28, 0.28, paint));
  g.add(ring(0.119, 0.14, 0.026, 0.043, steel()), box(0.34, 0.01, 0.30, dark(), 0, -0.68, 0));
  return g;
}

function ballBearing() {
  const g = new THREE.Group(), m = steel();
  // A grooved lathed section leaves space for each ball around the raceway.
  const profile = (points: [number, number][]) => {
    const geo = cachedGeo('wp-race:' + points.join('|'), () =>
      new THREE.LatheGeometry(points.map(([x, r]) => new THREE.Vector2(r, x)), 56).rotateZ(-Math.PI / 2));
    g.add(new THREE.Mesh(geo, m));
  };
  const bore = 0.065 / Math.cos(Math.PI / 56);
  profile([[-0.026, bore], [-0.026, 0.091], [-0.014, 0.091], [-0.008, 0.086],
    [0, 0.084], [0.008, 0.086], [0.014, 0.091], [0.026, 0.091], [0.026, bore], [-0.026, bore]]);
  profile([[-0.026, 0.115], [-0.026, 0.14], [0.026, 0.14], [0.026, 0.115],
    [0.014, 0.115], [0.008, 0.12], [0, 0.122], [-0.008, 0.12], [-0.014, 0.115], [-0.026, 0.115]]);
  const ball = cachedGeo('wp-bearing-ball', () => new THREE.SphereGeometry(0.018, 16, 12));
  for (let i = 0; i < 9; i++) {
    const a = i * Math.PI * 2 / 9;
    const b = new THREE.Mesh(ball, m);
    b.position.set(0, Math.sin(a) * 0.103, Math.cos(a) * 0.103);
    g.add(b);
  }
  g.add(ring(0.098, 0.109, -0.02, -0.0175, metal(0x9d783a)));
  return g;
}

const sleeveClearBore = sealSleeveProfile.outside / Math.cos(Math.PI / 48);

function rotaryFace() {
  const g = new THREE.Group();
  g.add(ring(sleeveClearBore, 0.103, -0.042, -0.016, steel()), ring(sleeveClearBore, 0.106, -0.016, 0, dark()));
  return g;
}

function stationaryFace() {
  const g = new THREE.Group();
  g.add(ring(sleeveClearBore, 0.106, 0, 0.016, metal(0xe5e1d6)), ring(sleeveClearBore, 0.115, 0.016, 0.043, metal(0x55675d)));
  return g;
}

function sealChamber() {
  const g = new THREE.Group(), paint = metal(0x51876e);
  g.add(ring(0.116, 0.135, -0.12, 0.043, paint));
  g.add(ring(0.096, 0.135, 0.043, 0.055, paint));
  g.add(ring(0.095, 0.17, 0.055, 0.105, paint));
  return g;
}

function coupling() {
  const g = new THREE.Group(), paint = metal(0xc4813f);
  const shaftBore = 0.05 / Math.cos(Math.PI / 48);
  g.add(ring(shaftBore, 0.10, -0.13, -0.032, paint, true), ring(0.05, 0.10, 0.032, 0.13, paint));
  g.add(ring(shaftBore, 0.18, -0.032, 0, paint, true, true), flangeHolesX(0.18, 0.032, 0.014, 4, 0.135, paint, 0.016, 0.05));
  g.add(boltSetX(4, 0.135, 0.012, 0.092, 0, steel(), dark()));
  return g;
}

function workshopBase() {
  const base = pumpModelPart('base', 0x4d6078);
  for (const child of base.children) {
    if (child instanceof THREE.Mesh && child.geometry instanceof THREE.BoxGeometry && child.geometry.parameters.height === 0.09) {
      child.position.y = 0.015;
    }
  }
  return base;
}

const specs = {
  P039: { name: '泵壳（蜗壳）', pos: axisPoint(-1), build: () => pumpModelPart('casing', 0x5b7a9d, true),
    desc: '轴向吸入，蜗壳收集叶轮排出的液体。底脚落在公共底座，后端带孔法兰与泵盖贴合。吸排管口在本课仅供观察。',
    basis: 'Etanorm 产品页的单级蜗壳布置。蜗壳、吸排口及支脚轮廓沿用站内 casing。', url: ksb },
  P040: { name: '泵盖', pos: axisPoint(-0.605), build: cover,
    desc: '前端八孔与泵壳配对，后侧止口承托密封腔。中心孔贯通，泵轴从中穿过。',
    basis: 'Etanorm 产品剖视资料含螺栓连接泵盖版本。结合面与孔圈按站内泵壳适配。', url: ksb },
  P041: { name: '闭式叶轮', pos: axisPoint(-1), build: impeller,
    desc: '识别两片盖板之间的后弯叶片。进口眼朝向泵壳吸入口，轮毂抵住轴肩，键连接在本课中合并表示。',
    basis: 'Etanorm 产品页的闭式径向叶轮构型。叶片曲面与叶轮眼复用本站 impeller。', url: ksb },
  P042: { name: '阶梯泵轴', pos: axisPoint(0), build: shaft,
    desc: '在同一轴线上分别定位叶轮、轴套、轴承内圈和联轴器。轴颈与止挡按本课对应零件重建。',
    basis: 'CV 3196 手册零件表 122 核对泵轴与带轴套方案的功能。轴段和尺寸按本站配合建模。', url: goulds },
  P043: { name: '轴套', pos: axisPoint(-0.4), build: () => pumpModelPart('sealSleeve', 0xb9c2cc),
    desc: '套入密封段轴颈，外圆安装随轴转动的密封动环。',
    basis: 'Etanorm 产品页说明密封区域采用可更换轴保护套。几何取本站 sealSleeve。', url: ksb },
  P044: { name: '轴承座', pos: axisPoint(0.3), build: bearingStand,
    desc: '底脚贴合公共底座，座孔定位轴承外圈。两端通孔留出泵轴通路。',
    basis: 'CV 3196 手册图表 134、228、241 核对轴承座、轴承架和支脚功能。轮廓沿用本站 bearing。', url: goulds },
  P045: { name: '深沟球轴承', pos: axisPoint(0.3), build: ballBearing,
    desc: '外圈入座孔，内圈靠泵轴轴肩。可见深沟滚道、滚珠和保持架。本课演示一处径向支承。',
    basis: 'CV 3196 手册零件表 168A 核对单列径向球轴承，滚道与球组依据本站轴承示意适配。', url: goulds },
  P046: { name: '机械密封动环', pos: axisPoint(-0.4), build: rotaryFace,
    desc: '动环的驱动座与轴套配合，右侧研磨端面贴向静环。弹簧加载在本课中省略。',
    basis: 'John Crane 公开说明的旋转密封面。端面以平环建模，尺寸与本站轴套配套。', url: faces },
  P047: { name: '机械密封静环', pos: axisPoint(-0.4), build: stationaryFace,
    desc: '背部由密封座定位，左侧平面与动环接触；装好后保持静止。',
    basis: 'John Crane 公开说明的静止密封面。静环与本课密封座孔及动环端面适配。', url: faces },
  P048: { name: '密封腔座', pos: axisPoint(-0.4), build: sealChamber,
    desc: '前端对合泵盖后止口，腔内容纳动静环和轴套。静环的外缘由座孔定位。',
    basis: 'CV 3196 手册 184 核对密封腔与泵盖的位置关系。独立腔座来自本站 seal，不照搬厂商组合件。', url: goulds },
  P049: { name: '联轴器组件', pos: axisPoint(0.86), build: coupling,
    desc: '两个带孔半联轴器及连接螺栓作为一个组件。泵侧轮毂套在驱动端；电机侧在本课留空。',
    basis: 'Etanorm 产品页说明联轴器在驱动端的连接与拆卸关系。双半联轴器按本站构型重建。', url: ksb },
  P050: { name: '泵组底座', pos: [0.25, 0.05, 0] as Vec3, build: workshopBase,
    desc: '主板和底梁共用一个安装基准，按两处不同的支脚位置固定泵壳和轴承座。',
    basis: '本站 base 主板、底梁及轴系支承记录构成本课安装基准。CV 3196 手册安装章节用于核对底座作用。', url: goulds },
} as const;

type PumpCode = keyof typeof specs;
type End = [PumpCode, string, string];
interface Fit { child: End; parent: End; point: Vec3; dir: Vec3; mode: 'axial' | 'plane' | 'fixed' }
const fits: Fit[] = [
  { child: ['P039','foot','泵壳底脚'], parent: ['P050','case-pad','泵壳安装位'], point: [-1, 0.11, 0], dir: up, mode: 'fixed' },
  { child: ['P044','foot','轴承座底脚'], parent: ['P050','bearing-pad','轴承座安装位'], point: [0.3, 0.11, 0], dir: up, mode: 'fixed' },
  { child: ['P045','outer','外圈定位面'], parent: ['P044','bore','座孔止肩'], point: axisPoint(0.326), dir: [-1,0,0], mode: 'axial' },
  { child: ['P042','journal','轴承轴颈止肩'], parent: ['P045','inner','内圈端面'], point: axisPoint(0.274), dir: [-1,0,0], mode: 'axial' },
  { child: ['P043','bore','轴套内孔'], parent: ['P042','sleeve','密封段轴肩'], point: axisPoint(-0.30), dir: [-1,0,0], mode: 'axial' },
  { child: ['P046','drive','动环驱动座'], parent: ['P043','drive','轴套外圆'], point: axisPoint(-0.442), dir: positiveX, mode: 'axial' },
  { child: ['P041','hub','叶轮毂孔'], parent: ['P042','impeller','叶轮端轴肩'], point: axisPoint(-0.88), dir: [-1,0,0], mode: 'fixed' },
  { child: ['P040','front','泵盖前结合面'], parent: ['P039','cover','泵壳后结合面'], point: axisPoint(-0.745), dir: positiveX, mode: 'fixed' },
  { child: ['P048','pilot','腔座前止口'], parent: ['P040','seal','泵盖后止口'], point: axisPoint(-0.52), dir: positiveX, mode: 'fixed' },
  { child: ['P047','seat','静环定位外圆'], parent: ['P048','seat','静环座孔'], point: axisPoint(-0.357), dir: [-1,0,0], mode: 'axial' },
  { child: ['P049','hub','泵侧轮毂'], parent: ['P042','coupling','驱动端轴颈'], point: axisPoint(0.73), dir: positiveX, mode: 'fixed' },
  { child: ['P046','face','动环工作端面'], parent: ['P047','face','静环工作端面'], point: axisPoint(-0.4), dir: [-1,0,0], mode: 'plane' },
];

export const pumpLessonConnections: readonly { a: [string, string]; b: [string, string] }[] =
  fits.map(({child, parent}) => ({ a: [child[0], child[1]], b: [parent[0], parent[1]] }));

export const pumpAssets: AssemblyAsset[] = (Object.keys(specs) as PumpCode[]).map(code => {
  const model = specs[code];
  return {
    id: code, code, category: 'pump', course: 'pump', name: model.name,
    mounting: '站内单级悬臂离心泵教学构型，共用 X 轴线和底座基准。未核实厂商型号、公差及材料。',
    description: model.desc, lessonPosition: model.pos, spec: { dn: 0 },
    sources: [
      { title: model.url === faces ? 'John Crane · 动静密封面' : model.url === ksb ? 'KSB · Etanorm 产品构型' : 'Goulds · CV 3196 i-FRAME 安装运行维护手册', url: model.url, basis: model.basis },
      { title: '站内《单级离心泵精度记录》第 2–4 节', basis: '单级悬臂离心泵教学样板；比例与配合取自本站模型，不作为实物制造数据。' }
    ],
    ports: () => fits.filter(f => f.child[0] === code || f.parent[0] === code).map(f => {
      const insert = f.child[0] === code;
      const end = insert ? f.child : f.parent;
      const pos: Vec3 = [f.point[0] - model.pos[0], f.point[1] - model.pos[1], f.point[2] - model.pos[2]];
      const dir: Vec3 = insert ? [-f.dir[0], -f.dir[1], -f.dir[2]] : [...f.dir];
      return mechanical(end[1], end[2], pos, dir, 'pump-' + f.parent[0] + '-' + f.parent[1], insert ? 'insert' : 'receive', f.mode);
    }),
    build: model.build,
    collisionVolumes: code === 'P042' ? shaftVolumes : code === 'P043' ? sleeveVolumes : undefined
  };
});








