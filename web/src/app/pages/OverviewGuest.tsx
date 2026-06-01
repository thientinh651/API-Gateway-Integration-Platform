import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import {
  ArrowDown,
  ArrowRight,
  Box,
  Cpu,
  FileCode,
  GitBranch,
  Layers,
  Lock,
  Network,
  Server,
  Shield,
  Sparkles,
  Zap,
} from 'lucide-react';
import { Card } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { TechPanel } from '../components/tech/TechPanel';

type HealthPayload = {
  status?: string;
  service?: string;
  version?: string;
  instance?: string;
};

const TERMINAL_LINES = [
  '$ curl -s https://gateway/health | jq .status',
  '"ok"',
  '$ curl -H "X-API-Key: …" -H "X-Signature: …" /v1/api/crm/leads',
  'HTTP/1.1 200 · upstream 142ms',
  '$ avaso-gateway · tokio workers: async I/O',
];

const STACK = ['Rust', 'Tokio', 'Axum', 'SQLite', 'HMAC-SHA256', 'RBAC'];

const FLOW = [
  { label: 'Client / AI App', icon: Network, tone: 'from-blue-500/20 to-blue-500/5 border-blue-500/30' },
  { label: 'AVASO Gateway', icon: Layers, tone: 'from-primary/25 to-primary/5 border-primary/40' },
  { label: 'Salesforce · Zoho', icon: GitBranch, tone: 'from-violet-500/20 to-violet-500/5 border-violet-500/30' },
  { label: 'Upstream APIs', icon: Server, tone: 'from-emerald-500/20 to-emerald-500/5 border-emerald-500/30' },
];

const CAPABILITIES = [
  {
    icon: Shield,
    title: 'Zero-trust data plane',
    text: 'HMAC + timestamp + chống replay.',
    tag: 'Security',
  },
  {
    icon: Zap,
    title: 'Async proxy engine',
    text: 'Rust/Tokio — không GC pause. Rate limit, retry, DLQ, transform header theo route.',
    tag: 'Performance',
  },
  {
    icon: Box,
    title: 'Đa tích hợp CRM',
    text: 'OAuth Salesforce & Zoho, snapshot KPI trên dashboard — một cổng cho nhiều nguồn dữ liệu.',
    tag: 'Integration',
  },
  {
    icon: Lock,
    title: 'Admin plane tách biệt',
    text: 'Session + RBAC (Admin / Operator / Viewer). Audit log mọi thao tác nhạy cảm.',
    tag: 'Governance',
  },
];

function useGatewayHealth() {
  const [health, setHealth] = useState<HealthPayload | null>(null);
  const [online, setOnline] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const r = await fetch('/health', { credentials: 'same-origin' });
        if (!r.ok) throw new Error('offline');
        const j = (await r.json()) as HealthPayload;
        if (!cancelled) {
          setHealth(j);
          setOnline(true);
        }
      } catch {
        if (!cancelled) {
          setHealth(null);
          setOnline(false);
        }
      }
    };
    void tick();
    const id = window.setInterval(() => void tick(), 12_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  return { health, online };
}

function TerminalMock() {
  const [lineIdx, setLineIdx] = useState(0);
  const [charIdx, setCharIdx] = useState(0);

  useEffect(() => {
    const line = TERMINAL_LINES[lineIdx] ?? '';
    if (charIdx < line.length) {
      const t = window.setTimeout(() => setCharIdx((c) => c + 1), 28);
      return () => window.clearTimeout(t);
    }
    const t = window.setTimeout(() => {
      setLineIdx((i) => (i + 1) % TERMINAL_LINES.length);
      setCharIdx(0);
    }, 1400);
    return () => window.clearTimeout(t);
  }, [lineIdx, charIdx]);

  const visible = TERMINAL_LINES.slice(0, lineIdx + 1).map((full, i) =>
    i < lineIdx ? full : full.slice(0, charIdx)
  );

  return (
    <TechPanel className="overflow-hidden shadow-2xl shadow-primary/5 !bg-[#050810]">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border/60 bg-slate-900/80">
        <span className="w-2.5 h-2.5 rounded-full bg-red-500/90" />
        <span className="w-2.5 h-2.5 rounded-full bg-amber-500/90" />
        <span className="w-2.5 h-2.5 rounded-full bg-emerald-500/90" />
        <span className="ml-2 text-[10px] font-mono text-muted-foreground tracking-wider">
          gateway-shell · zsh
        </span>
      </div>
      <pre className="p-5 text-xs md:text-sm font-mono text-emerald-400/95 leading-relaxed min-h-[148px]">
        {visible.map((line, i) => (
          <div key={`${lineIdx}-${i}`} className={line.startsWith('HTTP') ? 'text-primary' : undefined}>
            {line}
            {i === visible.length - 1 && (
              <span className="inline-block w-2 h-4 ml-0.5 bg-primary/80 animate-pulse align-middle" />
            )}
          </div>
        ))}
      </pre>
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.07]"
        style={{
          backgroundImage:
            'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(255,255,255,0.4) 2px, rgba(255,255,255,0.4) 3px)',
        }}
      />
    </TechPanel>
  );
}

