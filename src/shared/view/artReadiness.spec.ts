// Art readiness (docs/STAGE_ASSETS.md SA15): content statuses, logical-id readiness, the one retry, epoch and flips,
// the KV_StandInsForce force.
import { describe, expect, it } from "@rbxts/jest-globals";
import { PLACEHOLDER_MANIFEST, ThemePack, type ContentRef, type RobloxAssetId } from "shared/theme";
import { VALE_MANIFEST } from "shared/theme/packs/vale";
import { ART_READINESS, ArtReadiness, parseStandInsForce, type ReadinessSource } from "shared/view";

const quiet = () => {};

/** A fake pack: logical id -> content ids. */
function source(rows: ReadonlyArray<[string, ReadonlyArray<string>]>): ReadinessSource {
	const map = new Map<string, ReadonlyArray<string>>();
	for (const [k, v] of rows) map.set(k, v);
	return {
		contentIds(id: string): ReadonlyArray<ContentRef> {
			const ids = map.get(id) ?? [];
			// fake ids: the core never reads the scheme (real uploads live in shared/theme only)
			return ids.map((id) => ({ contentId: id as unknown as RobloxAssetId, media: "image" as const }));
		},
	};
}

// a sprite set and its optional sheet as their own logical ids (ThemePack lists a set's sheets under one id; a renderer
// that wants an optional sheet on its own asks for that sheet's id)
const SRC = source([
	["enemy.imp", ["c1", "c2"]],
	["enemy.imp.attack", ["c3"]],
	["enemy.swarmer", ["c2", "c4"]],
	["bullet.enemy", ["c5"]],
	["ui.none", []],
]);

describe("ArtReadiness: logical ids", () => {
	it("a set is ready only when every one of its content ids is ready", () => {
		const r = new ArtReadiness(SRC);
		expect(r.isReady("enemy.imp")).toBe(false);
		r.markReady("c1");
		expect(r.isReady("enemy.imp")).toBe(false);
		expect(r.unresolved("enemy.imp")).toEqual(["c2"]);
		r.markReady("c2");
		expect(r.isReady("enemy.imp")).toBe(true);
		// a shared sheet counts for both sets
		expect(r.isReady("enemy.swarmer")).toBe(false);
		r.markReady("c4");
		expect(r.isReady("enemy.swarmer")).toBe(true);
		expect(r.contentCount("enemy.imp")).toBe(2);
	});

	it("an optional sheet flips on its own", () => {
		const r = new ArtReadiness(SRC);
		r.track("enemy.imp");
		r.track("enemy.imp.attack");
		const e0 = r.epoch();
		r.markReady("c1");
		r.markReady("c2");
		expect(r.flippedSince(e0)).toEqual(["enemy.imp"]);
		const e1 = r.epoch();
		r.markReady("c3");
		expect(r.flippedSince(e1)).toEqual(["enemy.imp.attack"]);
	});

	it("an id with no content ids is ready at once (nothing to wait for)", () => {
		const r = new ArtReadiness(SRC);
		expect(r.isReady("ui.none")).toBe(true);
		expect(r.isReady("not.in.the.pack")).toBe(true);
		expect(r.contentCount("ui.none")).toBe(0);
	});

	it("the placeholder pack is ready everywhere; vale ids wait for their content", () => {
		const placeholder = new ThemePack(PLACEHOLDER_MANIFEST, { warn: quiet });
		const r = new ArtReadiness(placeholder);
		expect(r.isReady("class.vanguard")).toBe(true);
		expect(r.isReady("enemy.swarmer")).toBe(true);
		const vale = new ThemePack(VALE_MANIFEST, { warn: quiet });
		const v = new ArtReadiness(vale);
		const ids = vale.assetIdList();
		expect(ids.size()).toBeGreaterThan(0);
		const id = ids[0];
		expect(v.isReady(id)).toBe(false);
		for (const ref of vale.contentIds(id)) v.markReady(ref.contentId);
		expect(v.isReady(id)).toBe(true);
	});

	it("content resolved before a logical id is first asked counts (the cache is built from the current statuses)", () => {
		const r = new ArtReadiness(SRC);
		r.markReady("c1");
		r.markReady("c2");
		expect(r.isReady("enemy.imp")).toBe(true);
		// and a later change updates the cached count
		expect(r.isReady("enemy.swarmer")).toBe(false);
		r.markReady("c4");
		expect(r.isReady("enemy.swarmer")).toBe(true);
	});
});

