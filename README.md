# Worldo

A third-person exploration and production game set in the **Lowland valley**. Search for resources, carry or drive them to local businesses, refine useful goods, and trade against finite inventories and budgets.

Built for NEAR Hackathon’s **Games With Real Economies** track. Desktop and portrait touch controls share the same playable world. [Demo walkthrough](docs/demo.md) · [NEAR setup and limitations](docs/near.md)

**[Play the practice preview](https://lowland-near.fly.dev/)** — deployed on Fly with persistent local saves. Mainnet is disabled pending production setup.

## Run the game

Requires Node.js 24 and npm. No credentials are needed for practice mode.

```sh
npm ci
npm run dev
```

Open **http://localhost:3000** and choose **Enter Worldo**. Optional local settings go in an ignored `.env` copied from `.env.example`; the development script loads it automatically.

Practice progress saves on the server in `.local/games`, associated with an anonymous HttpOnly session cookie. Reloading retains that world. Clearing the cookie or using another browser profile starts another player. Settings includes a practice reset. Practice credits have no cash value.

## The playable loop

- **Every 30 seconds:** navigate, take a scanner reading, gather a load, or review a business’s offer.
- **Every five minutes:** choose a supply route, manage energy, fuel and cargo, and decide whether to sell raw material or pay to process it.
- **Across a session:** obtain construction materials, build a facility, and respond to changes in stock and demand.

| Resource | Product | Use |
| --- | --- | --- |
| Crude oil | Petrol | Refuel the pickup |
| Iron ore | Steel | Construct a player facility |
| Timber | Planks | Construct a player facility |

Processing consumes **two raw units per finished product**. In practice, business fees are 2 credits for petrol or steel, and 1 credit for planks. A player workshop costs 4 steel, 6 planks and 60 credits, then processes all three recipes without service fees. These practice values are separate from mainnet rules.

The scanner costs 12 practice credits. North Ridge is a search region: the deposit location stays private until successive directional readings bring the player close enough to discover it. Surveying uses 3 energy; collection uses 6 energy and has a three-second cooldown. Each collection yields up to two units, subject to remaining resources and cargo space. Rest at the depot restores energy.

The pickup holds 40 units; on foot the limit is 12, increasing to 40 while working within reach of the parked pickup. Driving consumes fuel. Refuelling consumes one petrol can and restores up to 25 fuel.

NPC businesses follow explicit rules, not an LLM. Selling transfers a business’s existing budget to the player. Buying and processing fees transfer money back. Stock changes the price of successive units; a spread separates purchase and resale prices. Practice mode’s **Next working day** advances production, inter-business purchases, consumption and partial resource replenishment. It does not create credits. Rules are in `shared/economy-rules.ts` and `server/economy.ts`.

## Controls

| Action | Desktop | Portrait touch |
| --- | --- | --- |
| Walk / drive | W/S or up/down | Joystick forward/back; hold ↑ to accelerate while steering |
| Turn / steer | A/D or left/right | Joystick left/right |
| Run | Hold Shift while walking | Not exposed as a separate control |
| Look | Drag the world | Drag the world |
| Interact | E | Interact button |
| Enter / leave pickup | F | Vehicle button |
| Map / inventory | M / I | Minimap / backpack |
| Close a panel | Escape or close button | Close button |

Map markers set a destination; they do not teleport the player. Panels pause movement. [Follow the complete resource-to-sale walkthrough](docs/demo.md).

## Practice and mainnet are separate

| System | Implementation and current verification boundary |
| --- | --- |
| Practice game | Playable world, server-validated actions, production, finite merchant budgets, construction and saved progress. Each guest has an independent practice town. |
| NEAR gameplay | Separate authenticated account state, live contract inventory/quotes, transaction review, signing and receipt display. Hidden until the required production services are configured. No real mainnet gameplay transaction has been validated as part of the current build. |
| NEAR Intents | Supported-token discovery, signed 1Click quotes, deposit instructions and status checking. Funding arrives as **wNEAR** in the player’s wallet; explicit unwrapping and a game-contract deposit are separate steps. Public token discovery and a signature-verified dry quote were checked against the deployed service on 4 November 2026. No deposit address was returned and no funds were sent; settlement remains unverified. |
| Neon | Postgres persistence and revision-checked updates are implemented. A live Neon database has not been verified for this build. |
| Fly | Deployed at `https://lowland-near.fly.dev/`. The public health check confirms the practice server and local persistent storage. |

Mainnet uses actual NEAR-backed game balances, not converted practice credits. The UI shows contract prices to six decimal places and preserves exact integer amounts in transaction review. Its scanner is a free equipment loan; business processing costs 0.001 NEAR per batch. Its player refinery consumes 10 steel and 10 planks, and processes crude oil only. Practice reset and time fast-forward are unavailable in the mainnet world.

The contract implements NEP-245 core multi-token operations; optional extensions and production integration requirements are described in [docs/near.md](docs/near.md). Harvest grants are authorized by the gameplay server and reconciled with chain state. The oracle cannot create NEAR. A pending resource transaction blocks further economic work until checked; the UI provides **Check transaction**.

There are no guaranteed earnings, automatic token rewards or claims of real commodity backing. Mainnet NPC budgets require real funding. Current sign-in and economic signatures require user approval; completely invisible blockchain interactions are not claimed.

## Persistence and deployment

`DATABASE_URL` selects the Neon adapter. It stores game snapshots using revision checks; executable mainnet flows also require durable identity, funding and oracle records. SQL definitions are in `migrations/`. Without a database, atomic local files support development and a single-machine practice preview. `LOCAL_DATA_DIR` controls their location.

Fly serves the built client and API on one origin. The supplied configuration mounts persistent preview storage and leaves `ENABLE_MAINNET=false`. Use Neon before running multiple application machines. Store runtime secrets through Fly’s secret manager, never in browser configuration or Git.

`npm start` serves the production build and requires a valid production HTTPS `PUBLIC_URL`. For a local production-build preview, use `node scripts/preview.mjs`; this deliberately runs a practice-only QA server with separate `.local/e2e` saves. Mainnet configuration and deployment steps are in [docs/near.md](docs/near.md).

## Verify

```sh
npm test
npm run build
npm run test:e2e
```

**Build before browser tests. Stop any other server on port 3000 first** so Playwright starts the QA server for the current `dist/` build. Tests use installed Microsoft Edge on local Windows and bundled Chromium elsewhere (install it with `npx playwright install chromium`), one worker, a 1440×900 desktop viewport and a 390×844 touch viewport. Set `E2E_BASE_URL` to test a deployed practice preview instead of launching a local server. CI installs Chromium before running browser checks.

Unit/API tests cover economic conservation, movement limits, private prospecting, resource caps, concurrency, session isolation, origin checks, mainnet reconciliation and authorization boundaries. Browser tests exercise desktop scouting/extraction/processing/selling, portrait touch movement/trading, and pickup driving and parking on both layouts. Provider and chain mocks test application behavior; they do not establish production access or complete a real swap.

On **4 November 2026**, remote Chromium verification against the deployed practice preview recorded **four successful browser scenarios** across the resource-loop run and a focused transport run. The resource-loop run had two intentional platform skips; the final transport run passed both layouts with no skips or flaky results:

- **Desktop, 1440×900:** keyboard movement, scanner purchase, following directional readings to discover a hidden deposit, oil extraction, processing, selling the resulting petrol, and persistence after reload. Completed in 220.5 seconds.
- **Portrait, 390×844:** touch-joystick movement, depot interaction, scanner purchase, and a check for horizontal page overflow. Completed in 12.4 seconds.
- **Pickup transport, desktop and portrait:** enter through real keyboard/touch controls, accelerate, steer, stop, exit safely, reload, and re-board with parking position, heading and fuel preserved. Portrait also checks simultaneous steering/throttle, releasing the joystick while continuing to accelerate, and notifications leaving the accelerator touchable. Completed in 51.9 and 34.6 seconds respectively.

The scenarios select the shipped battery-saver graphics mode. These are functional browser checks using an emulated viewport and a software GPU, not a measurement of frame rate on physical phones.

To repeat browser checks against the public practice preview, set `E2E_BASE_URL=https://lowland-near.fly.dev` before running `npm run test:e2e`. No local API server is launched when that variable is set. To run the same checks on a remote Fly builder:

```sh
mkdir -p .local
fly deploy --config fly.e2e.toml --remote-only --build-only \
  --build-arg E2E_BASE_URL=https://lowland-near.fly.dev \
  --build-arg QA_RUN_ID=your-unique-run-id > .local/qa-build.log 2>&1
```

This builds a separate QA image and does not deploy it as the game. Add `--build-arg E2E_SCOPE=transport` to run only pickup transport checks. Change `QA_RUN_ID` for each run so Docker does not reuse a previous test result. The build exits with the actual test status. Its captured log contains a `WORLDO_QA_REPORT` JSON summary and bounded, chunked screenshot artifacts; `scripts/export-qa.mjs` defines the artifact format. Use a Fly app you can build into if you are not a maintainer of the supplied configuration.

```sh
rustup target add wasm32-unknown-unknown
cargo test --locked --manifest-path contracts/Cargo.toml
cargo build --locked --manifest-path contracts/Cargo.toml --target wasm32-unknown-unknown --release
```

The remote Linux image build has passed **101 application tests and 20 Rust unit tests**, compiled the contract to WASM, and passed TypeScript checking and the production client build. The Dockerfile runs both suites before packaging. Live Neon, NEAR Auth, mainnet funding and settlement require separate configured integration tests.

## Visuals and limits

The world uses procedural geometry, batched static meshes, bounded shadows and adaptive resolution. Barlow Condensed and IBM Plex Sans are bundled locally. UI icons are Lucide; the NEAR symbol uses published brand artwork with attribution in `public/brand/README.md`.

This is a compact prototype with on-foot exploration and transport, not a multiplayer driving simulation. NPC production and prices are rule-based. Some town activity is represented by inventory changes rather than animated logistics. Concept mockups are not gameplay screenshots. Browser viewport emulation does not demonstrate performance on physical phones; those devices still need measurement.

## NEAR Auth application draft

Use **Worldo** as the application name and describe Lowland as its playable region. The use case is a 3D resource-production game with social sign-in, player-owned resources, funded NPC trading and optional cross-chain funding through NEAR Intents. The project owner must supply contact information and expected usage volumes.

Apply through [NEAR Auth’s application page](https://docs.auth.near.org/home/apply). Register the verified deployment origin as the callback, logout and web origin, and use that same value for `PUBLIC_URL`. If `APP_ORIGIN` is set, it must agree. Mainnet access is an external approval dependency, not something the repository can manufacture.
