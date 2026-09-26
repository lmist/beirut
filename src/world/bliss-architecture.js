import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// All positions and dimensions are metres in the source city's coordinate frame.
// A facade's local x follows tangent; local y starts at base. Its normal points
// out of the source mass. A shallow shell puts glass behind real reveals without
// modifying the source mesh or creating an opening through its collision wall.
const BACK = .035;
const EPSILON = 1e-5;
const DEFAULT_URL = '/data/bliss-architecture.json';
// Partial photographs can support the features that are visible. Their status
// remains partial in provenance; acceptance does not imply a complete survey.
const REVIEWED = new Set(['reviewed', 'photo-reviewed', 'observed', 'partial', 'verified']);
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const finite = value => typeof value === 'number' && Number.isFinite(value);
const color = (value, fallback) => value ?? fallback;

function photoReviewed(facade, building) {
  const review = facade.review ?? building.review;
  return review === true || review?.reviewed === true || REVIEWED.has(review?.status);
}

function pointOnSegment(point, a, b) {
  const cross = (point[0] - a[0]) * (b[1] - a[1]) - (point[1] - a[1]) * (b[0] - a[0]);
  if (Math.abs(cross) > EPSILON * Math.max(1, Math.hypot(b[0] - a[0], b[1] - a[1]))) return false;
  return point[0] >= Math.min(a[0], b[0]) - EPSILON && point[0] <= Math.max(a[0], b[0]) + EPSILON &&
    point[1] >= Math.min(a[1], b[1]) - EPSILON && point[1] <= Math.max(a[1], b[1]) + EPSILON;
}

