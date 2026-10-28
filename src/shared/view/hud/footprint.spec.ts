// The in-run HUD's footprint budget (docs/HUD_LAYOUT.md H2): the always-on corner panels stay out of the playfield.
import { describe, expect, it } from "@rbxts/jest-globals";
import { DEFAULT_HUD_SCALE_PERCENT, HUD_SCALE_PERCENTS } from "shared/settings";
import { BOOST_VIEW } from "shared/view/boosts";
import { MINIMAP_VIEW } from "shared/view/minimap";
import {
	ALWAYS_ON_PANELS,
	TOUCH_ALWAYS_ON_PANELS,
	TOUCH_TEST_VIEWPORTS,
	TOUCH_TUTORIAL_BOX,
	touchFootprintRects,
	touchTutorialRect,
	HUD_FOOTPRINT,
	HUD_FOOTPRINT_LIMITS,
	HUD_TEST_VIEWPORTS,
	HUD_TRANSIENT,
	HUD_VIEW,
	MINIMAP_PANEL,
	TUTORIAL_VIEW,
	VERDICT_BOX,
	clearZoneRect,
	cornerRect,
	footprintRects,
	footprintReport,
	rectsOverlap,
	HUD_TEST_TOP_INSET,
	scoreEstimate,
	statusEstimate,
	transientRects,
	weaponsEstimate,
} from "shared/view/hud";

const TEN_FOOT = [false, true];
/** No inset, and the Roblox top bar above the safe area. */
const INSETS = [0, HUD_TEST_TOP_INSET];
const PERCENT = 100;

function label(x: number, y: number, tenFoot: boolean, percent: number, inset = 0): string {
	return string.format("%dx%d %s %d%%%s", x, y, tenFoot ? "TV" : "  ", percent, inset > 0 ? " bar" : "");
}

