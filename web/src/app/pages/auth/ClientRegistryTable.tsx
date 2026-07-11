import { Copy, Download, Settings2, Trash2, UserCheck, UserX } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { Button } from '../../components/ui/button';
import { ConfirmDangerButton } from '../../components/forms/ConfirmDangerButton';
import { Card } from '../../components/ui/card';
import { Badge } from '../../components/ui/badge';
import { Checkbox } from '../../components/ui/checkbox';
import { Switch } from '../../components/ui/switch';
import type { GatewayRouteRow } from '../../../lib/gatewayRoutes';
import { formatDbTimestamp, formatDbTimestampForExport } from '../../../lib/formatDbTimestamp';
import {
  authModeLabel,
  authModeLabelShort,
  authorizationLabel,
  authorizationLabelShort,
  type ClientRegistryRow,
} from './clientRegistryTypes';
import { integrationTypeLabel } from './clientKeyIntegrationTypes';

function exportRegistryCsv(clients: ClientRegistryRow[], routes: GatewayRouteRow[]) {
  const routePath = (id: number) => routes.find((r) => r.id === id)?.path ?? `#${id}`;
  const header = [
    'id',
    'name',
    'api_key',
    'auth_mode',
    'integration_type',
    'status',
    'rate_limit_per_min',
    'allowed_routes',
    'last_used_at',
  ];
  const lines = clients.map((c) => [
    c.id,
    c.name,
    c.apiKey,
    c.authMode,
    c.integrationType,
    c.isActive ? 'active' : 'disabled',
    String(c.rateLimitPerMinute),
    c.allowedRouteIds.length
      ? c.allowedRouteIds.map(routePath).join('; ')
      : 'all tenant routes',
    c.lastUsedAt ? formatDbTimestampForExport(c.lastUsedAt) : '',
  ]);
  const csv = [header, ...lines]
    .map((row) => row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','))
    .join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `client-registry-${Date.now()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

type Props = {
  clients: ClientRegistryRow[];
  routes: GatewayRouteRow[];
  traffic24h?: Map<string, number>;
  onConfigure: (client: ClientRegistryRow) => void;
  onDelete: (id: string) => void;
  onBulkStatus?: (ids: string[], status: 'active' | 'disabled') => Promise<void>;
  onStatusChange?: (id: string, active: boolean) => Promise<void>;
  onBulkDelete?: (ids: string[]) => Promise<void>;
  canDelete?: boolean;
  canManage?: boolean;
};

export function ClientRegistryTable({
  clients,
  routes,
  traffic24h,
  onConfigure,
  onDelete,
  onBulkStatus,
  onStatusChange,
  onBulkDelete,
  canDelete = true,
  canManage = false,
}: Props) {
  const navigate = useNavigate();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [statusBusy, setStatusBusy] = useState<Set<string>>(new Set());

  const allSelected = clients.length > 0 && selected.size === clients.length;
  const someSelected = selected.size > 0;

  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(clients.map((c) => c.id)));
  };

  const runBulk = async (status: 'active' | 'disabled') => {
    if (!onBulkStatus || selected.size === 0) return;
    setBulkBusy(true);
    try {
      await onBulkStatus([...selected], status);
      setSelected(new Set());
    } finally {
      setBulkBusy(false);
    }
  };

  const selectedCount = useMemo(() => selected.size, [selected]);

  const selectedSummary = useMemo(() => {
    const rows = clients.filter((c) => selected.has(c.id));
    const names = rows.map((c) => c.name);
    const preview = names.slice(0, 4).join(', ');
    const more = names.length > 4 ? ` và ${names.length - 4} client khác` : '';
    return { count: rows.length, preview: `${preview}${more}` };
  }, [clients, selected]);

  const runBulkDelete = async () => {
    if (!onBulkDelete || selected.size === 0) return;
    setBulkBusy(true);
    try {
      await onBulkDelete([...selected]);
      setSelected(new Set());
    } finally {
      setBulkBusy(false);
    }
  };

  const toggleStatus = async (client: ClientRegistryRow, active: boolean) => {
    if (!onStatusChange || statusBusy.has(client.id)) return;
    setStatusBusy((prev) => new Set(prev).add(client.id));
    try {
      await onStatusChange(client.id, active);
    } finally {
      setStatusBusy((prev) => {
        const next = new Set(prev);
        next.delete(client.id);
        return next;
      });
    }
  };

  const canSelect = canManage || (canDelete && !!onBulkDelete);

  const canCopyKey = (k: string) => k.startsWith('avaso_');

  if (clients.length === 0) {
    return (
      <Card className="rounded-2xl p-10 text-center bg-card/80 border-dashed border-2 border-border">
        <p className="text-sm text-muted-foreground">Client Registry trống</p>
      </Card>
    );
  }

  return (
    <Card className="rounded-2xl overflow-hidden bg-card/80 border-border min-w-0">
      <div className="px-6 py-4 border-b border-border flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 min-w-0">
          <h3 className="font-bold text-white text-sm shrink-0">Client Registry</h3>
          <span className="text-[11px] text-muted-foreground shrink-0">
            {clients.length} client
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2 justify-end min-w-0 ml-auto">
          {someSelected && (canManage || canDelete) ? (
            <>
              <span className="text-xs text-slate-400 shrink-0">{selectedCount} đã chọn</span>
              {canManage ? (
                <>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs border-emerald-500/40 text-emerald-400"
                    disabled={bulkBusy}
                    onClick={() => void runBulk('active')}
                  >
                    <UserCheck className="w-3.5 h-3.5 mr-1" />
                    Bật active
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs border-amber-500/40 text-amber-400"
                    disabled={bulkBusy}
                    onClick={() => void runBulk('disabled')}
                  >
                    <UserX className="w-3.5 h-3.5 mr-1" />
                    Tắt (disabled)
                  </Button>
                </>
              ) : null}
              {canDelete && onBulkDelete ? (
                <ConfirmDangerButton
                  title={`Xóa ${selectedSummary.count} client đã chọn?`}
                  description={`Xóa vĩnh viễn: ${selectedSummary.preview}. Mọi request từ các client này sẽ bị từ chối — không khôi phục.`}
                  confirmLabel={`Xóa ${selectedSummary.count} client`}
                  pendingLabel="Đang xóa…"
                  disabled={bulkBusy}
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs border-red-500/40 text-red-400 hover:bg-red-500/10"
                  onConfirm={runBulkDelete}
                >
                  <Trash2 className="w-3.5 h-3.5 mr-1" />
                  Xóa đã chọn
                </ConfirmDangerButton>
              ) : null}
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-8 text-xs text-muted-foreground"
                disabled={bulkBusy}
                onClick={() => setSelected(new Set())}
              >
                Bỏ chọn
              </Button>
            </>
          ) : null}
          <Button
            variant="outline"
            size="sm"
            className="border-border text-xs shrink-0"
            onClick={() => exportRegistryCsv(clients, routes)}
          >
            <Download className="w-3.5 h-3.5 mr-1.5" />
            Xuất CSV
          </Button>
        </div>
      </div>
      <div className="min-w-0">
        <table className="w-full table-fixed text-left border-collapse">
          <colgroup>
            {canSelect ? <col className="w-9" /> : null}
            <col className="w-[13%]" />
            <col className="w-[14%]" />
            <col className="w-[9%]" />
            <col className="w-[14%]" />
            <col className="w-[9%]" />
            <col className="w-[6%]" />
            <col className="w-[10%]" />
            <col className="w-[8%]" />
            <col className="w-[17%]" />
          </colgroup>
          <thead className="bg-slate-900/50 text-[10px] uppercase text-muted-foreground font-bold">
            <tr>
              {canSelect ? (
                <th className="px-2 py-2.5">
                  <Checkbox
                    aria-label="Chọn tất cả"
                    checked={allSelected ? true : someSelected ? 'indeterminate' : false}
                    onCheckedChange={() => toggleAll()}
                  />
                </th>
              ) : null}
              <th className="px-3 py-2.5">Client</th>
              <th className="px-3 py-2.5">Client ID</th>
              <th className="px-3 py-2.5">Xác thực</th>
              <th className="px-3 py-2.5">Phân quyền</th>
              <th className="px-3 py-2.5">Rate limit</th>
              <th className="px-3 py-2.5">24h</th>
              <th className="px-3 py-2.5">Lần dùng</th>
              <th className="px-3 py-2.5">Trạng thái</th>
              <th className="px-2 py-2.5 text-right">Thao tác</th>
            </tr>
          </thead>
          <tbody className="text-sm">
            {clients.map((client) => (
              <tr key={client.id} className="border-b border-border/50 hover:bg-primary/5">
                {canSelect ? (
                  <td className="px-2 py-3 w-9 align-middle">
                    <Checkbox
                      checked={selected.has(client.id)}
                      onCheckedChange={() => toggleOne(client.id)}
                      aria-label={`Chọn ${client.name}`}
                      onClick={(e) => e.stopPropagation()}
                    />
                  </td>
                ) : null}
                <td className="px-3 py-3 align-middle max-w-0">
                  <p className="text-slate-200 font-medium truncate">{client.name}</p>
                  {client.integrationType !== 'app' ? (
                    <Badge
                      variant="outline"
                      className="mt-1 text-[10px] border-border text-muted-foreground max-w-full truncate"
                    >
                      {integrationTypeLabel(client.integrationType)}
                    </Badge>
                  ) : null}
                </td>
                <td className="px-3 py-3 align-middle max-w-0">
                  <span className="font-mono text-xs text-slate-400 truncate block" title={client.apiKey}>
                    {client.apiKey}
                  </span>
                </td>
                <td className="px-3 py-3 align-middle max-w-0 overflow-hidden">
                  <Badge
                    variant="outline"
                    className="text-[10px] border-emerald-500/25 text-emerald-400 bg-emerald-500/5 max-w-full truncate inline-block"
                    title={authModeLabel(client.authMode)}
                  >
                    {authModeLabelShort(client.authMode)}
                  </Badge>
                </td>
                <td className="px-3 py-3 align-middle max-w-0 overflow-hidden">
                  {client.allowedRouteIds.length === 0 ? (
                    <Badge
                      variant="outline"
                      className="text-[10px] border-sky-500/30 text-sky-300 bg-sky-500/10 max-w-full truncate inline-block"
                      title="ACL rỗng = client được gọi mọi route trong tenant"
                    >
                      Full tenant access
                    </Badge>
                  ) : (
                    <Badge
                      variant="outline"
                      className="text-[10px] border-amber-500/30 text-amber-300 bg-amber-500/10 max-w-full truncate inline-block"
                      title={authorizationLabel(client.allowedRouteIds)}
                    >
                      {authorizationLabelShort(client.allowedRouteIds)}
                    </Badge>
                  )}
                </td>
                <td className="px-3 py-3 align-middle text-xs text-slate-400 whitespace-nowrap">
                  {client.rateLimitPerMinute > 0
                    ? `${client.rateLimitPerMinute}/phút`
                    : 'Mặc định: 0'}
                </td>
                <td className="px-3 py-3 align-middle text-xs text-slate-400 font-mono whitespace-nowrap">
                  {traffic24h?.has(client.id) ? (
                    <button
                      type="button"
                      className="hover:text-cyan-400 hover:underline"
                      onClick={() => navigate(`/logs?kind=traffic&client_key_id=${client.id}`)}
                    >
                      {traffic24h.get(client.id)}
                    </button>
                  ) : (
                    '—'
                  )}
                </td>
                <td className="px-3 py-3 align-middle text-xs text-slate-500 whitespace-nowrap">
                  {client.lastUsedAt ? formatDbTimestamp(client.lastUsedAt) : '—'}
                </td>
                <td className="px-3 py-3 align-middle">
                  {canManage && onStatusChange ? (
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={client.isActive}
                        disabled={statusBusy.has(client.id)}
                        onCheckedChange={(checked) => void toggleStatus(client, checked)}
                        aria-label={client.isActive ? 'Tắt client' : 'Bật client'}
                      />
                      <span
                        className={`text-[10px] whitespace-nowrap ${
                          client.isActive ? 'text-emerald-400' : 'text-slate-400'
                        }`}
                      >
                        {client.isActive ? 'Active' : 'Tắt'}
                      </span>
                    </div>
                  ) : client.isActive ? (
                    <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/25 border text-[10px] whitespace-nowrap">
                      Active
                    </Badge>
                  ) : (
                    <Badge className="bg-slate-500/10 text-slate-400 border-slate-500/25 border text-[10px] whitespace-nowrap">
                      Disabled
                    </Badge>
                  )}
                </td>
                <td className="px-2 py-3 align-middle">
                  <div className="flex justify-end items-center gap-0.5">
                    {canManage ? (
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Cấu hình"
                        onClick={() => onConfigure(client)}
                        className="h-7 w-7 text-primary hover:bg-primary/10 shrink-0"
                      >
                        <Settings2 className="w-3.5 h-3.5" />
                      </Button>
                    ) : null}
                    {canCopyKey(client.apiKey) ? (
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Copy Client ID"
                        onClick={() => {
                          void navigator.clipboard.writeText(client.apiKey);
                          toast.success('Đã copy Client ID');
                        }}
                        className="h-7 w-7 text-blue-400 hover:text-blue-300 hover:bg-blue-500/10 shrink-0"
                      >
                        <Copy className="w-3.5 h-3.5" />
                      </Button>
                    ) : null}
                    {canDelete ? (
                      <ConfirmDangerButton
                        title="Xóa client khỏi registry?"
                        description={`Xóa "${client.name}" — không khôi phục. Mọi request từ client này sẽ bị từ chối.`}
                        confirmLabel="Xóa client"
                        onConfirm={() => onDelete(client.id)}
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-red-400 hover:text-red-300 hover:bg-red-500/10 shrink-0"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </ConfirmDangerButton>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
