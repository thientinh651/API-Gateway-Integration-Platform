import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { motion, useReducedMotion } from 'motion/react';
import {
  ArrowRight,
  FileCode,
  Gauge,
  GitBranch,
  KeyRound,
  Lock,
  Network,
  Server,
  Shield,
  Terminal,
  Workflow,
} from 'lucide-react';
import { Button } from '../components/ui/button';

type HealthPayload = {
  status?: string;
  version?: string;
};

const BENEFITS = [
  {
    icon: Gauge,
    title: 'Hiệu năng cao',
    text: 'Xây bằng Rust + Tokio — proxy nhanh, overhead thấp, phù hợp traffic production.',
  },
  {
    icon: Shield,
    title: 'Bảo mật chuẩn OAuth2',
    text: 'PKCE, JWT, thu hồi token tức thì. Client secret hash Argon2id.',
  },
  {
    icon: Workflow,
    title: 'Quản trị tập trung',
    text: 'Một console cho route, client, quyền RBAC, log và hàng đợi lỗi (DLQ).',
  },
];

/** Ba trụ cột sản phẩm — xác thực · giới hạn · định tuyến */
const PILLARS = [
  {
    icon: KeyRound,
    title: 'Xác thực',
    text: 'OAuth2 + JWT (PKCE). Client lấy token, gateway kiểm tra trước khi cho vào data plane.',
  },
  {
    icon: Gauge,
    title: 'Giới hạn',
    text: 'Token Bucket theo client/route — chống spam, bảo vệ upstream khi traffic tăng đột biến.',
  },
  {
    icon: GitBranch,
    title: 'Định tuyến',
    text: 'Khớp path (longest prefix), ACL client ↔ route, proxy tới upstream đúng đích.',
  },
];

const STEPS = [
  {
    n: '01',
    title: 'Đăng nhập',
    text: 'Vào dashboard quản trị để cấu hình gateway.',
  },
  {
    n: '02',
    title: 'Tạo route & client',
    text: 'Khai báo path upstream, cấp client ID/secret, gắn quyền.',
  },
  {
    n: '03',
    title: 'Gọi API qua gateway',
    text: 'Lấy JWT từ /oauth/token rồi gọi /v1/api/* — xem tài liệu để bắt đầu.',
  },
];

const FLOW = [
  { label: 'Ứng dụng', sub: 'Web, mobile, service', icon: Network },
  { label: 'Gateway', sub: 'Xác thực · giới hạn · định tuyến', icon: Shield, featured: true },
  { label: 'Route', sub: 'Khớp path, ACL', icon: GitBranch },
  { label: 'Upstream', sub: 'API đích của bạn', icon: Server },
];

