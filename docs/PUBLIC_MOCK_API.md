# Public Mock API

Endpoint public để người dùng thử nghiệm gateway qua domain thật, không cần API bên ngoài và không cần tạo route trên Dashboard.

## Mục đích

- Demo sản phẩm nhanh qua URL công khai
- Thử parser, timeout, xử lý lỗi, response rỗng
- Dùng cho tài liệu hướng dẫn / demotest

## Đường dẫn công khai

Base domain: `https://thientinh.io.vn`

Hai prefix tương đương (cùng handler):

### A) Short public (khuyến nghị docs)

- `GET /testAPI/get` → `200` JSON có dữ liệu
- `GET /testAPI/empty` → `200` + `result: []`
- `GET /testAPI/invalid` → `200` JSON sai shape
- `GET /testAPI/unauthorized` → `401`
- `GET /testAPI/not-found` → `404`
- `GET /testAPI/server-error` → `500`
- `GET /testAPI/delay` → mặc định `200` sau ~3000ms

### B) Alias dưới `/api` (dùng trong TC demotest)

- `GET /api/testAPI/get`
- `GET /api/testAPI/empty`
- `GET /api/testAPI/invalid`
- `GET /api/testAPI/unauthorized`
- `GET /api/testAPI/not-found`
- `GET /api/testAPI/server-error`
- `GET /api/testAPI/delay`

### C) Alias nội bộ report

- `GET /api/mock/report/success` (= get)
- `GET /api/mock/report/empty`
- `GET /api/mock/report/invalid`
- `GET /api/mock/report/unauthorized`
- `GET /api/mock/report/not-found`
- `GET /api/mock/report/server-error`
- `GET /api/mock/report/delay`

## Delay

Query:

- `ms`: mili giây delay, mặc định `3000`, tối đa `30000`
- `code`: HTTP status trả về, mặc định `200`

```bash
curl -i "https://thientinh.io.vn/api/testAPI/delay?ms=5000"
curl -i "https://thientinh.io.vn/api/testAPI/delay?ms=5000&code=504"
```

## Ví dụ smoke

```bash
curl -i https://thientinh.io.vn/api/testAPI/get
curl -i https://thientinh.io.vn/api/testAPI/empty
curl -i https://thientinh.io.vn/testAPI/empty
curl -i https://thientinh.io.vn/api/testAPI/invalid
curl -i https://thientinh.io.vn/api/testAPI/unauthorized
curl -i https://thientinh.io.vn/api/testAPI/not-found
curl -i https://thientinh.io.vn/api/testAPI/server-error
```

Kỳ vọng `empty`:

```json
{
  "status": "success",
  "message": "No report data",
  "result": [],
  "meta": {
    "source": "mock-api",
    "count": 0
  }
}
```

## Lưu ý vận hành

- Không cần JWT / X-API-Key
- Không cần tạo route Dashboard / upstream
- Không có logging nghiệp vụ riêng cho mock
- Sau khi sửa `src/mock_api.rs` phải `cargo build --release` + restart `avaso-gateway`
- Nếu thấy `Admin API is mounted at /api/*` → binary đang chạy chưa có mock (cần redeploy)
