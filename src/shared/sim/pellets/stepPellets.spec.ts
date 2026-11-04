// Pellets in the tick (docs/PELLETS.md PL3 / PL4): a room's pellets lie dormant until its score record engages, go
// live on that tick, are taken by the first living player (index order) within the pickup radius, pay scorePellet
// (never feeding the combo), and are gone at the clear, where a room whose every regular pellet was taken (this tick's
// pickups included) pays its Sweep first. The power pellet erases every enemy bullet but goo and strikes and pays per
// bullet up to the cap. Endless worlds set PELLETS_CONFIG (PL5). Test-only surgery: teleports, kills through SimCtx,
// bullets fired straight into the pool, hearts topped up.
import { describe, expect, it } from "@rbxts/jest-globals";
import "shared/sim/testing";
import { NO_POWER_PELLET } from "shared/dungeon";
import {
	AXIS_MAX,
	BulletKind,
	BulletPayload,
	Button,
	DEBUG_FLOOR_BUTTON,
	EMPTY_INPUT,
	NO_KIND,
	PELLETS_CONFIG,
	PELLETS_SUBSYSTEM,
	PelletPhase,
	SCORE_SUBSYSTEM,
	ScoreSource,
	SimCtx,
	cloneSimState,
	createSimState,
	fireBurstRaw,
	hashLayout,
	hashState,
	killPlayerState,
	packPayload,
	partySize,
	pelletsPower,
	playerAt,
	simWorldConfig,
	step,
	stepParty,
	stepPellets,
	type ActorState,
	type InputFrame,
	type SimConfig,
	type SimState,
} from "shared/sim";
import { buildDevRunConfig, buildEndlessRunConfig } from "shared/run";

const SEED = 4242;

interface Run {
	readonly config: SimConfig;
	readonly s: SimState;
}

/** God-mode endless run of SEED from `floor` (dev world: pellets from PELLETS_CONFIG, no deaths). */
function devRun(floor = 1): Run {
	const dev = buildDevRunConfig(SEED, { startFloor: floor, invulnerable: true });
	return { config: dev.config, s: createSimState(SEED, dev.spawn!.x, dev.spawn!.z, dev.config) };
}

/** A co-op endless run of SEED (hearts topped up by tickAll). */
function partyRun(n: number): Run {
	const setup = buildEndlessRunConfig(SEED, n);
	return { config: setup.config, s: createSimState(SEED, setup.spawn!.x, setup.spawn!.z, setup.config) };
}

function tickAll(r: Run, input: InputFrame = EMPTY_INPUT): void {
	const n = partySize(r.s);
	for (let i = 0; i < n; i++) {
		const p = playerAt(r.s, i);
		if (p.dead === 0) p.hearts = p.heartsMax;
	}
	if (r.s.party === undefined) step(r.s, input, r.config);
	else {
		const frames: InputFrame[] = [];
		for (let i = 0; i < n; i++) frames.push(i === 0 ? input : EMPTY_INPUT);
		stepParty(r.s, frames, r.config);
	}
}

/** The first score record with at least `min` regular pellets (and no power pellet unless `power`). */
function recordWith(s: SimState, min: number, power = false): number {
	const p = s.pellets!;
	for (let k = 0; k < p.rooms.size(); k++) {
		const r = p.rooms[k];
		const hasPower = p.power !== NO_POWER_PELLET && p.rec[p.power] === k;
		if (r.count >= min && hasPower === power) return k;
	}
	error(`no record with ${min} pellets (power ${power})`, 0);
}

/** Pellet indices of record k, the power pellet left out. */
function regular(s: SimState, k: number): number[] {
	const p = s.pellets!;
	const r = p.rooms[k];
	const out: number[] = [];
	for (let i = r.first; i < r.first + r.span; i++) if (i !== p.power) out.push(i);
	return out;
}

function place(s: SimState, x: number, z: number, i = 0): void {
	const p = playerAt(s, i);
	p.x = x;
	p.z = z;
}

/** Teleports player 0 onto pellet `at` of record k and steps once: the record engages, its pellets go live. */
function engage(r: Run, k: number, at: number): void {
	const p = r.s.pellets!;
	place(r.s, p.x[at], p.z[at]);
	tickAll(r);
	expect(p.rooms[k].phase).toBe(PelletPhase.LIVE);
}

