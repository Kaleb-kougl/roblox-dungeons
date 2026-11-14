// docs/NEW_ENEMIES_2.md NX5: the Pyre-keeper (`pyrekeeper`) and its brazier (`pyre`). The light cast (two draws at
// every decision, the first cooldown the only draw in init), the landing cell rule (the first valid compass point from
// the drawn start index: FLOOR, no intact piece, no pellet in play, the keeper's own room, >= 2 from every living
// player and from its other pyres; none: the cast is spent), the caps (3 of its pyres alive, 6 per life), the pyre's
// fire (lit 0.5 s after it lands, one aimed shot every 2 s at the nearest living player in sight, staggered so a
// keeper's pyres never fire together), the wither at the keeper's death (its own pyres only; a light telegraph is
// spent with it), the room clearing without the pyres (never members), no drop roll, no affix, and determinism.
//
// Open arenas (no grid, every sight line clear) for the rules, and an endless floor's real rooms (their planned spawns
// replaced by a Pyre-keeper and a training dummy that keeps the room open) for the landing census and the room clear.
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	AffixKind,
	TileType,
	cellKey,
	gridToWorld,
	tileAt,
	worldToGrid,
	type ActorSpawn,
	type EncounterRoom,
} from "shared/dungeon";
import {
	AiState,
	DEFAULT_SIM_CONFIG,
	DUMMY_KIND,
	EMPTY_INPUT,
	PELLET_STOLEN,
	PYRE,
	PYREKEEPER,
	PYREKEEPER_ATTACK_LIGHT,
	PYREKEEPER_LAND_X,
	PYREKEEPER_LAND_Z,
	PYREKEEPER_LIT,
	PYRE_FIRE,
	PYRE_KEEPER,
	PYRE_STAGGER,
	Rng,
	STATE_ENGAGED,
	ScoreSource,
	SimCtx,
	V_HOME_X,
	V_HOME_Z,
	archetypeIndex,
	createSimState,
	engage,
	hashState,
	partySize,
	playerAt,
	pyreTarget,
	pyrekeeperPyresAlive,
	spawnActor,
	step,
	stepParty,
	type ActorState,
	type EncounterConfig,
	type InputFrame,
	type SimConfig,
	type SimState,
} from "shared/sim";
import { buildEndlessRunConfig, type EndlessRunFloor, type EndlessRunSetup } from "shared/run";
import { teleport } from "shared/run/testing";

const KEEPER = archetypeIndex(PYREKEEPER.id);
const PYRE_KIND = archetypeIndex(PYRE.id);
const K = PYREKEEPER.data;
const P = PYRE.data;

// ---------------------------------------------------------------------------------------------
// Open arenas

interface World {
	s: SimState;
	config: SimConfig;
}

function open(encounter?: EncounterConfig, party = 1): World {
	const config: SimConfig = {
		...DEFAULT_SIM_CONFIG,
		encounter,
		party: party > 1 ? { size: party } : undefined,
	};
	const s = createSimState(13, 0, 0, config);
	return { s, config };
}

function ctxOf(w: { s: SimState; config: SimConfig }): SimCtx {
	return new SimCtx().bind(w.s, w.config, EMPTY_INPUT);
}

/** Every player can't be hurt (bullets pass through). */
function ghost(s: SimState): void {
	for (let i = 0; i < partySize(s); i++) playerAt(s, i).hurtTicks = 1e6;
}

/** An engaged Pyre-keeper at (x, z), stepping from this tick on. */
function keeper(w: World, x: number, z: number): ActorState {
	const a = spawnActor(ctxOf(w), KEEPER, x, z)!;
	a.spawnTick = -1;
	engage(a);
	return a;
}

function tick(w: { s: SimState; config: SimConfig }): void {
	ghost(w.s);
	if (partySize(w.s) > 1) {
		const inputs: InputFrame[] = [];
		for (let i = 0; i < partySize(w.s); i++) inputs.push(EMPTY_INPUT);
		stepParty(w.s, inputs, w.config);
	} else step(w.s, EMPTY_INPUT, w.config);
}

