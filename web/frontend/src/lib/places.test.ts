import { describe, expect, it } from 'vitest';

import {
  bearingWord,
  distanceKm,
  formatPlaceRail,
  formatPlaceTitle,
  nearestPlace,
} from './places';

describe('nearestPlace', () => {
  it('resolves a Central Kalimantan hotspot to Palangka Raya', () => {
    // Hotspot #5 on chain.
    const match = nearestPlace(-2.1234, 113.5678);

    expect(match.name).toBe('Palangka Raya');
    expect(match.province).toBe('Central Kalimantan');
    expect(match.km).toBeGreaterThan(25);
    expect(match.km).toBeLessThan(60);
  });

  it('resolves a Riau peat fire to a Riau town, not to a Sumatran capital', () => {
    const match = nearestPlace(0.4, 102.1);

    expect(['Rengat', 'Pekanbaru', 'Bengkalis']).toContain(match.name);
    expect(match.province).toBe('Riau');
  });

  it('resolves a South Papua fire across the Arafura coast', () => {
    const match = nearestPlace(-8.2, 140.3);

    expect(match.province).toBe('South Papua');
    expect(match.km).toBeLessThan(120);
  });

  it('always reports a distance and a compass point', () => {
    const match = nearestPlace(-6.2, 106.8);

    expect(match.km).toBeGreaterThanOrEqual(0);
    expect(['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']).toContain(match.bearing);
  });

  it('caches by rounded position so a re-render does not re-scan the table', () => {
    expect(nearestPlace(-1.23456, 110.98765)).toBe(nearestPlace(-1.23454, 110.98761));
  });
});

describe('distanceKm', () => {
  it('is zero for a point against itself', () => {
    expect(distanceKm(-2.2, 113.9, -2.2, 113.9)).toBe(0);
  });

  it('matches a known pair: Jakarta to Bandung is about 120 km', () => {
    const km = distanceKm(-6.21, 106.85, -6.92, 107.62);
    expect(km).toBeGreaterThan(100);
    expect(km).toBeLessThan(140);
  });

  it('is symmetric', () => {
    const there = distanceKm(-2.2, 113.9, -6.9, 107.6);
    const back = distanceKm(-6.9, 107.6, -2.2, 113.9);
    expect(Math.abs(there - back)).toBeLessThan(0.001);
  });
});

describe('bearingWord', () => {
  it('names the four cardinal directions', () => {
    expect(bearingWord(0, 0, 0, 1)).toBe('E');
    expect(bearingWord(0, 0, 0, -1)).toBe('W');
    expect(bearingWord(0, 0, 1, 0)).toBe('N');
    expect(bearingWord(0, 0, -1, 0)).toBe('S');
  });

  it('names the diagonals', () => {
    expect(bearingWord(0, 0, 1, 1)).toBe('NE');
    expect(bearingWord(0, 0, -1, -1)).toBe('SW');
  });
});

describe('formatPlaceTitle / formatPlaceRail', () => {
  it('drops the distance when the fire is effectively in town', () => {
    const close = { name: 'Sampit', province: 'Central Kalimantan', km: 4, bearing: 'N' };
    expect(formatPlaceTitle(close)).toBe('Near Sampit');
    expect(formatPlaceRail(close)).toBe('Sampit');
  });

  it('gives a distance and a bearing when it is not', () => {
    const far = { name: 'Palangka Raya', province: 'Central Kalimantan', km: 58, bearing: 'NE' };
    expect(formatPlaceTitle(far)).toBe('≈58 km NE of Palangka Raya');
    expect(formatPlaceRail(far)).toBe('Palangka Raya · 58 km NE');
  });

  it('keeps the town first in the rail, where the column is narrow', () => {
    const match = nearestPlace(-2.1234, 113.5678);
    expect(formatPlaceRail(match).startsWith('Palangka Raya')).toBe(true);
  });
});
