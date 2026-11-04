// Pellet census (docs/PELLETS.md PL5): a room-clearing sword bot plays the first endless floors of a few run seeds with
// the game's PELLETS_CONFIG twice, once chasing pellets and once ignoring them, and logs per floor the rooms with
// pellets, the pellets taken, the Sweeps, the power pellets, the pellet + Sweep share of the floor's points and the
// speed bonus (FAST) the chase costs. A log with sanity bounds, not a tuning tool (PL9 tunes in play).
//
//   pellets  walks into every room but the boss's; while the room's pellets are live it walks to the nearest untaken
//            live pellet (the power pellet included) unless an enemy is in sword reach, and it spares a room's LAST
//            living enemy until the pellets are done (at most SPARE_TICKS into the fight), so its Sweep rate is an
//            upper-ish bound for a player who goes for them
//   ignore   the drops census bot's fight: walk at the nearest enemy, swing; pellets only by accident
//
// Test-only shortcuts (none on a replay path): hearts topped up every tick, boon drafts dismissed, the debug floor skip.
//
// Then the pellet bot plays HONESTLY (no state surgery: a flask when hurt, recorded frames, drafts picked with the
// stick and a FIRE press): it walks floor 1 to its stairwell, then on floor 2 of a seed whose floor 2 holds a power
// pellet it enters that room, lets the enemies fire, takes the power pellet and fights the room for its pellets. The
// recording replays to the live hash and validates through the server's SegmentedValidator segment by segment.
import { describe, expect, it } from "@rbxts/jest-globals";
import { NO_POWER_PELLET, bulletBlocker, gridToWorld, lineOfSight, worldToGrid } from "shared/dungeon";
import {
	BulletKind,
	BulletPayload,
	Button,
	DEBUG_FLOOR_BUTTON,
	DRAFT_CONFIRM_BUTTON,
	DRAFT_MIN_OPEN_TICKS,
	NO_KIND,
	PELLETS_CONFIG,
	PelletPhase,
	Recorder,
	SIM_DT,
	SIM_HZ,
	SOLO_PLAYER,
	ScoreSource,
	archetypeAt,
	createSimState,
	hashState,
	isDraftOpen,
	runReplay,
	step,
	type ActorState,
	type InputFrame,
	type SimState,
} from "shared/sim";
import { LiveRun, RANKED_WORLD_KIND } from "shared/play";
import {
	DEFAULT_SEGMENT_LIMITS,
	SegmentedValidator,
	buildEndlessRunConfig,
	buildWorldSetup,
	type EndlessRunSetup,
	type RunSegment,
	type SegmentVerdict,
	type SegmentedRunResult,
} from "shared/run";
import { dismissDraft, distanceField, frame, walkDir, type Field } from "shared/run/testing";

const SEEDS: ReadonlyArray<number> = [1337, 4242, 90210];
const FLOORS = 4;
const WALK_TICKS = 40 * SIM_HZ;
const FIGHT_TICKS = 60 * SIM_HZ;
/** The pellet bot spares a room's last enemy at most this long into the fight. */
const SPARE_TICKS = 30 * SIM_HZ;
const MELEE_RANGE = 1.2;
const CHASE_RANGE = 8;
const QUIET_TICKS = 30;
/** The pellet bot gives up on a pellet it has walked toward this long (something solid in the way). */
const PELLET_WALK_TICKS = 4 * SIM_HZ;
/** Placement sweep for the power pellet rate: run seeds 1..POWER_SEEDS, floors 1..POWER_FLOORS (floor data only). */
const POWER_SEEDS = 8;
const POWER_FLOORS = 10;

type Mode = "pellets" | "ignore";

function dist2(ax: number, az: number, bx: number, bz: number): number {
	const dx = ax - bx;
	const dz = az - bz;
	return dx * dx + dz * dz;
}

function unit(dx: number, dz: number): [number, number] {
	const len = math.sqrt(dx * dx + dz * dz);
	return len > 1e-9 ? [dx / len, dz / len] : [0, 0];
}

