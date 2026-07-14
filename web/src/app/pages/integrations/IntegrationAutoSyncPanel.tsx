import { Clock, RefreshCw } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import type { IntegrationSyncSchedule, SyncScheduleMode } from '../../../lib/api';
import { updateIntegrationSyncSchedule } from '../../../lib/api';
import { formatDbTimestamp } from '../../../lib/formatDbTimestamp';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';

type IntervalUnit = 'minutes' | 'hours' | 'days';

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function timeValue(hour: number, minute: number): string {
  return `${pad2(hour)}:${pad2(minute)}`;
}

function parseTimeValue(raw: string): { hour: number; minute: number } | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(raw.trim());
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

function minsToParts(mins: number): { value: number; unit: IntervalUnit } {
  if (mins >= 1440 && mins % 1440 === 0) return { value: mins / 1440, unit: 'days' };
  if (mins >= 60 && mins % 60 === 0) return { value: mins / 60, unit: 'hours' };
  return { value: Math.max(mins, 1), unit: 'minutes' };
}

function partsToMins(value: number, unit: IntervalUnit): number {
  if (unit === 'days') return value * 1440;
  if (unit === 'hours') return value * 60;
  return value;
}

function inferMode(schedule: IntegrationSyncSchedule): SyncScheduleMode {
  if (schedule.mode === 'off' || schedule.mode === 'interval' || schedule.mode === 'daily') {
    return schedule.mode;
  }
  return schedule.interval_mins > 0 ? 'interval' : 'off';
}

type Props = {
  schedule: IntegrationSyncSchedule;
  onUpdated: (schedule: IntegrationSyncSchedule) => void;
};

