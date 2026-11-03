// docs/RUN_RECAP.md RR4: the recap's sounds through the room tally's sfx.score.tick / sfx.score.land: at most one sound
// a frame, a landing wins it, one land under reduced motion, nothing on the run-over jingle's frame, under the jingle.
import { describe, expect, it } from "@rbxts/jest-globals";
import { RecapTimeline, type RecapTimelineOptions } from "shared/view/hud";
import { SFX, SFX_PRIORITY } from "./cues";
import { RECAP_AUDIO, recapCue, type RecapCue } from "./recapCues";

const FRAME = 1 / 60;

function options(reducedMotion: boolean): RecapTimelineOptions {
	return {
		nearMiss: { from: 0, to: 8, counted: true },
		highlights: [
			{ from: 0, to: 214, counted: true },
			{ from: 0, to: 11, counted: true },
			{ from: 10, to: 42, counted: true },
			{ from: 0, to: 3, counted: true },
		],
		reducedMotion,
	};
}

interface Tally {
	ticks: number;
	lands: number;
	maxPerFrame: number;
}

/** Steps a timeline at `dt` for `sec` and counts the cues recapCue returns (frame 0 is the jingle's). */
function run(t: RecapTimeline, dt: number, sec: number): Tally {
	const out: RecapCue = { id: "", volume: 0 };
	const tally: Tally = { ticks: 0, lands: 0, maxPerFrame: 0 };
	let first = true;
	for (let time = 0; time < sec; time += dt) {
		const f = t.step(first ? 0 : dt);
		const cue = recapCue(f, first, out);
		first = false;
		if (cue === undefined) continue;
		tally.maxPerFrame = math.max(tally.maxPerFrame, 1);
		if (cue.id === SFX.scoreTick) tally.ticks += 1;
		else if (cue.id === SFX.scoreLand) tally.lands += 1;
	}
	return tally;
}

describe("recap cues (RR4)", () => {
	it("a full timeline at 60 fps: ticks while counting, one land per counted row, one sound a frame", () => {
		const t = new RecapTimeline(options(false));
		const tally = run(t, FRAME, 3);
		expect(t.isSettled()).toBe(true);
		expect(tally.lands).toBe(5);
		expect(tally.ticks).toBeGreaterThan(5);
		expect(tally.maxPerFrame).toBe(1);
	});

	it("a landing wins the frame: one land however many rows landed, and no tick", () => {
		const out: RecapCue = { id: "", volume: 0 };
		expect(recapCue({ tick: true, lands: 2 }, false, out)).toEqual({
			id: SFX.scoreLand,
			volume: RECAP_AUDIO.landVolume,
		});
		expect(recapCue({ tick: true, lands: 0 }, false, out)).toEqual({
			id: SFX.scoreTick,
			volume: RECAP_AUDIO.tickVolume,
		});
		expect(recapCue({ tick: false, lands: 0 }, false, out)).toBe(undefined);
	});

	it("a slow frame rate (5 fps) still gives at most one sound a frame", () => {
		const tally = run(new RecapTimeline(options(false)), 0.2, 3);
		expect(tally.maxPerFrame).toBe(1);
		expect(tally.lands).toBeGreaterThanOrEqual(1);
	});

	it("reduced motion: no tick, one land at the end", () => {
		const tally = run(new RecapTimeline(options(true)), FRAME, 3);
		expect([tally.ticks, tally.lands]).toEqual([0, 1]);
	});

	it("a skip lands once on the next frame, then silence", () => {
		const t = new RecapTimeline(options(false));
		const out: RecapCue = { id: "", volume: 0 };
		t.step(0.35);
		t.skip();
		expect(recapCue(t.step(FRAME), false, out)?.id).toBe(SFX.scoreLand);
		for (let i = 0; i < 120; i++) expect(recapCue(t.step(FRAME), false, out)).toBe(undefined);
	});

	it("nothing on the run-over jingle's frame", () => {
		const out: RecapCue = { id: "", volume: 0 };
		expect(recapCue({ tick: true, lands: 1 }, true, out)).toBe(undefined);
	});

	it("ranks and sounds under the run-over jingles", () => {
		for (const id of [SFX.scoreTick, SFX.scoreLand]) {
			expect(SFX_PRIORITY[id]).toBeLessThan(SFX_PRIORITY[SFX.gameOver]);
			expect(SFX_PRIORITY[id]).toBeLessThan(SFX_PRIORITY[SFX.jingleRecord]);
		}
		expect(RECAP_AUDIO.tickVolume).toBeLessThan(1);
		expect(RECAP_AUDIO.landVolume).toBeLessThan(1);
		expect(RECAP_AUDIO.tickVolume).toBeLessThanOrEqual(RECAP_AUDIO.landVolume);
	});
});
