import { describe, expect, it } from 'vitest';
import {
  DASHBOARD_PRESETS,
  bucketLabel,
  buildLatencySeries,
  buildTrafficSeries,
  findPreset,
  hasLatencySamples,
  presetWindow,
  resolveBackendUnit,
  sumRequests,
  tickInterval,
  truncToVnBucket,
  type DashboardWindow,
} from './dashboardSeries';

const NOWS = [
  '2026-08-18T12:34:56.789Z',
  '2026-08-18T17:00:00.000Z',
  '2026-08-01T00:00:00.000Z',
  '2026-03-01T16:59:59.999Z',
];

describe('truncToVnBucket', () => {
  it('cắt ngày theo nửa đêm giờ VN (17:00Z hôm trước)', () => {
    const midnightVn = Date.parse('2026-08-18T17:00:00Z');
    expect(truncToVnBucket(midnightVn, 'day')).toBe(midnightVn);
    expect(truncToVnBucket(midnightVn - 1, 'day')).toBe(Date.parse('2026-08-17T17:00:00Z'));
    expect(truncToVnBucket(Date.parse('2026-08-19T10:00:00Z'), 'day')).toBe(midnightVn);
  });

  it('cắt giờ và phút', () => {
    const ms = Date.parse('2026-08-18T12:34:56.700Z');
    expect(truncToVnBucket(ms, 'hour')).toBe(Date.parse('2026-08-18T12:00:00Z'));
    expect(truncToVnBucket(ms, 'minute')).toBe(Date.parse('2026-08-18T12:34:00Z'));
  });
});

describe('bucketLabel', () => {
  it('luôn là giờ VN, không phụ thuộc máy xem', () => {
    const ms = Date.parse('2026-08-18T12:00:00Z');
    expect(bucketLabel(ms, 'hour')).toBe('19:00');
    expect(bucketLabel(ms, 'minute')).toBe('19:00');
    expect(bucketLabel(ms, 'day')).toBe('18/08');
    expect(bucketLabel(Date.parse('2026-08-18T17:00:00Z'), 'day')).toBe('19/08');
  });
});

describe('presetWindow', () => {
  it('mỗi preset ra đúng số bucket, nhãn không trùng', () => {
    for (const preset of DASHBOARD_PRESETS) {
      for (const iso of NOWS) {
        const win = presetWindow(preset, new Date(iso));
        const series = buildTrafficSeries([], win);
        const labels = series.map((b) => b.label);
        expect(series).toHaveLength(preset.buckets);
        expect(new Set(labels).size).toBe(preset.buckets);
      }
    }
  });

  it('bucket đơn vị khớp với series_trunc của backend', () => {
    for (const preset of DASHBOARD_PRESETS) {
      for (const iso of NOWS) {
        const win = presetWindow(preset, new Date(iso));
        expect(resolveBackendUnit(win.from, win.to)).toBe(preset.unit);
      }
    }
  });

  it('mốc đầu cửa sổ nằm đúng biên bucket — không có cột cắt dở ở đầu', () => {
    for (const preset of DASHBOARD_PRESETS) {
      const win = presetWindow(preset, new Date('2026-08-18T12:34:56.789Z'));
      const from = Date.parse(win.from);
      expect(truncToVnBucket(from, preset.unit)).toBe(from);
    }
  });

  it('chỉ bucket cuối được đánh dấu đang chạy', () => {
    const win = presetWindow(findPreset('1d'), new Date('2026-08-18T12:34:56.789Z'));
    const series = buildTrafficSeries([], win);
    expect(series.filter((b) => b.partial)).toHaveLength(1);
    expect(series[series.length - 1].partial).toBe(true);
  });
});

