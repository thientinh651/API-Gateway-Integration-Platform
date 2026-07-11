import { Clock, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import type { IntegrationSyncSchedule } from '../../../lib/api';
import { updateIntegrationSyncSchedule } from '../../../lib/api';
import { formatDbTimestamp } from '../../../lib/formatDbTimestamp';
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

const INTERVAL_LABELS: Record<number, string> = {
  0: 'Tắt',
  5: 'Mỗi 5 phút',
  15: 'Mỗi 15 phút',
  30: 'Mỗi 30 phút',
  60: 'Mỗi 60 phút',
};

type Props = {
  schedule: IntegrationSyncSchedule;
  onUpdated: (schedule: IntegrationSyncSchedule) => void;
};

export function IntegrationAutoSyncPanel({ schedule, onUpdated }: Props) {
  const [saving, setSaving] = useState(false);

  const handleIntervalChange = async (value: string) => {
    const interval_mins = Number.parseInt(value, 10);
    if (!Number.isFinite(interval_mins)) return;
    if (interval_mins === schedule.interval_mins) return;
    setSaving(true);
    try {
      const next = await updateIntegrationSyncSchedule(interval_mins);
      onUpdated(next);
      if (interval_mins === 0) {
        toast.success('Đã tắt tự động đồng bộ');
      } else {
        toast.success(`Đã bật tự động đồng bộ — ${INTERVAL_LABELS[interval_mins] ?? `${interval_mins} phút`}`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const options = schedule.allowed_intervals.length
    ? schedule.allowed_intervals
    : [0, 5, 15, 30, 60];

  return (
    <Card className="p-5 sm:p-6 bg-card/80 border-border scroll-mt-24" id="section-auto-sync">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <Clock className="w-4 h-4 text-cyan-400 shrink-0" />
            <h2 className="text-sm font-bold text-white uppercase tracking-wider">
              Tự động đồng bộ
            </h2>
            <Badge
              variant="outline"
              className={
                schedule.enabled
                  ? 'text-[10px] bg-emerald-500/10 text-emerald-400 border-emerald-500/25'
                  : 'text-[10px] bg-slate-500/10 text-slate-400 border-slate-500/25'
              }
            >
              {schedule.enabled ? 'Đang bật' : 'Đã tắt'}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed max-w-2xl">
            Gateway tự chạy pipeline SF → Zoho theo chu kỳ — sale không cần vào đây bấm Sync.
            Cần <strong className="text-slate-300">cả hai</strong> connector connected.
          </p>
        </div>

        <div className="w-full sm:w-52 shrink-0">
          <Label htmlFor="auto-sync-interval" className="text-xs text-muted-foreground mb-1.5 block">
            Chu kỳ
          </Label>
          <Select
            value={String(schedule.interval_mins)}
            onValueChange={(v) => void handleIntervalChange(v)}
            disabled={saving}
          >
            <SelectTrigger id="auto-sync-interval" className="bg-input border-border">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-card border-border">
              {options.map((mins) => (
                <SelectItem key={mins} value={String(mins)}>
                  {INTERVAL_LABELS[mins] ?? `${mins} phút`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="mt-4 pt-4 border-t border-border/60 grid sm:grid-cols-2 gap-3 text-xs">
        <div className="rounded-lg border border-border/50 bg-slate-950/40 p-3">
          <p className="text-muted-foreground mb-1 flex items-center gap-1.5">
            <RefreshCw className="w-3.5 h-3.5" />
            Lần pipeline gần nhất
          </p>
          <p className="text-slate-200 font-medium">
            {formatDbTimestamp(schedule.last_pipeline_sync_at)}
          </p>
          <p className="text-[10px] text-muted-foreground mt-1">Gồm Sync Now thủ công + tự động</p>
        </div>
        <div className="rounded-lg border border-border/50 bg-slate-950/40 p-3">
          <p className="text-muted-foreground mb-1 flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5" />
            Lần tự động gần nhất
          </p>
          <p className="text-slate-200 font-medium">
            {formatDbTimestamp(schedule.last_auto_sync_at)}
          </p>
          <p className="text-[10px] text-muted-foreground mt-1">
            Mặc định env: {schedule.env_default_mins === 0 ? 'tắt' : `${schedule.env_default_mins} phút`}
          </p>
        </div>
      </div>

      {schedule.enabled && !schedule.both_connected ? (
        <p className="mt-3 text-xs text-amber-300/90 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2">
          Đã bật lịch — worker chỉ chạy pipeline khi Salesforce và Zoho Projects đều connected.
        </p>
      ) : null}
    </Card>
  );
}
