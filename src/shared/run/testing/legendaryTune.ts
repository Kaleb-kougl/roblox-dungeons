/**
 * Test support for specs (never imported by the game): docs/LEGENDARIES.md LG7's tuning measurements, on BU13's
 * harnesses (./buildTune.ts: the arena, the bots, the kill probe; ./buildOffers.ts: the offer statistics, extended there
 * with the legendary tallies and Greed's deal). Measurements only: nothing here changes a rule or a number.
 *
 * 1. Overkill TTK and chains (overkillRows): buildTune.ts's arena fights (the swarmer pack, the census rooms) with the
 *    Overkill builds (OVERKILL_TTK_CASES), plus per fight, read from the unhashed BuildEvents after every step: the
 *    streaks that struck (overkill* lists), their carries, their generations (the longest chain = the highest
 *    generation + 1 links), Skewer's line strikes (duoProc entries of Duo.SKEWER: enemies struck - 1 besides the
 *    target), and from the kill probe the kills made by a streak's strike (KillCounts.streakKills).
 *    Skewer counterfactuals (no sim change): the probe's hit observer sees each streak's first strike with every actor
 *    where the streak found it (the corpse and the target from the streak's overkill event, pushed before the strike),
 *    and counts the OTHER living enemies (nearestEnemy's skips: free, dead, spawned this tick) within SKEWER_RADIUS of
 *    three lines: corpse -> target (the first LG4 rule), extended (corpse -> the point OVERKILL_RANGE from the corpse
 *    through the target: Skewer's rule since the owner's tuning), and farthest (corpse -> the farthest such enemy within OVERKILL_RANGE, that enemy not counted). Only
 *    the line's geometry at the first strike: no chain is replayed under the alternative rule.
 * 2. Bastion (defenseFight): a room's enemies at floor 6's hp (Depth 2) in buildTune.ts's open arena, god mode (hearts
 *    refilled after every step; hits that landed and half hearts lost counted before the refill), DEFENSE_SECONDS or
 *    until every enemy is dead (turret rooms never clear: turrets revive). One room = one fight: the pick (grantCard)
 *    arms the brace once, and nothing re-arms it in an arena (no room spawns), so "per room" is per fight. Bots:
 *      guard  the sword bot (tuneBotFrame) plus ALT (the guard) whenever the guard is off cooldown, the knight is not
 *             rolling and an enemy bullet is within DEFENSE_GUARD_TRIGGER of the knight; never rolls
 *      roll   the bow bot (tuneBotFrame, the stream) plus a ROLL toward the nearest enemy bullet whenever it is not
 *             rolling, did not press ROLL last frame, and at least DEFENSE_ROLL_BULLETS enemy bullets are within
 *             DEFENSE_ROLL_RADIUS (into the volley, so the i-frames carry it through)
 *      -hold  the same defence without attacking: the bow bot's movement (kiting at TUNE_BOW_DISTANCE, strafing) with
 *             the FIRE bit cleared, the sword or the bow in hand; nothing dies, so the room's pressure lasts the
 *             whole DEFENSE_SECONDS and the hits measure the defence alone (the fighting bots also measure how a
 *             longer guard slows the killing: the guard cancels the combo and halves the walk)
 *    Guard cancels come from the scored state's ScoreEvents.guardPlayer (one entry per erased bullet), so every row,
 *    Bastion or not, counts its guards' erasures; a "<brace>+" guard erased BASTION_BRACE_BULLETS or more. A roll's count is
 *    Bastion's own braceCount (only a Bastion roller marks bullets), read when the next roll starts and at the end.
 *    Braces from BuildEvents.braceKind (PIP = a pip restored). Guard shape variants without Bastion (DefenseCase
 *    guardTicks / guardCos): SWORD_DATA's guardTicks / guardHalfAngleCos are set for the fight and restored after
 *    (spec surgery, like setSwordTimings: the sword reads both live; Bastion's own BASTION_GUARD_TICKS /
 *    BASTION_GUARD_SWEEP_HALF_ANGLE_COS are constants, so a Bastion row can only measure the shipped numbers). The
 *    player starts DEFENSE_START_STEP x ((seed mod 5) - 2) along X from the fight's start, so seeds give different
 *    fights in the turret rooms too (turrets draw no rng).
 */
