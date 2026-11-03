// The co-op moments' two sounds (docs/RUN_RECAP.md CM4). Registration: the IDs are the theme's port audio events, in
// ALL_SFX / PORT_SFX, ranked with the sound they stand in for, TEAM PERFECT a jingle that ducks, and each falls back one
// step while silent (TEAM PERFECT -> PERFECT, SYNC! -> the parry). Playback: the room clear's stamp / chip jingle rules
// (TEAM PERFECT in place of PERFECT, the chip at its volume) and the mapper's SYNC! cue (once per formed sync, view player
// loud, a teammate pair quieter, the parry +5 semitones while silent, nothing with both silent, the per-frame cap).
import { describe, expect, it } from "@rbxts/jest-globals";
import { ALL_EVENT_FIELDS, createSimState, eventDefault, type SimEvents, type SimState } from "shared/sim";
import { PORT_AUDIO_EVENTS, TEAM_MOMENT_AUDIO_IDS } from "shared/theme";
import { NO_COMBO_EVENTS, TEAM_MOMENTS_VIEW, type NearMissFrame, type SyncParryMoment } from "../fx";
import { FxEventBuffer } from "../fx/events";
import { semitonesToSpeed } from "../hud";
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
	SFX_PRIORITY,
	roomClearChipJingle,
	roomClearStampJingle,
	type Playable,
} from ".";

describe("audio: the co-op moments' IDs (docs/RUN_RECAP.md CM4)", () => {
	const ids = [SFX.roomTeamPerfect, SFX.playerSyncParry];

	it("are the theme's port audio events (lowercase segments), in ALL_SFX and PORT_SFX, ranked", () => {
		expect(ids).toEqual(["sfx.room.teamperfect", "sfx.player.syncparry"]);
		expect([...TEAM_MOMENT_AUDIO_IDS]).toEqual(ids);
		for (const id of ids) {
			expect([
				id,
				ALL_SFX.includes(id),
				PORT_SFX.includes(id),
				(PORT_AUDIO_EVENTS as ReadonlyArray<string>).includes(id),
			]).toEqual([id, true, true, true]);
		}
		expect(SFX_PRIORITY[SFX.roomTeamPerfect]).toBe(SFX_PRIORITY[SFX.roomPerfect]);
		expect(SFX_PRIORITY[SFX.playerSyncParry]).toBeGreaterThan(SFX_PRIORITY[SFX.playerParry]);
	});

	it("TEAM PERFECT is a jingle that ducks the music, like PERFECT; SYNC! is neither", () => {
		expect([JINGLE_SFX.includes(SFX.roomTeamPerfect), DUCKING_SFX.includes(SFX.roomTeamPerfect)]).toEqual([
			true,
			true,
		]);
		expect([JINGLE_SFX.includes(SFX.playerSyncParry), DUCKING_SFX.includes(SFX.playerSyncParry)]).toEqual([
			false,
			false,
		]);
	});

	it("falls back one step while silent: TEAM PERFECT -> PERFECT, SYNC! -> the parry", () => {
		expect(SFX_FALLBACK[SFX.roomTeamPerfect]).toBe(SFX.roomPerfect);
		expect(SFX_FALLBACK[SFX.playerSyncParry]).toBe(SFX.playerParry);
		// with clips, each is itself
		const all = new AudioCueMapper();
		expect([all.resolve(SFX.roomTeamPerfect), all.resolve(SFX.playerSyncParry)]).toEqual(ids);
		// silent (the placeholder and vale today): the PERFECT jingle and the parry
		const silent = new AudioCueMapper((id) => !ids.includes(id as (typeof ids)[number]));
		expect([silent.resolve(SFX.roomTeamPerfect), silent.resolve(SFX.playerSyncParry)]).toEqual([
			SFX.roomPerfect,
			SFX.playerParry,
		]);
		// one step only: with the fallback silent too, nothing
		const none = new AudioCueMapper(
			(id) =>
				id !== SFX.roomTeamPerfect &&
				id !== SFX.roomPerfect &&
				id !== SFX.playerSyncParry &&
				id !== SFX.playerParry,
		);
		expect([none.resolve(SFX.roomTeamPerfect), none.resolve(SFX.playerSyncParry)]).toEqual([undefined, undefined]);
	});
});

describe("audio: TEAM PERFECT's jingle (docs/RUN_RECAP.md CM4, CMD2)", () => {
	it("the stamp: TEAM PERFECT in place of PERFECT for a team perfect; PERFECT / CLEAR otherwise", () => {
		expect([
			roomClearStampJingle(true, true),
			roomClearStampJingle(true, false),
			roomClearStampJingle(false, false),
			roomClearStampJingle(false, true),
		]).toEqual([SFX.roomTeamPerfect, SFX.roomPerfect, SFX.roomClear, SFX.roomClear]);
	});

	it("a far client's chip: TEAM PERFECT when a team chip started, else the clear (both at the chip's volume)", () => {
		expect([roomClearChipJingle(1), roomClearChipJingle(2), roomClearChipJingle(0)]).toEqual([
			SFX.roomTeamPerfect,
			SFX.roomTeamPerfect,
			SFX.roomClear,
		]);
	});
});

