// Absolute-tick timers through a mid-floor freeze (docs/FORTUNE.md "Pacts", holdTimers.ts). Greed opens its deal
// mid-floor, so a player browsing it holds the world frozen while another room is engaged. Counted in ticks of LIVE
// play (ticks the world was not frozen), the frozen ticks must cost nothing: the room's FAST par and the Horde's wave-2
// telegraph (trigger to spawn) equal the no-freeze case, solo and co-op (the teammate holds the deal open while player
// 0's room fights). Each timer moves exactly while live. The Goldling has no waiting timer since it hides in its piece
// (docs/GOLDLING_RUMOURS.md GR2): it stays hidden through every freeze, its latched engageTick untouched; a running
// one's field tick still moves.
// Invariants: holdAbsoluteTimers is a no-op without pacts (and the frozen step never calls it there: a no-pacts freeze
// keeps today's behaviour) and on every frozen tick of a pacts run whose drafts all open on a floor change (so such a
// run replays exactly as before).
import { describe, expect, it } from "@rbxts/jest-globals";
import { AffixKind, VaultLock, gridToWorld } from "shared/dungeon";
import {
	DEBUG_FLOOR_BUTTON,
	DRAFT_CONFIRM_BUTTON,
	DRAFT_MIN_OPEN_TICKS,
	DRAFT_SCREEN_RIGHT_X,
	DRAFT_SCREEN_RIGHT_Z,
	EMPTY_INPUT,
	GoldenStatus,
	HORDE_WAVE_PENDING,
	NO_KIND,
	PactKind,
	SHRINE_BUTTON,
	ScoreSource,
	SimCtx,
	TILE_SIZE,
	TREASURE_UNSET,
	VaultStatus,
	affixesOnSpawn,
	cloneSimState,
	createSimState,
	hashState,
	holdAbsoluteTimers,
	isDraftOpen,
	openDealtDraft,
	step,
	stepParty,
	type ActorState,
	type InputFrame,
	type RoomScore,
	type SimState,
} from "shared/sim";
import { floorAltars, frame, pactsSetup, pressPact, skipToFloorAny, teleport } from "shared/run/testing";
import type { EndlessRunFloor, EndlessRunSetup } from "shared/run";

/** The first (run seed, floor) for a party of `party` whose floor has both pact altars and a Goldling. */
function findFortuneFloor(party: number): [number, number] {
	for (let seed = 1; seed <= 200; seed++) {
		const setup = pactsSetup(seed, party);
		for (let floor = 2; floor <= 9; floor++) {
			const w = setup.endlessFloor(floor);
			if (w.pactAltars !== undefined && w.golden !== undefined && w.roomSpawns[w.golden.room].size() > 0)
				return [seed, floor];
		}
	}
	error(`no floor with altars and a Goldling for a party of ${party} (seeds 1-200, floors 2-9)`, 0);
}

/**
 * Room kinds that never spawn a bullet (cloneSimState refuses a run that has spawned one): a room holding only these
 * can be fought while the twin below is cloned.
 */
const BULLETLESS_KINDS: ReadonlyArray<string> = ["swarmer", "charger"];

/** The first room of `w` with spawns, all of BULLETLESS_KINDS (-1: none). */
function bulletlessRoom(w: EndlessRunFloor): number {
	return w.roomSpawns.findIndex((l) => l.size() > 0 && l.every((sp) => BULLETLESS_KINDS.includes(sp.kind)));
}

/**
 * findFortuneFloor(party)'s rule, also wanting a bulletless room (bulletlessRoom) on the floor and the floor before:
 * which kinds a floor's rooms hold is the run's roster (docs/DAILY.md DSD18), so the first fortune floor may hold only
 * shooters.
 */
function findQuietFortuneFloor(party: number): [number, number] {
	for (let seed = 1; seed <= 400; seed++) {
		const setup = pactsSetup(seed, party);
		for (let floor = 2; floor <= 9; floor++) {
			const w = setup.endlessFloor(floor);
			if (w.pactAltars === undefined || w.golden === undefined || w.roomSpawns[w.golden.room].size() === 0)
				continue;
			if (bulletlessRoom(w) >= 0 && bulletlessRoom(setup.endlessFloor(floor - 1)) >= 0) return [seed, floor];
		}
	}
	error(`no quiet floor with altars and a Goldling for a party of ${party} (seeds 1-400, floors 2-9)`, 0);
}

interface Run {
	readonly setup: EndlessRunSetup;
	readonly s: SimState;
	readonly world: EndlessRunFloor;
	/** Ticks of live play stepped so far (ticks that started with no draft open), and frozen ones. */
	live: number;
	frozen: number;
	/** The live-tick count at the tick wave 2 telegraphed / spawned (-1: not yet). */
	trigger: number;
	spawn: number;
}

