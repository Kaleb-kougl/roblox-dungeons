/*
 * Ported from Dungeon Forge (https://github.com/majidmanzarpour/threejs-procedural-dungeon), src/main.js.
 * MIT License. Copyright (c) 2026 Majid Manzarpour.
 * Full license text: THIRD_PARTY_NOTICES.md at the repository root.
 *
 * Roblox port of project-kaleb-vale src/dungeon/forge/themes.ts @ 42897e2 (data unchanged).
 */
import { imul, u32 } from "shared/jsmath";
import type { RoomType, ThemeKey } from "./types";

/*
 * Theme specs, pure data. The generator reads only the "generation flags" (pools, lakes,
 * graveyards, icicles, roots, bones) and the name pools: they change the layout and the RNG
 * stream, so they are part of seed parity. The colors and lighting are the demo's look,
 * kept as reference data; Kaleb-Vale's art comes from theme packs (shared/theme), not from here.
 */

export interface ForgePoolSpec {
	/** 0 lava, 1 frost lake, 2 water, 3 miasma. */
	mode: 0 | 1 | 2 | 3;
	colA: number;
	colB: number;
	glow: number;
	/** Fraction of eligible wall cells turned into liquid pockets. */
	amount: number;
	/** Max interior liquid pits per combat/elite room. */
	pits?: number;
}

export interface ForgeTheme {
	label: string;
	accent: string;
	bg: number;
	fog: number;
	fogD: number;
	hemi: [number, number, number];
	dir: [number, number];
	floor: number;
	corridor: number;
	wall: number;
	cap: number;
	pillar: number;
	debris: [number, number];
	flame: number;
	flameCore: number;
	torchLight: [number, number, number];
	cloth: number;
	/** undefined: no liquid (the original's null). */
	pools?: ForgePoolSpec;
	particles: { kind: number; color: number; n: number };
	lakes?: boolean;
	icicles?: boolean;
	graveyards?: boolean;
	bones?: boolean;
	roots?: boolean;
	shafts?: boolean;
	nameA: ReadonlyArray<string>;
	nameB: ReadonlyArray<string>;
}

