// The Codex screen's rules (claude/codex-plan.md CX7): grid columns from the width, the tab row's counts and dots, the
// tiles' states and dots (cleared once focused), boons by rarity, the sub-headers, the detail panel per state (hints
// per R3, the duo recipe only once both boons are found, the character tag per R7, the Found line skipping zero
// parts), the completion and the badge.
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	CODEX_TABS,
	CodexTier,
	applyClaims,
	catalogTotal,
	codexDay,
	emptyCodexDoc,
	type CodexClaim,
	type CodexDoc,
} from "shared/codex";
import { DAILY } from "shared/daily";
import { BOONS, Rarity } from "shared/sim";
import { CODEX_STRING_KEYS, PLACEHOLDER_MANIFEST, ThemePack, type StringVars } from "shared/theme";
import {
	CODEX_SCREEN,
	CODEX_SCREEN_STRINGS,
	CodexViewDwell,
	codexBadgeText,
	codexCompletionPct,
	codexDateText,
	codexDetail,
	codexGridColumns,
	codexGridGroups,
	codexGridIds,
	codexGridWidth,
	codexNewCount,
	codexStatusLine,
	codexTabLabel,
	codexTabRowWidth,
	codexTabRows,
	codexTabScrollX,
	codexTabWidth,
	codexTileNew,
	codexTileState,
} from ".";

const pack = new ThemePack(PLACEHOLDER_MANIFEST, { warn: () => undefined });
const s = (key: string, vars?: StringVars) => pack.str(key, vars);
const DAY = codexDay(DAILY.epochSeconds) + 306; // 3 Nov 2026

function docWith(claims: ReadonlyArray<CodexClaim>, day = DAY, unread = true): CodexDoc {
	return applyClaims(emptyCodexDoc(), claims, day, unread);
}

const found = (id: string, floor = 7): CodexClaim => ({ id, tier: CodexTier.FOUND, floor });
const seen = (id: string): CodexClaim => ({ id, tier: CodexTier.SEEN, floor: 0 });

