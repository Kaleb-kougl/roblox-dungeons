// Stand-ins (docs/STAGE_ASSETS.md SA18): the readiness cursor, lookWhenReady, the solid decor stand-in boxes.
import { describe, expect, it } from "@rbxts/jest-globals";
import { buildEndlessFloor, generateDungeon, type Dungeon, type ForgeParams } from "shared/dungeon";
import type { ContentRef, RobloxAssetId } from "shared/theme";
import {
	ArtReadiness,
	ReadinessCursor,
	SOLID_DECOR_STAND_IN,
	decorInputOfLayout,
	lookWhenReady,
	planDecor,
	solidStandIns,
	solidStandInShown,
	type ReadinessSource,
} from "shared/view";

function source(rows: ReadonlyArray<[string, ReadonlyArray<string>]>): ReadinessSource {
	const map = new Map<string, ReadonlyArray<string>>();
	for (const [k, v] of rows) map.set(k, v);
	return {
		contentIds(id: string): ReadonlyArray<ContentRef> {
			// fake ids: the core never reads the scheme
			return (map.get(id) ?? []).map((c) => ({
				contentId: c as unknown as RobloxAssetId,
				media: "image" as const,
			}));
		},
	};
}

describe("ReadinessCursor", () => {
	it("lists each flip once, nothing while the epoch stands, and both directions under the force", () => {
		const r = new ArtReadiness(
			source([
				["breakable.barrel", ["a"]],
				["boost.fury", ["b"]],
			]),
		);
		r.track("breakable.barrel");
		r.track("boost.fury");
		r.markReady("b"); // before the cursor: not listed
		const c = new ReadinessCursor(r);
		expect(c.take()).toEqual([]);
		r.markReady("a");
		expect(c.take()).toEqual(["breakable.barrel"]);
		expect(c.take()).toEqual([]);
		expect(c.isReady("breakable.barrel")).toBe(true);
		r.setForced("all");
		const back = c.take();
		expect(back.size()).toBe(2);
		expect(c.isReady("breakable.barrel")).toBe(false);
		r.setForced(undefined);
		expect(c.take().size()).toBe(2);
		expect(c.isReady("boost.fury")).toBe(true);
	});
});

describe("lookWhenReady", () => {
	it("keeps the look while ready (or artless), drops only its art while not", () => {
		const look = { id: "pellet.normal", art: { kind: "image" }, placeholder: "Block" };
		expect(lookWhenReady(look, true)).toBe(look);
		const standIn = lookWhenReady(look, false);
		expect(standIn.art).toBe(undefined);
		expect([standIn.id, standIn.placeholder]).toEqual(["pellet.normal", "Block"]);
		expect(look.art).toEqual({ kind: "image" });
		const bare = { id: "x", art: undefined };
		expect(lookWhenReady(bare, false)).toBe(bare);
	});
});

describe("solidStandInShown", () => {
	it("shows the box with no piece drawn, or while the piece's id is not ready", () => {
		expect(solidStandInShown(undefined, () => true)).toBe(true);
		expect(solidStandInShown("decor.delve.b1.tomb", () => false)).toBe(true);
		expect(solidStandInShown("decor.delve.b1.tomb", () => true)).toBe(false);
	});
});

const dungeons = new Map<string, Dungeon>();
function dungeonFor(params: ForgeParams): Dungeon {
	const key = `${params.seed}/${params.roomCount}`;
	let d = dungeons.get(key);
	if (d === undefined) {
		d = generateDungeon(params);
		dungeons.set(key, d);
	}
	return d;
}

describe("solidStandIns (SAD15)", () => {
	it("gives every solid piece a box on its cells, matched to the plan entry drawing it (wide pairs share one)", () => {
		let pieces = 0;
		let wide = 0;
		for (let run = 1; run <= 6; run++)
			for (let floor = 1; floor <= 3; floor++) {
				const layout = buildEndlessFloor(run, floor, dungeonFor);
				const d = layout.dungeon;
				// every kind has art (16 variants): bookcases pair into wide cases where the plan picks them
				const plan = planDecor({ ...decorInputOfLayout(layout), variants: () => 16 });
				const boxes = solidStandIns(d.solidDecor ?? [], plan.entries);
				expect(boxes.size()).toBe((d.solidDecor ?? []).size());
				boxes.forEach((b, i) => {
					const p = d.solidDecor![i];
					expect([b.kind, b.x, b.y, b.w, b.h]).toEqual([p.kind, p.x, p.y, p.w, p.h]);
					expect(b.heightTiles).toBe(SOLID_DECOR_STAND_IN.heightTiles[p.kind]);
					expect(b.heightTiles > 0).toBe(true);
					expect(b.entry >= 0).toBe(true);
					const e = plan.entries[b.entry];
					expect(e.source).toBe("solid");
					if (e.kind === "bookcaseWide") {
						wide++;
						const second = e.cellX + e.runX === p.x && e.cellY + e.runZ === p.y;
						expect((e.cellX === p.x && e.cellY === p.y) || second).toBe(true);
					} else expect([e.cellX, e.cellY]).toEqual([p.x, p.y]);
					pieces++;
				});
			}
		expect(pieces).toBeGreaterThan(0);
		print(`[standIns] ${pieces} solid pieces, ${wide} in wide bookcase pairs`);
	});

	it("is empty without solid decor, and an unmatched piece gets entry -1", () => {
		expect(solidStandIns([], [])).toEqual([]);
		const b = solidStandIns([{ kind: "tomb", x: 3, y: 4, w: 2, h: 1, room: 0, fx: 0, fz: 0 }], []);
		expect(b[0].entry).toBe(-1);
		expect(b[0].heightTiles).toBe(SOLID_DECOR_STAND_IN.heightTiles.tomb);
	});
});
