// Server-side run validation by replay (task 9): honest golden-fixture runs pass (submitted in the binary form the
// remote carries), every tamper case is rejected with its reason.
import { describe, expect, it } from "@rbxts/jest-globals";
import runBoss from "shared/fixtures-generated/run-boss-1337";
import runFull from "shared/fixtures-generated/run-full-1337";
import runPlayer from "shared/fixtures-generated/run-player";
import runPlayerDungeon from "shared/fixtures-generated/run-player-dungeon-1337";
import {
	BINARY_RECORDING_HEADER_BYTES,
	Button,
	DEFAULT_SIM_CONFIG,
	deserializeRecording,
	encodeRecording,
	hashState,
	runReplay,
	type InputFrame,
	type Recording,
} from "shared/sim";
import {
	DEFAULT_RUN_LIMITS,
	MAX_RECORDING_BYTES,
	MAX_REJECT_REASON_CHARS,
	MAX_RUN_TICKS,
	RECORDING_BYTES_PER_TICK_BUDGET,
	ReplayBudget,
	buildRunConfig,
	errorMessage,
	replayObserved,
	truncateReason,
	validateRun,
	type RunLimits,
	type RunSubmission,
} from "shared/run";

interface RunFixtureLike {
	readonly seed: number;
	readonly recording: string;
	readonly finalHash: string;
	readonly ticks: number;
	readonly archetypeIds: ReadonlyArray<string>;
	readonly totals: { readonly enemiesKilled: number; readonly bossDefeated: number; readonly playerDied: number };
}

/** run-player.json: greybox arena, and its schedule presses DEBUG_HIT (K) to take hits. Dev tooling limits. */
const GREYBOX_DEV: RunLimits = { ...DEFAULT_RUN_LIMITS, world: "greybox", allowDebugInput: true };
/** run-player-dungeon-1337.json: the real floor, no enemies, no debug input. Live limits otherwise. */
const DUNGEON: RunLimits = { ...DEFAULT_RUN_LIMITS, world: "dungeonNoEncounter" };

/** The fixture's JSON recording in the binary form a client sends. */
function binary(f: RunFixtureLike): buffer {
	return encodeRecording(deserializeRecording(f.recording));
}

function honest(f: RunFixtureLike): RunSubmission {
	return {
		seed: f.seed,
		atBossDoor: false,
		recording: binary(f),
		claimedHash: f.finalHash,
		claimed: {
			ticks: f.ticks,
			kills: f.totals.enemiesKilled,
			bossDefeated: f.totals.bossDefeated > 0,
			died: f.totals.playerDied > 0,
		},
	};
}

/** The fixture's recording with `edit` applied to its frames, re-encoded. */
function tampered(f: RunFixtureLike, edit: (frames: InputFrame[]) => void, seed?: number): buffer {
	const r = deserializeRecording(f.recording);
	edit(r.frames);
	return encodeRecording({ ...r, seed: seed ?? r.seed });
}

/** Raw bytes: a binary recording header followed by `rest`. */
function rawRecording(seed: number, rest: ReadonlyArray<number>, version = 1): buffer {
	const b = buffer.create(BINARY_RECORDING_HEADER_BYTES + rest.size());
	buffer.writeu8(b, 0, version);
	buffer.writeu32(b, 1, seed);
	buffer.writef64(b, 5, 0);
	buffer.writef64(b, 13, 0);
	for (let i = 0; i < rest.size(); i++) buffer.writeu8(b, BINARY_RECORDING_HEADER_BYTES + i, rest[i]);
	return b;
}

