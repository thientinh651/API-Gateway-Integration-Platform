import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { AdminOnly } from '../components/auth/AdminOnly';
import { useAdminAuth } from '../../contexts/AdminAuthContext';
import { canDeleteClientKeys, canWriteClientKeys } from '../../lib/rbac';
import {
  ApiClientError,
  createClientKey,
  deleteClientKey,
  fetchClientKeys,
  type ClientKeyMeta,
} from '../../lib/api';
import { ApiKeySummaryCards } from './auth/ApiKeySummaryCards';
import { ApiKeysDataTable } from './auth/ApiKeysDataTable';
import { CreateApiKeyDialog } from './auth/CreateApiKeyDialog';
import { CreateApiKeyRsaDialog } from './auth/CreateApiKeyRsaDialog';
import type { ApiKeyRow } from './auth/apiKeyTypes';

function metaToRow(m: ClientKeyMeta): ApiKeyRow {
  const label = m.integration_type && m.integration_type !== 'app' ? ` [${m.integration_type}]` : '';
  return {
    id: String(m.id),
    name: `${m.name}${label}`,
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
      <div className="mb-8 flex justify-between items-center flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white mb-2">Bảo mật & Authentication</h1>
          <p className="text-muted-foreground">
            Hai cách cấp credential (giống WSO2 đơn giản): (1) HTTPS thường + HMAC; (2){' '}
            <strong className="text-foreground">RSA public encrypt</strong> → gateway private decrypt
            khi đăng ký secret.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {allowCreateKeys ? (
            <>
              <CreateApiKeyDialog onKeysChanged={() => void reload()} />
              <CreateApiKeyRsaDialog onKeysChanged={() => void reload()} />
            </>
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
