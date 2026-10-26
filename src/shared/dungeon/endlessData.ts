/**
 * Endless mode floor tunables (GDD "Endless mode" and "Dungeon generation and difficulty"): which floor gets which
 * layout, where the boss stands, and how much each room may spend on enemies. Data only; ./endless.ts reads it.
 * The sim-side numbers (enemy hp / bullet speed scaling, the stairwell radius) are in shared/sim endlessData.ts.
 */

/** The first floor of an endless run (floors are numbered from 1). */
export const ENDLESS_FIRST_FLOOR = 1;

/**
 * Floor seed mixer: floorSeed = ((runSeed >>> 0) ^ Math.imul(floor, FLOOR_SEED_MUL)) >>> 0, the style of
 * encounterRoomSeed with a different odd constant (murmur3's fmix 0x85ebca6b), so floor and room streams differ.
 */
export const FLOOR_SEED_MUL = 0x85ebca6b;

/**
 * Endless floors turn the Forge's pillars into solid 1-tile walls (ForgeParams.solidPillars, docs/DECOR.md D2): cover
 * that blocks movement, bullets and sight. M1 floors and the golden fixtures keep the demo's walk-through pillars.
 */
export const ENDLESS_SOLID_PILLARS = true;

/**
 * Endless floors' room size multiplier (ForgeParams.roomScale): every room is this many times as wide and as tall as
 * the M1 floor's (2 = four times the floor area). M1 floors and the golden fixtures stay at 1.
 */
export const ENDLESS_ROOM_SCALE = 2;

/** Rooms on floor 1 (the MVP floor's 12). */
export const ENDLESS_BASE_ROOM_COUNT = 12;
/** One more room every this many floors: roomCount = 12 + floor((floor - 1) / 5). */
export const ENDLESS_FLOORS_PER_EXTRA_ROOM = 5;
/** The room count stops growing here. */
export const ENDLESS_MAX_ROOM_COUNT = 16;

/**
 * Every this-many-th floor (5, 10, 15, ...) is a boss floor: a boss picked from ENDLESS_BOSSES waits in the boss room.
 */
export const BOSS_FLOOR_EVERY = 5;

/** A boss an endless boss floor may hold (archetype id) and its draw weight. */
export interface EndlessBossKind {
	readonly kind: string;
	readonly weight: number;
}

/**
 * The endless bosses, in draw order (docs/BOSS_DEMONLORD.md D5): each boss floor draws one by weight (./endless.ts
 * bossKindFor). Owner defaults: 50 / 50, any boss floor (floor 5 included) can be either, every floor an independent
 * draw (no no-repeat rule). M1 and the tutorial place Mother Bramble themselves and never read this.
 */
export const ENDLESS_BOSSES: ReadonlyArray<EndlessBossKind> = [
	{ kind: "boss.act1", weight: 1 },
	{ kind: "boss.demonlord", weight: 1 },
];

/** Tunables of the per-floor boss pick. */
export interface BossPickTunables {
	/**
	 * The pick's own rng stream: mulberry32 from (floor seed ^ salt), one draw. Like the breakables' (salt 0x5bd1e995,
	 * ./breakablesData.ts) it never touches the Forge's or a room encounter's stream, so the layout, its digest, the
	 * props, the room spawns and the breakables are the same whichever boss is picked. xxHash32's PRIME32_4.
	 */
	readonly salt: number;
}

export const BOSS_PICK: BossPickTunables = table.freeze({ salt: 0x27d4eb2f });

/** Encounter budget per combat room: ENCOUNTER_BUDGET_BASE + ENCOUNTER_BUDGET_PER_FLOOR x (floor - 1). */
export const ENCOUNTER_BUDGET_BASE = 6;
export const ENCOUNTER_BUDGET_PER_FLOOR = 1.2;
/** Elite rooms get this multiple of the combat budget. */
export const ELITE_BUDGET_MULTIPLIER = 1.5;

/**
 * Co-op (M4): a room's encounter budget x PARTY_BUDGET_MULTIPLIERS[n - 1] for a party of n (index 0 = solo, x1). The
 * bigger budget still spends into at most ENDLESS_ROOM_ACTOR_CAP enemies (spendEncounterBudget buys dearer ones once
 * the slots run short), and a full actor pool drops the rest of a room's spawns (no waves).
 */
export const PARTY_BUDGET_MULTIPLIERS: ReadonlyArray<number> = [1, 1.35, 1.7, 2.05, 2.25, 2.45, 2.65, 2.85];

/**
 * Most enemies one room spawns, whatever its budget (the sim's actor pool holds MAX_ACTORS = 64, and rooms spawn only
 * when the player first walks in, so a full room plus a straggler room still fits). Past ROOM_ACTOR_CAP x the dearest
 * cost the budget cannot be spent; the spender buys dearer enemies once the cheap ones would leave budget unspent.
 */
export const ENDLESS_ROOM_ACTOR_CAP = 16;

/** Swarmers spawn in packs of up to this many around one anchor tile. */
export const ENDLESS_PACK_SIZE = 4;

/** What a room's budget buys (archetype id and draw weight). Costs come from ENCOUNTER_COST (./encounterCost.ts). */
export interface EndlessRoomKind {
	readonly kind: string;
	readonly weight: number;
}

/** The room enemies of endless floors, in draw order. Turrets and the boss are not bought with room budgets. */
export const ENDLESS_ROOM_KINDS: ReadonlyArray<EndlessRoomKind> = [
	{ kind: "swarmer", weight: 3 },
	{ kind: "sniper", weight: 2 },
	{ kind: "bruiser", weight: 1 },
];
