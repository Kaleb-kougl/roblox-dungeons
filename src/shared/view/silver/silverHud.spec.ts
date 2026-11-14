// Silver on screen, the client's reads (docs/SILVER.md SV8 / SV18): the live counter (SilverTracker: a room clear
// ticks +2 once, a far co-op clear too, the first update is the baseline), its `+N` chip, which runs show it, its
// place on the score panel's row 5 (the floor line scales into what the counter leaves, never under the floor size),
// the run-over rows (dimmed client figures until the server's, the bonus and top-up rows only when they apply, the
// compact fold, the `to go` line, `No Silver` for runs that cannot pay) and the wallet reads.
import { describe, expect, it } from "@rbxts/jest-globals";
import { DEFAULT_CHARACTER, NO_UPGRADES } from "shared/characters";
import { buildEndlessRunConfig } from "shared/run";
import { SILVER, emptySilverRunInput, runSilver, silverRunInputOf, type SilverRunInput } from "shared/silver";
import { ScoreSource, createSimState } from "shared/sim";
import { PLACEHOLDER_MANIFEST, ThemePack, type StringVars } from "shared/theme";
import type { SilverGrantBreakdown, WalletStatus } from "shared/wallet";
import { HUD_STRINGS, HUD_VIEW } from "../hud";
import {
	SILVER_COUNTER,
	SILVER_RECAP,
	SilverCounterChip,
	SilverTracker,
	armoryItemLabel,
	ownedCharacterOr,
	silverClientFigures,
	silverCountUp,
	silverCounterShown,
	silverRecapLines,
	silverRecapModel,
	silverRowFit,
	silverRunPays,
	statusBalance,
	statusLevel,
	statusOwns,
	statusUpgrades,
	type SilverRecapInput,
	type SilverRunFacts,
} from ".";

const quiet = () => {};
const PACK = new ThemePack(PLACEHOLDER_MANIFEST, { warn: quiet });
const s = (key: string, vars?: StringVars) => PACK.str(key, vars);

function input(over: Partial<SilverRunInput>): SilverRunInput {
	return { ...emptySilverRunInput(), ...over };
}

describe("silver: the live counter (SilverTracker)", () => {
	it("the first update is the baseline; a room clear ticks +2 once; nothing on a quiet frame", () => {
		const t = new SilverTracker();
		expect(t.update(input({ roomsCleared: 3 })).gains.size()).toBe(0);
		expect(t.update(input({ roomsCleared: 3 })).total).toBe(3 * SILVER.roomPay);
		const f = t.update(input({ roomsCleared: 4 }));
		expect(f.gains.map((g) => [g.row, g.silver])).toEqual([["rooms", SILVER.roomPay]]);
		expect([f.gained, f.total]).toEqual([SILVER.roomPay, 4 * SILVER.roomPay]);
		expect(t.update(input({ roomsCleared: 4 })).gains.size()).toBe(0);
	});

	it("every row ticks: crates, a floor, a boss at its Depth, a vault, a secret, a Goldling, every tenth kill", () => {
		const t = new SilverTracker();
		t.update(input({}));
		const f = t.update(
			input({
				crateSilver: 6,
				floor: 2,
				depth: 2,
				vaultsOpened: 1,
				secretsFound: 1,
				goldlingsCaught: 1,
				kills: 10,
			}),
		);
		const got = new Map<string, number>();
		for (const g of f.gains) got.set(g.row, g.silver);
		expect(got.get("crates")).toBe(6);
		expect(got.get("floors")).toBe(SILVER.floorBase + 1);
		expect(got.get("bosses")).toBe(SILVER.bossPerDepth * 2);
		expect(got.get("vaults")).toBe(SILVER.vaultOpened);
		expect(got.get("secrets")).toBe(SILVER.secretFound);
		expect(got.get("goldlings")).toBe(SILVER.goldlingCaught);
		expect(got.get("kills")).toBe(1);
		expect(f.total).toBe(
			runSilver(
				input({
					crateSilver: 6,
					floor: 2,
					depth: 2,
					vaultsOpened: 1,
					secretsFound: 1,
					goldlingsCaught: 1,
					kills: 10,
				}),
			).sum,
		);
	});

	it("a far co-op clear ticks the counter too: it reads the party's shared score record", () => {
		const setup = buildEndlessRunConfig(1337, 2);
		const spawn = setup.spawn!;
		const st = createSimState(1337, spawn.x, spawn.z, setup.config);
		const t = new SilverTracker();
		t.update(silverRunInputOf(st, { kills: 0 }, setup.config));
		// The shared record clears once for the whole team (wherever the view player is): one ROOMS credit.
		st.score!.counts[ScoreSource.ROOMS] += 1;
		const f = t.update(silverRunInputOf(st, { kills: 0 }, setup.config));
		expect(f.gains.map((g) => [g.row, g.silver])).toEqual([["rooms", SILVER.roomPay]]);
	});

	it("reset makes the next update a baseline again (a new run)", () => {
		const t = new SilverTracker();
		t.update(input({ roomsCleared: 1 }));
		t.reset();
		expect(t.update(input({ roomsCleared: 9 })).gains.size()).toBe(0);
	});
});

