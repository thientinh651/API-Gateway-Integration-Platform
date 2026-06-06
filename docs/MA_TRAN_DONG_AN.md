# Ma trận trace đồ án — chứng cứ sản phẩm

Dùng khi bảo vệ: **không thay WSO2**, chứng minh **đủ / vượt FR** trong SRS.

| Nhóm | ID | Yêu cầu | Chứng cứ (demo / artifact) |
|------|-----|---------|----------------------------|
| Gateway | FR proxy | Route → upstream | UI **Quản lý Route**; `GET /api/routes` |
| Gateway | FR auth | HMAC + API key | **Thử Proxy**; `scripts/test_hmac_replay.py` |
| Gateway | FR replay | Chống replay signature | Script replay → 401 |
| Gateway | RBAC | admin/operator/viewer | Login 2 role; operator không tạo route |
| Gateway | Audit | Hành động admin | Trang **Audit Logs** |
| Gateway | Transaction log | Data-plane log | Trang **Logs**; `gateway_transaction` journalctl |
| Gateway | RSA key | WSO2-style envelope | **Tạo key (RSA)**; `docs/WSO2_RSA_FLOW.md` |
| Gateway | DLQ | Queue lỗi upstream | Settings DLQ + **Proxy Queue**; `/v1/api/status/503` |
| NFR | NFR-12 | Không lộ plain key | Log `api_key_masked`; DB hash/encrypt |
| NFR | NFR-20 | ổn định / RAM | `scripts/nfr20-soak-test.sh`; `deploy/systemd/NFR20_STABILITY.md` |
| NFR | Metrics | Quan sát runtime | `GET /metrics` — counters JSON |
| NFR | Hiệu năng | Latency/RSS nhẹ | `scripts/benchmark-gateway.sh`; `docs/BENCHMARK.md` |
| Tích hợp | FR-I1–I2 | OAuth SF, token encrypt | **Tích hợp** → Connect; callback; DB `integrations` |
| Tích hợp | FR-I4 | OAuth Zoho | Connect Zoho; Test |
| Tích hợp | FR-I5–I6 | Sync snapshot | Nút Sync; **Tổng quan** chart |
| Tích hợp | FR-I7–I8 | UI trạng thái + KPI | Trang Tích hợp + Overview |
| Tích hợp | FR-I9 | Chỉ Admin cấu hình | Operator/Viewer → 403 `/api/integrations/*` |
| Quản trị | F-19 | Hồ sơ cá nhân | Trang **Tài khoản**, `PUT /api/me` |
| Tích hợp | FR-I10 | Audit integration | Audit: `integration.connect`, `integration.sync` |
| Data-plane SF/Zoho | — | `/v1/api/sf/*`, `/v1/api/zoho/*` | Client HMAC → CRM API qua gateway |
| Vận hành | — | Production | https://thientinh.io.vn; systemd; `docs/XU_LY_502_BAD_GATEWAY.md` |
| HA Docker | — | Active-Active 2 instance | `docker-compose.ha.yml`; `docs/DOCKER_HA_DEMO.md` |
| CI | — | Tự động hóa | `.github/workflows/ci.yml`; `cargo test`; `npm test` |

## Gom chứng cứ một lệnh

```bash
./scripts/collect-thesis-evidence.sh
# → data/thesis-evidence/<timestamp>/
```

## Điểm mạnh kỹ thuật (Rust — nói với hội đồng)

1. **Đủ FR gateway + integration** trên một binary async (Tokio/Axum).  
2. **Bảo mật có script** (HMAC, replay, RSA, encrypt token).  
3. **NFR có số liệu** (RSS soak, benchmark, `/metrics` counters).  
4. **Triển khai thật** + tài liệu vận hành (502, systemd).

## Giới hạn (nói thẳng)

- Single-node; session / replay / DLQ in-memory.  
- Không claim parity ecosystem WSO2 (portal, cluster, policy studio).