import { AffixKind } from "shared/dungeon";
import {
	BASTION_BRACE_BULLETS,
	Boon,
	BraceKind,
	Button,
	Duo,
	EMPTY_INPUT,
	KillCause,
	NO_KIND,
	OVERKILL_RANGE,
	SIM_HZ,
	SKEWER_RADIUS,
	SWARMER,
	SWORD_DATA,
	SimCtx,
	archetypeIndex,
	boonCard,
	createSimState,
	duoCard,
	simWorldConfig,
	spawnActor,
	step,
	weaponsAt,
	type ActorState,
	type InputFrame,
	type SimState,
} from "shared/sim";
import {
	anyLiving,
	arenaConfig,
	boonLevels,
	buildFight,
	grantBuild,
	nearestLiving,
	setProbeHitObserver,
	tuneBotFrame,
	type BuildCase,
	type BuildTtkRow,
	type TuneFight,
	type TuneFloor,
	type TuneWeapon,
} from "./buildTune";
import { frame } from "./endlessBot";
import { withCharacters } from "../characters";
import type { CharacterId } from "shared/characters";

// ---------------------------------------------------------------------------------------------
// 1. Overkill

/**
 * The LG7 Overkill rows: no build; Overkill alone; Sharpened I and Executioner (Sharpened III) without and with
 * Overkill; Volatile I and Supernova (Overkill + Volatile I + the duo); Piercing Arrows I and Skewer (Overkill + Piercing
 * Arrows I + the duo).
 */
export const OVERKILL_TTK_CASES: ReadonlyArray<BuildCase> = [
	{ label: "no build", cards: [] },
	{ label: "Overkill", cards: [boonCard(Boon.OVERKILL)] },
	{ label: "Sharpened I", cards: boonLevels(Boon.SHARPENED, 1) },
	{ label: "Overkill + Sharpened I", cards: [boonCard(Boon.OVERKILL), ...boonLevels(Boon.SHARPENED, 1)] },
	{ label: "Executioner (Sharpened III)", cards: boonLevels(Boon.SHARPENED, 3) },
	{ label: "Overkill + Executioner", cards: [boonCard(Boon.OVERKILL), ...boonLevels(Boon.SHARPENED, 3)] },
	{ label: "Volatile I", cards: boonLevels(Boon.VOLATILE, 1) },
	{
		label: "Supernova (Overkill + Volatile I)",
		cards: [boonCard(Boon.OVERKILL), boonCard(Boon.VOLATILE), duoCard(Duo.SUPERNOVA)],
	},
	{ label: "Piercing Arrows I", cards: boonLevels(Boon.PIERCING_ARROWS, 1) },
	{
		label: "Skewer (Overkill + Piercing Arrows I)",
		cards: [boonCard(Boon.OVERKILL), boonCard(Boon.PIERCING_ARROWS), duoCard(Duo.SKEWER)],
	},
];

/**
 * Skewer's best case (LG7): 6 swarmers in a row straight ahead of the player, 1 unit apart (5 .. 10 units), in BU13's
 * pack arena. The nearest swarmer is the first target, so a streak from a corpse in the row has the rest of the row
 * behind its target.
 */
export const TUNE_LINE: TuneFight = {
	label: "swarmer line (6)",
	spawns: [5, 6, 7, 8, 9, 10].map((z) => ({ kind: SWARMER.id, x: 0, z, affix: AffixKind.NONE })),
	half: 12,
	startX: 0,
	startZ: 0,
	boss: false,
	maxSeconds: 60,
};

/** The Skewer comparison rows for TUNE_LINE: Overkill alone and Skewer, beside Piercing Arrows I and no build. */
export const SKEWER_LINE_CASES: ReadonlyArray<BuildCase> = [
	OVERKILL_TTK_CASES[0],
	OVERKILL_TTK_CASES[1],
	OVERKILL_TTK_CASES[8],
	OVERKILL_TTK_CASES[9],
];