describe("silver: the counter's `+N` chip", () => {
	it("merges gains within the window, shows then fades, a later gain starts a new one", () => {
		const c = new SilverCounterChip();
		const C = SILVER_COUNTER;
		expect(c.look(0).amount).toBe(0);
		c.add(2, 10);
		c.add(3, 10 + C.mergeSec / 2);
		expect(c.look(10.4)).toEqual({ amount: 5, transparency: 0 });
		const late = 10 + C.mergeSec / 2 + C.showSec - C.fadeSec / 2;
		expect(c.look(late).amount).toBe(5);
		expect(c.look(late).transparency > 0 && c.look(late).transparency < 1).toBe(true);
		expect(c.look(10 + C.mergeSec / 2 + C.showSec + 0.01).amount).toBe(0);
		c.add(2, 20);
		expect(c.look(20).amount).toBe(2);
	});
});

describe("silver: which runs show the counter and pay", () => {
	const ranked: SilverRunFacts = {
		world: "endless",
		tutorial: false,
		dev: false,
		stress: 0,
		debug: false,
		unranked: false,
		hasSilver: true,
	};
	it("endless and the Daily, ranked, with the feed; never the tutorial, dev, M1, unranked, debug or stress", () => {
		expect(silverCounterShown(ranked)).toBe(true);
		expect(silverCounterShown({ ...ranked, world: "daily" })).toBe(true);
		expect(silverCounterShown({ ...ranked, hasSilver: false })).toBe(false);
		expect(silverCounterShown({ ...ranked, world: "tutorial", tutorial: true })).toBe(false);
		expect(silverCounterShown({ ...ranked, world: "dev", dev: true })).toBe(false);
		expect(silverCounterShown({ ...ranked, world: "game" })).toBe(false);
		expect(silverRunPays({ ...ranked, unranked: true })).toBe(false);
		expect(silverRunPays({ ...ranked, debug: true })).toBe(false);
		expect(silverRunPays({ ...ranked, stress: 30 })).toBe(false);
	});
});

describe("silver: the counter on the score panel's row 5 (fit)", () => {
	const inner = HUD_VIEW.scoreWidth - 2 * HUD_VIEW.pad;
	const widest = s(HUD_STRINGS.floor, { floor: 99, depth: 19 });
	const big = 10 ** (SILVER_COUNTER.fitDigits - 1) * 9;
	it("the counter plus the floor line fit the row; the line never shrinks under minFloorText (printed)", () => {
		for (const silver of [0, 46, 999, big]) {
			const fit = silverRowFit(inner, widest, silver, HUD_VIEW.smallText);
			expect(fit.counterW + SILVER_COUNTER.gap + fit.textW).toBeLessThanOrEqual(inner);
			expect(fit.textSize).toBeLessThanOrEqual(HUD_VIEW.smallText);
			expect(fit.textSize).toBeGreaterThanOrEqual(SILVER_COUNTER.minFloorText);
			print(
				`[silver] row 5 "${widest}" with ${silver}: counter ${fit.counterW} px, text ${"%.1f".format(
					fit.textSize,
				)} px`,
			);
		}
	});
	it("a short floor line keeps its full size beside a small counter", () => {
		const fit = silverRowFit(inner, s(HUD_STRINGS.floor, { floor: 1, depth: 1 }), 2, HUD_VIEW.smallText);
		expect(fit.textSize > SILVER_COUNTER.minFloorText).toBe(true);
	});
});

