import { useState } from 'react';
import { toast } from 'sonner';
import { useGatewayRoutes } from '../../hooks/useGatewayRoutes';
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

export function Routes() {
  const { routes, setRoutes, loading, error, reload } = useGatewayRoutes();
  const [isOpen, setIsOpen] = useState(false);
  const [editingRoute, setEditingRoute] = useState<UiRoute | null>(null);
  const [formData, setFormData] = useState<RouteFormState>(emptyForm());

  const resetForm = () => {
    setFormData(emptyForm());
  };

  const handleDialogChange = (open: boolean) => {
    setIsOpen(open);
    if (!open) {
      setEditingRoute(null);
      resetForm();
    }
  };

  const handleCreate = () => {
    const newRoute: UiRoute = {
      id: Date.now().toString(),
      method: formData.method,
      path: formData.path,
      upstream: formData.upstream,
      timeout: parseInt(formData.timeout, 10),
      rateLimit: parseInt(formData.rateLimit, 10),
    };
    setRoutes((prev) => [...prev, newRoute]);
    setIsOpen(false);
    resetForm();
    toast.success('Route (local UI) — backend CRUD sau');
  };

  const handleUpdate = () => {
    if (!editingRoute) return;
    setRoutes((prev) =>
      prev.map((r) =>
        r.id === editingRoute.id
          ? {
              ...r,
              method: formData.method,
              path: formData.path,
              upstream: formData.upstream,
              timeout: parseInt(formData.timeout, 10),
              rateLimit: parseInt(formData.rateLimit, 10),
            }
          : r
      )
    );
    setIsOpen(false);
    setEditingRoute(null);
    resetForm();
    toast.success('Đã cập nhật (local UI)');
  };

  const handleDelete = (id: string) => {
    setRoutes((prev) => prev.filter((r) => r.id !== id));
    toast.success('Đã xóa (local UI)');
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
    if (editingRoute) handleUpdate();
    else handleCreate();
  };

  return (
    <>
      <div className="mb-8 flex justify-between items-center flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white mb-2">Quản lý Routes</h1>
          <p className="text-muted-foreground">Cấu hình định tuyến — seed từ gateway /api/routes</p>
        </div>
        <RouteFormDialog
          open={isOpen}
          onOpenChange={handleDialogChange}
          editingRoute={editingRoute}
          formData={formData}
          setFormData={setFormData}
          onSubmit={handleSubmit}
        />
      </div>

      <RoutesTable
        routes={routes}
        loading={loading}
        error={error}
        onReload={reload}
        onEdit={handleEdit}
        onDelete={handleDelete}
      />
    </>
  );
}
