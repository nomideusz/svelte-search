// ============================================================
// @nomideusz/svelte-search — Geo utilities
// ============================================================
// Haversine distance, bounding boxes, walking time, display formatting.
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

/**
 * Format a distance for display: under 1 km in metres ("850 m"), else
 * kilometres to one decimal ("2.3 km", Polish "2,3 km"). `locale` is a BCP 47
 * tag; the default is fixed rather than the runtime's so SSR and the browser
 * print the same string.
 */
export function formatDistance(km: number, locale = 'en'): string {
  return km < 1
    ? new Intl.NumberFormat(locale, { style: 'unit', unit: 'meter', maximumFractionDigits: 0 }).format(Math.round(km * 1000))
    : new Intl.NumberFormat(locale, { style: 'unit', unit: 'kilometer', minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(km);
}

/**
 * Format a duration in minutes: "12 min", "1 hr 15 min", "2 hr" (en). Say
 * what it is ("walk", "spacer") in your own copy — the word is not a unit.
 */
export function formatWalkingTime(min: number, locale = 'en'): string {
  const unit = (n: number, u: 'hour' | 'minute') =>
    new Intl.NumberFormat(locale, { style: 'unit', unit: u, unitDisplay: 'short' }).format(n);
  if (min < 60) return unit(min, 'minute');
  const h = Math.floor(min / 60), m = min % 60;
  return m ? `${unit(h, 'hour')} ${unit(m, 'minute')}` : unit(h, 'hour');
}
