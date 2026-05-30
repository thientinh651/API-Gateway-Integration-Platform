import { Link } from 'react-router';
import { Lock } from 'lucide-react';
import { Card } from '../ui/card';
import { Button } from '../ui/button';

type Props = {
  title?: string;
  description?: string;
};

export function GuestAdminPrompt({
  title = 'Khu vực quản trị',
  description = 'Đăng nhập để xem và chỉnh cấu hình gateway. Khách vẫn xem được trang Tổng quan, Tài liệu API và Thử proxy.',
}: Props) {
  return (
    <Card className="rounded-2xl border-border bg-card/80 backdrop-blur-sm p-10 max-w-lg">
      <div className="flex items-center gap-3 mb-4">
        <div className="p-2 rounded-lg bg-primary/10">
          <Lock className="w-5 h-5 text-primary" />
        </div>
        <h2 className="text-xl font-bold text-white">{title}</h2>
      </div>
      <p className="text-sm text-muted-foreground mb-6">{description}</p>
      <Button asChild className="bg-primary hover:bg-primary/90">
        <Link to="/login">Đăng nhập quản trị</Link>
      </Button>
    </Card>
  );
}
