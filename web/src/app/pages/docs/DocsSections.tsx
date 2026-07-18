import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Badge } from '../../components/ui/badge';
import { MiddlewarePipelineBanner } from '../../components/auth/MiddlewarePipelineBanner';
import { FlowDiagram } from './FlowDiagram';
import type { ApiDocTab } from './docsNav';

function Prose({ children }: { children: ReactNode }) {
  return <div className="text-sm sm:text-[15px] text-slate-300 leading-relaxed space-y-3 max-w-3xl">{children}</div>;
}

function Callout({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl border border-sky-500/30 bg-sky-500/5 px-4 py-3 text-sm text-slate-300 leading-relaxed max-w-3xl">
      {children}
    </div>
  );
}

function CodeBlock({ children }: { children: string }) {
  return (
    <div className="bg-[#050810] rounded-lg p-4 font-mono-tech text-xs overflow-x-auto border border-border/80 shadow-inner">
      <pre className="text-slate-300 whitespace-pre-wrap break-all sm:break-normal sm:whitespace-pre">{children}</pre>
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <div className="flex gap-3 sm:gap-4">
      <div className="shrink-0 w-8 h-8 rounded-lg bg-primary/15 border border-primary/40 flex items-center justify-center text-sm font-bold text-primary font-mono-tech">
        {n}
      </div>
      <div className="min-w-0 flex-1 pb-5 border-b border-border/50 last:border-0 last:pb-0">
        <h3 className="text-base font-bold text-white mb-1.5">{title}</h3>
        <div className="text-sm text-slate-300 leading-relaxed space-y-2">{children}</div>
      </div>
    </div>
  );
}

function ConceptCard({ title, plain, children }: { title: string; plain: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-border/70 bg-background/40 p-4 space-y-1.5">
      <h3 className="text-sm font-bold text-white">{title}</h3>
      <p className="text-sm text-slate-200 leading-relaxed">{plain}</p>
      <p className="text-xs text-muted-foreground leading-relaxed">{children}</p>
    </div>
  );
}

