/**
 * Test support for specs (never imported by the game): docs/ARCHER.md AR13's endless survival census. An honest solo
 * endless descent (no god mode, no debug hits) fought with ./characterTune.ts's fighter, per character, until the
 * player dies or reaches `maxFloor`; measures the floor reached, the hits taken per room and per boss, the deaths.
 *
 * Run config: buildEndlessRunConfig(seed, 1, { characters: [who] }) for the Knight and the Archer (the real character
 * path: what every live endless run builds), buildEndlessRunConfig(seed, 1) for "both" (the old two-weapon player).
 * The floors are pure in the run seed, so every character of one seed meets the same floors, rooms and spawns.
 *
 * Per floor (endlessBot.ts's Driver steps and records every frame):
 *   rooms   every room with planned spawns but the boss room, nearest first (BFS steps from the player to the room's
 *           first planned spawn): walk there (Driver.walkTo, the open stairwell avoided, its rolls and stuck attacks)
 *           until the room's score record engages, then fight it: the target is the nearest living member of the
 *           record (else the nearest living actor), the fighter's frame for the character (fighterFrame, a real floor:
 *           sight through the bullet blocker, paths through BFS fields), the Driver's flask / Ember reflexes; until the
 *           record clears, the player dies, the floor changes (a kite into the open stairwell) or SURVIVAL_ROOM_TICKS
 *   boss    on a boss floor: walk to the boss room (the stairwell's spot) until the boss wakes, fight her / him the same
 *           way (adds included: the nearest living actor) until the boss dies or SURVIVAL_BOSS_TICKS; never J
 *   stairs  walk onto the stairwell; the boon draft is resolved with buildOffers.ts's greedy pick (an evolution, a duo,
 *           an upgrade, else the first card). A floor the bot cannot leave in SURVIVAL_STAIR_TICKS is skipped with the
 *           debug floor button and counted (`stuck`).
 * Shrines, pacts, pedestals, vault chests, pellets and boosts on the ground are ignored (a vault room is fought like any
 * room; boosts are picked up only when walked over).
 */
import { bulletBlocker, gridToWorld, lineOfSight, worldToGrid } from "shared/dungeon";
import {
	DEBUG_FLOOR_BUTTON,
	DRAFT_COLUMN_CENTRE,
	DRAFT_COLUMN_LEFT,
	DRAFT_COLUMN_RIGHT,
	DRAFT_CONFIRM_BUTTON,
	DRAFT_MIN_OPEN_TICKS,
	DRAFT_SCREEN_RIGHT_X,
	DRAFT_SCREEN_RIGHT_Z,
	NO_KIND,
	Rng,
	SIM_HZ,
	SOLO_PLAYER,
	archetypeAt,
	draftCardFor,
	isDraftOpen,
	type ActorState,
	type InputFrame,
	type RoomScore,
	type SimState,
} from "shared/sim";
import { buildEndlessRunConfig } from "../endless";
import { pickOffer } from "./buildOffers";
import {
	fighterFrame,
	fighterModeOf,
	newFighterMemory,
	type FightEnv,
	type FighterMemory,
	type TuneCharacter,
} from "./characterTune";
import { Driver, bossOf, distanceField, frame, walkDir, type Field } from "./endlessBot";

/** A room fight ends after this long (s), the boss fight after SURVIVAL_BOSS_SECONDS. */
export const SURVIVAL_ROOM_SECONDS = 120;
export const SURVIVAL_BOSS_SECONDS = 420;
/** Walks: to a room (until it engages), to the boss room, to the stairwell (ticks). */
export const SURVIVAL_WALK_TICKS = 2400;
export const SURVIVAL_STAIR_TICKS = 4000;
/** A target farther than this (no room member alive) is not chased: the room is over for the bot. */
const STRAY_RANGE = 14;

/** One room fight. */
export interface SurvivalRoom {
	readonly floor: number;
	readonly room: number;
	readonly enemies: number;
	readonly hits: number;
	readonly ticks: number;
	readonly cleared: boolean;
	readonly died: boolean;
}

/** One boss fight. */
export interface SurvivalBoss {
	readonly floor: number;
	readonly boss: string;
	readonly hits: number;
	readonly ticks: number;
	readonly killed: boolean;
	readonly died: boolean;
}

/** One run of the census. */
export interface SurvivalRun {
	readonly seed: number;
	readonly who: TuneCharacter;
	/** The floor the run ended on (died there), or maxFloor + 1 (survived the cap). */
	readonly floorReached: number;
	readonly died: boolean;
	/** Where the death happened: "room", "boss", "travel" or "" (survived). */
	readonly deathIn: string;
	readonly ticks: number;
	readonly rooms: ReadonlyArray<SurvivalRoom>;
	readonly bosses: ReadonlyArray<SurvivalBoss>;
	/** Hits that landed outside room and boss fights (walks). */
	readonly travelHits: number;
	/** Floors skipped with the debug button (the bot could not reach the stairwell). */
	readonly stuck: number;
	readonly mem: FighterMemory;
	/** Boons / duos owned at the end (builds levels > 0, duos). */
	readonly boons: number;
	readonly duos: number;
}