describe("validateRun: honest runs", () => {
	it("accepts run-player.json (greybox, debug input allowed) with the web build's final hash", () => {
		const v = validateRun(honest(runPlayer), GREYBOX_DEV);
		expect(v.reason).toBe(undefined);
		expect(v.ok).toBe(true);
		expect(v.serverHash).toBe("03c59442");
		expect(v.serverHash).toBe(runPlayer.finalHash);
		expect(v.summary).toEqual({ ticks: 996, kills: 0, bossDefeated: false, died: true });
	});

	it("accepts run-player-dungeon-1337.json on the seed-1337 floor under live limits (no debug input)", () => {
		const v = validateRun(honest(runPlayerDungeon), DUNGEON);
		expect(v.reason).toBe(undefined);
		expect(v.ok).toBe(true);
		expect(v.serverHash).toBe(runPlayerDungeon.finalHash);
		expect(v.summary).toEqual({ ticks: 600, kills: 0, bossDefeated: false, died: false });
	});

	it("re-encoding an untouched recording changes nothing", () => {
		expect(buffer.tostring(tampered(runPlayer, () => undefined))).toBe(buffer.tostring(binary(runPlayer)));
		expect(buffer.tostring(tampered(runPlayerDungeon, () => undefined))).toBe(
			buffer.tostring(binary(runPlayerDungeon)),
		);
	});

	it("replayObserved is runReplay (same final hash), observes every tick and calls the checkpoint hook", () => {
		const r = deserializeRecording(runPlayer.recording);
		let observed = 0;
		let checkpoints = 0;
		const s = replayObserved(r, DEFAULT_SIM_CONFIG, () => observed++, {
			checkpointEvery: 100,
			onCheckpoint: () => checkpoints++,
		});
		expect(hashState(s)).toBe(hashState(runReplay(r, DEFAULT_SIM_CONFIG)));
		expect(observed).toBe(996);
		expect(checkpoints).toBe(9);
		let every = 0;
		replayObserved(r, DEFAULT_SIM_CONFIG, undefined, { onCheckpoint: () => every++ });
		expect(every).toBe(996);
	});

	it("the checkpoint hook runs inside validateRun (after every tick by default)", () => {
		let checkpoints = 0;
		const v = validateRun(honest(runPlayerDungeon), DUNGEON, { hooks: { onCheckpoint: () => checkpoints++ } });
		expect(v.ok).toBe(true);
		expect(checkpoints).toBe(600);
	});

	it("ReplayBudget yields once the injected clock passed the budget since the last yield", () => {
		let clock = 0;
		const yieldedAt: number[] = [];
		// Whole-number clock units (think ms) keep the arithmetic exact.
		const budget = new ReplayBudget(
			4,
			() => clock,
			() => yieldedAt.push(clock),
		);
		for (let tick = 0; tick < 100; tick++) {
			clock += 1; // 1 unit of work per tick
			budget.checkpoint();
		}
		expect(budget.yields).toBe(25);
		expect([yieldedAt[0], yieldedAt[1], yieldedAt[24]]).toEqual([4, 8, 100]);
	});

	it("the validation result is the same with a yielding budget in the hook", () => {
		let clock = 0;
		const budget = new ReplayBudget(
			4,
			() => clock,
			() => undefined,
		);
		const v = validateRun(honest(runPlayerDungeon), DUNGEON, {
			hooks: {
				onCheckpoint: () => {
					clock += 1;
					budget.checkpoint();
				},
			},
		});
		expect(v.ok).toBe(true);
		expect(v.serverHash).toBe(runPlayerDungeon.finalHash);
		expect(budget.yields).toBe(150);
	});
});

