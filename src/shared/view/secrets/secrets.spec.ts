// A secret room's view core (docs/SECRET_ROOMS.md SR6): the look per status from replayed states of the secret arena
// (shared/sim/testing secretArena.ts; the sim's own finisher pass opens it), the timeline (burst, sink, reveal), the
// dust's cadence, reduced motion, a plan that is not the state's secret; the knock throttle and the first-knock latch;
// the frame events' copies; SecretViewTracker's edges (the open once, the reveal 0.4 s later, none for an open met
// mid-way); the shout's priority and audience; the co-op toast; the reward cards' title.
import { describe, expect, it } from "@rbxts/jest-globals";
import { gridToWorld } from "shared/dungeon";
import {
	AXIS_MAX,
	BreakableSource,
	EMPTY_INPUT,
	SECRETS_CONFIG,
	SIM_HZ,
	SecretStatus,
	createSimState,
	meleeHitBreakables,
	playerAt,
	step,
	type SimConfig,
	type SimState,
} from "shared/sim";
import { ARENA, arenaConfig, arenaSecret } from "shared/sim/testing";
import { PLACEHOLDER_MANIFEST, ThemePack } from "shared/theme";
import { FLOOR_SHOUT_PRIORITY } from "../hud/dailyRankConfig";
import {
	FirstKnockLatch,
	KnockThrottle,
	NO_SECRET_EVENTS,
	SECRET_TEXT_KEYS,
	SECRET_VIEW,
	SecretFrameEvents,
	SecretPhase,
	SecretViewTracker,
	secretDustAt,
	secretLook,
	secretMatchesPlan,
	secretOpenSec,
	secretDebugLabel,
	secretOpenLogLine,
	secretRewardTexts,
	secretShout,
	secretSinkTiles,
	secretToast,
	type SecretOpenedEvent,
} from ".";

const SEED = 31;
const CX = gridToWorld(ARENA.crackX) + 0.5;
const CZ = gridToWorld(ARENA.wallZ);
const IDLE = { ...EMPTY_INPUT, aimZ: -AXIS_MAX };
const FULL = { reducedMotion: false };
const REDUCED = { reducedMotion: true };
const PLAN = arenaSecret(0);

function arena(extra: Partial<SimConfig> = {}): { config: SimConfig; s: SimState } {
	const config = arenaConfig(SEED, { extraConfig: { secrets: SECRETS_CONFIG, scoring: {}, ...extra } });
	const s = createSimState(SEED, ARENA.spawnX, ARENA.spawnZ, config);
	s.player.hurtTicks = 1e6;
	return { config, s };
}

/** A finisher pass straight onto the crack inside a tick's step (the sim's opener), collected like a run view. */
function openOnTick(s: SimState, config: SimConfig, ev: SecretFrameEvents): void {
	// The pass outside step() writes the events of the tick about to run: step first clears them, so collect before.
	meleeHitBreakables(s, CX, CZ + 1.5, 0, -1, 2.53, 0, 6, 0, true);
	ev.collect(s);
	step(s, IDLE, config);
}

