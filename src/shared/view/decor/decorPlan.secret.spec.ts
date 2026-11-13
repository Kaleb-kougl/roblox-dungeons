// The decor plan's keep-out (docs/SECRET_ROOMS.md SR7): on a secret floor no standing or dressing piece stands on the
// chamber, its ring or the crack, no banner hangs there and no void set piece stands, lies or reaches into it; the
// Forge's torches keep their cells. decorInputOfLayout passes the ring on a secret floor and nothing elsewhere; without
// a keep-out the plan is exactly the one before (decorPlan.spec.ts and decorPlan.void.spec.ts run without one).
import { describe, expect, it } from "@rbxts/jest-globals";
import type { EndlessFloorLayout } from "shared/dungeon";
import { endlessRunFloor } from "shared/run";
import { inCellRect, secretRingRect, type CellRect } from "../secrets";
import { VOID_PIECES, planVoid, voidInputOfLayout } from "../voidDecor";
import { DECOR_DROP_REASONS, decorInputOfLayout, planDecor, type DecorEntry, type DecorPlan } from ".";

function secretLayouts(n: number): EndlessFloorLayout[] {
	const out: EndlessFloorLayout[] = [];
	for (let run = 1; out.size() < n && run < 200; run++)
		for (let floor = 2; floor <= 6 && out.size() < n; floor++) {
			const layout = endlessRunFloor(run, floor).layout;
			if (layout.secret !== undefined) out.push(layout);
		}
	return out;
}

const LAYOUTS = secretLayouts(8);
const ART = (): number => 2;

/** Every cell an entry takes or reaches (a void flat piece: its whole radius). */
function cellsOf(e: DecorEntry): Array<[number, number]> {
	const out: Array<[number, number]> = [];
	const n = math.max(1, e.cells);
	for (let i = 0; i < n; i++) out.push([e.cellX + i * e.runX, e.cellY + i * e.runZ]);
	if (e.source === "void" && e.layer === "flat") {
		const r = math.ceil(VOID_PIECES.flatRadiusTiles);
		for (let oy = -r; oy <= r; oy++)
			for (let ox = -r; ox <= r; ox++)
				if (ox * ox + oy * oy < VOID_PIECES.flatRadiusTiles * VOID_PIECES.flatRadiusTiles)
					out.push([e.cellX + ox, e.cellY + oy]);
	}
	return out;
}

/** Entries the keep-out forbids (every piece but torches and the room's own floor pieces). */
function inside(plan: DecorPlan, keep: CellRect): DecorEntry[] {
	const out: DecorEntry[] = [];
	for (const e of plan.entries) {
		if (e.kind === "torch") continue;
		for (const [x, y] of cellsOf(e))
			if (inCellRect(keep, x, y)) {
				out.push(e);
				break;
			}
	}
	return out;
}

describe("planDecor's keep-out (docs/SECRET_ROOMS.md SR7)", () => {
	it("found secret floors; decorInputOfLayout carries the ring there and nothing on a floor without a secret", () => {
		expect(LAYOUTS.size()).toBe(8);
		for (const l of LAYOUTS) expect(decorInputOfLayout(l).keepOut).toEqual(secretRingRect(l.secret!));
		let plain: EndlessFloorLayout | undefined;
		for (let run = 1; plain === undefined; run++) {
			const l = endlessRunFloor(run, 2).layout;
			if (l.secret === undefined) plain = l;
		}
		expect(decorInputOfLayout(plain).keepOut).toBe(undefined);
		expect(DECOR_DROP_REASONS.includes("secret")).toBe(true);
	});

	it("no standing, dressing, banner or void piece on the chamber, its ring or the crack", () => {
		let freeInside = 0;
		for (const layout of LAYOUTS) {
			const input = {
				...decorInputOfLayout(layout),
				variants: ART,
				voidVariants: ART,
				voidPlan: planVoid(voidInputOfLayout(layout)),
			};
			const keep = input.keepOut!;
			const plan = planDecor(input);
			expect(inside(plan, keep).map((e) => `${e.kind}@${e.cellX},${e.cellY}`)).toEqual([]);
			const free = planDecor({ ...input, keepOut: undefined });
			freeInside += inside(free, keep).size();
			// The Forge's floor pieces keep their cells (a standing piece pushed off the keep-out may take another
			// far-wall spot, and so drop or free a torch under it, as tall pieces do on any floor).
			const key = (e: DecorEntry) => `${e.source}/${e.kind}/${e.cellX},${e.cellY}`;
			const flats = (p: DecorPlan) =>
				p.entries.filter((e) => e.layer === "flat" && e.source === "forge").map(key);
			expect(flats(plan)).toEqual(flats(free));
		}
		// The rule does something on these floors (wall-top pieces and void rock pieces round the chamber).
		print(`[secrets] decor pieces the keep-out removed over ${LAYOUTS.size()} secret floors: ${freeInside}`);
		expect(freeInside).toBeGreaterThan(0);
	});
});
