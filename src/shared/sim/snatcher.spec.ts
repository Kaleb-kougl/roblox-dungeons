// The Snatcher (docs/NEW_ENEMIES_2.md NX4, "Design > Snatcher", NXD9-NXD11): it steals its own room's live regular
// pellets (taken = PELLET_STOLEN, never the power pellet, never another room's), flees on its room's flee field from a
// player within fleeRadius until none is within fleeRelease, swallows at its stomach or swallowAfterTicks after its
// first steal (a standing telegraph, then PELLET_DIGESTED: the Sweep is lost), and its death puts every carried pellet
// back (collectable, the Sweep still pays). It never changes PelletRoom.left, draws nothing from any rng, and Horde's
// second wave never buys one.
//
// The rooms are an endless floor's real rooms with their planned spawns replaced (a Snatcher and a training dummy, which
// keeps the room open and never fights), so the record, pellets and field are the sim's own. The Snatcher is engaged by
// test surgery (the player waits at the entrance, out of its sight); kills go through SimCtx between ticks.
import { describe, expect, it } from "@rbxts/jest-globals";
import { AffixKind, encounterCost, type ActorSpawn, type EncounterRoom } from "shared/dungeon";
import {
	AiState,
	DUMMY_KIND,
	EMPTY_INPUT,
	HORDE_WAVE_PENDING,
	HordePhase,
	NO_KIND,
	PELLET_DIGESTED,
	PELLET_STOLEN,
	PactKind,
	PelletPhase,
	ROOM_PAR_TICKS_PER_COST,
	SNATCHER,
	SNATCHER_ATTACK_SWALLOW,
	SNATCHER_CARRIED,
	SNATCHER_FLEE,
	SNATCHER_FLEEING,
	SNATCHER_KIND,
	SNATCHER_STEAL,
	ScoreSource,
	SimCtx,
	archetypeIndex,
	cloneSimState,
	createSimState,
	engage,
	hashState,
	hordePhase,
	partySize,
	pelletsCarried,
	playerAt,
	snatchRecordOf,
	snatcherFleeTarget,
	scorePellet,
	step,
	stepParty,
	Button,
	type ActorState,
	type InputFrame,
	type SimConfig,
	type SimState,
} from "shared/sim";
import { buildEndlessRunConfig, type EndlessRunFloor, type EndlessRunSetup } from "shared/run";
import { altarFloor, frame, pactsSetup, pressPact, skipToFloorAny, teleport } from "shared/run/testing";
import { killActor } from "./combat/actors/actors";

const SEED = 4242;
const SWARMER = "swarmer";

interface Snatch {
	readonly config: SimConfig;
	readonly s: SimState;
	readonly world: EndlessRunFloor;
	readonly room: EncounterRoom;
	/** The Snatcher and the dummy (planned spawns 0 and 1). */
	readonly snatcher: ActorState;
	readonly dummy: ActorState;
	/** The room's score record (= its pellet room). */
	readonly rec: number;
}

/** Regular pellets of encounter room `id` on the floor (the power pellet left out). */
function regularCount(w: EndlessRunFloor, id: number): number {
	const fp = w.pellets;
	if (fp === undefined) return 0;
	let n = 0;
	for (let i = 0; i < fp.room.size(); i++) if (fp.room[i] === id && i !== fp.power) n += 1;
	return n;
}

/** Floor `floor` of `base` with room `room`'s planned spawns replaced by `spawns` (no affixes there). */
function withSpawns(
	base: EndlessRunSetup,
	floor: number,
	room: number,
	spawns: ReadonlyArray<ActorSpawn>,
): { setup: EndlessRunSetup; world: EndlessRunFloor } {
	const w = base.endlessFloor(floor);
	const roomSpawns = w.roomSpawns.map((l, id) => (id === room ? spawns : l));
	const roomAffixes = w.roomAffixes?.map((l, id) => (id === room ? spawns.map(() => AffixKind.NONE) : l));
	const world: EndlessRunFloor = { ...w, roomSpawns, roomAffixes };
	const endlessFloor = (f: number) => (f === floor ? world : base.endlessFloor(f));
	const setup: EndlessRunSetup = {
		...base,
		config: { ...base.config, endless: { ...base.config.endless!, worldForFloor: endlessFloor } },
		endlessFloor,
	};
	return { setup, world };
}

