// Boost drop census (docs/BOOSTS.md B4): a room-clearing bot plays the first endless floors of a few run seeds with the
// game's DROPS_CONFIG and logs, per floor, the kills, the drops that landed (by kind), the drops taken, faded and lost
// to the floor change, so the drop rate and the pickup rate can be read off the spec log. A log with sanity bounds, not
// a tuning tool (B11 tunes in play): the bot is a sword player that walks into every room but the boss's, fights
// until the room is quiet, then walks over every drop lying on the floor (so its pickup rate is an upper-ish bound:
// a real player under fire leaves some).
//
// Test-only shortcuts (none of them on a replay path): hearts topped up every tick (the bot never dies), every boon
// draft dismissed, and the debug floor skip once a floor's rooms are done.
//
// Then the same bot plays one floor HONESTLY (no state surgery: a flask when hurt, recorded frames) so a run with real
// drops and pickups replays to the live hash and validates through the server's SegmentedValidator, segment by
// segment (the recorded endless run of slice.spec / endless.spec never kills outside the boss room, so it rolls none).
import { describe, expect, it } from "@rbxts/jest-globals";
import { bulletBlocker, gridToWorld, lineOfSight, worldToGrid } from "shared/dungeon";
import {
	BOOST_COUNT,
	BOOSTS,
	Button,
	DEBUG_FLOOR_BUTTON,
	DROPS,
	DROPS_CONFIG,
	NO_BOOST,
	NO_KIND,
	SIM_HZ,
	ScoreSource,
	archetypeAt,
	createSimState,
	dropsEvents,
	dropsGround,
	isDraftOpen,
	step,
	Recorder,
	SIM_DT,
	hashState,
	runReplay,
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

/** Run seeds and floors censused (pre-boss floors: the boss floor's rooms but the arena would add little). */
const SEEDS: ReadonlyArray<number> = [1337, 4242, 90210];
const FLOORS = 4;
/** Per room: ticks to walk in, ticks to fight; per floor: ticks to collect what lies on the floor at the end. */
const WALK_TICKS = 40 * SIM_HZ;
const FIGHT_TICKS = 40 * SIM_HZ;
/** Swing when the target's centre is this close (SWORD reach 1.955 minus a margin). */
const MELEE_RANGE = 1.2;
/** Enemies this close count as the room's fight (chasers that followed the bot out). */
const CHASE_RANGE = 8;
/** "Quiet": nothing alive within CHASE_RANGE and nothing alive in the room, for this many ticks. */
const QUIET_TICKS = 30;

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
	kills: number;
	dropped: number;
	taken: number;
	faded: number;
	/** Still on the floor when the bot left it (the floor change frees them). */
	lost: number;
	byKind: number[];
	roomsFought: number;
	roomsQuiet: number;
	ticks: number;
}

function newCensus(floor: number): FloorCensus {
	const byKind: number[] = [];
	for (let k = 0; k < BOOST_COUNT; k++) byKind.push(0);
	return {
		floor,
		kills: 0,
		dropped: 0,
		taken: 0,
		faded: 0,
		lost: 0,
		byKind,
		roomsFought: 0,
		roomsQuiet: 0,
		ticks: 0,
	};
}

class CensusBot {
	readonly state: SimState;
	readonly recorder: Recorder;
	private readonly fields = new Map<string, Field>();
	private lastFlask = false;
	cur: FloorCensus;

	/** `honest`: no state surgery (no top-up, no draft dismissal; a flask when hurt), so the recording replays. */
	constructor(readonly setup: EndlessRunSetup, readonly seed: number, readonly honest = false) {
		const spawn = setup.spawn!;
		this.state = createSimState(seed, spawn.x, spawn.z, setup.config);
		this.recorder = new Recorder(seed, spawn.x, spawn.z);
		this.cur = newCensus(this.floor());
	}

	/** The honest bot died: every loop stops. */
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
			// A careful player's flask at <= 3 half hearts (press edges).
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
		const kills = this.state.score!.counts[ScoreSource.KILLS];
		this.recorder.record(input);
		step(this.state, input, this.setup.config);
		if (!this.honest && isDraftOpen(this.state)) dismissDraft(this.state);
		const c = this.cur;
		c.ticks++;
		c.kills += this.state.score!.counts[ScoreSource.KILLS] - kills;
		const ev = dropsEvents(this.state)!;
		for (const slot of ev.dropped) {
			c.dropped++;
			// A drop taken on the tick it landed has its slot freed already: its kind is in `collected`.
			const kind = this.state.drops!.ground[slot].kind;
			if (kind !== NO_BOOST) c.byKind[kind]++;
		}
		c.taken += ev.collected.size();
		c.faded += ev.expired.size();
		for (const e of ev.collected) if (ev.dropped.includes(e.slot)) c.byKind[e.kind]++;
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