type Cue = [string, number, number];

function noEvents(): SimEvents {
	const e = {} as SimEvents;
	for (const f of ALL_EVENT_FIELDS) e[f] = eventDefault(f);
	return e;
}

const NO_FX = new FxEventBuffer(1);

function trio(): SimState {
	return createSimState(1, 0, 0, { party: { size: 3 }, scoring: { partySize: 3 } });
}

function primed(s: SimState, playable?: Playable): AudioCueMapper {
	const m = new AudioCueMapper(playable);
	m.frame(0, noEvents(), NO_FX, s, 0, new AudioCueList());
	return m;
}

/** A near-miss frame with one parry cue (player 1's guard starting, a teammate's for view player 0) or none. */
function nearMiss(parry: boolean): NearMissFrame {
	return {
		grazeSparks: [],
		parryBursts: [],
		grazeCue: undefined,
		parryCues: parry ? [{ player: 1, local: false, speed: 1 }] : [],
		flashes: [],
		freezeMs: 0,
		parryGroups: [],
	};
}

function sync(players: number[], grew = false): Pick<SyncParryMoment, "grew" | "points"> {
	return { grew, points: players.map((player) => ({ player, tick: 0, x: 0, z: 0 })) };
}

function run(
	m: AudioCueMapper,
	now: number,
	s: SimState,
	syncs: ReadonlyArray<Pick<SyncParryMoment, "grew" | "points">>,
	parry = false,
	me = 0,
): Cue[] {
	const out = m.frame(
		now,
		noEvents(),
		NO_FX,
		s,
		me,
		new AudioCueList(),
		undefined,
		NO_COMBO_EVENTS,
		nearMiss(parry),
		undefined,
		undefined,
		undefined,
		undefined,
		undefined,
		syncs,
	);
	const list: Cue[] = [];
	for (let i = 0; i < out.size(); i++) list.push([out.id(i), out.volume(i), out.speed(i)]);
	return list;
}

describe("audio: SYNC! (docs/RUN_RECAP.md CM4)", () => {
	const quietRank = SFX_PRIORITY[SFX.playerSyncParry];

	it("a formed sync with the view player plays sfx.player.syncparry at full volume (the pack's jitter)", () => {
		const s = trio();
		const m = primed(s);
		expect(run(m, 1, s, [sync([0, 1])])).toEqual([[SFX.playerSyncParry, 1, 0]]);
		expect(quietRank).toBeGreaterThan(0);
	});

	it("a teammate pair's sync plays at the teammate volume; nothing without a sync", () => {
		const s = trio();
		const m = primed(s);
		expect(run(m, 1, s, [sync([1, 2])])).toEqual([[SFX.playerSyncParry, AUDIO_VIEW.teammateVolume, 0]]);
		expect(run(m, 5, s, [])).toEqual([]);
	});

	it("once per sync: a record that grew (a further player joined) plays no second cue", () => {
		const s = trio();
		const m = primed(s);
		expect(run(m, 1, s, [sync([0, 1, 2], true)])).toEqual([]);
		// one formed sync and an older one growing on the same frame: one cue
		expect(run(m, 5, s, [sync([0, 1], true), sync([1, 2])])).toEqual([
			[SFX.playerSyncParry, AUDIO_VIEW.teammateVolume, 0],
		]);
	});

	it("silent: the parry at +fallbackSemitones, merged with the frame's parry cue into one sound", () => {
		const s = trio();
		const up = semitonesToSpeed(TEAM_MOMENTS_VIEW.syncAudio.fallbackSemitones);
		expect(TEAM_MOMENTS_VIEW.syncAudio.fallbackSemitones).toBe(5);
		const m = primed(s, (id) => id !== SFX.playerSyncParry);
		expect(run(m, 1, s, [sync([0, 1])])).toEqual([[SFX.playerParry, 1, up]]);
		// the teammate's parry cue of the same frame becomes the one higher, louder parry
		expect(run(m, 5, s, [sync([0, 1])], true)).toEqual([[SFX.playerParry, 1, up]]);
		// with no sync the parry is as before
		expect(run(m, 9, s, [], true)).toEqual([[SFX.playerParry, AUDIO_VIEW.teammateVolume, 1]]);
	});

	it("with the parry silent too: nothing (and the parry's own rules leave the deflect alone)", () => {
		const s = trio();
		const m = primed(s, (id) => id !== SFX.playerSyncParry && id !== SFX.playerParry);
		expect(run(m, 1, s, [sync([0, 1])], true)).toEqual([]);
	});

	it("takes part in the per-frame cap by its rank (over the parry)", () => {
		expect(SFX_PRIORITY[SFX.playerSyncParry]).toBeGreaterThan(SFX_PRIORITY[SFX.playerParry]);
		const s = trio();
		const m = primed(s);
		// the parry cue and the sync both start (2 <= the cap)
		const cues = run(m, 1, s, [sync([0, 1])], true).map((c) => c[0]);
		expect(cues.size() <= AUDIO_VIEW.maxStartsPerFrame).toBe(true);
		expect([cues.includes(SFX.playerParry), cues.includes(SFX.playerSyncParry)]).toEqual([true, true]);
	});
});