/** The first room of floor 1 with at least `min` regular pellets and two spawn tiles (never the entrance). */
function pelletRoom(base: EndlessRunSetup, min: number): number {
	const w = base.endlessFloor(1);
	const entrance = w.config.encounter!.entranceRoom;
	for (let id = 0; id < w.roomSpawns.size(); id++) {
		if (id === entrance || w.roomSpawns[id].size() === 0) continue;
		if ((w.roomSpawnTiles?.[id].size() ?? 0) < 2 || regularCount(w, id) < min) continue;
		return id;
	}
	error(`no room with ${min} pellets`, 0);
}

function tick(x: Snatch | { s: SimState; config: SimConfig }, input: Readonly<InputFrame> = EMPTY_INPUT): void {
	const p = playerAt(x.s, 0);
	if (p.dead === 0) p.hearts = p.heartsMax;
	if (x.s.party === undefined) {
		step(x.s, input, x.config);
		return;
	}
	const inputs: Readonly<InputFrame>[] = [input];
	for (let k = 1; k < partySize(x.s); k++) inputs.push(EMPTY_INPUT);
	stepParty(x.s, inputs, x.config);
}

/**
 * Run SEED's floor 1 with a pellet room's planned spawns = a Snatcher on its first spawn tile and a dummy on its second;
 * the player walks in (the room spawns, its pellets go live), back to the entrance, and the Snatcher is engaged.
 */
function snatchRun(min = 6, partySize = 1): Snatch {
	const base = buildEndlessRunConfig(SEED, partySize);
	const id = pelletRoom(base, min);
	const tiles = base.endlessFloor(1).roomSpawnTiles![id];
	const { setup, world } = withSpawns(base, 1, id, [
		{ kind: SNATCHER_KIND, x: tiles[0].x, z: tiles[0].z },
		{ kind: DUMMY_KIND, x: tiles[1].x, z: tiles[1].z },
	]);
	const room = world.config.encounter!.rooms[id];
	const s = createSimState(SEED, setup.spawn!.x, setup.spawn!.z, setup.config);
	teleport(s, 0, room.cx, room.cz);
	tick({ s, config: setup.config });
	teleport(s, 0, world.spawnX, world.spawnZ);
	const snatcher = s.combat.actors.find((a) => a.kind === archetypeIndex(SNATCHER_KIND) && a.alive === 1)!;
	const dummy = s.combat.actors.find((a) => a.kind === archetypeIndex(DUMMY_KIND) && a.alive === 1)!;
	expect(snatcher === undefined || dummy === undefined).toBe(false);
	const rec = snatchRecordOf(s, snatcher);
	expect(rec >= 0).toBe(true);
	expect(s.score!.rooms[rec].room).toBe(id);
	engage(snatcher);
	const x: Snatch = { config: setup.config, s, world, room, snatcher, dummy, rec };
	tick(x); // the record's pellets went live on the spawn tick's stepScore
	expect(s.pellets!.rooms[rec].phase).toBe(PelletPhase.LIVE);
	return x;
}

/** Kills `a` between ticks, the kill bound to player `killer` (ctx.playerIndex). */
function kill(x: Snatch, a: ActorState, killer = 0): void {
	const ctx = new SimCtx().bind(x.s, x.world.config, EMPTY_INPUT);
	ctx.actingPlayer(killer);
	ctx.killActor(a);
}

