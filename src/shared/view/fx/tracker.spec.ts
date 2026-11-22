// The hit tracker (port of the web build's src/fx/tracker.test.ts @ 42897e2): hp diffs -> hits, kills, spawns,
// revives, resets, boss phases / defeats, elites, damage-cap hits, and the fixed event pool.
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	DAMAGE_CAP_BUCKETS,
	DAMAGE_CAP_BUCKET_TICKS,
	NO_KIND,
	type ActorState,
	type EncounterConfig,
} from "shared/sim";
import type { FxEvent, FxEventType } from "./events";
import {
	CAPPED_EVENT_MIN_TICKS,
	HitTracker,
	capWindowTaken,
	isAtDamageCap,
	type ActorInfo,
	type TrackedState,
} from "./tracker";

// Kinds used by the fake states: 0 = plain enemy, 1 = boss with a damage cap of 4 per second.
const BOSS_KIND = 1;
const describeKind = (kind: number): ActorInfo =>
	kind === BOSS_KIND ? { boss: true, damageCapPerSecond: 4 } : { boss: false };

function zeros(n: number): number[] {
	const out: number[] = [];
	for (let i = 0; i < n; i++) out.push(0);
	return out;
}

function actor(id: number, kind: number, hp: number, x = 0, z = 0): ActorState {
	return {
		id,
		kind,
		spawnTick: -1,
		x,
		z,
		prevX: x,
		prevZ: z,
		faceX: 0,
		faceZ: 1,
		hp,
		hpMax: hp,
		radius: 0.4,
		alive: 1,
		deadTicks: 0,
		aiState: 0,
		aiTicks: 0,
		attack: 0,
		cooldown: 0,
		flashTicks: 0,
		emitterId: 0,
		phase: 0,
		capBucket: -1,
		capWindow: zeros(DAMAGE_CAP_BUCKETS),
		v: zeros(8),
	};
}

interface FakeState extends TrackedState {
	tick: number;
	events: { enemyHits: number };
	combat: { actors: ActorState[] };
}

const fake = (actors: ActorState[]): FakeState => ({ tick: 0, events: { enemyHits: 0 }, combat: { actors } });

/** Copies of this frame's events (pooled objects are reused next frame). */
function frame(t: HitTracker, s: FakeState, ticks = 1, alpha = 0.5, encounter?: EncounterConfig): FxEvent[] {
	s.tick += ticks;
	t.update(s, alpha, encounter);
	const out: FxEvent[] = [];
	for (let i = 0; i < t.events.count(); i++) out.push({ ...t.events.at(i) });
	return out;
}

const types = (events: FxEvent[]): FxEventType[] => events.map((e) => e.type);

