/**
 * Test support for specs (never imported by the game): the endless-mode bot and its recorded run (endlessBot.ts), the
 * co-op party bot (partyBot.ts), the tutorial bot (tutorialBot.ts), and docs/ENEMY_VARIANTS.md EV13's enemy variants
 * TTK harness (variantTtk.ts) and actor-pool high-water estimate (poolHighWater.ts), and docs/BUILDS.md BU13's build
 * tuning harnesses (buildTune.ts: build TTK, kill probe, player bullet high-water; buildOffers.ts: offer statistics),
 * docs/TREASURE.md's vault runs (vaultRun.ts: the endless world with a forced VaultOverride, a start floor and an
 * optional treasure config), docs/FORTUNE.md's pact helpers (pactsBot.ts) and docs/LEGENDARIES.md LG7's legendary
 * tuning (legendaryTune.ts: Overkill TTK and chains, Bastion's defence rooms; the offer tallies in buildOffers.ts), and
 * docs/ARCHER.md AR13's per-character tuning (characterTune.ts: the character dimension, the fighter bot with its bow
 * mode, rooms by kind, the roll's reach; survivalBot.ts: the endless survival census),
 * the dense fight setup of the replay bench (denseFight.ts), and docs/WALL_SLIDE.md WS5's snag census (snagCensus.ts,
 * split over its shard specs).
 */
export * from "./endlessBot";
export * from "./partyBot";
export * from "./tutorialBot";
export * from "./variantTtk";
export * from "./poolHighWater";
export * from "./buildTune";
export * from "./buildOffers";
export * from "./vaultRun";
export * from "./pactsBot";
export * from "./legendaryTune";
export * from "./characterTune";
export * from "./survivalBot";
export * from "./denseFight";
export * from "./snagCensus";