/** Pellet indices of record `rec` (the power pellet left out). */
function regular(s: SimState, rec: number): number[] {
	const p = s.pellets!;
	const r = p.rooms[rec];
	const out: number[] = [];
	for (let i = r.first; i < r.first + r.span; i++) if (i !== p.power) out.push(i);
	return out;
}

/** Ticks until `done` (or `max`); returns the ticks run. */
function runUntil(x: Snatch, done: () => boolean, max = 1200): number {
	let n = 0;
	while (n < max && !done()) {
		tick(x);
		n++;
	}
	return n;
}

/** Takes every pellet of record `rec` still on the floor (taken 0) by standing on it, one per tick. */
function takeRest(x: Snatch): void {
	const p = x.s.pellets!;
	for (const i of regular(x.s, x.rec)) {
		if (p.taken[i] !== 0) continue;
		teleport(x.s, 0, p.x[i], p.z[i]);
		tick(x);
		expect(p.taken[i]).toBe(1);
	}
	teleport(x.s, 0, x.world.spawnX, x.world.spawnZ);
}

describe("Snatcher: steal", () => {
	it("walks to its room's pellets and carries them (PELLET_STOLEN), never changing left", () => {
		const x = snatchRun();
		const p = x.s.pellets!;
		const r = p.rooms[x.rec];
		const left0 = r.left;
		const others: number[] = [];
		for (let i = 0; i < p.taken.size(); i++) if (p.rec[i] !== x.rec) others.push(p.taken[i]);
		let stolenEvents = 0;
		const n = runUntil(x, () => {
			stolenEvents += p.events.stolen.size();
			expect(r.left).toBe(left0);
			return x.snatcher.v[SNATCHER_CARRIED] >= 3;
		});
		expect(n < 1200).toBe(true);
		expect(x.snatcher.aiState).toBe(SNATCHER_STEAL);
		expect(pelletsCarried(x.s, x.rec)).toBe(x.snatcher.v[SNATCHER_CARRIED]);
		expect(stolenEvents).toBe(x.snatcher.v[SNATCHER_CARRIED]);
		for (const i of regular(x.s, x.rec)) expect([0, PELLET_STOLEN].includes(p.taken[i])).toBe(true);
		// no other room's pellet moved
		let k = 0;
		for (let i = 0; i < p.taken.size(); i++) if (p.rec[i] !== x.rec) expect(p.taken[i]).toBe(others[k++]);
		expect(r.left).toBe(left0);
	});

	it("never eats the power pellet or another room's pellet, even standing on them", () => {
		const x = snatchRun();
		const p = x.s.pellets!;
		const own = regular(x.s, x.rec);
		// test surgery: the room's first pellet stands in for its power pellet (out of count / left), every other one
		// taken by a player
		const fake = own[0];
		p.power = fake;
		const r = p.rooms[x.rec];
		r.count -= 1;
		for (let k = 1; k < own.size(); k++) p.taken[own[k]] = 1;
		r.left = 0;
		// another room's pellet, its room live too
		let other = -1;
		for (let i = 0; i < p.rec.size() && other < 0; i++) if (p.rec[i] >= 0 && p.rec[i] !== x.rec) other = i;
		expect(other >= 0).toBe(true);
		p.rooms[p.rec[other]].phase = PelletPhase.LIVE;
		for (const at of [fake, other]) {
			x.snatcher.x = p.x[at];
			x.snatcher.z = p.z[at];
			for (let t = 0; t < 60; t++) tick(x);
			expect(p.taken[at]).toBe(0);
			expect(x.snatcher.v[SNATCHER_CARRIED]).toBe(0);
		}
		expect(r.left).toBe(0);
	});

	it("draws nothing from any rng stream", () => {
		const x = snatchRun();
		const main = x.s.rngState;
		const drops = x.s.drops?.rngState;
		const golden = x.s.golden?.rngState;
		const treasure = x.s.treasure?.rngState;
		const secrets = x.s.secrets?.rngState;
		let swallows = 0;
		for (let t = 0; t < 900; t++) {
			// a player walking through the room now and then (flights)
			teleport(x.s, 0, t % 200 < 40 ? x.room.cx : x.world.spawnX, t % 200 < 40 ? x.room.cz : x.world.spawnZ);
			tick(x);
			swallows += x.s.pellets!.events.swallowed.size();
		}
		expect(swallows > 0).toBe(true);
		const words = [x.s.rngState, x.s.drops?.rngState, x.s.golden?.rngState, x.s.treasure?.rngState];
		expect([...words, x.s.secrets?.rngState]).toEqual([main, drops, golden, treasure, secrets]);
	});

	it("replays bit for bit, a clone included (the flee field cache is a memo, never state)", () => {
		const a = snatchRun();
		const b = snatchRun();
		const c = { s: cloneSimState(a.s), config: a.config };
		for (let t = 0; t < 400; t++) {
			// a player walking through the room now and then (flights)
			if (t % 100 === 50) {
				for (const w of [a, b]) teleport(w.s, 0, w.room.cx, w.room.cz);
				teleport(c.s, 0, a.room.cx, a.room.cz);
			}
			if (t % 100 === 80) {
				for (const w of [a, b]) teleport(w.s, 0, w.world.spawnX, w.world.spawnZ);
				teleport(c.s, 0, a.world.spawnX, a.world.spawnZ);
			}
			tick(a);
			tick(b);
			tick(c);
		}
		expect(hashState(b.s)).toBe(hashState(a.s));
		expect(hashState(c.s)).toBe(hashState(a.s));
	});
});

