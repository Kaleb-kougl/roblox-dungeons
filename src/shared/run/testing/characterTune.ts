/**
 * Test support for specs (never imported by the game): docs/ARCHER.md AR13's tuning measurements, the character
 * dimension on BU13's / LG7's harnesses (./buildTune.ts: the arena, grantBuild, the census rooms; ./legendaryTune.ts:
 * the defence rooms). Measurements only: nothing here changes a rule or a number.
 *
 * Characters (TuneCharacter): "knight" and "archer" are built through the real character path (shared/run
 * withCharacters: the character's loadout and roll traits on the run config, which wins over the floor world's
 * loadout); "both" is the old two-weapon player (DEFAULT_LOADOUT, sword and bow, no traits: the pre-Archer endless
 * player, what buildEndlessRunConfig without characters still builds).
 *
 * The fighter (fighterFrame): one bot policy per character, shared by the arena TTK fights below and the endless
 * survival bot (./survivalBot.ts). Every mode rolls by the SAME rule (the volley roll): not rolling, ROLL not pressed
 * last tick, and at least FIGHT_ROLL_BULLETS enemy bullets (goo puddles not counted) within FIGHT_ROLL_RADIUS: a roll
 * toward the nearest of them (into the volley, so the i-frames carry the body through; LG7's roll bot).
 *   knight  the sword: walks in to TUNE_SWORD_CLOSE and holds FIRE in reach (the full combo); guards (an ALT press)
 *           when the guard is ready and an enemy bullet is within DEFENSE_GUARD_TRIGGER (LG7's guard bot); the
 *           volley roll only while the guard is on cooldown
 *   archer  the bow ("bow mode"): kites at TUNE_BOW_DISTANCE in line of sight, strafing and leading its target
 *           (tuneBotFrame's bow movement); CHARGES heavy shots back to back (ALT held to full charge, released, held
 *           again: the charge may start during the stream's heavyRecoverTicks) while the target has more than
 *           ARCHER_STREAM_HP hp, no enemy is within ARCHER_CHARGE_SAFE and no enemy bullet within
 *           ARCHER_CHARGE_BULLET_RADIUS, else streams (FIRE); a charge is dropped
 *           when an enemy comes within ARCHER_CHARGE_ABORT; the volley roll, and a roll straight away from any enemy
 *           body within ARCHER_PANIC_RADIUS (a rusher in contact)
 *   archer-stream  the archer's movement and rolls, the stream only (no charged shots; BU13's bow numbers)
 *   both    the old swap player: walks in like the knight; holds the bow (streaming as it closes) while its target is
 *           beyond SWAP_TO_BOW and the sword inside SWAP_TO_SWORD (one SWAP press edge per change, hysteresis between);
 *           guards with the sword in hand like the knight; the volley roll
 * Out of line of sight (FightEnv.sees false: walls, pillars) every mode walks the dungeon path toward its target
 * (FightEnv.pathDir) and holds its fire. In an arena both are trivial (always in sight, straight line).
 *
 * Arena TTK (characterFight / characterTtkRows): buildTune.ts's open endless arena (builds and affixes on, no drops),
 * solo, god mode (hearts refilled after every step; hits that landed counted), a build granted before tick 0, the
 * floor's hp from the state's endless floor / Depth (spawnActor scales every actor). Fights: KIND_ROOMS (one room per
 * endless room kind, the turret pairs of LG7's defence rooms included: a turret room "clears" the first tick both are
 * dead at once, they revive after 6 s), TUNE_PACK, the census mixed rooms (tuneCensusRoom), Mother Mayhem (TUNE_BOSS)
 * and the Demon Lord (TUNE_DEMONLORD). The target is the nearest living actor.
 *
 * The roll (rollReach): Blazing Trail's embers and Wrecker's smash along one roll on open ground, per character.
 */
