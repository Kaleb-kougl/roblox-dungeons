// The Mender (docs/NEW_ENEMIES_3.md NT3): the pick (the most wounded heal target by hp / hpMax, cross-multiplied, ties
// by slot order, within healRange and in sight; NTD8: never a boss, the Goldling, the dummy, a pyre or another Mender),
// the link and the channel (+1 hp every 30 ticks through healActor, never above hpMax), every end rule (the ally full or
// dead, sight lost, a body on the beam (a teammate too), a hit on the Mender then a 0.4 s flinch, the 3 s up), the bolt
// (BulletKind.CASTER, only with no wounded ally and its target in sight within 9), the draws (one in init, one per
// channel end but its death, one per bolt; checked tick by tick in every scenario), that a heal never reaches score,
// combo, the damage cap, the hit flash, builds or drops (a healed ally pays its kill points once), and determinism on
// real endless floors (solo and a party of two, every tick hashed twice).
import { describe, expect, it } from "@rbxts/jest-globals";
import { TileType, tileAt, worldToGrid } from "shared/dungeon";
import { endlessRunFloor, type EndlessRunFloor } from "shared/run";
import {
	AFFIXES_CONFIG,
	AXIS_MAX,
	AiState,
	BOSS_ACT1_ID,
	BOSS_DEMONLORD_ID,
	BRUISER,
	BUILDS_CONFIG,
	BulletKind,
	BulletPayload,
	COMBO_MIN,
	DEFAULT_BOUNDS,
	DEFAULT_SIM_CONFIG,
	DROPS_CONFIG,
	DUMMY_KIND,
	EMPTY_INPUT,
	GOLDEN_KIND,
	HealEnd,
	MENDER,
	MENDER_ALLY,
	MENDER_ATTACK_BOLT,
	MENDER_ATTACK_HEAL,
	MENDER_CHANNEL,
	MENDER_FLINCH,
	MENDER_HEALED,
	MENDER_KEEP,
	MENDER_PULSE,
	NO_KIND,
	PLAYER_RADIUS,
	Rng,
	ScoreSource,
	SimCtx,
	archetypeAt,
	archetypeIds,
	archetypeIndex,
	createSimState,
	engage,
	hashState,
	healActor,
	healEndCuts,
	isMenderHealTarget,
	isRoomEnemyData,
	menderBeamBlocker,
	menderPick,
	partySize,
	playerAt,
	spawnActor,
	step,
	stepParty,
	type ActorState,
	type EndlessFloorWorld,
	type InputFrame,
	type SimConfig,
	type SimState,
} from "shared/sim";

const D = MENDER.data;
const KIND = archetypeIndex(MENDER.id);
const BRUISER_KIND = archetypeIndex(BRUISER.id);

/** The rng word after exactly `n` draws from `from`. */
function after(from: number, n: number): number {
	const r = new Rng(0);
	r.setState(from);
	for (let i = 0; i < n; i++) r.next();
	return r.getState();
}

function put(s: SimState, i: number, x: number, z: number): void {
	const p = playerAt(s, i);
	p.x = x;
	p.z = z;
	p.prevX = x;
	p.prevZ = z;
}

/** Every player can't be hurt (bullets pass through); the run never ends. */
function ghost(s: SimState): void {
	for (let i = 0; i < partySize(s); i++) playerAt(s, i).hurtTicks = 1e6;
}

interface World {
	s: SimState;
	config: SimConfig;
	mender: ActorState;
	/** Actors held still (never stepped: spawnTick = this tick before every step). */
	frozen: ActorState[];
}

function ctxOf(w: World): SimCtx {
	return new SimCtx().bind(w.s, w.config, EMPTY_INPUT);
}

/**
 * The Mender at (mx, mz), engaged, its cooldown out and the pick due (it acts on the first tick); the player(s) at
 * the origin (ghosts). The first spawn takes slot 0, so the Mender steps before anything spawned after it.
 */
function world(mx = 0, mz = 6, extra: Partial<SimConfig> = {}, party = 1): World {
	const config: SimConfig = {
		...DEFAULT_SIM_CONFIG,
		party: party > 1 ? { size: party } : undefined,
		...extra,
	};
	const s = createSimState(5, 0, 0, config);
	for (let i = 0; i < party; i++) put(s, i, 0, 0);
	ghost(s);
	const w: World = { s, config, mender: undefined as unknown as ActorState, frozen: [] };
	const a = spawnActor(ctxOf(w), KIND, mx, mz)!;
	a.spawnTick = -1;
	engage(a);
	a.cooldown = 0;
	a.v[MENDER_PULSE] = 0;
	w.mender = a;
	return w;
}

