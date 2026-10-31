// Build effect sounds in the cue mapper (docs/BUILDS.md BU8): spark / burst / shard / ember from the frame's
// BuildFxFrameSource, pitched by the frame's highest proc generation, one each per frame and interval, under a voice
// cap; evolve / duo stings from the takes; teammates quieter; silent IDs nothing; the quiet gate; the theme's IDs.
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	ALL_EVENT_FIELDS,
	BUILDS_CONFIG,
	createSimState,
	eventDefault,
	type SimEvents,
	type SimState,
} from "shared/sim";
import { BUILD_AUDIO_IDS, PORT_AUDIO_EVENTS } from "shared/theme";
import { NO_BOOST_EVENTS } from "../boosts";
import {
	BUILD_FX_VIEW,
	BuildFxEvents,
	NO_COMBO_EVENTS,
	NO_VARIANT_CUES,
	audibleBuilds,
	buildGenSpeed,
	comboQuiet,
	type BuildFxFrameSource,
} from "../fx";
import { FxEventBuffer } from "../fx/events";
import {
	ALL_SFX,
	AUDIO_VIEW,
	AudioCueList,
	AudioCueMapper,
	BUILD_VOICE_SFX,
	DUCKING_SFX,
	JINGLE_SFX,
	PORT_SFX,
	SFX,
	SFX_FALLBACK,
	SFX_MIN_INTERVAL,
	SFX_PRIORITY,
	TEAMMATE_PRIORITY_DROP,
	type Playable,
} from ".";

const NO_FX = new FxEventBuffer(1);
const A = BUILD_FX_VIEW.audio;

function noEvents(): SimEvents {
	const e = {} as SimEvents;
	for (const f of ALL_EVENT_FIELDS) e[f] = eventDefault(f);
	return e;
}

function runState(players = 1): SimState {
	return createSimState(
		1,
		0,
		0,
		players > 1 ? { builds: BUILDS_CONFIG, party: { size: players } } : { builds: BUILDS_CONFIG },
	);
}

interface Fx {
	sparks?: ReadonlyArray<[number, number]>; // [owner, gen]
	bursts?: ReadonlyArray<[number, number]>;
	shards?: ReadonlyArray<[number, number]>;
	evolved?: ReadonlyArray<number>; // players
	duos?: ReadonlyArray<number>;
}

/** A frame source with these records (one tick). */
function source(fx: Fx, players = 2): BuildFxEvents {
	const s = runState(players);
	const e = s.builds!.events;
	for (const [o, g] of fx.sparks ?? []) {
		e.sparkX1.push(0);
		e.sparkZ1.push(0);
		e.sparkX2.push(1);
		e.sparkZ2.push(1);
		e.sparkOwner.push(o);
		e.sparkGen.push(g);
	}
	for (const [o, g] of fx.bursts ?? []) {
		e.burstX.push(0);
		e.burstZ.push(0);
		e.burstOwner.push(o);
		e.burstGen.push(g);
		e.burstFired.push(8);
	}
	for (const [o, g] of fx.shards ?? []) {
		e.shardX.push(0);
		e.shardZ.push(0);
		e.shardOwner.push(o);
		e.shardGen.push(g);
		e.shardFired.push(2);
	}
	for (const p of fx.evolved ?? []) {
		e.evolvedPlayer.push(p);
		e.evolvedBoon.push(0);
	}
	for (const p of fx.duos ?? []) {
		e.duoPlayer.push(p);
		e.duoTaken.push(0);
	}
	s.tick = 1;
	const ev = new BuildFxEvents();
	ev.collect(s);
	return ev;
}

function frame(m: AudioCueMapper, now: number, builds: BuildFxFrameSource, me = 0, players = 2): AudioCueList {
	return m.frame(
		now,
		noEvents(),
		NO_FX,
		runState(players),
		me,
		new AudioCueList(),
		NO_BOOST_EVENTS,
		NO_COMBO_EVENTS,
		undefined,
		NO_VARIANT_CUES,
		builds,
	);
}

const ids = (out: AudioCueList) => out.toIds();

describe("build cues: the IDs", () => {
	it("the nine IDs are the theme's build sounds (port audio events), ranked, timed, never a jingle / duck / fallback", () => {
		const build = [
			SFX.buildSpark,
			SFX.buildBurst,
			SFX.buildShard,
			SFX.buildEmber,
			SFX.buildNova,
			SFX.buildExecute,
			SFX.buildEvolve,
			SFX.buildDuo,
			SFX.buildJackpot,
		];
		expect([...build]).toEqual([...BUILD_AUDIO_IDS]);
		for (const id of build) {
			expect([
				id,
				PORT_AUDIO_EVENTS.includes(id),
				ALL_SFX.includes(id),
				PORT_SFX.includes(id),
				SFX_PRIORITY[id] > 0,
				(SFX_MIN_INTERVAL[id] ?? 0) > 0,
				JINGLE_SFX.includes(id),
				DUCKING_SFX.includes(id),
				SFX_FALLBACK[id],
			]).toEqual([id, true, true, true, true, true, false, false, undefined]);
		}
		// Under the player's hurt, the telegraph and the kill ladder's rank; the cascade sounds under the swing.
		for (const id of BUILD_VOICE_SFX) expect(SFX_PRIORITY[id] < SFX_PRIORITY[SFX.playerHurt]).toBe(true);
		for (const id of [SFX.buildSpark, SFX.buildBurst, SFX.buildShard, SFX.buildEmber])
			expect(SFX_PRIORITY[id] < SFX_PRIORITY[SFX.playerSwing]).toBe(true);
	});
});

