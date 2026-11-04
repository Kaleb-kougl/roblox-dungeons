// The Goldling's sounds (docs/FORTUNE.md FO9): its appearance, one hit sound per frame climbing the ladder by the hit
// count (goldenHitSpeed, pelletEatSpeed's approach), never inside its interval, quieter for a teammate's hit; the
// jackpot of a catch (a jingle that ducks the music, over the room clear's jingle, under the new-best fanfare); the
// escape. Each falls back to its FO6 clip while silent.
import { describe, expect, it } from "@rbxts/jest-globals";
import { ALL_EVENT_FIELDS, createSimState, eventDefault, type SimEvents, type SimState } from "shared/sim";
import { FxEventBuffer } from "shared/view/fx";
import { GOLDEN_VIEW, GoldenFrameEvents, goldenHitSpeed } from "shared/view/golden";
import { NO_PELLET_EVENTS } from "shared/view/pellets";
import {
	AUDIO_VIEW,
	AudioCueList,
	AudioCueMapper,
	DUCKING_SFX,
	JINGLE_SFX,
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

/** One mapper frame with `golden`: [id, volume, speed] per cue. */
function frame(
	m: AudioCueMapper,
	now: number,
	s: SimState,
	golden: GoldenFrameEvents,
	me = 0,
): Array<[string, number, number]> {
	const out = m.frame(
		now,
		noEvents(),
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
		NO_PELLET_EVENTS,
		golden,
	);
	const list: Array<[string, number, number]> = [];
	for (let i = 0; i < out.size(); i++) list.push([out.id(i), out.volume(i), out.speed(i)]);
	return list;
}

/** Hits numbered `from`.. on one Goldling, by `players` in order. */
function hits(from: number, players: number[]): GoldenFrameEvents {
	const ev = new GoldenFrameEvents();
	for (let i = 0; i < players.size(); i++)
		ev.hits.push({ x: 0, z: 0, player: players[i], points: 50, hits: from + i, tick: 1 });
	return ev;
}

describe("audio: the Goldling (docs/FORTUNE.md FO9)", () => {
	it("the hit: once per frame, at the frame's highest hit count, climbing to the octave and holding there", () => {
		const s = createSimState(1, 0, 0);
		const m = new AudioCueMapper();
		const gap = GOLDEN_VIEW.audio.hitMinIntervalSec;
		expect(m.intervalOf(SFX.goldenHit)).toBe(gap);
		expect(frame(m, 0, s, hits(1, [0, 0, 0]))).toEqual([[SFX.goldenHit, 1, goldenHitSpeed(3)]]);
		// Inside the interval: nothing.
		expect(frame(m, gap / 2, s, hits(4, [0]))).toEqual([]);
		let prev = goldenHitSpeed(3);
		const n = GOLDEN_VIEW.audio.ladderSemitones.size();
		for (let k = 4; k <= n; k++) {
			const out = frame(m, k * 2 * gap, s, hits(k, [0]));
			expect(out).toEqual([[SFX.goldenHit, 1, goldenHitSpeed(k)]]);
			expect(out[0][2] > prev).toBe(true);
			prev = out[0][2];
		}
		expect(prev).toBe(2);
		// Past the ladder: it holds at the octave.
		expect(frame(m, 100, s, hits(n + 5, [0]))).toEqual([[SFX.goldenHit, 1, 2]]);
		expect(frame(m, 200, s, new GoldenFrameEvents())).toEqual([]);
	});

	it("goldenHitSpeed: the root first, a scale step per hit, clamped", () => {
		expect(goldenHitSpeed(1)).toBe(1);
		expect(goldenHitSpeed(0)).toBe(1);
		expect(goldenHitSpeed(2)).toBeCloseTo(math.pow(2, 2 / 12), 10);
		expect(goldenHitSpeed(99)).toBe(2);
	});

	it("a teammate's hit is quieter and lower-ranked; one of the local player's in the frame is full volume", () => {
		const s = createSimState(1, 0, 0);
		const teammate = frame(new AudioCueMapper(), 0, s, hits(1, [1, 1]), 0);
		expect(teammate).toEqual([[SFX.goldenHit, AUDIO_VIEW.teammateVolume, goldenHitSpeed(2)]]);
		const mixed = frame(new AudioCueMapper(), 0, s, hits(1, [1, 0]), 0);
		expect(mixed).toEqual([[SFX.goldenHit, 1, goldenHitSpeed(2)]]);
		expect(SFX_PRIORITY[SFX.goldenHit] - TEAMMATE_PRIORITY_DROP < SFX_PRIORITY[SFX.enemyShoot]).toBe(true);
	});

	it("appearance, catch and escape each play their sound once, anyone's", () => {
		const s = createSimState(1, 0, 0);
		const appear = new GoldenFrameEvents();
		appear.appeared.push({ x: 1, z: 2, actorId: 7, tick: 1 });
		expect(frame(new AudioCueMapper(), 0, s, appear)).toEqual([[SFX.goldenAppear, 1, 0]]);
		const caught = new GoldenFrameEvents();
		caught.caught.push({ x: 0, z: 0, player: 1, points: 1500, boosts: [], lost: 0, tick: 1 });
		expect(frame(new AudioCueMapper(), 0, s, caught, 0)).toEqual([[SFX.goldenJackpot, 1, 0]]);
		const escaped = new GoldenFrameEvents();
		escaped.escaped.push({ x: 0, z: 0, coins: 350, tick: 1 });
		expect(frame(new AudioCueMapper(), 0, s, escaped)).toEqual([[SFX.goldenEscape, 1, 0]]);
	});

	it("the jackpot is a jingle that ducks the music, ranked over the room clear's and under the new-best fanfare", () => {
		expect([JINGLE_SFX.includes(SFX.goldenJackpot), DUCKING_SFX.includes(SFX.goldenJackpot)]).toEqual([true, true]);
		const rank = SFX_PRIORITY[SFX.goldenJackpot];
		expect(rank > SFX_PRIORITY[SFX.roomClear] && rank > SFX_PRIORITY[SFX.roomPerfect]).toBe(true);
		expect(rank < SFX_PRIORITY[SFX.bestNew]).toBe(true);
		for (const id of [SFX.goldenAppear, SFX.goldenHit, SFX.goldenEscape]) {
			expect([id, JINGLE_SFX.includes(id), DUCKING_SFX.includes(id)]).toEqual([id, false, false]);
		}
		// The appearance outranks the tier sting and the pickups (a busy frame keeps the call to act).
		expect(SFX_PRIORITY[SFX.goldenAppear] > SFX_PRIORITY[SFX.comboTier]).toBe(true);
		expect(SFX_PRIORITY[SFX.goldenAppear] > SFX_PRIORITY[SFX.boostCollect]).toBe(true);
	});

	it("silent: the catch plays the PERFECT jingle, a hit the tally's tick at the ladder's speed", () => {
		const s = createSimState(1, 0, 0);
		const silent = new Set<string>([SFX.goldenJackpot, SFX.goldenHit]);
		const m = new AudioCueMapper((id) => !silent.has(id));
		const ev = hits(1, [0, 0]);
		ev.caught.push({ x: 0, z: 0, player: 0, points: 1500, boosts: [], lost: 0, tick: 1 });
		expect(frame(m, 0, s, ev)).toEqual([
			[SFX.scoreTick, 1, goldenHitSpeed(2)],
			[SFX.roomPerfect, 1, 0],
		]);
	});
});
