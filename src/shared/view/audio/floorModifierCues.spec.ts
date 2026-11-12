// The floor modifiers' stings (docs/FLOOR_MODIFIERS.md FM7, FMD9): the five IDs are the theme's port audio events,
// listed and ranked here (just under the floor enter), each falls back one step to an existing clip while silent (a boon
// the Legendary chest's jingle, the twist the Horde's horn), and floorModifierStingId maps a floor modifier id to its
// sting. The card plays it on the banner's stamp (FM5).
import { describe, expect, it } from "@rbxts/jest-globals";
import { FloorModifier, MODIFIERS, isFloorModifierTwist } from "shared/dungeon";
import { FLOOR_MODIFIER_AUDIO_IDS, PORT_AUDIO_EVENTS, REQUIRED_ASSET_IDS, floorModifierAudioId } from "shared/theme";
import {
	ALL_SFX,
	AudioCueMapper,
	DUCKING_SFX,
	JINGLE_SFX,
	PORT_SFX,
	SFX,
	SFX_FALLBACK,
	SFX_PRIORITY,
	floorModifierStingId,
	type SfxId,
} from ".";

const STINGS: ReadonlyArray<SfxId> = [
	SFX.floorModifierGilded,
	SFX.floorModifierHoard,
	SFX.floorModifierFeast,
	SFX.floorModifierPlunder,
	SFX.floorModifierBloodMoon,
];

describe("audio: the floor modifier stings (docs/FLOOR_MODIFIERS.md FM7)", () => {
	it("are the theme's port audio events, in ALL_SFX and PORT_SFX, ranked just under the floor enter", () => {
		expect([...STINGS]).toEqual([...FLOOR_MODIFIER_AUDIO_IDS]);
		for (const id of STINGS) {
			expect([
				id,
				(PORT_AUDIO_EVENTS as ReadonlyArray<string>).includes(id),
				ALL_SFX.includes(id),
				PORT_SFX.includes(id),
				SFX_PRIORITY[id],
			]).toEqual([id, true, true, true, SFX_PRIORITY[SFX.floorEnter] - 1]);
			// a sting, not a jingle: it never ducks the music
			expect([id, JINGLE_SFX.includes(id), DUCKING_SFX.includes(id)]).toEqual([id, false, false]);
		}
	});

	it("each falls back, one step: a boon to the Legendary chest's jingle, the twist to the Horde's horn", () => {
		for (const id of STINGS) {
			const twist = id === SFX.floorModifierBloodMoon;
			const to = twist ? SFX.hordeHorn : SFX.jingleTreasure;
			expect([id, SFX_FALLBACK[id]]).toEqual([id, to]);
			expect([id, ALL_SFX.includes(to), REQUIRED_ASSET_IDS.includes(to), STINGS.includes(to)]).toEqual([
				id,
				true,
				true,
				false,
			]);
			expect([id, new AudioCueMapper((x) => x === to).resolve(id)]).toEqual([id, to]);
			expect([id, new AudioCueMapper((x) => x !== id && x !== to).resolve(id)]).toEqual([id, undefined]);
			expect([id, new AudioCueMapper().resolve(id)]).toEqual([id, id]);
		}
	});

	it("floorModifierStingId maps every kind to its sting (the theme's id for its key), NONE and unknown to none", () => {
		for (const k of MODIFIERS.kinds) {
			const id = floorModifierStingId(k.id);
			expect([k.key, id]).toEqual([k.key, floorModifierAudioId(k.key)]);
			expect([k.key, SFX_FALLBACK[id!] === SFX.hordeHorn]).toEqual([k.key, isFloorModifierTwist(k.id)]);
		}
		expect(floorModifierStingId(FloorModifier.GILDED)).toBe(SFX.floorModifierGilded);
		expect(floorModifierStingId(FloorModifier.BLOOD_MOON)).toBe(SFX.floorModifierBloodMoon);
		expect([floorModifierStingId(FloorModifier.NONE), floorModifierStingId(99), floorModifierStingId(-1)]).toEqual([
			undefined,
			undefined,
			undefined,
		]);
	});
});
