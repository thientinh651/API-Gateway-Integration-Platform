import { useMemo, useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Circle,
  Clock3,
  Info,
  Search,
} from 'lucide-react';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { Input } from '../../components/ui/input';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '../../components/ui/tooltip';
import type { EntityLinkRow } from '../../../lib/api';
import { formatDbTimestamp } from '../../../lib/formatDbTimestamp';
import {
  deriveEntityLinkStatus,
  summarizeEntityLinks,
  type ChecklistItem,
  type ChecklistState,
  type EntityLinkOverallKind,
  type EntityLinkStatusView,
} from '../../../lib/entityLinkStatus';

const PAGE_SIZE = 8;

type FilterKey = 'all' | EntityLinkOverallKind;

type Props = {
  links: EntityLinkRow[];
};

function toneBadgeClass(tone: EntityLinkStatusView['overallTone']): string {
  if (tone === 'emerald') return 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30';
  if (tone === 'sky') return 'bg-sky-500/15 text-sky-300 border-sky-500/30';
  return 'bg-amber-500/15 text-amber-200 border-amber-500/30';
}

function StateMark({ state }: { state: ChecklistState }) {
  if (state === 'done') {
    return (
      <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-400">
        <Check className="h-3 w-3" strokeWidth={2.5} />
      </span>
    );
  }
  if (state === 'waiting') {
    return (
      <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-amber-500/15 text-amber-300">
        <Clock3 className="h-3 w-3" />
      </span>
    );
  }
  return (
    <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-slate-800 text-slate-500">
      <Circle className="h-2.5 w-2.5" />
    </span>
  );
}

function stateTextClass(state: ChecklistState): string {
  if (state === 'done') return 'text-emerald-300';
  if (state === 'waiting') return 'text-amber-300';
  return 'text-slate-500';
}

function ChecklistRows({ items }: { items: ChecklistItem[] }) {
  return (
    <div className="space-y-2">
      {items.map((item) => (
        <div key={item.key} className="flex items-center gap-2.5 text-[12px]">
          <StateMark state={item.state} />
          <span className="text-slate-300 flex-1 min-w-0">{item.label}</span>
          <span className={`shrink-0 font-medium ${stateTextClass(item.state)}`}>
            {item.stateLabel}
          </span>
        </div>
      ))}
    </div>
  );
}