import { AffixKind, TileType, gridToWorld, tileAt, type BreakablePlacement } from "shared/dungeon";
import type { CharacterId } from "shared/characters";
import {
	BOSS_ACT1_ID,
	BOSS_DEMONLORD_ID,
	BOW_DATA,
	BOW_V_CHARGE,
	BREAKABLES_CONFIG,
	BUILDS_CONFIG,
	Boon,
	NOT_BROKEN,
	ROLL_TICKS,
	BulletKind,
	BulletPayload,
	Button,
	DEFAULT_LOADOUT,
	EMPTY_INPUT,
	NO_KIND,
	SIM_HZ,
	SWORD_DATA,
	SWORD_WEAPON_ID,
	SimCtx,
	archetypeIndex,
	bowChargeTicks,
	createSimState,
	simWorldConfig,
	spawnActor,
	step,
	weaponIndex,
	weaponsAt,
	type ActorState,
	type InputFrame,
	type PlayerState,
	type SimConfig,
	type SimState,
} from "shared/sim";
import { withCharacters } from "../characters";
import { endlessRunFloor } from "../endless";
import {
	TUNE_BOW_DISTANCE,
	TUNE_BOW_STRAFE,
	TUNE_BOW_STRAFE_TICKS,
	TUNE_EDGE_MARGIN,
	TUNE_SWORD_CLOSE,
	BUILD_TTK_CASES,
	anyLiving,
	boonLevels,
	arenaConfig,
	grantBuild,
	nearestLiving,
	type BuildCase,
	type TuneFight,
	type TuneFloor,
	type TuneSpawn,
} from "./buildTune";
import { frame } from "./endlessBot";
import { DEFENSE_GUARD_TRIGGER, DEFENSE_ROLL_BULLETS, DEFENSE_ROLL_RADIUS } from "./legendaryTune";

// ---------------------------------------------------------------------------------------------
// Characters

/** A character of the AR13 tables: the Knight, the Archer, or the old two-weapon player ("both"). */
export type TuneCharacter = CharacterId | "both";

export const TUNE_CHARACTERS: ReadonlyArray<TuneCharacter> = ["knight", "archer", "both"];

/** `config` as `who` plays it (file comment): withCharacters for a character, DEFAULT_LOADOUT and no traits for "both". */
export function characterConfig(config: SimConfig, who: TuneCharacter): SimConfig {
	return who === "both" ? { ...config, loadout: DEFAULT_LOADOUT } : withCharacters(config, [who]);
}

/** The fighter mode of a character (file comment). */
export type FighterMode = "knight" | "archer" | "archer-stream" | "both";

export function fighterModeOf(who: TuneCharacter): FighterMode {
	return who;
}

// ---------------------------------------------------------------------------------------------
// The fighter

/** The volley roll: this many enemy bullets within FIGHT_ROLL_RADIUS (LG7's roll bot's numbers). */
export const FIGHT_ROLL_BULLETS = DEFENSE_ROLL_BULLETS;
export const FIGHT_ROLL_RADIUS = DEFENSE_ROLL_RADIUS;
/** The archer streams at a target with at most this much hp (2 stream arrows), else charges. */
export const ARCHER_STREAM_HP = 2;
/** The archer starts a charge only with no enemy within this distance, and drops it inside ARCHER_CHARGE_ABORT. */
export const ARCHER_CHARGE_SAFE = 3;
export const ARCHER_CHARGE_ABORT = 2;
/** ... and with no enemy bullet within this distance (under fire the archer streams). */
export const ARCHER_CHARGE_BULLET_RADIUS = 2.5;
/** An enemy body this close (centre distance minus its radius) makes the archer roll straight away from it. */
export const ARCHER_PANIC_RADIUS = 1;
/** The swap player takes the bow beyond SWAP_TO_BOW and the sword inside SWAP_TO_SWORD (centre distance). */
export const SWAP_TO_BOW = 4.5;
export const SWAP_TO_SWORD = 3;

/** What the fighter needs from its surroundings: sight and a path (an arena: always in sight, a straight line). */
export interface FightEnv {
	/** Arena half size for the bow's edge pull (0: none, a real floor). */
	readonly half: number;
	readonly sees: (x1: number, z1: number, x2: number, z2: number) => boolean;
	/** Unit walk direction toward (tx, tz) along the floor's paths. */
	readonly pathDir: (x: number, z: number, tx: number, tz: number) => readonly [number, number];
}

export function arenaEnv(half: number): FightEnv {
	return {
		half,
		sees: () => true,
		pathDir: (x, z, tx, tz) => {
			const dx = tx - x;
			const dz = tz - z;
			const d = math.sqrt(dx * dx + dz * dz);
			return d > 1e-9 ? [dx / d, dz / d] : [0, 0];
		},
	};
}

/** Per-fight memory of the fighter, and what it did (tallies). */
export interface FighterMemory {
	rollPressed: boolean;
	altPressed: boolean;
	swapPressed: boolean;
	charging: boolean;
	rolls: number;
	volleyRolls: number;
	panicRolls: number;
	guards: number;
	charges: number;
	heavies: number;
	swaps: number;
}

export function newFighterMemory(): FighterMemory {
	return {
		rollPressed: false,
		altPressed: false,
		swapPressed: false,
		charging: false,
		rolls: 0,
		volleyRolls: 0,
		panicRolls: 0,
		guards: 0,
		charges: 0,
		heavies: 0,
		swaps: 0,
	};
}

