import { CheckCircle2, XCircle } from 'lucide-react';
import { Card } from '../../components/ui/card';
import type { ApiKeyRow } from './apiKeyTypes';

export function ApiKeySummaryCards({ apiKeys }: { apiKeys: ApiKeyRow[] }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
      <Card className="p-6 rounded-2xl bg-card/80 backdrop-blur-sm border-border">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-bold text-muted-foreground uppercase tracking-wider">Total Keys</h3>
          <div className="p-2 bg-blue-500/10 rounded-lg">
            <CheckCircle2 className="w-5 h-5 text-blue-500" />
          </div>
        </div>
        <p className="text-3xl font-bold text-white">{apiKeys.length}</p>
      </Card>
      <Card className="p-6 rounded-2xl bg-card/80 backdrop-blur-sm border-border">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-bold text-muted-foreground uppercase tracking-wider">Active</h3>
          <div className="p-2 bg-emerald-500/10 rounded-lg">
            <CheckCircle2 className="w-5 h-5 text-emerald-500" />
          </div>
        </div>
        <p className="text-3xl font-bold text-white">{apiKeys.filter((k) => k.isActive).length}</p>
      </Card>
      <Card className="p-6 rounded-2xl bg-card/80 backdrop-blur-sm border-border">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-bold text-muted-foreground uppercase tracking-wider">Inactive</h3>
          <div className="p-2 bg-red-500/10 rounded-lg">
            <XCircle className="w-5 h-5 text-red-500" />
          </div>
        </div>
        <p className="text-3xl font-bold text-white">{apiKeys.filter((k) => !k.isActive).length}</p>
      </Card>
    </div>
  );
}
