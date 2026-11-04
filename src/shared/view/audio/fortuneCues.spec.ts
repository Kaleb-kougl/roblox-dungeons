// Fortune's sounds (docs/FORTUNE.md FO6): the eight IDs are the theme's port audio events, listed and ranked here, and
// each falls back to an existing clip while silent (SFX_FALLBACK, one step). The cues that play them are FO9's: none
// is mapped yet, and none ducks the music or is a jingle until then.
import { describe, expect, it } from "@rbxts/jest-globals";
import { FORTUNE_AUDIO_IDS, PORT_AUDIO_EVENTS, REQUIRED_ASSET_IDS } from "shared/theme";
import {
	ALL_SFX,
	AudioCueMapper,
	DUCKING_SFX,
	JINGLE_SFX,
	PORT_SFX,
	SFX,
	SFX_FALLBACK,
	SFX_PRIORITY,
	type SfxId,
} from ".";

const FORTUNE: ReadonlyArray<SfxId> = [
	SFX.pactTake,
	SFX.hordeHorn,
	SFX.hordeWave,
	SFX.hordeDouble,
	SFX.goldenAppear,
	SFX.goldenHit,
	SFX.goldenJackpot,
	SFX.goldenEscape,
];

describe("audio: Fortune's IDs (docs/FORTUNE.md FO6)", () => {
	it("are the theme's port audio events, in ALL_SFX and PORT_SFX, ranked", () => {
		expect([...FORTUNE]).toEqual([...FORTUNE_AUDIO_IDS]);
		for (const id of FORTUNE) {
			expect([
				id,
				(PORT_AUDIO_EVENTS as ReadonlyArray<string>).includes(id),
				ALL_SFX.includes(id),
				PORT_SFX.includes(id),
				SFX_PRIORITY[id] > 0,
			]).toEqual([id, true, true, true, true]);
		}
	});

	it("each falls back, one step, to an existing clip the plan names", () => {
		const want: Array<[SfxId, SfxId]> = [
			[SFX.pactTake, SFX.shrineUse],
			[SFX.hordeHorn, SFX.comboTier],
			[SFX.hordeWave, SFX.enemySummon],
			[SFX.hordeDouble, SFX.scoreLand],
			[SFX.goldenAppear, SFX.pelletPower],
			[SFX.goldenHit, SFX.scoreTick],
			[SFX.goldenJackpot, SFX.roomPerfect],
			[SFX.goldenEscape, SFX.comboBreak],
		];
		for (const [id, to] of want) {
			expect([id, SFX_FALLBACK[id]]).toEqual([id, to]);
			// the target is an ID every pack must define, and not one of Fortune's own
			expect([id, ALL_SFX.includes(to), REQUIRED_ASSET_IDS.includes(to), FORTUNE.includes(to)]).toEqual([
				id,
				true,
				true,
				false,
			]);
			// silent: its fallback plays when that one can; with neither, nothing
			expect([id, new AudioCueMapper((x) => x === to).resolve(id)]).toEqual([id, to]);
			expect([id, new AudioCueMapper((x) => x !== id && x !== to).resolve(id)]).toEqual([id, undefined]);
			expect([id, new AudioCueMapper().resolve(id)]).toEqual([id, id]);
		}
	});

	it("none is a jingle or ducks the music yet (the jackpot's duck is the cue mapper's, FO9)", () => {
		for (const id of FORTUNE)
			expect([id, JINGLE_SFX.includes(id), DUCKING_SFX.includes(id)]).toEqual([id, false, false]);
	});
});
