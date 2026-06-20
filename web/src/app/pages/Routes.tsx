import { Link } from 'react-router';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { AdminOnly } from '../components/auth/AdminOnly';
import { useAdminAuth } from '../../contexts/AdminAuthContext';
import { canCreateRoute, canDeleteRoute, canUpdateRoute } from '../../lib/rbac';
import { useGatewayRoutes } from '../../hooks/useGatewayRoutes';
import {
  createGatewayRoute,
  deleteGatewayRoute,
  fetchRoutesAclSummary,
  updateGatewayRoute,
  type RouteAclSummaryRow,
} from '../../lib/api';
import { toastApiError } from '../../lib/apiClientError';
import { handleFormApiError } from '../../lib/formValidation';
import { parseDefaultNumber } from '../../lib/zeroDefaultNumberInput';
import { RouteFormDialog, type RouteFormState } from './routes/RouteFormDialog';
import { RoutesTable } from './routes/RoutesTable';
import { RouteClientsSheet } from './routes/RouteClientsSheet';
import type { UiRoute } from './routes/routeTypes';

const emptyForm = (): RouteFormState => ({
  path: '',
  upstream: '',
  timeout: '30',
  rateLimit: '100',
  transformAddHeaders: '{}',
  transformRemoveHeaders: '[]',
  retryMax: '0',
  retryOnStatus: '502,503,504',
  retryOnTimeout: true,
  queueOnFailure: false,
});

type RouteNumericDefaults = Pick<RouteFormState, 'timeout' | 'rateLimit' | 'retryMax'>;

function routeNumericDefaults(form: RouteFormState): RouteNumericDefaults {
  return {
    timeout: form.timeout,
    rateLimit: form.rateLimit,
    retryMax: form.retryMax,
  };
}

function parseRouteNumbers(
  form: RouteFormState,
  defaults: RouteNumericDefaults,
): { timeout_secs: number; rate_limit_per_min: number } {
  const timeout_secs = Number.parseInt(parseDefaultNumber(form.timeout, defaults.timeout), 10);
  const rate_limit_per_min = Number.parseInt(parseDefaultNumber(form.rateLimit, defaults.rateLimit), 10);
  return {
    timeout_secs: Number.isFinite(timeout_secs) ? timeout_secs : NaN,
    rate_limit_per_min: Number.isFinite(rate_limit_per_min) ? rate_limit_per_min : NaN,
  };
}

function routeBodyFromForm(form: RouteFormState, defaults: RouteNumericDefaults) {
  const { timeout_secs, rate_limit_per_min } = parseRouteNumbers(form, defaults);
  return {
    path: form.path.trim(),
    target: form.upstream.trim(),
    timeout_secs,
    rate_limit_per_min,
    transform_add_headers: form.transformAddHeaders.trim() || '{}',
    transform_remove_headers: form.transformRemoveHeaders.trim() || '[]',
    retry_max: Number.parseInt(parseDefaultNumber(form.retryMax, defaults.retryMax), 10) || 0,
    retry_on_status: form.retryOnStatus.trim() || '502,503,504',
    retry_on_timeout: form.retryOnTimeout ? 1 : 0,
    queue_on_failure: form.queueOnFailure,
  };
}

function RoutesAdmin() {
  const { user } = useAdminAuth();
  const allowCreate = canCreateRoute(user);
  const allowUpdate = canUpdateRoute(user);
  const allowDelete = canDeleteRoute(user);
  const { routes, loading, error, reload } = useGatewayRoutes(!!user);
  const [aclSummary, setAclSummary] = useState<RouteAclSummaryRow[]>([]);

  const loadAcl = useCallback(async () => {
    try {
      const rows = await fetchRoutesAclSummary();
      setAclSummary(rows);
    } catch {
      setAclSummary([]);
    }
  }, []);

  useEffect(() => {
    if (user) void loadAcl();
  }, [user, loadAcl, routes.length]);
  const [isOpen, setIsOpen] = useState(false);
  const [editingRoute, setEditingRoute] = useState<UiRoute | null>(null);
  const [aclRoute, setAclRoute] = useState<UiRoute | null>(null);
  const [aclOpen, setAclOpen] = useState(false);
  const [formData, setFormData] = useState<RouteFormState>(emptyForm());
  const [formNumericDefaults, setFormNumericDefaults] = useState<RouteNumericDefaults>(() =>
    routeNumericDefaults(emptyForm()),
  );
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const resetForm = () => {
    const empty = emptyForm();
    setFormData(empty);
    setFormNumericDefaults(routeNumericDefaults(empty));
  };

  const handleDialogChange = (open: boolean) => {
    setIsOpen(open);
    if (open) {
      setFormNumericDefaults(routeNumericDefaults(formData));
    } else {
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
    handleFormApiError(e, setFieldErrors);
  };

  const handleCreate = async () => {
    setSaving(true);
    try {
      await createGatewayRoute(routeBodyFromForm(formData, formNumericDefaults));
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
      await updateGatewayRoute(Number(editingRoute.id), routeBodyFromForm(formData, formNumericDefaults));
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
    const fd: RouteFormState = {
      path: route.path,
      upstream: route.upstream,
      timeout: String(route.timeout),
      rateLimit: String(route.rateLimit),
      transformAddHeaders: route.transformAddHeaders,
      transformRemoveHeaders: route.transformRemoveHeaders,
      retryMax: String(route.retryMax),
      retryOnStatus: route.retryOnStatus,
      retryOnTimeout: route.retryOnTimeout,
      queueOnFailure: route.queueOnFailure,
    };
    setFormData(fd);
    setFormNumericDefaults(routeNumericDefaults(fd));
    setIsOpen(true);
  };

  const handleSubmit = () => {
    if (editingRoute) {
      if (!allowUpdate) return;
      void handleUpdate();
    } else {
      if (!allowCreate) return;
      void handleCreate();
    }
  };

  return (
    <>
      <div className="mb-6 sm:mb-8 flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4">
        <div className="max-w-2xl">
          <p className="text-[10px] font-bold uppercase tracking-wider text-violet-400 mb-1">
            Middleware — Routing layer
          </p>
          <h1 className="text-2xl sm:text-3xl font-bold text-white mb-2">Quản lý Routes</h1>
              <Link to="/auth" className="text-primary hover:underline">
              Client Registry
            </Link>
        </div>
        {(allowCreate || allowUpdate) && (
          <RouteFormDialog
            open={isOpen}
            onOpenChange={handleDialogChange}
            editingRoute={editingRoute}
            formData={formData}
            setFormData={handleFormChange}
            fieldErrors={fieldErrors}
            onSubmit={handleSubmit}
            submitDisabled={saving}
            showCreateTrigger={allowCreate}
          />
        )}
        {!allowCreate && !allowUpdate && (
          <p className="text-xs text-muted-foreground">Viewer: chỉ xem danh sách route.</p>
        )}
        {!allowCreate && allowUpdate && (
          <p className="text-xs text-muted-foreground">
            Operator: sửa route có sẵn — không tạo/xóa route mới.
          </p>
        )}
      </div>

      <RoutesTable
        routes={routes}
        aclSummary={aclSummary}
        loading={loading}
        error={error}
        onReload={reload}
        onEdit={allowUpdate ? handleEdit : undefined}
        onDelete={allowDelete ? (id) => void handleDelete(id) : undefined}
        onViewAcl={(route) => {
          setAclRoute(route);
          setAclOpen(true);
        }}
      />

      <RouteClientsSheet route={aclRoute} open={aclOpen} onOpenChange={setAclOpen} />
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