describe("Snatcher: swallow (NXD11)", () => {
	it("at its stomach (5) it stands for the 1 s telegraph, then the pellets are digested and the Sweep is lost", () => {
		const x = snatchRun(SNATCHER.data.stomach + 1);
		const p = x.s.pellets!;
		const r = p.rooms[x.rec];
		const left0 = r.left;
		runUntil(x, () => x.snatcher.aiState === AiState.TELEGRAPH);
		expect(x.snatcher.attack).toBe(SNATCHER_ATTACK_SWALLOW);
		expect(x.snatcher.v[SNATCHER_CARRIED]).toBe(SNATCHER.data.stomach);
		const carried: number[] = [];
		for (const i of regular(x.s, x.rec)) if (p.taken[i] === PELLET_STOLEN) carried.push(i);
		expect(carried.size()).toBe(SNATCHER.data.stomach);
		const [sx, sz] = [x.snatcher.x, x.snatcher.z];
		let swallowed: number[] | undefined;
		for (let t = 0; t < SNATCHER.data.swallowTicks; t++) {
			expect([x.snatcher.x, x.snatcher.z]).toEqual([sx, sz]);
			tick(x);
			if (p.events.swallowed.size() > 0) swallowed = [...p.events.swallowed[0].indices];
		}
		expect(swallowed).toEqual(carried);
		for (const i of carried) expect(p.taken[i]).toBe(PELLET_DIGESTED);
		expect(x.snatcher.v[SNATCHER_CARRIED]).toBe(0);
		expect(r.left).toBe(left0);
		// the rest taken by the player, the room cleared: no Sweep
		kill(x, x.snatcher);
		takeRest(x);
		expect(r.left).toBe(SNATCHER.data.stomach);
		const sweep0 = x.s.score!.points[ScoreSource.SWEEP];
		kill(x, x.dummy);
		tick(x);
		expect(x.s.score!.rooms[x.rec].cleared).toBe(1);
		expect([r.phase, r.swept]).toEqual([PelletPhase.GONE, 0]);
		expect(x.s.score!.points[ScoreSource.SWEEP]).toBe(sweep0);
	});

	it("swallowAfterTicks (8 s) after its first steal it swallows whatever it carries", () => {
		const x = snatchRun();
		const p = x.s.pellets!;
		runUntil(x, () => x.snatcher.v[SNATCHER_CARRIED] === 1);
		// nothing more to steal: the rest taken by a player (surgery, left kept in step)
		const r = p.rooms[x.rec];
		for (const i of regular(x.s, x.rec))
			if (p.taken[i] === 0) {
				p.taken[i] = 1;
				r.left -= 1;
			}
		const t0 = x.s.tick;
		runUntil(x, () => x.snatcher.aiState === AiState.TELEGRAPH, 1000);
		// the belly counted from the tick after the steal: the telegraph starts swallowAfterTicks later
		expect(x.s.tick - t0).toBe(SNATCHER.data.swallowAfterTicks);
		runUntil(x, () => x.snatcher.aiState !== AiState.TELEGRAPH, 100);
		let digested = 0;
		for (const i of regular(x.s, x.rec)) if (p.taken[i] === PELLET_DIGESTED) digested += 1;
		expect(digested).toBe(1);
	});
});

