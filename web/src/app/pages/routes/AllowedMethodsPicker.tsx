import { cn } from '../../components/ui/utils';
import { Switch } from '../../components/ui/switch';
import { Label } from '../../components/ui/label';
import {
  defaultRestrictedMethods,
  formatAllowedMethodsLabel,
  HTTP_METHOD_OPTIONS,
  isAllMethodsAllowed,
  parseAllowedMethods,
  setAllowAllMethods,
  toggleAllowedMethod,
  unknownMethods,
} from '../../../lib/allowedMethodsOptions';

type Props = {
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
};

export function AllowedMethodsPicker({ value, onChange, disabled }: Props) {
  const allowAll = isAllMethodsAllowed(value);
  const selected = allowAll ? [] : parseAllowedMethods(value);
  const unknown = unknownMethods(value);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-4">
        <div>
          <Label className="text-foreground">HTTP methods</Label>
          <p className="text-xs text-muted-foreground mt-0.5">
            Giới hạn method được proxy qua route này. Method khác → 405.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs text-muted-foreground">Tất cả</span>
          <Switch
            checked={allowAll}
            disabled={disabled}
            onCheckedChange={(checked) => {
              onChange(checked ? setAllowAllMethods() : defaultRestrictedMethods());
            }}
          />
        </div>
      </div>

      <div
        className={cn('flex flex-wrap gap-1.5', allowAll && 'opacity-50 pointer-events-none')}
        role="group"
        aria-label="Allowed HTTP methods"
      >
        {HTTP_METHOD_OPTIONS.map((opt) => {
          const on = allowAll || selected.includes(opt.method);
          return (
            <button
              key={opt.method}
              type="button"
              disabled={disabled || allowAll}
              title={opt.hint}
              aria-pressed={on}
              onClick={() => onChange(toggleAllowedMethod(value, opt.method, !on))}
              className={cn(
                'h-7 min-w-[3.25rem] rounded-md border px-2.5 text-xs font-mono transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
                on
                  ? 'border-primary bg-primary text-primary-foreground shadow-sm'
                  : 'border-border bg-input/40 text-muted-foreground hover:border-primary/40 hover:text-foreground',
                (disabled || allowAll) && 'pointer-events-none',
              )}
            >
              {opt.method}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] leading-relaxed">
        {unknown.length > 0 ? (
          <>
            <span className="text-border">·</span>
            <span className="text-amber-200/80 font-mono">+{unknown.join(', ')}</span>
          </>
        ) : null}
      </div>
    </div>
  );
}
