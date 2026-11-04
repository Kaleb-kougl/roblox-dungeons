// M2 scoring: exact points per event, the combo (build / decay / hit cut), grazes (once per bullet, never on a hit or
// for a dead player), guard cancels vs swing deletes, room clear / perfect / fast, floor clear, curses, the opt-in
// hash subsystem.
import { describe, expect, it } from "@rbxts/jest-globals";
import { buildEndlessRunConfig } from "shared/run";
import {
	BOSS_NO_HIT_BONUS,
	BUILD_SCORE_SOURCE_NAMES,
	ENDLESS_TREASURE_CONFIG,
	PELLET_SCORE_SOURCE_NAMES,
	SCORE_SOURCE_COUNT,
	TREASURE_SCORE_SOURCE_NAMES,
	scorePellet,
	scorePowerBullets,
	scoreSweep,
	scoreTreasure,
	treasureAwardPoints,
	BULLET_Y,
	BulletKind,
	BulletPayload,
	Button,
	COMBO_MAX,
	COMBO_MIN,
	COMBO_WINDOW_TICKS,
	DEFAULT_SIM_CONFIG,
	EMPTY_INPUT,
	GRAZE_DONE_BIT,
	GRAZE_NEAR_BIT,
	HASH_SUBSYSTEMS,
	HIT_NORMAL,
	KILL_POINTS,
	ROOM_PAR_BASE_TICKS,
	ROOM_PAR_TICKS_PER_COST,
	SimCtx,
	ScoreSource,
	addCurse,
	archetypeAt,
	awardFloorClear,
	awardPoints,
	clearEvents,
	clearScoreEvents,
	compose,
	createSimState,
	floorClearBase,
	floorScalePercent,
	gen,
	hashLayout,
	hashState,
	mod,
	step,
	stepScore,
	writeHashFields,
	type ActorSpawn,
	type ActorState,
	type EncounterConfig,
	type EncounterRoom,
	type InputFrame,
	type ScoreState,
	type SimConfig,
	type SimState,
} from "shared/sim";

const SCORED: SimConfig = { ...DEFAULT_SIM_CONFIG, scoring: {} };
const frame = (over: Partial<InputFrame> = {}): InputFrame => ({ ...EMPTY_INPUT, ...over });
const IDLE = frame();

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

/** Room 0 (south-west, empty) and room 1 (north-east) of the greybox arena. */
const ROOMS = [room(0, -7, -3, -7, -3), room(1, 3, 7, 3, 7)];

function encounter(spawns: ActorSpawn[]): EncounterConfig {
	return { spawns, rooms: ROOMS, entranceRoom: 0, bossRoom: -1 };
}

function scored(spawns: ActorSpawn[] = [], extra: Partial<SimConfig> = {}): SimState {
	return createSimState(1, -6, -6, { ...SCORED, encounter: encounter(spawns), ...extra });
}

function sc(s: SimState): ScoreState {
	return s.score!;
}

const ctxOf = (s: SimState) => new SimCtx().bind(s, SCORED, EMPTY_INPUT);

/**
 * One tick of the scoring pass only (no player / actor / bullet step): clear events, run `during` (the tick's
 * hooks), then stepScore. Mirrors step()'s order around stepCombat.
 */
function tick(s: SimState, during?: (ctx: SimCtx) => void, hits = 0, bossPhase = 0): void {
	clearEvents(s.events);
	clearScoreEvents(sc(s));
	if (during !== undefined) during(ctxOf(s));
	s.events.playerHits += hits;
	if (bossPhase !== 0) s.events.bossPhase = bossPhase;
	stepScore(s);
	s.tick += 1;
}

function actorOf(s: SimState, id: string, nth = 0): ActorState {
	let seen = 0;
	for (const a of s.combat.actors) {
		if (a.kind >= 0 && archetypeAt(a.kind).id === id) {
			if (seen === nth) return a;
			seen++;
		}
	}
	return error(`no ${id} #${nth}`);
}

