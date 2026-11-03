// The co-op moments' two sounds, registration only (docs/RUN_RECAP.md CM4, first half): the IDs are the theme's port
// audio events, in ALL_SFX / PORT_SFX, ranked with the sound they stand in for, TEAM PERFECT a jingle that ducks, and
// each falls back one step while silent (TEAM PERFECT -> PERFECT, SYNC! -> the parry). The mapper's playback rules come
// with CM4's second half.
import { describe, expect, it } from "@rbxts/jest-globals";
import { PORT_AUDIO_EVENTS, TEAM_MOMENT_AUDIO_IDS } from "shared/theme";
import { ALL_SFX, AudioCueMapper, DUCKING_SFX, JINGLE_SFX, PORT_SFX, SFX, SFX_FALLBACK, SFX_PRIORITY } from ".";

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