describe("codex grid", () => {
	it("fits whole tiles in the width at any scale, clamped", () => {
		const S = CODEX_SCREEN;
		const step = S.tile + S.tileGap;
		expect(codexGridColumns(codexGridWidth(8), 1)).toBe(8);
		expect(codexGridColumns(codexGridWidth(8) - 1, 1)).toBe(7);
		// Screen px at a 0.75 UIScale: the same reference width.
		expect(codexGridColumns(codexGridWidth(6) * 0.75, 0.75)).toBe(6);
		expect(codexGridColumns(S.gridWidth, 1)).toBe(math.floor((S.gridWidth + S.tileGap) / step));
		expect(codexGridColumns(10, 1)).toBe(S.minColumns);
		expect(codexGridColumns(100000, 1)).toBe(S.maxColumns);
		expect(codexGridColumns(codexGridWidth(5), 0)).toBe(5);
		expect(codexGridColumns(-5, 1)).toBe(S.minColumns);
	});

	it("each layout's grid and detail fit its panel", () => {
		const S = CODEX_SCREEN;
		for (const [w, grid] of [
			[S.width, S.gridWidth],
			[S.compactWidth, S.compactGridWidth],
		] as const) {
			const detail = w - 2 * S.pad - grid - S.detailGap;
			expect([w, detail >= S.artBox + 2 * S.pad]).toEqual([w, true]);
			expect([w, codexGridWidth(codexGridColumns(grid, 1)) <= grid]).toEqual([w, true]);
		}
		const narrowInner = S.narrowWidth - 2 * S.pad;
		expect(codexGridWidth(codexGridColumns(narrowInner, 1))).toBeLessThanOrEqual(narrowInner);
		// The desktop tab row fits without scrolling; the narrow one scrolls.
		expect(codexTabRowWidth(6)).toBeLessThanOrEqual(S.width - 2 * S.pad);
		expect(codexTabRowWidth(6)).toBeGreaterThan(narrowInner);
	});

	it("tiles: unknown / seen / found, NEW dots from unread until focused", () => {
		const doc = docWith([found("boon:volatile"), seen("enemy:imp")]);
		expect(codexTileState(doc, "boon:volatile")).toBe("found");
		expect(codexTileState(doc, "enemy:imp")).toBe("seen");
		expect(codexTileState(doc, "boon:hearty")).toBe("unknown");
		expect(codexTileState(undefined, "boon:volatile")).toBe("unknown");
		expect(codexTileNew(doc, "boon:volatile")).toBe(true);
		expect(codexTileNew(doc, "boon:volatile", new Set(["boon:volatile"]))).toBe(false);
		expect(codexTileNew(doc, "boon:hearty")).toBe(false);
		expect(codexNewCount(doc)).toBe(2);
		expect(codexNewCount(doc, new Set(["enemy:imp"]))).toBe(1);
		// A seeded doc (no NEW dots).
		const quiet = docWith([found("boon:volatile")], DAY, false);
		expect(codexTileNew(quiet, "boon:volatile")).toBe(false);
	});

	it("boons sort by rarity (common, rare, legendary), data order within one", () => {
		const [g] = codexGridGroups("boons", undefined);
		expect(g.headerKey).toBe(undefined);
		expect(g.tiles.size()).toBe(catalogTotal("boons"));
		let last: number = Rarity.COMMON;
		for (const t of g.tiles) {
			const def = BOONS.find((b) => `boon:${b.id.sub(6)}` === t.id)!;
			expect([t.id, def.rarity >= last]).toEqual([t.id, true]);
			last = def.rarity;
		}
		expect(g.tiles[0].id).toBe("boon:swiftStrikes");
	});

	it("the items tab and the Bestiary have sub-headers per group", () => {
		const items = codexGridGroups("items", undefined);
		expect(items.map((g) => g.headerKey)).toEqual(["codex.group.relics", "codex.group.curses"]);
		const beasts = codexGridGroups("bestiary", undefined);
		expect(beasts.map((g) => g.group)).toEqual(["enemies", "champions", "bosses"]);
		expect(beasts.map((g) => g.tiles.size())).toEqual([12, 4, 2]);
		expect(beasts[2].tiles.map((t) => t.id)).toEqual(["boss:act1", "boss:demonlord"]);
		let n = 0;
		for (const tab of CODEX_TABS) n += codexGridIds(tab).size();
		expect(n).toBe(catalogTotal());
	});
});

describe("codex tab row", () => {
	it("found / total per tab, a dot when anything inside is NEW", () => {
		const doc = docWith([found("boon:volatile"), seen("boon:hearty"), found("boss:act1")]);
		const rows = codexTabRows(doc);
		expect(rows.map((r) => r.tab)).toEqual([...CODEX_TABS]);
		const boons = rows[0];
		expect([boons.found, boons.total, boons.isNew]).toEqual([1, 20, true]);
		expect(codexTabLabel(boons, s)).toBe("Boons 1/20");
		expect(rows.map((r) => r.isNew)).toEqual([true, false, false, false, false, true]);
		const viewed = new Set(["boon:volatile", "boon:hearty"]);
		expect(codexTabRows(doc, viewed)[0].isNew).toBe(false);
		expect(codexTabRows(undefined).map((r) => r.found)).toEqual([0, 0, 0, 0, 0, 0]);
	});

	it("long-named tabs are wider; the scroll keeps the current tab in view", () => {
		expect(codexTabWidth("items")).toBe(CODEX_SCREEN.tab.wideW);
		expect(codexTabWidth("boons")).toBe(CODEX_SCREEN.tab.w);
		const gap = 6;
		const view = 300;
		expect(codexTabScrollX("boons", gap, view, 0)).toBe(0);
		const x = codexTabScrollX("bestiary", gap, view, 0);
		expect(x).toBe(codexTabRowWidth(gap) - view);
		// Already in view: unchanged; back to the first: 0.
		expect(codexTabScrollX("bestiary", gap, view, x)).toBe(x);
		expect(codexTabScrollX("boons", gap, view, x)).toBe(0);
		// A view wider than the row never scrolls.
		expect(codexTabScrollX("bestiary", gap, 5000, 40)).toBe(0);
	});
});