/** The living pyres of keeper `a`, slot order. */
function pyresOf(s: SimState, a: Readonly<ActorState>): ActorState[] {
	return s.combat.actors.filter((o) => o.kind === PYRE_KIND && o.alive !== 0 && o.v[PYRE_KEEPER] === a.id);
}

/**
 * Forces one light decision this tick (the cooldown out, the strafe timer far off so no flip draws) and, when it starts
 * the telegraph, finishes it on the next tick. Returns the new pyre, or undefined (no cast).
 */
function forceLight(w: { s: SimState; config: SimConfig }, a: ActorState): ActorState | undefined {
	a.cooldown = 0;
	a.aiTicks = 1e6;
	a.aiState = STATE_ENGAGED;
	tick(w);
	if (a.aiState !== AiState.TELEGRAPH || a.attack !== PYREKEEPER_ATTACK_LIGHT) return undefined;
	const before = new Set<number>();
	for (const o of pyresOf(w.s, a)) before.add(o.id);
	a.aiTicks = 1;
	tick(w);
	for (const o of pyresOf(w.s, a)) if (!before.has(o.id)) return o;
	return undefined;
}

/** Rng state after `n` draws from `state`. */
function advanced(state: number, n: number): number {
	const r = new Rng(0);
	r.setState(state);
	for (let k = 0; k < n; k++) r.next();
	return r.getState();
}

function room(id: number, minX: number, maxX: number, minZ: number, maxZ: number): EncounterRoom {
	return {
		id,
		type: "combat",
		depth: id,
		cx: (minX + maxX) / 2,
		cz: (minZ + maxZ) / 2,
		minX,
		maxX,
		minZ,
		maxZ,
		floorTiles: 1,
	};
}

describe("Pyre-keeper: draws", () => {
	it("init draws exactly once (the first cooldown, in lightCooldownMin-Max)", () => {
		const w = open();
		const rng0 = w.s.rngState;
		const a = spawnActor(ctxOf(w), KEEPER, 0, 7)!;
		expect(w.s.rngState).toBe(advanced(rng0, 1));
		expect(a.cooldown >= K.lightCooldownMin && a.cooldown <= K.lightCooldownMax).toBe(true);
		expect(math.abs(a.v[6])).toBe(1); // the strafe side, from the id
	});

	it("every light decision draws exactly two (cooldown, start index): a cast, a capped one and a spent one", () => {
		// A cast: the landing point is the drawn start index's compass point around the player (an open arena: all valid).
		const w = open();
		const a = keeper(w, 0, 7);
		a.cooldown = 0;
		a.aiTicks = 1e6;
		const before = w.s.rngState;
		tick(w);
		expect(w.s.rngState).toBe(advanced(before, 2));
		expect([a.aiState, a.attack]).toEqual([AiState.TELEGRAPH, PYREKEEPER_ATTACK_LIGHT]);
		const probe = new Rng(0);
		probe.setState(before);
		const cd = probe.int(K.lightCooldownMin, K.lightCooldownMax);
		const start = probe.int(0, K.landingOffsets.size() - 1);
		expect(a.cooldown).toBe(cd);
		const o = K.landingOffsets[start];
		expect([a.v[PYREKEEPER_LAND_X], a.v[PYREKEEPER_LAND_Z]]).toEqual([
			gridToWorld(worldToGrid(o[0] * K.landingDistance)),
			gridToWorld(worldToGrid(o[1] * K.landingDistance)),
		]);

		// Capped: three pyres alive -> two draws, no telegraph.
		const w2 = open();
		const b = keeper(w2, 0, 7);
		for (let k = 0; k < K.maxAlive; k++) expect(forceLight(w2, b) !== undefined).toBe(true);
		expect(pyrekeeperPyresAlive(w2.s.combat.actors, b)).toBe(K.maxAlive);
		b.cooldown = 0;
		b.aiTicks = 1e6;
		const before2 = w2.s.rngState;
		tick(w2);
		expect(w2.s.rngState).toBe(advanced(before2, 2));
		expect(b.aiState).toBe(STATE_ENGAGED);

		// Spent: its room lies wholly outside every compass point -> two draws, no telegraph, no pyre, none lit.
		const w3 = open({ spawns: [], rooms: [room(0, -1.5, 1.5, 5.5, 8.5)], entranceRoom: -1, bossRoom: -1 });
		const c = keeper(w3, 0, 7);
		c.cooldown = 0;
		c.aiTicks = 1e6;
		const before3 = w3.s.rngState;
		tick(w3);
		expect(w3.s.rngState).toBe(advanced(before3, 2));
		expect([c.aiState, c.attack, c.v[PYREKEEPER_LIT]]).toEqual([STATE_ENGAGED, 0, 0]);
		expect(c.cooldown >= K.lightCooldownMin).toBe(true);
		for (let t = 0; t < 120; t++) tick(w3);
		expect(w3.s.combat.actors.some((x) => x.kind === PYRE_KIND)).toBe(false);
	});

	it("the pyre never draws", () => {
		const w = open();
		const rng0 = w.s.rngState;
		const p = spawnActor(ctxOf(w), PYRE_KIND, 3, 3)!;
		p.spawnTick = -1;
		for (let t = 0; t < 600; t++) tick(w);
		expect(w.s.rngState).toBe(rng0);
	});
});

