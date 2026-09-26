const METRES_PER_DEGREE_LATITUDE = 111320;

function number(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

/**
 * Normalize current and legacy registration records.
 *
 * Version-one location data did not carry a reflection or scale, so it keeps
 * its original orientation with zSign=+1 and unit scale.
 */
export function normalizeRegistration(registration = {}) {
  return {
    angleDeg: number(registration.angleDeg, 0),
    translationEast: number(registration.translationEast, 0),
    translationNorth: number(registration.translationNorth, 0),
    scale: number(registration.scale, 1),
    zSign: number(registration.zSign, 1),
    anchorLat: number(registration.anchorLat, 0),
    anchorLon: number(registration.anchorLon, 0),
  };
}

/** Convert a model x,z point to local tangent-plane easting/northing metres. */
export function toEastNorth(x, z, registration) {
  const r = normalizeRegistration(registration);
  const angle = r.angleDeg * Math.PI / 180;
  const localZ = z * r.zSign;
  return {
    east: r.scale * (x * Math.cos(angle) - localZ * Math.sin(angle)) + r.translationEast,
    north: r.scale * (x * Math.sin(angle) + localZ * Math.cos(angle)) + r.translationNorth,
  };
}

/** Convert local tangent-plane easting/northing metres back to model x,z. */
export function fromEastNorth(east, north, registration) {
  const r = normalizeRegistration(registration);
  const angle = r.angleDeg * Math.PI / 180;
  const de = (east - r.translationEast) / r.scale;
  const dn = (north - r.translationNorth) / r.scale;
  const x = de * Math.cos(angle) + dn * Math.sin(angle);
  const localZ = -de * Math.sin(angle) + dn * Math.cos(angle);
  return { x, z: localZ / r.zSign };
}

/** Convert a model x,z point to WGS84 latitude and longitude. */
export function toWgs84(x, z, registration) {
  const r = normalizeRegistration(registration);
  const { east, north } = toEastNorth(x, z, r);
  return {
    lat: r.anchorLat + north / METRES_PER_DEGREE_LATITUDE,
    lon: r.anchorLon + east / (METRES_PER_DEGREE_LATITUDE * Math.cos(r.anchorLat * Math.PI / 180)),
  };
}

/** Convert WGS84 latitude and longitude to model x,z coordinates. */
export function fromWgs84(lat, lon, registration) {
  const r = normalizeRegistration(registration);
  const east = (lon - r.anchorLon) * METRES_PER_DEGREE_LATITUDE * Math.cos(r.anchorLat * Math.PI / 180);
  const north = (lat - r.anchorLat) * METRES_PER_DEGREE_LATITUDE;
  return fromEastNorth(east, north, r);
}

/** Unit-length model-space direction that points toward geographic north. */
export function northVector(registration) {
  const r = normalizeRegistration(registration);
  const angle = r.angleDeg * Math.PI / 180;
  return { x: Math.sin(angle), z: Math.cos(angle) / r.zSign };
}
