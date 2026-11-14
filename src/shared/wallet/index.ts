/**
 * Barrel for the wallet and the Armory (docs/SILVER.md SV2 / SV3 / SV4 / SV10): the price ladder and the append-only
 * catalogue (catalog.ts), the stored document `KV_Wallet_v1` with its codec and reads (doc.ts), the pure transforms
 * WalletService runs inside UpdateAsync (transforms.ts), the Studio fake (fake.ts), the `wallet` payload (status.ts),
 * the grant plan at the verdict (grants.ts) and the economy telemetry builders (analytics.ts). Plain TypeScript,
 * headlessly tested; WalletService is a thin shell around it.
 */
export * from "./config";
export * from "./catalog";
export * from "./doc";
export * from "./transforms";
export * from "./fake";
export * from "./status";
export * from "./grants";
export * from "./analytics";
export * from "./book";
