// Asset preloading, the pure plan (docs/PRELOAD.md P2): tiers by longest matching prefix, order, cross-tier dedupe,
// the loading screen's release / Skip boundaries, PreloadProgress and the boss floor push; LoadWaiters (the stage
// loader's assets wait, docs/STAGE_LOADER.md SL6).
import { describe, expect, it } from "@rbxts/jest-globals";
import { BOSS_ACT1_KIND, BOSS_DEMONLORD_KIND } from "shared/dungeon";
import {
	LOADING_STRING_KEYS,
	PLACEHOLDER_MANIFEST,
	REQUIRED_STRING_KEYS,
	ThemePack,
	type ContentRef,
	type RobloxAssetId,
	uiIconIds,
	uiSkinIds,
} from "shared/theme";
import { VALE_MANIFEST } from "shared/theme/packs/vale";
import {
	JoinGate,
	LOADING_STRINGS,
	LoadWaiters,
	PRELOAD,
	PRELOAD_BOSS_IDS,
	PreloadProgress,
	PreloadQueue,
	bossContentIds,
	preloadChunkSize,
	preloadDeviceOf,
	loadingReleased,
	preloadPlan,
	skipVisible,
	type PreloadSource,
} from "shared/view";

const quiet = () => undefined;

/** Fake content ids for hand-built sources: the plan never reads the scheme (real uploads live in shared/theme only). */
const fakeId = (n: number) => `test://${n}` as unknown as RobloxAssetId;
const image = (n: number): ContentRef => ({ contentId: fakeId(n), media: "image" });
const sound = (n: number): ContentRef => ({ contentId: fakeId(n), media: "sound" });

/** A hand-built source: logical id -> refs, biome key -> refs. */
function fakeSource(
	assets: Record<string, Array<ContentRef>>,
	biomes: Record<string, Array<ContentRef>>,
): PreloadSource {
	const keysOf = (o: object) => {
		const out = new Array<string>();
		for (const [k] of pairs(o as ReadonlyMap<string, unknown>)) out.push(k);
		out.sort();
		return out;
	};
	return {
		assetIdList() {
			return keysOf(assets).filter((id) => assets[id].size() > 0);
		},
		contentIds(id) {
			return assets[id] ?? [];
		},
		biomeKeys() {
			return keysOf(biomes);
		},
		biomeContentIds(b) {
			return biomes[b] ?? [];
		},
	};
}

const numbers = (refs: ReadonlyArray<ContentRef>) => refs.map((r) => r.contentId);

/** Index of the first ref of `refs` that is in `of`, or -1. */
function firstIndex(refs: ReadonlyArray<ContentRef>, of: ReadonlyArray<ContentRef>): number {
	const want = new Set(numbers(of));
	for (let i = 0; i < refs.size(); i++) if (want.has(refs[i].contentId)) return i;
	return -1;
}
function lastIndex(refs: ReadonlyArray<ContentRef>, of: ReadonlyArray<ContentRef>): number {
	const want = new Set(numbers(of));
	let last = -1;
	for (let i = 0; i < refs.size(); i++) if (want.has(refs[i].contentId)) last = i;
	return last;
}

