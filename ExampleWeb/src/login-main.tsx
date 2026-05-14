import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { LoginPage } from './app/pages/login/LoginPage';
import { Toaster } from 'sonner';
import './styles/index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
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
        <Route path="/login.html" element={<Navigate to="/login" replace />} />
        <Route path="*" element={<LoginPage />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>
);
