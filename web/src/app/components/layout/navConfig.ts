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
  { path: '/auth', icon: Shield, label: 'OAuth & Clients' },
  { path: '/proxy-try', icon: FlaskConical, label: 'Thử gọi proxy' },
  { path: '/proxy-queue', icon: ListOrdered, label: 'Proxy Queue' },
  { path: '/integrations', icon: Plug, label: 'Tích hợp' },
  { path: '/users', icon: Users, label: 'Quản lý người dùng' },
  { path: '/logs', icon: ScrollText, label: 'Log vận hành' },
  { path: '/settings', icon: Settings, label: 'Cài đặt hệ thống' },
  { path: '/api-docs', icon: FileCode, label: 'Tài liệu' },
];
