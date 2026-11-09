// The run-over recap's core (docs/RUN_RECAP.md RR2):
//   - nearMissFor: every candidate at its edge (25 / 26 % boss, 15 % gap, the deepest floor, 10 / 11 path tiles, 2 / 3
//     rooms left, the pre-boss floor), RRD2's order, record-run drops and the dim line, FIRST RECORD none, unknown /
//     unranked / none baselines, daily best today, dev and other worlds
//   - pickHighlights: priority, one slot per priority, cap 4, fill to 2, every notable edge, source guards, Team / You
//     (You = the local player, never the spectate view: docs/RUN_CONTRIBUTION.md CT1)
//   - stairsPathTiles on small grids; the no-hit / boss-kill split (RR0 2)
//   - RecapTimeline: row order and start times, count-up and sound edges, the arm, skip before the arm, reduced motion,
//     the record offset, the verdict's silent re-derive
import { describe, expect, it } from "@rbxts/jest-globals";
import { TileType, type Dungeon } from "shared/dungeon";
import { SCORE_SOURCE_COUNT, ScoreSource } from "shared/sim";
import { NO_RECAP_TALLY } from "shared/view/fx";
import {
	RECAP,
	RECAP_HIGHLIGHTS,
	RECAP_STRINGS,
	RecapTimeline,
	bossKillsOf,
	bossNoHitAwards,
	nearMissFor,
	pickHighlights,
	recapBossPercent,
	recapHighlightRow,
	recapNearMissRow,
	recapStringKeys,
	stairsPathTiles,
	type RecapFrame,
	type RecapRowSpec,
	type RunBaseline,
	type RunOverRecords,
	type RunRecapInput,
} from ".";

const NO_RECORD: RunOverRecords = { record: false, first: false, fromServer: false, rows: [] };
const KNOWN: RunBaseline = { kind: "known", board: "solo", score: 10000, floor: 8 };
/** Every source a pellets + builds run has (JACKPOT, PELLETS, SWEEP). */
const FULL_SOURCES = ScoreSource.SWEEP + 1;

function sources(values: Readonly<Partial<Record<number, number>>>, size = SCORE_SOURCE_COUNT): number[] {
	const out: number[] = [];
	for (let i = 0; i < size; i++) out.push(values[i] ?? 0);
	return out;
}

function input(patch: Partial<RunRecapInput> = {}): RunRecapInput {
	return {
		world: "endless",
		partySize: 1,
		localIndex: 0,
		score: { total: 1000, maxCombo: 10, points: sources({}), counts: sources({}) },
		kills: 20,
		floor: 3,
		depth: 1,
		builds: { duos: 0, evolutions: 0 },
		bossFloor: false,
		boss: undefined,
		nextBossId: undefined,
		stairsTiles: undefined,
		roomsCleared: 0,
		roomsUncleared: 0,
		baseline: KNOWN,
		records: NO_RECORD,
		tally: { ...NO_RECAP_TALLY, parries: [], grazes: [] },
		...patch,
	};
}

function bossAt(fraction: number, alive = true, engaged = true): Partial<RunRecapInput> {
	return { bossFloor: true, boss: { engaged, alive, hpFraction: fraction, bossId: "boss.demonlord" } };
}

/** An input where every candidate applies (boss floor facts aside: candidates 4-5 need a non-boss floor). */
const EVERYTHING: Partial<RunRecapInput> = {
	score: { total: 9000, maxCombo: 10, points: sources({}), counts: sources({}) },
	floor: 8,
	stairsTiles: 5,
	roomsCleared: 3,
	roomsUncleared: 1,
	nextBossId: "boss.act1",
};

