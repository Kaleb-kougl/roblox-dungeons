// The co-op contribution core (docs/RUN_CONTRIBUTION.md CT3):
//   - largestRemainderShares: sums to 100, floors then remainders, ties by the lower index, all-zero and negative input
//   - contributionOf: solo -> undefined; rows in index order with shares; the local row; dropped You cells (no boss, no
//     pickups, a zero part of the pickups line); a leaver's numbers stay in the team totals
//   - standing: lastToFall / fell / stood / left, seconds from SIM_HZ, a revive (lastDeath alive), the derived wipe
//   - assignTitles: one per player, distinct but Teammate, greedy by relative lead, every threshold at its edge, ties
//     (a tie for the lead, an equal score), the fallback, 2 / 4 / 8 players, identical output for identical tallies
//   - strings (CT4): every view key is a contract string with placeholder English; the texts fill as the plan shows
import { describe, expect, it } from "@rbxts/jest-globals";
import { SIM_HZ } from "shared/sim";
import { CONTRIB_STRING_KEYS, PLACEHOLDER_MANIFEST, REQUIRED_STRING_KEYS, ThemePack } from "shared/theme";
import { NO_RECAP_TALLY, RECAP_ALIVE_TICK, type RecapTallySource } from "shared/view/fx";
import {
	CONTRIB,
	CONTRIB_STRINGS,
	CONTRIB_TITLES,
	assignTitles,
	contribPickupParts,
	contribStandingText,
	contribStringKeys,
	contribTitleDescKey,
	contribTitleKey,
	contribTitles,
	contributionOf,
	largestRemainderShares,
	type ContribStats,
	type ContribTitle,
	type ContributionInput,
} from ".";

function sum(list: ReadonlyArray<number>): number {
	let s = 0;
	for (const v of list) s += v;
	return s;
}

function filled(n: number, v: number): number[] {
	const out: number[] = [];
	for (let i = 0; i < n; i++) out.push(v);
	return out;
}

/** A tally of `n` players, all alive, every counter 0, then `patch`. */
function tally(n: number, patch: Partial<RecapTallySource> = {}): RecapTallySource {
	return {
		...NO_RECAP_TALLY,
		parries: filled(n, 0),
		grazes: filled(n, 0),
		kills: filled(n, 0),
		damage: filled(n, 0),
		bossDamage: filled(n, 0),
		hits: filled(n, 0),
		pellets: filled(n, 0),
		boosts: filled(n, 0),
		deathTick: filled(n, RECAP_ALIVE_TICK),
		deathFloor: filled(n, 0),
		leftFloor: filled(n, 0),
		lastTick: 600 * SIM_HZ,
		...patch,
	};
}

function input(n: number, patch: Partial<RecapTallySource> = {}, extra: Partial<ContributionInput> = {}) {
	const names: string[] = [];
	for (let i = 0; i < n; i++) names.push(`P${i}`);
	return { tally: tally(n, patch), partySize: n, localIndex: 0, names, ...extra };
}

/** A stats row with every field 0 (alive, standing `stand`), then `patch`. */
function stat(patch: Partial<ContribStats> = {}): ContribStats {
	return { damage: 0, kills: 0, bossDamage: 0, parries: 0, grazes: 0, hits: 0, pickups: 0, stand: 100, ...patch };
}

