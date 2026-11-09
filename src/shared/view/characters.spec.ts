// docs/ARCHER.md AR9: the visual pick. Each player draws their character's visual: the run's pick (RunSetup.characters)
// first, else the character their weapon sets are, else the Knight's visual (ACTOR_VIEW.playerVisualId) as before.
import { describe, expect, it } from "@rbxts/jest-globals";
import { characterLoadout } from "shared/characters";
import { DEV_WORLD_KIND, buildWorldSetup } from "shared/run";
import { DEFAULT_LOADOUT, createSimState, type SimConfig } from "shared/sim";
import { ACTOR_VIEW, ARCHER_SPRITE } from "./config";
import { characterVisualId, playerCharacterOf, playerVisualIdOf } from "./characters";

const solo = (loadout: ReadonlyArray<string | undefined>) => createSimState(1, 0, 0, { loadout });

describe("player visuals (docs/ARCHER.md AR9)", () => {
	it("a character's visual is its def's; no character is the Knight's (ACTOR_VIEW.playerVisualId)", () => {
		expect(characterVisualId("knight")).toBe("class.vanguard");
		expect(characterVisualId("archer")).toBe("class.ranger");
		expect(characterVisualId("archer")).toBe(ARCHER_SPRITE.visualId);
		expect(characterVisualId(undefined)).toBe(ACTOR_VIEW.playerVisualId);
		expect(ACTOR_VIEW.playerVisualId).toBe("class.vanguard");
	});

	it("without run characters: the character the weapons are; M1's two weapons draw the Knight's visual", () => {
		expect(playerCharacterOf(undefined, solo(characterLoadout("archer")), 0)).toBe("archer");
		expect(playerVisualIdOf(undefined, solo(characterLoadout("archer")), 0)).toBe("class.ranger");
		expect(playerCharacterOf(undefined, solo(characterLoadout("knight")), 0)).toBe("knight");
		expect(playerCharacterOf(undefined, solo(DEFAULT_LOADOUT), 0)).toBe(undefined);
		expect(playerVisualIdOf(undefined, solo(DEFAULT_LOADOUT), 0)).toBe("class.vanguard");
		expect(playerVisualIdOf(undefined, undefined, 0)).toBe("class.vanguard");
	});

	it("the run's pick wins over the weapons (dev 'Both weapons' as the Archer draws the Archer)", () => {
		const both = solo(DEFAULT_LOADOUT);
		expect(playerCharacterOf(["archer"], both, 0)).toBe("archer");
		expect(playerVisualIdOf(["archer"], both, 0)).toBe("class.ranger");
		// Not a character id (an untrusted or stale value): the weapons decide.
		expect(playerCharacterOf(["ranger"], solo(characterLoadout("archer")), 0)).toBe("archer");
		expect(playerCharacterOf([""], both, 0)).toBe(undefined);
		const dev = buildWorldSetup(DEV_WORLD_KIND, 7, {
			atBossDoor: false,
			dev: { startFloor: 1, invulnerable: false, bothWeapons: true },
			characters: ["archer"],
		});
		expect(dev.config.loadout).toEqual([...DEFAULT_LOADOUT]);
		const state = createSimState(7, dev.spawn?.x ?? 0, dev.spawn?.z ?? 0, dev.config);
		expect(playerVisualIdOf(dev.characters, state, 0)).toBe("class.ranger");
	});

	it("co-op: per player, index order; outside the party nothing", () => {
		const config: SimConfig = {
			party: { size: 3, loadouts: [characterLoadout("archer"), characterLoadout("knight"), DEFAULT_LOADOUT] },
		};
		const state = createSimState(3, 0, 0, config);
		expect([0, 1, 2].map((i) => playerVisualIdOf(undefined, state, i))).toEqual([
			"class.ranger",
			"class.vanguard",
			"class.vanguard",
		]);
		expect([0, 1, 2].map((i) => playerCharacterOf(undefined, state, i) ?? "none")).toEqual([
			"archer",
			"knight",
			"none",
		]);
		expect(playerCharacterOf(undefined, state, 3)).toBe(undefined);
		expect(playerCharacterOf(undefined, state, -1)).toBe(undefined);
		expect(playerVisualIdOf(["knight", "archer"], state, 1)).toBe("class.ranger");
	});

	it("an endless run built with characters echoes them and each player draws theirs", () => {
		const setup = buildWorldSetup("endless", 11, { atBossDoor: false, partySize: 2, characters: ["archer"] });
		expect(setup.characters).toEqual(["archer", "knight"]);
		const state = createSimState(11, setup.spawn?.x ?? 0, setup.spawn?.z ?? 0, setup.config);
		expect([0, 1].map((i) => playerVisualIdOf(setup.characters, state, i))).toEqual([
			"class.ranger",
			"class.vanguard",
		]);
		expect([0, 1].map((i) => playerVisualIdOf(undefined, state, i))).toEqual(["class.ranger", "class.vanguard"]);
	});
});
