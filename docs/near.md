# NEAR implementation and network setup

The default playable world is a practice economy. Its credits are not NEAR and its
inventory is not an on-chain balance. Enabling the live funding flow does not
convert practice progress into withdrawable money.

## Playable testnet deployment

Testnet uses free test tokens with no monetary value. Set `NEAR_NETWORK=testnet`,
`ENABLE_TESTNET=true`, `ENABLE_MAINNET=false` and `NEAR_AUTH_MODE=testnet-wallet`.
Leave `NEAR_RPC_URL` and explicit Auth values blank to use network-derived defaults.
The server selects the official listed testnet RPC (https://test.rpc.fastnear.com), `wrap.testnet` and testnet explorer; live-world
records are isolated by network. The mainnet default is https://free.rpc.fastnear.com. These endpoints follow the
[current official provider list](https://docs.near.org/api/rpc/providers). Before
signing, broadcasting, activation or oracle writes, the server verifies the node’s
actual `status.chain_id` against the selected network, cached for 30 seconds.
`GET /api/near/network-status` exposes that check. Known opposite-network hosts
are rejected at configuration time; other providers must still pass the chain-ID
check. Never point a testnet deployment at a mainnet RPC.

1. Create and fund a **testnet-only** operator account through the
   [NEAR faucet](https://near-faucet.io/). Deploy the compiled contract to a testnet
   account; initialize its owner and oracle. Follow the contract initialization
   sequence below, registering and funding the four testnet merchant accounts.
2. Configure `NEAR_CONTRACT_ID`, `NEAR_ORACLE_ACCOUNT_ID`/`NEAR_ORACLE_PRIVATE_KEY`,
   the four `NEAR_*_ACCOUNT` merchant settings, and
   `NEAR_RELAYER_ACCOUNT_ID`/`NEAR_RELAYER_PRIVATE_KEY` with a funded testnet operator.
   Set an explicit `NEAR_RELAYER_DAILY_BUDGET_YOCTO`. Browser test wallets do not
   use MPC, so `NEAR_RELAYER_SIGN_DEPOSIT_YOCTO` is not required in this mode.
3. Keep `LOCAL_DATA_DIR` on the Fly volume. Without Neon, testnet uses a durable
   single-process operator journal for daily reservations and one-time activation.
   This deployment must stay on one app machine. Mainnet continues to require
   Neon for budget and executable-quote records. Testnet games also support Neon.
4. In the wallet panel, choose **Create test wallet**, then **Activate wallet**.
   The browser generates its own Ed25519 key and proves possession with a one-use,
   session-bound challenge. The server derives the implicit account from the key;
   it never accepts a claimed account as proof. The private key stays in this
   origin’s testnet-specific browser storage. Clearing browser data loses access;
   this is a disposable development wallet, not social login or a production wallet.
5. Activation supplies **1 test NEAR once**, plus wrapped-token storage, within
   the operator’s budget. Review registration (0.01 NEAR storage; the remainder
   becomes game balance), sign it in the browser, then enter the testnet world.
   Registration/deposits debit the player’s wallet and gas; one-yocto game calls
   are sponsored. The same receipt and finalized-inventory reconciliation apply.

The browser wallet is rejected outside testnet at login, preparation and relay.
The key is never sent to the game server. These accounts must never hold real funds.
**NEAR Intents has no testnet deployment**, according to its
[official FAQ](https://docs.near-intents.org/resources/faqs). Every Intents endpoint
returns unavailable on testnet, including dry quotes. Mainnet swaps cannot fund
testnet balances, and the testnet UI does not display real deposit instructions.

### Verified testnet browser flow

On 2026-11-04, desktop run `20261104-testnet-05` passed against the deployed
app and real NEAR testnet in 151.7 seconds. The browser created its own wallet,
activated it, signed a 0.05 test NEAR registration (0.01 storage + 0.04 game
balance), deposited another 0.01, and reloaded the same account. The resulting
game balance before resource work was exactly 0.05 test NEAR.

Using game controls, the player walked to Stonecut Quarry and harvested two ore
with a finalized oracle receipt and one nonce increment. The player opened the
foundry door from beside its swing, spoke to Rosa, and signed production of one
steel from two ore. The contract charged exactly `1000000000000000000000`
yoctoNEAR (0.001 NEAR), crediting the same amount to the merchant. The player then
sold that steel through a reviewed, browser-signed transaction. Finalized chain
and server inventories agreed at each step; the merchant received one steel,
and combined player/merchant balances were conserved. The player's native wallet
balance stayed unchanged during the two sponsored gameplay calls.

The same run held actual backend quote responses during the switch from practice
to testnet: the NEAR price panel showed dashes while responses were pending, then
displayed the prices from those unmodified responses. It checked the RPC’s actual
chain ID before transactions and used no Auth0 popup, fabricated balances,
API action shortcuts or server-held player key.

Public receipts: [harvest](https://testnet.nearblocks.io/txns/C777WkjGP7w4HD576q8Pm1svMUntfTqpjkB3QpA93SoK),
[processing](https://testnet.nearblocks.io/txns/73EE58YXfQ755FhEDajJtfDCoB8jRQMP6k5hNcAxR3mJ),
[steel sale](https://testnet.nearblocks.io/txns/9VfuHxesKa9Wpp5z1jHKWB9462asdxyRmQz2Fm9wSCei).
Registration, deposit and exact checks are recorded in
[testnet-validation.json](testnet-validation.json).

The remote run exited 0: one desktop scenario passed, portrait transaction
execution was intentionally skipped, and no errors or flakes were reported.
This does not validate mainnet Auth approval, an Intents settlement or a live
Neon deployment; those remain separate integrations.

### Optional official testnet social login

The [official testnet guide](https://docs.auth.near.org/resources/testnet) publishes
client `np8paqIpMWmNbzT4xAvOOapZBjsOpptl`, domain `login.testnet.fast-auth.com`,
signing audience `auth0.jwt.fast-auth.testnet`, Auth contract `fast-auth.testnet`
and MPC contract `v1.signer-prod.testnet`. Set `NEAR_AUTH_MODE=social` to use it.
A read-only authorization probe accepted the callback `http://localhost:3000`
but rejected `https://lowland-near.fly.dev` and `http://localhost:5173` with a
callback mismatch. That probe does not establish a completed login. A deployed
social-login app needs its own approved callback configuration; the public client
is not a bypass for arbitrary origins. This is why the deployed testnet preview
uses browser-owned test wallets.

## Residents and optional NEAR AI

`POST /api/npc/chat` accepts `{npcId,message,mode,history?}` and returns
`{text,suggestions,source:'local'|'near-ai'}`. Morgan runs the supply shop, Hale
the refinery, Imani the sawmill, Rosa the foundry, and Theo the filling station.
Players must be on foot, within 3.2 metres and visible across the shared town
geometry. Authored replies use server inventory, current stock, finite merchant
budgets and exact game quotes; conversation cannot execute economic actions.

To enable optional model dialogue, create a server API key at
[NEAR AI Cloud](https://cloud.near.ai/) and set `NEAR_AI_API_KEY`. The adapter uses
the official `https://cloud-api.near.ai/v1/chat/completions` endpoint and
`NEAR_AI_MODEL` (default `zai-org/GLM-5.1-FP8` from its
[quickstart](https://docs.near.ai/cloud/quickstart)). No key or failed provider
request falls back to authored replies, labelled `local`. Browser speech is
text-to-speech, not a claim that the local fallback runs an AI model. No model
receives a transaction tool, private key or authority to set prices.

## Included integrations

- `server/intents.ts`: current 1Click supported-token discovery, exact-input
  quotes, decimal-safe amounts, origin-chain refunds, official SDK quote-signature
  verification, immutable recipient routing, durable quote records, session-scoped
  execution status. Dry quotes never return executable instructions from this app.
- `server/near.ts`: network-configured NEAR Auth sign-in and testnet-only browser wallets, single-use NEP-413 login challenges,
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
an explicit app review and a player signature. Social mode uses Auth0 authorization;
testnet-wallet mode signs locally with its test-only browser key. Fully silent routine gameplay
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
balances with native NEAR on the selected network, register each merchant's business kind, verify balance
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