describe("largestRemainderShares", () => {
	it("whole percents summing to 100: floors, then the largest remainders", () => {
		expect(largestRemainderShares([1, 1, 1])).toEqual([34, 33, 33]);
		expect(largestRemainderShares([2, 1])).toEqual([67, 33]);
		expect(largestRemainderShares([50, 30, 20])).toEqual([50, 30, 20]);
		// 12480 / 11450 / 6510 of 30440: 40.99 / 37.62 / 21.39 -> floors 40 / 37 / 21, two points to the .99 and the .62
		const shares = largestRemainderShares([12480, 11450, 6510]);
		expect(shares).toEqual([41, 38, 21]);
		expect(sum(shares)).toBe(100);
	});

	it("ties on the remainder go to the lower index; all-zero and negative values give zeros", () => {
		// 1/6 each: 16.67 -> six floors of 16 = 96, four points to indices 0..3
		expect(largestRemainderShares(filled(6, 5))).toEqual([17, 17, 17, 17, 16, 16]);
		expect(largestRemainderShares([0, 0, 0])).toEqual([0, 0, 0]);
		expect(largestRemainderShares([])).toEqual([]);
		expect(largestRemainderShares([-5, 5])).toEqual([0, 100]);
		expect(largestRemainderShares([0, 7, 0])).toEqual([0, 100, 0]);
	});

	it("always sums to 100 over random parties of 2 to 8", () => {
		let seed = 12345;
		const rand = () => {
			seed = (seed * 1103515245 + 12345) % 2147483648;
			return seed;
		};
		for (let k = 0; k < 200; k++) {
			const n = 2 + (rand() % 7);
			const values: number[] = [];
			for (let i = 0; i < n; i++) values.push(rand() % 5000);
			if (sum(values) === 0) continue;
			const s = largestRemainderShares(values);
			expect([k, sum(s)]).toEqual([k, 100]);
			for (let i = 0; i < n; i++) expect(s[i] >= 0 && s[i] <= 100).toBe(true);
		}
	});
});

describe("contributionOf: rows, shares, cells", () => {
	it("solo runs get none", () => {
		expect(contributionOf(input(1, { damage: [100] }))).toBe(undefined);
		expect(contributionOf({ ...input(2), partySize: 1 })).toBe(undefined);
		expect(CONTRIB.minPartySize).toBe(2);
	});

	it("rows in index order with names, shares and the local row", () => {
		const c = contributionOf(
			input(
				3,
				{ damage: [100, 300, 100], kills: [10, 5, 5], parries: [1, 2, 3], hits: [4, 0, 2] },
				{ localIndex: 2 },
			),
		)!;
		expect(c.rows.map((r) => r.index)).toEqual([0, 1, 2]);
		expect(c.rows.map((r) => r.name)).toEqual(["P0", "P1", "P2"]);
		expect(c.rows.map((r) => r.damageShare)).toEqual([20, 60, 20]);
		expect(c.damageShares).toEqual([20, 60, 20]);
		expect(c.rows.map((r) => r.killShare)).toEqual([50, 25, 25]);
		expect(c.rows.map((r) => r.local)).toEqual([false, false, true]);
		expect(c.local.index).toBe(2);
		expect([c.local.parries, c.local.hits]).toEqual([3, 2]);
	});

	it("the You cells in plan order; zero team totals dropped (no boss, no pickups)", () => {
		const c = contributionOf(input(2, { damage: [10, 30], kills: [1, 3], parries: [0, 2], hits: [1, 0] }))!;
		expect(c.youCells.map((x) => x.kind)).toEqual(["damage", "kills", "parries", "hits"]);
		expect(c.youCells.map((x) => x.labelKey)).toEqual([
			CONTRIB_STRINGS.youDamage,
			CONTRIB_STRINGS.youKills,
			CONTRIB_STRINGS.youParries,
			CONTRIB_STRINGS.youHits,
		]);
		expect([c.youCells[0].value, c.youCells[0].share, c.youCells[1].share]).toEqual([10, 25, 25]);
		// a zero of your own still shows when the team's total is not 0
		expect([c.youCells[2].value, c.youCells[2].share === undefined]).toEqual([0, true]);
		const full = contributionOf(
			input(2, {
				damage: [10, 30],
				kills: [1, 3],
				bossDamage: [5, 15],
				parries: [1, 0],
				grazes: [0, 3],
				hits: [1, 0],
				pellets: [4, 2],
				boosts: [1, 0],
			}),
		)!;
		expect(full.youCells.map((x) => x.kind)).toEqual([...CONTRIB.cellOrder]);
		const pick = full.youCells[6];
		expect([pick.value, pick.boosts, pick.pellets]).toEqual([5, 1, 4]);
		expect(full.youCells[2].share).toBe(25);
	});

	it("the pickups line drops a part whose team total is 0; singular and plural parts", () => {
		const pelletsOnly = contributionOf(input(2, { pellets: [22, 3] }))!;
		const cell = pelletsOnly.youCells[pelletsOnly.youCells.size() - 1];
		expect([cell.kind, cell.value, cell.boosts === undefined, cell.pellets]).toEqual(["pickups", 22, true, 22]);
		expect(contribPickupParts(cell)).toEqual([{ key: CONTRIB_STRINGS.youPellets, vars: { n: 22 } }]);
		const boostsOnly = contributionOf(input(2, { boosts: [0, 2] }))!.youCells[0];
		expect([boostsOnly.kind, boostsOnly.boosts, boostsOnly.pellets === undefined]).toEqual(["pickups", 0, true]);
		expect(contribPickupParts(boostsOnly)).toEqual([{ key: CONTRIB_STRINGS.youBoosts, vars: { n: 0 } }]);
		const both = contributionOf(input(2, { boosts: [1, 0], pellets: [1, 5] }))!.youCells[0];
		expect(contribPickupParts(both)).toEqual([
			{ key: CONTRIB_STRINGS.youBoostOne, vars: {} },
			{ key: CONTRIB_STRINGS.youPelletOne, vars: {} },
		]);
	});

	it("nothing dealt: all-zero shares, no damage cell", () => {
		const c = contributionOf(input(3))!;
		expect(c.damageShares).toEqual([0, 0, 0]);
		expect(c.youCells.size()).toBe(0);
	});

	it("a leaver keeps their row and their numbers in the team totals", () => {
		const c = contributionOf(
			input(4, { damage: [100, 100, 100, 100], kills: [5, 5, 5, 5], leftFloor: [0, 2, 0, 0] }, { localIndex: 0 }),
		)!;
		expect(c.rows.map((r) => r.left)).toEqual([false, true, false, false]);
		expect(c.damageShares).toEqual([25, 25, 25, 25]);
		expect(c.rows[1].standing).toEqual({ kind: "left", floor: 2, seconds: 0 });
	});

	it("an out-of-range local index reads as player 0; a missing name is empty", () => {
		const c = contributionOf({ ...input(2), localIndex: 5, names: ["Only"] })!;
		expect([c.local.index, c.rows[0].name, c.rows[1].name]).toEqual([0, "Only", ""]);
	});
});

