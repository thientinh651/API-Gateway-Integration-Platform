import type { ReactNode } from 'react';
import { Link } from 'react-router';
import type { ApiDocTab } from './docsNav';
import {
  CodeBlock,
  DEMO_HOST,
  DocFooterNav,
  DocGoal,
  DocPrereq,
  DocProse,
  DoNot,
  ExpectBox,
  FieldTable,
  HowToStep,
  WhereLink,
} from './DocPrimitives';

type GuideProps = {
  tab: ApiDocTab;
  onSelectTab?: (tab: ApiDocTab) => void;
};

function GuideShell({ children }: { children: ReactNode }) {
  return <div className="space-y-5">{children}</div>;
}

function TroubleshootLink({ onSelectTab }: { onSelectTab?: (tab: ApiDocTab) => void }) {
  if (onSelectTab) {
    return (
      <button
        type="button"
        className="text-primary hover:underline font-medium"
        onClick={() => onSelectTab('troubleshoot')}
      >
        Xử lý sự cố
      </button>
    );
  }
  return (
    <a href="#troubleshoot" className="text-primary hover:underline font-medium">
      Xử lý sự cố
    </a>
  );
}

function ErrorsLink({ onSelectTab }: { onSelectTab?: (tab: ApiDocTab) => void }) {
  if (onSelectTab) {
    return (
      <button
        type="button"
        className="text-primary hover:underline font-medium"
        onClick={() => onSelectTab('errors')}
      >
        Mã lỗi
      </button>
    );
  }
  return (
    <a href="#errors" className="text-primary hover:underline font-medium">
      Mã lỗi
    </a>
  );
}

const START_HERE_ROWS: { want: string; tab: ApiDocTab; label: string }[] = [
  { want: 'Thử nghiệm end-to-end', tab: 'first-call', label: 'Gọi API' },
  { want: 'Thiết lập đường dẫn và upstream', tab: 'configure-route', label: 'Tạo Route' },
  { want: 'Phân quyền cho một ứng dụng', tab: 'configure-client', label: 'Tạo Client & ACL' },
  { want: 'Lấy access_token để gọi API', tab: 'get-token', label: 'Lấy JWT' },
  { want: 'Gọi /v1/api/… từ ứng dụng', tab: 'call-api', label: 'Gọi Data plane' },
  { want: 'Xử lý lỗi upstream, retry, replay', tab: 'ops-dlq', label: 'Retry & DLQ' },
  { want: 'Đồng bộ Salesforce sang Zoho', tab: 'integrations', label: 'Tích hợp SF → Zoho' },
  { want: 'Khắc phục lỗi 401, 403, 502…', tab: 'troubleshoot', label: 'Xử lý sự cố' },
];

