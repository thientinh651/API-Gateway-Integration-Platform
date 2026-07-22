import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '../ui/utils';
import { fetchGatewayRoutes } from '../../../lib/api';

export type PathSuggestion = {
  path: string;
  hint?: string;
  group: 'route' | 'preset' | 'integration';
};

type Preset = { path: string; label: string };

type Props = {
  value: string;
  onChange: (path: string) => void;
  presets?: readonly Preset[];
  placeholder?: string;
  hasError?: boolean;
  className?: string;
};

/** Giữ đúng Path đã lưu trên Route — không tự ghép /v1/api. */
function normalizeRoutePath(routePath: string): string {
  const p = routePath.trim();
  if (!p) return '';
  return p.startsWith('/') ? p : `/${p}`;
}

function buildSuggestions(presets: readonly Preset[], routePaths: string[]): PathSuggestion[] {
  const seen = new Set<string>();
  const out: PathSuggestion[] = [];

  const add = (path: string, hint: string | undefined, group: PathSuggestion['group']) => {
    const norm = path.startsWith('/') ? path : `/${path}`;
    if (seen.has(norm)) return;
    seen.add(norm);
    out.push({ path: norm, hint, group });
  };

  for (const p of presets) add(p.path, p.label, 'preset');
  for (const raw of routePaths) add(normalizeRoutePath(raw), 'Route dashboard', 'route');

  const groupOrder: Record<PathSuggestion['group'], number> = {
    preset: 0,
    route: 1,
    integration: 2,
  };
  return out.sort((a, b) => {
    const byGroup = groupOrder[a.group] - groupOrder[b.group];
    return byGroup !== 0 ? byGroup : a.path.localeCompare(b.path);
  });
}

const GROUP_LABEL: Record<PathSuggestion['group'], string> = {
  preset: 'Path',
  route: 'Route dashboard',
  integration: 'Tích hợp',
};

function filterSuggestions(all: PathSuggestion[], query: string, browseAll: boolean): PathSuggestion[] {
  const q = query.trim().toLowerCase();
  const pool =
    browseAll || !q
      ? all
      : all.filter(
          (s) => s.path.toLowerCase().includes(q) || (s.hint?.toLowerCase().includes(q) ?? false),
        );
  return pool.slice(0, browseAll ? 24 : 12);
}

export function PathAutocomplete({
  value,
  onChange,
  presets = [],
  placeholder = '/v1/api/...',
  hasError,
  className,
}: Props) {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [browseAll, setBrowseAll] = useState(false);
  const [routePaths, setRoutePaths] = useState<string[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);

  useEffect(() => {
    void fetchGatewayRoutes()
      .then((rows) => setRoutePaths(rows.map((r) => r.path)))
      .catch(() => setRoutePaths([]));
  }, []);

  const allSuggestions = useMemo(
    () => buildSuggestions(presets, routePaths),
    [presets, routePaths],
  );

  const filtered = useMemo(
    () => filterSuggestions(allSuggestions, value, browseAll),
    [allSuggestions, value, browseAll],
  );

  const close = useCallback(() => {
    setOpen(false);
    setBrowseAll(false);
  }, []);

  const openBrowse = useCallback(() => {
    setBrowseAll(true);
    setOpen(true);
  }, []);

  useEffect(() => {
    setActiveIdx(0);
  }, [value, open]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) close();
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open, close]);

  const pick = (path: string) => {
    onChange(path);
    close();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      openBrowse();
      return;
    }
    if (!open || filtered.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx((i) => (i + 1) % filtered.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => (i - 1 + filtered.length) % filtered.length);
    } else if (e.key === 'Enter' && filtered[activeIdx]) {
      e.preventDefault();
      pick(filtered[activeIdx].path);
    } else if (e.key === 'Escape') {
      close();
    }
  };

  const showList = open && filtered.length > 0;

  const fieldShell = cn(
    'relative flex h-9 w-full items-center rounded-md border border-border bg-input text-foreground transition-[color,box-shadow] focus-within:border-ring focus-within:ring-ring/50 focus-within:ring-[3px]',
    hasError && 'border-destructive focus-within:ring-destructive/20',
  );

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <div className={fieldShell}>
        <input
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            setBrowseAll(false);
            setOpen(true);
          }}
          onFocus={() => {
            setBrowseAll(false);
            setOpen(true);
          }}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          className="h-full min-w-0 flex-1 border-0 bg-transparent pl-3 pr-9 font-mono text-sm text-foreground outline-none placeholder:text-muted-foreground"
        />
        <button
          type="button"
          aria-label="Mở danh sách path"
          onClick={() => (open && browseAll ? close() : openBrowse())}
          className="absolute inset-y-0 right-0 inline-flex w-9 items-center justify-center text-muted-foreground hover:text-foreground"
        >
          <ChevronDown className={cn('h-4 w-4 shrink-0 opacity-50 transition-transform', open && 'rotate-180')} />
        </button>
      </div>

      {showList ? (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-md border border-border bg-popover text-popover-foreground shadow-md py-1"
        >
          {filtered.map((s, idx) => {
            const prev = filtered[idx - 1];
            const showGroup = !prev || prev.group !== s.group;
            return (
              <li key={s.path} role="presentation">
                {showGroup ? (
                  <div className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {GROUP_LABEL[s.group]}
                  </div>
                ) : null}
                <button
                  type="button"
                  role="option"
                  aria-selected={idx === activeIdx}
                  onMouseEnter={() => setActiveIdx(idx)}
                  onClick={() => pick(s.path)}
                  className={cn(
                    'flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left text-sm transition-colors',
                    idx === activeIdx
                      ? 'bg-primary/15 text-foreground'
                      : 'text-foreground hover:bg-slate-800/70',
                  )}
                >
                  <span
                    className={cn(
                      'font-mono text-xs',
                      idx === activeIdx ? 'text-primary' : 'text-foreground',
                    )}
                  >
                    {s.path}
                  </span>
                  {s.hint ? (
                    <span
                      className={cn(
                        'text-[10px] truncate max-w-full',
                        idx === activeIdx ? 'text-slate-300' : 'text-muted-foreground',
                      )}
                    >
                      {s.hint}
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}

      {open && value.trim() && filtered.length === 0 ? (
        <p className="absolute z-50 mt-1 w-full rounded-md border border-border bg-popover px-3 py-2 text-xs text-muted-foreground shadow-lg">
          Không có path trùng — vẫn gõ tự do hoặc thêm route tại Quản lý Route.
        </p>
      ) : null}
    </div>
  );
}
