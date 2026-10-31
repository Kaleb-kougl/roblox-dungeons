/**
 * Test support for specs (never imported by the game): docs/BUILDS.md BU13's tuning measurements, the build half
 * (the offer statistics are ./buildOffers.ts). Measurements only: nothing here changes a rule or a number.
 *
 * 1. Build TTK (buildFight / buildTtkRows): time to clear a fight in an open endless ARENA (an endless world with no
 *    rooms and the stairs out of reach, like builds/procs.spec.ts; `SimConfig.builds` and `affixes` on, no drops),
 *    solo, the player holding ONE real weapon, a build granted through grantCard before tick 0, god mode (hearts
 *    refilled every tick; the hits that landed are counted). The floor's hp comes from the sim itself: the state's
 *    endless floor / Depth are set before anything spawns (test surgery), so spawnActor scales every actor (the boss
 *    by Depth only, adds / slimelets / summons as they appear) exactly as on that floor. Fights:
 *      pack  8 swarmers in builds/procs.spec.ts's pack, 5-7 units ahead (TUNE_PACK)
 *      room  a real endless room's planned spawns and affixes (tuneCensusRoom), centred on the player (spawns closer
 *            than SPAWN_SAFE_RADIUS pushed out to it, as safeRoomSpawns keeps them away from a player)
 *      boss  Mother Bramble at the centre of a boss room (TUNE_BOSS_HALF), the player 3 units inside its edge (so she
 *            wakes on the first tick); done when she dies (her adds are swept with her)
 *    Bots: the target is the nearest living actor (the boss's adds included); the sword walks to TUNE_SWORD_CLOSE and
 *    holds FIRE in reach (the full combo), the bow keeps TUNE_BOW_DISTANCE and holds FIRE (the stream, no charged
 *    shots), leading its target, strafing and staying off the arena's edges (tuneBotFrame).
 * 2. Kill probe (withKillProbe): for the fight's duration every archetype is re-registered (the registry allows a
 *    re-registration with the same band) as a copy whose onHit calls the original and then, when the hit is about to
 *    kill (damageActor runs onHit right before its kill line), records ctx.procGen (> 0: the kill was made by a build
 *    effect: a spark, an effect bullet, an ember) and whether buildsOnKill will queue a proc (the same tests as
 *    procs.ts: never a reviver or PROC_INELIGIBLE_ARCHETYPES, gen < genMax, an owner with an on-kill boon). The
 *    originals are registered back afterwards. Kills not made by damage (withers, a boss's sweep) are not probed.
 * 3. Player bullet high-water (buildPoolRun): the densest room of a real endless floor for the party size (poolHighWater.ts
 *    roomLoad's slots, with its planned affixes) as an arena fight (centredFight), solo or a party (every player at the
 *    origin with the build), at that floor's hp (Depth = the bosses on the way; spawnActor adds the party multiplier),
 *    `seconds` of combat in god mode with the bots (each player its own nearest target; every player rolls every
 *    TUNE_POOL_ROLL_TICKS, staggered). An open arena is the worst case for the pool: no wall ends a bullet early.
 *    Measured per tick: player bullets alive, effect bullets alive per player (effectBulletsAlive), each player's own
 *    weapon bullets (their emitter's count minus their effects), effect bullets refused (BuildEvents.effectDropped)
 *    and every other drop (combat.dropped's rise minus those: a weapon shot, as long as the enemy pool never fills).
 */
import { AffixKind, isBossFloor } from "shared/dungeon";
import {
	AFFIXES_CONFIG,
	BOSS_ACT1_ID,
	BOW_DATA,
	BUILDS_CONFIG,
	Boon,
	Button,
	Duo,
	EMPTY_INPUT,
	ENEMY_BULLET_CAPACITY,
	NO_KIND,
	PLAYER_BULLET_CAPACITY,
	PROC_INELIGIBLE_ARCHETYPES,
	SIM_HZ,
	SPAWN_SAFE_RADIUS,
	SWARMER,
	SWORD_DATA,
	SimCtx,
	archetypeAt,
	archetypeIds,
	archetypeIndex,
	boonCard,
	createSimState,
	duoCard,
	effectBulletsAlive,
	grantCard,
	hasOnKillEffect,
	playerAt,
	registerArchetype,
	simWorldConfig,
	spawnActor,
	step,
	stepParty,
	weaponsAt,
	type ActorState,
	type ArchetypeDef,
	type EndlessFloorWorld,
	type InputFrame,
	type PlayerState,
	type SimConfig,
	type SimState,
} from "shared/sim";
import { buildEndlessRunConfig } from "../endless";
import { frame } from "./endlessBot";
import { roomLoad } from "./poolHighWater";

export type TuneWeapon = "weapon.sword" | "weapon.bow";

