// Pellet sounds (docs/PELLETS.md PL7): the chomp climbs the room's ladder (pelletEatSpeed) and plays once per frame however many pellets
// were eaten, never inside its minimum interval; a teammate's chomp is quieter; a sweep plays its sting; the power pellet
// is a player sound of its picker. The three IDs are the theme's port audio events.
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	ALL_EVENT_FIELDS,
	createSimState,
	eventDefault,
	type PelletsState,
	type SimEvents,
	type SimState,
} from "shared/sim";
import { PELLET_AUDIO_IDS } from "shared/theme";
import { FxEventBuffer } from "shared/view/fx";
import { PELLETS_VIEW, PelletFrameEvents, pelletEatSpeed } from "shared/view/pellets";
import {
	ALL_SFX,
	AUDIO_VIEW,
	AudioCueList,
	AudioCueMapper,
	PORT_SFX,
	SFX,
	SFX_FALLBACK,
	SFX_PRIORITY,
	TEAMMATE_PRIORITY_DROP,
} from ".";
import { NO_BOOST_EVENTS } from "shared/view/boosts";
import { NO_DAILY_RANK_CUES, NO_NEW_BEST_CUES } from "shared/view/hud";
import { NO_BUILD_FX_EVENTS, NO_COMBO_EVENTS, NO_VARIANT_CUES } from "shared/view/fx";

function noEvents(): SimEvents {
	const e = {} as SimEvents;
	for (const f of ALL_EVENT_FIELDS) e[f] = eventDefault(f);
	return e;
}

const NO_FX = new FxEventBuffer(4);

/** One mapper frame with `pellets`: [id, volume, speed] per cue. */
function frame(
	m: AudioCueMapper,
	now: number,
	s: SimState,
	pellets: PelletFrameEvents,
	me = 0,
	events: SimEvents = noEvents(),
): Array<[string, number, number]> {
	const out = m.frame(
		now,
		events,
		NO_FX,
		s,
		me,
		new AudioCueList(),
		NO_BOOST_EVENTS,
		NO_COMBO_EVENTS,
		undefined,
		NO_VARIANT_CUES,
		NO_NEW_BEST_CUES,
		NO_BUILD_FX_EVENTS,
		NO_DAILY_RANK_CUES,
		pellets,
	);
	const list: Array<[string, number, number]> = [];
	for (let i = 0; i < out.size(); i++) list.push([out.id(i), out.volume(i), out.speed(i)]);
	return list;
}

function eaten(players: number[]): PelletFrameEvents {
	const ev = new PelletFrameEvents();
	for (let i = 0; i < players.size(); i++) ev.eaten.push({ index: i, x: i, z: 0, player: players[i], points: 5 });
	return ev;
}

/** `s` with one pellet room of `count` regular pellets, `left` of them still on the floor (pellets 0..count-1). */
function withRoom(s: SimState, count: number, left: number): SimState {
	const rec: number[] = [];
	const taken: number[] = [];
	for (let i = 0; i < count; i++) {
		rec.push(0);
		taken.push(0);
	}
	s.pellets = {
		rec,
		taken,
		power: -1,
		rooms: [{ first: 0, span: count, count, left, phase: 1, swept: 0 }],
	} as unknown as PelletsState;
	setLeft(s, left);
	return s;
}

/** The room's `left` and the pellets it leaves on the floor (the first count - left taken): the ladder counts both. */
function setLeft(s: SimState, left: number): void {
	const p = s.pellets!;
	const room = p.rooms[0];
	room.left = left;
	for (let i = 0; i < room.count; i++) p.taken[i] = i < room.count - left ? 1 : 0;
}

