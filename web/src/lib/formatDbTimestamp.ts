/** SQLite `datetime('now')` = UTC; PostgreSQL `::text` = `YYYY-MM-DD HH:MM:SS.µs+00`. */
export function parseDbTimestamp(value: string | null | undefined): Date | null {
  if (value == null) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  // SQLite UTC without timezone suffix
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(trimmed)) {
    const d = new Date(`${trimmed.replace(' ', 'T')}Z`);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  // PostgreSQL timestamptz text: space separator, optional fractional seconds, +00 or +07:00
  const pg = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}(?:\.\d+)?)(Z|[+-]\d{2}(?::\d{2})?)?$/.exec(trimmed);
  if (pg) {
    const [, date, time, tzRaw] = pg;
    let tz = tzRaw ?? 'Z';
    if (/^[+-]\d{2}$/.test(tz)) tz = `${tz}:00`;
    const iso = tz === 'Z' ? `${date}T${time}Z` : `${date}T${time}${tz}`;
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(trimmed);
  return Number.isNaN(d.getTime()) ? null : d;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * Chart X-axis tick in the browser local clock (same as `toLocaleTimeString` / Cập nhật).
 * `hours` is the selected dashboard window: ≤1 → `HH:mm`, ≤24 → `HH:00`, else `dd/MM`.
 */
export function formatDbChartTick(value: string | null | undefined, hours: number): string {
  if (!value) return '';
  const d = parseDbTimestamp(value);
  if (!d) return value.trim();
  if (hours <= 1) return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  if (hours <= 24) return `${pad2(d.getHours())}:00`;
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}`;
}

const VI_OPTS: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
};

export function formatDbTimestamp(value: string | null | undefined): string {
  if (!value) return '—';
  const d = parseDbTimestamp(value);
  if (!d) return value.trim() || '—';
  return d.toLocaleString('vi-VN', VI_OPTS);
}

/** Cho CSV export — giữ ISO local readable. */
export function formatDbTimestampForExport(value: string | null | undefined): string {
  if (!value) return '';
  const d = parseDbTimestamp(value);
  if (!d) return value;
  return d.toLocaleString('vi-VN', { hour12: false });
}

/** Khóa gom nhóm theo ngày (local) — `YYYY-MM-DD`. */
export function dbDayKey(value: string | null | undefined): string | null {
  if (!value) return null;
  const d = parseDbTimestamp(value);
  if (!d) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const VI_DAY_OPTS: Intl.DateTimeFormatOptions = {
  weekday: 'long',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
};

/** Nhãn ngày tiếng Việt — vd "Thứ Sáu, 26/07/2026". */
export function formatDbDayLabel(value: string | null | undefined): string {
  if (!value) return '—';
  const d = parseDbTimestamp(value);
  if (!d) return value?.trim() || '—';
  return d.toLocaleDateString('vi-VN', VI_DAY_OPTS);
}

export function formatUnixTimestamp(unixSec: number): string {
  const d = new Date(unixSec * 1000);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('vi-VN', VI_OPTS);
}
