// A secret room on screen against the REAL sim (docs/SECRET_ROOMS.md SR6): the secret arena (shared/sim/testing
// secretArena.ts: a carved room, a two-cell crack, a 5 x 4 chamber with its chest) driven through LiveRun (solo, a
// Knight holding FIRE at the crack: swings 1 and 2 knock, the finisher opens it) and through LockstepClient (a party of
// two, player 0 swinging, the local player 1 watching): the run views' own collection paths, frames of one tick and of
// several. Every frame's RunView.secrets feeds the view's SecretViewTracker, SecretCueTracker and FirstKnockLatch as the
// client's controllers do: each knock arrives once on its tick, the puffs and knock sounds through the throttle, the
// open once (burst, shout; the reveal 0.4 s later: the jingle), then the chest's take; the look walks HIDDEN ->
// OPENING -> OPEN -> TAKEN; the co-op toast names the finder for the teammate only.
//
// Test-only surgery (presentation specs; nothing here is recorded or validated): players placed in front of the crack
// and teleported to the chest, hearts topped up.
import { describe, expect, it } from "@rbxts/jest-globals";
import { gridToWorld } from "shared/dungeon";
import { DEFAULT_LOCKSTEP, LockstepClient, MergedEncoder } from "shared/lockstep";
import {
	AXIS_MAX,
	Button,
	EMPTY_INPUT,
	SECRETS_CONFIG,
	SIM_DT,
	SIM_HZ,
	SecretHow,
	SecretStatus,
	partySize,
	playerAt,
	type InputFrame,
	type SimConfig,
	type SimState,
} from "shared/sim";
import { ARENA, arenaConfig, arenaSecret } from "shared/sim/testing";
import {
	FirstKnockLatch,
	SECRET_VIEW,
	SecretCueTracker,
	SecretPhase,
	SecretViewTracker,
	secretShout,
	secretToast,
	type SecretFrameSource,
} from "shared/view/secrets";
import { LiveRun, type RunView } from ".";

const SEED = 77;
const CX = gridToWorld(ARENA.crackX) + 0.5;
const FACE = gridToWorld(ARENA.wallZ) + 0.5;
const FIRE: InputFrame = { ...EMPTY_INPUT, aimZ: -AXIS_MAX, buttons: Button.FIRE };
const IDLE: InputFrame = { ...EMPTY_INPUT, aimZ: -AXIS_MAX };
const FULL = { reducedMotion: false };
/** The plan the floor's layout would carry (no extra pieces before the crack). */
const PLAN = arenaSecret(0);

function config(party: number): SimConfig {
	const extra: Partial<SimConfig> = { secrets: SECRETS_CONFIG, scoring: { partySize: party } };
	return arenaConfig(SEED, { extraConfig: party > 1 ? { ...extra, party: { size: party } } : extra });
}

function topUp(s: SimState): void {
	for (let i = 0; i < partySize(s); i++) {
		const p = playerAt(s, i);
		p.hurtTicks = 1e6;
		if (p.dead === 0) p.hearts = p.heartsMax;
	}
}

interface Seen {
	knocks: number;
	puffs: number;
	knockCues: number;
	opens: number;
	openEdges: number;
	openCues: number;
	reveals: number;
	jingles: number;
	taken: number;
	takenEdges: number;
	latchEdges: number;
	phases: number[];
	shouts: number;
	toasts: string[];
}

/**
 * The scenario on any run view: `tick(fire)` runs one frame of `ticks` ticks (the swinger holds FIRE while `fire`).
 * `me` is this client's player (the latch, cues, shout and toast are its).
 */