/** Streak tallies of fights (file comment, item 1). */
export interface StreakTally {
	kills: number;
	streakKills: number;
	streaks: number;
	carrySum: number;
	carryMax: number;
	/** The highest generation of a streak that struck (-1: none). */
	maxGen: number;
	/** Skewer: streaks whose line struck someone besides the target, and those extra enemies struck. */
	skewerLines: number;
	skewerExtra: number;
	/** Counterfactual lines at each streak's first strike: streaks seen; streaks with another enemy on the line, and
	 * the other enemies on it, as built / extended to OVERKILL_RANGE / to the farthest enemy in range. */
	cfStreaks: number;
	cfBuiltAny: number;
	cfBuilt: number;
	cfExtendedAny: number;
	cfExtended: number;
	cfFarthestAny: number;
	cfFarthest: number;
}

export function emptyStreakTally(): StreakTally {
	return {
		kills: 0,
		streakKills: 0,
		streaks: 0,
		carrySum: 0,
		carryMax: 0,
		maxGen: -1,
		skewerLines: 0,
		skewerExtra: 0,
		cfStreaks: 0,
		cfBuiltAny: 0,
		cfBuilt: 0,
		cfExtendedAny: 0,
		cfExtended: 0,
		cfFarthestAny: 0,
		cfFarthest: 0,
	};
}

function addTally(into: StreakTally, t: StreakTally): void {
	into.kills += t.kills;
	into.streakKills += t.streakKills;
	into.streaks += t.streaks;
	into.carrySum += t.carrySum;
	into.carryMax = math.max(into.carryMax, t.carryMax);
	into.maxGen = math.max(into.maxGen, t.maxGen);
	into.skewerLines += t.skewerLines;
	into.skewerExtra += t.skewerExtra;
	into.cfStreaks += t.cfStreaks;
	into.cfBuiltAny += t.cfBuiltAny;
	into.cfBuilt += t.cfBuilt;
	into.cfExtendedAny += t.cfExtendedAny;
	into.cfExtended += t.cfExtended;
	into.cfFarthestAny += t.cfFarthestAny;
	into.cfFarthest += t.cfFarthest;
}

const SKEWER_R2 = SKEWER_RADIUS * SKEWER_RADIUS;
const RANGE2 = OVERKILL_RANGE * OVERKILL_RANGE;

/** Squared distance from (x, z) to the segment (x1, z1) -> (x2, z2). */
function segmentDistance2(x: number, z: number, x1: number, z1: number, x2: number, z2: number): number {
	const dx = x2 - x1;
	const dz = z2 - z1;
	const len2 = dx * dx + dz * dz;
	let t = len2 > 1e-12 ? ((x - x1) * dx + (z - z1) * dz) / len2 : 0;
	t = math.clamp(t, 0, 1);
	const ex = x - (x1 + t * dx);
	const ez = z - (z1 + t * dz);
	return ex * ex + ez * ez;
}

function eligible(ctx: SimCtx, b: Readonly<ActorState>): boolean {
	return b.kind !== NO_KIND && b.alive !== 0 && b.spawnTick !== ctx.tick;
}

function onLineCount(ctx: SimCtx, skip: number, x1: number, z1: number, x2: number, z2: number): number {
	let n = 0;
	const actors = ctx.actors;
	for (let j = 0; j < actors.size(); j++) {
		const b = actors[j];
		if (j === skip || !eligible(ctx, b)) continue;
		if (segmentDistance2(b.x, b.z, x1, z1, x2, z2) <= SKEWER_R2) n++;
	}
	return n;
}

let cfTally: StreakTally | undefined;
let cfTick = -1;
let cfSeen = 0;