/** Enemy bullets within `r` of (x, z) (goo puddles not counted) and the nearest one's offset. */
export function threatBullets(s: SimState, x: number, z: number, r: number): [number, number, number] {
	let n = 0;
	let best = math.huge;
	let bx = 0;
	let bz = 0;
	const r2 = r * r;
	s.combat.enemyBullets.forEachActive((_i, pos, payload) => {
		const dx = pos.x - x;
		const dz = pos.z - z;
		const d2 = dx * dx + dz * dz;
		if (d2 > r2 || BulletPayload.get(payload, "kind") === BulletKind.GOO) return;
		n++;
		if (d2 < best) {
			best = d2;
			bx = dx;
			bz = dz;
		}
	});
	return [n, bx, bz];
}

/** The nearest living enemy body to `p` (edge distance: centre distance minus its radius), or undefined. */
function nearestBody(s: SimState, p: Readonly<PlayerState>): [ActorState | undefined, number] {
	let best: ActorState | undefined;
	let bestD = math.huge;
	for (const a of s.combat.actors) {
		if (a.kind === NO_KIND || a.alive === 0) continue;
		const d = math.sqrt((a.x - p.x) * (a.x - p.x) + (a.z - p.z) * (a.z - p.z)) - a.radius;
		if (d < bestD) {
			bestD = d;
			best = a;
		}
	}
	return [best, bestD];
}

let swordIndexCache = -1;
function swordIndex(): number {
	if (swordIndexCache < 0) swordIndexCache = weaponIndex(SWORD_WEAPON_ID);
	return swordIndexCache;
}

function unit(x: number, z: number): [number, number] {
	const d = math.sqrt(x * x + z * z);
	return d > 1e-9 ? [x / d, z / d] : [1, 0];
}

function clampLen(x: number, z: number): [number, number] {
	const d = math.sqrt(x * x + z * z);
	return d > 1 ? [x / d, z / d] : [x, z];
}

/**
 * The bow's kiting move toward the ring at TUNE_BOW_DISTANCE around `t`, strafing (flips every
 * TUNE_BOW_STRAFE_TICKS) and pulled off an arena's edges, and its aim led by the arrow's flight (tuneBotFrame's bow).
 */
function bowMove(p: Readonly<PlayerState>, t: ActorState, tick: number, half: number, speed: number) {
	const dx = t.x - p.x;
	const dz = t.z - p.z;
	const dist = math.sqrt(dx * dx + dz * dz);
	const [ux, uz] = unit(dx, dz);
	const flight = dist / speed;
	const ax = dx + (t.x - t.prevX) * SIM_HZ * flight;
	const az = dz + (t.z - t.prevZ) * SIM_HZ * flight;
	const radial = math.max(-1, math.min(1, (dist - TUNE_BOW_DISTANCE) * 0.8));
	const side = math.floor(tick / TUNE_BOW_STRAFE_TICKS) % 2 === 0 ? TUNE_BOW_STRAFE : -TUNE_BOW_STRAFE;
	let mx = ux * radial - uz * side;
	let mz = uz * radial + ux * side;
	if (half > 0) {
		if (p.x > half - TUNE_EDGE_MARGIN) mx -= 1;
		if (p.x < -half + TUNE_EDGE_MARGIN) mx += 1;
		if (p.z > half - TUNE_EDGE_MARGIN) mz -= 1;
		if (p.z < -half + TUNE_EDGE_MARGIN) mz += 1;
	}
	const [mmx, mmz] = clampLen(mx, mz);
	const [aux, auz] = unit(ax, az);
	return { mx: mmx, mz: mmz, ax: aux, az: auz };
}

/**
 * The fighter's frame for player 0 of `s` against `t` (file comment); `extra` buttons are added (the survival bot's
 * flask / Ember reflexes). `mem` keeps the press edges and the tallies.
 */
