// The void's hold-out (docs/SECRET_ROOMS.md SR7): a secret room's chamber and ring keep columns of their own, never
// merged across the rectangle's edge, listed in VoidPlan.held, so the VoidController can sink them at the open. Every
// layer and top is the one without it; without a hold-out the plan is exactly the one before (plan.spec.ts's census
// runs without one). voidInputOfLayout carries a secret floor's ring and nothing on a floor without a secret.
import { describe, expect, it } from "@rbxts/jest-globals";
import { endlessRunFloor } from "shared/run";
import type { EndlessFloorLayout } from "shared/dungeon";
import { inCellRect, secretRingRect, type CellRect } from "../secrets";
import { planVoid, planVoidCached, voidInputOfLayout, type VoidPlan, type VoidRect } from ".";

function serialize(p: VoidPlan): string {
	const parts: string[] = [`${p.W}x${p.H}|${p.floorSeed}|${p.band}`];
	for (let c = 0; c < p.W * p.H; c++) parts.push(`${p.layer[c]}:${p.top[c]}`);
	for (const r of p.rects) parts.push(`${r.x},${r.y},${r.w},${r.h},${r.layer},${r.top}`);
	return parts.join(";");
}

/** Every cell of `r` inside `h` (1), none (0), or some (-1). */
function side(r: VoidRect, h: CellRect): number {
	let inside = 0;
	for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) if (inCellRect(h, x, y)) inside++;
	return inside === r.w * r.h ? 1 : inside === 0 ? 0 : -1;
}

/** Secret floors of runs 1.. on floors 2..6 (the first `n`). */
function secretLayouts(n: number): EndlessFloorLayout[] {
	const out: EndlessFloorLayout[] = [];
	for (let run = 1; out.size() < n && run < 200; run++)
		for (let floor = 2; floor <= 6 && out.size() < n; floor++) {
			const layout = endlessRunFloor(run, floor).layout;
			if (layout.secret !== undefined) out.push(layout);
		}
	return out;
}

const LAYOUTS = secretLayouts(6);

describe("planVoid's hold-out (docs/SECRET_ROOMS.md SR7)", () => {
	it("found secret floors to test", () => {
		expect(LAYOUTS.size()).toBe(6);
	});

	it("voidInputOfLayout: a secret floor's ring as the hold-out, none elsewhere (the input before, exactly)", () => {
		for (const layout of LAYOUTS) {
			const input = voidInputOfLayout(layout, 1);
			expect(input.holdOut).toEqual(secretRingRect(layout.secret!));
		}
		let plain: EndlessFloorLayout | undefined;
		for (let run = 1; plain === undefined; run++) {
			const l = endlessRunFloor(run, 2).layout;
			if (l.secret === undefined) plain = l;
		}
		const input = voidInputOfLayout(plain, 2);
		expect(input.holdOut).toBe(undefined);
		const before = planVoid({ dungeon: plain.dungeon, floorSeed: plain.seed, floor: plain.floor, depth: 2 });
		const now = planVoid(input);
		expect(serialize(now)).toBe(serialize(before));
		expect(now.held).toBe(undefined);
	});

	it("the same layers and tops; no rect crosses the hold-out's edge; `held` lists exactly the rects inside", () => {
		let held = 0;
		for (const layout of LAYOUTS) {
			const input = voidInputOfLayout(layout, 1);
			const h = input.holdOut!;
			const free = planVoid({ ...input, holdOut: undefined });
			const plan = planVoid(input);
			const cells = plan.W * plan.H;
			let same = true;
			for (let c = 0; c < cells; c++)
				if (plan.layer[c] !== free.layer[c] || plan.top[c] !== free.top[c]) same = false;
			expect(same).toBe(true);
			const inside: number[] = [];
			let crossing = 0;
			let covered = 0;
			plan.rects.forEach((r, i) => {
				const s = side(r, h);
				if (s < 0) crossing++;
				if (s === 1) inside.push(i);
				covered += r.w * r.h;
			});
			expect(crossing).toBe(0);
			expect([...plan.held!]).toEqual(inside);
			held += inside.size();
			// The same raised cells, each in exactly one rect.
			let freeCovered = 0;
			for (const r of free.rects) freeCovered += r.w * r.h;
			expect(covered).toBe(freeCovered);
			// The free plan may merge across the edge; the held one at least as many rects.
			expect(plan.rects.size() >= free.rects.size()).toBe(true);
		}
		// The chamber lies in the void behind its wall: shoulder rock covers it on these floors.
		expect(held).toBeGreaterThan(0);
	});

	it("planVoidCached tells hold-outs apart (and the same one hits)", () => {
		const input = voidInputOfLayout(LAYOUTS[0], 1);
		const a = planVoidCached(input);
		expect(planVoidCached({ ...input, holdOut: { ...input.holdOut! } })).toBe(a);
		const b = planVoidCached({ ...input, holdOut: undefined });
		expect(b).never.toBe(a);
		expect(b.held).toBe(undefined);
		expect(planVoidCached(input)).never.toBe(b);
	});
});