describe("Snatcher: death returns the pellets", () => {
	it("every carried pellet goes back in place (events with indices), is collectable, and the Sweep still pays", () => {
		const x = snatchRun();
		const p = x.s.pellets!;
		const r = p.rooms[x.rec];
		const left0 = r.left;
		runUntil(x, () => x.snatcher.v[SNATCHER_CARRIED] >= 2);
		const carried: number[] = [];
		for (const i of regular(x.s, x.rec)) if (p.taken[i] === PELLET_STOLEN) carried.push(i);
		const [dx, dz] = [x.snatcher.x, x.snatcher.z];
		p.events.eaten.clear();
		const pellets0 = x.s.score!.points[ScoreSource.PELLETS];
		kill(x, x.snatcher); // the dummy still stands: the room stays open, nothing is credited (NXD18)
		expect(p.events.eaten.size()).toBe(0);
		expect(x.s.score!.points[ScoreSource.PELLETS]).toBe(pellets0);
		expect(p.events.returned.map((e) => e.index)).toEqual(carried);
		for (const e of p.events.returned) expect([e.fromX, e.fromZ]).toEqual([dx, dz]);
		for (const i of carried) expect(p.taken[i]).toBe(0);
		expect(pelletsCarried(x.s, x.rec)).toBe(0);
		expect(r.left).toBe(left0);
		takeRest(x);
		expect(r.left).toBe(0);
		const sweep0 = x.s.score!.points[ScoreSource.SWEEP];
		kill(x, x.dummy);
		tick(x);
		expect([r.phase, r.swept]).toEqual([PelletPhase.GONE, 1]);
		expect(x.s.score!.points[ScoreSource.SWEEP] > sweep0).toBe(true);
	});
});

/** The record's carried pellets (taken = PELLET_STOLEN), ascending. */
function stolen(x: Snatch): number[] {
	const p = x.s.pellets!;
	const out: number[] = [];
	for (const i of regular(x.s, x.rec)) if (p.taken[i] === PELLET_STOLEN) out.push(i);
	return out;
}

/**
 * The Snatcher carrying at least `n`, then the dummy killed (the Snatcher is the room's last living member) and every
 * pellet of the room still on the floor taken by a player (surgery: taken 1, left kept in step, no points), so only its
 * belly stands between the room and its Sweep. Returns the carried pellets.
 */
function lastWithBelly(x: Snatch, n = 2): number[] {
	runUntil(x, () => x.snatcher.v[SNATCHER_CARRIED] >= n);
	const carried = stolen(x);
	expect(carried.size() >= n).toBe(true);
	kill(x, x.dummy);
	const p = x.s.pellets!;
	const r = p.rooms[x.rec];
	for (const i of regular(x.s, x.rec))
		if (p.taken[i] === 0) {
			p.taken[i] = 1;
			r.left -= 1;
		}
	expect(r.left).toBe(carried.size());
	expect(x.s.score!.rooms[x.rec].cleared).toBe(0);
	p.events.eaten.clear();
	p.events.returned.clear();
	return carried;
}