/** A frozen ally of `id` at (x, z) with `hp` of its hpMax. */
function ally(w: World, id: string, x: number, z: number, hp?: number): ActorState {
	const o = spawnActor(ctxOf(w), archetypeIndex(id), x, z)!;
	if (hp !== undefined) o.hp = hp;
	w.frozen.push(o);
	return o;
}

const boltStart = (a: Readonly<ActorState>): boolean =>
	a.alive === 1 &&
	a.aiState === AiState.TELEGRAPH &&
	a.attack === MENDER_ATTACK_BOLT &&
	a.aiTicks === D.boltWindupTicks;
const linking = (a: Readonly<ActorState>): boolean =>
	a.alive === 1 && a.aiState === AiState.TELEGRAPH && a.attack === MENDER_ATTACK_HEAL;

interface Tally {
	ticks: number;
	heals: number[];
	healSlots: number[];
	ends: number[];
	cuts: number;
	bolts: number;
	boltTicks: number[];
	draws: number;
}

function tally(): Tally {
	return { ticks: 0, heals: [], healSlots: [], ends: [], cuts: 0, bolts: 0, boltTicks: [], draws: 0 };
}

/**
 * One tick (party: every player idle unless `inputs`), asserting the draw rule: the rng moved by exactly one draw per
 * channel end (but the death) plus one per bolt start, and nothing else (the frozen allies and the players never draw).
 * Also: the feed agrees with the counters, and no actor is ever above its hpMax.
 */
function tick(w: World, t: Tally, inputs?: InputFrame[]): void {
	const s = w.s;
	for (const o of w.frozen) o.spawnTick = s.tick;
	const before = s.rngState;
	if (partySize(s) > 1) {
		const all: InputFrame[] = [];
		for (let i = 0; i < partySize(s); i++) all.push(inputs !== undefined ? inputs[i] : EMPTY_INPUT);
		stepParty(s, all, w.config);
	} else step(s, inputs !== undefined ? inputs[0] : EMPTY_INPUT, w.config);
	t.ticks++;
	const e = s.combat.healEvents;
	let n = 0;
	let cuts = 0;
	for (const r of e.endReason) {
		t.ends.push(r);
		if (r !== HealEnd.DEATH) n++;
		if (healEndCuts(r)) cuts++;
	}
	expect(cuts).toBe(s.events.healCuts);
	t.cuts += cuts;
	let sum = 0;
	for (let k = 0; k < e.healAmount.size(); k++) {
		t.heals.push(e.healAmount[k]);
		t.healSlots.push(e.healSlot[k]);
		sum += e.healAmount[k];
	}
	expect(sum).toBe(s.events.heals);
	if (boltStart(w.mender)) {
		n++;
		t.bolts++;
		t.boltTicks.push(s.tick);
	}
	t.draws += n;
	expect([s.tick, s.rngState]).toEqual([s.tick, after(before, n)]);
	for (const o of s.combat.actors) if (o.kind !== NO_KIND) expect(o.hp <= o.hpMax).toBe(true);
}

function run(w: World, t: Tally, ticks: number, done?: () => boolean): number {
	for (let k = 1; k <= ticks; k++) {
		tick(w, t);
		if (done !== undefined && done()) return k;
	}
	return -1;
}

/** Ticks until the channel starts (link done). */
function toChannel(w: World, t: Tally): void {
	expect(run(w, t, 400, () => w.mender.aiState === MENDER_CHANNEL) > 0).toBe(true);
}

/** Puts the Mender back at (x, z) after a tick (a test hold: no move, no lost-sight count). */
function hold(a: ActorState, x: number, z: number): void {
	a.x = x;
	a.z = z;
	a.prevX = x;
	a.prevZ = z;
	if (a.aiState === MENDER_KEEP) a.aiTicks = 0;
}

/** Damages `a` by `n` as player 0's hit (onHit: the Mender's cut), outside a step. */
function hit(w: World, a: ActorState, n: number): void {
	const ctx = ctxOf(w);
	ctx.actingPlayer(0);
	ctx.damageActor(a, n);
}

// ---------------------------------------------------------------------------------------------