describe("nearMissFor: each candidate at its edge", () => {
	it("boss: engaged, alive, at 25 % applies (pct, the boss's name key); 26 %, dead or not engaged does not", () => {
		const at25 = nearMissFor(input(bossAt(0.25)))!;
		expect(at25.kind).toBe("boss");
		expect(at25.key).toBe(RECAP_STRINGS.nearBoss);
		expect(at25.vars).toEqual({ pct: 25 });
		expect(at25.bossKey).toBe("boss.demonlord.name");
		expect(at25.countVar).toBe("pct");
		expect(at25.dim).toBe(false);
		expect(nearMissFor(input(bossAt(0.26)))).toBe(undefined);
		expect(nearMissFor(input(bossAt(0.1, false)))).toBe(undefined);
		expect(nearMissFor(input(bossAt(0.1, true, false)))).toBe(undefined);
		expect(nearMissFor(input({ ...bossAt(0.1), bossFloor: false }))).toBe(undefined);
		expect([recapBossPercent(0.09), recapBossPercent(0.001), recapBossPercent(0.245)]).toEqual([9, 1, 25]);
	});

	it("score: a gap of 15 % of the best applies; 15 % + 1 and a passed best do not", () => {
		const s = (total: number) =>
			input({ score: { total, maxCombo: 10, points: sources({}), counts: sources({}) } });
		const n = nearMissFor(s(8500))!;
		expect([n.kind, n.key, n.vars.gap, n.countVar]).toEqual(["score", RECAP_STRINGS.nearScore, 1500, "gap"]);
		expect(nearMissFor(s(8499))).toBe(undefined);
		expect(nearMissFor(s(10000))).toBe(undefined);
		expect(nearMissFor(s(12000))).toBe(undefined);
	});

	it("recordFloor: died on the deepest floor applies; a floor above it does not", () => {
		const n = nearMissFor(input({ floor: 8 }))!;
		expect([n.kind, n.key, n.countVar]).toEqual(["recordFloor", RECAP_STRINGS.nearRecordFloor, undefined]);
		expect(nearMissFor(input({ floor: 7 }))).toBe(undefined);
	});

	it("stairs: 10 path tiles applies (next floor), 11 does not, nor a boss floor", () => {
		const n = nearMissFor(input({ stairsTiles: 10 }))!;
		expect([n.kind, n.key, n.vars.tiles, n.vars.next, n.countVar]).toEqual([
			"stairs",
			RECAP_STRINGS.nearStairs,
			10,
			4,
			"tiles",
		]);
		expect(nearMissFor(input({ stairsTiles: 11 }))).toBe(undefined);
		expect(nearMissFor(input({ stairsTiles: 3, bossFloor: true }))).toBe(undefined);
	});

	it("fullClear: 2 rooms left applies, 1 uses the singular key, 3 or no room cleared does not", () => {
		const two = nearMissFor(input({ roomsCleared: 4, roomsUncleared: 2 }))!;
		expect([two.kind, two.key, two.vars.rooms, two.countVar]).toEqual([
			"fullClear",
			RECAP_STRINGS.nearFullClear,
			2,
			"rooms",
		]);
		const one = nearMissFor(input({ roomsCleared: 4, roomsUncleared: 1 }))!;
		expect([one.key, one.countVar]).toEqual([RECAP_STRINGS.nearFullClearOne, undefined]);
		expect(nearMissFor(input({ roomsCleared: 4, roomsUncleared: 3 }))).toBe(undefined);
		expect(nearMissFor(input({ roomsCleared: 0, roomsUncleared: 2 }))).toBe(undefined);
		expect(nearMissFor(input({ roomsCleared: 4, roomsUncleared: 2, bossFloor: true }))).toBe(undefined);
	});

	it("nextBoss: the floor before a boss floor names its boss", () => {
		const n = nearMissFor(input({ nextBossId: "boss.act1" }))!;
		expect([n.kind, n.key, n.bossKey, n.countVar]).toEqual([
			"nextBoss",
			RECAP_STRINGS.nearNextBoss,
			"boss.act1.name",
			undefined,
		]);
	});
});

