// The rollback spike's shared contract (docs/ROLLBACK_SPIKE.md Design 5-7, R4): the probe / live readers accept what
// the client sends and refuse every malformed payload, keep no extra keys; the analytics events and log lines; the
// capture gate; and the capture codec: a recorded bot party run round-trips through tiny chunks and blocks, the
// server's recorder follows a releasing PartyRunLog, the decoded capture replays to the run's final hash, and a
// malformed meta / chunk is refused.
import type { CharacterId } from "shared/characters";
import { describe, expect, it } from "@rbxts/jest-globals";
import { PartyRunLog } from "shared/lockstep";
import { buildWorldSetup, ENDLESS_WORLD_KIND } from "shared/run";
import { recordPartyRun } from "shared/run/testing";
import { createSimState, hashState, stepParty, type InputFrame, type Recording } from "shared/sim";
import {
	ROLLBACK_ANALYTICS_EVENT,
	ROLLBACK_ANALYTICS_LIVE_METRICS,
	Base64Stream,
	RollbackCaptureRecorder,
	analyticsForLiveSummary,
	analyticsForProbeSummary,
	base64Decode,
	base64Encode,
	decodeCapture,
	describeLiveSummary,
	describeProbeSummary,
	encodeCapture,
	liveMetricPerMinute,
	readCaptureMeta,
	readLiveSummary,
	readProbeSummary,
	rollbackCaptureAllowed,
	rollbackCaptureChunkKey,
	rollbackCaptureMetaKey,
	rollbackHorizonBucket,
	rollbackHorizonLabel,
	rollbackModeHorizon,
	rollbackModeHorizonValues,
	rollbackProbeAllowed,
	rollbackProbeRowKey,
	type RollbackCaptureInfo,
	type RollbackCaptureSetup,
} from ".";

const SESSION = "0f8e2a6c-1d3b-4c5e-9a7f-112233445566";

function stat(p50: number, p95: number, max: number) {
	return { p50, p95, max };
}

function probe(): Record<string, unknown> {
	return {
		sessionId: SESSION,
		windowIndex: 3,
		mode: "parallel",
		horizon: 16,
		case: "room",
		partySize: 4,
		actors: 37,
		enemyBullets: 120,
		clone: stat(0.4, 0.8, 1.2),
		step: stat(2, 3.5, 6),
		send: stat(0.01, 0.02, 0.05),
		total: stat(2.5, 4.4, 7.3),
		digest: stat(0.5, 1.5, 4),
		framesPerPrediction: stat(1, 2, 3),
		live: stat(3, 5, 9),
		liveSamples: 580,
		samples: 590,
		windowSeconds: 10,
		renderFps: 59.8,
		frameMsP95: 18.1,
		gcKbPerSec: -40,
		native: true,
		deviceLabel: "touch 2400x1080 Pixel 6a",
		deviceClass: "phone",
	};
}

function live(): Record<string, unknown> {
	return {
		sessionId: SESSION,
		windowIndex: 1,
		strategy: "repeatLast",
		horizon: 16,
		partySize: 2,
		playerIndex: 1,
		seconds: 60,
		predictions: 3400,
		mainFrames: 3590,
		lead: { lMean: 11.5, lMax: 14, dMean: 3.2, dMax: 5 },
		rooms: {
			combat: { seconds: 40, counts: { enemyCorr050: 6, undoneKill: 1 } },
			walk: { seconds: 20, counts: { mateCorr100: 2 } },
		},
		deviceLabel: "keyboard 1920x1080",
		deviceClass: "pc",
	};
}

function withField(base: Record<string, unknown>, key: string, value: unknown): Record<string, unknown> {
	const out = { ...base };
	out[key] = value;
	return out;
}

