import { Copy, Trash2 } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import type { ApiKeyRow } from './apiKeyTypes';

type Props = {
  apiKeys: ApiKeyRow[];
  onDelete: (id: string) => void;
};

export function ApiKeysDataTable({ apiKeys, onDelete }: Props) {
  const canCopyKey = (k: string) => k.startsWith('avaso_');

  return (
    <Card className="rounded-2xl overflow-hidden bg-card/80 backdrop-blur-sm border-border">
      <div className="p-6 border-b border-border">
        <h3 className="font-bold text-white text-sm uppercase tracking-wider">API Keys ({apiKeys.length})</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead className="bg-slate-900/50 text-[10px] uppercase text-muted-foreground font-bold">
            <tr>
              <th className="px-6 py-4">Name</th>
              <th className="px-6 py-4">Key</th>
              <th className="px-6 py-4">Rate Limit</th>
              <th className="px-6 py-4">Created</th>
              <th className="px-6 py-4">Status</th>
              <th className="px-6 py-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="text-sm">
            {apiKeys.map((key) => (
              <tr key={key.id} className="border-b border-border/50 hover:bg-primary/5">
                <td className="px-6 py-4 text-slate-300 font-medium">{key.name}</td>
                <td className="px-6 py-4 text-slate-400 font-mono text-xs">{key.key}</td>
                <td className="px-6 py-4 text-slate-400">
                  {key.rateLimitPerMinute > 0 ? `${key.rateLimitPerMinute}/min` : '—'}
                </td>
                <td className="px-6 py-4 text-slate-400">{key.createdAt}</td>
                <td className="px-6 py-4">
                  <span className="text-xs font-bold text-emerald-400">Active</span>
                </td>
                <td className="px-6 py-4 text-right">
                  <div className="flex justify-end gap-2">
                    {canCopyKey(key.key) ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => void navigator.clipboard.writeText(key.key)}
                        className="text-blue-400 hover:text-blue-300 hover:bg-blue-500/10"
                      >
                        <Copy className="w-4 h-4" />
                      </Button>
                    ) : null}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onDelete(key.id)}
                      className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
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