// ---------------------------------------------------------------------------------------------
// Builds

/** A build: its label and the cards granted in order (grantCard; a boon card per level, then duo cards). */
export interface BuildCase {
	readonly label: string;
	readonly cards: ReadonlyArray<number>;
}

/** `boon`'s card `levels` times (level I .. `levels`). */
export function boonLevels(boon: number, levels: number): number[] {
	const out: number[] = [];
	for (let k = 0; k < levels; k++) out.push(boonCard(boon));
	return out;
}

function cards(...parts: ReadonlyArray<ReadonlyArray<number>>): number[] {
	const out: number[] = [];
	for (const p of parts) for (const c of p) out.push(c);
	return out;
}

/**
 * The BU13 TTK rows: no build; each on-kill boon at I and III; Cataclysm + Chain Reaction; Fire Arrows; Storm Blade.
 * A duo row holds the duo's two boons at level I (their own level-I effects included: Chain Spark's sparks, Swift
 * Strikes' 80 % recovery, Piercing Arrows' +1 pierce, Ember Wake's roll ring, which the bots never trigger).
 */
export const BUILD_TTK_CASES: ReadonlyArray<BuildCase> = [
	{ label: "no build", cards: [] },
	{ label: "Chain Spark I", cards: boonLevels(Boon.CHAIN_SPARK, 1) },
	{ label: "Storm Crown (Chain Spark III)", cards: boonLevels(Boon.CHAIN_SPARK, 3) },
	{ label: "Volatile I", cards: boonLevels(Boon.VOLATILE, 1) },
	{ label: "Cataclysm (Volatile III)", cards: boonLevels(Boon.VOLATILE, 3) },
	{ label: "Soul Shards I", cards: boonLevels(Boon.SOUL_SHARDS, 1) },
	{ label: "Soul Swarm (Soul Shards III)", cards: boonLevels(Boon.SOUL_SHARDS, 3) },
	{
		label: "Cataclysm + Chain Reaction (+ Chain Spark I)",
		cards: cards(boonLevels(Boon.VOLATILE, 3), boonLevels(Boon.CHAIN_SPARK, 1), [duoCard(Duo.CHAIN_REACTION)]),
	},
	{
		label: "Fire Arrows (Ember Wake + Piercing Arrows I)",
		cards: cards([boonCard(Boon.EMBER_WAKE), boonCard(Boon.PIERCING_ARROWS), duoCard(Duo.FIRE_ARROWS)]),
	},
	{
		label: "Storm Blade (Chain Spark I + Swift Strikes I)",
		cards: cards([boonCard(Boon.CHAIN_SPARK), boonCard(Boon.SWIFT_STRIKES), duoCard(Duo.STORM_BLADE)]),
	},
];

/** The two heaviest builds for the player bullet high-water (BU13 item 2), with the weapon each is measured with. */
export interface PoolCase extends BuildCase {
	readonly weapon: TuneWeapon;
}

/** Cataclysm + Storm Crown + Chain Reaction + Soul Swarm: every on-kill boon maxed and the cross trigger. */
export const HEAVY_ON_KILL: ReadonlyArray<number> = cards(
	boonLevels(Boon.VOLATILE, 3),
	boonLevels(Boon.CHAIN_SPARK, 3),
	boonLevels(Boon.SOUL_SHARDS, 3),
	[duoCard(Duo.CHAIN_REACTION)],
);

/**
 * Fire Arrows + Thrill Seeker, at their heaviest: Ember Wake, Piercing Arrows III (Ricochet; arrows that pierce live on
 * and drop all four embers), Swift Strikes III (Flurry: a faster stream and every 6th arrow a triple), Daredevil III.
 */
export const HEAVY_ARROWS: ReadonlyArray<number> = cards(
	[boonCard(Boon.EMBER_WAKE)],
	boonLevels(Boon.PIERCING_ARROWS, 3),
	boonLevels(Boon.SWIFT_STRIKES, 3),
	boonLevels(Boon.DAREDEVIL, 3),
	[duoCard(Duo.FIRE_ARROWS)],
);

export const POOL_CASES: ReadonlyArray<PoolCase> = [
	{
		label: "Cataclysm + Storm Crown + Chain Reaction + Soul Swarm, sword",
		cards: HEAVY_ON_KILL,
		weapon: "weapon.sword",
	},
	{ label: "Cataclysm + Storm Crown + Chain Reaction + Soul Swarm, bow", cards: HEAVY_ON_KILL, weapon: "weapon.bow" },
	{ label: "Fire Arrows + Thrill Seeker (+ Ricochet, Flurry), bow", cards: HEAVY_ARROWS, weapon: "weapon.bow" },
];