/** Checks the credit: `carried` taken by `player` (eaten events, one pellet's points each), none returned. */
function expectCredited(x: Snatch, carried: ReadonlyArray<number>, player: number, pellets0: number): void {
	const p = x.s.pellets!;
	expect(p.events.returned.size()).toBe(0);
	expect(p.events.eaten.map((e) => e.index)).toEqual([...carried]);
	// pellets never feed the combo, so one more pellet now pays what each credited one paid
	const each = scorePellet(cloneSimState(x.s), x.rec);
	expect(each > 0).toBe(true);
	for (const e of p.events.eaten)
		expect([e.player, e.points, e.x, e.z]).toEqual([player, each, p.x[e.index], p.z[e.index]]);
	for (const i of carried) expect(p.taken[i]).toBe(1);
	expect(p.rooms[x.rec].left).toBe(0);
	expect(x.s.score!.points[ScoreSource.PELLETS] - pellets0).toBe(each * carried.size());
}

describe("Snatcher killed last: its pellets are the killer's (NXD18)", () => {
	it("credited as the killer's pickups (left, points, events), and the clear's Sweep pays", () => {
		const x = snatchRun();
		const carried = lastWithBelly(x);
		const r = x.s.pellets!.rooms[x.rec];
		const pellets0 = x.s.score!.points[ScoreSource.PELLETS];
		kill(x, x.snatcher);
		expectCredited(x, carried, 0, pellets0);
		const sweep0 = x.s.score!.points[ScoreSource.SWEEP];
		tick(x);
		expect(x.s.score!.rooms[x.rec].cleared).toBe(1);
		expect([r.phase, r.swept]).toEqual([PelletPhase.GONE, 1]);
		expect(x.s.score!.points[ScoreSource.SWEEP] > sweep0).toBe(true);
	});

	it("a kill inside the tick (a sword swing during the swallow) is credited before that tick's clear pays the Sweep", () => {
		const x = snatchRun();
		const carried = lastWithBelly(x);
		const a = x.snatcher;
		const r = x.s.pellets!.rooms[x.rec];
		// nothing left to steal: the belly timer starts the swallow, during which it stands still
		runUntil(x, () => a.aiState === AiState.TELEGRAPH, SNATCHER.data.swallowAfterTicks + 10);
		expect(a.aiState).toBe(AiState.TELEGRAPH);
		a.hp = 1;
		const open = x.world.config.isBodyBlocked!;
		let placed = false;
		for (const [ox, oz] of [
			[1, 0],
			[-1, 0],
			[0, 1],
			[0, -1],
		]) {
			if (placed || open(a.x + ox, a.z + oz)) continue;
			teleport(x.s, 0, a.x + ox, a.z + oz);
			placed = true;
		}
		expect(placed).toBe(true);
		const pl = playerAt(x.s, 0);
		const len = math.sqrt((a.x - pl.x) * (a.x - pl.x) + (a.z - pl.z) * (a.z - pl.z));
		const pellets0 = x.s.score!.points[ScoreSource.PELLETS];
		let t = 0;
		while (a.alive !== 0 && t < SNATCHER.data.swallowTicks - 2) {
			const buttons = t % 2 === 0 ? Button.FIRE : 0;
			tick(x, frame(0, 0, buttons, (a.x - pl.x) / len, (a.z - pl.z) / len));
			t++;
		}
		expect(a.alive).toBe(0);
		// the kill (stepCombat), the credit, then stepPellets and stepScore's clear: all in this one tick
		expectCredited(x, carried, 0, pellets0);
		expect(x.s.score!.rooms[x.rec].cleared).toBe(1);
		expect([r.phase, r.swept]).toEqual([PelletPhase.GONE, 1]);
	});

	it("a quiet death (nobody earned it) puts them back as before, and the room clears without its Sweep", () => {
		const x = snatchRun();
		const carried = lastWithBelly(x);
		const p = x.s.pellets!;
		const r = p.rooms[x.rec];
		const ctx = new SimCtx().bind(x.s, x.world.config, EMPTY_INPUT);
		killActor(ctx, x.snatcher, true);
		expect(p.events.eaten.size()).toBe(0);
		expect(p.events.returned.map((e) => e.index)).toEqual(carried);
		for (const i of carried) expect(p.taken[i]).toBe(0);
		expect(r.left).toBe(carried.size());
		tick(x);
		expect(x.s.score!.rooms[x.rec].cleared).toBe(1);
		expect([r.phase, r.swept]).toEqual([PelletPhase.GONE, 0]);
	});

	it("co-op: credited to the killing player", () => {
		const x = snatchRun(6, 2);
		expect(partySize(x.s)).toBe(2);
		const carried = lastWithBelly(x);
		const r = x.s.pellets!.rooms[x.rec];
		const pellets0 = x.s.score!.points[ScoreSource.PELLETS];
		kill(x, x.snatcher, 1);
		expectCredited(x, carried, 1, pellets0);
		tick(x);
		expect([r.phase, r.swept]).toEqual([PelletPhase.GONE, 1]);
	});
});

