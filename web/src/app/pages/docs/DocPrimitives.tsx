import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { ArrowRight, CheckCircle2, MapPin, XCircle } from 'lucide-react';
import { cn } from '../../components/ui/utils';
import type { ApiDocTab } from './docsNav';

export const DEMO_HOST = 'https://thientinh.io.vn';

export function DocGoal({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-primary/35 bg-primary/5 px-4 py-3 text-sm text-slate-200 leading-relaxed max-w-3xl">
      <span className="font-semibold text-primary">Trong phần này — </span>
      {children}
    </div>
  );
}

export function DocPrereq({ children }: { children: ReactNode }) {
  return (
    <p className="text-sm text-slate-400 leading-relaxed max-w-3xl">
      <span className="font-medium text-slate-300">Trước khi bắt đầu: </span>
      {children}
    </p>
  );
}

export function DocProse({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('text-sm text-slate-300 leading-relaxed space-y-2 max-w-3xl', className)}>
      {children}
    </div>
  );
}

export function CodeBlock({ children }: { children: string }) {
  return (
    <div className="bg-[#050810] rounded-lg p-4 font-mono-tech text-xs overflow-x-auto border border-border/80 shadow-inner max-w-3xl">
      <pre className="text-slate-300 whitespace-pre-wrap break-all sm:break-normal sm:whitespace-pre">
        {children}
      </pre>
    </div>
  );
}

export function WhereLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link
      to={to}
      className="inline-flex items-center gap-1.5 text-primary hover:underline font-medium"
    >
      <MapPin className="w-3.5 h-3.5 shrink-0" />
      {children}
    </Link>
  );
}

export function HowToStep({
  n,
  title,
  where,
  children,
}: {
  n: number;
  title: string;
  where?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex gap-3 sm:gap-4 max-w-3xl">
      <div className="shrink-0 w-8 h-8 rounded-lg bg-primary/15 border border-primary/40 flex items-center justify-center text-sm font-bold text-primary font-mono-tech">
        {n}
      </div>
      <div className="min-w-0 flex-1 pb-6 border-b border-border/50 last:border-0 last:pb-0 space-y-2.5">
        <div>
          <h3 className="text-base font-bold text-white">{title}</h3>
          {where ? (
            <p className="text-xs text-muted-foreground mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1">
              <span className="uppercase tracking-wide font-semibold text-slate-500">Tại</span>
              {where}
            </p>
          ) : null}
        </div>
        <div className="text-sm text-slate-300 leading-relaxed space-y-2.5">{children}</div>
      </div>
    </div>
  );
}

export type FieldRow = {
  field: string;
  value: string;
  note?: string;
};

export function FieldTable({ rows }: { rows: FieldRow[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border/70 max-w-3xl">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border/70 bg-background/50 text-left">
            <th className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-400 w-[28%]">
              Field
            </th>
            <th className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-400 w-[36%]">
              Nhập / chọn
            </th>
            <th className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
              Ý nghĩa
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.field} className="border-b border-border/40 last:border-0 align-top">
              <td className="px-3 py-2.5 font-mono-tech text-xs text-amber-300/95 whitespace-nowrap">
                {row.field}
              </td>
              <td className="px-3 py-2.5 font-mono-tech text-xs text-emerald-300/90 break-all">
                {row.value}
              </td>
              <td className="px-3 py-2.5 text-slate-400 text-xs leading-relaxed">
                {row.note ?? '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ExpectBox({ children }: { children: ReactNode }) {
  return (
    <div className="flex gap-2.5 rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-2.5 text-sm text-slate-300 leading-relaxed max-w-3xl">
      <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
      <div>
        <span className="font-semibold text-emerald-300">Kết quả — </span>
        {children}
      </div>
    </div>
  );
}

export function DoNot({ children }: { children: ReactNode }) {
  return (
    <div className="flex gap-2.5 rounded-lg border border-red-500/25 bg-red-500/5 px-3 py-2.5 text-sm text-slate-300 leading-relaxed max-w-3xl">
      <XCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
      <div>{children}</div>
    </div>
  );
}

export function NextLink({
  tab,
  onSelect,
  children,
}: {
  tab: ApiDocTab;
  onSelect?: (tab: ApiDocTab) => void;
  children: ReactNode;
}) {
  if (onSelect) {
    return (
      <button
        type="button"
        onClick={() => onSelect(tab)}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
      >
        {children}
        <ArrowRight className="w-3.5 h-3.5" />
      </button>
    );
  }
  return (
    <a
      href={`#${tab}`}
      className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
    >
      {children}
      <ArrowRight className="w-3.5 h-3.5" />
    </a>
  );
}

export function DocFooterNav({
  prev,
  next,
  onSelect,
}: {
  prev?: { tab: ApiDocTab; label: string };
  next?: { tab: ApiDocTab; label: string };
  onSelect?: (tab: ApiDocTab) => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 pt-2 max-w-3xl border-t border-border/50 mt-2">
      {prev ? (
        onSelect ? (
          <button
            type="button"
            onClick={() => onSelect(prev.tab)}
            className="text-sm text-slate-400 hover:text-primary"
          >
            ← {prev.label}
          </button>
        ) : (
          <a href={`#${prev.tab}`} className="text-sm text-slate-400 hover:text-primary">
            ← {prev.label}
          </a>
        )
      ) : (
        <span />
      )}
      {next ? <NextLink tab={next.tab} onSelect={onSelect}>{next.label}</NextLink> : null}
    </div>
  );
}
