# 6. A server-owned wallet of transactions

Status: built 2026-11-14 ([`../SILVER.md`](../SILVER.md) SVD5, [`../SILVER_SHOP.md`](../SILVER_SHOP.md) SHD2).

## Context

Silver is earned in runs, spent in the Armory and, since the Silver shop, bought with Robux. Three facts shape
the design. The simulation runs on the client, so a client's count of what it earned is a claim. Roblox may run
a player's writes from more than one server (a teleport, a shutdown, a purchase that lands after the buyer
left) and delivers a purchase receipt again until it is answered `Processed`. And the player documents that
already existed (records, the Codex) are a session cache saved when dirty and max-merged on write, which is
correct for a best score and wrong for a number that goes down.

## Options considered

SVD5 names the first ("Transactions, not dirty-saves"). The second and third were not weighed in writing; they are
the alternatives the facts above rule out.

- **The existing pattern: a cached document, dirty-saved and max-merged.** A balance cannot be max-merged: a
  spend would be undone by any stale copy.
- **Store a balance and let the client report earnings.** The server would have to trust the amount.
- **A separate receipts store** checked before granting. Two writes: a crash between them grants twice or
  never.
- **One document, changed only by transactions whose transform reads the stored value.**

## Decision

DataStore `KV_Wallet_v1` holds `earned`, `bought`, `spent`, what is owned, and two rings of ids. The balance is
`earned + bought - spent` and is never stored. Every change is one `UpdateAsync` whose pure transform runs on
the stored document, so concurrent servers compose.

- **Grants.** A run's Silver is a pure function of the replayed run, read in the validator's final check
  (SVD2). The grant is keyed on the server-issued run id; the transform cancels if the id is in the ring of the
  last 64. Day bonuses are decided inside the transform from the stored day, not from a session copy.
- **Receipts.** The `PurchaseId` is written to a ring of 128 in the same `UpdateAsync` that adds `bought`.
  A redelivered receipt finds its id and pays nothing. The handler answers `Processed` only for a committed
  grant or a duplicate; everything else answers `NotProcessedYet` and Roblox delivers again.
- **Purchases in the Armory.** The client sends an item id. The price is the server's, and the check runs
  against the stored document.
- **The client never writes a balance.** No remote carries an amount or a price. The session cache is a read
  copy, replaced by each transaction's result and never saved.

## Consequences

- A grant or a receipt is applied once across servers, crashes and redeliveries, and lands whether or not the
  player is still on the server or their join load worked (SHD4).
- Cost: one `UpdateAsync` per credited member per paying run, and one per purchase or equip.
- Idempotency is bounded by the rings. A run id older than the last 64 grants, or a `PurchaseId` older than
  the last 128, would not be recognised.
- A document written by a newer server is refused, not downgraded; a grant there is lost and logged (SVD34).
  Unknown fields are kept and written back, and that codec had to be live on every server before any product
  id was configured (SHD7).
- The run-over screen shows a predicted figure, then settles on the transaction's real breakdown.
- No refunds or reversals in code (SHD10); a best-effort audit entry per purchase exists for support.

## Evidence

- Code: [`transforms.ts`](../../src/shared/wallet/transforms.ts) `applyGrant`,
  [`shop.ts`](../../src/shared/wallet/shop.ts) `applyPurchase` / `receiptDecision`,
  [`book.ts`](../../src/shared/wallet/book.ts) `WalletBook`,
  [`WalletTransactions.ts`](../../src/server/services/data/WalletTransactions.ts),
  [`WalletService.ts`](../../src/server/services/WalletService.ts),
  [`SilverShopService.ts`](../../src/server/services/SilverShopService.ts),
  [`network.ts`](../../src/shared/network.ts) (`walletBuy(itemId)`, `walletEquip(slot, itemId)`).
- Specs: [`transforms.spec.ts`](../../src/shared/wallet/transforms.spec.ts) ("is idempotent per run id"),
  [`shopBook.spec.ts`](../../src/shared/wallet/shopBook.spec.ts) ("commit then crash: the redelivery finds the
  id and pays once"), [`docCompat.spec.ts`](../../src/shared/wallet/docCompat.spec.ts).
- Docs: [`../SILVER.md`](../SILVER.md) "Wallet (server)", SVD2, SVD5, SVD26, SVD34;
  [`../SILVER_SHOP.md`](../SILVER_SHOP.md) SHD2, SHD4, SHD7, SHD10.
- Log: [`../DECISIONS.md`](../DECISIONS.md), entries "Silver" and "Silver shop".