describe("readProbeSummary", () => {
	it("accepts a well-formed window and keeps only the listed keys", () => {
		const raw = withField(probe(), "extra", "ignored");
		const s = readProbeSummary(raw);
		expect(s).never.toBe(undefined);
		expect(s?.horizon).toBe(16);
		expect(s?.case).toBe("room");
		expect(s?.total.p95).toBe(4.4);
		expect((s as unknown as Record<string, unknown>).extra).toBe(undefined);
	});

	it("refuses malformed windows", () => {
		const bad: Array<[string, unknown]> = [
			["sessionId", ""],
			["sessionId", "has space"],
			["sessionId", string.rep("a", 37)],
			["windowIndex", -1],
			["windowIndex", 1.5],
			["mode", "gpu"],
			["horizon", 0],
			["horizon", 65],
			["case", "lobby"],
			["partySize", 9],
			["actors", 0 / 0],
			["enemyBullets", -1],
			["clone", stat(2, 1, 3)],
			["step", stat(1, 2, 1e9)],
			["total", { p50: 1, p95: 2 }],
			["framesPerPrediction", stat(1, 2, 601)],
			["digest", undefined],
			["live", stat(3, 2, 1)],
			["liveSamples", -1],
			["renderFps", math.huge],
			["gcKbPerSec", -2e6],
			["native", 1],
			["deviceLabel", "tab\there"],
			["deviceLabel", `cut${string.char(195)}`],
			["deviceLabel", string.rep("x", 49)],
			["deviceClass", "fridge"],
		];
		for (const [key, value] of bad) expect(readProbeSummary(withField(probe(), key, value))).toBe(undefined);
		expect(readProbeSummary("not a table")).toBe(undefined);
		expect(readProbeSummary(undefined)).toBe(undefined);
	});

	it("becomes one RollbackCpu event and one log line", () => {
		const s = readProbeSummary(probe())!;
		const specs = analyticsForProbeSummary(s);
		expect(specs.size()).toBe(1);
		const e = specs[0];
		expect(e.kind === "custom" && e.name).toBe(ROLLBACK_ANALYTICS_EVENT.cpu);
		if (e.kind === "custom") {
			expect(e.value).toBe(4.4);
			expect(e.fields).toEqual({ field01: "phone", field02: "parallel16", field03: "room" });
		}
		const line = describeProbeSummary(s);
		expect(string.find(line, "parallel H16 room", 1, true)[0]).never.toBe(undefined);
		expect(string.find(line, "total 2.50/4.40/7.30", 1, true)[0]).never.toBe(undefined);
	});
});

describe("readLiveSummary", () => {
	it("accepts a well-formed window; per-minute rates over the window", () => {
		const s = readLiveSummary(withField(live(), "extra", 1));
		expect(s).never.toBe(undefined);
		if (s === undefined) return;
		expect((s as unknown as Record<string, unknown>).extra).toBe(undefined);
		expect(liveMetricPerMinute(s, "enemyCorr050")).toBe(6);
		expect(liveMetricPerMinute(s, "mateCorr100")).toBe(2);
		expect(liveMetricPerMinute(s, "phantomBullet")).toBe(0);
		const half = readLiveSummary(withField(live(), "seconds", 30))!;
		expect(liveMetricPerMinute(half, "enemyCorr050")).toBe(12);
		const line = describeLiveSummary(s);
		expect(string.find(line, "enemyCorr050=6.00", 1, true)[0]).never.toBe(undefined);
		expect(string.find(line, "combat 40s walk 20s", 1, true)[0]).never.toBe(undefined);
		expect(string.find(line, "pred 3400/3590 fr", 1, true)[0]).never.toBe(undefined);
	});

	it("refuses malformed windows", () => {
		const bad: Array<[string, unknown]> = [
			["strategy", "oracle"],
			["playerIndex", 2],
			["seconds", -1],
			["predictions", undefined],
			["mainFrames", 0.5],
			["lead", { lMean: 20, lMax: 14, dMean: 3, dMax: 5 }],
			["lead", { lMean: 1, lMax: 2, dMean: 1 }],
			["rooms", { lobby: { seconds: 1, counts: {} } }],
			["rooms", { combat: { seconds: 1, counts: { madeUp: 1 } } }],
			["rooms", { combat: { seconds: 1, counts: { undoneKill: 1.5 } } }],
			["rooms", { combat: { seconds: 1, counts: { undoneKill: -1 } } }],
			["rooms", { combat: { seconds: 1 } }],
			["rooms", "none"],
			["deviceClass", "toaster"],
		];
		for (const [key, value] of bad) expect(readLiveSummary(withField(live(), key, value))).toBe(undefined);
	});

	it("logs one RollbackProbe per gate metric, none for an empty window", () => {
		const s = readLiveSummary(live())!;
		const specs = analyticsForLiveSummary(s);
		expect(specs.size()).toBe(ROLLBACK_ANALYTICS_LIVE_METRICS.size());
		expect(ROLLBACK_ANALYTICS_LIVE_METRICS.size()).toBe(4);
		const values = new Map<string, number>();
		for (const e of specs) if (e.kind === "custom") values.set(e.fields?.field01 ?? "", e.value);
		expect(values.get("enemyCorr050")).toBe(6);
		expect(values.get("mateCorr100")).toBe(2);
		expect(values.get("phantomBullet")).toBe(0);
		for (const e of specs) {
			expect(e.kind === "custom" && e.name).toBe(ROLLBACK_ANALYTICS_EVENT.probe);
			if (e.kind === "custom") {
				expect(e.fields?.field02).toBe("pc");
				expect(e.fields?.field03).toBe("h16");
			}
		}
		expect(analyticsForLiveSummary(readLiveSummary(withField(live(), "seconds", 0))!).size()).toBe(0);
	});
});