describe("preloadPlan (docs/PRELOAD.md P2)", () => {
	it("vale: every content id lands in exactly one tier", () => {
		const pack = new ThemePack(VALE_MANIFEST, { warn: quiet });
		const plan = preloadPlan(pack);
		const all = new Set<string>();
		for (const id of pack.assetIdList()) for (const r of pack.contentIds(id)) all.add(r.contentId);
		for (const b of pack.biomeKeys()) for (const r of pack.biomeContentIds(b)) all.add(r.contentId);
		const count = new Map<string, number>();
		for (const r of plan.core) count.set(r.contentId, (count.get(r.contentId) ?? 0) + 1);
		for (const r of plan.later) count.set(r.contentId, (count.get(r.contentId) ?? 0) + 1);
		expect(plan.core.size() + plan.later.size()).toBe(all.size());
		for (const id of all) expect([id, count.get(id)]).toEqual([id, 1]);
		expect(plan.core.size()).toBeGreaterThan(0);
		expect(plan.later.size()).toBeGreaterThan(0);
	});

	it("vale: ui sfx and the knight come before the enemies in core; the bosses are later", () => {
		const pack = new ThemePack(VALE_MANIFEST, { warn: quiet });
		const plan = preloadPlan(pack);
		const enemies = [
			...pack.contentIds("enemy.swarmer"),
			...pack.contentIds("enemy.sniper"),
			...pack.contentIds("enemy.bruiser"),
		];
		const firstEnemy = firstIndex(plan.core, enemies);
		expect(firstEnemy).toBeGreaterThanOrEqual(0);
		for (const id of ["sfx.ui.click", "sfx.ui.back", "sfx.ui.confirm", "sfx.ui.move", "class.vanguard"]) {
			const refs = pack.contentIds(id);
			expect([id, refs.size() > 0]).toEqual([id, true]);
			const last = lastIndex(plan.core, refs);
			expect([id, last >= 0 && last < firstEnemy]).toEqual([id, true]);
		}
		// the ui sfx (a longer prefix than sfx.) are core, ahead of every other sfx
		expect(lastIndex(plan.core, pack.contentIds("sfx.ui.move"))).toBeLessThan(
			firstIndex(plan.core, pack.contentIds("sfx.player.swing")),
		);
		const bramble = pack.contentIds("boss.act1");
		expect(bramble.size()).toBeGreaterThan(0);
		expect(firstIndex(plan.core, bramble)).toBe(-1);
		expect(lastIndex(plan.later, bramble) - firstIndex(plan.later, bramble) + 1).toBe(bramble.size());
		// biome 1's floor texture is core
		const floor = pack.biomeContentIds("biome.1");
		expect(floor.size()).toBeGreaterThan(0);
		expect(firstIndex(plan.core, floor)).toBeGreaterThanOrEqual(0);
	});

	it("longest prefix wins; core keeps an id both tiers share; unmatched ids go last in later", () => {
		const src = fakeSource(
			{
				"amb.b1": [sound(1)],
				"boss.act1": [image(2), image(3)],
				"class.vanguard": [image(4)],
				"enemy.swarmer": [image(5), image(3)],
				"music.biome.1": [sound(6)],
				"music.biome.2": [sound(7)],
				"music.menu": [sound(8)],
				"sfx.player.swing": [sound(9)],
				"sfx.ui.click": [sound(10)],
				"tile.biome.1.floor": [image(11)],
				"ui.ring.player": [image(12)],
				"zzz.unknown": [image(13)],
			},
			{ "biome.1": [image(11)], "biome.2": [image(14)], "biome.10": [image(15)] },
		);
		const plan = preloadPlan(src);
		// core: ui., class., sfx.ui., music.menu, enemy., sfx., biome:biome.1 (its tile is the unmatched tile id's),
		// then music.biome.1 (floor 1's track, after the art)
		expect(numbers(plan.core)).toEqual(
			numbers([image(12), image(4), sound(10), sound(8), image(5), image(3), sound(9), image(11), sound(6)]),
		);
		// later: boss., music. (biome 2+), amb., biome: (sorted keys), then the unmatched ids sorted
		expect(numbers(plan.later)).toEqual(numbers([image(2), sound(7), sound(1), image(15), image(14), image(13)]));
		// boss.act1's image 3 is already core (enemy.swarmer): first occurrence wins
		expect(plan.later.map((r) => r.media)).toEqual(["image", "sound", "sound", "image", "image", "image"]);
	});

	it("the bullet atlas is core (docs/PROJECTILE_ART.md): bullet sprites and the impact effect share it, planned once", () => {
		const plan = preloadPlan(
			fakeSource(
				{
					"bullet.enemy.small": [image(21)],
					"bullet.player.basic": [image(21)],
					"fx.bullet.hit": [image(21)],
					"boss.act1": [image(22)],
				},
				{},
			),
		);
		expect(PRELOAD.core.includes("bullet.")).toBe(true);
		expect(numbers(plan.core)).toEqual([fakeId(21)]);
		expect(numbers(plan.later)).toEqual([fakeId(22)]);
	});

	it("every UI skin id (docs/UI_ART.md UA4) is core: one shared icon atlas is planned once", () => {
		const assets: Record<string, Array<ContentRef>> = {};
		uiSkinIds().forEach((id, i) => (assets[id] = [image(100 + i)]));
		for (const id of uiIconIds()) assets[id] = [image(99)];
		assets["boss.act1"] = [image(1)];
		const plan = preloadPlan(fakeSource(assets, {}));
		expect(numbers(plan.later)).toEqual([fakeId(1)]);
		const core = numbers(plan.core);
		expect(core.size()).toBe(uiSkinIds().size() + 1);
		expect(core.filter((c) => c === fakeId(99)).size()).toBe(1);
		for (const id of uiSkinIds()) expect([id, core.includes(assets[id][0].contentId)]).toEqual([id, true]);
	});

	it("an empty source plans nothing and releases at once", () => {
		const plan = preloadPlan(fakeSource({}, {}));
		expect(plan.core).toEqual([]);
		expect(plan.later).toEqual([]);
		const placeholder = preloadPlan(new ThemePack(PLACEHOLDER_MANIFEST, { warn: quiet }));
		expect(placeholder.core).toEqual([]);
		expect(placeholder.later).toEqual([]);
		const progress = new PreloadProgress(0);
		expect(progress.fraction()).toBe(1);
		expect(progress.complete()).toBe(true);
		expect(loadingReleased({ coreDone: progress.complete(), elapsedSec: 0, skipped: false })).toBe(true);
	});

	it("is deterministic", () => {
		const pack = new ThemePack(VALE_MANIFEST, { warn: quiet });
		expect(preloadPlan(pack)).toEqual(preloadPlan(new ThemePack(VALE_MANIFEST, { warn: quiet })));
	});
});

