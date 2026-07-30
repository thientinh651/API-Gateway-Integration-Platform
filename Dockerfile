# syntax=docker/dockerfile:1
# Multi-stage — image runtime ~40–80MB (Alpine + binary + web/dist)

FROM rust:1-alpine AS rust-build
RUN apk add --no-cache musl-dev openssl-dev openssl-libs-static pkgconf build-base
WORKDIR /app
COPY Cargo.toml Cargo.lock ./
COPY migrations ./migrations
COPY src ./src
RUN cargo build --release

FROM node:20-alpine AS web-build
WORKDIR /app/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM alpine:3.19 AS runtime
RUN apk add --no-cache ca-certificates
WORKDIR /app
COPY --from=rust-build /app/target/release/avaso-gateway /app/avaso-gateway
COPY --from=web-build /app/web/dist /app/web/dist
COPY config.yaml /app/config.yaml
COPY migrations /app/migrations
ENV DATABASE_URL=postgres://avaso:avaso@postgres:5432/avaso_gateway \
    REDIS_URL=redis://redis:6379 \
    PG_POOL_MAX=5 \
    PORT=3000 \
    BIND_HOST=0.0.0.0 \
    COOKIE_SECURE=false \
    INSTANCE_NAME=gateway
EXPOSE 3000
CMD ["/app/avaso-gateway"]
