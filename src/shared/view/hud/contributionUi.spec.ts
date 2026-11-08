// How the co-op contribution is drawn (docs/RUN_CONTRIBUTION.md CT5; contributionUi.ts):
//   - the tabs: order (You first), the LB / RB / Q / E / Tab step wrapping, when they show, their labels
//   - the share bar's segments: index order, whole px summing to the bar, the local one flagged, zero shares skipped
//   - a You cell's value text at a counted value (share form, the pickups parts filling boosts first, plain numbers)
//   - the Party row texts, the header, share and standing lines (placeholder English)
//   - the layout numbers: every piece fits the box (316 on a phone, four highlight cells on desktop), the box is the
//     taller of You and Team, the Party list scrolls for 8 players and not for 4
import { describe, expect, it } from "@rbxts/jest-globals";
import { SIM_HZ } from "shared/sim";
import { PLACEHOLDER_MANIFEST, REQUIRED_STRING_KEYS, ThemePack } from "shared/theme";
import { NO_RECAP_TALLY, RECAP_ALIVE_TICK, type RecapTallySource } from "shared/view/fx";
import {
	CONTRIB_PARTY_COLUMNS,
	CONTRIB_UI,
	HUD_VIEW,
	RECAP_CELL,
	RECAP_FIRST_TAB,
	RECAP_TABS,
	RECAP_UI,
	contribBoxHeight,
	contribBoxWidth,
	contribCardHeight,
	contribCellRows,
	contribCellText,
	contribHeaderText,
	contribPartyHeight,
	contribPartyScrolls,
	contribPartyTexts,
	contribShareBarShown,
	contribShareSegments,
	contribShareText,
	contribStandingLine,
	contribTabBodyHeight,
	contribTabsSize,
	contributionOf,
	recapGridSize,
	recapTabKey,
	recapTabStep,
	recapTabsShown,
	type ContribCell,
	type RecapLayout,
	type RunContribution,
} from ".";

const quiet = (): void => {};
const pack = new ThemePack(PLACEHOLDER_MANIFEST, { warn: quiet });
const s = (key: string, vars?: Readonly<Record<string, string | number>>) => pack.str(key, vars);
const LAYOUTS: ReadonlyArray<RecapLayout> = ["wide", "compact", "narrow"];

function filled(n: number, v: number): number[] {
	const out: number[] = [];
	for (let i = 0; i < n; i++) out.push(v);
	return out;
}

/** A finished party run of `n` players: every counter set, so every You cell shows (7 cells). */
function party(n: number, patch: Partial<RecapTallySource> = {}, localIndex = 0): RunContribution {
	const names: string[] = [];
	for (let i = 0; i < n; i++) names.push(`Player${i}`);
	const tally: RecapTallySource = {
		...NO_RECAP_TALLY,
		parries: filled(n, 3),
		grazes: filled(n, 20),
		kills: filled(n, 40),
		damage: filled(n, 4000),
		bossDamage: filled(n, 300),
		hits: filled(n, 2),
		pellets: filled(n, 11),
		boosts: filled(n, 2),
		deathTick: filled(n, 600 * SIM_HZ),
		deathFloor: filled(n, 7),
		leftFloor: filled(n, 0),
		lastTick: 600 * SIM_HZ,
		...patch,
	};
	return contributionOf({ tally, partySize: n, localIndex, names })!;
}

describe("the tabs (CT5 / CT6)", () => {
	it("You | Team | Party, opening on You; labels are contract strings", () => {
		expect([...RECAP_TABS]).toEqual(["you", "team", "party"]);
		expect(RECAP_FIRST_TAB).toBe("you");
		expect(RECAP_TABS.map((t) => s(recapTabKey(t)))).toEqual(["You", "Team", "Party"]);
		for (const t of RECAP_TABS) expect(REQUIRED_STRING_KEYS.includes(recapTabKey(t))).toBe(true);
	});

	it("a step wraps around both ways; 0 stays", () => {
		expect(recapTabStep("you", 1)).toBe("team");
		expect(recapTabStep("team", 1)).toBe("party");
		expect(recapTabStep("party", 1)).toBe("you");
		expect(recapTabStep("you", -1)).toBe("party");
		expect(recapTabStep("party", -1)).toBe("team");
		expect(recapTabStep("team", 0)).toBe("team");
	});

	it("show only with a contribution (party runs) and the Team tab's highlights", () => {
		const c = party(2);
		expect(recapTabsShown(c, 2)).toBe(true);
		expect(recapTabsShown(c, 0)).toBe(false);
		expect(recapTabsShown(undefined, 4)).toBe(false);
	});
});