describe("validateRun: tampered runs are rejected", () => {
	it("one frame's button bits flipped (SWAP toggled at tick 120) -> hash mismatch", () => {
		const s = honest(runPlayerDungeon);
		s.recording = tampered(runPlayerDungeon, (frames) => {
			frames[120] = { ...frames[120], buttons: bit32.bxor(frames[120].buttons, Button.SWAP) };
		});
		const v = validateRun(s, DUNGEON);
		expect(v.ok).toBe(false);
		expect(v.code).toBe("hash_mismatch");
		expect(v.reason).toBe(`hash mismatch: claimed ${runPlayerDungeon.finalHash}, replay ${v.serverHash}`);
	});

	it("an extra ROLL press mid-walk (tick 450) -> hash mismatch", () => {
		const s = honest(runPlayerDungeon);
		s.recording = tampered(runPlayerDungeon, (frames) => {
			frames[450] = { ...frames[450], buttons: bit32.bxor(frames[450].buttons, Button.ROLL) };
		});
		expect(validateRun(s, DUNGEON).code).toBe("hash_mismatch");
	});

	it("one frame's move axis nudged (tick 450, on the BFS walk) -> hash mismatch", () => {
		const s = honest(runPlayerDungeon);
		s.recording = tampered(runPlayerDungeon, (frames) => {
			const f = frames[450];
			frames[450] = { ...f, moveX: f.moveX > 0 ? f.moveX - 7 : f.moveX + 7 };
		});
		const v = validateRun(s, DUNGEON);
		expect(v.code).toBe("hash_mismatch");
	});

	it("one frame's buttons changed in the greybox run (ROLL at tick 200) -> hash mismatch", () => {
		const s = honest(runPlayer);
		s.recording = tampered(runPlayer, (frames) => {
			frames[200] = { ...frames[200], buttons: bit32.bxor(frames[200].buttons, Button.ROLL) };
		});
		const v = validateRun(s, GREYBOX_DEV);
		expect(v.code).toBe("hash_mismatch");
	});

	it("an edit the sim ignores (FLASK at full hearts, tick 200) replays to the same state: accepted", () => {
		// Replay validation checks that the claimed OUTCOME follows from the input, not that the input is the one the
		// player typed: a press with no effect (the only trace, prevButtons, is overwritten next tick) is the same run.
		const s = honest(runPlayer);
		s.recording = tampered(runPlayer, (frames) => {
			frames[200] = { ...frames[200], buttons: bit32.bxor(frames[200].buttons, Button.FLASK) };
		});
		expect(buffer.tostring(s.recording)).never.toBe(buffer.tostring(binary(runPlayer)));
		expect(validateRun(s, GREYBOX_DEV).ok).toBe(true);
	});

	it("a forged claimed hash -> hash mismatch; a non-hash string -> bad submission", () => {
		const s = honest(runPlayerDungeon);
		s.claimedHash = "deadbeef";
		expect(validateRun(s, DUNGEON).code).toBe("hash_mismatch");
		s.claimedHash = "not-hex!";
		const v = validateRun(s, DUNGEON);
		expect(v.code).toBe("bad_submission");
		expect(v.reason).toBe("bad submission: claimedHash must be 8 hex digits");
	});

	it("a lie in the claimed summary -> summary mismatch (the server's summary is reported)", () => {
		const s = honest(runPlayerDungeon);
		s.claimed = { ...s.claimed, kills: 5 };
		const v = validateRun(s, DUNGEON);
		expect(v.code).toBe("summary_mismatch");
		expect(v.reason).toBe("summary mismatch: kills claimed 5, replay 0");
		expect(v.summary.kills).toBe(0);
		const d = honest(runPlayerDungeon);
		d.claimed = { ...d.claimed, bossDefeated: true };
		expect(validateRun(d, DUNGEON).reason).toBe("summary mismatch: bossDefeated claimed true, replay false");
	});

	it("wrong seed: submission and recording disagree -> seed mismatch", () => {
		const s = honest(runPlayerDungeon);
		s.seed = 42;
		const v = validateRun(s, DUNGEON);
		expect(v.code).toBe("seed_mismatch");
		expect(v.reason).toBe("seed mismatch: submitted 42, recording 1337");
	});

	it("wrong seed everywhere (recording re-seeded to 42): the floor's spawn differs -> spawn mismatch", () => {
		const s = honest(runPlayerDungeon);
		s.seed = 42;
		s.recording = tampered(runPlayerDungeon, () => undefined, 42);
		const v = validateRun(s, DUNGEON);
		expect(v.code).toBe("spawn_mismatch");
	});

	it("wrong seed everywhere in the greybox (no spawn rule): the rng state differs -> hash mismatch", () => {
		const s = honest(runPlayer);
		s.seed = 7;
		s.recording = tampered(runPlayer, () => undefined, 7);
		const v = validateRun(s, GREYBOX_DEV);
		expect(v.code).toBe("hash_mismatch");
	});

	it("a moved spawn -> spawn mismatch (dungeon), out of the arena -> spawn mismatch (greybox)", () => {
		const r: Recording = deserializeRecording(runPlayerDungeon.recording);
		const s = honest(runPlayerDungeon);
		s.recording = encodeRecording({ ...r, spawn: { x: r.spawn.x + 1, z: r.spawn.z } });
		expect(validateRun(s, DUNGEON).reason).toBe("spawn mismatch: spawn (68, 35) is not the run's spawn (67, 35)");
		const g = deserializeRecording(runPlayer.recording);
		const t = honest(runPlayer);
		t.recording = encodeRecording({ ...g, spawn: { x: 100, z: 0 } });
		expect(validateRun(t, GREYBOX_DEV).reason).toBe("spawn mismatch: spawn (100, 0) is outside the arena");
	});

	it("oversize: more ticks than the limit -> too long; more bytes than the limit -> too large", () => {
		const s = honest(runPlayer);
		const short: RunLimits = { ...GREYBOX_DEV, maxTicks: 500 };
		const v = validateRun(s, short);
		expect(v.code).toBe("too_long");
		expect(v.reason).toBe("run too long: 996 ticks (max 500)");
		const tiny: RunLimits = { ...GREYBOX_DEV, maxRecordingBytes: 100 };
		expect(validateRun(s, tiny).reason).toBe(`recording too large: ${buffer.len(s.recording)} bytes (max 100)`);
	});

	it("the byte cap is the per-tick budget over the longest run, above the worst measured recording", () => {
		expect(MAX_RECORDING_BYTES).toBe(
			BINARY_RECORDING_HEADER_BYTES + MAX_RUN_TICKS * RECORDING_BYTES_PER_TICK_BUDGET,
		);
		expect(DEFAULT_RUN_LIMITS.maxRecordingBytes).toBe(MAX_RECORDING_BYTES);
		const boss = binary(runBoss as unknown as RunFixtureLike);
		expect(buffer.len(boss) / runBoss.ticks).toBeLessThan(RECORDING_BYTES_PER_TICK_BUDGET);
	});

	it("a run-length bomb (268 million frames in 30 bytes) is rejected before the frames are expanded", () => {
		const s = honest(runPlayer);
		// n = 2^28 - 1, then one run of the empty frame with an extended length covering it.
		s.recording = rawRecording(1337, [0xff, 0xff, 0xff, 0x7f, 0xe0, 0xf7, 0xff, 0xff, 0x7f]);
		const v = validateRun(s, GREYBOX_DEV);
		expect(v.code).toBe("too_long");
		expect(v.reason).toBe(`run too long: 268435455 ticks (max ${DEFAULT_RUN_LIMITS.maxTicks})`);
	});

	it("debug buttons in the recording -> debug input (run-player.json presses DEBUG_HIT)", () => {
		const v = validateRun(honest(runPlayer), { ...GREYBOX_DEV, allowDebugInput: false });
		expect(v.ok).toBe(false);
		expect(v.code).toBe("debug_input");
		expect(v.reason?.sub(1, 12)).toBe("debug input:");
		const s = honest(runPlayerDungeon);
		s.recording = tampered(runPlayerDungeon, (frames) => {
			frames[10] = { ...frames[10], buttons: bit32.bor(frames[10].buttons, Button.DEBUG_BOSS) };
		});
		expect(validateRun(s, DUNGEON).reason).toBe("debug input: debug button bits at tick 10");
	});

	it("a boss-door start -> debug spawn", () => {
		const s = honest(runPlayerDungeon);
		s.atBossDoor = true;
		expect(validateRun(s, DUNGEON).code).toBe("debug_spawn");
	});

	it("malformed recordings -> malformed, with the decoder's reason (recordingCodec.spec.ts has the full set)", () => {
		const s = honest(runPlayer);
		s.recording = buffer.fromstring("{");
		const a = validateRun(s, GREYBOX_DEV);
		expect(a.code).toBe("malformed");
		expect(a.reason).toBe("malformed recording: 1-byte header");
		s.recording = rawRecording(1337, [0], 3); // version 2 is the co-op party variant
		expect(validateRun(s, GREYBOX_DEV).reason).toBe("malformed recording: unsupported version 3");
		// One frame, moveX = 0 + 5000 (zigzag 10000 = 0x90 0x4e).
		s.recording = rawRecording(1337, [1, 1, 0x90, 0x4e]);
		expect(validateRun(s, GREYBOX_DEV).reason).toBe("malformed recording: axis out of range at frame 0");
	});

	it("the JSON form is not accepted over the wire (the server only takes the binary form)", () => {
		const s = honest(runPlayer) as unknown as { recording: unknown };
		s.recording = runPlayer.recording;
		const v = validateRun(s as unknown as RunSubmission, GREYBOX_DEV);
		expect(v.code).toBe("bad_submission");
		expect(v.reason).toBe("bad submission: recording must be a buffer");
	});

	it("reject reasons are cut to MAX_REJECT_REASON_CHARS", () => {
		expect(truncateReason("short")).toBe("short");
		const long = string.rep("x", 1000);
		const cut = truncateReason(long);
		expect(cut.size()).toBe(MAX_REJECT_REASON_CHARS);
		expect(cut.sub(-3)).toBe("...");
		expect(truncateReason(string.rep("y", MAX_REJECT_REASON_CHARS))).toBe(string.rep("y", MAX_REJECT_REASON_CHARS));
	});

	it("a submission of the wrong shape -> bad submission (never throws)", () => {
		const s = honest(runPlayer);
		s.seed = -1;
		expect(validateRun(s, GREYBOX_DEV).code).toBe("bad_submission");
		const t = honest(runPlayer);
		t.seed = 0 / 0;
		expect(validateRun(t, GREYBOX_DEV).code).toBe("bad_submission");
		const u = honest(runPlayer) as unknown as { claimed: unknown };
		u.claimed = undefined;
		expect(validateRun(u as unknown as RunSubmission, GREYBOX_DEV).code).toBe("bad_submission");
	});

	it("errorMessage strips Luau's file:line prefix", () => {
		const [, err] = pcall((): void => error("boom"));
		expect(errorMessage(err)).toBe("boom");
		expect(errorMessage("plain")).toBe("plain");
	});
});