describe("mender: heal targets (NTD8)", () => {
	it("a room enemy, never a boss, the Goldling, the dummy, a pyre, a turret or another Mender", () => {
		const ids = archetypeIds();
		for (let k = 0; k < ids.size(); k++) {
			const data = archetypeAt(k).data;
			const want = isRoomEnemyData(data) && data.boss !== true && ids[k] !== MENDER.id;
			expect([ids[k], isMenderHealTarget(k)]).toEqual([ids[k], want]);
		}
		for (const id of [MENDER.id, BOSS_ACT1_ID, BOSS_DEMONLORD_ID, GOLDEN_KIND, DUMMY_KIND, "pyre", "turret.caster"])
			expect([id, isMenderHealTarget(archetypeIndex(id))]).toEqual([id, false]);
		for (const id of ["swarmer", "bruiser", "slime.small", "jackal", "mortar", "bulwark", "warbanner"])
			expect([id, isMenderHealTarget(archetypeIndex(id))]).toEqual([id, true]);
		expect(isMenderHealTarget(NO_KIND)).toBe(false);
	});

	it("the pick and 600 ticks next to a wounded boss, Goldling, dummy, pyre and Mender: no heal, only bolts", () => {
		const w = world();
		const base = ally(w, BRUISER.id, 2, 6);
		const kinds = [BOSS_ACT1_ID, BOSS_DEMONLORD_ID, GOLDEN_KIND, DUMMY_KIND, "pyre", MENDER.id];
		// Look-alikes of the bruiser (frozen: never stepped) carrying each kind, wounded, in range and sight.
		base.kind = archetypeIndex(kinds[0]);
		base.hp = 1;
		base.hpMax = 10;
		for (let k = 1; k < kinds.size(); k++) {
			const o: ActorState = { ...base, capWindow: [...base.capWindow], v: [...base.v] };
			o.id = w.s.combat.nextActorId++;
			o.kind = archetypeIndex(kinds[k]);
			o.x = 2 - k * 0.5;
			w.s.combat.actors.push(o);
			w.frozen.push(o);
		}
		expect(menderPick(ctxOf(w), w.mender) === undefined).toBe(true);
		const t = tally();
		run(w, t, 600);
		expect([t.heals.size(), t.ends.size(), w.mender.v[MENDER_ALLY], w.mender.v[MENDER_HEALED]]).toEqual([
			0, 0, 0, 0,
		]);
		expect(t.bolts).toBeGreaterThanOrEqual(3);
	});
});

describe("mender: the pick", () => {
	it("the most wounded by ratio (cross-multiplied), ties by slot order; full, dead, far or hidden allies are skipped", () => {
		let blocked = false;
		const w = world(0, 6, { isBulletBlocked: (x, z) => blocked && worldToGrid(x) === -3 && worldToGrid(z) === 6 });
		const ctx = ctxOf(w);
		const big = ally(w, BRUISER.id, 2, 6, 6); // 6 / 10 = 0.6 (4 hp lost)
		const small = ally(w, "sniper", 0, 8, 2); // 2 / 4 = 0.5 (2 hp lost): more wounded by ratio
		expect(menderPick(ctx, w.mender)).toBe(small);
		const tie = ally(w, "sniper", 1, 8, 2); // the same 0.5, a later slot
		expect(menderPick(ctx, w.mender)).toBe(small);
		small.hp = small.hpMax; // full: skipped; the tie's later slot is next
		expect(menderPick(ctx, w.mender)).toBe(tie);
		tie.alive = 0;
		expect(menderPick(ctx, w.mender)).toBe(big);
		const worse = ally(w, BRUISER.id, 0, 6 + D.healRange + 0.01, 1); // out of range
		expect(menderPick(ctx, w.mender)).toBe(big);
		worse.z = 6 + D.healRange; // exactly at healRange: in
		expect(menderPick(ctx, w.mender)).toBe(worse);
		const hidden = ally(w, BRUISER.id, -4, 6, 0.5); // behind the wall cell (-3, 6) once it is up
		expect(menderPick(ctx, w.mender)).toBe(hidden);
		blocked = true;
		expect(menderPick(ctx, w.mender)).toBe(worse);
	});

	it("re-picks every pickEveryTicks while keeping range (a newly wounded ally is linked within 15 ticks)", () => {
		const w = world();
		const o = ally(w, BRUISER.id, 3, 6);
		w.mender.cooldown = 1000; // no action: only the pick runs
		const t = tally();
		run(w, t, 1);
		expect(w.mender.v[MENDER_ALLY]).toBe(0);
		o.hp = 5;
		const k = run(w, t, 40, () => w.mender.v[MENDER_ALLY] === o.id);
		expect(k >= 1 && k <= D.pickEveryTicks).toBe(true);
	});
});