	/** Straight at (tx, tz) with a clear line, else along the distance field. */
	private dirTo(tx: number, tz: number): [number, number] {
		const p = this.state.player;
		if (lineOfSight(bulletBlocker(this.world().dungeon), p.x, p.z, tx, tz)) return unit(tx - p.x, tz - p.z);
		return walkDir(this.field(tx, tz), p.x, p.z);
	}

	/** The nearest living non-boss enemy in room `roomId` or within CHASE_RANGE. */
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

	private nearestDrop(): [number, number] | undefined {
		const p = this.state.player;
		let best: [number, number] | undefined;
		let bestD = math.huge;
		for (const g of dropsGround(this.state)) {
			if (g.kind === NO_BOOST) continue;
			const d = dist2(g.x, g.z, p.x, p.z);
			if (d < bestD) {
				bestD = d;
				best = [g.x, g.z];
			}
		}
		return best;
	}

	/** Walks over every drop lying on the floor, nearest first (each walk budgeted; a drop may fade first). */
	collect(): void {
		const startFloor = this.floor();
		let n = 0;
		for (;;) {
			const d = this.nearestDrop();
			if (d === undefined || n >= WALK_TICKS || this.floor() !== startFloor || this.out()) return;
			const [mx, mz] = this.dirTo(d[0], d[1]);
			this.tick(frame(mx, mz));
			n++;
		}
	}

	/** Walks into room `roomId` (onto its first spawn), fights until it is quiet, then collects the drops. */
	clearRoom(roomId: number): void {
		const w = this.world();
		const spawn = w.roomSpawns[roomId][0];
		const startFloor = this.floor();
		let n = 0;
		while (
			n < WALK_TICKS &&
			this.state.endless!.roomsEntered[roomId] === 0 &&
			this.floor() === startFloor &&
			!this.out()
		) {
			const [mx, mz] = this.dirTo(spawn.x, spawn.z);
			this.tick(frame(mx, mz));
			n++;
		}
		if (this.state.endless!.roomsEntered[roomId] === 0) return;
		this.cur.roomsFought++;
		let quiet = 0;
		n = 0;
		while (n < FIGHT_TICKS && quiet < QUIET_TICKS && this.floor() === startFloor && !this.out()) {
			const a = this.target(roomId);
			const p = this.state.player;
			if (a === undefined) {
				quiet++;
				this.tick(frame(0, 0));
			} else {
				quiet = 0;
				const [ax, az] = unit(a.x - p.x, a.z - p.z);
				const near = dist2(a.x, a.z, p.x, p.z) <= MELEE_RANGE * MELEE_RANGE;
				const [mx, mz] = near ? [0, 0] : this.dirTo(a.x, a.z);
				this.tick(frame(mx, mz, Button.FIRE, ax, az));
			}
			n++;
		}
		if (quiet >= QUIET_TICKS) this.cur.roomsQuiet++;
		this.collect();
	}

	/** Every room with spawns but the boss room, in id order, then what is left on the floor. */
	clearFloor(): FloorCensus {
		this.cur = newCensus(this.floor());
		const w = this.world();
		const rooms = w.config.encounter!.rooms;
		for (let id = 0; id < w.roomSpawns.size(); id++) {
			if (w.roomSpawns[id].size() === 0 || rooms[id]?.type === "boss") continue;
			this.clearRoom(id);
		}
		this.collect();
		for (const g of dropsGround(this.state)) if (g.kind !== NO_BOOST) this.cur.lost++;
		return this.cur;
	}

	/** clearFloor, then the debug skip. */
	playFloor(): FloorCensus {
		const c = this.clearFloor();
		const startFloor = this.floor();
		this.tick(frame(0, 0, DEBUG_FLOOR_BUTTON));
		this.tick(frame(0, 0));
		expect(this.floor()).toBe(startFloor + 1);
		return c;
	}
}

function pct(a: number, b: number): string {
	return b > 0 ? string.format("%.1f%%", (100 * a) / b) : "-";
}

