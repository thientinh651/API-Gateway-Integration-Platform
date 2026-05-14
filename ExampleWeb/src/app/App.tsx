import { BrowserRouter, Route, Routes } from 'react-router';
import { Toaster } from 'sonner';
import { MainLayout } from './components/layout/MainLayout';
import { Overview } from './pages/Overview';
import { Routes as RoutesPage } from './pages/Routes';
import { Auth } from './pages/Auth';
import { ApiDocs } from './pages/ApiDocs';
import { Settings } from './pages/Settings';
import { Users } from './pages/Users';
import { Logs } from './pages/Logs';
import { AuditLogs } from './pages/AuditLogs';
import { LoginPage } from './pages/login/LoginPage';

export default function App() {
  return (
    <BrowserRouter>
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
          <Route path="api-docs" element={<ApiDocs />} />
          <Route path="users" element={<Users />} />
          <Route path="logs" element={<Logs />} />
          <Route path="audit" element={<AuditLogs />} />
          <Route path="settings" element={<Settings />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