describe("mender: link and channel", () => {
	it("links for 0.4 s standing still, then +1 hp every 30 ticks and never above hpMax (ends FULL)", () => {
		const w = world();
		const o = ally(w, BRUISER.id, 3, 6, 7.5);
		const t = tally();
		tick(w, t);
		expect(linking(w.mender)).toBe(true);
		expect([w.mender.v[MENDER_ALLY], w.mender.aiTicks]).toEqual([o.id, D.linkTicks]);
		const x0 = w.mender.x;
		const z0 = w.mender.z;
		let linkTicks = 1; // ticks that end in the link
		for (;;) {
			tick(w, t);
			expect([w.mender.x, w.mender.z]).toEqual([x0, z0]);
			if (!linking(w.mender)) break;
			linkTicks++;
		}
		expect([linkTicks, w.mender.aiState]).toEqual([D.linkTicks, MENDER_CHANNEL]);
		const healTicks: number[] = [];
		const start = w.s.tick;
		while (w.mender.aiState === MENDER_CHANNEL) {
			tick(w, t);
			if (w.s.events.heals > 0) healTicks.push(w.s.tick - start);
			expect([w.mender.x, w.mender.z]).toEqual([x0, z0]);
		}
		expect(healTicks).toEqual([30, 60, 90]);
		expect(t.heals).toEqual([1, 1, 0.5]);
		expect(t.healSlots).toEqual([1, 1, 1]);
		expect([o.hp, o.hpMax, w.mender.v[MENDER_HEALED]]).toEqual([10, 10, 2.5]);
		expect(t.ends).toEqual([HealEnd.FULL]);
		expect([t.cuts, w.mender.aiState, w.mender.v[MENDER_ALLY]]).toEqual([0, MENDER_KEEP, 0]);
		const c = w.mender.cooldown;
		expect(c >= D.channelCooldownMin && c <= D.channelCooldownMax).toBe(true);
	});

	it("the 3 s are up: six pulses, then TIME, a cooldown, and it links again once that is out", () => {
		const w = world();
		const o = ally(w, BRUISER.id, 3, 6, 1);
		const t = tally();
		toChannel(w, t);
		run(w, t, 400, () => t.ends.size() > 0);
		expect(t.ends).toEqual([HealEnd.TIME]);
		expect([t.heals.size(), o.hp]).toEqual([6, 7]);
		expect(run(w, t, 200, () => linking(w.mender)) > 0).toBe(true);
		expect(t.draws).toBe(1);
	});

	it("healActor: clamps to hpMax, nothing for a full actor, a corpse or a free slot; a feed entry per heal", () => {
		const w = world();
		const o = ally(w, BRUISER.id, 3, 6, 9.25);
		const ctx = ctxOf(w);
		expect(healActor(ctx, o, 2)).toBe(0.75);
		expect(o.hp).toBe(10);
		expect(healActor(ctx, o, 1)).toBe(0);
		o.hp = 4;
		o.alive = 0;
		expect(healActor(ctx, o, 1)).toBe(0);
		o.alive = 1;
		expect(healActor(ctx, o, 0)).toBe(0);
		expect([w.s.events.heals, w.s.combat.healEvents.healSlot, w.s.combat.healEvents.healAmount]).toEqual([
			0.75,
			[1],
			[0.75],
		]);
	});
});

