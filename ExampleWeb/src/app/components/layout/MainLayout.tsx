import { Outlet } from 'react-router';
import { Sidebar } from './Sidebar';
import { Header } from './Header';

export function MainLayout() {
  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <main className="flex-grow overflow-y-auto bg-background">
        <Header />
        <div className="p-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
