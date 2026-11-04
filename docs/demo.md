# Demonstrating Worldo

Worldo is the game; **Lowland** is its valley. Demonstrate the running build. The earlier generated images illustrate a visual direction and should not be presented as screenshots of this implementation.

## Start a clean practice run

1. Run `npm ci`, then `npm run dev`, and open http://localhost:3000.
2. Choose **Enter Worldo**. If this browser already has progress, open Settings and choose **Start a fresh practice world**. This resets that practice world only.
3. Identify the **Practice economy** label. A fresh player has 120 credits, 100 energy, 70 fuel, empty cargo and a pickup outside the supply depot. Credits have no cash value.

For a production-build rehearsal, first run `npm run build`, stop the development server, then run `node scripts/preview.mjs`. This uses separate QA saves and keeps mainnet disabled. The deployed practice preview is at [lowland-near.fly.dev](https://lowland-near.fly.dev/).

## Show the resource-to-sale loop

1. **Get equipped.** Walk a few steps toward the supply depot. Press **E**, or tap **Interact**. Buy the **Resource scanner** for 12 credits. Show that the balance changes to 108 and the scanner becomes equipped.
2. **Choose a route.** Close the panel and open the map. Select **North ridge**. This sets a destination rather than moving the character. Walk around the depot building, or approach the parked pickup and use **F** / the vehicle button to drive. The refinery road continues toward North Ridge.
3. **Prospect.** At North Ridge, leave the pickup and interact with the region. Choose **Survey this area**. Read the signal percentage and direction hint. Close the panel, move a few metres in that direction and scan again. Each reading consumes 3 energy. The exact location should remain absent from the map until discovery; a deposit may require several readings.
4. **Extract.** Once discovered, a gold oil-deposit marker appears. Move within drilling range if necessary. Choose **Extract crude oil** to collect up to two barrels. Show the inventory increase, energy cost and disabled button during the three-second equipment cooldown. Capacity is 12 on foot or 40 near the pickup.
5. **Process.** Return to **Lowland Refinery**, interact, and select **Refine**. Two barrels of crude plus a 2-credit service fee produce one petrol can. Show the raw inventory decrease and finished-product increase.
6. **Sell.** Select **Sell cargo**, choose **Petrol**, and review the current offer and merchant budget. Confirm the sale. Show the can leaving the player’s inventory, stock increasing at the refinery and money moving from the merchant’s finite budget to the player. The price depends on current stock; do not promise a fixed return.
7. **Prove persistence.** Reload, re-enter Worldo and verify the scanner and resulting inventory/balance remain. The server save is associated with this browser’s session cookie.

## Explain why the economy matters

At a business, compare buying and selling prices for the same good. Sell additional raw loads to demonstrate that abundant stock lowers offers. Show a merchant’s budget: it cannot buy an unlimited quantity without funding.

At the depot, **Next working day** runs the practice economy’s production, inter-business purchasing and consumption rules. Reopen a business to inspect changed stock and offers. This is an explicit practice simulation, not evidence of autonomous mainnet transactions.

Petrol has a concrete use: driving consumes fuel, and refuelling consumes a can. Steel and planks have a construction use. The practice workshop at **Riverside plot** consumes 4 steel, 6 planks and 60 credits; its appearance changes and it unlocks processing without business fees. Construction takes additional gathering/trading and need not be forced into the first short demo.

These systems redistribute existing credits; resource collection does not create NEAR. A profitable-looking trade in practice is not a financial return promised to a player.

## Demonstrate portrait controls

Use a phone or a narrow touch viewport. The left joystick moves and steers; drag the world to adjust the camera. The right controls handle interaction and entering/leaving the pickup. While driving, hold the up-arrow accelerator and steer with the joystick; releasing the joystick keeps the held accelerator active. Open the depot panel, change the quantity and inspect the confirmation button without horizontal scrolling.

A browser’s mobile viewport is useful for layout and input checks. Only a physical-device run supports claims about that phone’s frame rate, thermals or battery use.

## Optional mainnet demonstration

Do this only after the required production identity, wallet provisioning, deployed contract, merchant accounts, oracle, relayer and Neon services are configured and independently checked. Until then, show the honest **Setup pending** state. Do not substitute mocked receipts or relabel practice credits.

The implemented UI separates these operations:

1. Sign in with an approved NEAR Auth method and activate the wallet if required.
2. Request a quote for a supported asset on its supported source chain. Confirm the asset, chain, refund address, expiry and deposit instructions. The player sends from their source wallet.
3. Wait for verified funding status. The destination asset is **wNEAR**, not native NEAR.
4. Review and sign the 1:1 conversion from wNEAR to native NEAR.
5. Review game registration or a deposit. Registration reserves 0.01 NEAR for storage; any remainder becomes game balance. Wallet funding alone does not deposit money into the game.
6. Choose **Enter mainnet world**. Show the separate account inventory and genuine NEAR balances. Live prices come from the contract, not practice pricing constants.
7. Review a specific gameplay transaction, sign it and open its confirmed explorer receipt. A quote, signature popup or submitted request alone is not proof of successful settlement. If a resource transaction is pending, use **Check transaction** instead of repeating the collection.

Mainnet currently differs from practice: the scanner is borrowed free, business processing costs 0.001 NEAR per batch, and a player refinery consumes 10 steel and 10 planks and processes crude only. There is no mainnet reset or fast-forward button. See [production setup](near.md) for signing, funding and operational details.

## Evidence to keep with a submission

- Exact setup commands, environment requirements and current test results.
- A recording of the playable loop, including the price/inventory changes.
- Actual gameplay screenshots at desktop and portrait sizes.
- Deployment URL and commit/build identity once deployment is verified.
- Real explorer links only for transactions actually completed on the configured network.
- An explicit statement of remaining dependencies: provider approval, unverified Neon/mainnet flows, and physical-device performance measurements where applicable.
