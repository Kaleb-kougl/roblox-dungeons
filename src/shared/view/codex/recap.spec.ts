// The Codex on the run-over panel (claude/codex-plan.md CX9, R12): the count (singular / plural keys), up to
// CODEX.recapIcons icons in the summary's order then `+N`, the completion; hidden with nothing new, unloaded or no
// summary; the row's height per layout; the build-online callout's hook reads the frozen summary.
import { describe, expect, it } from "@rbxts/jest-globals";
import { CODEX } from "shared/codex";
import { CODEX_STRING_KEYS, PLACEHOLDER_MANIFEST, ThemePack, type StringVars } from "shared/theme";
import { HUD_VIEW, ROOM_CLEAR_VIEW } from "shared/view/hud";
import { MENU_FIT } from "shared/view/menu";
import {
	CODEX_RECAP,
	CODEX_RECAP_STRINGS,
	codexRecapIconsWidth,
	codexRecapRow,
	codexRecapRowFit,
	codexRecapRowHeight,
	codexRecapRowLines,
	codexRecapRowWidth,
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

	it("one line on the wide panel and a landscape phone when it fits, two upright", () => {
		const line = math.max(CODEX_RECAP.iconBox, CODEX_RECAP.lineHeight);
		const gap = HUD_VIEW.gap;
		expect(codexRecapRowHeight("wide", gap)).toBe(line);
		expect(codexRecapRowHeight("compact", gap)).toBe(line);
		expect(codexRecapRowHeight("narrow", gap)).toBe(2 * line + gap);
		expect(codexRecapRowLines("narrow", codexRecapRow(summary(["boon:volatile"]), s), math.huge)).toBe(2);
	});

	it("the width estimate: the texts by the HUD font's advance, the strip, the Row's gaps", () => {
		const row = codexRecapRow(summary(SEVEN), s)!;
		const em = HUD_VIEW.smallText * ROOM_CLEAR_VIEW.tallyFit.glyphAspect;
		const bytes = row.countText.size() + row.moreText!.size() + row.totalText.size();
		expect(codexRecapRowWidth(row)).toBeCloseTo(
			bytes * em + codexRecapIconsWidth(CODEX.recapIcons) + 3 * HUD_VIEW.gap,
		);
	});

	it("the compact left column: a full strip without `+N` fits one line; a longer row shows fewer icons", () => {
		const left = MENU_FIT.runOverLeftWidth;
		const line = math.max(CODEX_RECAP.iconBox, CODEX_RECAP.lineHeight);
		const fiveIds = [...SEVEN].filter((_, i) => i < CODEX.recapIcons);
		const five = codexRecapRowFit(summary(fiveIds), s, "compact", left)!;
		expect([five.lines, five.row.icons.size(), five.row.moreText]).toEqual([1, CODEX.recapIcons, undefined]);
		expect(codexRecapRowHeight("compact", HUD_VIEW.gap, five)).toBe(line);
		const all = [...SEVEN, "boon:volatile", "boon:bounty", "boon:warding"];
		const full = codexRecapRow(summary(all, 86), s)!; // `10 new in the Codex`, 5 icons, `+5`, `Codex 100%`
		expect(codexRecapRowWidth(full)).toBeGreaterThan(left);
		const many = codexRecapRowFit(summary(all, 86), s, "compact", left)!;
		expect(many.lines).toBe(1);
		expect(many.row.icons.size()).toBeLessThan(CODEX.recapIcons);
		expect(many.row.icons.size()).toBeGreaterThanOrEqual(CODEX_RECAP.minIcons);
		expect(codexRecapRowWidth(many.row)).toBeLessThanOrEqual(left);
		expect(many.row.moreText).toBe(`+${all.size() - many.row.icons.size()}`);
		// one icon more would not fit
		expect(codexRecapRowWidth(codexRecapRow(summary(all, 86), s, many.row.icons.size() + 1)!)).toBeGreaterThan(
			left,
		);
		// the wide panel (its padding off both sides) keeps the whole row on one line
		const wide = codexRecapRowFit(summary(all, 86), s, "wide", HUD_VIEW.panelWidth * 2 - HUD_VIEW.pad * 4)!;
		expect([wide.lines, wide.row.icons.size()]).toEqual([1, CODEX.recapIcons]);
	});

	it("two lines when even the fewest icons do not fit, and always upright", () => {
		const line = math.max(CODEX_RECAP.iconBox, CODEX_RECAP.lineHeight);
		const tight = codexRecapRowFit(summary(SEVEN), s, "compact", 100)!;
		expect([tight.lines, tight.row.icons.size()]).toEqual([2, CODEX.recapIcons]);
		expect(codexRecapRowHeight("compact", HUD_VIEW.gap, tight)).toBe(2 * line + HUD_VIEW.gap);
		const upright = codexRecapRowFit(summary(["boon:volatile"]), s, "narrow", math.huge)!;
		expect(upright.lines).toBe(2);
		expect(codexRecapRowFit(summary([]), s, "compact", 400)).toBe(undefined);
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