describe("Snatcher: flee", () => {
	it("a player within fleeRadius sends it running on its room's field, inside the room, until none within fleeRelease", () => {
		const x = snatchRun();
		const a = x.snatcher;
		const pl = playerAt(x.s, 0);
		// put the player beside it on an open floor cell
		const open = x.world.config.isBodyBlocked!;
		let placed = false;
		for (const [ox, oz] of [
			[1.5, 0],
			[-1.5, 0],
			[0, 1.5],
			[0, -1.5],
		]) {
			if (placed || open(a.x + ox, a.z + oz)) continue;
			teleport(x.s, 0, a.x + ox, a.z + oz);
			placed = true;
		}
		expect(placed).toBe(true);
		// the field (not the straight-away fallback) gives its first step
		const fctx = new SimCtx().bind(x.s, x.world.config, EMPTY_INPUT);
		expect(snatcherFleeTarget(fctx, x.room, a.x, a.z, SNATCHER.data.fleeFactor)).toBe(1);
		const d0 = math.sqrt((pl.x - a.x) * (pl.x - a.x) + (pl.z - a.z) * (pl.z - a.z));
		expect(d0 < SNATCHER.data.fleeRadius).toBe(true);
		tick(x);
		expect([a.aiState, a.v[SNATCHER_FLEEING]]).toEqual([SNATCHER_FLEE, 1]);
		for (let t = 0; t < 30; t++) {
			tick(x);
			const inside = a.x >= x.room.minX && a.x <= x.room.maxX && a.z >= x.room.minZ && a.z <= x.room.maxZ;
			expect(inside).toBe(true);
		}
		const d1 = math.sqrt((pl.x - a.x) * (pl.x - a.x) + (pl.z - a.z) * (pl.z - a.z));
		expect(d1 > d0).toBe(true);
		teleport(x.s, 0, x.world.spawnX, x.world.spawnZ);
		tick(x);
		expect(a.v[SNATCHER_FLEEING]).toBe(0);
		expect(a.aiState === SNATCHER_STEAL || a.aiState === AiState.TELEGRAPH).toBe(true);
	});
});

