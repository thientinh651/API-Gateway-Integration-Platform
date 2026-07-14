import {
  BookOpen,
  Boxes,
  Gauge,
  Globe,
  HelpCircle,
  Layers,
  ListOrdered,
  Plug,
  Rocket,
  Server,
  Shield,
  Terminal,
  AlertTriangle,
  type LucideIcon,
} from 'lucide-react';

export type ApiDocTab =
  | 'overview'
  | 'architecture'
  | 'quick-start'
  | 'authentication'
  | 'client-registry'
  | 'routing'
  | 'proxy-queue'
  | 'integrations'
  | 'concepts'
  | 'faq'
  | 'data-plane'
  | 'admin-api'
  | 'errors'
  | 'examples';

export type TabMeta = {
  label: string;
  short: string;
  description: string;
  icon: LucideIcon;
  frameClass: string;
  headerClass: string;
  /** guide = hướng dẫn; reference = catalog endpoint */
  kind: 'guide' | 'reference';
};

/** Tầng 1 — hướng dẫn sử dụng. */
export const GUIDE_TABS: ApiDocTab[] = [
  'overview',
  'architecture',
  'quick-start',
  'authentication',
  'client-registry',
  'routing',
  'proxy-queue',
  'integrations',
  'concepts',
  'faq',
];

/** Tầng 2 — API Reference (4 tab cách đều). */
export const REFERENCE_TABS: ApiDocTab[] = ['data-plane', 'admin-api', 'errors', 'examples'];

export const TAB_ORDER: ApiDocTab[] = [...GUIDE_TABS, ...REFERENCE_TABS];

