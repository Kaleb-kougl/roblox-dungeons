// Run sessions (M3): the server picks the seed, a runId is only good for its owner, one open session per player,
// restarts replace it, sessions expire, and the world registry builds the world (a new world is one registration).
import { describe, expect, it } from "@rbxts/jest-globals";
import runPlayerDungeon from "shared/fixtures-generated/run-player-dungeon-1337";
import { deserializeRecording, encodeRecording } from "shared/sim";
import {
	DEFAULT_RUN_SESSION_LIMITS,
	RunSessionRegistry,
	buildEndlessRunConfig,
	buildRunConfig,
	buildWorldSetup,
	isRunWorldKind,
	registerRunWorld,
	resolveParty,
	runWorldKinds,
	type RunSession,
	type StartContext,
	type StartRunRequest,
} from "shared/run";

const OWNER = 101;
const FRIEND = 202;
const STRANGER = 303;
/** A session clock past every run's length. */
const LATE = 1e9;

/** Picks the seeds in order (default: always 1337, the floor of run-player-dungeon-1337). */
function registry(seeds: number[] = [1337]) {
	let picked = 0;
	let ids = 0;
	return new RunSessionRegistry({
		newRunId: () => `run-${++ids}`,
		pickSeed: () => seeds[picked++ % seeds.size()],
	});
}

function ctx(now = 0, overrides: Partial<StartContext> = {}): StartContext {
	return {
		now,
		isInServer: (id) => id === OWNER || id === FRIEND,
		allowBossDoorSpawn: false,
		allowDebugInput: false,
		...overrides,
	};
}

/** The cheapest real world (the floor without enemies). */
const REQUEST: StartRunRequest = { requestId: 1, worldKind: "dungeonNoEncounter" };

describe("world registry", () => {
	it("has the built-in worlds, building exactly what buildRunConfig builds", () => {
		const kinds = runWorldKinds();
		expect([kinds[0], kinds[1], kinds[2], kinds[3]]).toEqual(["game", "dungeonNoEncounter", "greybox", "endless"]);
		expect(isRunWorldKind("game")).toBe(true);
		expect(isRunWorldKind("endless")).toBe(true);
		expect(isRunWorldKind("nowhere")).toBe(false);
		const endless = buildWorldSetup("endless", 1337, { atBossDoor: true }); // no boss door in endless
		expect(endless.spawn).toEqual(buildEndlessRunConfig(1337).spawn);
		expect(endless.config.scoring).never.toBe(undefined);
		expect(endless.endlessFloor).never.toBe(undefined);
		const a = buildWorldSetup("dungeonNoEncounter", 1337, { atBossDoor: false });
		const b = buildRunConfig(1337, { world: "dungeonNoEncounter" });
		expect(a.spawn).toEqual(b.spawn);
		expect(a.dungeon).toBe(b.dungeon);
		expect(a.config.encounter).toBe(undefined);
		expect(buildWorldSetup("greybox", 5, { atBossDoor: false }).spawn).toBe(undefined);
	});

	it("adds a world with one registration", () => {
		registerRunWorld("test.world", (seed, o) =>
			buildRunConfig(seed, { atBossDoor: o.atBossDoor, world: "greybox" }),
		);
		expect(isRunWorldKind("test.world")).toBe(true);
		const r = registry().start(OWNER, { requestId: 3, worldKind: "test.world" }, ctx());
		expect(r.ok).toBe(true);
	});
});

