# Silver shop: Silver for Robux

Status (2026-11-14): **built (SH1-SH8), not run in Studio.** Server and client code is typechecked, linted and built
only; the pure cores are specced. Owner answers (2026-11-14): **OC1** bought Silver buys everything, power included (one
pool, SHD1); **OC2** packs slightly cheaper (20 / 55 / 115 / 265 Robux); **OC3** the shop opens from the Armory's
balance and the main menu's balance (SHD5). This **supersedes docs/SILVER.md SVD1** ("no Robux purchase of Silver in
v1"). Pending: SH0 (Studio confirmations) and SH9 (create the products, paste their ids, checks), both the owner's.
Numbers marked *(tune)* are starting points. Task prefix **SH**, decisions **SHD**.

Goal: a player can buy Silver with Robux from the Armory or the main menu, through Roblox developer products. The
Silver lands in the same wallet as earned Silver and buys the same things. Nothing else changes: what play pays, the
price ladder and every Armory rule stay as they are.

Three rules shape everything:

- **A receipt is a wallet transaction.** The receipt's `PurchaseId` is recorded in the wallet doc inside the same
  `UpdateAsync` that adds the Silver, and the handler answers `Processed` only after that write committed. A receipt
  delivered twice never pays twice; a failed write is delivered again by Roblox. No session copy, no second store on the
  critical path.
- **Selling Silver never lowers what play pays** (SHD3). No earn-rate cut, no ladder rise, no slow lane for players who
  do not pay.
- **Calm selling** for a young audience (SHD5). Two entry points, both a Silver balance; nothing in the run, at run
  over, on lock cards or at a death; no timers, fake sales or "best value" banners.

## Owner calls

| # | Question | Answer / recommended | Alternative |
|---|---|---|---|
| OC1 | May bought Silver buy power (Vigor, Deep Flask, Plating) too? | **Answered: yes, one pool** (SHD1) | |
| OC2 | Packs and prices | **Answered: slightly cheaper.** Four packs, table below *(tune)* | |
| OC3 | Where is the shop? | **Answered: the Armory's balance and the main menu's balance** (a `+` beside each) | |
| OC4 | Bulk bonus | **Modest:** about +25 % Silver per Robux on the largest pack | The same Silver per Robux on every pack |
| OC5 | A starter pack or first-purchase bonus? | **None** in v1 | A one-time 2x on the first pack |
| OC6 | Managed Pricing (regional prices, price optimisation) | **Built for it** (prices always read from Roblox); opt in after SH9's Dynamic Price Check | Fixed prices everywhere |
| OC7 | Are boards affected? | **No marking**; upgrades already count on every board (docs/SILVER.md SVD3) | An icon on entries of accounts that bought power |
| OC8 | Names | **Get Silver**; packs Pouch / Purse / Chest / Hoard | Small / Medium / Large / Huge |
| OC9 | Gifting Silver | **Not in v1** (Later) | |

## Packs *(tune)*

| Pack | Silver | Default price (Robux) | Silver per Robux | Roughly buys |
|---|---|---|---|---|
| Pouch | 150 | 20 | 7.5 | one tier 3 item |
| Purse | 450 | 55 | 8.2 | the Archer, with change |
| Chest | 1,000 | 115 | 8.7 | Deep Flask II or Plating, with change |
| Hoard | 2,500 | 265 | 9.4 | a tier 7 cosmetic |

- For scale (docs/SILVER.md "Census", at 3 hearts before the cut): a floor-1-2 player earns about 32 Silver a run,
  about 196 a day with the first-run bonus; a floor-10 run about 434. A Pouch is about five short runs. The whole power
  tree is a Hoard and a Purse (2,950 Silver, 320 Robux at default prices).
- The Silver in a pack is fixed in code (`SILVER_PACKS`); the Robux price is Roblox's (set in Creator Hub, read per
  player, SHD8) and may differ per region or price test.