describe("award arithmetic", () => {
	it("floors base x combo x depth x curse (x floor scaling) exactly", () => {
		const s = scored();
		const st = sc(s);
		expect(awardPoints(s, st, 50)).toBe(50);
		st.combo = 23; // x2.3
		expect(awardPoints(s, st, 50)).toBe(115);
		st.curses = 1; // x1.25
		expect(awardPoints(s, st, 50)).toBe(143); // 143.75
		expect(awardPoints(s, st, 5)).toBe(14); // 14.375
		expect(floorScalePercent(1)).toBe(100);
		expect(floorScalePercent(3)).toBe(116);
		st.combo = 10;
		st.curses = 0;
		expect(awardPoints(s, st, 50, floorScalePercent(3))).toBe(58);
		expect(awardPoints(s, st, 200, floorScalePercent(2))).toBe(216);
	});
});

describe("kills", () => {
	const KINDS = ["swarmer", "sniper", "bruiser", "turret.caster", "turret.sniper", "turret.sprayer"];

	it("score the archetype's base at x1.0, then raise the combo by 0.1", () => {
		const spawns = KINDS.map((kind, i) => ({ kind, x: -6 + i * 2, z: 0 })); // outside both rooms
		const s = scored(spawns);
		const st = sc(s);
		const expected = [50, 100, 200, 150, 150, 150];
		for (let i = 0; i < KINDS.size(); i++) {
			st.combo = COMBO_MIN;
			const before = st.total;
			tick(s, (ctx) => ctx.killActor(actorOf(s, KINDS[i])));
			expect([KINDS[i], st.total - before]).toEqual([KINDS[i], expected[i]]);
			expect(st.combo).toBe(COMBO_MIN + 1);
			expect(st.comboTimer).toBe(COMBO_WINDOW_TICKS);
			expect(st.events.kills).toBe(1);
			expect(st.events.popPoints).toEqual([expected[i]]);
		}
		expect(st.points[ScoreSource.KILLS]).toBe(800);
		expect(st.counts[ScoreSource.KILLS]).toBe(6);
		for (const k of KINDS) expect(KILL_POINTS.get(k)).toBe(expected[KINDS.indexOf(k)]);
	});

	it("a reviving turret scores its first death only", () => {
		const s = scored([{ kind: "turret.caster", x: 0, z: 0 }]);
		const st = sc(s);
		const t = actorOf(s, "turret.caster");
		tick(s, (ctx) => ctx.killActor(t));
		expect(st.total).toBe(150);
		tick(s, (ctx) => {
			ctx.reviveActor(t);
			ctx.killActor(t);
		});
		expect(st.total).toBe(150);
		expect(st.combo).toBe(COMBO_MIN + 1);
		expect(st.scoredReviverIds).toEqual([t.id]);
	});

	it("the boss: 5000 (no floor scaling), +2500 when no hit landed in its final phase", () => {
		for (const hitInFinal of [false, true]) {
			const s = scored([{ kind: "boss.act1", x: 5, z: 5 }]);
			const st = sc(s);
			const boss = actorOf(s, "boss.act1");
			tick(s, undefined, 1); // a hit before the final phase does not matter
			boss.phase = 3;
			tick(s, undefined, 0, 3); // the final phase begins
			expect(st.bossFinalHits).toBe(1);
			if (hitInFinal) tick(s, undefined, 1);
			st.combo = COMBO_MIN;
			tick(s, (ctx) => ctx.killActor(boss));
			const want = hitInFinal ? 5000 : 5000 + BOSS_NO_HIT_BONUS;
			expect([hitInFinal, st.points[ScoreSource.BOSS]]).toEqual([hitInFinal, want]);
			expect(st.events.popPoints).toEqual([want]);
			expect(st.points[ScoreSource.KILLS]).toBe(0);
			expect(st.bossFinalHits).toBe(-1);
		}
	});

	it("a hit landing in the boss's death tick (before the kill) loses the bonus", () => {
		const s = scored([{ kind: "boss.act1", x: 5, z: 5 }]);
		const st = sc(s);
		const boss = actorOf(s, "boss.act1");
		boss.phase = 3;
		tick(s, undefined, 0, 3);
		tick(s, (ctx) => {
			s.events.playerHits += 1;
			ctx.killActor(boss);
		});
		expect(st.points[ScoreSource.BOSS]).toBe(5000);
	});
});