export interface SurvivalOptions {
	readonly maxFloor: number;
	/** Called after every step (Driver.onStep): a census's observer (docs/SILVER.md SV1). */
	readonly onStep?: (s: SimState, input: InputFrame) => void;
	/** Census only: hearts topped up before every tick (Driver's `immortal`), so the run reaches maxFloor. */
	readonly immortal?: boolean;
}

/** The fight environment of the driver's current floor: sight through its bullet blocker, BFS fields cached by cell. */
function floorEnv(drv: Driver): FightEnv {
	const w = drv.world();
	const blocked = bulletBlocker(w.dungeon);
	const pieces = new Set<number>();
	for (const b of w.breakables ?? []) pieces.add(b.y * w.dungeon.W + b.x);
	const fields = new Map<number, Field>();
	return {
		half: 0,
		sees: (x1, z1, x2, z2) => lineOfSight(blocked, x1, z1, x2, z2),
		pathDir: (x, z, tx, tz) => {
			const gx = worldToGrid(tx);
			const gz = worldToGrid(tz);
			const key = gz * w.dungeon.W + gx;
			let f = fields.get(key);
			if (f === undefined) {
				f = distanceField(w.dungeon, gridToWorld(gx), gridToWorld(gz), undefined, pieces);
				fields.set(key, f);
			}
			return walkDir(f, x, z);
		},
	};
}

function living(a: ActorState | undefined): a is ActorState {
	return a !== undefined && a.kind !== NO_KIND && a.alive !== 0;
}

/** The nearest living member of `r` to the player, else the nearest living actor within STRAY_RANGE. */
function roomTarget(s: SimState, r: Readonly<RoomScore> | undefined): ActorState | undefined {
	const p = s.player;
	let best: ActorState | undefined;
	let bestD = math.huge;
	if (r !== undefined) {
		for (let k = 0; k < r.memberSlots.size(); k++) {
			const a: ActorState | undefined = s.combat.actors[r.memberSlots[k]];
			if (!living(a) || a.id !== r.memberIds[k]) continue;
			const d = (a.x - p.x) * (a.x - p.x) + (a.z - p.z) * (a.z - p.z);
			if (d < bestD) {
				bestD = d;
				best = a;
			}
		}
		if (best !== undefined) return best;
	}
	for (const a of s.combat.actors) {
		if (!living(a)) continue;
		const d = (a.x - p.x) * (a.x - p.x) + (a.z - p.z) * (a.z - p.z);
		if (d < bestD && d <= STRAY_RANGE * STRAY_RANGE) {
			bestD = d;
			best = a;
		}
	}
	return best;
}

/** Resolves an open draft with the greedy pick (buildOffers.ts pickOffer), deal by deal (endlessBot resolveDraft). */
function resolveGreedy(drv: Driver, rng: Rng): void {
	const s = drv.state;
	const p = s.run?.players[SOLO_PLAYER];
	if (p === undefined || !isDraftOpen(s)) return;
	for (let deal = 0; deal < 4 && p.draftOpen !== 0; deal++) {
		const n = p.draftOffers.size();
		const levels = s.builds?.players[SOLO_PLAYER].levels ?? [];
		const want = pickOffer("greedy", levels, p.draftOffers, rng);
		let col = DRAFT_COLUMN_CENTRE;
		for (const c of [DRAFT_COLUMN_LEFT, DRAFT_COLUMN_CENTRE, DRAFT_COLUMN_RIGHT])
			if (draftCardFor(c, n) === want) col = c;
		if (draftCardFor(col, n) < 0) col = DRAFT_COLUMN_LEFT;
		const side = col === DRAFT_COLUMN_RIGHT ? 1 : col === DRAFT_COLUMN_LEFT ? -1 : 0;
		const mx = side * DRAFT_SCREEN_RIGHT_X;
		const mz = side * DRAFT_SCREEN_RIGHT_Z;
		let guard = 0;
		while (p.draftTicks + 1 < DRAFT_MIN_OPEN_TICKS && guard++ < 600) drv.tick(frame(mx, mz));
		drv.tick(frame(mx, mz, DRAFT_CONFIRM_BUTTON));
		drv.tick(frame(0, 0));
	}
}

