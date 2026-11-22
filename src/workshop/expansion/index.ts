import { pipingAssets } from './piping';
import { pumpAssets } from './pump';
import { instrumentAssets } from './instruments';

export const assemblyAssets = [...pipingAssets, ...pumpAssets, ...instrumentAssets].sort((a, b) => a.code.localeCompare(b.code));
export const assemblyAssetById = new Map(assemblyAssets.map(asset => [asset.id, asset]));

export const courseNames = {
  flange: '法兰连接装配',
  pipework: '管路单元组装',
  pump: '离心泵结构装配',
  measurement: '仪表安装基础'
} as const;
