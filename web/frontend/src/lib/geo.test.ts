import { describe, expect, it } from 'vitest';

import { STATUS_EXPIRED } from './config';
import { fromE6, markerFillOpacity, markerRadius, markerTooltip, toE6 } from './geo';

describe('toE6', () => {
  it('scales decimal degrees to the on-chain int32 representation', () => {
    expect(toE6(-2.1234)).toBe(-2_123_400);
    expect(toE6(113.5678)).toBe(113_567_800);
    expect(toE6(0)).toBe(0);
    expect(toE6(1)).toBe(1_000_000);
  });

  it('truncates toward zero like the pusher, it does not round', () => {
    expect(toE6(0.1234567)).toBe(123_456);
    expect(toE6(-0.1234567)).toBe(-123_456);
  });

  it('keeps the sign, so southern latitudes stay south', () => {
    expect(toE6(-2.5) < 0).toBe(true);
  });

  it('documents the float truncation drift on negative 6-decimal coords', () => {
    // -8.123456 * 1e6 is -8123455.999999999 in IEEE-754, so truncation lands one
    // micro-degree high: 1e-6° ≈ 11 cm. Harmless against a 25 km radius, but it
    // means the conversion is not an exact round trip for every input.
    expect(toE6(-8.123456)).toBe(-8_123_455);
    expect(Math.abs(fromE6(toE6(-8.123456)) - -8.123456)).toBeLessThanOrEqual(1e-6);
  });
});

describe('fromE6', () => {
  it('scales back to decimal degrees', () => {
    expect(fromE6(-2_123_400)).toBe(-2.1234);
    expect(fromE6(113_567_800)).toBe(113.5678);
    expect(fromE6(0)).toBe(0);
  });

  it('round-trips realistic Indonesian coordinates', () => {
    const samples = [-11, -2.1234, 0, 3.5, 5.987654, 95.123456, 113.5678, 140.999999];
    for (const degrees of samples) {
      expect(fromE6(toE6(degrees))).toBe(degrees);
    }
  });
});

describe('markerRadius', () => {
  it('never goes below 3 px', () => {
    expect(markerRadius(0)).toBe(3);
    expect(markerRadius(-5)).toBe(3);
  });

  it('grows with fire radiative power', () => {
    expect(markerRadius(9)).toBeCloseTo(4, 6);
    expect(markerRadius(100)).toBeGreaterThan(markerRadius(25));
  });

  it('is clamped at 10 px for a huge fire', () => {
    expect(markerRadius(10_000)).toBe(10);
    expect(markerRadius(1e9)).toBe(10);
  });
});

describe('markerFillOpacity', () => {
  it('fades an expired fire', () => {
    expect(markerFillOpacity(STATUS_EXPIRED)).toBe(0.5);
  });

  it('keeps live fires solid', () => {
    expect(markerFillOpacity(1)).toBe(0.8);
    expect(markerFillOpacity(3)).toBe(0.8);
  });
});

describe('markerTooltip', () => {
  it('builds the id · FRP tooltip', () => {
    expect(markerTooltip(12, 42.4)).toBe('#12 · 42 MW');
  });
});
