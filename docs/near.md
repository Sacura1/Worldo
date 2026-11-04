# NEAR implementation and production setup

The default playable world is a practice economy. Its credits are not NEAR and its
inventory is not an on-chain balance. Enabling the live funding flow does not
convert practice progress into withdrawable money.

## Included integrations

- `server/intents.ts`: current 1Click supported-token discovery, exact-input
  quotes, decimal-safe amounts, origin-chain refunds, official SDK quote-signature
  verification, immutable recipient routing, durable quote records, session-scoped
  execution status. Dry quotes never return executable instructions from this app.
- `server/near.ts`: NEAR Auth mainnet sign-in, single-use NEP-413 login challenges,
  JWT issuer/audience/application verification, MPC-derived implicit accounts,
  contract/account reads and allowlisted user-approved contract calls.
- `server/relayer.ts`: optional local signing relayer. Keys stay server-side. It
  reserves its configured signing deposit plus gas estimated at twice the current
  RPC gas price against a durable Neon budget. Delegated calls separately reserve
  their one-yocto deposit and gas; player deposits never use sponsored funds.
- `contracts/`: Rust economy with NEP-245 core balances, transfers, batch transfers,
  transfer-call and bounded refund resolution, token queries and events. Optional
  approval, metadata and enumeration extensions are not implemented. Harvesting is
  restricted to a trusted gameplay oracle, has per-account daily caps and sequential
  nonces. Native NEAR deposits back spendable balances; trading conserves those
  balances. Failed withdrawals restore the account balance through a callback.

## Approved social login

