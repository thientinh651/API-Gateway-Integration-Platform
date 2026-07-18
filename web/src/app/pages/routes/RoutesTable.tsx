import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { ConfirmDangerButton } from '../../components/forms/ConfirmDangerButton';
import { Edit, RefreshCw, Trash2, Users } from 'lucide-react';
import type { RouteAclSummaryRow } from '../../../lib/api';
import { formatAllowedMethodsLabel } from '../../../lib/allowedMethodsOptions';
import type { UiRoute } from './routeTypes';

type Props = {
  routes: UiRoute[];
  aclSummary: RouteAclSummaryRow[];
  loading: boolean;
  error: string | null;
  onReload: () => void;
  onEdit?: (route: UiRoute) => void;
  onDelete?: (id: string) => void;
  onViewAcl?: (route: UiRoute) => void;
  undoSeconds?: number;
};

export function RoutesTable({
  routes,
  aclSummary,
  loading,
  error,
  onReload,
  onEdit,
  onDelete,
  onViewAcl,
  undoSeconds = 10,
}: Props) {
  const aclMap = new Map(aclSummary.map((a) => [a.route_id, a]));
  return (
    <Card className="rounded-2xl overflow-hidden bg-card/80 backdrop-blur-sm border-border">
      <div className="p-6 border-b border-border flex justify-between items-center flex-wrap gap-2">
        <h3 className="font-bold text-white text-sm uppercase tracking-wider">
          Danh sách Routes ({loading ? '…' : routes.length})
        </h3>
        <Button variant="outline" size="sm" className="border-border" onClick={() => void onReload()}>
          <RefreshCw className="w-4 h-4 mr-2" />
          Reload từ gateway
        </Button>
      </div>
      {error ? (
        <div className="p-6 text-sm text-amber-400 border-b border-border/50">
          Không đọc được /api/routes: {error}. Dev: copy{' '}
          <code className="text-xs bg-slate-900 px-1 rounded">web/.env.example</code> →{' '}
          <code className="text-xs bg-slate-900 px-1 rounded">.env</code> và set key.
        </div>
      ) : null}
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead className="bg-slate-900/50 text-[10px] uppercase text-muted-foreground font-bold">
            <tr>
              <th className="px-6 py-4">Path</th>
              <th className="px-6 py-4">Methods</th>
              <th className="px-6 py-4">Upstream</th>
              <th className="px-6 py-4">Timeout</th>
              <th className="px-6 py-4">Rate limit</th>
              <th className="px-6 py-4">Client ACL</th>
              <th className="px-6 py-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="text-sm">
            {loading ? (
              <tr className="border-b border-border/50">
                <td className="px-6 py-4 text-muted-foreground" colSpan={7}>
                  Đang tải…
                </td>
              </tr>
            ) : (
              routes.map((route) => (
                <tr key={route.id} className="border-b border-border/50 hover:bg-primary/5">
                  <td className="px-6 py-4 text-slate-300 font-mono text-xs">{route.path}</td>
                  <td className="px-6 py-4 text-slate-400 text-xs font-mono">
                    {formatAllowedMethodsLabel(route.allowedMethods)}
                  </td>
                  <td className="px-6 py-4 text-slate-400 text-xs">{route.upstream}</td>
                  <td className="px-6 py-4 text-slate-400">{route.timeout}s</td>
                  <td className="px-6 py-4 text-slate-400">
                    {route.rateLimit > 0 ? `${route.rateLimit}/min` : 'config.yaml'}
                  </td>
                  <td className="px-6 py-4 text-xs text-slate-400 max-w-[140px]">
                    {(() => {
                      const acl = aclMap.get(Number(route.id));
                      if (!acl || acl.client_count === 0) {
                        return <span className="text-muted-foreground">Mọi client tenant</span>;
                      }
                      return (
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 text-sky-400 hover:underline"
                          title={acl.client_names.join(', ')}
                          onClick={() => onViewAcl?.(route)}
                        >
                          <Users className="w-3 h-3" />
                          {acl.client_count} client
                        </button>
                      );
                    })()}
                  </td>
                  <td className="px-6 py-4 text-right">
                    {onEdit || onDelete ? (
                      <div className="flex justify-end gap-2">
                        {onEdit ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => onEdit(route)}
                            className="text-blue-400 hover:text-blue-300 hover:bg-blue-500/10"
                          >
                            <Edit className="w-4 h-4" />
                          </Button>
                        ) : null}
                        {onDelete ? (
                          <ConfirmDangerButton
                            title="Xóa route?"
                            description={
                              undoSeconds > 0
                                ? `Ẩn route ${route.path} → ${route.upstream}. Có ${undoSeconds}s hoàn tác trước khi xóa thật.`
                                : `Xóa route ${route.path} → ${route.upstream}. Request tới path này sẽ 404.`
                            }
                            confirmLabel="Xóa route"
                            onConfirm={() => onDelete(route.id)}
                            className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
                          >
                            <Trash2 className="w-4 h-4" />
                          </ConfirmDangerButton>
                        ) : null}
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
