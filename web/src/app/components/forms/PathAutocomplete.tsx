import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '../ui/utils';
import { fetchGatewayRoutes } from '../../../lib/api';

type Props = {
  value: string;
  onChange: (path: string) => void;
  placeholder?: string;
  hasError?: boolean;
  className?: string;
};

function normalizeRoutePath(routePath: string): string {
  const p = routePath.trim();
  if (!p) return '';
  return p.startsWith('/') ? p : `/${p}`;
}

function filterPaths(all: string[], query: string, browseAll: boolean): string[] {
  const q = query.trim().toLowerCase();
  const pool =
    browseAll || !q ? all : all.filter((p) => p.toLowerCase().includes(q));
  return pool.slice(0, browseAll ? 24 : 12);
}

export function PathAutocomplete({
  value,
  onChange,
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
      .then((rows) => {
        const paths = rows
          .map((r) => normalizeRoutePath(r.path))
          .filter(Boolean)
          .sort((a, b) => a.localeCompare(b));
        setRoutePaths([...new Set(paths)]);
      })
      .catch(() => setRoutePaths([]));
  }, []);

  const filtered = useMemo(
    () => filterPaths(routePaths, value, browseAll),
    [routePaths, value, browseAll],
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
      pick(filtered[activeIdx]);
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
          {filtered.map((path, idx) => (
            <li key={path} role="presentation">
              <button
                type="button"
                role="option"
                aria-selected={idx === activeIdx}
                onMouseEnter={() => setActiveIdx(idx)}
                onClick={() => pick(path)}
                className={cn(
                  'flex w-full items-center px-3 py-2 text-left text-sm transition-colors',
                  idx === activeIdx
                    ? 'bg-primary/15 text-primary font-mono text-xs'
                    : 'text-foreground font-mono text-xs hover:bg-slate-800/70',
                )}
              >
                {path}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
