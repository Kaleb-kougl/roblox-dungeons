// A vault on screen against the REAL sim (docs/TREASURE.md TR7): a forced SWIFT Rare vault (cracked to Common: boosts) on floor 2 of seed
// 4242, driven through LiveRun (a dev run in god mode) and through LockstepClient (a two-player party): the run views'
// own collection paths. Every frame's RunView.treasure feeds the view's TreasureViewTracker as the client's
// TreasureRenderController does; the arm, crack, unlock and open each arrive once, on the tick the sim's state shows
// them, the look follows (plate, shards, bars, pop edge once, the open's cards), and the chest's boosts are the frame's
// BoostFrameEvents.fromChest landings.
//
// Test-only surgery (presentation specs; nothing here is recorded or validated): teleports in front of the chest, the
// SWIFT countdown cut to one tick (the crack), the room's members killed through SimCtx (the clear), hearts topped up.
import { describe, expect, it } from "@rbxts/jest-globals";
import { VaultLock, VaultTier } from "shared/dungeon";
import { DEFAULT_LOCKSTEP, LockstepClient, MergedEncoder } from "shared/lockstep";
import { buildDevRunConfig } from "shared/run";
import { buildVaultRunConfig } from "shared/run/testing";
import {
	EMPTY_INPUT,
	GIVEN_DROP_SLOT,
	NO_KIND,
	SIM_DT,
	SIM_HZ,
	SimCtx,
	TREASURE_UNSET,
	VaultStatus,
	partySize,
	playerAt,
	simWorldConfig,
	type ActorState,
	type InputFrame,
	type SimConfig,
	type SimState,
} from "shared/sim";
import { chestLandingAt } from "shared/view/boosts";
import { TREASURE_VIEW, TreasureViewTracker, type TreasureLook } from "shared/view/treasure";
import { LiveRun, type RunView } from ".";

const SEED = 4242;
const OVERRIDE = { every: true, lock: VaultLock.SWIFT, tier: VaultTier.RARE };
const FULL = { reducedMotion: false, particles: true };

/** Player `i` `cells` in front of the chest's centre. */
function place(s: SimState, cells: number, i = 0): void {
	const t = s.treasure!;
	const p = playerAt(s, i);
	p.x = t.x + t.fx * cells;
	p.z = t.z + t.fz * cells;
}

function killRoom(s: SimState, config: Readonly<SimConfig>): void {
	const rec = s.score!.rooms[s.treasure!.record];
	const ctx = new SimCtx().bind(s, simWorldConfig(s, config), EMPTY_INPUT);
	for (let pass = 0; pass < 8; pass++) {
		let live = 0;
		for (let m = 0; m < rec.memberSlots.size(); m++) {
			const a: ActorState | undefined = s.combat.actors[rec.memberSlots[m]];
			if (a !== undefined && a.kind !== NO_KIND && a.id === rec.memberIds[m] && a.alive !== 0) {
				ctx.killActor(a);
				live++;
			}
		}
		if (live === 0) return;
	}
}

/** One frame of one tick on a run view, its look, and what the frame's events held. */
interface Frame {
	readonly look: TreasureLook;
	readonly armed: number;
	readonly cracked: number;
	readonly unlocked: number;
	readonly opened: number;
}

/**
 * The scenario on any run view: `tick` runs one tick (the run view's own frame) and tops hearts up. Checks every event
 * against the state on its tick and walks the tracker through the arm, the crack, the unlock and the open.
 */