/** The probe's hit observer: a streak's first strike (file comment, item 1). */
function observeStreakHit(ctx: SimCtx): void {
	const t = cfTally;
	if (t === undefined || ctx.procCause !== KillCause.OVERKILL) return;
	const e = ctx.state.builds?.events;
	if (e === undefined) return;
	const n = e.overkillX1.size();
	if (n === 0 || (ctx.tick === cfTick && n === cfSeen)) return;
	cfTick = ctx.tick;
	cfSeen = n;
	const x1 = e.overkillX1[n - 1];
	const z1 = e.overkillZ1[n - 1];
	const x2 = e.overkillX2[n - 1];
	const z2 = e.overkillZ2[n - 1];
	const actors = ctx.actors;
	let target = -1;
	let far = -1;
	let farD2 = -1;
	for (let j = 0; j < actors.size(); j++) {
		const b = actors[j];
		if (!eligible(ctx, b)) continue;
		if (target < 0 && b.x === x2 && b.z === z2) target = j;
		const d2 = (b.x - x1) * (b.x - x1) + (b.z - z1) * (b.z - z1);
		if (d2 <= RANGE2 && d2 > farD2) {
			far = j;
			farD2 = d2;
		}
	}
	t.cfStreaks++;
	const built = onLineCount(ctx, target, x1, z1, x2, z2);
	const dx = x2 - x1;
	const dz = z2 - z1;
	const len = math.sqrt(dx * dx + dz * dz);
	const ex = len > 1e-9 ? x1 + (dx / len) * OVERKILL_RANGE : x2;
	const ez = len > 1e-9 ? z1 + (dz / len) * OVERKILL_RANGE : z2;
	const extended = onLineCount(ctx, target, x1, z1, ex, ez);
	const farthest = far >= 0 ? onLineCount(ctx, far, x1, z1, actors[far].x, actors[far].z) : 0;
	t.cfBuilt += built;
	t.cfExtended += extended;
	t.cfFarthest += farthest;
	if (built > 0) t.cfBuiltAny++;
	if (extended > 0) t.cfExtendedAny++;
	if (farthest > 0) t.cfFarthestAny++;
}

/** After every step: this tick's streaks and Skewer lines (BuildEvents). */
function observeStreakEvents(s: SimState, t: StreakTally): void {
	const e = s.builds?.events;
	if (e === undefined) return;
	for (let k = 0; k < e.overkillCarry.size(); k++) {
		const c = e.overkillCarry[k];
		t.streaks++;
		t.carrySum += c;
		t.carryMax = math.max(t.carryMax, c);
		t.maxGen = math.max(t.maxGen, e.overkillGen[k]);
	}
	for (let k = 0; k < e.duoProcDuo.size(); k++) {
		if (e.duoProcDuo[k] !== Duo.SKEWER) continue;
		t.skewerLines++;
		t.skewerExtra += e.duoProcValue[k] - 1;
	}
}

/** One printed Overkill row: BU13's TTK row (formatBuildTtkRow) and the streak tallies per floor and overall. */
export interface OverkillRow {
	readonly ttk: BuildTtkRow;
	readonly perFloor: StreakTally[];
	readonly all: StreakTally;
}

