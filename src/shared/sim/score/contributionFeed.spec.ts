// docs/RUN_CONTRIBUTION.md CT2: the unhashed contribution feed in ScoreEvents. popPlayer names the killer of every
// score pop, dealtPlayer / dealtAmount / dealtBoss one entry per damaging damageActor (summing to events.damageDealt),
// hurtPlayer one entry per landed hit (summing to playerHits / hitsTaken). Over a scripted 2-player endless run (floor
// 1 walked, a boss fought) the per-player sums equal the team totals every tick; a bullet's damage and kill go to its
// owner; solo runs record player 0; clones copy the arrays; the state hash ignores them; unscored runs have no feed.
import { describe, expect, it } from "@rbxts/jest-globals";
import { buildEndlessRunConfig, type EndlessRunSetup } from "shared/run";
import { PartyDriver } from "shared/run/testing";
import { TEST_CHASER } from "shared/sim/testing";
import {
	AXIS_MAX,
	Button,
	EMPTY_INPUT,
	NO_KIND,
	ScoreSource,
	archetypeAt,
	cloneScoreState,
	createSimState,
	hashState,
	isPartyWiped,
	partySize,
	playerAt,
	stepParty,
	type ActorSpawn,
	type EncounterConfig,
	type InputFrame,
	type ScoreEvents,
	type SimConfig,
	type SimState,
} from "shared/sim";

const enc = (spawns: ActorSpawn[]): EncounterConfig => ({ spawns, rooms: [], entranceRoom: -1, bossRoom: -1 });

function frame(mx: number, mz: number, buttons = 0, ax = 0, az = 0): InputFrame {
	return {
		...EMPTY_INPUT,
		moveX: math.round(mx * AXIS_MAX),
		moveZ: math.round(mz * AXIS_MAX),
		aimX: math.round(ax * AXIS_MAX),
		aimZ: math.round(az * AXIS_MAX),
		buttons,
	};
}

function place(s: SimState, i: number, x: number, z: number): void {
	const p = playerAt(s, i);
	p.x = x;
	p.z = z;
	p.prevX = x;
	p.prevZ = z;
}

function events(s: SimState): ScoreEvents {
	return s.score!.events;
}

/** Whole-run per-player sums of the feed, and the team totals they must equal. */
interface FeedTotals {
	kills: number[];
	damage: number[];
	bossDamage: number[];
	hits: number[];
	teamPops: number;
	teamDamage: number;
	/** Ticks whose pops were all KILLS awards (no boss kill, no Goldling jackpot): pops === delta counts[KILLS]. */
	plainKillTicks: number;
}

function newTotals(n: number): FeedTotals {
	const z = () => {
		const out: number[] = [];
		for (let i = 0; i < n; i++) out.push(0);
		return out;
	};
	return { kills: z(), damage: z(), bossDamage: z(), hits: z(), teamPops: 0, teamDamage: 0, plainKillTicks: 0 };
}

/**
 * After one tick: the per-tick invariants (parallel sizes, credit in range, sums equal the tick's totals) and the
 * whole-run sums. `killsBefore` / `hitsBefore`: counts[KILLS] / hitsTaken before the tick.
 */
function observe(s: SimState, t: FeedTotals, killsBefore: number, hitsBefore: number): void {
	const e = events(s);
	const n = partySize(s);
	expect([e.popPlayer.size(), e.popX.size()]).toEqual([e.kills, e.kills]);
	expect([e.dealtAmount.size(), e.dealtBoss.size()]).toEqual([e.dealtPlayer.size(), e.dealtPlayer.size()]);
	expect(e.dealtPlayer.size() <= s.events.enemyHits).toBe(true);
	expect(e.hurtPlayer.size()).toBe(s.events.playerHits);
	expect(s.score!.hitsTaken - hitsBefore).toBe(e.hurtPlayer.size());
	let dealt = 0;
	for (let k = 0; k < e.dealtPlayer.size(); k++) {
		const p = e.dealtPlayer[k];
		expect(p >= 0 && p < n).toBe(true);
		expect(e.dealtAmount[k] > 0).toBe(true);
		t.damage[p] += e.dealtAmount[k];
		if (e.dealtBoss[k] !== 0) t.bossDamage[p] += e.dealtAmount[k];
		dealt += e.dealtAmount[k];
	}
	expect(dealt).toBe(s.events.damageDealt);
	t.teamDamage += s.events.damageDealt;
	for (const p of e.popPlayer) {
		expect(p >= 0 && p < n).toBe(true);
		t.kills[p] += 1;
	}
	t.teamPops += e.kills;
	const jackpot = s.golden !== undefined && s.golden.events.jackpot > 0;
	if (s.events.bossDefeated === 0 && !jackpot) {
		expect(e.kills).toBe(s.score!.counts[ScoreSource.KILLS] - killsBefore);
		if (e.kills > 0) t.plainKillTicks++;
	}
	for (const p of e.hurtPlayer) {
		expect(p >= 0 && p < n).toBe(true);
		t.hits[p] += 1;
	}
}

