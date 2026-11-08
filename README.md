# Worldo

Worldo is a 3D economy game, live on NEAR testnet. Three cities run on the crude oil, rubber, wood and petrol that players gather and deliver. Each city has a mayor with its own treasury who sets prices from the city's stock and explains every decision. Players can build a petrol station and compete with the mayors for drivers. Players sign in with Google or email through NEAR Auth and get a NEAR account with no seed phrase. Trades settle on NEAR in the background, so they never see a wallet prompt or pay gas.

- Play: https://worldo.world
- Contract: [`worldo-cities-aecd50.testnet`](https://testnet.nearblocks.io/address/worldo-cities-aecd50.testnet)

## The problem

Most blockchain games start from the token. Players meet wallets and gas prompts before they play, and the economy only changes when the developers patch it. In Worldo the economy is the game: shortages, prices and competition drive play, and NEAR stays in the background.

## Try it

| Do this | See this |
| --- | --- |
| Open https://worldo.world and press **Create account & play** | Sign in with Google or email through NEAR Auth and approve once. You get a NEAR account with no seed phrase, and no wallet pop-ups after that. |
| Follow the step tracker at the top. Walk to the gold beam at the Oil Field and hold **E** next to a pump | Crude oil goes into your cart while you hold the key. |
| Carry it into the Refinery Exchange, open the door with **E** and talk to Hale with **E** | The mayor answers from the city's live numbers. |
| Choose **Browse goods & services** and sell your crude | The quote shows the price, the reason for it, how far your order moves it, and the mayor's latest decision. |
| Click your coins at the top right, then **View latest transaction** | NearBlocks shows the batch holding real game activity. Allow a minute or two for it to settle. |
| Open settings (gear icon, top right) and pick another language | The whole interface switches language. |
| Open https://worldo.world/?ff=1 and press **Run** | A game week plays in about a minute, and fuel, prices and market share move on the chart. |

To run it on your own computer, you need Node.js 24 and no keys:

```sh
npm ci
npm run dev:local
```

Open http://localhost:3000 and press the play button. The full game runs in a local save. NEAR settlement and NEAR AI need keys, so they are off and mayors use scripted replies. `npm run demo` starts the storm scene, and `npm test` runs the tests. To run it on NEAR testnet with your own accounts, see [docs/worldo.md](docs/worldo.md).

## How to play

1. Gather crude oil, rubber and wood with your starter tools.
2. Sell crude to Refinery City, and rubber and wood to Motor and Harbor City.
3. Buy petrol at the Refinery and carry it to cities that need it. Better tools and vehicles come from Motor City.
4. Buy a station plot for 300 coins, pay the 40-coin build fee and deliver 40 wood.
5. Stock the tank with petrol, set a pump price and repair the hoses with rubber. Drivers keep buying while you are away.

W and S walk, A and D turn (the arrow keys work too), and dragging looks around. **E** opens doors and talks, and holding it gathers. **F** enters a vehicle, **M** opens the map and **I** opens your cargo.

## What's in the game

| Feature | Code |
| --- | --- |
| Simple social login: sign in with Google or email through NEAR Auth, with no seed phrase | [near-login.ts](server/near-login.ts) |
| Each mayor is a NEAR account with its own coins and goods | `account` and `apply_batch` in [lib.rs](contracts/src/lib.rs) |
| While someone is playing, mayors use NEAR AI to set wages, bounties, fuel reserves and a price adjustment of up to 15%, within fixed limits. Their built-in rules decide the rest of the time. Each decision and its reason goes on chain | [mayor-council.ts](server/mayor-council.ts), [mayorPolicy.ts](server/economy/mayorPolicy.ts) |
| Talk to the mayors in your own language, with ElevenLabs voices | [npc.ts](server/npc.ts), [npc-providers.ts](server/npc-providers.ts) |
| Player-owned petrol stations compete with the mayors for drivers | [stations.ts](server/economy/stations.ts), [driverChoice.ts](server/economy/driverChoice.ts) |
| Storms, refinery faults, festivals, oil booms and cold snaps hit the economy on their own | [citySim.ts](server/economy/citySim.ts), [events.ts](shared/config/events.ts) |
| Prices follow stock, explain themselves, and move as large orders fill | [pricingRules.ts](server/economy/pricingRules.ts) |
| Supply contracts lock in a price for daily deliveries | [contracts.ts](server/economy/contracts.ts) |
| Reputation moves a player's prices by up to 10% | [reputation.ts](server/economy/reputation.ts) |
| A simulated week in a minute at `/?ff=1` | [preview.ts](server/economy/preview.ts) |
| Ten languages | [languages.ts](shared/languages.ts) |
| No wallet pop-ups or gas. A sponsored worker settles actions in batches | [city-controller.ts](server/city-controller.ts), [relayer.ts](server/relayer.ts) |
| Coins, goods, equipment and station deeds are NEP-245 tokens in one contract. They move only through game settlement, so direct wallet transfers are blocked | [lib.rs](contracts/src/lib.rs) |

## How NEAR is used

- **Accounts.** NEAR Auth gives each player a NEAR account from a Google or email login, with no seed phrase.
- **Permission.** A player approves one grant with `authorize_game`. It lasts 30 days, caps coin spending at 100,000 and cannot move native NEAR or any other asset.
- **No gas for players.** NEP-366 delegate actions let a sponsor pay.
- **Settlement.** Actions apply in the game at once and join a queue. A worker sends ordered batches to `apply_batch`, signed by all three mayor keys, which the game server holds. The contract checks batch order, player nonces, grant limits and that the coin supply never changes.

## Testnet transactions

- [Contract deployment](https://testnet.nearblocks.io/txns/2iJdmZfuaStiPmMahWWFxkhL698Ai9vCHGKcmc9WjhGg)
- [Sponsored permission grant](https://testnet.nearblocks.io/txns/BCXn8NfbWRZ3rdX7NqCexZPfhi4KG3ByujoRdhzuaKXL)
- [NEAR AI mayor decisions and their reasons in a `mayor_decisions` event](https://testnet.nearblocks.io/txns/94P4S4x4ooEbZoFESYCSr1cNFWyV24BfVDChgh7gvbaA)
- [Permission revocation](https://testnet.nearblocks.io/txns/3fiMFzvpgMFvyae1uwgpx9xGBKbWaupB18UBzvqq8g6V)

## Built with

Three.js, React, TypeScript, Vite, Express, Neon PostgreSQL, Rust with near-sdk, near-api-js, NEAR Auth, NEAR AI Cloud, ElevenLabs and Fly.io, with help from AI coding tools including Claude Code and Codex.