describe("RunSessionRegistry", () => {
	it("starts a session with a SERVER-picked seed and a fresh runId; the request cannot choose the seed", () => {
		const reg = registry([4242]);
		const r = reg.start(OWNER, { ...REQUEST, seed: 1 } as unknown as StartRunRequest, ctx(10));
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		const s = r.session;
		expect([s.runId, s.seed, s.worldKind, s.ownerId, s.createdAt]).toEqual([
			"run-1",
			4242,
			"dungeonNoEncounter",
			OWNER,
			10,
		]);
		expect(s.members).toEqual([OWNER]);
		expect(s.debug).toBe(false);
		expect(s.validator.seed).toBe(4242);
		expect(s.validator.getSpawn()).toEqual(s.setup.spawn);
		expect(reg.get("run-1", OWNER)).toBe(s);
		expect(reg.get("run-1", FRIEND)).toBe(undefined); // only the owner may use it
		expect(reg.get("nope", OWNER)).toBe(undefined);
	});

	it("refuses bad requests, unknown worlds, debug spawns and bad parties with their codes", () => {
		const reg = registry();
		const code = (req: unknown, c: StartContext = ctx()) => {
			const r = reg.start(OWNER, req as StartRunRequest, c);
			return r.ok ? "ok" : r.code;
		};
		expect(code("x")).toBe("bad_request");
		expect(code({ requestId: 1, worldKind: "" })).toBe("bad_request");
		expect(code({ requestId: 1, worldKind: "game", classId: string.rep("a", 100) })).toBe("bad_request");
		expect(code({ requestId: 1, worldKind: "nowhere" })).toBe("unknown_world");
		// The tutorial world is registered (the client builds it) but played locally only: never a server session.
		expect(code({ requestId: 1, worldKind: "tutorial" })).toBe("unknown_world");
		expect(reg.size()).toBe(0);
		expect(code({ ...REQUEST, atBossDoor: true })).toBe("debug_spawn");
		expect(code({ ...REQUEST, atBossDoor: true }, ctx(0, { allowBossDoorSpawn: true }))).toBe("ok");
		expect(code({ ...REQUEST, party: [STRANGER] })).toBe("bad_party");
		expect(code({ ...REQUEST, party: [0.5] })).toBe("bad_party");
		// A party needs every member's consent (an accepted invite): a client's startRun cannot name one.
		expect(code({ ...REQUEST, party: [FRIEND] })).toBe("bad_party");
		expect(code({ ...REQUEST, party: [FRIEND] }, ctx(0, { partyConsent: [FRIEND, OWNER] }))).toBe("bad_party");
		expect(code({ ...REQUEST, party: [FRIEND] }, ctx(0, { partyConsent: [OWNER, FRIEND] }))).toBe("ok");
	});

	it("builds a party: owner first, deduplicated, members in this server, at most 8", () => {
		const here = () => true;
		expect(resolveParty(OWNER, undefined, here, 8)).toEqual([OWNER]);
		expect(resolveParty(OWNER, [FRIEND, OWNER, FRIEND, STRANGER], here, 8)).toEqual([OWNER, FRIEND, STRANGER]);
		expect(resolveParty(OWNER, [1, 2, 3, 4, 5, 6, 7], here, 8)).toEqual([OWNER, 1, 2, 3, 4, 5, 6, 7]);
		expect(typeIs(resolveParty(OWNER, [1, 2, 3, 4, 5, 6, 7, 8], here, 8), "string")).toBe(true);
		expect(
			typeIs(
				resolveParty(OWNER, [FRIEND], (id) => id !== FRIEND, 8),
				"string",
			),
		).toBe(true);
		const reg = registry();
		const r = reg.start(OWNER, { ...REQUEST, party: [FRIEND] }, ctx(0, { partyConsent: [OWNER, FRIEND] }));
		expect(r.ok && r.session.members).toEqual([OWNER, FRIEND]);
	});

	it("members of an unconcluded party run are busy (the owner's restart included) until it is decided or they leave", () => {
		const reg = registry();
		const party = reg.start(OWNER, { ...REQUEST, party: [FRIEND] }, ctx(0, { partyConsent: [OWNER, FRIEND] }));
		if (!party.ok) error("party start failed");
		const s = party.session;
		expect(reg.busyReason(FRIEND)).never.toBe(undefined);
		expect(reg.busyReason(STRANGER)).toBe(undefined);
		// The owner restarting while the party run is still being played or decided: busy, the run is NOT replaced.
		const restart = reg.start(OWNER, REQUEST, ctx());
		expect(restart.ok ? "ok" : restart.code).toBe("busy");
		expect(s.validator.getStatus()).toBe("open");
		expect(reg.openSession(OWNER)).toBe(s);
		// A member's own solo start: busy too.
		const solo = reg.start(FRIEND, REQUEST, ctx());
		expect(solo.ok ? "ok" : solo.code).toBe("busy");
		// A member who left the run (left the server / stalled) is free again.
		reg.releaseMember(s, FRIEND);
		expect(reg.busyReason(FRIEND)).toBe(undefined);
		expect(reg.start(FRIEND, REQUEST, ctx()).ok).toBe(true);
		// Once the run is concluded (decided and removed), the owner may start again.
		reg.close(s, "desync", "test");
		expect(reg.busyReason(OWNER)).toBe(undefined);
		const again = reg.start(OWNER, REQUEST, ctx());
		expect(again.ok && again.replaced).toBe(undefined);
	});

	it("an owner who left their party run starts a solo run; the party run is detached, never concluded", () => {
		const reg = registry();
		const party = reg.start(OWNER, { ...REQUEST, party: [FRIEND] }, ctx(0, { partyConsent: [OWNER, FRIEND] }));
		if (!party.ok) error("party start failed");
		const s = party.session;
		// Leave run (lockstepLeave) -> lobby -> main menu -> Play solo.
		reg.releaseMember(s, OWNER);
		expect(reg.busyReason(OWNER)).toBe(undefined);
		const solo = reg.start(OWNER, REQUEST, ctx());
		expect(solo.ok).toBe(true);
		if (!solo.ok) return;
		expect(solo.replaced).toBe(undefined); // nothing for the service to conclude
		expect(s.validator.getStatus()).toBe("open");
		expect(s.validator.getResult()).toBe(undefined);
		expect(reg.get(s.runId, OWNER)).toBe(s); // still tracked: the lockstep session concludes it
		expect(reg.openSession(OWNER)).toBe(solo.session);
		// The others play on, still busy.
		expect(reg.busyReason(FRIEND)).never.toBe(undefined);
		// The owner's restart replaces the solo run, not the party run.
		const restart = reg.start(OWNER, REQUEST, ctx());
		if (!restart.ok) error("restart failed");
		expect(restart.replaced).toBe(solo.session);
		expect(s.validator.getStatus()).toBe("open");
		// The party run concluding later leaves the owner's open solo session alone.
		reg.markFinishing(s);
		reg.close(s, "desync", "test");
		expect(reg.openSession(OWNER)).toBe(restart.session);
		expect(reg.busyReason(FRIEND)).toBe(undefined);
		expect(reg.size()).toBe(1);
	});

	it("a member who left their party run starts a solo run; the party run and its owner are unaffected", () => {
		const reg = registry();
		const party = reg.start(OWNER, { ...REQUEST, party: [FRIEND] }, ctx(0, { partyConsent: [OWNER, FRIEND] }));
		if (!party.ok) error("party start failed");
		const s = party.session;
		reg.releaseMember(s, FRIEND);
		const solo = reg.start(FRIEND, REQUEST, ctx());
		if (!solo.ok) error("solo start failed");
		expect(solo.replaced).toBe(undefined);
		expect(s.validator.getStatus()).toBe("open");
		expect(reg.get(s.runId, OWNER)).toBe(s);
		expect(reg.openSession(OWNER)).toBe(s);
		expect(reg.busyReason(OWNER)).never.toBe(undefined);
		expect(reg.openSession(FRIEND)).toBe(solo.session);
		// The member restarts their solo run: still only their own session is replaced.
		const again = reg.start(FRIEND, REQUEST, ctx());
		expect(again.ok && again.replaced).toBe(solo.session);
		expect(s.validator.getStatus()).toBe("open");
	});

	it("a new start replaces the open session (aborted as abandoned); a finishing one is kept, up to `busy`", () => {
		const reg = registry();
		const a = reg.start(OWNER, REQUEST, ctx());
		const b = reg.start(OWNER, REQUEST, ctx());
		expect(a.ok && b.ok).toBe(true);
		if (!a.ok || !b.ok) return;
		expect(b.replaced).toBe(a.session);
		expect(a.session.validator.getResult()?.code).toBe("abandoned");
		expect(reg.get(a.session.runId, OWNER)).toBe(undefined);
		expect(reg.openSession(OWNER)).toBe(b.session);
		// Sessions whose final arrived while their last segment still waits to replay, until the cap answers busy.
		const finishing = (s: RunSession) => {
			const recording = deserializeRecording(runPlayerDungeon.recording);
			const offer = s.validator.offer(
				{
					runId: s.runId,
					index: 0,
					startTick: 0,
					recording: encodeRecording(recording),
					claimedEndHash: runPlayerDungeon.finalHash,
					checkpointHashes: [],
				},
				LATE,
			);
			expect(offer.ok).toBe(true);
			const final = {
				runId: s.runId,
				finalTick: runPlayerDungeon.ticks,
				claimedHash: runPlayerDungeon.finalHash,
				claimed: {
					ticks: runPlayerDungeon.ticks,
					kills: 0,
					bossDefeated: false,
					died: false,
					score: 0,
					floor: 1,
				},
			};
			expect(s.validator.finish(final, LATE)).toBe(undefined);
			expect(s.validator.getStatus()).toBe("finishing");
			reg.markFinishing(s);
		};
		finishing(b.session);
		const c = reg.start(OWNER, REQUEST, ctx());
		expect(c.ok && c.replaced).toBe(undefined); // b was not open any more
		if (!c.ok) return;
		finishing(c.session);
		expect(reg.finishingCount(OWNER)).toBe(DEFAULT_RUN_SESSION_LIMITS.maxFinishingPerPlayer);
		const d = reg.start(OWNER, REQUEST, ctx());
		expect(d.ok ? "ok" : d.code).toBe("busy");
		expect(reg.start(FRIEND, REQUEST, ctx()).ok).toBe(true); // per player
	});

	it("a world that fails to build is `config_error`; a bad picked seed too", () => {
		registerRunWorld("test.broken", () => error("no floor today", 0));
		const r = registry().start(OWNER, { requestId: 1, worldKind: "test.broken" }, ctx());
		expect(r.ok ? "" : `${r.code}: ${r.reason}`).toBe("config_error: config error: no floor today");
		const bad = registry([-1]).start(OWNER, REQUEST, ctx());
		expect(bad.ok ? "" : bad.code).toBe("config_error");
	});

	it("debug input allowed marks the session debug and relaxes its segment limits", () => {
		const r = registry().start(OWNER, REQUEST, ctx(0, { allowDebugInput: true }));
		expect(r.ok && r.session.debug).toBe(true);
	});

	it("expires open sessions idle or too old; finishing ones never expire", () => {
		const reg = registry();
		const lim = DEFAULT_RUN_SESSION_LIMITS;
		const a = reg.start(OWNER, REQUEST, ctx(0));
		const b = reg.start(FRIEND, REQUEST, ctx(0));
		if (!a.ok || !b.ok) error("start failed");
		reg.touch(b.session, lim.idleSeconds);
		const first = reg.sweep(lim.idleSeconds + 1);
		expect(first.map((x) => [x.session.runId, x.result.code])).toEqual([[a.session.runId, "expired"]]);
		expect(reg.size()).toBe(1);
		// b keeps sending segments, but no session lives past maxAgeSeconds.
		reg.touch(b.session, lim.maxAgeSeconds);
		expect(reg.sweep(lim.maxAgeSeconds).size()).toBe(0);
		const old = reg.sweep(lim.maxAgeSeconds + 1);
		expect(old.map((x) => x.result.reason)).toEqual(["expired: run too old"]);
		expect(reg.size()).toBe(0);
	});

	it("drops the open session of a player who left", () => {
		const reg = registry();
		const a = reg.start(OWNER, REQUEST, ctx());
		if (!a.ok) error("start failed");
		expect(reg.dropOpen(OWNER)).toBe(a.session);
		expect(a.session.validator.getResult()?.code).toBe("abandoned");
		expect(reg.size()).toBe(0);
		expect(reg.dropOpen(OWNER)).toBe(undefined);
	});
});
