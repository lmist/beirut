import { roadHalfWidth } from './street-detail.js';

const PASSABLE = new Set(['primary', 'secondary', 'tertiary', 'residential', 'unclassified', 'living_street', 'service', 'pedestrian', 'footway']);

/** Short, surveyed-road-aligned walks. Sidewalk positions are inferred, not surveyed. */
export class ResidentPaths {
  constructor(roads = [], buildings = []) {
    this.buildings = new Map();
    for (const b of buildings) {
      for (let x = Math.floor((b[0] - 1) / 64); x <= Math.floor((b[2] + 1) / 64); x++) {
        for (let z = Math.floor((b[1] - 1) / 64); z <= Math.floor((b[3] + 1) / 64); z++) {
          const key = `${x},${z}`;
          if (!this.buildings.has(key)) this.buildings.set(key, []);
          this.buildings.get(key).push(b);
        }
      }
    }
    this.segments = [];
    for (const road of roads) {
      if (road.bridge || road.tunnel || !PASSABLE.has(road.highway)) continue;
      for (let i = 1; i < road.points.length; i++) {
        const [ax, az] = road.points[i - 1], [bx, bz] = road.points[i];
        const length = Math.hypot(bx - ax, bz - az);
        if (length < 14) continue;
        this.segments.push({ ax, az, bx, bz, length, dx: (bx - ax) / length, dz: (bz - az) / length, width: roadHalfWidth(road.highway), id: `${road.id}/${i}` });
      }
    }
  }
  clear(x, z) {
    return !(this.buildings.get(`${Math.floor(x / 64)},${Math.floor(z / 64)}`) || []).some(b => x > b[0] - .65 && x < b[2] + .65 && z > b[1] - .65 && z < b[3] + .65);
  }
  candidates(center, limit = 192, radius = 145) {
    const result = [];
    for (const s of this.segments) {
      const projection = Math.max(0, Math.min(s.length, (center.x - s.ax) * s.dx + (center.z - s.az) * s.dz));
      if (Math.hypot(s.ax + s.dx * projection - center.x, s.az + s.dz * projection - center.z) > radius) continue;
      for (let d = 8; d < s.length - 8; d += 9) for (const side of [-1, 1]) for (const extra of [0, 2, 4, 6, 9]) {
        const offset = (s.width + .85 + extra) * side;
        const x = s.ax + s.dx * d - s.dz * offset, z = s.az + s.dz * d + s.dx * offset;
        const distance = Math.hypot(x - center.x, z - center.z);
        if (distance > radius || !this.clear(x, z)) continue;
        const a = { x: x - s.dx * 6, z: z - s.dz * 6 }, b = { x: x + s.dx * 6, z: z + s.dz * 6 };
        let clear = true;
        for (let i = 0; i <= 24; i++) if (!this.clear(a.x + (b.x - a.x) * i / 24, a.z + (b.z - a.z) * i / 24)) { clear = false; break; }
        result.push({ x, z, distance, path: clear ? { a, b, t: .5, direction: result.length % 2 ? 1 : -1, id: `${s.id}/${side}/${extra}` } : null });
      }
    }
    const spaced = [];
    for (const point of result.sort((a, b) => a.distance - b.distance)) {
      if (!spaced.some(p => Math.hypot(p.x - point.x, p.z - point.z) < 1.7)) spaced.push(point);
      if (spaced.length >= limit) break;
    }
    return spaced;
  }

}

/** Stop before people and solid vehicles; residents never push through the player. */
export function residentObstructed(point, player, vehicles = [], neighbours = []) {
  if (player && Math.hypot(point.x - player.x, point.z - player.z) < 1.25) return true;
  for (const car of vehicles) {
    if (Math.abs((car.position.y || 0) - (point.y || 0)) > 4) continue;
    const dx = point.x - car.position.x, dz = point.z - car.position.z;
    const c = Math.cos(car.yaw || 0), s = Math.sin(car.yaw || 0);
    if (Math.abs(dx * c - dz * s) < 1.65 && Math.abs(dx * s + dz * c) < 3.4) return true;
  }
  return neighbours.some(other => Math.abs(other.y - point.y) < 3 && Math.hypot(other.x - point.x, other.z - point.z) < .75);
}