describe("the loading screen's rules", () => {
	it("releases on core done, on Skip, or at the timeout (15 s)", () => {
		expect(PRELOAD.timeoutSec).toBe(15);
		expect(loadingReleased({ coreDone: false, elapsedSec: 14.99, skipped: false })).toBe(false);
		expect(loadingReleased({ coreDone: false, elapsedSec: 15, skipped: false })).toBe(true);
		expect(loadingReleased({ coreDone: true, elapsedSec: 0, skipped: false })).toBe(true);
		expect(loadingReleased({ coreDone: false, elapsedSec: 3, skipped: true })).toBe(true);
		expect(loadingReleased({ coreDone: false, elapsedSec: 0, skipped: false })).toBe(false);
	});

	it("shows Skip from 3 s", () => {
		expect(PRELOAD.skipAfterSec).toBe(3);
		expect(skipVisible(0)).toBe(false);
		expect(skipVisible(2.99)).toBe(false);
		expect(skipVisible(3)).toBe(true);
		expect(skipVisible(14.99)).toBe(true);
	});

	it("PreloadProgress counts done and failed entries", () => {
		const p = new PreloadProgress(4);
		expect([p.done(), p.failed(), p.total(), p.fraction(), p.complete()]).toEqual([0, 0, 4, 0, false]);
		p.resolve(true);
		p.resolve(false);
		expect([p.done(), p.failed(), p.fraction(), p.complete()]).toEqual([2, 1, 0.5, false]);
		p.resolve(true);
		p.resolve(true);
		p.resolve(false); // past the total: ignored
		expect([p.done(), p.failed(), p.fraction(), p.complete()]).toEqual([4, 1, 1, true]);
	});
});

describe("bossContentIds", () => {
	it("maps each endless boss kind to its sheets; an unknown kind has none", () => {
		const pack = new ThemePack(VALE_MANIFEST, { warn: quiet });
		expect(PRELOAD_BOSS_IDS[BOSS_ACT1_KIND]).toBe("boss.act1");
		expect(PRELOAD_BOSS_IDS[BOSS_DEMONLORD_KIND]).toBe("boss.demonlord");
		expect(bossContentIds(pack, BOSS_ACT1_KIND)).toEqual(pack.contentIds("boss.act1"));
		expect(bossContentIds(pack, BOSS_ACT1_KIND).size()).toBeGreaterThan(0);
		expect(bossContentIds(pack, BOSS_DEMONLORD_KIND)).toEqual(pack.contentIds("boss.demonlord"));
		expect(bossContentIds(pack, "boss.nobody")).toEqual([]);
	});
});

describe("the music tiers", () => {
	it("vale: floor 1's and the tutorial's music are core, biome 2+ and the boss track later", () => {
		const pack = new ThemePack(VALE_MANIFEST, { warn: quiet });
		const plan = preloadPlan(pack);
		for (const id of ["music.menu", "music.biome.1", "music.tutorial"]) {
			const refs = pack.contentIds(id);
			if (refs.size() === 0) continue; // not uploaded yet: nothing to place
			expect([id, firstIndex(plan.core, refs) >= 0, firstIndex(plan.later, refs)]).toEqual([id, true, -1]);
		}
		for (const id of ["music.biome.2", "music.biome.5", "music.boss"]) {
			const refs = pack.contentIds(id);
			if (refs.size() === 0) continue;
			expect([id, firstIndex(plan.core, refs)]).toEqual([id, -1]);
		}
		expect(PRELOAD.core.includes("music.biome.1")).toBe(true);
		expect(PRELOAD.core.includes("music.tutorial")).toBe(true);
	});
});

