// ============================================================
// @nomideusz/svelte-search — Geo utilities
// ============================================================
// Haversine distance, bounding boxes, walking time, OSRM routing.
// Pure functions — no DB, no side effects.

const R = 6371; // Earth radius in km
const WALK_SPEED = 4.8; // km/h

/** Haversine distance in km between two points. */
export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Estimated walking time in minutes (1.3x for non-straight routes). */
export function walkingMinutes(km: number): number {
  return Math.round((km * 1.3) / WALK_SPEED * 60);
}

/** Bounding box for fast SQL pre-filter before exact Haversine. */
export function boundingBox(lat: number, lng: number, radiusKm: number) {
  const latD = radiusKm / 111.32;
  const lngD = radiusKm / (111.32 * Math.cos((lat * Math.PI) / 180));
  return { minLat: lat - latD, maxLat: lat + latD, minLng: lng - lngD, maxLng: lng + lngD };
}

/** Format distance: <1km → "850 m", ≥1km → "2.3 km" */
export function formatDistance(km: number): string {
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`;
}

/** Format walking time: <60 → "12 min walk", ≥60 → "1 hr 15 min walk" */
export function formatWalkingTime(min: number): string {
  if (min < 60) return `${min} min walk`;
  const h = Math.floor(min / 60), m = min % 60;
  return m ? `${h} hr ${m} min walk` : `${h} hr walk`;
}

/**
 * Get real walking route from OSRM. Call only for top N results.
 * Self-host OSRM with foot.lua profile for production.
 * Falls back gracefully to null on any error.
 */
export async function walkingRoute(
  fromLat: number, fromLng: number, toLat: number, toLng: number,
  osrmBase = 'https://router.project-osrm.org'
): Promise<{ distanceM: number; durationS: number } | null> {
  try {
    const url = `${osrmBase}/route/v1/foot/${fromLng},${fromLat};${toLng},${toLat}?overview=false`;
    const res = await fetch(url);
    const data = await res.json();
    if (data.code !== 'Ok' || !data.routes?.[0]) return null;
    return { distanceM: data.routes[0].distance, durationS: data.routes[0].duration };
  } catch { return null; }
}
