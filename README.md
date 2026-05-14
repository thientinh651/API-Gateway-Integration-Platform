# avaso-gateway

Simplified middleware / API Gateway (inspired by WSO2). Rust + Axum + Tokio. Single-node demo.

## MVP scope (this project)
- **API Gateway (HTTP server)**
- **Routing config**
- **API key auth**
- **Rate limiting**
- **Logging**
- Optional (if time): **request transform**, **retry**, **queue**

## What it does
- **Reverse proxy / routing**: map `/<path_prefix>/*` -> upstream `target`
- **Config-driven**: routes from `config.yaml`
- **Dashboard (static)**: served from `web/` at `/`
- **Health**: `GET /health`
- **Protected internal API (demo)**: `/api/*` requires header `x-api-key` (value currently hardcoded in code; do not use in production)

Status note:
- Routing + config + basic API-key check: **implemented**
- Rate limiting + structured logging: **planned** (see Roadmap)

## Architecture (quick)
- **Data plane**: public traffic, route-match then proxy
- **Admin/internal plane (minimal today)**: `/api/routes` (list configured routes), `/api/proxy` (demo handler)

## Quickstart (local)
Prereq: Rust toolchain.

```bash
cargo run
```

Open:
- `http://127.0.0.1:3000/` (dashboard)
- `http://127.0.0.1:3000/health`

Test proxy via config default (`/test/*` -> `https://httpbin.org`):

```bash
curl -i "http://127.0.0.1:3000/test/get"
```

List routes (requires `x-api-key` header):

```bash
curl -i -H 'x-api-key: <your_demo_key>' "http://127.0.0.1:3000/api/routes"
```

## Configuration (`config.yaml`)

Example:

```yaml
routes:
  - path: "/test"
    target: "https://httpbin.org"
  - path: "/my-api"
    target: "http://localhost:5000"
```

Match rule:
- **Longest prefix wins**. `path == route.path` or `path starts_with route.path + "/"`.
- Query string preserved.
- Request method preserved.
- Most headers forwarded (skips `Host`, `Content-Length`).

## Endpoints
- **Public**
  - `GET /health`
  - `/<configured_route>/*` (proxy)
  - `/` and other paths (static files from `web/` when no route match)
- **Internal (demo, protected by `x-api-key`)**
  - `GET /api/routes`
  - `GET /api/proxy` (demo call to jsonplaceholder)

## Deploy (Ubuntu + Nginx + TLS)
Repo includes Nginx + Let's Encrypt notes in [`deploy/nginx/README.md`](deploy/nginx/README.md).

Important:
- App currently binds **localhost `127.0.0.1:3000`**.
- Example Nginx vhost uses upstream `127.0.0.1:8080` in [`deploy/nginx/thientinh.io.vn.conf`](deploy/nginx/thientinh.io.vn.conf). Change to `3000` (or change app bind) to match.
- For public repo, treat domain as **placeholder**; use your own domain + cert paths.

## Security notes (public repo)
- `x-api-key` check is **demo-only** (hardcoded in `src/main.rs`). Production needs:
  - secret from env/DB/Vault, rotation, per-key scopes
  - authn + authz policy (RBAC/ABAC) for admin plane
  - audit log
- Bind localhost + Nginx reverse proxy is intentional perimeter for demo.

## Roadmap (thesis/scale topics)
MVP + extensions:
- **Rate limiting**: token bucket/leaky bucket per key/IP
- **Logging**: structured request/response logs + request id
- Optional extensions:
  - **Request/response transform**: headers/body mapping per route
  - **Retry**: idempotent-safe retry policy
  - **Queue**: async buffering for burst traffic / downstream outage

## License
TBD.