describe("combo", () => {
	it("builds by exact tenths and caps at x5.0", () => {
		const spawns: ActorSpawn[] = [];
		for (let i = 0; i < 45; i++) spawns.push({ kind: "swarmer", x: -7 + (i % 15), z: -1 + math.floor(i / 15) });
		const s = scored(spawns);
		const st = sc(s);
		let expectedTotal = 0;
		for (let i = 0; i < 45; i++) {
			const combo = st.combo;
			expectedTotal += math.floor((50 * combo) / 10);
			tick(s, (ctx) => ctx.killActor(s.combat.actors[i]));
			expect(st.combo).toBe(math.min(COMBO_MAX, combo + 1));
		}
		expect(st.combo).toBe(COMBO_MAX);
		expect(st.maxCombo).toBe(COMBO_MAX);
		expect(st.total).toBe(expectedTotal);
	});

	it("resets after 180 ticks without a kill or graze", () => {
		const s = scored([{ kind: "swarmer", x: 0, z: 0 }]);
		const st = sc(s);
		tick(s, (ctx) => ctx.killActor(actorOf(s, "swarmer")));
		expect(st.combo).toBe(11);
		for (let k = 1; k < COMBO_WINDOW_TICKS; k++) {
			tick(s);
			expect(st.events.comboBroken).toBe(0);
		}
		expect(st.combo).toBe(11);
		expect(st.comboTimer).toBe(1);
		tick(s);
		expect(st.combo).toBe(COMBO_MIN);
		expect(st.events.comboBroken).toBe(1);
		expect(st.events.comboChanged).toBe(1);
		tick(s);
		expect(st.events.comboBroken).toBe(0);
	});

	it("a landed hit halves it solo (floored to the tenth, never below x1.0)", () => {
		const s = scored();
		const st = sc(s);
		st.combo = 50;
		tick(s, undefined, 1);
		expect(st.combo).toBe(25);
		expect(st.events.comboCut).toBe(1);
		tick(s, undefined, 1);
		expect(st.combo).toBe(12); // 12.5 -> 12
		tick(s, undefined, 1);
		expect(st.combo).toBe(10); // 6 -> 10
		st.combo = 40;
		tick(s, undefined, 2);
		expect(st.combo).toBe(10);
		expect(st.hitsTaken).toBe(5);
	});

	it("cuts by 1/partySize in a party of more than two", () => {
		const cuts: number[] = [];
		for (const partySize of [1, 2, 3, 4]) {
			const s = createSimState(1, 0, 0, { ...DEFAULT_SIM_CONFIG, scoring: { partySize } });
			sc(s).combo = 50;
			tick(s, undefined, 1);
			cuts.push(sc(s).combo);
		}
		expect(cuts).toEqual([25, 25, 33, 37]);
		expect(() => createSimState(1, 0, 0, { scoring: { partySize: 0 } })).toThrow(
			"scoring: partySize must be an integer >= 1, got 0",
		);
	});

	it("co-op: the cut divides by the players still PRESENT at the hit (leavers no longer count)", () => {
		const cutWith = (left: number[]): number => {
			const s = createSimState(1, 0, 0, { ...DEFAULT_SIM_CONFIG, party: { size: 4 }, scoring: { partySize: 4 } });
			for (const i of left) s.party!.left[i] = 1;
			sc(s).combo = 50;
			tick(s, undefined, 1);
			return sc(s).combo;
		};
		expect(cutWith([])).toBe(37); // 4 present: 1/4
		expect(cutWith([3])).toBe(33); // 3 present: 1/3
		expect(cutWith([2, 3])).toBe(25); // 2 present: 1/2
		expect(cutWith([1, 2, 3])).toBe(25); // 1 present: still at most 1/2
		expect(cutWith([0, 1, 2, 3])).toBe(25);
	});
});