describe("Pyre-keeper: caps and the light", () => {
	it("at most 3 of its pyres alive, at most 6 per life (pyres killed as soon as 3 live)", () => {
		const w = open();
		const a = keeper(w, 0, 7);
		const ctx = ctxOf(w);
		const ids = new Set<number>();
		let peak = 0;
		for (let t = 0; t < 60 * 60; t++) {
			tick(w);
			const live = pyresOf(w.s, a);
			peak = math.max(peak, live.size());
			for (const o of live) ids.add(o.id);
			expect(live.size() <= K.maxAlive).toBe(true);
			if (live.size() === K.maxAlive && t % 97 === 0) ctx.bind(w.s, w.config, EMPTY_INPUT).killActor(live[0]);
		}
		expect(peak).toBe(K.maxAlive);
		expect(ids.size()).toBe(K.perLife);
		expect(a.v[PYREKEEPER_LIT]).toBe(K.perLife);
	});

	it("the telegraph lasts 0.8 s with the ring on the landing point, then the pyre lands there linked to its keeper", () => {
		const w = open();
		const a = keeper(w, 0, 7);
		a.cooldown = 0;
		a.aiTicks = 1e6;
		let tele = 0;
		let landed = 0;
		let pyre: ActorState | undefined;
		let lx = 0;
		let lz = 0;
		for (let t = 0; t < 120 && pyre === undefined; t++) {
			tick(w);
			landed += w.s.events.pyresLanded;
			if (a.aiState === AiState.TELEGRAPH) {
				tele++;
				lx = a.v[PYREKEEPER_LAND_X];
				lz = a.v[PYREKEEPER_LAND_Z];
			}
			pyre = pyresOf(w.s, a)[0];
		}
		expect(pyre !== undefined).toBe(true);
		// Seen at the end of the decision tick and the 47 after it; the 48th spawns (back to keeping range at its end).
		expect(tele).toBe(K.lightTelegraphTicks);
		expect([pyre!.x, pyre!.z, pyre!.v[PYRE_KEEPER], landed]).toEqual([lx, lz, a.id, 1]);
		expect(pyre!.spawnTick).toBe(w.s.tick - 1);
		expect(a.v[PYREKEEPER_LIT]).toBe(1);
		expect(math.sqrt(lx * lx + lz * lz) >= K.landingPlayerClear).toBe(true);
	});

	it("killed mid-telegraph: the cast is spent, no pyre, the ring off", () => {
		const w = open();
		const a = keeper(w, 0, 7);
		a.cooldown = 0;
		a.aiTicks = 1e6;
		tick(w);
		expect([a.aiState, a.attack]).toEqual([AiState.TELEGRAPH, PYREKEEPER_ATTACK_LIGHT]);
		for (let t = 0; t < 10; t++) tick(w);
		ctxOf(w).killActor(a);
		expect(a.attack).toBe(0);
		for (let t = 0; t < 120; t++) tick(w);
		expect(w.s.combat.actors.some((x) => x.kind === PYRE_KIND)).toBe(false);
	});

	it("never lands within 2 of a living player or of its other pyres (co-op: every player)", () => {
		const w = open(undefined, 2);
		const p1 = playerAt(w.s, 1);
		p1.x = 2.5;
		p1.z = 0;
		p1.prevX = p1.x;
		p1.prevZ = p1.z;
		const a = keeper(w, 0, 9);
		for (let k = 0; k < 40; k++) {
			const live = pyresOf(w.s, a);
			if (live.size() === K.maxAlive) ctxOf(w).killActor(live[0]);
			a.v[PYREKEEPER_LIT] = 0;
			const p = forceLight(w, a);
			if (p === undefined) continue;
			for (let i = 0; i < 2; i++) {
				const q = playerAt(w.s, i);
				const d2 = (q.x - p.x) * (q.x - p.x) + (q.z - p.z) * (q.z - p.z);
				expect(d2 >= K.landingPlayerClear * K.landingPlayerClear).toBe(true);
			}
			for (const o of pyresOf(w.s, a)) {
				if (o === p) continue;
				const d2 = (o.x - p.x) * (o.x - p.x) + (o.z - p.z) * (o.z - p.z);
				expect(d2 >= K.landingPyreClear * K.landingPyreClear).toBe(true);
			}
		}
	});
});

