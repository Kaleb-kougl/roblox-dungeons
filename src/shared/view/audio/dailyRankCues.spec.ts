// The Daily's rank layer sounds in the cue mapper (docs/DAILY.md DS10): sfx.rank.up on a threshold frame,
// sfx.friend.passed on a friend toast frame, one celebration sound per frame (new best's fanfare > rank-up > friend),
// silent IDs play nothing, the minimum intervals, and the IDs' ranks / listing (not jingles, no duck).
import { describe, expect, it } from "@rbxts/jest-globals";
import { ALL_EVENT_FIELDS, COMBO_MIN, createSimState, eventDefault, type SimEvents, type SimState } from "shared/sim";
import { PORT_AUDIO_EVENTS } from "shared/theme";
import { NO_BOOST_EVENTS } from "../boosts";
import { NO_COMBO_EVENTS, NO_VARIANT_CUES } from "../fx";
import { FxEventBuffer } from "../fx/events";
import { NO_DAILY_RANK_CUES, NO_NEW_BEST_CUES, type DailyRankCueSource, type NewBestCueSource } from "../hud";
import {
	ALL_SFX,
	AudioCueList,
	AudioCueMapper,
	DUCKING_SFX,
	JINGLE_SFX,
	PORT_SFX,
	SFX,
	SFX_FALLBACK,
	SFX_MIN_INTERVAL,
	SFX_PRIORITY,
	type Playable,
} from ".";

const NO_FX = new FxEventBuffer(1);

function noEvents(): SimEvents {
	const e = {} as SimEvents;
	for (const f of ALL_EVENT_FIELDS) e[f] = eventDefault(f);
	return e;
}

function dailyState(): SimState {
	const s = createSimState(1, 0, 0);
	const fake = s as unknown as {
		endless: { floor: number };
		score: { combo: number; total: number; rooms: Array<{ cleared: number }> };
	};
	fake.endless = { floor: 2 };
	fake.score = { combo: COMBO_MIN, total: 0, rooms: [{ cleared: 0 }] };
	return s;
}

const rank = (rankUp: boolean, friendPassed: boolean): DailyRankCueSource => ({ rankUp, friendPassed });
const fanfare: NewBestCueSource = { fanfare: true, recordFloor: 0, recordRun: false };

function frame(m: AudioCueMapper, now: number, s: SimState, r: DailyRankCueSource, nb = NO_NEW_BEST_CUES): string[] {
	return m
		.frame(
			now,
			noEvents(),
			NO_FX,
			s,
			0,
			new AudioCueList(),
			NO_BOOST_EVENTS,
			NO_COMBO_EVENTS,
			undefined,
			NO_VARIANT_CUES,
			nb,
			r,
		)
		.toIds();
}

function primed(s: SimState, playable?: Playable): AudioCueMapper {
	const m = new AudioCueMapper(playable);
	frame(m, 0, s, NO_DAILY_RANK_CUES);
	return m;
}

describe("daily rank cues", () => {
	it("a threshold frame plays sfx.rank.up, a friend toast frame sfx.friend.passed; none by default", () => {
		const s = dailyState();
		const m = primed(s);
		expect(frame(m, 1, s, rank(true, false))).toEqual([SFX.rankUp]);
		expect(frame(m, 2, s, rank(false, true))).toEqual([SFX.friendPassed]);
		expect(frame(m, 3, s, rank(false, false))).toEqual([]);
		expect(frame(m, 4, s, NO_DAILY_RANK_CUES)).toEqual([]);
	});

	it("one celebration sound per frame: new best's fanfare > rank-up > friend passed", () => {
		const s = dailyState();
		expect(frame(primed(s), 1, s, rank(true, true))).toEqual([SFX.rankUp]);
		expect(frame(primed(s), 1, s, rank(true, true), fanfare)).toEqual([SFX.bestNew]);
		expect(frame(primed(s), 1, s, rank(false, true), fanfare)).toEqual([SFX.bestNew]);
	});

	it("silent IDs play nothing (no fallback); minimum intervals stop a stutter", () => {
		const s = dailyState();
		const silent = primed(s, (id) => id !== SFX.rankUp && id !== SFX.friendPassed);
		expect(frame(silent, 1, s, rank(true, false))).toEqual([]);
		expect(frame(silent, 2, s, rank(false, true))).toEqual([]);
		expect([SFX_FALLBACK[SFX.rankUp], SFX_FALLBACK[SFX.friendPassed]]).toEqual([undefined, undefined]);
		const m = primed(s);
		expect(frame(m, 1, s, rank(false, true))).toEqual([SFX.friendPassed]);
		expect(frame(m, 1.1, s, rank(false, true))).toEqual([]);
		expect(frame(m, 1 + SFX_MIN_INTERVAL[SFX.friendPassed]!, s, rank(false, true))).toEqual([SFX.friendPassed]);
		expect(frame(m, 2, s, rank(true, false))).toEqual([SFX.rankUp]);
		expect(frame(m, 2.2, s, rank(true, false))).toEqual([]);
	});

	it("are the theme's port audio events, in ALL_SFX and PORT_SFX, ranked under the jingles, neither a jingle nor ducking", () => {
		for (const id of [SFX.rankUp, SFX.friendPassed]) {
			expect([
				id,
				(PORT_AUDIO_EVENTS as ReadonlyArray<string>).includes(id),
				ALL_SFX.includes(id),
				PORT_SFX.includes(id),
				JINGLE_SFX.includes(id),
				DUCKING_SFX.includes(id),
			]).toEqual([id, true, true, true, false, false]);
		}
		expect([SFX.rankUp, SFX.friendPassed]).toEqual(["sfx.rank.up", "sfx.friend.passed"]);
		expect(SFX_PRIORITY[SFX.bestNew] > SFX_PRIORITY[SFX.rankUp]).toBe(true);
		expect(SFX_PRIORITY[SFX.roomClear] > SFX_PRIORITY[SFX.rankUp]).toBe(true);
		expect(SFX_PRIORITY[SFX.rankUp] > SFX_PRIORITY[SFX.friendPassed]).toBe(true);
		expect(SFX_PRIORITY[SFX.friendPassed] > SFX_PRIORITY[SFX.comboTier]).toBe(true);
	});
});
