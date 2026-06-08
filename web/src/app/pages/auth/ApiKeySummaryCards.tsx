import { KeyRound, Play, ShieldCheck } from 'lucide-react';
import { Link } from 'react-router';
import { Card } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import type { ApiKeyRow } from './apiKeyTypes';

export function ApiKeySummaryCards({ apiKeys }: { apiKeys: ApiKeyRow[] }) {
  const count = apiKeys.length;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
      <Card className="p-5 rounded-2xl bg-card/80 border-border">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Client keys
            </p>
            <p className="text-3xl font-bold text-white mt-1">{count}</p>
            <p className="text-xs text-muted-foreground mt-1">
              {count === 0 ? 'Chưa có key — bấm Tạo API Key' : 'Đang hoạt động trên gateway'}
            </p>
          </div>
          <div className="p-2 bg-primary/10 rounded-lg">
            <KeyRound className="w-5 h-5 text-primary" />
          </div>
        </div>
      </Card>

      <Card className="p-5 rounded-2xl bg-card/80 border-border">
        <div className="flex items-start gap-3">
          <div className="p-2 bg-emerald-500/10 rounded-lg shrink-0">
            <ShieldCheck className="w-5 h-5 text-emerald-400" />
          </div>
          <div>
            <p className="text-sm font-semibold text-white">Cách dùng key</p>
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
              App gửi <code className="text-slate-400">X-API-Key</code> + chữ ký HMAC tới path{' '}
              <code className="text-slate-400">/v1/api/...</code>
            </p>
          </div>
        </div>
      </Card>

      <Card className="p-5 rounded-2xl bg-card/80 border-border flex flex-col justify-between">
        <div className="flex items-start gap-3">
          <div className="p-2 bg-blue-500/10 rounded-lg shrink-0">
            <Play className="w-5 h-5 text-blue-400" />
          </div>
          <div>
            <p className="text-sm font-semibold text-white">Bước tiếp theo</p>
            <p className="text-xs text-muted-foreground mt-1">
              Kiểm tra key trên sandbox proxy — không cần viết code.
            </p>
          </div>
        </div>
        <Button asChild variant="outline" size="sm" className="mt-4 w-full border-border">
          <Link to="/proxy-try">Mở Thử gọi Proxy</Link>
        </Button>
      </Card>
    </div>
  );
}