interface FloorCensus {
	floor: number;
	/** Score records with regular pellets, and those that cleared. */
	rooms: number;
	roomsCleared: number;
	/** Regular pellets in those rooms, and taken. */
	pellets: number;
	taken: number;
	sweeps: number;
	power: number;
	powerTaken: number;
	powerBullets: number;
	/** Score deltas over the floor's rooms (the debug skip's floor clear excluded), and the floor clear. */
	pelletPoints: number;
	sweepPoints: number;
	fastPoints: number;
	roomPoints: number;
	floorClear: number;
	ticks: number;
}

class PelletBot {
	readonly state: SimState;
	readonly recorder: Recorder;
	private readonly fields = new Map<string, Field>();
	private lastFlask = false;
	/** Pellets given up on ("floor:index"), and the one being walked to with its ticks so far. */
	private readonly skip = new Set<string>();
	private chasing = -1;
	private chaseTicks = 0;
	powerBullets = 0;

	constructor(readonly setup: EndlessRunSetup, readonly seed: number, readonly mode: Mode, readonly honest = false) {
		const spawn = setup.spawn!;
		this.state = createSimState(seed, spawn.x, spawn.z, setup.config);
		this.recorder = new Recorder(seed, spawn.x, spawn.z);
	}

	out(): boolean {
		return this.state.player.dead !== 0;
	}

	floor(): number {
		return this.state.endless!.floor;
	}

	world() {
		return this.setup.endlessFloor(this.floor());
	}

	tick(raw: InputFrame): void {
		const p = this.state.player;
		let input = raw;
		if (!this.honest) {
			p.hearts = p.heartsMax; // test-only: the census bot never dies
		} else {
			const want = p.hearts <= 3 && p.flask > 0 && p.flaskTicks === 0;
			if (want && !this.lastFlask) input = { ...raw, buttons: bit32.bor(raw.buttons, Button.FLASK) };
			this.lastFlask = want;
		}
		// -0 axes as 0, like every real client's quantizeAxis (the binary segment codec carries integers).
		input = { ...input };
		if (input.moveX === 0) input.moveX = 0;
		if (input.moveZ === 0) input.moveZ = 0;
		if (input.aimX === 0) input.aimX = 0;
		if (input.aimZ === 0) input.aimZ = 0;
		this.recorder.record(input);
		step(this.state, input, this.setup.config);
		if (!this.honest && isDraftOpen(this.state)) dismissDraft(this.state);
		const power = this.state.pellets!.events.power;
		if (power !== undefined) this.powerBullets += power.x.size();
	}

	private field(tx: number, tz: number): Field {
		const gx = worldToGrid(tx);
		const gz = worldToGrid(tz);
		const key = `${this.floor()}:${gx}:${gz}`;
		let f = this.fields.get(key);
		if (f === undefined) {
			f = distanceField(this.world().dungeon, gridToWorld(gx), gridToWorld(gz));
			this.fields.set(key, f);
		}
		return f;
	}

	dirTo(tx: number, tz: number): [number, number] {
		const p = this.state.player;
		if (lineOfSight(bulletBlocker(this.world().dungeon), p.x, p.z, tx, tz)) return unit(tx - p.x, tz - p.z);
		return walkDir(this.field(tx, tz), p.x, p.z);
	}

	private target(roomId: number): ActorState | undefined {
		const p = this.state.player;
		const w = this.world();
		let best: ActorState | undefined;
		let bestD = math.huge;
		for (const a of this.state.combat.actors) {
			if (a.kind === NO_KIND || a.alive === 0 || archetypeAt(a.kind).data.boss === true) continue;
			const d = dist2(a.x, a.z, p.x, p.z);
			if (w.roomIdAt(a.x, a.z) !== roomId && d > CHASE_RANGE * CHASE_RANGE) continue;
			if (d < bestD) {
				bestD = d;
				best = a;
			}
		}
		return best;
	}

