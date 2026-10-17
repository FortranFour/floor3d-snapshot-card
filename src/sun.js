// Sun position and the shared surface-direction table used by the sunlight layer.
const RAD = Math.PI / 180;

/** Solar azimuth (degrees clockwise from north) and elevation (degrees) — NOAA approximation, ~0.1°. */
export function solarPosition(date, lat, lon) {
  const n = date.getTime() / 86400000 + 2440587.5 - 2451545.0;
  const L = (280.46 + 0.9856474 * n) % 360;
  const g = ((357.528 + 0.9856003 * n) % 360) * RAD;
  const lambda = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD;
  const eps = (23.439 - 0.0000004 * n) * RAD;
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda));
  const dec = Math.asin(Math.sin(eps) * Math.sin(lambda));
  const gmst = ((18.697374558 + 24.06570982441908 * n) % 24 + 24) % 24;
  const ha = (gmst * 15 + lon) * RAD - ra;
  const phi = lat * RAD;
  const el = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(ha));
  const az = Math.atan2(-Math.sin(ha), Math.tan(dec) * Math.cos(phi) - Math.sin(phi) * Math.cos(ha));
  return { azimuth: (az / RAD + 360) % 360, elevation: el / RAD };
}

/**
 * Direction toward the sun in model coordinates (y up). `north` is degrees clockwise
 * from the top of the floor plan (model −Z), as in Sweet Home 3D's compass.
 */
export function sunVector({ azimuth, elevation }, north = 0) {
  const t = north * RAD, a = azimuth * RAD, e = elevation * RAD;
  const N = [Math.sin(t), 0, -Math.cos(t)], E = [Math.cos(t), 0, Math.sin(t)];
  const h = Math.cos(e);
  return [h * (Math.cos(a) * N[0] + Math.sin(a) * E[0]), Math.sin(e), h * (Math.cos(a) * N[2] + Math.sin(a) * E[2])];
}
export const northVector = (north = 0) => [Math.sin(north * RAD), 0, -Math.cos(north * RAD)];

/** 255 unit directions (6 axes first, then a Fibonacci sphere); index 255 means "no surface". */
export const NORMALS = (() => {
  const t = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  const n = 249, golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) { const y = 1 - 2 * (i + 0.5) / n, r = Math.sqrt(1 - y * y), p = i * golden; t.push([Math.cos(p) * r, y, Math.sin(p) * r]); }
  return Float32Array.from(t.flat());
})();
export function nearestNormal(x, y, z) {
  let best = -2, k = 0;
  for (let i = 0; i < 255; i++) { const d = NORMALS[i * 3] * x + NORMALS[i * 3 + 1] * y + NORMALS[i * 3 + 2] * z; if (d > best) { best = d; k = i; } }
  return k;
}

const COMPASS = ["north", "north-northeast", "northeast", "east-northeast", "east", "east-southeast", "southeast", "south-southeast", "south", "south-southwest", "southwest", "west-southwest", "west", "west-northwest", "northwest", "north-northwest"];
export const compassName = (deg) => COMPASS[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16];
