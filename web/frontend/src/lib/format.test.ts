import { describe, expect, it } from 'vitest';

import {
  confidenceLabel,
  formatCoords,
  formatFrp,
  formatKilobytes,
  formatMon,
  formatMonOrDash,
  formatSha256Prefix,
  formatTimeWIB,
  parseHoursInput,
  parseMonInput,
  relativeTime,
  shortAddress,
} from './format';

const MON = 10n ** 18n;

describe('formatMon', () => {
  it('renders zero as three decimals', () => {
    expect(formatMon(0n)).toBe('0.000');
  });

  it('renders 0.01 MON with three decimals', () => {
    expect(formatMon(10n ** 16n)).toBe('0.010');
  });

  it('renders a typical 0.05 MON bond', () => {
    expect(formatMon(5n * 10n ** 16n)).toBe('0.050');
  });

  it('keeps large pools exact — no float drift in the visible digits', () => {
    expect(formatMon(50_000n * MON)).toBe('50000.000');
    expect(formatMon(1_234_567_890_000_000_000_000_000n)).toBe('1234567.890');
  });

  it('rounds dust to three decimals', () => {
    expect(formatMon(1n)).toBe('0.000');
    expect(formatMon(999_999_999_999_999_999n)).toBe('1.000');
    // 0.0105 MON → 0.011 (toFixed rounds half away from zero at this magnitude)
    expect(formatMon(10_500_000_000_000_000n)).toBe('0.011');
  });
});

describe('formatMonOrDash', () => {
  it('shows an em dash for no pool', () => {
    expect(formatMonOrDash(0n)).toBe('—');
    expect(formatMonOrDash(null)).toBe('—');
    expect(formatMonOrDash(undefined)).toBe('—');
  });

  it('appends the MON symbol for a real pool', () => {
    expect(formatMonOrDash(5n * 10n ** 16n)).toBe('0.050 MON');
  });
});

describe('parseMonInput', () => {
  it('rejects empty and whitespace-only input', () => {
    expect(parseMonInput('')).toBeNull();
    expect(parseMonInput('   ')).toBeNull();
  });

  it('rejects non-numeric input', () => {
    expect(parseMonInput('abc')).toBeNull();
    expect(parseMonInput('0.0.5')).toBeNull();
  });

  it('rejects zero and negative amounts', () => {
    expect(parseMonInput('0')).toBeNull();
    expect(parseMonInput('0.000000000000000000')).toBeNull();
    expect(parseMonInput('-1')).toBeNull();
  });

  it('accepts a decimal MON amount', () => {
    expect(parseMonInput('0.05')).toBe(5n * 10n ** 16n);
    expect(parseMonInput(' 0.05 ')).toBe(5n * 10n ** 16n);
  });

  it('accepts 1 wei but not less', () => {
    expect(parseMonInput('0.000000000000000001')).toBe(1n);
  });
});

describe('parseHoursInput', () => {
  it('converts hours to whole seconds', () => {
    expect(parseHoursInput('6')).toBe(21_600);
    expect(parseHoursInput('1.5')).toBe(5_400);
    expect(parseHoursInput(' 24 ')).toBe(86_400);
  });

  it('rounds sub-second input down to 0 seconds, which callers treat as invalid', () => {
    // 0.0001 h = 0.36 s. The function returns 0 rather than null, but every caller
    // guards with `Boolean(ttlSeconds)`, so the action stays disabled.
    expect(parseHoursInput('0.0001')).toBe(0);
  });

  it('rejects empty, zero, negative and non-numeric input', () => {
    expect(parseHoursInput('')).toBeNull();
    expect(parseHoursInput('0')).toBeNull();
    expect(parseHoursInput('-2')).toBeNull();
    expect(parseHoursInput('abc')).toBeNull();
  });
});

