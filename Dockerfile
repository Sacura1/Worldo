FROM rust:bookworm@sha256:7085845219c18e7c5b1f34ed9ce89b84f822f2e3d54a02774cedc996ac0f304f AS contract
WORKDIR /contract
ENV CARGO_BUILD_JOBS=2 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0
RUN rustup target add wasm32-unknown-unknown
COPY contracts/ ./
RUN --mount=type=cache,target=/usr/local/cargo/registry --mount=type=cache,target=/contract/target \
    cargo test --locked --lib && cargo build --locked --target wasm32-unknown-unknown --release && \
    mkdir -p /contract/artifacts && cp /contract/target/wasm32-unknown-unknown/release/worldo_economy.wasm /contract/artifacts/worldo.wasm
RUN apt-get update -qq && apt-get install -y --no-install-recommends binaryen=108-1 && \
    wasm-opt -Oz --strip-debug --strip-producers --enable-bulk-memory --enable-sign-ext --enable-mutable-globals \
      /contract/artifacts/worldo.wasm -o /contract/artifacts/worldo-optimized.wasm && \
    cp /contract/artifacts/worldo-optimized.wasm /contract/artifacts/worldo.wasm && \
    sha256sum /contract/artifacts/worldo.wasm && rm -rf /var/lib/apt/lists/*

FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm test -- --maxWorkers 2 && npm run build

FROM node:24-bookworm-slim
ENV NODE_ENV=production PORT=3000
WORKDIR /app
COPY --from=build /app/package.json /app/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=contract /contract/artifacts/worldo.wasm ./dist/contracts/worldo.wasm
COPY --from=contract /contract/Cargo.lock ./dist/contracts/Cargo.lock
COPY --from=build /app/server ./server
COPY --from=build /app/shared ./shared
COPY --from=build /app/scripts/start.mjs /app/scripts/container-start.mjs ./scripts/
RUN mkdir -p /data && chown node:node /data /app
EXPOSE 3000
CMD ["node","--import","tsx","scripts/container-start.mjs"]
