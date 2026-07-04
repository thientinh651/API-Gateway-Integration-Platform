import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { PasswordManagerTrap } from '../../components/forms/PasswordManagerTrap';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '../../components/ui/dialog';
import { Plus } from 'lucide-react';
import { Switch } from '../../components/ui/switch';
import {
  defaultNumberHandlers,
  useNumericDefaultsOnOpen,
} from '../../../lib/zeroDefaultNumberInput';
import type { UiRoute } from './routeTypes';
import { AllowedMethodsPicker } from './AllowedMethodsPicker';
import { RetryOnStatusPicker } from './RetryOnStatusPicker';

export type RouteFormState = {
  path: string;
  upstream: string;
  timeout: string;
  rateLimit: string;
  allowedMethods: string;
  transformAddHeaders: string;
  transformRemoveHeaders: string;
  retryMax: string;
  retryOnStatus: string;
  retryOnTimeout: boolean;
  queueOnFailure: boolean;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editingRoute: UiRoute | null;
  formData: RouteFormState;
  setFormData: (next: RouteFormState) => void;
  fieldErrors?: Record<string, string>;
  onSubmit: () => void;
  submitDisabled?: boolean;
  /** false = operator chỉ mở dialog khi sửa (không nút Thêm Route) */
  showCreateTrigger?: boolean;
};

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="text-xs text-destructive mt-1">{message}</p>;
}