/** Every live member of record k, killed through SimCtx (scores as a kill, like a sword blow). */
function killRoom(r: Run, k: number): void {
	const rec = r.s.score!.rooms[k];
	const ctx = new SimCtx().bind(r.s, simWorldConfig(r.s, r.config), EMPTY_INPUT);
	for (let m = 0; m < rec.memberSlots.size(); m++) {
		const a: ActorState | undefined = r.s.combat.actors[rec.memberSlots[m]];
		if (a !== undefined && a.kind !== NO_KIND && a.id === rec.memberIds[m] && a.alive !== 0) ctx.killActor(a);
	}
}

/** Takes pellets `list` one per tick by standing on each (record k live). */
function takeAll(r: Run, list: ReadonlyArray<number>): void {
	const p = r.s.pellets!;
	for (const i of list) {
		place(r.s, p.x[i], p.z[i]);
		tickAll(r);
		expect(p.taken[i]).toBe(1);
	}
}

/** True when the run's mover carries player 0 from (x, z) by (dx, dz) unblocked (0.1-unit steps). */
function clearPath(r: Run, x: number, z: number, dx: number, dz: number): boolean {
	const move = simWorldConfig(r.s, r.config).moveResolver!;
	const steps = 20;
	let px = x;
	let pz = z;
	for (let n = 0; n < steps; n++) {
		const at = move(px, pz, dx / steps, dz / steps);
		px = at.x;
		pz = at.z;
	}
	return math.abs(px - (x + dx)) < 1e-6 && math.abs(pz - (z + dz)) < 1e-6;
}

/** Two pellets of `list` 2 tiles apart along an axis with an open path between: [i, j, ux, uz], j = i + 2 (ux, uz). */
function pairIn(r: Run, list: ReadonlyArray<number>): [number, number, number, number] {
	const p = r.s.pellets!;
	for (const i of list) {
		for (const j of list) {
			const dx = p.x[j] - p.x[i];
			const dz = p.z[j] - p.z[i];
			const axis = (math.abs(dx) === 2 && dz === 0) || (math.abs(dz) === 2 && dx === 0);
			if (axis && clearPath(r, p.x[i], p.z[i], dx, dz)) return [i, j, dx / 2, dz / 2];
		}
	}
	error("no pellet pair 2 tiles apart", 0);
}

/** The first floor of SEED (2..20) whose pellets hold a power pellet. */
function powerFloor(): number {
	const setup = buildEndlessRunConfig(SEED);
	for (let f = 2; f <= 20; f++) if (setup.endlessFloor(f).pellets!.power !== NO_POWER_PELLET) return f;
	error("no power pellet on floors 2-20", 0);
}

/** `n` enemy bullets of `kind`, near-stationary, at (x, z) + i x 0.01. */
function fireEnemy(s: SimState, n: number, kind: number, x: number, z: number): void {
	const c = s.combat;
	for (let i = 0; i < n; i++) {
		const spawned = fireBurstRaw(
			c.enemyBullets,
			1,
			x + i * 0.01,
			z,
			1,
			0,
			1,
			0,
			0.001,
			600,
			packPayload(1, kind, 0),
		);
		expect(spawned).toBe(1);
	}
}

function activeEnemyBullets(s: SimState): number[] {
	const kinds: number[] = [];
	s.combat.enemyBullets.forEachActive((_i, _pos, payload) => {
		kinds.push(BulletPayload.get(payload, "kind"));
	});
	return kinds;
}