1. Apply at <https://docs.auth.near.org/home/apply> for a **mainnet** NEAR Auth
   application. The [official FAQ](https://auth.near.org/) says approval provides
   the production Auth0 domain, client ID and audience. Submit the app name,
   description, expected volume, use case and contact. A new personal Auth0 tenant
   or the public testnet client ID does not by itself grant mainnet access.
2. Set `PUBLIC_URL` to the exact public origin, for example
   `https://YOUR-APP.fly.dev`. Register that exact value as the allowed callback
   URL, logout URL and web origin for the approved app. Popup callbacks use this
   origin, without a separate callback path. Production requires HTTPS. Register
   the local development origin separately if needed. `APP_ORIGIN` is an optional
   alias; if both variables are set, they must resolve to the same origin.
3. Set `NEAR_AUTH_CLIENT_ID`, `NEAR_AUTH_DOMAIN` and `NEAR_AUTH_AUDIENCE` from the
   approved configuration. **Audience here is the signing API audience**, called
   `signingAudience` in the official JavaScript provider; ask the NEAR Auth team to
   confirm it if the approval also lists a general API audience. Defaults are
   `login.auth.near.org` and `auth0.jwt.fast-auth.near`. `NEAR_AUTH_GUARD_ID`
   defaults to `jwt#https://<approved-domain>/`; set it only to the corresponding
   registered guard approved by the provider. The server derives the wallet using
   `{guard_id}#{verified JWT sub}` and uses the same guard to request signatures.
   When changing the domain, also update or remove any old explicit guard value.
4. These settings are public application configuration served by the trusted
   server; issuer, JWKS URL, audience and guard are never accepted from request
   bodies. The server validates RS256 signature, issuer, signing audience,
   application ID, token age, subject and the exact one-use challenge or delegate
   bytes. Signing keys and API credentials remain server-only.
5. Test sign-in with an enabled method. The server verifies the challenge, then
   asks `v1.signer` for the key derived through `fast-auth.near`. It never accepts
   a user-entered account as proof of ownership. Existing deployments must use
   their previously approved issuer/guard consistently to retain wallet identity.

The published JavaScript provider 1.4.1 predates the documented NEP-413 message
method. `src/lib/near-provider.ts` uses Auth0's public APIs and the official NEAR
provider's NEP-413 encoding and byte-array authorization parameters. Auth0
serializes those arrays as comma-separated URL values. Each requested signature
uses `getTokenWithPopup`, which performs popup authorization and retrieves the token
for that exact signing audience and `transaction:sign` scope. The adapter immediately
matches `fatxn` to the requested bytes and the current subject, then consumes the
token once. It does not call `getTokenSilently` to refresh or reuse a prior action.
The click handler opens its authorization window before asynchronous preparation,
so mobile browsers retain the user gesture required to allow the popup.
The server independently verifies the JWT; browser decoding is not verification.

Unit tests cover alternate trusted issuer configuration, callback consistency,
NEP-413 encoding, stale/wrong-subject tokens, failed popups and concurrent requests.
Production sign-in and a real delegated action still need an end-to-end test with
approved credentials; mocks do not establish provider approval or availability.

## Mainnet funding

Set `NEAR_CONTRACT_ID` to the deployed Lowland contract and `ENABLE_MAINNET=true`
only after deployment checks. `DATABASE_URL` is required for production executable
quotes. `NEAR_INTENTS_API_KEY` is optional, server-only partner authentication from
<https://partners.near-intents.org/>; unauthenticated requests have the platform's
published fee schedule.

1Click uses `nep141:wrap.near` (**wNEAR**) as the destination asset and
`recipientType: DESTINATION_CHAIN`. The recipient is the signed-in player's
server-derived NEAR account, never the app treasury. The quote includes minimum
output, fees, deadline, deposit address and any required memo. The user sends the
displayed asset on its exact source chain using their source wallet. The app does
not control that wallet. Status is fetched from 1Click by the server and checked
against the signed stored routing. A successful wallet-funding swap is not a game
purchase: the player explicitly unwraps wNEAR into native NEAR and then approves a
game-contract deposit. The UI displays these as separate confirmed operations.

Before executable funding instructions, `POST /api/near/prepare-wallet` creates the
verified implicit account if absent and registers its storage on `wrap.near`.
The local relayer reserves the cost against its daily budget; each identity gets
one provisioning attempt in the durable journal. Already-ready accounts need no
payment. Ambiguous interrupted provisioning is not automatically paid twice; the
operator must reconcile its receipt before resetting a journal entry. The account
seed is 0.01 NEAR, storage cost is queried from `wrap.near`, and both are bounded.
This is an operator-funded onboarding expense, not a player earnings faucet.

The integration currently offers supported EVM networks, NEAR, Solana and Bitcoin
from the upstream token list. Other 1Click chains are intentionally excluded until
their address and memo flows are implemented. Nothing here means every coin is
supported. Validate the complete route, unwrap and contract deposit with a small
explicit user-approved amount before launch; never credit a game balance based
only on a swap status.

## Signing relayer

There is no assumed public relayer URL. The local implementation calls the official
`fast-auth.near` signing contract. Configure these as **Fly secrets**, not Vite env:

- `NEAR_RELAYER_ACCOUNT_ID`: the funded operating account.
- `NEAR_RELAYER_PRIVATE_KEY`: its dedicated signing key; restrict permissions and
  keep only the intended operating budget in this account.
- `NEAR_RELAYER_SIGN_DEPOSIT_YOCTO`: the signing deposit required by the deployed
  NEAR Auth contract. There is deliberately no guessed default. The reference
  implementation makes this configurable.
- `NEAR_RELAYER_DAILY_BUDGET_YOCTO`: explicit maximum daily reservation, including
  attached signing deposit and the per-call gas allowance.
- `DATABASE_URL`: durable budget and quote records.

Alternatively point `NEAR_AUTH_RELAYER_URL` at an operator-controlled deployment of
the [official reference relayer](https://github.com/Peersyst/fast-auth/tree/main/apps/relayer),
including its `/relayer/fast-auth` base path. `NEAR_AUTH_RELAYER_TOKEN` is optional
authentication for that operator's gateway. The app calls its documented
`/sign-delegate-tx` route. External relayer budgets and access controls are the operator's
responsibility; the built-in database budget applies to the local implementation.

**NEP-366 makes the relayer pay both attached deposits and gas.** Therefore
registration and game deposits use ordinary player-signed transactions, never
sponsored delegate actions. Auth0 authorizes the exact encoded transaction; the
MPC signature is verified against the player's key and sent to NEAR RPC. The
player's native wallet pays the attached amount and network fee. The operator
pays only the separate NEAR Auth signing-service call.

Other allowlisted game operations and wNEAR unwrap use NEP-366 with exactly one
yoctoNEAR attached, paid by the sponsor together with network gas. A second check
at the sponsor broadcast boundary rejects deposits, registration, transfers,
unknown methods/receivers and any attached amount other than one yocto. Sponsor
budget reservations include both this attached amount and the wrapper's gas.
Gas reservations are conservative estimates at the current price; they do not
freeze future protocol prices. Native player deposits are never operator loans
and cannot be credited from the sponsor's balance.

The review fetches `POST /api/near/action-cost`. It states the verified account,
attached-payment payer, gas payer and a current network fee estimate (60 TGas call
plus a 5 TGas overhead allowance). This is not a fixed network price; unused gas
is refunded. Native signing requires a review no older than two minutes. The
server checks the estimate again before preparing and before broadcasting the
signed transaction, rejecting increases or an account change. The protocol still
determines the actual charged gas when executing the transaction.

The external reference relayer's `/sign-tx` endpoint obtains ordinary transaction
signatures; `/sign-delegate-tx` handles sponsored calls. All operations require
an explicit app review and Auth0 authorization. Fully silent routine gameplay
requires an additional bounded session design and is not claimed by this adapter.

The gameplay oracle uses `NEAR_ORACLE_ACCOUNT_ID` and
`NEAR_ORACLE_PRIVATE_KEY`, server-only. Set `NEAR_REFINERY_ACCOUNT`,
`NEAR_FOUNDRY_ACCOUNT`, `NEAR_SAWMILL_ACCOUNT`, and `NEAR_DEPOT_ACCOUNT` to the
registered merchant accounts. `server/game-chain.ts` reads canonical chain balances,
obtains exact merchant quotes and submits bounded harvest grants. The authoritative
game server must journal each account/nonce before granting, and reconcile final
chain state after errors; a timed-out transaction must not be retried with a new
nonce. Ordinary balance reads and accounting use finalized chain state.

## Contract build and deployment

```sh
rustup target add wasm32-unknown-unknown
cargo test --manifest-path contracts/Cargo.toml
cargo build --manifest-path contracts/Cargo.toml --target wasm32-unknown-unknown --release
```

The WASM artifact is `contracts/target/wasm32-unknown-unknown/release/lowland_economy.wasm`.
CI runs the same checks on Linux and uploads the artifact. Deployment must select
real owner, contract and oracle accounts; no example account is a deployment target.

Initialize `new({owner, oracle})` from the chosen owner account. The economy starts
paused. Register player/NPC accounts with their storage reserve, fund merchant
balances with real NEAR, register each merchant's business kind, verify balance
conservation and transaction receipts, then call `set_paused({paused:false})` from
the owner. In live mode, the operator must call `produce_stock` using each
merchant's own account to turn purchased raw stock into goods. No autonomous
mainnet merchant-production runner is included; autonomous cycles in the practice
world are a simulation. The oracle can issue bounded harvests, not print NEAR. Funding,
deployment and unpausing are separate explicit operating steps.

`sendNearAction` supports registration, deposit/withdrawal, trade, processing,
facility construction and owned refining. It is a transaction adapter; the game
server must reconcile finalized contract inventory and receipts with the live
world before offering real-money gameplay. Practice-world `/api/action` is not that
reconciliation layer and must never mint live inventory without verified oracle
state.

## Sources checked

- <https://docs.near-intents.org/api-reference/oneclick/request-a-swap-quote>
- <https://docs.near-intents.org/integration/distribution-channels/1click-api/verify-quote-signature>
- <https://auth.near.org/> (mainnet approval FAQ)
- <https://docs.auth.near.org/home/quickstart>
- <https://github.com/auth0/auth0-spa-js/blob/main/src/Auth0Client.ts>
- <https://docs.auth.near.org/protocol/concepts/relayer>
- <https://github.com/Peersyst/fast-auth/tree/main/packages/providers/javascript>
- <https://github.com/near/NEPs/blob/master/neps/nep-0245.md>
- <https://github.com/near/nearcore/blob/master/runtime/runtime/src/actions.rs> (delegate deposit payer)
- <https://github.com/near/NEPs/blob/master/neps/nep-0366.md>
- <https://github.com/Peersyst/fast-auth/blob/main/packages/sdks/browser/src/signers/signer.ts>
- <https://github.com/Peersyst/fast-auth/blob/main/apps/relayer/src/modules/relayer/relayer.controller.ts>
