// Treasure room sounds in the cue mapper (docs/TREASURE.md TR8): the crack, the unlock's rattle and the open's sting
// on the vault look's edges (TreasureCueTracker: the crack's frame, the bars' sink 0.6 s after the clear, the lid's pop
// 0.25 s after the open), the sting's tier pitch (0 / +3 / +7 semitones), a Legendary's jingle (ducks the music, ranked
// under the new-best fanfare and over the room clear's jingles), the silent fallbacks, and the open's boosts playing no
// sfx.boost.drop.
import { describe, expect, it } from "@rbxts/jest-globals";
import { VaultLock, VaultTier } from "shared/dungeon";
import {
	ALL_EVENT_FIELDS,
	COMBO_MIN,
	ENDLESS_TREASURE_CONFIG,
	SIM_HZ,
	TREASURE_UNSET,
	VaultStatus,
	clearTreasureEvents,
	createSimState,
	createTreasureState,
	eventDefault,
	type SimEvents,
	type SimState,
	type TreasureState,
} from "shared/sim";
import { TREASURE_AUDIO_IDS } from "shared/theme";
import { BoostFrameEvents, NO_BOOST_EVENTS, type BoostEventSource } from "shared/view/boosts";
import { FxEventBuffer, NO_BUILD_FX_EVENTS, NO_COMBO_EVENTS, NO_VARIANT_CUES } from "shared/view/fx";
import { NO_DAILY_RANK_CUES, NO_NEW_BEST_CUES, semitonesToSpeed, type NewBestCueSource } from "shared/view/hud";
import { NO_PELLET_EVENTS } from "shared/view/pellets";
import {
	NO_TREASURE_CUES,
	NO_TREASURE_OPEN,
	TREASURE_VIEW,
	TreasureCueTracker,
	TreasureFrameEvents,
	type TreasureCueSource,
} from "shared/view/treasure";
import {
	ALL_SFX,
	AudioCueList,
	AudioCueMapper,
	DUCKING_SFX,
	JINGLE_SFX,
	PORT_SFX,
	SFX,
	SFX_FALLBACK,
	SFX_PRIORITY,
	treasureOpenSpeed,
	type Playable,
} from ".";

const NO_FX = new FxEventBuffer(1);

function noEvents(): SimEvents {
	const e = {} as SimEvents;
	for (const f of ALL_EVENT_FIELDS) e[f] = eventDefault(f);
	return e;
}

interface Fake {
	endless?: { floor: number };
	score?: { combo: number; total: number; rooms: Array<{ cleared: number }> };
}

/** A solo endless-ish state: a floor, one room record, the combo at x1.0. */
function endlessState(): [SimState, Fake] {
	const s = createSimState(1, 0, 0);
	const fake = s as unknown as Fake;
	fake.endless = { floor: 3 };
	fake.score = { combo: COMBO_MIN, total: 0, rooms: [{ cleared: 0 }] };
	return [s, fake];
}

function cues(crack: boolean, unlock: boolean, openTier = NO_TREASURE_OPEN): TreasureCueSource {
	return { crack, unlock, openTier };
}

/** One mapper frame: [id, volume, speed] per cue. */
function frame(
	m: AudioCueMapper,
	now: number,
	s: SimState,
	treasure: TreasureCueSource,
	opts: { boosts?: BoostEventSource; newBest?: NewBestCueSource } = {},
): Array<[string, number, number]> {
	const out = m.frame(
		now,
		noEvents(),
		NO_FX,
		s,
		0,
		new AudioCueList(),
		opts.boosts ?? NO_BOOST_EVENTS,
		NO_COMBO_EVENTS,
		undefined,
		NO_VARIANT_CUES,
		opts.newBest ?? NO_NEW_BEST_CUES,
		NO_BUILD_FX_EVENTS,
		NO_DAILY_RANK_CUES,
		NO_PELLET_EVENTS,
		treasure,
	);
	const list: Array<[string, number, number]> = [];
	for (let i = 0; i < out.size(); i++) list.push([out.id(i), out.volume(i), out.speed(i)]);
	return list;
}

function ids(list: Array<[string, number, number]>): string[] {
	return list.map((c) => c[0]);
}

/** A mapper that has seen `s` once (the watch's baseline frame). */
function primed(s: SimState, playable?: Playable): AudioCueMapper {
	const m = new AudioCueMapper(playable);
	frame(m, 0, s, NO_TREASURE_CUES);
	return m;
}

