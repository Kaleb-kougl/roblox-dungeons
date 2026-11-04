// Pact sounds (docs/FORTUNE.md FO9): the cue mapper plays sfx.pact.take for a pact taken (Greed is the taker's own: a
// teammate's quieter and lower-ranked; the Horde arms the party: full volume for everyone), sfx.horde.horn when the
// horde room is roused, sfx.horde.wave when its second wave is telegraphed, sfx.horde.double at its clear only while the
// room clear celebration is off (it plays the x2 itself otherwise); a silent pact sound plays its fallback; the classic
// shrine's own sound no longer counts Greed takes; none of the pact sounds ducks the music or is a jingle.
import { describe, expect, it } from "@rbxts/jest-globals";
import { ALL_EVENT_FIELDS, PactKind, createSimState, eventDefault, type SimEvents, type SimState } from "shared/sim";
import { NO_BOOST_EVENTS } from "shared/view/boosts";
import { FxEventBuffer, NO_BUILD_FX_EVENTS, NO_COMBO_EVENTS, NO_VARIANT_CUES } from "shared/view/fx";
import { NO_DAILY_RANK_CUES, NO_NEW_BEST_CUES } from "shared/view/hud";
import { NO_PELLET_EVENTS } from "shared/view/pellets";
import { PactFrameEvents } from "shared/view/pacts";
import {
	AUDIO_VIEW,
	AudioCueList,
	AudioCueMapper,
	DUCKING_SFX,
	JINGLE_SFX,
	NO_SYNC_CUES,
	SFX,
	SFX_PRIORITY,
	TEAMMATE_PRIORITY_DROP,
	type SfxId,
} from ".";
import { NO_TREASURE_CUES } from "shared/view/treasure";

function noEvents(): SimEvents {
	const e = {} as SimEvents;
	for (const f of ALL_EVENT_FIELDS) e[f] = eventDefault(f);
	return e;
}

const NO_FX = new FxEventBuffer(4);

/** One mapper frame with `pacts`: [id, volume] per cue. */
function frame(m: AudioCueMapper, now: number, s: SimState, pacts: PactFrameEvents, me = 0): Array<[string, number]> {
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
		NO_SYNC_CUES,
		NO_TREASURE_CUES,
		pacts,
	);
	const list: Array<[string, number]> = [];
	for (let i = 0; i < out.size(); i++) list.push([out.id(i), out.volume(i)]);
	return list;
}

function taken(kind: number, player: number): PactFrameEvents {
	const ev = new PactFrameEvents();
	ev.taken.push({ kind, player, x: 0, z: 0, curse: kind === PactKind.GREED ? 0 : -1, tick: 1 });
	return ev;
}

const PACT_SFX: ReadonlyArray<SfxId> = [SFX.pactTake, SFX.hordeHorn, SFX.hordeWave, SFX.hordeDouble];

describe("audio: pact cues (docs/FORTUNE.md FO9)", () => {
	it("a pact taken plays sfx.pact.take; the classic shrine sound does not", () => {
		const s = createSimState(1, 0, 0, {});
		const m = new AudioCueMapper();
		frame(m, 0, s, new PactFrameEvents());
		expect(frame(m, 1, s, taken(PactKind.GREED, 0))).toEqual([[SFX.pactTake, 1]]);
		expect(frame(m, 2, s, taken(PactKind.HORDE, 0))).toEqual([[SFX.pactTake, 1]]);
	});

	it("co-op: a teammate's Greed is quieter, the Horde is the party's (full volume)", () => {
		const s = createSimState(1, 0, 0, {});
		const m = new AudioCueMapper();
		frame(m, 0, s, new PactFrameEvents());
		expect(frame(m, 1, s, taken(PactKind.GREED, 1), 0)).toEqual([[SFX.pactTake, AUDIO_VIEW.teammateVolume]]);
		expect(frame(m, 2, s, taken(PactKind.HORDE, 1), 0)).toEqual([[SFX.pactTake, 1]]);
		expect(TEAMMATE_PRIORITY_DROP > 0).toBe(true);
	});

	it("the horn on rousing, the wave at the telegraph, the x2 at the clear only without the celebration", () => {
		const s = createSimState(1, 0, 0, {});
		const m = new AudioCueMapper();
		frame(m, 0, s, new PactFrameEvents());
		const roused = new PactFrameEvents();
		roused.roused.push(3);
		expect(frame(m, 1, s, roused)).toEqual([[SFX.hordeHorn, 1]]);
		const wave = new PactFrameEvents();
		wave.telegraphed.push(4);
		expect(frame(m, 2, s, wave)).toEqual([[SFX.hordeWave, 1]]);
		const spawned = new PactFrameEvents();
		spawned.spawned.push(4);
		expect(frame(m, 3, s, spawned)).toEqual([]);
		const cleared = new PactFrameEvents();
		cleared.hordeCleared = 1;
		m.celebratesRoomClears = true;
		expect(frame(m, 4, s, cleared)).toEqual([]);
		m.celebratesRoomClears = false;
		expect(frame(m, 5, s, cleared)).toEqual([[SFX.hordeDouble, 1]]);
	});

	it("a silent pact sound plays its fallback (the take: the shrine's sound)", () => {
		const s = createSimState(1, 0, 0, {});
		const m = new AudioCueMapper((id) => id !== SFX.pactTake);
		frame(m, 0, s, new PactFrameEvents());
		expect(frame(m, 1, s, taken(PactKind.GREED, 0))).toEqual([[SFX.shrineUse, 1]]);
	});

	it("ranks: the wave under the telegraph and over the jingles, the horn over the room clear, none ducks", () => {
		const P = SFX_PRIORITY;
		expect(P[SFX.hordeWave] < P[SFX.enemyTelegraph] && P[SFX.hordeWave] > P[SFX.roomClear]).toBe(true);
		expect(P[SFX.hordeHorn] > P[SFX.roomClear] && P[SFX.hordeHorn] < P[SFX.bossRoar]).toBe(true);
		expect(P[SFX.hordeDouble] > P[SFX.scoreLand]).toBe(true);
		expect(P[SFX.pactTake]).toBe(P[SFX.shrineUse]);
		for (const id of PACT_SFX)
			expect([id, JINGLE_SFX.includes(id), DUCKING_SFX.includes(id)]).toEqual([id, false, false]);
	});
});
