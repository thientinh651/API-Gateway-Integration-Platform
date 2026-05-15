import { useState } from 'react';
import { toast } from 'sonner';
import { AdminOnly } from '../components/auth/AdminOnly';
import { useAdminAuth } from '../../contexts/AdminAuthContext';
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
  method: 'GET',
  path: '',
  upstream: '',
  timeout: '30',
  rateLimit: '100',
});

function RoutesAdmin() {
  const { user } = useAdminAuth();
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
      await createGatewayRoute({
        path: formData.path.trim(),
        target: formData.upstream.trim(),
      });
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
      await updateGatewayRoute(Number(editingRoute.id), {
        path: formData.path.trim(),
        target: formData.upstream.trim(),
      });
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
      method: route.method,
      path: route.path,
      upstream: route.upstream,
      timeout: route.timeout?.toString() || '30',
      rateLimit: route.rateLimit?.toString() || '100',
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
      </div>

      <RoutesTable
        routes={routes}
        loading={loading}
        error={error}
        onReload={reload}
        onEdit={handleEdit}
        onDelete={(id) => void handleDelete(id)}
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