export const THEMES: Readonly<Record<ThemeKey, ForgeTheme>> = {
	ancient: {
		label: "ANCIENT",
		accent: "#e8973f",
		bg: 0x07080d,
		fog: 0x07080d,
		fogD: 0.0021,
		hemi: [0x2e3a52, 0x0a0b10, 0.55],
		dir: [0xffe8c8, 0.85],
		floor: 0x8a8f9c,
		corridor: 0x6d7380,
		wall: 0x5c626e,
		cap: 0x757b88,
		pillar: 0x6a707e,
		debris: [0x4c515e, 0x60584a],
		flame: 0xffa640,
		flameCore: 0xfff3c8,
		torchLight: [0xff8c3a, 1.5, 9.5],
		cloth: 0x7d2c26,
		particles: { kind: 0, color: 0xaab4cc, n: 110 },
		nameA: ["Sunken", "Forgotten", "Silent", "Hollow", "Elder", "Broken", "Nameless", "Fallen"],
		nameB: ["Halls", "Vaults", "Catacombs", "Depths", "Sanctum", "Undercroft", "Barrows", "Reliquary"],
	},
	molten: {
		label: "MOLTEN",
		accent: "#ff8642",
		bg: 0x0c0605,
		fog: 0x1a0b04,
		fogD: 0.0028,
		hemi: [0x6b3419, 0x160503, 0.55],
		dir: [0xffd9b0, 0.5],
		floor: 0x7a685c,
		corridor: 0x614f44,
		wall: 0x503e34,
		cap: 0x6b5546,
		pillar: 0x5e4a3e,
		debris: [0x4a382e, 0x60462f],
		flame: 0xff8c26,
		flameCore: 0xffe9b0,
		torchLight: [0xff7326, 1.7, 10],
		cloth: 0x7d2416,
		pools: { mode: 0, colA: 0x2b0d05, colB: 0xff5a1f, glow: 1.55, amount: 0.16, pits: 2 },
		particles: { kind: 1, color: 0xffa050, n: 240 },
		nameA: ["Molten", "Ashen", "Cindered", "Smouldering", "Charred", "Burning", "Ember", "Scorched"],
		nameB: ["Forges", "Furnaces", "Calderas", "Foundry", "Kilns", "Vents", "Crucible", "Depths"],
	},
	frost: {
		label: "FROST",
		accent: "#7fd4ff",
		bg: 0x060a12,
		fog: 0x0b1522,
		fogD: 0.0024,
		hemi: [0x3a5a80, 0x0a0e18, 0.5],
		dir: [0xcfe4ff, 0.82],
		floor: 0x93a0b2,
		corridor: 0x78848f,
		wall: 0x60708a,
		cap: 0x8194ac,
		pillar: 0x70809a,
		debris: [0x55617a, 0x6d7a90],
		flame: 0x86d9ff,
		flameCore: 0xe8f7ff,
		torchLight: [0x6fc4ff, 1.35, 9.5],
		cloth: 0x2b4d70,
		pools: { mode: 1, colA: 0x4a86c0, colB: 0xbfe4ff, glow: 0.55, amount: 0 },
		lakes: true,
		icicles: true,
		particles: { kind: 2, color: 0xdff0ff, n: 260 },
		nameA: ["Frozen", "Rimebound", "Glacial", "Howling", "Pale", "Shivering", "Wintered", "Whitelocked"],
		nameB: ["Crypts", "Caverns", "Hollows", "Galleries", "Sepulchre", "Warrens", "Reaches", "Throat"],
	},
	grim: {
		label: "GRIM",
		accent: "#9fe66a",
		bg: 0x070a07,
		fog: 0x0a130a,
		fogD: 0.003,
		hemi: [0x2c4030, 0x070a06, 0.52],
		dir: [0xbfd8b0, 0.45],
		floor: 0x7c8276,
		corridor: 0x62685c,
		wall: 0x4f5549,
		cap: 0x666c5e,
		pillar: 0x5c6254,
		debris: [0x4a4f44, 0x5e5c48],
		flame: 0x8fe05a,
		flameCore: 0xe9ffd0,
		torchLight: [0x77d94a, 1.35, 9],
		cloth: 0x33461f,
		pools: { mode: 3, colA: 0x0a1207, colB: 0x41602c, glow: 0.6, amount: 0.05, pits: 1 },
		graveyards: true,
		bones: true,
		particles: { kind: 3, color: 0x9fe66a, n: 150 },
		nameA: ["Blighted", "Weeping", "Rotting", "Cursed", "Umbral", "Plagued", "Mournful", "Grim"],
		nameB: ["Necropolis", "Ossuary", "Tombs", "Charnels", "Graves", "Catacombs", "Morgue", "Crypts"],
	},
	verdant: {
		label: "VERDANT",
		accent: "#59d68f",
		bg: 0x060c09,
		fog: 0x091510,
		fogD: 0.0023,
		hemi: [0x2f5a46, 0x08120c, 0.6],
		dir: [0xd8f0c8, 0.8],
		floor: 0x848e7e,
		corridor: 0x6a7560,
		wall: 0x556050,
		cap: 0x6e7a66,
		pillar: 0x606c5c,
		debris: [0x49543f, 0x5c644c],
		flame: 0x62e0a8,
		flameCore: 0xe6fff0,
		torchLight: [0x4ad98e, 1.3, 9],
		cloth: 0x1f5038,
		pools: { mode: 2, colA: 0x0c3532, colB: 0x2fa38a, glow: 0.6, amount: 0.05, pits: 1 },
		roots: true,
		shafts: true,
		particles: { kind: 4, color: 0x8fe6b8, n: 200 },
		nameA: ["Verdant", "Overgrown", "Sporebound", "Tangled", "Mossgrown", "Waking", "Feral", "Blooming"],
		nameB: ["Gardens", "Warrens", "Roots", "Conservatory", "Hollows", "Groves", "Cisterns", "Arbors"],
	},
};

/** Key order matters: the AUTO theme indexes into it. */
export const THEME_KEYS: ReadonlyArray<ThemeKey> = ["ancient", "molten", "frost", "grim", "verdant"];

const AUTO_THEME_XOR = 0x9e37;
const AUTO_THEME_MUL = 2654435761;

/** The demo's AUTO theme for a seed (its resolveTheme with themeSel === "auto"). */
export function resolveAutoTheme(seed: number): ThemeKey {
	// JS `seed ^ 0x9e37` is ToInt32(seed) ^ 0x9e37: the same low 32 bits as bit32.bxor on the uint32 view.
	return THEME_KEYS[imul(bit32.bxor(u32(seed), AUTO_THEME_XOR), AUTO_THEME_MUL) % THEME_KEYS.size()];
}

/** The demo's room-type tint colors (graph overlay / heatmap). */
export const ROOM_TINT: Readonly<Record<RoomType, number>> = {
	entrance: 0x3fd0bb,
	combat: 0x8f95a3,
	elite: 0x9b6cf0,
	treasure: 0xd9a441,
	shrine: 0x5a8fe8,
	boss: 0xd8433a,
};
