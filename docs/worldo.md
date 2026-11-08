# NEAR setup for Worldo

Worldo has two separate modes. `CHAIN_SYNC_ENABLED=false` runs the complete game without NEAR credentials in a separate local save namespace. `CHAIN_SYNC_ENABLED=true` keeps the same immediate gameplay, then settles a durable outbox to the selected NEAR network in ordered batches. Local and fast-forward progress never converts into chain assets.

The current three-city contract must be deployed and verified separately from the former single-town game. Historical receipts from the old contract do not validate this implementation. The account panel and `GET /chain/status` report actual settlement state; no transaction link is shown without a confirmed transaction.

## Testnet deployment

`worldo-cities-aecd50.testnet` runs the optimized city-ledger contract: 400,058 bytes, SHA-256 `578385df23d735304aa239de750d4df43817b9e6c4bf4f98fa7e230b0ee025ef`, fixed supply 136,000 game coins. See the [atomic deployment and initialization](https://testnet.nearblocks.io/txns/2iJdmZfuaStiPmMahWWFxkhL698Ai9vCHGKcmc9WjhGg), a [sponsored owner grant](https://testnet.nearblocks.io/txns/GK8urtjaSsGeVXv8tZGjDf7FxeMxMxxz4oh7D5CkXNCF), a [real mayor trade](https://testnet.nearblocks.io/txns/HQAdGwzzDqSispjpsfLCTZ3PWS5sLnmdRAGMaYVD6mNe) and a [revocation](https://testnet.nearblocks.io/txns/3fiMFzvpgMFvyae1uwgpx9xGBKbWaupB18UBzvqq8g6V).

The source has been reformatted since deployment with no logic change, so a fresh build can differ from that hash. `scripts/verify-contract-wasm.ts` plays a full session against a compiled contract with no network and checks every balance against the game.

## Guest play

Set `GUEST_PLAY_ENABLED=true` on testnet to show **Play as guest**. Each guest gets a throwaway implicit account. The sponsor funds its storage, its key signs one bounded `authorize_game` grant, and the key is then discarded. The server keeps only the account name, tied to the browser session, so a guest can return to the same save. A few accounts are prepared in advance because a new one takes about 25 seconds. Guest play is refused on mainnet.

Social sign-in checks stop being required for settlement when guest play is on, so a world can run on a domain NEAR Auth has not approved yet. Set `NEAR_AUTH_MODE=off` on such a domain to hide the sign-in button, leaving only guest play.

## Settlement costs

Empty city updates are never queued. Neighbouring city updates merge into one plan when a batch is claimed. Batches holding only city bookkeeping go out at most every five minutes, and player actions go out in the next batch. The sponsor budget reserves 60 TGas per sponsored call and returns the unused part after the transaction, because a real batch burns about 23 TGas. If the contract refuses a batch, the batch is split to find the cause, and an action refused three times alone is skipped so one bad action cannot stop every player.

## Configuration groups

Use ignored `.env.testnet` and `.env.mainnet` files copied from the corresponding templates in `config/`. Network launch commands load only that complete profile; they do not silently inherit credentials from the other one. Never put secrets in `VITE_` variables.

| Settings | Purpose |
| --- | --- |
| `NEAR_NETWORK`, `ENABLE_TESTNET`, `ENABLE_MAINNET`, `CHAIN_SYNC_ENABLED` | Select the network and explicitly enable settlement. Keep the opposite network disabled. |
| `PUBLIC_URL` / `APP_ORIGIN` | The exact browser origin registered with the authentication provider. If both are set, they must match. |
| `NEAR_AUTH_MODE=social`, `NEAR_AUTH_CLIENT_ID` and optional issuer/audience/guard overrides | NEAR Auth sign-in and MPC signatures. Testnet network defaults are built in; mainnet needs the app's approved credentials. A client ID is public configuration, not a private key. |
| `NEAR_CONTRACT_ID` | A fresh deployed Worldo city-ledger contract account. |
| `NEAR_ORACLE_ACCOUNT_ID`, `NEAR_ORACLE_PRIVATE_KEY` | Dedicated simulation operator that signs authorizations and submits batches. |
| `NEAR_REFINERY_ACCOUNT`, `NEAR_MOTOR_ACCOUNT`, `NEAR_HARBOR_ACCOUNT` and each matching `_PRIVATE_KEY` | Three dedicated mayor accounts. Their keys approve every batch and must match initialization. NEAR AI does not create these accounts or hold their keys. |
| `NEAR_RELAYER_ACCOUNT_ID`, `NEAR_RELAYER_PRIVATE_KEY` | Dedicated funded sponsor for player onboarding, MPC signature requests and NEP-366 transaction gas. |
| `NEAR_RELAYER_SIGN_DEPOSIT_YOCTO`, `NEAR_RELAYER_DAILY_BUDGET_YOCTO` | Current signing-service deposit and the operator's explicit daily sponsorship ceiling. Use the provider's actual required deposit, not a guessed fee. |
| `DATABASE_URL` | Pooled Neon PostgreSQL URL with TLS. World state, outbox, authority grants and broadcast journals survive restarts. |
| `GUEST_PLAY_ENABLED` | Shows Play as guest on testnet. Mainnet ignores it. |
| `LOCAL_DATA_DIR`, `TESTNET_SINGLE_PROCESS=true` | Durable single-process filesystem storage when running testnet without Neon. A hosted deployment needs a persistent mounted volume. Mainnet requires Neon. |
| `NEAR_AI_API_KEY` | Server-side dialogue with the three mayors. AI cannot change balances, prices or grant resources. |
| `ELEVENLABS_API_KEY` and mayor voice IDs | Optional spoken replies. They are unrelated to wallet creation or chain settlement. Routine automated checks mock the provider. |

Create/fund testnet operator accounts through the [NEAR faucet](https://near-faucet.io/) or your NEAR account tools. Use dedicated accounts rather than a personal wallet or treasury key. Keep the contract deployment key outside the runtime environment and outside Git; it is needed for deploying code, not for ordinary game operation.

## Social login and network differences

NEAR testnet is a public blockchain, not a localhost-only chain. The [official NEAR Auth testnet page](https://docs.auth.near.org/resources/testnet) publishes shared development credentials and requires no production approval. The shared client still restricts callback origins. A custom domain such as `https://worldo.world` must be allowed by that client or by an app-specific client; changing an environment variable does not grant provider permission. Use the accepted loopback origin for a local demo if the public origin is not approved.

Mainnet uses a separate approved NEAR Auth application. Keep both profiles configured independently. The code selects network-specific RPC, Auth/MPC contracts, wrapped token and explorer; it verifies the RPC's actual chain ID before writes. Browser private-key wallets have been removed from the player flow.

Initial sign-in uses OIDC authorization code + PKCE with only the `openid` scope. The server binds a one-time state and nonce to the player's HttpOnly session, verifies the provider's RS256 ID token, issuer, client audience, nonce and freshness, and derives the same NEAR account from its verified subject. The callback returns to the configured origin itself, so the shared testnet client needs no additional callback path. Provider tokens are not returned to the game client. Pending attempts expire after five minutes. Sign-in stays in the same tab: the page goes to the provider, comes back to the origin, and the game carries on from the player's click.

This separation matters for hosted testnet compatibility: the [older Auth0 action](https://github.com/Peersyst/fast-auth/blob/b9c1fbc8861947893dfb53baa2d2c4d351e08f7d/packages/auth0/src/actions/authorize-app.action.js) accepts transaction and delegate payloads but rejects the newer `nep413` message parameter. That produces the reported “Signing audience requested without transaction payload” error. The [newer action](https://github.com/Peersyst/fast-auth/blob/ddab262122491fe3315d28195e719fb2151f1f37/packages/auth0/src/actions/authorize-app.action.js) adds message signing. Worldo no longer requires that feature for identity login. Only explicit game-asset approvals request the signing audience, with the exact delegate bytes still verified against the pending action and signed-in subject. Approvals also stay in the same tab, and the saved approval state must match on return. An expired transaction requires a fresh approval, never an automatic economic retry.

NEAR Intents is a separate, optional mainnet wallet-funding integration. It does not mint game coins. Its [official FAQ](https://docs.near-intents.org/resources/faqs) says there is no testnet deployment, so Worldo disables executable Intents requests on testnet. Do not describe a local or testnet demo as a completed cross-chain swap.

## Build and initialize the city contract

Build and test from `contracts/`:

```sh
rustup target add wasm32-unknown-unknown
cargo test --locked --lib
cargo build --locked --target wasm32-unknown-unknown --release
```

The Rust output is `contracts/target/wasm32-unknown-unknown/release/worldo_economy.wasm`. The container uses a digest-pinned Rust image and Binaryen `108-1` to optimize it before packaging `dist/contracts/worldo.wasm`. To match that optimization locally, run Binaryen 108 from `contracts/`:

```sh
wasm-opt -Oz --strip-debug --strip-producers --enable-bulk-memory --enable-sign-ext --enable-mutable-globals \
  target/wasm32-unknown-unknown/release/worldo_economy.wasm -o target/worldo.wasm
```

After configuring the contract, oracle and mayor accounts, print the public initialization manifest first:

```sh
node --env-file=.env.testnet --import tsx scripts/deploy-city-contract.ts
```

The manifest derives the opening inventories, 12,000 coins per city and 100,000-coin starter pool from the same shared configuration used by the game. It contains only account IDs and public keys. There are three mayors, not the old game's four merchants.

Once deployment is intended, use a fresh, funded contract account and a NEAR credential JSON file containing `account_id` and `private_key` (or `accountId` and `privateKey`):

```sh
node --env-file=.env.testnet --import tsx scripts/deploy-city-contract.ts --deploy --wasm contracts/target/worldo.wasm --key-file /private/path/worldo-contract.json
```

The script verifies the network, operator keys and empty contract state before writing. It refuses to overwrite an initialized account or unrelated code. It deploys and initializes atomically, then verifies the fixed coin supply and prints the real transaction hash. The contract also requires self-initialization, preventing a different account from taking ownership before setup. A rerun can finish initialization after code deployment was interrupted. Mainnet additionally requires the mainnet profile, explicit network enablement and `--confirm-mainnet`; none of these commands is part of normal game startup.

Keep settlement off until that deployment is verified, then set `CHAIN_SYNC_ENABLED=true`. Use a new world namespace for a new contract; do not import old single-town saves.

## What is on-chain

The contract records integer game `coin`, resource balances, unique equipment instances and station deeds. Harvested raw materials are validated in the game and minted when delivered to a city or used for station construction/upkeep. Petrol already belongs to its owner; stocking a station locks part of that balance into its tank. Offline driver sales spend only stocked petrol and pay from finite funded budgets.

The trusted simulation operator controls gameplay decisions. All three mayor keys are also operated by Worldo; their signatures are not independent consensus. Read [the contract trust boundary](../contracts/README.md) before treating these assets as externally tradable.

Direct NEP-245 wallet transfers are intentionally disabled while assets belong to the ordered game ledger. An immediately accepted game action can already have reserved the balance before the next chain batch. Free external transfers would race those reservations. This release has no export, peer-to-peer wallet trading or cash redemption. On-chain ownership does not imply unrestricted outside transfers.

## Consent, settlement and recovery

Players sign in socially and approve a bounded Worldo game-token grant. The default expires after 30 days and caps cumulative coin debits at 100,000. It cannot spend native NEAR or another application's tokens. Normal gameplay has no wallet popups and does not wait for settlement.

The Play button now starts that setup as one flow: its nearby explanation describes automatic in-game trades, and expandable permission details show the actual limit and exclusions. After social login the same tab goes on to any required approval, and entry happens only after the grant is confirmed. A player with a usable existing grant needs no new approval. If a step stops short, a visible Continue to play button starts it again from a fresh click. NEAR Auth's own approval screen may still identify the network; Worldo does not suppress consent or grant itself permission by default.

Cancellation before submission prevents relay. Once submission has started, a lost response or cancellation cannot prove the transaction was unsent: a non-secret pending marker survives reload, and the next explicit attempt checks the grant instead of resubmitting. A fresh approval is allowed only after definite non-submission, a confirmed failure, or a FINAL grant query beyond that delegate's maximum block height. Grant state and height come from the same query. Account, public key, network, contract, expiration and remaining allowance must match. The contract and its limits are unchanged by this onboarding update.

Revoking first freezes the exact grant epoch in the same durable compare-and-swap transaction used by game actions. An oracle-signed, owner-approved nonce cutoff lets already accepted actions finish while refusing new ones. Station tanks continue serving offline customers from previously allocated stock.

Each batch is immutable and ordered. Its exact signed transaction is journaled before broadcast. If a response is lost, the settler checks the same hash and can retransmit the identical envelope while valid. Once a FINAL block proves the delegate expired, it can sign a new envelope for the same immutable batch within the sponsorship budget. Prior attempt hashes are retained to find the real winning receipt; contract batch IDs and sequences prevent duplicate game effects. The latest 512 operation receipts and 128 batch receipts remain queryable; permanent nonces protect replay after older lookup entries are evicted. Failed or uncertain batches remain visible in `/chain/status` while immediate gameplay remains available.

## Verification before public use

`GET /api/near/readiness` checks configuration, persistent storage, provider callback eligibility, the deployed contract version/transfer boundary and operator accounts. It reports safe summaries rather than secret values. Read-only readiness is not proof of completed social sign-in or signing.

`authConfigured` describes the static social-login configuration, including the selected network and origin rules. Ordinary game config, identity, login status and challenge requests do not wait for full health probes. The actual login still verifies the provider token and the session challenge. Funded account operations retain their readiness and authorization checks. The optional funding panel explicitly requests `GET /api/near/status?readiness=1` for current operational status.

Complete an end-user social login, grant approval/cancellation, gameplay batch, reload, revoke and fresh-grant cycle on the intended origin. Confirm real receipts and balances against the contract. Test mainnet funding separately with explicitly authorized amounts after approval. Unit tests and the isolated simulation do not substitute for those external integration checks.