describe("pyre: fire", () => {
	it("lit 0.5 s after it lands, then one aimed shot every 2 s at the nearest living player in sight", () => {
		const w = open();
		const p = spawnActor(ctxOf(w), PYRE_KIND, 4, 0)!;
		const spawned = w.s.tick;
		const shots: number[] = [];
		for (let t = 0; t < 400; t++) {
			const n0 = w.s.combat.enemySpawned;
			tick(w);
			const n = w.s.combat.enemySpawned - n0;
			if (n > 0) {
				expect(n).toBe(1);
				expect(p.aiTicks).toBe(0); // lit
				shots.push(w.s.tick - 1 - spawned); // the tick it stepped on
			}
		}
		// Landed on tick `spawned` (skipped then: spawnTick === tick), it lights and fires litTicks ticks later.
		expect(shots[0]).toBe(P.litTicks);
		for (let k = 1; k < shots.size(); k++) expect(shots[k] - shots[k - 1]).toBe(P.fireTicks);
		expect(p.faceX).toBeCloseTo(-1, 9);
	});

	it("aims at the nearest living player in sight (co-op), none when every player is dead", () => {
		const w = open(undefined, 2);
		const q = playerAt(w.s, 1);
		q.x = 6;
		q.z = 1;
		const ctx = ctxOf(w);
		expect(pyreTarget(ctx, 5, 0)).toBe(q);
		expect(pyreTarget(ctx, -1, 0)).toBe(playerAt(w.s, 0));
		q.dead = 1;
		expect(pyreTarget(ctx, 5, 0)).toBe(playerAt(w.s, 0));
		playerAt(w.s, 0).dead = 1;
		expect(pyreTarget(ctx, 5, 0)).toBe(undefined);
	});

	it("a keeper's pyres never fire on the same tick, also after one dies and another takes its place", () => {
		const w = open();
		const a = keeper(w, 0, 7);
		const fired = new Map<number, number[]>();
		let checked = 0;
		let replaced = false;
		for (let t = 0; t < 60 * 50; t++) {
			if (pyresOf(w.s, a).size() < K.maxAlive) a.cooldown = math.min(a.cooldown, 20);
			if (!replaced && pyresOf(w.s, a).size() === K.maxAlive && t > 600) {
				ctxOf(w).killActor(pyresOf(w.s, a)[1]);
				replaced = true;
			}
			tick(w);
			const now: number[] = [];
			for (const o of pyresOf(w.s, a)) {
				if (o.v[PYRE_FIRE] !== P.fireTicks || o.spawnTick === w.s.tick - 1) continue;
				now.push(o.id);
				const l = fired.get(o.id) ?? [];
				l.push(w.s.tick);
				fired.set(o.id, l);
			}
			expect(now.size() <= 1).toBe(true);
			if (pyresOf(w.s, a).size() === K.maxAlive) checked++;
		}
		expect(replaced).toBe(true);
		expect(checked > 600).toBe(true);
		// Shots of different pyres of the keeper are at least shotStaggerTicks - 1 apart (a sibling not yet stepped).
		const all: number[] = [];
		fired.forEach((l) => {
			for (let k = 1; k < l.size(); k++) expect(l[k] - l[k - 1]).toBe(P.fireTicks);
			for (const x of l) all.push(x);
		});
		all.sort((x, y) => x < y);
		for (let k = 1; k < all.size(); k++) expect(all[k] - all[k - 1] >= P.shotStaggerTicks - 1).toBe(true);
		// Stagger slots of the living pyres are distinct.
		const slots = pyresOf(w.s, a).map((o) => o.v[PYRE_STAGGER]);
		expect(new Set(slots).size()).toBe(slots.size());
	});
});

