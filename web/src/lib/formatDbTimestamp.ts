/** SQLite `datetime('now')` = UTC, dạng `YYYY-MM-DD HH:MM:SS` — hiển thị giờ máy user. */
export function formatDbTimestamp(value: string | null | undefined): string {
  if (!value) return '—';
  const trimmed = value.trim();
  if (!trimmed) return '—';

  const asUtc = trimmed.includes('T') ? trimmed : `${trimmed.replace(' ', 'T')}Z`;
  const d = new Date(asUtc);
  if (Number.isNaN(d.getTime())) return value;

  return d.toLocaleString('vi-VN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

/** Cho CSV export — giữ ISO local readable. */
export function formatDbTimestampForExport(value: string | null | undefined): string {
  if (!value) return '';
  const trimmed = value.trim();
  const asUtc = trimmed.includes('T') ? trimmed : `${trimmed.replace(' ', 'T')}Z`;
  const d = new Date(asUtc);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString('vi-VN', { hour12: false });
}
