/**
 * The rollback probe's small pure pieces (docs/ROLLBACK_SPIKE.md R3 / R3a): the worker message validators (a valid
 * message round-trips, a malformed one is dropped), the input packing, the device class rules and label, the probe
 * case, the window statistics and the facts probes.
 */
import { describe, expect, it } from "@rbxts/jest-globals";
import { EMPTY_INPUT, copyInput, createSimState, type InputFrame } from "shared/sim";
import { buildEndlessRunConfig } from "shared/run";
import { ROLLBACK_PROBE_LIMITS } from "shared/spikes";
import { ROLLBACK_SPIKE, rollbackDigestBytes } from "../config";
import {
	WindowSamples,
	factsBufferProbe,
	factsTableProbe,
	fillDigestBuffer,
	packInput,
	readBufferProbe,
	readMainToWorker,
	readTableProbe,
	readWorkerToMain,
	rollbackDeviceClass,
	rollbackDeviceLabel,
	utf8Truncate,
	rollbackProbeCase,
	bufferAfter,
	tableAfter,
	unpackInput,
	type RollbackDeviceFacts,
} from ".";

const SETUP = {
	kind: "setup",
	sessionId: "0F6C2B1E-6A55-4C1D-9E0A-2B7D8C9E1F00",
	mode: "parallel",
	horizon: 16,
	worldKind: "dev",
	seed: 12345,
	partySize: 1,
	localIndex: 0,
	coop: false,
	atBossDoor: false,
	scoring: false,
	stress: 0,
	dev: { startFloor: 15, invulnerable: true, vault: { every: true, tier: 2 } },
	live: false,
	strategy: "repeatLast",
	borrowed: false,
	deviceLabel: "kb 1920x1080",
	deviceClass: "pc",
	native: false,
};

describe("rollback probe protocol (R3)", () => {
	it("round-trips a setup and refuses malformed ones", () => {
		const s = readMainToWorker(SETUP, undefined);
		expect(s).toEqual(SETUP);
		expect(readMainToWorker({ ...SETUP, extra: 1 }, undefined)).toEqual(SETUP);
		expect(readMainToWorker({ ...SETUP, horizon: 0 }, undefined)).toBeUndefined();
		expect(
			readMainToWorker({ ...SETUP, horizon: ROLLBACK_PROBE_LIMITS.maxHorizon + 1 }, undefined),
		).toBeUndefined();
		expect(readMainToWorker({ ...SETUP, sessionId: "bad id!" }, undefined)).toBeUndefined();
		expect(readMainToWorker({ ...SETUP, localIndex: 1 }, undefined)).toBeUndefined();
		expect(readMainToWorker({ ...SETUP, mode: "facts" }, undefined)).toBeUndefined();
		expect(readMainToWorker({ ...SETUP, dev: { startFloor: 0, invulnerable: true } }, undefined)).toBeUndefined();
		expect(readMainToWorker({ ...SETUP, coop: undefined }, undefined)).toBeUndefined();
		expect(readMainToWorker("setup", undefined)).toBeUndefined();
	});

	it("reads frames only after a setup, with whole packed ticks", () => {
		const f: InputFrame = { moveX: 3, moveZ: -2, aimX: 1, aimZ: 0, buttons: 5 };
		const truth: number[] = [];
		packInput(f, truth);
		packInput(EMPTY_INPUT, truth);
		const msg = {
			kind: "frames",
			tick: 3,
			frameMs: 16.7,
			truthFirst: 2,
			truth,
			ownFirst: 4,
			own: [],
			hashTick: -1,
		};
		expect(readMainToWorker(msg, undefined)).toBeUndefined();
		expect(readMainToWorker(msg, 2)).toBeDefined(); // 2 ticks of 1 player are 1 tick of 2
		expect(readMainToWorker(msg, 3)).toBeUndefined();
		expect(readMainToWorker(msg, 1)).toEqual(msg);
		expect(readMainToWorker({ ...msg, truth: [1, 2, 3] }, 1)).toBeUndefined();
		expect(readMainToWorker({ ...msg, truth: [0, 0, 0, 0, 0.5] }, 1)).toBeUndefined();
		expect(readMainToWorker({ ...msg, hashTick: -2 }, 1)).toBeUndefined();
		const back = unpackInput(truth, 0, copyInput(EMPTY_INPUT));
		expect(back).toEqual(f);
		expect(readMainToWorker({ kind: "control", op: "end", tick: 10 }, 1)).toEqual({
			kind: "control",
			op: "end",
			tick: 10,
		});
		expect(readMainToWorker({ kind: "control", op: "pause", tick: 10 }, 1)).toBeUndefined();
	});

	it("reads worker messages and drops bad summaries", () => {
		expect(readWorkerToMain({ kind: "mirrorHash", tick: 600, hash: "abc" })).toEqual({
			kind: "mirrorHash",
			tick: 600,
			hash: "abc",
		});
		expect(readWorkerToMain({ kind: "cpu", summary: { sessionId: "x" } })).toBeUndefined();
		expect(readWorkerToMain({ kind: "error", message: "boom" })).toEqual({ kind: "error", message: "boom" });
		expect(readWorkerToMain({ kind: "digest", sentAt: 1, data: "not a buffer" })).toBeUndefined();
		const data = buffer.create(rollbackDigestBytes());
		expect(readWorkerToMain({ kind: "digest", sentAt: 1, data })?.kind).toBe("digest");
		expect(readWorkerToMain({ kind: "nope" })).toBeUndefined();
	});

	it("fills the digest buffer from a state", () => {
		const setup = buildEndlessRunConfig(4242, 2);
		const state = createSimState(4242, setup.spawn!.x, setup.spawn!.z, setup.config);
		const b = buffer.create(rollbackDigestBytes());
		expect(rollbackDigestBytes()).toBe(8 + 64 * 20 + 150 * 12 + 8 * 12);
		fillDigestBuffer(b, state);
		expect(buffer.readu32(b, 0)).toBe(0);
		expect(buffer.readu8(b, 7)).toBe(2);
		// Each actor record ends with its hp (f32 at +16).
		const first = state.combat.actors.find((a) => a.kind >= 0);
		if (first !== undefined) {
			expect(buffer.readu8(b, 4)).toBeGreaterThan(0);
			expect(buffer.readf32(b, 8 + 16)).toBeCloseTo(first.hp);
		}
	});
});