function scenario(run: RunView, me: number, tick: (fire: boolean) => number): Seen {
	const s = run.state;
	const view = new SecretViewTracker();
	const cues = new SecretCueTracker();
	const latch = new FirstKnockLatch();
	const seen: Seen = {
		knocks: 0,
		puffs: 0,
		knockCues: 0,
		opens: 0,
		openEdges: 0,
		openCues: 0,
		reveals: 0,
		jingles: 0,
		taken: 0,
		takenEdges: 0,
		latchEdges: 0,
		phases: [],
		shouts: 0,
		toasts: [],
	};
	const frame = (fire: boolean): SecretFrameSource => {
		const before = s.tick;
		const ran = tick(fire);
		expect(s.tick).toBe(before + ran);
		const ev = run.secrets;
		// Every event's tick is one of this frame's (state.tick at the END of its tick).
		for (const k of ev.knocks) {
			expect(k.tick > before && k.tick <= s.tick).toBe(true);
			expect([k.slot >= PLAN.crackSlot && k.slot < PLAN.crackSlot + PLAN.cells]).toEqual([true]);
		}
		for (const o of ev.opened) {
			expect([o.tick, s.secrets!.openTick + 1, o.how, o.slot]).toEqual([
				o.tick,
				o.tick,
				SecretHow.FINISHER,
				PLAN.crackSlot,
			]);
			const shout = secretShout(o, s, me);
			if (shout !== undefined) seen.shouts++;
			const toast = secretToast(o, s, me, (i) => `P${i}`);
			if (toast !== undefined) seen.toasts.push(`${toast.key}:${toast.args.name}`);
		}
		seen.knocks += ev.knocks.size();
		seen.opens += ev.opened.size();
		seen.taken += ev.taken.size();
		const simSec = s.tick / SIM_HZ;
		const f = view.update(s, PLAN, ev, simSec, FULL);
		seen.puffs += f.puffs.size();
		if (f.openEdge !== undefined) seen.openEdges++;
		if (f.revealEdge) seen.reveals++;
		if (f.takenEdge !== undefined) seen.takenEdges++;
		const phase = f.look.phase;
		if (seen.phases[seen.phases.size() - 1] !== phase) seen.phases.push(phase);
		const c = cues.update(s, PLAN, ev, simSec, me);
		if (c.knock) seen.knockCues++;
		if (c.open) seen.openCues++;
		if (c.jingle) seen.jingles++;
		if (latch.observe(ev, me)) seen.latchEdges++;
		return ev;
	};

	expect(s.secrets!.status).toBe(SecretStatus.HIDDEN);
	for (let n = 0; n < 120 && s.secrets!.status === SecretStatus.HIDDEN; n++) frame(true);
	expect(s.secrets!.status).toBe(SecretStatus.OPEN);
	// The reveal and the rest of the opening.
	for (let n = 0; n < SECRET_VIEW.openingSec * SIM_HZ + 4; n++) frame(false);
	// The chest: player 0 steps into reach.
	const p = playerAt(s, 0);
	p.x = gridToWorld(ARENA.chestX);
	p.z = gridToWorld(ARENA.chestY) + 1;
	for (let n = 0; n < 6 && s.secrets!.status !== SecretStatus.TAKEN; n++) frame(false);
	expect(s.secrets!.status).toBe(SecretStatus.TAKEN);
	frame(false);
	return seen;
}

describe("a secret room on screen against the real sim (solo, LiveRun)", () => {
	for (const ticks of [1, 3]) {
		it(`collects the knocks, the open and the take once each (${ticks} tick(s) a frame); the look and edges follow`, () => {
			const cfg = config(1);
			const run = new LiveRun({
				seed: SEED,
				spawnX: ARENA.spawnX,
				spawnZ: ARENA.spawnZ,
				config: cfg,
				atBossDoor: false,
			});
			const s = run.state;
			s.player.x = CX;
			s.player.z = FACE + 1.5;
			topUp(s);
			const seen = scenario(run, 0, (fire) => {
				const n = run.frame(SIM_DT * ticks, fire ? FIRE : IDLE);
				topUp(s);
				return n;
			});
			// Swings 1 and 2 knock both cells each (4 knocks); the finisher opens.
			expect(seen.knocks).toBe(4);
			expect([seen.opens, seen.openEdges, seen.openCues, seen.reveals, seen.jingles]).toEqual([1, 1, 1, 1, 1]);
			expect([seen.taken, seen.takenEdges]).toEqual([1, 1]);
			expect([seen.latchEdges, seen.shouts, seen.toasts.size()]).toEqual([1, 1, 0]);
			// One puff and one knock sound per swing: the throttle folds a pass's two cells into one.
			expect([seen.puffs, seen.knockCues]).toEqual([2, 2]);
			expect(seen.phases).toEqual([SecretPhase.HIDDEN, SecretPhase.OPENING, SecretPhase.OPEN, SecretPhase.TAKEN]);
		});
	}
});

describe("a secret room on screen against the real sim (two-player party, LockstepClient)", () => {
	it("collects the same events through the lockstep client; the toast names the finder for the teammate", () => {
		const cfg = config(2);
		const c = new LockstepClient({
			runId: "secrets-view",
			seed: SEED,
			spawn: { x: ARENA.spawnX, z: ARENA.spawnZ },
			config: cfg,
			players: 2,
			localIndex: 1,
			tunables: DEFAULT_LOCKSTEP,
		});
		const s = c.state;
		const p0 = playerAt(s, 0);
		p0.x = CX;
		p0.z = FACE + 1.5;
		const p1 = playerAt(s, 1);
		p1.x = CX + 4;
		p1.z = FACE + 3;
		topUp(s);
		const enc = new MergedEncoder(2);
		let fed = 0;
		const seen = scenario(c, 1, (fire) => {
			expect(c.receive(fed, enc.encode([[fire ? FIRE : IDLE, IDLE]]))).toBe(true);
			fed += 1;
			const stepped = c.pump(SIM_DT, () => EMPTY_INPUT).stepped;
			topUp(s);
			return stepped;
		});
		expect(seen.knocks).toBe(4);
		expect([seen.puffs, seen.knockCues]).toEqual([2, 2]);
		expect([seen.opens, seen.openEdges, seen.openCues, seen.reveals, seen.jingles]).toEqual([1, 1, 1, 1, 1]);
		expect([seen.taken, seen.takenEdges]).toEqual([1, 1]);
		// The knocks were player 0's: no first-time card for the local player 1. Near the crack: the shout shows.
		expect(seen.latchEdges).toBe(0);
		expect(seen.shouts).toBe(1);
		expect(seen.toasts).toEqual(["hud.toast.secret:P0"]);
	});
});