/** Nội dung tầng 1 — viết rõ ràng cho người mới. */
export function GuideTabContent({ tab }: { tab: ApiDocTab }) {
  switch (tab) {
    case 'overview':
      return (
        <div className="space-y-5">
          <Prose>
            <p>
              <strong className="text-white">AVASO Gateway</strong> là cổng API (API Gateway) viết bằng Rust.
              Ứng dụng không gọi thẳng Salesforce / Zoho / backend nội bộ — mà gọi qua gateway.
              Gateway kiểm tra quyền, chọn đúng đường đi, giới hạn tốc độ, ghi log, và chuyển tiếp request.
            </p>
            <p>Bạn có thể hình dung như một “lễ tân bảo mật” đứng trước các dịch vụ phía sau.</p>
          </Prose>
          <FlowDiagram
            nodes={[
              { label: 'Ứng dụng của ', detail: 'Web shop, ERP, script…', tone: 'border-sky-500/35 bg-sky-500/10' },
              {
                label: 'AVASO Gateway',
                detail: 'Xác thực · định tuyến · bảo vệ',
                tone: 'border-primary/45 bg-primary/10',
              },
              {
                label: 'Dịch vụ phía sau',
                detail: 'Salesforce, Zoho, API sản phẩm…',
                tone: 'border-emerald-500/35 bg-emerald-500/10',
              },
            ]}
          />
          <div className="grid sm:grid-cols-2 gap-3">
            <div className="rounded-xl border border-blue-500/30 bg-blue-500/5 p-4 space-y-2">
              <p className="text-xs font-bold uppercase tracking-wide text-blue-300">Phần 1 — Gọi API (Data plane)</p>
              <p className="text-sm text-slate-300 leading-relaxed">
                App gọi đường dẫn bắt đầu bằng{' '}
                <code className="font-mono-tech text-primary/90">/v1/api/…</code>
                . Phải gửi kèm <strong className="text-white">JWT</strong> (token) trong header Authorization.
              </p>
            </div>
            <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 space-y-2">
              <p className="text-xs font-bold uppercase tracking-wide text-primary">Phần 2 — Quản trị (Dashboard)</p>
              <p className="text-sm text-slate-300 leading-relaxed">
                Người quản trị đăng nhập website, tạo client, tạo route, xem log, xử lý hàng đợi lỗi. Dùng
                session đăng nhập — khác với JWT của app.
              </p>
            </div>
          </div>
          <Callout>
            <strong className="text-white">Bắt đầu nhanh:</strong> mở tab{' '}
            <strong className="text-white">Quick Start</strong> và làm theo 5 bước. Khi cần tra endpoint cụ thể,
            kéo xuống tầng 2 (Data plane / Admin API / Errors / Examples).
          </Callout>
        </div>
      );

    case 'architecture':
      return (
        <div className="space-y-5">
          <Prose>
            <p>
              Mỗi lần app gọi API, request đi qua nhiều bước (middleware) theo thứ tự. Nếu một bước từ chối
              (sai token, hết hạn mức, không có route…) thì gateway trả lỗi ngay — không chuyển tiếp lên
              backend.
            </p>
          </Prose>
          <MiddlewarePipelineBanner />
          <Prose>
            <p>
              <strong className="text-white">Dữ liệu cấu hình</strong> (route, client, log, hàng đợi lỗi) lưu
              trong <strong className="text-white">PostgreSQL</strong>.{' '}
              <strong className="text-white">Redis</strong> (nếu bật) giúp giữ phiên đăng nhập admin và đếm
              rate limit nhanh hơn.
            </p>
          </Prose>
          <div className="rounded-xl border border-border/70 bg-background/30 p-4 space-y-3">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Các thành phần</p>
            <FlowDiagram
              direction="vertical"
              nodes={[
                { label: 'Người dùng / App', detail: 'Dashboard hoặc curl / k6' },
                { label: 'Gateway (Rust)', detail: 'Kiểm tra JWT, chọn route, proxy' },
                { label: 'PostgreSQL', detail: 'Cấu hình + log + DLQ' },
                { label: 'Redis', detail: 'Session admin + rate limit' },
                { label: 'Upstream', detail: 'Salesforce · Zoho · HTTP API' },
              ]}
            />
          </div>
        </div>
      );

    case 'quick-start':
      return (
        <div className="space-y-4">
          <Callout>
            Mục tiêu: sau 5 bước, gọi được{' '}
            <code className="font-mono-tech text-primary/90">GET /v1/api/…</code> và nhận phản hồi từ upstream.
          </Callout>
          <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 sm:p-5 space-y-5">
            <Step n={1} title="Đăng nhập Dashboard">
              <p>
                Mở{' '}
                <Link to="/login" className="text-primary hover:underline font-medium">
                  trang đăng nhập
                </Link>{' '}
                bằng tài khoản Admin hoặc Operator. Đây là bước quản trị — chưa phải JWT của app.
              </p>
            </Step>
            <Step n={2} title="Tạo một Client (ứng dụng)">
              <p>
                Vào{' '}
                <Link to="/auth" className="text-primary hover:underline font-medium">
                  OAuth & Clients
                </Link>
                , tạo client mới. Hệ thống cấp:
              </p>
              <ul className="list-disc pl-5 space-y-1">
                <li>
                  <code className="font-mono-tech text-amber-300">avaso_pk_…</code> — Client ID 
                </li>
                <li>
                  <code className="font-mono-tech text-amber-300">avaso_sk_…</code> — Client Secret 
                </li>
              </ul>
            </Step>
            <Step n={3} title="Tạo Route và gán quyền cho Client">
              <p>
                Vào{' '}
                <Link to="/routes" className="text-primary hover:underline font-medium">
                  Quản lý Route
                </Link>
                : chọn path (ví dụ <code className="font-mono-tech">/v1/api/get</code>) và URL đích upstream.
                Sau đó gắn route này vào client vừa tạo — nếu không gắn, JWT hợp lệ vẫn bị 403.
              </p>
            </Step>
            <Step n={4} title="Đổi Client ID + Secret lấy JWT">
              <p className="text-muted-foreground text-xs mb-2">
                Chỉ dùng secret ở bước này. Không gửi secret khi gọi /v1/api/*.
              </p>
              <CodeBlock>{`curl -sS -X POST https://thientinh.io.vn/api/oauth/token \\
  -H "Content-Type: application/x-www-form-urlencoded" \\
  -d "grant_type=client_credentials&client_id=avaso_pk_...&client_secret=avaso_sk_..."`}</CodeBlock>
              <p>
                Trong phản hồi, lấy trường <code className="font-mono-tech">access_token</code> — đó là JWT.
              </p>
            </Step>
            <Step n={5} title="Gọi API qua gateway">
              <CodeBlock>{`TOKEN="<dán access_token vào đây>"
curl -sS "https://thientinh.io.vn/v1/api/get" \\
  -H "Authorization: Bearer $TOKEN"`}</CodeBlock>
              <p>
                Hoặc thử trên giao diện{' '}
                <Link to="/proxy-try" className="text-primary hover:underline font-medium">
                  Thử gọi proxy
                </Link>
                .
              </p>
            </Step>
          </div>
        </div>
      );

    case 'authentication':
      return (
        <div className="space-y-5">
          <Prose>
            <p>
              Có <strong className="text-white">hai kiểu đăng nhập</strong> — đừng nhầm lẫn:
            </p>
            <ol className="list-decimal pl-5 space-y-2">
              <li>
                <strong className="text-white">App / máy gọi API:</strong> dùng Client ID + Secret để lấy JWT,
                rồi gửi JWT trên mọi request <code className="font-mono-tech">/v1/api/*</code>.
              </li>
              <li>
                <strong className="text-white">Người quản trị:</strong> đăng nhập dashboard bằng username /
                password (cookie session + phân quyền Viewer / Operator / Admin).
              </li>
            </ol>
          </Prose>
          <FlowDiagram
            nodes={[
              {
                label: 'Client ID + Secret',
                detail: 'Chỉ dùng khi lấy token',
                tone: 'border-amber-500/35 bg-amber-500/10',
              },
              {
                label: 'POST /oauth/token',
                detail: 'Gateway phát JWT',
                tone: 'border-sky-500/35 bg-sky-500/10',
              },
              { label: 'JWT (access_token)', detail: 'Có hạn dùng (exp)', tone: 'border-emerald-500/35 bg-emerald-500/10' },
              {
                label: 'Gọi /v1/api/*',
                detail: 'Header: Bearer JWT',
                tone: 'border-primary/40 bg-primary/10',
              },
            ]}
          />
          <Callout>
            <strong className="text-white">Lưu ý tên:</strong>{' '}
            <code className="font-mono-tech">avaso_pk_</code> / <code className="font-mono-tech">avaso_sk_</code>{' '}
            chỉ là quy ước đặt tên Client ID / Secret (giống Stripe). <em>Không</em> phải cặp khóa RSA.
          </Callout>
          <Prose>
            <p>
              Địa chỉ lấy token: <code className="font-mono-tech">/api/oauth/token</code> hoặc{' '}
              <code className="font-mono-tech">/oauth/token</code> (cùng chức năng). Có giới hạn số lần gọi
              token mỗi phút để chống spam.
            </p>
          </Prose>
        </div>
      );

    case 'client-registry':
      return (
        <div className="space-y-5">
          <Prose>
            <p>
              <strong className="text-white">Client Registry</strong> là danh sách ứng dụng được phép gọi
              gateway. Mỗi app (web shop, ERP, script benchmark…) nên có một client riêng — để tắt riêng,
              giới hạn tốc độ riêng, và chỉ mở đúng các route cần dùng.
            </p>
            <p>Nếu không tạo client,  không lấy được JWT hợp lệ → mọi lời gọi data plane sẽ thất bại.</p>
          </Prose>
          <FlowDiagram
            nodes={[
              { label: 'Tạo client trên Dashboard', detail: 'OAuth & Clients' },
              { label: 'Nhận ID + Secret', detail: 'avaso_pk_ · avaso_sk_' },
              { label: 'Đổi lấy JWT', detail: 'POST /oauth/token' },
              { label: 'Chỉ gọi route đã gán', detail: 'ACL' },
            ]}
          />
          <Prose>
            <ul className="list-disc pl-5 space-y-1">
              <li>Client bị tắt → lỗi 403.</li>
              <li>Gọi path chưa được gán cho client → lỗi 403.</li>
              <li>Có thể xoay (rotate) secret hoặc thu hồi toàn bộ JWT mà không đổi Client ID.</li>
            </ul>
          </Prose>
        </div>
      );

    case 'routing':
      return (
        <div className="space-y-5">
          <Prose>
            <p>
              <strong className="text-white">Route</strong> nói với gateway: “path này thì chuyển tiếp sang URL
              nào”. Ví dụ <code className="font-mono-tech">/crm/…</code> sang Salesforce,{' '}
              <code className="font-mono-tech">/project/…</code> sang Zoho.
            </p>
            <p>
              Khi nhiều route trùng nhau, gateway chọn <strong className="text-white">path khớp dài nhất</strong>{' '}
              (longest prefix). Bạn cũng có thể giới hạn method (GET/POST…) và gắn quyền theo từng client.
            </p>
          </Prose>
          <div className="grid sm:grid-cols-2 gap-3">
            <div className="rounded-xl border border-border/70 bg-background/40 p-4 space-y-2">
              <Badge variant="outline" className="font-mono-tech text-[10px]">
                Ví dụ /crm/*
              </Badge>
              <FlowDiagram
                direction="vertical"
                nodes={[
                  { label: 'App gửi Bearer JWT' },
                  { label: 'Khớp route /crm', detail: 'Prefix dài nhất thắng' },
                  { label: 'Chuyển tới Salesforce', tone: 'border-sky-500/35 bg-sky-500/10' },
                ]}
              />
            </div>
            <div className="rounded-xl border border-border/70 bg-background/40 p-4 space-y-2">
              <Badge variant="outline" className="font-mono-tech text-[10px]">
                Ví dụ /project/*
              </Badge>
              <FlowDiagram
                direction="vertical"
                nodes={[
                  { label: 'App gửi Bearer JWT' },
                  { label: 'Khớp route /project' },
                  { label: 'Chuyển tới Zoho', tone: 'border-violet-500/35 bg-violet-500/10' },
                ]}
              />
            </div>
          </div>
          <Prose>
            <p>
              Một số path đặc biệt như{' '}
              <code className="font-mono-tech">/v1/api/canonical/contacts?target=sf|zoho</code> dùng schema
              chung (canonical) rồi gateway chuyển sang định dạng của từng CRM.
            </p>
          </Prose>
        </div>
      );

    case 'proxy-queue':
      return (
        <div className="space-y-5">
          <Prose>
            <p>
              Khi dịch vụ phía sau trả lỗi tạm thời (5xx) hoặc quá chậm (timeout), gateway có thể{' '}
              <strong className="text-white">thử lại</strong> vài lần. Nếu vẫn thất bại và route bật xếp hàng,
              request được đưa vào <strong className="text-white">Proxy Queue (DLQ)</strong> — hàng đợi lưu
              trong PostgreSQL để  xem và gửi lại (replay) sau.
            </p>
          </Prose>
          <FlowDiagram
            nodes={[
              { label: 'Gọi upstream', tone: 'border-sky-500/35 bg-sky-500/10' },
              { label: 'Lỗi / timeout', tone: 'border-red-500/35 bg-red-500/10' },
              { label: 'Thử lại', detail: 'Theo cấu hình route', tone: 'border-amber-500/35 bg-amber-500/10' },
              { label: 'Vào DLQ', detail: 'Lưu PostgreSQL', tone: 'border-orange-500/35 bg-orange-500/10' },
              { label: 'Replay', detail: 'Thủ công hoặc worker', tone: 'border-emerald-500/35 bg-emerald-500/10' },
            ]}
          />
          <Prose>
            <p>
              Cấu hình trên từng route: số lần retry, mã status nào cần retry, có xếp hàng khi fail hay không.
              Mở trang{' '}
              <Link to="/proxy-queue" className="text-primary hover:underline font-medium">
                Proxy Queue
              </Link>{' '}
              để xem và xử lý các bản ghi đang chờ.
            </p>
          </Prose>
        </div>
      );

    case 'integrations':
      return (
        <div className="space-y-5">
          <Prose>
            <p>
              Ngoài việc làm API Gateway, AVASO còn có màn hình{' '}
              <strong className="text-white">Tích hợp</strong> minh họa đồng bộ dữ liệu giữa Salesforce và
              Zoho: kết nối OAuth, kéo snapshot, chạy pipeline chuyển dữ liệu, xem log và liên kết entity.
            </p>
            <p>
              Đây là use case mở rộng — phần cốt lõi của đồ án vẫn là gateway (JWT, route, rate limit, DLQ).
            </p>
          </Prose>
          <FlowDiagram
            nodes={[
              { label: 'Salesforce', detail: 'Kết nối & kéo dữ liệu', tone: 'border-sky-500/35 bg-sky-500/10' },
              { label: 'Connector', detail: 'Snapshot · map', tone: 'border-cyan-500/35 bg-cyan-500/10' },
              { label: 'Pipeline', detail: 'Lọc · chuyển · ghi log', tone: 'border-primary/40 bg-primary/10' },
              { label: 'Zoho', detail: 'Đẩy dữ liệu', tone: 'border-violet-500/35 bg-violet-500/10' },
            ]}
          />
          <Prose>
            <p>
              Thao tác trên{' '}
              <Link to="/integrations" className="text-primary hover:underline font-medium">
                trang Tích hợp
              </Link>
              : kết nối từng CRM, sync, chạy sync-now, đặt lịch tự động (5/15/30/60 phút).
            </p>
          </Prose>
        </div>
      );

    case 'concepts':
      return (
        <div className="grid sm:grid-cols-2 gap-3">
          <ConceptCard title="Rate Limit" plain="Giới hạn số request trong một phút.">
            Vượt hạn mức → HTTP 429. Có thể cấu hình theo client. Header Retry-After gợi ý chờ bao lâu.
          </ConceptCard>
          <ConceptCard title="Retry" plain="Thử gọi lại khi upstream lỗi tạm thời.">
            Số lần và mã lỗi nào được retry cấu hình trên từng route (kèm backoff).
          </ConceptCard>
          <ConceptCard title="DLQ (Dead Letter Queue)" plain="Hàng đợi chứa request đã fail sau khi retry.">
            Lưu để người vận hành xem và gửi lại — tránh mất giao dịch khi backend tạm chết.
          </ConceptCard>
          <ConceptCard title="Transform" plain="Đổi định dạng dữ liệu giữa client và CRM.">
            Ví dụ schema canonical → field Salesforce/Zoho trước khi gọi API thật.
          </ConceptCard>
          <ConceptCard title="Connector" plain="Mảnh ghép nói chuyện với một hệ thống bên ngoài.">
            Giữ OAuth CRM, gọi API, đồng bộ snapshot trên dashboard Tích hợp.
          </ConceptCard>
          <ConceptCard title="ACL" plain="Danh sách route mà một client được phép gọi.">
            JWT hợp lệ nhưng path chưa gắn → 403. Giúp cô lập quyền giữa các app.
          </ConceptCard>
        </div>
      );

    case 'faq':
      return (
        <div className="space-y-4">
          <Callout>
            Gặp lỗi? Đọc cột “Làm gì” bên dưới. Chi tiết mã JSON xem tầng 2 → tab{' '}
            <strong className="text-white">Error Codes</strong>.
          </Callout>
          <div className="space-y-3">
            {[
              {
                code: '401',
                meaning: 'Chưa đăng nhập API / token sai / hết hạn',
                fix: 'Gửi header Authorization: Bearer <JWT>. Lấy token mới bằng Client ID + Secret tại POST /api/oauth/token.',
              },
              {
                code: '403',
                meaning: 'Có token nhưng không được phép',
                fix: 'Bật lại client nếu đang disabled. Gán đúng route vào client. Với dashboard: kiểm tra role (Viewer/Operator/Admin).',
              },
              {
                code: '404',
                meaning: 'Không có route khớp path',
                fix: 'Tạo route trên Dashboard khớp path  đang gọi (ví dụ /v1/api/…). Kiểm tra chính tả path.',
              },
              {
                code: '429',
                meaning: 'Gọi quá nhanh (rate limit)',
                fix: 'Giảm tần suất. Đọc header Retry-After. Có thể tăng hạn mức trên client (Operator).',
              },
              {
                code: '502',
                meaning: 'Gateway ổn nhưng upstream lỗi',
                fix: 'Kiểm tra URL target của route. Xem transaction log. Nếu bật queue: mở Proxy Queue.',
              },
              {
                code: '504',
                meaning: 'Upstream trả lời quá chậm',
                fix: 'Tăng timeout trên route hoặc tối ưu backend phía sau.',
              },
            ].map((row) => (
              <div
                key={row.code}
                className="flex flex-col sm:flex-row sm:items-start gap-3 p-3 rounded-lg bg-background/50 border border-border"
              >
                <Badge className="bg-red-500/10 text-red-400 border-red-500/20 border font-mono min-w-[52px] justify-center shrink-0">
                  {row.code}
                </Badge>
                <div className="min-w-0 space-y-1">
                  <p className="text-sm font-medium text-white">{row.meaning}</p>
                  <p className="text-sm text-slate-300 leading-relaxed">
                    <span className="text-muted-foreground">Làm gì → </span>
                    {row.fix}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      );

    default:
      return null;
  }
}
