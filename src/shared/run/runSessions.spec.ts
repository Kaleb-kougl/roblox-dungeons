// Run sessions (M3): the server picks the seed, a runId is only good for its owner, one open session per player,
// restarts replace it, sessions expire, and the world registry builds the world (a new world is one registration).
import { describe, expect, it } from "@rbxts/jest-globals";
import runPlayerDungeon from "shared/fixtures-generated/run-player-dungeon-1337";
import {
	Button,
	DEBUG_FLOOR_BUTTON,
	EMPTY_INPUT,
	NEUTRAL_TRAITS,
	Recorder,
	SIM_DT,
	createSimState,
	deserializeRecording,
	encodeRecording,
	hashState,
	quantizeInput,
	stepParty,
	type InputFrame,
} from "shared/sim";
import { characterLoadout, characterTraits, type CharacterId } from "shared/characters";
import { bytesOfHex } from "shared/crypto";
import { DAILY, DAILY_WORLD_KIND, dailyDay, dailySeedFrom } from "shared/daily";
import { LOBBY, Lobbies } from "shared/lobby";
import { LiveRun } from "shared/play";
import {
	DEFAULT_RUN_SESSION_LIMITS,
	DEFAULT_SEGMENT_LIMITS,
	LIVE_RUN_LIMITS,
	RunSessionRegistry,
	sessionCharacters,
	validateRun,
	buildEndlessRunConfig,
	buildRunConfig,
	buildWorldSetup,
	isRunWorldKind,
	registerRunWorld,
	resolveParty,
	runWorldKinds,
	type RunSegment,
	type RunSession,
	type RunSetup,
	type SegmentedRunResult,
	type StartContext,
	type StartRunRequest,
} from "shared/run";

const OWNER = 101;
const FRIEND = 202;
const STRANGER = 303;
/** A session clock past every run's length. */
const LATE = 1e9;
/** 2026-10-31T00:00:00Z (Daily #304, day 303) and its noon: the wall clock (StartContext.unixNow) of most starts. */
const OCT_31 = 1793404800;
const OCT_31_NOON = OCT_31 + 43200;
/** The daily seed's test key (the real one is server-only, src/server/config/daily.ts). */
const TEST_KEY = bytesOfHex("000102030405060708090a0b0c0d0e0f");
const fakeDailySeed = (day: number) => dailySeedFrom(day, TEST_KEY);

/** Picks the seeds in order (default: always 1337, the floor of run-player-dungeon-1337); the Daily's from the fake. */
function registry(seeds: number[] = [1337]) {
	let picked = 0;
	let ids = 0;
	return new RunSessionRegistry({
		newRunId: () => `run-${++ids}`,
		pickSeed: () => seeds[picked++ % seeds.size()],
		dailySeed: fakeDailySeed,
	});
}