describe("nearMissFor: order and rules", () => {
	it("RRD2's order: boss > score > recordFloor > stairs > fullClear > nextBoss", () => {
		const kinds: string[] = [];
		let p: Partial<RunRecapInput> = { ...EVERYTHING, ...bossAt(0.1) };
		kinds.push(nearMissFor(input(p))!.kind);
		p = { ...EVERYTHING };
		kinds.push(nearMissFor(input(p))!.kind);
		p = { ...p, score: { total: 100, maxCombo: 10, points: sources({}), counts: sources({}) } };
		kinds.push(nearMissFor(input(p))!.kind);
		p = { ...p, floor: 5 };
		kinds.push(nearMissFor(input(p))!.kind);
		p = { ...p, stairsTiles: undefined };
		kinds.push(nearMissFor(input(p))!.kind);
		p = { ...p, roomsUncleared: 0 };
		kinds.push(nearMissFor(input(p))!.kind);
		p = { ...p, nextBossId: undefined };
		expect(nearMissFor(input(p))).toBe(undefined);
		expect(kinds).toEqual(["boss", "score", "recordFloor", "stairs", "fullClear", "nextBoss"]);
	});

	it("a score record drops the score candidate, a deepest record the floor one; the first remaining shows dim", () => {
		const scoreRecord: RunOverRecords = {
			record: true,
			first: false,
			fromServer: false,
			rows: [{ kind: "score", from: 10000, to: 12000, delta: 2000 }],
		};
		const n = nearMissFor(input({ ...EVERYTHING, records: scoreRecord }))!;
		expect([n.kind, n.dim]).toEqual(["recordFloor", true]);
		const both: RunOverRecords = {
			...scoreRecord,
			rows: [scoreRecord.rows[0], { kind: "floor", from: 8, to: 9, delta: 1 }],
		};
		const m = nearMissFor(input({ ...EVERYTHING, records: both }))!;
		expect([m.kind, m.dim]).toEqual(["stairs", true]);
		// The boss stays (it is not about a record).
		expect(nearMissFor(input({ ...EVERYTHING, ...bossAt(0.1), records: both }))!.kind).toBe("boss");
	});

	it("FIRST RECORD shows none", () => {
		const first: RunOverRecords = {
			record: true,
			first: true,
			fromServer: false,
			rows: [{ kind: "score", from: 0, to: 900, delta: 900 }],
		};
		expect(nearMissFor(input({ ...EVERYTHING, ...bossAt(0.1), records: first }))).toBe(undefined);
	});

	it("unknown, unranked and none baselines skip the score and floor candidates", () => {
		const baselines: RunBaseline[] = [
			{ kind: "unknown", board: "solo" },
			{ kind: "unranked" },
			{ kind: "none", board: "solo", score: 10000, floor: 8 },
		];
		for (const baseline of baselines) {
			expect(nearMissFor(input({ ...EVERYTHING, baseline }))!.kind).toBe("stairs");
		}
	});

	it("daily: the score candidate compares with best today; no recordFloor", () => {
		const daily: RunBaseline = { kind: "known", board: "solo", score: 5000, floor: 8, daily: true };
		const s = { total: 8000, maxCombo: 10, points: sources({}), counts: sources({}) };
		const today = nearMissFor(input({ world: "daily", baseline: daily, score: s, dailyBestToday: 9000 }))!;
		expect([today.kind, today.vars.gap]).toEqual(["score", 1000]);
		expect(nearMissFor(input({ world: "daily", baseline: daily, score: s, floor: 8 }))).toBe(undefined);
		const near = { ...s, total: 4500 };
		expect(nearMissFor(input({ world: "daily", baseline: daily, score: near }))!.vars.gap).toBe(500);
	});

	it("dev runs and other worlds get no line", () => {
		expect(nearMissFor(input({ ...EVERYTHING, ...bossAt(0.1), world: "dev" }))).toBe(undefined);
		expect(nearMissFor(input({ ...EVERYTHING, ...bossAt(0.1), world: "other" }))).toBe(undefined);
	});

	it("a verdict with other numbers re-derives: the same input shape, the new numbers", () => {
		const s = (total: number) => ({ total, maxCombo: 10, points: sources({}), counts: sources({}) });
		expect(nearMissFor(input({ score: s(9000) }))!.vars.gap).toBe(1000);
		expect(nearMissFor(input({ score: s(9200) }))!.vars.gap).toBe(800);
	});
});

describe("boss kills and no-hit awards (RR0 2)", () => {
	it("kills = Depth gained; no-hits = counts[BOSS] - kills, within 0..kills", () => {
		expect([bossKillsOf(3), bossKillsOf(5, 4), bossKillsOf(1)]).toEqual([2, 1, 0]);
		expect([bossNoHitAwards(3, 3), bossNoHitAwards(2, 3), bossNoHitAwards(4, 3), bossNoHitAwards(1, 1)]).toEqual([
			1, 0, 2, 0,
		]);
	});
});

