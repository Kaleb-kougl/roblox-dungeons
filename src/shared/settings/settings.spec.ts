// Juice settings schema (defaults and sanitize rules of the web build's src/fx/settings.ts), the settings document
// v2 (every group, v1 migration, sanitize, patches) and the mockable persistence layer: retries, session cache,
// dirty tracking, save on release.
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	DEFAULT_HUD_SCALE_PERCENT,
	DEFAULT_ROOM_EDGES,
	HUD_SCALE_PERCENTS,
	PlayerDocCache,
	SETTINGS_DOC_V1,
	SETTINGS_DOC_VERSION,
	VOLUME_PERCENT,
	applyJuicePatch,
	applySettingsPatch,
	decodeSettingsDoc,
	defaultAudioSettings,
	defaultDisplaySettings,
	defaultJuiceSettings,
	encodeSettingsDoc,
	playerDataKey,
	resolveAudioSettings,
	resolveDisplaySettings,
	resolveJuiceSettings,
	reuseSameGroups,
	sameJuiceOverrides,
	sameSettingsOverrides,
	sanitizeDisplayOverrides,
	sanitizeJuiceOverrides,
	sanitizeJuiceSettings,
	sanitizeSettingsOverrides,
	sanitizeSettingsPatch,
	stepVolume,
	withRetries,
	type DocCodec,
	type JuiceOverrides,
	type KeyValueStore,
	type SettingsOverrides,
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

	it("the player data key", () => {
		expect(playerDataKey(12345)).toBe("u_12345");
	});
});

const EMPTY_DOC = { v: SETTINGS_DOC_VERSION, juice: {}, controls: {}, audio: {}, display: {} };