describe("buckets, keys and the capture gate", () => {
	it("buckets H", () => {
		expect(rollbackHorizonBucket(1)).toBe("8");
		expect(rollbackHorizonBucket(8)).toBe("8");
		expect(rollbackHorizonBucket(9)).toBe("16");
		expect(rollbackHorizonBucket(33)).toBe("More");
		expect(rollbackModeHorizon("serial", 24)).toBe("serial24");
		expect(rollbackHorizonLabel(16)).toBe("h16");
		expect(rollbackModeHorizonValues().size()).toBe(10);
	});

	it("keys fit DataStore's 50 characters", () => {
		expect(rollbackProbeRowKey(SESSION, 99999)).toBe(`${SESSION}/99999`);
		expect(rollbackProbeRowKey(SESSION, 9999999).size() <= 50).toBe(true);
		const run = "{0f8e2a6c-1d3b-4c5e-9a7f-112233445566}";
		expect(rollbackCaptureMetaKey(run).size() <= 50).toBe(true);
		expect(rollbackCaptureChunkKey(run, 63)).toBe(`${run}/63`);
	});

	it("captures in Studio, all-developer parties and a developer's private server only", () => {
		const policy = { enabled: true, allowedUserIds: [11, 12], allowPlaceCreator: true };
		const base = {
			studio: false,
			memberIds: [11, 12],
			privateServerOwnerId: 0,
			creatorId: 99,
			creatorIsUser: true,
		};
		expect(rollbackCaptureAllowed(base, policy)).toBe(true);
		expect(rollbackCaptureAllowed({ ...base, memberIds: [11, 50] }, policy)).toBe(false);
		expect(rollbackCaptureAllowed({ ...base, memberIds: [99, 12] }, policy)).toBe(true);
		expect(rollbackCaptureAllowed({ ...base, memberIds: [50, 51], privateServerOwnerId: 11 }, policy)).toBe(true);
		expect(rollbackCaptureAllowed({ ...base, memberIds: [50, 51], privateServerOwnerId: 50 }, policy)).toBe(false);
		expect(rollbackCaptureAllowed({ ...base, memberIds: [50], studio: true }, policy)).toBe(true);
		expect(rollbackCaptureAllowed(base, { ...policy, enabled: false })).toBe(false);
		// The same rule per player for the probe intake (and the client's KV_RollbackAllowed attribute).
		const one = { studio: false, userId: 11, privateServerOwnerId: 0, creatorId: 99, creatorIsUser: true };
		expect(rollbackProbeAllowed(one, policy)).toBe(true);
		expect(rollbackProbeAllowed({ ...one, userId: 99 }, policy)).toBe(true);
		expect(rollbackProbeAllowed({ ...one, userId: 50 }, policy)).toBe(false);
		expect(rollbackProbeAllowed({ ...one, userId: 50, privateServerOwnerId: 12 }, policy)).toBe(true);
		expect(rollbackProbeAllowed({ ...one, userId: 50, studio: true }, policy)).toBe(true);
		expect(rollbackProbeAllowed(one, { ...policy, enabled: false })).toBe(false);
	});
});