	/**
	 * The nearest untaken pellet of room `roomId` while its pellets are live (the power pellet included), as an index,
	 * or -1. Pellets the bot could not reach within PELLET_WALK_TICKS (a breakable in the way) are skipped.
	 */
	livePellet(roomId: number): number {
		const s = this.state;
		const p = s.pellets!;
		const rec = s.score!.rooms.findIndex((r) => r.room === roomId);
		if (rec < 0 || p.rooms[rec].phase !== PelletPhase.LIVE) return -1;
		let best = -1;
		let bestD = math.huge;
		for (let i = 0; i < p.x.size(); i++) {
			if (p.taken[i] !== 0 || p.rec[i] !== rec || this.skip.has(`${this.floor()}:${i}`)) continue;
			const d = dist2(p.x[i], p.z[i], s.player.x, s.player.z);
			if (d < bestD) {
				bestD = d;
				best = i;
			}
		}
		return best;
	}

	/** Living members of room `roomId`'s score record. */
	private alive(roomId: number): number {
		const s = this.state;
		const rec = s.score!.rooms.find((r) => r.room === roomId);
		if (rec === undefined) return 0;
		let n = 0;
		for (let m = 0; m < rec.memberSlots.size(); m++) {
			const a = s.combat.actors[rec.memberSlots[m]];
			if (a !== undefined && a.kind !== NO_KIND && a.id === rec.memberIds[m] && a.alive !== 0) n++;
		}
		return n;
	}

	/** Walks onto (tx, tz) until done() or the budget runs out; rolls now and then. */
	walkTo(tx: number, tz: number, done: () => boolean, maxTicks: number): void {
		const startFloor = this.floor();
		let n = 0;
		while (n < maxTicks && !done() && !this.out() && this.floor() === startFloor) {
			const [mx, mz] = this.dirTo(tx, tz);
			this.tick(frame(mx, mz, n % 50 === 25 ? Button.ROLL : 0));
			n++;
		}
	}

	/** An open draft, answered like a player: the centre card, a FIRE press once it may close (every deal). */
	resolveDraft(): void {
		const me = this.state.run!.players[SOLO_PLAYER];
		for (let deal = 0; deal < 4 && me.draftOpen !== 0; deal++) {
			while (me.draftTicks + 1 < DRAFT_MIN_OPEN_TICKS) this.tick(frame(0, 0));
			this.tick(frame(0, 0, DRAFT_CONFIRM_BUTTON));
			this.tick(frame(0, 0));
		}
	}

	/** Walks into room `roomId`, then fights it (and, in pellets mode, collects) until quiet. */
	clearRoom(roomId: number): void {
		const w = this.world();
		const spawn = w.roomSpawns[roomId][0];
		const startFloor = this.floor();
		const entered = () => this.state.endless!.roomsEntered[roomId] !== 0;
		this.walkTo(spawn.x, spawn.z, entered, WALK_TICKS);
		if (!entered()) return;
		this.fight(roomId, startFloor);
	}

	fight(roomId: number, startFloor: number): void {
		let quiet = 0;
		let n = 0;
		while (n < FIGHT_TICKS && quiet < QUIET_TICKS && this.floor() === startFloor && !this.out()) {
			const a = this.target(roomId);
			const pel = this.mode === "pellets" ? this.livePellet(roomId) : -1;
			const p = this.state.player;
			const near = a !== undefined && dist2(a.x, a.z, p.x, p.z) <= MELEE_RANGE * MELEE_RANGE;
			const spare = pel >= 0 && n < SPARE_TICKS && this.alive(roomId) <= 1;
			if (pel >= 0 && (!near || spare)) {
				quiet = 0;
				if (pel !== this.chasing) {
					this.chasing = pel;
					this.chaseTicks = 0;
				}
				this.chaseTicks++;
				if (this.chaseTicks > PELLET_WALK_TICKS) this.skip.add(`${this.floor()}:${pel}`);
				const pp = this.state.pellets!;
				const [mx, mz] = this.dirTo(pp.x[pel], pp.z[pel]);
				this.tick(frame(mx, mz));
			} else if (a !== undefined) {
				quiet = 0;
				const [ax, az] = unit(a.x - p.x, a.z - p.z);
				const [mx, mz] = near ? [0, 0] : this.dirTo(a.x, a.z);
				this.tick(frame(mx, mz, Button.FIRE, ax, az));
			} else {
				quiet++;
				this.tick(frame(0, 0));
			}
			n++;
		}
	}