export function fighterFrame(
	s: SimState,
	mode: FighterMode,
	t: ActorState | undefined,
	env: FightEnv,
	mem: FighterMemory,
	extra = 0,
): InputFrame {
	const p = s.player;
	const w = weaponsAt(s, 0);
	const slot = w.sets[w.activeSet];
	const holdingSword = slot.weapon === swordIndex();
	const prevRoll = mem.rollPressed;
	const prevAlt = mem.altPressed;
	const prevSwap = mem.swapPressed;
	mem.rollPressed = false;
	mem.altPressed = false;
	mem.swapPressed = false;
	if (t === undefined) {
		mem.charging = false;
		return frame(0, 0, extra);
	}
	const dx = t.x - p.x;
	const dz = t.z - p.z;
	const dist = math.sqrt(dx * dx + dz * dz);
	const [ux, uz] = unit(dx, dz);
	const inSight = env.sees(p.x, p.z, t.x, t.z);
	const rolling = p.rollTicks > 0;

	// Defence first: the guard (sword in hand), then the rolls.
	if (holdingSword && mode !== "archer" && mode !== "archer-stream") {
		if (!prevAlt && !rolling && slot.cooldown === 0) {
			const [n] = threatBullets(s, p.x, p.z, DEFENSE_GUARD_TRIGGER);
			if (n > 0) {
				mem.altPressed = true;
				mem.guards++;
				return frame(ux, uz, bit32.bor(Button.ALT, extra), ux, uz);
			}
		}
	}
	const guardReady = holdingSword && slot.cooldown === 0;
	if (!rolling && !prevRoll && !(guardReady && mode !== "archer" && mode !== "archer-stream")) {
		const [n, bx, bz] = threatBullets(s, p.x, p.z, FIGHT_ROLL_RADIUS);
		if (n >= FIGHT_ROLL_BULLETS) {
			const [rx, rz] = unit(bx, bz);
			mem.rollPressed = true;
			mem.rolls++;
			mem.volleyRolls++;
			mem.charging = false;
			return frame(rx, rz, bit32.bor(Button.ROLL, extra), ux, uz);
		}
		if (mode === "archer" || mode === "archer-stream") {
			const [body, edge] = nearestBody(s, p);
			if (body !== undefined && edge < ARCHER_PANIC_RADIUS) {
				const [rx, rz] = unit(p.x - body.x, p.z - body.z);
				mem.rollPressed = true;
				mem.rolls++;
				mem.panicRolls++;
				mem.charging = false;
				return frame(rx, rz, bit32.bor(Button.ROLL, extra), ux, uz);
			}
		}
	}

	// Out of sight: walk the path, hold fire.
	if (!inSight) {
		mem.charging = false;
		const [mx, mz] = env.pathDir(p.x, p.z, t.x, t.z);
		return frame(mx, mz, extra, mx, mz);
	}

	// The swap player picks its weapon by distance.
	if (mode === "both") {
		const wantBow = holdingSword ? dist > SWAP_TO_BOW : dist >= SWAP_TO_SWORD;
		if (wantBow === holdingSword && !prevSwap && !rolling) {
			mem.swapPressed = true;
			mem.swaps++;
			const walk = dist > TUNE_SWORD_CLOSE ? 1 : 0;
			return frame(ux * walk, uz * walk, bit32.bor(Button.SWAP, extra), ux, uz);
		}
	}

	if (holdingSword) {
		const walk = dist > TUNE_SWORD_CLOSE ? 1 : 0;
		const fire = dist <= SWORD_DATA.reach + t.radius ? Button.FIRE : 0;
		return frame(ux * walk, uz * walk, bit32.bor(fire, extra), ux, uz);
	}

	if (mode === "both") {
		// The swap player's bow: stream while it closes in.
		const m = bowMove(p, t, s.tick, env.half, BOW_DATA.speed);
		return frame(ux, uz, bit32.bor(Button.FIRE, extra), m.ax, m.az);
	}

	// The archer's bow.
	const [, edge] = nearestBody(s, p);
	const charge = slot.v[BOW_V_CHARGE];
	const full = charge >= bowChargeTicks(s, 0);
	if (mem.charging) {
		const m = bowMove(p, t, s.tick, env.half, BOW_DATA.heavySpeed);
		if (full) {
			// Release: ALT up this tick (the heavy arrow flies at the assisted aim).
			mem.charging = false;
			mem.heavies++;
			return frame(m.mx, m.mz, extra, m.ax, m.az);
		}
		if (edge < ARCHER_CHARGE_ABORT) {
			mem.charging = false;
			return frame(m.mx, m.mz, extra, m.ax, m.az);
		}
		return frame(m.mx, m.mz, bit32.bor(Button.ALT, extra), m.ax, m.az);
	}
	if (
		mode === "archer" &&
		t.hp > ARCHER_STREAM_HP &&
		edge >= ARCHER_CHARGE_SAFE &&
		charge === 0 &&
		threatBullets(s, p.x, p.z, ARCHER_CHARGE_BULLET_RADIUS)[0] === 0
	) {
		mem.charging = true;
		mem.charges++;
		const m = bowMove(p, t, s.tick, env.half, BOW_DATA.heavySpeed);
		return frame(m.mx, m.mz, bit32.bor(Button.ALT, extra), m.ax, m.az);
	}
	const m = bowMove(p, t, s.tick, env.half, BOW_DATA.speed);
	return frame(m.mx, m.mz, bit32.bor(Button.FIRE, extra), m.ax, m.az);
}

