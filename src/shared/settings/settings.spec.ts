// Juice settings schema (defaults and sanitize rules of the web build's src/fx/settings.ts) and the mockable
// persistence layer: retries, session cache, dirty tracking, save on release.
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	PlayerDocCache,
	SETTINGS_DOC_VERSION,
	applyJuicePatch,
	decodeSettingsDoc,
	defaultJuiceSettings,
	encodeSettingsDoc,
	playerDataKey,
	resolveJuiceSettings,
	sameJuiceOverrides,
	sanitizeJuiceOverrides,
	sanitizeJuiceSettings,
	withRetries,
	type DocCodec,
	type JuiceOverrides,
	type KeyValueStore,
} from "shared/settings";

describe("juice settings schema", () => {
	it("defaults match the web build (reducedMotion from the system)", () => {
		expect(defaultJuiceSettings()).toEqual({
			healthBars: "onDamage",
			damageNumbers: true,
			freezeFrame: true,
			particles: "normal",
			reducedMotion: false,
		});
		expect(defaultJuiceSettings(true).reducedMotion).toBe(true);
	});

	it("sanitize keeps valid known keys and falls back to the defaults for the rest", () => {
		const d = defaultJuiceSettings();
		expect(sanitizeJuiceSettings(undefined, d)).toEqual(d);
		expect(sanitizeJuiceSettings("nope", d)).toEqual(d);
		expect(
			sanitizeJuiceSettings(
				{ healthBars: "always", particles: "loud", damageNumbers: 1, freezeFrame: false, extra: true },
				d,
			),
		).toEqual({ ...d, healthBars: "always", freezeFrame: false });
		expect(sanitizeJuiceOverrides({ particles: "high", reducedMotion: true, healthBars: 3 })).toEqual({
			particles: "high",
			reducedMotion: true,
		});
	});

	it("overrides resolve against the client's defaults; untouched reducedMotion follows the system", () => {
		expect(resolveJuiceSettings({}, true).reducedMotion).toBe(true);
		expect(resolveJuiceSettings({ reducedMotion: false }, true).reducedMotion).toBe(false);
		expect(resolveJuiceSettings({ particles: "off" }).particles).toBe("off");
	});

	it("patches merge valid keys only", () => {
		const a = applyJuicePatch({ particles: "low" }, { damageNumbers: false, particles: "bogus", nope: 1 });
		expect(a).toEqual({ particles: "low", damageNumbers: false });
		expect(sameJuiceOverrides(a, { damageNumbers: false, particles: "low" })).toBe(true);
		expect(sameJuiceOverrides(a, { particles: "low" })).toBe(false);
	});

	it("the stored document round-trips; other versions and garbage read as no overrides", () => {
		const doc = encodeSettingsDoc({ healthBars: "off" });
		expect(doc).toEqual({ v: SETTINGS_DOC_VERSION, juice: { healthBars: "off" } });
		expect(decodeSettingsDoc(doc)).toEqual({ healthBars: "off" });
		expect(decodeSettingsDoc(undefined)).toEqual({});
		expect(decodeSettingsDoc({ v: 99, juice: { healthBars: "off" } })).toEqual({});
		expect(decodeSettingsDoc({ v: SETTINGS_DOC_VERSION, juice: "x" })).toEqual({});
		expect(playerDataKey(12345)).toBe("u_12345");
	});
});

/**
 * In-memory store that fails the next `failures` calls. With `yields` set, every call yields its coroutine once
 * (like a DataStore request in flight) before it completes; the test resumes it.
 */