describe("mender: every end rule", () => {
	it("the ally dies mid-channel: ALLY_GONE (one draw), no more heals", () => {
		const w = world();
		const o = ally(w, BRUISER.id, 3, 6, 2);
		const t = tally();
		toChannel(w, t);
		run(w, t, 35);
		const heals = t.heals.size();
		expect(heals).toBe(1);
		ctxOf(w).killActor(o);
		tick(w, t);
		expect([t.ends, t.draws]).toEqual([[HealEnd.ALLY_GONE], 1]);
		run(w, t, 120);
		expect(t.heals.size()).toBe(heals);
	});

	it("a pillar between them: SIGHT (a cut), and no link while it stands", () => {
		let wall = false;
		// The ally 4 east; the wall cell is the beam's midpoint (2, 6), off the Mender's line to the player.
		const w = world(0, 6, { isBulletBlocked: (x, z) => wall && worldToGrid(x) === 2 && worldToGrid(z) === 6 });
		ally(w, BRUISER.id, 4, 6, 2);
		const t = tally();
		toChannel(w, t);
		run(w, t, 10);
		wall = true;
		tick(w, t);
		expect([t.ends, t.cuts]).toEqual([[HealEnd.SIGHT], 1]);
		for (let k = 0; k < 300; k++) {
			tick(w, t);
			hold(w.mender, 0, 6); // held where the wall hides the ally (it would strafe round it)
		}
		expect(t.ends.size()).toBe(1); // never linked again while the wall stands (it bolts the player instead)
		expect(t.bolts).toBeGreaterThanOrEqual(1);
	});

	it("a player standing on the beam: BLOCKED; beside it or past either end it holds", () => {
		const w = world();
		const o = ally(w, BRUISER.id, 4, 6, 1);
		const t = tally();
		toChannel(w, t);
		const a = w.mender;
		const r = PLAYER_RADIUS + D.beamBlockPad;
		// Just off the beam, and past each end inside the reach of an end's round cap: no block.
		for (const [x, z] of [
			[2, 6 + r + 0.01],
			[2, 6 - r - 0.01],
			[-0.1, 6],
			[4.1, 6],
		]) {
			put(w.s, 0, x, z);
			expect([x, z, menderBeamBlocker(w.s, a.x, a.z, o.x, o.z, D.beamBlockPad)]).toEqual([x, z, -1]);
			tick(w, t);
			expect([x, z, a.aiState]).toEqual([x, z, MENDER_CHANNEL]);
		}
		put(w.s, 0, 2, 6 + r - 0.01);
		tick(w, t);
		expect([t.ends, t.cuts, a.aiState]).toEqual([[HealEnd.BLOCKED], 1, MENDER_KEEP]);
	});

	it("co-op: a teammate's body on the beam blocks it too (the target stays off it)", () => {
		const w = world(0, 6, {}, 2);
		put(w.s, 1, 30, 30); // far, so player 0 is the Mender's target
		const o = ally(w, BRUISER.id, 4, 6, 1);
		const t = tally();
		toChannel(w, t);
		run(w, t, 40);
		expect(t.heals.size()).toBe(1);
		put(w.s, 1, 2, 6.2);
		expect(menderBeamBlocker(w.s, w.mender.x, w.mender.z, o.x, o.z, D.beamBlockPad)).toBe(1);
		tick(w, t);
		expect([t.ends, t.cuts]).toEqual([[HealEnd.BLOCKED], 1]);
		// A dead teammate on the beam blocks nothing.
		const w2 = world(0, 6, {}, 2);
		put(w2.s, 1, 2, 6);
		playerAt(w2.s, 1).dead = 1;
		const o2 = ally(w2, BRUISER.id, 4, 6, 1);
		expect(menderBeamBlocker(w2.s, w2.mender.x, w2.mender.z, o2.x, o2.z, D.beamBlockPad)).toBe(-1);
	});

	it("one hit on the Mender: DAMAGE (a cut, one draw), a 0.4 s flinch standing still, then it keeps range", () => {
		const w = world();
		const o = ally(w, BRUISER.id, 3, 6, 1);
		const t = tally();
		toChannel(w, t);
		run(w, t, 40);
		const hp = o.hp;
		const before = w.s.rngState;
		hit(w, w.mender, 1);
		const e = w.s.combat.healEvents;
		expect([e.endReason, e.endSlot, w.s.events.healCuts, w.s.rngState]).toEqual([
			[HealEnd.DAMAGE],
			[0],
			1,
			after(before, 1),
		]);
		expect([w.mender.aiState, w.mender.aiTicks, w.mender.v[MENDER_ALLY]]).toEqual([
			MENDER_FLINCH,
			D.flinchTicks,
			0,
		]);
		const x = w.mender.x;
		const z = w.mender.z;
		const c = w.mender.cooldown;
		for (let k = 1; k < D.flinchTicks; k++) {
			tick(w, t);
			expect([k, w.mender.aiState, w.mender.x, w.mender.z]).toEqual([k, MENDER_FLINCH, x, z]);
		}
		tick(w, t);
		expect(w.mender.aiState).toBe(MENDER_KEEP);
		expect(w.mender.cooldown).toBe(c - D.flinchTicks);
		expect(o.hp).toBe(hp);
	});

	it("a hit during the link cuts it too; a killing hit ends it as DEATH without a draw", () => {
		const w = world();
		ally(w, BRUISER.id, 3, 6, 1);
		const t = tally();
		tick(w, t);
		expect(linking(w.mender)).toBe(true);
		hit(w, w.mender, 1);
		expect([w.s.combat.healEvents.endReason, w.mender.aiState]).toEqual([[HealEnd.DAMAGE], MENDER_FLINCH]);
		const w2 = world();
		ally(w2, BRUISER.id, 3, 6, 1);
		const t2 = tally();
		toChannel(w2, t2);
		const before = w2.s.rngState;
		hit(w2, w2.mender, w2.mender.hp);
		expect([w2.mender.alive, w2.s.combat.healEvents.endReason, w2.s.events.healCuts, w2.s.rngState]).toEqual([
			0,
			[HealEnd.DEATH],
			0,
			before,
		]);
		expect([w2.mender.v[MENDER_ALLY], w2.mender.attack]).toEqual([0, 0]);
	});
});

