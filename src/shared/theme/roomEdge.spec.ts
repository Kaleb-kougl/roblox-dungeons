// Roblox port (docs/ROOM_EDGES.md RE4): the room-edge colour roles (one per room state), their validator rules (waiting
// and live: WCAG contrast on every biome floor; all three: CIE76 distance from the enemy-bullet roles and telegraph)
// and the bundled packs' values.
import { describe, expect, it } from "@rbxts/jest-globals";
import { colorDifference, contrastRatio } from "./color";
import {
	BIOMES,
	ENEMY_BULLET_ROLES,
	MIN_ROOM_EDGE_CONTRAST,
	MIN_ROOM_EDGE_DIFFERENCE,
	ROOM_EDGE_CONTRAST_ROLES,
	ROOM_EDGE_DIFFERENCE_ROLES,
	ROOM_EDGE_ROLES,
} from "./contract";
import { THEME_PACKS } from "./packs";
import { PLACEHOLDER_MANIFEST } from "./packs/placeholder";
import { VALE_FLOOR_HEX } from "./packs/vale";
import { COLOR_ROLES, type ColorRole } from "./types";
import { deepClone, sortedKeys, startsWith, type Obj } from "./util";
import { roomEdgeReport, validateManifest } from "./validate";

const clone = (): Obj => deepClone(PLACEHOLDER_MANIFEST) as unknown as Obj;
const colorsOf = (m: Obj) => m.colors as Obj;
const PLACEHOLDER_EDGES: ReadonlyArray<[ColorRole, string]> = [
	["roomEdge.safe", "#6a655c"],
	["roomEdge.waiting", "#a39e94"],
	["roomEdge.live", "#f4f1ea"],
];
const fixed1 = (n: number) => "%.1f".format(n);
const fixed2 = (n: number) => "%.2f".format(n);

describe("roomEdge: colour roles", () => {
	it("are colour roles in RoomEdgeState order (SAFE 0, WAITING 1, LIVE 2) with the plan's bars", () => {
		expect([...ROOM_EDGE_ROLES]).toEqual(["roomEdge.safe", "roomEdge.waiting", "roomEdge.live"]);
		for (const r of ROOM_EDGE_ROLES)
			expect([r, (COLOR_ROLES as ReadonlyArray<string>).includes(r)]).toEqual([r, true]);
		expect([...ROOM_EDGE_CONTRAST_ROLES]).toEqual(["roomEdge.waiting", "roomEdge.live"]);
		expect([...ROOM_EDGE_DIFFERENCE_ROLES]).toEqual([...ENEMY_BULLET_ROLES, "telegraph"]);
		expect(MIN_ROOM_EDGE_CONTRAST).toBe(3);
		expect(MIN_ROOM_EDGE_DIFFERENCE).toBe(40);
	});

	it("the placeholder fills the value ramp and every bundled pack carries the roles", () => {
		for (const [role, hex] of PLACEHOLDER_EDGES)
			expect([role, PLACEHOLDER_MANIFEST.colors[role]]).toEqual([role, hex]);
		for (const id of sortedKeys(THEME_PACKS)) {
			for (const [role, hex] of PLACEHOLDER_EDGES) {
				expect([id, role, THEME_PACKS[id].colors[role]]).toEqual([id, role, hex]);
			}
		}
	});
});