describe("pellets: dormant, live, pickup", () => {
	it("dormant before engagement: standing on a pellet of an unengaged room takes nothing", () => {
		const r = devRun();
		const k = recordWith(r.s, 8);
		const i = regular(r.s, k)[0];
		const p = r.s.pellets!;
		place(r.s, p.x[i], p.z[i]);
		stepPellets(r.s);
		expect([p.taken[i], p.rooms[k].left, p.events.eaten.size()]).toEqual([0, p.rooms[k].count, 0]);
	});

	it("live on the engagement tick (events.live), taken from the next tick (events.eaten, scorePellet)", () => {
		const r = devRun();
		const k = recordWith(r.s, 8);
		const i = regular(r.s, k)[0];
		const p = r.s.pellets!;
		const sc = r.s.score!;
		place(r.s, p.x[i], p.z[i]);
		tickAll(r);
		// Entering engaged the record (attachScoreRoomMembers); stepPellets ran before stepScore turned it live.
		expect(sc.rooms[k].engageTick).toBe(r.s.tick - 1);
		expect([p.rooms[k].phase, p.events.live, p.taken[i]]).toEqual([PelletPhase.LIVE, [k], 0]);
		const total = sc.total;
		tickAll(r);
		expect(p.taken[i]).toBe(1);
		expect(p.rooms[k].left).toBe(p.rooms[k].count - 1);
		expect(p.events.live.size()).toBe(0);
		expect(p.events.eaten.size()).toBe(1);
		const e = p.events.eaten[0];
		expect([e.index, e.x, e.z, e.player]).toEqual([i, p.x[i], p.z[i], 0]);
		expect(e.points > 0).toBe(true);
		expect([sc.points[ScoreSource.PELLETS], sc.counts[ScoreSource.PELLETS]]).toEqual([e.points, 1]);
		expect(sc.total - total >= e.points).toBe(true);
		// Taken once: standing on it pays nothing more.
		tickAll(r);
		expect([p.events.eaten.size(), sc.counts[ScoreSource.PELLETS]]).toEqual([0, 1]);
	});

	it("pickup radius edges: just inside takes, just outside does not (all four sides)", () => {
		const r = devRun();
		const k = recordWith(r.s, 8);
		const list = regular(r.s, k);
		engage(r, k, list[0]);
		const p = r.s.pellets!;
		const reach = PELLETS_CONFIG.pickupRadius;
		const eps = 1e-6;
		const sides: Array<[number, number]> = [
			[1, 0],
			[-1, 0],
			[0, 1],
			[0, -1],
		];
		for (let s = 0; s < sides.size(); s++) {
			const i = list[1 + s];
			const [ux, uz] = sides[s];
			place(r.s, p.x[i] + ux * (reach + eps), p.z[i] + uz * (reach + eps));
			stepPellets(r.s);
			expect(p.taken[i]).toBe(0);
			place(r.s, p.x[i] + ux * (reach - eps), p.z[i] + uz * (reach - eps));
			stepPellets(r.s);
			expect(p.taken[i]).toBe(1);
		}
		// A diagonal neighbour cell's pellet is never in reach from this cell's centre.
		expect(reach < 1).toBe(true);
	});

	it("a roll collects: rolling across a pellet takes it (mid-roll)", () => {
		const r = devRun();
		const k = recordWith(r.s, 8);
		const list = regular(r.s, k);
		const [i, j, ux, uz] = pairIn(r, list);
		engage(r, k, list[0] === i ? list[1] : list[0]);
		const p = r.s.pellets!;
		place(r.s, p.x[i], p.z[i]);
		const pl = r.s.player;
		const roll = { ...EMPTY_INPUT, moveX: ux * AXIS_MAX, moveZ: uz * AXIS_MAX };
		tickAll(r, { ...roll, buttons: Button.ROLL });
		expect(pl.rollTicks > 0).toBe(true);
		let n = 0;
		while (p.taken[j] === 0 && n < 20) {
			tickAll(r, roll);
			n++;
		}
		expect(p.taken[j]).toBe(1);
		expect(pl.rollTicks > 0).toBe(true);
	});

	it("a dead player takes nothing; co-op: the first living player in index order takes it", () => {
		const r = partyRun(2);
		const k = recordWith(r.s, 8);
		const list = regular(r.s, k);
		engage(r, k, list[0]);
		const p = r.s.pellets!;
		// Both in reach of the same pellet: player 0 takes it.
		const a = list[1];
		place(r.s, p.x[a], p.z[a], 0);
		place(r.s, p.x[a] + 0.2, p.z[a], 1);
		stepPellets(r.s);
		expect(p.events.eaten.map((e) => [e.index, e.player])).toEqual([[a, 0]]);
		// Player 0 dead: player 1 takes the next one.
		p.events.eaten.clear();
		const b = list[2];
		killPlayerState(playerAt(r.s, 0));
		place(r.s, p.x[b], p.z[b], 0);
		stepPellets(r.s);
		expect(p.taken[b]).toBe(0);
		place(r.s, p.x[b] - 0.2, p.z[b], 1);
		stepPellets(r.s);
		expect(p.events.eaten.map((e) => [e.index, e.player])).toEqual([[b, 1]]);
	});

	it("several pellets in reach on one tick: taken in index order", () => {
		// A radius over half a tile (still under the 3 x 3 lookup's 1.5) reaches two pellets 2 tiles apart from the
		// cell between them.
		const dev = buildDevRunConfig(SEED, { startFloor: 1, invulnerable: true });
		const config: SimConfig = { ...dev.config, pellets: { ...PELLETS_CONFIG, pickupRadius: 1.2 } };
		const r: Run = { config, s: createSimState(SEED, dev.spawn!.x, dev.spawn!.z, config) };
		const k = recordWith(r.s, 8);
		const list = regular(r.s, k);
		const [i, j, ux, uz] = pairIn(r, list);
		const p = r.s.pellets!;
		const other = list.find((x) => x !== i && x !== j)!;
		engage(r, k, other);
		place(r.s, p.x[i] + ux, p.z[i] + uz);
		const left = p.rooms[k].left;
		stepPellets(r.s);
		const idx = p.events.eaten.map((e) => e.index);
		expect(idx.includes(i) && idx.includes(j)).toBe(true);
		for (let n = 1; n < idx.size(); n++) expect(idx[n] > idx[n - 1]).toBe(true);
		expect(p.rooms[k].left).toBe(left - idx.size());
	});
});