function ids(list: ReadonlyArray<{ id: string }>): string[] {
	const out: string[] = [];
	for (const h of list) out.push(h.id);
	return out;
}

describe("pickHighlights", () => {
	it("notable ones in priority order, at most 4", () => {
		const h = pickHighlights(
			input({
				depth: 3,
				score: {
					total: 50000,
					maxCombo: 42,
					points: sources({}),
					counts: sources({ [ScoreSource.BOSS]: 3, [ScoreSource.PERFECT]: 7, [ScoreSource.ROOMS]: 11 }),
				},
				builds: { duos: 2, evolutions: 3 },
				tally: { ...NO_RECAP_TALLY, parries: [14], grazes: [0] },
			}),
		);
		expect(ids(h)).toEqual(["bossNoHit", "combo", "perfect", "duos"]);
		expect(h.size()).toBe(RECAP.maxHighlights);
		expect([h[0].value, h[1].value, h[1].from, h[1].format]).toEqual([1, 42, 10, "combo"]);
		expect([h[1].tierKey, h[1].colourRole]).toEqual(["hud.combo.dominating", "combo.dominating"]);
		expect([h[2].key, h[2].value, h[2].valueKey, h[2].vars?.total]).toEqual([
			RECAP_STRINGS.hlPerfect,
			7,
			RECAP_STRINGS.hlOfTotal,
			11,
		]);
		for (const c of h) expect(c.scope).toBe(undefined);
	});

	it("one slot per priority: bosses without a no-hit, duos before evolved", () => {
		const bosses = pickHighlights(
			input({ depth: 3, score: { total: 1, maxCombo: 10, points: sources({}), counts: sources({ 7: 2 }) } }),
		);
		expect([bosses[0].id, bosses[0].value]).toEqual(["bosses", 2]);
		expect(ids(pickHighlights(input({ builds: { duos: 1, evolutions: 3 } })))).toEqual(["duos", "kills"]);
		expect(ids(pickHighlights(input({ builds: { duos: 0, evolutions: 3 } })))).toEqual(["evolved", "kills"]);
		// A dev run's start Depth (docs/DEV_MODE.md): kills from there.
		const dev = pickHighlights(
			input({
				world: "dev",
				depth: 5,
				startDepth: 4,
				score: { total: 1, maxCombo: 10, points: sources({}), counts: sources({ 7: 1 }) },
			}),
		);
		expect([dev[0].id, dev[0].value]).toEqual(["bosses", 1]);
	});

	it("fills to 2 with Kills and Rooms cleared", () => {
		const short = pickHighlights(
			input({ kills: 7, score: { total: 1, maxCombo: 10, points: sources({}), counts: sources({ 3: 2 }) } }),
		);
		expect(ids(short)).toEqual(["kills", "rooms"]);
		expect([short[0].value, short[1].value]).toEqual([7, 2]);
		const one = pickHighlights(
			input({ score: { total: 1, maxCombo: 20, points: sources({}), counts: sources({}) } }),
		);
		expect(ids(one)).toEqual(["combo", "kills"]);
	});

	it("notable edges: combo x2, perfect >= 3 or >= 50 %, parries 5, grazes 50, speed 3 rooms under par", () => {
		const one = (patch: Partial<RunRecapInput>) => ids(pickHighlights(input(patch)))[0];
		const sc = (maxCombo: number, counts: Partial<Record<number, number>>, points = {}) => ({
			score: { total: 1, maxCombo, points: sources(points), counts: sources(counts) },
		});
		expect([one(sc(19, {})), one(sc(20, {}))]).toEqual(["kills", "combo"]);
		expect(one(sc(10, { [ScoreSource.PERFECT]: 3, [ScoreSource.ROOMS]: 10 }))).toBe("perfect");
		expect(one(sc(10, { [ScoreSource.PERFECT]: 2, [ScoreSource.ROOMS]: 10 }))).toBe("kills");
		expect(one(sc(10, { [ScoreSource.PERFECT]: 2, [ScoreSource.ROOMS]: 4 }))).toBe("perfect");
		expect(one(sc(10, { [ScoreSource.PERFECT]: 1, [ScoreSource.ROOMS]: 3 }))).toBe("kills");
		expect([
			one({ tally: { ...NO_RECAP_TALLY, parries: [4], grazes: [] } }),
			one({ tally: { ...NO_RECAP_TALLY, parries: [5], grazes: [] } }),
		]).toEqual(["kills", "parries"]);
		expect([one(sc(10, { [ScoreSource.GRAZES]: 49 })), one(sc(10, { [ScoreSource.GRAZES]: 50 }))]).toEqual([
			"kills",
			"grazes",
		]);
		const fast = (n: number) => sc(10, { [ScoreSource.FAST]: n }, { [ScoreSource.FAST]: 1240 });
		expect([one(fast(2)), one(fast(3))]).toEqual(["kills", "speed"]);
		expect(pickHighlights(input(fast(3)))[0].value).toBe(1240);
		expect(pickHighlights(input(fast(3)))[0].valueKey).toBe(RECAP_STRINGS.hlPoints);
	});

	it("Sweeps and Jackpots only when the run has the source", () => {
		const counts = sources({ [ScoreSource.SWEEP]: 2, [ScoreSource.JACKPOT]: 1 }, FULL_SOURCES);
		const h = pickHighlights(
			input({ score: { total: 1, maxCombo: 10, points: sources({}, FULL_SOURCES), counts } }),
		);
		expect(ids(h)).toEqual(["sweeps", "jackpots"]);
		expect([h[0].value, h[1].value]).toEqual([2, 1]);
		expect(ids(pickHighlights(input()))).toEqual(["kills", "rooms"]);
	});

	it("Chests (docs/TREASURE.md, the reserved slot): only in treasure runs, from 1 opened, after Sweeps, a Team value", () => {
		const chests = (opened: number) => ({ opened, kept: 0, legendary: 0 });
		// no treasure rooms in the run: never a Chests row, whatever else is notable
		expect(ids(pickHighlights(input()))).toEqual(["kills", "rooms"]);
		expect(ids(pickHighlights(input({ chests: chests(0) })))).toEqual(["kills", "rooms"]);
		const h = pickHighlights(input({ chests: { opened: 3, kept: 1, legendary: 1 } }));
		expect(ids(h)).toEqual(["chests", "kills"]);
		expect([h[0].value, h[0].key, h[0].scope]).toEqual([3, RECAP_STRINGS.hlChests, undefined]);
		// its priority sits between Sweeps and Grazes
		const counts = sources({ [ScoreSource.SWEEP]: 1, [ScoreSource.GRAZES]: 60 }, FULL_SOURCES);
		const score = { total: 1, maxCombo: 10, points: sources({}, FULL_SOURCES), counts };
		expect(ids(pickHighlights(input({ score, chests: chests(2) })))).toEqual(["sweeps", "chests", "grazes"]);
		// co-op: the party's opens, labelled Team
		const coop = pickHighlights(input({ partySize: 2, chests: chests(2) }));
		expect([coop[0].id, coop[0].scope]).toEqual(["chests", "team"]);
	});

	it("co-op: Team and You labels, the local player's tally, TEAM PERFECT, the team rows", () => {
		const h = pickHighlights(
			input({
				partySize: 2,
				localIndex: 1,
				score: {
					total: 1,
					maxCombo: 20,
					points: sources({}),
					counts: sources({ [ScoreSource.PERFECT]: 4, [ScoreSource.ROOMS]: 5, [ScoreSource.GRAZES]: 500 }),
				},
				tally: { ...NO_RECAP_TALLY, parries: [40, 6], grazes: [450, 50] },
				team: { teamPerfects: 4, bestTeamStreak: 3, syncParries: 2 },
			}),
		);
		expect(ids(h)).toEqual(["combo", "perfect", "teamStreak", "parries"]);
		expect([h[0].scope, h[1].scope, h[2].scope, h[3].scope]).toEqual(["team", undefined, undefined, "you"]);
		expect([h[1].key, h[3].value]).toEqual([RECAP_STRINGS.hlTeamPerfect, 6]);
		const g = pickHighlights(
			input({
				partySize: 2,
				localIndex: 1,
				tally: { ...NO_RECAP_TALLY, parries: [], grazes: [450, 50] },
				team: undefined,
			}),
		);
		expect(ids(g)).toEqual(["grazes", "kills"]);
		expect([g[0].value, g[0].scope, g[1].scope]).toEqual([50, "you", "team"]);
		const sync = pickHighlights(
			input({ partySize: 3, team: { teamPerfects: 0, bestTeamStreak: 0, syncParries: 1 } }),
		);
		expect(ids(sync)).toEqual(["syncParries", "kills"]);
	});

	it("CT1: You is the local player, not the view: player 0 died first and spectated player 1 at the wipe", () => {
		// The spectate view stays on player 1 at the wipe; the local client is player 0: its own parries and grazes show.
		const tally = { ...NO_RECAP_TALLY, parries: [7, 30], grazes: [60, 300] };
		const h = pickHighlights(input({ partySize: 2, localIndex: 0, tally }));
		expect(ids(h)).toEqual(["parries", "grazes"]);
		expect([h[0].value, h[0].scope, h[1].value, h[1].scope]).toEqual([7, "you", 60, "you"]);
		// player 1's own client shows player 1's
		const other = pickHighlights(input({ partySize: 2, localIndex: 1, tally }));
		expect([other[0].value, other[1].value]).toEqual([30, 300]);
	});

	it("solo runs never show the team rows; other worlds show nothing", () => {
		const team = { teamPerfects: 9, bestTeamStreak: 9, syncParries: 9 };
		expect(ids(pickHighlights(input({ team })))).toEqual(["kills", "rooms"]);
		expect(pickHighlights(input({ world: "other", kills: 50 })).size()).toBe(0);
	});

	it("the table is in priority order and every key is a recap string", () => {
		const keys = recapStringKeys();
		let last = 0;
		for (const d of RECAP_HIGHLIGHTS) {
			expect(d.priority >= last).toBe(true);
			last = d.priority;
			expect(keys.includes(d.key)).toBe(true);
		}
		expect(keys.includes("run.recap.near.fullClearOne")).toBe(true);
		expect(keys.size()).toBe(30);
	});
});

