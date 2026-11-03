// The seeded roster on the stage card (docs/DAILY.md DS2, DSD13): the line per floor from the layout's roster (floor 1:
// every kind; a floor where kinds joined: "New: ..."; else none), its strings in every bundled pack, and its priority
// against new best's stage line (NEW DEEPEST > roster > the other new-best lines).
import { describe, expect, it } from "@rbxts/jest-globals";
import { buildEndlessFloor, endlessRoster, generateDungeon } from "shared/dungeon";
import {
	ENEMY_ARCHETYPES,
	PLACEHOLDER_MANIFEST,
	REQUIRED_STRING_KEYS,
	ROSTER_STRING_KEYS,
	ThemePack,
	type StringVars,
} from "shared/theme";
import { VALE_MANIFEST } from "shared/theme/packs/vale";
import {
	NEW_BEST_STRINGS,
	ROSTER_STRINGS,
	enemyNameKey,
	rosterNames,
	rosterJoined,
	stageBestLine,
	stageCardLine,
	stageRosterLine,
	type RunBaseline,
} from "shared/view/hud";

const quiet = (): void => {};
const pack = new ThemePack(PLACEHOLDER_MANIFEST, { warn: quiet });
const str = (key: string, vars?: StringVars) => pack.str(key, vars);
const known = (score: number, floor: number): RunBaseline => ({ kind: "known", board: "solo", score, floor });

/** The card's text for run `run` on `floor` (floor 1 as a run start), placeholder strings. */
function cardText(run: number, floor: number): string | undefined {
	const roster = endlessRoster(run, floor);
	const line = stageRosterLine(roster, floor > 1 ? endlessRoster(run, floor - 1) : undefined, str);
	return line === undefined ? undefined : str(line.key, line.args);
}

describe("roster line: strings", () => {
	it("are the contract's required ROSTER_STRING_KEYS, in every bundled pack, with {names}; every kind has a name", () => {
		expect([ROSTER_STRINGS.line, ROSTER_STRINGS.joined, ROSTER_STRINGS.separator]).toEqual([...ROSTER_STRING_KEYS]);
		for (const key of ROSTER_STRING_KEYS) expect([key, REQUIRED_STRING_KEYS.includes(key)]).toEqual([key, true]);
		for (const manifest of [PLACEHOLDER_MANIFEST, VALE_MANIFEST]) {
			const p = new ThemePack(manifest, { warn: quiet });
			for (const key of ROSTER_STRING_KEYS) expect([key, p.hasString(key)]).toEqual([key, true]);
		}
		expect(str(ROSTER_STRINGS.line, { names: "A" })).toBe("A");
		expect(str(ROSTER_STRINGS.joined, { names: "A" })).toBe("New: A");
		for (const kind of endlessRoster(1, 20)) {
			expect((ENEMY_ARCHETYPES as ReadonlyArray<string>).includes(kind)).toBe(true);
			expect(REQUIRED_STRING_KEYS.includes(enemyNameKey(kind))).toBe(true);
		}
		expect(str(ROSTER_STRINGS.separator)).toBe(" · ");
		// The separator is a string (docs/LOCALIZATION.md L1): a pack or a locale may change it.
		const slash = (key: string) => (key === ROSTER_STRINGS.separator ? " / " : key);
		expect(rosterNames(["swarmer", "imp"], slash)).toBe("enemy.swarmer.name / enemy.imp.name");
	});
});

describe("roster line per floor", () => {
	it("run start: every kind of floor 1's roster (swarmers first)", () => {
		expect(cardText(1337, 1)).toBe("Swarmer · Bruiser");
		const line = stageRosterLine(["swarmer", "bruiser"], undefined, str);
		expect(line).toEqual({ key: ROSTER_STRINGS.line, args: { names: "Swarmer · Bruiser" }, gold: false });
	});

	it("a floor where kinds joined: New: <names>; other floors: none (run 1337, floors 1-12)", () => {
		// Run 1337's order: bomber, stormcaller, bruiser, charger, reaper, sniper, ... (shared/dungeon roster.spec;
		// re-recorded for docs/NEW_ENEMIES.md NE7: 10 seeded kinds reshuffled every run's roster).
		const want: Array<string | undefined> = [
			"Swarmer · Bruiser",
			undefined,
			"New: Bomber",
			undefined,
			"New: Stormcaller",
			undefined,
			"New: Charger",
			undefined,
			"New: Reaper",
			undefined,
			"New: Sniper",
			undefined,
		];
		for (let f = 1; f <= want.size(); f++) expect([f, cardText(1337, f)]).toEqual([f, want[f - 1]]);
	});

	it("joins: the kinds missing from the floor before, in join order; several at once are joined", () => {
		expect(rosterJoined(["swarmer", "sniper", "imp"], ["swarmer", "sniper"])).toEqual(["imp"]);
		expect(rosterJoined(["swarmer", "sniper"], ["swarmer", "sniper"])).toEqual([]);
		const two = stageRosterLine(["swarmer", "sniper", "imp", "slime"], ["swarmer", "sniper"], str);
		expect(two).toEqual({ key: ROSTER_STRINGS.joined, args: { names: "Imp · Ooze" }, gold: false });
	});

	it("a floor without a roster (the tutorial's) or an empty one: none", () => {
		expect(stageRosterLine(undefined, undefined, str)).toBe(undefined);
		expect(stageRosterLine(undefined, ["swarmer"], str)).toBe(undefined);
		expect(stageRosterLine([], undefined, str)).toBe(undefined);
	});

	it("reads the built floor's roster (EndlessFloorLayout.roster)", () => {
		const l = buildEndlessFloor(1337, 3, generateDungeon);
		const line = stageRosterLine(l.roster, endlessRoster(1337, 2), str);
		expect(line === undefined ? undefined : str(line.key, line.args)).toBe("New: Bomber");
	});
});

describe("stage card line priority (DSD13)", () => {
	const K = NEW_BEST_STRINGS;
	const b = known(5000, 9);
	const roster = stageRosterLine(["swarmer", "sniper", "imp"], ["swarmer", "sniper"], str);

	it("NEW DEEPEST outranks the roster line", () => {
		const deepest = stageBestLine(10, b, false);
		expect(deepest?.key).toBe(K.stageNewDeepest);
		expect(stageCardLine(deepest, roster)).toBe(deepest);
	});

	it("the roster line outranks new best's other lines (to go, record floor, deepest yet)", () => {
		const others = [7, 8, 9].map((f) => stageBestLine(f, b, false)!);
		others.push(stageBestLine(11, b, true)!);
		expect(others.map((o) => o.key)).toEqual([K.stageToGo, K.stageToGo, K.stageRecordFloor, K.stageDeeperYet]);
		for (const o of others) expect(stageCardLine(o, roster)).toBe(roster);
	});

	it("without a roster line new best's line shows; without either, nothing", () => {
		const toGo = stageBestLine(7, b, false);
		expect(stageCardLine(toGo, undefined)).toBe(toGo);
		expect(stageCardLine(undefined, roster)).toBe(roster);
		expect(stageCardLine(undefined, undefined)).toBe(undefined);
	});
});
