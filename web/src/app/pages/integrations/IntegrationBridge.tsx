import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { ArrowLeftRight, ChevronDown, ChevronUp, Play, Settings2, X } from 'lucide-react';
import { toast } from 'sonner';
import {
  fetchIntegrationBridge,
  runIntegrationBridge,
  updateIntegrationBridge,
  type BridgeFieldMapping,
  type IntegrationBridgeConfig,
} from '../../../lib/api';
import { toastApiError } from '../../../lib/apiClientError';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { Card } from '../../components/ui/card';
import { Label } from '../../components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';

type Props = {
  isAdmin: boolean;
  sfConnected: boolean;
  zohoConnected: boolean;
  onApplied?: () => void;
};

export function IntegrationBridge({ isAdmin, sfConnected, zohoConnected, onApplied }: Props) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [bridge, setBridge] = useState<IntegrationBridgeConfig | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setBridge(await fetchIntegrationBridge());
    } catch (e) {
      toastApiError(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, sfConnected, zohoConnected]);

  const toggleMapping = (id: string) => {
    if (!bridge) return;
    setBridge({
      ...bridge,
      mappings: bridge.mappings.map((m) => (m.id === id ? { ...m, enabled: !m.enabled } : m)),
    });
  };

  const persistBridge = async (next: IntegrationBridgeConfig, quiet = false) => {
    const saved = await updateIntegrationBridge({
      enabled: next.enabled,
      direction: next.direction,
      mappings: next.mappings,
    });
    setBridge(saved);
    if (!quiet) {
      if (!saved.enabled) {
        toast.warning('Đã lưu map — bật "Bật bridge" để chạy');
      } else if (!saved.both_connected) {
        toast.success('Đã lưu — chờ SF + Zoho connected');
      } else {
        toast.success('Bridge đã bật — sync snapshot hoặc Chạy bridge');
      }
    }
    return saved;
  };

  const save = async () => {
    if (!bridge) return;
    setSaving(true);
    try {
      await persistBridge(bridge);
    } catch (e) {
      toastApiError(e);
    } finally {
      setSaving(false);
    }
  };

  const setBridgeEnabled = async (enabled: boolean) => {
    if (!bridge) return;
    const next = { ...bridge, enabled };
    setBridge(next);
    setSaving(true);
    try {
      await persistBridge(next, true);
      toast.success(enabled ? 'Đã bật bridge' : 'Đã tắt bridge');
    } catch (e) {
      toastApiError(e);
      void load();
    } finally {
      setSaving(false);
    }
  };

  const runBridge = async () => {
    if (!bridge) return;
    setRunning(true);
    try {
      await persistBridge(bridge, true);
      const res = await runIntegrationBridge();
      toast.success(
        `Bridge OK — ${res.records} Opportunity từ Salesforce đã map `
      );
      onApplied?.();
    } catch (e) {
      toastApiError(e);
    } finally {
      setRunning(false);
    }
  };

  const activeCount = bridge?.mappings.filter((m) => m.enabled).length ?? 0;
  const bridgeLive = bridge?.enabled && bridge.both_connected;

  const statusHint = (() => {
    if (!bridge) return null;
    if (!bridge.enabled) {
      return 'Bridge chưa bật — tick ô "Bật bridge".';
    }
    if (!bridge.both_connected) {
      return 'Bridge đã bật — cần connected cả Salesforce và Zoho.';
    }
    if (activeCount === 0) {
      return 'Bật ít nhất một field map rồi Lưu.';
    }
    return 'Sẵn sàng — số map = Opportunity SF trong snapshot.';
  })();

  return (
    <div className="flex flex-col items-center justify-center px-2 lg:px-4 py-4 lg:py-0 min-w-[120px] lg:min-w-[180px]">
      <div className="hidden lg:flex items-center w-full gap-1 text-muted-foreground mb-2">
        <span className="h-px flex-1 bg-gradient-to-r from-transparent via-cyan-500/40 to-cyan-500/80" />
        <ArrowLeftRight className="w-5 h-5 text-cyan-400 shrink-0" />
        <span className="h-px flex-1 bg-gradient-to-l from-transparent via-violet-500/40 to-violet-500/80" />
      </div>

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="group flex flex-col items-center gap-2 rounded-xl border border-dashed border-cyan-500/30 bg-cyan-500/5 px-4 py-3 hover:border-cyan-400/50 hover:bg-cyan-500/10 transition-colors w-full max-w-[200px]"
      >
        <ArrowLeftRight className="w-6 h-6 text-cyan-400 group-hover:scale-110 transition-transform" />
        <span className="text-xs font-semibold text-white text-center">Bridge CRM → PM</span>
        {loading ? (
          <span className="text-[10px] text-muted-foreground">…</span>
        ) : (
          <Badge
            className={
              bridgeLive
                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/25 border text-[10px]'
                : 'bg-slate-500/10 text-slate-400 border-slate-500/25 border text-[10px]'
            }
          >
            {bridgeLive ? `${activeCount} map · bật` : bridge?.enabled ? 'chờ kết nối' : 'chưa bật'}
          </Badge>
        )}
        {open ? (
          <ChevronUp className="w-3 h-3 text-muted-foreground" />
        ) : (
          <ChevronDown className="w-3 h-3 text-muted-foreground" />
        )}
      </button>

      {open && bridge ? (
        <Card className="mt-4 p-4 bg-slate-950/90 border-cyan-500/20 w-full max-w-md lg:absolute lg:z-20 lg:mt-48 shadow-xl">
          <div className="flex items-start justify-between gap-2 mb-3">
            <div className="flex items-start gap-2 min-w-0">
              <Settings2 className="w-4 h-4 text-cyan-400 mt-0.5 shrink-0" />
              <div>
                <h3 className="text-sm font-bold text-white">Field map</h3>
              </div>
            </div>
            <button
              type="button"
              className="p-1.5 rounded-lg text-muted-foreground hover:text-white hover:bg-slate-800 shrink-0"
              onClick={() => setOpen(false)}
              aria-label="Đóng"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {statusHint && !bridgeLive ? (
            <p className="text-xs mb-3 text-amber-400">{statusHint}</p>
          ) : null}

          <div className="space-y-3 mb-4">
            <div>
              <Label className="text-xs text-muted-foreground">Hướng đồng bộ</Label>
              <Select
                value={bridge.direction}
                onValueChange={(v) => setBridge({ ...bridge, direction: v })}
                disabled={!isAdmin}
              >
                <SelectTrigger className="mt-1 h-8 text-xs bg-input border-border">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="salesforce_to_zoho">Salesforce → Zoho</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                className="rounded border-border"
                checked={bridge.enabled}
                disabled={!isAdmin || saving}
                onChange={(e) => void setBridgeEnabled(e.target.checked)}
              />
              Bật bridge
            </label>
          </div>

          <div className="space-y-2 max-h-52 overflow-y-auto mb-4">
            {bridge.mappings.map((m) => (
              <MappingRow key={m.id} mapping={m} onToggle={() => toggleMapping(m.id)} disabled={!isAdmin} />
            ))}
          </div>

          {isAdmin ? (
            <div className="flex flex-col gap-2">
              <Button
                size="sm"
                className="w-full bg-primary hover:bg-primary/90"
                disabled={saving}
                onClick={() => void save()}
              >
                {saving ? 'Đang lưu…' : 'Lưu cấu hình bridge'}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="w-full border-cyan-500/30"
                disabled={running || saving || !bridge.enabled || !bridge.both_connected || activeCount === 0}
                onClick={() => void runBridge()}
              >
                <Play className="w-3.5 h-3.5 mr-2" />
                {running ? 'Đang chạy…' : 'Chạy bridge'}
              </Button>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground text-center">Viewer: chỉ xem map.</p>
          )}
        </Card>
      ) : null}
    </div>
  );
}

function MappingRow({
  mapping,
  onToggle,
  disabled,
}: {
  mapping: BridgeFieldMapping;
  onToggle: () => void;
  disabled: boolean;
}) {
  return (
    <div
      className={`rounded-lg border p-2 text-[11px] ${
        mapping.enabled ? 'border-cyan-500/25 bg-cyan-500/5' : 'border-border bg-slate-900/50 opacity-70'
      }`}
    >
      <label className="flex items-start gap-2 cursor-pointer">
        <input
          type="checkbox"
          className="mt-0.5 rounded border-border"
          checked={mapping.enabled}
          disabled={disabled}
          onChange={onToggle}
        />
        <div className="min-w-0 flex-1">
          <p className="text-slate-200 font-medium">{mapping.label}</p>
          <p className="font-mono text-muted-foreground mt-0.5 truncate">
            sf.{mapping.source_entity}.{mapping.source_field} → zoho.{mapping.target_entity}.
            {mapping.target_field}
          </p>
        </div>
      </label>
    </div>
  );
}