/** One enemy bullet at (x, z) heading +Z at `speed`. */
function shoot(s: SimState, x: number, z: number, speed: number): void {
	const payload = BulletPayload.pack({ damage: HIT_NORMAL, kind: BulletKind.SNIPER });
	s.combat.enemyBullets.fireAt({ x, y: BULLET_Y, z }, () => compose(gen.arc(1, 0, speed, 0), mod.payload(payload)));
}

function run(s: SimState, n: number, input: InputFrame = IDLE): void {
	for (let k = 0; k < n; k++) step(s, input, SCORED);
}

describe("grazes", () => {
	it("one per bullet that passes through the graze ring, after it leaves it", () => {
		const s = createSimState(1, 0, 0, SCORED);
		const st = sc(s);
		shoot(s, 0.7, -5, 6);
		shoot(s, -0.8, -6, 6);
		shoot(s, 1.2, -5, 6); // outside the ring: never
		let grazeTick = -1;
		for (let k = 0; k < 150; k++) {
			step(s, IDLE, SCORED);
			if (st.events.grazes > 0 && grazeTick < 0) grazeTick = s.tick;
		}
		expect(st.counts[ScoreSource.GRAZES]).toBe(2);
		expect(st.points[ScoreSource.GRAZES]).toBe(5 + 5); // the second graze at x1.1 = 5.5 -> 5
		expect(st.combo).toBe(12);
		expect(s.player.hearts + s.player.armor).toBe(s.player.heartsMax + s.player.armorMax);
		// The first bullet reaches z = 0 after ~50 ticks and leaves the ring at z ~ +0.66.
		expect(grazeTick).toBeGreaterThan(50);
		expect(grazeTick).toBeLessThan(70);
	});

	it("never for a bullet that entered the hit circle (a hit, or a roll's i-frames)", () => {
		const hit = createSimState(1, 0, 0, SCORED);
		shoot(hit, 0, -5, 6);
		run(hit, 150);
		expect(sc(hit).counts[ScoreSource.GRAZES]).toBe(0);
		expect(sc(hit).hitsTaken).toBe(1);

		const dodge = createSimState(1, 0, 0, SCORED);
		dodge.player.iframeTicks = 1000;
		shoot(dodge, 0.3, -5, 6); // passes through the hit circle without landing
		run(dodge, 150);
		expect(sc(dodge).counts[ScoreSource.GRAZES]).toBe(0);
		expect(sc(dodge).hitsTaken).toBe(0);
		expect(dodge.combat.enemyBullets.activeCount).toBe(1);
		const slot = 0;
		expect(bit32.band(dodge.combat.enemyBullets.payloadAt(slot), GRAZE_DONE_BIT)).toBe(GRAZE_DONE_BIT);
	});

	it("never for a dead player", () => {
		const s = createSimState(1, 0, 0, SCORED);
		s.player.dead = 1;
		s.player.hearts = 0;
		shoot(s, 0.7, -5, 6);
		run(s, 150);
		expect(sc(s).counts[ScoreSource.GRAZES]).toBe(0);
	});

	it("flags live in payload bits above the layout and leave damage / kind / source alone", () => {
		const s = createSimState(1, 0, 0, SCORED);
		shoot(s, 0.7, -0.5, 0); // parked inside the ring
		run(s, 2);
		const p = s.combat.enemyBullets.payloadAt(0);
		expect(bit32.band(p, GRAZE_NEAR_BIT)).toBe(GRAZE_NEAR_BIT);
		expect(bit32.band(p, GRAZE_DONE_BIT)).toBe(0);
		expect(BulletPayload.get(p, "damage")).toBe(HIT_NORMAL);
		expect(BulletPayload.get(p, "kind")).toBe(BulletKind.SNIPER);
		expect(sc(s).counts[ScoreSource.GRAZES]).toBe(0);
	});

	it("are off without scoring: payloads untouched", () => {
		const s = createSimState(1, 0, 0, DEFAULT_SIM_CONFIG);
		shoot(s, 0.7, -0.5, 0);
		for (let k = 0; k < 2; k++) step(s, IDLE, DEFAULT_SIM_CONFIG);
		expect(s.score).toBe(undefined);
		expect(s.combat.enemyBullets.payloadAt(0)).toBe(
			BulletPayload.pack({ damage: HIT_NORMAL, kind: BulletKind.SNIPER }),
		);
	});
});