function newRun(seed: number, floor: number, party: number, pacts = true): Run {
	const setup = pactsSetup(seed, party, pacts);
	const s = createSimState(seed, setup.spawn!.x, setup.spawn!.z, setup.config);
	skipToFloorAny(s, setup.config, floor);
	return { setup, s, world: setup.endlessFloor(floor), live: 0, frozen: 0, trigger: -1, spawn: -1 };
}

/** One tick; `input(i)` is player i's frame (default: idle). Counts live and frozen ticks. */
function tick(r: Run, input: (i: number) => InputFrame = () => frame(0, 0)): void {
	const frozen = isDraftOpen(r.s);
	if (r.s.party === undefined) step(r.s, input(0), r.setup.config);
	else {
		const inputs: InputFrame[] = [];
		for (let i = 0; i < r.s.party.size; i++) inputs.push(input(i));
		stepParty(r.s, inputs, r.setup.config);
	}
	if (frozen) r.frozen++;
	else r.live++;
	const p = r.s.pacts;
	if (p !== undefined && p.events.waveTelegraphed > 0) r.trigger = r.live;
	if (p !== undefined && p.events.waveSpawned > 0) r.spawn = r.live;
}

/** The walk-mask cell of the Goldling room nearest the room's centre (world). */
function goldenRoomCell(w: EndlessRunFloor): [number, number] {
	const g = w.golden!;
	const room = w.config.encounter!.rooms[g.room];
	let best: [number, number] = [room.cx, room.cz];
	let bestD2 = math.huge;
	for (let ly = 0; ly < g.h; ly++)
		for (let lx = 0; lx < g.w; lx++) {
			if (g.walk[ly * g.w + lx] !== 1) continue;
			const x = gridToWorld(g.x0 + lx);
			const z = gridToWorld(g.y0 + ly);
			const d2 = (x - room.cx) * (x - room.cx) + (z - room.cz) * (z - room.cz);
			if (d2 < bestD2) {
				bestD2 = d2;
				best = [x, z];
			}
		}
	return best;
}

function goldenRecord(r: Run): RoomScore {
	return r.s.score!.rooms.find((x) => x.room === r.world.golden!.room)!;
}

function living(r: Run, rec: RoomScore): ActorState[] {
	const out: ActorState[] = [];
	for (let m = 0; m < rec.memberSlots.size(); m++) {
		const a = r.s.combat.actors[rec.memberSlots[m]];
		if (a !== undefined && a.kind !== NO_KIND && a.id === rec.memberIds[m] && a.alive !== 0) out.push(a);
	}
	return out;
}

const kctx = new SimCtx();
function killAll(r: Run, rec: RoomScore): void {
	kctx.bind(r.s, r.world.config, EMPTY_INPUT);
	for (const a of living(r, rec)) kctx.killActor(a);
}

/** Player 0 into the Goldling room for one tick (it engages), then back to the entrance. */
function engageGoldenRoom(r: Run): RoomScore {
	const [x, z] = goldenRoomCell(r.world);
	teleport(r.s, 0, x, z);
	tick(r);
	teleport(r.s, 0, r.world.spawnX, r.world.spawnZ);
	const rec = goldenRecord(r);
	expect(rec.engageTick).toBe(r.s.tick - 1);
	return rec;
}

/** Player `taker` takes Greed (one press tick) and holds the deal open `hold` more ticks, then picks its first card. */
function greedHeld(r: Run, taker: number, hold: number): void {
	const altar = floorAltars(r.setup, r.s)!.altars[PactKind.GREED];
	teleport(r.s, taker, altar.x, altar.z);
	tick(r, (i) => frame(0, 0, i === taker ? SHRINE_BUTTON : 0));
	const me = r.s.run!.players[taker];
	expect(me.draftOpen).toBe(1);
	expect(r.s.pacts!.players[taker].greedTaken).toBe(1);
	for (let k = 0; k < hold; k++) tick(r);
	const lx = -DRAFT_SCREEN_RIGHT_X;
	const lz = -DRAFT_SCREEN_RIGHT_Z;
	while (me.draftTicks + 1 < DRAFT_MIN_OPEN_TICKS) tick(r, (i) => (i === taker ? frame(lx, lz) : frame(0, 0)));
	tick(r, (i) => (i === taker ? frame(lx, lz, DRAFT_CONFIRM_BUTTON) : frame(0, 0)));
	expect(me.draftOpen).toBe(0);
	expect(isDraftOpen(r.s)).toBe(false);
}