describe("Pyre-keeper: wither", () => {
	it("its death withers its own pyres at once; another keeper's live on", () => {
		const w = open();
		const a = keeper(w, 0, 7);
		const b = keeper(w, 0, -7);
		forceLight(w, a);
		forceLight(w, a);
		forceLight(w, b);
		expect([pyresOf(w.s, a).size(), pyresOf(w.s, b).size()]).toEqual([2, 1]);
		const mine = pyresOf(w.s, a);
		ctxOf(w).killActor(a);
		expect(w.s.events.pyresWithered).toBe(2);
		for (const o of mine) expect(o.alive).toBe(0);
		expect(pyresOf(w.s, b).size()).toBe(1);
		tick(w);
		expect(pyresOf(w.s, b).size()).toBe(1);
	});
});

// ---------------------------------------------------------------------------------------------
// Endless floors (the snatcher spec's construction)

interface Keep {
	readonly config: SimConfig;
	readonly s: SimState;
	readonly world: EndlessRunFloor;
	readonly room: EncounterRoom;
	readonly keeper: ActorState;
	readonly dummy: ActorState;
}

function withSpawns(
	base: EndlessRunSetup,
	floor: number,
	id: number,
	spawns: ReadonlyArray<ActorSpawn>,
): { setup: EndlessRunSetup; world: EndlessRunFloor } {
	const w = base.endlessFloor(floor);
	const roomSpawns = w.roomSpawns.map((l, k) => (k === id ? spawns : l));
	const roomAffixes = w.roomAffixes?.map((l, k) => (k === id ? spawns.map(() => AffixKind.NONE) : l));
	const world: EndlessRunFloor = { ...w, roomSpawns, roomAffixes };
	const endlessFloor = (f: number) => (f === floor ? world : base.endlessFloor(f));
	const setup: EndlessRunSetup = {
		...base,
		config: { ...base.config, endless: { ...base.config.endless!, worldForFloor: endlessFloor } },
		endlessFloor,
	};
	return { setup, world };
}

