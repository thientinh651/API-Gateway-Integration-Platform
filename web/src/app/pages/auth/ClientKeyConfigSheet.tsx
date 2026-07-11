import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Copy, FlaskConical, Gauge, KeyRound, Shield, UserCheck, Activity, Ban } from 'lucide-react';
import { toast } from 'sonner';
import type { GatewayRouteRow } from '../../../lib/gatewayRoutes';
import {
  fetchClientKeyTraffic,
  patchClientKey,
  putClientKeyRoutes,
  revokeClientTokens,
  rotateClientKey,
  type ClientKeyTrafficStats,
} from '../../../lib/api';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Badge } from '../../components/ui/badge';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '../../components/ui/sheet';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { ConfirmDangerButton } from '../../components/forms/ConfirmDangerButton';
import { EnterSubmitForm } from '../../components/forms/EnterSubmitForm';
import { Checkbox } from '../../components/ui/checkbox';
import type { ClientRegistryRow } from './clientRegistryTypes';
import { authModeLabel } from './clientRegistryTypes';
import { integrationTypeLabel } from './clientKeyIntegrationTypes';
import { defaultNumberHandlers, parseDefaultNumber } from '../../../lib/zeroDefaultNumberInput';

type Props = {
  client: ClientRegistryRow | null;
  routes: GatewayRouteRow[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
  canManage: boolean;
};

export function ClientKeyConfigSheet({
  client,
  routes,
  open,
  onOpenChange,
  onSaved,
  canManage,
}: Props) {
  const [name, setName] = useState('');
  const [active, setActive] = useState(true);
  const [rateLimit, setRateLimit] = useState('0');
  const [rateLimitDefault, setRateLimitDefault] = useState('0');
  const [selectedRoutes, setSelectedRoutes] = useState<number[]>([]);
  const [restrictRoutes, setRestrictRoutes] = useState(false);
  const [saving, setSaving] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [revokingTokens, setRevokingTokens] = useState(false);
  const [rotatedSecret, setRotatedSecret] = useState('');
  const [rotateDialogOpen, setRotateDialogOpen] = useState(false);
  const [traffic, setTraffic] = useState<ClientKeyTrafficStats | null>(null);
  const [trafficLoading, setTrafficLoading] = useState(false);
  const [trafficError, setTrafficError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !client) {
      setTraffic(null);
      setTrafficLoading(false);
      setTrafficError(null);
      return;
    }
    setTrafficLoading(true);
    setTrafficError(null);
    void fetchClientKeyTraffic(Number(client.id))
      .then(setTraffic)
      .catch(() => {
        setTraffic(null);
        setTrafficError('load_failed');
      })
      .finally(() => setTrafficLoading(false));
  }, [open, client]);

  useEffect(() => {
    if (!client) return;
    setName(client.name);
    setActive(client.isActive);
    const rl = String(client.rateLimitPerMinute);
    setRateLimit(rl);
    setRateLimitDefault(rl);
    setSelectedRoutes(client.allowedRouteIds);
    setRestrictRoutes(client.allowedRouteIds.length > 0);
  }, [client]);

  const selectAllRoutes = () => setSelectedRoutes(routes.map((r) => r.id));
  const clearRoutes = () => setSelectedRoutes([]);

  const ratePresets = [0, 100, 500, 1000];

  const toggleRoute = (id: number) => {
    setSelectedRoutes((prev) =>
      prev.includes(id) ? prev.filter((r) => r !== id) : [...prev, id],
    );
  };

  const handleSave = async () => {
    if (!client || !canManage) return;
    const trimmedName = name.trim();
    if (!trimmedName) {
      toast.error('Nhập tên client');
      return;
    }
    const rl = Number.parseInt(parseDefaultNumber(rateLimit, rateLimitDefault), 10);
    if (!Number.isFinite(rl) || rl < 0 || rl > 1_000_000) {
      toast.error('Rate limit phải từ 0 đến 1.000.000 req/phút');
      return;
    }
    if (restrictRoutes && selectedRoutes.length === 0) {
      toast.error('Chọn ít nhất một route hoặc bật "Tất cả route"');
      return;
    }
    setSaving(true);
    try {
      await patchClientKey(Number(client.id), {
        name: trimmedName,
        status: active ? 'active' : 'disabled',
        rate_limit_per_min: rl,
      });
      await putClientKeyRoutes(
        Number(client.id),
        restrictRoutes ? selectedRoutes : [],
      );
      onSaved();
      onOpenChange(false);
      toast.success('Đã cập nhật client');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const handleRotate = async () => {
    if (!client || !canManage) return;
    setRotating(true);
    try {
      const res = await rotateClientKey(Number(client.id));
      setRotatedSecret(res.secret_key);
      setRotateDialogOpen(true);
      toast.success('Đã rotate secret — mọi JWT cũ vô hiệu');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setRotating(false);
    }
  };

  const handleRevokeAllTokens = async () => {
    if (!client || !canManage) return;
    setRevokingTokens(true);
    try {
      await revokeClientTokens(Number(client.id));
      toast.success('Đã thu hồi mọi JWT của client — cần đổi token mới');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setRevokingTokens(false);
    }
  };

  if (!client) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="bg-card border-border w-full sm:max-w-lg overflow-y-auto px-6 pb-6">
        <SheetHeader className="text-left border-b border-border pb-4 px-0">
          <SheetTitle className="text-white">{name.trim() || client.name}</SheetTitle>
        </SheetHeader>

        <EnterSubmitForm
          className="flex flex-col min-h-0"
          disabled={saving || !canManage}
          onSubmit={() => void handleSave()}
        >
        <div className="space-y-6 py-6">
          <section className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-white">
              <Shield className="w-4 h-4 text-emerald-400" />
              Authentication
            </div>
            <div className="rounded-lg border border-border bg-slate-950/50 p-3 space-y-2 text-xs">
              <div>
                <Label className="text-xs text-muted-foreground">Tên client</Label>
                <Input
                  value={name}
                  disabled={!canManage}
                  onChange={(e) => setName(e.target.value)}
                  className="mt-1.5 bg-input border-border"
                  placeholder="VD: weather-web-demo"
                />
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-muted-foreground">Client ID</span>
                <code className="text-slate-300 font-mono truncate max-w-[200px]">
                  {client.apiKey}
                </code>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-muted-foreground">Phương thức</span>
                <Badge variant="outline" className="text-[10px] border-emerald-500/30 text-emerald-400">
                  {authModeLabel(client.authMode)}
                </Badge>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-muted-foreground">Loại client</span>
                <span className="text-slate-300">{integrationTypeLabel(client.integrationType)}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-muted-foreground">Lần gọi gần nhất</span>
                <span className="text-slate-300">
                  {client.lastUsedAt ? new Date(client.lastUsedAt).toLocaleString('vi-VN') : 'Chưa có'}
                </span>
              </div>
              {canManage && client.apiKey.startsWith('avaso_pk_') ? (
                <div className="mt-2 space-y-2">
                  <ConfirmDangerButton
                    title="Rotate secret?"
                    description="Secret cũ hết hiệu lực ngay. Mọi JWT đang live cũng bị vô hiệu."
                    confirmLabel="Rotate secret"
                    pendingLabel="Đang rotate…"
                    variant="outline"
                    disabled={rotating}
                    onConfirm={() => void handleRotate()}
                    className="w-full text-xs border-amber-500/40 text-amber-400 hover:bg-amber-500/10"
                  >
                    <KeyRound className="w-3.5 h-3.5 mr-1.5" />
                    Rotate secret
                  </ConfirmDangerButton>
                  <ConfirmDangerButton
                    title="Thu hồi mọi JWT?"
                    description="Tăng token version — mọi access token hiện tại của client này không dùng được nữa. App phải gọi lại POST /api/oauth/token."
                    confirmLabel="Thu hồi"
                    pendingLabel="Đang thu hồi…"
                    variant="outline"
                    disabled={revokingTokens}
                    onConfirm={() => void handleRevokeAllTokens()}
                    className="w-full text-xs border-red-500/40 text-red-400 hover:bg-red-500/10"
                  >
                    <Ban className="w-3.5 h-3.5 mr-1.5" />
                    Thu hồi mọi token
                  </ConfirmDangerButton>
                  <Button asChild variant="outline" size="sm" className="w-full text-xs border-border">
                    <Link to="/auth?tab=tokens">
                      Xem audit token
                    </Link>
                  </Button>
                </div>
              ) : null}
            </div>
          </section>

          <section className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-semibold text-white">
                <Activity className="w-4 h-4 text-cyan-400" />
                Traffic 24h
              </div>
              <Button asChild variant="ghost" size="sm" className="h-7 text-xs text-primary">
                <Link to={`/logs?kind=traffic&client_key_id=${client.id}`}>Xem log</Link>
              </Button>
            </div>
            {trafficLoading ? (
              <p className="text-xs text-muted-foreground">Đang tải thống kê…</p>
            ) : trafficError ? (
              <p className="text-xs text-muted-foreground">
                Không tải được thống kê. Thử đóng rồi mở lại, hoặc bấm &quot;Xem log&quot; bên trên.
              </p>
            ) : traffic && traffic.total > 0 ? (
              <div className="rounded-lg border border-border bg-slate-950/50 p-3 space-y-2 text-xs">
                <div className="flex flex-wrap gap-3">
                  <span className="text-slate-300">
                    <strong className="text-white">{traffic.total}</strong> request
                  </span>
                  <span className="text-emerald-400">{traffic.success} OK</span>
                  <span className="text-amber-400">{traffic.denied} từ chối</span>
                  {traffic.upstream_error > 0 ? (
                    <span className="text-red-400">{traffic.upstream_error} upstream</span>
                  ) : null}
                  <span className="text-muted-foreground">
                    ~{Math.round(traffic.avg_duration_ms)} ms
                  </span>
                </div>
                {traffic.top_paths.length > 0 ? (
                  <ul className="space-y-0.5 font-mono text-[10px] text-slate-500 border-t border-border/50 pt-2">
                    {traffic.top_paths.map(([p, n]) => (
                      <li key={p} className="flex justify-between gap-2 truncate">
                        <span className="truncate">{p}</span>
                        <span className="shrink-0">{n}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                Chưa có request nào trong 24h qua cho client này.
              </p>
            )}
          </section>

          <section className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-white">
              <UserCheck className="w-4 h-4 text-sky-400" />
              Authorization
            </div>
            <div className="flex items-center gap-2.5 text-sm text-slate-300">
              <Checkbox
                id="client-active"
                checked={active}
                disabled={!canManage}
                onCheckedChange={(v) => setActive(v === true)}
              />
              <label htmlFor="client-active" className="cursor-pointer select-none">
                Client active — cho phép gọi data plane
              </label>
            </div>
            <div className="flex items-center gap-2.5 text-sm text-slate-300">
              <Checkbox
                id="client-acl"
                checked={restrictRoutes}
                disabled={!canManage}
                onCheckedChange={(v) => setRestrictRoutes(v === true)}
              />
              <label htmlFor="client-acl" className="cursor-pointer select-none">
                Giới hạn route (ACL)
              </label>
              {!restrictRoutes ? (
                <Badge
                  variant="outline"
                  className="text-[10px] border-sky-500/30 text-sky-300 bg-sky-500/10"
                >
                  Full tenant access
                </Badge>
              ) : null}
            </div>
            {!restrictRoutes ? (
              <p className="text-xs text-sky-300/80 leading-relaxed">
                ACL rỗng — client gọi được <strong>mọi route</strong>
              </p>
            ) : (
              <p className="text-xs text-muted-foreground leading-relaxed">
                Bật ACL không cần tắt <strong>Client active</strong>. Khi active và có ACL, client chỉ gọi được các route đã chọn bên dưới.
              </p>
            )}
            <div className="space-y-2">
              {canManage && routes.length > 0 && restrictRoutes ? (
                <div className="flex gap-2 text-[11px]">
                  <button type="button" className="text-primary hover:underline" onClick={selectAllRoutes}>
                    Chọn tất cả
                  </button>
                  <span className="text-muted-foreground">·</span>
                  <button type="button" className="text-muted-foreground hover:underline" onClick={clearRoutes}>
                    Bỏ chọn
                  </button>
                </div>
              ) : null}
              <div
                className={`rounded-lg border border-border max-h-48 overflow-y-auto ${
                  restrictRoutes ? '' : 'opacity-50 pointer-events-none'
                }`}
              >
                {routes.length === 0 ? (
                  <p className="p-3 text-xs text-muted-foreground">
                    Chưa có route — tạo tại Quản lý Route.
                  </p>
                ) : (
                  routes.map((r) => (
                    <div
                      key={r.id}
                      className="flex items-start gap-2.5 px-3 py-2 border-b border-border/50 last:border-0 hover:bg-primary/5"
                    >
                      <Checkbox
                        id={`route-${r.id}`}
                        className="mt-0.5"
                        disabled={!canManage || !restrictRoutes}
                        checked={selectedRoutes.includes(r.id)}
                        onCheckedChange={() => toggleRoute(r.id)}
                      />
                      <label htmlFor={`route-${r.id}`} className="min-w-0 cursor-pointer select-none">
                        <p className="text-xs font-mono text-slate-200 truncate">{r.path}</p>
                        <p className="text-[10px] text-muted-foreground truncate">{r.target}</p>
                      </label>
                    </div>
                  ))
                )}
              </div>
            </div>
          </section>

          <section className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-white">
              <Gauge className="w-4 h-4 text-amber-400" />
              Rate limiting
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Giới hạn (req/phút)</Label>
              <Input
                type="number"
                min={0}
                max={1_000_000}
                value={rateLimit}
                disabled={!canManage}
                onChange={(e) => setRateLimit(e.target.value)}
                {...defaultNumberHandlers(rateLimit, setRateLimit, rateLimitDefault)}
                className="mt-1.5 bg-input border-border"
                placeholder="0 — kế thừa route/global"
              />
              {canManage ? (
                <div className="flex flex-wrap gap-2 mt-2">
                  {ratePresets.map((p) => (
                    <Button
                      key={p}
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs border-border"
                      onClick={() => setRateLimit(String(p))}
                    >
                      {p === 0 ? 'Mặc định (0)' : `${p}/phút`}
                    </Button>
                  ))}
                </div>
              ) : null}
            </div>
          </section>

          <Button asChild variant="outline" size="sm" className="w-full border-border">
            <Link to={`/proxy-try?clientId=${client.id}`}>
              <FlaskConical className="w-4 h-4 mr-2" />
              Thử gọi proxy
            </Link>
          </Button>
        </div>

        {canManage ? (
          <div className="flex gap-2 pt-4 border-t border-border px-0">
            <Button
              type="submit"
              className="flex-1 bg-primary hover:bg-primary/90"
              disabled={saving}
            >
              {saving ? 'Đang lưu…' : 'Lưu'}
            </Button>
            <Button type="button" variant="outline" className="border-border" onClick={() => onOpenChange(false)}>
              Hủy
            </Button>
          </div>
        ) : null}
        </EnterSubmitForm>
      </SheetContent>

      <Dialog open={rotateDialogOpen} onOpenChange={setRotateDialogOpen}>
        <DialogContent className="bg-card border-border sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-white">Secret mới — lưu ngay</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Chỉ hiển thị một lần. Cập nhật secret trên ERP/CRM trước khi đóng.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <p className="text-[10px] uppercase text-muted-foreground mb-1">Client ID (không đổi)</p>
              <code className="block text-xs font-mono text-slate-300 break-all">{client.apiKey}</code>
            </div>
            <div>
              <p className="text-[10px] uppercase text-muted-foreground mb-1">Secret mới</p>
              <code className="block text-xs font-mono text-emerald-400 break-all">{rotatedSecret}</code>
            </div>
            <Button
              type="button"
              className="w-full"
              onClick={() => {
                void navigator.clipboard.writeText(rotatedSecret);
                toast.success('Đã copy secret');
              }}
            >
              <Copy className="w-4 h-4 mr-2" />
              Copy secret
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Sheet>
  );
}