// ---------------------------------------------------------------------------------------------
// Rooms by kind

/** Room fights by kind are fought at these floors' hp (Depth after every boss on the way; kinds unlock from floor 2). */
export const KIND_FLOORS: ReadonlyArray<TuneFloor> = [
	{ floor: 2, depth: 1 },
	{ floor: 6, depth: 2 },
	{ floor: 11, depth: 3 },
	{ floor: 20, depth: 4 },
];

/** Boss fights: the boss floors 5 / 10 / 15 (Depth 1 / 2 / 3). */
export const CHARACTER_BOSS_FLOORS: ReadonlyArray<TuneFloor> = [
	{ floor: 5, depth: 1 },
	{ floor: 10, depth: 2 },
	{ floor: 15, depth: 3 },
];

/** A kind room's cap (s); the turret pairs' TURRET_ROOM_SECONDS (they revive, so a slow fight may never end). */
export const KIND_ROOM_SECONDS = 180;
export const TURRET_ROOM_SECONDS = 90;

function kindRoom(
	label: string,
	spawns: ReadonlyArray<readonly [string, number, number]>,
	maxSeconds = KIND_ROOM_SECONDS,
): TuneFight {
	return {
		label,
		spawns: spawns.map(([kind, x, z]): TuneSpawn => ({ kind, x, z, affix: AffixKind.NONE })),
		half: 12,
		startX: 0,
		startZ: 0,
		boss: false,
		maxSeconds,
	};
}

/**
 * One synthetic room per endless room kind, 5-7 units ahead of the player (+Z), as many as a room may hold where it
 * has a cap (NEW_KIND_MAX_PER_ROOM; the summoner 1), the swarmer pack as BU13's, the Warbanner with company (NED9), and
 * LG7's two turret pairs (M1 sandbox kinds, never in endless rooms: the bullet-pressure rooms of the defence tables).
 */
export const KIND_ROOMS: ReadonlyArray<TuneFight> = [
	kindRoom("8 swarmer (pack)", [
		["swarmer", -1.5, 5],
		["swarmer", -0.5, 5],
		["swarmer", 0.5, 5],
		["swarmer", 1.5, 5],
		["swarmer", -1, 6],
		["swarmer", 0, 6],
		["swarmer", 1, 6],
		["swarmer", 0, 7],
	]),
	kindRoom("3 sniper", [
		["sniper", -4, 6],
		["sniper", 0, 7],
		["sniper", 4, 6],
	]),
	kindRoom("2 bruiser", [
		["bruiser", -2, 5],
		["bruiser", 2, 5],
	]),
	kindRoom("3 imp", [
		["imp", -3, 5],
		["imp", 0, 6],
		["imp", 3, 5],
	]),
	kindRoom("2 slime (+4 small)", [
		["slime", -2, 5],
		["slime", 2, 5],
	]),
	kindRoom("1 summoner (+summons)", [["summoner", 0, 6]]),
	kindRoom("4 bomber", [
		["bomber", -3, 6],
		["bomber", -1, 6],
		["bomber", 1, 6],
		["bomber", 3, 6],
	]),
	kindRoom("2 charger", [
		["charger", -3, 6],
		["charger", 3, 6],
	]),
	kindRoom("2 stormcaller", [
		["stormcaller", -3, 6],
		["stormcaller", 3, 6],
	]),
	kindRoom("2 reaper", [
		["reaper", -4, 5],
		["reaper", 4, 5],
	]),
	kindRoom("warbanner + 2 sniper + 2 swarmer", [
		["warbanner", 0, 7],
		["sniper", -3, 6],
		["sniper", 3, 6],
		["swarmer", -1, 5],
		["swarmer", 1, 5],
	]),
	kindRoom(
		"2 turret.sprayer",
		[
			["turret.sprayer", -3, 5],
			["turret.sprayer", 3, 5],
		],
		TURRET_ROOM_SECONDS,
	),
	kindRoom(
		"2 turret.caster",
		[
			["turret.caster", -3, 5],
			["turret.caster", 3, 5],
		],
		TURRET_ROOM_SECONDS,
	),
];

/** The Demon Lord in Mother Mayhem's arena (buildTune.ts TUNE_BOSS). */
export const TUNE_DEMONLORD: TuneFight = {
	label: "Demon Lord",
	spawns: [{ kind: BOSS_DEMONLORD_ID, x: 0, z: 0, affix: AffixKind.NONE }],
	half: 13,
	startX: 0,
	startZ: -10,
	boss: true,
	maxSeconds: 900,
};