export function OverviewGuest() {
  const { health, online } = useGatewayHealth();

  return (
    <div className="lg:-m-8 min-h-[calc(100dvh-3.5rem)]">
      <style>{`
        @keyframes guest-float {
          0%, 100% { transform: translateY(0) scale(1); }
          50% { transform: translateY(-12px) scale(1.02); }
        }
      `}</style>

      {/* Hero */}
      <section className="relative overflow-hidden border-b border-border/60">
        <div className="absolute inset-0 tech-grid-bg opacity-70" />
        <div
          className="absolute -top-32 -right-32 w-96 h-96 rounded-full bg-primary/20 blur-[100px] pointer-events-none"
          style={{ animation: 'guest-float 8s ease-in-out infinite' }}
        />
        <div
          className="absolute -bottom-24 -left-24 w-80 h-80 rounded-full bg-blue-600/15 blur-[90px] pointer-events-none"
          style={{ animation: 'guest-float 10s ease-in-out infinite 1s' }}
        />

        <div className="relative px-4 sm:px-6 lg:px-8 py-10 sm:py-14 md:py-20 max-w-6xl mx-auto">
          <div className="flex flex-wrap items-center gap-3 mb-6">
            <Badge
              variant="outline"
              className="border-primary/40 bg-primary/10 text-primary font-mono text-[10px] tracking-widest uppercase"
            >
              <Sparkles className="w-3 h-3 mr-1.5" />
              Middleware Platform
            </Badge>
            {online === true && (
              <Badge
                variant="outline"
                className="border-emerald-500/40 bg-emerald-500/10 text-emerald-400 font-mono text-[10px]"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse mr-1.5" />
                LIVE · {health?.version ? `v${health.version}` : 'gateway'}
                {health?.instance ? ` · ${health.instance}` : ''}
              </Badge>
            )}
            {online === false && (
              <Badge variant="outline" className="border-amber-500/40 text-amber-400 text-[10px]">
                Gateway offline (demo UI vẫn xem được)
              </Badge>
            )}
          </div>

          <h1 className="text-3xl sm:text-4xl md:text-6xl font-black tracking-tight text-white mb-5 leading-[1.1]">
            <span className="tech-shimmer-title">AVASO Gateway</span>
            <br />
            <span className="text-xl sm:text-2xl md:text-4xl font-bold text-slate-300">
              Cổng API đa tích hợp · Rust async
            </span>
          </h1>

          <p className="text-base sm:text-lg text-muted-foreground max-w-2xl mb-8 leading-relaxed">
            Điều phối traffic, bảo mật HMAC, đồng bộ Salesforce & Zoho — một lớp middleware cho sản phẩm
            và pipeline AI. Đăng nhập để vận hành route, key và observability thời gian thực.
          </p>

          <div className="flex flex-wrap gap-2 mb-10">
            {STACK.map((t) => (
              <span
                key={t}
                className="px-3 py-1 rounded-full text-[11px] font-mono font-medium border border-border/80 bg-slate-900/60 text-slate-300"
              >
                {t}
              </span>
            ))}
          </div>

          <div className="flex flex-col sm:flex-row flex-wrap gap-3 w-full sm:w-auto">
            <Button
              asChild
              size="lg"
              className="w-full sm:w-auto bg-primary hover:bg-primary/90 shadow-lg shadow-primary/25 min-h-[48px]"
            >
              <Link to="/login">
                Vào console quản trị
                <ArrowRight className="w-4 h-4 ml-2" />
              </Link>
            </Button>
            <Button
              asChild
              size="lg"
              variant="outline"
              className="w-full sm:w-auto border-border bg-slate-900/50 min-h-[48px]"
            >
              <Link to="/api-docs">
                <FileCode className="w-4 h-4 mr-2" />
                OpenAPI & curl
              </Link>
            </Button>
          </div>
        </div>
      </section>

      <div className="px-4 sm:px-6 lg:px-8 py-8 sm:py-12 max-w-6xl mx-auto space-y-10 sm:space-y-14">
        {/* Live stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { icon: Cpu, label: 'Runtime', value: 'Tokio async', sub: 'Không GC pause' },
            { icon: Shield, label: 'Auth', value: 'HMAC + RBAC', sub: 'Admin / data plane' },
            { icon: Network, label: 'Protocol', value: 'HTTP/1.1', sub: 'Proxy + transform' },
            {
              icon: Server,
              label: 'Service',
              value: online ? 'Online' : online === false ? 'Offline' : '…',
              sub: health?.service ?? 'avaso-gateway',
            },
          ].map(({ icon: Icon, label, value, sub }) => (
            <TechPanel
              key={label}
              corners={false}
              className="p-5 hover:border-primary/30 transition-colors group"
            >
              <Icon className="w-5 h-5 text-primary mb-3 group-hover:scale-110 transition-transform" />
              <p className="tech-label">{label}</p>
              <p className="text-xl font-bold text-white mt-1 font-mono-tech">{value}</p>
              <p className="text-xs text-muted-foreground mt-1 font-mono-tech">{sub}</p>
            </TechPanel>
          ))}
        </div>

        {/* Architecture + terminal */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 lg:gap-8 items-stretch">
          <div>
            <h2 className="tech-label text-primary mb-4 flex items-center gap-2 font-mono-tech">
              <GitBranch className="w-4 h-4" />
              Kiến trúc luồng
            </h2>
            <div className="flex flex-col items-stretch max-w-md">
              {FLOW.map(({ label, icon: Icon, tone }, i) => (
                <div key={label} className="flex flex-col items-center w-full">
                  <Card
                    className={`w-full min-h-[56px] rounded-xl p-4 border bg-gradient-to-r ${tone} flex items-center gap-3`}
                  >
                    <div className="p-2 rounded-lg bg-black/30 shrink-0">
                      <Icon className="w-5 h-5 text-white" />
                    </div>
                    <span className="font-semibold text-white text-sm">{label}</span>
                  </Card>
                  {i < FLOW.length - 1 && (
                    <div
                      className="flex items-center justify-center h-8 w-full"
                      aria-hidden
                    >
                      <ArrowDown className="w-5 h-5 text-primary" />
                    </div>
                  )}
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground mt-4 leading-relaxed">
              Một request đi qua rate limit → optional transform → upstream. Lỗi 5xx/timeout có thể vào DLQ
              (demo in-memory). Tích hợp CRM qua OAuth riêng, data-plane qua{' '}
              <code className="text-primary">/v1/api/sf|zoho</code>.
            </p>
          </div>
          <TerminalMock />
        </div>

        {/* Capabilities */}
        <div>
          <h2 className="text-2xl font-bold text-white mb-2">Năng lực nền tảng</h2>
          <p className="text-muted-foreground mb-8 max-w-xl">
            Xây dựng cho vận hành thật
          </p>
          <div className="grid md:grid-cols-2 gap-5">
            {CAPABILITIES.map(({ icon: Icon, title, text, tag }) => (
              <Card
                key={title}
                className="rounded-2xl p-6 bg-card/40 border-border/80 backdrop-blur-sm hover:bg-card/70 hover:border-primary/25 hover:shadow-lg hover:shadow-primary/5 transition-all duration-300"
              >
                <div className="flex justify-between items-start mb-4">
                  <div className="p-2.5 rounded-xl bg-primary/15 ring-1 ring-primary/25">
                    <Icon className="w-5 h-5 text-primary" />
                  </div>
                  <Badge variant="secondary" className="text-[10px] font-mono uppercase">
                    {tag}
                  </Badge>
                </div>
                <h3 className="font-bold text-white mb-2">{title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{text}</p>
              </Card>
            ))}
          </div>
        </div>

        {/* CTA */}
        <TechPanel className="p-8 md:p-10 border-primary/30 bg-gradient-to-br from-primary/10 via-slate-900/80 to-slate-950 overflow-hidden">
          <div className="absolute top-0 right-0 w-64 h-64 bg-primary/10 rounded-full blur-3xl pointer-events-none" />
          <div className="relative flex flex-col md:flex-row md:items-center md:justify-between gap-6">
            <div>
              <h3 className="text-2xl font-bold text-white mb-2">Sẵn sàng vận hành?</h3>
              <p className="text-muted-foreground max-w-md">
                Đăng nhập với tài khoản Admin / Operator / Viewer — menu và quyền tự ẩn theo role.
              </p>
            </div>
            <Button asChild size="lg" className="bg-primary hover:bg-primary/90 shrink-0">
              <Link to="/login">
                Đăng nhập ngay
                <ArrowRight className="w-4 h-4 ml-2" />
              </Link>
            </Button>
          </div>
        </TechPanel>
      </div>
    </div>
  );
}
