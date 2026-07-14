/** Format audit `details` for inline table display (no dialog). */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function splitCsvIds(raw: string): string[] {
  return raw
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function looksLikeUuidList(raw: string): string[] | null {
  const parts = splitCsvIds(raw);
  if (parts.length < 2) return null;
  if (!parts.every((p) => UUID_RE.test(p))) return null;
  return parts;
}

/**
 * Turn raw DB details into one readable line for the Chi tiết column.
 * Legacy bulk-discard (comma UUIDs): chỉ tóm tắt số lượng — không hiện UUID.
 */
export function formatAuditDetails(
  raw: string | null | undefined,
  action?: string | null,
): string | null {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return null;

  const uuidList = looksLikeUuidList(trimmed);
  if (uuidList) {
    const n = uuidList.length;
    const isDiscard =
      action === 'proxy_queue_bulk_discard' || action === 'proxy_queue_discard';
    return isDiscard
      ? `Đã xóa ${n} bản ghi Proxy Queue (DLQ)`
      : `${n} mục`;
  }

  if (trimmed.includes('\n')) {
    const lines = trimmed
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    const head = lines[0] ?? trimmed;
    const body = lines.length > 1 ? lines.slice(1) : [];
    const onlyUuids =
      body.length > 0 &&
      body.every((l) => {
        const t = l.replace(/^\d+\.\s*/, '').trim();
        return UUID_RE.test(t) || t.startsWith('queue_id:');
      });
    if (onlyUuids) return head;
    // Hiện đủ trên 1 cột: header + các dòng request, cách bằng ·
    return [head, ...body.map((l) => l.replace(/^\d+\.\s*/, ''))].join(' · ');
  }

  if (UUID_RE.test(trimmed) || trimmed.startsWith('queue_id:')) {
    const isDiscard = action === 'proxy_queue_discard';
    return isDiscard ? 'Đã xóa 1 bản ghi DLQ' : trimmed.slice(0, 40);
  }

  return trimmed;
}