describe("HitTracker", () => {
	it("adopts the initial encounter silently on the first frame", () => {
		const t = new HitTracker({ describe: describeKind });
		const s = fake([actor(1, 0, 10), actor(2, 0, 10)]);
		expect(frame(t, s, 0)).toEqual([]);
		expect(t.runs).toBe(1);
	});

	it("turns an hp drop into one hit with the hp delta, the interpolated position and the hp after", () => {
		const t = new HitTracker({ describe: describeKind });
		const a = actor(7, 0, 10, 2, 4);
		const s = fake([a]);
		frame(t, s);
		a.prevX = 2;
		a.x = 3;
		a.hp = 8;
		const events = frame(t, s, 1, 0.25);
		expect(events.size()).toBe(1);
		expect(events[0]).toMatchObject({
			type: "hit",
			slot: 0,
			actorId: 7,
			kind: 0,
			damage: 2,
			hpAfter: 8,
			hpMax: 10,
			heavy: false,
			boss: false,
		});
		expect(events[0].x).toBeCloseTo(2.25);
		expect(events[0].z).toBe(4);
	});

	it("aggregates every tick of a multi-tick frame into one hit and flags heavy hits", () => {
		const t = new HitTracker({ describe: describeKind });
		const a = actor(1, 0, 20);
		const s = fake([a]);
		frame(t, s);
		a.hp -= 2; // tick 1
		a.hp -= 2; // tick 2
		a.hp -= 1; // tick 3
		const events = frame(t, s, 3);
		expect(types(events)).toEqual(["hit"]);
		expect(events[0].damage).toBe(5);
		expect(events[0].heavy).toBe(true);
		a.hp -= 1;
		expect(frame(t, s)[0]).toMatchObject({ damage: 1, heavy: false });
	});

	it("reports a death once: the killing hit, then killed; the corpse stays quiet", () => {
		const t = new HitTracker({ describe: describeKind });
		const a = actor(3, 0, 4);
		const s = fake([a]);
		frame(t, s);
		a.hp = 0;
		a.alive = 0;
		const events = frame(t, s);
		expect(types(events)).toEqual(["hit", "killed"]);
		expect(events[0]).toMatchObject({ damage: 4, hpAfter: 0 });
		expect(events[1]).toMatchObject({ slot: 0, actorId: 3, hpMax: 4 });
		a.deadTicks = 5;
		expect(frame(t, s, 5)).toEqual([]);
	});

	it("never invents a hit or a kill when a slot is reused by a new actor: it reports a spawn", () => {
		const t = new HitTracker({ describe: describeKind });
		const s = fake([actor(1, 0, 10)]);
		frame(t, s);
		s.combat.actors[0] = actor(9, 0, 2);
		const events = frame(t, s);
		expect(types(events)).toEqual(["spawned"]);
		expect(events[0]).toMatchObject({ slot: 0, actorId: 9, revived: false });
		s.combat.actors[0].kind = NO_KIND;
		s.combat.actors[0].id = 0;
		expect(frame(t, s)).toEqual([]);
	});

	it("reports runtime spawns in new slots, and a dead actor coming back in place as a revive", () => {
		const t = new HitTracker({ describe: describeKind });
		const a = actor(1, 0, 3);
		const s = fake([a]);
		frame(t, s);
		s.combat.actors.push(actor(2, 0, 3));
		expect(frame(t, s)).toMatchObject([{ type: "spawned", slot: 1, actorId: 2 }]);
		a.hp = 0;
		a.alive = 0;
		frame(t, s);
		a.hp = 3;
		a.alive = 1;
		expect(frame(t, s)).toMatchObject([{ type: "spawned", slot: 0, actorId: 1, revived: true }]);
	});

	it("clears on a run restart (new state object or tick going back) and emits reset first", () => {
		const t = new HitTracker({ describe: describeKind });
		const s1 = fake([actor(1, 0, 10)]);
		frame(t, s1);
		frame(t, s1);
		const s2 = fake([actor(1, 0, 5)]);
		expect(types(frame(t, s2, 0))).toEqual(["reset"]);
		expect(t.runs).toBe(2);
		s2.combat.actors[0].hp = 4;
		expect(types(frame(t, s2))).toEqual(["hit"]);
		s2.tick = 0;
		s2.combat.actors[0].hp = 1;
		expect(types(frame(t, s2, 0))).toEqual(["reset"]);
	});

	it("does nothing on frames that stepped no tick (pause, hitstop)", () => {
		const t = new HitTracker({ describe: describeKind });
		const a = actor(1, 0, 10);
		const s = fake([a]);
		frame(t, s);
		a.hp = 5; // (impossible without a tick; proves the diff is skipped)
		expect(frame(t, s, 0)).toEqual([]);
		expect(t.ticksThisFrame).toBe(0);
	});

	it("marks bosses and elites, and reports boss phases and the boss defeat", () => {
		const t = new HitTracker({ describe: describeKind });
		const boss = actor(1, BOSS_KIND, 100, 5, 5);
		const elite = actor(2, 0, 10, 20, 20);
		const s = fake([boss, elite]);
		const encounter: EncounterConfig = {
			spawns: [],
			rooms: [
				{ id: 0, type: "boss", depth: 3, cx: 5, cz: 5, minX: 0, maxX: 10, minZ: 0, maxZ: 10, floorTiles: 100 },
				{
					id: 1,
					type: "elite",
					depth: 2,
					cx: 20,
					cz: 20,
					minX: 15,
					maxX: 25,
					minZ: 15,
					maxZ: 25,
					floorTiles: 100,
				},
			],
			entranceRoom: -1,
			bossRoom: 0,
		};
		frame(t, s, 1, 0, encounter);
		elite.hp = 9;
		boss.phase = 2;
		const events = frame(t, s, 1, 0, encounter);
		expect(events).toMatchObject([
			{ type: "bossPhase", slot: 0, phase: 2, boss: true },
			{ type: "hit", slot: 1, elite: true, boss: false },
		]);
		boss.hp = 0;
		boss.alive = 0;
		expect(types(frame(t, s, 1, 0, encounter))).toEqual(["hit", "killed", "bossDefeated"]);
	});

	it("flags hits that filled the damage cap, and reports absorbed hits on a capped actor (rate limited)", () => {
		const t = new HitTracker({ describe: describeKind });
		const boss = actor(1, BOSS_KIND, 100);
		const s = fake([boss]);
		frame(t, s);
		// Tick 1 (state.tick 1 -> 2): an 8-damage hit fills the window (4/s x the 2 s window).
		boss.hp = 92;
		boss.capBucket = math.floor(1 / DAMAGE_CAP_BUCKET_TICKS);
		boss.capWindow[boss.capBucket % DAMAGE_CAP_BUCKETS] = 8;
		s.events.enemyHits = 1;
		expect(frame(t, s)).toMatchObject([{ type: "hit", damage: 8, capped: true }]);
		// Next ticks: hits land (enemyHits) but hp does not move: absorbed by the cap.
		expect(frame(t, s)).toMatchObject([{ type: "capped", slot: 0, capped: true, boss: true }]);
		expect(frame(t, s)).toEqual([]); // rate limited
		expect(types(frame(t, s, CAPPED_EVENT_MIN_TICKS))).toEqual(["capped"]); // still inside the ~2 s window
		// Once the window has rolled past the booked damage, hits that move no hp are not cap hits (e.g. immunity).
		expect(frame(t, s, DAMAGE_CAP_BUCKETS * DAMAGE_CAP_BUCKET_TICKS)).toEqual([]);
	});

	it("keeps the event pool fixed: overflow drops the newest and counts it", () => {
		const t = new HitTracker({ describe: describeKind, capacity: 2 });
		const actors = [actor(1, 0, 5), actor(2, 0, 5), actor(3, 0, 5)];
		const s = fake(actors);
		frame(t, s);
		for (const a of actors) a.hp = 4;
		expect(frame(t, s).size()).toBe(2);
		expect(t.events.dropped).toBe(1);
		expect(t.events.droppedTotal).toBe(1);
	});
});

describe("capWindowTaken / isAtDamageCap", () => {
	it("sums only buckets still inside the rolling window", () => {
		const a = actor(1, BOSS_KIND, 100);
		expect(capWindowTaken(a, 0)).toBe(0);
		a.capBucket = 20;
		for (let i = 0; i < a.capWindow.size(); i++) a.capWindow[i] = 1; // buckets 9..20 booked 1 each
		expect(DAMAGE_CAP_BUCKETS).toBe(12);
		expect(capWindowTaken(a, 20 * DAMAGE_CAP_BUCKET_TICKS)).toBe(12);
		expect(capWindowTaken(a, 22 * DAMAGE_CAP_BUCKET_TICKS)).toBe(10); // buckets 9, 10 fell out
		expect(capWindowTaken(a, 32 * DAMAGE_CAP_BUCKET_TICKS)).toBe(0);
		expect(isAtDamageCap(a, 20 * DAMAGE_CAP_BUCKET_TICKS, 6)).toBe(true); // 12 booked = 6/s x 2 s
		expect(isAtDamageCap(a, 20 * DAMAGE_CAP_BUCKET_TICKS, 7)).toBe(false);
		expect(isAtDamageCap(a, 0, undefined)).toBe(false);
	});
});