/** Grants `build` to player `i` card by card; throws if a card did nothing (a typo in a case). */
export function grantBuild(s: SimState, i: number, build: ReadonlyArray<number>): void {
	for (const card of build) {
		if (grantCard(s, i, card) === -1) error(`grantBuild: card ${card} did nothing for player ${i}`, 0);
	}
}

// ---------------------------------------------------------------------------------------------
// Kill probe

/** What the probe counted (see the file comment). */
export interface KillCounts {
	/** Kills made by damage (any player, any source). */
	kills: number;
	/** Of those, kills made by a build effect (ctx.procGen > 0). */
	effectKills: number;
	/** Kills whose proc buildsOnKill queued. */
	procs: number;
	/** The highest kill generation seen (0: weapon kills only). */
	maxGen: number;
}

let counts: KillCounts | undefined;

function probeKill(ctx: SimCtx, a: Readonly<ActorState>, def: Readonly<ArchetypeDef>): void {
	const c = counts;
	if (c === undefined) return;
	const gen = ctx.procGen;
	c.kills += 1;
	if (gen > 0) c.effectKills += 1;
	if (gen > c.maxGen) c.maxGen = gen;
	const s = ctx.state.builds;
	if (s === undefined || def.stepDead !== undefined || PROC_INELIGIBLE_ARCHETYPES.includes(def.id)) return;
	const p = s.players[ctx.playerIndex];
	if (p !== undefined && gen < s.config.genMax && hasOnKillEffect(p)) c.procs += 1;
}

function probed(def: ArchetypeDef): ArchetypeDef {
	return {
		...def,
		onHit(ctx: SimCtx, a: ActorState, dmg: number) {
			if (def.onHit !== undefined) def.onHit(ctx, a, dmg);
			if (a.alive !== 0 && a.hp <= 0) probeKill(ctx, a, def);
		},
	};
}

/** Runs `fn` with the kill probe installed and returns its result with what the probe counted. */
export function withKillProbe<T>(fn: () => T): [T, KillCounts] {
	const originals: ArchetypeDef[] = [];
	for (const id of archetypeIds()) originals.push(archetypeAt(archetypeIndex(id)));
	for (const def of originals) registerArchetype(probed(def));
	const mine: KillCounts = { kills: 0, effectKills: 0, procs: 0, maxGen: 0 };
	counts = mine;
	const result = fn();
	counts = undefined;
	for (const def of originals) registerArchetype(def);
	return [result, mine];
}

// ---------------------------------------------------------------------------------------------
// Bots

export const TUNE_SWORD_CLOSE = 1.4;
export const TUNE_BOW_DISTANCE = 5;

/** The nearest living actor to `p` (any kind), or undefined. */
export function nearestLiving(s: SimState, p: Readonly<PlayerState>): ActorState | undefined {
	let best: ActorState | undefined;
	let bestD = math.huge;
	for (const a of s.combat.actors) {
		if (a.kind === NO_KIND || a.alive === 0) continue;
		const d = (a.x - p.x) * (a.x - p.x) + (a.z - p.z) * (a.z - p.z);
		if (d < bestD) {
			bestD = d;
			best = a;
		}
	}
	return best;
}

/** The bow bot strafes around its target, flipping direction every this many ticks. */
export const TUNE_BOW_STRAFE_TICKS = 120;
export const TUNE_BOW_STRAFE = 0.6;
/** Within this distance of an arena edge (bounds `half`) the bow bot is pulled back toward the centre. */
export const TUNE_EDGE_MARGIN = 2.5;

/**
 * The bots' frame for `p` against `t` (file comment); `extra` buttons are added (a roll). The bow bot (unlike
 * variantTtk.ts's) leads its target by the arrow's flight time (its last tick's velocity), strafes around it, and is
 * pulled toward the centre near the arena's edges (`half`; 0: no pull), so it neither stands cornered under a swarmer
 * nor misses a strafing imp forever.
 */
export function tuneBotFrame(
	p: Readonly<PlayerState>,
	t: ActorState | undefined,
	weapon: TuneWeapon,
	tick: number,
	half: number,
	extra = 0,
): InputFrame {
	if (t === undefined) return frame(0, 0, extra);
	const dx = t.x - p.x;
	const dz = t.z - p.z;
	const dist = math.sqrt(dx * dx + dz * dz);
	const ux = dist > 1e-9 ? dx / dist : 1;
	const uz = dist > 1e-9 ? dz / dist : 0;
	if (weapon === "weapon.sword") {
		const walk = dist > TUNE_SWORD_CLOSE ? 1 : 0;
		const fire = dist <= SWORD_DATA.reach + t.radius ? Button.FIRE : 0;
		return frame(ux * walk, uz * walk, bit32.bor(fire, extra), ux, uz);
	}
	const flight = dist / BOW_DATA.speed;
	const ax = dx + (t.x - t.prevX) * SIM_HZ * flight;
	const az = dz + (t.z - t.prevZ) * SIM_HZ * flight;
	const alen = math.sqrt(ax * ax + az * az);
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
	const mlen = math.sqrt(mx * mx + mz * mz);
	if (mlen > 1) {
		mx /= mlen;
		mz /= mlen;
	}
	return frame(mx, mz, bit32.bor(Button.FIRE, extra), alen > 1e-9 ? ax / alen : ux, alen > 1e-9 ? az / alen : uz);
}

