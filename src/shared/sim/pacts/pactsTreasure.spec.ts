// Pacts with treasure rooms (docs/FORTUNE.md PS3 / PS4 x docs/TREASURE.md TR3 / TR4).
// A Horde room that is also the floor's vault room: the horde's second wave joins the record the vault's lock reads.
// The lock arms once (on the record's engagement), never unlocks between the waves (pactHoldsRoom holds the clear),
// SWIFT counts down the grown par (vaultParGrown: still exactly FAST over both waves), the room clears and pays its
// ROOMS once, and the chest's TREASURE award is never doubled (it is not one of the room's x2 awards).
// Greed's mid-floor deal and a Legendary chest's bonus deal: Greed's one deal never takes a pending bonus deal, and the
// next floor's draft deals the bonus as an ordinary draft (draftKind reset, no "Pick again" on its first deal).
// Test-only surgery: teleports, kills through SimCtx, a bonus deal set by hand.
import { describe, expect, it } from "@rbxts/jest-globals";
import { VaultLock, isBossFloor } from "shared/dungeon";
import {
	DEBUG_FLOOR_BUTTON,
	DRAFT_CONFIRM_BUTTON,
	DRAFT_MIN_OPEN_TICKS,
	DRAFT_SCREEN_RIGHT_X,
	DRAFT_SCREEN_RIGHT_Z,
	EMPTY_INPUT,
	NO_PACT,
	NO_KIND,
	PactKind,
	ScoreSource,
	SimCtx,
	TILE_SIZE,
	TREASURE_UNSET,
	VaultStatus,
	createSimState,
	isDraftOpen,
	pactDraftKind,
	pactHoldsRoom,
	step,
	swiftTicks,
	treasureAwardPoints,
	type ActorState,
	type RoomScore,
	type SimState,
} from "shared/sim";
import { altarFloor, frame, pactsSetup, pressPact, skipToFloor, skipToFloorAny, teleport } from "shared/run/testing";
import { draftRedealt } from "shared/view/hud";
import type { EndlessRunSetup } from "shared/run";

/** The first (run seed, floor) solo whose floor has both pact altars and a SWIFT vault. */
function findFloor(): [number, number] {
	for (let seed = 1; seed <= 200; seed++) {
		const setup = pactsSetup(seed, 1);
		for (let floor = 2; floor <= 9; floor++) {
			const w = setup.endlessFloor(floor);
			if (w.pactAltars !== undefined && w.vault !== undefined && w.vault.lock === VaultLock.SWIFT)
				return [seed, floor];
		}
	}
	error("no floor with altars and a SWIFT vault (seeds 1-200, floors 2-9)", 0);
}

function living(s: SimState, rec: RoomScore): ActorState[] {
	const out: ActorState[] = [];
	for (let m = 0; m < rec.memberSlots.size(); m++) {
		const a = s.combat.actors[rec.memberSlots[m]];
		if (a !== undefined && a.kind !== NO_KIND && a.id === rec.memberIds[m] && a.alive !== 0) out.push(a);
	}
	return out;
}

const kctx = new SimCtx();
function killAll(setup: EndlessRunSetup, s: SimState, rec: RoomScore): void {
	kctx.bind(s, setup.endlessFloor(s.endless!.floor).config, EMPTY_INPUT);
	for (const a of living(s, rec)) kctx.killActor(a);
}