describe("guard cancels", () => {
	/** Three parked bullets in front of the player (facing screen-down, +X +Z), ~1 unit away. */
	function parked(): SimState {
		const s = createSimState(1, 0, 0, SCORED);
		shoot(s, 0.7, 0.7, 0);
		shoot(s, 0.8, 0.6, 0);
		shoot(s, 0.6, 0.8, 0);
		return s;
	}

	it("score 10 per bullet the sword's guard erases", () => {
		const s = parked();
		step(s, frame({ buttons: Button.ALT }), SCORED);
		expect(s.events.bulletsDeleted).toBe(3);
		expect(sc(s).events.guardCancels).toBe(3);
		expect(sc(s).points[ScoreSource.GUARD]).toBe(30);
		expect(sc(s).counts[ScoreSource.GUARD]).toBe(3);
		expect(sc(s).combo).toBe(COMBO_MIN); // the guard does not feed the combo
	});

	it("score nothing when an ordinary swing deletes them", () => {
		const s = parked();
		step(s, frame({ buttons: Button.FIRE }), SCORED);
		expect(s.events.bulletsDeleted).toBeGreaterThan(0);
		expect(sc(s).total).toBe(0);
	});
});

describe("rooms", () => {
	const SPAWNS: ActorSpawn[] = [
		{ kind: "swarmer", x: 5, z: 5 },
		{ kind: "sniper", x: 6, z: 6 },
	];
	const PAR = ROOM_PAR_BASE_TICKS + ROOM_PAR_TICKS_PER_COST * (1 + 2);

	it("records members per room, with par = 6 s + 1.5 s per encounter cost", () => {
		const s = scored([...SPAWNS, { kind: "swarmer", x: 0, z: 0 }]);
		const rooms = sc(s).rooms;
		expect(rooms.size()).toBe(1);
		expect(rooms[0].room).toBe(1);
		expect(rooms[0].memberSlots).toEqual([0, 1]);
		expect(rooms[0].parTicks).toBe(PAR);
		expect(PAR).toBe(630);
		expect(rooms[0].engageTick).toBe(-1);
	});

	it("clear 250 + perfect 500 + 1 per tick under par, at the combo of the clearing tick", () => {
		const s = scored(SPAWNS);
		const st = sc(s);
		tick(s);
		expect(st.rooms[0].engageTick).toBe(-1); // nothing happened yet
		tick(s, (ctx) => ctx.killActor(actorOf(s, "swarmer")));
		const engaged = st.rooms[0].engageTick;
		expect(engaged).toBe(1);
		for (let k = 0; k < 99; k++) tick(s);
		const before = st.total;
		tick(s, (ctx) => ctx.killActor(actorOf(s, "sniper")));
		// The sniper kill at x1.1 = 110; the clear at x1.2 (both kills fed the combo).
		const elapsed = 100;
		const fast = math.floor(((PAR - elapsed) * 12) / 10);
		expect(st.total - before).toBe(110 + 300 + 600 + fast);
		expect(st.points[ScoreSource.ROOMS]).toBe(300);
		expect(st.points[ScoreSource.PERFECT]).toBe(600);
		expect(st.points[ScoreSource.FAST]).toBe(fast);
		expect(st.rooms[0].cleared).toBe(1);
		expect(st.events.roomsCleared).toBe(1);
		tick(s);
		expect(st.points[ScoreSource.ROOMS]).toBe(300); // once
	});

	it("no perfect after a hit since engagement (the engagement tick's hits count); no fast past par", () => {
		const s = scored(SPAWNS);
		const st = sc(s);
		s.player.x = 4; // the player walks in: the room engages
		s.player.z = 4;
		tick(s, undefined, 1);
		expect(st.rooms[0].engageTick).toBe(0);
		for (let k = 0; k < PAR + 10; k++) tick(s);
		st.combo = COMBO_MIN;
		tick(s, (ctx) => {
			ctx.killActor(actorOf(s, "swarmer"));
			ctx.killActor(actorOf(s, "sniper"));
		});
		expect(st.points[ScoreSource.ROOMS]).toBe(300);
		expect(st.points[ScoreSource.PERFECT]).toBe(0);
		expect(st.points[ScoreSource.FAST]).toBe(0);
	});

	it("hits before the room engaged do not spoil perfect", () => {
		const s = scored(SPAWNS);
		const st = sc(s);
		tick(s, undefined, 1);
		tick(s, (ctx) => {
			ctx.killActor(actorOf(s, "swarmer"));
			ctx.killActor(actorOf(s, "sniper"));
		});
		expect(st.points[ScoreSource.PERFECT]).toBeGreaterThan(0);
		expect(st.points[ScoreSource.FAST]).toBe(math.floor((PAR * 12) / 10)); // cleared on its engagement tick
	});
});