/** Mother Mayhem (buildTune.ts TUNE_BOSS's spawn and arena). */
export const TUNE_MAYHEM: TuneFight = {
	label: "Mother Mayhem",
	spawns: [{ kind: BOSS_ACT1_ID, x: 0, z: 0, affix: AffixKind.NONE }],
	half: 13,
	startX: 0,
	startZ: -10,
	boss: true,
	maxSeconds: 900,
};

/** The arena weapon for arenaConfig's world loadout (the run config's loadout wins: characterConfig). */
function arenaWeapon(who: TuneCharacter): "weapon.sword" | "weapon.bow" {
	return who === "archer" ? "weapon.bow" : "weapon.sword";
}

/** One arena fight's outcome (file comment). */
export interface CharacterFightResult {
	/** Seconds to the clear (the boss's death); -1: not within the fight's maxSeconds. */
	readonly seconds: number;
	readonly hitsTaken: number;
	readonly mem: FighterMemory;
}

/** One arena fight of `who` with `mode` (default: the character's own) and `build`, at floor `f`'s hp. */
export function characterFight(
	fight: TuneFight,
	build: BuildCase,
	who: TuneCharacter,
	f: TuneFloor,
	seed: number,
	mode: FighterMode = fighterModeOf(who),
): CharacterFightResult {
	const config = characterConfig(arenaConfig(seed, arenaWeapon(who), fight), who);
	const s = createSimState(seed, fight.startX, fight.startZ, config);
	s.endless!.floor = f.floor;
	s.endless!.depth = f.depth;
	grantBuild(s, 0, build.cards);
	const ctx = new SimCtx().bind(s, simWorldConfig(s, config), EMPTY_INPUT);
	const spawned: ActorState[] = [];
	for (const sp of fight.spawns) {
		const a = spawnActor(ctx, archetypeIndex(sp.kind), sp.x, sp.z, sp.affix);
		if (a === undefined) error(`characterFight: could not spawn ${sp.kind}`, 0);
		spawned.push(a);
	}
	const boss = fight.boss ? spawned[0] : undefined;
	const env = arenaEnv(fight.half);
	const mem = newFighterMemory();
	let hits = 0;
	const maxTicks = fight.maxSeconds * SIM_HZ;
	for (let k = 0; k < maxTicks; k++) {
		step(s, fighterFrame(s, mode, nearestLiving(s, s.player), env, mem), config);
		s.player.hearts = s.player.heartsMax;
		hits += s.events.playerHits;
		const done = boss !== undefined ? boss.alive === 0 : !anyLiving(s);
		if (done) return { seconds: (k + 1) / SIM_HZ, hitsTaken: hits, mem };
	}
	return { seconds: -1, hitsTaken: hits, mem };
}

/** A build of the AR13 tables; `only`: the characters it is dealt to (others print n/a; absent: everyone). */
export interface CharacterBuildCase extends BuildCase {
	readonly only?: ReadonlyArray<TuneCharacter>;
}

/**
 * The AR13 build rows: no build; BU13's Storm Blade and Soul Swarm (both characters); Executioner (Sharpened III);
 * the Archer's Fire Arrows and Siege Bolt (Ballista III); the Knight's Counterstrike (Riposte III). The old player
 * ("both") may be dealt every one.
 */
export const CHARACTER_BUILD_CASES: ReadonlyArray<CharacterBuildCase> = [
	BUILD_TTK_CASES[0],
	BUILD_TTK_CASES[9],
	BUILD_TTK_CASES[6],
	{ label: "Executioner (Sharpened III)", cards: boonLevels(Boon.SHARPENED, 3) },
	{ ...BUILD_TTK_CASES[8], only: ["archer", "both"] },
	{ label: "Siege Bolt (Ballista III)", cards: boonLevels(Boon.BALLISTA, 3), only: ["archer", "both"] },
	{ label: "Counterstrike (Riposte III)", cards: boonLevels(Boon.RIPOSTE, 3), only: ["knight", "both"] },
];

/** Printed for a build a character is never dealt. */
const NOT_DEALT = -2;

/** One printed row: a fight and a build, per character, per floor: mean seconds (-1 any fight lost) and hits. */
export interface CharacterTtkRow {
	readonly fight: string;
	readonly build: string;
	/** [character][floor] */
	readonly seconds: number[][];
	readonly hits: number[][];
	readonly heavies: number[][];
	readonly swaps: number[][];
}

