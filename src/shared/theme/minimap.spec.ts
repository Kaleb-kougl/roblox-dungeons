// Roblox port (docs/MINIMAP.md M6): the minimap colour roles, their validator rules (markers: WCAG contrast on
// minimap.floor and uiPanel; the enemy dot: CIE76 distance from the arrow, the boost glint and every class colour) and
// the bundled packs' values.
import { describe, expect, it } from "@rbxts/jest-globals";
import { channelToByte, colorDifference, contrastRatio, mixChannel, mixRgb, parseHex, toHex } from "./color";
import {
	CLASS_IDS,
	MINIMAP_ENEMY_DIFFERENCE_ROLES,
	MINIMAP_MARKER_BACKGROUNDS,
	MINIMAP_MARKER_ROLES,
	MINIMAP_ROLES,
	MINIMAP_ROOM_TINT_MIX,
	MINIMAP_TINT_ROLES,
	MIN_MINIMAP_ENEMY_DIFFERENCE,
	MIN_MINIMAP_MARKER_CONTRAST,
} from "./contract";
import { THEME_PACKS } from "./packs";
import { PLACEHOLDER_MANIFEST } from "./packs/placeholder";
import { COLOR_ROLES, type ColorRole } from "./types";
import { deepClone, sortedKeys, startsWith, type Obj } from "./util";
import { minimapReport, validateManifest } from "./validate";

const clone = (): Obj => deepClone(PLACEHOLDER_MANIFEST) as unknown as Obj;
const colorsOf = (m: Obj) => m.colors as Obj;
const PLACEHOLDER_MINIMAP: ReadonlyArray<[ColorRole, string]> = [
	["minimap.floor", "#36342f"],
	["minimap.wall", "#7a7466"],
	["minimap.pool", "#2c4a63"],
	["minimap.frontier", "#8f8462"],
	["minimap.self", "#f4f1ea"],
	["minimap.enemy", "#ff5880"],
	["minimap.boss", "#ff9a5a"],
	["minimap.stairs", "#7fd6ff"],
	["minimap.boost", "#ffc83d"],
];
const fixed1 = (n: number) => "%.1f".format(n);
const fixed2 = (n: number) => "%.2f".format(n);

describe("minimap: colour roles", () => {
	it("are required colour roles with the plan's bars", () => {
		expect([...MINIMAP_ROLES]).toEqual([
			"minimap.floor",
			"minimap.wall",
			"minimap.pool",
			"minimap.frontier",
			"minimap.self",
			"minimap.enemy",
			"minimap.boss",
			"minimap.stairs",
			"minimap.boost",
		]);
		for (const r of MINIMAP_ROLES)
			expect([r, (COLOR_ROLES as ReadonlyArray<string>).includes(r)]).toEqual([r, true]);
		expect([...MINIMAP_MARKER_ROLES]).toEqual([
			"minimap.self",
			"minimap.enemy",
			"minimap.boss",
			"minimap.stairs",
			"minimap.boost",
		]);
		expect([...MINIMAP_MARKER_BACKGROUNDS]).toEqual(["minimap.floor", "uiPanel"]);
		const classes = CLASS_IDS.map((c) => `class.${c}`);
		expect([...MINIMAP_ENEMY_DIFFERENCE_ROLES]).toEqual(["minimap.self", "minimap.boost", ...classes]);
		expect(MIN_MINIMAP_MARKER_CONTRAST).toBe(3);
		expect([...MINIMAP_TINT_ROLES]).toEqual(["roomEdge.safe", "roomEdge.waiting", "roomEdge.live"]);
		expect(MINIMAP_ROOM_TINT_MIX).toBe(0.1);
		expect(MIN_MINIMAP_ENEMY_DIFFERENCE).toBe(40);
	});

	it("the placeholder fills them and every bundled pack carries the roles", () => {
		for (const [role, hex] of PLACEHOLDER_MINIMAP)
			expect([role, PLACEHOLDER_MANIFEST.colors[role]]).toEqual([role, hex]);
		for (const id of sortedKeys(THEME_PACKS)) {
			for (const [role, hex] of PLACEHOLDER_MINIMAP) {
				expect([id, role, THEME_PACKS[id].colors[role]]).toEqual([id, role, hex]);
			}
		}
	});
});

