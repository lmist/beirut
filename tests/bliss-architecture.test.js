import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildBlissArchitecture, createBlissArchitecture, normalizeBlissFacade, planBlissFacade } from '../src/world/bliss-architecture.js';

const reviewed = { id: 1, review: { status: 'photo-reviewed', sourceIds: ['actual-building-photo'] } };
const facade = {
  id: '1-north', center: [10, -20], tangent: [1, 0], normal: [0, 1], width: 12, base: 5, top: 18,
  style: { wallColor: '#b9b0a0', window: { recess: .28 }, cornice: { depth: .24, height: .18 } },
  openings: [
    { x: -3, y: 4, width: 2, height: 2.1, kind: 'window', mullions: 1, balcony: { depth: 1.05, floorY: 3.3, rail: 'metal' } },
    { x: 3, y: .08, width: 2.6, height: 2.8, kind: 'shop', canopyDepth: .9, shutter: true },
  ],
};

test('photographic fallback keeps unknown and conflicting source walls free of opaque overlays',()=>{
  const data={buildings:[
    {...reviewed,facades:[facade]},
    {id:2,review:{status:'occluded'},facades:[{...facade,id:'2-front',center:[30,-20]}]},
    {...reviewed,id:3,facades:[{...facade,id:'3-front',center:[50,-20],style:{geometryConflict:'Source height does not match observed floors'}}]},
  ]};
  const architecture=buildBlissArchitecture(data,{preserveUnobserved:true});
  const stats=architecture.diagnostics();
  assert.equal(stats.buildings,1);assert.equal(stats.facades,1);
  assert.equal(stats.photographicFallbackFacades,2);
  architecture.group.updateMatrixWorld(true);
  const ray=new THREE.Raycaster(new THREE.Vector3(30,10,-10),new THREE.Vector3(0,0,-1));
  assert.equal(ray.intersectObject(architecture.group,true).length,0,'unobserved wall receives no flat opaque skin');
  architecture.dispose();
});

test('reviewed facade has actual holes, inset frames, projecting slabs and freestanding rail bars', () => {
  const plan = planBlissFacade(facade, reviewed);
  assert.equal(plan.stats.windows, 1);
  assert.equal(plan.stats.storefronts, 1);
  assert.equal(plan.stats.balconies, 1);
  assert.ok(plan.boxes.filter(box => box.kind === 'rail').length > 10);
  const glass = plan.boxes.find(box => box.kind === 'glass');
  assert.ok(plan.face.front - (glass.z + glass.depth / 2) > .2, 'window pane sits over 20 cm behind facade');
  const rail = plan.boxes.find(box => box.kind === 'rail');
  assert.ok(rail.z > plan.face.front + .9, 'balcony rails are a metre out from source wall');

  const architecture = buildBlissArchitecture({ buildings: [{ ...reviewed, facades: [facade] }] });
  architecture.group.updateMatrixWorld(true);
  const shell = architecture.group.children[0].children.find(mesh => mesh.name.includes('wall shell'));
  const ray = new THREE.Raycaster(new THREE.Vector3(7, 10, -10), new THREE.Vector3(0, 0, -1));
  assert.equal(ray.intersectObject(shell).length, 0, 'opening is absent from the shell triangles');
  ray.ray.origin.x = 10;
  assert.ok(ray.intersectObject(shell).length > 0, 'wall beside the opening remains solid');
  architecture.dispose();
});

test('left-handed source traces retain positions and put projections along the supplied outward normal', () => {
  const reversed = { ...facade, tangent: [-1, 0], normal: [0, 1] };
  const plan = planBlissFacade(reversed, reviewed);
  assert.equal(plan.face.xSign, -1);
  const architecture = buildBlissArchitecture({ buildings: [{ ...reviewed, facades: [reversed] }] });
  const paneMesh = architecture.group.children[0].children.find(mesh => mesh.name === 'Bliss glass');
  const transform = new THREE.Matrix4(); paneMesh.getMatrixAt(0, transform);
  const worldCenter = new THREE.Vector3().setFromMatrixPosition(transform);
  assert.ok(Math.abs(worldCenter.x - 13) < 1e-5, 'local negative x follows the input tangent');
  assert.ok(worldCenter.z > -20, 'pane stays outside the source building');
  assert.ok(transform.determinant() > 0, 'instance transforms never contain a reflection');
  architecture.dispose();
});

