// Enemy-variant sounds in the cue mapper (docs/ENEMY_VARIANTS.md EV9 / EV11): an Imp's blink landing, a Summoner's
// summons, an Ooze's split, a shield breaking and a Vengeful ring from the frame's VariantCueSource; ranks, intervals,
// silent IDs (no fallback), the quiet gate, the co-op rule (world sounds at full volume) and the theme's port IDs.
import { describe, expect, it } from "@rbxts/jest-globals";
import { ALL_EVENT_FIELDS, createSimState, eventDefault, type SimEvents, type SimState } from "shared/sim";
import { PORT_AUDIO_EVENTS } from "shared/theme";
import { NO_BOOST_EVENTS } from "../boosts";
import {
	NO_COMBO_EVENTS,
	NO_VARIANT_CUES,
	VariantCueEvents,
	audibleVariantCues,
	comboQuiet,
	type VariantCueSource,
} from "../fx";
import { FxEventBuffer } from "../fx/events";
import {
	ALL_SFX,
	AUDIO_VIEW,
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
	type SfxId,
} from ".";

const VARIANT_SFX: ReadonlyArray<SfxId> = [
	SFX.enemyBlink,
	SFX.enemySummon,
	SFX.enemySplit,
	SFX.affixShieldBreak,
	SFX.affixVengeful,
];

/** VariantCueSource field -> the ID it plays. */
const FIELD_SOUNDS: ReadonlyArray<readonly [keyof VariantCueSource, SfxId]> = [
	["blinks", SFX.enemyBlink],
	["summons", SFX.enemySummon],
	["splits", SFX.enemySplit],
	["shieldBreaks", SFX.affixShieldBreak],
	["vengefulFired", SFX.affixVengeful],
];

const NO_FX = new FxEventBuffer(1);

function noEvents(): SimEvents {
	const e = {} as SimEvents;
	for (const f of ALL_EVENT_FIELDS) e[f] = eventDefault(f);
	return e;
}

function source(fields: Partial<Record<keyof VariantCueSource, number>>): VariantCueEvents {
	const ev = new VariantCueEvents();
	for (const [k, v] of pairs(fields)) (ev as unknown as Record<string, number>)[k] = v;
	return ev;
}

function frame(
	m: AudioCueMapper,
	now: number,
	variants: VariantCueSource,
	s: SimState = createSimState(1, 0, 0),
	me = 0,
): AudioCueList {
	return m.frame(
		now,
		noEvents(),
		NO_FX,
		s,
		me,
		new AudioCueList(),
		NO_BOOST_EVENTS,
		NO_COMBO_EVENTS,
		undefined,
		variants,
	);
}

const idsOf = (out: AudioCueList): string[] => out.toIds();

