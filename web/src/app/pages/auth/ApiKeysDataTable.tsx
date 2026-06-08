import { Copy, ExternalLink, Trash2 } from 'lucide-react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { Button } from '../../components/ui/button';
import { ConfirmDangerButton } from '../../components/forms/ConfirmDangerButton';
import { Card } from '../../components/ui/card';
import { Badge } from '../../components/ui/badge';
import type { ApiKeyRow } from './apiKeyTypes';

type Props = {
  apiKeys: ApiKeyRow[];
  onDelete: (id: string) => void;
  canDelete?: boolean;
};

export function ApiKeysDataTable({ apiKeys, onDelete, canDelete = true }: Props) {
  const navigate = useNavigate();

  const canCopyKey = (k: string) => k.startsWith('avaso_');

  const goProxyTry = () => {
    navigate('/proxy-try');
  };

  if (apiKeys.length === 0) {
    return (
      <Card className="rounded-2xl p-10 text-center bg-card/80 border-dashed border-2 border-border">
        <p className="text-white font-medium mb-1">Chưa có API Key</p>
        <p className="text-sm text-muted-foreground max-w-md mx-auto">
          Bấm <strong className="text-slate-300">Tạo API Key</strong> ở góc trên — nhận cặp Key +
          Secret, rồi thử gọi tại Thử gọi Proxy.
        </p>
      </Card>
    );
  }

  return (
    <Card className="rounded-2xl overflow-hidden bg-card/80 border-border">
      <div className="px-6 py-4 border-b border-border flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-bold text-white text-sm">Danh sách key ({apiKeys.length})</h3>
        <p className="text-[11px] text-muted-foreground">Secret không lưu trên dashboard</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left min-w-[640px]">
          <thead className="bg-slate-900/50 text-[10px] uppercase text-muted-foreground font-bold">
            <tr>
              <th className="px-6 py-3">Tên</th>
              <th className="px-6 py-3">API Key</th>
              <th className="px-6 py-3">Xác thực</th>
              <th className="px-6 py-3">Trạng thái</th>
              <th className="px-6 py-3 text-right">Thao tác</th>
            </tr>
          </thead>
          <tbody className="text-sm">
            {apiKeys.map((key) => (
              <tr key={key.id} className="border-b border-border/50 hover:bg-primary/5">
                <td className="px-6 py-4 text-slate-300 font-medium">{key.name}</td>
                <td className="px-6 py-4 font-mono text-xs text-slate-400 max-w-[200px] truncate">
                  {key.key}
                </td>
                <td className="px-6 py-4 text-slate-400 text-xs">{key.createdAt}</td>
                <td className="px-6 py-4">
                  <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/25 border text-[10px]">
                    Hoạt động
                  </Badge>
                </td>
                <td className="px-6 py-4">
                  <div className="flex justify-end gap-1">
                    {canCopyKey(key.key) ? (
                      <>
                        <Button
                          variant="ghost"
                          size="sm"
                          title="Copy API Key"
                          onClick={() => {
                            void navigator.clipboard.writeText(key.key);
                            toast.success('Đã copy API Key');
                          }}
                          className="text-blue-400 hover:text-blue-300 hover:bg-blue-500/10"
                        >
                          <Copy className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          title="Mở Thử gọi Proxy — tự nhập Key + Secret"
                          onClick={goProxyTry}
                          className="text-primary hover:bg-primary/10"
                        >
                          <ExternalLink className="w-4 h-4" />
                        </Button>
                      </>
                    ) : null}
                    {canDelete ? (
                      <ConfirmDangerButton
                        title="Xóa API Key?"
                        description={`Xóa key "${key.name}" — không khôi phục. App dùng key này sẽ bị từ chối ngay.`}
                        confirmLabel="Xóa key"
                        onConfirm={() => onDelete(key.id)}
                        className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
                      >
                        <Trash2 className="w-4 h-4" />
                      </ConfirmDangerButton>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
