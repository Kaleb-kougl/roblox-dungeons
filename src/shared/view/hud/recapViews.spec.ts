// The recap's clocks per tab (docs/RUN_CONTRIBUTION.md CT7; recapViews.ts):
//   - untabbed (solo): exactly one RecapTimeline (same rows, frames, arm and settle)
//   - tabbed: the near-miss line and the arm on the main clock; You counts where the highlights did (0.7 s, or after
//     new best's rows on a record run); Team counts from its first open; Party never counts
//   - leaving a tab settles it silently (no land), later opens show finals; a skip / early press settles the near-miss
//     line and the tab showing (at most one sound a frame through recapCue); after the arm a press retries; tab switches
//     are no presses
//   - reduced motion: finals, one land per clock
//   - renewed (a verdict re-derive): the tab kept, every clock at its old time, settled stays settled
import { describe, expect, it } from "@rbxts/jest-globals";
import { recapCue, type RecapCue } from "shared/view/audio";
import { CONTRIB_UI, RECAP, RecapTimeline, RecapViews, type RecapRowSpec, type RecapViewsOptions } from ".";

const DT = 1 / 60;
const NEAR: RecapRowSpec = { from: 0, to: 12, counted: true };
const HL: RecapRowSpec[] = [
	{ from: 0, to: 40, counted: true },
	{ from: 0, to: 9, counted: true },
	{ from: 0, to: 300, counted: true },
	{ from: 0, to: 3, counted: true },
];
const YOU: RecapRowSpec[] = [
	{ from: 0, to: 12480, counted: true },
	{ from: 0, to: 86, counted: true },
	{ from: 0, to: 14, counted: true },
];

function opts(patch: Partial<RecapViewsOptions> = {}): RecapViewsOptions {
	return { tabbed: true, nearMiss: NEAR, highlights: HL, you: YOU, reducedMotion: false, ...patch };
}

interface Trace {
	lands: number;
	ticks: number;
	/** Frames on which recapCue played something (at most one sound each). */
	sounds: number;
	settledAt: number;
}

/** Steps `v` for `sec` seconds at 60 fps. */
function run(v: RecapViews, sec: number): Trace {
	const out: Trace = { lands: 0, ticks: 0, sounds: 0, settledAt: -1 };
	const cue: RecapCue = { id: "", volume: 0 };
	const steps = math.round(sec / DT);
	for (let i = 0; i < steps; i++) {
		const f = v.step(DT);
		out.lands += f.lands;
		if (f.tick) out.ticks += 1;
		if (recapCue(f, false, cue) !== undefined) out.sounds += 1;
		if (f.settled && out.settledAt < 0) out.settledAt = v.elapsed();
	}
	return out;
}

describe("untabbed (solo runs): one RecapTimeline, as before", () => {
	it("the same rows, frames, arm and settle as a bare RecapTimeline", () => {
		const v = new RecapViews(opts({ tabbed: false }));
		const t = new RecapTimeline({ nearMiss: NEAR, highlights: HL, reducedMotion: false });
		expect(v.tab()).toBe("team");
		expect(v.teamOpened()).toBe(true);
		for (let i = 0; i < 150; i++) {
			const a = v.step(DT);
			const fa = { ...a };
			const b = t.step(DT);
			expect([i, fa.tick, fa.lands, fa.armed, fa.armedNow, fa.settled]).toEqual([
				i,
				b.tick,
				b.lands,
				b.armed,
				b.armedNow,
				b.settled,
			]);
			expect(v.nearMissRow()?.value).toBe(t.rows[0].value);
			for (let k = 0; k < HL.size(); k++) expect(v.cellRow("team", k)?.value).toBe(t.rows[1 + k].value);
		}
		expect(v.cellRow("you", 0)).toBe(undefined);
		// setTab does nothing untabbed.
		v.setTab("party");
		expect(v.tab()).toBe("team");
	});
});