describe("base64", () => {
	it("round-trips every tail length and refuses bad text", () => {
		for (let n = 0; n <= 7; n++) {
			const b = buffer.create(n);
			for (let i = 0; i < n; i++) buffer.writeu8(b, i, (i * 97 + 13) % 256);
			const text = base64Encode(b);
			const back = base64Decode(text);
			expect(back !== undefined && buffer.tostring(back)).toBe(buffer.tostring(b));
		}
		expect(base64Encode(buffer.fromstring("Man"))).toBe("TWFu");
		expect(base64Encode(buffer.fromstring("Ma"))).toBe("TWE=");
		expect(base64Encode(buffer.fromstring("M"))).toBe("TQ==");
		for (const bad of ["TWF", "TW=u", "T===", "TWE!", "TWF=", "TR=="]) expect(base64Decode(bad)).toBe(undefined);
	});

	it("a Base64Stream fed in pieces gives the text of the joined bytes", () => {
		const total = 40;
		const all = buffer.create(total);
		for (let i = 0; i < total; i++) buffer.writeu8(all, i, (i * 53 + 7) % 256);
		for (const sizes of [[40], [1, 1, 1, 37], [2, 5, 0, 7, 26], [3, 3, 34], [13, 14, 13]]) {
			const stream = new Base64Stream();
			let at = 0;
			for (const n of sizes) {
				const piece = buffer.create(n);
				buffer.copy(piece, 0, all, at, n);
				stream.push(piece);
				at += n;
				const sofar = buffer.create(at);
				buffer.copy(sofar, 0, all, 0, at);
				expect(stream.text()).toBe(base64Encode(sofar));
				expect(stream.length()).toBe(base64Encode(sofar).size());
			}
		}
	});
});

function sameStreams(a: Readonly<Recording>, b: Readonly<Recording>): boolean {
	const streams = (r: Readonly<Recording>) => [r.frames, ...(r.others ?? [])];
	const sa = streams(a);
	const sb = streams(b);
	if (sa.size() !== sb.size() || a.seed !== b.seed || a.spawn.x !== b.spawn.x || a.spawn.z !== b.spawn.z) {
		return false;
	}
	for (let i = 0; i < sa.size(); i++) {
		if (sa[i].size() !== sb[i].size()) return false;
		for (let t = 0; t < sa[i].size(); t++) {
			const x = sa[i][t];
			const y = sb[i][t];
			if (x.moveX !== y.moveX || x.moveZ !== y.moveZ || x.aimX !== y.aimX) return false;
			if (x.aimZ !== y.aimZ || x.buttons !== y.buttons) return false;
		}
	}
	return true;
}

