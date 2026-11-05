# Demonstrating Worldo

Show the running game, using its visible **Worldo** name. Concept images are not gameplay screenshots.

## Before recording

The submission runs on **NEAR testnet with NEAR Auth social sign-in**. Use `APP_MODE=production`, `NEAR_NETWORK=testnet`, `NEAR_AUTH_MODE=social`, `ENABLE_TESTNET=true` and `ENABLE_MAINNET=false`. Players should see the normal account flow, without public practice credits or a disposable browser wallet. Test NEAR has no monetary value; no real funds are required.

Configure the services in [near.md](near.md), then check `/api/near/readiness`. On the single-machine Fly deployment, `TESTNET_SINGLE_PROCESS=true` and a mounted `LOCAL_DATA_DIR` provide durable testnet storage. Neon can be added later and is required for a future mainnet release. Missing credentials should produce an honest unavailable state.

**Resolve sign-in before recording the playable account flow.** The official shared testnet client accepted a read-only callback probe for `http://localhost:3000`, but rejected `https://worldo.world` and `http://localhost:5173` with a callback mismatch. No completed social sign-in has been verified yet. For local verification, run the app at localhost:3000 with that exact `PUBLIC_URL`; retain production app mode and social authentication. Hosted recording requires an allowed Fly callback configuration. Do not substitute a development browser wallet and describe it as social login.

Once sign-in works, follow the actual player flow: sign in, activate the wallet if needed, review registration and enter Worldo. A newly provisioned testnet social wallet receives **1 test NEAR once** from the operator's bounded test-token budget. A 0.05 test NEAR registration reserves 0.01 for storage and leaves 0.04 as game balance. Social signing requires the configured NEAR Auth signing-service deposit and relayer; it is not the browser test-key flow.

**NEAR Intents is unavailable on testnet.** Do not show mainnet deposit addresses or claim a testnet swap. The retained Intents adapter is for a later, separately configured mainnet release.

## A short playable walkthrough

1. **Enter the supply shop.** Approach the door and press E or tap Interact. Walk inside and talk to Morgan. Ask a question only if NEAR AI is configured and actually responding; otherwise show the unavailable state briefly. Open Goods & services and borrow the free resource scanner.
2. **Show the camera.** Turn around: the character turns and the camera follows toward the door. Walk out. Use the crude-oil shortcut to inspect its recipe and set a route to North Ridge. The ore and timber shortcuts show different routes; the backpack shows all cargo.
3. **Prospect.** Take the pickup or walk to North Ridge. Leave the vehicle and scan. Follow signal strength and directional hints until the deposit is found. Surveying uses 3 energy. A discovered deposit gets its own map marker.
4. **Extract.** Move within drilling range and collect up to two crude units. Show energy, cargo capacity and the actual finalized inventory. A pending chain transaction must be checked rather than repeated.
5. **Process.** Return to Worldo Refinery, open the office and speak to Hale. Two crude units and a 0.001 test NEAR processing fee produce one petrol can. Review the transaction, approve its social-signing request and wait for confirmation.
6. **Use or sell.** Petrol can refuel the pickup, or be sold to the refinery. Show the current offer and merchant budget before signing a sale. The merchant pays from its existing balance; inventory changes after confirmation.
7. **Show the economy.** The town board uses current contract merchant offers. Keep the testnet network identification visible and describe amounts as test NEAR per unit. Compare the changed stock and offer after a trade. Prices are game market prices, not real-world oil prices or real earnings.
8. **Show persistence.** Reload, sign in if required and re-enter. Inventory and game balance must agree with the confirmed contract state.

For a longer demonstration, mine ore and gather timber, process steel and planks, then build a refinery at Riverside Plot using 10 steel and 10 planks. That player refinery processes crude without a business fee.

## Languages and sound

Choose a language from the title screen, or switch it in Settings while playing. Demonstrate a translated resource panel and one short NPC exchange, then let the reply play. The game supports English, French, Spanish, Portuguese, German, Arabic, Hindi, Simplified Chinese, Japanese and Korean. Language changes clear the visible conversation and cancel outstanding audio. Keep monetary amounts and chain account identifiers visible as provided by the game.

Enter the pickup and accelerate to demonstrate the engine changing with speed, then walk to hear footsteps. Show the game-volume slider separately from the NPC voice toggle. Record system audio; the browser must receive an initial click or tap before sound can start.

## Portrait controls

Show joystick walking, automatic camera following, manual drag to look around, entering a shop and using its panel without horizontal scrolling. The vehicle controls support steering and a separate throttle button.

An emulated phone viewport verifies layout and inputs; it does not establish frame rate or battery use on a physical phone.

## Honest feature boundaries

- NEAR AI dialogue uses each character's role and game context. Missing credentials show an unavailable message. Introductory greetings are authored.
- ElevenLabs voices generated replies only when configured. It has a mute control and Listen fallback. No microphone is requested.
- Conversation does not execute trades or modify inventory.
- The public testnet account flow has no practice reset or day fast-forward. The development world's daily NPC production simulation is not an autonomous chain process.
- Social-signing approval and AI/voice access must each be verified separately. Reachable issuer metadata and passing mock tests do not prove those integrations work end to end.
- Intents is absent from this testnet walkthrough. Mainnet code being present does not establish a completed swap.
- The existing [testnet receipts](testnet-validation.json) prove historical contract transactions using a development browser wallet. They do not prove the current social-login entry flow.

## Submission evidence

Keep the exact commit/build identity, reproducible setup, validation results, actual desktop and portrait screenshots, a recording of the playable loop, and **testnet explorer links** for completed transactions. State that the game is on NEAR testnet. List the unresolved hosted callback and any unconfigured AI, voice or database services plainly; do not label them verified.

The latest full application/API run passed 319 tests. See the README for current provider checks and historical chain evidence; internal browser fixtures do not establish the social-login flow.

Internal development rehearsal remains available through `scripts/preview.mjs` after a client build. Its isolated practice fixture is useful for controls and visuals, but must not be presented as the social-login submission flow.