describe("the share bar", () => {
	it("segments in index order, summing to the bar's width, the local one flagged", () => {
		const segs = contribShareSegments([41, 38, 21], 1, 140);
		expect(segs.map((g) => g.index)).toEqual([0, 1, 2]);
		expect(segs.map((g) => g.local)).toEqual([false, true, false]);
		let w = 0;
		for (const g of segs) w += g.w;
		expect(w).toBe(140);
		expect(segs[0].x).toBe(0);
		expect(segs[1].x).toBe(segs[0].w);
		expect(segs[2].x + segs[2].w).toBe(140);
	});

	it("a zero share draws nothing; nothing at all without damage", () => {
		const segs = contribShareSegments([0, 100, 0], 0, 140);
		expect(segs.size()).toBe(1);
		expect([segs[0].index, segs[0].x, segs[0].w, segs[0].local]).toEqual([1, 0, 140, false]);
		expect(contribShareSegments([0, 0], 0, 140)).toEqual([]);
		expect(contribShareSegments([50, 50], 0, 0)).toEqual([]);
	});

	it("8 even players: every px used, no segment empty", () => {
		const segs = contribShareSegments([13, 13, 13, 13, 12, 12, 12, 12], 7, 140);
		expect(segs.size()).toBe(8);
		let w = 0;
		for (const g of segs) {
			expect(g.w >= 1).toBe(true);
			w += g.w;
		}
		expect(w).toBe(140);
		expect(segs[7].local).toBe(true);
	});

	it("draws when the Damage cell exists", () => {
		expect(contribShareBarShown(party(2))).toBe(true);
		expect(contribShareBarShown(party(2, { damage: [0, 0] }))).toBe(false);
	});
});

describe("You cell texts at a counted value", () => {
	const cell = (patch: Partial<ContribCell>): ContribCell => ({ kind: "kills", labelKey: "", value: 0, ...patch });

	it("a share cell: `{value} · {pct}%`, the number counted and grouped, the share final", () => {
		const c = cell({ kind: "damage", value: 12480, share: 41 });
		expect(contribCellText(c, 12480, s)).toBe("12,480 · 41%");
		expect(contribCellText(c, 0, s)).toBe("0 · 41%");
	});

	it("plain cells: the grouped number", () => {
		expect(contribCellText(cell({ kind: "parries", value: 14 }), 7, s)).toBe("7");
		expect(contribCellText(cell({ kind: "grazes", value: 1063 }), 1063, s)).toBe("1,063");
	});

	it("pickups: both parts, boosts filling first; singular forms; a dropped part left out", () => {
		const both = cell({ kind: "pickups", value: 26, boosts: 4, pellets: 22 });
		expect(contribCellText(both, 26, s)).toBe("4 boosts · 22 pellets");
		expect(contribCellText(both, 3, s)).toBe("3 boosts · 0 pellets");
		expect(contribCellText(both, 5, s)).toBe("4 boosts · 1 pellet");
		const one = cell({ kind: "pickups", value: 2, boosts: 1, pellets: 1 });
		expect(contribCellText(one, 2, s)).toBe("1 boost · 1 pellet");
		const noPellets = cell({ kind: "pickups", value: 3, boosts: 3, pellets: undefined });
		expect(contribCellText(noPellets, 3, s)).toBe("3 boosts");
		const noBoosts = cell({ kind: "pickups", value: 9, boosts: undefined, pellets: 9 });
		expect(contribCellText(noBoosts, 4, s)).toBe("4 pellets");
	});

	it("RichText-escaped (the cell draws RichText)", () => {
		const evil = (key: string, vars?: Readonly<Record<string, string | number>>) =>
			key === "run.recap.you.share" ? `<b>${vars?.value}</b>` : s(key, vars);
		expect(contribCellText(cell({ kind: "damage", value: 5, share: 50 }), 5, evil)).toBe("&lt;b&gt;5&lt;/b&gt;");
	});
});