describe("minimap: validator", () => {
	it("the bundled packs validate clean, every background and difference in the report (numbers printed)", () => {
		for (const id of sortedKeys(THEME_PACKS)) {
			const manifest = THEME_PACKS[id];
			expect([id, validateManifest(manifest, { packId: id })]).toEqual([id, []]);
			const report = minimapReport(manifest);
			const backgrounds = report.filter((e) => e.check === "background");
			const diffs = report.filter((e) => e.check === "difference");
			expect([id, backgrounds.size()]).toEqual([
				id,
				MINIMAP_MARKER_ROLES.size() * (MINIMAP_MARKER_BACKGROUNDS.size() + MINIMAP_TINT_ROLES.size()),
			]);
			expect([id, diffs.size()]).toEqual([id, MINIMAP_ENEMY_DIFFERENCE_ROLES.size()]);
			for (const e of diffs) expect(e.role).toBe("minimap.enemy");
			for (const e of report) {
				expect([id, e.role, e.against, e.ok]).toEqual([id, e.role, e.against, true]);
				if (e.check === "background") {
					expect(e.value).toBe(contrastRatio(e.color, e.againstColor));
					expect(e.min).toBe(MIN_MINIMAP_MARKER_CONTRAST);
				} else {
					expect(e.value).toBe(colorDifference(e.color, e.againstColor));
					expect(e.min).toBe(MIN_MINIMAP_ENEMY_DIFFERENCE);
				}
			}
			for (const role of MINIMAP_MARKER_ROLES) {
				const cells: string[] = [];
				for (const e of report) {
					if (e.role !== role) continue;
					cells.push(
						e.check === "background"
							? `${e.against} ${fixed2(e.value)}:1`
							: `${e.against} CIE76 ${fixed1(e.value)}`,
					);
				}
				print(`[minimap] ${id} ${role}: ${cells.join(", ")}`);
			}
		}
	});

	it("the placeholder values as measured (docs/MINIMAP.md M6)", () => {
		const report = minimapReport(PLACEHOLDER_MANIFEST);
		const value = (role: string, against: string) => {
			for (const e of report) if (e.role === role && e.against === against) return e.value;
			return 0 / 0;
		};
		expect(fixed2(value("minimap.self", "minimap.floor"))).toBe("11.02");
		expect(fixed2(value("minimap.enemy", "minimap.floor"))).toBe("4.12");
		expect(fixed2(value("minimap.boss", "minimap.floor"))).toBe("5.93");
		expect(fixed2(value("minimap.stairs", "minimap.floor"))).toBe("7.68");
		expect(fixed2(value("minimap.boost", "minimap.floor"))).toBe("8.04");
		expect(fixed2(value("minimap.enemy", "uiPanel"))).toBe("5.61");
		// the tinted room floors (MINIMAP_ROOM_TINT_MIX 0.1): the enemy dot is the tightest, on a live room's floor
		expect(fixed2(value("minimap.enemy", "minimap.floor+roomEdge.safe"))).toBe("3.82");
		expect(fixed2(value("minimap.enemy", "minimap.floor+roomEdge.waiting"))).toBe("3.49");
		expect(fixed2(value("minimap.enemy", "minimap.floor+roomEdge.live"))).toBe("3.08");
		expect(fixed2(value("minimap.boss", "minimap.floor+roomEdge.live"))).toBe("4.43");
		// the nearest class colour is the pyromancer's orange
		let minDiff = math.huge;
		let closest = "";
		for (const e of report) {
			if (e.check !== "difference" || e.value >= minDiff) continue;
			minDiff = e.value;
			closest = e.against;
		}
		expect([closest, fixed1(minDiff)]).toEqual(["class.pyromancer", "42.5"]);
		// The tiles are not checked, but they read on the panel: walls outline the map, the floor recedes.
		const c = PLACEHOLDER_MANIFEST.colors;
		print(
			`[minimap] placeholder tiles on uiPanel: floor ${fixed2(
				contrastRatio(c["minimap.floor"], c.uiPanel),
			)}:1, ` +
				`wall ${fixed2(contrastRatio(c["minimap.wall"], c.uiPanel))}:1, ` +
				`pool ${fixed2(contrastRatio(c["minimap.pool"], c.uiPanel))}:1, ` +
				`frontier on floor ${fixed2(contrastRatio(c["minimap.frontier"], c["minimap.floor"]))}:1`,
		);
		expect(contrastRatio(c["minimap.wall"], c.uiPanel)).toBeGreaterThan(MIN_MINIMAP_MARKER_CONTRAST);
	});

	it("an enemy dot coloured like class.ranger fails (it would read as a teammate)", () => {
		const m = clone();
		const ranger = PLACEHOLDER_MANIFEST.colors["class.ranger"];
		colorsOf(m)["minimap.enemy"] = ranger;
		const errors = validateManifest(m);
		expect(errors.size()).toBeGreaterThan(0);
		for (const e of errors) expect([e, startsWith(e, 'colors["minimap.enemy"]: ')]).toEqual([e, true]);
		expect(errors).toContain(
			`colors["minimap.enemy"]: colour difference: minimap.enemy ${ranger} vs class.ranger ${ranger} is 0.0 ` +
				`(CIE76), needs >= 40.0: an enemy dot must never read as a teammate or a pickup`,
		);
		expect(minimapReport(m).some((e) => e.against === "class.ranger" && !e.ok)).toBe(true);
	});

	it("the markers are checked on every tinted room floor, the pixel the painter writes", () => {
		const c = PLACEHOLDER_MANIFEST.colors;
		const report = minimapReport(PLACEHOLDER_MANIFEST);
		for (const tint of MINIMAP_TINT_ROLES) {
			const mixed = toHex(mixRgb(parseHex(c["minimap.floor"])!, parseHex(c[tint])!, MINIMAP_ROOM_TINT_MIX));
			// shared/view/minimap paint.ts: mixChannel on 0..1 channels, then channelToByte.
			const r = channelToByte(mixChannel(parseHex(c["minimap.floor"])!.r / 255, parseHex(c[tint])!.r / 255, 0.1));
			expect(parseHex(mixed)!.r).toBe(r);
			for (const role of MINIMAP_MARKER_ROLES) {
				const e = report.find((x) => x.role === role && x.against === `minimap.floor+${tint}`);
				expect([role, tint, e?.againstColor]).toEqual([role, tint, mixed]);
			}
		}
		// The old crimson at the old mix: the review's 1.23:1 on a live room's floor.
		const old = mixRgb(parseHex(c["minimap.floor"])!, parseHex(c["roomEdge.live"])!, 0.35);
		expect(fixed2(contrastRatio("#ff2e2e", toHex(old)))).toBe("1.23");
		// The old crimson at today's mix still fails on the live floor (2.51:1).
		const m = clone();
		colorsOf(m)["minimap.enemy"] = "#ff2e2e";
		expect(validateManifest(m)).toContain(
			`colors["minimap.enemy"]: contrast: minimap.enemy #ff2e2e on minimap.floor+roomEdge.live ${toHex(
				mixRgb(parseHex(c["minimap.floor"])!, parseHex(c["roomEdge.live"])!, MINIMAP_ROOM_TINT_MIX),
			)} is 2.51:1, needs >= 3.0:1`,
		);
	});

	it("a marker too dark for the map fails on minimap.floor, uiPanel and the tinted floors", () => {
		const m = clone();
		colorsOf(m)["minimap.stairs"] = "#3a3a46"; // the default wall: invisible on the panel
		const errors = validateManifest(m);
		expect(errors.size()).toBe(MINIMAP_MARKER_BACKGROUNDS.size() + MINIMAP_TINT_ROLES.size());
		const floor = PLACEHOLDER_MANIFEST.colors["minimap.floor"];
		expect(errors).toContain(
			`colors["minimap.stairs"]: contrast: minimap.stairs #3a3a46 on minimap.floor ${floor} is ${fixed2(
				contrastRatio("#3a3a46", floor),
			)}:1, needs >= 3.0:1`,
		);
	});

	it("requires the roles like every other", () => {
		for (const role of MINIMAP_ROLES) {
			const m = clone();
			colorsOf(m)[role] = undefined;
			const errors = validateManifest(m);
			expect([role, errors.size()]).toEqual([role, 1]);
			expect([role, errors[0].find(role, 1, true)[0] !== undefined]).toEqual([role, true]);
			expect(minimapReport(m).some((e) => e.role === role)).toBe(false);
		}
	});
});