/** A bare grid from rows (row = grid y = world z; tile centres at whole world units): '#' WALL, '.' FLOOR. */
function grid(rows: ReadonlyArray<string>): Dungeon {
	const H = rows.size();
	const W = rows[0].size();
	const cells: number[] = [];
	for (const row of rows)
		for (let x = 1; x <= W; x++) cells.push(string.sub(row, x, x) === "." ? TileType.FLOOR : TileType.WALL);
	return { W, H, grid: cells } as unknown as Dungeon;
}

describe("stairsPathTiles", () => {
	// A corridor along row 1 (x 1..14), a wall-locked pocket at the end of row 3.
	const d = grid([
		"################",
		"#..............#",
		"################",
		"#############..#",
		"################",
	]);
	it("walking tiles to the open stairwell: 10 and 11", () => {
		const floor = { dungeon: d, stairX: 11, stairZ: 1, stairsOpen: true };
		expect(stairsPathTiles(floor, 1, 1)).toBe(10);
		expect(stairsPathTiles({ ...floor, stairX: 12 }, 1, 1)).toBe(11);
		expect(stairsPathTiles(floor, 11, 1)).toBe(0);
	});

	it("undefined when the stairs are closed or nothing connects them", () => {
		expect(stairsPathTiles({ dungeon: d, stairX: 11, stairZ: 1, stairsOpen: false }, 1, 1)).toBe(undefined);
		expect(stairsPathTiles({ dungeon: d, stairX: 14, stairZ: 3, stairsOpen: true }, 1, 1)).toBe(undefined);
	});
});