export function GuideTabContent({ tab, onSelectTab }: GuideProps) {
  switch (tab) {
    case 'start-here':
      return (
        <GuideShell>
          <DocProse>
            <p>
              Hướng dẫn này giúp bạn nhanh chóng làm quen và sử dụng AVASO Gateway từ A đến Z. Bạn sẽ
              bắt đầu từ việc cấu hình trên Dashboard cho đến việc gọi API từ ứng dụng.
            </p>
          </DocProse>

          <div className="grid sm:grid-cols-2 gap-3 max-w-3xl">
            <div className="rounded-lg border border-border/70 bg-background/40 p-4 space-y-2">
              <p className="text-xs font-bold uppercase tracking-wide text-slate-400">
                1. Cấu hình trên Dashboard
              </p>
              <p className="text-sm text-slate-300 leading-relaxed">
                Đăng nhập vào giao diện web, tạo <strong className="text-white">Route</strong>, sau đó
                tạo <strong className="text-white">Client</strong> và gán ACL. Bạn dùng session cookie
                để quản trị — không dùng JWT của ứng dụng.
              </p>
            </div>
            <div className="rounded-lg border border-border/70 bg-background/40 p-4 space-y-2">
              <p className="text-xs font-bold uppercase tracking-wide text-slate-400">
                2. Gọi API qua Data plane
              </p>
              <p className="text-sm text-slate-300 leading-relaxed">
                Ứng dụng dùng Client ID và Secret để lấy JWT, rồi gửi header{' '}
                <code className="font-mono-tech text-primary/90">Authorization: Bearer …</code> tới
                endpoint <code className="font-mono-tech text-primary/90">/v1/api/…</code>.
              </p>
            </div>
          </div>

          <div className="overflow-x-auto rounded-lg border border-border/70 max-w-3xl">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/70 bg-background/50 text-left">
                  <th className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                    Bạn cần
                  </th>
                  <th className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                    Hướng dẫn
                  </th>
                </tr>
              </thead>
              <tbody className="text-slate-300">
                {START_HERE_ROWS.map((row) => (
                  <tr key={row.tab} className="border-b border-border/40 last:border-0">
                    <td className="px-3 py-2.5">{row.want}</td>
                    <td className="px-3 py-2.5">
                      {onSelectTab ? (
                        <button
                          type="button"
                          onClick={() => onSelectTab(row.tab)}
                          className="text-primary hover:underline font-medium"
                        >
                          {row.label}
                        </button>
                      ) : (
                        <a href={`#${row.tab}`} className="text-primary hover:underline font-medium">
                          {row.label}
                        </a>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <DocFooterNav
            next={{ tab: 'first-call', label: 'Gọi API' }}
            onSelect={onSelectTab}
          />
        </GuideShell>
      );

    case 'first-call':
      return (
        <GuideShell>
          <DocGoal>
            Sau khi hoàn thành các bước bên dưới, bạn sẽ gọi thành công{' '}
            <code className="font-mono-tech text-primary/90">GET /v1/api/demo/get</code> và nhận được
            phản hồi từ upstream.
          </DocGoal>
          <DocPrereq>
            Yêu cầu quyền Admin hoặc Operator. Môi trường demo:{' '}
            <code className="font-mono-tech text-slate-300">{DEMO_HOST}</code>.
          </DocPrereq>

          <div className="rounded-xl border border-border/70 bg-background/30 p-4 sm:p-5 space-y-5">
            <HowToStep n={1} title="Đăng nhập Dashboard" where={<WhereLink to="/login">Đăng nhập</WhereLink>}>
              <p>Nhập tên đăng nhập và mật khẩu (Admin hoặc Operator), sau đó nhấn Submit.</p>
              <ExpectBox>
                Bạn sẽ thấy trang tổng quan. Cookie session được lưu — đây chưa phải JWT dành cho
                ứng dụng.
              </ExpectBox>
            </HowToStep>

            <HowToStep
              n={2}
              title="Tạo Route"
              where={<WhereLink to="/routes">Quản lý Route</WhereLink>}
            >
              <p>
                Nhấn nút <strong className="text-white">Thêm route</strong> và nhập các thông tin sau:
              </p>
              <FieldTable
                rows={[
                  { field: 'Path', value: '/v1/api/demo/get', note: 'Đường dẫn mà client sẽ gọi qua gateway' },
                  {
                    field: 'Upstream URL',
                    value: 'https://httpbin.org/get',
                    note: 'Có thể thay bằng URL thực tế của dịch vụ phía sau',
                  },
                  { field: 'Timeout (s)', value: '30', note: 'Giá trị mặc định' },
                  { field: 'Rate limit', value: '100', note: 'Số yêu cầu tối đa mỗi phút trên route' },
                  { field: 'Methods', value: 'GET', note: 'Chỉ cho phép GET trong lần thử đầu' },
                  { field: 'Retry max', value: '0', note: 'Tắt retry để đơn giản hóa bước đầu' },
                  { field: 'Queue on failure', value: 'tắt', note: 'Có thể bật sau ở mục Retry & DLQ' },
                ]}
              />
              <ExpectBox>Route mới sẽ xuất hiện trong danh sách.</ExpectBox>
            </HowToStep>

            <HowToStep
              n={3}
              title="Tạo Client và gán ACL"
              where={<WhereLink to="/auth">OAuth & Clients</WhereLink>}
            >
              <p>
                Vào tab <strong className="text-white">Machine clients</strong>, tạo client mới và nhập:
              </p>
              <FieldTable
                rows={[
                  { field: 'Name', value: 'demo-app', note: 'Tên hiển thị trên dashboard' },
                  { field: 'Loại', value: 'app', note: 'Thường dùng cho tích hợp máy-máy' },
                  { field: 'Rate limit', value: '100', note: 'Giới hạn theo client (yêu cầu/phút)' },
                  {
                    field: 'Routes (ACL)',
                    value: 'chọn /v1/api/demo/get',
                    note: 'Bắt buộc — thiếu ACL sẽ trả 403 dù JWT hợp lệ',
                  },
                ]}
              />
              <p>
                Sau khi tạo, hãy <strong className="text-white">sao chép ngay</strong> Client ID và Client
                Secret (chỉ hiển thị một lần).
              </p>
              <DoNot>
                Không dùng Client Secret khi gọi <code className="font-mono-tech">/v1/api/*</code>. Secret
                chỉ dùng để lấy token.
              </DoNot>
            </HowToStep>

            <HowToStep n={4} title="Đổi Client ID/Secret lấy JWT">
              <CodeBlock>{`curl -sS -X POST ${DEMO_HOST}/api/oauth/token \\
  -H "Content-Type: application/x-www-form-urlencoded" \\
  -d "grant_type=client_credentials&client_id=avaso_cid_...&client_secret=avaso_csec_..."`}</CodeBlock>
              <ExpectBox>
                Phản hồi JSON chứa <code className="font-mono-tech text-emerald-200">access_token</code>,{' '}
                <code className="font-mono-tech text-emerald-200">token_type</code> là{' '}
                <code className="font-mono-tech text-emerald-200">Bearer</code>, và{' '}
                <code className="font-mono-tech text-emerald-200">expires_in</code>.
              </ExpectBox>
            </HowToStep>

            <HowToStep n={5} title="Gọi API qua gateway">
              <CodeBlock>{`TOKEN="<dán access_token>"
curl -sS -i "${DEMO_HOST}/v1/api/demo/get" \\
  -H "Authorization: Bearer $TOKEN"`}</CodeBlock>
              <ExpectBox>
                Bạn nhận HTTP 200 kèm body từ upstream. Nếu dùng httpbin, bạn sẽ thấy JSON phản hồi.
                Bạn cũng có thể thử trên{' '}
                <Link to="/proxy-try" className="text-primary hover:underline font-medium">
                  công cụ thử proxy
                </Link>
                .
              </ExpectBox>
            </HowToStep>
          </div>

          <DocProse>
            <p>
              Nếu gặp lỗi, hãy tham khảo mục <TroubleshootLink onSelectTab={onSelectTab} />. Các hướng dẫn
              chi tiết về Route và Client nằm ở các phần tiếp theo.
            </p>
          </DocProse>

          <DocFooterNav
            prev={{ tab: 'start-here', label: 'Bắt đầu' }}
            next={{ tab: 'configure-route', label: 'Tạo Route chi tiết' }}
            onSelect={onSelectTab}
          />
        </GuideShell>
      );

    case 'configure-route':
      return (
        <GuideShell>
          <DocGoal>
            Thiết lập Route để gateway biết cách ánh xạ đường dẫn đến URL upstream tương ứng.
          </DocGoal>
          <DocPrereq>
            Bạn đã đăng nhập với quyền Admin (để tạo mới) hoặc Operator (để sửa). Truy cập{' '}
            <WhereLink to="/routes">Quản lý Route</WhereLink>.
          </DocPrereq>

          <HowToStep n={1} title="Mở form tạo hoặc chỉnh sửa route">
            <p>
              Nhấn nút thêm route mới, hoặc chọn route có sẵn rồi nhấn Edit. Điền đầy đủ các trường bắt
              buộc để lưu thành công.
            </p>
          </HowToStep>

          <HowToStep n={2} title="Nhập các trường bắt buộc">
            <FieldTable
              rows={[
                {
                  field: 'Path',
                  value: '/v1/api/crm',
                  note: 'Path đầy đủ client gọi qua gateway (bắt buộc dưới /v1/api). Hỗ trợ {id}. Match longest prefix.',
                },
                {
                  field: 'Upstream URL',
                  value: 'https://api.example.com',
                  note: 'URL đích (HTTP/HTTPS). Gateway nối phần còn lại của đường dẫn vào đây.',
                },
                {
                  field: 'Timeout (s)',
                  value: '30',
                  note: 'Nếu quá thời gian này, gateway trả về 504. Tăng giá trị nếu upstream phản hồi chậm.',
                },
                {
                  field: 'Rate limit (req/min)',
                  value: '100',
                  note: 'Giới hạn tần suất trên route. Áp dụng chung cho mọi client gọi route này.',
                },
                {
                  field: 'Allowed methods',
                  value: 'GET,POST',
                  note: 'Phương thức không nằm trong danh sách sẽ bị từ chối.',
                },
              ]}
            />
            <DoNot>
              Đặt path chỉ <code className="font-mono-tech">/crm</code> rồi kỳ vọng gọi{' '}
              <code className="font-mono-tech">https://host/crm</code>. Data plane chỉ nhận{' '}
              <code className="font-mono-tech">/v1/api/…</code> + Bearer JWT.
            </DoNot>
          </HowToStep>

          <HowToStep n={3} title="Tùy chọn độ tin cậy (có thể giữ mặc định)">
            <FieldTable
              rows={[
                {
                  field: 'Retry max',
                  value: '0',
                  note: 'Số lần thử lại khi upstream thất bại. 0 nghĩa là không retry.',
                },
                {
                  field: 'Retry on status',
                  value: '502,503,504',
                  note: 'Chỉ retry với các mã trạng thái này (khi retry max lớn hơn 0).',
                },
                {
                  field: 'Retry on timeout',
                  value: 'bật',
                  note: 'Timeout cũng được coi là lỗi tạm thời và có thể retry.',
                },
                {
                  field: 'Queue on failure',
                  value: 'tắt',
                  note: 'Bật nếu muốn lưu request vào hàng đợi khi retry vẫn thất bại (DLQ).',
                },
                {
                  field: 'Transform headers',
                  value: '{} / []',
                  note: 'Thêm hoặc xóa header trước khi chuyển tiếp. Để trống nếu chưa cần.',
                },
              ]}
            />
            <ExpectBox>
              Sau khi lưu, route sẽ xuất hiện trong bảng với các thông số đã cấu hình.
            </ExpectBox>
          </HowToStep>

          <HowToStep n={4} title="Kiểm tra nhanh">
            <p>
              Nếu chưa gán client nào, cột ACL sẽ trống. Khi đó, client gọi đường dẫn này sẽ nhận 403
              cho đến khi được gán ACL trong trang Client.
            </p>
            <p className="text-slate-400 text-xs">
              Lưu ý về độ ưu tiên: nếu có hai route trùng prefix, route khớp dài hơn sẽ được áp dụng
              (ví dụ <code className="font-mono-tech">/v1/api/crm/contacts</code> thắng{' '}
              <code className="font-mono-tech">/v1/api/crm</code>).
            </p>
          </HowToStep>

          <DocFooterNav
            prev={{ tab: 'first-call', label: 'Gọi API' }}
            next={{ tab: 'configure-client', label: 'Tạo Client & ACL' }}
            onSelect={onSelectTab}
          />
        </GuideShell>
      );

    case 'configure-client':
      return (
        <GuideShell>
          <DocGoal>
            Đăng ký ứng dụng (machine client), nhận cặp Client ID/Secret, và gán đúng các route được phép
            gọi.
          </DocGoal>
          <DocPrereq>
            Đã có ít nhất một route trong hệ thống. Truy cập{' '}
            <WhereLink to="/auth">OAuth & Clients</WhereLink>, tab Machine clients.
          </DocPrereq>

          <HowToStep n={1} title="Tạo client">
            <p>Nhấn nút tạo mới và điền các thông tin:</p>
            <FieldTable
              rows={[
                { field: 'Name', value: 'web-shop', note: 'Tên hiển thị, giúp dễ nhận diện sau này' },
                {
                  field: 'Integration type',
                  value: 'app',
                  note: 'Loại client (app, integration, …)',
                },
                {
                  field: 'Rate limit (req/min)',
                  value: '100',
                  note: 'Có thể đặt từ 0 đến 1.000.000. Vượt mức sẽ nhận HTTP 429.',
                },
                {
                  field: 'Gán routes',
                  value: 'chọn các route cần cho phép',
                  note: 'ACL: JWT hợp lệ nhưng route chưa được gán sẽ dẫn đến 403.',
                },
              ]}
            />
            <ExpectBox>
              Hệ thống hiển thị <code className="font-mono-tech">avaso_cid_…</code> (Client ID) và{' '}
              <code className="font-mono-tech">avaso_csec_…</code> (Client Secret). Hãy sao chép secret
              ngay vì nó không xuất hiện lại sau này.
            </ExpectBox>
          </HowToStep>

          <HowToStep n={2} title="Sửa ACL sau khi tạo">
            <p>
              Bạn có thể mở lại cấu hình client, thay đổi danh sách route được gán, rồi lưu lại. Danh
              sách ACL cũng có thể xem từ trang Route.
            </p>
          </HowToStep>

          <HowToStep n={3} title="Vận hành client">
            <FieldTable
              rows={[
                {
                  field: 'Disable',
                  value: 'tắt status',
                  note: 'Client bị vô hiệu hóa — mọi JWT của client đó sẽ bị 403.',
                },
                {
                  field: 'Rotate secret',
                  value: 'Rotate',
                  note: 'Đổi secret, giữ nguyên client_id. Ứng dụng phải dùng secret mới để lấy token.',
                },
                {
                  field: 'Revoke tokens',
                  value: 'Revoke',
                  note: 'Thu hồi toàn bộ JWT đang hoạt động (tăng token_version).',
                },
              ]}
            />
            <DoNot>
              Nhét Client Secret vào header data plane như API key. Secret chỉ dùng ở{' '}
              <code className="font-mono-tech">POST /api/oauth/token</code>; sau đó gửi Bearer JWT.
            </DoNot>
          </HowToStep>

          <DocFooterNav
            prev={{ tab: 'configure-route', label: 'Tạo Route' }}
            next={{ tab: 'get-token', label: 'Lấy JWT' }}
            onSelect={onSelectTab}
          />
        </GuideShell>
      );

    case 'get-token':
      return (
        <GuideShell>
          <DocGoal>
            Dùng Client ID và Secret để lấy <code className="font-mono-tech">access_token</code> (JWT) nhằm
            gọi các API qua data plane.
          </DocGoal>
          <DocPrereq>
            Bạn đã có Client ID và Secret từ trang Client. Client đang bật và chưa vượt hạn mức.
          </DocPrereq>

          <HowToStep n={1} title="Gọi token endpoint">
            <p>
              Sử dụng <code className="font-mono-tech">POST /api/oauth/token</code> hoặc{' '}
              <code className="font-mono-tech">POST /oauth/token</code> (cả hai đều hợp lệ). Body ở dạng{' '}
              <code className="font-mono-tech">application/x-www-form-urlencoded</code>:
            </p>
            <FieldTable
              rows={[
                {
                  field: 'grant_type',
                  value: 'client_credentials',
                  note: 'Luồng máy-máy theo chuẩn OAuth 2.0',
                },
                { field: 'client_id', value: 'avaso_cid_…', note: 'Client ID' },
                { field: 'client_secret', value: 'avaso_csec_…', note: 'Chỉ dùng ở bước này' },
              ]}
            />
            <CodeBlock>{`curl -sS -X POST ${DEMO_HOST}/api/oauth/token \\
  -H "Content-Type: application/x-www-form-urlencoded" \\
  -d "grant_type=client_credentials&client_id=avaso_cid_...&client_secret=avaso_csec_..."`}</CodeBlock>
            <ExpectBox>
              <code className="font-mono-tech text-xs block mt-1">{`{"access_token":"eyJ...","token_type":"Bearer","expires_in":3600}`}</code>
            </ExpectBox>
          </HowToStep>

          <HowToStep n={2} title="Phân biệt hai loại đăng nhập">
            <FieldTable
              rows={[
                {
                  field: 'Ứng dụng / script',
                  value: 'JWT Bearer',
                  note: 'Client ID + Secret → token → gọi /v1/api/*',
                },
                {
                  field: 'Người quản trị',
                  value: 'Session cookie',
                  note: 'Đăng nhập dashboard bằng username/password — không dùng để gọi data plane',
                },
              ]}
            />
            <p className="text-xs text-slate-400">
              Các grant type khác (password, authorization code + PKCE) dành cho ứng dụng có người dùng
              hoặc bên thứ ba. Hầu hết tích hợp backend chỉ cần{' '}
              <code className="font-mono-tech">client_credentials</code>.
            </p>
          </HowToStep>

          <DocFooterNav
            prev={{ tab: 'configure-client', label: 'Client & ACL' }}
            next={{ tab: 'call-api', label: 'Gọi Data plane' }}
            onSelect={onSelectTab}
          />
        </GuideShell>
      );

    case 'call-api':
      return (
        <GuideShell>
          <DocGoal>
            Gửi JWT hợp lệ đến đường dẫn đã cấu hình và nhận phản hồi từ upstream.
          </DocGoal>
          <DocPrereq>
            Bạn có <code className="font-mono-tech">access_token</code> còn hiệu lực, và đường dẫn đã được
            thiết lập route cùng ACL.
          </DocPrereq>

          <HowToStep n={1} title="Gọi API với header Authorization">
            <FieldTable
              rows={[
                {
                  field: 'Header',
                  value: 'Authorization: Bearer <access_token>',
                  note: 'Bắt buộc đối với data plane',
                },
                {
                  field: 'URL',
                  value: `${DEMO_HOST}/v1/api/demo/get`,
                  note: 'Phải khớp với route đã tạo',
                },
                {
                  field: 'Method',
                  value: 'GET / POST…',
                  note: 'Phải nằm trong danh sách allowed methods',
                },
              ]}
            />
            <CodeBlock>{`TOKEN="<access_token>"
curl -sS -i "${DEMO_HOST}/v1/api/demo/get" \\
  -H "Authorization: Bearer $TOKEN"`}</CodeBlock>
            <ExpectBox>
              HTTP 200 kèm body từ upstream. Token sai → 401. Thiếu ACL → 403. Không có route khớp →
              404.
            </ExpectBox>
          </HowToStep>

          <HowToStep
            n={2}
            title="Thử trên giao diện (không cần curl)"
            where={<WhereLink to="/proxy-try">Thử gọi proxy</WhereLink>}
          >
            <p>
              Chọn đường dẫn và phương thức, dán token, gửi yêu cầu và xem status cùng body phản hồi.
            </p>
          </HowToStep>

          <HowToStep n={3} title="Canonical contacts (dùng chung cho CRM)">
            <p>
              Đường dẫn này ánh xạ schema chung sang Salesforce hoặc Zoho. Vẫn cần JWT và ACL nếu route
              được bảo vệ:
            </p>
            <CodeBlock>{`curl -sS "${DEMO_HOST}/v1/api/canonical/contacts?target=sf" \\
  -H "Authorization: Bearer $TOKEN"`}</CodeBlock>
            <p className="text-xs text-slate-400">
              Tham số <code className="font-mono-tech">target=sf|zoho</code>. Chi tiết endpoint xem thêm
              ở tab Data plane.
            </p>
          </HowToStep>

          <HowToStep
            n={4}
            title="Xem log để debug"
            where={<WhereLink to="/logs">Logs</WhereLink>}
          >
            <p>
              Transaction log ghi lại các request đã qua gateway: trạng thái, client, đường dẫn và kết
              quả.
            </p>
          </HowToStep>

          <DocFooterNav
            prev={{ tab: 'get-token', label: 'Lấy JWT' }}
            next={{ tab: 'ops-dlq', label: 'Retry & DLQ' }}
            onSelect={onSelectTab}
          />
        </GuideShell>
      );

    case 'ops-dlq':
      return (
        <GuideShell>
          <DocGoal>
            Khi upstream gặp sự cố tạm thời, bạn có thể bật retry, xếp hàng vào DLQ, rồi replay qua Proxy
            Queue.
          </DocGoal>
          <DocPrereq>
            Đã có route cần bảo vệ. Truy cập <WhereLink to="/routes">Routes</WhereLink> và{' '}
            <WhereLink to="/proxy-queue">Proxy Queue</WhereLink>.
          </DocPrereq>

          <HowToStep n={1} title="Bật retry và queue trên route">
            <p>Chỉnh sửa route và nhập các giá trị sau:</p>
            <FieldTable
              rows={[
                { field: 'Retry max', value: '3', note: 'Thử lại tối đa 3 lần' },
                {
                  field: 'Retry on status',
                  value: '502,503,504',
                  note: 'Chỉ retry với các mã lỗi tạm thời',
                },
                { field: 'Retry on timeout', value: 'bật', note: 'Timeout cũng được retry' },
                {
                  field: 'Queue on failure',
                  value: 'bật',
                  note: 'Sau khi retry vẫn thất bại, request được lưu vào DLQ (PostgreSQL). Chỉ method idempotent (GET/PUT/DELETE…) — POST/PATCH không vào DLQ.',
                },
              ]}
            />
            <ExpectBox>
              Sau khi lưu, các request thất bại đủ điều kiện (method an toàn gửi lại) sẽ xuất hiện trong Proxy
              Queue. POST/PATCH timeout chỉ trả lỗi cho client + ghi log, không xếp DLQ.
            </ExpectBox>
          </HowToStep>

          <HowToStep
            n={2}
            title="Xem và replay"
            where={<WhereLink to="/proxy-queue">Proxy Queue</WhereLink>}
          >
            <p>
              Mở danh sách bản ghi lỗi, chọn bản ghi cần xử lý, rồi nhấn{' '}
              <strong className="text-white">Retry / Replay</strong> (yêu cầu quyền Operator trở lên).
              Gateway từ chối Replay POST/PATCH để tránh gửi lại lệnh thay đổi trạng thái.
            </p>
            <ExpectBox>
              Replay thành công khi upstream đã hoạt động trở lại — bản ghi sẽ được xử lý xong.
            </ExpectBox>
          </HowToStep>

          <DocFooterNav
            prev={{ tab: 'call-api', label: 'Gọi Data plane' }}
            next={{ tab: 'integrations', label: 'Tích hợp SF → Zoho' }}
            onSelect={onSelectTab}
          />
        </GuideShell>
      );

    case 'integrations':
      return (
        <GuideShell>
          <DocGoal>
            Kết nối Salesforce và Zoho trên dashboard, kéo snapshot dữ liệu và chạy pipeline đồng bộ.
          </DocGoal>
          <DocPrereq>
            Quyền Admin. Đã có Connected App hoặc OAuth client từ Salesforce và Zoho. Truy cập{' '}
            <WhereLink to="/integrations">Tích hợp</WhereLink>.
          </DocPrereq>

          <HowToStep n={1} title="Kết nối Salesforce">
            <p>
              Trên card Salesforce, nhấn <strong className="text-white">Connect</strong>, đăng nhập và cấp
              quyền OAuth trên Salesforce, rồi quay lại dashboard.
            </p>
            <ExpectBox>Trạng thái Salesforce hiển thị đã kết nối (connected).</ExpectBox>
          </HowToStep>

          <HowToStep n={2} title="Kết nối Zoho">
            <p>
              Tương tự, nhấn <strong className="text-white">Connect</strong> trên card Zoho và hoàn tất luồng
              OAuth.
            </p>
            <ExpectBox>Cả hai provider đều hiển thị trạng thái đã kết nối.</ExpectBox>
          </HowToStep>

          <HowToStep n={3} title="Đồng bộ snapshot và chạy pipeline">
            <FieldTable
              rows={[
                {
                  field: 'Sync SF / Zoho',
                  value: 'nút Sync trên từng provider',
                  note: 'Kéo snapshot dữ liệu về cơ sở dữ liệu',
                },
                {
                  field: 'Đồng bộ ngay',
                  value: 'chạy pipeline ngay',
                  note: 'Quy trình: pull → lọc → đẩy → ghi log (SF → Zoho)',
                },
                {
                  field: 'Lịch tự động',
                  value: 'off | mỗi N phút | daily',
                  note: 'Cấu hình lịch sync trên giao diện',
                },
              ]}
            />
            <ExpectBox>
              Pipeline status, sync logs và entity links sẽ hiển thị dữ liệu mới sau khi chạy.
            </ExpectBox>
          </HowToStep>

          <DocProse>
            <p className="text-xs text-slate-400">
              Đây là luồng tích hợp CRM trên dashboard — tách biệt với data plane JWT. Proxy connector qua{' '}
              <code className="font-mono-tech">/v1/api/…</code> vẫn yêu cầu route và client như các hướng
              dẫn trước.
            </p>
          </DocProse>

          <DocFooterNav
            prev={{ tab: 'ops-dlq', label: 'Retry & DLQ' }}
            next={{ tab: 'troubleshoot', label: 'Xử lý sự cố' }}
            onSelect={onSelectTab}
          />
        </GuideShell>
      );

    case 'troubleshoot':
      return (
        <GuideShell>
          <DocGoal>
            Dựa vào mã HTTP để xác định nguyên nhân và cách khắc phục.
          </DocGoal>
          <DocPrereq>
            Để biết thêm chi tiết về các mã lỗi, xem tab <ErrorsLink onSelectTab={onSelectTab} />.
          </DocPrereq>

          <div className="space-y-3 max-w-3xl">
            {[
              {
                code: '401',
                meaning: 'Thiếu, sai hoặc hết hạn JWT',
                fix: 'Gửi header Authorization: Bearer <JWT>. Lấy token mới tại POST /api/oauth/token bằng Client ID và Secret.',
              },
              {
                code: '403',
                meaning: 'JWT hợp lệ nhưng không có quyền truy cập',
                fix: 'Kiểm tra client có bị vô hiệu hóa không. Gán route cần thiết cho client (ACL). Xem lại vai trò Viewer/Operator/Admin trên dashboard.',
              },
              {
                code: '404',
                meaning: 'Không tìm thấy route khớp với đường dẫn',
                fix: 'Tạo route với đường dẫn đúng. Kiểm tra chính tả và prefix. Nếu vừa sửa cấu hình trong DB, hãy reload config.',
              },
              {
                code: '429',
                meaning: 'Vượt quá giới hạn tần suất',
                fix: 'Giảm tần suất gọi. Kiểm tra header Retry-After. Tăng hạn mức trên route hoặc client (Operator).',
              },
              {
                code: '502',
                meaning: 'Upstream trả về lỗi hoặc phản hồi không hợp lệ',
                fix: 'Xác minh Upstream URL trong route. Xem transaction log. Nếu đã bật queue, mở Proxy Queue để xem chi tiết.',
              },
              {
                code: '504',
                meaning: 'Upstream phản hồi quá chậm (timeout)',
                fix: 'Tăng giá trị Timeout trên route, hoặc tối ưu hiệu suất backend phía sau.',
              },
            ].map((row) => (
              <div
                key={row.code}
                className="flex flex-col sm:flex-row sm:items-start gap-3 p-3 rounded-lg bg-background/50 border border-border"
              >
                <span className="inline-flex min-w-[52px] justify-center rounded-md border border-red-500/20 bg-red-500/10 px-2 py-1 font-mono text-sm text-red-400 shrink-0">
                  {row.code}
                </span>
                <div className="min-w-0 space-y-1">
                  <p className="text-sm font-medium text-white">{row.meaning}</p>
                  <p className="text-sm text-slate-300 leading-relaxed">
                    <span className="text-muted-foreground">Cách khắc phục → </span>
                    {row.fix}
                  </p>
                </div>
              </div>
            ))}
          </div>

          <DocFooterNav
            prev={{ tab: 'integrations', label: 'Tích hợp' }}
            next={{ tab: 'examples', label: 'Curl mẫu' }}
            onSelect={onSelectTab}
          />
        </GuideShell>
      );

    default:
      return null;
  }
}