/** Every (fight, build) at every floor for every character of `who` over `seeds`. */
export function characterTtkRows(
	fights: ReadonlyArray<TuneFight> | ((f: TuneFloor) => TuneFight),
	builds: ReadonlyArray<CharacterBuildCase>,
	who: ReadonlyArray<TuneCharacter>,
	floors: ReadonlyArray<TuneFloor>,
	seeds: ReadonlyArray<number>,
	modes?: ReadonlyArray<FighterMode>,
): CharacterTtkRow[] {
	const rows: CharacterTtkRow[] = [];
	const list: ReadonlyArray<(f: TuneFloor) => TuneFight> = typeIs(fights, "function")
		? [fights]
		: (fights as ReadonlyArray<TuneFight>).map((x) => () => x);
	for (const fightAt of list) {
		for (const build of builds) {
			const row: CharacterTtkRow = {
				fight: fightAt(floors[0]).label,
				build: build.label,
				seconds: [],
				hits: [],
				heavies: [],
				swaps: [],
			};
			for (let c = 0; c < who.size(); c++) {
				const secs: number[] = [];
				const hits: number[] = [];
				const heavies: number[] = [];
				const swaps: number[] = [];
				const dealt = build.only === undefined || build.only.includes(who[c]);
				for (const f of floors) {
					if (!dealt) {
						secs.push(NOT_DEALT);
						hits.push(0);
						heavies.push(0);
						swaps.push(0);
						continue;
					}
					let sum = 0;
					let h = 0;
					let hv = 0;
					let sw = 0;
					let failed = false;
					for (const seed of seeds) {
						const r = characterFight(fightAt(f), build, who[c], f, seed, modes?.[c]);
						if (r.seconds < 0) failed = true;
						sum += r.seconds;
						h += r.hitsTaken;
						hv += r.mem.heavies;
						sw += r.mem.swaps;
					}
					const n = seeds.size();
					secs.push(failed ? -1 : sum / n);
					hits.push(h / n);
					heavies.push(hv / n);
					swaps.push(sw / n);
				}
				row.seconds.push(secs);
				row.hits.push(hits);
				row.heavies.push(heavies);
				row.swaps.push(swaps);
			}
			rows.push(row);
		}
	}
	return rows;
}

const s1 = (x: number) => (x === NOT_DEALT ? "n/a" : x < 0 ? "t/o" : string.format("%.1f", x));

/** Markdown header for characterTtkRows' rows: seconds per floor per character, then the ratios to `base`. */
export function characterTtkHeader(
	names: ReadonlyArray<string>,
	floors: ReadonlyArray<TuneFloor>,
	base: number,
): string {
	const fs = floors.map((f) => `f${f.floor}`).join(" / ");
	const cols = names.map((n) => `${n} s ${fs}`).join(" | ");
	const ratios = names
		.filter((_n, i) => i !== base)
		.map((n) => `${n} x ${names[base]}`)
		.join(" | ");
	return `| room | build | ${cols} | ${ratios} | hits / min ${names.join(" / ")} (last floor) |`;
}

export function formatCharacterTtkRow(row: CharacterTtkRow, base: number, withBuild = true): string {
	const cols = row.seconds.map((xs) => xs.map(s1).join(" / ")).join(" | ");
	const ratios: string[] = [];
	for (let c = 0; c < row.seconds.size(); c++) {
		if (c === base) continue;
		ratios.push(
			row.seconds[c]
				.map((x, i) => {
					const b = row.seconds[base][i];
					return x < 0 || b <= 0 ? "-" : string.format("%.2f", x / b);
				})
				.join(" / "),
		);
	}
	const last = row.seconds[0].size() - 1;
	const hpm = row.seconds
		.map((xs, c) => (xs[last] > 0 ? string.format("%.0f", (60 * row.hits[c][last]) / xs[last]) : "-"))
		.join(" / ");
	return `| ${row.fight} | ${withBuild ? row.build : "-"} | ${cols} | ${ratios.join(" | ")} | ${hpm} |`;
}

// ---------------------------------------------------------------------------------------------
// The roll's reach (Blazing Trail, Wrecker)

/** What one roll on open ground left behind, per character (rollReach). */
export interface RollReach {
	/** The roll's length (start to end, open ground). */
	readonly distance: number;
	/** Blazing Trail: embers dropped, the distance from the first to the last, the gaps between neighbours. */
	readonly embers: number;
	readonly emberSpan: number;
	readonly emberGapMin: number;
	readonly emberGapMax: number;
}

/**
 * One roll along +X in buildTune.ts's empty arena (no enemies) with Blazing Trail (Ember Wake + Slippery + the duo),
 * as `who` (traits through characterConfig): the embers are the player bullets of kind EMBER alive after the roll.
 */