describe("the card's and the Party rows' texts (placeholder English)", () => {
	it("header, share, standing", () => {
		const c = party(2, { damage: [300, 100], deathTick: [100 * SIM_HZ, 200 * SIM_HZ], lastDeath: 1 }, 1);
		expect(contribHeaderText(c, s)).toBe(`You · ${s(`run.recap.title.${c.local.title}`)}`);
		expect(contribShareText(c, s)).toBe("25% of the team's damage");
		expect(contribStandingLine(c.local, s)).toBe("Last to fall · floor 7 · 3:20");
		expect(contribStandingLine(c.rows[0], s)).toBe("Fell on floor 7 · 1:40");
	});

	it("a Party row: name, title, damage share, kills, parries, hits", () => {
		const c = party(3, { damage: [100, 300, 100], kills: [1200, 2, 3], parries: [4, 0, 1], hits: [0, 5, 2] });
		const t = contribPartyTexts(c.rows[0], s);
		expect(t.name).toBe("Player0");
		expect(t.title).toBe(s(`run.recap.title.${c.rows[0].title}`));
		expect([t.damage, t.kills, t.parries, t.hits]).toEqual(["20%", "1,200", "4", "0"]);
		expect(CONTRIB_PARTY_COLUMNS.map((k) => s(k))).toEqual(["Damage", "Kills", "Parries", "Hits"]);
	});
});

