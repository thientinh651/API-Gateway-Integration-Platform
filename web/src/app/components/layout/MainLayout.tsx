import { Outlet } from 'react-router';
import { useAdminAuth } from '../../../contexts/AdminAuthContext';
import { Sidebar } from './Sidebar';
import { Header } from './Header';

export function MainLayout() {
  const { user } = useAdminAuth();
  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <main className="flex-grow overflow-y-auto bg-background">
        <Header />
        <div
          className={
            user
              ? 'p-4 sm:p-6 lg:p-8 max-w-[100vw] overflow-x-hidden'
              : 'p-0 max-w-[100vw] overflow-x-hidden'
          }
        >
          <Outlet />
        </div>
      </main>
    </div>
  );
}
