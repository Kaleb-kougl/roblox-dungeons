// Roblox port (docs/GAMEPAD_MENUS.md GM7 / GM9): the gamepad menus' strings are in the contract's list, and every bundled
// pack fills them with short, placeholder-free English. contract.ts names the keys inline (its compiled Luau sits near
// the 200-locals limit), so this spec is what keeps padHints.ts and contract.ts in step.
import { describe, expect, it } from "@rbxts/jest-globals";
import { REQUIRED_STRING_KEYS } from "./contract";
import { THEME_PACKS } from "./packs";
import { PLACEHOLDER_MANIFEST } from "./packs/placeholder";
import { GAMEPAD_MENU_STRING_KEYS, PAD_HINT_STRING_KEYS, PAD_VIBRATION_STRING_KEY } from "./padHints";
import { placeholders, templateProblem } from "./strings";
import { deepClone, sortedKeys, type Obj } from "./util";
import { validateManifest } from "./validate";

/** Every key's English (the placeholder pack's, as the plan words it). */
const ENGLISH: ReadonlyArray<[string, string]> = [
	["pad.hint.select", "Select"],
	["pad.hint.back", "Back"],
	["pad.hint.close", "Close"],
	["pad.hint.resume", "Resume"],
	["pad.hint.cancel", "Cancel"],
	["pad.hint.tabs", "Tabs"],
	["pad.hint.subTabs", "Sub-tabs"],
	["pad.hint.scroll", "Scroll"],
	["pad.hint.holdExit", "Hold: Exit"],
	["pad.hint.details", "Details"],
	["pad.hint.refresh", "Refresh"],
	["pad.hint.create", "Create"],
	["pad.hint.ready", "Ready"],
	["pad.hint.invite", "Invite"],
	["pad.hint.invites", "Invites"],
	["pad.hint.reset", "Reset"],
	["options.controls.vibration", "Vibration"],
];

/** A hint sits beside a glyph in a one-row bar: never longer than this (English). */
const MAX_HINT_CHARS = 12;

describe("gamepad menu strings: contract", () => {
	it("lists the 16 hint labels then the vibration row, written out in REQUIRED_STRING_KEYS as one run", () => {
		expect([...GAMEPAD_MENU_STRING_KEYS]).toEqual(ENGLISH.map(([k]) => k));
		expect(PAD_HINT_STRING_KEYS.size()).toBe(16);
		expect(GAMEPAD_MENU_STRING_KEYS[GAMEPAD_MENU_STRING_KEYS.size() - 1]).toBe(PAD_VIBRATION_STRING_KEY);
		const start = REQUIRED_STRING_KEYS.indexOf(GAMEPAD_MENU_STRING_KEYS[0]);
		expect(start >= 0).toBe(true);
		const run = new Array<string>();
		for (let i = 0; i < GAMEPAD_MENU_STRING_KEYS.size(); i++) run.push(REQUIRED_STRING_KEYS[start + i]);
		expect(run).toEqual([...GAMEPAD_MENU_STRING_KEYS]);
		expect(new Set(REQUIRED_STRING_KEYS).size()).toBe(REQUIRED_STRING_KEYS.size());
	});
});

describe("gamepad menu strings: packs", () => {
	it("the placeholder's English, short and without placeholders", () => {
		const s = PLACEHOLDER_MANIFEST.strings;
		for (const [k, text] of ENGLISH) {
			expect([k, s[k]]).toEqual([k, text]);
			expect([k, text.size() <= MAX_HINT_CHARS]).toEqual([k, true]);
		}
	});

	it("every bundled pack fills every key with a well-formed, placeholder-free text", () => {
		for (const id of sortedKeys(THEME_PACKS)) {
			const strings = THEME_PACKS[id].strings;
			for (const [k] of ENGLISH) {
				const text = strings[k];
				expect([id, k, typeIs(text, "string")]).toEqual([id, k, true]);
				expect([id, k, templateProblem(text as string)]).toEqual([id, k, undefined]);
				expect([id, k, placeholders(text as string).size()]).toEqual([id, k, 0]);
			}
		}
	});

	it("a pack missing one of them fails validation", () => {
		for (const k of ["pad.hint.holdExit", "pad.hint.select", PAD_VIBRATION_STRING_KEY]) {
			const m = deepClone(PLACEHOLDER_MANIFEST) as unknown as Obj;
			(m.strings as Obj)[k] = undefined;
			expect([k, validateManifest(m).some((e) => e.find(`"${k}"`, 1, true)[0] !== undefined)]).toEqual([k, true]);
		}
	});
});
