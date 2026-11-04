FROM rust:bookworm AS contract
WORKDIR /contract
ENV CARGO_BUILD_JOBS=2 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0
RUN rustup target add wasm32-unknown-unknown
COPY contracts/ ./
RUN --mount=type=cache,target=/usr/local/cargo/registry --mount=type=cache,target=/contract/target \
    cargo test --locked --lib && cargo build --locked --target wasm32-unknown-unknown --release && \
    mkdir -p /contract/artifacts && cp /contract/target/wasm32-unknown-unknown/release/lowland_economy.wasm /contract/artifacts/lowland.wasm

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
COPY --from=contract /contract/artifacts/lowland.wasm ./dist/contracts/lowland.wasm
COPY --from=contract /contract/Cargo.lock ./dist/contracts/Cargo.lock
COPY --from=build /app/server ./server
COPY --from=build /app/shared ./shared
COPY --from=build /app/migrations ./migrations
COPY --from=build /app/scripts/start.mjs /app/scripts/container-start.mjs ./scripts/
RUN mkdir -p /data && chown node:node /data /app
EXPOSE 3000
CMD ["node","--import","tsx","scripts/container-start.mjs"]
