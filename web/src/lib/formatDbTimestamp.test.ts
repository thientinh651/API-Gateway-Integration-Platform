import { describe, expect, it } from 'vitest';
import { formatDbTimestamp, formatDbTimestampForExport } from './formatDbTimestamp';

describe('formatDbTimestamp', () => {
  it('returns em dash for empty', () => {
    expect(formatDbTimestamp(null)).toBe('—');
    expect(formatDbTimestamp('')).toBe('—');
    expect(formatDbTimestamp('   ')).toBe('—');
  });

  it('parses SQLite UTC datetime as local vi-VN', () => {
    const utc = '2026-05-30 04:53:43';
    const expected = new Date('2026-05-30T04:53:43Z').toLocaleString('vi-VN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
    expect(formatDbTimestamp(utc)).toBe(expected);
  });

  it('accepts ISO UTC strings', () => {
    const iso = '2026-05-30T04:53:43Z';
    expect(formatDbTimestamp(iso)).not.toBe('—');
  });

  it('parses ISO with timezone offset', () => {
    const iso = '2026-05-30T11:53:43+07:00';
    expect(formatDbTimestamp(iso)).toContain('2026');
  });

  it('returns raw string when unparseable', () => {
    expect(formatDbTimestamp('not-a-date')).toBe('not-a-date');
  });
});

describe('formatDbTimestampForExport', () => {
  it('returns empty for null', () => {
    expect(formatDbTimestampForExport(null)).toBe('');
  });

  it('formats valid UTC for CSV', () => {
    const out = formatDbTimestampForExport('2026-05-30 04:53:43');
    expect(out).toContain('2026');
    expect(out.length).toBeGreaterThan(10);
  });
});