describe("PreloadQueue (docs/PRELOAD.md P3, docs/STAGE_ASSETS.md SA4)", () => {
	it("serves front, then next, then back, each lane first in first out, in chunks", () => {
		const q = new PreloadQueue();
		expect(q.push([image(1), image(2), image(3)], "back")).toBe(3);
		expect(q.push([image(7), image(8)], "next")).toBe(2);
		expect(q.push([sound(4), sound(5)], "front")).toBe(2);
		expect([q.pending(), q.pending("front"), q.pending("next"), q.pending("back")]).toEqual([7, 2, 2, 3]);
		expect(numbers(q.take(3))).toEqual(numbers([sound(4), sound(5), image(7)]));
		expect(q.push([sound(6)], "front")).toBe(1);
		expect(numbers(q.take(3))).toEqual(numbers([sound(6), image(8), image(1)]));
		expect(numbers(q.take(3))).toEqual(numbers([image(2), image(3)]));
		expect(q.take(3)).toEqual([]);
		expect(q.pending()).toBe(0);
	});

	it("accepts an id once; a front push moves an id still waiting in the back lane", () => {
		const q = new PreloadQueue();
		expect(q.push([image(1), image(2), image(1)], "back")).toBe(2);
		expect(q.push([image(2)], "back")).toBe(0);
		// image 2 jumps the back lane; image 1 stays behind
		expect(q.push([image(2), sound(3)], "front")).toBe(2);
		expect(q.push([image(2)], "front")).toBe(0);
		expect(q.pending()).toBe(3);
		expect(numbers(q.take(1))).toEqual(numbers([image(2)]));
		// taken: never queued again, whatever the lane
		expect(q.push([image(2)], "front")).toBe(0);
		expect(q.push([image(2)], "next")).toBe(0);
		expect(q.push([image(2)], "back")).toBe(0);
		expect(q.seen(fakeId(2))).toBe(true);
		expect(q.seen(fakeId(9))).toBe(false);
		expect(numbers(q.take(4))).toEqual(numbers([sound(3), image(1)]));
	});

	it("a next push jumps back, a front push jumps next; a lower push never moves an id down", () => {
		const q = new PreloadQueue();
		q.push([image(1), image(2), image(3)], "back");
		expect(q.push([image(3)], "next")).toBe(1);
		expect(q.laneOf(fakeId(3))).toBe("next");
		expect(q.push([image(3)], "back")).toBe(0);
		expect(q.laneOf(fakeId(3))).toBe("next");
		q.push([image(4)], "next");
		expect(q.push([image(4)], "front")).toBe(1);
		expect(q.push([image(4)], "next")).toBe(0);
		expect([q.laneOf(fakeId(4)), q.laneOf(fakeId(9))]).toEqual(["front", undefined]);
		expect(numbers(q.take(10))).toEqual(numbers([image(4), image(3), image(1), image(2)]));
		expect(q.laneOf(fakeId(4))).toBe("taken");
	});

	it("retry re-queues a taken id once, bypassing the seen set", () => {
		const q = new PreloadQueue();
		q.push([image(1), image(2)], "front");
		q.take(1);
		expect(q.retry(image(1), "back")).toBe(true);
		expect(q.retry(image(1), "back")).toBe(false); // waiting already
		expect(q.laneOf(fakeId(1))).toBe("back");
		expect(numbers(q.take(10))).toEqual(numbers([image(2), image(1)]));
		// a retry of an id still waiting moves it up like a push
		q.retry(image(1), "back");
		q.push([image(5)], "next");
		expect(q.retry(image(1), "front")).toBe(true);
		expect(numbers(q.take(10))).toEqual(numbers([image(1), image(5)]));
		expect(q.retry(image(9), "next")).toBe(true); // never accepted: queued like a push
		expect(numbers(q.take(10))).toEqual(numbers([image(9)]));
	});
});

describe("the chunk size per device (docs/STAGE_ASSETS.md SAD11)", () => {
	it("classes a device and reads its chunk size", () => {
		const base = { tenFoot: false, touchEnabled: false, keyboardEnabled: true, gamepadEnabled: false };
		expect(preloadDeviceOf(base)).toBe("desktop");
		expect(preloadDeviceOf({ ...base, tenFoot: true, gamepadEnabled: true })).toBe("console");
		expect(preloadDeviceOf({ ...base, touchEnabled: true, keyboardEnabled: false })).toBe("touch");
		// a touch laptop with a keyboard is a desktop
		expect(preloadDeviceOf({ ...base, touchEnabled: true })).toBe("desktop");
		for (const d of ["desktop", "touch", "console"] as const) {
			expect(preloadChunkSize(d)).toBe(PRELOAD.chunkSizeByDevice[d]);
			expect(preloadChunkSize(d)).toBeGreaterThan(0);
		}
		const zero = { ...PRELOAD, chunkSizeByDevice: { desktop: 4, touch: 0, console: 4 } };
		expect(preloadChunkSize("touch", zero)).toBe(1);
	});
});