describe("settings document v2", () => {
	it("round-trips every group; empty groups are stored as {} and read back as absent", () => {
		expect(SETTINGS_DOC_VERSION).toBe(2);
		const overrides: SettingsOverrides = {
			juice: { healthBars: "off" },
			controls: { kbm: { swap: ["G"] }, pad: { roll: "ButtonX", skill3: "ButtonL1" } },
			audio: { music: 40 },
			display: { hudScale: 125 },
		};
		const doc = encodeSettingsDoc(overrides);
		expect(doc).toEqual({ v: 2, ...overrides });
		expect(decodeSettingsDoc(doc)).toEqual(overrides);
		expect(encodeSettingsDoc({})).toEqual(EMPTY_DOC);
		expect(decodeSettingsDoc(EMPTY_DOC)).toEqual({});
	});

	it("migrates a v1 document: its juice is kept, the new groups start empty", () => {
		const v1 = { v: SETTINGS_DOC_V1, juice: { particles: "low", reducedMotion: true, bogus: 1 } };
		expect(decodeSettingsDoc(v1)).toEqual({ juice: { particles: "low", reducedMotion: true } });
		// A v1 doc never carried other groups: anything else in it is ignored.
		expect(decodeSettingsDoc({ v: 1, juice: {}, controls: { kbm: { swap: ["G"] } } })).toEqual({});
		// Written back, it is a v2 document.
		expect(encodeSettingsDoc(decodeSettingsDoc(v1))).toEqual({
			...EMPTY_DOC,
			juice: { particles: "low", reducedMotion: true },
		});
	});

	it("unknown versions and garbage read as no overrides", () => {
		expect(decodeSettingsDoc(undefined)).toEqual({});
		expect(decodeSettingsDoc("doc")).toEqual({});
		expect(decodeSettingsDoc({ juice: { healthBars: "off" } })).toEqual({});
		expect(decodeSettingsDoc({ v: 0, juice: { healthBars: "off" } })).toEqual({});
		expect(decodeSettingsDoc({ v: 3, juice: { healthBars: "off" } })).toEqual({});
		expect(decodeSettingsDoc({ v: "2", juice: { healthBars: "off" } })).toEqual({});
		expect(decodeSettingsDoc({ v: 2, juice: "x", controls: 5, audio: [], display: true })).toEqual({});
	});

	it("sanitizes every group: unknown keys, bad values, reserved / duplicate bindings and defaults are dropped", () => {
		expect(
			sanitizeSettingsOverrides({
				juice: { particles: "loud", freezeFrame: false },
				controls: {
					kbm: { swap: ["Escape"], roll: ["LeftShift"], ember: ["Q"], dance: ["G"] },
					pad: { fire: "ButtonStart", alt: "ButtonR2" }, // alt on RT duplicates fire's default
				},
				audio: { master: 55, music: 101, sfx: -10, voice: 20 },
				display: { hudScale: 95 },
				extra: { a: 1 },
			}),
		).toEqual({ juice: { freezeFrame: false }, controls: { kbm: { roll: ["LeftShift"] } }, audio: { master: 55 } });
		expect(sanitizeSettingsOverrides({ audio: { master: 50.5, music: 0 } })).toEqual({ audio: { music: 0 } });
		expect(sanitizeSettingsOverrides({ audio: { master: 100 }, display: { hudScale: 100 } })).toEqual({});
		expect(sanitizeSettingsOverrides(42)).toEqual({});
	});

	it("is overrides-only: what resolves is the defaults plus what the player changed", () => {
		expect(resolveAudioSettings(undefined)).toEqual(defaultAudioSettings());
		expect(resolveAudioSettings({ sfx: 30 })).toEqual({ master: 100, music: 100, sfx: 30 });
		expect(resolveDisplaySettings({})).toEqual(defaultDisplaySettings());
		expect(resolveDisplaySettings({ hudScale: 80 }).hudScale).toBe(80);
		expect(HUD_SCALE_PERCENTS.includes(DEFAULT_HUD_SCALE_PERCENT)).toBe(true);
		expect([
			stepVolume(100, 1),
			stepVolume(100, -1),
			stepVolume(0, -1),
			stepVolume(VOLUME_PERCENT.step, -1),
		]).toEqual([100, 90, 0, 0]);
	});

	it("a patch replaces each group it carries; {} clears a group; other groups are kept", () => {
		const current: SettingsOverrides = { juice: { particles: "low" }, audio: { music: 20 } };
		expect(applySettingsPatch(current, { juice: { damageNumbers: false } })).toEqual({
			juice: { damageNumbers: false },
			audio: { music: 20 },
		});
		expect(applySettingsPatch(current, { audio: {} })).toEqual({ juice: { particles: "low" } });
		expect(applySettingsPatch(current, { controls: { kbm: { flask: ["G"] } } })).toEqual({
			...current,
			controls: { kbm: { flask: ["G"] } },
		});
		expect(applySettingsPatch(current, "nope")).toEqual(current);
		expect(applySettingsPatch(current, { juice: { particles: "bogus" } })).toEqual({ audio: { music: 20 } });
		// The wire form keeps a present-but-empty group (it means "clear"); sanitizeSettingsOverrides drops it.
		expect(sanitizeSettingsPatch({ juice: { particles: "x" }, controls: {}, nope: 1 })).toEqual({
			juice: {},
			controls: {},
		});
		expect(sanitizeSettingsOverrides({ juice: {}, controls: {} })).toEqual({});
	});

	it("reuses unchanged groups' objects (memoized readers update only for the group that changed)", () => {
		const prev: SettingsOverrides = { juice: { particles: "low" }, controls: { kbm: { swap: ["G"] } } };
		expect(reuseSameGroups(prev, { juice: { particles: "low" }, controls: { kbm: { swap: ["G"] } } })).toBe(prev);
		const changed = reuseSameGroups(prev, applySettingsPatch(prev, { juice: { particles: "high" } }));
		expect(changed.controls).toBe(prev.controls);
		expect(changed.juice).toEqual({ particles: "high" });
		expect(reuseSameGroups(prev, { juice: { particles: "low" } }).juice).toBe(prev.juice);
		expect(reuseSameGroups(prev, { juice: { particles: "low" } }).controls).toBe(undefined);
	});

	it("compares override sets group by group (absent = empty)", () => {
		const a: SettingsOverrides = { controls: { kbm: { moveUp: ["I", "Up"] } }, audio: { sfx: 10 } };
		expect(sameSettingsOverrides(a, { audio: { sfx: 10 }, controls: { kbm: { moveUp: ["I", "Up"] } } })).toBe(true);
		expect(sameSettingsOverrides(a, { audio: { sfx: 10 }, controls: { kbm: { moveUp: ["I"] } } })).toBe(false);
		expect(sameSettingsOverrides(a, { controls: a.controls })).toBe(false);
		expect(sameSettingsOverrides({}, { juice: {}, controls: {}, audio: {}, display: {} })).toBe(true);
		expect(sameSettingsOverrides({ controls: { pad: { swap: "ButtonX" } } }, {})).toBe(false);
	});
});

