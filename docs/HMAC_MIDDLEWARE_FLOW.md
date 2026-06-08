# Luồng HMAC — Data plane

**Không dùng JWT.** Client phải ký mỗi request.

## Header bắt buộc

| Header | Ý nghĩa |
|--------|---------|
| `X-API-Key` | Public key (`avaso_...`) |
| `X-Timestamp` | Unix giây (UTC) |
| `X-Signature` | HMAC-SHA256 hex |

## Payload ký

```text
{api_key}\n{timestamp}\n{METHOD}\n{path_with_query}\n{body}
```

`path_with_query` = path + `?query` nếu có.

## Luồng Gateway

```mermaid
sequenceDiagram
  participant C as Client
  participant G as Gateway
  participant DB as PostgreSQL
  participant U as Upstream

  C->>G: Request + Key + Timestamp + Signature
  G->>DB: Lookup key, decrypt secret
  G->>G: Verify HMAC + replay window
  alt Invalid
    G-->>C: 401 + transaction log
  else OK
    G->>G: Rate limit
    alt 429
      G-->>C: 429
    else OK
      G->>U: Proxy (transform/retry)
      U-->>G: Response
      G-->>C: Response + async transaction log
    end
  end
```

## Replay

Cùng `(key, timestamp, signature)` lặp lại trong cửa sổ → từ chối.

Test: `python3 scripts/test_hmac_replay.py`

## Demo UI

Trang **Proxy Try** (`/proxy-try`) — admin tự sinh chữ ký, gọi thử gateway.

## So sánh JWT (HĐ hay hỏi)

| | JWT | HMAC (đồ án) |
|---|-----|----------------|
| Secret trên wire | Bearer token | Không gửi secret |
| Đổi nội dung request | Token vẫn “hợp lệ” nếu không bind body | Chữ ký bind method/path/body |
| Phù hợp | User session API | Machine-to-machine, API key |