	/** Every room with spawns but the boss's, in id order. */
	clearFloor(): FloorCensus {
		const s = this.state;
		const sc = s.score!;
		const pl = s.pellets!;
		const floor = this.floor();
		const before = [...sc.points];
		const total0 = sc.total;
		const tick0 = s.tick;
		const bullets0 = this.powerBullets;
		const w = this.world();
		const rooms = w.config.encounter!.rooms;
		for (let id = 0; id < w.roomSpawns.size(); id++) {
			if (w.roomSpawns[id].size() === 0 || rooms[id]?.type === "boss") continue;
			this.clearRoom(id);
		}
		const c: FloorCensus = {
			floor,
			rooms: 0,
			roomsCleared: 0,
			pellets: 0,
			taken: 0,
			sweeps: 0,
			power: pl.power !== NO_POWER_PELLET ? 1 : 0,
			powerTaken: pl.power !== NO_POWER_PELLET ? pl.taken[pl.power] : 0,
			powerBullets: this.powerBullets - bullets0,
			pelletPoints: sc.points[ScoreSource.PELLETS] - before[ScoreSource.PELLETS],
			sweepPoints: sc.points[ScoreSource.SWEEP] - before[ScoreSource.SWEEP],
			fastPoints: sc.points[ScoreSource.FAST] - before[ScoreSource.FAST],
			roomPoints: sc.total - total0,
			floorClear: 0,
			ticks: s.tick - tick0,
		};
		for (const r of pl.rooms) {
			if (r.count === 0) continue;
			c.rooms++;
			c.pellets += r.count;
			c.taken += r.count - r.left;
			c.sweeps += r.swept;
			if (r.phase === PelletPhase.GONE) c.roomsCleared++;
		}
		return c;
	}

	playFloor(): FloorCensus {
		const c = this.clearFloor();
		const startFloor = this.floor();
		const total = this.state.score!.total;
		this.tick(frame(0, 0, DEBUG_FLOOR_BUTTON));
		c.floorClear = this.state.score!.total - total;
		this.tick(frame(0, 0));
		expect(this.floor()).toBe(startFloor + 1);
		return c;
	}
}

function pct(a: number, b: number): string {
	return b > 0 ? string.format("%.1f%%", (100 * a) / b) : "-";
}

function describeFloor(c: FloorCensus): string {
	return (
		`floor ${c.floor}: ${c.rooms} rooms with pellets (${c.roomsCleared} cleared), ` +
		`${c.taken}/${c.pellets} pellets taken (${pct(c.taken, c.pellets)}), ${c.sweeps} sweeps, ` +
		`power ${c.powerTaken}/${c.power} (${c.powerBullets} bullets); points pellets ${c.pelletPoints} ` +
		`sweep ${c.sweepPoints} fast ${c.fastPoints} rooms ${c.roomPoints} floor clear ${c.floorClear} ` +
		`(pellet + sweep ${pct(c.pelletPoints + c.sweepPoints, c.roomPoints)} of rooms, ` +
		`${pct(c.pelletPoints + c.sweepPoints, c.roomPoints + c.floorClear)} with the floor clear); ` +
		`${string.format("%.0f", c.ticks / SIM_HZ)} s sim`
	);
}

function sum(list: ReadonlyArray<FloorCensus>, f: (c: FloorCensus) => number): number {
	let n = 0;
	for (const c of list) n += f(c);
	return n;
}