const SPAWNS_FLOOR: ActorSpawn[] = [
	{ kind: "swarmer", x: 5, z: 5 },
	{ kind: "sniper", x: 6, z: 6 },
];

describe("floors and curses", () => {
	it("awardFloorClear scores 1000 x floor through the multipliers; addCurse adds +0.25", () => {
		const s = scored();
		expect(awardFloorClear(s, 1)).toBe(1000);
		expect(awardFloorClear(s, 3)).toBe(3000);
		sc(s).combo = 15;
		expect(awardFloorClear(s, 2)).toBe(3000);
		sc(s).combo = COMBO_MIN;
		addCurse(s);
		expect(sc(s).curses).toBe(1);
		expect(awardFloorClear(s, 1)).toBe(1250);
		expect(sc(s).points[ScoreSource.FLOORS]).toBe(8250);
		expect(sc(s).counts[ScoreSource.FLOORS]).toBe(4);
	});

	it("floorClearBase: 1000 x floor x cleared / total, rounded down before the multipliers", () => {
		expect(floorClearBase(3, 0, 0)).toBe(3000); // nothing to clear: the full bonus
		expect(floorClearBase(3, 0, 4)).toBe(0); // sprinted past every room
		expect(floorClearBase(3, 1, 4)).toBe(750);
		expect(floorClearBase(1, 1, 3)).toBe(333); // 333.33 -> 333
		expect(floorClearBase(2, 2, 3)).toBe(1333); // 1333.33 -> 1333
		expect(floorClearBase(7, 5, 6)).toBe(5833); // 5833.33 -> 5833
		expect(floorClearBase(4, 4, 4)).toBe(4000);
		expect(floorClearBase(4, 9, 4)).toBe(4000); // never more than the full bonus
	});

	it("awardFloorClear pays by the share of the floor's enemy rooms cleared; a boss floor's boss is one room", () => {
		// One room with enemies (room 1); not cleared yet.
		const s = scored(SPAWNS_FLOOR);
		expect(sc(s).rooms.size()).toBe(1);
		expect(awardFloorClear(s, 2)).toBe(0);
		expect(awardFloorClear(s, 2, true, true)).toBe(1000); // + the boss: 1 of 2
		expect(awardFloorClear(s, 2, true, false)).toBe(0);
		sc(s).combo = 20; // x2.0 applies after the ratio's rounding
		expect(awardFloorClear(s, 1, true, true)).toBe(1000); // floor(1000 x 1 / 2) x 2
		sc(s).combo = COMBO_MIN;
		tick(s, undefined);
		tick(s, (ctx) => {
			ctx.killActor(actorOf(s, "swarmer"));
			ctx.killActor(actorOf(s, "sniper"));
		});
		expect(sc(s).rooms[0].cleared).toBe(1);
		sc(s).combo = COMBO_MIN; // the two kills fed it
		expect(awardFloorClear(s, 2)).toBe(2000);
		expect(awardFloorClear(s, 3, true, false)).toBe(1500);
	});

	it("are no-ops without scoring", () => {
		const s = createSimState(1, 0, 0);
		expect(awardFloorClear(s, 2)).toBe(0);
		addCurse(s);
		expect(s.score).toBe(undefined);
	});
});

