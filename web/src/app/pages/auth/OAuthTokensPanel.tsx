import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Ban, Copy, RefreshCw, ShieldCheck, Timer, Zap } from 'lucide-react';
import { Card } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import { ConfirmDangerButton } from '../../components/forms/ConfirmDangerButton';
import {
  fetchClientKeys,
  fetchOAuthTokens,
  revokeOAuthTokenJti,
  type OAuthTokenAuditRow,
} from '../../../lib/api';
import { toastApiError } from '../../../lib/apiClientError';
import { formatDbTimestamp } from '../../../lib/formatDbTimestamp';

type Props = {
  canRevoke: boolean;
  refreshKey?: number;
};

type ClientNameMaps = {
  byId: Map<number, string>;
  byClientId: Map<string, string>;
};

function subjectLabel(row: OAuthTokenAuditRow, maps: ClientNameMaps): string {
  if (row.client_key_id != null) {
    const name = maps.byId.get(row.client_key_id);
    if (name) return name;
  }
  const cid = row.subject.startsWith('client:')
    ? row.subject.slice('client:'.length)
    : row.subject;
  const byCid = maps.byClientId.get(cid);
  if (byCid) return byCid;
  if (row.user_id != null) {
    return `${row.subject} · user #${row.user_id}`;
  }
  return row.subject;
}