describe("pellet census (endless, PELLETS_CONFIG)", () => {
	it(`seeds ${SEEDS.join(", ")}, floors 1-${FLOORS}, chasing pellets vs ignoring them (spec log)`, () => {
		const runs = new Map<Mode, FloorCensus[]>();
		for (const mode of ["pellets", "ignore"] as Mode[]) {
			const all: FloorCensus[] = [];
			for (const seed of SEEDS) {
				const setup = buildEndlessRunConfig(seed);
				expect(setup.config.pellets).toBe(PELLETS_CONFIG);
				const bot = new PelletBot(setup, seed, mode);
				for (let f = 1; f <= FLOORS; f++) {
					const c = bot.playFloor();
					all.push(c);
					print(`[pellets census] ${mode} seed ${seed} ${describeFloor(c)}`);
					expect(c.taken <= c.pellets).toBe(true);
					expect(c.sweeps <= c.roomsCleared).toBe(true);
				}
			}
			runs.set(mode, all);
			const rooms = sum(all, (c) => c.rooms);
			const cleared = sum(all, (c) => c.roomsCleared);
			const pellets = sum(all, (c) => c.pellets);
			const taken = sum(all, (c) => c.taken);
			const sweeps = sum(all, (c) => c.sweeps);
			const pp = sum(all, (c) => c.pelletPoints);
			const sp = sum(all, (c) => c.sweepPoints);
			const roomPts = sum(all, (c) => c.roomPoints);
			const floorPts = sum(all, (c) => c.floorClear);
			print(
				`[pellets census] ${mode} total: ${all.size()} floors, ${rooms} rooms with pellets ` +
					`(${string.format("%.1f", pellets / math.max(1, rooms))} pellets per room), ${cleared} cleared; ` +
					`${taken}/${pellets} taken (${pct(taken, pellets)}); sweeps ${sweeps}/${cleared} ` +
					`(${pct(sweeps, cleared)}); power ${sum(all, (c) => c.powerTaken)}/${sum(all, (c) => c.power)} ` +
					`(${sum(
						all,
						(c) => c.powerBullets,
					)} bullets); points pellets ${pp} sweep ${sp} of rooms ${roomPts} ` +
					`= ${pct(pp + sp, roomPts)} (with floor clears ${pct(pp + sp, roomPts + floorPts)}); fast ` +
					`${sum(all, (c) => c.fastPoints)}`,
			);
		}
		const chase = runs.get("pellets")!;
		const ignore = runs.get("ignore")!;
		const fastChase = sum(chase, (c) => c.fastPoints);
		const fastIgnore = sum(ignore, (c) => c.fastPoints);
		const roomsChase = sum(chase, (c) => c.roomPoints);
		const roomsIgnore = sum(ignore, (c) => c.roomPoints);
		print(
			`[pellets census] speed bonus: chasing ${fastChase}, ignoring ${fastIgnore}: ${pct(
				fastIgnore - fastChase,
				fastIgnore,
			)} lost; rooms' points chasing ${roomsChase} vs ignoring ${roomsIgnore} (${pct(
				roomsChase - roomsIgnore,
				roomsIgnore,
			)} net)`,
		);
		// Sanity: the chasing bot takes most pellets and sweeps some rooms; the fighter takes fewer.
		const takenChase = sum(chase, (c) => c.taken);
		expect(takenChase > sum(ignore, (c) => c.taken)).toBe(true);
		expect(takenChase / sum(chase, (c) => c.pellets) >= 0.5).toBe(true);
		expect(sum(chase, (c) => c.sweeps) > 0).toBe(true);
	});

	it(`power pellets per floor: run seeds 1-${POWER_SEEDS}, floors 1-${POWER_FLOORS} (floor data, spec log)`, () => {
		let floors = 0;
		let from2 = 0;
		let power = 0;
		for (let seed = 1; seed <= POWER_SEEDS; seed++) {
			const setup = buildEndlessRunConfig(seed);
			for (let f = 1; f <= POWER_FLOORS; f++) {
				const pellets = setup.endlessFloor(f).pellets!;
				floors++;
				if (f >= 2) from2++;
				if (pellets.power !== NO_POWER_PELLET) {
					power++;
					expect(f >= 2).toBe(true);
				}
			}
		}
		print(
			`[pellets census] power pellets: ${power} on ${floors} floors (${string.format(
				"%.2f",
				power / floors,
			)} per floor; ${pct(power, from2)} of floors 2+)`,
		);
		expect(power > 0).toBe(true);
	});
});