// ---------------------------------------------------------------------------------------------
// Arena fights

/** A floor's hp: the endless floor and Depth set on the state before anything spawns. */
export interface TuneFloor {
	readonly floor: number;
	readonly depth: number;
}

/** Room fights: floors 1 / 6 / 11 at the Depth of a run that killed every boss on the way. */
export const TUNE_FLOORS: ReadonlyArray<TuneFloor> = [
	{ floor: 1, depth: 1 },
	{ floor: 6, depth: 2 },
	{ floor: 11, depth: 3 },
];

/** Boss fights: Mother Bramble's own floors 5 / 10 / 15 (Depth 1 / 2 / 3: the bosses before her). */
export const TUNE_BOSS_FLOORS: ReadonlyArray<TuneFloor> = [
	{ floor: 5, depth: 1 },
	{ floor: 10, depth: 2 },
	{ floor: 15, depth: 3 },
];

export interface TuneSpawn {
	readonly kind: string;
	readonly x: number;
	readonly z: number;
	readonly affix: number;
}

/** One arena fight: what spawns, the arena's half size, where the player starts, the time cap. */
export interface TuneFight {
	readonly label: string;
	readonly spawns: ReadonlyArray<TuneSpawn>;
	readonly half: number;
	readonly startX: number;
	readonly startZ: number;
	/** spawns[0] is a boss: the fight is over when it dies, and the arena is its boss room. */
	readonly boss: boolean;
	readonly maxSeconds: number;
}

/** builds/procs.spec.ts's swarmer pack: 8 swarmers 5-7 units ahead of the player (+Z). */
export const TUNE_PACK: TuneFight = {
	label: "swarmer pack (8)",
	spawns: [
		[-1.5, 5],
		[-0.5, 5],
		[0.5, 5],
		[1.5, 5],
		[-1, 6],
		[0, 6],
		[1, 6],
		[0, 7],
	].map(([x, z]) => ({ kind: SWARMER.id, x, z, affix: AffixKind.NONE })),
	half: 12,
	startX: 0,
	startZ: 0,
	boss: false,
	maxSeconds: 60,
};

/** Mother Bramble's arena: a square boss room this half size, the player 3 units inside its -Z edge. */
export const TUNE_BOSS_HALF = 13;

export const TUNE_BOSS: TuneFight = {
	label: "Mother Bramble",
	spawns: [{ kind: BOSS_ACT1_ID, x: 0, z: 0, affix: AffixKind.NONE }],
	half: TUNE_BOSS_HALF,
	startX: 0,
	startZ: -(TUNE_BOSS_HALF - 3),
	boss: true,
	maxSeconds: 900,
};

function arenaConfig(seed: number, weapon: TuneWeapon, fight: TuneFight): SimConfig {
	const h = fight.half;
	const bounds = { minX: -h, maxX: h, minZ: -h, maxZ: h };
	const cache = new Map<number, EndlessFloorWorld>();
	const worldForFloor = (floor: number): EndlessFloorWorld => {
		let w = cache.get(floor);
		if (w === undefined) {
			w = {
				floor,
				config: {
					bounds,
					loadout: [weapon],
					encounter: {
						spawns: [],
						rooms: fight.boss
							? [
									{
										id: 0,
										type: "boss",
										depth: 1,
										cx: 0,
										cz: 0,
										minX: -h,
										maxX: h,
										minZ: -h,
										maxZ: h,
										floorTiles: 4 * h * h,
									},
							  ]
							: [],
						entranceRoom: -1,
						bossRoom: fight.boss ? 0 : -1,
					},
				},
				bossFloor: false,
				spawnX: fight.startX,
				spawnZ: fight.startZ,
				stairX: 1000,
				stairZ: 1000,
				roomSpawns: [],
				roomIdAt: () => -1,
			};
			cache.set(floor, w);
		}
		return w;
	};
	return {
		endless: { runSeed: seed, worldForFloor },
		scoring: {},
		affixes: AFFIXES_CONFIG,
		builds: BUILDS_CONFIG,
	};
}