export function RouteFormDialog({
  open,
  onOpenChange,
  editingRoute,
  formData,
  setFormData,
  fieldErrors = {},
  onSubmit,
  submitDisabled,
  showCreateTrigger = true,
}: Props) {
  const numericDefaults = useNumericDefaultsOnOpen(open, {
    timeout: formData.timeout,
    rateLimit: formData.rateLimit,
    retryMax: formData.retryMax,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {showCreateTrigger ? (
        <DialogTrigger asChild>
          <Button className="bg-primary hover:bg-primary/90">
            <Plus className="w-4 h-4 mr-2" />
            Thêm Route
          </Button>
        </DialogTrigger>
      ) : null}
      <DialogContent className="bg-card border-border flex max-h-[min(90vh,44rem)] w-full max-w-[calc(100%-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-xl">
        <DialogHeader className="shrink-0 border-b border-border/50 px-6 pt-6 pb-4">
          <DialogTitle className="text-white">
            {editingRoute ? 'Chỉnh sửa Route' : 'Tạo Route mới'}
          </DialogTitle>
        </DialogHeader>
        <form
          className="flex min-h-0 flex-1 flex-col"
          autoComplete="off"
          data-1p-ignore
          data-lpignore="true"
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit();
          }}
        >
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-4">
          <PasswordManagerTrap />
          <div>
            <Label htmlFor="route-path" className="text-foreground">
              Path
            </Label>
            <Input
              id="route-path"
              name="route-path"
              type="text"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              placeholder="/v1/api"
              value={formData.path}
              onChange={(e) => setFormData({ ...formData, path: e.target.value })}
              aria-invalid={Boolean(fieldErrors.path)}
              className={`bg-input border-border text-foreground mt-1 ${fieldErrors.path ? 'border-destructive' : ''}`}
            />
            <FieldError message={fieldErrors.path} />
          </div>
          <div>
            <Label htmlFor="route-upstream" className="text-foreground">
              Upstream URL
            </Label>
            <Input
              id="route-upstream"
              name="route-upstream"
              type="url"
              autoComplete="off"
              placeholder="https://httpbin.org"
              value={formData.upstream}
              onChange={(e) => setFormData({ ...formData, upstream: e.target.value })}
              aria-invalid={Boolean(fieldErrors.target)}
              className={`bg-input border-border text-foreground mt-1 ${fieldErrors.target ? 'border-destructive' : ''}`}
            />
            <FieldError message={fieldErrors.target} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="route-timeout" className="text-foreground">
                Timeout (s)
              </Label>
              <Input
                id="route-timeout"
                name="route-timeout"
                type="text"
                inputMode="numeric"
                autoComplete="off"
                value={formData.timeout}
                onChange={(e) => setFormData({ ...formData, timeout: e.target.value })}
                {...defaultNumberHandlers(formData.timeout, (v) =>
                  setFormData({ ...formData, timeout: v }),
                  numericDefaults.timeout,
                )}
                aria-invalid={Boolean(fieldErrors.timeout_secs)}
                className={`bg-input border-border text-foreground mt-1 ${fieldErrors.timeout_secs ? 'border-destructive' : ''}`}
              />
              <FieldError message={fieldErrors.timeout_secs} />
            </div>
            <div>
              <Label htmlFor="route-rate-limit" className="text-foreground">
                Rate limit (req/min)
              </Label>
              <Input
                id="route-rate-limit"
                name="route-rate-limit"
                type="text"
                inputMode="numeric"
                autoComplete="off"
                value={formData.rateLimit}
                onChange={(e) => setFormData({ ...formData, rateLimit: e.target.value })}
                {...defaultNumberHandlers(formData.rateLimit, (v) =>
                  setFormData({ ...formData, rateLimit: v }),
                  numericDefaults.rateLimit,
                )}
                aria-invalid={Boolean(fieldErrors.rate_limit_per_min)}
                className={`bg-input border-border text-foreground mt-1 ${fieldErrors.rate_limit_per_min ? 'border-destructive' : ''}`}
              />
              <FieldError message={fieldErrors.rate_limit_per_min} />
            </div>
          </div>
          <div>
            <AllowedMethodsPicker
              value={formData.allowedMethods}
              onChange={(allowedMethods) => setFormData({ ...formData, allowedMethods })}
            />
            <FieldError message={fieldErrors.allowed_methods} />
          </div>
          <div className="rounded-lg border border-border/60 p-4 space-y-3">
            <p className="text-sm font-semibold text-white">Transform / Retry / Queue</p>
            <p className="text-xs text-muted-foreground">
              Bật cấu hình tương ứng trong cài đặt hệ thống trước.
            </p>
            <div>
              <Label className="text-foreground">Add headers (JSON)</Label>
              <Input
                value={formData.transformAddHeaders}
                onChange={(e) => setFormData({ ...formData, transformAddHeaders: e.target.value })}
                placeholder='{"X-Proxy-Version":"1.0"}'
                className="bg-input border-border text-foreground mt-1 font-mono text-xs"
              />
              <FieldError message={fieldErrors.transform_add_headers} />
            </div>
            <div>
              <Label className="text-foreground">Remove headers (JSON array)</Label>
              <Input
                value={formData.transformRemoveHeaders}
                onChange={(e) => setFormData({ ...formData, transformRemoveHeaders: e.target.value })}
                placeholder='["Authorization"]'
                className="bg-input border-border text-foreground mt-1 font-mono text-xs"
              />
              <FieldError message={fieldErrors.transform_remove_headers} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-foreground">Retry max</Label>
                <Input
                  value={formData.retryMax}
                  onChange={(e) => setFormData({ ...formData, retryMax: e.target.value })}
                  {...defaultNumberHandlers(formData.retryMax, (v) =>
                    setFormData({ ...formData, retryMax: v }),
                    numericDefaults.retryMax,
                  )}
                  className="bg-input border-border text-foreground mt-1"
                />
                <FieldError message={fieldErrors.retry_max} />
              </div>
              <div>
                <Label className="text-foreground">Retry on timeout</Label>
                <div className="mt-1 flex h-9 items-center">
                  <Switch
                    checked={formData.retryOnTimeout}
                    onCheckedChange={(c) => setFormData({ ...formData, retryOnTimeout: c })}
                  />
                </div>
              </div>
            </div>
            <div>
              <Label className="text-foreground">Retry on status</Label>
              <RetryOnStatusPicker
                value={formData.retryOnStatus}
                onChange={(retryOnStatus) => setFormData({ ...formData, retryOnStatus })}
              />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-foreground">Queue on failure</Label>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Bật khi global DLQ tắt; nếu đã bật trong Cài đặt thì route này vẫn vào queue.
                </p>
              </div>
              <Switch
                checked={formData.queueOnFailure}
                onCheckedChange={(c) => setFormData({ ...formData, queueOnFailure: c })}
              />
            </div>
          </div>
          </div>
          <div className="flex shrink-0 gap-3 border-t border-border/50 bg-card px-6 py-4">
            <Button
              type="submit"
              disabled={submitDisabled}
              className="flex-1 bg-primary hover:bg-primary/90"
            >
              {editingRoute ? 'Cập nhật' : 'Tạo'}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="flex-1 border-border"
            >
              Hủy
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