describe('buildTrafficSeries', () => {
  it('tổng trên chart bằng tổng API trả về', () => {
    const win = presetWindow(findPreset('1d'), new Date('2026-08-18T12:34:56.789Z'));
    const points = [
      { time: '2026-08-17T14:00:00Z', requests: 100, errors: 4 },
      { time: '2026-08-18T05:00:00Z', requests: 7, errors: 0 },
      { time: '2026-08-18T12:00:00Z', requests: 5, errors: 5 },
    ];
    const series = buildTrafficSeries(points, win);
    expect(sumRequests(series)).toBe(112);
    expect(series.reduce((s, b) => s + b.errors, 0)).toBe(9);
  });

  it('hai bucket cùng nhãn HH:00 không đè nhau (lỗi cũ làm mất dữ liệu)', () => {
    const win: DashboardWindow = {
      from: '2026-08-17T12:00:00Z',
      to: '2026-08-18T12:30:00Z',
      unit: 'hour',
    };
    const points = [
      { time: '2026-08-17T12:00:00Z', requests: 100, errors: 0 },
      { time: '2026-08-18T12:00:00Z', requests: 5, errors: 0 },
    ];
    const series = buildTrafficSeries(points, win);
    const sameLabel = series.filter((b) => b.label === '19:00');

    expect(sameLabel).toHaveLength(2);
    expect(sameLabel.map((b) => b.requests)).toEqual([100, 5]);
    expect(sumRequests(series)).toBe(105);
  });

  it('bucket không có log là 0 request', () => {
    const win = presetWindow(findPreset('1h'), new Date('2026-08-18T12:34:56.789Z'));
    const series = buildTrafficSeries([{ time: '2026-08-18T12:34:00Z', requests: 3, errors: 1 }], win);
    expect(series.filter((b) => b.requests > 0)).toHaveLength(1);
    expect(series.filter((b) => b.requests === 0)).toHaveLength(59);
  });

  it('cộng dồn khi nhiều điểm rơi vào cùng bucket', () => {
    const win: DashboardWindow = {
      from: '2026-08-18T00:00:00Z',
      to: '2026-08-18T01:00:00Z',
      unit: 'hour',
    };
    const series = buildTrafficSeries(
      [
        { time: '2026-08-18T00:10:00Z', requests: 4, errors: 1 },
        { time: '2026-08-18T00:40:00Z', requests: 6, errors: 2 },
      ],
      win,
    );
    expect(sumRequests(series)).toBe(10);
    expect(series[0]).toMatchObject({ requests: 10, errors: 3, ok: 7 });
  });

  it('ok = requests - errors, không âm', () => {
    const win: DashboardWindow = {
      from: '2026-08-18T00:00:00Z',
      to: '2026-08-18T00:30:00Z',
      unit: 'hour',
    };
    const series = buildTrafficSeries([{ time: '2026-08-18T00:05:00Z', requests: 2, errors: 5 }], win);
    expect(series[0].ok).toBe(0);
  });
});

describe('buildLatencySeries', () => {
  const win: DashboardWindow = {
    from: '2026-08-18T00:00:00Z',
    to: '2026-08-18T02:30:00Z',
    unit: 'hour',
  };

  it('bucket không có sample trả null, không phải 0 ms', () => {
    const series = buildLatencySeries([{ time: '2026-08-18T01:00:00Z', p50: 32, p95: 314, p99: 1132 }], win);
    expect(series).toHaveLength(3);
    expect(series[0]).toMatchObject({ p50: null, p95: null, p99: null });
    expect(series[1]).toMatchObject({ p50: 32, p95: 314, p99: 1132 });
    expect(series[2].p50).toBeNull();
  });

  it('giữ được số 0 thật khi API trả 0', () => {
    const series = buildLatencySeries([{ time: '2026-08-18T00:00:00Z', p50: 0, p95: 0, p99: 0 }], win);
    expect(series[0].p50).toBe(0);
    expect(hasLatencySamples(series)).toBe(true);
  });

  it('không có điểm nào thì coi như chưa có dữ liệu', () => {
    expect(hasLatencySamples(buildLatencySeries([], win))).toBe(false);
  });
});

describe('tickInterval', () => {
  it('không giãn khi ít mốc', () => {
    expect(tickInterval(7)).toBe(0);
    expect(tickInterval(12)).toBe(0);
  });

  it('giãn khi nhiều mốc', () => {
    expect(tickInterval(24)).toBe(1);
    expect(tickInterval(60)).toBe(4);
  });
});

describe('findPreset', () => {
  it('id lạ thì về mặc định 1 ngày', () => {
    expect(findPreset('khong-ton-tai').id).toBe('1d');
    expect(findPreset('1w').label).toBe('1 tuần');
  });
});