const DT = 1 / 60;

interface Trace {
	readonly firstShown: number[];
	readonly lands: number;
	readonly landTimes: number[];
	readonly ticks: number;
	readonly armedAt: number;
	readonly settledAt: number;
	readonly values: number[][];
}

/** Steps `tl` for `sec` seconds at 60 Hz, tracing every row and edge. */
function run(tl: RecapTimeline, sec: number): Trace {
	const firstShown: number[] = [];
	const values: number[][] = [];
	for (let i = 0; i < tl.rows.size(); i++) {
		firstShown.push(-1);
		values.push([]);
	}
	let lands = 0;
	const landTimes: number[] = [];
	let ticks = 0;
	let armedAt = -1;
	let settledAt = -1;
	const frames = math.ceil(sec / DT);
	for (let f = 0; f < frames; f++) {
		const out: RecapFrame = tl.step(DT);
		const t = tl.elapsed();
		for (let i = 0; i < tl.rows.size(); i++) {
			const r = tl.rows[i];
			if (r.visible && firstShown[i] < 0) firstShown[i] = t;
			if (r.visible) values[i].push(r.value);
		}
		if (out.tick) ticks += 1;
		for (let k = 0; k < out.lands; k++) landTimes.push(t);
		lands += out.lands;
		if (out.armedNow) armedAt = t;
		if (out.settled && settledAt < 0) settledAt = t;
	}
	return { firstShown, lands, landTimes, ticks, armedAt, settledAt, values };
}