/** One survival run (file comment). */
export function survivalRun(seed: number, who: TuneCharacter, options: SurvivalOptions): SurvivalRun {
	const setup =
		who === "both" ? buildEndlessRunConfig(seed, 1) : buildEndlessRunConfig(seed, 1, { characters: [who] });
	const drv = new Driver(setup, seed, options.immortal === true);
	drv.onStep = options.onStep;
	const s = drv.state;
	const mode = fighterModeOf(who);
	const mem = newFighterMemory();
	const pickRng = new Rng(seed);
	const rooms: SurvivalRoom[] = [];
	const bosses: SurvivalBoss[] = [];
	let travelHits = 0;
	let stuck = 0;
	let deathIn = "";
	const dead = () => s.player.dead !== 0;
	/** Steps one fight frame and returns the hits that landed. */
	const fightTick = (target: ActorState | undefined, env: FightEnv): number => {
		drv.tick(fighterFrame(s, mode, target, env, mem, drv.assisted(0)));
		return s.events.playerHits;
	};
	/** Walks with drv.walkTo, counting the hits as travel. */
	const walk = (tx: number, tz: number, done: () => boolean, ticks: number, avoid?: readonly [number, number]) => {
		const before = s.score!.hitsTaken;
		drv.walkTo(tx, tz, done, ticks, avoid);
		travelHits += s.score!.hitsTaken - before;
	};
	while (!dead() && drv.floor() <= options.maxFloor) {
		const floor = drv.floor();
		const w = drv.world();
		const env = floorEnv(drv);
		const bossRoom = w.config.encounter?.bossRoom ?? -1;
		const stair: readonly [number, number] | undefined = w.bossFloor ? undefined : [w.stairX, w.stairZ];
		const pieces = new Set<number>();
		for (const b of w.breakables ?? []) pieces.add(b.y * w.dungeon.W + b.x);
		const todo: number[] = [];
		for (let id = 0; id < w.roomSpawns.size(); id++)
			if (id !== bossRoom && w.roomSpawns[id].size() > 0) todo.push(id);
		while (!dead() && drv.floor() === floor && todo.size() > 0) {
			// The nearest room by BFS steps from the player to its first planned spawn.
			const here = distanceField(w.dungeon, s.player.x, s.player.z, undefined, pieces);
			let pick = 0;
			let bestD = math.huge;
			for (let k = 0; k < todo.size(); k++) {
				const sp = w.roomSpawns[todo[k]][0];
				const d = here.dist[worldToGrid(sp.z) * w.dungeon.W + worldToGrid(sp.x)];
				if (d < bestD) {
					bestD = d;
					pick = k;
				}
			}
			const id = todo[pick];
			todo.remove(pick);
			const rec = s.score!.rooms.find((r) => r.room === id);
			if (rec === undefined || rec.cleared !== 0) continue;
			const sp = w.roomSpawns[id][0];
			walk(sp.x, sp.z, () => rec.engageTick >= 0 || rec.cleared !== 0, SURVIVAL_WALK_TICKS, stair);
			if (dead()) {
				deathIn = "travel";
				break;
			}
			if (drv.floor() !== floor || rec.engageTick < 0 || rec.cleared !== 0) continue;
			let hits = 0;
			let n = 0;
			const limit = SURVIVAL_ROOM_SECONDS * SIM_HZ;
			while (n < limit && rec.cleared === 0 && !dead() && drv.floor() === floor) {
				const t = roomTarget(s, rec);
				if (t === undefined) break;
				hits += fightTick(t, env);
				n++;
			}
			rooms.push({
				floor,
				room: id,
				enemies: w.roomSpawns[id].size(),
				hits,
				ticks: n,
				cleared: rec.cleared !== 0,
				died: dead(),
			});
			if (dead()) deathIn = "room";
		}
		if (dead() || drv.floor() !== floor) {
			if (!dead()) resolveGreedy(drv, pickRng);
			continue;
		}
		if (w.bossFloor) {
			walk(
				w.stairX,
				w.stairZ,
				() => s.combat.actors.some((a) => living(a) && a.phase > 0 && archetypeAt(a.kind).data.boss === true),
				SURVIVAL_WALK_TICKS,
			);
			const boss = bossOf(s);
			if (dead()) deathIn = "travel";
			else if (boss !== undefined) {
				const id = archetypeAt(boss.kind).id;
				let hits = 0;
				let n = 0;
				const limit = SURVIVAL_BOSS_SECONDS * SIM_HZ;
				while (n < limit && living(boss) && !dead() && drv.floor() === floor) {
					hits += fightTick(roomTarget(s, undefined) ?? boss, env);
					n++;
				}
				bosses.push({ floor, boss: id, hits, ticks: n, killed: !living(boss), died: dead() });
				if (dead()) deathIn = "boss";
			}
		}
		if (dead()) break;
		if (drv.floor() === floor) walk(w.stairX, w.stairZ, () => false, SURVIVAL_STAIR_TICKS);
		if (dead()) {
			deathIn = "travel";
			break;
		}
		if (drv.floor() === floor) {
			stuck++;
			drv.tick(frame(0, 0, DEBUG_FLOOR_BUTTON));
			drv.tick(frame(0, 0));
		}
		resolveGreedy(drv, pickRng);
	}
	const bp = s.builds?.players[SOLO_PLAYER];
	let boons = 0;
	if (bp !== undefined) for (const l of bp.levels) if (l > 0) boons++;
	return {
		seed,
		who,
		floorReached: dead() ? drv.floor() : options.maxFloor + 1,
		died: dead(),
		deathIn,
		ticks: s.tick,
		rooms,
		bosses,
		travelHits,
		stuck,
		mem,
		boons,
		duos: bp?.duos.size() ?? 0,
	};
}