describe("variant cues: mapping", () => {
	it("each event plays its ID at full volume and the pack's jitter; nothing without events (the default)", () => {
		for (const [field, id] of FIELD_SOUNDS) {
			const out = frame(new AudioCueMapper(), 0, source({ [field]: 1 }));
			expect([field, idsOf(out), out.volume(0), out.speed(0)]).toEqual([field, [id], 1, 0]);
		}
		expect(idsOf(frame(new AudioCueMapper(), 0, NO_VARIANT_CUES))).toEqual([]);
		// The parameter's default is NO_VARIANT_CUES: today's frames are unchanged.
		const s = createSimState(1, 0, 0);
		expect(new AudioCueMapper().frame(0, noEvents(), NO_FX, s, 0, new AudioCueList()).size()).toBe(0);
	});

	it("several of one event on a frame are one cue; all five on one frame are five cues", () => {
		expect(idsOf(frame(new AudioCueMapper(), 0, source({ blinks: 3 })))).toEqual([SFX.enemyBlink]);
		const all = source({ blinks: 1, summons: 2, splits: 2, shieldBreaks: 1, vengefulFired: 1 });
		expect(idsOf(frame(new AudioCueMapper(), 0, all))).toEqual([...VARIANT_SFX]);
	});

	it("keeps each ID's minimum interval (a pack's minInterval wins)", () => {
		for (const id of VARIANT_SFX) expect([id, (SFX_MIN_INTERVAL[id] ?? 0) > 0]).toEqual([id, true]);
		const m = new AudioCueMapper();
		const gap = SFX_MIN_INTERVAL[SFX.enemyBlink]!;
		expect(idsOf(frame(m, 1, source({ blinks: 1 })))).toEqual([SFX.enemyBlink]);
		expect(idsOf(frame(m, 1 + gap / 2, source({ blinks: 1 })))).toEqual([]);
		expect(idsOf(frame(m, 1 + gap, source({ blinks: 1 })))).toEqual([SFX.enemyBlink]);
		m.setMinInterval(SFX.enemySplit, 2);
		expect(idsOf(frame(m, 5, source({ splits: 2 })))).toEqual([SFX.enemySplit]);
		expect(idsOf(frame(m, 6, source({ splits: 2 })))).toEqual([]);
	});

	it("a silent ID plays nothing (no fallback, no cap slot, no cooldown)", () => {
		for (const id of VARIANT_SFX) expect([id, SFX_FALLBACK[id]]).toEqual([id, undefined]);
		const silent: Playable = (id) => !(VARIANT_SFX as ReadonlyArray<string>).includes(id);
		const m = new AudioCueMapper(silent);
		const all = source({ blinks: 1, summons: 2, splits: 2, shieldBreaks: 1, vengefulFired: 1 });
		expect(idsOf(frame(m, 0, all))).toEqual([]);
	});

	it("quiet (stage cover, run over): audibleVariantCues hands the mapper nothing", () => {
		const all = source({ blinks: 1, summons: 2, splits: 2, shieldBreaks: 1, vengefulFired: 1 });
		for (const [covered, runOver] of [
			[true, false],
			[false, true],
		]) {
			const out = frame(new AudioCueMapper(), 0, audibleVariantCues(all, comboQuiet(covered, runOver)));
			expect([covered, runOver, idsOf(out)]).toEqual([covered, runOver, []]);
		}
		expect(idsOf(frame(new AudioCueMapper(), 0, audibleVariantCues(all, comboQuiet(false, false))))).toEqual([
			...VARIANT_SFX,
		]);
	});

	it("co-op: world sounds at full volume for every client, the spectated view included", () => {
		const duo = createSimState(1, 0, 0, { party: { size: 2 } });
		for (const me of [0, 1]) {
			const out = frame(new AudioCueMapper(), 0, source({ shieldBreaks: 1 }), duo, me);
			expect([me, idsOf(out), out.volume(0)]).toEqual([me, [SFX.affixShieldBreak], 1]);
		}
	});
});

describe("variant cues: ranks and lists", () => {
	it("rank under every player sound and the telegraph, over the enemy's hurt, death and shot", () => {
		const player = [SFX.playerHurt, SFX.playerSwing, SFX.playerShoot, SFX.playerRoll, SFX.enemyTelegraph];
		for (const id of VARIANT_SFX) {
			for (const p of player) expect([id, p, SFX_PRIORITY[p] > SFX_PRIORITY[id]]).toEqual([id, p, true]);
			for (const e of [SFX.enemyHurt, SFX.enemyDeath, SFX.enemyShoot])
				expect([id, e, SFX_PRIORITY[id] > SFX_PRIORITY[e]]).toEqual([id, e, true]);
		}
		expect(VARIANT_SFX.map((id) => SFX_PRIORITY[id])).toEqual([46, 42, 41, 49, 47]);
	});

	it("a busy frame drops them before the player's hurt and the telegraph", () => {
		const e = noEvents();
		e.playerHits = 1;
		e.telegraphs = 1;
		e.rollStarted = 1;
		e.shotsFired = 1;
		e.meleeSwings = 1;
		const all = source({ blinks: 1, summons: 2, splits: 2, shieldBreaks: 1, vengefulFired: 1 });
		const s = createSimState(1, 0, 0);
		const out = new AudioCueMapper()
			.frame(0, e, NO_FX, s, 0, new AudioCueList(), NO_BOOST_EVENTS, NO_COMBO_EVENTS, undefined, all)
			.toIds();
		expect(out.size()).toBe(AUDIO_VIEW.maxStartsPerFrame);
		for (const id of [SFX.playerHurt, SFX.enemyTelegraph, SFX.playerRoll, SFX.playerSwing, SFX.playerShoot])
			expect(out).toContain(id);
		expect(out).toContain(SFX.affixShieldBreak);
		for (const id of [SFX.enemyBlink, SFX.enemySummon, SFX.enemySplit, SFX.affixVengeful])
			expect(out).never.toContain(id);
	});

	it("are the theme's port audio events, in ALL_SFX and PORT_SFX; no jingle, no duck", () => {
		for (const id of VARIANT_SFX) {
			expect([
				id,
				ALL_SFX.includes(id),
				PORT_SFX.includes(id),
				(PORT_AUDIO_EVENTS as ReadonlyArray<string>).includes(id),
				JINGLE_SFX.includes(id),
				DUCKING_SFX.includes(id),
			]).toEqual([id, true, true, true, false, false]);
		}
	});
});