describe("contributionOf: standing", () => {
	it("a wipe: the last death is lastToFall, the others fell; seconds from SIM_HZ", () => {
		const c = contributionOf(
			input(3, {
				deathTick: [100 * SIM_HZ, 860 * SIM_HZ, 760 * SIM_HZ + 30],
				deathFloor: [3, 9, 7],
				lastDeath: 1,
			}),
		)!;
		expect(c.wipe).toBe(true);
		expect(c.rows.map((r) => r.standing)).toEqual([
			{ kind: "fell", floor: 3, seconds: 100 },
			{ kind: "lastToFall", floor: 9, seconds: 860 },
			{ kind: "fell", floor: 7, seconds: 760 },
		]);
	});

	it("no wipe: the living stood to the end (run length from lastTick), the dead fell", () => {
		const c = contributionOf(
			input(2, { deathTick: [RECAP_ALIVE_TICK, 50 * SIM_HZ], deathFloor: [0, 4], lastDeath: 1 }),
		)!;
		expect(c.wipe).toBe(false);
		expect(c.rows[0].standing).toEqual({ kind: "stood", floor: 0, seconds: 600 });
		expect(c.rows[1].standing).toEqual({ kind: "fell", floor: 4, seconds: 50 });
		// endedInWipe given: false keeps everyone `fell`
		const all = { deathTick: [10 * SIM_HZ, 20 * SIM_HZ], deathFloor: [1, 2], lastDeath: 1 };
		const notWipe = contributionOf(input(2, all, { endedInWipe: false }))!;
		expect(notWipe.rows.map((r) => r.standing.kind)).toEqual(["fell", "fell"]);
		expect(contributionOf(input(2, all))!.rows.map((r) => r.standing.kind)).toEqual(["fell", "lastToFall"]);
	});

	it("leavers do not stop a wipe; lastDeath revived since (alive) falls back to the latest death", () => {
		const c = contributionOf(
			input(3, {
				deathTick: [30 * SIM_HZ, RECAP_ALIVE_TICK, 40 * SIM_HZ],
				deathFloor: [5, 0, 5],
				leftFloor: [0, 2, 0],
				lastDeath: 1,
			}),
		)!;
		expect(c.wipe).toBe(true);
		expect(c.rows.map((r) => r.standing.kind)).toEqual(["fell", "left", "lastToFall"]);
	});

	it("a player who died and then left keeps their death", () => {
		const c = contributionOf(
			input(2, { deathTick: [10 * SIM_HZ, 20 * SIM_HZ], deathFloor: [2, 3], leftFloor: [2, 0], lastDeath: 1 }),
		)!;
		expect([c.rows[0].left, c.rows[0].standing.kind]).toEqual([true, "fell"]);
	});

	it("standing texts: key and vars (floor, time as m:ss, seconds)", () => {
		expect(contribStandingText({ kind: "lastToFall", floor: 9, seconds: 860 })).toEqual({
			key: CONTRIB_STRINGS.lastToFall,
			vars: { floor: 9, time: "14:20", seconds: 860 },
		});
		expect(contribStandingText({ kind: "stood", floor: 0, seconds: 65 }).key).toBe(CONTRIB_STRINGS.stood);
		expect(contribStandingText({ kind: "stood", floor: 0, seconds: 65 }).vars.time).toBe("1:05");
		expect(contribStandingText({ kind: "fell", floor: 7, seconds: 760 }).key).toBe(CONTRIB_STRINGS.fell);
		expect(contribStandingText({ kind: "left", floor: 2, seconds: 0 }).key).toBe(CONTRIB_STRINGS.left);
	});
});

