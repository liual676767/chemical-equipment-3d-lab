import * as THREE from 'three';
import type { Spec } from '../layout';
import type { PortDef } from '../types';
import {
  add, box, flange, flangeMesh, negativeX, negativeY, outsideDiameter as odU, profile, roundPlate, solid, X, Y
} from './piping-geometry';

type Material = THREE.MeshStandardMaterial;
type ValveKind = 'globe' | 'butterfly' | 'lift' | 'diaphragm' | 'plug' | 'control' | 'safety';
const metal = new THREE.MeshStandardMaterial({ color: '#a6b6c5', roughness: 0.53, metalness: 0.45 });
const handle = new THREE.MeshStandardMaterial({ color: '#236078', roughness: 0.64 });

const valveSpan: Record<Exclude<ValveKind, 'safety'>, number> = {
  globe: 3.5, butterfly: 1.65, lift: 3.25, diaphragm: 3.7, plug: 3.15, control: 3.8
};

export function valvePorts(kind: ValveKind, spec: Spec): PortDef[] {
  const d = odU(spec.dn);
  if (kind === 'safety') {
    return [
      flange(spec.dn, [0, -1.5 * d, 0], negativeY, 'p1', '底部进口', 'in'),
      flange(spec.dn, [1.55 * d, 0, 0], X, 'p2', '侧向泄放口', 'out')
    ];
  }
  const span = valveSpan[kind] * d / 2;
  const directional = kind === 'globe' || kind === 'lift' || kind === 'control';
  return [
    flange(spec.dn, [-span, 0, 0], negativeX, 'p1', directional ? '进口' : '管口 A', directional ? 'in' : 'both'),
    flange(spec.dn, [span, 0, 0], X, 'p2', directional ? '出口' : '管口 B', directional ? 'out' : 'both')
  ];
}

function nozzle(group: THREE.Group, port: PortDef, bodyEnd: number, material: Material) {
  const d = odU(port.dn);
  const end = new THREE.Vector3(...port.pos);
  const direction = new THREE.Vector3(...port.dir);
  const neck = end.clone().addScaledVector(direction, -bodyEnd);
  roundPlate(group, d * 0.55, d * 0.42, bodyEnd, neck.addScaledVector(direction, bodyEnd / 2).toArray(), port.dir, material);
  flangeMesh(group, port.dn, port.pos, port.dir, material);
}

function wheel(group: THREE.Group, y: number, radius: number) {
  const rim = add(group, new THREE.TorusGeometry(radius, radius * 0.12, 9, 32), handle, [0, y, 0]);
  rim.rotation.x = Math.PI / 2;
  box(group, [radius * 2, radius * 0.15, radius * 0.15], [0, y, 0], handle);
  box(group, [radius * 0.15, radius * 0.15, radius * 2], [0, y, 0], handle);
}

function chamber(group: THREE.Group, d: number, material: Material, width: number, height: number) {
  const body = add(group, new THREE.SphereGeometry(d, 28, 18), material, [0, 0, 0]);
  body.scale.set(width, height, 0.69);
}

export const buildValve = (kind: ValveKind) => (spec: Spec, material: Material): THREE.Group => {
  const group = new THREE.Group();
  const d = odU(spec.dn);
  const ports = valvePorts(kind, spec);
  if (kind === 'butterfly') {
    const thickness = valveSpan.butterfly * d;
    roundPlate(group, d * 0.64, d * 0.45, thickness, [0, 0, 0], X, material);
    for (const port of ports) flangeMesh(group, port.dn, port.pos, port.dir, material);
    solid(group, d * 0.43, d * 0.085, [0, 0, 0], metal, [Math.sin(0.42), 0, Math.cos(0.42)]);
    solid(group, d * 0.095, d * 1.4, [0, d * 0.42, 0], metal);
    box(group, [1.15 * d, 0.12 * d, 0.20 * d], [0.45 * d, d * 1.17, 0], handle);
    return group;
  }

  if (kind === 'safety') {
    nozzle(group, ports[0], 1.18 * d, material);
    nozzle(group, ports[1], 1.27 * d, material);
    chamber(group, d, material, 0.7, 0.62);
    solid(group, d * 0.49, d * 0.18, [0, d * 0.61, 0], metal);
    solid(group, d * 0.38, d * 1.2, [0, d * 1.26, 0], material);
    solid(group, d * 0.27, d * 0.28, [0, d * 1.99, 0], metal, Y, 6);
    box(group, [d * 0.75, d * 0.08, d * 0.13], [d * 0.21, d * 2.05, 0], handle);
    return group;
  }

  for (const port of ports) nozzle(group, port, Math.abs(port.pos[0]) - d * 0.36, material);
  if (kind === 'plug') {
    profile(group, [[0, -0.67 * d], [0.47 * d, -0.67 * d], [0.68 * d, 0.53 * d], [0.57 * d, 0.65 * d], [0, 0.65 * d]], [0, 0, 0], Y, material);
    solid(group, d * 0.37, d * 0.14, [0, d * 0.69, 0], metal, Y, 6);
    solid(group, d * 0.12, d * 0.30, [0, d * 0.86, 0], metal, Y, 4);
    box(group, [d * 1.14, d * 0.13, d * 0.14], [d * 0.49, d, 0], handle);
    return group;
  }

  if (kind === 'diaphragm') {
    chamber(group, d, material, 1.1, 0.45);
    solid(group, d * 0.69, d * 0.11, [0, d * 0.39, 0], handle);
    profile(group, [[0, 0.45 * d], [0.67 * d, 0.45 * d], [0.56 * d, 0.66 * d], [0.29 * d, d], [0, d]], [0, 0, 0], Y, material);
    solid(group, d * 0.08, d * 0.33, [0, d * 1.08, 0], metal);
    wheel(group, d * 1.25, d * 0.46);
    return group;
  }

  chamber(group, d, material, 0.9, kind === 'lift' ? 0.63 : 0.72);
  solid(group, d * 0.49, d * 0.17, [0, d * 0.58, 0], metal);
  if (kind === 'lift') {
    profile(group, [[0, 0.66 * d], [0.48 * d, 0.66 * d], [0.28 * d, d], [0, d]], [0, 0, 0], Y, material);
    return group;
  }

  solid(group, d * 0.10, d * 0.88, [0, d * 1.07, 0], metal);
  for (const side of [-1, 1]) box(group, [d * 0.14, d * 0.62, d * 0.18], [side * d * 0.30, d, 0], material);
  if (kind === 'globe') {
    wheel(group, d * 1.52, d * 0.55);
  } else {
    profile(group, [[0, 1.25 * d], [0.37 * d, 1.25 * d], [0.82 * d, 1.47 * d], [0.84 * d, 1.57 * d], [0.73 * d, 1.82 * d], [0.35 * d, 1.97 * d], [0, 1.97 * d]], [0, 0, 0], Y, handle);
    solid(group, d * 0.85, d * 0.11, [0, d * 1.55, 0], metal);
    box(group, [d * 0.37, d * 0.46, d * 0.30], [d * 0.68, d * 1.14, 0], handle);
  }
  return group;
};
