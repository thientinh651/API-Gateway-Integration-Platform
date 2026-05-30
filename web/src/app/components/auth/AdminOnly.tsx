import type { ReactNode } from 'react';
import { useAdminAuth } from '../../../contexts/AdminAuthContext';
import { GuestAdminPrompt } from './GuestAdminPrompt';

type Props = {
  children: ReactNode;
  title?: string;
  description?: string;
};

export function AdminOnly({ children, title, description }: Props) {
  const { user, loading } = useAdminAuth();

  if (loading) {
    return <p className="text-sm text-muted-foreground">Đang kiểm tra phiên…</p>;
  }

  if (!user) {
    return <GuestAdminPrompt title={title} description={description} />;
  }

  return <>{children}</>;
}
