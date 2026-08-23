/**
 * Chuỗi thời gian cho dashboard.
 *
 * Bucket được khóa theo **mốc thời gian** (epoch ms), không theo nhãn đã format:
 * hai bucket khác nhau có thể ra cùng nhãn (`HH:00` trong cửa sổ 24 giờ) và sẽ
 * đè nhau nếu dùng nhãn làm khóa.
 *
 * Mốc bucket + nhãn tính theo giờ Việt Nam để trùng khít `DASHBOARD_SERIES_TZ`
 * mà `src/db.rs` dùng khi `date_trunc`, bất kể máy xem đang ở múi nào.
 */
import { parseDbTimestamp } from './formatDbTimestamp';

/** Việt Nam cố định +07:00, không có DST — nên offset là hằng số. */
const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

export type BucketUnit = 'minute' | 'hour' | 'day';

const STEP_MS: Record<BucketUnit, number> = {
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
};

export function bucketStep(unit: BucketUnit): number {
  return STEP_MS[unit];
}

/** Mốc đầu bucket (epoch ms) theo giờ VN — tương ứng `date_trunc` ở backend. */
export function truncToVnBucket(ms: number, unit: BucketUnit): number {
  const step = STEP_MS[unit];
  return Math.floor((ms + VN_OFFSET_MS) / step) * step - VN_OFFSET_MS;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** Nhãn trục X theo giờ VN: phút `HH:mm`, giờ `HH:00`, ngày `dd/MM`. */
export function bucketLabel(ms: number, unit: BucketUnit): string {
  const d = new Date(ms + VN_OFFSET_MS);
  if (unit === 'minute') return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
  if (unit === 'hour') return `${pad2(d.getUTCHours())}:00`;
  return `${pad2(d.getUTCDate())}/${pad2(d.getUTCMonth() + 1)}`;
}

/** Nhãn đầy đủ cho tooltip — có ngày kèm giờ. */
export function bucketFullLabel(ms: number, unit: BucketUnit): string {
  const d = new Date(ms + VN_OFFSET_MS);
  const day = `${pad2(d.getUTCDate())}/${pad2(d.getUTCMonth() + 1)}`;
  if (unit === 'day') return day;
  if (unit === 'hour') return `${day} ${pad2(d.getUTCHours())}:00`;
  return `${day} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
}

export type DashboardPresetId = '1h' | '1d' | '1w' | '1m';

export type DashboardPreset = {
  id: DashboardPresetId;
  label: string;
  unit: BucketUnit;
  /** Số bucket hiển thị, gồm cả bucket đang chạy. */
  buckets: number;
};

export const DASHBOARD_PRESETS: readonly DashboardPreset[] = [
  { id: '1h', label: '1 giờ', unit: 'minute', buckets: 60 },
  { id: '1d', label: '1 ngày', unit: 'hour', buckets: 24 },
  { id: '1w', label: '1 tuần', unit: 'day', buckets: 7 },
  { id: '1m', label: '1 tháng', unit: 'day', buckets: 30 },
];

export const DEFAULT_PRESET_ID: DashboardPresetId = '1d';

export function findPreset(id: string): DashboardPreset {
  return (
    DASHBOARD_PRESETS.find((p) => p.id === id) ??
    DASHBOARD_PRESETS.find((p) => p.id === DEFAULT_PRESET_ID)!
  );
}

export type DashboardWindow = {
  from: string;
  to: string;
  unit: BucketUnit;
};

/**
 * Cửa sổ căn đúng biên bucket: `buckets - 1` bucket đầy + bucket hiện tại đang chạy.
 * Nhờ vậy không có bucket đầu bị cắt dở, và tổng các bucket = tổng cửa sổ.
 */
export function presetWindow(preset: DashboardPreset, now: Date = new Date()): DashboardWindow {
  const to = now.getTime();
  const current = truncToVnBucket(to, preset.unit);
  const from = current - (preset.buckets - 1) * STEP_MS[preset.unit];
  return {
    from: new Date(from).toISOString(),
    to: new Date(to).toISOString(),
    unit: preset.unit,
  };
}

/** Bản sao của `DashRange::duration_hours` (src/db.rs) để suy ra bucket backend đã dùng. */
export function durationHours(fromIso: string, toIso: string): number {
  const from = parseDbTimestamp(fromIso);
  const to = parseDbTimestamp(toIso);
  if (!from || !to) return 1;
  const secs = Math.max(1, Math.floor((to.getTime() - from.getTime()) / 1000));
  const hours = Math.floor((secs + 3599) / 3600);
  return Math.min(8760, Math.max(1, hours));
}

/** Bản sao của `series_trunc` (src/db.rs). */
export function bucketUnitForHours(hours: number): BucketUnit {
  if (hours <= 1) return 'minute';
  if (hours <= 24) return 'hour';
  return 'day';
}

/** Bucket backend thực sự trả về cho cửa sổ này — dùng để đối chiếu với preset. */
export function resolveBackendUnit(fromIso: string, toIso: string): BucketUnit {
  return bucketUnitForHours(durationHours(fromIso, toIso));
}

function bucketStarts(window: DashboardWindow): number[] {
  const from = parseDbTimestamp(window.from);
  const to = parseDbTimestamp(window.to);
  if (!from || !to) return [];
  const step = STEP_MS[window.unit];
  const first = truncToVnBucket(from.getTime(), window.unit);
  const last = truncToVnBucket(to.getTime(), window.unit);
  const starts: number[] = [];
  for (let s = first; s <= last; s += step) {
    starts.push(s);
  }
  return starts;
}

export type TrafficPoint = {
  time: string;
  requests: number;
  errors: number;
};

export type TrafficBucket = {
  key: number;
  label: string;
  fullLabel: string;
  requests: number;
  errors: number;
  ok: number;
  /** Bucket cuối chưa đủ độ dài — số liệu còn đang tăng. */
  partial: boolean;
};

/**
 * Ghép điểm từ API vào đúng bucket. Bucket không có log → 0 request (đúng nghĩa:
 * không có request nào). Trùng bucket thì **cộng dồn**, không ghi đè, để tổng
 * trên chart luôn khớp tổng API trả về.
 */
export function buildTrafficSeries(
  points: readonly TrafficPoint[],
  window: DashboardWindow,
): TrafficBucket[] {
  const totals = new Map<number, { requests: number; errors: number }>();
  for (const p of points) {
    const at = parseDbTimestamp(p.time);
    if (!at) continue;
    const key = truncToVnBucket(at.getTime(), window.unit);
    const prev = totals.get(key);
    if (prev) {
      prev.requests += p.requests;
      prev.errors += p.errors;
    } else {
      totals.set(key, { requests: p.requests, errors: p.errors });
    }
  }
  const step = STEP_MS[window.unit];
  const end = parseDbTimestamp(window.to)?.getTime() ?? 0;
  return bucketStarts(window).map((key) => {
    const hit = totals.get(key);
    const requests = hit?.requests ?? 0;
    const errors = hit?.errors ?? 0;
    return {
      key,
      label: bucketLabel(key, window.unit),
      fullLabel: bucketFullLabel(key, window.unit),
      requests,
      errors,
      ok: Math.max(0, requests - errors),
      partial: key + step > end,
    };
  });
}

export type LatencyPoint = {
  time: string;
  p50: number;
  p95: number;
  p99: number;
};

export type LatencyBucket = {
  key: number;
  label: string;
  fullLabel: string;
  /** `null` = không có request nào trong bucket, không phải 0 ms. */
  p50: number | null;
  p95: number | null;
  p99: number | null;
};

export function buildLatencySeries(
  points: readonly LatencyPoint[],
  window: DashboardWindow,
): LatencyBucket[] {
  const byBucket = new Map<number, LatencyPoint>();
  for (const p of points) {
    const at = parseDbTimestamp(p.time);
    if (!at) continue;
    byBucket.set(truncToVnBucket(at.getTime(), window.unit), p);
  }
  return bucketStarts(window).map((key) => {
    const hit = byBucket.get(key);
    return {
      key,
      label: bucketLabel(key, window.unit),
      fullLabel: bucketFullLabel(key, window.unit),
      p50: hit ? hit.p50 : null,
      p95: hit ? hit.p95 : null,
      p99: hit ? hit.p99 : null,
    };
  });
}

export function sumRequests(series: readonly TrafficBucket[]): number {
  return series.reduce((s, b) => s + b.requests, 0);
}

export function hasLatencySamples(series: readonly LatencyBucket[]): boolean {
  return series.some((b) => b.p50 != null || b.p95 != null || b.p99 != null);
}

/** Giãn nhãn trục X để không in trùng khi bucket quá dày. */
export function tickInterval(count: number, maxTicks = 12): number {
  if (count <= maxTicks) return 0;
  return Math.ceil(count / maxTicks) - 1;
}