test('source roof notches reject crossing and overlapping openings instead of extending the building', () => {
  const polygon = [[-6, 0], [6, 0], [6, 13], [1, 13], [1, 5], [-1, 5], [-1, 13], [-6, 13]];
  const source = { ...facade, polygon, openings: [
    { x: 0, y: 7, width: 8, height: 2 }, // All four corners are inside but the roof notch crosses it.
    { x: -3, y: 7, width: 2, height: 2 },
    { x: -3, y: 7.5, width: 2, height: 2 },
    { x: 5.9, y: 2, width: 2, height: 2 },
  ] };
  const plan = planBlissFacade(source, reviewed);
  assert.equal(plan.openings.length, 1);
  assert.equal(plan.stats.rejectedOpenings, 3);
  const cornices = plan.boxes.filter(box => box.kind === 'trim' && box.y > 10);
  assert.equal(cornices.length, 2);
  assert.ok(cornices.every(box => box.width === 5), 'cornices respect both independent roof edges');
});

test('unobserved source faces get a neutral skin without invented openings or details', () => {
  const plan = planBlissFacade(facade, { id: 2, review: { status: 'unobserved' } });
  assert.equal(plan.unreviewed, true);
  assert.equal(plan.openings.length, 0);
  assert.equal(plan.boxes.length, 0);
  const architecture = buildBlissArchitecture({ buildings: [{ id: 2, facades: [facade] }] });
  const diagnostics = architecture.diagnostics();
  assert.equal(diagnostics.facades, 1);
  assert.equal(diagnostics.unreviewedFacades, 1);
  assert.equal(diagnostics.reviewedFacades, 0);
  assert.equal(diagnostics.windows, 0);
  architecture.dispose();
});

test('reviewed floor counts include ground and optional balcony and AC evidence controls their locations', () => {
  const plan = planBlissFacade({ ...facade, openings: undefined, width: 12, top: 19,
    style: { floors: 4, bays: 3, groundHeight: 4, window: { width: 1.8, height: 1.65, sill: .65 },
      balconies: { floors: [1, 2], bays: [0, 2], depth: .8, rail: 'solid' },
      storefront: { bays: [0, 1, 2] }, acUnits: [{ floor: 2, bay: 1 }] } }, reviewed);
  assert.equal(plan.stats.windows, 9);
  assert.equal(plan.stats.storefronts, 3);
  assert.equal(plan.stats.balconies, 4);
  assert.equal(plan.stats.acUnits, 1);
  assert.equal(plan.openings.find(opening => opening.floor === 1).y, 4.65);
  const noDimensions = planBlissFacade({ ...facade, openings: undefined, style: { floors: 4, bays: 3 } }, reviewed);
  assert.equal(noDimensions.openings.length, 0, 'floor and bay counts alone do not invent window dimensions');
});

test('a whole corridor shares instance pools and culled cells restore when returning', () => {
  const scene = new THREE.Scene();
  const buildings = Array.from({ length: 20 }, (_, i) => ({ ...reviewed, id: i, facades: [{ ...facade,
    center: [i * 14, -20] }] }));
  const architecture = buildBlissArchitecture({ buildings }, { scene, cellSize: 100, distance: 180 });
  const stats = architecture.diagnostics();
  assert.equal(stats.buildings, 20);
  assert.ok(stats.instances > 700);
  assert.ok(stats.meshes < 35, 'geometry parts are pooled by material and nearby cells');
  const meshes = architecture.group.children.flatMap(chunk => chunk.children);
  assert.equal(new Set(meshes.filter(mesh => mesh.isInstancedMesh).map(mesh => mesh.geometry)).size, 1);
  architecture.update({ x: 10000, y: 0, z: 10000 });
  assert.equal(architecture.diagnostics().visibleCells, 0);
  architecture.update({ x: 10, y: 7, z: -20 });
  assert.ok(architecture.diagnostics().visibleCells > 0);
  architecture.setEnabled(false);
  assert.equal(architecture.diagnostics().visibleCells, 0);
  architecture.dispose(); architecture.dispose();
  assert.equal(scene.children.length, 0);
});

test('partially photographed continuous balconies are one terrace per observed floor', () => {
  const source = { ...facade, openings: undefined, top: 19,
    style: { floors: 4, bays: 3, groundHeight: 4, floorHeight: 3.2,
      window: { width: 1.8, height: 1.65, sill: .65 },
      balconies: { floors: [1, 2], bays: [0, 1, 2], continuous: true, depth: 1, rail: 'metal' } } };
  const plan = planBlissFacade(source, { id: 1, review: { status: 'partial' } });
  assert.equal(plan.stats.balconies, 2);
  const slabs = plan.boxes.filter(box => box.kind === 'trim' && box.depth > 1);
  assert.equal(slabs.length, 2);
  assert.ok(slabs.every(slab => slab.width > 10 && slab.width < source.width));
  assert.equal(plan.openings.find(opening => opening.floor === 3).y, 11.05, 'explicit floor height preserves observed floor spacing');
});

