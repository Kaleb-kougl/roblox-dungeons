// The Codex on the run-over panel (claude/codex-plan.md CX9, R12): the count (singular / plural keys), up to
// CODEX.recapIcons icons in the summary's order then `+N`, the completion; hidden with nothing new, unloaded or no
// summary; the row's height per layout; the build-online callout's hook reads the frozen summary.
import { describe, expect, it } from "@rbxts/jest-globals";
import { CODEX } from "shared/codex";
import { CODEX_STRING_KEYS, PLACEHOLDER_MANIFEST, ThemePack, type StringVars } from "shared/theme";
import {
	CODEX_RECAP,
	CODEX_RECAP_STRINGS,
	codexRecapIconsWidth,
	codexRecapRow,
	codexRecapRowHeight,
	codexSummaryHas,
	type CodexRunSummary,
} from ".";

const pack = new ThemePack(PLACEHOLDER_MANIFEST, { warn: () => undefined });
const s = (key: string, vars?: StringVars) => pack.str(key, vars);

function summary(newIds: string[], foundTotal = 35, loaded = true): CodexRunSummary {
	return { newIds, foundTotal, catalogTotal: 86, loaded };
}

const SEVEN = [
	"boon:overkill",
	"duo:fireArrows",
	"evo:volatile",
	"boss:act1",
	"boon:hearty",
	"enemy:imp",
	"boost:fury",
];

describe("codex run-over row", () => {
	it("hidden with nothing new, before the load, or without a summary", () => {
		expect(codexRecapRow(summary([]), s)).toBe(undefined);
		expect(codexRecapRow(summary(["boon:volatile"], 3, false), s)).toBe(undefined);
		expect(codexRecapRow(undefined, s)).toBe(undefined);
	});

	it("one: the singular line, its icon, the completion", () => {
		const row = codexRecapRow(summary(["boon:volatile"], 1), s)!;
		expect([row.countText, row.icons, row.moreText, row.totalText]).toEqual([
			"1 new in the Codex",
			["boon:volatile"],
			undefined,
			"Codex 1%",
		]);
	});

	it("many: the count, the first CODEX.recapIcons in summary order, +N for the rest", () => {
		const row = codexRecapRow(summary(SEVEN), s)!;
		expect(row.countText).toBe("7 new in the Codex");
		expect(row.icons.size()).toBe(CODEX.recapIcons);
		expect(row.icons).toEqual(["boon:overkill", "duo:fireArrows", "evo:volatile", "boss:act1", "boon:hearty"]);
		expect(row.moreText).toBe("+2");
		expect(row.totalText).toBe("Codex 40%");
		expect(codexRecapRow(summary(["a:b", "c:d"]), s)!.moreText).toBe(undefined);
	});

	it("one line on the wide panel and a landscape phone, two upright; the strip leaves the text room", () => {
		const line = math.max(CODEX_RECAP.iconBox, CODEX_RECAP.lineHeight);
		expect(codexRecapRowHeight("wide", 6)).toBe(line);
		expect(codexRecapRowHeight("compact", 6)).toBe(line);
		expect(codexRecapRowHeight("narrow", 6)).toBe(2 * line + 6);
		// The compact left column (MENU_FIT.runOverLeftWidth 400): the strip and `+N` leave over half for the texts.
		expect(codexRecapIconsWidth(CODEX.recapIcons) + 6 + 40).toBeLessThanOrEqual(400 / 2);
	});

	it("the callout hook: an entry new on the frozen run", () => {
		expect(codexSummaryHas(summary(SEVEN), "duo:fireArrows")).toBe(true);
		expect(codexSummaryHas(summary(SEVEN), "duo:chainReaction")).toBe(false);
		expect(codexSummaryHas(undefined, "duo:fireArrows")).toBe(false);
	});

	it("uses only the Codex's theme strings", () => {
		for (const [, key] of pairs(CODEX_RECAP_STRINGS))
			expect([key, CODEX_STRING_KEYS.includes(key)]).toEqual([key, true]);
	});
});