/** One fight's outcome. */
export interface FightResult {
	/** Seconds from tick 0 to the clear (the boss's death); -1: not cleared within the fight's maxSeconds. */
	readonly seconds: number;
	readonly hitsTaken: number;
	readonly counts: KillCounts;
	/** Effect bullets refused by the budget, and every other drop (see the file comment). */
	readonly effectDropped: number;
	readonly otherDropped: number;
	/** The most procs still queued after a tick's drain (> 0: procsPerTick carried some over). */
	readonly maxQueue: number;
}

function anyLiving(s: SimState): boolean {
	for (const a of s.combat.actors) if (a.kind !== NO_KIND && a.alive !== 0) return true;
	return false;
}

/** One arena fight (file comment). `seed`: the run seed (the actors' rng). */
export function buildFight(
	fight: TuneFight,
	build: BuildCase,
	weapon: TuneWeapon,
	f: TuneFloor,
	seed: number,
): FightResult {
	const [r, killCounts] = withKillProbe(() => {
		const config = arenaConfig(seed, weapon, fight);
		const s = createSimState(seed, fight.startX, fight.startZ, config);
		s.endless!.floor = f.floor;
		s.endless!.depth = f.depth;
		grantBuild(s, 0, build.cards);
		const ctx = new SimCtx().bind(s, simWorldConfig(s, config), EMPTY_INPUT);
		const spawned: ActorState[] = [];
		for (const sp of fight.spawns) {
			const a = spawnActor(ctx, archetypeIndex(sp.kind), sp.x, sp.z, sp.affix);
			if (a === undefined) error(`buildFight: could not spawn ${sp.kind}`, 0);
			spawned.push(a);
		}
		const boss = fight.boss ? spawned[0] : undefined;
		let hits = 0;
		let effectDropped = 0;
		let otherDropped = 0;
		let maxQueue = 0;
		const maxTicks = fight.maxSeconds * SIM_HZ;
		for (let k = 0; k < maxTicks; k++) {
			const droppedBefore = s.combat.dropped;
			step(s, tuneBotFrame(s.player, nearestLiving(s, s.player), weapon, s.tick, fight.half), config);
			s.player.hearts = s.player.heartsMax;
			hits += s.events.playerHits;
			const eff = s.builds!.events.effectDropped;
			effectDropped += eff;
			otherDropped += s.combat.dropped - droppedBefore - eff;
			maxQueue = math.max(maxQueue, s.builds!.procs.size());
			const done = boss !== undefined ? boss.alive === 0 : !anyLiving(s);
			if (done) return { seconds: (k + 1) / SIM_HZ, hits, effectDropped, otherDropped, maxQueue };
		}
		return { seconds: -1, hits, effectDropped, otherDropped, maxQueue };
	});
	return {
		seconds: r.seconds,
		hitsTaken: r.hits,
		counts: killCounts,
		effectDropped: r.effectDropped,
		otherDropped: r.otherDropped,
		maxQueue: r.maxQueue,
	};
}

/** One printed row: per floor, means over the seeds (seconds -1 when any fight was not cleared). */
export interface BuildTtkRow {
	readonly build: BuildCase;
	readonly seconds: number[];
	readonly kills: number[];
	readonly effectShare: number[];
	readonly procs: number[];
	readonly maxGen: number[];
	readonly hitsTaken: number[];
	readonly otherDropped: number;
	/** The most procs left queued after a drain, over every fight of the row. */
	readonly maxQueue: number;
}

/** Every build of `builds` against `fight` at every floor of `floors` with `weapon`, over run seeds `seeds`. */
export function buildTtkRows(
	fight: (f: TuneFloor) => TuneFight,
	builds: ReadonlyArray<BuildCase>,
	weapon: TuneWeapon,
	floors: ReadonlyArray<TuneFloor>,
	seeds: ReadonlyArray<number>,
): BuildTtkRow[] {
	const rows: BuildTtkRow[] = [];
	for (const build of builds) {
		const row: BuildTtkRow = {
			build,
			seconds: [],
			kills: [],
			effectShare: [],
			procs: [],
			maxGen: [],
			hitsTaken: [],
			otherDropped: 0,
			maxQueue: 0,
		};
		let other = 0;
		let queue = 0;
		for (const f of floors) {
			let sum = 0;
			let failed = false;
			let kills = 0;
			let effect = 0;
			let procs = 0;
			let maxGen = 0;
			let hits = 0;
			for (const seed of seeds) {
				const r = buildFight(fight(f), build, weapon, f, seed);
				if (r.seconds < 0) failed = true;
				sum += r.seconds;
				kills += r.counts.kills;
				effect += r.counts.effectKills;
				procs += r.counts.procs;
				maxGen = math.max(maxGen, r.counts.maxGen);
				hits += r.hitsTaken;
				other += r.otherDropped;
				queue = math.max(queue, r.maxQueue);
			}
			const n = seeds.size();
			row.seconds.push(failed ? -1 : sum / n);
			row.kills.push(kills / n);
			row.effectShare.push(kills > 0 ? effect / kills : 0);
			row.procs.push(procs / n);
			row.maxGen.push(maxGen);
			row.hitsTaken.push(hits / n);
		}
		rows.push({ ...row, otherDropped: other, maxQueue: queue });
	}
	return rows;
}

