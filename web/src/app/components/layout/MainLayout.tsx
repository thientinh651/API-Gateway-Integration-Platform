import { useRef, useState } from 'react';
import { Outlet } from 'react-router';
import { useAdminAuth } from '../../../contexts/AdminAuthContext';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { ScrollToTopButton } from './ScrollToTopButton';

export function MainLayout() {
  const { user } = useAdminAuth();
  const mainRef = useRef<HTMLElement>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  return (
    <div className="flex h-screen overflow-hidden">
      {user ? <Sidebar open={sidebarOpen} /> : null}
      <main ref={mainRef} className="flex-grow overflow-y-auto bg-background relative">
        <div className="pointer-events-none absolute inset-0 tech-grid-bg-subtle opacity-40" aria-hidden />
        <Header
          sidebarOpen={sidebarOpen}
          onToggleSidebar={user ? () => setSidebarOpen((v) => !v) : undefined}
        />
        <div
          className={
            user
              ? 'relative z-[1] p-4 sm:p-6 lg:p-8 max-w-full overflow-x-hidden'
              : 'relative z-[1] max-w-full overflow-x-hidden'
          }
        >
          <Outlet />
        </div>
        <ScrollToTopButton scrollRoot={mainRef} />
      </main>
    </div>
  );
}
