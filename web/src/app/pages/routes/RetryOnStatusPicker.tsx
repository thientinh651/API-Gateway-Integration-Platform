import { cn } from '../../components/ui/utils';
import {
  formatRetryOnStatus,
  parseRetryOnStatus,
  RETRY_ON_STATUS_OPTIONS,
  toggleRetryOnStatus,
  unknownRetryStatusCodes,
} from '../../../lib/retryOnStatusOptions';

type Props = {
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
};

export function RetryOnStatusPicker({ value, onChange, disabled }: Props) {
  const selected = parseRetryOnStatus(value);
  const unknown = unknownRetryStatusCodes(selected);

  return (
    <div className="mt-1 space-y-2">
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Retry on status">
        {RETRY_ON_STATUS_OPTIONS.map((opt) => {
          const on = selected.includes(opt.code);
          return (
            <button
              key={opt.code}
              type="button"
              disabled={disabled}
              title={opt.hint}
              aria-pressed={on}
              onClick={() => onChange(toggleRetryOnStatus(value, opt.code, !on))}
              className={cn(
                'h-7 min-w-[2.75rem] rounded-md border px-2.5 text-xs font-mono transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
                on
                  ? 'border-primary bg-primary text-primary-foreground shadow-sm'
                  : 'border-border bg-input/40 text-muted-foreground hover:border-primary/40 hover:text-foreground',
                disabled && 'opacity-50 pointer-events-none',
              )}
            >
              {opt.label}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] leading-relaxed">
        <span className="text-muted-foreground">
          {selected.length > 0 ? (
            <>
              Đã chọn{' '}
              <span className="font-mono text-slate-300">{formatRetryOnStatus(selected)}</span>
            </>
          ) : (
            'Chưa chọn mã — không retry theo status'
          )}
        </span>
        {unknown.length > 0 ? (
          <>
            <span className="text-border">·</span>
            <span className="text-amber-200/80 font-mono">+{formatRetryOnStatus(unknown)}</span>
          </>
        ) : null}
      </div>
    </div>
  );
}
