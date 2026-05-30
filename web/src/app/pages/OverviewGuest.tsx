import { Link } from 'react-router';
import { ArrowRight, FileCode, FlaskConical, Route, Shield, Zap } from 'lucide-react';
import { Card } from '../components/ui/card';
import { Button } from '../components/ui/button';

const features = [
  {
    icon: Route,
    title: 'Điều phối route',
    text: 'Map path công khai → upstream nội bộ. Cấu hình lưu SQLite, reload không cần restart.',
  },
  {
    icon: Shield,
    title: 'Bảo mật phân tầng',
    text: 'Admin plane (session cookie) và data plane (client API key). Key client chỉ hash trong DB.',
  },
  {
    icon: Zap,
    title: 'Proxy & rate limit',
    text: 'Chuyển tiếp HTTP, kiểm soát key, sẵn sàng mở rộng log và audit.',
  },
];

export function OverviewGuest() {
  return (
    <>
      <div className="mb-10">
        <p className="text-xs font-semibold uppercase tracking-widest text-primary mb-2">Avaso Gateway</p>
        <h1 className="text-3xl md:text-4xl font-bold text-white mb-3">
          Cổng API điều phối cho hệ thống của bạn
        </h1>
        <p className="text-muted-foreground max-w-2xl text-lg">
          Trang này giới thiệu sản phẩm cho khách tham quan. Quản trị viên đăng nhập để xem route thật,
          API key và cấu hình nội bộ.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Button asChild variant="outline" className="border-border">
            <Link to="/api-docs">
              <FileCode className="w-4 h-4 mr-2" />
              Xem tài liệu API
            </Link>
          </Button>
          <Button asChild variant="outline" className="border-border">
            <Link to="/proxy-try">
              <FlaskConical className="w-4 h-4 mr-2" />
              Thử gọi proxy
            </Link>
          </Button>
          <Button asChild className="bg-primary hover:bg-primary/90">
            <Link to="/login">
              Đăng nhập quản trị
              <ArrowRight className="w-4 h-4 ml-2" />
            </Link>
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
        {features.map(({ icon: Icon, title, text }) => (
          <Card key={title} className="rounded-2xl p-6 bg-card/80 border-border">
            <div className="p-2 rounded-lg bg-primary/10 w-fit mb-4">
              <Icon className="w-5 h-5 text-primary" />
            </div>
            <h3 className="font-bold text-white mb-2">{title}</h3>
            <p className="text-sm text-muted-foreground">{text}</p>
          </Card>
        ))}
      </div>

      <Card className="rounded-2xl p-6 bg-card/80 border-border border-dashed">
        <p className="text-sm text-muted-foreground">
          Bạn là quản trị?{' '}
          <Link to="/login" className="text-primary hover:underline font-medium">
            Đăng nhập
          </Link>{' '}
          để mở dashboard đầy đủ (routes, keys, logs).
        </p>
      </Card>
    </>
  );
}
