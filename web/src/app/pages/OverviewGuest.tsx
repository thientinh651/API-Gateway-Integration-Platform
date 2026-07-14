import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import {
  ArrowDown,
  ArrowRight,
  Cpu,
  FileCode,
  GitBranch,
  KeyRound,
  Lock,
  Network,
  Play,
  Server,
  Shield,
  Sparkles,
  Terminal,
  Zap,
} from 'lucide-react';
import { Card } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog';
import { TechPanel } from '../components/tech/TechPanel';

type HealthPayload = {
  status?: string;
  service?: string;
  version?: string;
  instance?: string;
};

type MetricsPayload = {
  data_plane?: {
    requests_total?: number;
    rate_limit_hits_total?: number;
  };
  uptime_secs?: number;
};

const STACK = ['Rust', 'Tokio', 'Axum', 'PostgreSQL', 'OAuth2', 'PKCE', 'Argon2id', 'RBAC'];

const FLOW = [
  { label: 'Web shop / Client', icon: Network, tone: 'from-blue-500/20 to-blue-500/5 border-blue-500/30' },
  { label: 'Gateway · JWT validate', icon: Shield, tone: 'from-primary/25 to-primary/5 border-primary/40' },
  { label: 'Routing engine', icon: GitBranch, tone: 'from-cyan-500/20 to-cyan-500/5 border-cyan-500/30' },
  { label: 'Upstream API', icon: Server, tone: 'from-emerald-500/20 to-emerald-500/5 border-emerald-500/30' },
];

const CAPABILITIES = [
  {
    icon: GitBranch,
    title: 'Routing Engine',
    text: 'Longest prefix, {id}, ACL client ↔ route, proxy upstream qua Tokio async.',
    tag: 'Core',
    to: '/api-docs#routing',
  },
  {
    icon: Shield,
    title: 'JWT Identity',
    text: 'POST /oauth/token → Bearer trên /v1/api/* — Token Bucket rate limit + RBAC admin.',
    tag: 'Security',
    to: '/api-docs#authentication',
  },
  {
    icon: Zap,
    title: 'Benchmark hiệu năng',
    text: 'wrk/k6 so sánh /health vs JWT data plane — overhead thấp nhờ Rust.',
    tag: 'NFR',
    to: '/api-docs#quick-start',
  },
  {
    icon: Lock,
    title: 'Admin control plane',
    text: 'Session Redis + RBAC. Route, OAuth client, DLQ, transaction log trên dashboard.',
    tag: 'Governance',
    to: '/login',
  },
];

const SECURITY_UPGRADES = [
  {
    icon: KeyRound,
    title: 'OAuth2 + PKCE (S256)',
    text: 'Authorization Code flow bắt buộc code_challenge — chống đánh cắp code trên mobile/SPA.',
    tag: 'OAuth2.1',
    badge: 'PKCE',
  },
  {
    icon: Shield,
    title: 'Secret at rest',
    text: 'Client secret Argon2id one-way (`secret_hash`); chỉ hiện plaintext lúc tạo. Admin password cùng Argon2id.',
    tag: 'Crypto',
    badge: 'Argon2',
  },
  {
    icon: Lock,
    title: 'Token lifecycle',
    text: 'JWT jti revoke (Redis) + token_version — thu hồi ngay không cần đợi hết hạn.',
    tag: 'Revocation',
    badge: null,
  },
];

type DemoCommand = {
  id: string;
  label: string;
  cmd: string;
  output: string;
  tone?: 'json' | 'http' | 'plain';
};

