import { SidebarNav } from './SidebarNav';

/** Sidebar desktop — ẩn trên mobile, dùng {@link MobileNav}. */
export function Sidebar() {
  return (
    <aside className="w-64 border-r border-border bg-slate-950 flex-shrink-0 hidden lg:flex flex-col">
      <SidebarNav />
    </aside>
  );
}
