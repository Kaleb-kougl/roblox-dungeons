// Roblox port (docs/ARCHER.md AR11 / AR10): the characters' theme strings. The Knight and the Archer names on their class
// slots, the character screen's required strings (written out in REQUIRED_STRING_KEYS like every other group), the
// per-character overrides in both bundled packs, the optional icon ids, and both packs still validating.
import { describe, expect, it } from "@rbxts/jest-globals";
import { CHARACTER_IDS, characterDef } from "shared/characters";
import {
	CHARACTER_ICON_PREFIX,
	CHARACTER_OVERRIDE_KEYS,
	CHARACTER_SCREEN_STRINGS,
	CHARACTER_SUMMARY_LINES,
	THEME_CHARACTER_IDS,
	characterIconId,
	characterLineKey,
	characterOverrideKey,
	characterStringKeys,
} from "./characters";
import { REQUIRED_STRING_KEYS } from "./contract";
import { ThemePack } from "./pack";
import { THEME_PACKS } from "./packs";
import { PLACEHOLDER_MANIFEST } from "./packs/placeholder";
import { sortedKeys } from "./util";
import { validateManifest } from "./validate";

const quiet = (id: string) => new ThemePack(THEME_PACKS[id], { warn: () => undefined });

describe("character strings (docs/ARCHER.md AR11)", () => {
	it("the theme's character ids are shared/characters CHARACTER_IDS", () => {
		expect([...THEME_CHARACTER_IDS]).toEqual([...CHARACTER_IDS]);
	});

	it("the Knight is class.vanguard 'Knight', the Archer class.ranger 'Archer' (owner answer 11)", () => {
		const p = quiet("placeholder");
		expect(p.str(`${characterDef("knight").visualId}.name`)).toBe("Knight");
		expect(p.str(`${characterDef("archer").visualId}.name`)).toBe("Archer");
	});

	it("the screen's keys are required (written out in REQUIRED_STRING_KEYS) and every pack has them", () => {
		const keys = characterStringKeys();
		expect(keys).toEqual([
			"character.title",
			"character.start",
			"run.over.character",
			"character.knight.line.1",
			"character.knight.line.2",
			"character.archer.line.1",
			"character.archer.line.2",
		]);
		expect(CHARACTER_SCREEN_STRINGS.runOverCharacter).toBe("run.over.character");
		expect(CHARACTER_SUMMARY_LINES).toBe(2);
		for (const key of keys) expect([key, REQUIRED_STRING_KEYS.includes(key)]).toEqual([key, true]);
		for (const id of sortedKeys(THEME_PACKS)) {
			const p = quiet(id);
			for (const key of keys) expect([id, key, p.hasString(key)]).toEqual([id, key, true]);
		}
	});

	it("the placeholder's working text (the plan's summary lines)", () => {
		const s = PLACEHOLDER_MANIFEST.strings;
		expect(s["character.title"]).toBe("Choose your character");
		expect(s["character.start"]).toBe("Start");
		expect(s["run.over.character"]).toBe("Character");
		expect([s[characterLineKey("knight", 1)], s[characterLineKey("knight", 2)]]).toEqual([
			"Sword: a three-hit combo.",
			"Guard blocks bullets.",
		]);
		expect([s[characterLineKey("archer", 1)], s[characterLineKey("archer", 2)]]).toEqual([
			"Bow: a stream of arrows, hold to charge.",
			"A longer, safer roll.",
		]);
	});

	it("the five overridden items (the plan's table), in both packs, never required", () => {
		const s = PLACEHOLDER_MANIFEST.strings;
		const rows: ReadonlyArray<[string, string, string]> = [
			["boon.swiftStrikes.evo.desc", "archer", "40% faster; arrows fly in threes"],
			["boon.bastion.desc", "archer", "+1 armor pip; roll through 8 bullets: +1 pip"],
			["duo.stormBlade.desc", "knight", "Finishers spark"],
			["duo.stormBlade.desc", "archer", "Every 5th arrow hit sparks"],
			["duo.fullHeart.desc", "knight", "At full hearts, finishers fire a beam"],
			["duo.fullHeart.desc", "archer", "At full hearts, charged arrows fire a beam"],
			["duo.citadel.desc", "archer", "Every roll through 8 bullets restores a pip"],
		];
		expect(rows.map(([k, c]) => characterOverrideKey(k, c))).toEqual([...CHARACTER_OVERRIDE_KEYS]);
		for (const [key, character, text] of rows) {
			expect([key, character, s[characterOverrideKey(key, character)]]).toEqual([key, character, text]);
			// Every override has its base key (the fallback).
			expect([key, s[key] !== undefined]).toEqual([key, true]);
		}
		const bases = new Set<string>();
		for (const [key] of rows) bases.add(key);
		expect(bases.size()).toBe(5);
		// The Knight's Swift Strikes evolution, Bastion and Citadel lines are the base keys (unchanged).
		expect(s["boon.swiftStrikes.evo.desc.knight"]).toBe(undefined);
		expect(s["boon.bastion.desc.knight"]).toBe(undefined);
		expect(s["duo.citadel.desc.knight"]).toBe(undefined);
		for (const key of CHARACTER_OVERRIDE_KEYS)
			expect([key, REQUIRED_STRING_KEYS.includes(key)]).toEqual([key, false]);
		for (const id of sortedKeys(THEME_PACKS)) {
			const p = quiet(id);
			for (const key of CHARACTER_OVERRIDE_KEYS) expect([id, key, p.hasString(key)]).toEqual([id, key, true]);
		}
	});

	it("icons: optional ui.character.<id>, none in the bundled packs (the class colour square instead)", () => {
		expect(characterIconId("archer")).toBe("ui.character.archer");
		expect(CHARACTER_ICON_PREFIX).toBe("ui.character.");
		for (const id of sortedKeys(THEME_PACKS)) {
			const p = quiet(id);
			for (const c of CHARACTER_IDS)
				expect([id, c, p.image(characterIconId(c)) === undefined]).toEqual([id, c, true]);
		}
	});

	it("both bundled packs validate", () => {
		for (const id of sortedKeys(THEME_PACKS)) {
			expect([id, validateManifest(THEME_PACKS[id], { packId: id })]).toEqual([id, []]);
		}
	});
});