describe("hash", () => {
	it("an unscored state hashes the six M1 subsystems only", () => {
		const s = createSimState(1, 0, 0, DEFAULT_SIM_CONFIG);
		const layout = hashLayout(s, true);
		expect(layout.groups.map((g) => g.name)).toEqual([...HASH_SUBSYSTEMS]);
	});

	it("a scored state appends the score subsystem, named field by field, covering every score field", () => {
		const s = scored([{ kind: "swarmer", x: 5, z: 5 }]);
		const layout = hashLayout(s, true);
		const names = layout.groups.map((g) => g.name);
		expect(names[names.size() - 1]).toBe("score");
		expect(layout.values).toEqual(writeHashFields(s, []));
		expect(layout.names.size()).toBe(layout.values.size());
		const g = layout.groups[layout.groups.size() - 1];
		expect(layout.names[g.start]).toBe("score.total");
		const h0 = hashState(s);
		sc(s).comboTimer = 7;
		expect(hashState(s)).never.toBe(h0);
		sc(s).comboTimer = 0;
		sc(s).rooms[0].engageTick = 3;
		expect(hashState(s)).never.toBe(h0);
	});

	it("scoring does not change the unscored part of the state for the same input", () => {
		const a = createSimState(1, 0, 0, DEFAULT_SIM_CONFIG);
		const b = createSimState(1, 0, 0, SCORED);
		const la = hashLayout(a).values;
		const lb = hashLayout(b).values;
		for (let i = 0; i < la.size(); i++) expect(lb[i]).toBe(la[i]);
	});
});