describe("display: room edges (docs/ROOM_EDGES.md RE6)", () => {
	it("defaults to On; only Off is stored", () => {
		expect(DEFAULT_ROOM_EDGES).toBe(true);
		expect(defaultDisplaySettings().roomEdges).toBe(true);
		expect(resolveDisplaySettings(undefined).roomEdges).toBe(true);
		expect(sanitizeDisplayOverrides({ roomEdges: false })).toEqual({ roomEdges: false });
		expect(sanitizeDisplayOverrides({ roomEdges: true })).toEqual({});
		expect(resolveDisplaySettings({ roomEdges: false })).toEqual({
			hudScale: DEFAULT_HUD_SCALE_PERCENT,
			roomEdges: false,
		});
	});

	it("round-trips Off through the stored document (still v2)", () => {
		const overrides: SettingsOverrides = { display: { roomEdges: false } };
		const doc = encodeSettingsDoc(overrides);
		expect(doc).toEqual({ ...EMPTY_DOC, display: { roomEdges: false } });
		expect(doc.v).toBe(2);
		expect(decodeSettingsDoc(doc)).toEqual(overrides);
		expect(resolveDisplaySettings(decodeSettingsDoc(doc).display).roomEdges).toBe(false);
		// With a HUD scale too, and back to On through a patch (true is the default: the group clears).
		const both = decodeSettingsDoc(encodeSettingsDoc({ display: { hudScale: 110, roomEdges: false } }));
		expect(both).toEqual({ display: { hudScale: 110, roomEdges: false } });
		expect(applySettingsPatch(overrides, { display: { roomEdges: true } })).toEqual({});
		expect(sameSettingsOverrides(overrides, { display: { roomEdges: false } })).toBe(true);
		expect(sameSettingsOverrides(overrides, {})).toBe(false);
	});

	it("ignores junk", () => {
		for (const junk of [0, 1, "false", "off", "no", {}, [false]] as ReadonlyArray<unknown>) {
			expect(sanitizeDisplayOverrides({ roomEdges: junk })).toEqual({});
		}
		expect(sanitizeSettingsOverrides({ display: { roomEdges: "false" } })).toEqual({});
		expect(decodeSettingsDoc({ ...EMPTY_DOC, display: { roomEdges: 0, hudScale: 90 } })).toEqual({
			display: { hudScale: 90 },
		});
	});

	it("an older v2 document without the field reads On", () => {
		const old = { v: 2, juice: {}, controls: {}, audio: {}, display: { hudScale: 125 } };
		expect(resolveDisplaySettings(decodeSettingsDoc(old).display)).toEqual({ hudScale: 125, roomEdges: true });
		expect(resolveDisplaySettings(decodeSettingsDoc({ v: 2 }).display).roomEdges).toBe(true);
		expect(resolveDisplaySettings(decodeSettingsDoc({ v: SETTINGS_DOC_V1, juice: {} }).display).roomEdges).toBe(
			true,
		);
	});
});

function encodeJuice(juice: JuiceOverrides): unknown {
	return encodeSettingsDoc({ juice });
}

function decodeJuice(raw: unknown): JuiceOverrides {
	return decodeSettingsDoc(raw).juice ?? {};
}

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
		return decodeJuice(raw);
	},
	encode(doc) {
		return encodeJuice(doc);
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
		store.data.set("u_1", encodeJuice({ particles: "low" }));
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
		expect(store.data.get("u_1")).toEqual({ ...EMPTY_DOC, juice: { particles: "low", freezeFrame: false } });
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
		store.data.set("u_3", encodeJuice({ particles: "high" }));
		store.failures = 3;
		const cache = new PlayerDocCache(store, CODEC, POLICY, () => undefined);
		expect(cache.load("u_3")).toEqual({});
		expect(cache.loadFailed("u_3")).toBe(true);
		expect(cache.release("u_3")).toBe("clean");
		expect(decodeJuice(store.data.get("u_3"))).toEqual({ particles: "high" });
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
		store.data.set("u_6", encodeJuice({ healthBars: "always" }));
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
		expect(decodeJuice(store.data.get("u_7"))).toEqual({ freezeFrame: false });
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
