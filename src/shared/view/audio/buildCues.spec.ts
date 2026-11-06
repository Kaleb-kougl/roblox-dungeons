// Build effect sounds in the cue mapper (docs/BUILDS.md BU8 and its follow-up): spark / burst / shard / ember / nova /
// execute / jackpot from the frame's BuildFxFrameSource, pitched by the frame's highest proc generation, one each per
// frame and interval, under a voice cap; BU5's releases on the burst (Thrill Seeker, Flurry) and shard (Momentum,
// Ricochet) cues; Phantom Step and Lionheart silent; evolve / duo stings from the takes; teammates quieter; silent IDs
// nothing; the quiet gate; the theme's IDs.
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
import { NO_NEW_BEST_CUES } from "../hud";
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
	// BU5, each entry an owner.
	novas?: ReadonlyArray<number>;
	executes?: ReadonlyArray<number>;
	jackpots?: ReadonlyArray<number>;
	phantoms?: ReadonlyArray<number>;
	heals?: ReadonlyArray<number>;
	momentum?: ReadonlyArray<number>;
	thrills?: ReadonlyArray<number>;
	flurries?: ReadonlyArray<number>;
	ricochets?: ReadonlyArray<number>;
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
	for (const o of fx.novas ?? []) {
		e.novaX.push(0);
		e.novaZ.push(0);
		e.novaRadius.push(3);
		e.novaOwner.push(o);
		e.novaKind.push(0);
		e.novaErased.push(1);
	}
	for (const o of fx.executes ?? []) {
		e.execX.push(0);
		e.execZ.push(0);
		e.execOwner.push(o);
	}
	for (const o of fx.jackpots ?? []) {
		e.jackpotX.push(0);
		e.jackpotZ.push(0);
		e.jackpotOwner.push(o);
		e.jackpotPoints.push(100);
	}
	for (const o of fx.phantoms ?? []) {
		e.phantomX.push(0);
		e.phantomZ.push(0);
		e.phantomOwner.push(o);
	}
	for (const o of fx.heals ?? []) {
		e.lionPlayer.push(o);
		e.lionHealed.push(1);
	}
	for (const o of fx.momentum ?? []) {
		e.momentumX.push(0);
		e.momentumZ.push(0);
		e.momentumOwner.push(o);
		e.momentumTier.push(2);
		e.momentumFired.push(2);
	}
	for (const o of fx.thrills ?? []) {
		e.thrillX.push(0);
		e.thrillZ.push(0);
		e.thrillOwner.push(o);
		e.thrillFired.push(8);
	}
	for (const o of fx.flurries ?? []) {
		e.flurryX.push(0);
		e.flurryZ.push(0);
		e.flurryOwner.push(o);
		e.flurryKind.push(0);
		e.flurryFired.push(5);
	}
	for (const o of fx.ricochets ?? []) {
		e.ricochetX.push(0);
		e.ricochetZ.push(0);
		e.ricochetOwner.push(o);
		e.ricochetFired.push(2);
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
		NO_NEW_BEST_CUES,
		builds,
	);
}

const ids = (out: AudioCueList) => out.toIds();

