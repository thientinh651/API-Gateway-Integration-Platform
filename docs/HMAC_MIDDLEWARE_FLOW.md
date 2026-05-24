# Luồng HMAC tại Gateway (giải trình hội đồng)

```mermaid
sequenceDiagram
    participant C as Client
    participant G as Gateway Axum
    participant DB as SQLite
    participant U as Upstream

    C->>G: HTTPS + X-API-Key + X-Timestamp + X-Signature + body
    G->>G: B1 Thiếu header? → 401
    G->>G: B2 |now - ts| > 300s? → 401
    G->>G: B3 Signature đã có trong replay cache? → 401 replay
    G->>DB: B4 Lookup api_key
    alt Legacy key
        G->>G: SHA-256(X-API-Key) vs DB
    else HMAC key
        G->>G: AES-GCM decrypt secret (CLIENT_KEY_MASTER_KEY)
        G->>G: B5 HMAC-SHA256(secret, canonical payload)
        G->>G: B6 constant-time compare vs X-Signature
        G->>G: Ghi signature vào replay cache (TTL 300s)
    end
    G->>G: B7 route.tenant_id == key.tenant_id? → else 403
    G->>U: Forward request
    U-->>G: Response
    G-->>C: Response
```

**Canonical payload:**

```
{api_key}\n{timestamp}\n{METHOD}\n{path?query}\n{body}
```

`METHOD` = GET, POST, … (uppercase). `path?query` = raw URI path + query. Body empty → dòng cuối rỗng.