describe("mender: the bolt", () => {
	function liveCasters(s: SimState): number {
		let n = 0;
		s.combat.enemyBullets.forEachActive((_slot, _pos, payload) => {
			if (BulletPayload.get(payload, "kind") === BulletKind.CASTER) n++;
			return false;
		});
		return n;
	}

	it("no wounded ally, the target in sight within 9: one CASTER bolt per wind-up, every 2.2-2.8 s", () => {
		const w = world(0, 6);
		w.mender.cooldown = 0;
		const t = tally();
		let fired = 0;
		for (let k = 0; k < 900; k++) {
			const spawned = w.s.combat.enemySpawned;
			tick(w, t);
			const n = w.s.combat.enemySpawned - spawned;
			if (n > 0) {
				expect(n).toBe(1);
				fired++;
			}
		}
		expect(fired).toBe(t.bolts);
		expect(t.bolts).toBeGreaterThanOrEqual(5);
		for (let k = 1; k < t.boltTicks.size(); k++) {
			const gap = t.boltTicks[k] - t.boltTicks[k - 1];
			expect([
				gap,
				gap >= D.boltWindupTicks + D.boltCooldownMin && gap <= D.boltWindupTicks + D.boltCooldownMax + 1,
			]).toEqual([gap, true]);
		}
		expect(liveCasters(w.s)).toBeGreaterThanOrEqual(1);
	});

	it("the bolt flies at the target", () => {
		const w = world(0, 6);
		const t = tally();
		run(w, t, 200, () => t.bolts > 0);
		run(w, t, D.boltWindupTicks + 3);
		let vx = 0;
		let vz = 0;
		w.s.combat.enemyBullets.forEachActive((_slot, pos, _payload) => {
			vx = pos.x - 0;
			vz = pos.z - 6;
			return false;
		});
		// Straight down -z from (0, 6) toward the player at the origin.
		expect(math.abs(vx) < 1e-9 && vz < 0).toBe(true);
	});

	it("no bolt past boltRange, out of sight or with a wounded ally in reach", () => {
		const far = world(0, D.boltRange + 0.5);
		const t1 = tally();
		for (let k = 0; k < 300; k++) {
			tick(far, t1);
			hold(far.mender, 0, D.boltRange + 0.5); // held (it would close in to keepMax)
		}
		expect(t1.bolts).toBe(0);
		const hidden = world(0, 6, { isBulletBlocked: (x, z) => worldToGrid(x) === 0 && worldToGrid(z) === 3 });
		const t2 = tally();
		for (let k = 0; k < 300; k++) {
			tick(hidden, t2);
			hold(hidden.mender, 0, 6); // held (it would walk round the wall to find a line, or leash)
		}
		expect(t2.bolts).toBe(0);
		const busy = world(0, 6);
		const deep = ally(busy, BRUISER.id, 3, 6, 1);
		deep.hpMax = 1000; // stays wounded for the whole run
		const t3 = tally();
		run(busy, t3, 600);
		expect(t3.bolts).toBe(0);
		expect(t3.heals.size()).toBeGreaterThanOrEqual(6);
	});
});

// ---------------------------------------------------------------------------------------------
// A heal is a write to hp only: no score, combo, cap bucket, flash, enemy hit, build proc or drop sees it, and the
// healed ally pays its kill points exactly once.

/** An open endless arena (no rooms, stairs out of reach): run state, builds, drops, affixes and scoring on. */
function arena(floor: number): EndlessFloorWorld {
	return {
		floor,
		config: { bounds: DEFAULT_BOUNDS, encounter: { spawns: [], rooms: [], entranceRoom: -1, bossRoom: -1 } },
		bossFloor: false,
		spawnX: 0,
		spawnZ: 0,
		stairX: 1000,
		stairZ: 1000,
		roomSpawns: [],
		roomIdAt: () => -1,
	};
}

