export function summarizeFrames(frames, cpu = []) {
  if (!frames.length) return null;
  const sorted = [...frames].sort((a, b) => a - b);
  const percentile = (p) => sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)];
  const total = frames.reduce((a, b) => a + b, 0);
  const slowest = sorted.slice(-Math.max(1, Math.ceil(sorted.length * .01)));
  const p99 = percentile(.99);
  return {
    frames: frames.length,
    durationSeconds: total / 1000,
    averageFps: 1000 * frames.length / total,
    onePercentLowFps: 1000 / (slowest.reduce((a, b) => a + b, 0) / slowest.length),
    p50Ms: percentile(.5), p95Ms: percentile(.95), p99Ms: p99,
    maxMs: sorted.at(-1),
    over20Ms: frames.filter(x => x > 20).length,
    over33Ms: frames.filter(x => x > 33.34).length,
    averageCpuMs: cpu.length ? cpu.reduce((a, b) => a + b, 0) / cpu.length : null,
    meets60Fps: 1000 * frames.length / total >= 59 && p99 <= 18.5 && frames.every(x => x < 33.34),
  };
}

export function distanceToTile(x, z, bounds) {
  return Math.hypot(Math.max(bounds[0] - x, 0, x - bounds[3]), Math.max(bounds[2] - z, 0, z - bounds[5]));
}

export function findOpenPoint(x, z, buildings, clearance = 2) {
  const open = (px, pz) => !buildings.some(b => px > b[0] - clearance && px < b[2] + clearance && pz > b[1] - clearance && pz < b[3] + clearance);
  if (open(x, z)) return { x, z };
  // A deterministic spiral keeps map clicks reproducible and outside building bounds.
  for (let i = 1; i < 2400; i++) {
    const r = 2.5 * Math.sqrt(i), angle = i * 2.399963229728653;
    const px = x + Math.cos(angle) * r, pz = z + Math.sin(angle) * r;
    if (open(px, pz)) return { x: px, z: pz };
  }
  throw new Error('No open street found nearby. Try a less dense part of the map.');
}
