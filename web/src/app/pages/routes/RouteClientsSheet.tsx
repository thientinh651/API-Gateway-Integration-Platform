import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Settings2, Users } from 'lucide-react';
import { toast } from 'sonner';
import { fetchRouteClients, type RouteAclClientRow } from '../../../lib/api';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '../../components/ui/sheet';
import type { UiRoute } from './routeTypes';

type Props = {
  route: UiRoute | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function RouteClientsSheet({ route, open, onOpenChange }: Props) {
  const [clients, setClients] = useState<RouteAclClientRow[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !route) return;
    setLoading(true);
    void fetchRouteClients(Number(route.id))
      .then(setClients)
      .catch((e) => {
        setClients([]);
        toast.error(e instanceof Error ? e.message : String(e));
      })
      .finally(() => setLoading(false));
  }, [open, route]);

  if (!route) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="bg-card border-border w-full sm:max-w-md overflow-y-auto">
        <SheetHeader className="text-left border-b border-border pb-4">
          <SheetTitle className="text-white flex items-center gap-2">
            <Users className="w-4 h-4 text-sky-400" />
            Client ACL
          </SheetTitle>
          <SheetDescription className="text-muted-foreground font-mono text-xs">
            {route.path}
          </SheetDescription>
        </SheetHeader>

        <div className="py-6 space-y-4">
          {loading ? (
            <p className="text-sm text-muted-foreground">Đang tải…</p>
          ) : clients.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border px-4 py-6 text-center">
              <p className="text-sm text-slate-300 mb-1">Không client nào bị giới hạn route này</p>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Client không có ACL riêng được phép gọi mọi route trong tenant. Gán ACL tại{' '}
                <Link to="/auth" className="text-primary hover:underline">
                  Client Registry
                </Link>
                .
              </p>
            </div>
          ) : (
            <ul className="space-y-2">
              {clients.map((c) => (
                <li
                  key={c.id}
                  className="flex items-center justify-between gap-2 rounded-lg border border-border bg-slate-950/40 px-3 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="text-sm text-slate-200 truncate">{c.name}</p>
                    <p className="text-[10px] text-muted-foreground">ID {c.id}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {c.status === 'active' ? (
                      <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/25 border text-[10px]">
                        Active
                      </Badge>
                    ) : (
                      <Badge className="bg-slate-500/10 text-slate-400 border-slate-500/25 border text-[10px]">
                        Disabled
                      </Badge>
                    )}
                    <Button asChild variant="ghost" size="sm" className="h-8 w-8 p-0 text-primary">
                      <Link to={`/auth?open=${c.id}`} title="Cấu hình client">
                        <Settings2 className="w-4 h-4" />
                      </Link>
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