describe("tabbed (party runs)", () => {
	it("opens on You; You counts from the highlights' start, every 0.15 s; the near-miss line on the main clock", () => {
		const v = new RecapViews(opts());
		expect(v.tab()).toBe("you");
		expect(v.teamOpened()).toBe(false);
		expect(v.cellRow("team", 0)).toBe(undefined);
		expect(v.cellRow("party", 0)).toBe(undefined);
		run(v, RECAP.highlightsStartSec - DT);
		expect(v.cellRow("you", 0)?.visible).toBe(false);
		expect(v.nearMissRow()?.visible).toBe(true);
		run(v, 2 * DT);
		expect(v.cellRow("you", 0)?.visible).toBe(true);
		expect(v.cellRow("you", 1)?.visible).toBe(false);
		const tr = run(v, 2);
		for (let i = 0; i < YOU.size(); i++) expect(v.cellRow("you", i)?.value).toBe(YOU[i].to);
		// One land per counted You row (the near-miss line landed before).
		expect(tr.lands).toBe(YOU.size());
		expect(tr.ticks > YOU.size()).toBe(true);
		expect(v.isSettled()).toBe(true);
	});

	it("a record run: You starts after new best's rows (+ RECAP.afterRecordRowsSec)", () => {
		const v = new RecapViews(opts({ recordRowsSec: 1.3 }));
		const start = 1.3 + RECAP.afterRecordRowsSec;
		run(v, start - 2 * DT);
		expect(v.cellRow("you", 0)?.visible).toBe(false);
		run(v, 3 * DT);
		expect(v.cellRow("you", 0)?.visible).toBe(true);
	});

	it("Team counts the first time it opens (from CONTRIB_UI.teamOpenDelaySec), later opens show finals", () => {
		const v = new RecapViews(opts());
		run(v, 3);
		v.setTab("team");
		expect(v.teamOpened()).toBe(true);
		expect(v.tabElapsed("team")).toBe(0);
		expect(v.cellRow("team", 0)?.visible).toBe(false);
		expect(v.isSettled()).toBe(false);
		run(v, CONTRIB_UI.teamOpenDelaySec + DT);
		expect(v.cellRow("team", 0)?.visible).toBe(true);
		const tr = run(v, 2);
		expect(tr.lands).toBe(HL.size());
		for (let i = 0; i < HL.size(); i++) expect(v.cellRow("team", i)?.value).toBe(HL[i].to);
		// Away and back: final, silent.
		v.setTab("party");
		v.setTab("team");
		const again = run(v, 2);
		expect([again.lands, again.ticks]).toEqual([0, 0]);
	});

	it("leaving a tab mid-count settles it silently; coming back shows finals with no sound", () => {
		const v = new RecapViews(opts());
		run(v, RECAP.highlightsStartSec + 0.1);
		expect(v.cellRow("you", 0)?.value).toBeLessThan(YOU[0].to);
		v.setTab("team");
		for (let i = 0; i < YOU.size(); i++) {
			const r = v.cellRow("you", i)!;
			expect([r.visible, r.value, r.landed]).toEqual([true, YOU[i].to, true]);
		}
		// Back on You (Team left before its first row): finals, silent.
		v.setTab("you");
		const tr = run(v, 2);
		expect(tr.lands).toBe(0);
		// The Team tab, left before its first row, settled too (later opens show finals).
		v.setTab("team");
		for (let i = 0; i < HL.size(); i++) expect(v.cellRow("team", i)?.value).toBe(HL[i].to);
	});

	it("Party never counts (no rows); the near-miss line keeps counting under any tab", () => {
		const v = new RecapViews(opts());
		v.setTab("party");
		expect(v.cellRow("party", 0)).toBe(undefined);
		const tr = run(v, 1);
		// The near-miss line's one land; You was left before it began.
		expect(tr.lands).toBe(1);
		expect(v.nearMissRow()?.value).toBe(NEAR.to);
		expect(v.isSettled()).toBe(true);
	});

	it("a skip before the arm settles the near-miss line and the tab showing: one sound on the next frame", () => {
		const v = new RecapViews(opts());
		run(v, 0.35);
		expect(v.press()).toBe("skip");
		expect(v.isSettled()).toBe(true);
		expect(v.nearMissRow()?.value).toBe(NEAR.to);
		for (let i = 0; i < YOU.size(); i++) expect(v.cellRow("you", i)?.value).toBe(YOU[i].to);
		const tr = run(v, 1);
		// Two clocks landed on the same frame; recapCue keeps it to one sound.
		expect(tr.lands).toBe(2);
		expect([tr.sounds, tr.ticks]).toEqual([1, 0]);
		// Team, never opened, still counts on its first open.
		v.setTab("team");
		expect(v.cellRow("team", 0)?.visible).toBe(false);
		expect(run(v, 2).lands).toBe(HL.size());
	});

	it("after the arm a press retries (nothing is skipped); a tab switch never arms or retries", () => {
		const v = new RecapViews(opts());
		run(v, 0.3);
		v.setTab("party");
		v.setTab("you");
		expect(v.isArmed()).toBe(false);
		run(v, RECAP.retryArmSec);
		expect(v.isArmed()).toBe(true);
		const before = v.cellRow("you", 0)?.value;
		v.setTab("team");
		expect(v.press()).toBe("retry");
		expect(v.cellRow("team", 0)?.visible).toBe(false);
		expect(before).toBeDefined();
	});

	it("reduced motion: finals with one land per clock", () => {
		const v = new RecapViews(opts({ reducedMotion: true }));
		const tr = run(v, 2);
		// The near-miss line's clock and You's: one land each, never a tick.
		expect([tr.lands, tr.ticks]).toEqual([2, 0]);
		for (let i = 0; i < YOU.size(); i++) expect(v.cellRow("you", i)?.value).toBe(YOU[i].to);
		v.setTab("team");
		const team = run(v, 2);
		expect([team.lands, team.ticks]).toEqual([1, 0]);
	});

	it("renewed: the tab kept, clocks at their old time, settled stays settled, unopened Team stays unopened", () => {
		const v = new RecapViews(opts());
		run(v, 3);
		v.setTab("party");
		const r = v.renewed(opts({ you: [{ from: 0, to: 99, counted: true }] }));
		expect(r.tab()).toBe("party");
		expect(r.elapsed()).toBe(v.elapsed());
		expect(r.teamOpened()).toBe(false);
		expect(r.cellRow("you", 0)?.value).toBe(99);
		expect(run(r, 1).lands).toBe(0);
		// Mid-count Team, renewed: still counting from its own clock.
		const w = new RecapViews(opts());
		run(w, 1);
		w.setTab("team");
		run(w, CONTRIB_UI.teamOpenDelaySec + 0.05);
		const wr = w.renewed(opts());
		expect(wr.tab()).toBe("team");
		expect(wr.tabElapsed("team")).toBe(w.tabElapsed("team"));
		expect(wr.isSettled()).toBe(false);
		expect(run(wr, 2).lands > 0).toBe(true);
	});
});