export function OAuthTokensPanel({ canRevoke, refreshKey = 0 }: Props) {
  const [rows, setRows] = useState<OAuthTokenAuditRow[]>([]);
  const [nameMaps, setNameMaps] = useState<ClientNameMaps>({
    byId: new Map(),
    byClientId: new Map(),
  });
  const [loading, setLoading] = useState(true);
  const [activeOnly, setActiveOnly] = useState<'true' | 'false'>('true');

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [res, clients] = await Promise.all([
        fetchOAuthTokens({
          active_only: activeOnly === 'true',
          limit: 200,
        }),
        fetchClientKeys().catch(() => []),
      ]);
      setRows(res.tokens);
      const byId = new Map<number, string>();
      const byClientId = new Map<string, string>();
      for (const c of clients) {
        byId.set(c.id, c.name);
        if (c.api_key) byClientId.set(c.api_key, c.name);
      }
      setNameMaps({ byId, byClientId });
    } catch (e) {
      toastApiError(e);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [activeOnly]);

  useEffect(() => {
    void reload();
  }, [reload, refreshKey]);

  const handleRevoke = async (jti: string) => {
    try {
      await revokeOAuthTokenJti(jti);
      toast.success('Đã thu hồi token');
      await reload();
    } catch (e) {
      toastApiError(e);
    }
  };

  const liveCount = rows.filter(
    (r) => !r.revoked_at && new Date(r.expires_at).getTime() >= Date.now(),
  ).length;
  const revokedCount = rows.filter((r) => r.revoked_at).length;
  const expiredCount = rows.filter(
    (r) => !r.revoked_at && new Date(r.expires_at).getTime() < Date.now(),
  ).length;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Card className="p-4 rounded-xl bg-card/80 border-border">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-emerald-500/10">
              <Zap className="w-4 h-4 text-emerald-400" />
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Live</p>
              <p className="text-2xl font-bold text-white">{loading ? '—' : liveCount}</p>
            </div>
          </div>
        </Card>
        <Card className="p-4 rounded-xl bg-card/80 border-border">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-amber-500/10">
              <ShieldCheck className="w-4 h-4 text-amber-400" />
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Revoked</p>
              <p className="text-2xl font-bold text-white">{loading ? '—' : revokedCount}</p>
            </div>
          </div>
        </Card>
        <Card className="p-4 rounded-xl bg-card/80 border-border">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-slate-500/10">
              <Timer className="w-4 h-4 text-slate-400" />
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Hết hạn</p>
              <p className="text-2xl font-bold text-white">{loading ? '—' : expiredCount}</p>
            </div>
          </div>
        </Card>
      </div>

      <div className="rounded-lg border border-border/60 bg-slate-950/40 px-4 py-3 text-sm text-muted-foreground leading-relaxed">
        Mỗi lần cấp JWT được ghi audit tại đây. Thu hồi một token → Redis blacklist + đánh dấu{' '}
        <code className="text-slate-300">revoked_at</code>. Thu hồi toàn bộ client: mở cấu hình client →
        &quot;Thu hồi mọi token&quot;.
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Select value={activeOnly} onValueChange={(v) => setActiveOnly(v as 'true' | 'false')}>
          <SelectTrigger className="w-[180px] bg-input border-border">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-card border-border">
            <SelectItem value="true">Đang hoạt động</SelectItem>
            <SelectItem value="false">Tất cả (gồm đã revoke)</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" className="border-border" onClick={() => void reload()}>
          <RefreshCw className="w-4 h-4 mr-2" />
          Làm mới
        </Button>
        <span className="text-xs text-muted-foreground">{rows.length} bản ghi</span>
      </div>

      <Card className="border-border bg-card/50 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground uppercase tracking-wide">
                <th className="px-4 py-3 font-medium">Token ID</th>
                <th className="px-4 py-3 font-medium">Subject</th>
                <th className="px-4 py-3 font-medium">Grant</th>
                <th className="px-4 py-3 font-medium">Scope</th>
                <th className="px-4 py-3 font-medium">Thời gian cấp</th>
                <th className="px-4 py-3 font-medium">Hết hạn</th>
                <th className="px-4 py-3 font-medium">IP</th>
                <th className="px-4 py-3 font-medium">Trạng thái</th>
                {canRevoke ? <th className="px-4 py-3 font-medium w-28" /> : null}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={canRevoke ? 9 : 8} className="px-4 py-8 text-center text-muted-foreground">
                    Đang tải…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={canRevoke ? 9 : 8} className="px-4 py-8 text-center text-muted-foreground">
                    Chưa có token nào được ghi.
                  </td>
                </tr>
              ) : (
                rows.map((row) => {
                  const revoked = Boolean(row.revoked_at);
                  const expired = new Date(row.expires_at).getTime() < Date.now();
                  const active = !revoked && !expired;
                  return (
                    <tr
                      key={row.jti}
                      className="border-b border-border/40 last:border-0 hover:bg-primary/5"
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5 max-w-[140px]">
                          <code className="text-[10px] font-mono text-slate-500 truncate" title={row.jti}>
                            {row.jti.slice(0, 8)}…
                          </code>
                          <button
                            type="button"
                            className="text-slate-500 hover:text-slate-300 shrink-0"
                            onClick={() => {
                              void navigator.clipboard.writeText(row.jti);
                              toast.success('Đã copy');
                            }}
                          >
                            <Copy className="w-3 h-3" />
                          </button>
                        </div>
                      </td>
                      <td
                        className="px-4 py-3 text-xs text-slate-200 max-w-[220px] truncate"
                        title={row.subject}
                      >
                        {subjectLabel(row, nameMaps)}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-400">{row.grant_type}</td>
                      <td className="px-4 py-3 text-xs font-mono text-slate-400 max-w-[120px] truncate">
                        {row.scope || '—'}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-400 whitespace-nowrap">
                        {formatDbTimestamp(row.issued_at)}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-400 whitespace-nowrap">
                        {formatDbTimestamp(row.expires_at)}
                      </td>
                      <td className="px-4 py-3 text-xs font-mono text-slate-500">
                        {row.source_ip ?? '—'}
                      </td>
                      <td className="px-4 py-3">
                        {revoked ? (
                          <Badge variant="outline" className="text-amber-400 border-amber-500/30">
                            Revoked
                          </Badge>
                        ) : expired ? (
                          <Badge variant="outline" className="text-slate-400 border-slate-500/30">
                            Hết hạn
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-emerald-400 border-emerald-500/30">
                            Live
                          </Badge>
                        )}
                      </td>
                      {canRevoke ? (
                        <td className="px-4 py-3">
                          {active ? (
                            <ConfirmDangerButton
                              title="Thu hồi token?"
                              description="Token này sẽ bị vô hiệu ngay — client phải đổi token mới."
                              confirmLabel="Thu hồi"
                              variant="outline"
                              size="sm"
                              className="border-border text-amber-400 hover:text-amber-300"
                              onConfirm={() => handleRevoke(row.jti)}
                            >
                              <Ban className="w-3.5 h-3.5 mr-1" />
                              Revoke
                            </ConfirmDangerButton>
                          ) : null}
                        </td>
                      ) : null}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
