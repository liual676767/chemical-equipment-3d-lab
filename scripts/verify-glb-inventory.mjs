import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createServer } from 'vite';

const server = await createServer({ server: { middlewareMode: true }, cacheDir: 'node_modules/.vite-glb-inventory' });
const baseline = process.env.VERIFY_BASELINE_ASSETS;
const output = 'outputs/verify-p5';
mkdirSync(output, { recursive: true });
try {
  const { UPLOAD_ASSETS } = await server.ssrLoadModule('/src/assets/registry.ts');
  const { DEVICES } = await server.ssrLoadModule('/src/data/devices.ts');
  assert.equal(UPLOAD_ASSETS.length, 13);
  const deviceIds = new Set(DEVICES.map(device => device.id));
  const report = UPLOAD_ASSETS.map(asset => {
    const relative = asset.file.replace(/^\.\//, '');
    const bytes = readFileSync(resolve('public', relative));
    assert.equal(bytes.toString('ascii', 0, 4), 'glTF', asset.id);
    assert.equal(bytes.readUInt32LE(4), 2);
    assert.equal(bytes.readUInt32LE(8), bytes.length);
    assert.equal(bytes.length, asset.bytes);
    const jsonSize = bytes.readUInt32LE(12);
    assert.equal(bytes.toString('ascii', 16, 20), 'JSON');
    assert.equal(jsonSize % 4, 0);
    const metadata = JSON.parse(bytes.toString('utf8', 20, 20 + jsonSize));
    const chunk = 20 + jsonSize;
    assert.equal(bytes.readUInt32LE(chunk + 4), 0x004e4942);
    assert.equal(chunk + 8 + bytes.readUInt32LE(chunk), bytes.length);
    assert.equal(metadata.asset.version, '2.0');
    assert.equal(metadata.meshes.length, asset.meshes);
    assert.equal(metadata.materials.length, asset.materials);
    assert.ok(asset.matches.every(deviceId => deviceIds.has(deviceId)));
    const positions = metadata.meshes.flatMap(mesh => mesh.primitives).map(primitive => metadata.accessors[primitive.attributes.POSITION]);
    assert.ok(positions.length && positions.every(position => position.type === 'VEC3' && position.count > 0));
    assert.ok(positions.every(position => [position.min, position.max].every(bound =>
      bound?.length === 3 && bound.every(Number.isFinite))));
    const identicalToBaseline = baseline ? bytes.equals(readFileSync(resolve(baseline, relative))) : null;
    if (baseline) assert.equal(identicalToBaseline, true, asset.id);
    return {
      id: asset.id, meshes: asset.meshes, materials: asset.materials, positionAccessors: positions.length,
      bytes: bytes.length, requiredExtensions: metadata.extensionsRequired, matches: asset.matches,
      identicalToBaseline, sha256: createHash('sha256').update(bytes).digest('hex')
    };
  });
  writeFileSync(output + '/glb-inventory.json', JSON.stringify(report, null, 2));
  console.log('PASS 13 GLB headers, binary lengths, finite position bounds, component metadata and device IDs');
} finally {
  await server.close();
}
