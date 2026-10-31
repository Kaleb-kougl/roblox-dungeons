// The main menu's Daily card, yesterday's podium and the lobby world row (docs/DAILY.md DS9, DSD14 / DSD15): the
// preview from the day's seed, the best line per state, the unknown / stale status, the podium with fewer than 3
// entries, the host's toggle.
import { describe, expect, it } from "@rbxts/jest-globals";
import { BOSS_FLOOR_EVERY, bossKindFor, endlessRoster, floorSeed } from "shared/dungeon";
import { dailyResetsAt, dailyStatusFor, type DailyPodium, type DailyStatus } from "shared/daily";
import { PLACEHOLDER_MANIFEST, ThemePack, type StringVars } from "shared/theme";
import { ROSTER_VIEW, enemyNameKey } from "shared/view/hud";
import { dailyCardModel, dailyPodiumModel, dailyPreview, lobbyWorldModel } from "shared/view/menu";

const quiet = (): void => {};
const pack = new ThemePack(PLACEHOLDER_MANIFEST, { warn: quiet });
const str = (key: string, vars?: StringVars) => pack.str(key, vars);

const SEED = 1337;
const TODAY = 303;
const status = (patch: Partial<DailyStatus>): DailyStatus => ({ ...dailyStatusFor(TODAY, SEED), ...patch });

describe("daily preview (DSD14)", () => {
	it("floor 1's roster in join order and the first boss floor's boss", () => {
		const p = dailyPreview(SEED);
		expect([...p.roster]).toEqual(endlessRoster(SEED, 1));
		expect(p.roster[0]).toBe("swarmer");
		expect(p.roster.size()).toBe(2);
		expect(p.bossFloor).toBe(5);
		expect(p.bossFloor).toBe(BOSS_FLOOR_EVERY);
		expect(p.boss).toBe(bossKindFor(floorSeed(SEED, 5)));
	});
});

describe("daily card", () => {
	it("today's status: title, roster, boss, countdown end", () => {
		const m = dailyCardModel(status({}), TODAY, str);
		const p = dailyPreview(SEED);
		const names = p.roster.map((k) => str(enemyNameKey(k))).join(ROSTER_VIEW.separator);
		expect(m.title).toBe("DAILY #304 · Sat Oct 31");
		expect(m.known).toBe(true);
		expect(m.roster).toBe(`Floor 1: ${names}`);
		expect(m.boss).toBe(`Floor 5 boss: ${str(`${p.boss}.name`)}`);
		expect(m.placeholder).toBe("");
		expect(m.resetsAt).toBe(dailyResetsAt(TODAY));
		// No `mine` at all (no DataStore): no best line.
		expect(m.best).toBe("");
	});

	it("best today per state (DSD15)", () => {
		const best = (mine: DailyStatus["mine"]) => dailyCardModel(status({ mine }), TODAY, str).best;
		expect(best({})).toBe("Not played yet");
		expect(best({ coop: { score: 9000, floor: 4 } })).toBe("Not played yet");
		expect(best({ solo: { score: 23410, floor: 9, rank: 41, percentile: 9, total: 500 } })).toBe(
			"Your best today 23,410 · #41",
		);
		expect(best({ solo: { score: 23410, floor: 9, percentile: 9, total: 1240 } })).toBe(
			"Your best today 23,410 · top 9%",
		);
		expect(best({ solo: { score: 23410, floor: 9, rank: 3, total: 12 } })).toBe(
			"Your best today 23,410 · #3 of 12",
		);
		expect(best({ solo: { score: 23410, floor: 9 } })).toBe("Your best today 23,410");
	});

	it("unknown or stale status: title from the clock, a quiet placeholder, nothing else", () => {
		for (const s of [undefined, status({ day: TODAY - 1, label: TODAY })]) {
			const m = dailyCardModel(s, TODAY, str);
			expect(m).toEqual({
				title: "DAILY #304 · Sat Oct 31",
				known: false,
				roster: "",
				boss: "",
				best: "",
				placeholder: "Today's daily is on its way",
				resetsAt: undefined,
			});
		}
		expect(dailyCardModel(undefined, TODAY + 1, str).title).toBe("DAILY #305 · Sun Nov 1");
	});
});

const PODIUM: DailyPodium = {
	day: TODAY - 1,
	label: TODAY,
	top: [
		{ userId: 1, name: "Alex", score: 41230, floor: 15 },
		{ userId: 2, name: "Sam", score: 38800, floor: 14 },
		{ userId: 3, name: "Kim", score: 9050, floor: 6 },
	],
};

describe("yesterday's podium", () => {
	it("hidden when unknown or nobody played", () => {
		expect(dailyPodiumModel(undefined, str)).toBe(undefined);
		expect(dailyPodiumModel({ ...PODIUM, top: [] }, str)).toBe(undefined);
	});

	it("top 3 with places and scores; your finish when you played", () => {
		const m = dailyPodiumModel(
			{ ...PODIUM, mine: { score: 8120, floor: 5, rank: 57, percentile: 12, total: 480 } },
			str,
		);
		expect(m?.title).toBe("Yesterday's podium · Daily #303");
		expect(m?.rows.map((r) => [r.place, r.userId, r.name, r.placeText, r.score])).toEqual([
			[1, 1, "Alex", "#1", "41,230"],
			[2, 2, "Sam", "#2", "38,800"],
			[3, 3, "Kim", "#3", "9,050"],
		]);
		expect(m?.mine).toBe("You finished #57");
		expect(
			dailyPodiumModel({ ...PODIUM, mine: { score: 8120, floor: 5, percentile: 12, total: 1480 } }, str)?.mine,
		).toBe("You finished top 12%");
		expect(dailyPodiumModel({ ...PODIUM, mine: { score: 8120, floor: 5 } }, str)?.mine).toBe("You scored 8,120");
		expect(dailyPodiumModel(PODIUM, str)?.mine).toBe("");
	});

	it("fewer than 3 entries: only those places", () => {
		const m = dailyPodiumModel(
			{ ...PODIUM, top: [PODIUM.top[0], PODIUM.top[1]], mine: { score: 38800, floor: 14, rank: 2, total: 2 } },
			str,
		);
		expect(m?.rows.size()).toBe(2);
		expect(m?.mine).toBe("You finished #2 of 2");
		expect(dailyPodiumModel({ ...PODIUM, top: [PODIUM.top[0]] }, str)?.rows.map((r) => r.name)).toEqual(["Alex"]);
	});
});

describe("lobby world row", () => {
	const WORLDS = ["endless", "daily"];
	it("the host toggles while forming; others see a line", () => {
		const host = lobbyWorldModel("daily", WORLDS, true, true, str);
		expect([host.toggle, host.canEdit, host.label]).toEqual([true, true, "World"]);
		expect(host.options.map((o) => [o.world, o.text, o.active])).toEqual([
			["endless", "Endless", false],
			["daily", "Daily", true],
		]);
		expect(lobbyWorldModel("daily", WORLDS, true, false, str).canEdit).toBe(false);
		const guest = lobbyWorldModel("endless", WORLDS, false, true, str);
		expect([guest.toggle, guest.canEdit, guest.line]).toEqual([false, false, "World: Endless"]);
	});
});
