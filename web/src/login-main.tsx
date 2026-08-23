import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router';
import { LoginPage } from './app/pages/login/LoginPage';
import { AdminAuthProvider } from './contexts/AdminAuthContext';
import { GatewayFeaturesProvider } from './contexts/GatewayFeaturesContext';
import { AppToaster } from './app/components/AppToaster';
import './styles/index.css';

function LoginHtmlRedirect() {
  const { search } = useLocation();
  return <Navigate to={`/login${search}`} replace />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <GatewayFeaturesProvider>
        <AdminAuthProvider>
          <AppToaster
            dir="ltr"
            position="top-right"
            richColors
            closeButton
          />
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/login.html" element={<LoginHtmlRedirect />} />
            <Route path="*" element={<LoginPage />} />
          </Routes>
        </AdminAuthProvider>
      </GatewayFeaturesProvider>
    </BrowserRouter>
  </StrictMode>
);
