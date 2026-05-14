import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { Edit, RefreshCw, Trash2 } from 'lucide-react';
import type { UiRoute } from './routeTypes';

type Props = {
  routes: UiRoute[];
  loading: boolean;
  error: string | null;
  onReload: () => void;
  onEdit: (route: UiRoute) => void;
  onDelete: (id: string) => void;
};

export function RoutesTable({ routes, loading, error, onReload, onEdit, onDelete }: Props) {
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
          <code className="text-xs bg-slate-900 px-1 rounded">ExampleWeb/.env.example</code> →{' '}
          <code className="text-xs bg-slate-900 px-1 rounded">.env</code> và set key.
        </div>
      ) : null}
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead className="bg-slate-900/50 text-[10px] uppercase text-muted-foreground font-bold">
            <tr>
              <th className="px-6 py-4">Method</th>
              <th className="px-6 py-4">Path</th>
              <th className="px-6 py-4">Upstream</th>
              <th className="px-6 py-4">Timeout</th>
              <th className="px-6 py-4">Rate Limit</th>
              <th className="px-6 py-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="text-sm">
            {loading ? (
              <tr className="border-b border-border/50">
                <td className="px-6 py-4 text-muted-foreground" colSpan={6}>
                  Đang tải…
                </td>
              </tr>
            ) : (
              routes.map((route) => (
                <tr key={route.id} className="border-b border-border/50 hover:bg-primary/5">
                  <td className="px-6 py-4">
                    <span className="px-2 py-1 bg-primary/10 text-primary rounded text-xs font-bold">
                      {route.method}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-slate-300 font-mono text-xs">{route.path}</td>
                  <td className="px-6 py-4 text-slate-400 text-xs">{route.upstream}</td>
                  <td className="px-6 py-4 text-slate-400">{route.timeout}s</td>
                  <td className="px-6 py-4 text-slate-400">{route.rateLimit}/min</td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onEdit(route)}
                        className="text-blue-400 hover:text-blue-300 hover:bg-blue-500/10"
                      >
                        <Edit className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onDelete(route.id)}
                        className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
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
