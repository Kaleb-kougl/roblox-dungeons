// The new-best celebration's sounds in the cue mapper (docs/NEW_BEST.md NB5): the fanfare on the tracker's edges (a
// jingle over the room clear's, NBD7), the first floor past the deepest dropping its floor enter, the run-over jingle
// swap on a record run only, the silent fallbacks (fanfare -> PERFECT, record -> game over), the IDs' ranks / jingle /
// duck / theme listing, and a real NewBestTracker driving the mapper.
import { describe, expect, it } from "@rbxts/jest-globals";
import { ALL_EVENT_FIELDS, COMBO_MIN, createSimState, eventDefault, type SimEvents, type SimState } from "shared/sim";
import { PORT_AUDIO_EVENTS } from "shared/theme";
import { NO_BOOST_EVENTS } from "../boosts";
import { NO_COMBO_EVENTS, NO_VARIANT_CUES } from "../fx";
import { FxEventBuffer } from "../fx/events";
import { NO_NEW_BEST_CUES, NewBestTracker, type NewBestCueSource } from "../hud";
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
	runOverJingle,
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
function endlessState(floor: number): [SimState, Fake] {
	const s = createSimState(1, 0, 0);
	const fake = s as unknown as Fake;
	fake.endless = { floor };
	fake.score = { combo: COMBO_MIN, total: 0, rooms: [{ cleared: 0 }] };
	return [s, fake];
}

function cues(fanfare: boolean, recordFloor = 0, recordRun = false): NewBestCueSource {
	return { fanfare, recordFloor, recordRun };
}

function frame(
	m: AudioCueMapper,
	now: number,
	s: SimState,
	newBest: NewBestCueSource,
	e: SimEvents = noEvents(),
): string[] {
	return m
		.frame(
			now,
			e,
			NO_FX,
			s,
			0,
			new AudioCueList(),
			NO_BOOST_EVENTS,
			NO_COMBO_EVENTS,
			undefined,
			NO_VARIANT_CUES,
			newBest,
		)
		.toIds();
}

/** A mapper that has seen `s` once (the watch's baseline frame). */
function primed(s: SimState, playable?: Playable): AudioCueMapper {
	const m = new AudioCueMapper(playable);
	frame(m, 0, s, NO_NEW_BEST_CUES);
	return m;
}

const floorChange = (): SimEvents => {
	const e = noEvents();
	e.floorChanged = 1;
	return e;
};

describe("new best cues: the fanfare", () => {
	it("a fanfare edge plays sfx.best.new once at full volume; none without one (the default: today's frames)", () => {
		const [s] = endlessState(2);
		const m = primed(s);
		const out = m.frame(
			1,
			noEvents(),
			NO_FX,
			s,
			0,
			new AudioCueList(),
			NO_BOOST_EVENTS,
			NO_COMBO_EVENTS,
			undefined,
			NO_VARIANT_CUES,
			cues(true),
		);
		expect([out.toIds(), out.volume(0), out.speed(0)]).toEqual([[SFX.bestNew], 1, 0]);
		expect(frame(m, 2, s, cues(false))).toEqual([]);
		expect(frame(m, 3, s, NO_NEW_BEST_CUES)).toEqual([]);
		expect(new AudioCueMapper().frame(0, noEvents(), NO_FX, s, 0, new AudioCueList()).size()).toBe(0);
	});

	it("NBD7: it outranks the room clear's jingle on a shared frame (the clear jingle is dropped)", () => {
		expect(SFX_PRIORITY[SFX.bestNew] > SFX_PRIORITY[SFX.roomPerfect]).toBe(true);
		expect(SFX_PRIORITY[SFX.bestNew] > SFX_PRIORITY[SFX.roomClear]).toBe(true);
		const [s, fake] = endlessState(2);
		const m = primed(s);
		fake.score!.rooms[0].cleared = 1;
		expect(frame(m, 1, s, cues(true))).toEqual([SFX.bestNew]);
		// without the fanfare the clear jingle plays as before
		const [s2, fake2] = endlessState(2);
		const m2 = primed(s2);
		fake2.score!.rooms[0].cleared = 1;
		expect(frame(m2, 1, s2, cues(false))).toEqual([SFX.roomClear]);
	});

	it("silent: falls back to the PERFECT jingle (still over the CLEAR one), else nothing and no cooldown", () => {
		expect(SFX_FALLBACK[SFX.bestNew]).toBe(SFX.roomPerfect);
		const [s, fake] = endlessState(2);
		const m = primed(s, (id) => id !== SFX.bestNew);
		fake.score!.rooms[0].cleared = 1;
		expect(frame(m, 1, s, cues(true))).toEqual([SFX.roomPerfect]);
		const silent = new Set<string>([SFX.bestNew, SFX.roomPerfect]);
		const none = primed(s, (id) => !silent.has(id));
		expect(frame(none, 1, s, cues(true))).toEqual([]);
		// one step only: a silent PERFECT does not chain on to the CLEAR jingle
		expect(none.resolve(SFX.bestNew)).toBe(undefined);
		silent.delete(SFX.bestNew);
		expect(frame(none, 1.01, s, cues(true))).toEqual([SFX.bestNew]);
	});
});