describe("HUD footprint budget", () => {
	it("cornerRect places boxes margin-in from each corner; touching rects do not overlap", () => {
		const r = cornerRect("bottomRight", 100, 50, 1280, 720, 1);
		expect(r.x).toBe(1280 - 16 - 100);
		expect(r.y).toBe(720 - 16 - 50);
		expect(rectsOverlap({ x: 0, y: 0, w: 10, h: 10 }, { x: 10, y: 0, w: 10, h: 10 })).toBe(false);
		expect(rectsOverlap({ x: 0, y: 0, w: 10, h: 10 }, { x: 9, y: 9, w: 10, h: 10 })).toBe(true);
	});

	it("no always-on box enters the clear zone at HUD scale <= 100 % (every viewport, ten-foot on and off)", () => {
		const bad: string[] = [];
		const over: string[] = [];
		for (const v of HUD_TEST_VIEWPORTS) {
			for (const inset of INSETS) {
				for (const tenFoot of TEN_FOOT) {
					for (const percent of HUD_SCALE_PERCENTS) {
						const report = footprintReport(v.x, v.y, tenFoot, percent, inset);
						for (const p of report.panels) {
							if (!p.intrudes) continue;
							const what = `${label(v.x, v.y, tenFoot, percent, inset)} ${p.panel}`;
							if (percent <= PERCENT) bad.push(what);
							else over.push(what);
						}
					}
				}
			}
		}
		// Informational: a HUD scale above 100 % may reach into the clear zone (the player asked for a bigger HUD).
		print(`[footprint] intrusions above 100 %: ${over.size() === 0 ? "none" : over.join(", ")}`);
		expect(bad.join(", ")).toBe("");
	});

	it("the always-on boxes cover at most maxCoverShare of the screen at 100 % (table printed)", () => {
		const rows: string[] = [];
		const bad: string[] = [];
		for (const v of HUD_TEST_VIEWPORTS) {
			for (const inset of INSETS) {
				for (const tenFoot of TEN_FOOT) {
					const r = footprintReport(v.x, v.y, tenFoot, DEFAULT_HUD_SCALE_PERCENT, inset);
					const cells: string[] = [];
					for (const p of r.panels) cells.push(string.format("%s %.1f%%", p.panel, p.coverShare * PERCENT));
					rows.push(
						string.format(
							"%s  total %.1f%%  (%s)",
							label(v.x, v.y, tenFoot, DEFAULT_HUD_SCALE_PERCENT, inset),
							r.totalShare * PERCENT,
							cells.join(", "),
						),
					);
					if (!tenFoot && r.totalShare > HUD_FOOTPRINT_LIMITS.maxCoverShare)
						bad.push(label(v.x, v.y, tenFoot, DEFAULT_HUD_SCALE_PERCENT, inset));
				}
			}
		}
		print(`[footprint] cover share at 100 %:\n  ${rows.join("\n  ")}`);
		expect(bad.join(", ")).toBe("");
	});

	it("never covers the centre column or the centre row, at any HUD scale", () => {
		const bad: string[] = [];
		for (const v of HUD_TEST_VIEWPORTS) {
			for (const inset of INSETS) {
				const cx = v.x / 2;
				const cy = inset + (v.y - inset) / 2;
				for (const tenFoot of TEN_FOOT) {
					for (const percent of HUD_SCALE_PERCENTS) {
						for (const p of footprintRects(v.x, v.y, tenFoot, percent, inset)) {
							const r = p.rect;
							const column = r.x < cx && cx < r.x + r.w;
							const row = r.y < cy && cy < r.y + r.h;
							if (column || row) bad.push(`${label(v.x, v.y, tenFoot, percent, inset)} ${p.panel}`);
						}
					}
				}
			}
		}
		expect(bad.join(", ")).toBe("");
	});

	it("transient panels never land on an always-on panel at 100 % (ten-foot overlaps printed)", () => {
		const bad: string[] = [];
		const info: string[] = [];
		for (const v of HUD_TEST_VIEWPORTS) {
			for (const tenFoot of TEN_FOOT) {
				const fixed = footprintRects(v.x, v.y, tenFoot, DEFAULT_HUD_SCALE_PERCENT);
				for (const t of transientRects(v.x, v.y, tenFoot, DEFAULT_HUD_SCALE_PERCENT)) {
					for (const f of fixed) {
						if (!rectsOverlap(t.rect, f.rect)) continue;
						const what = `${label(v.x, v.y, tenFoot, DEFAULT_HUD_SCALE_PERCENT)} ${t.panel}/${f.panel}`;
						if (tenFoot) info.push(what);
						else bad.push(what);
					}
				}
			}
		}
		print(`[footprint] ten-foot transient overlaps at 100 %: ${info.size() === 0 ? "none" : info.join(", ")}`);
		expect(bad.join(", ")).toBe("");
	});

	it("the reference layout (1280x720, 100 %) keeps every transient panel clear of the corners", () => {
		const fixed = footprintRects(1280, 720, false, DEFAULT_HUD_SCALE_PERCENT);
		for (const t of transientRects(1280, 720, false, DEFAULT_HUD_SCALE_PERCENT)) {
			for (const f of fixed)
				expect(`${t.panel}/${f.panel} ${rectsOverlap(t.rect, f.rect)}`).toBe(`${t.panel}/${f.panel} false`);
		}
		const zone = clearZoneRect(1280, 720);
		expect(zone.x).toBe(320);
		expect(zone.w).toBe(640);
	});

	it("the WeaponPanel's size from HUD_VIEW fits its budget", () => {
		const e = weaponsEstimate();
		print(
			string.format(
				"[footprint] weapons estimate %dx%d (budget %dx%d)",
				e.w,
				e.h,
				HUD_FOOTPRINT.weapons.maxW,
				HUD_FOOTPRINT.weapons.maxH,
			),
		);
		expect(e.w).toBeLessThanOrEqual(HUD_FOOTPRINT.weapons.maxW);
		expect(e.h).toBeLessThanOrEqual(HUD_FOOTPRINT.weapons.maxH);
	});

	it("the ScorePanel's size from HUD_VIEW (with the endless floor line) fits its budget", () => {
		const e = scoreEstimate();
		print(
			string.format(
				"[footprint] score estimate %dx%d (budget %dx%d)",
				e.w,
				e.h,
				HUD_FOOTPRINT.score.maxW,
				HUD_FOOTPRINT.score.maxH,
			),
		);
		expect(e.w).toBeLessThanOrEqual(HUD_FOOTPRINT.score.maxW);
		expect(e.h).toBeLessThanOrEqual(HUD_FOOTPRINT.score.maxH);
	});

	it("the StatusPanel's size from HUD_VIEW (3 rows, one boost row, one item row) fits its budget", () => {
		const e = statusEstimate(BOOST_VIEW.iconSize);
		print(
			string.format(
				"[footprint] status estimate %dx%d (budget %dx%d)",
				e.w,
				e.h,
				HUD_FOOTPRINT.status.maxW,
				HUD_FOOTPRINT.status.maxH,
			),
		);
		expect(e.w).toBeLessThanOrEqual(HUD_FOOTPRINT.status.maxW);
		expect(e.h).toBeLessThanOrEqual(HUD_FOOTPRINT.status.maxH);
	});

	it("lists every always-on panel once", () => {
		expect(ALWAYS_ON_PANELS.size()).toBe(4); // + minimap (docs/MINIMAP.md M7)
		expect(new Set(ALWAYS_ON_PANELS).size()).toBe(ALWAYS_ON_PANELS.size());
	});

	it("the corner minimap (docs/MINIMAP.md M7) is bottom right, MINIMAP_PANEL sized, the verdict line above it", () => {
		expect(HUD_FOOTPRINT.minimap).toEqual({ corner: "bottomRight", maxW: MINIMAP_PANEL.w, maxH: MINIMAP_PANEL.h });
		expect(MINIMAP_PANEL).toEqual({ w: 140, h: 140 });
		expect(VERDICT_BOX.edge).toBe(HUD_VIEW.margin + MINIMAP_PANEL.h + HUD_VIEW.gap);
		expect(HUD_TRANSIENT.verdict.edge).toBe(VERDICT_BOX.edge);
		// The verdict box's bottom edge clears the minimap's top by one HUD gap on every viewport, ten-foot on and off.
		for (const v of HUD_TEST_VIEWPORTS) {
			for (const tenFoot of TEN_FOOT) {
				const map = footprintRects(v.x, v.y, tenFoot, DEFAULT_HUD_SCALE_PERCENT).find(
					(p) => p.panel === "minimap",
				)!;
				const verdict = transientRects(v.x, v.y, tenFoot, DEFAULT_HUD_SCALE_PERCENT).find(
					(p) => p.panel === "verdict",
				)!;
				const gap = map.rect.y - (verdict.rect.y + verdict.rect.h);
				expect([label(v.x, v.y, tenFoot, PERCENT), gap > 0]).toEqual([label(v.x, v.y, tenFoot, PERCENT), true]);
			}
		}
	});

	// Ten-foot is informational like the cover table's: its 1.25 boost already put the three older boxes over the cap
	// (16.5 % at 1280 x 720 TV under the bar before the minimap), so the cap holds the 100 % desktop / phone cases.
	it("the 140 x 140 minimap (MD7) fits the raised cover cap on every viewport, with and without the top bar", () => {
		expect(MINIMAP_PANEL).toEqual({ w: MINIMAP_VIEW.panel.width, h: MINIMAP_VIEW.panel.height });
		expect(HUD_FOOTPRINT_LIMITS.maxCoverShare).toBe(0.145);
		let worst = 0;
		let worstAt = "";
		let worstTv = 0;
		let worstTvAt = "";
		for (const v of HUD_TEST_VIEWPORTS) {
			for (const inset of INSETS) {
				for (const tenFoot of TEN_FOOT) {
					const share = footprintReport(v.x, v.y, tenFoot, DEFAULT_HUD_SCALE_PERCENT, inset).totalShare;
					const at = label(v.x, v.y, tenFoot, DEFAULT_HUD_SCALE_PERCENT, inset);
					if (tenFoot && share > worstTv) {
						worstTv = share;
						worstTvAt = at;
					} else if (!tenFoot && share > worst) {
						worst = share;
						worstAt = at;
					}
				}
			}
		}
		print(
			string.format(
				"[footprint] 140x140 minimap: worst cover %.2f%% (%s); ten-foot worst %.2f%% (%s); cap %.1f%%",
				worst * PERCENT,
				worstAt,
				worstTv * PERCENT,
				worstTvAt,
				HUD_FOOTPRINT_LIMITS.maxCoverShare * PERCENT,
			),
		);
		expect(worst).toBeLessThanOrEqual(HUD_FOOTPRINT_LIMITS.maxCoverShare);
	});
});