test('glass balcony rail panels follow the actual rounded slab perimeter', () => {
  const source = { ...facade, openings: [{ x: 0, y: 4, width: 3.2, height: 2.1,
    balcony: { depth: 1.2, floorY: 3.3, rail: 'glass', shape: 'rounded' } }] };
  const plan = planBlissFacade(source, reviewed);
  assert.equal(plan.stats.glassBalconies, 1);
  assert.equal(plan.stats.shapedBalconies, 1);
  const slab = plan.profiles.find(profile => profile.kind === 'trim');
  assert.ok(slab.points.length > 12, 'rounded front corners change the slab outline');
  const glass = plan.boxes.filter(box => box.kind === 'railGlass');
  assert.ok(glass.length > 10);
  assert.ok(glass.some(panel => Math.abs(Math.sin(panel.rotationY * 2)) > .5), 'panels follow diagonal curve segments');
  const architecture = buildBlissArchitecture({ buildings: [{ ...reviewed, facades: [source] }] });
  const mesh = architecture.group.children[0].children.find(child => child.name === 'Bliss railGlass');
  assert.equal(mesh.count, glass.length);
  assert.equal(mesh.material.transparent, true);
  assert.ok(mesh.material.opacity > .2 && mesh.material.opacity < .7);
  assert.equal(architecture.diagnostics().profiles, 1);
  architecture.dispose();
});

test('observed vertical piers match bay boundaries and floor bands follow provided levels', () => {
  const source = { ...facade, openings: undefined, top: 19,
    style: { floors: 4, bays: 3, groundHeight: 4, floorHeight: 3.2,
      window: { width: 1.8, height: 1.65, sill: .65 },
      verticalPiers: { width: .24, depth: .4 }, floorBands: { floors: [1, 2], height: .2, depth: .16 } } };
  const plan = planBlissFacade(source, reviewed);
  assert.equal(plan.stats.verticalPiers, 4);
  assert.equal(plan.stats.floorBands, 2);
  const piers = plan.boxes.filter(box => box.feature === 'vertical-pier');
  assert.deepEqual(piers.map(pier => Number(pier.x.toFixed(2))), [-5.87, -2, 2, 5.87]);
  assert.ok(piers.every(pier => pier.height === 10 && pier.z - pier.depth / 2 === plan.face.front));
  const bands = plan.boxes.filter(box => box.feature === 'floor-band');
  assert.deepEqual(bands.map(band => band.y), [4, 7.2]);
  const withoutEvidence = planBlissFacade({ ...source, style: { ...source.style, verticalPiers: false, floorBands: false } }, reviewed);
  assert.equal(withoutEvidence.stats.verticalPiers, 0);
  assert.equal(withoutEvidence.stats.floorBands, 0);
});

test('arched windows change both shell cutout and glazing silhouette', () => {
  const source = { ...facade, openings: [{ x: 0, y: 4, width: 2, height: 3, arch: true }] };
  const plan = planBlissFacade(source, reviewed);
  assert.equal(plan.stats.archedWindows, 1);
  assert.equal(plan.boxes.filter(box => box.feature === 'arch-frame').length, 16);
  const architecture = buildBlissArchitecture({ buildings: [{ ...reviewed, facades: [source] }] });
  architecture.group.updateMatrixWorld(true);
  const shell = architecture.group.children[0].children.find(mesh => mesh.name.includes('wall shell'));
  const pane = architecture.group.children[0].children.find(mesh => mesh.name === 'Bliss glass profiles');
  const ray = new THREE.Raycaster(new THREE.Vector3(10, 11.85, -10), new THREE.Vector3(0, 0, -1));
  assert.equal(ray.intersectObject(shell).length, 0, 'arch center is open');
  assert.ok(ray.intersectObject(pane).length > 0, 'curved pane covers the arch center');
  ray.ray.origin.x = 10.85;
  assert.ok(ray.intersectObject(shell).length > 0, 'upper corner outside the arch remains wall');
  assert.equal(ray.intersectObject(pane).length, 0, 'glazing does not extend behind the upper corners');
  architecture.dispose();
});

