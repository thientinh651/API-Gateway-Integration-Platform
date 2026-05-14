import { useState } from 'react';
import { toast } from 'sonner';
import { ApiKeySummaryCards } from './auth/ApiKeySummaryCards';
import { ApiKeysDataTable } from './auth/ApiKeysDataTable';
import { CreateApiKeyDialog } from './auth/CreateApiKeyDialog';
import type { ApiKeyRow } from './auth/apiKeyTypes';

const seedKeys: ApiKeyRow[] = [
  {
    id: '1',
    name: 'Production App',
    key: 'avaso_***************************abc123',
    isActive: true,
    createdAt: '2026-05-10',
    rateLimitPerMinute: 1000,
  },
  {
    id: '2',
    name: 'Mobile App',
    key: 'avaso_***************************def456',
    isActive: true,
    createdAt: '2026-05-12',
    rateLimitPerMinute: 500,
  },
  {
    id: '3',
    name: 'Test Environment',
    key: 'avaso_***************************xyz789',
    isActive: false,
    createdAt: '2026-05-14',
    rateLimitPerMinute: 100,
  },
];

export function Auth() {
  const [apiKeys, setApiKeys] = useState<ApiKeyRow[]>(seedKeys);

  const handleCopy = (key: string) => {
    void navigator.clipboard.writeText(key);
    toast.success('Đã copy API key');
  };

  const handleDelete = (id: string) => {
    setApiKeys((k) => k.filter((x) => x.id !== id));
    toast.success('API Key đã được xóa');
  };

  const handleToggleActive = (id: string) => {
    setApiKeys((keys) => {
      const row = keys.find((k) => k.id === id);
      if (row) {
        toast.success(`API Key "${row.name}" đã được ${row.isActive ? 'vô hiệu hóa' : 'kích hoạt'}`);
      }
      return keys.map((k) => (k.id === id ? { ...k, isActive: !k.isActive } : k));
    });
  };

  const handleAdd = (row: ApiKeyRow) => {
    setApiKeys((prev) => [...prev, row]);
  };

  return (
    <>
      <div className="mb-8 flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-white mb-2">Bảo mật & Authentication</h1>
          <p className="text-muted-foreground">Quản lý API Keys và xác thực client</p>
        </div>
        <CreateApiKeyDialog onAdd={handleAdd} />
      </div>

      <ApiKeySummaryCards apiKeys={apiKeys} />
      <ApiKeysDataTable
        apiKeys={apiKeys}
        onCopy={handleCopy}
        onDelete={handleDelete}
        onToggleActive={handleToggleActive}
      />
    </>
  );
}
