import { Gauge, KeyRound, Lock, Users } from 'lucide-react';
import { Link } from 'react-router';
import { Card } from '../../components/ui/card';
import type { ClientRegistryRow } from './clientRegistryTypes';

export function ClientRegistrySummary({ clients }: { clients: ClientRegistryRow[] }) {
  const total = clients.length;
  const active = clients.filter((c) => c.isActive).length;
  const disabled = total - active;
  const restricted = clients.filter((c) => c.allowedRouteIds.length > 0).length;
  const withClientRl = clients.filter((c) => c.rateLimitPerMinute > 0).length;

  const cards = [
    {
      label: 'Client đã đăng ký',
      value: total,
      hint: total === 0 ? 'Chưa có system-to-system client' : `${active} đang active`,
      icon: Users,
      iconClass: 'text-primary bg-primary/10',
    },
    {
      label: 'OAuth2 clients',
      value: clients.filter((c) => c.authMode === 'oauth_client' || c.authMode === 'hmac').length,
      hint: 'Client ID + Secret → JWT Bearer (OAuth2)',
      icon: KeyRound,
      iconClass: 'text-emerald-400 bg-emerald-500/10',
    },
    {
      label: 'Phân quyền route',
      value: restricted,
      hint: restricted === 0 ? 'Mặc định: full tenant' : 'Client bị giới hạn route',
      icon: Lock,
      iconClass: 'text-sky-400 bg-sky-500/10',
    },
    {
      label: 'Rate limit riêng',
      value: withClientRl,
      hint: disabled > 0 ? `${disabled} client đã tắt` : '0',
      icon: Gauge,
      iconClass: 'text-amber-400 bg-amber-500/10',
    },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
      {cards.map((card, idx) => {
        const Icon = card.icon;
        return (
          <Card key={card.label} className="p-5 rounded-2xl bg-card/80 border-border">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  {card.label}
                </p>
                <p className="text-3xl font-bold text-white mt-1">{card.value}</p>
                <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                  {idx === 0 ? (
                    total > 0 ? (
                      <>
                        <Link to="/auth?status=active" className="text-emerald-400 hover:underline">
                          {active} active
                        </Link>
                        {disabled > 0 ? (
                          <>
                            {' · '}
                            <Link to="/auth?status=disabled" className="text-amber-400 hover:underline">
                              {disabled} tắt
                            </Link>
                          </>
                        ) : null}
                      </>
                    ) : (
                      card.hint
                    )
                  ) : (
                    card.hint
                  )}
                </p>
              </div>
              <div className={`p-2 rounded-lg shrink-0 ${card.iconClass}`}>
                <Icon className="w-5 h-5" />
              </div>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