export function rollReach(who: TuneCharacter, cards: ReadonlyArray<number>): RollReach {
	const fight: TuneFight = { ...kindRoom("empty", []), half: 12, startX: -6 };
	const config = characterConfig(arenaConfig(1, arenaWeapon(who), fight), who);
	const s = createSimState(1, fight.startX, 0, config);
	grantBuild(s, 0, cards);
	const x0 = s.player.x;
	step(s, frame(1, 0, Button.ROLL, 1, 0), config);
	for (let k = 0; k < 30; k++) step(s, frame(0, 0), config);
	const xs: number[] = [];
	s.combat.playerBullets.forEachActive((_i, pos, payload) => {
		if (BulletPayload.get(payload, "kind") === BulletKind.EMBER) xs.push(pos.x);
	});
	xs.sort((a, b) => a < b);
	let gapMin = math.huge;
	let gapMax = 0;
	for (let i = 1; i < xs.size(); i++) {
		gapMin = math.min(gapMin, xs[i] - xs[i - 1]);
		gapMax = math.max(gapMax, xs[i] - xs[i - 1]);
	}
	return {
		distance: s.player.x - x0,
		embers: xs.size(),
		emberSpan: xs.size() > 1 ? xs[xs.size() - 1] - xs[0] : 0,
		emberGapMin: xs.size() > 1 ? gapMin : 0,
		emberGapMax: gapMax,
	};
}

/** An open 17 x 17 patch of a real endless floor (archerRoll.spec's Wrecker harness), found once. */
let wreckPatch: { config: SimConfig; gx: number; gy: number } | undefined;

function openPatch(): { config: SimConfig; gx: number; gy: number } {
	if (wreckPatch !== undefined) return wreckPatch;
	for (let runSeed = 1; runSeed <= 40; runSeed++) {
		const fl = endlessRunFloor(runSeed, 1);
		const d = fl.dungeon;
		for (let gy = 8; gy < d.H - 8; gy++)
			for (let gx = 8; gx < d.W - 8; gx++) {
				let open = true;
				for (let oy = -8; oy <= 8 && open; oy++)
					for (let ox = -8; ox <= 8 && open; ox++)
						if (tileAt(d, gx + ox, gy + oy) !== TileType.FLOOR) open = false;
				if (open) {
					wreckPatch = { config: fl.config, gx, gy };
					return wreckPatch;
				}
			}
	}
	error("openPatch: no open patch on floor 1 of runs 1-40", 0);
}

/** What one Wrecker roll smashed (wreckerReach). */
export interface WreckerReach {
	/** Crates broken, and the farthest one broken (tiles ahead of the start; 0: none). */
	readonly broken: number;
	readonly farthest: number;
}

/**
 * Wrecker I, one roll along +X from the centre of an open patch of a real floor (no endless mode) into crates on the
 * roll's line at `ahead` tiles (one piece per tile), as `who`: crates broken and the farthest.
 */
export function wreckerReach(who: TuneCharacter, ahead: ReadonlyArray<number>): WreckerReach {
	const patch = openPatch();
	const pieces: BreakablePlacement[] = ahead.map((a) => ({ x: patch.gx + a, y: patch.gy, kind: "crate" }));
	const config = characterConfig(
		{
			...patch.config,
			encounter: { ...patch.config.encounter!, spawns: [] },
			breakables: { ...BREAKABLES_CONFIG, pieces },
			builds: BUILDS_CONFIG,
		},
		who,
	);
	const s = createSimState(1, gridToWorld(patch.gx), gridToWorld(patch.gy), config);
	s.builds!.players[0].levels[Boon.WRECKER] = 1;
	step(s, frame(1, 0, Button.ROLL, 1, 0), config);
	for (let t = 0; t < ROLL_TICKS; t++) step(s, frame(0, 0), config);
	let broken = 0;
	let farthest = 0;
	const ps = s.breakables!.pieces;
	for (let k = 0; k < ps.size(); k++) {
		if (ps[k].brokenTick === NOT_BROKEN) continue;
		broken++;
		farthest = math.max(farthest, ahead[k]);
	}
	return { broken, farthest };
}

/**
 * True when the spec run asked for the full census (the headless runner's `--census` flag sets the Workspace attribute
 * KV_Census; scripts/lune/run-tests.luau). Census specs run a small default sample without it, so the normal test run
 * stays fast.
 */
export function censusRequested(): boolean {
	return game.GetService("Workspace").GetAttribute("KV_Census") === true;
}