describe("new best cues: the deepest floor", () => {
	it("entering the first floor past the record drops sfx.floor.enter (the fanfare plays at the reveal)", () => {
		const [s, fake] = endlessState(3);
		const m = primed(s);
		fake.endless!.floor = 4;
		expect(frame(m, 1, s, cues(false, 3), floorChange())).toEqual([]);
		// the reveal frame: the tracker's deepest edge
		expect(frame(m, 2, s, cues(true, 3))).toEqual([SFX.bestNew]);
	});

	it("floors up to the record and later floors keep their floor enter; so does a run with no record floor", () => {
		for (const [from, to, record] of [
			[1, 2, 3],
			[2, 3, 3],
			[4, 5, 3],
			[3, 4, 0],
		]) {
			const [s, fake] = endlessState(from);
			const m = primed(s);
			fake.endless!.floor = to;
			expect([from, to, record, frame(m, 1, s, cues(false, record), floorChange())]).toEqual([
				from,
				to,
				record,
				[SFX.floorEnter],
			]);
		}
		// no floor change on the frame: nothing to drop
		const [s] = endlessState(4);
		expect(frame(primed(s), 1, s, cues(false, 3))).toEqual([]);
	});

	it("a frame that skips several floors (debug) past the record still drops it once", () => {
		const [s, fake] = endlessState(2);
		const m = primed(s);
		fake.endless!.floor = 5;
		const e = noEvents();
		e.floorChanged = 3;
		expect(frame(m, 1, s, cues(false, 3), e)).toEqual([]);
	});

	it("the same frame as the fanfare (no cover): the fanfare replaces the floor enter", () => {
		const [s, fake] = endlessState(3);
		const m = primed(s);
		fake.endless!.floor = 4;
		expect(frame(m, 1, s, cues(true, 3), floorChange())).toEqual([SFX.bestNew]);
	});

	it("while neither the fanfare nor its fallback can play, the floor enter stays", () => {
		const silent = new Set<string>([SFX.bestNew, SFX.roomPerfect]);
		const [s, fake] = endlessState(3);
		const m = primed(s, (id) => !silent.has(id));
		fake.endless!.floor = 4;
		expect(frame(m, 1, s, cues(false, 3), floorChange())).toEqual([SFX.floorEnter]);
		// the fallback alone is enough to drop it (the PERFECT jingle plays at the reveal)
		const [s2, fake2] = endlessState(3);
		const m2 = primed(s2, (id) => id !== SFX.bestNew);
		fake2.endless!.floor = 4;
		expect(frame(m2, 1, s2, cues(false, 3), floorChange())).toEqual([]);
	});
});

describe("new best cues: the run-over jingle", () => {
	function wipe(recordRun: boolean, playable?: Playable): string[] {
		const [s] = endlessState(5);
		const m = primed(s, playable);
		const e = noEvents();
		e.playerDied = 1;
		e.playerHits = 1;
		s.player.dead = 1;
		return frame(m, 1, s, cues(false, 0, recordRun), e);
	}

	it("runOverJingle: the record fanfare on a record run, else the game-over jingle", () => {
		expect([runOverJingle(true), runOverJingle(false)]).toEqual([SFX.jingleRecord, SFX.gameOver]);
	});

	it("a record run's wipe plays sfx.jingle.record instead of the game-over jingle; a run without one keeps it", () => {
		expect(wipe(true)).toEqual([SFX.playerDeath, SFX.playerHurt, SFX.jingleRecord]);
		expect(wipe(false)).toEqual([SFX.playerDeath, SFX.playerHurt, SFX.gameOver]);
		// recordRun alone (no wipe) plays nothing
		const [s] = endlessState(5);
		expect(frame(primed(s), 1, s, cues(false, 0, true))).toEqual([]);
	});

	it("silent: the record run plays the game-over jingle", () => {
		expect(SFX_FALLBACK[SFX.jingleRecord]).toBe(SFX.gameOver);
		expect(wipe(true, (id) => id !== SFX.jingleRecord)).toEqual([SFX.playerDeath, SFX.playerHurt, SFX.gameOver]);
	});

	it("the run over owns the moment: a fanfare on the wipe frame is dropped for the record jingle (one jingle)", () => {
		const [s] = endlessState(5);
		const m = primed(s);
		const e = noEvents();
		e.playerDied = 1;
		s.player.dead = 1;
		expect(frame(m, 1, s, cues(true, 0, true), e)).toEqual([SFX.playerDeath, SFX.jingleRecord]);
	});
});

describe("new best cues: IDs", () => {
	it("are the theme's port audio events, in ALL_SFX and PORT_SFX, ranked, jingles that duck the music", () => {
		for (const id of [SFX.bestNew, SFX.jingleRecord]) {
			expect([
				id,
				(PORT_AUDIO_EVENTS as ReadonlyArray<string>).includes(id),
				ALL_SFX.includes(id),
				PORT_SFX.includes(id),
				JINGLE_SFX.includes(id),
				DUCKING_SFX.includes(id),
			]).toEqual([id, true, true, true, true, true]);
		}
		expect([SFX.bestNew, SFX.jingleRecord]).toEqual(["sfx.best.new", "sfx.jingle.record"]);
		expect([SFX_PRIORITY[SFX.bestNew], SFX_PRIORITY[SFX.jingleRecord]]).toEqual([74, SFX_PRIORITY[SFX.gameOver]]);
	});
});

describe("new best cues: a real tracker", () => {
	it("the tracker's frame is the mapper's source: the crossing plays once, held under the cover to the reveal", () => {
		const [s] = endlessState(2);
		const m = primed(s);
		const t = new NewBestTracker({ kind: "known", board: "solo", score: 2000, floor: 9 });
		const run = (now: number, shown: number, covered: boolean) => {
			const look = t.frame({
				dt: 1 / 60,
				shownScore: shown,
				score: shown,
				floor: 2,
				underCover: covered,
				runOver: false,
				reducedMotion: false,
			});
			return frame(m, now, s, look);
		};
		expect(run(1, 1500, false)).toEqual([]);
		expect(run(2, 2500, true)).toEqual([]);
		expect(run(3, 2500, false)).toEqual([SFX.bestNew]);
		expect(run(4, 3000, false)).toEqual([]);
	});
});