describe("build cues: mapping", () => {
	it("nothing without effects (the default argument too)", () => {
		expect(ids(frame(new AudioCueMapper(), 0, new BuildFxEvents()))).toEqual([]);
		const s = runState();
		expect(new AudioCueMapper().frame(0, noEvents(), NO_FX, s, 0, new AudioCueList()).size()).toBe(0);
	});

	it("one cue per effect per frame at the frame's highest generation's pitch and the build volume", () => {
		const out = frame(
			new AudioCueMapper(),
			0,
			source({
				sparks: [
					[0, 0],
					[0, 2],
					[0, 1],
				],
				bursts: [[0, 1]],
				shards: [[0, 0]],
			}),
		);
		expect(ids(out)).toEqual([SFX.buildSpark, SFX.buildBurst, SFX.buildShard]);
		expect([out.speed(0), out.speed(1), out.speed(2)]).toEqual([
			buildGenSpeed(2),
			buildGenSpeed(1),
			buildGenSpeed(0),
		]);
		expect([out.volume(0), out.volume(1), out.volume(2)]).toEqual([A.volume, A.volume, A.volume]);
		expect(buildGenSpeed(2) > buildGenSpeed(1)).toBe(true);
	});

	it("an effect only a teammate set off is quieter (teammate volume) and ranks lower", () => {
		const m = new AudioCueMapper();
		const out = frame(m, 0, source({ bursts: [[1, 0]] }), 0);
		expect([ids(out), out.volume(0)]).toEqual([[SFX.buildBurst], A.volume * AUDIO_VIEW.teammateVolume]);
		// Mixed: the local player's share makes it full.
		const mixed = frame(
			new AudioCueMapper(),
			0,
			source({
				bursts: [
					[1, 0],
					[0, 0],
				],
			}),
			0,
		);
		expect(mixed.volume(0)).toBe(A.volume);
		// Spectating player 1: their bursts are the loud ones.
		const watched = frame(new AudioCueMapper(), 0, source({ bursts: [[1, 0]] }), 1);
		expect(watched.volume(0)).toBe(A.volume);
		expect(TEAMMATE_PRIORITY_DROP > 0).toBe(true);
	});

	it("keeps each ID's minimum interval (a cascade over consecutive frames is one sound per interval)", () => {
		const m = new AudioCueMapper();
		const gap = SFX_MIN_INTERVAL[SFX.buildSpark]!;
		const fx = source({ sparks: [[0, 0]] });
		expect(ids(frame(m, 1, fx))).toEqual([SFX.buildSpark]);
		expect(ids(frame(m, 1 + gap / 2, fx))).toEqual([]);
		expect(ids(frame(m, 1 + gap, fx))).toEqual([SFX.buildSpark]);
	});

	it("the voice cap: at most maxVoices build starts within voiceWindowSec, spark first", () => {
		const m = new AudioCueMapper();
		// Long intervals out of the way: only the cap limits.
		for (const id of BUILD_VOICE_SFX) m.setMinInterval(id, 0.001);
		const all = source({ sparks: [[0, 0]], bursts: [[0, 0]], shards: [[0, 0]] });
		let started = 0;
		const step = A.voiceWindowSec / 10;
		for (let k = 0; k < 9; k++) started += frame(m, 10 + k * step, all).size();
		expect(started).toBe(A.maxVoices);
		// The window passed: voices free up.
		expect(frame(m, 10 + A.voiceWindowSec + 9 * step, all).size() > 0).toBe(true);
		// One frame with every effect: the first maxVoices (BUILD_VOICE_SFX order) start.
		const fresh = new AudioCueMapper();
		const out = frame(fresh, 0, all);
		expect(ids(out)).toEqual([SFX.buildSpark, SFX.buildBurst, SFX.buildShard].filter((_, i) => i < A.maxVoices));
	});

	it("evolve / duo stings: the local player's at full volume, a teammate's quieter, outside the voice cap", () => {
		const m = new AudioCueMapper();
		for (const id of BUILD_VOICE_SFX) m.setMinInterval(id, 0.001);
		const cascade = source({ sparks: [[0, 0]], bursts: [[0, 0]], shards: [[0, 0]] });
		for (let k = 0; k < 4; k++) frame(m, k * 0.01, cascade);
		const out = frame(m, 0.05, source({ sparks: [[0, 0]], evolved: [0], duos: [1] }));
		expect(ids(out)).toEqual([SFX.buildEvolve, SFX.buildDuo]);
		expect([out.volume(0), out.volume(1), out.speed(0)]).toEqual([1, AUDIO_VIEW.teammateVolume, 0]);
	});

	it("a silent ID plays nothing and takes no voice", () => {
		const silent: Playable = (id) => id !== SFX.buildSpark;
		const m = new AudioCueMapper(silent);
		const out = frame(m, 0, source({ sparks: [[0, 0]], bursts: [[0, 0]] }));
		expect(ids(out)).toEqual([SFX.buildBurst]);
	});

	it("quiet (stage cover, run over): audibleBuilds hands the mapper nothing", () => {
		const all = source({ sparks: [[0, 0]], evolved: [0] });
		for (const [covered, runOver] of [
			[true, false],
			[false, true],
		]) {
			const out = frame(new AudioCueMapper(), 0, audibleBuilds(all, comboQuiet(covered, runOver)));
			expect([covered, runOver, ids(out)]).toEqual([covered, runOver, []]);
		}
		expect(ids(frame(new AudioCueMapper(), 0, audibleBuilds(all, comboQuiet(false, false))))).toEqual([
			SFX.buildSpark,
			SFX.buildEvolve,
		]);
	});
});