describe("ArtReadiness: failures", () => {
	it("a failure is retried once after retryAfterSec, then the second failure is final (resolved)", () => {
		expect(ART_READINESS.retryAfterSec).toBe(10);
		expect(ART_READINESS.maxFailures).toBe(2);
		const r = new ArtReadiness(SRC);
		r.markReady("c1");
		r.markFailed("c2", 100);
		expect(r.status("c2")).toBe("failed");
		expect(r.isResolved("c2")).toBe(false);
		expect(r.isReady("enemy.imp")).toBe(false);
		expect(r.retriesPending()).toBe(1);
		expect(r.retryDue(109.99)).toEqual([]);
		expect(r.retryDue(110)).toEqual(["c2"]);
		expect(r.retryDue(200)).toEqual([]); // handed out once
		r.markFailed("c2", 112);
		expect(r.isFinalFailure("c2")).toBe(true);
		expect(r.isResolved("c2")).toBe(true);
		expect(r.retriesPending()).toBe(0);
		// the set draws without the broken sheet, never a stand-in forever
		expect(r.isReady("enemy.imp")).toBe(true);
		// later reports change nothing
		const e = r.epoch();
		r.markFailed("c2", 300);
		expect(r.epoch()).toBe(e);
	});

	it("a retry that succeeds makes the id ready", () => {
		const r = new ArtReadiness(SRC);
		r.markFailed("c5", 0);
		expect(r.retryDue(10)).toEqual(["c5"]);
		r.markReady("c5");
		expect(r.status("c5")).toBe("ready");
		expect(r.isReady("bullet.enemy")).toBe(true);
	});

	it("a success cancels a scheduled retry; a failure after a success is ignored", () => {
		const r = new ArtReadiness(SRC);
		r.markFailed("c5", 0);
		r.markReady("c5");
		expect(r.retryDue(100)).toEqual([]);
		r.markFailed("c5", 1);
		expect(r.status("c5")).toBe("ready");
	});

	it("due retries come out in failure order", () => {
		const r = new ArtReadiness(SRC);
		r.markFailed("c3", 2);
		r.markFailed("c1", 1);
		r.markFailed("c5", 50);
		expect(r.retryDue(20)).toEqual(["c3", "c1"]);
		expect(r.retryDue(60)).toEqual(["c5"]);
	});
});

