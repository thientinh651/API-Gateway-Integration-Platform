import { Outlet } from 'react-router';
import { useAdminAuth } from '../../../contexts/AdminAuthContext';
import { Sidebar } from './Sidebar';
import { Header } from './Header';

export function MainLayout() {
  const { user } = useAdminAuth();
  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <main className="flex-grow overflow-y-auto bg-background relative">
        <div className="pointer-events-none absolute inset-0 tech-grid-bg-subtle opacity-40" aria-hidden />
        <Header />
        <div
          className={
            user
              ? 'relative z-[1] p-4 sm:p-6 lg:p-8 max-w-[100vw] overflow-x-hidden'
              : 'relative z-[1] p-0 max-w-[100vw] overflow-x-hidden'
          }
        >
          <Outlet />
        </div>
      </main>
    </div>
  );
}
