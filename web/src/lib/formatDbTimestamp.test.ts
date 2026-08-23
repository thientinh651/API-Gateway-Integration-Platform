import { describe, expect, it } from 'vitest';
import {
  formatDbChartTick,
  formatDbTimestamp,
  formatDbTimestampForExport,
} from './formatDbTimestamp';

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

  it('parses PostgreSQL timestamptz text with microseconds', () => {
    const pg = '2026-07-10 04:35:17.367968+00';
    const out = formatDbTimestamp(pg);
    expect(out).toContain('2026');
    expect(out).not.toContain('367968');
    expect(out).not.toBe(pg);
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

describe('formatDbChartTick', () => {
  const utc = '2026-08-18T10:35:00Z';
  const local = new Date(utc);

  it('1h window uses local HH:mm — not the UTC clock digits', () => {
    const expected = `${String(local.getHours()).padStart(2, '0')}:${String(local.getMinutes()).padStart(2, '0')}`;
    expect(formatDbChartTick(utc, 1)).toBe(expected);
    expect(formatDbChartTick('2026-08-18T17:35:00+07:00', 1)).toBe(expected);
  });

  it('24h window uses local HH:00', () => {
    const expected = `${String(local.getHours()).padStart(2, '0')}:00`;
    expect(formatDbChartTick(utc, 24)).toBe(expected);
  });

  it('multi-day window uses local dd/MM', () => {
    const expected = `${String(local.getDate()).padStart(2, '0')}/${String(local.getMonth() + 1).padStart(2, '0')}`;
    expect(formatDbChartTick(utc, 72)).toBe(expected);
  });

  it('returns empty for missing value', () => {
    expect(formatDbChartTick(null, 1)).toBe('');
    expect(formatDbChartTick('', 1)).toBe('');
  });
});