// ---------------------------------------------------------------------------------------------
// An honest run that takes a power pellet: replay and segmented validation

const HONEST_SEGMENT_TICKS = 1200;

/** Archetypes that fire ordinary enemy bullets (the power pellet needs some on screen). */
const SHOOTERS: ReadonlyArray<string> = ["sniper", "reaper", "imp", "turret.caster", "turret.sniper", "turret.sprayer"];
/** The honest bot waits at most this long for SHOOTER bullets before it takes the power pellet anyway. */
const POWER_WAIT_TICKS = 8 * SIM_HZ;
/** ... and takes it once this many erasable enemy bullets are on screen. */
const POWER_WAIT_BULLETS = 3;

/** The honest run tries at most this many candidate seeds (powerSeeds) for one that erases bullets. */
const POWER_SEED_TRIES = 6;

/** The first `count` run seeds whose floor 2 holds a power pellet in a room with a shooter. */
function powerSeeds(count: number): number[] {
	const out: number[] = [];
	for (let seed = 1; seed <= 200 && out.size() < count; seed++) {
		const w = buildEndlessRunConfig(seed).endlessFloor(2);
		const pellets = w.pellets!;
		if (pellets.power === NO_POWER_PELLET) continue;
		const spawns = w.roomSpawns[pellets.room[pellets.power]];
		if (spawns.some((sp) => SHOOTERS.includes(sp.kind))) out.push(seed);
	}
	if (out.size() === 0) error("no run seed in 1-200 has a power pellet on floor 2 in a room with a shooter", 0);
	return out;
}

/** Erasable enemy bullets on screen (not goo, not strikes). */
function erasable(s: SimState): number {
	let n = 0;
	s.combat.enemyBullets.forEachActive((_i, _pos, payload) => {
		const kind = BulletPayload.get(payload, "kind");
		if (kind !== BulletKind.GOO && kind !== BulletKind.STRIKE) n++;
	});
	return n;
}

function drain(v: SegmentedValidator): { verdicts: SegmentVerdict[]; result?: SegmentedRunResult } {
	const verdicts: SegmentVerdict[] = [];
	let result: SegmentedRunResult | undefined = v.getResult();
	while (v.hasWork()) {
		const r = v.advance(500);
		for (const x of r.verdicts) verdicts.push(x);
		result = r.result ?? result;
	}
	return { verdicts, result: result ?? v.getResult() };
}

/** One honest run of `seed`: floor 1 to the stairwell, then floor 2's power pellet room. */
function honestRun(seed: number) {
	const setup = buildEndlessRunConfig(seed);
	const bot = new PelletBot(setup, seed, "pellets", true);
	// Floor 1: walk to the stairwell (rooms on the way engage and their pellets go live; the walk takes what it
	// crosses), then pick the draft.
	const w1 = bot.world();
	bot.walkTo(w1.stairX, w1.stairZ, () => false, 4000);
	bot.resolveDraft();
	const onFloor2 = bot.floor() === 2;
	// Floor 2: the power pellet's room.
	const pl = bot.state.pellets!;
	const at = pl.power;
	const roomId = at >= 0 && onFloor2 ? bot.state.score!.rooms[pl.rec[at]].room : -1;
	let erased = 0;
	if (roomId >= 0 && !bot.out()) {
		const entered = () => bot.state.endless!.roomsEntered[roomId] !== 0;
		bot.walkTo(pl.x[at], pl.z[at], entered, 3000);
		// Let the room's enemies fire (strafing in place, rolling now and then), then take it.
		for (let n = 0; n < POWER_WAIT_TICKS && !bot.out() && erasable(bot.state) < POWER_WAIT_BULLETS; n++)
			bot.tick(frame(n % 60 < 30 ? 1 : -1, 0, n % 50 === 25 ? Button.ROLL : 0));
		bot.walkTo(pl.x[at], pl.z[at], () => pl.taken[at] !== 0, 600);
		erased = bot.powerBullets;
		if (!bot.out()) bot.fight(roomId, 2);
	}
	return { bot, onFloor2, pl, at, erased };
}