const DEMO_COMMANDS: DemoCommand[] = [
  {
    id: 'health',
    label: 'Health',
    cmd: 'curl -s https://gateway/health | jq .status',
    output: '"ok"',
    tone: 'json',
  },
  {
    id: 'token',
    label: 'OAuth token',
    cmd: 'curl -X POST /oauth/token -d grant_type=client_credentials&client_id=avaso_pk_…',
    output: `{
  "access_token": "eyJhbGciOiJIUzI1NiIs…",
  "token_type": "Bearer",
  "expires_in": 3600
}`,
    tone: 'json',
  },
  {
    id: 'proxy',
    label: 'Data plane',
    cmd: 'curl -H "Authorization: Bearer eyJ…" /v1/api/products',
    output: 'HTTP/1.1 200 OK\nX-RateLimit-Remaining: 2\nroute: /v1/api/products → upstream 12ms',
    tone: 'http',
  },
  {
    id: 'metrics',
    label: 'Metrics',
    cmd: 'curl -s /metrics | jq .data_plane.requests_total',
    output: '1842',
    tone: 'plain',
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

function useLiveMetrics(online: boolean | null) {
  const [requests, setRequests] = useState<number | null>(null);
  const [rlHits, setRlHits] = useState<number | null>(null);
  const [uptimeSecs, setUptimeSecs] = useState<number | null>(null);
  const [simulated, setSimulated] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const pull = async () => {
      try {
        const r = await fetch('/metrics', { credentials: 'same-origin' });
        if (!r.ok) throw new Error('metrics off');
        const j = (await r.json()) as MetricsPayload;
        const total = j.data_plane?.requests_total;
        if (!cancelled && typeof total === 'number') {
          setRequests(total);
          setRlHits(j.data_plane?.rate_limit_hits_total ?? null);
          setUptimeSecs(j.uptime_secs ?? null);
          setSimulated(false);
        }
      } catch {
        if (!cancelled && online) {
          setSimulated(true);
          setRequests((c) => (c ?? 1200) + Math.floor(Math.random() * 5) + 1);
        }
      }
    };
    void pull();
    const id = window.setInterval(() => void pull(), online ? 4000 : 8000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [online]);

  return { requests, rlHits, uptimeSecs, simulated };
}

function ParticleCanvas() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let raf = 0;
    const particles = Array.from({ length: 48 }, () => ({
      x: Math.random(),
      y: Math.random(),
      vx: (Math.random() - 0.5) * 0.0004,
      vy: (Math.random() - 0.5) * 0.0004,
      r: Math.random() * 1.2 + 0.4,
      a: Math.random() * 0.35 + 0.08,
    }));

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const draw = () => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      ctx.clearRect(0, 0, w, h);
      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0 || p.x > 1) p.vx *= -1;
        if (p.y < 0 || p.y > 1) p.vy *= -1;
        ctx.beginPath();
        ctx.arc(p.x * w, p.y * h, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(56, 189, 248, ${p.a})`;
        ctx.fill();
      }
      raf = requestAnimationFrame(draw);
    };

    resize();
    draw();
    window.addEventListener('resize', resize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return (
    <canvas
      ref={ref}
      className="absolute inset-0 w-full h-full pointer-events-none opacity-60"
      aria-hidden
    />
  );
}

function InteractiveTerminal({ metricsHint }: { metricsHint: number | null }) {
  const [activeId, setActiveId] = useState(DEMO_COMMANDS[0].id);
  const [typing, setTyping] = useState('');
  const [showOutput, setShowOutput] = useState(false);

  const active = DEMO_COMMANDS.find((c) => c.id === activeId) ?? DEMO_COMMANDS[0];

  const runCommand = useCallback((cmd: DemoCommand) => {
    setActiveId(cmd.id);
    setTyping('');
    setShowOutput(false);
    let i = 0;
    const line = cmd.cmd;
    const typeTick = () => {
      i += 1;
      setTyping(line.slice(0, i));
      if (i < line.length) {
        window.setTimeout(typeTick, 16);
      } else {
        window.setTimeout(() => setShowOutput(true), 400);
      }
    };
    typeTick();
  }, []);

  useEffect(() => {
    runCommand(DEMO_COMMANDS[0]);
  }, [runCommand]);

  const outputText =
    active.id === 'metrics' && metricsHint != null ? String(metricsHint) : active.output;

  return (
    <TechPanel className="relative overflow-hidden shadow-2xl shadow-primary/5 !bg-[#050810] flex flex-col h-full">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border/60 bg-slate-900/80 shrink-0">
        <span className="w-2.5 h-2.5 rounded-full bg-red-500/90" />
        <span className="w-2.5 h-2.5 rounded-full bg-amber-500/90" />
        <span className="w-2.5 h-2.5 rounded-full bg-emerald-500/90" />
        <span className="ml-2 text-[10px] font-mono text-muted-foreground tracking-wider flex items-center gap-1.5">
          <Terminal className="w-3 h-3" />
          gateway-shell · interactive
        </span>
      </div>

      <div className="flex flex-wrap gap-1.5 p-3 border-b border-border/40 bg-slate-950/50">
        {DEMO_COMMANDS.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => runCommand(c)}
            className={`px-2.5 py-1 rounded-md text-[10px] font-mono uppercase tracking-wide border transition-colors ${
              activeId === c.id
                ? 'border-primary/50 bg-primary/15 text-primary'
                : 'border-border/60 text-slate-400 hover:border-primary/30 hover:text-slate-200'
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>

      <pre className="p-5 text-xs md:text-sm font-mono leading-relaxed min-h-[160px] flex-1">
        <div className="text-emerald-400/95">
          {typing}
          {!showOutput && <span className="inline-block w-2 h-4 ml-0.5 bg-primary/80 animate-pulse align-middle" />}
        </div>
        {showOutput ? (
          <div
            className={`mt-3 whitespace-pre-wrap ${
              active.tone === 'http' ? 'text-primary' : active.tone === 'json' ? 'text-cyan-300/90' : 'text-slate-300'
            }`}
          >
            {outputText}
          </div>
        ) : null}
      </pre>

      <div
        className="pointer-events-none absolute inset-0 opacity-[0.06]"
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
  const { requests, rlHits, uptimeSecs, simulated } = useLiveMetrics(online);
  const [demoOpen, setDemoOpen] = useState(false);

  return (
    <div className="lg:-m-8 min-h-[calc(100dvh-3.5rem)]">
      <style>{`
        @keyframes guest-float {
          0%, 100% { transform: translateY(0) scale(1); }
          50% { transform: translateY(-12px) scale(1.02); }
        }
        @keyframes flow-pulse {
          0%, 100% { opacity: 0.4; transform: scaleY(1); }
          50% { opacity: 1; transform: scaleY(1.15); }
        }
        .guest-card-tilt {
          transition: transform 0.25s ease, box-shadow 0.25s ease, border-color 0.25s ease;
        }
        .guest-card-tilt:hover {
          transform: translateY(-3px) perspective(800px) rotateX(1deg);
        }
      `}</style>

      {/* Hero */}
      <section className="relative overflow-hidden border-b border-border/60">
        <div className="absolute inset-0 tech-grid-bg opacity-70" />
        <ParticleCanvas />
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
              Production Ready · Rust Backend
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

          <h1 className="text-4xl sm:text-5xl md:text-7xl font-black tracking-tighter text-white mb-6 leading-[1.05]">
            AVASO{' '}
            <span className="tech-shimmer-title bg-clip-text text-transparent bg-gradient-to-r from-primary via-cyan-400 to-primary">
              Gateway
            </span>
            <br />
            <span className="text-2xl sm:text-3xl md:text-4xl font-semibold text-slate-400">
              Rust · High-Performance · Production Grade
            </span>
          </h1>

          <p className="text-lg text-slate-400 max-w-xl mb-8 leading-relaxed">
            API Gateway với <span className="text-primary font-medium">OAuth2 + PKCE</span>, dynamic routing,
            Token Bucket rate limit, DLQ và tích hợp CRM SF→Zoho.
          </p>

          <div className="flex flex-wrap gap-2 mb-8">
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
                Tài liệu API
              </Link>
            </Button>
          </div>
        </div>
      </section>

      <div className="px-4 sm:px-6 lg:px-8 py-8 sm:py-12 max-w-6xl mx-auto space-y-10 sm:space-y-14">
        {/* Live stats */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          <TechPanel
            corners={false}
            className="p-5 col-span-2 lg:col-span-1 border-primary/25 bg-primary/5 guest-card-tilt"
          >
            <p className="tech-label">Data plane</p>
            <p className="text-3xl sm:text-4xl font-bold text-primary mt-1 font-mono tabular-nums">
              {requests != null ? requests.toLocaleString() : '…'}
            </p>
            <p className="text-xs text-muted-foreground mt-1 font-mono-tech">
              {simulated ? 'requests (ước lượng)' : 'requests_total · /metrics'}
            </p>
          </TechPanel>
          {[
            { icon: Cpu, label: 'Runtime', value: 'Tokio async', sub: 'Không GC pause' },
            { icon: Shield, label: 'Auth', value: 'JWT + PKCE', sub: 'Argon2id secret' },
            { icon: Network, label: 'Protocol', value: 'HTTP/1.1', sub: 'Proxy + DLQ' },
            {
              icon: Server,
              label: 'Service',
              value: online ? 'Online' : online === false ? 'Offline' : '…',
              sub:
                online && uptimeSecs != null
                  ? `uptime ${Math.floor(uptimeSecs / 60)}m · RL ${rlHits ?? 0}`
                  : health?.status === 'ok'
                    ? 'health: ok'
                    : (health?.service ?? 'avaso-gateway'),
            },
          ].map(({ icon: Icon, label, value, sub }) => (
            <TechPanel
              key={label}
              corners={false}
              className="p-5 hover:border-primary/30 guest-card-tilt group"
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
                    className={`guest-card-tilt w-full min-h-[56px] rounded-xl p-4 border bg-gradient-to-r ${tone} flex items-center gap-3`}
                  >
                    <div className="p-2 rounded-lg bg-black/30 shrink-0">
                      <Icon className="w-5 h-5 text-white" />
                    </div>
                    <span className="font-semibold text-white text-sm">{label}</span>
                  </Card>
                  {i < FLOW.length - 1 && (
                    <div className="flex items-center justify-center h-8 w-full" aria-hidden>
                      <ArrowDown
                        className="w-5 h-5 text-primary"
                        style={{ animation: 'flow-pulse 2s ease-in-out infinite', animationDelay: `${i * 0.2}s` }}
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground mt-4 leading-relaxed">
              JWT validate → Token Bucket → route match → proxy upstream → transaction log. Click terminal bên phải
              để xem curl mẫu.
            </p>
          </div>
          <InteractiveTerminal metricsHint={requests} />
        </div>

        {/* Security upgrades */}
        <div>
          <h2 className="text-2xl font-bold text-white mb-2">Security upgrades</h2>
          <p className="text-muted-foreground mb-6 max-w-xl">
            Các cải tiến bảo mật gần đây — nói trực tiếp khi demo cho hội đồng.
          </p>
          <div className="grid md:grid-cols-3 gap-4">
            {SECURITY_UPGRADES.map(({ icon: Icon, title, text, tag, badge }) => (
              <Card
                key={title}
                className="guest-card-tilt rounded-2xl p-5 bg-card/40 border-border/80 backdrop-blur-sm hover:border-emerald-500/25 h-full"
              >
                <div className="flex justify-between items-start mb-3">
                  <div className="p-2 rounded-lg bg-emerald-500/10 ring-1 ring-emerald-500/20">
                    <Icon className="w-5 h-5 text-emerald-400" />
                  </div>
                  <div className="flex gap-1.5">
                    {badge ? (
                      <Badge className="text-[9px] bg-violet-500/15 text-violet-300 border-violet-500/30">
                        {badge}
                      </Badge>
                    ) : null}
                    <Badge variant="secondary" className="text-[9px] font-mono uppercase">
                      {tag}
                    </Badge>
                  </div>
                </div>
                <h3 className="font-bold text-white text-sm mb-2">{title}</h3>
                <p className="text-xs text-muted-foreground leading-relaxed">{text}</p>
              </Card>
            ))}
          </div>
        </div>

        {/* Capabilities */}
        <div>
          <h2 className="text-2xl font-bold text-white mb-2">Năng lực nền tảng</h2>
          <p className="text-muted-foreground mb-8 max-w-xl">Xây dựng cho vận hành thật</p>
          <div className="grid md:grid-cols-2 gap-5">
            {CAPABILITIES.map(({ icon: Icon, title, text, tag, to }) => (
              <Link
                key={title}
                to={to}
                className="block rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Card className="guest-card-tilt rounded-2xl p-6 bg-card/40 border-border/80 backdrop-blur-sm cursor-pointer hover:bg-card/70 hover:border-primary/25 hover:shadow-lg hover:shadow-primary/5 h-full">
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
                  <p className="text-[10px] text-primary/80 mt-3 font-mono-tech uppercase tracking-wider">
                    Tìm hiểu →
                  </p>
                </Card>
              </Link>
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
                Đăng nhập Admin / Operator / Viewer — menu và quyền tự ẩn theo role.
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

      <Dialog open={demoOpen} onOpenChange={setDemoOpen}>
        <DialogContent className="bg-slate-950 border-border max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-white">Demo 90 giây</DialogTitle>
            <DialogDescription>
              Quay màn hình: đăng nhập → tạo route → Postman lấy JWT → gọi /v1/api → xem transaction log &
              rate limit 429. Gắn link YouTube/Loom vào đây khi có video.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-lg border border-border bg-black/40 p-4 font-mono text-xs text-slate-400 space-y-2">
            <p>1. POST /oauth/token (client_credentials)</p>
            <p>2. GET /v1/api/… + Bearer</p>
            <p>3. Dashboard → Logs → outcome success / denied</p>
            <p>4. Spam → 429 Token Bucket</p>
          </div>
          <Button asChild variant="outline" className="w-full">
            <Link to="/login" onClick={() => setDemoOpen(false)}>
              Bắt đầu demo live
            </Link>
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