interface Timings {
	/** Live ticks from wave 2's trigger to its spawn. */
	telegraph: number;
	/** The Goldling at the end: still hidden (WAITING) with its engageTick the record's tick at the engagement. */
	goldenHidden: boolean;
	/** Live ticks from the engagement to the clear, and FAST's `under` as the sim judged it at the clear. */
	engagedFor: number;
	under: number;
	/** FAST points booked at the clear (the FAST source: x1, HORDE books the other half). */
	fast: number;
	/** Frozen ticks between the trigger and the spawn. */
	frozen: number;
}

/**
 * The scenario: the Horde taken (by the taker), player 0 rouses the Goldling room, wave 1 dies at once (wave 2
 * telegraphs), 10 live ticks later the taker takes Greed and holds the deal `hold` ticks (undefined: no Greed), wave 2
 * spawns and dies at once (the clear); the Goldling stays in its piece throughout (nobody breaks it).
 */
function play(seed: number, floor: number, party: number, hold: number | undefined): Timings {
	const r = newRun(seed, floor, party);
	const taker = party - 1;
	pressPact(r.setup, r.s, PactKind.HORDE, taker);
	const p = r.s.pacts!;
	const g = r.s.golden!;
	expect(p.horde.armed).toBe(1);
	expect(g.status).toBe(GoldenStatus.WAITING);
	const rec = engageGoldenRoom(r);
	const liveEngage = r.live;
	const engaged = rec.engageTick;
	expect(p.horde.room).toBe(r.world.golden!.room);
	expect([g.engageTick, g.appearTick, g.releaseTick]).toEqual([engaged, -1, -1]);
	killAll(r, rec);
	tick(r);
	expect(r.trigger).toBe(r.live);
	const frozenTrigger = r.frozen;
	for (let k = 0; k < 10; k++) tick(r);
	if (hold !== undefined) {
		greedHeld(r, taker, hold);
		expect(p.horde.spawned).toBe(HORDE_WAVE_PENDING); // the freeze fell inside the telegraph
		expect(g.status).toBe(GoldenStatus.WAITING); // and it is still hidden
	}
	for (let k = 0; k < 2000 && r.spawn < 0; k++) tick(r);
	expect(r.spawn > 0).toBe(true);
	const frozen = r.frozen - frozenTrigger;
	const sc = r.s.score!;
	const fast0 = sc.points[ScoreSource.FAST];
	// (a split or a summon can leave members standing: kill until the record clears)
	for (let k = 0; k < 20 && rec.cleared === 0; k++) {
		killAll(r, rec);
		tick(r);
	}
	expect(rec.cleared).toBe(1);
	const engagedFor = r.live - liveEngage;
	const under = rec.parTicks - (r.s.tick - 1 - rec.engageTick);
	const fast = sc.points[ScoreSource.FAST] - fast0;
	for (let k = 0; k < 600; k++) tick(r);
	const goldenHidden = g.status === GoldenStatus.WAITING && g.engageTick === engaged && g.appearTick === -1;
	return { telegraph: r.spawn - r.trigger, goldenHidden, engagedFor, under, fast, frozen };
}

const HOLD = 600;

describe("a mid-floor freeze costs no live-play time (holdAbsoluteTimers)", () => {
	for (const party of [2, 1]) {
		it(`${
			party === 1 ? "solo" : "co-op"
		}: FAST and the wave-2 telegraph equal the no-freeze case; the Goldling stays hidden`, () => {
			const [seed, floor] = findFortuneFloor(party);
			const none = play(seed, floor, party, undefined);
			const brief = play(seed, floor, party, 0);
			const held = play(seed, floor, party, HOLD);
			const w = pactsSetup(seed, party).config;
			for (const t of [none, brief, held]) {
				expect(t.telegraph).toBe(w.pacts!.waveTelegraphTicks);
				expect(t.goldenHidden).toBe(true);
				expect(t.engagedFor).toBe(none.engagedFor);
				expect(t.under).toBe(none.under);
			}
			expect(none.frozen).toBe(0);
			expect(brief.frozen).toBe(DRAFT_MIN_OPEN_TICKS);
			expect(held.frozen).toBe(HOLD + 1); // the hold already passed DRAFT_MIN_OPEN_TICKS: the confirm tick
			// FAST paid, the same with the deal held 10 s as browsed for the minimum (both took the same curse)
			expect(none.under > 0).toBe(true);
			expect(held.fast > 0).toBe(true);
			expect(held.fast).toBe(brief.fast);
		});
	}
});

