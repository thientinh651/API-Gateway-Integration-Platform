/** Format audit `details` for table preview + full dialog. */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One row in detail dialog — like Route/Traffic list. */
export type AuditDetailRow = {
  method?: string;
  path?: string;
  reason?: string;
  /** Fallback plain text when not parseable as method/path */
  text: string;
};

export type FormattedAuditDetails = {
  preview: string;
  summary: string;
  rows: AuditDetailRow[];
  /** Legacy UUID dump — ẩn list, chỉ hiện tóm tắt */
  hideIds: boolean;
};

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

/** `GET /v1/api/get · upstream_status:503` hoặc `1. GET /path · reason` */
function parseRequestLine(line: string): AuditDetailRow {
  const cleaned = line.replace(/^\d+\.\s*/, '').trim();
  const sep = cleaned.indexOf(' · ');
  const left = sep >= 0 ? cleaned.slice(0, sep).trim() : cleaned;
  const reason = sep >= 0 ? cleaned.slice(sep + 3).trim() : undefined;
  const sp = left.indexOf(' ');
  if (sp > 0) {
    const method = left.slice(0, sp);
    const path = left.slice(sp + 1).trim();
    if (/^[A-Z]+$/.test(method) && path.startsWith('/')) {
      return { method, path, reason, text: cleaned };
    }
  }
  return { text: cleaned };
}

/**
 * Turn raw DB details into readable preview + dialog rows.
 * Legacy bulk-discard (comma UUIDs): chỉ tóm tắt số lượng — không hiện UUID.
 */
export function formatAuditDetails(
  raw: string | null | undefined,
  action?: string | null,
): FormattedAuditDetails | null {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return null;

  const uuidList = looksLikeUuidList(trimmed);
  if (uuidList) {
    const n = uuidList.length;
    const isDiscard =
      action === 'proxy_queue_bulk_discard' || action === 'proxy_queue_discard';
    return {
      preview: isDiscard
        ? `Đã xóa ${n} bản ghi Proxy Queue (DLQ)`
        : `${n} mục`,
      summary: isDiscard
        ? `Đã xóa ${n} bản ghi khỏi Proxy Queue`
        : `Có ${n} mục`,
      rows: [],
      hideIds: true,
    };
  }

  if (trimmed.includes('\n')) {
    const lines = trimmed
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    const head = lines[0] ?? trimmed;
    const body = lines.length > 1 ? lines.slice(1) : [];
    // Body toàn UUID (format cũ có header) → ẩn
    const onlyUuids =
      body.length > 0 &&
      body.every((l) => {
        const t = l.replace(/^\d+\.\s*/, '').trim();
        return UUID_RE.test(t) || t.startsWith('queue_id:');
      });
    if (onlyUuids) {
      return {
        preview: head.length > 90 ? `${head.slice(0, 90).trim()}…` : head,
        summary: head,
        rows: [],
        hideIds: true,
      };
    }
    return {
      preview: head.length > 90 ? `${head.slice(0, 90).trim()}…` : head,
      summary: head,
      rows: body.map(parseRequestLine),
      hideIds: false,
    };
  }

  if (UUID_RE.test(trimmed) || trimmed.startsWith('queue_id:')) {
    const isDiscard = action === 'proxy_queue_discard';
    return {
      preview: isDiscard ? `Đã xóa 1 bản ghi DLQ` : trimmed.slice(0, 40),
      summary: isDiscard ? 'Đã xóa 1 bản ghi khỏi Proxy Queue' : 'Chi tiết',
      rows: [],
      hideIds: true,
    };
  }

  const row = parseRequestLine(trimmed);
  if (row.method && row.path) {
    return {
      preview: `${row.method} ${row.path}`,
      summary: 'Chi tiết thao tác',
      rows: [row],
      hideIds: false,
    };
  }

  return {
    preview: trimmed.length > 90 ? `${trimmed.slice(0, 90).trim()}…` : trimmed,
    summary: 'Chi tiết thao tác',
    rows: [{ text: trimmed }],
    hideIds: false,
  };
}