describe("mender: a heal touches nothing but hp", () => {
	function scored(withMender: boolean): { s: SimState; o: ActorState; points: number; t: Tally } {
		const config: SimConfig = {
			endless: { runSeed: 9, worldForFloor: arena },
			scoring: {},
			builds: BUILDS_CONFIG,
			drops: DROPS_CONFIG,
			affixes: AFFIXES_CONFIG,
		};
		const s = createSimState(9, 0, 0, config);
		ghost(s);
		const wc = arena(1).config;
		const ctx = new SimCtx().bind(s, wc, EMPTY_INPUT);
		const w: World = { s, config, mender: undefined as unknown as ActorState, frozen: [] };
		if (withMender) {
			const a = spawnActor(ctx, KIND, 0, 6)!;
			a.spawnTick = -1;
			engage(a);
			a.cooldown = 0;
			w.mender = a;
		}
		const o = spawnActor(ctx, BRUISER_KIND, 3, 6)!;
		w.frozen.push(o);
		o.hp = 1; // wounded by a direct write: no hit, no score
		const t = tally();
		if (withMender) {
			const sc = s.score!;
			const cap = [o.capBucket, ...o.capWindow];
			const drops = [s.drops!.rngState, s.drops!.killsSinceDrop];
			for (let k = 0; k < 300; k++) {
				for (const f of w.frozen) f.spawnTick = s.tick;
				step(s, EMPTY_INPUT, config);
				if (s.events.heals > 0) t.heals.push(s.events.heals);
				expect([s.events.enemyHits, s.events.damageDealt, o.flashTicks]).toEqual([0, 0, 0]);
			}
			expect(t.heals.size()).toBeGreaterThanOrEqual(6);
			expect([sc.total, sc.combo, sc.events.kills]).toEqual([0, COMBO_MIN, 0]);
			for (const n of sc.points) expect(n).toBe(0);
			for (const n of sc.counts) expect(n).toBe(0);
			expect([o.capBucket, ...o.capWindow]).toEqual(cap);
			expect([s.builds!.procs.size(), s.builds!.players[0].kills, s.run!.players[0].fangKills]).toEqual([
				0, 0, 0,
			]);
			expect([s.drops!.rngState, s.drops!.killsSinceDrop]).toEqual(drops);
		}
		const hp = o.hp;
		const kc = new SimCtx().bind(s, wc, EMPTY_INPUT);
		kc.actingPlayer(0);
		kc.damageActor(o, o.hpMax + 1);
		expect([o.alive, withMender ? hp > 1 : true]).toEqual([0, true]);
		const points = s.score!.points[ScoreSource.KILLS];
		expect(s.score!.counts[ScoreSource.KILLS]).toBe(1);
		for (let k = 0; k < 120; k++) step(s, EMPTY_INPUT, config);
		expect([s.score!.points[ScoreSource.KILLS], s.score!.counts[ScoreSource.KILLS]]).toEqual([points, 1]);
		return { s, o, points, t };
	}

	it("no score, combo, cap bucket, flash, enemy hit, build proc, Fang or drop moves; the kill pays once, as unhealed", () => {
		const healed = scored(true);
		const plain = scored(false);
		expect(healed.points).toBe(plain.points);
		expect(healed.points > 0).toBe(true);
	});
});

// ---------------------------------------------------------------------------------------------
// Real endless floors (run WITHOUT endless mode, the floor's breakables as config pieces): a Mender and a bruiser in a
// combat room, wandering ghost players, the bruiser wounded by a scripted hit now and then. Heals happen, nobody is ever
// above hpMax, and two runs hash identically every tick.

interface Scene {
	readonly fl: EndlessRunFloor;
	readonly config: SimConfig;
	readonly players: ReadonlyArray<readonly [number, number]>;
}

function scene(runSeed: number, floor: number, party: number): Scene | undefined {
	const fl = endlessRunFloor(runSeed, floor, party);
	const d = fl.dungeon;
	const rooms = fl.config.encounter!.rooms;
	const rng = new Rng(runSeed * 43 + floor);
	for (let tries = 0; tries < 40; tries++) {
		const r = rooms[rng.int(0, rooms.size() - 1)];
		if (r.type !== "combat" && r.type !== "elite") continue;
		const tiles: Array<readonly [number, number]> = [];
		for (let gy = 0; gy < d.H; gy++)
			for (let gx = 0; gx < d.W; gx++)
				if (d.roomId[gy * d.W + gx] === r.id && tileAt(d, gx, gy) === TileType.FLOOR) tiles.push([gx, gy]);
		if (tiles.size() < 30) continue;
		const me = tiles[rng.int(0, tiles.size() - 1)];
		let mate: readonly [number, number] | undefined;
		for (const p of tiles) {
			const dd = (p[0] - me[0]) * (p[0] - me[0]) + (p[1] - me[1]) * (p[1] - me[1]);
			if (dd >= 4 && dd <= 9) {
				mate = p;
				break;
			}
		}
		if (mate === undefined) continue;
		const players: Array<readonly [number, number]> = [];
		for (let k = 0; k < 20 && players.size() < party; k++) {
			const p = tiles[rng.int(0, tiles.size() - 1)];
			const dd = (p[0] - me[0]) * (p[0] - me[0]) + (p[1] - me[1]) * (p[1] - me[1]);
			if (dd >= 25 && dd <= 81) players.push(p);
		}
		if (players.size() < party) continue;
		const config: SimConfig = {
			...fl.config,
			encounter: {
				...fl.config.encounter!,
				spawns: [
					{ kind: MENDER.id, x: me[0], z: me[1] },
					{ kind: BRUISER.id, x: mate[0], z: mate[1] },
				],
			},
			party: party > 1 ? { size: party } : undefined,
		};
		return { fl, config, players };
	}
	return undefined;
}