describe("an endless run that takes a power pellet replays and validates segmented", () => {
	// The first candidate whose bot erases bullets with it: a layout can lay the power pellet where the walk in takes
	// it before the room fires (seed 2 since docs/BOOKSHELVES.md moved its floor 2's pieces). Since the libraries'
	// reading area (docs/BOOKSHELVES.md), seed 2 erases bullets again: the first candidate is taken (before: seed 14).
	let seed = 0;
	let honest: ReturnType<typeof honestRun> | undefined;
	for (const candidate of powerSeeds(POWER_SEED_TRIES)) {
		seed = candidate;
		honest = honestRun(candidate);
		if (honest.erased > 0) break;
	}
	const { bot, onFloor2, pl, at, erased } = honest!;
	const recording = bot.recorder.getRecording();
	const finalHash = hashState(bot.state);
	const sc = bot.state.score!;
	print(
		`[pellets census] honest seed ${seed}: floor ${bot.floor()}, power pellet taken ${
			at >= 0 ? pl.taken[at] : -1
		} (${erased} bullets erased), pellets ${sc.counts[ScoreSource.PELLETS]} (${
			sc.points[ScoreSource.PELLETS]
		} pts), sweeps ${sc.counts[ScoreSource.SWEEP]}, dead ${bot.state.player.dead}, ${bot.state.tick} ticks`,
	);

	it("the run reached floor 2 and took its power pellet with bullets on screen (and some pellets)", () => {
		expect(onFloor2).toBe(true);
		expect(at).never.toBe(NO_POWER_PELLET);
		expect(pl.taken[at]).toBe(1);
		expect(erased > 0).toBe(true);
		expect(sc.counts[ScoreSource.PELLETS] > 0).toBe(true);
	});

	it("replays to the live hash", () => {
		expect(hashState(runReplay(recording, buildEndlessRunConfig(seed).config))).toBe(finalHash);
	});

	it("a ranked LiveRun cutting segments every HONEST_SEGMENT_TICKS validates segment by segment, same hash", () => {
		const world = buildWorldSetup(RANKED_WORLD_KIND, seed, { atBossDoor: false });
		const run = new LiveRun({
			seed,
			spawnX: world.spawn!.x,
			spawnZ: world.spawn!.z,
			config: world.config,
			atBossDoor: false,
			runId: "pellets-run",
			segmentCutAfterTick: (s) => s.tick % HONEST_SEGMENT_TICKS === 0,
		});
		const v = new SegmentedValidator({
			runId: "pellets-run",
			seed,
			worldKind: RANKED_WORLD_KIND,
			setup: buildWorldSetup(RANKED_WORLD_KIND, seed, { atBossDoor: false }),
			createdAt: 0,
			limits: DEFAULT_SEGMENT_LIMITS,
		});
		const sent: RunSegment[] = [];
		const verdicts: SegmentVerdict[] = [];
		const late = 1e9;
		const pump = () => {
			for (const seg of run.takeSegments()) {
				sent.push(seg);
				expect(v.offer(seg, late).ok).toBe(true);
			}
			for (const x of drain(v).verdicts) {
				verdicts.push(x);
				if (x.ok) run.releaseVerifiedFrames(x.endTick);
			}
		};
		for (const f of recording.frames) {
			run.frame(SIM_DT, f);
			pump();
		}
		expect(hashState(run.state)).toBe(finalHash);
		const final = run.final()!;
		pump();
		const result = v.finish(final, late) ?? drain(v).result;
		expect(sent.size() > 1).toBe(true);
		for (const x of verdicts) expect([x.index, x.ok, x.code]).toEqual([x.index, true, undefined]);
		expect(result?.reason).toBe(undefined);
		expect(result?.ok).toBe(true);
		expect(result?.serverHash).toBe(finalHash);
		expect(result?.score?.score).toBe(sc.total);
	});
});
