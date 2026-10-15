import { describe, it, expect } from 'vitest';
import { entryInstant, localDate, localTime, parseClock, parseIsoDate } from '../../src/core/dates.js';

describe('parseIsoDate', () => {
  it('accepts a real calendar date', () => {
    expect(parseIsoDate('2026-11-18')).toBe('2026-11-18');
    expect(parseIsoDate('2028-02-29')).toBe('2028-02-29');
  });

  it.each(['2026-02-31', '1', '07/01/2026', 'July 1 2026', '2026-13-01', '2026-1-5', '2026-11-18T10:00', ' 2026-11-18', '', '2027-02-29'])(
    'rejects %j',
    (s) => {
      expect(parseIsoDate(s)).toBeNull();
    },
  );

  it('rejects anything that is not a string', () => {
    for (const v of [1, 20261118, null, undefined, new Date(), ['2026-11-18']]) expect(parseIsoDate(v)).toBeNull();
  });
});

describe('clock and local formatting', () => {
  it('accepts only a 24-hour HH:MM', () => {
    expect(parseClock('16:48')).toBe('16:48');
    for (const s of ['24:00', '12:60', '9:05', '16:48:00']) expect(parseClock(s)).toBeNull();
  });

  it('formats an instant on the local clock', () => {
    const d = new Date(2026, 0, 5, 7, 3);
    expect(localDate(d)).toBe('2026-01-05');
    expect(localTime(d)).toBe('07:03');
  });
});

describe('entryInstant', () => {
  it('uses the local date and time when the heading has both', () => {
    expect(entryInstant('2026-10-11', '16:48').getTime()).toBe(new Date(2026, 9, 11, 16, 48).getTime());
  });

  it('puts a date-only entry at the end of that day when no modification time is known', () => {
    expect(entryInstant('2026-10-11', null).getTime()).toBe(new Date(2026, 9, 11, 23, 59, 59).getTime());
  });

  it('clamps a date-only entry to the modification time', () => {
    const mtime = new Date(2026, 9, 11, 9, 30);
    expect(entryInstant('2026-10-11', null, mtime).getTime()).toBe(mtime.getTime());
    // An older entry is not dragged forward to the modification time.
    expect(entryInstant('2026-10-01', null, mtime).getTime()).toBe(new Date(2026, 9, 1, 23, 59, 59).getTime());
  });
});
