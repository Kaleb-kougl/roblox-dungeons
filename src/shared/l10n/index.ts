/**
 * Barrel for localization (docs/LOCALIZATION.md): the locale table (locales.ts), the translation source hash
 * (hash.ts), developer-only keys (devStrings.ts) and the generated table type (localeTable.ts).
 *
 * Plain TypeScript, no Roblox APIs (headlessly tested). Never reached by the sim.
 */
export * from "./devStrings";
export * from "./hash";
export * from "./locales";
export * from "./localeTable";
