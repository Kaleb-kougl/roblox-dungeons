// How the run-over recap is drawn (docs/RUN_RECAP.md RR5 / RR6; recapUi.ts): the near-miss and highlight texts at a
// counted value, the row fade, the record rows' end, the Best line rule; and every RECAP_STRINGS key is a contract
// string (RECAP_STRING_KEYS) with English text in the placeholder pack.
import { describe, expect, it } from "@rbxts/jest-globals";
import { PLACEHOLDER_MANIFEST, RECAP_STRING_KEYS, REQUIRED_STRING_KEYS, ThemePack } from "shared/theme";
import {
	COMBO_TIERS,
	NEW_BEST,
	RECAP_STRINGS,
	RECAP_UI,
	RecapTimeline,
	recapExitSizes,
	recapHidesBestLine,
	recapHighlightValue,
	recapNearMissText,
	recapRecordRowsSec,
	recapRowTransparency,
	recapStringKeys,
	type RecapHighlight,
	type RecapNearMiss,
} from ".";

const quiet = (): void => {};
const pack = new ThemePack(PLACEHOLDER_MANIFEST, { warn: quiet });
const s = (key: string, vars?: Readonly<Record<string, string | number>>) => pack.str(key, vars);

function cell(patch: Partial<RecapHighlight>): RecapHighlight {
	return { id: "kills", key: RECAP_STRINGS.hlKills, value: 0, from: 0, format: "int", scope: undefined, ...patch };
}

describe("recap strings (RR3 / RR5)", () => {
	it("every RECAP_STRINGS key is in the contract's RECAP_STRING_KEYS and REQUIRED_STRING_KEYS", () => {
		const contract = [...RECAP_STRING_KEYS];
		contract.sort();
		expect(recapStringKeys()).toEqual(contract);
		for (const key of recapStringKeys()) {
			expect([key, REQUIRED_STRING_KEYS.includes(key)]).toEqual([key, true]);
		}
	});

	it("every RECAP_STRINGS key has English text in the placeholder pack", () => {
		for (const key of recapStringKeys()) {
			expect([key, pack.hasString(key)]).toEqual([key, true]);
			const text = pack.str(key);
			expect([key, text !== "" && text !== key]).toEqual([key, true]);
		}
	});
});

describe("recap texts (RR5)", () => {
	it("the near-miss line at its counted value, numbers grouped, the boss named", () => {
		const boss: RecapNearMiss = {
			kind: "boss",
			key: RECAP_STRINGS.nearBoss,
			vars: { pct: 9 },
			bossKey: "boss.demonlord.name",
			countVar: "pct",
			dim: false,
		};
		expect(recapNearMissText(boss, 4, s)).toBe(`${pack.str("boss.demonlord.name")} had 4% left`);
		expect(recapNearMissText(boss, 9, s)).toBe(`${pack.str("boss.demonlord.name")} had 9% left`);
		const score: RecapNearMiss = {
			kind: "score",
			key: RECAP_STRINGS.nearScore,
			vars: { gap: 1240 },
			countVar: "gap",
			dim: false,
		};
		expect(recapNearMissText(score, 1240, s)).toBe("1,240 short of your best");
		const stairs: RecapNearMiss = {
			kind: "stairs",
			key: RECAP_STRINGS.nearStairs,
			vars: { tiles: 8, next: 5 },
			countVar: "tiles",
			dim: false,
		};
		expect(recapNearMissText(stairs, 3, s)).toBe("3 tiles from floor 5");
		const floor: RecapNearMiss = { kind: "recordFloor", key: RECAP_STRINGS.nearRecordFloor, vars: {}, dim: true };
		expect(recapNearMissText(floor, 0, s)).toBe("One more floor for a new deepest");
	});

	it("a highlight's value: grouped, `{n} of {total}`, or the combo with the counted tier's name", () => {
		expect(recapHighlightValue(cell({ value: 1240 }), 1240, s)).toBe("1,240");
		const perfect = cell({
			id: "perfect",
			key: RECAP_STRINGS.hlPerfect,
			value: 7,
			valueKey: RECAP_STRINGS.hlOfTotal,
			vars: { total: 11 },
		});
		expect(recapHighlightValue(perfect, 3, s)).toBe("3 of 11");
		const combo = cell({ id: "combo", key: RECAP_STRINGS.hlCombo, value: 42, from: 10, format: "combo" });
		// x1.3: below RAMPAGE, the multiplier alone; x4.2: DOMINATING in the tier's colour.
		expect(recapHighlightValue(combo, 13, s, "#ff0000")).toBe("x1.3");
		const named = recapHighlightValue(combo, 42, s, "#ff0000");
		expect(named.find("x4.2", 1, true)[0]).toBe(1);
		expect(named.find(pack.str(COMBO_TIERS[3].nameKey!), 1, true)[0] !== undefined).toBe(true);
		expect(named.find('<font color="#ff0000">', 1, true)[0] !== undefined).toBe(true);
	});

	it("a row fades up over fadeSec from its start, hidden before", () => {
		const t = new RecapTimeline({
			nearMiss: { from: 0, to: 8, counted: true },
			highlights: [],
			reducedMotion: false,
		});
		const row = t.rows[0];
		expect(recapRowTransparency(row, 0)).toBe(1);
		t.step(row.startSec);
		expect(recapRowTransparency(row, row.startSec)).toBe(1);
		expect(recapRowTransparency(row, row.startSec + RECAP_UI.fadeSec / 2)).toBeCloseTo(0.5, 6);
		expect(recapRowTransparency(row, row.startSec + RECAP_UI.fadeSec)).toBeCloseTo(0, 9);
		expect(recapRowTransparency(row, row.startSec + 2 * RECAP_UI.fadeSec)).toBe(0);
	});

	it("new best's record rows end when the last one landed; FIRST RECORD's at the rows' start", () => {
		const R = NEW_BEST.runOver;
		expect(recapRecordRowsSec(1)).toBeCloseTo(R.rowDelaySec + R.rollSec, 9);
		expect(recapRecordRowsSec(2)).toBeCloseTo(R.rowDelaySec + R.rowGapSec + R.rollSec, 9);
		expect(recapRecordRowsSec(0)).toBe(R.rowDelaySec);
	});

	it("the dim Best line steps aside for the near-miss line", () => {
		expect(recapHidesBestLine(undefined)).toBe(false);
		expect(
			recapHidesBestLine({
				kind: "fullClear",
				key: RECAP_STRINGS.nearFullClearOne,
				vars: { rooms: 1 },
				dim: false,
			}),
		).toBe(true);
	});

	it("Again is the largest exit in every layout", () => {
		for (const layout of ["wide", "compact", "narrow"] as const) {
			const e = recapExitSizes(layout);
			expect([layout, e.again.x > e.other.x]).toEqual([layout, true]);
		}
	});
});