- The "Roughly buys" column is for the owner, not the UI: the shop never says what a pack is "enough for".

## Facts that constrain the design

1. **The old codec dropped unknown fields**, so a server running pre-SH1 code would erase `bought` and the receipt ring
   on its next transaction for that player; bumping `v` would make old servers refuse every transaction (SVD34). So the
   codec change ships first and **must be live on every server before any product id is configured** (SHD7).
2. **Roblox keeps no per-user purchase history**; the developer stores it. The wallet's receipt ring is the idempotence
   record; the audit store is for support.
3. **Receipts are delivered again until acknowledged** (`NotProcessedYet`); the handler fires only while the buyer is
   on a server.
4. **`PromptProductPurchaseFinished` is not a grant**; it only tells the client the prompt closed.
5. **Dynamic prices.** Regional pricing and price optimisation only reach prices read through `GetProductInfoAsync`.
6. **Silver is now a Robux-acquired currency.** Anything random bought with it would be a paid random item needing
   PolicyService gating; the Armory sells fixed items only (SHD6).
7. **Pinned theme tails** and the Luau top-level locals limit (contract.luau 189, validate.luau 192 of 200).
8. **`earned` means play.** `silverWelcomeShown`, analytics and the census read it; bought Silver is its own field.

## Player experience

```
 ARMORY                                                       Silver 460 [+]
 [ Upgrades ] [ Unlocks ] [ Cosmetics ]
                    +------------------------------------------+
                    |  GET SILVER                          [x] |
                    |   [ 150 Silver ]   [ 450 Silver ]        |
                    |      20 Robux         55 Robux           |
                    |   [ 1,000 Silver ] [ 2,500 Silver ]      |
                    |      115 Robux        265 Robux          |
                    |  Silver bought with Robux works like     |
                    |  Silver you find. Purchases can't be     |
                    |  undone.                                 |
                    +------------------------------------------+
```

- A `+` beside the Silver balance, in the Armory's header and on the main menu, opens **Get Silver**: one panel over
  the screen that opened it. Closing it returns focus to that `+`. Four equal cards: the Silver amount, the coin icon
  and the price Roblox gives this player. No ribbons, badges, animation or crossed-out prices.
- A card press opens Roblox's own purchase prompt; it is the only confirm.
- Bought: `Adding Silver...` until the server's `wallet` push with the purchase arrives, then `+450 Silver`, the
  balance rolls up, `sfx.silver.gain`. After 15 s: `Your Silver is on its way`; the push still lands (a toast if the
  panel is closed). Cancelled: nothing. Prices not loaded: `Unavailable`.
- Wallet unknown or shop off in this universe: no `+`. A receipt still lands (SHD4).
- Never: in a run, at run over, in the draft, on a death, on the Archer's locked card, on the character screen, in a
  lobby, in the tutorial. No badge, toast or reminder points at the shop.

## As built (2026-11-14)

Built in three tracks on branch `silver-shop` (A: shared wallet core; B: server; C: client and theme), merged without
conflicts.

### Wallet core (SH1, SH2; shared/wallet)

- **Doc** (`doc.ts`): optional `bought` (non-negative integer), `receipts` (string ring, oldest first, trimmed to
  `SILVER_SHOP.receiptRing` 128) and `extra` (every unknown top-level field, kept as stored and written back on encode,
  sorted). `walletBalance` = earned + bought - spent, never below 0. `v` stays 1. Spec `docCompat.spec`.
- **Tunables** (`config.ts`): `SILVER_SHOP` (`receiptRing` 128, `pendingNoticeSec` 15, `auditStore` `KV_Purchases_v1`,
  `auditKeyPrefix` `p_`, `reportRate` 10 / 10 s, `maxReportSeconds` 600, `reportSecondsStep` 0.1),
  `SILVER_SHOP_FAKE_ATTRIBUTE` `KV_FakeShop`.
