# Worldo

A third-person game about supplying a small industrial town. Explore on foot, drive deliveries, find crude oil, mine iron ore, gather timber, and turn those resources into useful goods. Shops have finite stock and budgets; their offers change as players trade.

Built for NEAR Hackathon’s **Games With Real Economies** track. Desktop and portrait touch controls share the world. [Walkthrough](docs/demo.md) · [NEAR configuration](docs/near.md)

**[Worldo on Fly](https://worldo.world/)**. The submission release targets **NEAR testnet with social sign-in**. Testnet transactions use test NEAR with no monetary value; no real funds are required. Players use the normal account and game flow, without a public practice mode or disposable browser wallet.

**Sign-in is not yet verified on Fly.** A read-only authorization probe on 4 November 2026 found that the official shared testnet client accepts `http://localhost:3000`, but rejects `https://worldo.world`, the legacy Fly origin and `http://localhost:5173` with a callback mismatch. The hosted origin needs an allowed callback configuration. Issuer metadata is reachable, but neither that check nor the localhost probe proves a completed social login. Localhost on port 3000 is the supported route for the next sign-in verification.

## Testnet submission setup

Requires Node.js 24 and npm.

1. Copy `.env.example` to ignored `.env`. Set `APP_MODE=production`, `NEAR_NETWORK=testnet`, `NEAR_AUTH_MODE=social`, `ENABLE_TESTNET=true` and `ENABLE_MAINNET=false`. Production mode selects the player-facing experience; it does not imply mainnet.
2. Configure the deployed **testnet** game contract, four registered merchant accounts, and oracle and relayer accounts funded with test tokens. Configure the verified NEAR Auth signing deposit and a daily sponsorship budget. Social signing still uses the signing service; it is different from the historical browser test-wallet path.
3. Use NEAR Auth configuration approved for the exact app origin. The official shared testnet configuration supports the localhost callback described above; it does not authorize arbitrary hosted origins.
4. For the single-machine Fly testnet deployment, set `TESTNET_SINGLE_PROCESS=true` and `LOCAL_DATA_DIR` to the mounted persistent volume. Neon is optional for this testnet configuration. Supply a pooled TLS `DATABASE_URL` when using Neon; it is required for a future mainnet deployment.
5. Supply `NEAR_AI_API_KEY` for generated conversations and `ELEVENLABS_API_KEY` plus account voice IDs for speech when those services are ready. Their absence leaves shops usable and labels dialogue or voice unavailable.
6. Run `npm ci`, `npm test` and `npm run build`. For local social-login verification, use `PUBLIC_URL=http://localhost:3000` and run `npm run dev` or the built app with `npm start`. Open **localhost:3000**, not port 5173 or a different hostname.

On Fly, set `PUBLIC_URL=https://worldo.world` and register that exact origin with NEAR Auth before claiming hosted sign-in works. `APP_ORIGIN`, if set, must agree. Keep credentials on the server; never use a `VITE_` variable for secrets. Local HTTP is allowed only for loopback testnet development; hosted origins use HTTPS.

`/api/near/readiness` reports configuration and bounded storage, issuer and chain checks without secret values. Checks include the selected RPC network, contract views, merchant accounts, operator keys and funding; Neon checks perform a write/read/cleanup. Testnet may use the explicitly configured single-machine volume instead. Successful social login and signing require an actual user verification, including callback acceptance. `/api/health` is a service health check, not proof that account entry or transactions work.

Missing credentials produce an unavailable sign-in or service message. They never activate a fake transaction, canned AI answer or development wallet. Mainnet remains disabled for this submission.

## One codebase, two network profiles

The demo runs at **http://localhost:3000 against public NEAR testnet**. Localhost
is the shared social-login application's accepted callback, not a private
blockchain. Mainnet uses the same game and contract source with its own deployment.

- Copy `config/testnet.env.example` to ignored `.env.testnet`, supply the testnet
  accounts, and run `npm run build` then `npm run start:testnet`.
- Copy `config/mainnet.env.example` to ignored `.env.mainnet`. After mainnet Auth
  approval, configure its exact callback, deploy and initialize the game contract,
  fund the mainnet operators/merchants and supply a separate Neon database or
  branch. Verify the MPC signing deposit, then set `ENABLE_MAINNET=true` and run
  `npm run start:mainnet` on the approved HTTPS origin.

The profile launch commands read only the selected file and discard inherited
application settings, so a shell's old RPC, credentials or database cannot override
the profile. They require social login and the normal production game flow.
Restart to change profiles; no frontend rebuild is needed just for runtime network
configuration. `npm start` remains compatible with the existing generic `.env`.
Fly uses runtime secrets rather than these local files; see the
[activation instructions](docs/near.md#network-profiles-and-mainnet-activation).

Only empty templates are tracked. Private keys, API keys and database passwords
belong in ignored local files or Fly secrets. Auth client IDs are public application
identifiers, not secret keys; the official shared testnet ID is documented in code.
Mainnet cannot be called end-to-end verified until real approved login, signing and
settlement succeed. Intents remains mainnet-only and is not demonstrated as a
completed swap in the local testnet video.

Live saves and oracle journals are scoped to network, contract and account.
The contract-scoped format starts fresh local progress rather than importing
legacy saves whose original contract cannot be established. Legacy rows remain
untouched; on-chain balances, inventory and refinery ownership are reloaded.
Reconcile any legacy pending grants against their original contract before
migrating a live deployment. Keep one app instance: login sessions and sponsor
transaction locks are currently held in-process.

## The game

| Gather | Process into | Use |
| --- | --- | --- |
| Crude oil | Petrol | Refuel the pickup |
| Iron ore | Steel | Build a player refinery |
| Timber | Planks | Build a player refinery |

Processing uses two raw units per finished product. On the submission network, the contract charges **0.001 test NEAR per batch** at a business. The scanner is a free equipment loan; a player refinery costs **10 steel and 10 planks** and processes crude into petrol without a business fee.

Survey North Ridge, follow directional readings and find the hidden oil deposit. Surveying uses 3 energy; collecting uses 6 energy with a three-second cooldown. Each collection yields up to two units. Rest at the depot restores energy.

On-foot cargo holds 12 units; the pickup holds 40, including when parked within reach. Driving consumes fuel. One petrol can restores up to 25 fuel.

Selling transfers test NEAR from the merchant’s existing game balance to the player. Buying and processing transfer it back. Trades change stock, which changes subsequent offers; buying and selling have a spread. The price board shows **what the named merchant pays for one unit** and refreshes every 20 seconds while open. Its arrows compare with arrival prices. The release identifies the selected testnet network; these are game goods and test-token balances, not real commodity prices or earnings.

Conversation does not execute trades or create resources. The player reviews economic transactions before signing. The chain-backed game does not currently run the development world's daily autonomous NPC production cycle.

## The town and controls

Eight buildings have doors and interiors. Open a door, walk in and talk to the shopkeeper. The supply shop, refinery, sawmill and foundry have different staff and furnishings. The filling station has pumps and an attendant. Residents follow separate walking and working routines; sellers move their heads and hands while idle.

Buildings, furniture, trees, rocks, fences, parked vehicles and people have collision handling. The camera follows the character’s travel direction and adjusts around walls, ceilings and doorways. Drag to look around manually. The character turns to walk back; held movement retains its initial reference direction so camera following cannot steer it into a circle.

| Action | Desktop | Portrait touch |
| --- | --- | --- |
| Walk | W/A/S/D or arrows | Joystick |
| Drive / reverse | W/S or up/down | Joystick forward/back; throttle button |
| Steer | A/D or left/right | Joystick left/right |
| Run | Hold Shift | — |
| Look around | Drag the world | Drag the world |
| Doors / talk / interact | E | Interact button |
| Enter / leave pickup | F | Vehicle button |
| Material guides | 1 / 2 / 3 | Crude, ore and timber shortcuts |
| Map / all cargo | M / I | Minimap / backpack |
| Close panel | Escape | Close button |

Each material shortcut shows its gathering site, recipe, use and route. The backpack shows all cargo. Map markers set a route rather than teleporting. Panels pause movement.

## NPC conversations and voice

NEAR AI Cloud generates responses from each character’s role, current player state, inventory, merchant budget and quotes. Conversation history is server-owned. Chat cannot grant items, alter prices or move money.

Conversation context is kept in server memory only: the last six messages per
browser session, signed-in account and NPC. This lets residents understand
follow-up questions. Message text is not written to Neon, game-save files or the
blockchain. Neon/file usage records contain daily provider request/character
counts, not conversations. Context older than 30 minutes and speech replies older
than 10 minutes are removed on later chat/speech requests; these are reuse limits,
not a timed deletion guarantee. Server restart clears the caches; logout currently
does not explicitly erase them. The browser keeps displayed messages in component
memory and clears them when the dialogue closes or the page reloads.

NEAR AI's private inference guarantees apply to its TEE-hosted models. Worldo's
backend still receives the message and sends the relevant context over HTTPS; it
does not independently verify inference attestations or hide text from the game
server. Optional ElevenLabs speech sends the generated reply to that separate
provider. Do not describe the complete game chat flow as end-to-end private.

ElevenLabs voices the generated reply using a server-configured voice for each character, or the shared fallback voice ID. No microphone is used. Closing dialogue or starting another reply cancels previous audio; browsers that block autoplay show a Listen button. Device speech synthesis is not used.

Without a configured provider, the UI labels conversation or voice unavailable. Shops remain usable. Initial greetings are authored introductions, not claimed AI output.

Default daily provider caps are 100 responses and 10,000 speech characters. Explicit zero disables that provider. Durable usage reservations, per-session limits, bounded input and session-bound reply IDs constrain requests. Provider calls can incur charges. See .env.example for keys, model and voice configuration.

## NEAR, Intents and persistence

- **Game contract:** test NEAR balances and six resource inventories on NEAR testnet, with NEP-245 core multi-token operations. Optional extensions and limitations are listed in [docs/near.md](docs/near.md).
- **Social login:** NEAR Auth is the public account flow. Hosted callback configuration and an actual social-signing test are still required. Economic actions require signature approval; fully invisible blockchain interactions are not claimed.
- **NEAR Intents:** unavailable on testnet. The retained mainnet adapter supports 1Click funding from supported chains into the player's own wNEAR, followed by separately reviewed unwrap and game-deposit steps. It is not part of the playable testnet walkthrough, and no mainnet settlement is claimed.
- **Persistence:** the single-machine Fly testnet configuration uses its mounted volume for durable account-linked saves and operator journals. Keep `TESTNET_SINGLE_PROCESS=true` and do not scale this file-storage configuration to multiple machines. Neon support is implemented for shared durable records and future mainnet deployment; live Neon verification remains pending until credentials are supplied. Schema initialization is handled server-side; migrations are in `migrations/`.
- **Fly:** serves the built client and API on one origin. Runtime secrets belong in Fly secrets. The legacy `lowland-near` hosting identifier is retained; the game’s visible name is Worldo.

Harvest grants are validated by the gameplay server and reconciled with the contract. The oracle cannot mint NEAR. Pending resource transactions block further economic actions until confirmation. NPC purchasing budgets must be funded with test tokens; selling does not create new currency.

Mainnet remains a later operator setup: approved mainnet Auth configuration, deployed and funded mainnet accounts, verified Neon persistence and explicit mainnet enablement. Testnet balances and saved progress do not become real funds when that configuration changes.

## Validation

npm test runs application/API regressions; npm run build checks TypeScript and builds the client. The Dockerfile also runs the Rust contract suite and compiles WASM before packaging.

For isolated internal browser checks, `node scripts/preview.mjs` serves a development fixture on localhost:3000. It explicitly uses `APP_MODE=development` and separate `.local/e2e` saves. This fixture is not the public account flow. `npm run test:e2e` uses desktop and portrait emulation; practice scenarios require that isolated fixture, not the public social-login release.

The current application/API suite contains **200 tests**. The production TypeScript/client build passes. Network profile checks cover inherited credentials, mixed networks and deployment-scoped saves, including live NPC chat and speech. Camera entry/turn/exit and UI checks cover desktop and portrait layouts. A deliberately throttled 112-frame rendering check reproduced three cleared frames before the resize fix and zero afterward. The local testnet social-login popup was opened and inspected (email, Google and passkey options); no credentials were entered and a completed social login/signature is still unverified.

Earlier verification on 4 November 2026 covered six desktop/portrait practice scenarios and a real testnet sequence: registration, deposit, reload, quarry harvest, foundry processing and sale. It verified the 0.001 test NEAR fee, canonical inventory, conserved balances and sponsored signing. [Historical testnet receipts](docs/testnet-validation.json) preserve that evidence. That transaction test used a development browser wallet; it does not prove the current social-login flow or the latest camera behavior.

Provider mocks verify error handling and authorization, not real provider access. Hosted and local social login, live Neon, NEAR AI and ElevenLabs still need configured end-to-end checks before they can be described as verified. Intents settlement is a separate future mainnet check.

## Visuals and limits

Three.js renders procedural geometry, batched static meshes, bounded shadows and adaptive resolution. Barlow Condensed and IBM Plex Sans are bundled locally. Icons are Lucide; NEAR artwork attribution is in public/brand/README.md. The Worldo logo and generation provenance are in public/brand/.

This is a compact exploration and production game, not a multiplayer simulation. Browser viewport emulation does not establish frame rate on physical phones; real devices still need measurement.

## NEAR Auth application

Use the [official testnet configuration](https://docs.auth.near.org/resources/testnet) for the supported localhost verification. For hosted social login, request the exact Fly callback, logout and web origin configuration from [NEAR Auth](https://docs.auth.near.org/home/apply), using **Worldo** as the application name and stating that this submission runs on testnet. Describe player-owned resources and funded NPC trading; cross-chain funding is retained for a future mainnet release. Setting an origin in `.env` does not register it with the provider.

Account operations are checked separately from gameplay: an unavailable merchant or harvest oracle does not prevent an otherwise valid withdrawal. Auth, network, contract, durable storage, release and relayer checks still apply.