/** The first room of floor 1 (never the entrance) with two spawn tiles and at least `minPellets` pellets. */
function pickRoom(base: EndlessRunSetup, minPellets: number): number {
	const w = base.endlessFloor(1);
	const entrance = w.config.encounter!.entranceRoom;
	for (let id = 0; id < w.roomSpawns.size(); id++) {
		if (id === entrance || w.roomSpawns[id].size() === 0) continue;
		if ((w.roomSpawnTiles?.[id].size() ?? 0) < 2) continue;
		let n = 0;
		const fp = w.pellets;
		if (fp !== undefined) for (let i = 0; i < fp.room.size(); i++) if (fp.room[i] === id) n++;
		if (n >= minPellets) return id;
	}
	error(`no room with ${minPellets} pellets`, 0);
}

/** Run `seed`'s floor 1 with a room's planned spawns = a Pyre-keeper and a dummy; the player walks in; it engages. */
function keepRun(seed: number): Keep {
	const base = buildEndlessRunConfig(seed);
	const id = pickRoom(base, 6);
	const tiles = base.endlessFloor(1).roomSpawnTiles![id];
	const { setup, world } = withSpawns(base, 1, id, [
		{ kind: PYREKEEPER.id, x: tiles[0].x, z: tiles[0].z },
		{ kind: DUMMY_KIND, x: tiles[1].x, z: tiles[1].z },
	]);
	const r = world.config.encounter!.rooms[id];
	const s = createSimState(seed, setup.spawn!.x, setup.spawn!.z, setup.config);
	teleport(s, 0, r.cx, r.cz);
	step(s, EMPTY_INPUT, setup.config);
	const k = s.combat.actors.find((a) => a.kind === KEEPER && a.alive === 1)!;
	const dummy = s.combat.actors.find((a) => a.kind === archetypeIndex(DUMMY_KIND) && a.alive === 1)!;
	expect(k === undefined || dummy === undefined).toBe(false);
	engage(k);
	return { config: setup.config, s, world, room: r, keeper: k, dummy };
}

type Reason = "tile" | "piece" | "pellet" | "room" | "clear";

/** The landing rules, written out from the plan, for grid cell (gx, gz): undefined when valid, else the first failure. */
function why(x: Keep, gx: number, gz: number): Reason | undefined {
	const s = x.s;
	if (tileAt(x.world.dungeon, gx, gz) !== TileType.FLOOR) return "tile";
	const key = cellKey(gx, gz);
	const b = s.breakables;
	if (b !== undefined && b.slotByCell.has(key)) return "piece";
	const pl = s.pellets;
	const i = pl?.byCell.get(key);
	if (pl !== undefined && i !== undefined && (pl.taken[i] === 0 || pl.taken[i] === PELLET_STOLEN)) return "pellet";
	const cx = gridToWorld(gx);
	const cz = gridToWorld(gz);
	const inBox = (r: EncounterRoom, px: number, pz: number) =>
		px >= r.minX && px <= r.maxX && pz >= r.minZ && pz <= r.maxZ;
	const rooms = x.world.config.encounter!.rooms;
	const firstRoom = (px: number, pz: number) => rooms.find((r) => inBox(r, px, pz));
	if (firstRoom(cx, cz) !== firstRoom(x.keeper.v[V_HOME_X], x.keeper.v[V_HOME_Z])) return "room";
	const p = playerAt(s, 0);
	if ((p.x - cx) * (p.x - cx) + (p.z - cz) * (p.z - cz) < K.landingPlayerClear * K.landingPlayerClear) return "clear";
	for (const o of pyresOf(s, x.keeper))
		if ((o.x - cx) * (o.x - cx) + (o.z - cz) * (o.z - cz) < K.landingPyreClear * K.landingPyreClear) return "clear";
	return undefined;
}

