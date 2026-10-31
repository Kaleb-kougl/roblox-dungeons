/**
 * Barrel for first sightings (docs/ENEMY_VARIANTS.md EV12): which new enemies / affixes the watched view shows and the
 * one-at-a-time toast queue over the account's seen set (sighting.ts), and their tunables (config.ts). Pure, tested
 * headlessly; the client's SightingController draws the toast and reports the sighting.
 */
export * from "./config";
export * from "./sighting";
