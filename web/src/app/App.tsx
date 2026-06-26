import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { AppToaster } from './components/AppToaster';
import { ToastNavigateBridge } from './components/ToastNavigateBridge';
import { AdminAuthProvider } from '../contexts/AdminAuthContext';
import { MainLayout } from './components/layout/MainLayout';
import { Overview } from './pages/Overview';
import { Routes as RoutesPage } from './pages/Routes';
import { Auth } from './pages/Auth';
import { ApiDocs } from './pages/ApiDocs';
import { Settings } from './pages/Settings';
import { Users } from './pages/Users';
import { Logs } from './pages/Logs';
import { Integrations } from './pages/Integrations';
import { ProxyTry } from './pages/ProxyTry';
import { ProxyQueuePage } from './pages/ProxyQueue';
import { OAuthDemoCallback } from './pages/oauth/OAuthDemoCallback';
import { LoginPage } from './pages/login/LoginPage';
import { ForgotPassword } from './pages/ForgotPassword';
import { Register } from './pages/Register';
import { Profile } from './pages/Profile';
import { AdminOnly } from './components/auth/AdminOnly';
import { NavAccessGuard } from './components/auth/NavAccessGuard';

export default function App() {
  return (
    <BrowserRouter>
      <AdminAuthProvider>
        <ToastNavigateBridge />
        <AppToaster
          dir="ltr"
          position="top-right"
          offset={{ top: '1.5rem', right: '2.5rem' }}
          richColors
          closeButton
          toastOptions={{ duration: 8000, closeButton: true }}
        />
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/oauth/demo-callback" element={<OAuthDemoCallback />} />
          <Route path="/register" element={<Register />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/" element={<MainLayout />}>
            <Route index element={<Overview />} />
            <Route
              path="profile"
              element={
                <NavAccessGuard path="/profile">
                  <Profile />
                </NavAccessGuard>
              }
            />
            <Route
              path="routes"
              element={
                <NavAccessGuard path="/routes">
                  <RoutesPage />
                </NavAccessGuard>
              }
            />
            <Route
              path="auth"
              element={
                <NavAccessGuard path="/auth">
                  <Auth />
                </NavAccessGuard>
              }
            />
            <Route
              path="proxy-try"
              element={
                <NavAccessGuard path="/proxy-try">
                  <AdminOnly title="Thử gọi Proxy" description="Đăng nhập để thử JWT data-plane.">
                    <ProxyTry />
                  </AdminOnly>
                </NavAccessGuard>
              }
            />
            <Route
              path="proxy-queue"
              element={
                <NavAccessGuard path="/proxy-queue">
                  <ProxyQueuePage />
                </NavAccessGuard>
              }
            />
            <Route path="api-docs" element={<ApiDocs />} />
            <Route
              path="integrations"
              element={
                <NavAccessGuard path="/integrations">
                  <Integrations />
                </NavAccessGuard>
              }
            />
            <Route
              path="users"
              element={
                <NavAccessGuard path="/users">
                  <AdminOnly title="Quản lý Users" description="Đăng nhập để quản lý tài khoản quản trị.">
                    <Users />
                  </AdminOnly>
                </NavAccessGuard>
              }
            />
            <Route
              path="logs"
              element={
                <NavAccessGuard path="/logs">
                  <AdminOnly title="Log vận hành" description="Đăng nhập để xem log traffic và audit quản trị.">
                    <Logs />
                  </AdminOnly>
                </NavAccessGuard>
              }
            />
            <Route path="audit" element={<Navigate to="/logs?kind=admin" replace />} />
            <Route
              path="settings"
              element={
                <NavAccessGuard path="/settings">
                  <AdminOnly title="Cài đặt hệ thống" description="Đăng nhập để chỉnh cấu hình gateway.">
                    <Settings />
                  </AdminOnly>
                </NavAccessGuard>
              }
            />
          </Route>
        </Routes>
      </AdminAuthProvider>
    </BrowserRouter>
  );
}