describe("secretLook (docs/SECRET_ROOMS.md SR6)", () => {
	it("HIDDEN: the crack and the dust; the dust passes every everySec, cell by cell, none under reduced motion", () => {
		const { s } = arena();
		expect(secretMatchesPlan(s, PLAN)).toBe(true);
		const look = secretLook(s, PLAN, 0.05, FULL);
		expect([look.phase, look.crackShown, look.chamberShown, look.tier]).toEqual([
			SecretPhase.HIDDEN,
			true,
			false,
			PLAN.tier,
		]);
		expect(look.dust).toEqual({ shown: true, frame: 0, cell: 0 });
		const D = SECRET_VIEW.dust;
		expect(secretDustAt(D.everySec + 0.15, 2)).toEqual({ shown: true, frame: 1, cell: 1 });
		expect(secretDustAt(2 * D.everySec + 0.01, 2)).toEqual({ shown: true, frame: 0, cell: 0 });
		expect(secretDustAt(D.frames / D.fps + 0.01, 2).shown).toBe(false);
		expect(secretLook(s, PLAN, 0.05, REDUCED).dust.shown).toBe(false);
	});

	it("OPENING t: the burst, the sink, the torches at the reveal, then OPEN; TAKEN; reduced motion cuts the chamber in", () => {
		const { config, s } = arena();
		const ev = new SecretFrameEvents();
		openOnTick(s, config, ev);
		expect(s.secrets!.status).toBe(SecretStatus.OPEN);
		const t0 = secretOpenSec(s.secrets!.openTick);
		expect(t0).toBe(s.tick / SIM_HZ);
		const at = (t: number, settings = FULL) => secretLook(s, PLAN, t0 + t, settings);
		const V = SECRET_VIEW;
		const start = at(0);
		expect([start.phase, start.crackShown, start.chamberShown, start.burstU, start.sinkU, start.bursting]).toEqual([
			SecretPhase.OPENING,
			false,
			true,
			0,
			0,
			true,
		]);
		const mid = at(V.burst.sec / 2);
		expect([mid.burstU, mid.sinkU < 1, mid.torchesLit]).toEqual([0.5, true, false]);
		expect(at(V.reveal.jingleSec).torchesLit).toBe(true);
		const done = at(V.openingSec);
		expect([done.phase, done.burstU, done.sinkU, done.bursting]).toEqual([SecretPhase.OPEN, 1, 1, false]);
		const reduced = at(0, REDUCED);
		expect([reduced.sinkU, reduced.bursting, reduced.chamberShown]).toEqual([1, false, true]);
		// The rock's sink: 0 at the open, eased, the whole depth at the end (and at once under reduced motion).
		expect([secretSinkTiles(start), secretSinkTiles(done), secretSinkTiles(reduced)]).toEqual([
			0,
			V.sink.depthTiles,
			V.sink.depthTiles,
		]);
		expect(secretSinkTiles(at(V.sink.sec / 2)) < V.sink.depthTiles / 2).toBe(true);
		// The chest: TAKEN.
		const p = playerAt(s, 0);
		p.x = gridToWorld(ARENA.chestX);
		p.z = gridToWorld(ARENA.chestY) + 1;
		step(s, IDLE, config);
		expect(s.secrets!.status).toBe(SecretStatus.TAKEN);
		const taken = at(V.openingSec + 1);
		expect([taken.phase, taken.chestOpen, taken.chamberShown]).toEqual([SecretPhase.TAKEN, true, true]);
	});

	it("no secret, no plan or another plan: NONE", () => {
		const { s } = arena();
		expect(secretLook(s, undefined, 0, FULL).phase).toBe(SecretPhase.NONE);
		const other = { ...PLAN, x: PLAN.x + 3 };
		expect(secretLook(s, other, 0, FULL).phase).toBe(SecretPhase.NONE);
		const plain = createSimState(SEED, ARENA.spawnX, ARENA.spawnZ, arenaConfig(SEED));
		expect(secretLook(plain, PLAN, 0, FULL).phase).toBe(SecretPhase.NONE);
	});
});

describe("knocks: the throttle, the latch, the frame's copies", () => {
	it("KnockThrottle: one per throttleSec; a clock going back resets it", () => {
		const k = new KnockThrottle();
		const gap = SECRET_VIEW.knock.throttleSec;
		expect([k.admit(1), k.admit(1 + gap / 2), k.admit(1 + gap), k.admit(1 + gap + 0.01)]).toEqual([
			true,
			false,
			true,
			false,
		]);
		expect(k.admit(0)).toBe(true);
	});

	it("the frame events copy every knock of the tick (slot, cell centre, source, player); the latch is the local player's", () => {
		const { s } = arena();
		const ev = new SecretFrameEvents();
		// A swing's pass (not the finisher) on both cells, by player 0.
		meleeHitBreakables(s, CX, CZ + 1.5, 0, -1, 2.53, 0, 6, 0);
		ev.collect(s);
		expect(ev.knocks.map((k) => [k.slot, k.x, k.z, k.source, k.player])).toEqual([
			[PLAN.crackSlot, gridToWorld(ARENA.crackX), CZ, BreakableSource.MELEE, 0],
			[PLAN.crackSlot + 1, gridToWorld(ARENA.crackX + 1), CZ, BreakableSource.MELEE, 0],
		]);
		expect([ev.opened.size(), ev.taken.size(), ev.count()]).toEqual([0, 0, 2]);
		const latch = new FirstKnockLatch();
		expect([latch.observe(ev, 1), latch.knocked()]).toEqual([false, false]);
		expect([latch.observe(ev, 0), latch.knocked(), latch.observe(ev, 0)]).toEqual([true, true, false]);
		latch.reset();
		expect(latch.knocked()).toBe(false);
		ev.reset();
		expect(ev.count()).toBe(0);
		expect(NO_SECRET_EVENTS.knocks.size()).toBe(0);
	});
});

describe("SecretViewTracker: the edges", () => {
	it("the open once, the reveal reveal.jingleSec later, the knock puffs throttled; an open met mid-way is silent", () => {
		const { config, s } = arena();
		const tracker = new SecretViewTracker();
		const ev = new SecretFrameEvents();
		// Two knocks in one frame (two cells, one tick): one puff.
		meleeHitBreakables(s, CX, CZ + 1.5, 0, -1, 2.53, 0, 6, 0);
		ev.collect(s);
		step(s, IDLE, config);
		expect(tracker.update(s, PLAN, ev, s.tick / SIM_HZ, FULL).puffs.size()).toBe(1);
		ev.reset();
		openOnTick(s, config, ev);
		let f = tracker.update(s, PLAN, ev, s.tick / SIM_HZ, FULL);
		expect([f.openEdge !== undefined, f.revealEdge, f.look.phase]).toEqual([true, false, SecretPhase.OPENING]);
		ev.reset();
		let reveals = 0;
		let at = -1;
		for (let n = 0; n < SIM_HZ; n++) {
			step(s, IDLE, config);
			f = tracker.update(s, PLAN, ev, s.tick / SIM_HZ, FULL);
			expect(f.openEdge).toBe(undefined);
			if (f.revealEdge) {
				reveals++;
				at = s.tick / SIM_HZ - secretOpenSec(s.secrets!.openTick);
			}
		}
		expect(reveals).toBe(1);
		expect(math.abs(at - SECRET_VIEW.reveal.jingleSec) < 1 / SIM_HZ + 1e-9).toBe(true);
		// A fresh tracker on the open state (a late view): the look, no edges ever.
		const late = new SecretViewTracker();
		const g = late.update(s, PLAN, NO_SECRET_EVENTS, s.tick / SIM_HZ, FULL);
		expect([g.look.phase, g.openEdge, g.revealEdge]).toEqual([SecretPhase.OPEN, undefined, false]);
	});
});