- **Packs and products** (`shop.ts`): `SILVER_PACKS` (append-only, order lock; `retired?` packs still grant),
  `SILVER_PRODUCTS` (game id -> pack id -> product id; **empty until SH9**), `silverProductsFor`,
  `silverPackForProduct`, `silverProductIdsFor` (the handler's filter), `shownSilverProducts`, `silverShopAvailable`.
  `SilverReceipt` / `readSilverReceipt`, `applyPurchase(doc, receipt, pack)` -> `SilverPurchaseGrant` or `duplicate` /
  `unknownProduct` / `badPurchaseId` (never touches `earned`, `spent`, `own` or the day marks), `receiptDecision`
  (`Processed` only for a committed grant or a duplicate), `parseFakeShop`.
- **Transforms / book**: `WalletOp` `silverPurchase`; `WalletBook.purchase(userId, receipt, pack)` through the same
  per-player lock and retries, whether or not the wallet loaded (the copy is updated when it did); it counts in
  `pending()`, so BindToClose's wait covers receipts.
- **Status**: `WalletStatus.purchase` (`walletPurchaseNotice`), `shopAvailable`, `fakePrices` (`SilverFakePrice`).
- **Telemetry**: `EconomyTransactionType` `IAP`, `silverPackSku` (`silverPack.<id>`, in `economySkus`),
  `silverPackEconomyEvent`; custom event `SilverShop` (39 of 100 names; 3,586 of 8,000 field combinations) with client
  steps opened / prompted / bought / cancelled / settled / pricesFailed (`from` armory / mainMenu) and the server's
  `granted`; `readSilverShopReport`. The economy event carries no Robux field (the economy spec has no custom fields;
  Roblox's monetization dashboard records the Robux).
- **Remotes** (`shared/network.ts`): client -> server `silverShopReport(report)` and `silverShopFakeBuy(packId)`
  (Studio only, below); purchases come back in the existing `wallet` push.

### Server (SH3; server/services SilverShopService, WalletService)

- When `silverShopAvailable(game.GameId)`: one `MarketplaceService:BindReceiptHandler(DeveloperProduct, handler,
  silverProductIdsFor(...))`, so `ProcessReceipt` stays free; if the bind throws, `ProcessReceipt` is set once, only if
  nothing else set it.
- The handler (pure plan `silverReceiptPlan`, shared/wallet `shopServer.ts`) defers (`NotProcessedYet`, no transaction)
  what is not a receipt, not ours, or arrives after BindToClose began; otherwise `WalletService.purchaseSilver`, granting
  whether or not the buyer is still here.
- After a committed grant: `pushPurchase` (a `wallet` push with `purchase`) if the buyer is here; the IAP Source and the
  `granted` event **only while the buyer is on the server** (AnalyticsService needs the player); a best-effort SetAsync
  of `silverAuditRecord` into `KV_Purchases_v1` under `p_<PurchaseId>`, tagged with the user id (never in Studio; a
  failure never changes the answer). A duplicate logs nothing.
- `silverShopReport`: rate limited at `SILVER_SHOP.reportRate`, validated, logged as `SilverShop`.
- Loaded statuses carry `shopAvailable` (products in this universe, or `KV_FakeShop` with prices; `off` = false) and,
  in Studio, `fakePrices`.
- **Studio path:** `KV_FakeShop` (Workspace, Studio only) = `off` or four prices in pack order (e.g. `20,55,115,265`):
  the `+` shows, the cards show the fake prices, and a press fires `silverShopFakeBuy(packId)`, which grants through
  the same `WalletBook.purchase` with a fake purchase id (`studio_` + 8 chars, product id 0) into the memory store.
  Refused on live servers. Statuses are re-sent when the attribute changes.

### Client and theme (SH4-SH6)

- **Theme** (`shared/theme/silverShop.ts`): 12 keys `silver.shop.*`, spread last into `REQUIRED_STRING_KEYS` (the prefix
  is `silver.shop`, not `silverShop`, because the validator refuses a capital letter in a key's first segment); English
  in the placeholder manifest; `l10n/context.json` entries; optional `ui.icon.robux` (`ROBUX_ICON_ID`): without it
  prices read `55 Robux` (vale wires it, "Robux icon" below). No new audio id. Pinned tails updated (codex, fortune, floorModifiers, treasure, runRecap,
  secrets, silver, contract specs). Luau top-level locals on out/: contract.luau 189 (was 188), validate.luau 192.
- **Flow** (`shared/view/menu/silverShop.ts`): `silverShopEntryShown` (loaded and `shopAvailable`),
  `SILVER_SHOP_ENTRY_POINTS`, the flow (`shopOpen` / `shopClose` / `shopPrompt` / `shopPromptFinished` /
  `shopPurchaseArrived` / `shopNoticeShown` / `shopAddedExpired`), card states (loading / ready / unavailable / adding /
  added / busy, `silverShopCards`), layout (`silverShopLayout`, `silverShopRows`), `SILVER_SHOP_VIEW`.
- **Client**: store slice `silverShop` (`client/store/silverShop.ts`); `SilverShopController`
  (`client/controllers/ui`): prices through `GetProductInfoAsync` once per session (or `fakePrices`),
  `PromptProductPurchase` (or `silverShopFakeBuy`), the prompt's finish only drives pending, the push's `purchase`
  settles it; the funnel reports. Actions `openSilverShop(from)` / `closeSilverShop` / `buySilver(packId)`.
  `SilverBalance` (the readout with the optional 28 x 28 `+`) in `ArmoryScreen` and `MainMenu`; `GetSilverPanel`
  mounted by `MenuLayer`.
- **Side effects:** the Armory's focus scope now has `memoryKey="armory"` (so B returns to the `+`; re-entering the
  Armory lands on the last selected button, as the main menu and lobbies already do). Purchase toasts reuse the lobby
  notice toasts with negative ids (no collision with lobby notices). The desktop main menu's Silver line grows 20 -> 28
  px (the fit estimate counts it); the phone line and the Armory header keep their height.
- **Entry-point guard**: `scripts/check-silver-shop-entry.test.js` (in `test:checks`) fails if anything but
  `SilverBalance` opens the panel, any screen but the main menu and the Armory draws the `+`, or anything but
  `MenuLayer` mounts the panel. The panel is in every phone / portrait fit check.

### Robux icon (SH10)

- **Roblox's own icon, never redrawn.** The Robux icon is Roblox's mark, so the pack uses Roblox's official white icon
  from the Roblox Studio install (`content/textures/ui/common/robux@3x.png`), copied by the owner into
  `art/vendor/roblox/` (gitignored, like every vendor file). The theme takes uploaded images only (`rbxassetid://`;
  local `rbxasset://` content is refused), so it is uploaded like any other ui image.
- `scripts/art/roblox/prep_robux_icon.py` (python3 + Pillow, not run by art:build): crop to the visible pixels, centre
  on a square, Lanczos on premultiplied alpha down to 14 x 14 (the UI sheet's glyphs are 11-14 art px; the button's
  glyph box is 16 reference px), white with its alpha, edges hardened at alpha 128 (the menus draw art Pixelated;
  `--soft` keeps them) -> `art/vendor/roblox/robux-icon.png`.
- `art/atlases.json` `images` entry `ui.icon.robux` (`crop: none`, `rgb: white`, name `ui-robux`) -> `art/upload/ui-robux.png`
  and the `VALE_IMAGE_LAYOUTS` entry (14 x 14; written by hand to match what `--only ui.icon.robux` generates).
- vale manifest: `ROBUX_ICON_ID` is an optional image (absent until `ui-robux.png` has an id in `assetIds.ts`, never a
  placeholder). `valeRobuxIcon.spec.ts` pins the layout, the absent and uploaded cases and the bundled state.
- Drawn by the existing path: `GetSilverPanel` shows it when the pack has it and the buttons are on their art; it is
  the skinned button's glyph (`IconLabel`, tinted like the text) and the label drops the word Robux (`55`).
- Done 2026-11-14: the owner copied robux@3x.png (108 x 108); built at 14 x 14 (12 broke the hexagon ring at its
  corners, soft edges read grey); `ui-robux.png` uploaded and in `assetIds.ts`, so the bundled vale pack draws it. To
  rebuild: (1) `mkdir -p art/vendor/roblox && cp
  /Applications/RobloxStudio.app/Contents/Resources/content/textures/ui/common/robux@3x.png art/vendor/roblox/`;
  (2) `python3 scripts/art/roblox/prep_robux_icon.py`; (3) `node scripts/art/build-atlases.js --only ui.icon.robux` and
  `--lock --only ui.icon.robux` (if the generated layout differs from the hand-written 14 x 14, keep the generated one);
  (4) upload `art/upload/ui-robux.png`, paste its id into `packs/vale/assetIds.ts` as `"ui-robux.png"`; (5) Studio: the
  icon beside each price, white and crisp at every HUD scale.

### Changed and not changed

- **No sim, dungeon, lockstep, hash, replay, fixture, score or leaderboard change.** `DAILY.ruleset` unchanged.
- **Wallet doc:** `bought`, `receipts`, unknown-field pass-through; `v` stays 1.
- **Earn side, ladder, catalogue:** unchanged (SHD3).

### Verify as run (2026-11-14, the VM)

typecheck, lint, check:assets, check:autolocalize, test:art (318 pass, 5 skipped: vendor packs), test:checks (12),
test:l10n (36), build: all pass. Lune: 372 spec files under shared/wallet, theme, view, onboarding, l10n, run,
characters, lobby, silver, play, codex, records, plus sim/rng and sim/silver: all pass. Not run: the known VM timeouts
and censuses (roomEdges, minimap/tiles, affixes.census, roomPool.lock, snagCensus, enemyBullets.census), the rest of
sim / dungeon (unchanged).

## Tasks

- [ ] **SH0. [owner] Confirm in Studio.** `Enum.ReceiptType.DeveloperProduct`, `Enum.ReceiptDecision` /
  `Enum.ProductPurchaseDecision` as used; that BindReceiptHandler fires for a mocked purchase and honours the product id
  filter; the receipt fields' types; `GetProductInfoAsync`'s `PriceInRobux` on the client; `PromptProductPurchaseFinished`'s
  arguments; the pad over Roblox's prompt (`CorePromptGuard`); console prompts; any refund / reversal signal; one
  universe or a test universe. Results in docs/SPIKES.md.
- [x] **SH1. Wallet codec forward compatibility.**
- [x] **SH2. Packs and the purchase transform.**
- [x] **SH3. SilverShopService.**
- [x] **SH4. Theme.**
- [x] **SH5. Client controller and store.**
- [x] **SH6. Get Silver panel and the two `+` buttons.**
- [x] **SH7. Telemetry.**
- [x] **SH8. Docs.** This file, docs/SILVER.md, docs/SERVER.md, docs/CLIENT.md, CLAUDE.md.
- [x] **SH10. Robux icon.** Wired (prep script, atlas entry, layout, manifest, spec), built at 14 x 14 and uploaded
  2026-11-14 (`ui-robux.png`, `assetIds.ts`); the Studio look is part of the Studio check.
- [ ] **SH9. [owner] Products and checks.** **First ship the codec (SH1) and restart every server** (SHD7). Then create
  the four developer products in Creator Hub (name, icon, description, translations) at 20 / 55 / 115 / 265 Robux;
  paste their ids into `SILVER_PRODUCTS` under the universe's `GameId` (shared/wallet `shop.ts`); publish; run the
  Studio check, the Dynamic Price Check, decide OC6; one real Pouch on the published place; check the Monetization and
  economy dashboards.

## Studio check

1. `KV_FakeShop` unset, no products for the universe: no `+` beside either balance.
2. `KV_FakeShop = "20,55,115,265"`: the `+` on the main menu and in the Armory; the panel shows the four prices; a press
   grants (`Adding Silver...`, `+150 Silver`, the balance up), the Armory's next-goal marks move.
3. Products configured: the prices come from Roblox; a mocked purchase grants once; cancel changes nothing; close the
   panel before the push: a toast.
4. `KV_FakeWallet = "unknown"`: no `+` on either screen.
5. Buy, then leave before the push: rejoin, the Silver is there once.
6. Pad only: reach the main menu's `+`, A on a card, Roblox's prompt takes the pad, B returns to the `+`. Touch upright
   and landscape on the smallest phone. A long translated pack name in Roblox's prompt.
7. A run, a death, the Archer's locked card, the character screen, the draft: no shop anywhere.
8. Published place, a real Pouch: the audit entry, the Monetization dashboard's sale, the IAP Source apart from Gameplay.
9. Look first at: the codec rollout, a receipt racing a run grant on the same player, the pad over Roblox's prompt, the
   main menu's balance row on the smallest phone.

## Decisions

- **SHD1. One pool** (owner, 2026-11-14). Bought Silver buys everything earned Silver buys, power included.
- **SHD2. A receipt is a wallet transaction:** the `PurchaseId` ring lives in the wallet doc, written in the same
  UpdateAsync as the Silver; `Processed` only after commit or for a duplicate.
- **SHD3. Selling Silver never lowers what play pays** or raises a price.
- **SHD4. Receipts grant whether or not the buyer is still on the server, and whether or not the join load worked.**
- **SHD5. Calm selling:** two entry points, a quiet `+` beside the Armory's and the main menu's balance (owner,
  2026-11-14); equal cards; no timers, sales, ribbons, badges, animation or shortfall prompts; Roblox's prompt is the
  only confirm.
- **SHD6. Silver never buys a random reward** (or PolicyService gating comes first).
- **SHD7. The codec's forward compatibility ships alone and first,** live on every server before any product id.
- **SHD8. Prices are Roblox's** (default 20 / 55 / 115 / 265 Robux, owner 2026-11-14), read per player; the Silver per
  pack is fixed in code.
- **SHD9. Bought Silver is its own field** (`bought`); `earned` stays "earned by play".
- **SHD10. No refunds or reversals in code** unless SH0 finds a signal; support uses the audit store.
- **SHD11. Purchase analytics are logged only while the buyer is on the server** (AnalyticsService takes a Player); a
  grant for a buyer who left is in the audit store and Roblox's own sales data.

## Risks

- **Pay to win on boards** (SHD1): bought power closes the same small gap faster (the power tree for about 320 Robux).
  Power stops at tier 5 (SVD23). Lever: OC7.
- **Young buyers.** Roblox's parental controls apply; ours is SHD5. Watch purchases in the first 3 runs and the main
  menu's share; lever: hide the main menu `+` for accounts in their first runs.
- **Old servers erasing `bought`** (fact 1): SHD7.
- **Lost or double Silver**: SHD2, redelivery, the audit store; Studio check 5.
- **Future randomness bought with Silver** (draft rerolls on docs/SILVER.md's Later list): SHD6.

## Later

- Gifting Silver (needs `GetUsersPriceLevelsAsync` for regional prices).
- A cosmetic-only subscription or season pass.
- Rewarded video ads for Silver (receipts arrive through the same handler); Roblox restricts these for younger users.

## Sources

- MarketplaceService: https://create.roblox.com/docs/reference/engine/classes/MarketplaceService
- Developer products: https://create.roblox.com/docs/production/monetization/developer-products
- Regional pricing: https://create.roblox.com/docs/production/monetization/regional-pricing
- Price optimisation: https://create.roblox.com/docs/production/monetization/price-optimization
- Monetization guidelines: https://create.roblox.com/docs/en-us/production/monetization