export const TAB_CONFIG: Record<ApiDocTab, TabMeta> = {
  overview: {
    label: 'Giới thiệu',
    short: 'Giới thiệu',
    description: 'Giới thiệu về Gateway và hệ thống.',
    icon: BookOpen,
    frameClass: 'border-slate-500/40 bg-slate-500/[0.06] shadow-[inset_0_1px_0_rgba(148,163,184,0.12)]',
    headerClass: 'from-slate-500/15 to-transparent border-slate-500/30',
    kind: 'guide',
  },
  architecture: {
    label: 'Kiến trúc',
    short: 'Kiến trúc',
    description: 'Request đi qua gateway thế nào? PostgreSQL và Redis ở đâu?',
    icon: Layers,
    frameClass: 'border-cyan-500/40 bg-cyan-500/[0.06] shadow-[inset_0_1px_0_rgba(6,182,212,0.12)]',
    headerClass: 'from-cyan-500/15 to-transparent border-cyan-500/30',
    kind: 'guide',
  },
  'quick-start': {
    label: 'Quick Start',
    short: 'Quick Start',
    description: 'Làm theo 5 bước để gọi API thành công lần đầu.',
    icon: Rocket,
    frameClass: 'border-primary/45 bg-primary/[0.07] shadow-[inset_0_1px_0_rgba(249,115,22,0.2)]',
    headerClass: 'from-primary/20 to-transparent border-primary/35',
    kind: 'guide',
  },
  authentication: {
    label: 'Authentication',
    short: 'Auth',
    description: 'Lấy JWT ở đâu? Gửi token thế nào? Secret dùng khi nào?',
    icon: Shield,
    frameClass: 'border-emerald-500/40 bg-emerald-500/[0.06] shadow-[inset_0_1px_0_rgba(16,185,129,0.12)]',
    headerClass: 'from-emerald-500/15 to-transparent border-emerald-500/30',
    kind: 'guide',
  },
  'client-registry': {
    label: 'Client Registry',
    short: 'Clients',
    description: 'Vì sao phải tạo client? Client ID / Secret dùng để làm gì?',
    icon: Boxes,
    frameClass: 'border-amber-500/40 bg-amber-500/[0.06] shadow-[inset_0_1px_0_rgba(245,158,11,0.12)]',
    headerClass: 'from-amber-500/15 to-transparent border-amber-500/30',
    kind: 'guide',
  },
  routing: {
    label: 'Routing',
    short: 'Routing',
    description: 'Path nào đi đâu? Gateway chọn route như thế nào?',
    icon: Gauge,
    frameClass: 'border-sky-500/40 bg-sky-500/[0.06] shadow-[inset_0_1px_0_rgba(14,165,233,0.12)]',
    headerClass: 'from-sky-500/15 to-transparent border-sky-500/30',
    kind: 'guide',
  },
  'proxy-queue': {
    label: 'Proxy Queue',
    short: 'DLQ',
    description: 'Upstream lỗi thì sao? Retry và hàng đợi (DLQ) hoạt động ra sao?',
    icon: ListOrdered,
    frameClass: 'border-orange-500/40 bg-orange-500/[0.06] shadow-[inset_0_1px_0_rgba(249,115,22,0.12)]',
    headerClass: 'from-orange-500/15 to-transparent border-orange-500/30',
    kind: 'guide',
  },
  integrations: {
    label: 'Integrations',
    short: 'SF→Zoho',
    description: 'Đồng bộ Salesforce → Zoho trên dashboard như thế nào?',
    icon: Plug,
    frameClass: 'border-violet-500/40 bg-violet-500/[0.06] shadow-[inset_0_1px_0_rgba(139,92,246,0.12)]',
    headerClass: 'from-violet-500/15 to-transparent border-violet-500/30',
    kind: 'guide',
  },
  concepts: {
    label: 'Concepts',
    short: 'Concepts',
    description: 'Giải thích ngắn các thuật ngữ hay gặp trên dashboard.',
    icon: BookOpen,
    frameClass: 'border-slate-500/40 bg-slate-500/[0.05] shadow-[inset_0_1px_0_rgba(148,163,184,0.1)]',
    headerClass: 'from-slate-500/12 to-transparent border-slate-500/25',
    kind: 'guide',
  },
  faq: {
    label: 'FAQ',
    short: 'FAQ',
    description: 'Gặp 401, 403, 429, 502… thì làm gì?',
    icon: HelpCircle,
    frameClass: 'border-rose-500/35 bg-rose-500/[0.05] shadow-[inset_0_1px_0_rgba(244,63,94,0.1)]',
    headerClass: 'from-rose-500/15 to-transparent border-rose-500/30',
    kind: 'guide',
  },
  'data-plane': {
    label: 'Data plane',
    short: 'Data plane',
    description: 'Endpoint client gọi qua gateway (/v1/api/*, token, health).',
    icon: Globe,
    frameClass: 'border-blue-500/40 bg-blue-500/[0.06] shadow-[inset_0_1px_0_rgba(59,130,246,0.15)]',
    headerClass: 'from-blue-500/15 to-transparent border-blue-500/30',
    kind: 'reference',
  },
  'admin-api': {
    label: 'Quản trị trên dashboard',
    short: 'Admin API',
    description: 'Endpoint dashboard: route, client, user, log, tích hợp.',
    icon: Server,
    frameClass: 'border-primary/45 bg-primary/[0.07] shadow-[inset_0_1px_0_rgba(249,115,22,0.2)]',
    headerClass: 'from-primary/20 to-transparent border-primary/35',
    kind: 'reference',
  },
  errors: {
    label: 'Error Codes',
    short: 'Errors',
    description: 'Mã HTTP và mã lỗi JSON khi gateway từ chối hoặc upstream lỗi.',
    icon: AlertTriangle,
    frameClass: 'border-red-500/35 bg-red-500/[0.05] shadow-[inset_0_1px_0_rgba(239,68,68,0.12)]',
    headerClass: 'from-red-500/15 to-transparent border-red-500/30',
    kind: 'reference',
  },
  examples: {
    label: 'Examples',
    short: 'Examples',
    description: 'Lệnh curl mẫu: lấy JWT, gọi API, đăng nhập admin.',
    icon: Terminal,
    frameClass: 'border-emerald-500/35 bg-emerald-500/[0.05] shadow-[inset_0_1px_0_rgba(16,185,129,0.12)]',
    headerClass: 'from-emerald-500/15 to-transparent border-emerald-500/30',
    kind: 'reference',
  },
};

export function isApiDocTab(v: string): v is ApiDocTab {
  return (TAB_ORDER as string[]).includes(v);
}
