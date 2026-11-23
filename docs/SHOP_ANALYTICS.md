# Shop analytics

One custom event, `Purchase`, says what players buy: its kind, the currency paid and the item, for everything the
game sells. Built 2026-11-22 (PU1-PU5, PU7). Tasks **PU0-PU9**, decisions **PUD1-PUD7**.

No gameplay change: no sim, hash group, wire format, ruleset, fixture or remote is touched. Server telemetry only;
nothing grants, refuses or counts from it.

## Why

Before this, what was bought was spread over events of different shapes, and one kind of purchase logged nothing:

| Purchase | Paid with | Event before | What it said about the item |
|---|---|---|---|
| Armory upgrade, Archer unlock, Silver cosmetic | Silver | `ArmoryPurchase` + an economy Sink | item id, tier, level, value = price |
| Silver pack | Robux (developer product) | `SilverShop` step `granted` + an economy Source | the pack, value = the Silver |
| Prismatic dye | Robux (game pass) | none | nothing (docs/COSMETICS.md CS12 was open) |

`ArmoryPurchase` uses all three field slots, so "cosmetics against upgrades" could only be charted by picking item
ids one by one, and a Silver pack could not be set beside a dye at all.

## The event

`Purchase` (`WALLET_ANALYTICS_EVENT.purchase`, builders in `shared/wallet/purchaseAnalytics.ts`):

| Field | Values |
|---|---|
| field01, the kind | `upgrade` / `unlock` / `cosmetic` (the catalogue item's own kind), `silverPack` |
| field02, the currency | `silver`, or `robux` (a Robux-only item's game pass, a Silver pack's developer product) |
| field03, the item | the catalogue id (`dye.knight.prismatic`), or a pack's economy SKU (`silverPack.purse`) |
| value | 1 |

Logged by the server, once per thing bought:

| Where | When |
|---|---|
| `WalletService.afterRequest` | a `walletBuy` that committed, beside `ArmoryPurchase` |
| `SilverShopService` | a granted receipt, beside `SilverShop` `granted` (a duplicate receipt logs nothing) |
| `CosmeticPassService.grant` | a game-pass grant that committed, from the purchase prompt or the join check |

The older events keep their names, fields and values.

## Which chart answers which question

- **What do players buy, by kind or by item?** `Purchase`, broken down by field01, then field03 within a kind.
- **Silver or Robux?** `Purchase` by field02.
- **How much Silver is spent on an item?** The economy Sink by SKU, or `ArmoryPurchase`'s value.
- **Which upgrade level, which price tier?** `ArmoryPurchase` field03 / field02.
- **Where do pack buyers drop out?** `SilverShop` by step.
- **Robux revenue?** Roblox's own sales data. The prices are Roblox's and never in code.

A pack bought now appears three times (`SilverShop` `granted`, the economy Source, `Purchase`) and an Armory
purchase three times (`ArmoryPurchase`, the economy Sink, `Purchase`): they are the same purchase seen by three
charts, never to be added together.

## Decisions

- **PUD1. One new event; the existing ones are untouched**, so no dashboard built on them breaks. One name and
  kinds x currencies x items combinations under the catalogue's counting rule (docs/FACTS.md has the totals).
- **PUD2. The value is a count, not a price.** Silver prices and Robux prices cannot be summed in one chart.
- **PUD3. A game-pass item logs when the wallet grant commits**, whether it came from the in-game prompt or the
  join check. `grantPass` writes only when the item is not owned, so each pass logs once per player; a pass bought
  on the website, or one whose confirmation was lost, is counted at the buyer's next join, the only moment the game
  learns of it.
- **PUD4. The labels come from the catalogue, not the caller**: `armoryItem(id).kind`, and `robux` when
  `isRobuxItem`. `purchaseAnalytics.spec.ts` walks every catalogue item; an id the catalogue does not know logs
  nothing.
- **PUD5. Logged only while the buyer is on the server** (docs/SILVER_SHOP.md SHD11): AnalyticsService takes a
  Player.
- **PUD6. Log text is frozen.** No existing line changes; the debug echo prints the new event on the existing
  `ANALYTICS` line.
- **PUD7. This closes docs/COSMETICS.md CS12 for purchases only.** Views, try-ons and the pass prompt's
  cancellations are open (OC1, OC2).

## Open owner calls

- **OC1. A funnel for the game-pass prompt** (`prompted` / `cancelled` / `bought`, as `SilverShop` has). It needs a
  client remote with a limiter and a reader. Suggested: once `Purchase` shows whether passes sell.
- **OC2. Interest before purchase** (which cosmetics are focused or tried on, which upgrade rows are opened).
  Client-reported and high volume; it needs a once-per-session cap.
- **OC3. The field labels are permanent in Roblox's table** once a published build logs them. Rename `upgrade` /
  `unlock` / `cosmetic` / `silverPack` / `silver` / `robux` before publishing or not at all.

## Tasks

- [x] **PU0. Baseline.** Branch `shop-analytics` from `main` @ `8aa94bd7`.
- [x] **PU1. `shared/wallet/purchaseAnalytics.ts`** with its spec: `itemPurchaseEvent`, `packPurchaseEvent`,
  `purchaseFieldValues`, `PURCHASE_KINDS`, `PURCHASE_CURRENCIES`.
- [x] **PU2. The analytics catalogue**: the `Purchase` entry, the name count (40), a spec case that every builder's
  event is inside the entry's field sets; docs/FACTS.md regenerated.
- [x] **PU3. Armory purchases** (`WalletService.afterRequest`).
- [x] **PU4. Silver packs** (`SilverShopService`).
- [x] **PU5. Game passes** (`CosmeticPassService`, PUD3; it now takes `TelemetryService`).
- [ ] **PU6. Continues.** With docs/CONTINUE.md: a `continue` kind and item, logged beside `ContinueOffer`
  `granted`. Part of the Continue pull request, which lands after this one.
- [x] **PU7. Record.** This file, the docs/DECISIONS.md entry, the `CLAUDE.md` row, the `docs/README.md` line,
  pointers from docs/SILVER.md, docs/SILVER_SHOP.md and docs/COSMETICS.md.
- [ ] **PU8. [owner] Studio check.** With the analytics debug echo on (`ANALYTICS_DEBUG_ATTRIBUTE`) and
  `KV_FakeShop` / `KV_FakePasses` priced: buy an upgrade level, a Silver dye, a pack and a Prismatic dye. Four
  `Purchase` lines, one each, with the kind, currency and item expected; the older events still appear beside
  them. Rejoin: the Prismatic dye logs nothing a second time.
- [ ] **PU9. [owner] Dashboard.** After a day on the published place: Creator Hub > Analytics > Custom events >
  `Purchase`, broken down by field01, then by field03 within `cosmetic`.

## Risk

- **PU3 to PU5 have no spec**: the handlers are engine wiring. PU8 is their check.
- **PU5 adds a dependency** (`CosmeticPassService` on `TelemetryService`). It logs after the grant and the push,
  and `logEvents` catches a failing call, so telemetry cannot hold up either.
