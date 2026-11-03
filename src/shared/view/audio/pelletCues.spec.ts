// Pellet sounds (docs/PELLETS.md PL7): the chomp alternates two pitches and plays once per frame however many pellets
// were eaten, never inside its minimum interval; a teammate's chomp is quieter; a sweep plays its sting; the power pellet
// is a player sound of its picker. The three IDs are the theme's port audio events.
import { describe, expect, it } from "@rbxts/jest-globals";
import { ALL_EVENT_FIELDS, createSimState, eventDefault, type SimEvents, type SimState } from "shared/sim";
import { PELLET_AUDIO_IDS } from "shared/theme";
import { FxEventBuffer } from "shared/view/fx";
import { PELLETS_VIEW, PelletFrameEvents } from "shared/view/pellets";
import {
	ALL_SFX,
	AUDIO_VIEW,
	AudioCueList,
	AudioCueMapper,
	PORT_SFX,
	SFX,
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

	it("the chomp: once per frame for several pellets, alternating the two speeds, never inside its interval", () => {
		const s = createSimState(1, 0, 0);
		const m = new AudioCueMapper();
		const [a, b] = [PELLETS_VIEW.audio.eatSpeeds[0], PELLETS_VIEW.audio.eatSpeeds[1]];
		expect(a).never.toBe(b);
		const gap = PELLETS_VIEW.audio.eatMinIntervalSec;
		expect(m.intervalOf(SFX.pelletEat)).toBe(gap);
		expect(frame(m, 0, s, eaten([0, 0, 0]))).toEqual([[SFX.pelletEat, 1, a]]);
		// Inside the interval: nothing, and the toggle stays.
		expect(frame(m, gap / 2, s, eaten([0]))).toEqual([]);
		expect(frame(m, gap, s, eaten([0]))).toEqual([[SFX.pelletEat, 1, b]]);
		expect(frame(m, 2 * gap, s, eaten([0]))).toEqual([[SFX.pelletEat, 1, a]]);
		// No pellet, no chomp; a new run starts on the first speed again.
		expect(frame(m, 3 * gap, s, new PelletFrameEvents())).toEqual([]);
		frame(m, 4 * gap, s, eaten([0]));
		m.reset();
		expect(frame(m, 5 * gap, s, eaten([0]))).toEqual([[SFX.pelletEat, 1, a]]);
	});

	it("co-op: a teammate's chomp is quieter and lower-ranked; one of the local player's is full volume", () => {
		const s = createSimState(1, 0, 0, { party: { size: 2 } });
		const m = new AudioCueMapper();
		const quiet = frame(m, 0, s, eaten([1]), 0);
		expect(quiet).toEqual([[SFX.pelletEat, AUDIO_VIEW.teammateVolume, PELLETS_VIEW.audio.eatSpeeds[0]]]);
		expect(SFX_PRIORITY[SFX.pelletEat] - TEAMMATE_PRIORITY_DROP < SFX_PRIORITY[SFX.pelletEat]).toBe(true);
		const loud = frame(m, 1, s, eaten([1, 0]), 0);
		expect(loud[0][1]).toBe(1);
	});

	it("a silent chomp (no clip) queues nothing and keeps the toggle", () => {
		const s = createSimState(1, 0, 0);
		let on = false;
		const m = new AudioCueMapper((id) => id !== SFX.pelletEat || on);
		expect(frame(m, 0, s, eaten([0]))).toEqual([]);
		on = true;
		expect(frame(m, 1, s, eaten([0]))).toEqual([[SFX.pelletEat, 1, PELLETS_VIEW.audio.eatSpeeds[0]]]);
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