function describeFloor(c: FloorCensus): string {
	const kinds = c.byKind.map((n, k) => `${BOOSTS[k].id.sub(7)} ${n}`).join(", ");
	const rooms = `${c.roomsQuiet}/${c.roomsFought} rooms quiet`;
	const drops = `${c.dropped} drops (${pct(c.dropped, c.kills)} of kills; ${kinds})`;
	const fate = `${c.taken} taken (${pct(c.taken, c.dropped)}), ${c.faded} faded, ${c.lost} lost to the floor change`;
	return `floor ${c.floor}: ${c.kills} kills (${rooms}), ${drops}, ${fate}; ${string.format(
		"%.0f",
		c.ticks / SIM_HZ,
	)} s sim`;
}

describe("boost drop census (endless, DROPS_CONFIG)", () => {
	it(`seeds ${SEEDS.join(", ")}, floors 1-${FLOORS}: drops per floor and pickup rate (spec log)`, () => {
		const all: FloorCensus[] = [];
		for (const seed of SEEDS) {
			const setup = buildEndlessRunConfig(seed);
			expect(setup.config.drops).toBe(DROPS_CONFIG);
			const bot = new CensusBot(setup, seed);
			for (let f = 1; f <= FLOORS; f++) {
				const c = bot.playFloor();
				all.push(c);
				print(`[drops census] seed ${seed} ${describeFloor(c)}`);
				// Every drop is accounted for: taken, faded, or freed by the floor change.
				expect(c.taken + c.faded + c.lost).toBe(c.dropped);
				let sum = 0;
				for (const n of c.byKind) sum += n;
				expect(sum).toBe(c.dropped);
				// At most one drop per kill.
				expect(c.dropped <= c.kills).toBe(true);
			}
		}
		let kills = 0;
		let dropped = 0;
		let taken = 0;
		for (const c of all) {
			kills += c.kills;
			dropped += c.dropped;
			taken += c.taken;
		}
		print(
			`[drops census] total: ${all.size()} floors, ${kills} kills, ${dropped} drops ` +
				`(${string.format("%.2f", dropped / all.size())} per floor, ${pct(dropped, kills)} of kills), ` +
				`${taken} taken (${pct(taken, dropped)})`,
		);
		// Sanity: the bot fights (kills), drops happen at a rate near the configured chances (between the lowest
		// archetype chance and pity's floor of one per pityKills + 1 kills, loosely), and a bot that walks over them
		// takes most.
		expect(kills > 20).toBe(true);
		expect(dropped > 0).toBe(true);
		expect(dropped / kills >= 1 / (DROPS.pityKills + 1) / 2).toBe(true);
		expect(dropped / kills <= 0.3).toBe(true);
		expect(taken / dropped >= 0.5).toBe(true);
	});
});

// ---------------------------------------------------------------------------------------------
// An honest run with drops: replay and segmented validation

/** The honest run's seed (its floor 1 drops boosts and the bot takes some) and its segment length (ticks). */
const HONEST_SEED = 4242;
const HONEST_SEGMENT_TICKS = 1200;

/** Drains the validator's queue; returns the segment verdicts and the run's result (if decided). */
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

describe("an endless run with boost drops replays and validates segmented", () => {
	const setup = buildEndlessRunConfig(HONEST_SEED);
	const bot = new CensusBot(setup, HONEST_SEED, true);
	const c = bot.clearFloor();
	const recording = bot.recorder.getRecording();
	const finalHash = hashState(bot.state);
	print(`[drops census] honest seed ${HONEST_SEED} ${describeFloor(c)}; dead ${bot.state.player.dead}`);

	it("the run dropped boosts and the bot took some (so the replay below covers drops, pickups and boost effects)", () => {
		expect(c.dropped > 0).toBe(true);
		expect(c.taken > 0).toBe(true);
	});

	it("replays to the live hash", () => {
		expect(hashState(runReplay(recording, buildEndlessRunConfig(HONEST_SEED).config))).toBe(finalHash);
	});

	it("a ranked LiveRun cutting segments every HONEST_SEGMENT_TICKS validates segment by segment, same hash", () => {
		const world = buildWorldSetup(RANKED_WORLD_KIND, HONEST_SEED, { atBossDoor: false });
		const run = new LiveRun({
			seed: HONEST_SEED,
			spawnX: world.spawn!.x,
			spawnZ: world.spawn!.z,
			config: world.config,
			atBossDoor: false,
			runId: "drops-run",
			segmentCutAfterTick: (s) => s.tick % HONEST_SEGMENT_TICKS === 0,
		});
		const v = new SegmentedValidator({
			runId: "drops-run",
			seed: HONEST_SEED,
			worldKind: RANKED_WORLD_KIND,
			setup: buildWorldSetup(RANKED_WORLD_KIND, HONEST_SEED, { atBossDoor: false }),
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
		expect(result?.score?.score).toBe(bot.state.score!.total);
	});
});