describe("JoinGate (docs/PRELOAD.md P5)", () => {
	it("decided first: fires on the release", () => {
		const g = new JoinGate<string>();
		expect(g.decide("tutorial")).toBe(undefined);
		expect(g.hasFired()).toBe(false);
		expect(g.release()).toBe("tutorial");
		expect(g.hasFired()).toBe(true);
		expect(g.release()).toBe(undefined);
		expect(g.decide("normal")).toBe(undefined);
	});

	it("released first: fires on the decision, once", () => {
		const g = new JoinGate<string>();
		expect(g.release()).toBe(undefined);
		expect(g.decide("normal")).toBe("normal");
		expect(g.decide("tutorial")).toBe(undefined);
		expect(g.release()).toBe(undefined);
	});

	it("keeps the first decision", () => {
		const g = new JoinGate<string>();
		g.decide("normal");
		g.decide("tutorial");
		expect(g.release()).toBe("normal");
	});
});

describe("the loading screen's strings", () => {
	it("are the contract's required LOADING_STRING_KEYS and exist in every bundled pack", () => {
		const keys = [LOADING_STRINGS.title, LOADING_STRINGS.progress, LOADING_STRINGS.skip];
		expect(keys).toEqual([...LOADING_STRING_KEYS]);
		for (const key of keys) expect([key, REQUIRED_STRING_KEYS.includes(key)]).toEqual([key, true]);
		for (const manifest of [PLACEHOLDER_MANIFEST, VALE_MANIFEST]) {
			const pack = new ThemePack(manifest, { warn: quiet });
			for (const key of keys) expect([key, pack.hasString(key)]).toEqual([key, true]);
			expect(pack.str(LOADING_STRINGS.progress, { done: 23, total: 40 })).toBe("Loading 23 / 40");
		}
	});
});

describe("LoadWaiters", () => {
	it("fires at once when every id resolved, else when the last one does, in wait order", () => {
		const w = new LoadWaiters<string>();
		expect(w.wait([], "empty")).toBe(true);
		expect(w.resolve("a")).toEqual([]);
		expect(w.wait(["a"], "a only")).toBe(true);
		expect(w.wait(["a", "b", "c"], "first")).toBe(false);
		expect(w.wait(["c"], "second")).toBe(false);
		expect(w.open()).toBe(2);
		expect(w.resolve("b")).toEqual([]);
		expect(w.resolve("c")).toEqual(["first", "second"]);
		expect(w.open()).toBe(0);
		expect(w.isResolved("b")).toBe(true);
		expect(w.isResolved("d")).toBe(false);
		expect(w.resolve("c")).toEqual([]); // resolved twice: nothing waits any more
	});

	it("a repeated id waits once", () => {
		const w = new LoadWaiters<number>();
		expect(w.wait(["x", "x"], 1)).toBe(false);
		expect(w.progress(1)).toEqual([0, 1]);
		expect(w.resolve("x")).toEqual([1]);
	});

	it("reads an open wait's progress (docs/STAGE_ASSETS.md SA4)", () => {
		const w = new LoadWaiters<string>();
		w.resolve("a");
		expect(w.wait(["a", "b", "c", "d"], "stage")).toBe(false);
		expect(w.progress("stage")).toEqual([1, 4]);
		w.resolve("c");
		expect(w.progress("stage")).toEqual([2, 4]);
		w.resolve("b");
		w.resolve("d");
		expect(w.progress("stage")).toBe(undefined); // fired
		expect(w.progress("never")).toBe(undefined);
	});

	it("cancels a wait; forget makes a resolved id wait again", () => {
		const w = new LoadWaiters<string>();
		expect(w.wait(["a"], "gone")).toBe(false);
		expect(w.cancel("gone")).toBe(true);
		expect(w.cancel("gone")).toBe(false);
		expect(w.resolve("a")).toEqual([]);
		expect(w.wait(["a"], "now")).toBe(true);
		w.forget("a");
		expect(w.isResolved("a")).toBe(false);
		expect(w.wait(["a"], "again")).toBe(false);
		expect(w.resolve("a")).toEqual(["again"]);
	});
});