describe('shortAddress', () => {
  it('collapses a full address to 0x1234…abcd', () => {
    const address = '0x1234567890abcdef1234567890abcdef12345678';
    expect(shortAddress(address)).toBe('0x1234…5678');
  });

  it('returns an empty string when there is no address', () => {
    expect(shortAddress()).toBe('');
    expect(shortAddress(null)).toBe('');
    expect(shortAddress('')).toBe('');
  });
});

describe('formatSha256Prefix', () => {
  const digest = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';

  it('takes the first 12 hex chars by default', () => {
    expect(formatSha256Prefix(digest)).toBe('sha256 ba7816bf8f01…');
  });

  it('honours an explicit prefix length', () => {
    expect(formatSha256Prefix(digest, 8)).toBe('sha256 ba7816bf…');
    expect(formatSha256Prefix(digest, 64)).toBe(`sha256 ${digest}…`);
  });
});

describe('formatCoords', () => {
  it('uses four decimals by default', () => {
    expect(formatCoords(-2.123456, 113.567891)).toBe('-2.1235, 113.5679');
  });

  it('honours an explicit precision', () => {
    expect(formatCoords(-2.123456, 113.567891, 2)).toBe('-2.12, 113.57');
  });
});

describe('formatFrp', () => {
  it('renders whole megawatts', () => {
    expect(formatFrp(42.4)).toBe('42 MW');
    expect(formatFrp(0)).toBe('0 MW');
    expect(formatFrp(127.6)).toBe('128 MW');
  });
});

describe('formatKilobytes', () => {
  it('renders whole kilobytes', () => {
    expect(formatKilobytes(143 * 1024)).toBe('143 KB');
    expect(formatKilobytes(0)).toBe('0 KB');
  });
});

describe('formatTimeWIB', () => {
  // 2026-10-24T06:05:00Z — UTC says 06:05, Jakarta says 13:05 on the same day.
  const SAME_DAY = 1_792_821_900;
  // 2026-10-24T18:30:00Z — UTC is still the 24th, Jakarta has rolled over to the 25th.
  const NEXT_DAY = 1_792_866_600;

  it('renders the Asia/Jakarta wall clock, not the machine locale', () => {
    // Pinned to UTC+7: 06:05Z must read as 13:05 in Jakarta. If the implementation
    // ever drops `timeZone`, this fails on any machine that is not UTC+7.
    expect(formatTimeWIB(SAME_DAY)).toMatch(/^24 Okt,? 13[.:]05$/);
  });

  it('applies the +07:00 offset across a date boundary', () => {
    // 18:30Z is 01:30 the next day in Jakarta.
    expect(formatTimeWIB(NEXT_DAY)).toMatch(/^25 Okt,? 01[.:]30$/);
  });

  it('is pure: the same timestamp always formats identically', () => {
    expect(formatTimeWIB(SAME_DAY)).toBe(formatTimeWIB(SAME_DAY));
  });
});

describe('relativeTime', () => {
  const NOW = 1_792_830_000_000; // fixed, so the assertions cannot flake

  const ago = (seconds: number): string => relativeTime(NOW / 1000 - seconds, NOW);

  it('collapses anything under a minute to "just now"', () => {
    expect(ago(0)).toBe('just now');
    expect(ago(59)).toBe('just now');
  });

  it('counts minutes, hours and days in words', () => {
    expect(ago(60)).toBe('1 min ago');
    expect(ago(45 * 60)).toBe('45 min ago');
    expect(ago(3 * 3600)).toBe('3 hours ago');
    expect(ago(23 * 3600)).toBe('23 hours ago');
    expect(ago(26 * 3600)).toBe('1 day ago');
    expect(ago(3 * 86_400)).toBe('3 days ago');
  });

  it('never counts backwards when the clock is skewed', () => {
    expect(relativeTime(NOW / 1000 + 600, NOW)).toBe('just now');
  });
});

describe('confidenceLabel', () => {
  it('maps the on-chain enum to words', () => {
    expect(confidenceLabel(0)).toBe('low confidence');
    expect(confidenceLabel(1)).toBe('nominal confidence');
    expect(confidenceLabel(2)).toBe('high confidence');
  });
});