describe("codex detail", () => {
	it("an unknown tile: ??? and its hint (R3), the character tag (R7)", () => {
		const d = (id: string, doc?: CodexDoc) => codexDetail(id, doc, s)!;
		const swarmer = d("enemy:swarmer");
		expect([swarmer.name, swarmer.nameRole, swarmer.kind, swarmer.status]).toEqual([
			"???",
			"uiTextDim",
			undefined,
			undefined,
		]);
		expect([swarmer.body, swarmer.bodyIsHint]).toEqual(["Lurks deeper in the dungeon", true]);
		expect(d("affix:swift").body).toBe("Champions from floor 4");
		expect(d("affix:shielded").body).toBe("Champions from floor 7");
		expect(d("boss:act1").body).toBe("Waits every 5 floors");
		expect(d("boon:volatile").body).toBe("???");
		expect(d("relic:mirrorCloak").requires).toBe("Knight only");
		expect(d("boon:piercingArrows").requires).toBe("Archer only");
		expect(d("boon:volatile").requires).toBe(undefined);
		expect(codexDetail("nope", undefined, s)).toBe(undefined);
	});

	it("evolution and duo hints wait for their boons to be found", () => {
		const d = (id: string, doc?: CodexDoc) => codexDetail(id, doc, s)!;
		expect(d("evo:sharpened").body).toBe("???");
		expect(d("evo:sharpened", docWith([seen("boon:sharpened")])).body).toBe("???");
		expect(d("evo:sharpened", docWith([found("boon:sharpened")])).body).toBe("Take Sharpened three times");
		expect(d("duo:chainReaction").body).toBe("Combine two boons");
		expect(d("duo:chainReaction", docWith([found("boon:volatile")])).body).toBe("Combine two boons");
		expect(d("duo:chainReaction", docWith([found("boon:volatile"), found("boon:chainSpark")])).body).toBe(
			"Recipe: Volatile + Chain Spark",
		);
	});

	it("seen and found: name in the role colour, kind line, description, state line", () => {
		const doc = docWith([found("boon:sharpened", 9), seen("enemy:imp"), seen("duo:fireArrows")]);
		const boon = codexDetail("boon:sharpened", doc, s)!;
		expect([boon.name, boon.nameRole, boon.kind, boon.bodyIsHint]).toEqual([
			"Sharpened",
			"boon.rare",
			"Rare boon",
			false,
		]);
		expect(boon.body).toBe(s("boon.sharpened.desc"));
		expect(boon.status).toBe("Found on floor 9 · 3 Nov 2026");
		const imp = codexDetail("enemy:imp", doc, s)!;
		expect([imp.name, imp.kind, imp.body, imp.status]).toEqual(["Imp", "Enemy", s("bestiary.imp"), "Seen"]);
		// A duo's two boons, unknown ones as ???.
		const duo = codexDetail("duo:fireArrows", doc, s)!;
		expect([duo.nameRole, duo.kind]).toEqual(["boon.duo", "Duo"]);
		expect(duo.duo!.map((b) => [b.name, b.known])).toEqual([
			["???", false],
			["???", false],
		]);
		const both = codexDetail("duo:fireArrows", docWith([seen("duo:fireArrows"), seen("boon:emberWake")]), s)!;
		expect(both.duo!.map((b) => b.name)).toEqual(["Ember Wake", "???"]);
		// An evolution names its boon in the kind line (??? until the boon is seen).
		const evo = codexDetail("evo:sharpened", docWith([seen("evo:sharpened")]), s)!;
		expect([evo.name, evo.nameRole, evo.kind, evo.boon?.known]).toEqual([
			"Executioner",
			"boon.evolved",
			"Evolution of ???",
			false,
		]);
		const evo2 = codexDetail("evo:sharpened", docWith([seen("evo:sharpened"), found("boon:sharpened")]), s)!;
		expect(evo2.kind).toBe("Evolution of Sharpened");
		const champion = codexDetail("affix:swift", docWith([found("affix:swift")]), s)!;
		expect([champion.name, champion.nameRole, champion.kind]).toEqual(["Swift", "affix.swift", "Champion"]);
		const boost = codexDetail("boost:fury", docWith([found("boost:fury")]), s)!;
		expect([boost.nameRole, boost.kind]).toEqual(["boost.fury", "Boost"]);
		expect(codexDetail("boss:act1", docWith([found("boss:act1")]), s)!.name).toBe("Mother Mayhem");
	});

	it("the Found line skips the zero parts (a seeded / fake entry)", () => {
		expect(codexStatusLine([CodexTier.FOUND, DAY, 9], s)).toBe("Found on floor 9 · 3 Nov 2026");
		expect(codexStatusLine([CodexTier.FOUND, 0, 9], s)).toBe("Found on floor 9");
		expect(codexStatusLine([CodexTier.FOUND, DAY, 0], s)).toBe("Found · 3 Nov 2026");
		expect(codexStatusLine([CodexTier.FOUND, 0, 0], s)).toBe("Found");
		expect(codexStatusLine([CodexTier.SEEN, 0, 0], s)).toBe("Seen");
		expect(codexStatusLine(undefined, s)).toBe(undefined);
		expect(codexDateText(codexDay(DAILY.epochSeconds), s)).toBe("1 Jan 2026");
	});
});