export function IntegrationAutoSyncPanel({ schedule, onUpdated }: Props) {
  const [saving, setSaving] = useState(false);
  const [mode, setMode] = useState<SyncScheduleMode>(() => inferMode(schedule));
  const initialParts = minsToParts(schedule.interval_mins > 0 ? schedule.interval_mins : 15);
  const [intervalValue, setIntervalValue] = useState(String(initialParts.value));
  const [intervalUnit, setIntervalUnit] = useState<IntervalUnit>(initialParts.unit);
  const [dailyTime, setDailyTime] = useState(
    timeValue(schedule.daily_hour ?? 7, schedule.daily_minute ?? 0),
  );

  useEffect(() => {
    setMode(inferMode(schedule));
    const parts = minsToParts(schedule.interval_mins > 0 ? schedule.interval_mins : 15);
    setIntervalValue(String(parts.value));
    setIntervalUnit(parts.unit);
    setDailyTime(timeValue(schedule.daily_hour ?? 7, schedule.daily_minute ?? 0));
  }, [schedule]);

  const minMins = schedule.interval_mins_min ?? 1;
  const maxMins = schedule.interval_mins_max ?? 10080;

  const dirty = useMemo(() => {
    const savedMode = inferMode(schedule);
    if (mode !== savedMode) return true;
    if (mode === 'interval') {
      const n = Number.parseInt(intervalValue, 10);
      if (!Number.isFinite(n)) return true;
      return partsToMins(n, intervalUnit) !== schedule.interval_mins;
    }
    if (mode === 'daily') {
      const t = parseTimeValue(dailyTime);
      if (!t) return true;
      return t.hour !== (schedule.daily_hour ?? 7) || t.minute !== (schedule.daily_minute ?? 0);
    }
    return false;
  }, [mode, intervalValue, intervalUnit, dailyTime, schedule]);

  const handleSave = async () => {
    setSaving(true);
    try {
      let next: IntegrationSyncSchedule;
      if (mode === 'off') {
        next = await updateIntegrationSyncSchedule({ mode: 'off' });
      } else if (mode === 'interval') {
        const n = Number.parseInt(intervalValue, 10);
        if (!Number.isFinite(n) || n < 1) {
          toast.error('Nhập số hợp lệ');
          return;
        }
        const mins = partsToMins(n, intervalUnit);
        if (mins < minMins || mins > maxMins) {
          toast.error(`Ngoài khoảng cho phép`);
          return;
        }
        next = await updateIntegrationSyncSchedule({ mode: 'interval', interval_mins: mins });
      } else {
        const t = parseTimeValue(dailyTime);
        if (!t) {
          toast.error('Giờ không hợp lệ');
          return;
        }
        next = await updateIntegrationSyncSchedule({
          mode: 'daily',
          daily_hour: t.hour,
          daily_minute: t.minute,
        });
      }
      onUpdated(next);
      toast.success('Đã lưu lịch');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="p-5 sm:p-6 bg-card/80 border-border scroll-mt-24" id="section-auto-sync">
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-2 flex-wrap">
          <Clock className="w-4 h-4 text-cyan-400 shrink-0" />
          <h2 className="text-sm font-bold text-white uppercase tracking-wider">Tự động đồng bộ</h2>
          <Badge
            variant="outline"
            className={
              schedule.enabled
                ? 'text-[10px] bg-emerald-500/10 text-emerald-400 border-emerald-500/25'
                : 'text-[10px] bg-slate-500/10 text-slate-400 border-slate-500/25'
            }
          >
            {schedule.enabled ? 'Bật' : 'Tắt'}
          </Badge>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 items-end">
          <div>
            <Label htmlFor="auto-sync-mode" className="text-xs text-muted-foreground mb-1.5 block">
              Lịch
            </Label>
            <Select
              value={mode}
              onValueChange={(v: SyncScheduleMode) => setMode(v)}
              disabled={saving}
            >
              <SelectTrigger id="auto-sync-mode" className="bg-input border-border">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-card border-border">
                <SelectItem value="off">Tắt</SelectItem>
                <SelectItem value="interval">Định kỳ</SelectItem>
                <SelectItem value="daily">Mỗi ngày</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {mode === 'interval' ? (
            <>
              <div>
                <Label htmlFor="auto-sync-value" className="text-xs text-muted-foreground mb-1.5 block">
                  Mỗi
                </Label>
                <Input
                  id="auto-sync-value"
                  type="number"
                  min={1}
                  step={1}
                  value={intervalValue}
                  onChange={(e) => setIntervalValue(e.target.value)}
                  disabled={saving}
                  className="bg-input border-border text-foreground"
                />
              </div>
              <div>
                <Label htmlFor="auto-sync-unit" className="text-xs text-muted-foreground mb-1.5 block">
                  Đơn vị
                </Label>
                <Select
                  value={intervalUnit}
                  onValueChange={(v: IntervalUnit) => setIntervalUnit(v)}
                  disabled={saving}
                >
                  <SelectTrigger id="auto-sync-unit" className="bg-input border-border">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-card border-border">
                    <SelectItem value="minutes">Phút</SelectItem>
                    <SelectItem value="hours">Giờ</SelectItem>
                    <SelectItem value="days">Ngày</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </>
          ) : null}

          {mode === 'daily' ? (
            <div>
              <Label htmlFor="auto-sync-time" className="text-xs text-muted-foreground mb-1.5 block">
                Giờ
              </Label>
              <Input
                id="auto-sync-time"
                type="time"
                value={dailyTime}
                onChange={(e) => setDailyTime(e.target.value)}
                disabled={saving}
                className="bg-input border-border text-foreground max-w-[12rem]"
              />
            </div>
          ) : null}
        </div>

        <div>
          <Button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving || !dirty}
            className="bg-primary hover:bg-primary/90"
          >
            {saving ? 'Đang lưu…' : 'Lưu'}
          </Button>
        </div>
      </div>

      <div className="mt-4 pt-4 border-t border-border/60 grid sm:grid-cols-2 gap-3 text-xs">
        <div className="rounded-lg border border-border/50 bg-slate-950/40 p-3">
          <p className="text-muted-foreground mb-1 flex items-center gap-1.5">
            <RefreshCw className="w-3.5 h-3.5" />
            Pipeline gần nhất
          </p>
          <p className="text-slate-200 font-medium">
            {formatDbTimestamp(schedule.last_pipeline_sync_at)}
          </p>
        </div>
        <div className="rounded-lg border border-border/50 bg-slate-950/40 p-3">
          <p className="text-muted-foreground mb-1 flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5" />
            Tự động gần nhất
          </p>
          <p className="text-slate-200 font-medium">
            {formatDbTimestamp(schedule.last_auto_sync_at)}
          </p>
        </div>
      </div>

      {schedule.enabled && !schedule.both_connected ? (
        <p className="mt-3 text-xs text-amber-300/90 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2">
          Cần Salesforce và Zoho Projects đều connected.
        </p>
      ) : null}
    </Card>
  );
}
