/** SQLite `datetime('now')` = UTC, dạng `YYYY-MM-DD HH:MM:SS` — hiển thị giờ máy user. */
function parseDbTimestamp(value: string): Date | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  // SQLite UTC without timezone suffix
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(trimmed)) {
    const d = new Date(`${trimmed.replace(' ', 'T')}Z`);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(trimmed);
  return Number.isNaN(d.getTime()) ? null : d;
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

export function formatUnixTimestamp(unixSec: number): string {
  const d = new Date(unixSec * 1000);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('vi-VN', VI_OPTS);
}