const secs = (x: number, cap: number) => (x < 0 ? `> ${cap}` : string.format("%.1f", x));

/** Markdown header for buildTtkRows' rows over `floors`. */
export function buildTtkHeader(floors: ReadonlyArray<TuneFloor>): string {
	const fs = floors.map((f) => `f${f.floor}`).join(" / ");
	return `| build | TTK s ${fs} | x no build ${fs} | effect kills ${fs} | procs ${fs} | max gen | queue | hits ${fs} |`;
}

/** One row as Markdown; `base` is the no-build row (for the ratio). */
export function formatBuildTtkRow(row: BuildTtkRow, base: BuildTtkRow, cap: number): string {
	const ratio = row.seconds.map((x, i) =>
		x < 0 || base.seconds[i] <= 0 ? "-" : string.format("%.2f", x / base.seconds[i]),
	);
	return (
		`| ${row.build.label} | ${row.seconds.map((x) => secs(x, cap)).join(" / ")} | ${ratio.join(" / ")} | ` +
		`${row.effectShare.map((x) => string.format("%d%%", math.round(x * 100))).join(" / ")} | ` +
		`${row.procs.map((x) => string.format("%.1f", x)).join(" / ")} | ${math.max(...row.maxGen)} | ${
			row.maxQueue
		} | ` +
		`${row.hitsTaken.map((x) => string.format("%.1f", x)).join(" / ")} |`
	);
}

/** The bow's stream and the sword's full combo flat out on one target (damage per second). */
export function tuneIdealDps(weapon: TuneWeapon): number {
	if (weapon === "weapon.bow") return (BOW_DATA.damage * SIM_HZ) / BOW_DATA.streamTicks;
	const d = SWORD_DATA;
	const cycle = 2 * d.swingRecoveryTicks + d.finisherWindupTicks + d.finisherRecoveryTicks;
	return ((2 * d.damage + d.finisherDamage) * SIM_HZ) / cycle;
}

// ---------------------------------------------------------------------------------------------
// The census room

/** A real endless room's planned spawns (solo), where it is, and its spawns centred for an arena fight. */
export interface CensusRoom {
	readonly run: number;
	readonly floor: number;
	readonly room: number;
	readonly kinds: string;
	readonly fight: TuneFight;
}

function kindsOf(spawns: ReadonlyArray<{ kind: string; affix: number }>): string {
	const counts = new Map<string, number>();
	const order: string[] = [];
	for (const s of spawns) {
		const id = s.affix !== AffixKind.NONE ? `${s.kind}*` : s.kind;
		if (!counts.has(id)) order.push(id);
		counts.set(id, (counts.get(id) ?? 0) + 1);
	}
	return order.map((k) => `${counts.get(k)} ${k}`).join(", ");
}

function distinctKinds(spawns: ReadonlyArray<{ kind: string }>): number {
	const seen = new Set<string>();
	for (const s of spawns) seen.add(s.kind);
	return seen.size();
}

/**
 * The floor's "typical mixed room" over solo run seeds `firstRun`..`lastRun`: among the rooms with the most distinct
 * kinds (at least 2), the one whose enemy count is closest to the mean count of every room of the floor (ties: the
 * lower run, then the lower room id). Its spawns are moved so their centroid is the origin (the player's start), each
 * at least SPAWN_SAFE_RADIUS from it, in an arena 3 units wider than the farthest spawn (at least 12).
 */
export function tuneCensusRoom(floor: number, firstRun: number, lastRun: number): CensusRoom {
	interface Candidate {
		run: number;
		room: number;
		spawns: TuneSpawn[];
	}
	const all: Candidate[] = [];
	let total = 0;
	for (let run = firstRun; run <= lastRun; run++) {
		const world = buildEndlessRunConfig(run, 1).endlessFloor(floor);
		for (let id = 0; id < world.roomSpawns.size(); id++) {
			const planned = world.roomSpawns[id];
			if (planned.size() === 0) continue;
			const affixes = world.roomAffixes?.[id];
			const spawns: TuneSpawn[] = [];
			for (let i = 0; i < planned.size(); i++)
				spawns.push({ kind: planned[i].kind, x: planned[i].x, z: planned[i].z, affix: affixes?.[i] ?? 0 });
			all.push({ run, room: id, spawns });
			total += spawns.size();
		}
	}
	if (all.size() === 0) error(`tuneCensusRoom: no room on floor ${floor}`, 0);
	const mean = total / all.size();
	let most = 0;
	for (const c of all) most = math.max(most, distinctKinds(c.spawns));
	let best: Candidate | undefined;
	for (const c of all) {
		if (distinctKinds(c.spawns) !== most) continue;
		if (best === undefined || math.abs(c.spawns.size() - mean) < math.abs(best.spawns.size() - mean)) best = c;
	}
	const pick = best!;
	const kinds = kindsOf(pick.spawns);
	return {
		run: pick.run,
		floor,
		room: pick.room,
		kinds,
		fight: centredFight(`run ${pick.run} floor ${floor} room ${pick.room} (${kinds})`, pick.spawns),
	};
}

