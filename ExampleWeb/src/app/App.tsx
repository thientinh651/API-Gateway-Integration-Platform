import { BrowserRouter, Route, Routes } from 'react-router';
import { Toaster } from 'sonner';
import { AdminAuthProvider } from '../contexts/AdminAuthContext';
import { MainLayout } from './components/layout/MainLayout';
import { Overview } from './pages/Overview';
import { Routes as RoutesPage } from './pages/Routes';
import { Auth } from './pages/Auth';
import { ApiDocs } from './pages/ApiDocs';
import { Settings } from './pages/Settings';
import { Users } from './pages/Users';
import { Logs } from './pages/Logs';
import { AuditLogs } from './pages/AuditLogs';
import { ProxyTry } from './pages/ProxyTry';
import { LoginPage } from './pages/login/LoginPage';
import { AdminOnly } from './components/auth/AdminOnly';

export default function App() {
  return (
    <BrowserRouter>
      <AdminAuthProvider>
        <Toaster
          dir="ltr"
          position="top-right"
          richColors
          closeButton
          toastOptions={{ duration: 8000, closeButton: true }}
        />
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<MainLayout />}>
            <Route index element={<Overview />} />
            <Route path="routes" element={<RoutesPage />} />
            <Route path="auth" element={<Auth />} />
            <Route path="proxy-try" element={<ProxyTry />} />
            <Route path="api-docs" element={<ApiDocs />} />
            <Route
              path="users"
              element={
                <AdminOnly title="Quản lý Users" description="Đăng nhập để quản lý tài khoản quản trị.">
                  <Users />
                </AdminOnly>
              }
            />
            <Route
              path="logs"
              element={
                <AdminOnly title="Logs" description="Đăng nhập để xem log hệ thống.">
                  <Logs />
                </AdminOnly>
              }
            />
            <Route
              path="audit"
              element={
                <AdminOnly title="Audit Logs" description="Đăng nhập để xem nhật ký audit.">
                  <AuditLogs />
                </AdminOnly>
              }
            />
            <Route
              path="settings"
              element={
                <AdminOnly title="Cài đặt hệ thống" description="Đăng nhập để chỉnh cấu hình gateway.">
                  <Settings />
                </AdminOnly>
              }
            />
          </Route>
        </Routes>
      </AdminAuthProvider>
    </BrowserRouter>
  );
}