const NEAR: RecapRowSpec = { from: 0, to: 1500, counted: true };
const HL: RecapRowSpec[] = [
	{ from: 0, to: 2, counted: true },
	{ from: 10, to: 42, counted: true },
	{ from: 0, to: 7, counted: true },
	{ from: 0, to: 214, counted: true },
];

describe("RecapTimeline", () => {
	it("non-record order: the line at 0.3 s, highlights from 0.7 s every 0.15 s, armed at 0.6 s, settled at 1.4 s", () => {
		const tl = new RecapTimeline({ nearMiss: NEAR, highlights: HL, reducedMotion: false });
		expect([tl.nearMissRow, tl.firstHighlightRow, tl.rows.size()]).toEqual([0, 1, 5]);
		expect(tl.settleSec).toBeCloseTo(1.4, 9);
		const tr = run(tl, 2);
		const starts = [0.3, 0.7, 0.85, 1.0, 1.15];
		for (let i = 0; i < starts.size(); i++) {
			expect(tr.firstShown[i] >= starts[i] - 1e-9 && tr.firstShown[i] < starts[i] + DT + 1e-9).toBe(true);
		}
		expect(tr.armedAt >= RECAP.retryArmSec - 1e-9 && tr.armedAt < RECAP.retryArmSec + DT + 1e-9).toBe(true);
		expect(tr.settledAt >= 1.4 - 1e-9 && tr.settledAt < 1.4 + DT + 1e-9).toBe(true);
	});

	it("counts up in integer steps to the final value; a tick at most once a frame; one land per row", () => {
		const tl = new RecapTimeline({ nearMiss: NEAR, highlights: HL, reducedMotion: false });
		const tr = run(tl, 2);
		for (let i = 0; i < tl.rows.size(); i++) {
			const vs = tr.values[i];
			const r = tl.rows[i];
			let prev = r.from;
			for (const v of vs) {
				expect(v % 1).toBe(0);
				expect(v >= prev && v <= r.to).toBe(true);
				prev = v;
			}
			expect(vs[vs.size() - 1]).toBe(r.to);
			// It counted: some frame showed a value between.
			let between = false;
			for (const v of vs) if (v > r.from && v < r.to) between = true;
			expect(between).toBe(true);
		}
		expect(tr.lands).toBe(5);
		expect(tr.ticks > 5).toBe(true);
		// The land of the last row is the settle frame's.
		expect(tr.landTimes[tr.landTimes.size() - 1]).toBe(tr.settledAt);
	});

	it("a row without a number appears with no count and no sound", () => {
		const tl = new RecapTimeline({
			nearMiss: { from: 0, to: 0, counted: false },
			highlights: [],
			reducedMotion: false,
		});
		const tr = run(tl, 1);
		expect([tr.lands, tr.ticks]).toEqual([0, 0]);
		expect(tl.rows[0].visible).toBe(true);
	});

	it("a press before the arm skips to settled (one land, still not armed); after the arm it retries", () => {
		const tl = new RecapTimeline({ nearMiss: NEAR, highlights: HL, reducedMotion: false });
		run(tl, 0.2);
		expect(tl.press()).toBe("skip");
		expect(tl.isSettled()).toBe(true);
		for (const r of tl.rows) expect([r.visible, r.value, r.landed]).toEqual([true, r.to, true]);
		const after = run(tl, 0.5);
		expect([after.lands, after.ticks]).toEqual([1, 0]);
		expect(tl.isArmed()).toBe(true);
		expect(tl.press()).toBe("retry");
		// A press after the arm, before settling, retries too.
		const t2 = new RecapTimeline({ nearMiss: NEAR, highlights: HL, reducedMotion: false });
		run(t2, 0.65);
		expect(t2.press()).toBe("retry");
		expect(t2.isSettled()).toBe(false);
	});

	it("reduced motion: no count-up, values final when shown, one land at the very end", () => {
		const tl = new RecapTimeline({ nearMiss: NEAR, highlights: HL, reducedMotion: true });
		const tr = run(tl, 2);
		for (let i = 0; i < tl.rows.size(); i++) for (const v of tr.values[i]) expect(v).toBe(tl.rows[i].to);
		expect([tr.lands, tr.ticks]).toEqual([1, 0]);
		expect(tr.landTimes[0] >= 1.15 - 1e-9 && tr.landTimes[0] < 1.15 + DT + 1e-9).toBe(true);
		expect(tl.settleSec).toBeCloseTo(1.15, 9);
		// A skip before the end lands once; after it, never again.
		const sk = new RecapTimeline({ nearMiss: NEAR, highlights: HL, reducedMotion: true });
		run(sk, 0.4);
		sk.skip();
		expect(run(sk, 1).lands).toBe(1);
	});

	it("record run: the highlights and the dim line start after NB's rows + 0.2 s", () => {
		const tl = new RecapTimeline({ nearMiss: NEAR, highlights: HL, recordRowsSec: 1.3, reducedMotion: false });
		const tr = run(tl, 3);
		const start = 1.3 + RECAP.afterRecordRowsSec;
		expect(tr.firstShown[0]).toBe(tr.firstShown[1]);
		expect(tr.firstShown[1] >= start - 1e-9 && tr.firstShown[1] < start + DT + 1e-9).toBe(true);
		expect(tl.settleSec).toBeCloseTo(start + 3 * RECAP.highlightGapSec + RECAP.highlightCountSec, 9);
	});

	it("a verdict's re-derive at the old clock: rows already due show final and silent, later rows still count", () => {
		const old = new RecapTimeline({ nearMiss: NEAR, highlights: HL, reducedMotion: false });
		run(old, 1.05);
		const tl = new RecapTimeline({
			nearMiss: { from: 0, to: 800, counted: true },
			highlights: HL,
			reducedMotion: false,
			atSec: 1.05,
		});
		expect(tl.elapsed()).toBe(1.05);
		expect([tl.rows[0].value, tl.rows[0].landed, tl.rows[1].value, tl.rows[1].landed]).toEqual([
			800,
			true,
			2,
			true,
		]);
		// 1.05 s: highlights 2 and 3 are counting (started at 0.85 / 1.0), highlight 4 (1.15) not shown yet.
		expect([tl.rows[2].visible, tl.rows[2].landed, tl.rows[3].visible, tl.rows[4].visible]).toEqual([
			true,
			false,
			true,
			false,
		]);
		expect(tl.isArmed()).toBe(true);
		const tr = run(tl, 1);
		// Only the rows still counting or not yet shown land: no sound for the rows already due.
		expect(tr.lands).toBe(3);
		expect(tr.armedAt).toBe(-1);
	});

	it("no rows: settled at once, no sound", () => {
		const tl = new RecapTimeline({ nearMiss: undefined, highlights: [], reducedMotion: false });
		const tr = run(tl, 1);
		expect([tr.lands, tr.ticks, tl.isSettled()]).toEqual([0, 0, true]);
	});

	it("row specs from the near-miss line and the highlights", () => {
		const n = nearMissFor(input({ stairsTiles: 8 }))!;
		expect(recapNearMissRow(n)).toEqual({ from: 0, to: 8, counted: true });
		const r = nearMissFor(input({ floor: 8 }))!;
		expect(recapNearMissRow(r).counted).toBe(false);
		const h = pickHighlights(
			input({ score: { total: 1, maxCombo: 33, points: sources({}), counts: sources({}) } }),
		);
		expect(recapHighlightRow(h[0])).toEqual({ from: 10, to: 33, counted: true });
	});
});