describe("treasure cues: the IDs", () => {
	it("are the theme's port audio events, listed, ranked, with one-step fallbacks", () => {
		const mine = [SFX.treasureCrack, SFX.treasureUnlock, SFX.treasureOpen, SFX.jingleTreasure];
		expect([...TREASURE_AUDIO_IDS].sort()).toEqual([...mine].sort());
		for (const id of mine) {
			expect(ALL_SFX.includes(id)).toBe(true);
			expect(PORT_SFX.includes(id)).toBe(true);
		}
		expect(SFX_FALLBACK[SFX.treasureCrack]).toBe(SFX.comboBreak);
		expect(SFX_FALLBACK[SFX.treasureUnlock]).toBe(SFX.stairwellOpen);
		expect(SFX_FALLBACK[SFX.treasureOpen]).toBe(SFX.relicTake);
		expect(SFX_FALLBACK[SFX.jingleTreasure]).toBe(SFX.roomPerfect);
		// The jingle ducks the music and is one; the stings are neither.
		expect(DUCKING_SFX.includes(SFX.jingleTreasure)).toBe(true);
		expect(JINGLE_SFX.includes(SFX.jingleTreasure)).toBe(true);
		for (const id of [SFX.treasureCrack, SFX.treasureUnlock, SFX.treasureOpen]) {
			expect(DUCKING_SFX.includes(id)).toBe(false);
			expect(JINGLE_SFX.includes(id)).toBe(false);
		}
	});

	it("rank the jingle under the new-best fanfare and over the room clear's jingles", () => {
		expect(SFX_PRIORITY[SFX.jingleTreasure]).toBe(73);
		expect(SFX_PRIORITY[SFX.jingleTreasure] < SFX_PRIORITY[SFX.bestNew]).toBe(true);
		expect(SFX_PRIORITY[SFX.jingleTreasure] > SFX_PRIORITY[SFX.roomClear]).toBe(true);
		expect(SFX_PRIORITY[SFX.jingleTreasure] > SFX_PRIORITY[SFX.roomPerfect]).toBe(true);
	});
});