describe("pellets: the clear, the Sweep", () => {
	it("a pickup on the clear tick counts for the Sweep; the Sweep pays before the room awards; then gone", () => {
		const r = devRun();
		const k = recordWith(r.s, 8);
		const list = regular(r.s, k);
		const p = r.s.pellets!;
		const sc = r.s.score!;
		engage(r, k, list[0]);
		const last = list[list.size() - 1];
		const rest: number[] = [];
		for (let j = 0; j < list.size() - 1; j++) rest.push(list[j]);
		takeAll(r, rest);
		expect(p.rooms[k].left).toBe(1);
		// The last pellet and the last kill on one tick.
		killRoom(r, k);
		place(r.s, p.x[last], p.z[last]);
		const combo = sc.combo;
		tickAll(r);
		expect(p.taken[last]).toBe(1);
		expect(sc.rooms[k].cleared).toBe(1);
		expect([p.rooms[k].left, p.rooms[k].swept, p.rooms[k].phase]).toEqual([0, 1, PelletPhase.GONE]);
		expect([p.events.swept, p.events.gone]).toEqual([[k], [k]]);
		expect(sc.counts[ScoreSource.SWEEP]).toBe(1);
		expect(sc.points[ScoreSource.SWEEP] > 0).toBe(true);
		// The Sweep never fed the combo (the kills before this tick did).
		expect(sc.combo).toBe(combo);
	});

	it("gone at the clear: leftovers stay untaken; no Sweep with one pellet left", () => {
		const r = devRun();
		const k = recordWith(r.s, 8);
		const list = regular(r.s, k);
		const p = r.s.pellets!;
		const sc = r.s.score!;
		engage(r, k, list[0]);
		killRoom(r, k);
		tickAll(r);
		expect([p.rooms[k].phase, p.rooms[k].swept, p.events.gone, p.events.swept]).toEqual([
			PelletPhase.GONE,
			0,
			[k],
			[],
		]);
		expect(sc.counts[ScoreSource.SWEEP]).toBe(0);
		const left = list[list.size() - 1];
		place(r.s, p.x[left], p.z[left]);
		tickAll(r);
		expect([p.taken[left], p.events.eaten.size(), p.events.gone.size()]).toEqual([0, 0, 0]);
	});

	it("no Sweep for a room with all but one taken", () => {
		const r = devRun();
		const k = recordWith(r.s, 8);
		const list = regular(r.s, k);
		const p = r.s.pellets!;
		engage(r, k, list[0]);
		const rest: number[] = [];
		for (let j = 0; j < list.size() - 1; j++) rest.push(list[j]);
		takeAll(r, rest);
		killRoom(r, k);
		tickAll(r);
		expect([p.rooms[k].left, p.rooms[k].swept, p.rooms[k].phase]).toEqual([1, 0, PelletPhase.GONE]);
		expect(r.s.score!.counts[ScoreSource.SWEEP]).toBe(0);
	});

	it("the combo and its timer are untouched by every pellet award", () => {
		const r = devRun();
		const k = recordWith(r.s, 8);
		const list = regular(r.s, k);
		const p = r.s.pellets!;
		const sc = r.s.score!;
		engage(r, k, list[0]);
		sc.combo = 23;
		sc.comboTimer = 77;
		place(r.s, p.x[list[1]], p.z[list[1]]);
		tickAll(r);
		expect(p.taken[list[1]]).toBe(1);
		expect(r.s.events.enemiesKilled).toBe(0);
		expect([sc.combo, sc.comboTimer, sc.events.comboFed]).toEqual([23, 76, 0]);
	});

	it("a floor change resets the pellets (next floor, dormant, untaken)", () => {
		const r = devRun();
		const k = recordWith(r.s, 8);
		const list = regular(r.s, k);
		engage(r, k, list[0]);
		takeAll(r, [list[1]]);
		tickAll(r, { ...EMPTY_INPUT, buttons: DEBUG_FLOOR_BUTTON });
		expect(r.s.endless!.floor).toBe(2);
		const p = r.s.pellets!;
		for (const t of p.taken) expect(t).toBe(0);
		for (const room of p.rooms)
			expect([room.phase, room.left, room.swept]).toEqual([PelletPhase.DORMANT, room.count, 0]);
	});
});