describe("layout numbers (CONTRIB_UI)", () => {
	it("the box: the breakdown's 316 on a phone, four highlight cells (638) on desktop; everything fits it", () => {
		const breakdownW = HUD_VIEW.breakdownLabelWidth + HUD_VIEW.gap + HUD_VIEW.breakdownValueWidth;
		expect(contribBoxWidth("compact")).toBe(breakdownW);
		expect(contribBoxWidth("narrow")).toBe(breakdownW);
		expect(contribBoxWidth("wide")).toBe(4 * RECAP_UI.cellWidth + 3 * HUD_VIEW.gap);
		// The wide panel (HUD_VIEW.panelWidth x 2, its padding both sides) holds it.
		expect(contribBoxWidth("wide") <= HUD_VIEW.panelWidth * 2 - HUD_VIEW.pad * 4).toBe(true);
		for (const layout of LAYOUTS) {
			const box = contribBoxWidth(layout);
			const C = CONTRIB_UI.card[layout];
			expect([layout, contribTabsSize(layout, HUD_VIEW.gap).w <= breakdownW]).toEqual([layout, true]);
			expect([layout, recapGridSize(4, HUD_VIEW.gap).w <= box]).toEqual([layout, true]);
			expect([layout, C.columns * C.cell.width + (C.columns - 1) * HUD_VIEW.gap]).toEqual([layout, box]);
			const P = CONTRIB_UI.party[layout];
			const cols = P.nameWidth + P.titleWidth + CONTRIB_PARTY_COLUMNS.size() * P.numberWidth + 5 * P.columnGap;
			expect([layout, cols <= box]).toEqual([layout, true]);
			// The header keeps room beside a bar in its row; the share label beside a bar in its own.
			expect([layout, C.barWidth + HUD_VIEW.gap < box / 2]).toEqual([layout, true]);
		}
		// The wide card's cells are the highlight grid's own.
		expect(CONTRIB_UI.card.wide.cell).toBe(RECAP_CELL);
		expect(RECAP_CELL.height).toBe(RECAP_UI.cellHeight);
		expect(CONTRIB_UI.card.compact.shareInHeader).toBe(true);
	});

	it("cells: `columns` a row; a lone last one (pickups, seven in two columns) a full-width row", () => {
		expect(contribCellRows(7, "compact")).toEqual({ gridCells: 6, wideLast: true, rows: 4, columns: 2 });
		expect(contribCellRows(6, "narrow")).toEqual({ gridCells: 6, wideLast: false, rows: 3, columns: 2 });
		expect(contribCellRows(1, "narrow")).toEqual({ gridCells: 0, wideLast: true, rows: 1, columns: 2 });
		expect(contribCellRows(0, "compact")).toEqual({ gridCells: 0, wideLast: false, rows: 0, columns: 2 });
		// Desktop: seven in two rows of four (the Team grid's two rows).
		expect(contribCellRows(7, "wide")).toEqual({ gridCells: 7, wideLast: false, rows: 2, columns: 4 });
		expect(contribCellRows(5, "wide")).toEqual({ gridCells: 4, wideLast: true, rows: 2, columns: 4 });
	});

	it("the card: header, share row, cell rows, standing line, the layout's gap between", () => {
		const W = CONTRIB_UI.card.wide;
		expect(contribCardHeight(7, true, "wide")).toBe(
			W.headerHeight + W.shareHeight + (2 * W.cell.height + W.gap) + W.standingHeight + 3 * W.gap,
		);
		const N = CONTRIB_UI.card.narrow;
		expect(contribCardHeight(7, true, "narrow")).toBe(
			N.headerHeight + N.shareHeight + (4 * N.cell.height + 3 * N.gap) + N.standingHeight + 3 * N.gap,
		);
		expect(contribCardHeight(0, false, "narrow")).toBe(N.headerHeight + N.standingHeight + N.gap);
		// A landscape phone: the bar sits in the header row (no share row).
		const P = CONTRIB_UI.card.compact;
		expect(contribCardHeight(7, true, "compact")).toBe(
			P.headerHeight + (4 * P.cell.height + 3 * P.gap) + P.standingHeight + 2 * P.gap,
		);
		expect(contribCardHeight(2, false, "compact")).toBe(
			P.headerHeight + P.cell.height + P.standingHeight + 2 * P.gap,
		);
	});

	it("the box is the taller of the You card and the Team grid; the body adds the strip and a gap", () => {
		const c = party(4);
		expect(c.youCells.size()).toBe(7);
		for (const layout of LAYOUTS) {
			const you = contribCardHeight(7, true, layout);
			const team = recapGridSize(4, HUD_VIEW.gap).h;
			expect([layout, contribBoxHeight(c, 4, layout)]).toEqual([layout, math.max(you, team)]);
			expect(contribTabBodyHeight(c, 4, layout, 2)).toBe(CONTRIB_UI.tabs[layout].h + 2 + math.max(you, team));
		}
		// Two cells only: the Team grid's two rows set it.
		const small = party(2, {
			damage: [0, 0],
			bossDamage: [0, 0],
			grazes: [0, 0],
			hits: [0, 0],
			pellets: [0, 0],
			boosts: [0, 0],
			parries: [0, 0],
		});
		expect(small.youCells.size()).toBe(1);
		expect(contribBoxHeight(small, 4, "wide")).toBe(recapGridSize(4, HUD_VIEW.gap).h);
	});

	it("the Party list: 2-4 players fit the box everywhere; 8 scroll on a phone (and on desktop)", () => {
		expect(contribPartyScrolls(party(8), 4, "wide")).toBe(true);
		for (const layout of LAYOUTS) {
			for (const n of [2, 3, 4]) {
				expect([layout, n, contribPartyScrolls(party(n), 4, layout)]).toEqual([layout, n, false]);
			}
		}
		expect(contribPartyScrolls(party(8), 4, "compact")).toBe(true);
		expect(contribPartyScrolls(party(8), 4, "narrow")).toBe(true);
		const P = CONTRIB_UI.party.wide;
		expect(contribPartyHeight(8, "wide")).toBe(P.headerHeight + 8 * (P.rowHeight + P.gap));
	});
});

describe("standing ticks", () => {
	it("alive at run over reads Stood to the end", () => {
		const c = party(2, { deathTick: [RECAP_ALIVE_TICK, 30 * SIM_HZ] });
		expect(contribStandingLine(c.rows[0], s)).toBe("Stood to the end · 10:00");
	});
});
