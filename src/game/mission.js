/** A short courier route through the city; all rewards are earned once. */
export class CourierMission {
  constructor(stops = []) {
    this.stops = stops;
    this.index = -1;
    this.cash = 250;
    this.complete = false;
    this.visited = [];
  }
  startDriving() {
    if (this.index === -1 && !this.complete) { this.index = 0; return true; }
    return false;
  }
  restart() {
    this.index = -1;
    this.cash = 250;
    this.complete = false;
    this.visited = [];
  }
  /** Rewards are derived from progress when loading; stale routes never migrate silently. */
  serialize() {
    return { version: 1, route: this.stops.map(stop => stop.id || stop.name), index: this.index };
  }
  restore(saved) {
    if (!saved || saved.version !== 1 || !Array.isArray(saved.route) ||
      JSON.stringify(saved.route) !== JSON.stringify(this.stops.map(stop => stop.id || stop.name)) ||
      !Number.isInteger(saved.index) || saved.index < -1 || saved.index > this.stops.length) return false;
    this.index = saved.index;
    const delivered = Math.max(0, this.index);
    this.complete = this.stops.length > 0 && delivered === this.stops.length;
    this.visited = this.stops.slice(0, delivered).map(stop => stop.name);
    this.cash = 250 + delivered * 150 + (this.complete ? 500 : 0);
    return true;
  }
  get target() { return this.complete || this.index < 0 ? null : this.stops[this.index] || null; }
  arrive(x, z, speed = 0) {
    const stop = this.target;
    if (!stop || Math.hypot(x - stop.x, z - stop.z) > 22 || Math.abs(speed) > 3.5) return null;
    this.visited.push(stop.name);
    this.cash += 150;
    this.index++;
    if (this.index >= this.stops.length) { this.complete = true; this.cash += 500; }
    return { ...stop, complete: this.complete, cash: this.cash };
  }
  get title() {
    if (this.complete) return 'THE CITY REMEMBERS';
    if (this.index === -1) return 'FIND YOUR RIDE';
    return `${this.index + 1} / ${this.stops.length} · THE LAST CASSETTE`;
  }
}

export const normalizeAngle = angle => Math.atan2(Math.sin(angle), Math.cos(angle));
export function dampAngle(current, target, amount) { return current + normalizeAngle(target-current) * amount; }