/** Every build of `builds` against `fight` at every floor with `weapon` over `seeds` (file comment, item 1). */
export function overkillRows(
	fight: (f: TuneFloor) => TuneFight,
	builds: ReadonlyArray<BuildCase>,
	weapon: TuneWeapon,
	floors: ReadonlyArray<TuneFloor>,
	seeds: ReadonlyArray<number>,
): OverkillRow[] {
	const rows: OverkillRow[] = [];
	setProbeHitObserver((ctx) => observeStreakHit(ctx));
	for (const build of builds) {
		const ttk: BuildTtkRow = {
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
		const perFloor: StreakTally[] = [];
		const all = emptyStreakTally();
		let other = 0;
		let queue = 0;
		for (const f of floors) {
			const ft = emptyStreakTally();
			let sum = 0;
			let failed = false;
			let effect = 0;
			let procs = 0;
			let maxGen = 0;
			let hits = 0;
			for (const seed of seeds) {
				const t = emptyStreakTally();
				cfTally = t;
				cfTick = -1;
				cfSeen = 0;
				const r = buildFight(fight(f), build, weapon, f, seed, (s) => observeStreakEvents(s, t));
				cfTally = undefined;
				t.kills = r.counts.kills;
				t.streakKills = r.counts.streakKills;
				addTally(ft, t);
				if (r.seconds < 0) failed = true;
				sum += r.seconds;
				effect += r.counts.effectKills;
				procs += r.counts.procs;
				maxGen = math.max(maxGen, r.counts.maxGen);
				hits += r.hitsTaken;
				other += r.otherDropped;
				queue = math.max(queue, r.maxQueue);
			}
			const n = seeds.size();
			ttk.seconds.push(failed ? -1 : sum / n);
			ttk.kills.push(ft.kills / n);
			ttk.effectShare.push(ft.kills > 0 ? effect / ft.kills : 0);
			ttk.procs.push(procs / n);
			ttk.maxGen.push(maxGen);
			ttk.hitsTaken.push(hits / n);
			perFloor.push(ft);
			addTally(all, ft);
		}
		rows.push({ ttk: { ...ttk, otherDropped: other, maxQueue: queue }, perFloor, all });
	}
	setProbeHitObserver(undefined);
	return rows;
}

const pct = (a: number, b: number) => (b > 0 ? string.format("%d%%", math.round((100 * a) / b)) : "-");
const per = (a: number, b: number, fmt = "%.2f") => (b > 0 ? string.format(fmt, a / b) : "-");

/** Markdown header of the streak table over `floors`. */
export function streakHeader(floors: ReadonlyArray<TuneFloor>): string {
	const fs = floors.map((f) => `f${f.floor}`).join(" / ");
	return (
		`| build | kills ${fs} | streaks per kill ${fs} | kills by a streak ${fs} | carry mean ${fs} | carry max | ` +
		`longest chain (links) | Skewer: streaks striking others / extra enemies |`
	);
}

export function formatStreakRow(row: OverkillRow, seeds: number): string {
	const f = row.perFloor;
	const a = row.all;
	return (
		`| ${row.ttk.build.label} | ${f.map((t) => per(t.kills, seeds, "%.1f")).join(" / ")} | ` +
		`${f.map((t) => per(t.streaks, t.kills)).join(" / ")} | ${f
			.map((t) => pct(t.streakKills, t.kills))
			.join(" / ")} | ` +
		`${f.map((t) => per(t.carrySum, t.streaks)).join(" / ")} | ${
			a.streaks > 0 ? string.format("%.2f", a.carryMax) : "-"
		} | ` +
		`${a.maxGen >= 0 ? a.maxGen + 1 : "-"} | ${
			a.skewerLines > 0 || a.streaks > 0 ? `${a.skewerLines} / ${a.skewerExtra}` : "-"
		} |`
	);
}

/** Markdown header of the Skewer line table (all floors together). */
export function skewerHeader(): string {
	return (
		"| build | streaks | corpse -> target (first LG4 rule): streaks with another enemy on the line / others per streak | " +
		"extended to OVERKILL_RANGE (the rule now) | to the farthest enemy in range |"
	);
}

export function formatSkewerRow(row: OverkillRow): string {
	const a = row.all;
	const n = a.cfStreaks;
	const cell = (any: number, sum: number) => `${pct(any, n)} / ${per(sum, n)}`;
	return (
		`| ${row.ttk.build.label} | ${n} | ${cell(a.cfBuiltAny, a.cfBuilt)} | ${cell(
			a.cfExtendedAny,
			a.cfExtended,
		)} | ` + `${cell(a.cfFarthestAny, a.cfFarthest)} |`
	);
}

// ---------------------------------------------------------------------------------------------
// 2. Bastion

/** The defence bots (file comment, item 2); "-hold": the same defence, but the bot never attacks (it kites at the bow
 * bot's distance with the FIRE bit cleared), so nothing dies and the room's pressure stays for DEFENSE_SECONDS. */
export type DefenseBot = "guard" | "roll" | "guard-hold" | "roll-hold";

/** True for the sword bots that guard. */
export function guardBot(bot: DefenseBot): boolean {
	return bot === "guard" || bot === "guard-hold";
}

function holdBot(bot: DefenseBot): boolean {
	return bot === "guard-hold" || bot === "roll-hold";
}

/** A Bastion row: a build, and optionally the guard's shape without Bastion (SWORD_DATA, file comment, item 2). */
export interface DefenseCase extends BuildCase {
	readonly guardTicks?: number;
	readonly guardCos?: number;
}

export interface DefenseRoom {
	readonly label: string;
	readonly fight: TuneFight;
	/** false: never ends before DEFENSE_SECONDS (turrets revive). */
	readonly untilClear: boolean;
}

/** Bastion's rooms are fought at floor 6's hp (Depth 2). */
export const DEFENSE_FLOOR: TuneFloor = { floor: 6, depth: 2 };
/** A room lasts at most this long (the f6 mixed census room's no-build sword TTK was 14.6 s, the bow's 28.3 s). */
export const DEFENSE_SECONDS = 20;
/** The guard bot guards when an enemy bullet is this close (the guard's reach plus about 5 ticks of a bullet's flight). */
export const DEFENSE_GUARD_TRIGGER = SWORD_DATA.guardReach + 0.6;
/** The roll bot rolls into a volley when this many enemy bullets are within DEFENSE_ROLL_RADIUS. */
export const DEFENSE_ROLL_BULLETS = 2;
export const DEFENSE_ROLL_RADIUS = 1.6;
/** A higher brace threshold to compare with BASTION_BRACE_BULLETS (the tables' second "stopping" column). */
export const DEFENSE_HIGH_STOPS = 12;

function room(label: string, kind: string, at: ReadonlyArray<readonly [number, number]>, untilClear: boolean) {
	return {
		label,
		untilClear,
		fight: {
			label,
			spawns: at.map(([x, z]) => ({ kind, x, z, affix: AffixKind.NONE })),
			half: 12,
			startX: 0,
			startZ: 0,
			boss: false,
			maxSeconds: DEFENSE_SECONDS,
		},
	};
}

/** The synthetic single-kind rooms (the spec adds a census room for the mixed one). */
export const DEFENSE_ROOMS: ReadonlyArray<DefenseRoom> = [
	room(
		"2 turret.caster",
		"turret.caster",
		[
			[-3, 5],
			[3, 5],
		],
		false,
	),
	room(
		"2 turret.sprayer",
		"turret.sprayer",
		[
			[-3, 5],
			[3, 5],
		],
		false,
	),
	room(
		"4 sniper",
		"sniper",
		[
			[-5, 5],
			[5, 5],
			[-6, -2],
			[6, -2],
		],
		true,
	),
	room(
		"2 reaper",
		"reaper",
		[
			[-4, 5],
			[4, 5],
		],
		true,
	),
];

/** One defence fight's tallies (file comment, item 2). */
export interface DefenseResult {
	seconds: number;
	cleared: boolean;
	hits: number;
	halfHeartsLost: number;
	guards: number;
	guardCancels: number;
	guards3: number;
	/** Guards / rolls that stopped DEFENSE_HIGH_STOPS or more (a higher threshold's braces). */
	guards5: number;
	rolls: number;
	rollCounted: number;
	rolls3: number;
	rolls5: number;
	braces: number;
	pips: number;
	heals: number;
}

function emptyDefense(): DefenseResult {
	return {
		seconds: 0,
		cleared: false,
		hits: 0,
		halfHeartsLost: 0,
		guards: 0,
		guardCancels: 0,
		guards3: 0,
		guards5: 0,
		rolls: 0,
		rollCounted: 0,
		rolls3: 0,
		rolls5: 0,
		braces: 0,
		pips: 0,
		heals: 0,
	};
}

/** The player's start along X for run seed `seed` (turret rooms draw no rng: the start varies the fight instead). */
export const DEFENSE_START_STEP = 0.5;

export function defenseStartOffset(seed: number): number {
	return ((seed % 5) - 2) * DEFENSE_START_STEP;
}

/** Enemy bullets within `r` of (x, z), and the nearest one's offset. */
function bulletsNear(s: SimState, x: number, z: number, r: number): [number, number, number] {
	let n = 0;
	let best = math.huge;
	let bx = 0;
	let bz = 0;
	const r2 = r * r;
	s.combat.enemyBullets.forEachActive((_i, pos) => {
		const dx = pos.x - x;
		const dz = pos.z - z;
		const d2 = dx * dx + dz * dz;
		if (d2 > r2) return;
		n++;
		if (d2 < best) {
			best = d2;
			bx = dx;
			bz = dz;
		}
	});
	return [n, bx, bz];
}

/**
 * One defence fight (file comment, item 2). docs/ARCHER.md AR13: with `character` the run config is that character's
 * (shared/run withCharacters: its loadout and roll traits, over the arena world's weapon), so a "-hold" bot measures
 * the character's own defence (the Archer's longer roll, the Knight's guard) under the same movement.
 */
export function defenseFight(
	r: DefenseRoom,
	build: DefenseCase,
	bot: DefenseBot,
	f: TuneFloor,
	seed: number,
	seconds = DEFENSE_SECONDS,
	character?: CharacterId,
): DefenseResult {
	const weapon: TuneWeapon = guardBot(bot) ? "weapon.sword" : "weapon.bow";
	const hold = holdBot(bot);
	// The turrets draw no rng, so every seed would replay one fight: the start moves with the seed instead.
	const fight: TuneFight = { ...r.fight, startX: r.fight.startX + defenseStartOffset(seed) };
	const savedTicks = SWORD_DATA.guardTicks;
	const savedCos = SWORD_DATA.guardHalfAngleCos;
	if (build.guardTicks !== undefined) SWORD_DATA.guardTicks = build.guardTicks;
	if (build.guardCos !== undefined) SWORD_DATA.guardHalfAngleCos = build.guardCos;
	const out = emptyDefense();
	try {
		const arena = arenaConfig(seed, weapon, fight);
		const config = character !== undefined ? withCharacters(arena, [character]) : arena;
		const s = createSimState(seed, fight.startX, fight.startZ, config);
		s.endless!.floor = f.floor;
		s.endless!.depth = f.depth;
		grantBuild(s, 0, build.cards);
		const ctx = new SimCtx().bind(s, simWorldConfig(s, config), EMPTY_INPUT);
		for (const sp of fight.spawns) {
			if (spawnActor(ctx, archetypeIndex(sp.kind), sp.x, sp.z, sp.affix) === undefined)
				error(`defenseFight: could not spawn ${sp.kind}`, 0);
		}
		let pressedLast = false;
		let guardCancels = -1; // the current guard's erasures (-1: no guard yet)
		let lastCount = 0;
		let rolled = false;
		const ticks = seconds * SIM_HZ;
		let k = 0;
		for (; k < ticks; k++) {
			const p = s.player;
			const t = nearestLiving(s, p);
			const moved = tuneBotFrame(p, t, hold ? "weapon.bow" : weapon, s.tick, fight.half);
			const base: InputFrame = hold
				? { ...moved, buttons: bit32.band(moved.buttons, bit32.bnot(Button.FIRE)) }
				: moved;
			let f2: InputFrame = base;
			let press = false;
			if (guardBot(bot)) {
				const w = weaponsAt(s, 0);
				const slot = w.sets[w.activeSet];
				if (!pressedLast && p.rollTicks === 0 && slot.cooldown === 0) {
					const [n] = bulletsNear(s, p.x, p.z, DEFENSE_GUARD_TRIGGER);
					if (n > 0) {
						press = true;
						f2 = { ...base, buttons: bit32.bor(base.buttons, Button.ALT) };
					}
				}
			} else if (!pressedLast && p.rollTicks === 0) {
				const [n, bx, bz] = bulletsNear(s, p.x, p.z, DEFENSE_ROLL_RADIUS);
				if (n >= DEFENSE_ROLL_BULLETS) {
					press = true;
					const len = math.sqrt(bx * bx + bz * bz);
					const ux = len > 1e-9 ? bx / len : 1;
					const uz = len > 1e-9 ? bz / len : 0;
					f2 = frame(ux, uz, bit32.bor(base.buttons, Button.ROLL), base.aimX / 1000, base.aimZ / 1000);
				}
			}
			pressedLast = press;
			const bp = s.builds!.players[0];
			const countBefore = bp.braceCount;
			step(s, f2, config);
			// A guard started: close the last one's tally.
			if (guardBot(bot) && press && weaponsAt(s, 0).sets[weaponsAt(s, 0).activeSet].cooldown > 0) {
				if (guardCancels >= BASTION_BRACE_BULLETS) out.guards3++;
				if (guardCancels >= DEFENSE_HIGH_STOPS) out.guards5++;
				if (guardCancels >= 0) out.guardCancels += guardCancels;
				guardCancels = 0;
				out.guards++;
			}
			const erased = s.score!.events.guardPlayer.size();
			if (guardCancels >= 0) guardCancels += erased;
			if (s.events.rollStarted !== 0) {
				if (rolled) {
					out.rollCounted += countBefore;
					if (countBefore >= BASTION_BRACE_BULLETS) out.rolls3++;
					if (countBefore >= DEFENSE_HIGH_STOPS) out.rolls5++;
				}
				rolled = true;
				out.rolls++;
			}
			lastCount = bp.braceCount;
			out.hits += s.events.playerHits;
			out.halfHeartsLost += p.heartsMax - p.hearts;
			const e = s.builds!.events;
			for (const kind of e.braceKind) {
				out.braces++;
				if (kind === BraceKind.PIP) out.pips++;
				if (kind === BraceKind.HEAL) out.heals++;
			}
			p.hearts = p.heartsMax;
			if (r.untilClear && !hold && !anyLiving(s)) {
				out.cleared = true;
				k++;
				break;
			}
		}
		out.seconds = k / SIM_HZ;
		if (guardCancels >= 0) {
			out.guardCancels += guardCancels;
			if (guardCancels >= BASTION_BRACE_BULLETS) out.guards3++;
			if (guardCancels >= DEFENSE_HIGH_STOPS) out.guards5++;
		}
		if (rolled) {
			out.rollCounted += lastCount;
			if (lastCount >= BASTION_BRACE_BULLETS) out.rolls3++;
			if (lastCount >= DEFENSE_HIGH_STOPS) out.rolls5++;
		}
	} finally {
		SWORD_DATA.guardTicks = savedTicks;
		SWORD_DATA.guardHalfAngleCos = savedCos;
	}
	return out;
}

/** A Bastion row: one build in one room, summed over the seeds. */
export interface DefenseRow {
	readonly room: string;
	readonly build: DefenseCase;
	readonly fights: number;
	readonly cleared: number;
	readonly sum: DefenseResult;
}

export function defenseRows(
	rooms: ReadonlyArray<DefenseRoom>,
	builds: ReadonlyArray<DefenseCase>,
	bot: DefenseBot,
	f: TuneFloor,
	seeds: ReadonlyArray<number>,
	character?: CharacterId,
): DefenseRow[] {
	const rows: DefenseRow[] = [];
	for (const r of rooms) {
		for (const build of builds) {
			const sum = emptyDefense();
			let cleared = 0;
			for (const seed of seeds) {
				const x = defenseFight(r, build, bot, f, seed, DEFENSE_SECONDS, character);
				if (x.cleared) cleared++;
				sum.seconds += x.seconds;
				sum.hits += x.hits;
				sum.halfHeartsLost += x.halfHeartsLost;
				sum.guards += x.guards;
				sum.guardCancels += x.guardCancels;
				sum.guards3 += x.guards3;
				sum.guards5 += x.guards5;
				sum.rolls += x.rolls;
				sum.rollCounted += x.rollCounted;
				sum.rolls3 += x.rolls3;
				sum.rolls5 += x.rolls5;
				sum.braces += x.braces;
				sum.pips += x.pips;
				sum.heals += x.heals;
			}
			rows.push({ room: r.label, build, fights: seeds.size(), cleared, sum });
		}
	}
	return rows;
}

export function defenseHeader(bot: DefenseBot): string {
	const act = guardBot(bot) ? "guards" : "rolls";
	const each = guardBot(bot) ? "erased per guard" : "counted per roll (Bastion)";
	return (
		`| room | build | s per room (cleared) | hits / min | half hearts lost / room | ${act} / room | ${each} | ` +
		`${act} stopping ${BASTION_BRACE_BULLETS}+ / ${DEFENSE_HIGH_STOPS}+ per room | braces / room (pips restored) |`
	);
}

export function formatDefenseRow(row: DefenseRow, bot: DefenseBot): string {
	const s = row.sum;
	const n = row.fights;
	const g = guardBot(bot);
	const acts = g ? s.guards : s.rolls;
	const each = g ? s.guardCancels : s.rollCounted;
	const three = g ? s.guards3 : s.rolls3;
	const five = g ? s.guards5 : s.rolls5;
	return (
		`| ${row.room} | ${row.build.label} | ${per(s.seconds, n, "%.1f")} (${row.cleared}/${n}) | ` +
		`${s.seconds > 0 ? string.format("%.1f", (60 * s.hits) / s.seconds) : "-"} | ${per(
			s.halfHeartsLost,
			n,
			"%.1f",
		)} | ` +
		`${per(acts, n, "%.1f")} | ${per(each, acts, "%.1f")} | ${per(three, n, "%.1f")} / ${per(five, n, "%.1f")} | ` +
		`${per(s.braces, n)} (${per(s.pips, n)}) |`
	);
}

/** Hits per minute of a row (for the spec's bounds). */
export function defenseHitsPerMinute(row: DefenseRow): number {
	return row.sum.seconds > 0 ? (60 * row.sum.hits) / row.sum.seconds : 0;
}
