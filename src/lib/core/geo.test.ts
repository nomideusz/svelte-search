import { describe, it, expect, vi, afterEach } from 'vitest';
import { haversineKm, walkingMinutes, boundingBox, formatDistance, formatWalkingTime, walkingRoute } from './geo.js';

describe('haversineKm', () => {
  it('returns 0 for same point', () => {
    expect(haversineKm(50.0, 20.0, 50.0, 20.0)).toBe(0);
  });

  it('calculates Kraków → Warsaw (~252 km)', () => {
    const d = haversineKm(50.0647, 19.9450, 52.2297, 21.0122);
    expect(d).toBeGreaterThan(240);
    expect(d).toBeLessThan(260);
  });

  it('calculates short distance (~1 km)', () => {
    // ~1 km apart in Kraków
    const d = haversineKm(50.0647, 19.9450, 50.0647, 19.9590);
    expect(d).toBeGreaterThan(0.5);
    expect(d).toBeLessThan(2);
  });
});

describe('walkingMinutes', () => {
  it('estimates walking time with detour factor', () => {
    // 1 km * 1.3 / 4.8 km/h * 60 = ~16 min
    expect(walkingMinutes(1)).toBe(16);
  });

  it('returns 0 for 0 distance', () => {
    expect(walkingMinutes(0)).toBe(0);
  });
});

describe('boundingBox', () => {
  it('creates symmetric bounding box', () => {
    const bbox = boundingBox(50.0, 20.0, 10);
    expect(bbox.minLat).toBeLessThan(50.0);
    expect(bbox.maxLat).toBeGreaterThan(50.0);
    expect(bbox.minLng).toBeLessThan(20.0);
    expect(bbox.maxLng).toBeGreaterThan(20.0);
    // Symmetric around center
    expect(bbox.maxLat - 50.0).toBeCloseTo(50.0 - bbox.minLat, 5);
  });
});

describe('formatDistance', () => {
  it('formats < 1km in meters', () => {
    expect(formatDistance(0.85)).toBe('850 m');
  });

  it('formats >= 1km in km', () => {
    expect(formatDistance(2.3)).toBe('2.3 km');
  });
});

describe('formatWalkingTime', () => {
  it('formats < 60 min', () => {
    expect(formatWalkingTime(12)).toBe('12 min walk');
  });

  it('formats >= 60 min with hours', () => {
    expect(formatWalkingTime(75)).toBe('1 hr 15 min walk');
  });

  it('formats exact hours', () => {
    expect(formatWalkingTime(120)).toBe('2 hr walk');
  });
});

describe('walkingRoute', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('returns a route on a good response', async () => {
    vi.stubGlobal('fetch', async () => ({
      json: async () => ({ code: 'Ok', routes: [{ distance: 820, duration: 611 }] }),
    }));
    expect(await walkingRoute(52.2, 21.0, 52.3, 21.1)).toEqual({ distanceM: 820, durationS: 611 });
  });

  it('degrades to null instead of hanging when the router stalls', async () => {
    // A hang is not an error — without the abort this would never settle, and
    // in an SSR load that is a hung request rather than a missed estimate.
    vi.stubGlobal('fetch', (_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      }));
    const started = Date.now();
    expect(await walkingRoute(52.2, 21.0, 52.3, 21.1, undefined, 50)).toBeNull();
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('returns null when OSRM reports no route', async () => {
    vi.stubGlobal('fetch', async () => ({ json: async () => ({ code: 'NoRoute' }) }));
    expect(await walkingRoute(52.2, 21.0, 52.3, 21.1)).toBeNull();
  });

  it('returns null when the request throws', async () => {
    vi.stubGlobal('fetch', async () => { throw new Error('network'); });
    expect(await walkingRoute(52.2, 21.0, 52.3, 21.1)).toBeNull();
  });
});
