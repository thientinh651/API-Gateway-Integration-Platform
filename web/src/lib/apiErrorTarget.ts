/** Đích UI khi user bấm toast lỗi API. */
export type ApiErrorTarget = {
  route: string;
  sectionId?: string;
  label: string;
};

type Rule = {
  test: (apiPath: string) => boolean;
  target: ApiErrorTarget;
};

const RULES: Rule[] = [
  {
    test: (p) => p.includes('/integrations/salesforce'),
    target: { route: '/integrations', sectionId: 'section-salesforce', label: 'Salesforce' },
  },
  {
    test: (p) => p.includes('/integrations/zoho'),
    target: { route: '/integrations', sectionId: 'section-zoho', label: 'Zoho Projects' },
  },
  {
    test: (p) => p.includes('/integrations/sync-logs') || p.includes('/integrations/entity-links'),
    target: { route: '/integrations', sectionId: 'section-sync-logs', label: 'Nhật ký đồng bộ' },
  },
  {
    test: (p) => p.includes('/integrations'),
    target: { route: '/integrations', label: 'Tích hợp' },
  },
  {
    test: (p) => p.includes('/middleware/status'),
    target: { route: '/auth', sectionId: 'section-middleware-status', label: 'Runtime middleware' },
  },
  {
    test: (p) => p.includes('/client-keys'),
    target: { route: '/auth', sectionId: 'section-client-registry', label: 'Client Registry' },
  },
  {
    test: (p) => p.includes('/routes'),
    target: { route: '/routes', label: 'Quản lý Route' },
  },
  {
    test: (p) => p.includes('/proxy-queue'),
    target: { route: '/proxy-queue', label: 'Proxy Queue' },
  },
  {
    test: (p) => p.includes('/transaction-logs'),
    target: { route: '/logs', sectionId: 'section-logs', label: 'Log vận hành' },
  },
  {
    test: (p) => p.includes('/audit-logs'),
    target: { route: '/logs', sectionId: 'section-logs', label: 'Log quản trị' },
  },
  {
    test: (p) => p.includes('/settings'),
    target: { route: '/settings', label: 'Cài đặt hệ thống' },
  },
  {
    test: (p) => p.includes('/users'),
    target: { route: '/users', label: 'Quản lý người dùng' },
  },
  {
    test: (p) => p.includes('/dashboard/stats'),
    target: { route: '/', label: 'Tổng quan' },
  },
];

export function normalizeApiPath(input: string): string {
  try {
    const u = input.startsWith('http') ? new URL(input) : new URL(input, 'http://local');
    return u.pathname;
  } catch {
    const q = input.indexOf('?');
    return q >= 0 ? input.slice(0, q) : input;
  }
}

export function resolveApiErrorTarget(apiPath?: string): ApiErrorTarget | null {
  if (!apiPath) return null;
  const path = normalizeApiPath(apiPath);
  for (const rule of RULES) {
    if (rule.test(path)) return rule.target;
  }
  return null;
}
