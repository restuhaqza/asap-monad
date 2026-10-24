import { describe, expect, it } from 'vitest';

import { hotspotHash, parseHotspotHash } from './deeplink';

describe('parseHotspotHash', () => {
  it('parses a plain hotspot deep link', () => {
    expect(parseHotspotHash('#h=5')).toBe(5);
    expect(parseHotspotHash('#h=123')).toBe(123);
  });

  it('parses the id when the hash carries extra params', () => {
    expect(parseHotspotHash('#h=5&x=1')).toBe(5);
    expect(parseHotspotHash('#x=1&h=7')).toBe(7);
  });

  it('returns null when there is no h=<digits> sequence', () => {
    expect(parseHotspotHash('#h=abc')).toBeNull();
    expect(parseHotspotHash('#h=')).toBeNull();
    expect(parseHotspotHash('')).toBeNull();
    expect(parseHotspotHash('#')).toBeNull();
  });

  it('returns null for unrelated hashes', () => {
    expect(parseHotspotHash('#other=1')).toBeNull();
    expect(parseHotspotHash('#x=1')).toBeNull();
  });

  it('rejects id 0', () => {
    expect(parseHotspotHash('#h=0')).toBeNull();
  });

  it('ignores a leading minus, so a negative id never parses', () => {
    // `-1` has no digits before the minus, so the regex cannot produce a negative.
    expect(parseHotspotHash('#h=-1')).toBeNull();
  });

  it('accepts trailing junk after the digits (lenient prefix match)', () => {
    // The matcher is deliberately unanchored so `#h=5&x=1` works; the consequence
    // is that `#h=5abc` also resolves to 5. Documented, not a regression.
    expect(parseHotspotHash('#h=5abc')).toBe(5);
  });
});

describe('hotspotHash', () => {
  it('round-trips through parseHotspotHash', () => {
    expect(hotspotHash(5)).toBe('#h=5');
    expect(parseHotspotHash(hotspotHash(42))).toBe(42);
  });
});
