# syntax=docker/dockerfile:1

FROM rust:1-bookworm AS rust-build
WORKDIR /app
COPY Cargo.toml Cargo.lock ./
COPY migrations ./migrations
COPY src ./src
RUN cargo build --release

FROM node:20-bookworm AS web-build
WORKDIR /app/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM debian:bookworm-slim AS runtime
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=rust-build /app/target/release/avaso-gateway /app/avaso-gateway
COPY --from=web-build /app/web/dist /app/web/dist
COPY config.yaml /app/config.yaml
COPY migrations /app/migrations
ENV DATABASE_URL=sqlite:data/gateway.db \
    PORT=3000 \
    BIND_HOST=0.0.0.0 \
    COOKIE_SECURE=false
EXPOSE 3000
VOLUME ["/app/data"]
CMD ["/app/avaso-gateway"]