describe("validateRun: the full game", () => {
	it("validating the full game never raises", () => {
		expect(() => validateRun(honest(runFull))).never.toThrow();
	});

	it("accepts run-boss-1337.json (boss door, J presses) under dev limits with the web build's final hash", () => {
		const s = honest(runBoss as unknown as RunFixtureLike);
		s.atBossDoor = true;
		const v = validateRun(s, { ...DEFAULT_RUN_LIMITS, allowDebugInput: true, allowBossDoorSpawn: true });
		expect(v.reason).toBe(undefined);
		expect(v.ok).toBe(true);
		expect(v.serverHash).toBe(runBoss.finalHash);
		expect(v.summary.ticks).toBe(runBoss.ticks);
		expect(validateRun(s).code).toBe("debug_input");
	});

	it("accepts run-full-1337.json under live limits with the web build's final hash", () => {
		const setup = buildRunConfig(runFull.seed);
		expect(setup.spawn).toEqual({ x: runFull.spawn.x, z: runFull.spawn.z });
		const v = validateRun(honest(runFull), DEFAULT_RUN_LIMITS, { archetypeNames: runFull.archetypeIds });
		expect(v.reason).toBe(undefined);
		expect(v.ok).toBe(true);
		expect(v.serverHash).toBe(runFull.finalHash);
		expect(v.summary).toEqual({ ticks: 3600, kills: 21, bossDefeated: false, died: true });
		const t = v.telemetry!;
		expect(t.deathTick).toBe(runFull.firstTick.playerDied + 1);
		expect(t.deathCause).toBe("boss.act1");
		expect(t.bossEngagedTick).toBe(runFull.firstTick.bossEngaged + 1);
		expect(t.hitsTaken).toBe(runFull.totals.playerHits);
		expect(t.heartsLostTotal).toBeGreaterThan(0);
	});
});