/** PartyDriver that checks the feed after every tick it steps. */
class FeedDriver extends PartyDriver {
	readonly totals: FeedTotals;

	constructor(setup: EndlessRunSetup, seed: number) {
		super(setup, seed);
		this.totals = newTotals(partySize(this.state));
	}

	tick(frames: InputFrame[]): void {
		const sc = this.state.score!;
		const killsBefore = sc.counts[ScoreSource.KILLS];
		const hitsBefore = sc.hitsTaken;
		super.tick(frames);
		observe(this.state, this.totals, killsBefore, hitsBefore);
	}
}

/** Sword reach the close boss fight closes to (world units). */
const CLOSE_RANGE = 1.6;

/**
 * Up close: every living player walks into the boss and swings at it every other tick, rolling now and then
 * (partyBot's fightBoss circles out of sword reach and lands its damage with the debug J key, which is no damageActor).
 */
function fightBossClose(drv: FeedDriver, maxTicks: number): void {
	const s = drv.state;
	for (let t = 0; t < maxTicks && !isPartyWiped(s); t++) {
		const boss = s.combat.actors.find(
			(a) => a.kind !== NO_KIND && a.alive !== 0 && archetypeAt(a.kind).data.boss === true,
		);
		if (boss === undefined) return;
		const f: InputFrame[] = [];
		for (let i = 0; i < drv.n; i++) {
			const p = playerAt(s, i);
			const dx = boss.x - p.x;
			const dz = boss.z - p.z;
			const d = math.max(1e-6, math.sqrt(dx * dx + dz * dz));
			const walk = d > CLOSE_RANGE ? 1 : 0;
			let buttons = t % 2 === i % 2 ? Button.FIRE : 0;
			if ((t + i * 13) % 45 === 0) buttons = Button.ROLL;
			f.push(
				p.dead !== 0 ? { ...EMPTY_INPUT } : frame((dx / d) * walk, (dz / d) * walk, buttons, dx / d, dz / d),
			);
		}
		drv.tick(f);
	}
}

/** partyBot's recordPartyRun script, shortened: floor 1 walked, a skip to floor 5, its boss fought up close. */
function playRun(seed: number, n: number): FeedDriver {
	const drv = new FeedDriver(buildEndlessRunConfig(seed, n), seed);
	const w1 = drv.world();
	drv.walkAll(w1.stairX, w1.stairZ, 2000);
	while (drv.floor() < 5 && !isPartyWiped(drv.state)) drv.skipFloor();
	if (!isPartyWiped(drv.state)) {
		const w5 = drv.world();
		drv.walkAll(w5.stairX, w5.stairZ, 2500, () => drv.state.combat.actors.some((a) => a.phase > 0));
		fightBossClose(drv, 1500);
	}
	return drv;
}

function sum(xs: ReadonlyArray<number>): number {
	let out = 0;
	for (const x of xs) out += x;
	return out;
}

describe("contribution feed over a scripted 2-player endless run", () => {
	const drv = playRun(4242, 2);
	const t = drv.totals;
	const sc = drv.state.score!;

	it("per-player sums equal the team totals (damage, pops, hits taken)", () => {
		// Run totals add the same hits in a different grouping (per entry vs per tick), so they can differ in the last bit;
		// the per-tick check in observe() is exact.
		expect(sum(t.damage)).toBeCloseTo(t.teamDamage, 6);
		expect(sum(t.kills)).toBe(t.teamPops);
		expect(sum(t.hits)).toBe(sc.hitsTaken);
		expect(sum(t.bossDamage) <= sum(t.damage)).toBe(true);
		// Every pop is a kill award: counts[KILLS] plus the boss kills (each a BOSS award) and Goldling jackpots.
		expect(t.teamPops >= sc.counts[ScoreSource.KILLS]).toBe(true);
		expect(t.plainKillTicks > 0).toBe(true);
	});

	it("both players are credited, and the boss fight credits boss damage", () => {
		expect(t.damage[0] > 0 && t.damage[1] > 0).toBe(true);
		expect(t.kills[0] + t.kills[1] > 0).toBe(true);
		expect(sum(t.bossDamage) > 0).toBe(true);
	});
});