describe("codex completion and badge", () => {
	it("floors the percentage: 100 only when everything is found", () => {
		expect(codexCompletionPct(0, 86)).toBe(0);
		expect(codexCompletionPct(35, 86)).toBe(40);
		expect(codexCompletionPct(85, 86)).toBe(98);
		expect(codexCompletionPct(86, 86)).toBe(100);
		expect(codexCompletionPct(3, 0)).toBe(0);
	});

	it("the badge: none at 0, the count up to 9, then 9+", () => {
		expect(codexBadgeText(0, s)).toBe(undefined);
		expect(codexBadgeText(1, s)).toBe("1");
		expect(codexBadgeText(9, s)).toBe("9");
		expect(codexBadgeText(10, s)).toBe("9+");
		expect(codexBadgeText(57, s)).toBe("9+");
	});

	it("uses only the Codex's theme strings", () => {
		for (const [, key] of pairs(CODEX_SCREEN_STRINGS))
			expect([key, CODEX_STRING_KEYS.includes(key)]).toEqual([key, true]);
	});
});

describe("codex viewed dwell", () => {
	const D = CODEX_SCREEN.viewDwellSeconds;

	it("activation views at once; focus only after the dwell (hover, pad selection, the default selection on open)", () => {
		expect(D > 0 && D < 1).toBe(true);
		const d = new CodexViewDwell();
		// the default selection on open: nothing until it dwelt
		d.focus("boon:volatile", 0);
		expect(d.due(0)).toBe(undefined);
		expect(d.due(D * 0.9)).toBe(undefined);
		expect(d.due(D)).toBe("boon:volatile");
		// reported once
		expect(d.due(D * 3)).toBe(undefined);
		expect(d.activate("enemy:imp")).toBe("enemy:imp");
	});

	it("passing over tiles views nothing; a repeat focus keeps the start; a blur or a tab change stops it", () => {
		const d = new CodexViewDwell();
		d.focus("a:x", 0);
		d.focus("a:y", D / 2);
		expect(d.due(D)).toBe(undefined);
		d.focus("a:y", D);
		expect(d.due(D * 2)).toBe("a:y");
		d.focus("a:z", 2);
		d.blur("a:other");
		d.blur("a:z");
		expect(d.due(2 + D * 2)).toBe(undefined);
		d.focus("a:z", 5);
		d.blur();
		expect(d.due(5 + D * 2)).toBe(undefined);
		// an activated tile's dwell ends with it
		d.focus("a:w", 9);
		d.activate("a:w");
		expect(d.due(9 + D * 2)).toBe(undefined);
	});
});