describe("pellets: determinism", () => {
	it("pickups move only the score and pellets groups: the rng and every other group match a run without pellets", () => {
		// Both without pacts (docs/FORTUNE.md PS5: their group follows this one; nobody takes a pact here anyway).
		const dev = devRun();
		const withPellets: SimConfig = { ...dev.config, pacts: undefined };
		const a: Run = { config: withPellets, s: createSimState(SEED, dev.s.player.x, dev.s.player.z, withPellets) };
		const b: Run = {
			config: { ...withPellets, pellets: undefined },
			s: createSimState(SEED, a.s.player.x, a.s.player.z, { ...withPellets, pellets: undefined }),
		};
		const k = recordWith(a.s, 8);
		const list = regular(a.s, k);
		const p = a.s.pellets!;
		for (const i of list) {
			place(a.s, p.x[i], p.z[i]);
			place(b.s, p.x[i], p.z[i]);
			tickAll(a);
			tickAll(b);
		}
		expect(p.rooms[k].left).toBe(1); // the first stand engaged the room
		expect(a.s.rngState).toBe(b.s.rngState);
		const la = hashLayout(a.s);
		const lb = hashLayout(b.s);
		for (let g = 0; g < lb.groups.size(); g++) {
			const gb = lb.groups[g];
			if (gb.name === SCORE_SUBSYSTEM) continue;
			// By name: the Goldling's group (docs/FORTUNE.md GE3) follows pellets in `a` and takes their index in `b`.
			const ga = la.groups.find((x) => x.name === gb.name)!;
			const va: number[] = [];
			const vb: number[] = [];
			for (let i = ga.start; i < ga.finish; i++) va.push(la.values[i]);
			for (let i = gb.start; i < gb.finish; i++) vb.push(lb.values[i]);
			expect([ga.name, ...va]).toEqual([gb.name, ...vb]);
		}
		expect(la.groups.size()).toBe(lb.groups.size() + 1);
		expect(la.groups.map((x) => x.name).includes(PELLETS_SUBSYSTEM)).toBe(true);
		const sa = a.s.score!;
		const sb = b.s.score!;
		expect([sa.combo, sa.comboTimer]).toEqual([sb.combo, sb.comboTimer]);
		expect(sa.total).toBe(sb.total + sa.points[ScoreSource.PELLETS] + sa.points[ScoreSource.SWEEP]);
	});

	it("a clone stepped with the same inputs keeps the same hash through pickups and a clear", () => {
		const r = devRun();
		const k = recordWith(r.s, 8);
		const list = regular(r.s, k);
		const p = r.s.pellets!;
		const c: Run = { config: r.config, s: cloneSimState(r.s) };
		for (let j = 0; j < 4; j++) {
			for (const run of [r, c]) {
				place(run.s, p.x[list[j]], p.z[list[j]]);
				tickAll(run);
			}
			expect(hashState(c.s)).toBe(hashState(r.s));
		}
		killRoom(r, k);
		killRoom(c, k);
		tickAll(r);
		tickAll(c);
		expect(hashState(c.s)).toBe(hashState(r.s));
		expect(c.s.pellets!.rooms[k].phase).toBe(PelletPhase.GONE);
	});
});