describe("holdAbsoluteTimers invariants", () => {
	it("moves exactly the live timers: engaged uncleared records, a telegraphed wave, a running Goldling's field, an armed Vengeful ring; never a hidden Goldling's", () => {
		const [seed, floor] = findFortuneFloor(1);
		const r = newRun(seed, floor, 1);
		const rec = engageGoldenRoom(r);
		const sc = r.s.score!;
		const g = r.s.golden!;
		const h = r.s.pacts!.horde;
		// a Vengeful member (surgery), killed: its ring armed
		const a = living(r, rec)[0];
		const slot = r.s.combat.actors.indexOf(a);
		affixesOnSpawn(r.s, slot, a, AffixKind.VENGEFUL);
		kctx.bind(r.s, r.world.config, EMPTY_INPUT);
		kctx.killActor(a);
		const x = r.s.affixes!.slots[slot];
		expect(x.vengeTicks > 0).toBe(true);
		// a telegraphed, unspawned wave (surgery on the horde record)
		h.room = rec.room;
		h.record = sc.rooms.indexOf(rec);
		h.waveDueTick = r.s.tick + 20;
		const engage = sc.rooms.map((q) => q.engageTick);
		const [vArm, due, gEngage, gAppear] = [x.vengeArmTick, h.waveDueTick, g.engageTick, g.appearTick];
		holdAbsoluteTimers(r.s);
		for (let k = 0; k < sc.rooms.size(); k++) {
			const q = sc.rooms[k];
			expect(q.engageTick).toBe(q.engageTick >= 0 && q.cleared === 0 ? engage[k] + 1 : engage[k]);
		}
		expect(rec.engageTick).toBe(engage[sc.rooms.indexOf(rec)] + 1);
		// The hidden Goldling (WAITING) has no timer: its latched engageTick and its appearTick (-1) stay put.
		expect(g.status).toBe(GoldenStatus.WAITING);
		expect([x.vengeArmTick, h.waveDueTick, g.engageTick, g.appearTick]).toEqual([
			vArm + 1,
			due + 1,
			gEngage,
			gAppear,
		]);
		expect(gAppear).toBe(-1);
		// a cleared record, a spawned wave, a fired ring, a Goldling out: only the running field's tick moves
		rec.cleared = 1;
		h.spawned = 0;
		x.vengeTicks = 0;
		g.status = GoldenStatus.RUNNING;
		g.fieldTick = r.s.tick;
		const before = [rec.engageTick, h.waveDueTick, x.vengeArmTick, g.engageTick, g.appearTick, g.fieldTick];
		holdAbsoluteTimers(r.s);
		expect([rec.engageTick, h.waveDueTick, x.vengeArmTick, g.engageTick, g.appearTick, g.fieldTick]).toEqual([
			before[0],
			before[1],
			before[2],
			before[3],
			before[4],
			before[5] + 1,
		]);
	});

	it("without pacts: a no-op, and a frozen tick moves no timer (today's behaviour)", () => {
		const [seed, floor] = findFortuneFloor(2);
		const r = newRun(seed, floor, 2, false);
		expect(r.s.pacts).toBe(undefined);
		const rec = engageGoldenRoom(r);
		const g = r.s.golden!;
		for (let k = 0; k < 5; k++) tick(r);
		expect(g.engageTick).toBe(rec.engageTick);
		const engage = rec.engageTick;
		const gEngage = g.engageTick;
		const h0 = hashState(r.s);
		holdAbsoluteTimers(r.s);
		expect(hashState(r.s)).toBe(h0);
		// a mid-floor draft by surgery (no pact opens one here): the world freezes, the absolute ticks stay put
		expect(openDealtDraft(r.s, 1, [0])).toBe(true);
		const tick0 = r.s.tick;
		for (let k = 0; k < 50; k++) tick(r);
		expect(r.s.tick).toBe(tick0 + 50);
		expect(rec.engageTick).toBe(engage);
		expect([g.engageTick, g.appearTick, g.status]).toEqual([gEngage, -1, GoldenStatus.WAITING]);
	});

	it("with pacts: a no-op on every frozen tick of a run whose drafts all open on a floor change", () => {
		const [seed, floor] = findQuietFortuneFloor(1);
		const r = newRun(seed, floor - 1, 1);
		let checked = 0;
		const checkedTick = (input: (i: number) => InputFrame = () => frame(0, 0)) => {
			if (isDraftOpen(r.s)) {
				const twin = cloneSimState(r.s);
				holdAbsoluteTimers(twin);
				expect(hashState(twin)).toBe(hashState(r.s));
				checked++;
			}
			tick(r, input);
		};
		// fight on the floor before (a room engaged and left standing), then each floor change's draft held and picked
		for (let f = floor - 1; f <= floor; f++) {
			expect(r.s.endless!.floor).toBe(f);
			const w = r.setup.endlessFloor(f);
			const room = bulletlessRoom(w);
			const rm = w.config.encounter!.rooms[room];
			teleport(r.s, 0, rm.cx, rm.cz);
			for (let k = 0; k < 30; k++) checkedTick();
			teleport(r.s, 0, w.spawnX, w.spawnZ);
			checkedTick(() => frame(0, 0, DEBUG_FLOOR_BUTTON));
			expect(isDraftOpen(r.s)).toBe(true);
			for (let k = 0; k < 120; k++) checkedTick();
			const me = r.s.run!.players[0];
			for (let deal = 0; deal < 3 && me.draftOpen !== 0; deal++) {
				const lx = -DRAFT_SCREEN_RIGHT_X;
				const lz = -DRAFT_SCREEN_RIGHT_Z;
				while (me.draftTicks + 1 < DRAFT_MIN_OPEN_TICKS) checkedTick(() => frame(lx, lz));
				checkedTick(() => frame(lx, lz, DRAFT_CONFIRM_BUTTON));
			}
			expect(isDraftOpen(r.s)).toBe(false);
		}
		expect(checked > 2 * 120).toBe(true);
		expect(r.s.pacts!.taken).toEqual([0, 0]);
	});
});