describe("audio: pellets (docs/PELLETS.md PL7)", () => {
	it("the three IDs are the theme's port audio events, ranked, in ALL_SFX and PORT_SFX", () => {
		const ids = [SFX.pelletEat, SFX.pelletSweep, SFX.pelletPower];
		expect([...ids] as string[]).toEqual([...PELLET_AUDIO_IDS]);
		for (const id of ids) {
			expect([id, ALL_SFX.includes(id), PORT_SFX.includes(id), SFX_PRIORITY[id] > 0]).toEqual([
				id,
				true,
				true,
				true,
			]);
		}
	});

	it("the chomp: once per frame for several pellets, climbing the room's ladder, never inside its interval", () => {
		const n = PELLETS_VIEW.audio.ladderSemitones.size();
		const s = withRoom(createSimState(1, 0, 0), n, n);
		const m = new AudioCueMapper();
		const gap = PELLETS_VIEW.audio.eatMinIntervalSec;
		expect(m.intervalOf(SFX.pelletEat)).toBe(gap);
		// Three pellets on one frame: one chomp at the room's progress after the frame (3 of n taken).
		setLeft(s, n - 3);
		expect(frame(m, 0, s, eaten([0, 0, 0]))).toEqual([[SFX.pelletEat, 1, pelletEatSpeed(3, n)]]);
		// Inside the interval: nothing.
		setLeft(s, n - 4);
		expect(frame(m, gap / 2, s, eaten([0]))).toEqual([]);
		// Every later pellet a step higher, the last one the octave.
		let prev = pelletEatSpeed(3, n);
		for (let k = 5; k <= n; k++) {
			setLeft(s, n - k);
			const out = frame(m, k * gap, s, eaten([0]));
			expect(out).toEqual([[SFX.pelletEat, 1, pelletEatSpeed(k, n)]]);
			expect(out[0][2] > prev).toBe(true);
			prev = out[0][2];
		}
		expect(prev).toBe(2);
		// No pellet, no chomp; without pellet state (an unknown room) the root.
		expect(frame(m, 100, s, new PelletFrameEvents())).toEqual([]);
		expect(frame(m, 101, createSimState(1, 0, 0), eaten([0]))).toEqual([[SFX.pelletEat, 1, 1]]);
	});

	it("co-op: a teammate's chomp is quieter and lower-ranked; one of the local player's is full volume", () => {
		const s = createSimState(1, 0, 0, { party: { size: 2 } });
		const m = new AudioCueMapper();
		const quiet = frame(m, 0, s, eaten([1]), 0);
		expect(quiet).toEqual([[SFX.pelletEat, AUDIO_VIEW.teammateVolume, 1]]);
		expect(SFX_PRIORITY[SFX.pelletEat] - TEAMMATE_PRIORITY_DROP < SFX_PRIORITY[SFX.pelletEat]).toBe(true);
		const loud = frame(m, 1, s, eaten([1, 0]), 0);
		expect(loud[0][1]).toBe(1);
	});

	it("co-op: a teammate's pellet climbs the shared room's ladder; the local player's pellet sets the pitch", () => {
		const s = withRoom(createSimState(1, 0, 0, { party: { size: 2 } }), 10, 6);
		const m = new AudioCueMapper();
		expect(frame(m, 0, s, eaten([1]), 0)).toEqual([
			[SFX.pelletEat, AUDIO_VIEW.teammateVolume, pelletEatSpeed(4, 10)],
		]);
	});

	it("a silent chomp plays the tally tick at the ladder's speed; with neither clip, nothing", () => {
		expect([SFX_FALLBACK[SFX.pelletEat], SFX_FALLBACK[SFX.pelletSweep], SFX_FALLBACK[SFX.pelletPower]]).toEqual([
			SFX.scoreTick,
			SFX.comboTier,
			SFX.playerParry,
		]);
		const s = withRoom(createSimState(1, 0, 0), 8, 2);
		let tick = false;
		const m = new AudioCueMapper((id) => id !== SFX.pelletEat && (id !== SFX.scoreTick || tick));
		expect(frame(m, 0, s, eaten([0]))).toEqual([]);
		tick = true;
		expect(frame(m, 1, s, eaten([0]))).toEqual([[SFX.scoreTick, 1, pelletEatSpeed(6, 8)]]);
		const ev = new PelletFrameEvents();
		ev.swept.push(0);
		ev.power.push({ player: 0, px: 0, pz: 0, x: [], z: [], points: 0, tick: 1 });
		const silent = new AudioCueMapper((id) => id !== SFX.pelletSweep && id !== SFX.pelletPower);
		expect(frame(silent, 0, createSimState(1, 0, 0), ev)).toEqual([
			[SFX.comboTier, 1, 0],
			[SFX.playerParry, 1, 0],
		]);
	});

	it("a sweep plays its sting once; the power pellet is its picker's player sound", () => {
		const s = createSimState(1, 0, 0, { party: { size: 2 } });
		const m = new AudioCueMapper();
		const ev = new PelletFrameEvents();
		ev.swept.push(0, 3);
		ev.power.push({ player: 1, px: 0, pz: 0, x: [1], z: [1], points: 5, tick: 3 });
		const out = frame(m, 0, s, ev, 0);
		expect(out).toEqual([
			[SFX.pelletSweep, 1, 0],
			[SFX.pelletPower, AUDIO_VIEW.teammateVolume, 0],
		]);
		const solo = createSimState(1, 0, 0);
		const own = new PelletFrameEvents();
		own.power.push({ player: 0, px: 0, pz: 0, x: [], z: [], points: 0, tick: 1 });
		expect(frame(new AudioCueMapper(), 0, solo, own)).toEqual([[SFX.pelletPower, 1, 0]]);
	});

	it("the power pellet's erases (in bulletsDeleted, docs/PELLETS.md PL4) never play the deflect, solo or co-op", () => {
		const deleted = (n: number): SimEvents => {
			const e = noEvents();
			e.bulletsDeleted = n;
			return e;
		};
		const power = (n: number): PelletFrameEvents => {
			const ev = new PelletFrameEvents();
			const x: number[] = [];
			for (let i = 0; i < n; i++) x.push(i);
			ev.power.push({ player: 0, px: 0, pz: 0, x, z: x, points: 5 * n, tick: 1 });
			return ev;
		};
		const ids = (out: Array<[string, number, number]>) => out.map((c) => c[0]);
		const solo = createSimState(1, 0, 0);
		expect(ids(frame(new AudioCueMapper(), 0, solo, power(3), 0, deleted(3)))).toEqual([SFX.pelletPower]);
		// One more deleted than the power pellet erased: a real deflect on the same frame.
		expect(ids(frame(new AudioCueMapper(), 0, solo, power(3), 0, deleted(4)))).toEqual([
			SFX.playerDeflect,
			SFX.pelletPower,
		]);
		// Co-op (the deflect is placed by the watch): no deflect, the local player's nor a teammate's.
		const party = createSimState(1, 0, 0, { party: { size: 2 } });
		expect(ids(frame(new AudioCueMapper(), 0, party, power(2), 0, deleted(2)))).toEqual([SFX.pelletPower]);
		expect(ids(frame(new AudioCueMapper(), 0, party, new PelletFrameEvents(), 0, deleted(2)))).toEqual([
			SFX.playerDeflect,
		]);
	});
});