describe("pellets: the power pellet (PL4)", () => {
	const FLOOR = powerFloor();

	/** A dev run on the power floor with the power pellet's record live. */
	function powerRun(): { r: Run; k: number } {
		const r = devRun(FLOOR);
		const p = r.s.pellets!;
		expect(p.power).never.toBe(NO_POWER_PELLET);
		const k = p.rec[p.power];
		const list = regular(r.s, k);
		engage(r, k, list[0]);
		// Only the bullets each spec fires: whatever the room's enemies fired on the engage tick goes.
		r.s.combat.enemyBullets.clear();
		return { r, k };
	}

	it("erases every enemy bullet but goo and strikes, pays one award per bullet, once; left and the Sweep untouched", () => {
		const { r, k } = powerRun();
		const p = r.s.pellets!;
		const sc = r.s.score!;
		fireEnemy(r.s, 5, BulletKind.ENEMY, p.x[p.power] + 5, p.z[p.power]);
		fireEnemy(r.s, 3, BulletKind.SNIPER, p.x[p.power] - 5, p.z[p.power]);
		fireEnemy(r.s, 2, BulletKind.GOO, p.x[p.power], p.z[p.power] + 5);
		fireEnemy(r.s, 2, BulletKind.STRIKE, p.x[p.power], p.z[p.power] - 5);
		const left = p.rooms[k].left;
		const kills = sc.counts[ScoreSource.KILLS];
		place(r.s, p.x[p.power], p.z[p.power]);
		stepPellets(r.s);
		expect(p.taken[p.power]).toBe(1);
		expect(p.rooms[k].left).toBe(left);
		const ev = p.events.power!;
		expect(ev.player).toBe(0);
		expect([ev.x.size(), ev.z.size()]).toEqual([8, 8]);
		expect(r.s.events.bulletsDeleted).toBe(8);
		expect(sc.counts[ScoreSource.PELLETS]).toBe(8);
		expect(ev.points).toBe(sc.points[ScoreSource.PELLETS]);
		expect(ev.points > 0).toBe(true);
		expect(sc.counts[ScoreSource.KILLS]).toBe(kills);
		expect(p.events.eaten.size()).toBe(0);
		const rest = activeEnemyBullets(r.s);
		table.sort(rest);
		const want = [BulletKind.GOO, BulletKind.GOO, BulletKind.STRIKE, BulletKind.STRIKE];
		table.sort(want);
		expect(rest).toEqual(want);
		// Once: standing on it again does nothing.
		p.events.power = undefined;
		fireEnemy(r.s, 2, BulletKind.ENEMY, p.x[p.power] + 5, p.z[p.power]);
		stepPellets(r.s);
		expect(p.events.power).toBe(undefined);
		expect(sc.counts[ScoreSource.PELLETS]).toBe(8);
	});

	it("the cap: more than powerMaxBullets bullets are all erased, powerMaxBullets paid", () => {
		const { r } = powerRun();
		const p = r.s.pellets!;
		const cap = PELLETS_CONFIG.powerMaxBullets;
		fireEnemy(r.s, cap + 20, BulletKind.ENEMY, p.x[p.power] + 3, p.z[p.power]);
		place(r.s, p.x[p.power], p.z[p.power]);
		stepPellets(r.s);
		expect(p.events.power!.x.size()).toBe(cap + 20);
		expect(r.s.score!.counts[ScoreSource.PELLETS]).toBe(cap);
		expect(activeEnemyBullets(r.s).size()).toBe(0);
	});

	it("an empty pool pays nothing (the pellet is still taken, the event still fires)", () => {
		const { r } = powerRun();
		const p = r.s.pellets!;
		const total = r.s.score!.total;
		expect(pelletsPower(r.s, 0)).toBe(0);
		expect(p.events.power).toEqual({ player: 0, x: [], z: [], points: 0 });
		expect(r.s.score!.total).toBe(total);
	});

	it("not needed for the Sweep: every regular pellet taken, the power pellet left, the clear pays the Sweep", () => {
		const { r, k } = powerRun();
		const p = r.s.pellets!;
		const list = regular(r.s, k);
		const rest: number[] = [];
		for (let j = 0; j < list.size() - 1; j++) rest.push(list[j]);
		takeAll(r, rest);
		expect([p.rooms[k].left, p.taken[p.power]]).toEqual([1, 0]);
		killRoom(r, k);
		const last = list[list.size() - 1];
		place(r.s, p.x[last], p.z[last]);
		tickAll(r);
		expect([p.rooms[k].swept, p.rooms[k].phase, p.taken[p.power]]).toEqual([1, PelletPhase.GONE, 0]);
		expect(r.s.score!.counts[ScoreSource.SWEEP]).toBe(1);
	});
});