describe("assignTitles", () => {
	it("each title on its own lead; distinct; a player without a lead is a Teammate", () => {
		const titles = assignTitles([
			stat({ damage: 900, stand: 10 }),
			stat({ kills: 20, damage: 100, stand: 10 }),
			stat({ parries: 9, damage: 100, stand: 10 }),
			stat({ damage: 100, stand: 10 }),
		]);
		expect(titles).toEqual(["heavyHitter", "finisher", "guardian", "teammate"]);
	});

	it("greedy by relative lead: a player leading two stats keeps the bigger lead; the other title goes to nobody", () => {
		// player 0 leads kills 30 vs 10 (0.67) and parries 6 vs 5 (0.17): Finisher; Guardian is not handed to player 1
		const titles = assignTitles([stat({ kills: 30, parries: 6 }), stat({ kills: 10, parries: 5 })]);
		expect(titles).toEqual(["finisher", "teammate"]);
		// a bigger lead wins over table order: grazes 100 vs 10 (0.9) beats damage 200 vs 100 (0.5)
		const t2 = assignTitles([stat({ damage: 200, grazes: 100 }), stat({ damage: 100, grazes: 10 })]);
		expect(t2).toEqual(["daredevil", "teammate"]);
	});

	it("equal scores: title order first, then the lower index", () => {
		// player 0 and 1 each lead with score 1 (next 0): Finisher (earlier) for player 0's kills over its parries
		const t = assignTitles([stat({ kills: 10, parries: 5 }), stat({})]);
		expect(t).toEqual(["finisher", "teammate"]);
		const t2 = assignTitles([stat({ parries: 5 }), stat({ kills: 10 })]);
		expect(t2).toEqual(["guardian", "finisher"]);
	});

	it("a tie for the lead gives the title to nobody", () => {
		expect(assignTitles([stat({ kills: 12 }), stat({ kills: 12 })])).toEqual(["teammate", "teammate"]);
	});

	it("thresholds at their edges", () => {
		const edge = (field: keyof ContribStats, v: number) => {
			const a: Partial<ContribStats> = {};
			(a as Record<string, number>)[field] = v;
			return assignTitles([stat(a), stat({})])[0];
		};
		expect(CONTRIB_TITLES.finisher.min).toBe(10);
		expect([edge("kills", 10), edge("kills", 9)]).toEqual(["finisher", "teammate"]);
		expect([edge("parries", 5), edge("parries", 4)]).toEqual(["guardian", "teammate"]);
		expect([edge("grazes", 30), edge("grazes", 29)]).toEqual(["daredevil", "teammate"]);
		expect([edge("pickups", 10), edge("pickups", 9)]).toEqual(["collector", "teammate"]);
		expect([edge("bossDamage", 1), edge("bossDamage", 0)]).toEqual(["bossBreaker", "teammate"]);
		// Heavy Hitter: share >= 120 % of even. 2 players: 60 % exactly qualifies, 59 % does not.
		expect(assignTitles([stat({ damage: 60 }), stat({ damage: 40 })])[0]).toBe("heavyHitter");
		expect(assignTitles([stat({ damage: 59 }), stat({ damage: 41 })])[0]).toBe("teammate");
		// 4 players: even 25 %, 30 % qualifies
		const four = [stat({ damage: 30 }), stat({ damage: 25 }), stat({ damage: 25 }), stat({ damage: 20 })];
		expect(assignTitles(four)[0]).toBe("heavyHitter");
		const four2 = [stat({ damage: 29 }), stat({ damage: 25 }), stat({ damage: 25 }), stat({ damage: 21 })];
		expect(assignTitles(four2)[0]).toBe("teammate");
	});

	it("Untouchable: the strict fewest hits when the party took >= 3; a tie for fewest gives none", () => {
		expect(assignTitles([stat({ hits: 0 }), stat({ hits: 3 })])).toEqual(["untouchable", "teammate"]);
		expect(assignTitles([stat({ hits: 0 }), stat({ hits: 2 })])).toEqual(["teammate", "teammate"]);
		const tie = assignTitles([stat({ hits: 1 }), stat({ hits: 1 }), stat({ hits: 5 })]);
		expect(tie).toEqual(["teammate", "teammate", "teammate"]);
		// the inverse lead: (next - lead) / next
		const t = assignTitles([stat({ hits: 1, kills: 10 }), stat({ hits: 4, kills: 5 })]);
		// Untouchable 0.75 vs Finisher 0.5: player 0 is Untouchable
		expect(t).toEqual(["untouchable", "teammate"]);
	});

	it("Last Stand: the wipe's last to fall even on a same-tick death; else the strict longest standing", () => {
		expect(assignTitles([stat({ stand: 50 }), stat({ stand: 90 })])).toEqual(["teammate", "lastStand"]);
		const sameTick = assignTitles([stat({ stand: 90 }), stat({ stand: 90, lastToFall: true })]);
		expect(sameTick).toEqual(["teammate", "lastStand"]);
		expect(assignTitles([stat({ stand: 90 }), stat({ stand: 90 })])).toEqual(["teammate", "teammate"]);
	});

	it("8 players: one title each, distinct but Teammate, deterministic", () => {
		const stats = [
			stat({ damage: 5000, stand: 10 }),
			stat({ damage: 900, bossDamage: 800, stand: 10 }),
			stat({ damage: 900, kills: 40, stand: 10 }),
			stat({ damage: 900, parries: 12, stand: 10 }),
			stat({ damage: 900, grazes: 80, stand: 10 }),
			stat({ damage: 900, hits: 0, stand: 10 }),
			stat({ damage: 900, pickups: 30, hits: 3, stand: 10 }),
			stat({ damage: 900, hits: 3, stand: 99 }),
		];
		// everyone but player 5 took hits
		for (let i = 0; i < stats.size(); i++) if (i !== 5 && stats[i].hits === 0) stats[i] = { ...stats[i], hits: 2 };
		const titles = assignTitles(stats);
		expect(titles).toEqual([
			"heavyHitter",
			"bossBreaker",
			"finisher",
			"guardian",
			"daredevil",
			"untouchable",
			"collector",
			"lastStand",
		]);
		expect(assignTitles(stats)).toEqual(titles);
	});

	it("every title has its name and description keys; the fallback is last", () => {
		const all = contribTitles();
		expect(all.size()).toBe(9);
		expect(all[all.size() - 1]).toBe("teammate");
		expect(contribTitleKey("guardian")).toBe("run.recap.title.guardian");
		expect(contribTitleDescKey("guardian")).toBe("run.recap.titleDesc.guardian");
		const keys = contribStringKeys();
		expect(new Set(keys).size()).toBe(keys.size());
		for (const t of all)
			expect([t, keys.includes(contribTitleKey(t)), keys.includes(contribTitleDescKey(t))]).toEqual([
				t,
				true,
				true,
			]);
	});
});