function ctx(now = 0, overrides: Partial<StartContext> = {}): StartContext {
	return {
		now,
		unixNow: OCT_31_NOON,
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
		expect(code({ requestId: 1, worldKind: "game", characterId: string.rep("a", 100) })).toBe("bad_request");
		expect(code({ requestId: 1, worldKind: "game", characterId: "ranger" })).toBe("bad_request");
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

	it("accepts Studio's negative test UserIds in a party and refuses 0, fractions and non-numbers", () => {
		const here = () => true;
		expect(resolveParty(-1, [-1, -2], here, 8)).toEqual([-1, -2]);
		expect(typeIs(resolveParty(-1, [0], here, 8), "string")).toBe(true);
		expect(typeIs(resolveParty(-1, [1.5], here, 8), "string")).toBe(true);
		expect(typeIs(resolveParty(-1, ["2" as unknown as number], here, 8), "string")).toBe(true);
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

describe("daily runs (docs/DAILY.md DS4)", () => {
	const DAILY_REQUEST: StartRunRequest = { requestId: 1, worldKind: DAILY_WORLD_KIND };

	function startDaily(reg: RunSessionRegistry, owner: number, c: StartContext): RunSession {
		const r = reg.start(owner, DAILY_REQUEST, c);
		if (!r.ok) error(`daily start refused: ${r.code} ${r.reason}`);
		return r.session;
	}

	it("two owners starting the Daily on the same day get the same seed; the next day another", () => {
		const reg = registry([4242]);
		const a = startDaily(reg, OWNER, ctx(0, { unixNow: OCT_31 + 60 }));
		const b = startDaily(reg, FRIEND, ctx(0, { unixNow: OCT_31 + 80000 }));
		expect(a.seed).toBe(fakeDailySeed(303));
		expect(b.seed).toBe(a.seed);
		expect(a.daily).toEqual({ day: 303, ruleset: DAILY.ruleset });
		expect(b.daily).toEqual({ day: 303, ruleset: DAILY.ruleset });
		expect(a.worldKind).toBe(DAILY_WORLD_KIND);
		const tomorrow = startDaily(reg, OWNER, ctx(0, { unixNow: OCT_31 + 86400 + 60 }));
		expect(tomorrow.daily?.day).toBe(304);
		expect(tomorrow.seed).toBe(fakeDailySeed(304));
		expect(tomorrow.seed).never.toBe(a.seed);
		expect(a.setup.spawn).toEqual(buildWorldSetup(DAILY_WORLD_KIND, a.seed, { atBossDoor: false }).spawn);
	});

	it("a run started at 23:59:59 UTC keeps its day; 00:00:00 is the next day", () => {
		const reg = registry();
		const late = startDaily(reg, OWNER, ctx(0, { unixNow: OCT_31 + 86399 }));
		const midnight = startDaily(reg, FRIEND, ctx(0, { unixNow: OCT_31 + 86400 }));
		expect([late.daily?.day, late.seed]).toEqual([303, fakeDailySeed(303)]);
		expect([midnight.daily?.day, midnight.seed]).toEqual([304, fakeDailySeed(304)]);
		expect(dailyDay(OCT_31 + 86399)).toBe(303);
		// Long after midnight the session still belongs to its start day (the board it will post to, DSD5).
		reg.touch(late, 3600);
		expect(reg.get(late.runId, OWNER)?.daily?.day).toBe(303);
	});

	it("other worlds keep pickSeed's random path (the Daily draws nothing from it) and carry no day", () => {
		const reg = registry([4242, 77]);
		const a = reg.start(OWNER, REQUEST, ctx());
		const d = reg.start(FRIEND, DAILY_REQUEST, ctx());
		const b = reg.start(OWNER, REQUEST, ctx());
		if (!a.ok || !d.ok || !b.ok) error("start failed");
		expect([a.session.seed, d.session.seed, b.session.seed]).toEqual([4242, fakeDailySeed(303), 77]);
		expect(a.session.daily).toBe(undefined);
		const endless = reg.start(FRIEND, { requestId: 2, worldKind: "endless" }, ctx());
		expect(endless.ok && endless.session.seed).toBe(4242);
		expect(endless.ok && endless.session.daily).toBe(undefined);
	});

	it("a server without a daily seed source answers config_error for the Daily only", () => {
		let ids = 0;
		const reg = new RunSessionRegistry({ newRunId: () => `r${++ids}`, pickSeed: () => 5 });
		const r = reg.start(OWNER, DAILY_REQUEST, ctx());
		expect(r.ok ? "ok" : `${r.code}: ${r.reason}`).toBe("config_error: config error: no daily seed on this server");
		expect(reg.start(OWNER, REQUEST, ctx()).ok).toBe(true);
	});

	it("a daily lobby starts a daily party run on the day's seed (the lobby's world, resolved at start)", () => {
		let ids = 0;
		const lobbies = new Lobbies({ newId: () => `L${++ids}` });
		const lctx = (now: number) => ({ now, busyReason: () => undefined, areFriends: () => true });
		const made = lobbies.create(OWNER, { worldKind: DAILY_WORLD_KIND }, lctx(0));
		if (!made.ok) error(made.reason);
		lobbies.join(FRIEND, made.lobby.lobbyId, lctx(0));
		lobbies.setReady(OWNER, true);
		lobbies.setReady(FRIEND, true);
		expect(lobbies.start(OWNER, lctx(0)).ok).toBe(true);
		const [start] = lobbies.tick(lctx(LOBBY.countdownSeconds)).starts;
		if (start === undefined || start.kind !== "party") error("no party start");
		expect(start.worldKind).toBe(DAILY_WORLD_KIND);
		// RunSessionService.startLobbyRun: owner first, the members as consent, the lobby's world.
		const others: number[] = [];
		for (let i = 1; i < start.members.size(); i++) others.push(start.members[i]);
		const reg = registry([4242]);
		const r = reg.start(
			start.members[0],
			{ requestId: 0, worldKind: start.worldKind, party: others },
			ctx(0, { partyConsent: start.members, unixNow: OCT_31 + 86399 }),
		);
		if (!r.ok) error(`${r.code}: ${r.reason}`);
		expect(r.session.members).toEqual([OWNER, FRIEND]);
		expect([r.session.seed, r.session.daily?.day]).toEqual([fakeDailySeed(303), 303]);
		// The world is built for the party (the same as every member's client builds from the reply's seed).
		const client = buildWorldSetup(DAILY_WORLD_KIND, r.session.seed, { atBossDoor: false, partySize: 2 });
		expect(r.session.setup.spawn).toEqual(client.spawn);
		expect(r.session.setup.config.party).toEqual(client.config.party);
	});

	it("segmented validation accepts a daily run played by the client's LiveRun on the reply's seed (floor 2 too)", () => {
		const reg = registry();
		const session = startDaily(reg, OWNER, ctx(0, { allowDebugInput: true }));
		// The client: buildWorldSetup("daily", reply.seed), a segmented LiveRun cut at every floor change.
		const setup = buildWorldSetup(DAILY_WORLD_KIND, session.seed, { atBossDoor: false });
		const run = new LiveRun({
			seed: session.seed,
			spawnX: setup.spawn!.x,
			spawnZ: setup.spawn!.z,
			config: setup.config,
			atBossDoor: false,
			runId: session.runId,
			segmentCutAfterTick: (state) => state.events.floorChanged !== 0,
		});
		const input: InputFrame = { ...EMPTY_INPUT };
		const FRAMES = 300;
		const SKIP_AT = 120; // the debug floor skip (KV_Debug): floor 1 -> 2, a segment cut there
		for (let n = 0; n < FRAMES; n++) {
			quantizeInput(math.cos(n * 0.02), math.sin(n * 0.02), 1, 0, 0, input);
			// A port bit (quantizeButtons keeps the web table's): set after quantizing, as InputController does.
			input.buttons = n === SKIP_AT ? DEBUG_FLOOR_BUTTON : 0;
			run.frame(SIM_DT, input);
		}
		expect(run.state.endless?.floor).toBe(2);
		const final = run.final()!;
		const segments = run.takeSegments();
		expect(segments.size() >= 2).toBe(true);
		const v = session.validator;
		for (const seg of segments) {
			const offer = v.offer(seg, LATE);
			expect([seg.index, offer.ok]).toEqual([seg.index, true]);
		}
		expect(v.finish(final, LATE)).toBe(undefined);
		let result = v.getResult();
		while (v.hasWork()) result = v.advance(97).result ?? result;
		expect(result?.reason).toBe(undefined);
		expect(result?.ok).toBe(true);
		expect(result?.serverHash).toBe(final.claimedHash);
		expect(result?.score.floor).toBe(2);
		expect(result?.score.score).toBe(final.claimed.score);
	});
});

describe("characters (docs/ARCHER.md AR5)", () => {
	const THIRD = 404;
	const ENDLESS: StartRunRequest = { requestId: 1, worldKind: "endless" };
	const inServer = (id: number) => id === OWNER || id === FRIEND || id === THIRD;
	const partyCtx = (picks?: ReadonlyArray<string>) =>
		ctx(0, { isInServer: inServer, partyConsent: [OWNER, FRIEND, THIRD], partyCharacters: picks });
	const PARTY: StartRunRequest = { ...ENDLESS, party: [FRIEND, THIRD] };
	/** Ticks each run below plays (two checkpoints and a bit; several rolls each). */
	const TICKS = DEFAULT_SEGMENT_LIMITS.checkpointEvery * 2 + 37;
	const ROLL_EVERY = 45;

	function started(reg: RunSessionRegistry, owner: number, req: StartRunRequest, c: StartContext): RunSession {
		const r = reg.start(owner, req, c);
		if (!r.ok) error(`start refused: ${r.code} ${r.reason}`);
		return r.session;
	}

	/** Player `i`'s input at tick `t`: a slow turn (its own phase), aim along it, a roll press every ROLL_EVERY ticks. */
	function botInput(i: number, t: number, out: InputFrame): InputFrame {
		const a = t * 0.015 + i * 2.1;
		const roll = (t + i * 11) % ROLL_EVERY === 0 ? Button.ROLL : 0;
		return quantizeInput(math.cos(a), math.sin(a), math.cos(a), math.sin(a), roll, out);
	}

	/** Drains a validator, returning its verdict (undefined while still open). */
	function drain(s: RunSession): SegmentedRunResult | undefined {
		let result = s.validator.getResult();
		while (s.validator.hasWork()) result = s.validator.advance(97).result ?? result;
		return result;
	}

	/**
	 * A party client's run as one segment: the world built from `setup` (what the client built from the party start's
	 * payload), every player on botInput, checkpoint hashes where the server compares them.
	 */
	function partySegment(session: RunSession, setup: RunSetup): RunSegment {
		const spawn = setup.spawn!;
		const state = createSimState(session.seed, spawn.x, spawn.z, setup.config);
		const recorder = new Recorder(session.seed, spawn.x, spawn.z);
		const n = session.members.size();
		const frames: InputFrame[] = [];
		for (let i = 0; i < n; i++) frames.push({ ...EMPTY_INPUT });
		const every = DEFAULT_SEGMENT_LIMITS.checkpointEvery;
		const checkpointHashes: string[] = [];
		for (let t = 0; t < TICKS; t++) {
			for (let i = 0; i < n; i++) botInput(i, t, frames[i]);
			recorder.recordParty(frames);
			stepParty(state, frames, setup.config);
			if (state.tick % every === 0 && state.tick < TICKS) checkpointHashes.push(hashState(state));
		}
		return {
			runId: session.runId,
			index: 0,
			startTick: 0,
			recording: encodeRecording(recorder.getRecording()),
			claimedEndHash: hashState(state),
			checkpointHashes,
		};
	}

	/** A solo client's ranked run (LiveRun, segmented) built as `character`, offered to `session` and drained. */
	function soloRun(session: RunSession, character: CharacterId): SegmentedRunResult | undefined {
		const setup = buildWorldSetup("endless", session.seed, { atBossDoor: false, characters: [character] });
		const run = new LiveRun({
			seed: session.seed,
			spawnX: setup.spawn!.x,
			spawnZ: setup.spawn!.z,
			config: setup.config,
			atBossDoor: false,
			runId: session.runId,
			segmentCutAfterTick: (state) => state.events.floorChanged !== 0,
		});
		const input: InputFrame = { ...EMPTY_INPUT };
		for (let t = 0; t < TICKS; t++) run.frame(SIM_DT, botInput(0, t, input));
		const final = run.final()!;
		for (const seg of run.takeSegments()) session.validator.offer(seg, LATE);
		session.validator.finish(final, LATE);
		return drain(session);
	}

	it("startRun.characterId: optional (the Knight), checked, and the session's setup is built with it", () => {
		const reg = registry();
		const knight = started(reg, OWNER, ENDLESS, ctx());
		expect(knight.characters).toEqual(["knight"]);
		expect(knight.setup.config.loadout).toEqual(characterLoadout("knight"));
		expect(knight.setup.config.traits).toEqual(characterTraits("knight"));
		const archer = started(reg, FRIEND, { ...ENDLESS, characterId: "archer" }, ctx());
		expect(archer.characters).toEqual(["archer"]);
		expect(archer.setup.config.loadout).toEqual(characterLoadout("archer"));
		expect(archer.setup.config.traits).toEqual(characterTraits("archer"));
		// What the client builds from the reply's seed and character is the session's setup.
		const client = buildWorldSetup("endless", archer.seed, { atBossDoor: false, characters: ["archer"] });
		expect(client.config.loadout).toEqual(archer.setup.config.loadout);
		expect(client.config.traits).toEqual(archer.setup.config.traits);
		// A world without characters (M1's) records none.
		expect(started(reg, OWNER, { ...REQUEST, characterId: "archer" }, ctx()).characters).toBe(undefined);
		// Unknown or malformed ids: bad_request, nothing created.
		const size = reg.size();
		for (const bad of ["ranger", "Archer", "", 3, true, string.rep("k", 49)]) {
			const r = reg.start(OWNER, { ...ENDLESS, characterId: bad } as unknown as StartRunRequest, ctx());
			expect(r.ok ? "ok" : r.code).toBe("bad_request");
		}
		expect(reg.size()).toBe(size);
	});

	it("a party plays the lobby's picks in member order (the request's own pick is the solo one)", () => {
		expect(sessionCharacters({ ...PARTY, characterId: "archer" }, 3, ["knight", "archer", "archer"])).toEqual([
			"knight",
			"archer",
			"archer",
		]);
		// Without the lobby's picks: the owner's request, the others the default.
		expect(sessionCharacters({ ...PARTY, characterId: "archer" }, 3, undefined)).toEqual([
			"archer",
			"knight",
			"knight",
		]);
		// Missing entries: the default; a solo start ignores partyCharacters.
		expect(sessionCharacters(PARTY, 3, ["archer"])).toEqual(["archer", "knight", "knight"]);
		expect(sessionCharacters({ ...ENDLESS, characterId: "archer" }, 1, ["knight"])).toEqual(["archer"]);
		const reg = registry();
		const s = started(reg, OWNER, PARTY, partyCtx(["archer", "knight", "archer"]));
		expect(s.members).toEqual([OWNER, FRIEND, THIRD]);
		expect(s.characters).toEqual(["archer", "knight", "archer"]);
		const party = s.setup.config.party!;
		expect(party.loadouts).toEqual([
			characterLoadout("archer"),
			characterLoadout("knight"),
			characterLoadout("archer"),
		]);
		expect(party.traits).toEqual([characterTraits("archer"), characterTraits("knight"), characterTraits("archer")]);
		// An unknown pick: bad_party, nothing created.
		const bad = registry().start(OWNER, PARTY, partyCtx(["archer", "wizard", "knight"]));
		expect(bad.ok ? "ok" : bad.code).toBe("bad_party");
	});

	it("a lobby's picks reach the party session through its start (the RunSessionService handoff)", () => {
		let ids = 0;
		const lobbies = new Lobbies({ newId: () => `L${++ids}` });
		const lctx = (now: number) => ({ now, busyReason: () => undefined, areFriends: () => true });
		const made = lobbies.create(OWNER, undefined, lctx(0));
		if (!made.ok) error(made.reason);
		lobbies.join(FRIEND, made.lobby.lobbyId, lctx(0));
		lobbies.join(THIRD, made.lobby.lobbyId, lctx(0));
		lobbies.setReady(OWNER, true, "knight");
		lobbies.setReady(FRIEND, true, "archer");
		lobbies.setReady(THIRD, true, "archer");
		lobbies.start(OWNER, lctx(0));
		const [start] = lobbies.tick(lctx(LOBBY.countdownSeconds)).starts;
		if (start === undefined || start.kind !== "party") error("no party start");
		const others: number[] = [];
		for (let i = 1; i < start.members.size(); i++) others.push(start.members[i]);
		const s = started(
			registry(),
			start.members[0],
			{ requestId: 0, worldKind: start.worldKind, party: others },
			ctx(0, { isInServer: inServer, partyConsent: start.members, partyCharacters: start.characters }),
		);
		expect(s.characters).toEqual(["knight", "archer", "archer"]);
	});

	it("a party run of three picks validates when every client builds the start payload's characters", () => {
		const s = started(registry(), OWNER, PARTY, partyCtx(["archer", "knight", "archer"]));
		// partyRunStarted carries s.characters; each client: buildWorldSetup(kind, seed, { partySize, characters }).
		const client = buildWorldSetup("endless", s.seed, {
			atBossDoor: false,
			partySize: 3,
			characters: [...s.characters!],
		});
		const seg = partySegment(s, client);
		expect(s.validator.offer(seg, LATE).ok).toBe(true);
		const result = drain(s);
		expect(result).toBe(undefined); // still open: every tick verified, no rejection
		expect(s.validator.getStatus()).toBe("open");
		expect(s.validator.getResult()).toBe(undefined);
		// A client that built other characters (here: everyone the Knight) is caught at the first checkpoint.
		const wrong = started(registry(), OWNER, PARTY, partyCtx(["archer", "knight", "archer"]));
		const knights = buildWorldSetup("endless", wrong.seed, { atBossDoor: false, partySize: 3 });
		expect(wrong.validator.offer(partySegment(wrong, knights), LATE).ok).toBe(true);
		const rejected = drain(wrong);
		expect([rejected?.ok, rejected?.code]).toEqual([false, "hash_mismatch"]);
		expect(rejected?.mismatchAtTick).toBe(DEFAULT_SEGMENT_LIMITS.checkpointEvery);
	});

	it("a solo run built as the Archer but started as the Knight fails validation (loadout and roll differ)", () => {
		const reg = registry();
		const honest = soloRun(started(reg, OWNER, { ...ENDLESS, characterId: "archer" }, ctx()), "archer");
		expect([honest?.ok, honest?.reason]).toEqual([true, undefined]);
		expect(honest?.telemetry?.character).toBe("archer");
		const knight = started(reg, FRIEND, { ...ENDLESS, characterId: "knight" }, ctx());
		expect(knight.setup.config.loadout).never.toEqual(characterLoadout("archer"));
		const forged = soloRun(knight, "archer");
		expect([forged?.ok, forged?.code]).toEqual([false, "hash_mismatch"]);
		// The default (no characterId) is the Knight's session too.
		const unnamed = soloRun(started(reg, THIRD, ENDLESS, ctx(0, { isInServer: inServer })), "archer");
		expect(unnamed?.ok).toBe(false);
	});

	it("the sessionless submitRun path builds the submission's character (absent: both weapons, as before)", () => {
		const limits = { ...LIVE_RUN_LIMITS, world: "endless" as const };
		const seed = 1337;
		const setup = buildWorldSetup("endless", seed, { atBossDoor: false, characters: ["archer"] });
		const run = new LiveRun({
			seed,
			spawnX: setup.spawn!.x,
			spawnZ: setup.spawn!.z,
			config: setup.config,
			atBossDoor: false,
		});
		const input: InputFrame = { ...EMPTY_INPUT };
		for (let t = 0; t < TICKS; t++) run.frame(SIM_DT, botInput(0, t, input));
		const sub = run.submission();
		const archer = validateRun({ ...sub, characterId: "archer" }, limits);
		expect([archer.ok, archer.reason]).toEqual([true, undefined]);
		expect(archer.telemetry?.character).toBe("archer");
		expect(validateRun({ ...sub, characterId: "knight" }, limits).code).toBe("hash_mismatch");
		expect(validateRun(sub, limits).code).toBe("hash_mismatch");
		expect(validateRun({ ...sub, characterId: "ranger" }, limits).code).toBe("bad_submission");
		expect(validateRun({ ...sub, characterId: string.rep("a", 49) }, limits).code).toBe("bad_submission");
	});
});