describe("roomEdge: validator", () => {
	it("the bundled packs validate clean, every floor and difference role in the report (numbers printed)", () => {
		for (const id of sortedKeys(THEME_PACKS)) {
			const manifest = THEME_PACKS[id];
			expect([id, validateManifest(manifest, { packId: id })]).toEqual([id, []]);
			const report = roomEdgeReport(manifest);
			const floors = report.filter((e) => e.check === "floor");
			const diffs = report.filter((e) => e.check === "difference");
			expect([id, floors.size()]).toEqual([id, ROOM_EDGE_CONTRAST_ROLES.size() * BIOMES.size()]);
			expect([id, diffs.size()]).toEqual([id, ROOM_EDGE_ROLES.size() * ROOM_EDGE_DIFFERENCE_ROLES.size()]);
			for (const e of report) {
				expect([id, e.role, e.against, e.ok]).toEqual([id, e.role, e.against, true]);
				if (e.check === "floor") {
					expect(e.value).toBe(contrastRatio(e.color, e.againstColor));
					expect(e.min).toBe(MIN_ROOM_EDGE_CONTRAST);
				} else {
					expect(e.value).toBe(colorDifference(e.color, e.againstColor));
					expect(e.min).toBe(MIN_ROOM_EDGE_DIFFERENCE);
				}
			}
			// safe is exempt from the contrast rule: no floor entry
			expect([id, floors.some((e) => e.role === "roomEdge.safe")]).toEqual([id, false]);
			for (const role of ROOM_EDGE_ROLES) {
				let minContrast = math.huge;
				let minDiff = math.huge;
				let closest = "";
				for (const e of report) {
					if (e.role !== role) continue;
					if (e.check === "floor") minContrast = math.min(minContrast, e.value);
					else if (e.value < minDiff) {
						minDiff = e.value;
						closest = e.against;
					}
				}
				print(
					`[roomEdge] ${id} ${role}: min floor contrast ${
						minContrast === math.huge ? "exempt" : `${fixed2(minContrast)}:1`
					}, min CIE76 ${fixed1(minDiff)} (${closest})`,
				);
			}
		}
	});

	it("the placeholder values as measured (docs/ROOM_EDGES.md RE4 table)", () => {
		const report = roomEdgeReport(PLACEHOLDER_MANIFEST);
		const minOf = (role: string, check: string) => {
			let m = math.huge;
			for (const e of report) if (e.role === role && e.check === check) m = math.min(m, e.value);
			return m;
		};
		// as measured; docs/ROOM_EDGES.md's hand-checked table had 4.2 / 9.9 / 1.9:1 (the ratios are higher)
		expect(fixed2(minOf("roomEdge.waiting", "floor"))).toBe("5.49");
		expect(fixed2(minOf("roomEdge.live", "floor"))).toBe("12.98");
		let safeContrast = math.huge;
		for (const b of sortedKeys(PLACEHOLDER_MANIFEST.biomes)) {
			const floor = PLACEHOLDER_MANIFEST.biomes[b].floor;
			safeContrast = math.min(safeContrast, contrastRatio(PLACEHOLDER_MANIFEST.colors["roomEdge.safe"], floor));
		}
		print(`[roomEdge] placeholder roomEdge.safe: min floor contrast ${fixed2(safeContrast)}:1 (exempt)`);
		expect(safeContrast).toBeLessThan(MIN_ROOM_EDGE_CONTRAST);
		expect(fixed1(minOf("roomEdge.safe", "difference"))).toBe("41.1");
		expect(fixed1(minOf("roomEdge.waiting", "difference"))).toBe("62.8");
		expect(fixed1(minOf("roomEdge.live", "difference"))).toBe("72.3");
		// vale's floor texture colour (the floors once its texture is uploaded) is darker than every placeholder floor
		for (const role of ROOM_EDGE_CONTRAST_ROLES) {
			const hex = PLACEHOLDER_MANIFEST.colors[role];
			expect([role, contrastRatio(hex, VALE_FLOOR_HEX) >= MIN_ROOM_EDGE_CONTRAST]).toEqual([role, true]);
		}
	});

	it("safe is exempt from the contrast rule: its own low contrast is not an error", () => {
		const safe = PLACEHOLDER_MANIFEST.colors["roomEdge.safe"];
		const floor = PLACEHOLDER_MANIFEST.biomes["biome.1"].floor;
		expect(contrastRatio(safe, floor)).toBeLessThan(MIN_ROOM_EDGE_CONTRAST);
		expect(validateManifest(PLACEHOLDER_MANIFEST)).toEqual([]);
	});

	it("a red live line fails on telegraph", () => {
		const m = clone();
		colorsOf(m)["roomEdge.live"] = "#ff6a6a";
		const d = colorDifference("#ff6a6a", PLACEHOLDER_MANIFEST.colors.telegraph);
		expect(d).toBeLessThan(MIN_ROOM_EDGE_DIFFERENCE);
		const errors = validateManifest(m);
		expect(errors.size()).toBeGreaterThan(0);
		for (const e of errors) expect([e, startsWith(e, 'colors["roomEdge.live"]: ')]).toEqual([e, true]);
		expect(errors).toContain(
			`colors["roomEdge.live"]: colour difference: roomEdge.live #ff6a6a vs telegraph #ff8a3d is ${fixed1(
				d,
			)} (CIE76), needs >= 40.0: a room edge must never read as an enemy bullet or a telegraph`,
		);
	});

	it("a low-contrast waiting line fails the contrast rule, per biome floor", () => {
		const m = clone();
		colorsOf(m)["roomEdge.waiting"] = "#6a655c"; // the safe colour: far enough from the bullets, too dim to read
		const errors = validateManifest(m);
		expect(errors.size()).toBe(BIOMES.size());
		for (const e of errors) {
			expect([e, startsWith(e, 'colors["roomEdge.waiting"]: contrast: roomEdge.waiting #6a655c on ')]).toEqual([
				e,
				true,
			]);
		}
		const floor = PLACEHOLDER_MANIFEST.biomes["biome.1"].floor;
		expect(errors).toContain(
			`colors["roomEdge.waiting"]: contrast: roomEdge.waiting #6a655c on biome.1 (ancient) floor ${floor} is ${fixed2(
				contrastRatio("#6a655c", floor),
			)}:1, needs >= 3.0:1`,
		);
	});

	it("requires the roles like every other", () => {
		for (const role of ROOM_EDGE_ROLES) {
			const m = clone();
			colorsOf(m)[role] = undefined;
			const errors = validateManifest(m);
			expect([role, errors.size()]).toEqual([role, 1]);
			expect([role, errors[0].find(role, 1, true)[0] !== undefined]).toEqual([role, true]);
			expect(roomEdgeReport(m).some((e) => e.role === role)).toBe(false);
		}
	});
});
