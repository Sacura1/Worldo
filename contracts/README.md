# Worldo city ledger

The contract records the same three-city economy served by the game: a fixed supply of integer `coin`, resource balances, unique equipment instances and six station deeds. A station's stocked petrol is an allocation within its owner's petrol balance; offline sales can consume only that allocation. Native NEAR pays network and account costs and is not the game currency.

## Trust and transfer boundary

The simulation server is the trusted gameplay oracle. It validates movement, gathering, trades, construction and driver purchases. Each batch requires the configured oracle caller and signatures from all three mayor keys over the exact contract, network, sequence and batch hash. The mayor keys are controlled by the game operator; they are separate signing accounts, not independent validators.

Game assets remain in the ordered game ledger. The contract exposes NEP-245 balance, token, supply and event formats, but **direct wallet transfers are disabled**. A player may already have spent an asset in an accepted game action that is waiting for settlement. Allowing an external wallet transfer during that interval would create two conflicting owners or spend the same balance twice. This release has no external export, peer-to-peer wallet transfer or cash redemption feature. Player station ownership is recorded on-chain; it does not imply unrestricted external trading.

Any future export feature must first freeze that player's game activity, settle outstanding actions, and reconcile a deliberate exit transaction. Merely polling balances does not make unrestricted transfers safe.

## Player consent and revocation

NEAR Auth proves the player account. The player then approves one scoped `authorize_game` call, sponsored through NEP-366. The grant permits only Worldo game assets, with an expiry and cumulative coin-spending limit. It cannot move native NEAR or tokens held in other contracts. Gameplay does not store a browser private key or ask for a transaction popup on every trade.

Revocation first freezes the exact grant epoch in the durable game store using the same compare-and-swap boundary as player actions. The oracle signs the last accepted player nonce; the account owner signs `revoke_game`. Queued actions at or below that cutoff can still settle. New actions using that epoch are rejected, so revoking permission cannot invalidate everyone else's shared batch. A fresh approved grant uses a new epoch. Station sales from previously stocked tanks continue independently of login or grant expiry.

## Ordered, recoverable settlement

Gameplay commits immediately with a durable outbox. The settler sends an immutable batch approximately once a minute. The contract checks consecutive sequence numbers, unique operation IDs, player nonces, grant limits, permitted counterparties, integer amounts, finite coin supply and station allocations. Receipt lookups retain the latest 512 operations and 128 batches in bounded rings; older records remain in chain event history. Permanent player/tick nonces and the batch sequence prevent replay after lookup eviction. An uncertain broadcast is retained with its real transaction hash and queried before retrying. Within its validity window the same signed envelope may be retransmitted. After a verified FINAL block passes the delegate expiry, a new envelope may carry the same immutable batch, using another explicitly budgeted sponsorship fee. Prior hashes are retained so the actual winning transaction can be confirmed; batch IDs and sequences prevent duplicate game effects. The server never fabricates a receipt.

`CHAIN_SYNC_ENABLED=false` runs the complete local game in a separate save namespace without NEAR keys. Local play and the isolated fast-forward simulation do not produce blockchain receipts.

## Build and test

From this directory, with a current Rust toolchain and a working native linker:

```sh
rustup target add wasm32-unknown-unknown
cargo test --locked --lib
cargo build --locked --target wasm32-unknown-unknown --release
```

The Rust output is `target/wasm32-unknown-unknown/release/worldo_economy.wasm`. The container runs the tests and release build, then optimizes the same module with Binaryen 108 before packaging `dist/contracts/worldo.wasm`. Its Rust image is pinned by digest in `Dockerfile`, dependencies by `Cargo.lock`, and Debian's Binaryen package by version `108-1`.

To produce the corresponding optimized module locally, use Binaryen 108:

```sh
wasm-opt -Oz --strip-debug --strip-producers --enable-bulk-memory --enable-sign-ext --enable-mutable-globals \
  target/wasm32-unknown-unknown/release/worldo_economy.wasm -o target/worldo.wasm
```

Pass that optimized output explicitly to the deployment script with `--wasm contracts/target/worldo.wasm` when running it from the repository root. Different Rust/Binaryen versions may produce a different binary; use the pinned container build for matching artifacts.

Use a **fresh contract account** for this city-ledger version. The previous single-town contract has a different state layout and no migration method. Initialization must use the city accounts, mayor public keys, opening inventories and starter pool from the server's current configuration. Never initialize arbitrary balances and assume the game will reconcile them automatically.

`fixtures/signed-batch.json` contains public test vectors and signatures generated solely for unit tests; it contains no deployable account private keys.
