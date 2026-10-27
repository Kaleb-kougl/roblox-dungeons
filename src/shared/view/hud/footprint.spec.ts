// The in-run HUD's footprint budget (docs/HUD_LAYOUT.md H2): the always-on corner panels stay out of the playfield.
import { describe, expect, it } from "@rbxts/jest-globals";
import { DEFAULT_HUD_SCALE_PERCENT, HUD_SCALE_PERCENTS } from "shared/settings";
import { BOOST_VIEW } from "shared/view/boosts";
import {
	ALWAYS_ON_PANELS,
	HUD_FOOTPRINT,
	HUD_FOOTPRINT_LIMITS,
	HUD_TEST_VIEWPORTS,
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
		expect(ALWAYS_ON_PANELS.size()).toBe(3);
	});
});