describe("rollback probe device, case, stats, facts (R3 / R3a)", () => {
	const base: RollbackDeviceFacts = {
		tenFoot: false,
		touch: false,
		keyboard: true,
		gamepad: false,
		viewportX: 1920,
		viewportY: 1080,
	};

	it("classes devices by the plan's rules", () => {
		expect(rollbackDeviceClass(base)).toBe("pc");
		expect(rollbackDeviceClass({ ...base, tenFoot: true })).toBe("console");
		const touch = { ...base, touch: true, keyboard: false };
		expect(rollbackDeviceClass({ ...touch, viewportX: 844, viewportY: 390 })).toBe("phone");
		expect(rollbackDeviceClass({ ...touch, viewportX: 1180, viewportY: 820 })).toBe("tablet");
		expect(rollbackDeviceClass({ ...touch, gamepad: true, viewportX: 844, viewportY: 390 })).toBe("pc");
		expect(rollbackDeviceClass({ ...base, touch: true, viewportX: 844, viewportY: 390 })).toBe("pc");
		expect(ROLLBACK_SPIKE.probe.tabletMinShortSidePx).toBe(600);
	});

	it("labels the device with the tester's tag, cut to the reader's limit", () => {
		expect(rollbackDeviceLabel(base, undefined)).toBe("kb 1920x1080");
		expect(rollbackDeviceLabel({ ...base, touch: true, keyboard: false }, " Pixel 6a\n")).toBe(
			"touch 1920x1080 Pixel 6a",
		);
		const long = rollbackDeviceLabel(base, string.rep("x", 100));
		expect(long.size()).toBe(ROLLBACK_PROBE_LIMITS.maxDeviceLabelChars);
		// A cut never splits a UTF-8 character (the server's reader refuses invalid UTF-8): e-acute is 2 bytes, so 13
		// bytes of label + 18 of them leave the cut at a character's start, one byte short of the limit.
		const eAcute = string.char(0xc3, 0xa9);
		const accents = rollbackDeviceLabel(base, string.rep(eAcute, 18));
		expect(typeIs(utf8.len(accents)[0], "number")).toBe(true);
		expect(accents.size()).toBe(ROLLBACK_PROBE_LIMITS.maxDeviceLabelChars - 1);
		expect(utf8Truncate(`ab${eAcute}`, 3)).toBe("ab");
		expect(utf8Truncate(`ab${eAcute}`, 4)).toBe(`ab${eAcute}`);
		// A tag that is not UTF-8 keeps its ASCII.
		expect(rollbackDeviceLabel(base, `Pixel${string.char(255)} 6a`)).toBe("kb 1920x1080 Pixel 6a");
	});

	it("reads the case from the state", () => {
		const setup = buildEndlessRunConfig(4242, 1);
		const state = createSimState(4242, setup.spawn!.x, setup.spawn!.z, setup.config);
		expect(rollbackProbeCase(state)).toBe("walk");
		const rooms = state.score!.rooms;
		expect(rooms.size()).toBeGreaterThan(1);
		const r0 = rooms[0] as { engageTick: number; cleared: number };
		const r1 = rooms[1] as { engageTick: number; cleared: number };
		r0.engageTick = 1;
		r0.cleared = 0;
		expect(rollbackProbeCase(state)).toBe("room");
		r1.engageTick = 1;
		r1.cleared = 0;
		expect(rollbackProbeCase(state)).toBe("floor");
	});

	it("computes p50 / p95 / max by nearest rank", () => {
		const w = new WindowSamples();
		expect(w.stat()).toEqual({ p50: 0, p95: 0, max: 0 });
		for (let i = 1; i <= 100; i++) w.add(i / 1000);
		const s = w.stat(1000);
		expect(s.p50).toBeCloseTo(50);
		expect(s.p95).toBeCloseTo(95);
		expect(s.max).toBeCloseTo(100);
		expect(w.count()).toBe(100);
	});

	it("facts probes: a copied table and buffer read as copied, a shared one as shared", () => {
		const t = factsTableProbe();
		const seen = readTableProbe(t); // in place: as if the message were shared
		expect(seen).toEqual({ arrived: true, nested: true, aliasKept: true, metaKept: true, list: true });
		expect(tableAfter(t)).toBe("shared (the worker's write shows here)");
		expect(tableAfter(factsTableProbe())).toBe("copied");
		const b = factsBufferProbe();
		expect(readBufferProbe(b)).toBe("a buffer, content intact");
		expect(bufferAfter(b)).toBe("shared (the worker's write shows here)");
		expect(bufferAfter(factsBufferProbe())).toBe("copied");
		expect(readBufferProbe("x")).toBe("not a buffer (string)");
	});
});
