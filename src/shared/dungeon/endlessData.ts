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
	/** First floor whose rooms may buy this kind (absent: every floor). Below it the spender skips the kind entirely. */
	readonly fromFloor?: number;
	/** Most of this kind one room buys (absent: only ENDLESS_ROOM_ACTOR_CAP limits it). */
	readonly maxPerRoom?: number;
	/**
	 * True: never a room's first buy (docs/NEW_ENEMIES.md NED9, the Warbanner buffs its room's other enemies). The
	 * spender opens the kind only once the room has bought at least one enemy (of any kind); no draw.
	 */
	readonly needsCompany?: boolean;
}

/**
 * Unlock floors of the docs/ENEMY_VARIANTS.md room enemies (EVD2: 2 / 4 / 6, faster than the recommended 3 / 6 / 8).
 * Floor 1 buys only the original three, draw for draw as before (dungeon/roomPool.lock.spec.ts, without a roster); the
 * seeded roster (ROSTER) closes more kinds on top of these and never lets one in before its unlock floor.
 */
export const ROOM_KIND_UNLOCK_FLOOR = table.freeze({
	imp: 2,
	slime: 4,
	summoner: 6,
	// docs/NEW_ENEMIES.md NED3: the second set of room enemies, all from floor 2 (floor 1 spends as before).
	bomber: 2,
	charger: 2,
	stormcaller: 2,
	warbanner: 2,
	reaper: 2,
});

/** Summoners one room buys at most (EVD3: one support per room, whatever the budget or the party size). */
export const SUMMONERS_PER_ROOM = 1;

/**
 * Oozes one room buys at most (docs/NEW_ENEMIES.md NE7, the Ooze cap of the docs/ENEMY_VARIANTS.md "Owner calls from
 * EV13"): with ten seeded kinds a roster can hold the Ooze without the Bruiser deep into a run, and then a saturated
 * party room's no-draw fallback bought 16 Oozes (48 actor slots with their splits). Unlocked from floor 4, so floor 1
 * spends as before.
 */
export const OOZES_PER_ROOM = 8;

/**
 * Room maxima of the docs/NEW_ENEMIES.md room enemies (NE7): Bombers 4, Chargers / Stormcallers / Reapers 2, one
 * Warbanner (NED9: one support per room, like the summoner).
 */
export const NEW_KIND_MAX_PER_ROOM = table.freeze({ bomber: 4, charger: 2, stormcaller: 2, warbanner: 1, reaper: 2 });

/**
 * The room enemies of endless floors, in draw order. Turrets and the boss are not bought with room budgets. The first
 * three (and their weights 3 / 2 / 1) are the original pool and never change; the docs/ENEMY_VARIANTS.md kinds are
 * appended after them (EVD2), then the docs/NEW_ENEMIES.md kinds (NE7), and join only from their unlock floor, so
 * floors below every unlock spend as before.
 * Endless floors buy only the kinds of the run's seeded roster (ROSTER, ./endless.ts endlessRoster; docs/DAILY.md DS1).
 */
export const ENDLESS_ROOM_KINDS: ReadonlyArray<EndlessRoomKind> = [
	{ kind: "swarmer", weight: 3 },
	{ kind: "sniper", weight: 2 },
	{ kind: "bruiser", weight: 1 },
	{ kind: "imp", weight: 2, fromFloor: ROOM_KIND_UNLOCK_FLOOR.imp },
	{ kind: "slime", weight: 1, fromFloor: ROOM_KIND_UNLOCK_FLOOR.slime, maxPerRoom: OOZES_PER_ROOM },
	{ kind: "summoner", weight: 1, fromFloor: ROOM_KIND_UNLOCK_FLOOR.summoner, maxPerRoom: SUMMONERS_PER_ROOM },
	// docs/NEW_ENEMIES.md NE7 (NED3 weights 2 / 1 / 1 / 1 / 1, NED9 the Warbanner never a room's first buy).
	{ kind: "bomber", weight: 2, fromFloor: ROOM_KIND_UNLOCK_FLOOR.bomber, maxPerRoom: NEW_KIND_MAX_PER_ROOM.bomber },
	{
		kind: "charger",
		weight: 1,
		fromFloor: ROOM_KIND_UNLOCK_FLOOR.charger,
		maxPerRoom: NEW_KIND_MAX_PER_ROOM.charger,
	},
	{
		kind: "stormcaller",
		weight: 1,
		fromFloor: ROOM_KIND_UNLOCK_FLOOR.stormcaller,
		maxPerRoom: NEW_KIND_MAX_PER_ROOM.stormcaller,
	},
	{
		kind: "warbanner",
		weight: 1,
		fromFloor: ROOM_KIND_UNLOCK_FLOOR.warbanner,
		maxPerRoom: NEW_KIND_MAX_PER_ROOM.warbanner,
		needsCompany: true,
	},
	{ kind: "reaper", weight: 1, fromFloor: ROOM_KIND_UNLOCK_FLOOR.reaper, maxPerRoom: NEW_KIND_MAX_PER_ROOM.reaper },
];

/** Tunables of the seeded roster (docs/DAILY.md DS1, DSD1 / DSD2 / DSD9): which room kinds a run meets per floor. */
export interface RosterTunables {
	/** The kind every roster holds from floor 1 on (it is not shuffled). */
	readonly always: string;
	/**
	 * One more seeded kind joins every this many floors: the roster holds 1 + floor((floor - 1) / floorsPerKind) kinds
	 * besides `always` (capped at the kinds there are), each from its unlock floor (EndlessRoomKind.fromFloor) only.
	 */
	readonly floorsPerKind: number;
	/**
	 * The roster's own rng stream: new EncounterRng(u32(runSeed) ^ salt), one Fisher-Yates shuffle per run. Drawn from
	 * the RUN seed, so no floor's Forge, boss pick, breakables or affixes stream moves (salts in use: 0x27d4eb2f boss,
	 * 0x5bd1e995 breakables, 0xcc9e2d51 affixes, 0x4b564452 drops). xxHash32's PRIME32_5.
	 */
	readonly salt: number;
}

export const ROSTER: RosterTunables = table.freeze({ always: "swarmer", floorsPerKind: 2, salt: 0x165667b1 });

/**
 * Room enemies wider than half a tile (body radius > 0.5: the Ooze's 0.55, docs/ENEMY_VARIANTS.md EV0 item 14). A
 * body that size spawned on a tile centre beside a wall overlaps the wall and can stick, so the endless placer gives
 * them only tiles whose 8 neighbours are all FLOOR (./enemyRooms.ts isOpenTile); roomSpawnTiles already holds to
 * that except in a tiny room's fallback. Kept here as data so the dungeon need not read the sim's archetype table
 * (dungeon/roomPool.spec.ts checks it against the registered radii; the docs/NEW_ENEMIES.md kinds are 0.3-0.5, none
 * over half a tile, NE7). Affix radii (Hulking) are applied after
 * placement and are not covered.
 */
export const WIDE_BODY_KINDS: ReadonlySet<string> = new Set<string>(["slime"]);
