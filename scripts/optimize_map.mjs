import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { MeshoptEncoder } from 'meshoptimizer/encoder';
import { MeshoptSimplifier } from 'meshoptimizer/simplifier';

await Promise.all([MeshoptEncoder.ready, MeshoptSimplifier.ready]);
const manifest = JSON.parse(await readFile('public/data/manifest.json', 'utf8'));
await mkdir('public/data/tiles', { recursive: true });
let total = 0, lowTriangles = 0;
for (const tile of manifest.tiles) {
  const raw = await readFile(`.cache/tiles/${tile.id}.raw`);
  const nv = raw.readUInt32LE(0), ni = raw.readUInt32LE(4);
  const vertices = new Uint8Array(raw.buffer.slice(raw.byteOffset + 8, raw.byteOffset + 8 + nv * 20));
  const indices = new Uint32Array(raw.buffer.slice(raw.byteOffset + 8 + nv * 20, raw.byteOffset + raw.byteLength));
  const positions = new Float32Array(nv * 3);
  const dv = new DataView(vertices.buffer);
  for (let i = 0; i < nv; i++) for (let j = 0; j < 3; j++) positions[i * 3 + j] = dv.getFloat32(i * 20 + j * 4, true);
  // Bound geometric error to 0.65 m; all detail is restored near the viewer.
  const [low] = MeshoptSimplifier.simplify(indices, positions, 3, Math.floor(ni * .24 / 3) * 3, .65, ['Permissive', 'ErrorAbsolute', 'LockBorder']);
  tile.lods = [];
  for (const [level, inputIndices] of [indices, low].entries()) {
    const ix = inputIndices.slice();
    const [remap, count] = MeshoptEncoder.reorderMesh(ix, true, true);
    const vb = new Uint8Array(count * 20);
    for (let i = 0; i < nv; i++) if (remap[i] !== 0xffffffff) vb.set(vertices.subarray(i * 20, i * 20 + 20), remap[i] * 20);
    const encodedV = MeshoptEncoder.encodeVertexBuffer(vb, count, 20);
    const encodedI = MeshoptEncoder.encodeIndexBuffer(new Uint8Array(ix.buffer), ix.length, 4);
    const header = new Uint32Array([0x42525431, count, ix.length, encodedV.length, encodedI.length]);
    const file = Buffer.concat([Buffer.from(header.buffer), encodedV, encodedI]);
    await writeFile(`public/data/tiles/${tile.id}.${level}.mesh`, file);
    tile.lods.push({ vertices: count, triangles: ix.length / 3, bytes: file.length });
    total += file.length;
    if (level === 1) lowTriangles += ix.length / 3;
  }
}
manifest.compressedBytes = total;
manifest.overviewTriangles = lowTriangles;
manifest.codec = 'meshopt';
await writeFile('public/data/manifest.json', JSON.stringify(manifest));
console.log(JSON.stringify({ tiles:manifest.tiles.length, compressedMB:total / 1048576, lowTriangles }, null, 2));
