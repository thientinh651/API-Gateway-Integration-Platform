import { useEffect, useState } from 'react';
import { Copy, RefreshCw } from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '../../components/ui/sheet';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { toast } from 'sonner';
import {
  fetchTransactionLogDetail,
  type TransactionLogDetail,
} from '../../../lib/api';
import { toastApiError } from '../../../lib/apiClientError';
import { formatDbTimestamp } from '../../../lib/formatDbTimestamp';
import {
  formatBytes,
  getMethodColor,
  getStatusBadgeClass,
  prettyMaybeJson,
} from './logsShared';

type Props = {
  logId: number | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

function copyText(label: string, text: string) {
  void navigator.clipboard
    .writeText(text)
    .then(() => toast.success(`Đã copy ${label}`))
    .catch(() => toast.error('Không copy được'));
}

function HeadersBlock({ title, json }: { title: string; json: string | null }) {
  let entries: [string, string][] = [];
  if (json) {
    try {
      entries = Object.entries(JSON.parse(json) as Record<string, string>);
    } catch {
      entries = [];
    }
  }
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
          {title}
        </p>
        {json ? (
          <button
            type="button"
            className="text-[10px] text-muted-foreground hover:text-primary inline-flex items-center gap-1"
            onClick={() => copyText(title, json)}
          >
            <Copy className="w-3 h-3" /> Copy
          </button>
        ) : null}
      </div>
      {entries.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">Không có header</p>
      ) : (
        <div className="rounded-lg border border-border bg-slate-950/50 divide-y divide-border/60">
          {entries.map(([k, v]) => (
            <div key={k} className="grid grid-cols-[minmax(0,10rem)_1fr] gap-2 px-3 py-1.5">
              <span className="font-mono text-[11px] text-cyan-400 break-all">{k}</span>
              <span className="font-mono text-[11px] text-slate-300 break-all">{v}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function BodyBlock({
  title,
  body,
  bytes,
  truncated,
}: {
  title: string;
  body: string | null;
  bytes: number | null;
  truncated: boolean | null;
}) {
  const pretty = prettyMaybeJson(body);
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
          {title}
          <span className="ml-2 font-normal normal-case text-slate-500">{formatBytes(bytes)}</span>
          {truncated ? (
            <Badge className="ml-2 bg-amber-500/10 text-amber-400 border-amber-500/20 border text-[9px]">
              đã cắt bớt
            </Badge>
          ) : null}
        </p>
        {pretty ? (
          <button
            type="button"
            className="text-[10px] text-muted-foreground hover:text-primary inline-flex items-center gap-1"
            onClick={() => copyText(title, body ?? '')}
          >
            <Copy className="w-3 h-3" /> Copy
          </button>
        ) : null}
      </div>
      {pretty ? (
        <pre className="rounded-lg border border-border bg-slate-950/50 p-3 text-[11px] text-slate-300 overflow-auto max-h-72 whitespace-pre-wrap break-words">
          {pretty}
        </pre>
      ) : (
        <p className="text-xs text-muted-foreground italic">Không có body</p>
      )}
    </div>
  );
}

export function TransactionDetailSheet({ logId, open, onOpenChange }: Props) {
  const [detail, setDetail] = useState<TransactionLogDetail | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || logId == null) {
      setDetail(null);
      return;
    }
    let active = true;
    setLoading(true);
    fetchTransactionLogDetail(logId)
      .then((d) => {
        if (active) setDetail(d);
      })
      .catch((e) => {
        if (active) toastApiError(e);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [open, logId]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-2xl overflow-hidden flex flex-col">
        <SheetHeader className="border-b border-border">
          <SheetTitle className="text-white">Chi tiết transaction</SheetTitle>
          <SheetDescription>
            {detail ? (
              <span className="font-mono text-[11px]">{detail.request_id}</span>
            ) : (
              'Request / Response upstream'
            )}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-auto px-4 pb-6 space-y-5">
          {loading && !detail ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground">
              <RefreshCw className="w-5 h-5 animate-spin mr-2" /> Đang tải…
            </div>
          ) : !detail ? (
            <p className="py-16 text-center text-muted-foreground">Không có dữ liệu.</p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2 pt-2">
                <Badge className={`${getMethodColor(detail.method)} border font-mono`}>
                  {detail.method}
                </Badge>
                <Badge className={`${getStatusBadgeClass(detail.status)} border font-mono`}>
                  {detail.status}
                </Badge>
                <span className="text-xs text-slate-400">{detail.duration_ms}ms</span>
                {detail.outcome !== 'success' ? (
                  <Badge className="bg-red-500/10 text-red-400 border-red-500/20 border text-[10px]">
                    {detail.outcome}
                  </Badge>
                ) : null}
              </div>

              <dl className="grid grid-cols-[minmax(0,7rem)_1fr] gap-x-3 gap-y-1.5 text-xs">
                <dt className="text-muted-foreground">Đường dẫn</dt>
                <dd className="font-mono text-slate-300 break-all">{detail.path}</dd>
                <dt className="text-muted-foreground">Upstream</dt>
                <dd className="font-mono text-slate-300 break-all">
                  {detail.upstream_url ?? detail.upstream ?? '—'}
                </dd>
                <dt className="text-muted-foreground">Route</dt>
                <dd className="text-slate-300">{detail.route_id != null ? `#${detail.route_id}` : '—'}</dd>
                <dt className="text-muted-foreground">Client</dt>
                <dd className="text-slate-300">
                  {detail.api_key_masked ?? '—'}
                  {detail.client_key_id != null ? ` · client #${detail.client_key_id}` : ''}
                </dd>
                <dt className="text-muted-foreground">IP</dt>
                <dd className="font-mono text-slate-300">{detail.client_ip ?? '—'}</dd>
                <dt className="text-muted-foreground">Middleware</dt>
                <dd className="font-mono text-slate-300">{detail.reason}</dd>
                <dt className="text-muted-foreground">Thời gian</dt>
                <dd className="text-slate-300">{formatDbTimestamp(detail.created_at)}</dd>
              </dl>

              <div className="space-y-3">
                <p className="text-xs font-bold text-white">Request</p>
                <HeadersBlock title="Request headers" json={detail.req_headers} />
                <BodyBlock
                  title="Request body"
                  body={detail.req_body}
                  bytes={detail.req_bytes}
                  truncated={detail.req_truncated}
                />
              </div>

              <div className="space-y-3">
                <p className="text-xs font-bold text-white">Response</p>
                <HeadersBlock title="Response headers" json={detail.resp_headers} />
                <BodyBlock
                  title="Response body"
                  body={detail.resp_body}
                  bytes={detail.resp_bytes}
                  truncated={detail.resp_truncated}
                />
              </div>
            </>
          )}
        </div>

        <div className="border-t border-border p-3 flex justify-end">
          <Button variant="outline" size="sm" className="border-border" onClick={() => onOpenChange(false)}>
            Đóng
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