describe("a Horde room that is the vault room (pacts x treasure)", () => {
	it("one arm, no unlock between the waves, SWIFT on the grown par, one clear, the chest's award not doubled", () => {
		const [seed, floor] = findFloor();
		const setup = pactsSetup(seed, 1);
		const config = setup.config;
		const s = createSimState(seed, setup.spawn!.x, setup.spawn!.z, config);
		skipToFloorAny(s, config, floor);
		const world = setup.endlessFloor(floor);
		const t = s.treasure!;
		const h = s.pacts!.horde;
		const sc = s.score!;
		expect(t.status).toBe(VaultStatus.SEALED);
		pressPact(setup, s, PactKind.HORDE);
		expect(h.armed).toBe(1);
		const tick = () => step(s, frame(0, 0), config);
		// The vault room is the first enemy room entered: it is the horde room, the lock arms on its engagement.
		const front = (tiles: number): [number, number] => [
			t.x + t.fx * tiles * TILE_SIZE,
			t.z + t.fz * tiles * TILE_SIZE,
		];
		const [fx, fz] = front(1.7);
		teleport(s, 0, fx, fz);
		tick();
		teleport(s, 0, world.spawnX, world.spawnZ);
		expect(h.room).toBe(world.vault!.room);
		expect(h.record).toBe(t.record);
		expect(t.status).toBe(VaultStatus.ARMED);
		const rec = sc.rooms[t.record];
		const armTick = t.armTick;
		expect(armTick).toBe(rec.engageTick);
		const swiftLeft = () => swiftTicks(rec.parTicks, 0, t.config) - (s.tick - 1 - t.armTick);
		expect(t.ticksLeft).toBe(swiftLeft());
		const rooms0 = sc.counts[ScoreSource.ROOMS];
		const fast0 = sc.counts[ScoreSource.FAST];
		// Wave 1 down: wave 2 telegraphs and spawns; the record (and the chest) stays shut until wave 2 is down.
		killAll(setup, s, rec);
		const par1 = rec.parTicks;
		for (let k = 0; k < 400 && pactHoldsRoom(s, t.record); k++) {
			tick();
			expect(rec.cleared).toBe(0);
			expect(t.status).toBe(VaultStatus.ARMED);
		}
		expect(pactHoldsRoom(s, t.record)).toBe(false);
		expect(h.spawned > 0).toBe(true);
		expect(rec.parTicks > par1).toBe(true);
		expect(t.ticksLeft).toBe(swiftLeft()); // the grown par, counted from the same arm tick
		expect([t.status, t.armTick]).toEqual([VaultStatus.ARMED, armTick]);
		// Wave 2 down: one clear (ROOMS once), FAST paid, the lock kept, the chest unlocked.
		for (let k = 0; k < 20 && rec.cleared === 0; k++) {
			killAll(setup, s, rec);
			tick();
		}
		expect(rec.cleared).toBe(1);
		expect(sc.counts[ScoreSource.ROOMS] - rooms0).toBe(1);
		expect(sc.counts[ScoreSource.FAST] - fast0).toBe(1);
		expect([t.status, t.crackTick, t.spare > 0]).toEqual([VaultStatus.UNLOCKED, TREASURE_UNSET, true]);
		for (let k = 0; k < 5; k++) tick();
		expect(rec.cleared).toBe(1);
		expect(sc.counts[ScoreSource.ROOMS] - rooms0).toBe(1);
		// The open: TREASURE pays its own award, x1 (the Horde's HORDE source does not move).
		const horde0 = sc.points[ScoreSource.HORDE];
		const treasure0 = sc.points[ScoreSource.TREASURE];
		const expected = treasureAwardPoints(s, sc, t.config.points[t.tier]);
		const [ox, oz] = front(0.9);
		teleport(s, 0, ox, oz);
		tick();
		expect(t.status).toBe(VaultStatus.OPENED);
		expect(sc.points[ScoreSource.TREASURE] - treasure0).toBe(expected);
		expect(sc.points[ScoreSource.HORDE]).toBe(horde0);
	});
});

describe("Greed's deal and a Legendary chest's bonus deal (pacts x treasure)", () => {
	it("Greed's one deal leaves a pending bonus deal alone; the next floor's draft deals it as an ordinary draft", () => {
		const seed = 1337;
		const setup = pactsSetup(seed, 1);
		const config = setup.config;
		const f = altarFloor(setup);
		expect(f > 0).toBe(true);
		const s = createSimState(seed, setup.spawn!.x, setup.spawn!.z, config);
		skipToFloor(s, config, f);
		const t = s.treasure!;
		const bp = s.builds!.players[0];
		const me = s.run!.players[0];
		t.bonusDeals[0] = 1; // a Legendary chest opened earlier on this floor (surgery)
		pressPact(setup, s, PactKind.GREED);
		expect([me.draftOpen, bp.draftsLeft, pactDraftKind(s, 0)]).toEqual([1, 1, PactKind.GREED]);
		expect(draftRedealt(s, 0)).toBe(false);
		expect(t.bonusDeals[0]).toBe(1);
		// pick Greed's card: one deal, no re-deal, the bonus still pending
		const lx = -DRAFT_SCREEN_RIGHT_X;
		const lz = -DRAFT_SCREEN_RIGHT_Z;
		while (me.draftTicks + 1 < DRAFT_MIN_OPEN_TICKS) step(s, frame(lx, lz), config);
		step(s, frame(lx, lz, DRAFT_CONFIRM_BUTTON), config);
		step(s, frame(0, 0), config);
		expect(isDraftOpen(s)).toBe(false);
		expect(t.bonusDeals[0]).toBe(1);
		// the floor change: the floor's deals + the bonus, an ordinary draft (draftKind reset), first deal not a re-deal
		const builds = s.builds!.config;
		const deals = (isBossFloor(f) ? builds.bossFloorDrafts : builds.floorDrafts) + 1;
		step(s, frame(0, 0, DEBUG_FLOOR_BUTTON), config);
		expect(s.endless!.floor).toBe(f + 1);
		expect([me.draftOpen, bp.draftsLeft, t.bonusDeals[0], pactDraftKind(s, 0)]).toEqual([1, deals, 0, NO_PACT]);
		expect(draftRedealt(s, 0)).toBe(false);
	});
});
