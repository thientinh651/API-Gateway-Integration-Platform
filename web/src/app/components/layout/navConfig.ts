import {
  LayoutDashboard,
  Route,
  Shield,
  FileCode,
  FlaskConical,
  ListOrdered,
  Settings,
  Users,
  ScrollText,
  Plug,
  type LucideIcon,
} from 'lucide-react';

export type NavItem = { path: string; icon: LucideIcon; label: string };

export const NAV_ITEMS: NavItem[] = [
  { path: '/', icon: LayoutDashboard, label: 'Tổng quan' },
  { path: '/routes', icon: Route, label: 'Quản lý Route' },
  { path: '/auth', icon: Shield, label: 'Bảo mật & Auth' },
  { path: '/proxy-try', icon: FlaskConical, label: 'Thử gọi Proxy' },
  { path: '/proxy-queue', icon: ListOrdered, label: 'Proxy Queue' },
  { path: '/api-docs', icon: FileCode, label: 'Tài liệu API' },
  { path: '/integrations', icon: Plug, label: 'Tích hợp' },
  { path: '/users', icon: Users, label: 'Quản lý Users' },
  { path: '/logs', icon: ScrollText, label: 'Log vận hành' },
  { path: '/settings', icon: Settings, label: 'Cài đặt hệ thống' },
];