describe("Pyre-keeper on endless floors", () => {
	it("census: every landing is the first valid compass point from the drawn start; no pyre on a bad cell", () => {
		const reasons = new Map<Reason, number>();
		let casts = 0;
		let spent = 0;
		for (const seed of [4242, 101, 202, 303]) {
			const x = keepRun(seed);
			const ctx = new SimCtx();
			// Candidate player cells: the room's FLOOR cells 3-10 from the keeper's home.
			const hx = x.keeper.v[V_HOME_X];
			const hz = x.keeper.v[V_HOME_Z];
			const cells: [number, number][] = [];
			const d = x.world.dungeon;
			for (let gz = 0; gz < d.H; gz++)
				for (let gx = 0; gx < d.W; gx++) {
					if (tileAt(d, gx, gz) !== TileType.FLOOR || d.roomId[gz * d.W + gx] !== x.room.id) continue;
					const cx = gridToWorld(gx);
					const cz = gridToWorld(gz);
					const d2 = (cx - hx) * (cx - hx) + (cz - hz) * (cz - hz);
					if (d2 >= 9 && d2 <= 100) cells.push([cx, cz]);
				}
			expect(cells.size() > 10).toBe(true);
			const pick = new Rng(seed);
			for (let trial = 0; trial < 40; trial++) {
				const [px, pz] = cells[pick.int(0, cells.size() - 1)];
				teleport(x.s, 0, px, pz);
				const k = x.keeper;
				k.x = hx;
				k.z = hz;
				k.prevX = hx;
				k.prevZ = hz;
				engage(k);
				const live = pyresOf(x.s, k);
				if (live.size() === K.maxAlive) ctx.bind(x.s, x.config, EMPTY_INPUT).killActor(live[0]);
				k.v[PYREKEEPER_LIT] = 0;
				k.cooldown = 0;
				k.aiTicks = 1e6;
				const before = x.s.rngState;
				const probe = new Rng(0);
				probe.setState(before);
				probe.next();
				const start = probe.int(0, K.landingOffsets.size() - 1);
				// The oracle's answer, judged on the state the decision sees (no input: nobody moves before the actors).
				let want: [number, number] | undefined;
				const p = playerAt(x.s, 0);
				for (let j = 0; j < K.landingOffsets.size() && want === undefined; j++) {
					const o = K.landingOffsets[(start + j) % K.landingOffsets.size()];
					const gx = worldToGrid(p.x + o[0] * K.landingDistance);
					const gz = worldToGrid(p.z + o[1] * K.landingDistance);
					const r = why(x, gx, gz);
					if (r === undefined) want = [gx, gz];
					else reasons.set(r, (reasons.get(r) ?? 0) + 1);
				}
				tick(x);
				expect(x.s.rngState).toBe(advanced(before, 2));
				if (want === undefined) {
					expect(k.aiState === AiState.TELEGRAPH).toBe(false);
					spent++;
					continue;
				}
				expect([k.aiState, k.attack]).toEqual([AiState.TELEGRAPH, PYREKEEPER_ATTACK_LIGHT]);
				expect([k.v[PYREKEEPER_LAND_X], k.v[PYREKEEPER_LAND_Z]]).toEqual([
					gridToWorld(want[0]),
					gridToWorld(want[1]),
				]);
				k.aiTicks = 1;
				const ids = new Set(pyresOf(x.s, k).map((o) => o.id));
				tick(x);
				const fresh = pyresOf(x.s, k).filter((o) => !ids.has(o.id));
				expect(fresh.size()).toBe(1);
				expect([fresh[0].x, fresh[0].z]).toEqual([gridToWorld(want[0]), gridToWorld(want[1])]);
				casts++;
			}
		}
		print(
			`[pyrekeeper census] casts ${casts}, spent ${spent}, rejected: tile ${reasons.get("tile") ?? 0}, piece ${
				reasons.get("piece") ?? 0
			}, pellet ${reasons.get("pellet") ?? 0}, room ${reasons.get("room") ?? 0}, clear ${
				reasons.get("clear") ?? 0
			}`,
		);
		expect(casts > 100).toBe(true);
		// The rules that matter on real floors were exercised.
		expect((reasons.get("tile") ?? 0) > 0).toBe(true);
		expect((reasons.get("pellet") ?? 0) > 0).toBe(true);
		expect((reasons.get("clear") ?? 0) > 0).toBe(true);
		expect((reasons.get("room") ?? 0) > 0).toBe(true);
	});

	it("pyres are never members: the room clears with a pyre alive; the keeper's own wither at its death", () => {
		const x = keepRun(4242);
		const ctx = new SimCtx();
		const k = x.keeper;
		const rec = x.s.score!.rooms.find((r) => r.room === x.room.id)!;
		let tries = 0;
		while (pyresOf(x.s, k).size() < 2 && tries++ < 20) forceLight(x, k);
		const mine = pyresOf(x.s, k);
		expect(mine.size()).toBe(2);
		// A keeperless pyre in the room (no keeper id: nothing withers it).
		const stray = ctx.bind(x.s, x.config, EMPTY_INPUT).spawnActor(PYRE.id, k.v[V_HOME_X], k.v[V_HOME_Z])!;
		for (const o of [...mine, stray]) expect(rec.memberIds.includes(o.id)).toBe(false);
		expect(x.s.affixes!.slots[x.s.combat.actors.indexOf(stray)].affix).toBe(AffixKind.NONE);
		ctx.bind(x.s, x.config, EMPTY_INPUT).killActor(x.dummy);
		tick(x);
		expect(rec.cleared).toBe(0); // the keeper holds it open
		const kills0 = x.s.score!.counts[ScoreSource.KILLS];
		ctx.bind(x.s, x.config, EMPTY_INPUT).killActor(k);
		expect(x.s.events.pyresWithered).toBe(2);
		for (const o of mine) expect(o.alive).toBe(0);
		expect(x.s.score!.counts[ScoreSource.KILLS]).toBe(kills0 + 3); // the keeper and its two pyres
		tick(x);
		expect(rec.cleared).toBe(1);
		expect(stray.alive).toBe(1);
	});

	it("killing a pyre scores a kill and rolls no drop (no pity count either); runtime pyres carry no affix", () => {
		const x = keepRun(4242);
		const ctx = new SimCtx();
		const p = forceLight(x, x.keeper) ?? forceLight(x, x.keeper);
		expect(p !== undefined).toBe(true);
		expect(x.s.affixes!.slots[x.s.combat.actors.indexOf(p!)].affix).toBe(AffixKind.NONE);
		const drops = x.s.drops!;
		const since = drops.killsSinceDrop;
		const ground = drops.ground.filter((g) => g.ticksLeft > 0).size();
		const kills0 = x.s.score!.counts[ScoreSource.KILLS];
		const points0 = x.s.score!.points[ScoreSource.KILLS];
		ctx.bind(x.s, x.config, EMPTY_INPUT).killActor(p!);
		expect(x.s.score!.counts[ScoreSource.KILLS]).toBe(kills0 + 1);
		expect(x.s.score!.points[ScoreSource.KILLS] > points0).toBe(true);
		expect(drops.killsSinceDrop).toBe(since);
		expect(drops.ground.filter((g) => g.ticksLeft > 0).size()).toBe(ground);
	});

	it("two runs with casts, fire and a keeper kill hash the same every tick", () => {
		function play(): string[] {
			const x = keepRun(4242);
			const out: string[] = [];
			let landed = 0;
			for (let t = 0; t < 900; t++) {
				const input: InputFrame = {
					moveX: t % 240 < 120 ? 1 : -1,
					moveZ: 0,
					aimX: 0,
					aimZ: 1000,
					buttons: 0,
				};
				playerAt(x.s, 0).hearts = playerAt(x.s, 0).heartsMax;
				step(x.s, input, x.config);
				landed += x.s.events.pyresLanded;
				if (t === 700) new SimCtx().bind(x.s, x.config, EMPTY_INPUT).killActor(x.keeper);
				out.push(hashState(x.s));
			}
			expect(landed > 0).toBe(true);
			return out;
		}
		expect(play()).toEqual(play());
	});
});