/**
 * An arena fight of a real room's spawns: moved so their centroid is the origin (the player's start), each at least
 * SPAWN_SAFE_RADIUS from it, in an arena 3 units wider than the farthest spawn (at least 12), capped at 180 s.
 */
export function centredFight(label: string, spawns: ReadonlyArray<TuneSpawn>): TuneFight {
	let cx = 0;
	let cz = 0;
	for (const sp of spawns) {
		cx += sp.x;
		cz += sp.z;
	}
	cx /= spawns.size();
	cz /= spawns.size();
	let far = 0;
	const moved = spawns.map((sp): TuneSpawn => {
		let x = sp.x - cx;
		let z = sp.z - cz;
		const d = math.sqrt(x * x + z * z);
		if (d < SPAWN_SAFE_RADIUS) {
			const ux = d > 1e-9 ? x / d : 0;
			const uz = d > 1e-9 ? z / d : 1;
			x = ux * SPAWN_SAFE_RADIUS;
			z = uz * SPAWN_SAFE_RADIUS;
		}
		far = math.max(far, math.abs(x), math.abs(z));
		return { kind: sp.kind, x, z, affix: sp.affix };
	});
	return {
		label,
		spawns: moved,
		half: math.max(12, math.ceil(far + 3)),
		startX: 0,
		startZ: 0,
		boss: false,
		maxSeconds: 180,
	};
}

// ---------------------------------------------------------------------------------------------
// Player bullet high-water

/** Every TUNE_POOL_ROLL_TICKS each player rolls (staggered by TUNE_POOL_ROLL_STAGGER x their index). */
export const TUNE_POOL_ROLL_TICKS = 90;
export const TUNE_POOL_ROLL_STAGGER = 17;

/** Depth after every boss on the way (boss floors 5, 10, 15, ...). */
export function tuneDepthAt(floor: number): number {
	let depth = 1;
	for (let f = 1; f < floor; f++) if (isBossFloor(f)) depth++;
	return depth;
}

export interface PoolResult {
	readonly room: number;
	readonly kinds: string;
	/** Most player bullets alive at once (of PLAYER_BULLET_CAPACITY). */
	readonly maxPlayerBullets: number;
	/** Most effect bullets alive at once, all players together, and for one player. */
	readonly maxEffects: number;
	readonly maxEffectsOne: number;
	/** Most weapon bullets one player had alive (their emitter's bullets minus their effect bullets). */
	readonly maxWeaponOne: number;
	readonly effectDropped: number;
	/** combat.dropped's rise minus the effect drops: weapon shots, while the enemy pool never filled. */
	readonly otherDropped: number;
	readonly maxEnemyBullets: number;
	readonly kills: number;
	/** Seconds to clear the room (-1: not cleared within the run). */
	readonly cleared: number;
	/** The most procs still queued after a tick's drain. */
	readonly maxQueue: number;
}

/**
 * The densest room (by roomLoad's slots) of run `seed`'s floor `floor` for a party of `party`, with its planned affixes
 * (shared/run buildEndlessRunConfig's floor), as an arena fight (centredFight).
 */
export function densestRoom(
	seed: number,
	floor: number,
	party: number,
): { room: number; kinds: string; fight: TuneFight } {
	const world = buildEndlessRunConfig(seed, party).endlessFloor(floor);
	let room = -1;
	let best = -1;
	for (let id = 0; id < world.roomSpawns.size(); id++) {
		const load = roomLoad(world.roomSpawns[id]);
		if (world.roomSpawns[id].size() > 0 && load.slots > best) {
			best = load.slots;
			room = id;
		}
	}
	const planned = world.roomSpawns[room];
	const affixes = world.roomAffixes?.[room];
	const spawns = planned.map((sp, i): TuneSpawn => ({ kind: sp.kind, x: sp.x, z: sp.z, affix: affixes?.[i] ?? 0 }));
	const kinds = kindsOf(spawns);
	return { room, kinds, fight: centredFight(`run ${seed} floor ${floor} room ${room} (${kinds})`, spawns) };
}

