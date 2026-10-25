/*
 * Kaleb-Vale presets for the Dungeon Forge port.
 * Dungeon Forge: MIT License. Copyright (c) 2026 Majid Manzarpour.
 * Full license text: THIRD_PARTY_NOTICES.md at the repository root.
 *
 * Roblox port of project-kaleb-vale src/dungeon/forge/presets.ts @ 42897e2.
 */
import type { ForgeParams } from "./types";

/** The Dungeon Forge web demo's default sliders (rooms 42, loopiness 15%, decor 60%, AUTO theme). */
export const FORGE_DEMO_DEFAULT_PARAMS = {
	roomCount: 42,
	loopChance: 0.15,
	decorDensity: 0.6,
	themeKey: "auto",
} as const satisfies Omit<ForgeParams, "seed">;

/**
 * M1 floor: 12 rooms, 15% loopiness, 40% decor, plus all four Kaleb-Vale options ON.
 * The options change the layout, so a seed under this preset does NOT match the demo's floor
 * for that seed. Use as `generateDungeon({ seed, ...KALEB_VALE_MVP_PARAMS })`.
 */
export const KALEB_VALE_MVP_PARAMS = {
	roomCount: 12,
	loopChance: 0.15,
	decorDensity: 0.4,
	minCombatRoomSize: 8,
	corridorWidth: 3,
	treasureCap: 2,
	shrineCap: 1,
} as const satisfies Omit<ForgeParams, "seed">;
