# syntax=docker/dockerfile:1.7

FROM node:24-alpine AS frontend-build

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
WORKDIR /build

RUN corepack enable && corepack prepare pnpm@11.17.0 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=cs-guess-pnpm,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store && \
    pnpm install --frozen-lockfile

COPY components.json index.html lingui.config.ts tsconfig.app.json tsconfig.json tsconfig.node.json vite.config.ts ./
COPY public ./public
COPY src ./src
ARG VITE_API_BASE_URL=
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
RUN pnpm build

FROM rust:1.97.1-bookworm AS server-build

WORKDIR /build

COPY rust-toolchain.toml ./
COPY server/Cargo.toml server/Cargo.lock ./server/
COPY server/src ./server/src
COPY server/migrations ./server/migrations
COPY server/vendor ./server/vendor
COPY src/data/players.generated.json src/data/countries.generated.json ./src/data/

RUN --mount=type=cache,id=cs-guess-cargo-registry,target=/usr/local/cargo/registry \
    --mount=type=cache,id=cs-guess-cargo-git,target=/usr/local/cargo/git \
    --mount=type=cache,id=cs-guess-cargo-target,target=/build/server/target \
    cargo build --locked --release --manifest-path server/Cargo.toml && \
    mkdir -p /out && \
    cp server/target/release/cs-guess-server /out/cs-guess-server

FROM debian:bookworm-slim AS runtime

RUN apt-get update && \
    apt-get install --yes --no-install-recommends ca-certificates curl tini && \
    rm -rf /var/lib/apt/lists/* && \
    groupadd --gid 10001 app && \
    useradd --uid 10001 --gid app --home-dir /app --shell /usr/sbin/nologin app && \
    mkdir -p /app/data && \
    chown -R app:app /app

WORKDIR /app

COPY --from=server-build --chown=app:app /out/cs-guess-server ./cs-guess-server
COPY --from=frontend-build --chown=app:app /build/dist ./dist

ENV CS_GUESS_BIND_ADDR=0.0.0.0:8080
ENV CS_GUESS_DATABASE_PATH=/app/data/cs-guess.sqlite
ENV CS_GUESS_STATIC_DIR=/app/dist
ENV RUST_LOG=cs_guess_server=info,tower_http=info

USER app
EXPOSE 8080
VOLUME ["/app/data"]
STOPSIGNAL SIGTERM

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD curl --fail --silent http://127.0.0.1:8080/health/ready > /dev/null || exit 1

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["/app/cs-guess-server"]