describe("Snatcher and the Horde (NXD9)", () => {
	interface Horde {
		readonly setup: EndlessRunSetup;
		readonly s: SimState;
		readonly world: EndlessRunFloor;
		readonly room: number;
	}

	/** Run 1337 with pacts, its first altar floor's first pellet room with >= 12 tiles, planned spawns `kinds` on them. */
	function hordeRun(kinds: ReadonlyArray<string>): Horde {
		const base = pactsSetup(1337);
		const floor = altarFloor(base);
		expect(floor > 0).toBe(true);
		const w = base.endlessFloor(floor);
		let room = -1;
		for (let id = 0; id < w.roomSpawns.size() && room < 0; id++) {
			if (w.roomSpawns[id].size() === 0 || (w.roomSpawnTiles?.[id].size() ?? 0) < 12) continue;
			if (w.pellets === undefined || !w.pellets.room.includes(id)) continue;
			room = id;
		}
		expect(room >= 0).toBe(true);
		const tiles = w.roomSpawnTiles![room];
		const spawns = kinds.map((kind, k) => ({ kind, x: tiles[k].x, z: tiles[k].z }));
		const { setup, world } = withSpawns(base, floor, room, spawns);
		const s = createSimState(1337, setup.spawn!.x, setup.spawn!.z, setup.config);
		skipToFloorAny(s, setup.config, floor);
		pressPact(setup, s, PactKind.HORDE);
		const r = world.config.encounter!.rooms[room];
		teleport(s, 0, r.cx, r.cz);
		step(s, EMPTY_INPUT, setup.config);
		teleport(s, 0, world.spawnX, world.spawnZ);
		expect(hordePhase(s)).toBe(HordePhase.FIGHT);
		return { setup, s, world, room };
	}

	/** Kills the horde record's living first wave and steps once: wave 2 is telegraphed. */
	function trigger(h: Horde): void {
		const rec = h.s.score!.rooms[h.s.pacts!.horde.record];
		const ctx = new SimCtx().bind(h.s, h.world.config, EMPTY_INPUT);
		for (let m = 0; m < rec.memberSlots.size(); m++) {
			const a = h.s.combat.actors[rec.memberSlots[m]];
			if (a !== undefined && a.kind !== NO_KIND && a.id === rec.memberIds[m] && a.alive !== 0) ctx.killActor(a);
		}
		step(h.s, EMPTY_INPUT, h.setup.config);
		expect(h.s.pacts!.horde.spawned).toBe(HORDE_WAVE_PENDING);
	}

	it("wave 2 skips the Snatcher (one thief per room) and its par counts only what it buys", () => {
		const kinds = [SWARMER, SWARMER, SNATCHER_KIND, SWARMER, SWARMER];
		const h = hordeRun(kinds);
		const p = h.s.pacts!;
		trigger(h);
		const swarmer = archetypeIndex(SWARMER);
		expect([...p.horde.waveKinds]).toEqual([swarmer, swarmer, swarmer, swarmer]);
		const rec = h.s.score!.rooms[p.horde.record];
		const par0 = rec.parTicks;
		for (let t = 0; t < 200 && p.horde.spawned === HORDE_WAVE_PENDING; t++) step(h.s, EMPTY_INPUT, h.setup.config);
		expect(p.horde.spawned).toBe(4);
		expect(rec.parTicks).toBe(
			par0 + p.config.waveTelegraphTicks + 4 * ROOM_PAR_TICKS_PER_COST * encounterCost(SWARMER),
		);
		for (let m = kinds.size(); m < rec.memberSlots.size(); m++)
			expect(h.s.combat.actors[rec.memberSlots[m]].kind).toBe(swarmer);
	});

	it("the cap (hordeMaxWave) counts the kept entries: a Snatcher first in 12 planned still leaves a wave of 10", () => {
		const kinds = [SNATCHER_KIND];
		for (let k = 0; k < 11; k++) kinds.push(SWARMER);
		const h = hordeRun(kinds);
		trigger(h);
		const waveKinds = h.s.pacts!.horde.waveKinds;
		expect(waveKinds.size()).toBe(h.s.pacts!.config.hordeMaxWave);
		for (const k of waveKinds) expect(k).toBe(archetypeIndex(SWARMER));
	});
});
