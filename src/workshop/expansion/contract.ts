import type { Group, MeshStandardMaterial } from 'three';
import type { Spec } from '../layout';
import type { ConvexVolume } from '../collisionSweep';
import type { CatalogPart, PortDef } from '../types';

export type Vec3 = [number, number, number];

export interface SourceReference {
  title: string;
  url?: string;
  basis: string;
}

export interface AssemblyAsset {
  code: `P${number}`;
  id: string;
  name: string;
  category: CatalogPart['category'];
  description: string;
  sources: readonly SourceReference[];
  course: 'flange' | 'pipework' | 'pump' | 'measurement';
  spec: Spec;
  ports?: (spec: Spec) => PortDef[];
  build?: (spec: Spec, material: MeshStandardMaterial) => Group;
  collisionVolumes?: (spec: Spec) => ConvexVolume[];
  /** Explicit passage topology. Do not include mechanical or signal ports. */
  passages?: readonly (readonly [string, string])[];
  signal?: string;
  mounting?: string;
  /** An explicit local reference used by the original part in an assembled lesson. */
  lessonPosition?: Vec3;
}

export function mechanical(
  id: string, label: string, pos: Vec3, dir: Vec3, family: string,
  gender: 'insert' | 'receive', mode: 'axial' | 'plane' | 'fixed' = 'axial',
): PortDef {
  return { id, label, pos, dir, dn: 0, type: 'mechanical', mate: { family, gender, mode } };
}
