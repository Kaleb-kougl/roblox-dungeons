/**
 * LockstepClient's read-only rollback spike accessors (docs/ROLLBACK_SPIKE.md R3 / R4b: queuedFrame,
 * lastSentInputTick, sentInput, pacingDepthTicks) and the probe's feed over them: a recorded bot party run arrives as
 * merged batches (one tick a frame, a small playout buffer), the client samples the recording's own frames, and the
 * feed reads the client before every pump, as RollbackSpikeController does. The accessors return what was queued and
 * sent, the client's state still replays the log exactly, and the worker core's mirror (fed only what the feed read)
 * matches the client's hash at every check, with the live model seeing the client's real lead.
 */
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	EMPTY_INPUT,
	createSimState,
	hashState,
	inputsEqual,
	partyFrameAt,
	stepRecorded,
	type InputFrame,
} from "shared/sim";
import type { CharacterId } from "shared/characters";
import { recordPartyRun } from "shared/run/testing";
import { DEFAULT_LOCKSTEP, LockstepClient, MergedEncoder, type LockstepTunables } from ".";
import {
	RollbackFeed,
	RollbackWorkerCore,
	lockstepFrameSource,
	readMainToWorker,
	readWorkerToMain,
	recordedFrame,
	type RollbackWorkerHost,
	type RollbackWorkerToMain,
} from "./rollbackSpike";

const SEED = 4242;
const PLAYERS = 2;
const LOCAL = 1;
const DT = 1 / 60;
/** Ticks the server is ahead of the client's next step (the playout buffer). */
const AHEAD = 1;
const FRAMES = 300;
const HASH_EVERY = 60;
/** docs/ARCHER.md: a mixed party (the mirror must carry the characters). */
const CHARS: ReadonlyArray<CharacterId> = ["archer", "knight"];

/** Unpaced, legacy lead (inputDelay): a steady, known lead. */
const TUNABLES: LockstepTunables = { ...DEFAULT_LOCKSTEP, pacing: undefined, lead: undefined };

describe("LockstepClient rollback spike accessors (R3 / R4b)", () => {
	it("read what is queued and sent, change nothing, and feed a mirror that matches", () => {
		const r = recordPartyRun(SEED, PLAYERS, { walkTicks: FRAMES, boss: false, characters: CHARS });
		const rec = r.recording;
		const config = r.setup.config;
		const client = new LockstepClient({
			runId: "spec",
			seed: SEED,
			spawn: r.setup.spawn!,
			config,
			players: PLAYERS,
			localIndex: LOCAL,
			tunables: TUNABLES,
		});
		const enc = new MergedEncoder(PLAYERS);
		const posts: RollbackWorkerToMain[] = [];
		const host: RollbackWorkerHost = {
			clock() {
				return os.clock();
			},
			frameIndex() {
				return 0;
			},
			gcKb() {
				return gcinfo();
			},
			post(m) {
				posts.push(readWorkerToMain(m)!);
			},
			sendDigest() {
				return 0;
			},
			yieldSlice() {},
			profileBegin() {},
			profileEnd() {},
		};
		const core = new RollbackWorkerCore(host);
		const setup = readMainToWorker(
			{
				kind: "setup",
				sessionId: "spec-accessors",
				mode: "parallel",
				horizon: 4,
				worldKind: "endless",
				seed: SEED,
				partySize: PLAYERS,
				localIndex: LOCAL,
				coop: true,
				atBossDoor: false,
				scoring: false,
				stress: 0,
				// docs/ARCHER.md AR5: the run's characters, as the main client sends them.
				characters: CHARS,
				live: true,
				strategy: "repeatLast",
				borrowed: false,
				deviceLabel: "spec",
				deviceClass: "pc",
				native: false,
			},
			undefined,
		)!;
		core.receive(setup);
		const feed = new RollbackFeed(PLAYERS, HASH_EVERY);
		const src = lockstepFrameSource(client);
		const plain = createSimState(rec.seed, rec.spawn.x, rec.spawn.z, config);
		const merged: Array<Readonly<InputFrame>> = [];
		let sentTicks = 0;
		let served = 0;
		const serve = (through: number) => {
			const batch: InputFrame[][] = [];
			while (served <= through && served < rec.frames.size()) {
				batch.push(partyFrameAt(rec, served, []).map((f) => ({ ...f })));
				served++;
			}
			if (batch.size() > 0) expect(client.receive(served - batch.size(), enc.encode(batch))).toBe(true);
		};
		const frames = math.min(FRAMES, rec.frames.size() - AHEAD - TUNABLES.maxInputLead - 1);
		for (let f = 0; f < frames; f++) {
			serve(client.state.tick + AHEAD);
			// The accessors, before the pump (what the feed reads).
			const T = client.state.tick;
			const backlog = client.backlog();
			for (let k = 0; k < backlog; k++) {
				const q = client.queuedFrame(k)!;
				partyFrameAt(rec, T + k, merged);
				for (let i = 0; i < PLAYERS; i++) expect(inputsEqual(q[i], merged[i])).toBe(true);
			}
			expect(client.queuedFrame(backlog)).toBeUndefined();
			expect(client.queuedFrame(-1)).toBeUndefined();
			expect(client.pacingDepthTicks()).toBe(0);
			for (let t = T; t <= math.min(client.lastSentInputTick(), rec.frames.size() - 1); t++) {
				const s = client.sentInput(t);
				if (s !== undefined) {
					expect(inputsEqual(s, recordedFrame(rec, LOCAL, t))).toBe(true);
					sentTicks++;
				}
			}
			const msg = feed.next(src, DT * 1000, () => hashState(client.state));
			if (typeIs(msg, "string")) error(msg, 0);
			core.receive(readMainToWorker(msg, core.partySize())!);
			core.pump();
			client.pump(DT, () => {
				const t = client.nextInputTick();
				return t < rec.frames.size() ? recordedFrame(rec, LOCAL, t) : EMPTY_INPUT;
			});
			expect(client.lastSentInputTick()).toBe(client.state.tick + client.netLead());
			while (plain.tick < client.state.tick) stepRecorded(plain, rec, plain.tick, config);
			expect(client.state.tick).toBe(plain.tick);
		}
		// The client still replays the log exactly (the reads changed nothing) and never mismatched its own inputs.
		expect(hashState(client.state)).toBe(hashState(plain));
		expect(client.mismatches).toBe(0);
		expect(sentTicks).toBeGreaterThan(0);
		let checks = 0;
		for (const p of posts) {
			if (p.kind === "error") error(p.message, 0);
			if (p.kind !== "mirrorHash") continue;
			expect(feed.checkMirrorHash(p.tick, p.hash).kind).toBe("ok");
			checks++;
		}
		expect(checks).toBeGreaterThanOrEqual(math.floor((frames - 1) / HASH_EVERY) - 1);
		// The live model saw the client's own frames past the merged ones: L = the lead's span beyond the buffer.
		const lead = core.liveModel()!.metrics.leadSeen();
		expect(lead.lMax).toBeGreaterThan(0);
		expect(lead.dMax).toBeGreaterThan(0);
		print(
			`[R3] accessors: ${frames} frames, ${checks} mirror hash checks equal, live L mean ${string.format(
				"%.2f",
				lead.lMean,
			)} max ${lead.lMax}, D mean ${string.format("%.2f", lead.dMean)} max ${lead.dMax}`,
		);
	});
});