function breakdown(over: Partial<SilverGrantBreakdown>): SilverGrantBreakdown {
	return {
		runId: "r1",
		rows: [],
		sum: 30,
		prospectorLevel: 0,
		prospector: 0,
		topUp: 0,
		firstRunBonus: 0,
		dailyBonus: 0,
		total: 30,
		balance: 130,
		...over,
	};
}

const LOADED: WalletStatus = {
	loaded: true,
	balance: 100,
	earned: 100,
	firstRunBonusOpen: true,
	dailyBonusOpen: true,
	goals: [{ itemId: "vigor", level: 2, tier: 3, price: 150, toGo: 50 }],
};

describe("silver: the run-over rows", () => {
	const short = runSilver(input({ roomsCleared: 2, kills: 3 }));
	const base: SilverRecapInput = {
		paidWorld: true,
		pays: true,
		verdict: "pending",
		client: silverClientFigures(short, LOADED, false),
		goals: LOADED.goals,
		compact: false,
	};
	const ids = (m: ReturnType<typeof silverRecapModel>) => (m.kind === "rows" ? m.rows.map((r) => r.id) : [m.kind]);

	it("the client's figures, dimmed: the run, the top-up (two rooms), the first-run bonus, the total, the goal", () => {
		const m = silverRecapModel(base, s);
		expect(ids(m)).toEqual(["run", "topUp", "firstRun", "total", "goal"]);
		if (m.kind !== "rows") return;
		expect(m.dim).toBe(true);
		const text = m.rows.map((r) => s(r.key, r.vars));
		expect(text).toEqual([
			`Silver +${short.sum}`,
			`Topped up to ${SILVER.runMinimum}`,
			`First run today +${SILVER.firstRunBonus}`,
			`Total ${100 + SILVER.runMinimum + SILVER.firstRunBonus}`,
			// 150 for Vigor II: 100 + the minimum's 20 + the first-run bonus is past it
			"Vigor II: ready to buy",
		]);
	});

	it("shows the verdict's prediction still dimmed, then settles undimmed on the wallet's grant; bonus rows only when they apply", () => {
		const predicted = breakdown({ sum: 60, firstRunBonus: 50, total: 110, balance: 210 });
		const m = silverRecapModel({ ...base, verdict: "accepted", predicted }, s);
		expect(ids(m)).toEqual(["run", "firstRun", "total", "goal"]);
		if (m.kind === "rows") expect([m.dim, m.runAmount]).toEqual([true, 60]);
		// another server took the day's bonus first: the settled grant has none
		const settled = breakdown({ sum: 60, total: 60, balance: 160 });
		const n = silverRecapModel({ ...base, verdict: "accepted", predicted, settled }, s);
		expect(ids(n)).toEqual(["run", "total", "goal"]);
		if (n.kind === "rows") expect(s(n.rows[2].key, n.rows[2].vars)).toBe("Vigor II: ready to buy");
	});

	it("the Daily bonus and Prospector rows; compact folds them into one Bonuses row, two rows a line", () => {
		const b = breakdown({
			sum: 100,
			prospectorLevel: 1,
			prospector: 5,
			firstRunBonus: 50,
			dailyBonus: 50,
			total: 205,
		});
		expect(ids(silverRecapModel({ ...base, verdict: "accepted", predicted: b }, s))).toEqual([
			"run",
			"prospector",
			"firstRun",
			"daily",
			"total",
			"goal",
		]);
		const c = silverRecapModel({ ...base, verdict: "accepted", predicted: b, compact: true }, s);
		expect(ids(c)).toEqual(["run", "bonuses", "total", "goal"]);
		if (c.kind !== "rows") return;
		expect(s(c.rows[1].key, c.rows[1].vars)).toBe("Bonuses +105");
		expect(silverRecapLines(c.rows, "compact").size()).toBe(SILVER_RECAP.maxLines.compact);
		const full = silverRecapModel({ ...base, verdict: "accepted", predicted: { ...b, topUp: 3 } }, s);
		if (full.kind === "rows") {
			expect(full.rows.size()).toBe(7);
			for (const layout of ["wide", "narrow"] as const)
				expect([layout, silverRecapLines(full.rows, layout).size()]).toEqual([
					layout,
					SILVER_RECAP.maxLines[layout],
				]);
		}
	});

	it("No Silver: an unranked / debug run, a rejected one, an accepted one with nothing granted; hidden outside paying worlds", () => {
		expect(ids(silverRecapModel({ ...base, pays: false }, s))).toEqual(["none"]);
		expect(ids(silverRecapModel({ ...base, verdict: "rejected" }, s))).toEqual(["none"]);
		expect(ids(silverRecapModel({ ...base, verdict: "accepted" }, s))).toEqual(["none"]);
		expect(ids(silverRecapModel({ ...base, paidWorld: false }, s))).toEqual(["hidden"]);
		const none = silverRecapModel({ ...base, pays: false }, s);
		if (none.kind === "none") expect(s(none.key)).toBe("No Silver: unranked run");
	});

	it("a run under two rooms gets no top-up; an unknown wallet predicts both day bonuses open", () => {
		const one = silverClientFigures(runSilver(input({ roomsCleared: 1 })), undefined, true);
		expect([one.topUp, one.firstRun, one.daily]).toEqual([0, SILVER.firstRunBonus, SILVER.dailyBonus]);
		const claimed = silverClientFigures(short, { ...LOADED, firstRunBonusOpen: false }, false);
		expect(claimed.firstRun).toBe(0);
	});

	it("the run row counts up from 0 to its amount (at once under reduced motion)", () => {
		expect(silverCountUp(0, 46)).toBe(0);
		expect(silverCountUp(SILVER_RECAP.delaySec + SILVER_RECAP.countSec, 46)).toBe(46);
		const mid = silverCountUp(SILVER_RECAP.delaySec + SILVER_RECAP.countSec / 2, 46);
		expect(mid > 0 && mid < 46).toBe(true);
		expect(silverCountUp(0, 46, true)).toBe(46);
	});
});