describe("the news: shout, toast, cards", () => {
	const opened = (over: Partial<SecretOpenedEvent> = {}): SecretOpenedEvent => ({
		tick: 5,
		how: 0,
		player: 0,
		finder: 0,
		slot: 0,
		x: CX,
		z: CZ,
		fx: 0,
		fz: 1,
		room: 0,
		tier: PLAN.tier,
		chestX: 0,
		chestZ: 0,
		points: 600,
		...over,
	});

	it("SECRET! between the Goldling's appearance and the new best, for the opener or a player near the crack", () => {
		const P = FLOOR_SHOUT_PRIORITY;
		expect(P.secret < P.goldenAppear && P.secret > P.newBest).toBe(true);
		const { config, s } = arena({ party: { size: 2 }, scoring: { partySize: 2 } });
		expect(config.party!.size).toBe(2);
		playerAt(s, 1).x = CX + 30;
		const mine = secretShout(opened(), s, 0)!;
		expect([mine.key, mine.priority, mine.lifeSec]).toEqual([
			SECRET_TEXT_KEYS.shout,
			P.secret,
			SECRET_VIEW.shout.lifeSec,
		]);
		expect(secretShout(opened(), s, 1)).toBe(undefined);
		playerAt(s, 1).x = CX + 2;
		expect(secretShout(opened(), s, 1)).never.toBe(undefined);
		// A Charger's open: the finder (nearest player) is credited for the shout.
		playerAt(s, 1).x = CX + 30;
		expect(secretShout(opened({ player: -1, finder: 1 }), s, 1)).never.toBe(undefined);
	});

	it("the co-op toast names the finder for the others; none solo, for the finder or without a finder", () => {
		const party = arena({ party: { size: 2 }, scoring: { partySize: 2 } }).s;
		const solo = arena().s;
		const name = (i: number) => `P${i}`;
		expect(secretToast(opened(), party, 1, name)).toEqual({
			key: SECRET_TEXT_KEYS.toast,
			args: { name: "P0" },
			seconds: SECRET_VIEW.toast.seconds,
		});
		expect(secretToast(opened(), party, 0, name)).toBe(undefined);
		expect(secretToast(opened(), solo, 1, name)).toBe(undefined);
		expect(secretToast(opened({ finder: -1 }), party, 1, name)).toBe(undefined);
		expect(secretToast(opened(), party, 1, () => undefined)).toBe(undefined);
		const pack = new ThemePack(PLACEHOLDER_MANIFEST, { warn: () => undefined });
		expect(pack.str(SECRET_TEXT_KEYS.toast, { name: "Kai" })).toBe("Secret found by Kai");
	});

	it("the chest's cards are the vault's, titled Secret cache", () => {
		const pack = new ThemePack(PLACEHOLDER_MANIFEST, { warn: () => undefined });
		const s = (k: string, v?: Readonly<Record<string, string | number>>) => pack.str(k, v);
		const r = secretRewardTexts(
			s,
			{
				tick: 1,
				slot: 0,
				x: 0,
				z: 0,
				fx: 0,
				fz: 1,
				opener: 0,
				tier: 2,
				points: 1500,
				grants: [{ player: 0, relic: -1, bonusDeal: 1, boosts: [1], slots: [0] }],
			},
			0,
		);
		expect(r.title).toBe("Secret cache");
		expect(r.cards.map((c) => c.kind)).toEqual(["draft", "boosts", "points"]);
	});
});

describe("debug text (Design 12)", () => {
	it("the open's log line and the label", () => {
		const plan = { room: 4, x: 31, y: 12, fx: 1, fz: 0, tier: 2, along: 5, depth: 4 };
		expect(secretOpenLogLine(6, plan, { how: 2, player: 1 })).toBe(
			"[Secret] floor 6: room 4 crack (31,12)+x opened by heavy (player 1)",
		);
		expect(secretOpenLogLine(3, { ...plan, fx: 0, fz: 1 }, { how: 3, player: -1 })).toBe(
			"[Secret] floor 3: room 4 crack (31,12)+z opened by charger (nobody)",
		);
		expect(secretDebugLabel(plan, SecretStatus.HIDDEN)).toBe("legendary hidden 5x4");
	});
});
