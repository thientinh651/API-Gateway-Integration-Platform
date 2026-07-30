import { SidebarNav } from './SidebarNav';

type Props = {
  open?: boolean;
};

/** Sidebar desktop — ẩn trên mobile, dùng {@link MobileNav}. */
export function Sidebar({ open = true }: Props) {
  return (
    <aside
      aria-hidden={!open}
      className={`border-r border-border bg-slate-950/95 flex-shrink-0 hidden lg:flex flex-col relative overflow-hidden transition-[width,border-color] duration-300 ease-in-out ${
        open ? 'w-64 border-border' : 'w-0 border-transparent'
      }`}
    >
      <div
        className={`w-64 h-full flex flex-col transition-opacity duration-300 ease-in-out ${
          open ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      >
        <div className="pointer-events-none absolute inset-0 tech-grid-bg opacity-30" aria-hidden />
        <SidebarNav className="relative z-[1]" />
      </div>
    </aside>
  );
}