export function pointInFacade(point, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if (pointOnSegment(point, a, b)) return true;
    if ((a[1] > point[1]) !== (b[1] > point[1]) &&
      point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

function crosses(a, b, c, d) {
  const orientation = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  return orientation(a, b, c) * orientation(a, b, d) < -EPSILON &&
    orientation(c, d, a) * orientation(c, d, b) < -EPSILON;
}

// Corners alone do not catch a rectangle that spans a concave roof cutout.
function rectangleInFacade(x, y, width, height, polygon) {
  const corners = [[x - width / 2, y], [x + width / 2, y], [x + width / 2, y + height], [x - width / 2, y + height]];
  if (!corners.every(point => pointInFacade(point, polygon))) return false;
  for (let i = 0; i < 4; i++) for (let j = 0; j < polygon.length; j++) {
    if (crosses(corners[i], corners[(i + 1) % 4], polygon[j], polygon[(j + 1) % polygon.length])) return false;
  }
  // Reject polygon vertices strictly inside the opening (a notch could touch
  // the rectangle boundary without a proper crossing).
  return !polygon.some(([px, py]) => px > x - width / 2 + EPSILON && px < x + width / 2 - EPSILON &&
    py > y + EPSILON && py < y + height - EPSILON);
}

export function normalizeBlissFacade(facade, building = {}) {
  const center = facade.center, tangent = facade.tangent, normal = facade.normal;
  if (!Array.isArray(center) || center.length !== 2 || !center.every(finite) ||
    !Array.isArray(tangent) || tangent.length !== 2 || !tangent.every(finite) ||
    !Array.isArray(normal) || normal.length !== 2 || !normal.every(finite) ||
    !finite(facade.width) || facade.width <= 0 || !finite(facade.base) || !finite(facade.top) || facade.top <= facade.base) {
    throw new Error(`Invalid source facade geometry: ${building.id ?? '?'}:${facade.id ?? '?'}`);
  }
  const tl = Math.hypot(...tangent), nl = Math.hypot(...normal);
  if (tl < .001 || nl < .001 || Math.abs((tangent[0] * normal[0] + tangent[1] * normal[1]) / (tl * nl)) > .015) {
    throw new Error(`Facade tangent and normal must be perpendicular: ${facade.id ?? '?'}`);
  }
  const n = normal.map(value => value / nl), t = tangent.map(value => value / tl);
  const height = facade.top - facade.base;
  const polygon = facade.polygon ?? [[-facade.width / 2, 0], [facade.width / 2, 0], [facade.width / 2, height], [-facade.width / 2, height]];
  if (polygon.length < 3 || polygon.some(point => !Array.isArray(point) || point.length !== 2 || !point.every(finite))) {
    throw new Error(`Invalid source facade polygon: ${facade.id ?? '?'}`);
  }
  const style = { ...building.style, ...facade.style };
  return { ...facade, center, tangent: t, normal: n, height, polygon, style,
    buildingId: building.id, reviewed: photoReviewed(facade, building),
    // Instances use a right-handed basis even if the input polygon was traced
    // in the opposite direction; xSign preserves that trace's local positions.
    xSign: t[0] * n[1] - t[1] * n[0] >= 0 ? 1 : -1,
    yaw: Math.atan2(n[0], n[1]),
  };
}

function facadeBays(face) {
  const count = Math.trunc(face.style.bays ?? 0);
  if (count < 1 || count > 40) return [];
  const source = face.style.bayWidthRatios;
  const weights = Array.isArray(source) && source.length === count && source.every(value => finite(value) && value > 0)
    ? source : Array(count).fill(1);
  const total = weights.reduce((sum, value) => sum + value, 0);
  let left = -face.width / 2;
  return weights.map((weight, bay) => {
    const width = face.width * weight / total, span = { bay, left, width, x: left + width / 2, right: left + width };
    left += width;
    return span;
  });
}

function patternedOpenings(face) {
  const s = face.style, rows = Math.trunc(s.floors), columns = Math.trunc(s.bays);
  if (!(rows > 0 && rows <= 50 && columns > 0 && columns <= 40)) return [];
  const groundHeight = finite(s.groundHeight) ? s.groundHeight : 0;
  const floorHeight = finite(s.floorHeight) ? s.floorHeight : (face.height - groundHeight) / Math.max(1, rows - 1);
  const spans = facadeBays(face), openings = [], w = s.window;
  if (w && (finite(w.width) || finite(w.widthRatio)) && finite(w.height) && finite(w.sill) && floorHeight > 0) {
    for (let floor = 1; floor < rows; floor++) for (let bay = 0; bay < columns; bay++) {
      const span = spans[bay], windowWidth = finite(w.widthRatio) ? span.width * clamp(w.widthRatio, .05, .98) : w.width;
      const balcony = !s.balconies?.continuous && s.balconies?.floors?.includes(floor) && s.balconies?.bays?.includes(bay) ? {
        ...s.balconies, shape: s.balconies.shapesByBay?.[bay] ?? s.balconies.shape,
        width: s.balconies.width ?? Math.min(windowWidth + .65, span.width - .04),
        floorY: groundHeight + (floor - 1) * floorHeight,
      } : null;
      openings.push({ ...w, x: span.x, y: groundHeight + (floor - 1) * floorHeight + w.sill,
        width: windowWidth,
        height: w.height, kind: 'window', floor, bay, balcony });
    }
  }
  const shop = s.storefront;
  if (shop && groundHeight > .8) {
    const bays = Array.isArray(shop.bays) ? shop.bays : [];
    for (const bay of bays) if (Number.isInteger(bay) && bay >= 0 && bay < columns) {
      openings.push({ ...shop, x: spans[bay].x, y: .08,
        width: shop.width ?? spans[bay].width - .5, height: shop.height ?? groundHeight - .55,
        kind: 'shop', floor: 0, bay });
    }
  }
  return openings;
}

function archRise(opening) {
  if (!opening.arch) return 0;
  return clamp(typeof opening.arch === 'object' ? opening.arch.rise ?? opening.width / 2 : opening.width / 2,
    .1, Math.min(opening.height * .65, opening.width));
}

function openingOutline(opening) {
  const { x, y, width, height } = opening, rise = archRise(opening), half = width / 2;
  if (!rise) return [[x - half, y], [x + half, y], [x + half, y + height], [x - half, y + height]];
  const points = [[x - half, y], [x + half, y], [x + half, y + height - rise]];
  for (let i = 1; i <= 16; i++) {
    const angle = i * Math.PI / 16;
    points.push([x + Math.cos(angle) * half, y + height - rise + Math.sin(angle) * rise]);
  }
  return points;
}

/** A balcony plan starts at the left mounting corner and follows its outer
 * perimeter from the right mounting corner back to the left. */
function balconyOutline(width, depth, shape) {
  const half = width / 2;
  if (shape === 'angular') return [[-half, 0], [half, 0], [half, depth * .62], [half * .55, depth], [-half * .55, depth], [-half, depth * .62], [-half, 0]];
  if (shape !== 'curved' && shape !== 'rounded') return [[-half, 0], [half, 0], [half, depth], [-half, depth], [-half, 0]];
  const radius = Math.min(depth * .6, width * .2, 1.5), points = [[-half, 0], [half, 0], [half, depth - radius]];
  for (let i = 1; i <= 6; i++) {
    const angle = i * Math.PI / 12;
    points.push([half - radius + Math.cos(angle) * radius, depth - radius + Math.sin(angle) * radius]);
  }
  points.push([-half + radius, depth]);
  for (let i = 1; i <= 6; i++) {
    const angle = Math.PI / 2 + i * Math.PI / 12;
    points.push([-half + radius + Math.cos(angle) * radius, depth - radius + Math.sin(angle) * radius]);
  }
  points.push([-half, 0]);
  return points;
}

/** Pure planning makes source-boundary and depth checks possible without WebGL.
 * Explicit opening y is its lower edge, measured above the source base.
 * floors includes the ground floor; bay indices and the ground floor are zero.
 */
export function planBlissFacade(facade, building = {}) {
  const face = normalizeBlissFacade(facade, building);
  const boxes = [], profiles = [], openings = [], rejectedOpenings = [];
  const stats = { windows: 0, archedWindows: 0, curtainPanels: 0, storefronts: 0, balconies: 0, glassBalconies: 0, shapedBalconies: 0,
    verticalPiers: 0, floorBands: 0, acUnits: 0, rejectedOpenings: 0 };
  if (!face.reviewed) {
    // A source-backed neutral skin removes unrelated fallback imagery without
    // asserting an unobserved window, balcony, shop, or roof ornament.
    face.back = BACK; face.front = BACK + .015;
    return { face, boxes, profiles, openings, rejectedOpenings, stats, unreviewed: true };
  }
  const s = face.style;
  const shellDepth = clamp(s.window?.recess ?? s.recess ?? .24, .08, .6);
  face.back = BACK; face.front = BACK + shellDepth;
  const palette = { wall: color(s.wallColor, '#bcb7aa'), frame: color(s.frameColor, '#736e61'),
    glass: color(s.glassColor, '#293a3b'), trim: color(s.trimColor, s.wallColor ?? '#c7c1b3'),
    rail: color(s.railColor, '#5d625c'), shutter: color(s.shutterColor, '#88897e'), ac: '#c3c0ae', acVent: '#56594f',
    canopy: color(s.storefront?.canopyColor, '#676759'), railGlass: color(s.balconies?.glassColor, '#8baeb1') };
  const box = (kind, x, y, z, width, height, depth, overrides = {}) => {
    if (![x, y, z, width, height, depth].every(finite) || width <= 0 || height <= 0 || depth <= 0) return;
    boxes.push({ kind, x, y, z, width, height, depth, color: palette[kind] ?? palette.wall, ...overrides });
  };
  const addBalcony = (x, bottom, width, balcony) => {
    if (!finite(balcony.depth) || balcony.depth <= 0) return;
    const depth = clamp(balcony.depth, .15, 2.5), bw = balcony.width ?? width, bh = balcony.railHeight ?? .94;
    // The mounting edge must sit on the same source face. A ledge may project
    // out from it, but cannot bridge into an adjacent facade or roof cutout.
    if (!rectangleInFacade(x, bottom, bw, bh + .18, face.polygon)) return;
    stats.balconies++;
    const shaped = ['rounded', 'curved', 'angular'].includes(balcony.shape);
    if (shaped) {
      stats.shapedBalconies++;
      profiles.push({ kind: 'trim', color: palette.trim, axis: 'horizontal', depth: .17, offset: bottom - .085,
        points: balconyOutline(bw, depth, balcony.shape).map(([px, pz]) => [x + px, face.front + pz]) });
    } else box('trim', x, bottom, face.front + depth / 2, bw, .17, depth + .06);
    if (balcony.rail === 'glass') stats.glassBalconies++;
    if (shaped || balcony.rail === 'glass') {
      const outline = balconyOutline(bw, depth, balcony.shape);
      // Every straight or curved perimeter segment receives real panels/rails;
      // the rear mounting edge stays open against the facade.
      for (let i = 1; i < outline.length - 1; i++) {
        const a = outline[i], b = outline[i + 1], dx = b[0] - a[0], dz = b[1] - a[1];
        const length = Math.hypot(dx, dz), cx = x + (a[0] + b[0]) / 2, cz = face.front + (a[1] + b[1]) / 2;
        const rotationY = -Math.atan2(dz, dx), feature = 'balcony-rail';
        if (balcony.rail === 'glass') {
          box('railGlass', cx, bottom + bh / 2 + .08, cz, length + .005, bh - .12, .024, { rotationY, feature });
          box('rail', cx, bottom + bh, cz, length + .02, .035, .042, { rotationY, feature });
          for (const [px, pz] of [a, b]) box('rail', x + px, bottom + bh / 2 + .06, face.front + pz, .027, bh, .027, { feature });
        } else if (balcony.rail === 'solid') {
          box('wall', cx, bottom + bh / 2 + .1, cz, length + .055, bh, .11, { rotationY, feature });
        } else {
          for (const level of [.12, bh]) box('rail', cx, bottom + level, cz, length + .02, .038, .038, { rotationY, feature });
          const count = Math.max(1, Math.ceil(length / .23));
          for (let j = 0; j <= count; j++) box('rail', x + a[0] + dx * j / count, bottom + bh / 2 + .06,
            face.front + a[1] + dz * j / count, .025, bh - .07, .025, { feature });
        }
      }
      return;
    }
    const rz = face.front + depth - .05;
    if (balcony.rail === 'solid') {
      box('wall', x, bottom + bh / 2 + .1, rz, bw, bh, .11);
      for (const side of [-1, 1]) box('wall', x + side * (bw - .1) / 2, bottom + bh / 2 + .1, face.front + depth / 2, .11, bh, depth);
    } else {
      for (const level of [.12, bh]) box('rail', x, bottom + level, rz, bw, .038, .038);
      const count = Math.max(2, Math.ceil(bw / .23));
      for (let i = 0; i <= count; i++) box('rail', x - bw / 2 + bw * i / count, bottom + bh / 2 + .06, rz, .025, bh - .07, .025);
      for (const side of [-1, 1]) {
        box('rail', x + side * bw / 2, bottom + bh, face.front + depth / 2, .038, .038, depth);
        box('rail', x + side * bw / 2, bottom + bh / 2, face.front + .03, .03, bh, .03);
      }
    }
  };
  for (const source of facade.openings ?? patternedOpenings(face)) {
    const opening = { ...source, kind: source.kind ?? 'window', arch: source.arch ?? (source.kind === 'shop' || source.kind === 'door' ? false : s.window?.arch) };
    const { x, y, width, height } = opening;
    const overlaps = openings.some(other => Math.abs(other.x - x) < (other.width + width) / 2 + .03 &&
      Math.max(other.y, y) < Math.min(other.y + other.height, y + height) + .03);
    if (![x, y, width, height].every(finite) || width < .25 || height < .25 || overlaps ||
      !rectangleInFacade(x, y, width + .04, height + .04, face.polygon)) {
      rejectedOpenings.push(source); continue;
    }
    openings.push(opening);
    const isShop = opening.kind === 'shop' || opening.kind === 'door';
    stats[isShop ? 'storefronts' : 'windows']++;
    const frame = clamp(opening.frameWidth ?? .065, .035, .18), glassZ = BACK + .024, frameZ = glassZ + .045;
    const rise = archRise(opening), paneKind = opening.shutter ? 'shutter' : 'glass';
    if (rise) {
      stats.archedWindows++;
      profiles.push({ kind: paneKind, color: palette[paneKind], points: openingOutline(opening), depth: .025, axis: 'facade', offset: glassZ - .0125 });
    } else box(paneKind, x, y + height / 2, glassZ, width, height, .025);
    for (const edge of [-1, 1]) {
      box('frame', x + edge * (width - frame) / 2, y + (height - rise) / 2, frameZ, frame, height - rise, .075);
      if (!rise || edge === -1) box('frame', x, y + height / 2 + edge * (height - frame) / 2, frameZ, width, frame, .075);
    }
    if (rise) {
      const arc = openingOutline(opening).slice(2);
      for (let i = 0; i < arc.length - 1; i++) {
        const a = arc[i], b = arc[i + 1], dx = b[0] - a[0], dy = b[1] - a[1];
        box('frame', (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, frameZ, Math.hypot(dx, dy) + .015, frame, .075,
          { rotationZ: Math.atan2(dy, dx), feature: 'arch-frame' });
      }
    }
    const curtain = opening.curtainWall ?? (!isShop && s.curtainWall);
    const curtainStyle = typeof curtain === 'object' ? curtain : {};
    const panelWidth = clamp(curtainStyle.panelWidth ?? 1.2, .4, 3), panelHeight = clamp(curtainStyle.panelHeight ?? curtainStyle.transomHeight ?? 1.2, .4, 3);
    const panelColumns = curtain ? Math.ceil(width / panelWidth) : 1, panelRows = curtain ? Math.ceil(height / panelHeight) : 1;
    const mullions = clamp(Math.max(Math.trunc(opening.mullions ?? s.window?.mullions ?? (isShop ? 1 : 0)), panelColumns - 1), 0, 30);
    for (let n = 1; n <= mullions; n++) {
      const mx = -width / 2 + width * n / (mullions + 1), mh = height - rise + Math.sqrt(Math.max(0, 1 - (mx / (width / 2)) ** 2)) * rise;
      box('frame', x + mx, y + mh / 2, frameZ, frame * .75, mh, .065);
    }
    if (curtain) {
      stats.curtainPanels += (mullions + 1) * panelRows;
      for (let row = 1; row < panelRows; row++) {
        const my = height * row / panelRows, archT = rise ? Math.max(0, (my - (height - rise)) / rise) : 0;
        const span = width * Math.sqrt(Math.max(0, 1 - archT * archT));
        box('frame', x, y + my, frameZ, span, frame * .75, .065, { feature: 'curtain-transom' });
      }
    }
    if (opening.shutter) for (let h = .12; h < height; h += .16) box('frame', x, y + h, glassZ + .022, width, .016, .018);
    if (!isShop) box('trim', x, y - .055, (face.front + BACK) / 2 + .08, width + .18, .11, shellDepth + .22);
    if (isShop && finite(opening.canopyDepth) && opening.canopyDepth > 0) {
      const depth = clamp(opening.canopyDepth, .15, 2.2);
      box('canopy', x, y + height + .14, face.front + depth / 2, width + .16, .12, depth);
      box('canopy', x, y + height + .03, face.front + depth, width + .16, .19, .045);
    }
    const balcony = opening.balcony;
    if (balcony) addBalcony(x, balcony.floorY ?? y - .12, width + .65, balcony);
  }
  if (s.balconies?.continuous) for (const floor of s.balconies.floors ?? []) {
    const row = openings.filter(opening => opening.floor === floor && s.balconies.bays?.includes(opening.bay)).sort((a, b) => a.x - b.x);
    if (!row.length) continue;
    // The reviewed balcony bay span, rather than the full bounding rectangle,
    // controls a continuous terrace. Individual side returns are emitted once.
    const runs = [];
    for (const opening of row) {
      const shape = s.balconies.shapesByBay?.[opening.bay] ?? s.balconies.shape;
      const previous = runs[runs.length - 1];
      if (previous && previous.shape === shape) previous.openings.push(opening);
      else runs.push({ shape, openings: [opening] });
    }
    const floorHeight = s.floorHeight ?? (face.height - (s.groundHeight ?? 0)) / Math.max(1, s.floors - 1);
    for (const run of runs) {
      const left = run.openings[0].x - run.openings[0].width / 2 - .2, last = run.openings[run.openings.length - 1];
      const right = last.x + last.width / 2 + .2;
      addBalcony((left + right) / 2, (s.groundHeight ?? 0) + (floor - 1) * floorHeight, right - left, { ...s.balconies, shape: run.shape });
    }
  }
  if (s.verticalPiers) {
    const piers = typeof s.verticalPiers === 'object' ? s.verticalPiers : {};
    const width = clamp(piers.width ?? .19, .05, 1.2), depth = clamp(piers.depth ?? .3, .04, 1.8);
    const bottom = piers.bottom ?? s.groundHeight ?? 0, top = Math.min(piers.top ?? face.height, face.height);
    const spans = facadeBays(face);
    const boundaries = spans.length ? [spans[0].left, ...spans.map(span => span.right)] : [];
    const positions = piers.positions ?? boundaries.map(x =>
      clamp(x, -face.width / 2 + width / 2 + .01, face.width / 2 - width / 2 - .01));
    for (const x of positions) {
      if (!finite(x) || top <= bottom || !rectangleInFacade(x, bottom, width, top - bottom, face.polygon)) continue;
      stats.verticalPiers++;
      box('trim', x, (bottom + top) / 2, face.front + depth / 2, width, top - bottom, depth,
        { feature: 'vertical-pier', color: piers.color ?? palette.trim });
    }
  }
  if (s.floorBands) {
    const bands = typeof s.floorBands === 'object' ? s.floorBands : {};
    const height = clamp(bands.height ?? .16, .05, .6), depth = clamp(bands.depth ?? .15, .025, .8);
    const floorHeight = s.floorHeight ?? (face.height - (s.groundHeight ?? 0)) / Math.max(1, s.floors - 1);
    const floors = bands.floors ?? Array.from({ length: clamp(Math.trunc(s.floors ?? 0) - 1, 0, 49) }, (_, i) => i + 1);
    for (const floor of floors) {
      const y = (s.groundHeight ?? 0) + (floor - 1) * floorHeight;
      if (!finite(y) || !rectangleInFacade(0, y - height / 2, face.width - .03, height, face.polygon)) continue;
      stats.floorBands++;
      box('trim', 0, y, face.front + depth / 2, face.width - .03, height, depth,
        { feature: 'floor-band', color: bands.color ?? palette.trim });
    }
  }
  stats.rejectedOpenings = rejectedOpenings.length;
  for (const unit of s.acUnits ?? []) {
    const opening = openings.find(item => item.floor === unit.floor && item.bay === unit.bay);
    const x = finite(unit.x) ? unit.x : opening?.x;
    const y = finite(unit.y) ? unit.y : opening ? opening.y + opening.height + .38 : undefined;
    const width = unit.width ?? .82, height = unit.height ?? .52, depth = unit.depth ?? .32;
    if (![x, y, width, height, depth].every(finite) || !rectangleInFacade(x, y - height / 2, width, height, face.polygon)) continue;
    stats.acUnits++;
    box('ac', x, y, face.front + depth / 2 + .08, width, height, depth);
    // Individual louvres retain real depth without a texture or invented logo.
    for (let l = 0; l < 6; l++) box('acVent', x + width * .14, y - height * .34 + l * height * .135,
      face.front + depth + .083, width * .53, .02, .018);
    for (const side of [-1, 1]) box('rail', x + side * width * .31, y - height / 2 - .05, face.front + depth / 2, .035, .06, depth + .18);
  }
  // Trim only follows horizontal edges actually present in the source outline.
  // A stepped roof consequently receives stepped trim rather than a floating
  // bounding-box-wide beam.
  for (let i = 0; i < face.polygon.length; i++) {
    const a = face.polygon[i], b = face.polygon[(i + 1) % face.polygon.length];
    if (Math.abs(a[1] - b[1]) > .025 || Math.abs(a[0] - b[0]) < .2 || a[1] < face.height * .45) continue;
    const x = (a[0] + b[0]) / 2, width = Math.abs(a[0] - b[0]);
    // Only roof edges have interior immediately below and exterior above.
    if (!pointInFacade([x, a[1] - .03], face.polygon) || pointInFacade([x, a[1] + .03], face.polygon)) continue;
    if (s.cornice) {
      const height = s.cornice.height ?? .16, depth = s.cornice.depth ?? .22;
      box('trim', x, a[1] - height / 2, face.front + depth / 2, width, height, depth + .05);
    }
    if (s.parapet?.height > 0) box('wall', x, a[1] + s.parapet.height / 2,
      face.front - .08, width, s.parapet.height, s.parapet.depth ?? .2);
  }
  return { face, openings, rejectedOpenings, boxes, profiles, stats };
}

function facadeMatrix(face) {
  return new THREE.Matrix4().makeRotationY(face.yaw).setPosition(face.center[0], face.base, face.center[1]);
}

function facadeShell(plan) {
  const { face, openings } = plan;
  const points = face.polygon.map(([x, y]) => new THREE.Vector2(x * face.xSign, y));
  const shape = new THREE.Shape(points);
  for (const opening of openings) {
    shape.holes.push(new THREE.Path(openingOutline(opening).map(([x, y]) => new THREE.Vector2(x * face.xSign, y))));
  }
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: face.front - face.back, bevelEnabled: false, steps: 1, curveSegments: 1 });
  geometry.translate(0, 0, face.back);
  // A rectified photograph spans the original facade plane. Jambs retain the
  // corresponding edge pixels instead of repeating a complete photo per strip.
  const position = geometry.getAttribute('position'), uv = geometry.getAttribute('uv');
  const rect = face.texture?.rect ?? [0, 0, 1, 1];
  for (let i = 0; i < position.count; i++) uv.setXY(i,
    rect[0] + (position.getX(i) * face.xSign / face.width + .5) * rect[2],
    1 - rect[1] - (1 - position.getY(i) / face.height) * rect[3]);
  geometry.clearGroups();
  geometry.applyMatrix4(facadeMatrix(face));
  return geometry;
}

function facadeProfile(profile, face) {
  const horizontal = profile.axis === 'horizontal';
  const points = profile.points.map(([x, y]) => new THREE.Vector2(x * face.xSign, horizontal ? -y : y));
  const geometry = new THREE.ExtrudeGeometry(new THREE.Shape(points), { depth: profile.depth,
    bevelEnabled: false, steps: 1, curveSegments: 1 });
  geometry.clearGroups();
  if (horizontal) geometry.rotateX(-Math.PI / 2).translate(0, profile.offset, 0);
  else geometry.translate(0, 0, profile.offset);
  geometry.applyMatrix4(facadeMatrix(face));
  return geometry;
}

function createMaterial(kind, wallColor, map) {
  return new THREE.MeshStandardMaterial({ color: map ? '#ffffff' : wallColor, map,
    roughness: kind === 'railGlass' ? .16 : kind === 'glass' ? .29 : kind === 'frame' || kind === 'rail' ? .57 : .88,
    metalness: kind === 'glass' ? .18 : kind === 'rail' || kind === 'frame' ? .3 : 0,
    ...(kind === 'railGlass' ? { transparent: true, opacity: .42, depthWrite: false } : {}),
  });
}

/** Build synchronously from reviewed data, with a bounded number of shared
 * instanced pools per 100 m cell. `style.wallMap` may be a loaded THREE.Texture.
 * `photographs` maps texture.url or texture.id to a loaded THREE.Texture.
 */
export function buildBlissArchitecture(data, { scene, photographs = new Map(), cellSize = 100, distance = 430, preserveUnobserved = false } = {}) {
  const group = new THREE.Group(); group.name = 'Bliss Street — surveyed facade geometry';
  const chunks = new Map(), materials = new Map(), geometries = new Set(), warnings = [];
  const counts = { buildings: 0, facades: 0, reviewedFacades: 0, unreviewedFacades: 0, windows: 0, archedWindows: 0, curtainPanels: 0,
    storefronts: 0, balconies: 0, glassBalconies: 0, shapedBalconies: 0, verticalPiers: 0, floorBands: 0,
    acUnits: 0, rejectedOpenings: 0, instances: 0, profiles: 0, meshes: 0, photographicFallbackFacades: 0 };
  const sourceReviews = [];
  const colorKey = value => Array.isArray(value) ? value.join(',') : String(value);
  function materialFor(kind, value, map = null) {
    const key = `${kind}:${colorKey(value)}:${map?.uuid ?? ''}`;
    if (!materials.has(key)) {
      const c = Array.isArray(value) ? new THREE.Color().setRGB(...value) : value;
      materials.set(key, createMaterial(kind, c, map));
    }
    return { key, material: materials.get(key) };
  }
  function chunkFor(face) {
    const key = `${Math.floor(face.center[0] / cellSize)},${Math.floor(face.center[1] / cellSize)}`;
    if (!chunks.has(key)) {
      const chunk = new THREE.Group(); chunk.name = `Bliss facade cell ${key}`;
      chunk.userData.buildingIds = []; group.add(chunk);
      chunks.set(key, { group: chunk, boxes: new Map(), walls: new Map(), bounds: new THREE.Box3() });
    }
    return chunks.get(key);
  }
  for (const building of data?.buildings ?? []) {
    let built = false;
    sourceReviews.push({ id: building.id, review: building.review ?? null });
    for (const input of building.facades ?? []) {
      let plan;
      try { plan = planBlissFacade(input, building); }
      catch (error) { warnings.push(error.message); continue; }
      counts[plan.unreviewed ? 'unreviewedFacades' : 'reviewedFacades']++;
      if(preserveUnobserved&&(plan.unreviewed||plan.face.style.geometryConflict)){
        counts.photographicFallbackFacades++;continue;
      }
      const { face, boxes, profiles, stats } = plan, chunk = chunkFor(face);
      if (!chunk.group.userData.buildingIds.includes(building.id)) chunk.group.userData.buildingIds.push(building.id);
      const photoKey = face.texture?.url ?? face.texture?.id;
      const map = face.style.wallMap ?? (photographs instanceof Map ? photographs.get(photoKey) : photographs[photoKey]);
      const wall = materialFor('wall', color(face.style.wallColor, '#bcb7aa'), map);
      if (!chunk.walls.has(wall.key)) chunk.walls.set(wall.key, { kind: 'wall', material: wall.material, parts: [] });
      chunk.walls.get(wall.key).parts.push(facadeShell(plan));
      for (const profile of profiles) {
        const resolved = materialFor(profile.kind, profile.color);
        if (!chunk.walls.has(resolved.key)) chunk.walls.set(resolved.key, { kind: profile.kind, material: resolved.material, parts: [] });
        chunk.walls.get(resolved.key).parts.push(facadeProfile(profile, face));
      }
      for (const primitive of boxes) {
        const resolved = materialFor(primitive.kind, primitive.color);
        if (!chunk.boxes.has(resolved.key)) chunk.boxes.set(resolved.key, { kind: primitive.kind, material: resolved.material, instances: [] });
        chunk.boxes.get(resolved.key).instances.push({ face, primitive });
      }
      for (const key of Object.keys(stats)) counts[key] += stats[key];
      counts.facades++; counts.instances += boxes.length; counts.profiles += profiles.length; built = true;
    }
    if (built) counts.buildings++;
  }
  const cube = new THREE.BoxGeometry(1, 1, 1); geometries.add(cube);
  const dummy = new THREE.Object3D(), world = new THREE.Matrix4();
  for (const chunk of chunks.values()) {
    for (const { kind, material, parts } of chunk.walls.values()) {
      const geometry = mergeGeometries(parts, false); parts.forEach(part => part.dispose());
      geometries.add(geometry);
      const mesh = new THREE.Mesh(geometry, material); mesh.name = kind === 'wall' ? 'Bliss wall shell with recessed openings' : `Bliss ${kind} profiles`;
      mesh.castShadow = mesh.receiveShadow = true; chunk.group.add(mesh); counts.meshes++;
    }
    for (const { kind, material, instances } of chunk.boxes.values()) {
      const mesh = new THREE.InstancedMesh(cube, material, instances.length); mesh.name = `Bliss ${kind}`;
      mesh.castShadow = mesh.receiveShadow = true;
      for (let i = 0; i < instances.length; i++) {
        const { face, primitive: p } = instances[i];
        dummy.position.set(p.x * face.xSign, p.y, p.z);
        dummy.rotation.set(0, (p.rotationY ?? 0) * face.xSign, (p.rotationZ ?? 0) * face.xSign);
        dummy.scale.set(p.width, p.height, p.depth); dummy.updateMatrix();
        world.multiplyMatrices(facadeMatrix(face), dummy.matrix); mesh.setMatrixAt(i, world);
      }
      mesh.instanceMatrix.needsUpdate = true; mesh.computeBoundingBox(); mesh.computeBoundingSphere();
      chunk.group.add(mesh); counts.meshes++;
    }
    chunk.bounds.setFromObject(chunk.group);
    chunk.boxes.clear(); chunk.walls.clear();
  }
  scene?.add(group);
  let enabled = true, disposed = false;
  return {
    group, sourceReviews,
    update(position, mode = 'walk') {
      if (disposed) return;
      const point = position?.isVector3 ? position : new THREE.Vector3(position?.x ?? 0, position?.y ?? 0, position?.z ?? 0);
      group.visible = enabled;
      for (const chunk of chunks.values()) chunk.group.visible = enabled && chunk.bounds.distanceToPoint(point) < (mode === 'overview' ? distance * 1.7 : distance);
    },
    setEnabled(value) { enabled = !!value; group.visible = enabled; },
    diagnostics() { return { ...counts, available: !disposed && counts.facades > 0, enabled, cells: chunks.size,
      visibleCells: [...chunks.values()].filter(chunk => group.visible && chunk.group.visible).length,
      warnings: [...warnings], reviewStatus: data?.reviewStatus ?? data?.accuracyStatus ?? null }; },
    dispose() {
      if (disposed) return;
      disposed = true; group.removeFromParent();
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials.values()) material.dispose();
      // Externally supplied photographs remain owned by their caller.
      group.clear();
    },
  };
}