describe("ArtReadiness: epoch and flips", () => {
	it("the epoch rises on every status change, never otherwise", () => {
		const r = new ArtReadiness(SRC);
		expect(r.epoch()).toBe(0);
		r.isReady("enemy.imp");
		expect(r.epoch()).toBe(0);
		r.markReady("c1");
		expect(r.epoch()).toBe(1);
		r.markReady("c1"); // no change
		expect(r.epoch()).toBe(1);
		r.markFailed("c9", 0);
		expect(r.epoch()).toBe(2);
		r.retryDue(100); // handing out a retry changes no status
		expect(r.epoch()).toBe(2);
		r.markFailed("c9", 100);
		expect(r.epoch()).toBe(3);
	});

	it("lists each flipped tracked id once, in flip order; untracked ids are not listed", () => {
		const r = new ArtReadiness(SRC);
		r.track("enemy.swarmer");
		r.track("enemy.imp");
		r.track("bullet.enemy");
		const e0 = r.epoch();
		r.markReady("c5"); // bullet.enemy
		r.markReady("c2");
		r.markReady("c4"); // enemy.swarmer
		r.markReady("c1"); // enemy.imp
		r.markReady("c3"); // enemy.imp.attack: never asked about, not listed
		expect(r.flippedSince(e0)).toEqual(["bullet.enemy", "enemy.swarmer", "enemy.imp"]);
		expect(r.flippedSince(r.epoch())).toEqual([]);
		const half = r.epoch() - 2; // after c4: only enemy.imp flipped later
		expect(r.flippedSince(half)).toEqual(["enemy.imp"]);
		// asking about an id that is already ready never lists it
		expect(r.isReady("enemy.imp.attack")).toBe(true);
		expect(r.flippedSince(e0)).toEqual(["bullet.enemy", "enemy.swarmer", "enemy.imp"]);
	});

	it("a no-content id never flips", () => {
		const r = new ArtReadiness(SRC);
		r.track("ui.none");
		r.markReady("c1");
		expect(r.flippedSince(0)).toEqual([]);
	});

	it("trackedCounts counts ready tracked ids", () => {
		const r = new ArtReadiness(SRC);
		r.track("enemy.imp");
		r.track("ui.none");
		expect(r.trackedCounts()).toEqual([1, 2]);
		r.markReady("c1");
		r.markReady("c2");
		expect(r.trackedCounts()).toEqual([2, 2]);
	});
});

describe("ArtReadiness: forced stand-ins (KV_StandInsForce)", () => {
	it("forced prefixes report not ready; clearing flips them back", () => {
		const r = new ArtReadiness(SRC);
		for (const c of ["c1", "c2", "c3", "c4", "c5"]) r.markReady(c);
		r.track("enemy.imp");
		r.track("bullet.enemy");
		r.track("ui.none");
		const e0 = r.epoch();
		r.setForced(["enemy."]);
		expect(r.epoch()).toBe(e0 + 1);
		expect(r.isReady("enemy.imp")).toBe(false);
		expect(r.isReady("bullet.enemy")).toBe(true);
		expect(r.flippedSince(e0)).toEqual(["enemy.imp"]);
		const e1 = r.epoch();
		r.setForced(["enemy."]); // the same force: no change
		expect(r.epoch()).toBe(e1);
		r.setForced(undefined);
		expect(r.isReady("enemy.imp")).toBe(true);
		expect(r.flippedSince(e1)).toEqual(["enemy.imp"]);
	});

	it('"all" forces every id, even one with no content', () => {
		const r = new ArtReadiness(SRC);
		r.track("ui.none");
		r.track("enemy.imp");
		const e0 = r.epoch();
		r.setForced("all");
		expect(r.isReady("ui.none")).toBe(false);
		expect(r.isReady("enemy.imp")).toBe(false);
		// enemy.imp was not ready before: only ui.none flipped
		expect(r.flippedSince(e0)).toEqual(["ui.none"]);
		// content landing under the force flips nothing; clearing it does
		const e1 = r.epoch();
		r.markReady("c1");
		r.markReady("c2");
		expect(r.flippedSince(e1)).toEqual([]);
		r.setForced(undefined);
		expect(r.flippedSince(e1)).toEqual(["ui.none", "enemy.imp"]);
	});

	it("parses the attribute", () => {
		expect(parseStandInsForce(undefined)).toBe(undefined);
		expect(parseStandInsForce(3)).toBe(undefined);
		expect(parseStandInsForce("")).toBe(undefined);
		expect(parseStandInsForce("  ")).toBe(undefined);
		expect(parseStandInsForce("all")).toBe("all");
		expect(parseStandInsForce(" ALL ")).toBe("all");
		expect(parseStandInsForce("enemy., bullet.")).toEqual(["enemy.", "bullet."]);
		expect(parseStandInsForce("class.vanguard,,")).toEqual(["class.vanguard"]);
		expect(parseStandInsForce(" , ")).toBe(undefined);
	});
});
