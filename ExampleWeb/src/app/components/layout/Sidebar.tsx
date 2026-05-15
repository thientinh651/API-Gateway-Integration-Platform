import { Link, useLocation } from 'react-router';
import {
  LayoutDashboard,
  Route,
  Shield,
  FileCode,
  FlaskConical,
  Settings,
  Users,
  ScrollText,
  FileText,
  Layers,
} from 'lucide-react';

const navItems = [
  { path: '/', icon: LayoutDashboard, label: 'Tổng quan' },
  { path: '/routes', icon: Route, label: 'Quản lý Route' },
  { path: '/auth', icon: Shield, label: 'Bảo mật & Auth' },
  { path: '/proxy-try', icon: FlaskConical, label: 'Thử gọi Proxy' },
  { path: '/api-docs', icon: FileCode, label: 'Tài liệu API' },
  { path: '/users', icon: Users, label: 'Quản lý Users' },
  { path: '/logs', icon: ScrollText, label: 'Logs' },
  { path: '/audit', icon: FileText, label: 'Audit Logs' },
  { path: '/settings', icon: Settings, label: 'Cài đặt hệ thống' },
];

export function Sidebar() {
  const location = useLocation();

  return (
    <aside className="w-64 border-r border-border bg-slate-950 flex-shrink-0 hidden lg:flex flex-col">
      <div className="p-6">
        <div className="flex items-center space-x-3">
          <div className="bg-primary p-2 rounded-lg shadow-lg shadow-primary/20">
            <Layers className="w-5 h-5 text-white" />
          </div>
          <span className="text-lg font-bold text-white tracking-tight italic">
            AVASO <span className="text-primary">GW</span>
          </span>
        </div>
      </div>

      <nav className="flex-grow px-4 space-y-2 mt-4">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = location.pathname === item.path;

          return (
            <Link
              key={item.path}
              to={item.path}
              className={`flex items-center space-x-3 p-3 rounded-xl transition ${
                isActive
                  ? 'text-primary bg-primary/10'
                  : 'text-muted-foreground hover:bg-primary/10 hover:text-primary'
              }`}
            >
              <Icon className="w-5 h-5" />
              <span className="font-medium text-sm">{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="p-6 border-t border-border">
        <div className="flex items-center space-x-3 text-xs text-muted-foreground">
          <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></div>
          <span>Node: Ubuntu-Avaso-01</span>
        </div>
      </div>
    </aside>
  );
}