function scenario(run: RunView, config: Readonly<SimConfig>, tick: () => void): void {
	const s = run.state;
	const t = s.treasure!;
	const tracker = new TreasureViewTracker();
	const seen = { armed: 0, cracked: 0, unlocked: 0, opened: 0 };
	let pops = 0;
	const frame = (): Frame => {
		const before = s.tick;
		tick();
		expect(s.tick).toBe(before + 1);
		const f = run.treasure;
		// Event ticks are state.tick at the END of the tick; the sim's armTick / crackTick are the tick's own number.
		for (const e of f.armed) expect([e.tick, t.status, t.armTick]).toEqual([s.tick, VaultStatus.ARMED, s.tick - 1]);
		for (const e of f.cracked) {
			expect([e.tick, t.status, t.crackTick, e.fromTier, e.tier]).toEqual([
				s.tick,
				VaultStatus.CRACKED,
				s.tick - 1,
				VaultTier.RARE,
				VaultTier.COMMON,
			]);
		}
		for (const e of f.unlocked)
			expect([e.tick, t.status, e.kept, e.missBy]).toEqual([s.tick, VaultStatus.UNLOCKED, 0, t.missBy]);
		for (const e of f.opened) {
			expect([e.tick, t.status, e.tier, e.kept, e.room, e.slot]).toEqual([
				s.tick,
				VaultStatus.OPENED,
				VaultTier.COMMON,
				0,
				t.room,
				t.slot,
			]);
		}
		seen.armed += f.armed.size();
		seen.cracked += f.cracked.size();
		seen.unlocked += f.unlocked.size();
		seen.opened += f.opened.size();
		const look = tracker.update(s, f, s.tick / SIM_HZ, FULL);
		if (look.popEdge) pops++;
		return {
			look,
			armed: f.armed.size(),
			cracked: f.cracked.size(),
			unlocked: f.unlocked.size(),
			opened: f.opened.size(),
		};
	};
	const waitFor = (what: string, done: (f: Frame) => boolean, max = 60): Frame => {
		for (let n = 0; n < max; n++) {
			const f = frame();
			if (done(f)) return f;
		}
		error(`never: ${what}`, 0);
	};

	expect(t.status).toBe(VaultStatus.SEALED);
	const first = frame();
	expect([first.look.present, first.look.fresh, first.look.cage.shown, first.look.plateShown]).toEqual([
		true,
		true,
		true,
		false,
	]);

	// Arm: into the room (one cell in front of the chest), then out of reach.
	place(s, 1);
	waitFor("armed", (f) => f.armed > 0);
	for (let i = 0; i < partySize(s); i++) place(s, 2, i);
	const fade = waitFor("the plate up", (f) => f.look.plateAlpha >= 1);
	expect([fade.look.plateShown, fade.look.lock, t.lock]).toEqual([true, VaultLock.SWIFT, VaultLock.SWIFT]);

	// Crack: the countdown's last tick.
	t.ticksLeft = 1;
	const crack = waitFor("cracked", (f) => f.cracked > 0, 3);
	expect([crack.look.crackEdge, crack.look.whiteMix, crack.look.shardU, crack.look.shardTier]).toEqual([
		true,
		1,
		0,
		VaultTier.RARE,
	]);
	expect(crack.look.plateAlpha).toBe(0);

	// Clear: the unlock, then the bars go after the stamp's delay.
	killRoom(s, config);
	waitFor("unlocked", (f) => f.unlocked > 0, 5);
	expect(t.missBy !== TREASURE_UNSET).toBe(true);
	const down = waitFor("bars down", (f) => !f.look.cage.shown, 120);
	expect([down.look.plateShown, down.look.lineKind]).toEqual([false, "none"]); // a cracked lock stays quiet

	// Open: player 0 steps into reach.
	place(s, 1);
	const open = waitFor("opened", (f) => f.opened > 0, 5);
	expect([open.look.open, open.look.opened !== undefined, open.look.popEdge]).toEqual([false, true, false]);
	const o = open.look.opened!;
	expect(o.grants.size()).toBe(partySize(s));
	// A Common: two boosts per player; the ones that landed are this frame's fromChest landings.
	const landed: number[] = [];
	for (const g of o.grants) for (const slot of g.slots) if (slot >= 0 && slot !== GIVEN_DROP_SLOT) landed.push(slot);
	expect(landed.size() > 0).toBe(true);
	expect(run.boostEvents.fromChest.size()).toBe(landed.size());
	for (const l of run.boostEvents.fromChest) {
		expect(landed.includes(l.slot)).toBe(true);
		expect(chestLandingAt(run.boostEvents, l.slot, l.spawnTick)).toBe(l);
	}
	const popped = waitFor("popped", (f) => f.look.open, math.ceil(TREASURE_VIEW.open.popSec * SIM_HZ) + 2);
	expect([popped.look.column.shown, popped.look.sparkleShown]).toEqual([true, false]);
	for (let n = 0; n < 3 * SIM_HZ; n++) frame();
	expect(pops).toBe(1);
	expect(seen).toEqual({ armed: 1, cracked: 1, unlocked: 1, opened: 1 });
}

describe("a vault on screen against the real sim (solo, LiveRun)", () => {
	it("collects the arm, crack, unlock and open once each, and the look follows", () => {
		const dev = buildDevRunConfig(SEED, { startFloor: 2, invulnerable: true, vault: OVERRIDE });
		const config = dev.config;
		const run = new LiveRun({ seed: SEED, spawnX: dev.spawn!.x, spawnZ: dev.spawn!.z, config, atBossDoor: false });
		scenario(run, config, () => {
			run.frame(SIM_DT, EMPTY_INPUT);
		});
	});
});

describe("a vault on screen against the real sim (two-player party, LockstepClient)", () => {
	it("collects the same events through the lockstep client", () => {
		const setup = buildVaultRunConfig(SEED, 2, { override: OVERRIDE, startFloor: 2 });
		const c = new LockstepClient({
			runId: "treasure-view",
			seed: SEED,
			spawn: setup.spawn!,
			config: setup.config,
			players: 2,
			localIndex: 0,
			tunables: DEFAULT_LOCKSTEP,
		});
		const s = c.state;
		const enc = new MergedEncoder(2);
		let fed = 0;
		const frames: InputFrame[][] = [[EMPTY_INPUT, EMPTY_INPUT]];
		scenario(c, setup.config, () => {
			for (let i = 0; i < partySize(s); i++) {
				const pl = playerAt(s, i);
				pl.hurtTicks = 1e6;
				if (pl.dead === 0) pl.hearts = pl.heartsMax;
			}
			expect(c.receive(fed, enc.encode(frames))).toBe(true);
			fed += 1;
			expect(c.pump(SIM_DT, () => EMPTY_INPUT).stepped).toBe(1);
		});
	});
});