describe("treasure score source (docs/TREASURE.md TR2, TRD11 / correction 5)", () => {
	const SEED = 4242;
	const setup = buildEndlessRunConfig(SEED);
	/**
	 * The endless config with each of builds / pellets / treasure on or off, and without pacts and the Goldling
	 * (docs/FORTUNE.md: their HORDE 13 / GOLDEN 14 follow TREASURE and pad it; run/endless.spec.ts pins those subsets).
	 */
	function subset(builds: boolean, pellets: boolean, treasure: boolean): SimConfig {
		return {
			...setup.config,
			builds: builds ? setup.config.builds : undefined,
			pellets: pellets ? setup.config.pellets : undefined,
			treasure: treasure ? ENDLESS_TREASURE_CONFIG : undefined,
			pacts: undefined,
			golden: undefined,
		};
	}
	const make = (config: SimConfig) => createSimState(SEED, setup.spawn!.x, setup.spawn!.z, config);

	it("TREASURE is source 12, named `treasure`, after the pellet sources", () => {
		expect(ScoreSource.TREASURE).toBe(12);
		expect(TREASURE_SCORE_SOURCE_NAMES).toEqual(["treasure"]);
		expect(
			SCORE_SOURCE_COUNT +
				BUILD_SCORE_SOURCE_NAMES.size() +
				PELLET_SCORE_SOURCE_NAMES.size() +
				TREASURE_SCORE_SOURCE_NAMES.size(),
		).toBe(13);
	});

	it("padding for every subset of builds / pellets / treasure: sizes and the dump names' tail", () => {
		const cases: Array<[boolean, boolean, boolean, number, string]> = [
			[false, false, false, 9, "breakables"],
			[true, false, false, 10, "jackpot"],
			[false, true, false, 12, "sweep"],
			[true, true, false, 12, "sweep"],
			[false, false, true, 13, "treasure"],
			[true, false, true, 13, "treasure"],
			[false, true, true, 13, "treasure"],
			[true, true, true, 13, "treasure"],
		];
		for (const [b, p, t, size, last] of cases) {
			const st = make(subset(b, p, t));
			const sc = st.score!;
			expect([b, p, t, sc.points.size(), sc.counts.size()]).toEqual([b, p, t, size, size]);
			const names = hashLayout(st, true).names;
			expect(names.includes(`score.points.${last}`)).toBe(true);
			expect(names.includes(`score.counts.${last}`)).toBe(true);
			expect(names.includes("score.points.treasure")).toBe(t);
			for (const n of sc.points) expect(n).toBe(0);
		}
	});

	it("the award: floor(base x Depth x (4 + curses) / 4), the combo neither applied nor fed", () => {
		const st = make(subset(true, true, true));
		const sc = st.score!;
		sc.combo = 37;
		sc.comboTimer = COMBO_WINDOW_TICKS / 2;
		const cases: Array<[number, number, number, number]> = [
			// [base, depth, curses, points]
			[300, 1, 0, 300],
			[800, 3, 1, 3000],
			[1500, 2, 3, 5250],
			[301, 1, 1, 376], // 376.25
			[300, 1, 3, 525],
		];
		for (const [base, depth, curses, pts] of cases) {
			st.endless!.depth = depth;
			sc.curses = curses;
			expect([base, depth, curses, treasureAwardPoints(st, sc, base)]).toEqual([base, depth, curses, pts]);
		}
		st.endless!.depth = 2;
		sc.curses = 1;
		const total = sc.total;
		expect(scoreTreasure(st, 800)).toBe(2000);
		expect(scoreTreasure(st, 300)).toBe(750);
		expect([sc.points[ScoreSource.TREASURE], sc.counts[ScoreSource.TREASURE]]).toEqual([2750, 2]);
		expect([sc.total - total, sc.events.points]).toEqual([2750, 2750]);
		expect([sc.combo, sc.comboTimer, sc.events.comboFed]).toEqual([37, COMBO_WINDOW_TICKS / 2, 0]);
	});

	it("gated: no treasure sources -> 0 and nothing booked; treasure alone keeps the padded JACKPOT / PELLETS / SWEEP at 0", () => {
		const none = make(subset(true, true, false));
		expect(scoreTreasure(none, 800)).toBe(0);
		expect([none.score!.total, none.score!.points.size()]).toEqual([0, 12]);
		const unscored = make({ ...subset(true, true, true), scoring: undefined });
		expect(scoreTreasure(unscored, 800)).toBe(0);
		const alone = make(subset(false, false, true));
		expect(scoreTreasure(alone, 800)).toBe(800);
		// The pellet awards need state.pellets: absent here, so they pay nothing into the padded sources.
		expect([scorePellet(alone), scoreSweep(alone), scorePowerBullets(alone, 5)]).toEqual([0, 0, 0]);
		const sc = alone.score!;
		for (const k of [ScoreSource.JACKPOT, ScoreSource.PELLETS, ScoreSource.SWEEP])
			expect([k, sc.points[k], sc.counts[k]]).toEqual([k, 0, 0]);
		expect(sc.total).toBe(800);
	});
});