describe("treasure cues: the mapper", () => {
	it("no edges: nothing (the default: every frame without a vault)", () => {
		const [s] = endlessState();
		const m = primed(s);
		expect(frame(m, 1, s, NO_TREASURE_CUES)).toEqual([]);
		expect(new AudioCueMapper().frame(0, noEvents(), NO_FX, s, 0, new AudioCueList()).size()).toBe(0);
	});

	it("the crack and the rattle play once on their edges at full volume, the pack's jitter", () => {
		const [s] = endlessState();
		const m = primed(s);
		expect(frame(m, 1, s, cues(true, false))).toEqual([[SFX.treasureCrack, 1, 0]]);
		expect(frame(m, 2, s, cues(false, true))).toEqual([[SFX.treasureUnlock, 1, 0]]);
		// inside the 0.5 s minimum interval a second edge is dropped
		expect(frame(m, 2.1, s, cues(false, true))).toEqual([]);
	});

	it("the sting is pitched by tier: Common 0, Rare +3, Legendary +7 semitones (exact speed)", () => {
		expect(TREASURE_VIEW.audio.openSemitones).toEqual([0, 3, 7]);
		expect(treasureOpenSpeed(VaultTier.COMMON)).toBe(1);
		expect(treasureOpenSpeed(VaultTier.RARE)).toBe(semitonesToSpeed(3));
		expect(treasureOpenSpeed(VaultTier.LEGENDARY)).toBe(semitonesToSpeed(7));
		expect(treasureOpenSpeed(9)).toBe(1);
		const [s] = endlessState();
		const m = primed(s);
		expect(frame(m, 1, s, cues(false, false, VaultTier.COMMON))).toEqual([[SFX.treasureOpen, 1, 1]]);
		expect(frame(m, 2, s, cues(false, false, VaultTier.RARE))).toEqual([
			[SFX.treasureOpen, 1, semitonesToSpeed(3)],
		]);
	});

	it("a Legendary also plays sfx.jingle.treasure; Common and Rare do not", () => {
		const [s] = endlessState();
		const m = primed(s);
		const legendary = frame(m, 1, s, cues(false, false, VaultTier.LEGENDARY));
		expect(legendary).toEqual([
			[SFX.treasureOpen, 1, semitonesToSpeed(7)],
			[SFX.jingleTreasure, 1, 0],
		]);
		expect(ids(frame(m, 2, s, cues(false, false, VaultTier.RARE)))).toEqual([SFX.treasureOpen]);
	});

	it("the jingle beats a room clear's jingle on a shared frame and yields to the new-best fanfare", () => {
		const [s, fake] = endlessState();
		const m = primed(s);
		fake.score!.rooms[0].cleared = 1;
		expect(ids(frame(m, 1, s, cues(false, false, VaultTier.LEGENDARY)))).toEqual([
			SFX.treasureOpen,
			SFX.jingleTreasure,
		]);
		const [s2, fake2] = endlessState();
		const m2 = primed(s2);
		fake2.score!.rooms[0].cleared = 1;
		const fanfare: NewBestCueSource = { fanfare: true, recordFloor: 0, recordRun: false };
		expect(ids(frame(m2, 1, s2, cues(false, false, VaultTier.LEGENDARY), { newBest: fanfare }))).toEqual([
			SFX.bestNew,
			SFX.treasureOpen,
		]);
	});

	it("silent: each falls back one step (the sting keeps its tier pitch), else nothing", () => {
		const silent = new Set<string>([SFX.treasureCrack, SFX.treasureUnlock, SFX.treasureOpen, SFX.jingleTreasure]);
		const [s] = endlessState();
		const m = primed(s, (id) => !silent.has(id));
		expect(ids(frame(m, 1, s, cues(true, false)))).toEqual([SFX.comboBreak]);
		expect(ids(frame(m, 2, s, cues(false, true)))).toEqual([SFX.stairwellOpen]);
		expect(frame(m, 3, s, cues(false, false, VaultTier.LEGENDARY))).toEqual([
			[SFX.relicTake, 1, semitonesToSpeed(7)],
			[SFX.roomPerfect, 1, 0],
		]);
		for (const id of [SFX.comboBreak, SFX.stairwellOpen, SFX.relicTake, SFX.roomPerfect, SFX.roomClear])
			silent.add(id);
		const none = primed(s, (id) => !silent.has(id));
		expect(frame(none, 4, s, cues(true, true, VaultTier.LEGENDARY))).toEqual([]);
	});

	it("the open's boosts (fromChest landings) play no sfx.boost.drop; a kill drop on the same frame still does", () => {
		const [s] = endlessState();
		const m = primed(s);
		const chest = new BoostFrameEvents();
		const landing = { slot: 0, kind: 1, x: 2, z: 3 };
		chest.dropped.push(landing, { slot: 1, kind: 2, x: 2, z: 3 });
		chest.fromChest.push({ ...landing, spawnTick: 10 }, { slot: 1, kind: 2, x: 2, z: 3, spawnTick: 10 });
		expect(frame(m, 1, s, NO_TREASURE_CUES, { boosts: chest })).toEqual([]);
		chest.dropped.push({ slot: 2, kind: 0, x: 9, z: 9 });
		expect(ids(frame(m, 2, s, NO_TREASURE_CUES, { boosts: chest }))).toEqual([SFX.boostDrop]);
	});
});

// --- TreasureCueTracker: the look's timing -------------------------------------------------------------------------

/** A sealed Legendary UNTOUCHED vault (room 3, slot 9). */
function sealed(): TreasureState {
	const t = createTreasureState(ENDLESS_TREASURE_CONFIG, 7, 1);
	t.status = VaultStatus.SEALED;
	t.room = 3;
	t.record = 2;
	t.slot = 9;
	t.x = 10.5;
	t.z = 4.5;
	t.fx = 0;
	t.fz = 1;
	t.lock = VaultLock.UNTOUCHED;
	t.startTier = VaultTier.LEGENDARY;
	t.tier = VaultTier.LEGENDARY;
	return t;
}

/** Hand-stepped vault ticks, one frame per tick, through a TreasureCueTracker (vault.spec.ts's Driver pattern). */
class CueDriver {
	readonly tracker = new TreasureCueTracker();
	readonly frame = new TreasureFrameEvents();
	tick = 100;
	readonly state: { tick: number; treasure: TreasureState };

	constructor(readonly t: TreasureState) {
		this.state = { tick: this.tick, treasure: t };
	}

	/** One tick with `change`, then its frame's edges. */
	step(change?: (t: TreasureState) => void): TreasureCueSource {
		this.tick += 1;
		this.state.tick = this.tick;
		clearTreasureEvents(this.t);
		if (change !== undefined) change(this.t);
		this.frame.collect(this.state as unknown as SimState);
		const edges = this.tracker.update(this.state as unknown as SimState, this.frame, this.tick / SIM_HZ);
		const copy = { crack: edges.crack, unlock: edges.unlock, openTier: edges.openTier };
		this.frame.reset();
		return copy;
	}