class MockStore implements KeyValueStore {
	data = new Map<string, unknown>();
	failures = 0;
	gets = 0;
	sets = 0;
	yields = false;
	lastUserIds: ReadonlyArray<number> | undefined;
	get(key: string): unknown {
		this.gets++;
		if (this.yields) coroutine.yield();
		if (this.failures > 0) {
			this.failures--;
			error("DataStore throttled", 0);
		}
		return this.data.get(key);
	}
	set(key: string, value: unknown, userIds?: ReadonlyArray<number>): void {
		this.sets++;
		if (this.yields) coroutine.yield();
		if (this.failures > 0) {
			this.failures--;
			error("DataStore throttled", 0);
		}
		this.data.set(key, value);
		this.lastUserIds = userIds;
	}
}

function resume(waiter: thread): void {
	coroutine.resume(waiter);
}

const CODEC: DocCodec<JuiceOverrides> = {
	decode(raw) {
		return decodeSettingsDoc(raw);
	},
	encode(doc) {
		return encodeSettingsDoc(doc);
	},
	equals(a, b) {
		return sameJuiceOverrides(a, b);
	},
	empty() {
		return {};
	},
};
const POLICY = { attempts: 3, baseDelaySeconds: 1 };

describe("withRetries", () => {
	it("retries with exponential backoff and reports the last error", () => {
		const waits: number[] = [];
		let calls = 0;
		const ok = withRetries(
			() => {
				calls++;
				if (calls < 3) error("nope", 0);
				return 7;
			},
			POLICY,
			(s) => waits.push(s),
		);
		expect(ok).toEqual({ ok: true, value: 7, attempts: 3 });
		expect(waits).toEqual([1, 2]);
		const bad = withRetries(
			() => error("always", 0),
			POLICY,
			() => undefined,
		);
		expect(bad).toEqual({ ok: false, error: "always", attempts: 3 });
	});
});

