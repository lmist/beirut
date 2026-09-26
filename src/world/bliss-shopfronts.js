import * as THREE from 'three';

const DEFAULT_URL = '/data/bliss-shopfronts.json';
const FRONT = .56;
const finite = value => typeof value === 'number' && Number.isFinite(value);

/** Exact mounting planes come from the source CAD walls. Dimensions and ground
 * offsets are recorded photographic estimates, never surveyed shop interiors. */
export function planBlissShopfronts(data) {
  const plans = [];
  for (const sign of data.signs ?? []) {
    if (!sign.sourceId || !sign.textureUrl || !Array.isArray(sign.sourceCorners) || sign.sourceCorners.length !== 4 ||
      !finite(sign.baseOffset) || !finite(sign.height) || sign.height <= 0 || !finite(sign.depth) || sign.depth < 0) {
      throw new Error(`Invalid photographic sign: ${sign.id ?? '?'}`);
    }
    const segments = [];
    for (const mount of sign.mounts ?? []) {
      if (!mount.center?.every(finite) || mount.center.length !== 2 || !mount.normal?.every(finite) || mount.normal.length !== 2 ||
        !finite(mount.base) || !finite(mount.width) || mount.width <= 0 || !mount.uv?.every(finite) || mount.uv.length !== 2 ||
        mount.uv[0] < 0 || mount.uv[1] > 1 || mount.uv[1] <= mount.uv[0]) {
        throw new Error(`Invalid CAD mounting plane for sign ${sign.id}`);
      }
      const length = Math.hypot(...mount.normal);
      if (length < .99 || length > 1.01) throw new Error(`Invalid sign normal ${sign.id}`);
      const normal = mount.normal.map(value => value / length);
      segments.push({ ...mount, normal, yaw: Math.atan2(normal[0], normal[1]),
        position: [mount.center[0], mount.base, mount.center[1]],
        signBottom: sign.baseOffset, signTop: sign.baseOffset + sign.height,
        front: FRONT + sign.depth });
    }
    if (!segments.length) throw new Error(`Sign has no mounting planes: ${sign.id}`);
    plans.push({ sign, segments });
  }
  return plans;
}

