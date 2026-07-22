import {
  AlertTriangle,
  BookOpen,
  Boxes,
  Gauge,
  Globe,
  HelpCircle,
  ListOrdered,
  Plug,
  Rocket,
  Server,
  Shield,
  Terminal,
  type LucideIcon,
} from 'lucide-react';

export type ApiDocTab =
  | 'start-here'
  | 'first-call'
  | 'configure-route'
  | 'configure-client'
  | 'get-token'
  | 'call-api'
  | 'ops-dlq'
  | 'integrations'
  | 'troubleshoot'
  | 'data-plane'
  | 'admin-api'
  | 'errors'
  | 'examples';

export type TabMeta = {
  label: string;
  short: string;
  description: string;
  icon: LucideIcon;
  kind: 'guide' | 'reference';
};

export type NavSection = {
  id: string;
  title: string;
  tabs: ApiDocTab[];
};

/** Hash cũ → tab mới (bookmark / link cũ không gãy). */
export const LEGACY_HASH_REDIRECT: Record<string, ApiDocTab> = {
  overview: 'start-here',
  architecture: 'start-here',
  'quick-start': 'first-call',
  authentication: 'get-token',
  'client-registry': 'configure-client',
  routing: 'configure-route',
  'proxy-queue': 'ops-dlq',
  concepts: 'start-here',
  faq: 'troubleshoot',
};

export const NAV_SECTIONS: NavSection[] = [
  {
    id: 'start',
    title: 'Bắt đầu',
    tabs: ['start-here', 'first-call'],
  },
  {
    id: 'config',
    title: 'Cấu hình Dashboard',
    tabs: ['configure-route', 'configure-client'],
  },
  {
    id: 'call',
    title: 'Gọi API',
    tabs: ['get-token', 'call-api'],
  },
  {
    id: 'ops',
    title: 'Vận hành',
    tabs: ['ops-dlq', 'integrations', 'troubleshoot'],
  },
  {
    id: 'ref',
    title: 'Tra cứu',
    tabs: ['data-plane', 'admin-api', 'errors', 'examples'],
  },
];

export const GUIDE_TABS: ApiDocTab[] = NAV_SECTIONS.filter((s) => s.id !== 'ref').flatMap(
  (s) => s.tabs,
);

export const REFERENCE_TABS: ApiDocTab[] = ['data-plane', 'admin-api', 'errors', 'examples'];

export const TAB_ORDER: ApiDocTab[] = [...GUIDE_TABS, ...REFERENCE_TABS];

export const TAB_CONFIG: Record<ApiDocTab, TabMeta> = {
  'start-here': {
    label: 'Bắt đầu',
    short: 'Bắt đầu',
    description: 'Làm quen AVASO Gateway và tìm đúng hướng dẫn cho việc bạn cần làm.',
    icon: BookOpen,
    kind: 'guide',
  },
  'first-call': {
    label: 'Gọi API',
    short: 'Gọi API',
    description: 'Checklist từng bước: tạo route, client, lấy JWT và gọi API thành công.',
    icon: Rocket,
    kind: 'guide',
  },
  'configure-route': {
    label: 'Tạo Route',
    short: 'Route',
    description: 'Cách ánh xạ đường dẫn tới upstream — điền từng trường trên form.',
    icon: Gauge,
    kind: 'guide',
  },
  'configure-client': {
    label: 'Tạo Client & ACL',
    short: 'Client',
    description: 'Đăng ký ứng dụng, lấy Client ID/Secret và gán quyền gọi route.',
    icon: Boxes,
    kind: 'guide',
  },
  'get-token': {
    label: 'Lấy JWT',
    short: 'JWT',
    description: 'Đổi Client ID và Secret lấy access_token để gọi data plane.',
    icon: Shield,
    kind: 'guide',
  },
  'call-api': {
    label: 'Gọi Data plane',
    short: 'Gọi API',
    description: 'Gửi Bearer JWT tới /v1/api/… và đọc phản hồi từ upstream.',
    icon: Globe,
    kind: 'guide',
  },
  'ops-dlq': {
    label: 'Retry & DLQ',
    short: 'DLQ',
    description: 'Xử lý khi upstream lỗi: retry, xếp hàng và replay trên Proxy Queue.',
    icon: ListOrdered,
    kind: 'guide',
  },
  integrations: {
    label: 'Tích hợp SF → Zoho',
    short: 'Tích hợp',
    description: 'Kết nối CRM, đồng bộ snapshot, chạy pipeline và đặt lịch tự động.',
    icon: Plug,
    kind: 'guide',
  },
  troubleshoot: {
    label: 'Xử lý sự cố',
    short: 'Sự cố',
    description: 'Khắc phục lỗi 401, 403, 404, 429, 502, 504 trên dashboard hoặc qua API.',
    icon: HelpCircle,
    kind: 'guide',
  },
  'data-plane': {
    label: 'Data plane',
    short: 'Data',
    description: 'Endpoint ứng dụng gọi qua gateway.',
    icon: Globe,
    kind: 'reference',
  },
  'admin-api': {
    label: 'Admin API',
    short: 'Admin',
    description: 'Endpoint dashboard: route, client, log, tích hợp.',
    icon: Server,
    kind: 'reference',
  },
  errors: {
    label: 'Mã lỗi',
    short: 'Errors',
    description: 'HTTP status và JSON error field.',
    icon: AlertTriangle,
    kind: 'reference',
  },
  examples: {
    label: 'Curl mẫu',
    short: 'Curl',
    description: 'Bộ lệnh golden path copy-paste.',
    icon: Terminal,
    kind: 'reference',
  },
};

export function isApiDocTab(v: string): v is ApiDocTab {
  return (TAB_ORDER as string[]).includes(v);
}

export function resolveDocHash(raw: string): ApiDocTab {
  const hash = raw.replace(/^#/, '');
  if (isApiDocTab(hash)) return hash;
  const redirected = LEGACY_HASH_REDIRECT[hash];
  if (redirected) return redirected;
  return 'start-here';
}
