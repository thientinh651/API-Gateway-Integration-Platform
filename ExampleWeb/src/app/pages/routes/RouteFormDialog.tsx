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
import type { UiRoute } from './routeTypes';

export type RouteFormState = {
  path: string;
  upstream: string;
  timeout: string;
  rateLimit: string;
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
}: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button className="bg-primary hover:bg-primary/90">
          <Plus className="w-4 h-4 mr-2" />
          Thêm Route
        </Button>
      </DialogTrigger>
      <DialogContent className="bg-card border-border">
        <DialogHeader>
          <DialogTitle className="text-white">
            {editingRoute ? 'Chỉnh sửa Route' : 'Tạo Route mới'}
          </DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4 mt-4"
          autoComplete="off"
          data-1p-ignore
          data-lpignore="true"
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit();
          }}
        >
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
                aria-invalid={Boolean(fieldErrors.rate_limit_per_min)}
                className={`bg-input border-border text-foreground mt-1 ${fieldErrors.rate_limit_per_min ? 'border-destructive' : ''}`}
              />
              <FieldError message={fieldErrors.rate_limit_per_min} />
              <p className="text-xs text-muted-foreground mt-1">0 = dùng limit toàn cục trong config.yaml</p>
            </div>
          </div>
          <div className="flex gap-3">
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