export function buildBlissShopfronts(data, { scene, photographs = new Map(), distance = 350 } = {}) {
  const group = new THREE.Group();
  group.name = 'Bliss Street photographed shopfronts';
  const plans = planBlissShopfronts(data), geometries = [], materials = [], shops = [];
  const material = parameters => {
    const value = new THREE.MeshStandardMaterial({ roughness: .86, metalness: .02, ...parameters });
    materials.push(value); return value;
  };
  const supportMaterial = material({ color: '#423e39' });
  const glassMaterial = material({ color: '#23302d', roughness: .34, metalness: .2 });
  const box = (parent, width, height, depth, x, y, z, mat, name) => {
    const geometry = new THREE.BoxGeometry(width, height, depth); geometries.push(geometry);
    const mesh = new THREE.Mesh(geometry, mat);
    mesh.name = name; mesh.position.set(x, y, z); mesh.castShadow = true; mesh.receiveShadow = true;
    parent.add(mesh); return mesh;
  };
  for (const { sign, segments } of plans) {
    const shop = new THREE.Group(); shop.name = sign.name;
    shop.userData = { buildingId: sign.buildingId, sourceId: sign.sourceId,
      sourceCorners: sign.sourceCorners, dimensionsEstimated: true, signId: sign.id };
    const map = photographs.get(sign.textureUrl);
    const fasciaMaterial = material({ color: '#ffffff', map: map ?? null,
      emissive: '#ffffff', emissiveMap: map ?? null, emissiveIntensity: map ? .18 : 0,
      transparent: Boolean(sign.transparent), alphaTest: sign.transparent ? .3 : 0,
      side: THREE.FrontSide, roughness: .82 });
    const frameMaterial = sign.storefront ? material({ color: sign.storefront.pierColor ?? '#746c5d' }) : supportMaterial;
    // Visibility is based on a world-space representative point, not local (0,0).
    const center = segments.reduce((sum, segment) => [sum[0] + segment.center[0], sum[1] + segment.center[1]], [0, 0]);
    center[0] /= segments.length; center[1] /= segments.length;
    for (const segment of segments) {
      const mount = new THREE.Group(); mount.position.set(...segment.position); mount.rotation.y = segment.yaw;
      mount.userData.faceId = segment.faceId;
      shop.add(mount);
      const h = sign.height, y = sign.baseOffset + h / 2;
      // Freestanding arches retain alpha; the backing supports only the metal
      // fascia strip and does not fill the transparent space above it.
      const backingHeight = sign.transparent ? h * .45 : h;
      box(mount, segment.width, backingHeight, sign.depth || .02, 0,
        sign.baseOffset + backingHeight / 2, FRONT + sign.depth / 2, supportMaterial, 'Extruded fascia support');
      const geometry = new THREE.PlaneGeometry(segment.width, h);
      const uv = geometry.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setX(i, segment.uv[0] + uv.getX(i) * (segment.uv[1] - segment.uv[0]));
      geometries.push(geometry);
      const panel = new THREE.Mesh(geometry, fasciaMaterial);
      panel.name = `${sign.name} / original rectified photograph`;
      panel.position.set(0, y, segment.front + .008); panel.receiveShadow = true;
      panel.userData = { textureUrl: sign.textureUrl, sourceId: sign.sourceId, sourceCorners: sign.sourceCorners };
      mount.add(panel);
      if (sign.storefront) {
        const sh = Math.min(sign.storefront.height, sign.baseOffset - .08);
        if (sh <= .3) continue;
        box(mount, segment.width, sh, .045, 0, .10 + sh / 2, FRONT - .14, glassMaterial, 'Recessed dark retail glazing');
        box(mount, segment.width, .10, .15, 0, .12, FRONT - .07, frameMaterial, 'Shop threshold');
        const bays = Math.max(1, Math.trunc(sign.storefront.bays ?? 2));
        for (let i = 0; i <= bays; i++) {
          const u = i / bays;
          if (u < segment.uv[0] || u > segment.uv[1]) continue;
          const x = ((u - segment.uv[0]) / (segment.uv[1] - segment.uv[0]) - .5) * segment.width;
          box(mount, .085, sh, .17, x, .1 + sh / 2, FRONT - .04, frameMaterial, 'Retail glazing mullion');
        }
      }
    }
    shops.push({ object: shop, center }); group.add(shop);
  }
  scene?.add(group);
  const stats = { signs: plans.length, mountSegments: plans.reduce((sum, plan) => sum + plan.segments.length, 0),
    sourcePhotos: new Set(plans.map(plan => plan.sign.sourceId)).size, loadedTextures: photographs.size,
    businesses: data.summary?.businesses ?? plans.length };
  return { group, plans, stats,
    update(position, mode = 'walk') {
      const radius = mode === 'drive' ? distance * 1.25 : distance;
      for (const shop of shops) shop.object.visible = Math.hypot(position.x - shop.center[0], position.z - shop.center[1]) < radius;
    },
    dispose() { group.removeFromParent(); geometries.forEach(value => value.dispose()); materials.forEach(value => value.dispose()); },
  };
}

export function createBlissShopfronts({ scene, data, photographs, url = DEFAULT_URL, anisotropy = 8, ...options } = {}) {
  let current, disposed = false, lastUpdate;
  const group = new THREE.Group(); group.name = 'Bliss shopfront loader'; scene?.add(group);
  const ownedTextures = [], failedTextures = [];
  const ready = (async () => {
    if (!data) {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Could not load Bliss shopfronts (${response.status})`);
      data = await response.json();
    }
    planBlissShopfronts(data);
    const photos = new Map(photographs ?? []);
    if (!photographs) {
      const loader = new THREE.TextureLoader();
      await Promise.all([...new Set(data.signs.map(sign => sign.textureUrl))].map(async path => {
        try {
          const texture = await loader.loadAsync(path);
          if (disposed) { texture.dispose(); return; }
          texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = anisotropy;
          photos.set(path, texture); ownedTextures.push(texture);
        } catch { failedTextures.push(path); }
      }));
    }
    if (disposed) return null;
    current = buildBlissShopfronts(data, { ...options, scene: group, photographs: photos });
    current.stats.failedTextures = failedTextures;
    if (lastUpdate) current.update(...lastUpdate);
    return current;
  })();
  return { group, ready, get stats() { return current?.stats ?? null; },
    update(position, mode) { lastUpdate = [{ x: position.x, y: position.y, z: position.z }, mode]; current?.update(position, mode); },
    dispose() { disposed = true; current?.dispose(); group.removeFromParent(); ownedTextures.forEach(texture => texture.dispose()); },
  };
}