describe("silver: the wallet reads", () => {
	const archer: WalletStatus = {
		loaded: true,
		balance: 5,
		own: [
			{ itemId: "character.archer", level: 1 },
			{ itemId: "vigor", level: 2 },
		],
	};
	it("owned levels, characters, upgrades and the balance; an unknown or pending wallet owns the Knight only", () => {
		expect(statusLevel(archer, "vigor")).toBe(2);
		expect(statusOwns(archer, "archer")).toBe(true);
		expect(statusOwns(LOADED, "archer")).toBe(false);
		expect(statusOwns(undefined, "archer")).toBe(false);
		expect(statusOwns({ loaded: false }, "archer")).toBe(false);
		expect(statusOwns(undefined, DEFAULT_CHARACTER)).toBe(true);
		expect(statusUpgrades(archer)).toEqual({ vigor: 2, deepFlask: 0, plating: 0 });
		expect(statusUpgrades({ loaded: false })).toEqual(NO_UPGRADES);
		expect([statusBalance(archer), statusBalance(undefined)]).toEqual([5, 0]);
		expect(ownedCharacterOr(LOADED, "archer")).toBe(DEFAULT_CHARACTER);
		expect(ownedCharacterOr(archer, "archer")).toBe("archer");
		// before the first payload the pick stands (the server decides), unless strict
		expect(ownedCharacterOr(undefined, "archer")).toBe("archer");
		expect(ownedCharacterOr(undefined, "archer", true)).toBe(DEFAULT_CHARACTER);
		expect(ownedCharacterOr({ loaded: false }, "archer")).toBe(DEFAULT_CHARACTER);
	});

	it("item labels: a level in Roman numerals when the item has several, the name alone otherwise", () => {
		expect(armoryItemLabel("vigor", 2, s)).toBe("Vigor II");
		expect(armoryItemLabel("prospector", 4, s)).toBe("Prospector IV");
		expect(armoryItemLabel("plating", 1, s)).toBe("Plating");
		expect(armoryItemLabel("character.archer", 1, s)).toBe("The Archer");
	});
});