describe("capture codec", () => {
	const N = 3;
	// docs/ARCHER.md AR5: a mixed party, so the setup must carry the characters for the replay to match.
	const CHARS: ReadonlyArray<CharacterId> = ["archer", "knight", "knight"];
	const run = recordPartyRun(4242, N, { walkTicks: 900, boss: false, characters: CHARS });
	const rec = run.recording;
	const T = rec.frames.size();
	const setup: RollbackCaptureSetup = {
		worldKind: ENDLESS_WORLD_KIND,
		seed: run.seed,
		partySize: N,
		atBossDoor: false,
		debug: true,
		ruleset: 13,
		placeVersion: 0,
		characters: CHARS,
	};
	const info: RollbackCaptureInfo = {
		runId: "{run-1}",
		capturedAt: 1767225600,
		end: {
			status: "submitted",
			ok: true,
			verifiedTicks: T,
			serverHash: run.finalHash,
			leftFromTick: [-1, -1, -1],
		},
	};
	const TINY_CHUNK = 64;
	const SMALL_BLOCK = 97;

	it("round-trips a bot party run through tiny chunks and blocks, and replays to its final hash", () => {
		const cap = encodeCapture(setup, rec, info, TINY_CHUNK, SMALL_BLOCK);
		print(
			`[rollbackCapture] ${N} players ${T} ticks: ${cap.meta.bytes} bytes (${string.format(
				"%.2f",
				cap.meta.bytes / T,
			)} per tick), ${cap.meta.blockTicks.size()} blocks, ${cap.chunks.size()} chunks of ${TINY_CHUNK}`,
		);
		expect(cap.chunks.size() > 10).toBe(true);
		for (const c of cap.chunks) expect(c.size() <= TINY_CHUNK).toBe(true);
		expect(cap.meta.blockTicks.size()).toBe(math.ceil(T / SMALL_BLOCK));
		const back = decodeCapture(cap.meta, cap.chunks);
		expect(back).never.toBe(undefined);
		if (back === undefined) return;
		expect(sameStreams(back.recording, rec)).toBe(true);
		expect(back.setup).toEqual(setup);
		expect(back.info.end?.serverHash).toBe(run.finalHash);

		// The harness's replay: the world rebuilt from the setup, every merged frame stepped.
		const world = buildWorldSetup(back.setup.worldKind as typeof ENDLESS_WORLD_KIND, back.setup.seed, {
			atBossDoor: back.setup.atBossDoor,
			partySize: back.setup.partySize,
			characters: back.setup.characters,
		});
		const r = back.recording;
		const state = createSimState(r.seed, r.spawn.x, r.spawn.z, world.config);
		const merged: InputFrame[] = [];
		for (let t = 0; t < r.frames.size(); t++) {
			merged.clear();
			merged.push(r.frames[t]);
			for (const o of r.others!) merged.push(o[t]);
			stepParty(state, merged, world.config);
		}
		expect(hashState(state)).toBe(run.finalHash);
	});

	it("carries the members' characters (docs/ARCHER.md AR5) and refuses unknown ones", () => {
		const withChars: RollbackCaptureSetup = { ...setup, characters: ["archer", "archer", "knight"] };
		const cap = encodeCapture(withChars, rec, info);
		expect(decodeCapture(cap.meta, cap.chunks)?.setup).toEqual(withChars);
		const bad = encodeCapture({ ...setup, characters: ["wizard"] } as unknown as RollbackCaptureSetup, rec, info);
		expect(decodeCapture(bad.meta, bad.chunks)).toBe(undefined);
	});

	it("survives a round trip through plain data (what the DataStore and the receiver keep)", () => {
		const cap = encodeCapture(setup, rec, info);
		expect(cap.chunks.size()).toBe(1);
		const meta = readCaptureMeta(cap.meta);
		expect(meta).toEqual(cap.meta);
		expect(decodeCapture({ ...cap.meta }, [...cap.chunks])).never.toBe(undefined);
	});

	it("refuses a malformed meta or chunk", () => {
		const cap = encodeCapture(setup, rec, info, TINY_CHUNK, SMALL_BLOCK);
		const meta = cap.meta as unknown as Record<string, unknown>;
		const chunks = cap.chunks;
		const metaWith = (key: string, value: unknown) => withField(meta, key, value);
		expect(decodeCapture(metaWith("v", 2), chunks)).toBe(undefined);
		expect(decodeCapture(metaWith("chunks", chunks.size() + 1), chunks)).toBe(undefined);
		expect(decodeCapture(metaWith("ticks", T + 1), chunks)).toBe(undefined);
		expect(decodeCapture(metaWith("players", 2), chunks)).toBe(undefined);
		expect(decodeCapture(metaWith("encoding", "hex"), chunks)).toBe(undefined);
		expect(decodeCapture(metaWith("setup", { ...setup, seed: setup.seed + 1 }), chunks)).toBe(undefined);
		expect(decodeCapture(metaWith("setup", { ...setup, worldKind: "" }), chunks)).toBe(undefined);
		expect(decodeCapture(metaWith("info", { ...info, runId: "../etc" }), chunks)).toBe(undefined);
		const shifted = [...cap.meta.blockTicks];
		shifted[0] += 1;
		shifted[1] -= 1;
		expect(decodeCapture(metaWith("blockTicks", shifted), chunks)).toBe(undefined);
		expect(decodeCapture(meta, "not a list")).toBe(undefined);
		const dropped = [...chunks];
		dropped.remove(3);
		expect(decodeCapture(meta, dropped)).toBe(undefined);
		const flipped = [...chunks];
		flipped[2] = `!${flipped[2].sub(2)}`;
		expect(decodeCapture(meta, flipped)).toBe(undefined);
		const cut = [...chunks];
		cut[cut.size() - 1] = cut[cut.size() - 1].sub(1, 4);
		expect(decodeCapture(meta, cut)).toBe(undefined);
		const shuffled = [...chunks];
		shuffled[0] = chunks[1];
		shuffled[1] = chunks[0];
		expect(decodeCapture(meta, shuffled)).toBe(undefined);
		expect(decodeCapture(undefined, chunks)).toBe(undefined);
	});

	it("the server's recorder follows a releasing PartyRunLog and equals encodeCapture's capture", () => {
		const log = new PartyRunLog(rec.seed, rec.spawn, N);
		const recorder = new RollbackCaptureRecorder(log, SMALL_BLOCK);
		const STEP = 7;
		const SEGMENT = 360;
		let t = 0;
		let steps = 0;
		let queuedSeen = 0;
		while (t < T) {
			// One lockstep step: a few ticks finalized, then a segment's ticks released (never this step's own).
			const before = log.ticks();
			const last = math.min(T, t + STEP) - 1;
			for (let k = t; k <= last; k++) {
				const merged: InputFrame[] = [rec.frames[k]];
				for (const o of rec.others!) merged.push(o[k]);
				log.append(merged);
			}
			t = last + 1;
			const stop = math.floor(before / SEGMENT) * SEGMENT;
			log.releaseBefore(stop);
			recorder.pull();
			// pull never encodes: finished blocks wait for encodePending (the server's own thread, one at a time),
			// here every 20th step, so some are still queued at the end.
			queuedSeen = math.max(queuedSeen, recorder.queuedBlocks());
			steps++;
			if (steps % 20 === 0) recorder.encodePending(1);
		}
		expect(recorder.getProblem()).toBe(undefined);
		expect(recorder.ticks()).toBe(T);
		expect(queuedSeen).toBeGreaterThan(1);
		const queued = recorder.queuedBlocks();
		expect(queued).toBeGreaterThan(0);
		let pauses = 0;
		const cap = recorder.finish(setup, info, TINY_CHUNK, () => pauses++);
		// A pause between the blocks finish encodes (the queued ones and the open one) and between chunks.
		const encodedAtFinish = queued + (T % SMALL_BLOCK > 0 ? 1 : 0);
		expect(pauses).toBe(encodedAtFinish - 1 + (cap !== undefined ? cap.chunks.size() - 1 : 0));
		expect(cap).never.toBe(undefined);
		if (cap === undefined) return;
		const direct = encodeCapture(setup, rec, info, TINY_CHUNK, SMALL_BLOCK);
		expect(cap.chunks).toEqual(direct.chunks);
		expect(cap.meta).toEqual(direct.meta);
		const back = decodeCapture(cap.meta, cap.chunks);
		expect(back !== undefined && sameStreams(back.recording, rec)).toBe(true);
	});

	it("the recorder stops (never throws) on ticks released before it read them, and truncates at maxTicks", () => {
		const log = new PartyRunLog(rec.seed, rec.spawn, N);
		const recorder = new RollbackCaptureRecorder(log, SMALL_BLOCK);
		for (let k = 0; k < 200; k++) {
			const merged: InputFrame[] = [rec.frames[k]];
			for (const o of rec.others!) merged.push(o[k]);
			log.append(merged);
		}
		log.releaseBefore(100);
		recorder.pull();
		expect(recorder.getProblem()).never.toBe(undefined);
		expect(recorder.finish(setup, info)).toBe(undefined);

		const log2 = new PartyRunLog(rec.seed, rec.spawn, N);
		const capped = new RollbackCaptureRecorder(log2, SMALL_BLOCK, 150);
		for (let k = 0; k < 200; k++) {
			const merged: InputFrame[] = [rec.frames[k]];
			for (const o of rec.others!) merged.push(o[k]);
			log2.append(merged);
		}
		capped.pull();
		const cap = capped.finish(setup, info);
		expect(cap?.meta.ticks).toBe(150);
		expect(cap?.meta.info.problem).toBe("truncated at 150 ticks");
		expect(cap !== undefined && decodeCapture(cap.meta, cap.chunks)?.recording.frames.size()).toBe(150);
	});
});
