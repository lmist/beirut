import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildBlissShopfronts, planBlissShopfronts } from '../src/world/bliss-shopfronts.js';

const data = JSON.parse(fs.readFileSync(new URL('../public/data/bliss-shopfronts.json', import.meta.url)));
const architecture = JSON.parse(fs.readFileSync(new URL('../public/data/bliss-architecture.json', import.meta.url)));
const buildings = new Map(architecture.buildings.map(building => [building.id, building]));

test('every sign has original photo provenance and mounts entirely on its declared CAD frontage', () => {
  const plans = planBlissShopfronts(data);
  assert.equal(plans.length, data.summary.signs);
  for (const { sign, segments } of plans) {
    assert.match(sign.sourceSha256, /^[0-9a-f]{64}$/);
    assert.equal(sign.sourceCorners.length, 4);
    assert.ok(fs.existsSync(path.resolve('public', sign.textureUrl.slice(1))));
    assert.ok(fs.existsSync(sign.sourcePath));
    assert.ok(sign.dimensionsEstimated);
    for (const segment of segments) {
      const building = buildings.get(sign.buildingId);
      const facade = (building.sourceFacades ?? building.facades).find(face => face.id === segment.faceId);
      assert.ok(facade, `${sign.id}: source CAD face exists`);
      const offset = segment.center.map((value, i) => value - facade.center[i]);
      assert.ok(Math.abs(offset[0] * facade.normal[0] + offset[1] * facade.normal[1]) < .001,
        `${sign.id}: sign is on the source plane`);
      const localX = offset[0] * facade.tangent[0] + offset[1] * facade.tangent[1];
      assert.ok(Math.abs(localX) + segment.width / 2 <= facade.width / 2 + .02,
        `${sign.id}: sign is clipped to source face extent`);
      assert.equal(segment.base, facade.base);
    }
    assert.ok(Math.abs(segments[0].uv[0]) < .002);
    assert.ok(Math.abs(segments.at(-1).uv[1] - 1) < .002);
  }
});

test('segmented source faces keep one continuous photo and sign fronts face the street', () => {
  const renderer = buildBlissShopfronts(data);
  assert.ok(renderer.stats.mountSegments > renderer.stats.signs);
  const first = renderer.plans[0].segments[0];
  renderer.update({ x: first.center[0], z: first.center[1] });
  assert.equal(renderer.group.children[0].visible, true);
  renderer.update({ x: 0, z: 0 });
  assert.equal(renderer.group.children[0].visible, false);
  const panels = [];
  renderer.group.traverse(object => { if (object.name.endsWith('/ original rectified photograph')) panels.push(object); });
  assert.equal(panels.length, renderer.stats.mountSegments);
  for (const panel of panels) {
    const mount = panel.parent;
    const segment = renderer.plans.flatMap(plan => plan.segments).find(item =>
      item.faceId === mount.userData.faceId && Math.abs(item.position[0] - mount.position.x) < .001);
    assert.ok(segment);
    assert.ok(panel.position.z > .55);
    const uv = panel.geometry.attributes.uv;
    assert.ok(uv.getX(0) <= uv.getX(1));
  }
  renderer.dispose();
});

test('invalid source or a reversed texture interval fails before rendering', () => {
  const broken = structuredClone(data);
  broken.signs[0].mounts[0].uv = [1, 0];
  assert.throws(() => planBlissShopfronts(broken), /Invalid CAD mounting/);
});