function DealCard({ row }: { row: EntityLinkRow }) {
  const [open, setOpen] = useState(false);
  const status = deriveEntityLinkStatus(row);

  return (
    <div className="rounded-xl border border-border bg-slate-950/40 overflow-hidden">
      <div className="p-4 sm:p-5 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h4 className="text-base font-semibold text-white leading-snug">{status.title}</h4>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Opportunity{' '}
              <span className="font-mono text-slate-400">{row.source_id}</span>
            </p>
          </div>
          <Badge
            className={`border text-[11px] font-semibold uppercase tracking-wide shrink-0 ${toneBadgeClass(status.overallTone)}`}
          >
            {status.overallLabel}
          </Badge>
        </div>

        {status.overallHint ? (
          <p className="text-[12px] text-muted-foreground -mt-1">{status.overallHint}</p>
        ) : null}

        <div className="grid sm:grid-cols-2 gap-3 text-[12px]">
          <div className="rounded-lg border border-border/70 bg-background/20 px-3 py-2.5">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1.5">
              Salesforce
            </p>
            <p className="text-emerald-300 font-medium flex items-center gap-1.5">
              <Check className="h-3.5 w-3.5" /> Closed Won
            </p>
            <p className="text-[11px] text-muted-foreground mt-1">
              {formatDbTimestamp(row.last_synced_at)}
            </p>
          </div>
          <div className="rounded-lg border border-border/70 bg-background/20 px-3 py-2.5">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1.5">
              Zoho Project
            </p>
            <p
              className={`font-medium flex items-center gap-1.5 ${
                status.completionSynced ? 'text-emerald-300' : 'text-emerald-300/90'
              }`}
            >
              <Check className="h-3.5 w-3.5" />
              {status.completionSynced ? 'Đã hoàn thành' : 'Đã tạo'}
            </p>
            <p className="text-[11px] text-slate-300 mt-1 truncate" title={row.target_display_name ?? ''}>
              {row.target_display_name?.trim() || '—'}
            </p>
          </div>
        </div>

        <div className="border-t border-border/60 pt-3">
          <ChecklistRows items={status.checklist} />
        </div>

        <div className="flex items-center justify-between gap-2 pt-1">
          <p className="text-[11px] text-muted-foreground">
            Cập nhật: {formatDbTimestamp(row.last_synced_at)}
          </p>
          <button
            type="button"
            className="inline-flex items-center gap-1 h-8 px-2.5 rounded-md text-xs font-medium text-slate-200 border border-border bg-transparent hover:bg-white/10 hover:text-white transition-colors"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
          >
            {open ? 'Thu gọn' : 'Chi tiết'}
            <ChevronDown
              className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`}
            />
          </button>
        </div>
      </div>

      {open ? (
        <div className="border-t border-border px-4 sm:px-5 py-3 bg-slate-900/30 text-[11px] space-y-2">
          <div className="grid sm:grid-cols-2 gap-2">
            <div>
              <p className="text-muted-foreground">Mã Opportunity</p>
              <p className="font-mono text-slate-200 break-all">{row.source_id}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Mã Project Zoho</p>
              <p className="font-mono text-slate-200 break-all">{row.target_id}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Đồng bộ sang Zoho</p>
              <p className="text-slate-200">{formatDbTimestamp(row.last_synced_at)}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Cập nhật Salesforce</p>
              <p className="text-slate-200">
                {row.completion_synced_at
                  ? formatDbTimestamp(row.completion_synced_at)
                  : 'Chưa — chờ Project Zoho hoàn tất rồi bấm Đồng bộ ngay'}
              </p>
            </div>
            <div className="sm:col-span-2">
              <p className="text-muted-foreground">Hóa đơn</p>
              <p className="font-mono text-slate-200 break-all">
                {status.invoiceId ?? '—'}
                {row.invoice_created_at ? ` · ${formatDbTimestamp(row.invoice_created_at)}` : ''}
              </p>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function IntegrationEntityLinksPanel({ links }: Props) {
  const summary = summarizeEntityLinks(links);
  const [filter, setFilter] = useState<FilterKey>('all');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(0);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return links.filter((row) => {
      const s = deriveEntityLinkStatus(row);
      if (filter === 'awaiting_completion' && s.overall !== 'awaiting_completion') return false;
      if (filter === 'sf_updated' && !s.completionSynced) return false;
      if (filter === 'invoiced' && !s.hasInvoice) return false;
      if (!needle) return true;
      const hay = `${s.title} ${row.source_id} ${row.target_id} ${row.target_display_name ?? ''}`.toLowerCase();
      return hay.includes(needle);
    });
  }, [links, filter, q]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  const setFilterAndReset = (f: FilterKey) => {
    setFilter(f);
    setPage(0);
  };

  return (
    <Card className="p-4 sm:p-5 bg-card/80 border-border scroll-mt-24 space-y-4" id="section-entity-links">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-bold text-white">Kết quả đồng bộ</h3>
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-slate-300"
                    aria-label="Giải thích"
                  >
                    <Info className="h-3.5 w-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs text-xs leading-relaxed">
                  Danh sách Opportunity đã được đồng bộ sang Zoho và trạng thái hoàn thành cập nhật về Salesforce.
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
          <p className="text-[12px] text-muted-foreground mt-1">
            Theo dõi các Opportunity đã được đồng bộ sang Zoho và trạng thái hoàn thành.
          </p>
        </div>
      </div>

      {links.length === 0 ? (
        <p className="text-sm text-muted-foreground border border-dashed border-border rounded-lg p-4">
          Chưa có deal đồng bộ. Khi Opportunity đạt Closed Won và đủ điều kiện, bấm Đồng bộ ngay để tạo Project trên Zoho.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <SummaryChip
              label="Tổng"
              value={summary.total}
              active={filter === 'all'}
              onClick={() => setFilterAndReset('all')}
            />
            <SummaryChip
              label="Đang chờ"
              value={summary.awaiting}
              tone="amber"
              active={filter === 'awaiting_completion'}
              onClick={() => setFilterAndReset('awaiting_completion')}
            />
            <SummaryChip
              label="Hoàn thành"
              value={summary.sfUpdated}
              tone="emerald"
              active={filter === 'sf_updated'}
              onClick={() => setFilterAndReset('sf_updated')}
            />
            <SummaryChip
              label="Hóa đơn"
              value={summary.invoiced}
              tone="sky"
              active={filter === 'invoiced'}
              onClick={() => setFilterAndReset('invoiced')}
            />
          </div>

          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setPage(0);
              }}
              placeholder="Tìm Opportunity hoặc Project…"
              className="pl-8 h-9 text-sm bg-slate-950/50 border-border"
            />
          </div>

          <p className="text-[12px] text-muted-foreground">
            {filtered.length === links.length
              ? `${links.length} deal`
              : `${filtered.length} / ${links.length} deal`}
          </p>

          <div className="space-y-3">
            {pageRows.length === 0 ? (
              <p className="text-sm text-muted-foreground border border-dashed border-border rounded-lg p-4">
                Không có deal khớp tìm kiếm hoặc bộ lọc.
              </p>
            ) : (
              pageRows.map((row) => (
                <DealCard
                  key={`${row.flow_type}-${row.source_id}-${row.target_id}`}
                  row={row}
                />
              ))
            )}
          </div>

          {filtered.length > PAGE_SIZE ? (
            <div className="flex items-center justify-between gap-2 text-[12px] text-muted-foreground">
              <span>
                Trang {safePage + 1} / {pageCount}
              </span>
              <div className="flex gap-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 px-2 border-border"
                  disabled={safePage <= 0}
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 px-2 border-border"
                  disabled={safePage >= pageCount - 1}
                  onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ) : null}
        </>
      )}
    </Card>
  );
}

function SummaryChip({
  label,
  value,
  tone,
  active,
  onClick,
}: {
  label: string;
  value: number;
  tone?: 'amber' | 'emerald' | 'sky';
  active?: boolean;
  onClick?: () => void;
}) {
  const valueClass =
    tone === 'amber'
      ? 'text-amber-300'
      : tone === 'emerald'
        ? 'text-emerald-400'
        : tone === 'sky'
          ? 'text-sky-300'
          : 'text-white';
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-xl border px-3 py-2.5 text-left transition-colors ${
        active ? 'border-primary/50 bg-primary/10' : 'border-border bg-slate-950/50 hover:bg-white/[0.02]'
      }`}
    >
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className={`text-xl font-semibold tabular-nums mt-0.5 ${valueClass}`}>{value}</p>
    </button>
  );
}