	/** Ticks until an edge matching `pick` fires (at most `max`): the ticks it took, or -1. */
	until(pick: (e: TreasureCueSource) => boolean, max: number): number {
		for (let i = 1; i <= max; i++) if (pick(this.step())) return i;
		return -1;
	}
}

describe("treasure cues: TreasureCueTracker follows the look", () => {
	it("crack on its frame, the rattle 0.6 s after the clear, the sting 0.25 s after the open; each once", () => {
		const d = new CueDriver(sealed());
		d.step((t) => {
			t.status = VaultStatus.ARMED;
			t.armTick = d.tick;
			t.allowance = 0;
			t.events.armed = 1;
		});
		const crack = d.step((t) => {
			t.status = VaultStatus.CRACKED;
			t.tier = VaultTier.RARE;
			t.crackTick = d.tick;
			t.events.cracked = 1;
		});
		expect(crack).toEqual({ crack: true, unlock: false, openTier: NO_TREASURE_OPEN });
		const clear = d.step((t) => {
			t.status = VaultStatus.UNLOCKED;
			t.missBy = 1;
			t.events.unlocked = 1;
		});
		expect(clear.unlock).toBe(false);
		const rattleTicks = d.until((e) => e.unlock, 2 * SIM_HZ);
		// The bars start delaySec after the clear's tick (one tick of float slack on the sim clock's division).
		expect(math.abs(rattleTicks - TREASURE_VIEW.unlock.delaySec * SIM_HZ) <= 1).toBe(true);
		expect(d.until((e) => e.unlock || e.crack, SIM_HZ)).toBe(-1);
		const open = d.step((t) => {
			t.status = VaultStatus.OPENED;
			t.events.opened = {
				opener: 0,
				tier: t.tier,
				startTier: t.startTier,
				lock: t.lock,
				kept: 0,
				missBy: 1,
				spare: TREASURE_UNSET,
				points: 800,
				grants: [],
			};
		});
		expect(open.openTier).toBe(NO_TREASURE_OPEN);
		const popTicks = d.until((e) => e.openTier !== NO_TREASURE_OPEN, SIM_HZ);
		expect(math.abs(popTicks - TREASURE_VIEW.open.popSec * SIM_HZ) <= 1).toBe(true);
		expect(d.until((e) => e.openTier !== NO_TREASURE_OPEN, 2 * SIM_HZ)).toBe(-1);
	});

	it("the pop carries the opened tier (a kept Legendary: the jingle's tier)", () => {
		const d = new CueDriver(sealed());
		d.step((t) => {
			t.status = VaultStatus.UNLOCKED;
			t.spare = 0;
			t.events.unlocked = 1;
		});
		d.step((t) => {
			t.status = VaultStatus.OPENED;
			t.events.opened = {
				opener: 0,
				tier: VaultTier.LEGENDARY,
				startTier: VaultTier.LEGENDARY,
				lock: t.lock,
				kept: 1,
				missBy: TREASURE_UNSET,
				spare: 0,
				points: 1500,
				grants: [],
			};
		});
		let tier = NO_TREASURE_OPEN;
		for (let i = 0; i < SIM_HZ && tier === NO_TREASURE_OPEN; i++) tier = d.step().openTier;
		expect(tier).toBe(VaultTier.LEGENDARY);
	});

	it("a vault met mid-way (already opened, already unlocked) is silent; no vault, no edges", () => {
		const t = sealed();
		t.status = VaultStatus.OPENED;
		const d = new CueDriver(t);
		expect(d.until((e) => e.crack || e.unlock || e.openTier !== NO_TREASURE_OPEN, 2 * SIM_HZ)).toBe(-1);
		const u = sealed();
		u.status = VaultStatus.UNLOCKED;
		const d2 = new CueDriver(u);
		expect(d2.until((e) => e.unlock || e.openTier !== NO_TREASURE_OPEN, 2 * SIM_HZ)).toBe(-1);
		const none = new TreasureCueTracker();
		const edges = none.update(
			{ tick: 5, treasure: undefined } as unknown as SimState,
			new TreasureFrameEvents(),
			1,
		);
		expect([edges.crack, edges.unlock, edges.openTier]).toEqual([false, false, NO_TREASURE_OPEN]);
		expect(NO_TREASURE_CUES).toEqual({ crack: false, unlock: false, openTier: NO_TREASURE_OPEN });
	});
});
