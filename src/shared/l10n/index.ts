/**
 * Barrel for localization (docs/LOCALIZATION.md): the locale table (locales.ts), the translation source hash
 * (hash.ts), developer-only and untranslated keys (devStrings.ts), the generated table type (localeTable.ts), picking
 * a locale (pick.ts), locale-aware number text (number.ts), the pseudo-locale (pseudo.ts) and fonts per script
 * (fonts.ts).
 *
 * Plain TypeScript, no Roblox APIs (headlessly tested). Never reached by the sim.
 */
export * from "./devStrings";
export * from "./hash";
export * from "./locales";
export * from "./localeTable";
export * from "./pick";
export * from "./number";
export * from "./pseudo";
export * from "./fonts";
