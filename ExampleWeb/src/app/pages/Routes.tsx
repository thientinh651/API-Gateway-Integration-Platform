import { useState } from 'react';
import { toast } from 'sonner';
import { AdminOnly } from '../components/auth/AdminOnly';
import { useAdminAuth } from '../../contexts/AdminAuthContext';
import { canWriteRoutes } from '../../lib/rbac';
import { useGatewayRoutes } from '../../hooks/useGatewayRoutes';
import {
  ApiClientError,
  createGatewayRoute,
  deleteGatewayRoute,
  updateGatewayRoute,
} from '../../lib/api';
import { formatApiErrorToast } from '../../lib/apiClientError';
import { RouteFormDialog, type RouteFormState } from './routes/RouteFormDialog';
import { RoutesTable } from './routes/RoutesTable';
import type { UiRoute } from './routes/routeTypes';

const emptyForm = (): RouteFormState => ({
  path: '',
  upstream: '',
  timeout: '30',
  rateLimit: '100',
});

function parseRouteNumbers(form: RouteFormState): { timeout_secs: number; rate_limit_per_min: number } {
  const timeout_secs = Number.parseInt(form.timeout.trim(), 10);
  const rate_limit_per_min = Number.parseInt(form.rateLimit.trim(), 10);
  return {
    timeout_secs: Number.isFinite(timeout_secs) ? timeout_secs : NaN,
    rate_limit_per_min: Number.isFinite(rate_limit_per_min) ? rate_limit_per_min : NaN,
  };
}

function routeBodyFromForm(form: RouteFormState) {
  const { timeout_secs, rate_limit_per_min } = parseRouteNumbers(form);
  return {
    path: form.path.trim(),
    target: form.upstream.trim(),
    timeout_secs,
    rate_limit_per_min,
  };
}

function RoutesAdmin() {
  const { user } = useAdminAuth();
  const allowWrite = canWriteRoutes(user);
  const { routes, loading, error, reload } = useGatewayRoutes(!!user);
  const [isOpen, setIsOpen] = useState(false);
  const [editingRoute, setEditingRoute] = useState<UiRoute | null>(null);
  const [formData, setFormData] = useState<RouteFormState>(emptyForm());
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const resetForm = () => {
    setFormData(emptyForm());
  };

  const handleDialogChange = (open: boolean) => {
    setIsOpen(open);
    if (!open) {
      setEditingRoute(null);
      resetForm();
      setFieldErrors({});
    }
  };

  const handleFormChange = (next: RouteFormState) => {
    setFormData(next);
    setFieldErrors({});
  };

  const handleApiFailure = (e: unknown) => {
    if (e instanceof ApiClientError && e.fields && Object.keys(e.fields).length > 0) {
      setFieldErrors(e.fields);
    }
    toast.error(formatApiErrorToast(e));
  };

  const handleCreate = async () => {
    setSaving(true);
    try {
      await createGatewayRoute(routeBodyFromForm(formData));
      await reload();
      setIsOpen(false);
      resetForm();
      setFieldErrors({});
      toast.success('Đã tạo route');
    } catch (e) {
      handleApiFailure(e);
    } finally {
      setSaving(false);
    }
  };

  const handleUpdate = async () => {
    if (!editingRoute) return;
    setSaving(true);
    try {
      await updateGatewayRoute(Number(editingRoute.id), routeBodyFromForm(formData));
      await reload();
      setIsOpen(false);
      setEditingRoute(null);
      resetForm();
      setFieldErrors({});
      toast.success('Đã cập nhật route');
    } catch (e) {
      handleApiFailure(e);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteGatewayRoute(Number(id));
      await reload();
      toast.success('Đã xóa route');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const handleEdit = (route: UiRoute) => {
    setEditingRoute(route);
    setFormData({
      path: route.path,
      upstream: route.upstream,
      timeout: String(route.timeout),
      rateLimit: String(route.rateLimit),
    });
    setIsOpen(true);
  };

  const handleSubmit = () => {
    if (editingRoute) void handleUpdate();
    else void handleCreate();
  };

  return (
    <>
      <div className="mb-8 flex justify-between items-center flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white mb-2">Quản lý Routes</h1>
          <p className="text-muted-foreground">SQLite + reload cache — CRUD qua gateway admin API</p>
        </div>
        {allowWrite ? (
          <RouteFormDialog
            open={isOpen}
            onOpenChange={handleDialogChange}
            editingRoute={editingRoute}
            formData={formData}
            setFormData={handleFormChange}
            fieldErrors={fieldErrors}
            onSubmit={handleSubmit}
            submitDisabled={saving}
          />
        ) : (
          <p className="text-xs text-muted-foreground">Viewer/Operator: không tạo route mới (chỉ admin).</p>
        )}
      </div>

      <RoutesTable
        routes={routes}
        loading={loading}
        error={error}
        onReload={reload}
        onEdit={allowWrite ? handleEdit : undefined}
        onDelete={allowWrite ? (id) => void handleDelete(id) : undefined}
      />
    </>
  );
}

export function Routes() {
  return (
    <AdminOnly
      title="Quản lý Routes"
      description="Đăng nhập để xem và chỉnh route gateway (SQLite, reload cache)."
    >
      <RoutesAdmin />
    </AdminOnly>
  );
}