/** Async application wrapper. Missing data produces visible diagnostics while
 * preserving the original city, and never substitutes procedural buildings.
 */
export function createBlissArchitecture({ scene, data, photographs, url = DEFAULT_URL, anisotropy = 8, ...options } = {}) {
  const group = new THREE.Group(); group.name = 'Bliss Street architecture'; scene?.add(group);
  let architecture = null, error = null, disposed = false, lastUpdate = null, enabled = true;
  const ownedTextures = new Set();
  const ready = (async () => {
    if (!data) {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Bliss Street architecture unavailable (${response.status})`);
      data = await response.json();
    }
    const photos = new Map(photographs instanceof Map ? photographs : Object.entries(photographs ?? {}));
    const urls = [...new Set((data.buildings ?? []).flatMap(building => (building.facades ?? []).map(face => face.texture?.url).filter(Boolean)))];
    const loader = new THREE.TextureLoader();
    // Load in small batches so a whole street does not start hundreds of image
    // decodes simultaneously. Load failures keep that facade's observed color.
    for (let start = 0; start < urls.length; start += 4) {
      await Promise.all(urls.slice(start, start + 4).map(async textureUrl => {
        if (photos.has(textureUrl) || disposed) return;
        try {
          const texture = await loader.loadAsync(textureUrl);
          texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = anisotropy;
          texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
          if (disposed) { texture.dispose(); return; }
          photos.set(textureUrl, texture); ownedTextures.add(texture);
        } catch (reason) { error = `Facade photograph failed: ${textureUrl}: ${reason.message ?? reason}`; }
      }));
    }
    if (disposed) return;
    architecture = buildBlissArchitecture(data, { ...options, scene: group, photographs: photos });
    architecture.setEnabled(enabled);
    if (lastUpdate) architecture.update(...lastUpdate);
  })().catch(reason => { error = reason.message; console.warn(error); });
  return {
    group, ready,
    update(position, mode) { lastUpdate = [{ x: position.x, y: position.y, z: position.z }, mode]; architecture?.update(position, mode); },
    setEnabled(value) { enabled = !!value; group.visible = enabled; architecture?.setEnabled(enabled); },
    diagnostics() { return { ...(architecture?.diagnostics() ?? { available: false, buildings: 0, facades: 0 }), loading: !architecture && !error && !disposed, error }; },
    dispose() { disposed = true; architecture?.dispose(); group.removeFromParent(); for (const texture of ownedTextures) texture.dispose(); ownedTextures.clear(); },
  };
}