describe("contributionOf: titles over the party", () => {
	/** A 4-player wipe where each player led something. */
	const PARTY: Partial<RecapTallySource> = {
		damage: [12480, 9000, 5000, 4000],
		kills: [30, 86, 20, 10],
		bossDamage: [0, 0, 0, 0],
		parries: [2, 3, 14, 1],
		grazes: [10, 12, 9, 63],
		hits: [5, 8, 6, 9],
		deathTick: [860 * SIM_HZ, 700 * SIM_HZ, 500 * SIM_HZ, 300 * SIM_HZ],
		deathFloor: [9, 8, 7, 5],
		lastDeath: 0,
	};

	it("4 players: one title each, the local row's own; 2 players", () => {
		const c = contributionOf(input(4, PARTY, { localIndex: 2 }))!;
		const titles = c.rows.map((r) => r.title);
		expect(titles).toEqual(["heavyHitter", "finisher", "guardian", "daredevil"]);
		expect(c.local.title).toBe("guardian");
		const two = contributionOf(input(2, { damage: [70, 30], kills: [3, 12], deathTick: [10, 20], lastDeath: 1 }))!;
		expect(two.rows.map((r) => r.title)).toEqual(["heavyHitter", "finisher"]);
	});

	it("identical tallies give identical output on two clients (only `local` differs)", () => {
		const a = contributionOf(input(4, PARTY, { localIndex: 0 }))!;
		const b = contributionOf(input(4, PARTY, { localIndex: 3 }))!;
		const strip = (c: typeof a) =>
			c.rows.map((r) => [r.title, r.damageShare, r.killShare, r.standing.kind, r.standing.seconds]);
		expect(strip(a)).toEqual(strip(b));
		expect(a.damageShares).toEqual(b.damageShares);
		expect([a.local.index, b.local.index]).toEqual([0, 3]);
	});

	it("every row gets exactly one title; only Teammate repeats", () => {
		const c = contributionOf(input(8, { damage: [1, 1, 1, 1, 1, 1, 1, 9] }))!;
		const seen = new Map<ContribTitle, number>();
		for (const r of c.rows) seen.set(r.title, (seen.get(r.title) ?? 0) + 1);
		for (const [t, k] of seen) if (t !== "teammate") expect([t, k]).toEqual([t, 1]);
		expect(c.rows[7].title).toBe("heavyHitter");
	});
});