function wanderer(seed: number): () => InputFrame {
	const rng = new Rng(seed);
	let hold = 0;
	let cur: InputFrame = EMPTY_INPUT;
	const axes = [-AXIS_MAX, 0, AXIS_MAX];
	return () => {
		if (hold <= 0) {
			hold = rng.int(10, 40);
			cur = { ...EMPTY_INPUT, moveX: axes[rng.int(0, 2)], moveZ: axes[rng.int(0, 2)] };
		}
		hold--;
		return cur;
	};
}

interface Played {
	readonly heals: number;
	readonly ends: number;
	readonly hashes: string[];
}

function play(sc: Scene, seed: number, ticks: number): Played {
	const party = sc.players.size();
	const s = createSimState(seed, sc.players[0][0], sc.players[0][1], sc.config);
	for (let i = 0; i < party; i++) put(s, i, sc.players[i][0], sc.players[i][1]);
	ghost(s);
	const walkers: Array<() => InputFrame> = [];
	for (let i = 0; i < party; i++) walkers.push(wanderer(seed * 7 + i));
	let mender: ActorState | undefined;
	let bruiser: ActorState | undefined;
	for (const a of s.combat.actors) {
		if (a.kind === KIND) mender = a;
		if (a.kind === BRUISER_KIND) bruiser = a;
	}
	engage(mender!);
	engage(bruiser!);
	let heals = 0;
	let ends = 0;
	const hashes: string[] = [];
	for (let t = 0; t < ticks; t++) {
		if (t % 75 === 30 && bruiser!.alive === 1 && bruiser!.hp > 1.5) {
			const ctx = new SimCtx().bind(s, sc.config, EMPTY_INPUT);
			ctx.actingPlayer(0);
			ctx.damageActor(bruiser!, 1);
		}
		if (party > 1) {
			const inputs: InputFrame[] = [];
			for (let i = 0; i < party; i++) inputs.push(walkers[i]());
			stepParty(s, inputs, sc.config);
		} else step(s, walkers[0](), sc.config);
		hashes.push(hashState(s));
		heals += s.events.heals;
		ends += s.combat.healEvents.endReason.size();
		for (const o of s.combat.actors) if (o.kind !== NO_KIND) expect(o.hp <= o.hpMax).toBe(true);
	}
	return { heals, ends, hashes };
}

describe("mender: real endless floors", () => {
	it("solo (8 floors) and co-op (2, 4 floors): heals happen and stay within hpMax", () => {
		let heals = 0;
		let ends = 0;
		let scenes = 0;
		for (let rs = 1; rs <= 8; rs++) {
			const sc = scene(rs, 2 + (rs % 3), 1);
			if (sc === undefined) continue;
			scenes++;
			const r = play(sc, rs, 900);
			heals += r.heals;
			ends += r.ends;
		}
		for (let rs = 21; rs <= 24; rs++) {
			const sc = scene(rs, 3, 2);
			if (sc === undefined) continue;
			scenes++;
			const r = play(sc, rs, 900);
			heals += r.heals;
			ends += r.ends;
		}
		expect(scenes).toBeGreaterThanOrEqual(10);
		expect(heals).toBeGreaterThanOrEqual(10);
		expect(ends).toBeGreaterThanOrEqual(5);
	});

	it("is deterministic: two identical runs hash identically every tick (solo and a party of two)", () => {
		for (const [rs, party] of [
			[4, 1],
			[23, 2],
		]) {
			const first = play(scene(rs, 3, party)!, rs, 600);
			const second = play(scene(rs, 3, party)!, rs, 600);
			expect(first.hashes.size()).toBe(600);
			expect(second.hashes).toEqual(first.hashes);
		}
	});
});
