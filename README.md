# Worldo

A third-person exploration and production game set in the **Lowland valley**. Search for resources, carry or drive them to local businesses, refine useful goods, and trade against finite inventories and budgets.

Built for NEAR Hackathon’s **Games With Real Economies** track. Desktop and portrait touch controls share the same playable world. [Demo walkthrough](docs/demo.md) · [NEAR setup and limitations](docs/near.md)

**[Play Worldo](https://lowland-near.fly.dev/)** — deployed on Fly with persistent saves, a free practice world, and a configured NEAR testnet economy. Mainnet remains disabled. Test tokens have no cash value.

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

Processing consumes **two raw units per finished product**. In practice, business fees are 2 credits for petrol or steel, and 1 credit for planks. A player workshop costs 4 steel, 6 planks and 60 credits, then processes all three recipes without service fees. These practice values are separate from the chain world’s rules.

The scanner costs 12 practice credits. North Ridge is a search region: the deposit location stays private until successive directional readings bring the player close enough to discover it. Surveying uses 3 energy; collection uses 6 energy and has a three-second cooldown. Each collection yields up to two units, subject to remaining resources and cargo space. Rest at the depot restores energy.

The pickup holds 40 units; on foot the limit is 12, increasing to 40 while working within reach of the parked pickup. Driving consumes fuel. Refuelling consumes one petrol can and restores up to 25 fuel.

NPC businesses follow explicit economic rules. Conversation cannot change inventory, balances, or prices. Selling transfers a business’s existing budget to the player. Buying and processing fees transfer money back. Stock changes the price of successive units; a spread separates purchase and resale prices. Practice mode’s **Next working day** advances production, inter-business purchases, consumption and partial resource replenishment. It does not create credits. Rules are in `shared/economy-rules.ts` and `server/economy.ts`.

## A town you can enter

Eight buildings have opening doors and interiors. Approach a door and press **E** (or tap **Interact**), walk inside, then talk to the person at the counter. The supply shop, refinery office, sawmill and foundry have different staff and furnishings. The filling station has petrol pumps and its own attendant. Residents walk distinct routes, carry goods and perform work animations.

Buildings, furniture, trees, rocks, fences, support posts, parked vehicles and people have collision handling. Walking follows the camera direction and turns the character toward travel; the pickup uses steering and reverse. Existing saves that overlap the rebuilt town are moved to nearby clear ground while retaining inventory and money.

Typed NPC conversations use current stock, budgets and quotes. Authored role-specific replies work without credentials; `NEAR_AI_API_KEY` enables the optional NEAR AI Cloud adapter. Speech uses the device’s available voices and can be switched off. No microphone access is requested. The town price board shows real one-unit merchant offers and changes since arrival.

## Controls

| Action | Desktop | Portrait touch |
| --- | --- | --- |
| Walk | W/A/S/D or arrows, relative to the camera | Joystick in the direction you want to walk |
| Drive / reverse | W/S or up/down | Joystick forward/back; hold ↑ to accelerate while steering |
| Steer the pickup | A/D or left/right | Joystick left/right |
| Run | Hold Shift while walking | Not exposed as a separate control |
| Look | Drag the world | Drag the world |
| Open doors / talk / interact | E at the displayed prompt | Interact button at the displayed prompt |
| Enter / leave pickup | F | Vehicle button |
| Map / inventory | M / I | Minimap / backpack |
| Close a panel | Escape or close button | Close button |

On foot, the character faces the direction of travel: S turns them toward the camera and walks back. Dragging changes the camera direction; turning the character does not move the walking camera. Open a shop door, walk inside and speak to its shopkeeper to browse goods. Map markers set a destination; they do not teleport the player. Panels pause movement. [Follow the complete resource-to-sale walkthrough](docs/demo.md).

## Practice, testnet and mainnet are separate

| System | Implementation and current verification boundary |
| --- | --- |
| Practice game | Playable world, server-validated actions, production, finite merchant budgets, construction and saved progress. Each guest has an independent practice town. |
| NEAR gameplay | Deployed testnet contract with separate account inventory, funded NPC wallets, transaction review, browser signing and actual chain receipts. The deployed test-wallet flow has passed browser activation, registration, deposit, reload, quarry harvesting, foundry processing and steel-sale verification, including exact fees and conserved player/merchant balances. Mainnet gameplay remains unverified and disabled. |
| NEAR Intents | Mainnet-only integration; explicitly disabled on testnet because Intents has no testnet deployment. Supported-token discovery, signed 1Click quotes, deposit instructions and status checking. Funding arrives as **wNEAR** in the player’s wallet; explicit unwrapping and a game-contract deposit are separate steps. Public token discovery and a signature-verified dry quote were checked against the deployed service on 4 November 2026. No deposit address was returned and no funds were sent; settlement remains unverified. |
| Neon | Postgres persistence and revision-checked updates are implemented. A live Neon database has not been verified for this build. |
| Fly | Deployed at `https://lowland-near.fly.dev/`. The public health check confirms the practice server and local persistent storage. |

The chain world uses contract-backed NEAR balances, not converted practice credits. The deployed game is configured for testnet; its tokens are for testing only. The UI shows contract prices to six decimal places and preserves exact integer amounts in transaction review. Its scanner is a free equipment loan; business processing costs 0.001 NEAR per batch. Its player refinery consumes 10 steel and 10 planks, and processes crude oil only. Practice reset and time fast-forward are unavailable in the chain world.

The contract implements NEP-245 core multi-token operations; optional extensions and production integration requirements are described in [docs/near.md](docs/near.md). Harvest grants are authorized by the gameplay server and reconciled with chain state. The oracle cannot create NEAR. A pending resource transaction blocks further economic work until checked; the UI provides **Check transaction**.

There are no guaranteed earnings, automatic token rewards or claims of real commodity backing. Mainnet NPC budgets require real funding. Current sign-in and economic signatures require user approval; completely invisible blockchain interactions are not claimed.

## Persistence and deployment

`DATABASE_URL` selects the Neon adapter. It stores game snapshots using revision checks; executable mainnet flows also require durable identity, funding and oracle records. SQL definitions are in `migrations/`. Without a database, atomic local files support development and a single-machine practice preview. `LOCAL_DATA_DIR` controls their location.

Fly serves the built client and API on one origin. The supplied configuration mounts persistent storage, enables the configured testnet world, and leaves `ENABLE_MAINNET=false`. Testnet identity and operator journals use the mounted storage when Neon is absent. Use Neon before running multiple application machines. Store runtime secrets through Fly’s secret manager, never in browser configuration or Git.

`npm start` serves the production build and requires a valid production HTTPS `PUBLIC_URL`. For a local production-build preview, use `node scripts/preview.mjs`; this deliberately runs a practice-only QA server with separate `.local/e2e` saves. Mainnet configuration and deployment steps are in [docs/near.md](docs/near.md).

## Verify

```sh
npm test
npm run build
npm run test:e2e
```

**Build before browser tests. Stop any other server on port 3000 first** so Playwright starts the QA server for the current `dist/` build. Tests use installed Microsoft Edge on local Windows and bundled Chromium elsewhere (install it with `npx playwright install chromium`), one worker, a 1440×900 desktop viewport and a 390×844 touch viewport. Set `E2E_BASE_URL` to test a deployed practice preview instead of launching a local server. CI installs Chromium before running browser checks.

Unit/API tests cover economic conservation, movement limits, private prospecting, resource caps, concurrency, session isolation, origin checks, mainnet reconciliation and authorization boundaries. Browser tests exercise desktop scouting/extraction/processing/selling, portrait touch movement/trading, and pickup driving and parking on both layouts. Provider and chain mocks test application behavior; they do not establish production access or complete a real swap.

On **4 November 2026**, remote Chromium verification against the deployed rebuilt town passed **six practice scenarios** across the main run and a focused resource-loop rerun:

- **Desktop resource loop, 1440×900:** buy a scanner from Morgan inside the supply shop, follow directional readings to a hidden deposit, extract crude, walk around solid machinery, open the refinery door, speak to Hale, process petrol, sell it, and verify saved progress after reload. The final focused run passed in 248.7 seconds, with one intentional platform skip and no failures or flaky results.
- **Portrait controls, 390×844:** native touch-joystick movement, entering the depot, scanner purchase and horizontal-overflow checks.
- **Pickup transport, both layouts:** enter, accelerate, steer, park, exit safely, reload and re-board with vehicle position, heading and fuel preserved. Portrait includes simultaneous steering/throttle and touch-control release behavior.
- **Town tours, both layouts:** opening doors, walking inside, talking to a shopkeeper, typing a stock question, and checking that conversation leaves money and inventory unchanged. Camera inspection also checks that dragging the view does not rotate the character.

A separate explicit testnet scenario passed on the final release in **151.7 seconds**: browser-owned wallet activation, registration, deposit, reload, real quarry harvesting, foundry processing and steel sale. It verified exact canonical inventory, the 0.001 NEAR processing fee, conserved player/merchant balances and unchanged native wallet balance during sponsored calls. Holding real quote responses also verified that the price board shows dashes until NEAR quotes arrive. The portrait transaction scenario was intentionally skipped. [Public testnet receipts](docs/testnet-validation.json) record the actual transactions.

The scenarios select the shipped battery-saver graphics mode. These are functional browser checks using an emulated viewport and a software GPU, not a measurement of frame rate on physical phones.

To repeat browser checks against the public practice preview, set `E2E_BASE_URL=https://lowland-near.fly.dev` before running `npm run test:e2e`. No local API server is launched when that variable is set. To run the same checks on a remote Fly builder:

```sh
mkdir -p .local
fly deploy --config fly.e2e.toml --remote-only --build-only \
  --build-arg E2E_BASE_URL=https://lowland-near.fly.dev \
  --build-arg QA_RUN_ID=your-unique-run-id > .local/qa-build.log 2>&1
```

This builds a separate QA image and does not deploy it as the game. Use `E2E_SCOPE=transport`, `town`, or `economy` for focused practice checks. The separate `E2E_SCOPE=testnet` run verifies the network before creating a wallet or spending bounded test tokens; it never runs by default. Change `QA_RUN_ID` for each run so Docker does not reuse a previous test result. The build exits with the actual test status. Its captured log contains a `WORLDO_QA_REPORT` JSON summary and bounded, chunked screenshot artifacts; `scripts/export-qa.mjs` defines the artifact format. Use a Fly app you can build into if you are not a maintainer of the supplied configuration.

```sh
rustup target add wasm32-unknown-unknown
cargo test --locked --manifest-path contracts/Cargo.toml
cargo build --locked --manifest-path contracts/Cargo.toml --target wasm32-unknown-unknown --release
```

The latest application suite passed **139 tests**. The remote Linux image build passed **22 Rust unit tests**, compiled the contract to WASM, and passed TypeScript checking and the production client build. The Dockerfile runs both suites before packaging. Live Neon, NEAR Auth, mainnet funding and settlement require separate configured integration tests.

## Visuals and limits

The world uses procedural geometry, batched static meshes, bounded shadows and adaptive resolution. Barlow Condensed and IBM Plex Sans are bundled locally. UI icons are Lucide; the NEAR symbol uses published brand artwork with attribution in `public/brand/README.md`.

This is a compact prototype with on-foot exploration and transport, not a multiplayer driving simulation. NPC production and prices are rule-based; optional AI is limited to conversation. Some town activity is represented by inventory changes rather than animated logistics. The generated Worldo logo is installed in the title screen and HUD; its generation prompt is recorded in `public/brand/worldo-logo.provenance.json`. Concept mockups are not gameplay screenshots. Browser viewport emulation does not demonstrate performance on physical phones; those devices still need measurement.

## NEAR Auth application draft

Use **Worldo** as the application name and describe Lowland as its playable region. The use case is a 3D resource-production game with social sign-in, player-owned resources, funded NPC trading and optional cross-chain funding through NEAR Intents. The project owner must supply contact information and expected usage volumes.

Apply through [NEAR Auth’s application page](https://docs.auth.near.org/home/apply). Register the verified deployment origin as the callback, logout and web origin, and use that same value for `PUBLIC_URL`. If `APP_ORIGIN` is set, it must agree. Mainnet access is an external approval dependency, not something the repository can manufacture.
