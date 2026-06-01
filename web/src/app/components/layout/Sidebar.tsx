import { SidebarNav } from './SidebarNav';

/** Sidebar desktop — ẩn trên mobile, dùng {@link MobileNav}. */
export function Sidebar() {
  return (
    <aside className="w-64 border-r border-border bg-slate-950/95 flex-shrink-0 hidden lg:flex flex-col relative overflow-hidden">
      <div className="pointer-events-none absolute inset-0 tech-grid-bg opacity-30" aria-hidden />
      <SidebarNav className="relative z-[1]" />
    </aside>
  );
}