const TRUST = [
  {
    icon: KeyRound,
    title: 'OAuth2 + PKCE',
    text: 'Luồng chuẩn cho SPA/mobile — giảm rủi ro đánh cắp authorization code.',
  },
  {
    icon: Lock,
    title: 'Bảo vệ bí mật',
    text: 'Secret lưu dạng hash; có thể thu hồi token đang dùng ngay trên Redis.',
  },
  {
    icon: Shield,
    title: 'Phân quyền rõ ràng',
    text: 'RBAC trên console — mỗi vai trò chỉ thấy đúng phần việc của mình.',
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
    label: 'Lấy token',
    cmd: 'curl -X POST /oauth/token -d grant_type=client_credentials&client_id=…',
    output: `{
  "access_token": "eyJhbGciOiJIUzI1NiIs…",
  "token_type": "Bearer",
  "expires_in": 3600
}`,
    tone: 'json',
  },
  {
    id: 'proxy',
    label: 'Gọi API',
    cmd: 'curl -H "Authorization: Bearer eyJ…" /v1/api/products',
    output: 'HTTP/1.1 200 OK\nroute: /v1/api/products → upstream',
    tone: 'http',
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
    const id = window.setInterval(() => void tick(), 15_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  return { health, online };
}

function HeroTerrainMesh() {
  const ref = useRef<HTMLCanvasElement>(null);
  const reduce = useReducedMotion();

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let raf = 0;
    let t = 0;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, rect.width * dpr);
      canvas.height = Math.max(1, rect.height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const project = (x: number, y: number, z: number, w: number, h: number) => {
      const scale = 260 / (260 + z);
      return {
        sx: w * 0.5 + x * scale,
        sy: h * 0.28 + y * scale + z * 0.22,
      };
    };

    const drawFloorGrid = (w: number, h: number) => {
      const horizon = h * 0.22;
      const vanishingX = w * 0.5;
      ctx.save();
      for (let i = 1; i <= 18; i++) {
        const y = horizon + ((h - horizon) * i) / 18;
        const prog = i / 18;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.strokeStyle = `rgba(14, 165, 233, ${0.04 + prog * 0.18})`;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      for (let i = -16; i <= 16; i++) {
        const xBottom = vanishingX + i * (w / 14);
        ctx.beginPath();
        ctx.moveTo(vanishingX, horizon);
        ctx.lineTo(xBottom, h);
        ctx.strokeStyle = `rgba(249, 115, 22, ${0.03 + (1 - Math.abs(i) / 16) * 0.12})`;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      ctx.restore();
    };

    const draw = () => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      ctx.clearRect(0, 0, w, h);
      if (!reduce) t += 0.014;

      const wash = ctx.createLinearGradient(0, h * 0.3, w, h);
      wash.addColorStop(0, 'rgba(249,115,22,0.22)');
      wash.addColorStop(0.45, 'rgba(249,115,22,0.06)');
      wash.addColorStop(1, 'rgba(14,165,233,0.2)');
      ctx.fillStyle = wash;
      ctx.fillRect(0, h * 0.2, w, h * 0.8);
      drawFloorGrid(w, h);

      const cols = 36;
      const rows = 22;
      const pts: Array<Array<{ sx: number; sy: number; elev: number; u: number }>> = [];

      for (let row = 0; row <= rows; row++) {
        const line: Array<{ sx: number; sy: number; elev: number; u: number }> = [];
        for (let col = 0; col <= cols; col++) {
          const u = col / cols;
          const v = row / rows;
          const x = (u - 0.5) * w * 1.55;
          const z = v * 380 + 20;
          const elev =
            Math.sin(u * 6.2 + t) * 34 +
            Math.cos(v * 5.1 - t * 0.85) * 26 +
            Math.sin((u * 2 + v) * 7 + t * 0.55) * 16 +
            Math.sin(u * 12 - t * 1.2) * 8;
          const y = 55 - elev + (v - 0.25) * 36;
          const p = project(x, y, z, w, h);
          line.push({ ...p, elev, u });
        }
        pts.push(line);
      }

      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          const a = pts[row][col];
          const b = pts[row][col + 1];
          const c = pts[row + 1][col];
          const d = pts[row + 1][col + 1];
          const depth = row / rows;
          const mix = a.u;
          const r = Math.round(249 * (1 - mix) + 14 * mix);
          const g = Math.round(115 * (1 - mix) + 165 * mix);
          const bch = Math.round(22 * (1 - mix) + 233 * mix);
          const alpha = (0.03 + (1 - depth) * 0.07) * (0.5 + (a.elev + 40) / 120);
          ctx.beginPath();
          ctx.moveTo(a.sx, a.sy);
          ctx.lineTo(b.sx, b.sy);
          ctx.lineTo(d.sx, d.sy);
          ctx.lineTo(c.sx, c.sy);
          ctx.closePath();
          ctx.fillStyle = `rgba(${r},${g},${bch},${alpha})`;
          ctx.fill();
        }
      }

      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          const a = pts[row][col];
          const b = pts[row][col + 1];
          const c = pts[row + 1][col];
          const depth = row / rows;
          const mix = (a.u + b.u) / 2;
          const alpha = 0.1 + (1 - depth) * 0.45;
          const r = Math.round(249 * (1 - mix) + 14 * mix);
          const g = Math.round(115 * (1 - mix) + 165 * mix);
          const bl = Math.round(22 * (1 - mix) + 233 * mix);
          ctx.beginPath();
          ctx.moveTo(a.sx, a.sy);
          ctx.lineTo(b.sx, b.sy);
          ctx.strokeStyle = `rgba(${r},${g},${bl},${alpha})`;
          ctx.lineWidth = depth < 0.35 ? 1.35 : 1;
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(a.sx, a.sy);
          ctx.lineTo(c.sx, c.sy);
          ctx.strokeStyle = `rgba(${r},${g},${bl},${alpha * 0.85})`;
          ctx.stroke();
        }
      }

      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      if (!reduce) {
        for (let k = 0; k < 6; k++) {
          const row = 4 + ((k * 3) % (rows - 6));
          const colF = (t * 8 + k * 5) % cols;
          const col = Math.floor(colF);
          const frac = colF - col;
          const p0 = pts[row][col];
          const p1 = pts[row][Math.min(col + 1, cols)];
          const sx = p0.sx + (p1.sx - p0.sx) * frac;
          const sy = p0.sy + (p1.sy - p0.sy) * frac;
          const grd = ctx.createRadialGradient(sx, sy, 0, sx, sy, 8);
          grd.addColorStop(0, k % 2 === 0 ? 'rgba(249,115,22,0.9)' : 'rgba(14,165,233,0.9)');
          grd.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.fillStyle = grd;
          ctx.beginPath();
          ctx.arc(sx, sy, 8, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.restore();

      raf = requestAnimationFrame(draw);
    };

    resize();
    draw();
    window.addEventListener('resize', resize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, [reduce]);

  return (
    <canvas
      ref={ref}
      className="pointer-events-none absolute inset-x-0 bottom-0 h-[62%] w-full"
      aria-hidden
    />
  );
}

function CircuitOverlay() {
  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full opacity-[0.35]"
      aria-hidden
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id="ckt-o" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#F97316" stopOpacity="0.7" />
          <stop offset="100%" stopColor="#F97316" stopOpacity="0.1" />
        </linearGradient>
        <linearGradient id="ckt-c" x1="100%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#0EA5E9" stopOpacity="0.7" />
          <stop offset="100%" stopColor="#0EA5E9" stopOpacity="0.1" />
        </linearGradient>
      </defs>
      <g fill="none" stroke="url(#ckt-o)" strokeWidth="1">
        <path d="M0 80 H120 V40 H200" />
        <path d="M40 0 V100 H90 V160" />
        <circle cx="120" cy="40" r="2.5" fill="#F97316" stroke="none" />
        <circle cx="90" cy="100" r="2.5" fill="#F97316" stroke="none" />
      </g>
      <g fill="none" stroke="url(#ckt-c)" strokeWidth="1" transform="translate(100%,0) scale(-1,1)">
        <path d="M0 60 H100 V30 H180" />
        <path d="M50 0 V90 H110 V150" />
        <circle cx="100" cy="30" r="2.5" fill="#0EA5E9" stroke="none" />
        <circle cx="110" cy="90" r="2.5" fill="#0EA5E9" stroke="none" />
      </g>
    </svg>
  );
}

function InteractiveTerminal() {
  const [activeId, setActiveId] = useState(DEMO_COMMANDS[0].id);
  const [typing, setTyping] = useState('');
  const [showOutput, setShowOutput] = useState(false);
  const timers = useRef<number[]>([]);

  const active = DEMO_COMMANDS.find((c) => c.id === activeId) ?? DEMO_COMMANDS[0];

  const clearTimers = () => {
    for (const t of timers.current) window.clearTimeout(t);
    timers.current = [];
  };

  const runCommand = useCallback((cmd: DemoCommand) => {
    clearTimers();
    setActiveId(cmd.id);
    setTyping('');
    setShowOutput(false);
    let i = 0;
    const line = cmd.cmd;
    const typeTick = () => {
      i += 1;
      setTyping(line.slice(0, i));
      if (i < line.length) {
        timers.current.push(window.setTimeout(typeTick, 11));
      } else {
        timers.current.push(window.setTimeout(() => setShowOutput(true), 260));
      }
    };
    typeTick();
  }, []);

  useEffect(() => {
    runCommand(DEMO_COMMANDS[0]);
    return clearTimers;
  }, [runCommand]);

  useEffect(() => {
    if (!showOutput) return;
    const idx = DEMO_COMMANDS.findIndex((c) => c.id === activeId);
    const next = DEMO_COMMANDS[(idx + 1) % DEMO_COMMANDS.length];
    const t = window.setTimeout(() => runCommand(next), 4000);
    return () => window.clearTimeout(t);
  }, [showOutput, activeId, runCommand]);

  return (
    <div
      className="guest-term-frame relative flex h-full min-h-[340px] flex-col overflow-hidden rounded-2xl bg-[#06080f]/80 backdrop-blur-xl"
      role="region"
      aria-label="Ví dụ gọi API qua gateway"
    >
      <div className="flex items-center gap-2 border-b border-white/10 bg-slate-950/80 px-4 py-3 shrink-0">
        <span className="h-2.5 w-2.5 rounded-full bg-red-500" aria-hidden />
        <span className="h-2.5 w-2.5 rounded-full bg-amber-400" aria-hidden />
        <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" aria-hidden />
        <span className="ml-2 flex items-center gap-1.5 font-mono text-[10px] tracking-wider text-slate-400">
          <Terminal className="h-3 w-3" />
          Ví dụ tích hợp
        </span>
      </div>

      <div className="flex flex-wrap gap-1 border-b border-white/5 bg-black/30 p-2.5" role="tablist">
        {DEMO_COMMANDS.map((c) => (
          <button
            key={c.id}
            type="button"
            role="tab"
            aria-selected={activeId === c.id}
            onClick={() => runCommand(c)}
            className={`rounded-md px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-wide transition-colors ${
              activeId === c.id
                ? 'bg-primary/25 text-primary'
                : 'text-slate-500 hover:bg-white/5 hover:text-slate-200'
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>

      <pre className="flex-1 overflow-auto p-5 font-mono text-xs leading-relaxed md:text-sm" aria-live="polite">
        <div className="text-emerald-400">
          <span className="select-none text-slate-600">$ </span>
          {typing}
          {!showOutput && (
            <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-primary align-middle" />
          )}
        </div>
        {showOutput ? (
          <div
            className={`mt-3 whitespace-pre-wrap ${
              active.tone === 'http'
                ? 'text-primary'
                : active.tone === 'json'
                  ? 'text-sky-300'
                  : 'text-slate-300'
            }`}
          >
            {active.output}
          </div>
        ) : null}
      </pre>
    </div>
  );
}

function FlowConnector({ delay }: { delay: number }) {
  const reduce = useReducedMotion();
  return (
    <div className="relative mx-1 hidden w-10 shrink-0 items-center sm:flex" aria-hidden>
      <div className="h-px w-full bg-gradient-to-r from-primary/40 via-sky-400/70 to-primary/40" />
      {!reduce ? (
        <motion.span
          className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary shadow-[0_0_12px_rgba(249,115,22,0.95)]"
          initial={{ left: '0%' }}
          animate={{ left: '100%' }}
          transition={{ duration: 1.6, repeat: Infinity, ease: 'linear', delay }}
        />
      ) : null}
    </div>
  );
}

export function OverviewGuest() {
  const { health, online } = useGatewayHealth();

  return (
    <div className="guest-landing min-h-full bg-[#06080f] text-slate-300">
      <style>{`
        @keyframes guest-in {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .guest-in { animation: guest-in 0.75s ease-out both; }
        .guest-in-1 { animation-delay: 0.08s; }
        .guest-in-2 { animation-delay: 0.16s; }
        .guest-in-3 { animation-delay: 0.26s; }
        .guest-brand {
          text-shadow:
            0 0 28px rgba(249,115,22,0.35),
            0 0 60px rgba(249,115,22,0.18);
        }
        .guest-neon-orange {
          box-shadow:
            0 0 0 1px rgba(249,115,22,0.4),
            0 0 20px rgba(249,115,22,0.12);
        }
        .guest-neon-sky {
          box-shadow:
            0 0 0 1px rgba(14,165,233,0.35),
            0 0 20px rgba(14,165,233,0.1);
        }
        .guest-glass {
          background: linear-gradient(160deg, rgba(15,20,32,0.85), rgba(6,8,15,0.92));
          backdrop-filter: blur(14px);
        }
        .guest-term-frame {
          border: 1px solid transparent;
          background:
            linear-gradient(rgba(6,8,15,0.88), rgba(6,8,15,0.92)) padding-box,
            linear-gradient(135deg, rgba(249,115,22,0.75), rgba(14,165,233,0.65)) border-box;
          box-shadow:
            0 0 40px rgba(14,165,233,0.12),
            0 0 28px rgba(249,115,22,0.08);
        }
        @media (prefers-reduced-motion: reduce) {
          .guest-in { animation: none; }
        }
      `}</style>

      {/* Hero */}
      <section className="relative min-h-[min(100dvh,52rem)] overflow-hidden">
        <div className="absolute inset-0 bg-[#06080f]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_25%_0%,rgba(249,115,22,0.14),transparent_48%),radial-gradient(ellipse_at_85%_15%,rgba(14,165,233,0.12),transparent_42%)]" />
        <div className="absolute inset-0 tech-grid-bg opacity-[0.22]" />
        <CircuitOverlay />
        <HeroTerrainMesh />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-44 bg-gradient-to-t from-[#06080f] via-[#06080f]/85 to-transparent" />

        <div className="relative z-10 mx-auto grid max-w-6xl gap-10 px-4 pb-24 pt-12 sm:px-6 sm:pt-16 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:gap-12 lg:px-8 lg:pb-28 lg:pt-18">
          <div>
            <p className="guest-in font-mono text-[11px] uppercase tracking-[0.22em] text-primary">
              API Gateway · Rust
              {health?.version ? <span className="text-primary/80"> · v{health.version}</span> : null}
              {online === true ? (
                <span className="ml-2 inline-flex items-center gap-1.5 normal-case tracking-normal text-emerald-400">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
                  status: online
                </span>
              ) : null}
            </p>

            <h1 className="guest-in guest-in-1 guest-brand font-display mt-4 text-[clamp(3.5rem,12vw,6.75rem)] font-bold leading-[0.9] tracking-[-0.04em] text-white">
              AVASO
            </h1>
            <p className="guest-in guest-in-1 mt-4 font-display text-xl font-semibold tracking-tight sm:text-2xl">
              <span className="text-primary">AVASO:</span>{' '}
              <span className="text-white">Gateway & Integrations</span>
            </p>
            <p className="guest-in guest-in-2 mt-5 max-w-md text-base leading-relaxed text-slate-300 sm:text-lg">
              Bảo vệ và định tuyến API của bạn — xác thực OAuth2, giới hạn lưu lượng, quản trị tập trung.
            </p>

            <div className="guest-in guest-in-3 mt-8 flex flex-col gap-3 sm:flex-row">
              <Button
                asChild
                size="lg"
                className="min-h-12 rounded-xl bg-gradient-to-r from-primary to-orange-600 px-7 text-base font-semibold text-white shadow-[0_0_28px_rgba(249,115,22,0.4)] hover:from-primary/95 hover:to-orange-600/95"
              >
                <Link to="/login">
                  Đăng nhập
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
              <Button
                asChild
                size="lg"
                variant="outline"
                className="min-h-12 rounded-xl border-sky-400/50 bg-[#06080f]/60 px-7 text-base text-sky-100 hover:bg-sky-500/10 hover:text-white"
              >
                <Link to="/api-docs">
                  <FileCode className="mr-2 h-4 w-4" />
                  Xem tài liệu
                </Link>
              </Button>
            </div>
          </div>

          <div className="guest-in guest-in-2 relative z-10 lg:min-h-[360px]">
            <InteractiveTerminal />
          </div>
        </div>
      </section>

      <div className="relative z-10 mx-auto max-w-6xl space-y-20 px-4 py-16 sm:px-6 lg:px-8 lg:py-20">
        {/* Why */}
        <section aria-labelledby="why">
          <h2 id="why" className="font-display text-3xl font-bold tracking-tight text-white">
            Vì sao chọn AVASO Gateway
          </h2>
          <p className="mt-2 max-w-xl text-sm text-slate-400">
            Ba điều khách hàng thường cần ở một API gateway
          </p>
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {BENEFITS.map(({ icon: Icon, title, text }) => (
              <div key={title} className="guest-glass guest-neon-orange rounded-2xl px-5 py-6">
                <Icon className="h-5 w-5 text-primary" />
                <h3 className="mt-4 font-display text-lg font-semibold text-white">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-400">{text}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Pillars: xác thực · giới hạn · định tuyến */}
        <section aria-labelledby="pillars">
          <h2 id="pillars" className="font-display text-3xl font-bold tracking-tight text-white">
            Xác thực · giới hạn · định tuyến
          </h2>
          <p className="mt-2 max-w-xl text-sm text-slate-400">
            Ba việc gateway làm trên mỗi request — trước khi tới API của bạn.
          </p>
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {PILLARS.map(({ icon: Icon, title, text }) => (
              <div key={title} className="guest-glass guest-neon-sky rounded-2xl px-5 py-6">
                <Icon className="h-5 w-5 text-sky-400" />
                <h3 className="mt-4 font-semibold text-white">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-400">{text}</p>
              </div>
            ))}
          </div>
        </section>

        {/* How it works */}
        <section aria-labelledby="how">
          <h2 id="how" className="font-display text-3xl font-bold tracking-tight text-white">
            Cách hoạt động
          </h2>
          <p className="mt-2 max-w-xl text-sm text-slate-400">
            Request đi qua gateway trước khi tới API của bạn.
          </p>
          <ol className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-stretch">
            {FLOW.map(({ label, sub, icon: Icon, featured }, i) => (
              <li key={label} className="flex flex-1 items-stretch">
                <div
                  className={`guest-glass flex w-full flex-col rounded-2xl px-5 py-6 ${
                    featured ? 'guest-neon-orange' : 'guest-neon-sky'
                  }`}
                >
                  <Icon className={`h-5 w-5 ${featured ? 'text-primary' : 'text-sky-400'}`} />
                  <p className="mt-4 font-display text-lg font-semibold text-white">{label}</p>
                  <p className="mt-1 text-xs leading-relaxed text-slate-400">{sub}</p>
                </div>
                {i < FLOW.length - 1 ? <FlowConnector delay={i * 0.4} /> : null}
              </li>
            ))}
          </ol>
        </section>

        {/* Trust / security */}
        <section aria-labelledby="trust">
          <h2 id="trust" className="font-display text-3xl font-bold tracking-tight text-white">
            An toàn khi vận hành
          </h2>
          <p className="mt-2 max-w-xl text-sm text-slate-400">
            Chuẩn mực bảo mật mà đội kỹ thuật và bảo mật thường hỏi trước khi dùng.
          </p>
          <div className="mt-8 space-y-3">
            {TRUST.map(({ icon: Icon, title, text }) => (
              <div key={title} className="guest-glass guest-neon-orange flex gap-4 rounded-2xl px-5 py-5">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/15">
                  <Icon className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <h3 className="font-semibold text-white">{title}</h3>
                  <p className="mt-1 max-w-2xl text-sm leading-relaxed text-slate-400">{text}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Getting started */}
        <section aria-labelledby="start">
          <h2 id="start" className="font-display text-3xl font-bold tracking-tight text-white">
            Bắt đầu nhanh
          </h2>
          <p className="mt-2 max-w-xl text-sm text-slate-400">Ba bước để đưa traffic qua AVASO.</p>
          <ol className="mt-8 grid gap-4 md:grid-cols-3">
            {STEPS.map((s) => (
              <li key={s.n} className="guest-glass guest-neon-sky rounded-2xl px-5 py-6">
                <p className="font-mono text-xs text-primary">{s.n}</p>
                <h3 className="mt-3 font-semibold text-white">{s.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-400">{s.text}</p>
              </li>
            ))}
          </ol>
          <div className="mt-6 flex flex-wrap gap-3">
            <Button asChild className="bg-primary hover:bg-primary/90">
              <Link to="/login">
                Đăng nhập
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
            <Button asChild variant="outline" className="border-border">
              <Link to="/api-docs">Đọc tài liệu API</Link>
            </Button>
          </div>
        </section>

        {/* Final CTA */}
        <section
          className="guest-glass guest-neon-orange relative overflow-hidden rounded-2xl px-6 py-10 sm:px-10 sm:py-12"
          aria-labelledby="cta"
        >
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_0%_50%,rgba(249,115,22,0.18),transparent_55%)]" />
          <div className="relative flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 id="cta" className="font-display text-3xl font-bold tracking-tight text-white">
                Sẵn sàng dùng AVASO?
              </h2>
              <p className="mt-2 max-w-md text-sm text-slate-400">
                Đăng nhập để quản trị, hoặc mở tài liệu để tích hợp client.
              </p>
            </div>
            <Button
              asChild
              size="lg"
              className="min-h-12 shrink-0 rounded-xl bg-primary px-7 font-semibold shadow-[0_0_28px_rgba(249,115,22,0.45)] hover:bg-primary/90"
            >
              <Link to="/login">
                Đăng nhập
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </div>
        </section>
      </div>
    </div>
  );
}
