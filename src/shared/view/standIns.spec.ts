// Stand-in swaps (docs/STAGE_ASSETS.md SA17): drawsArt, FlipTracker and ReadyIds over a real ArtReadiness.
import { describe, expect, it } from "@rbxts/jest-globals";
import type { ContentRef, RobloxAssetId } from "shared/theme";
import { ArtReadiness, FlipTracker, ReadyIds, drawsArt, type ReadinessSource } from "shared/view";

function source(rows: ReadonlyArray<[string, ReadonlyArray<string>]>): ReadinessSource {
	const map = new Map<string, ReadonlyArray<string>>();
	for (const [k, v] of rows) map.set(k, v);
	return {
		contentIds(id: string): ReadonlyArray<ContentRef> {
			const ids = map.get(id) ?? [];
			return ids.map((c) => ({ contentId: c as unknown as RobloxAssetId, media: "image" as const }));
		},
	};
}

const SRC = source([
	["class.vanguard", ["k1", "k2"]],
	["enemy.swarmer", ["s1"]],
	["bullet.enemy.small", ["b1"]],
	["bullet.enemy.needle", ["b1"]],
	["ui.none", []],
]);

function readiness(): ArtReadiness {
	const r = new ArtReadiness(SRC);
	for (const id of ["class.vanguard", "enemy.swarmer", "bullet.enemy.small", "bullet.enemy.needle", "ui.none"]) {
		r.track(id);
	}
	return r;
}

describe("drawsArt", () => {
	it("draws art only when the pack has it and it is ready", () => {
		expect(drawsArt(true, true)).toBe(true);
		expect(drawsArt(true, false)).toBe(false);
		expect(drawsArt(false, true)).toBe(false);
		expect(drawsArt(false, false)).toBe(false);
	});
});

describe("FlipTracker", () => {
	it("syncs on the first poll and reports nothing", () => {
		const r = readiness();
		r.markReady("s1");
		const t = new FlipTracker();
		expect(t.poll(r)).toBe(false);
		expect(t.has("enemy.swarmer")).toBe(false);
	});

	it("lists only the ids that flipped since the last poll, once", () => {
		const r = readiness();
		const t = new FlipTracker();
		t.poll(r);
		r.markReady("k1");
		// k1 alone does not finish the knight: the epoch moves, nothing flips
		expect(t.poll(r)).toBe(true);
		expect(t.count()).toBe(0);
		expect(t.has("class.vanguard")).toBe(false);
		r.markReady("k2");
		r.markReady("s1");
		expect(t.poll(r)).toBe(true);
		expect(t.has("class.vanguard")).toBe(true);
		expect(t.has("enemy.swarmer")).toBe(true);
		expect(t.has("bullet.enemy.small")).toBe(false);
		expect(t.count()).toBe(2);
		// a quiet frame: nothing moved, nothing flipped
		expect(t.poll(r)).toBe(false);
		expect(t.changed()).toBe(false);
		expect(t.has("class.vanguard")).toBe(false);
	});

	it("reports flips back to stand-ins under the debug force", () => {
		const r = readiness();
		r.markReady("s1");
		const t = new FlipTracker();
		t.poll(r);
		r.setForced(["enemy."]);
		expect(t.poll(r)).toBe(true);
		expect(t.has("enemy.swarmer")).toBe(true);
		expect(r.isReady("enemy.swarmer")).toBe(false);
		r.setForced(undefined);
		expect(t.poll(r)).toBe(true);
		expect(t.has("enemy.swarmer")).toBe(true);
		expect(r.isReady("enemy.swarmer")).toBe(true);
	});

	it("a new feed counts every id as flipped once", () => {
		const t = new FlipTracker();
		t.poll(readiness());
		expect(t.poll(readiness())).toBe(true);
		expect(t.has("anything")).toBe(true);
		expect(t.poll(readiness())).toBe(true);
	});
});

describe("ReadyIds", () => {
	it("reads every id once per epoch and reports changes", () => {
		const r = readiness();
		const ids = new ReadyIds(["bullet.enemy.small", undefined, "bullet.enemy.needle", "ui.none"]);
		expect(ids.isReady(0)).toBe(false);
		expect(ids.refresh(r)).toBe(true); // ui.none has no content: ready at once
		expect(ids.isReady(0)).toBe(false);
		expect(ids.isReady(1)).toBe(false);
		expect(ids.isReady(3)).toBe(true);
		expect(ids.refresh(r)).toBe(false);
		r.markReady("b1"); // one sheet shared by two looks
		expect(ids.refresh(r)).toBe(true);
		expect(ids.isReady(0)).toBe(true);
		expect(ids.isReady(2)).toBe(true);
		expect(ids.isReady(1)).toBe(false); // no art: never ready
		expect(ids.isReady(9)).toBe(false);
		r.setForced("all");
		expect(ids.refresh(r)).toBe(true);
		expect(ids.isReady(0)).toBe(false);
		expect(ids.isReady(3)).toBe(false);
		expect(ids.size()).toBe(4);
	});
});