describe("build cues: the IDs", () => {
	it("the eleven IDs are the theme's build sounds, ranked, timed, never a jingle / duck (BU8's nine: no fallback)", () => {
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
		// docs/LEGENDARIES.md LG5: the legendaries' two close the list; they have a fallback (checked below)
		const legendary = [SFX.buildOverkill, SFX.buildBrace];
		expect([...build, ...legendary]).toEqual([...BUILD_AUDIO_IDS]);
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
		for (const id of legendary) {
			expect([
				id,
				PORT_AUDIO_EVENTS.includes(id),
				ALL_SFX.includes(id),
				PORT_SFX.includes(id),
				SFX_PRIORITY[id] > 0,
				(SFX_MIN_INTERVAL[id] ?? 0) > 0,
				JINGLE_SFX.includes(id),
				DUCKING_SFX.includes(id),
			]).toEqual([id, true, true, true, true, true, false, false]);
		}
		// While silent: the streak plays the spark, the brace the Aegis pip's break (one step each).
		expect([SFX_FALLBACK[SFX.buildOverkill], SFX_FALLBACK[SFX.buildBrace]]).toEqual([
			SFX.buildSpark,
			SFX.boostAegisBreak,
		]);
		// The streak is a cascade sound (over the spark, under the swing); the brace under the hurt and the Aegis break.
		expect(SFX_PRIORITY[SFX.buildOverkill] > SFX_PRIORITY[SFX.buildSpark]).toBe(true);
		expect(SFX_PRIORITY[SFX.buildOverkill] < SFX_PRIORITY[SFX.playerSwing]).toBe(true);
		expect(SFX_PRIORITY[SFX.buildBrace] < SFX_PRIORITY[SFX.boostAegisBreak]).toBe(true);
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

describe("build cues: the evolutions (BU8 follow-up)", () => {
	it("a nova, an execute and a Jackpot each play their own cue at generation 0's pitch and the build volume", () => {
		const out = frame(new AudioCueMapper(), 0, source({ novas: [0], executes: [0], jackpots: [0] }));
		expect(ids(out)).toEqual([SFX.buildNova, SFX.buildExecute, SFX.buildJackpot]);
		expect([out.speed(0), out.speed(1), out.speed(2)]).toEqual([
			buildGenSpeed(0),
			buildGenSpeed(0),
			buildGenSpeed(0),
		]);
		expect([out.volume(0), out.volume(1), out.volume(2)]).toEqual([A.volume, A.volume, A.volume]);
	});

	it("Thrill Seeker and Flurry reuse the burst cue, Momentum and Ricochet the shard cue (one each per frame)", () => {
		expect(ids(frame(new AudioCueMapper(), 0, source({ thrills: [0] })))).toEqual([SFX.buildBurst]);
		expect(ids(frame(new AudioCueMapper(), 0, source({ flurries: [0] })))).toEqual([SFX.buildBurst]);
		expect(ids(frame(new AudioCueMapper(), 0, source({ momentum: [0] })))).toEqual([SFX.buildShard]);
		expect(ids(frame(new AudioCueMapper(), 0, source({ ricochets: [0] })))).toEqual([SFX.buildShard]);
		// All four with a Volatile ring and a Soul Shards volley: still one burst and one shard.
		const all = frame(
			new AudioCueMapper(),
			0,
			source({ bursts: [[0, 2]], shards: [[0, 0]], thrills: [0], flurries: [0], momentum: [0], ricochets: [0] }),
		);
		expect(ids(all)).toEqual([SFX.buildBurst, SFX.buildShard]);
		// The burst cue keeps the highest generation of everything it carries.
		expect(all.speed(0)).toBe(buildGenSpeed(2));
	});

	it("a teammate's execute / release alone is quieter; the local player's share makes it full", () => {
		const out = frame(new AudioCueMapper(), 0, source({ executes: [1], thrills: [1] }), 0);
		expect([ids(out), out.volume(0), out.volume(1)]).toEqual([
			[SFX.buildBurst, SFX.buildExecute],
			A.volume * AUDIO_VIEW.teammateVolume,
			A.volume * AUDIO_VIEW.teammateVolume,
		]);
		const mixed = frame(new AudioCueMapper(), 0, source({ thrills: [1], ricochets: [0] }), 0);
		expect([mixed.volume(0), mixed.volume(1)]).toEqual([A.volume * AUDIO_VIEW.teammateVolume, A.volume]);
	});

	it("Phantom Step erases and Lionheart heals play nothing of their own", () => {
		expect(ids(frame(new AudioCueMapper(), 0, source({ phantoms: [0, 0], heals: [0] })))).toEqual([]);
	});

	it("the releases share the voice cap and the per-ID interval", () => {
		const m = new AudioCueMapper();
		const gap = SFX_MIN_INTERVAL[SFX.buildBurst]!;
		expect(ids(frame(m, 1, source({ thrills: [0] })))).toEqual([SFX.buildBurst]);
		expect(ids(frame(m, 1 + gap / 2, source({ flurries: [0] })))).toEqual([]);
		const capped = new AudioCueMapper();
		const out = frame(
			capped,
			0,
			source({ sparks: [[0, 0]], thrills: [0], momentum: [0], novas: [0], executes: [0], jackpots: [0] }),
		);
		expect(ids(out)).toEqual(
			[SFX.buildSpark, SFX.buildBurst, SFX.buildShard, SFX.buildNova, SFX.buildExecute, SFX.buildJackpot].filter(
				(_, i) => i < A.maxVoices,
			),
		);
	});
});