describe("contribution feed attribution", () => {
	function duel(shooter: number): { dealt: number[]; pops: number[]; damage: number; boss: number } {
		const config: SimConfig = {
			party: { size: 2, loadouts: [["weapon.test"], ["weapon.test"]] },
			scoring: { partySize: 2 },
			encounter: enc([{ kind: TEST_CHASER.id, x: 0, z: 0 }]),
		};
		const s = createSimState(7, 0, 0, config);
		place(s, 0, -4, 0);
		place(s, 1, 4, 0);
		const out = { dealt: [] as number[], pops: [] as number[], damage: 0, boss: 0 };
		for (let k = 0; k < 400 && s.combat.actors.some((a) => a.alive !== 0); k++) {
			// The shooter fires at the chaser in the middle; the other fires away from it.
			const f0 = shooter === 0 ? frame(0, 0, Button.FIRE, 1, 0) : frame(0, 0, Button.FIRE, -1, 0);
			const f1 = shooter === 1 ? frame(0, 0, Button.FIRE, -1, 0) : frame(0, 0, Button.FIRE, 1, 0);
			stepParty(s, [f0, f1], config);
			const e = events(s);
			for (let j = 0; j < e.dealtPlayer.size(); j++) {
				out.dealt.push(e.dealtPlayer[j]);
				out.boss += e.dealtBoss[j];
			}
			for (const p of e.popPlayer) out.pops.push(p);
			out.damage += s.events.damageDealt;
		}
		return out;
	}

	it("a player bullet's damage and kill go to its owner (either player)", () => {
		for (const shooter of [0, 1]) {
			const r = duel(shooter);
			expect(r.dealt.size() > 0).toBe(true);
			expect(r.dealt.every((p) => p === shooter)).toBe(true);
			expect(r.pops).toEqual([shooter]);
			expect(r.damage > 0).toBe(true);
			expect(r.boss).toBe(0);
		}
	});

	it("solo runs credit player 0", () => {
		const drv = new FeedDriver(buildEndlessRunConfig(4242, 1), 4242);
		expect(drv.state.party).toBe(undefined);
		const w1 = drv.world();
		drv.walkAll(w1.stairX, w1.stairZ, 1500);
		const t = drv.totals;
		expect(t.damage.size()).toBe(1);
		expect(t.damage[0]).toBeCloseTo(t.teamDamage, 6);
		expect(t.teamDamage > 0).toBe(true);
		expect(t.kills[0]).toBe(t.teamPops);
		expect(t.hits[0]).toBe(drv.state.score!.hitsTaken);
	});

	it("unscored runs have no feed (no score state)", () => {
		const config: SimConfig = {
			party: { size: 2, loadouts: [["weapon.test"], ["weapon.test"]] },
			encounter: enc([{ kind: TEST_CHASER.id, x: 0, z: 0 }]),
		};
		const s = createSimState(7, 0, 0, config);
		place(s, 0, -4, 0);
		let dealt = 0;
		for (let k = 0; k < 120; k++) {
			stepParty(s, [frame(0, 0, Button.FIRE, 1, 0), { ...EMPTY_INPUT }], config);
			dealt += s.events.damageDealt;
		}
		expect(dealt > 0).toBe(true);
		expect(s.score).toBe(undefined);
	});
});

describe("contribution feed bookkeeping", () => {
	it("clones copy the arrays; the state hash ignores them; clearScoreEvents empties them", () => {
		const setup = buildEndlessRunConfig(4242, 2);
		const s = createSimState(4242, setup.spawn!.x, setup.spawn!.z, setup.config);
		const before = hashState(s);
		const e = events(s);
		e.popPlayer.push(1);
		e.dealtPlayer.push(0);
		e.dealtAmount.push(3);
		e.dealtBoss.push(1);
		e.hurtPlayer.push(1);
		expect(hashState(s)).toBe(before);
		const c = cloneScoreState(s.score!);
		const ce = c.events;
		expect([ce.popPlayer, ce.dealtPlayer, ce.dealtAmount, ce.dealtBoss, ce.hurtPlayer]).toEqual([
			[1],
			[0],
			[3],
			[1],
			[1],
		]);
		ce.popPlayer[0] = 0;
		ce.hurtPlayer.clear();
		expect([e.popPlayer, e.hurtPlayer]).toEqual([[1], [1]]);
		stepParty(s, [{ ...EMPTY_INPUT }, { ...EMPTY_INPUT }], setup.config);
		expect([e.popPlayer, e.dealtPlayer, e.dealtAmount, e.dealtBoss, e.hurtPlayer]).toEqual([[], [], [], [], []]);
	});
});
