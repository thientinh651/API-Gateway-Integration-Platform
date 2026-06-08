import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { AdminOnly } from '../components/auth/AdminOnly';
import { useAdminAuth } from '../../contexts/AdminAuthContext';
import { canDeleteClientKeys, canWriteClientKeys } from '../../lib/rbac';
import {
  ApiClientError,
  deleteClientKey,
  fetchClientKeys,
  type ClientKeyMeta,
} from '../../lib/api';
import { ClientKeyFlowSteps } from '../components/auth/ClientKeyFlowSteps';
import { ApiKeySummaryCards } from './auth/ApiKeySummaryCards';
import { ApiKeysDataTable } from './auth/ApiKeysDataTable';
import { CreateApiKeyDialog } from './auth/CreateApiKeyDialog';
import type { ApiKeyRow } from './auth/apiKeyTypes';
import { integrationTypeLabel } from './auth/clientKeyIntegrationTypes';

function metaToRow(m: ClientKeyMeta): ApiKeyRow {
  const typeLabel =
    m.integration_type && m.integration_type !== 'app'
      ? ` · ${integrationTypeLabel(m.integration_type)}`
      : '';
  return {
    id: String(m.id),
    name: `${m.name}${typeLabel}`,
    key: m.api_key ?? '(legacy — secret không hiển thị lại)',
    isActive: true,
    createdAt: m.auth_mode,
    rateLimitPerMinute: 0,
  };
}

function AuthAdmin() {
  const { user } = useAdminAuth();
  const allowCreateKeys = canWriteClientKeys(user);
  const allowDeleteKeys = canDeleteClientKeys(user);
  const [apiKeys, setApiKeys] = useState<ApiKeyRow[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!user) return;
    setLoadError(null);
    try {
      const list = await fetchClientKeys();
      setApiKeys(list.map(metaToRow));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setLoadError(msg);
      const status = e instanceof ApiClientError ? e.status : 0;
      if (status !== 401) toast.error('Không tải danh sách API key');
    }
  }, [user]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const handleDelete = async (id: string) => {
    try {
      await deleteClientKey(Number(id));
      await reload();
      toast.success('Đã xóa API key');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <>
      <div className="mb-6 sm:mb-8 flex flex-col sm:flex-row sm:justify-between sm:items-start gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl sm:text-3xl font-bold text-white mb-2">Bảo mật & API Key</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          {allowCreateKeys ? (
            <CreateApiKeyDialog onKeysChanged={() => void reload()} />
          ) : (
            <p className="text-xs text-muted-foreground self-center">Viewer: không tạo API key.</p>
          )}
        </div>
      </div>

      {loadError ? (
        <div className="mb-4 text-sm text-amber-400 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3">
          {loadError}
        </div>
      ) : null}

      <div className="mb-6">
        <ClientKeyFlowSteps activeStep={apiKeys.length > 0 ? 'copy' : 'create'} />
      </div>

      <ApiKeySummaryCards apiKeys={apiKeys} />
      <ApiKeysDataTable
        apiKeys={apiKeys}
        onDelete={(id) => void handleDelete(id)}
        canDelete={allowDeleteKeys}
      />
    </>
  );
}

export function Auth() {
  return (
    <AdminOnly
      title="Bảo mật & API keys"
      description="Đăng nhập để tạo và quản lý client API key trên gateway."
    >
      <AuthAdmin />
    </AdminOnly>
  );
}