describe("touch footprint (docs/MOBILE.md MB10)", () => {
	/** Percents the touch HUD is checked at (above 100 % the boxes may reach the clear zone, as on the desktop layout). */
	const TOUCH_PERCENTS = HUD_SCALE_PERCENTS.filter((p) => p <= PERCENT);

	it("keeps only the status and score panels on touch (no weapons panel, no corner minimap)", () => {
		expect(TOUCH_ALWAYS_ON_PANELS).toEqual(["status", "score"]);
	});

	it("the touch boxes never cover the centre column or the centre row of the safe area", () => {
		const bad: string[] = [];
		for (const v of TOUCH_TEST_VIEWPORTS) {
			for (const inset of INSETS) {
				const cx = v.x / 2;
				const cy = inset + (v.y - inset) / 2;
				for (const percent of TOUCH_PERCENTS) {
					for (const p of touchFootprintRects(v.x, v.y, percent, inset)) {
						const r = p.rect;
						const column = r.x < cx && cx < r.x + r.w;
						const row = r.y < cy && cy < r.y + r.h;
						if (column || row) bad.push(`${label(v.x, v.y, false, percent, inset)} ${p.panel}`);
					}
				}
			}
		}
		expect(bad.join(", ")).toBe("");
	});

	it("the touch tutorial prompt (top centre, under the boss bar) does not intersect the status or score box", () => {
		const bad: string[] = [];
		for (const v of TOUCH_TEST_VIEWPORTS) {
			for (const inset of INSETS) {
				for (const percent of TOUCH_PERCENTS) {
					const tutorial = touchTutorialRect(v.x, v.y, percent, inset);
					for (const p of touchFootprintRects(v.x, v.y, percent, inset)) {
						if (rectsOverlap(tutorial, p.rect))
							bad.push(`${label(v.x, v.y, false, percent, inset)} tutorial/${p.panel}`);
					}
				}
			}
		}
		expect(bad.join(", ")).toBe("");
	});

	it("the touch tutorial box keeps its touch width and sits under the boss bar", () => {
		expect(TOUCH_TUTORIAL_BOX.anchor).toBe("topCentre");
		expect(TOUCH_TUTORIAL_BOX.width).toBe(TUTORIAL_VIEW.touchPanelWidth);
		expect(TOUCH_TUTORIAL_BOX.edge).toBeGreaterThanOrEqual(
			HUD_TRANSIENT.bossBar.edge + HUD_TRANSIENT.bossBar.height,
		);
	});

	it("prints (does not fail) any touch box that enters HUD_CLEAR_ZONE", () => {
		const info: string[] = [];
		for (const v of TOUCH_TEST_VIEWPORTS) {
			for (const inset of INSETS) {
				const zone = clearZoneRect(v.x, v.y, inset);
				for (const percent of TOUCH_PERCENTS) {
					for (const p of touchFootprintRects(v.x, v.y, percent, inset)) {
						if (rectsOverlap(p.rect, zone))
							info.push(`${label(v.x, v.y, false, percent, inset)} ${p.panel}`);
					}
				}
			}
		}
		print(`[footprint] touch boxes in HUD_CLEAR_ZONE (<= 100 %): ${info.size() === 0 ? "none" : info.join(", ")}`);
	});
});
