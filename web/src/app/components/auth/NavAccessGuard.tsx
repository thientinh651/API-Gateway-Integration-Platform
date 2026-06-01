import type { ReactNode } from 'react';
import { Navigate } from 'react-router';
import { useAdminAuth } from '../../../contexts/AdminAuthContext';
import { canAccessNavPath } from '../../../lib/rbac';

type Props = {
  path: string;
  children: ReactNode;
};

/** Chặn URL trực tiếp tới trang role không được xem — quay về Tổng quan. */
export function NavAccessGuard({ path, children }: Props) {
  const { user, loading } = useAdminAuth();

  if (loading) {
    return <p className="text-sm text-muted-foreground">Đang kiểm tra phiên…</p>;
  }

  if (!canAccessNavPath(path, user)) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