/** Per-character totals of a census (one entry per run). */
export interface SurvivalSummary {
	readonly who: TuneCharacter;
	readonly runs: number;
	/** Runs alive on entering floor f (index f; index 1 = every run). */
	readonly aliveAt: number[];
	readonly meanFloor: number;
	readonly medianFloor: number;
	readonly deaths: number;
	readonly deathsIn: { room: number; boss: number; travel: number };
	/** Room fights: count, cleared, hits, by floor band (1-4, 5-9, 10-14, 15-20). */
	readonly bandRooms: number[];
	readonly bandHits: number[];
	readonly bandCleared: number[];
	readonly bandSeconds: number[];
	readonly bossFights: number;
	readonly bossKills: number;
	readonly bossHits: number;
	readonly bossSeconds: number;
	readonly rolls: number;
	readonly guards: number;
	readonly heavies: number;
	readonly ticks: number;
	readonly stuck: number;
}

/** Floor bands of the survival tables. */
export const SURVIVAL_BANDS: ReadonlyArray<readonly [number, number]> = [
	[1, 4],
	[5, 9],
	[10, 14],
	[15, 20],
];

function bandOf(floor: number): number {
	for (let b = 0; b < SURVIVAL_BANDS.size(); b++) if (floor <= SURVIVAL_BANDS[b][1]) return b;
	return SURVIVAL_BANDS.size() - 1;
}

export function summarizeSurvival(
	who: TuneCharacter,
	runs: ReadonlyArray<SurvivalRun>,
	maxFloor: number,
): SurvivalSummary {
	const aliveAt: number[] = [];
	for (let f = 0; f <= maxFloor + 1; f++) aliveAt.push(0);
	const floors: number[] = [];
	const zero = () => SURVIVAL_BANDS.map(() => 0);
	const bandRooms = zero();
	const bandHits = zero();
	const bandCleared = zero();
	const bandSeconds = zero();
	const deathsIn = { room: 0, boss: 0, travel: 0 };
	let deaths = 0;
	let bossFights = 0;
	let bossKills = 0;
	let bossHits = 0;
	let bossSeconds = 0;
	let rolls = 0;
	let guards = 0;
	let heavies = 0;
	let ticks = 0;
	let stuck = 0;
	for (const r of runs) {
		floors.push(r.floorReached);
		for (let f = 1; f <= math.min(r.floorReached, maxFloor + 1); f++) aliveAt[f]++;
		if (r.died) {
			deaths++;
			if (r.deathIn === "room") deathsIn.room++;
			else if (r.deathIn === "boss") deathsIn.boss++;
			else deathsIn.travel++;
		}
		for (const room of r.rooms) {
			const b = bandOf(room.floor);
			bandRooms[b]++;
			bandHits[b] += room.hits;
			if (room.cleared) bandCleared[b]++;
			bandSeconds[b] += room.ticks / SIM_HZ;
		}
		for (const boss of r.bosses) {
			bossFights++;
			if (boss.killed) bossKills++;
			bossHits += boss.hits;
			bossSeconds += boss.ticks / SIM_HZ;
		}
		rolls += r.mem.rolls;
		guards += r.mem.guards;
		heavies += r.mem.heavies;
		ticks += r.ticks;
		stuck += r.stuck;
	}
	floors.sort((a, b) => a < b);
	const n = floors.size();
	const median = n === 0 ? 0 : n % 2 === 1 ? floors[(n - 1) / 2] : (floors[n / 2 - 1] + floors[n / 2]) / 2;
	let sum = 0;
	for (const f of floors) sum += f;
	return {
		who,
		runs: n,
		aliveAt,
		meanFloor: n > 0 ? sum / n : 0,
		medianFloor: median,
		deaths,
		deathsIn,
		bandRooms,
		bandHits,
		bandCleared,
		bandSeconds,
		bossFights,
		bossKills,
		bossHits,
		bossSeconds,
		rolls,
		guards,
		heavies,
		ticks,
		stuck,
	};
}