/** The first (run seed, floor) solo whose floor has both pact altars and a vault with lock `lock` (main's treasure). */
function findVaultAltarFloor(lock: number): [number, number] {
	for (let seed = 1; seed <= 200; seed++) {
		const setup = pactsSetup(seed, 1);
		for (let floor = 2; floor <= 9; floor++) {
			const w = setup.endlessFloor(floor);
			if (w.pactAltars !== undefined && w.vault !== undefined && w.vault.lock === lock) return [seed, floor];
		}
	}
	error(`no floor with altars and a vault (lock ${lock}) (seeds 1-200, floors 2-9)`, 0);
}

describe("holdAbsoluteTimers and treasure rooms' vault (docs/TREASURE.md x docs/FORTUNE.md)", () => {
	it("a Greed freeze with the vault room engaged: armTick stays the record's engageTick, SWIFT's countdown holds", () => {
		const [seed, floor] = findVaultAltarFloor(VaultLock.SWIFT);
		const r = newRun(seed, floor, 1);
		const t = r.s.treasure!;
		expect(t.status).toBe(VaultStatus.SEALED);
		// stand in front of the chest for one tick (the vault room engages, the lock arms), then back to the entrance
		teleport(r.s, 0, t.x + t.fx * 1.7 * TILE_SIZE, t.z + t.fz * 1.7 * TILE_SIZE);
		tick(r);
		teleport(r.s, 0, r.world.spawnX, r.world.spawnZ);
		expect(t.status).toBe(VaultStatus.ARMED);
		const rec = r.s.score!.rooms[t.record];
		expect(t.armTick).toBe(rec.engageTick);
		for (let k = 0; k < 5; k++) tick(r);
		const left = t.ticksLeft;
		const frozen0 = r.frozen;
		greedHeld(r, 0, HOLD);
		const frozen = r.frozen - frozen0;
		expect(frozen).toBe(HOLD + 1);
		// the live ticks of the take and the pick are the only ones the countdown saw
		expect(t.ticksLeft).toBe(left - (r.live - 6));
		expect(t.armTick).toBe(rec.engageTick);
		expect(t.status).toBe(VaultStatus.ARMED);
	});

	it("moves a live lock's armTick / crackTick only (ARMED, CRACKED), never a sealed, unlocked or opened vault's", () => {
		const [seed, floor] = findVaultAltarFloor(VaultLock.SWIFT);
		const r = newRun(seed, floor, 1);
		const t = r.s.treasure!;
		const live = (status: number, arm: number, crack: number) => {
			t.status = status;
			t.armTick = arm;
			t.crackTick = crack;
			holdAbsoluteTimers(r.s);
			return [t.armTick, t.crackTick];
		};
		expect(live(VaultStatus.SEALED, TREASURE_UNSET, TREASURE_UNSET)).toEqual([TREASURE_UNSET, TREASURE_UNSET]);
		expect(live(VaultStatus.ARMED, 40, TREASURE_UNSET)).toEqual([41, TREASURE_UNSET]);
		expect(live(VaultStatus.CRACKED, 40, 90)).toEqual([41, 91]);
		expect(live(VaultStatus.UNLOCKED, 40, 90)).toEqual([40, 90]);
		expect(live(VaultStatus.OPENED, 40, 90)).toEqual([40, 90]);
	});
});