describe("contribution strings (CT4)", () => {
	const quiet = (): void => {};
	const pack = new ThemePack(PLACEHOLDER_MANIFEST, { warn: quiet });

	it("every view key is in the contract's CONTRIB_STRING_KEYS and REQUIRED_STRING_KEYS", () => {
		const view = contribStringKeys();
		view.sort();
		const contract = [...CONTRIB_STRING_KEYS];
		contract.sort();
		expect(view).toEqual(contract);
		for (const key of view) expect([key, REQUIRED_STRING_KEYS.includes(key)]).toEqual([key, true]);
	});

	it("the You card's lines read as the plan draws them", () => {
		const title = pack.str(contribTitleKey("guardian"));
		expect(pack.str(CONTRIB_STRINGS.youHeader, { title })).toBe("You · Guardian");
		expect(pack.str(CONTRIB_STRINGS.youShareBar, { pct: 41 })).toBe("41% of the team's damage");
		expect(pack.str(CONTRIB_STRINGS.youShare, { value: "12,480", pct: 41 })).toBe("12,480 · 41%");
		const st = contribStandingText({ kind: "lastToFall", floor: 9, seconds: 860 });
		expect(pack.str(st.key, st.vars)).toBe("Last to fall · floor 9 · 14:20");
		const fell = contribStandingText({ kind: "fell", floor: 7, seconds: 760 });
		expect(pack.str(fell.key, fell.vars)).toBe("Fell on floor 7 · 12:40");
		const parts = contribPickupParts({
			kind: "pickups",
			labelKey: CONTRIB_STRINGS.youPickups,
			value: 26,
			boosts: 4,
			pellets: 22,
		});
		const [b, p] = [pack.str(parts[0].key, parts[0].vars), pack.str(parts[1].key, parts[1].vars)];
		expect(pack.str(CONTRIB_STRINGS.youPickupsValue, { boosts: b, pellets: p })).toBe("4 boosts · 22 pellets");
		expect(pack.str(contribTitleKey("daredevil"))).toBe("Bullet Dancer");
		expect(pack.str(contribTitleDescKey("teammate"))).toBe("Fought for the team");
	});
});