/**
 * The player bullet high-water of `build` on every player of a party of `party` in the densest room of run `seed`'s
 * floor `floor` (densestRoom), at that floor's hp (Depth tuneDepthAt; spawnActor adds the party's hp multiplier),
 * `seconds` of combat in god mode (file comment, item 3).
 */
export function buildPoolRun(seed: number, floor: number, party: number, build: PoolCase, seconds: number): PoolResult {
	const dense = densestRoom(seed, floor, party);
	const fight = dense.fight;
	const solo = arenaConfig(seed, build.weapon, fight);
	const config: SimConfig = party > 1 ? { ...solo, scoring: { partySize: party }, party: { size: party } } : solo;
	const s = createSimState(seed, fight.startX, fight.startZ, config);
	s.endless!.floor = floor;
	s.endless!.depth = tuneDepthAt(floor);
	for (let i = 0; i < party; i++) grantBuild(s, i, build.cards);
	const ctx = new SimCtx().bind(s, simWorldConfig(s, config), EMPTY_INPUT);
	for (const sp of fight.spawns) spawnActor(ctx, archetypeIndex(sp.kind), sp.x, sp.z, sp.affix);
	let maxPlayerBullets = 0;
	let maxEffects = 0;
	let maxEffectsOne = 0;
	let maxWeaponOne = 0;
	let effectDropped = 0;
	let otherDropped = 0;
	let maxEnemyBullets = 0;
	let kills = 0;
	let cleared = -1;
	let maxQueue = 0;
	for (let k = 0; k < seconds * SIM_HZ; k++) {
		const frames: InputFrame[] = [];
		for (let i = 0; i < party; i++) {
			const p = playerAt(s, i);
			p.hearts = p.heartsMax;
			const roll = (s.tick + i * TUNE_POOL_ROLL_STAGGER) % TUNE_POOL_ROLL_TICKS === 0 ? Button.ROLL : 0;
			frames.push(
				tuneBotFrame(
					p,
					nearestLiving(s, p),
					build.weapon,
					s.tick + i * TUNE_BOW_STRAFE_TICKS,
					fight.half,
					roll,
				),
			);
		}
		const droppedBefore = s.combat.dropped;
		if (party > 1) stepParty(s, frames, config);
		else step(s, frames[0], config);
		kills += s.events.enemiesKilled;
		const eff = s.builds!.events.effectDropped;
		effectDropped += eff;
		otherDropped += s.combat.dropped - droppedBefore - eff;
		const pb = s.combat.playerBullets;
		maxPlayerBullets = math.max(maxPlayerBullets, pb.activeCount);
		maxEnemyBullets = math.max(maxEnemyBullets, s.combat.enemyBullets.activeCount);
		let effects = 0;
		for (let i = 0; i < party; i++) {
			const e = effectBulletsAlive(s, i);
			effects += e;
			maxEffectsOne = math.max(maxEffectsOne, e);
			maxWeaponOne = math.max(maxWeaponOne, pb.activeCountFor(weaponsAt(s, i).emitterId) - e);
		}
		maxEffects = math.max(maxEffects, effects);
		maxQueue = math.max(maxQueue, s.builds!.procs.size());
		if (cleared < 0 && !anyLiving(s)) cleared = (k + 1) / SIM_HZ;
	}
	return {
		room: dense.room,
		kinds: dense.kinds,
		maxPlayerBullets,
		maxEffects,
		maxEffectsOne,
		maxWeaponOne,
		effectDropped,
		otherDropped,
		maxEnemyBullets,
		kills,
		cleared,
		maxQueue,
	};
}

/** The pool's capacities, for the printed rows. */
export const TUNE_POOL_CAPACITY = { player: PLAYER_BULLET_CAPACITY, enemy: ENEMY_BULLET_CAPACITY };

/** Markdown row of a pool run. */
export function formatPoolRow(label: string, seed: number, floor: number, party: number, r: PoolResult): string {
	return (
		`| ${label} | ${party} | run ${seed} f${floor} room ${r.room} (${r.kinds}) | ${r.maxPlayerBullets} | ` +
		`${r.maxEffects} / ${r.maxEffectsOne} | ${r.maxWeaponOne} | ${r.effectDropped} | ${r.otherDropped} | ` +
		`${r.maxEnemyBullets} | ${r.kills} | ${r.cleared < 0 ? "no" : string.format("%.1f", r.cleared)} | ${
			r.maxQueue
		} |`
	);
}

export function poolHeader(): string {
	return (
		"| build | party | room | max player bullets | max effects all / one | max weapon one | effect drops | " +
		"other drops | max enemy bullets | kills | cleared s | queue |"
	);
}