test('angular balconies contain diagonal front facets instead of rectangular slabs', () => {
  const plan = planBlissFacade({ ...facade, openings: [{ x: 0, y: 4, width: 3, height: 2,
    balcony: { depth: 1, floorY: 3.3, rail: 'solid', shape: 'angular' } }] }, reviewed);
  assert.equal(plan.stats.shapedBalconies, 1);
  const slab = plan.profiles[0];
  assert.equal(slab.points.length, 7);
  assert.ok(plan.boxes.filter(box => box.kind === 'wall').some(box => Math.abs(Math.sin(box.rotationY * 2)) > .3));
});

test('asymmetric bay weights control window width, pier position and each balcony shape', () => {
  const source = { ...facade, openings: undefined, style: { floors: 2, bays: 3, groundHeight: 4, floorHeight: 3,
    bayWidthRatios: [1, 2, 1], window: { widthRatio: .6, height: 1.8, sill: .6 }, verticalPiers: true,
    balconies: { bays: [0, 1, 2], floors: [1], depth: .9, rail: 'glass', shapesByBay: { 0: 'angular', 1: 'rectangular', 2: 'rounded' } } } };
  const plan = planBlissFacade(source, reviewed);
  assert.deepEqual(plan.openings.map(opening => opening.x), [-4.5, 0, 4.5]);
  assert.deepEqual(plan.openings.map(opening => Number(opening.width.toFixed(2))), [1.8, 3.6, 1.8]);
  assert.deepEqual(plan.boxes.filter(box => box.feature === 'vertical-pier').slice(1, 3).map(box => box.x), [-3, 3]);
  assert.equal(plan.stats.balconies, 3);
  assert.equal(plan.stats.glassBalconies, 3);
  assert.equal(plan.stats.shapedBalconies, 2);
  const outlines = plan.profiles.filter(profile => profile.kind === 'trim');
  assert.equal(outlines[0].points.length, 7, 'left bay uses the angular outline');
  assert.ok(outlines[1].points.length > 12, 'right bay uses rounded corners');
  assert.ok(outlines[1].points.every(([x]) => x > 3), 'rounded slab remains within the right bay');
});

test('curtain wall glazing receives a physical panel grid with finite aggregate diagnostics', () => {
  const source = { ...facade, style: { ...facade.style, curtainWall: true },
    openings: [{ x: 0, y: 4, width: 8, height: 2.8 }] };
  const plan = planBlissFacade(source, reviewed);
  assert.equal(plan.openings.length, 1, 'panel divisions retain the source opening envelope');
  assert.equal(plan.stats.curtainPanels, 21, '8 m by 2.8 m opening receives a 7 by 3 grid');
  assert.equal(plan.boxes.filter(box => box.feature === 'curtain-transom').length, 2);
  const regular = planBlissFacade({ ...source, style: { ...source.style, curtainWall: false } }, reviewed);
  assert.equal(regular.stats.curtainPanels, 0);
  assert.ok(plan.boxes.filter(box => box.kind === 'frame').length > regular.boxes.filter(box => box.kind === 'frame').length + 7);
  const architecture = buildBlissArchitecture({ buildings: [{ ...reviewed, facades: [source] }] });
  for (const [name, value] of Object.entries(architecture.diagnostics())) if (typeof value === 'number') {
    assert.ok(Number.isFinite(value), `${name} is a finite count`);
  }
  assert.equal(architecture.diagnostics().curtainPanels, 21);
  architecture.dispose();
});

test('loader supports preloaded source data without browser APIs and preserves an early visibility setting', async () => {
  const scene = new THREE.Scene();
  const architecture = createBlissArchitecture({ scene, data: { buildings: [{ ...reviewed, facades: [facade] }] } });
  architecture.setEnabled(false);
  await architecture.ready;
  assert.equal(architecture.diagnostics().available, true);
  assert.equal(architecture.diagnostics().enabled, false);
  assert.equal(architecture.diagnostics().loading, false);
  architecture.dispose();
  assert.equal(scene.children.length, 0);
});

test('invalid source plane is diagnosed without emitting malformed geometry', () => {
  assert.throws(() => normalizeBlissFacade({ ...facade, normal: [1, 1] }), /perpendicular/);
  const architecture = buildBlissArchitecture({ buildings: [{ ...reviewed, facades: [{ ...facade, base: NaN }] }] });
  assert.equal(architecture.diagnostics().facades, 0);
  assert.equal(architecture.diagnostics().warnings.length, 1);
  architecture.dispose();
});