describe("PlayerDocCache", () => {
	it("loads once per session, saves only when dirty, releases on leave", () => {
		const store = new MockStore();
		store.data.set("u_1", encodeSettingsDoc({ particles: "low" }));
		const cache = new PlayerDocCache(store, CODEC, POLICY, () => undefined);
		expect(cache.load("u_1")).toEqual({ particles: "low" });
		cache.load("u_1");
		expect(store.gets).toBe(1);
		expect(cache.save("u_1")).toBe("clean");
		cache.set("u_1", { particles: "low" });
		expect(cache.isDirty("u_1")).toBe(false);
		cache.set("u_1", applyJuicePatch(cache.get("u_1")!, { freezeFrame: false }));
		expect(cache.isDirty("u_1")).toBe(true);
		expect(cache.release("u_1")).toBe("saved");
		expect(store.data.get("u_1")).toEqual({
			v: SETTINGS_DOC_VERSION,
			juice: { particles: "low", freezeFrame: false },
		});
		expect(cache.get("u_1")).toBe(undefined);
		expect(cache.save("u_1")).toBe("unknown");
	});

	it("survives transient store errors with retries", () => {
		const store = new MockStore();
		store.failures = 2;
		const cache = new PlayerDocCache(store, CODEC, POLICY, () => undefined);
		expect(cache.load("u_2")).toEqual({});
		expect(cache.loadFailed("u_2")).toBe(false);
		store.failures = 2;
		cache.set("u_2", { healthBars: "always" });
		expect(cache.save("u_2")).toBe("saved");
		expect(store.sets).toBe(3);
	});

	it("after a failed load it never overwrites the stored value unless the player changed something", () => {
		const store = new MockStore();
		store.data.set("u_3", encodeSettingsDoc({ particles: "high" }));
		store.failures = 3;
		const cache = new PlayerDocCache(store, CODEC, POLICY, () => undefined);
		expect(cache.load("u_3")).toEqual({});
		expect(cache.loadFailed("u_3")).toBe(true);
		expect(cache.release("u_3")).toBe("clean");
		expect(decodeSettingsDoc(store.data.get("u_3"))).toEqual({ particles: "high" });
	});

	it("a failed save keeps the document dirty for the next try", () => {
		const store = new MockStore();
		const cache = new PlayerDocCache(store, CODEC, POLICY, () => undefined);
		cache.load("u_4");
		cache.set("u_4", { damageNumbers: false });
		store.failures = 3;
		expect(cache.save("u_4")).toBe("failed");
		expect(cache.isDirty("u_4")).toBe(true);
		expect(cache.save("u_4")).toBe("saved");
		expect(cache.keys()).toEqual(["u_4"]);
	});

	it("passes the key's owners (load's userIds) to every write", () => {
		const store = new MockStore();
		const cache = new PlayerDocCache(store, CODEC, POLICY, () => undefined);
		cache.load("u_5", [5]);
		cache.set("u_5", { particles: "off" });
		expect(cache.save("u_5")).toBe("saved");
		expect(store.lastUserIds).toEqual([5]);
	});

	it("concurrent loads of one key share the first read (join + early requestSettings: one GetAsync)", () => {
		const store = new MockStore();
		store.data.set("u_6", encodeSettingsDoc({ healthBars: "always" }));
		store.yields = true;
		const cache = new PlayerDocCache(store, CODEC, POLICY, () => undefined, resume);
		const got: JuiceOverrides[] = [];
		const first = coroutine.create(() => got.push(cache.load("u_6", [6])));
		const second = coroutine.create(() => got.push(cache.load("u_6", [6])));
		coroutine.resume(first); // in GetAsync
		expect(cache.isLoading("u_6")).toBe(true);
		coroutine.resume(second); // waits for the first load
		expect(store.gets).toBe(1);
		expect(got).toEqual([]);
		coroutine.resume(first); // the read completes and wakes the waiter
		expect(store.gets).toBe(1);
		expect(got).toEqual([{ healthBars: "always" }, { healthBars: "always" }]);
		expect(cache.isLoading("u_6")).toBe(false);
		expect(coroutine.status(second)).toBe("dead");
	});

	it("a save while the same key is saving waits for it, then writes only if still dirty (leave + BindToClose)", () => {
		const store = new MockStore();
		const cache = new PlayerDocCache(store, CODEC, POLICY, () => undefined, resume);
		cache.load("u_7", [7]);
		cache.set("u_7", { freezeFrame: false });
		store.yields = true;
		const outcomes: string[] = [];
		const leave = coroutine.create(() => outcomes.push(`release ${cache.release("u_7")}`));
		const close = coroutine.create(() => outcomes.push(`close ${cache.save("u_7")}`));
		coroutine.resume(leave); // SetAsync in flight
		expect(cache.isSaving("u_7")).toBe(true);
		coroutine.resume(close); // waits instead of writing the same document again
		expect(store.sets).toBe(1);
		coroutine.resume(leave);
		expect(store.sets).toBe(1);
		expect(outcomes).toEqual(["close clean", "release saved"]);
		expect(cache.get("u_7")).toBe(undefined);
		expect(decodeSettingsDoc(store.data.get("u_7"))).toEqual({ freezeFrame: false });
	});

	it("a waiting save writes after a failed one (the document is still dirty)", () => {
		const store = new MockStore();
		const cache = new PlayerDocCache(store, CODEC, POLICY, () => undefined, resume);
		cache.load("u_8");
		cache.set("u_8", { particles: "low" });
		store.yields = true;
		store.failures = POLICY.attempts;
		const outcomes: string[] = [];
		const a = coroutine.create(() => outcomes.push(`a ${cache.save("u_8")}`));
		const b = coroutine.create(() => outcomes.push(`b ${cache.save("u_8")}`));
		coroutine.resume(a);
		coroutine.resume(b);
		// a's three tries each yield once; the third failure wakes b, whose write yields too.
		for (let i = 0; i < POLICY.attempts; i++) coroutine.resume(a);
		expect(outcomes).toEqual(["a failed"]);
		coroutine.resume(b);
		expect(outcomes).toEqual(["a failed", "b saved"]);
		expect(cache.isDirty("u_8")).toBe(false);
	});
});
